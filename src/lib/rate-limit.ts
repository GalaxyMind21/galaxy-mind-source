// Coarse per-IP sliding-window rate limit for public API routes.
//
// Backed by the atomic kvIncrWithTtl Lua (one KV command per call · INCR
// + EXPIRE-on-first-hit, no permanent-lockout race). FAILS CLOSED
// (review, 2026-10-16): when KV is unconfigured or a write fails,
// a per-instance in-memory window still enforces min(limit, 100)/min, so a
// KV outage never means unlimited calls.
//
// IMPORTANT · only apply this to routes that are ALREADY dynamic (read
// the request / query params). Adding it to a statically-cacheable route
// handler (`export const revalidate = N`, no req param) would force that
// route dynamic and DISABLE its edge cache — which is the better defense
// for a parameterless read. For those, strengthen Cache-Control instead.
//
// IP source: getClientIp() uses Vercel's unforgeable
// x-vercel-forwarded-for, so the bucket key can't be trivially spoofed.

import { getClientIp } from "./client-ip";
import { kvIncrWithTtlFull, kvGetChecked, isKvConfigured } from "./kv";

export type RateLimitResult = {
  /** False ⇒ over the limit; caller should return 429 with `headers`. */
  ok: boolean;
  /** Standard headers to attach to the response (X-RateLimit-* [+ Retry-After when blocked]). */
  headers: Record<string, string>;
};

/**
 * Check + increment the per-IP counter for `name`. Returns ok + the
 * X-RateLimit-* headers to attach. Generous limits are the intent — the
 * goal is to clip floods and bandwidth/cost abuse, not to throttle
 * legitimate polling.
 *
 * On 429, Retry-After is the *remaining* window TTL from Redis PTTL
 * (not the full windowSec), so clients back off accurately.
 */
export async function rateLimit(
  req: Request | { headers: Headers },
  opts: { name: string; limit: number; windowSec: number },
): Promise<RateLimitResult> {
  const { name, limit, windowSec } = opts;

  const ip = rateLimitBucket(getClientIp(req));
  const key = `ratelimit:${name}:${ip}`;
  // KV missing or failed mid-call · fail closed to the local window.
  const hit = isKvConfigured() ? await kvIncrWithTtlFull(key, windowSec).catch(() => null) : null;
  if (!hit || hit.count === 0) {
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn(`[ratelimit] KV ${isKvConfigured() ? "returned no count" : "not configured"} · using local fallback`);
    }
    const r = localLimit(key, limit);
    return { ...r, headers: { ...r.headers, "X-RateLimit-Source": "local" } };
  }

  const remaining = Math.max(0, limit - hit.count);
  const source = { "X-RateLimit-Source": "kv" };
  const ok = hit.count <= limit;
  return {
    ok,
    headers: {
      ...source,
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": String(remaining),
      ...(ok
        ? {}
        : {
            "Retry-After": String(
              Math.max(1, Math.min(windowSec, hit.ttlSec || windowSec)),
            ),
          }),
    },
  };
}

let warnedFallback = false;

/**
 * Read the per-IP counter for `name` WITHOUT incrementing it. ok:false
 * when the bucket already holds `limit` hits, so a caller can refuse
 * before doing the guarded work (auth compares). A KV read failure falls
 * back to the local window, the same place rateLimit() counts on failure.
 */
export async function rateLimitPeek(
  req: Request | { headers: Headers },
  opts: { name: string; limit: number; windowSec: number },
): Promise<RateLimitResult> {
  const { name, limit, windowSec } = opts;
  const key = `ratelimit:${name}:${rateLimitBucket(getClientIp(req))}`;
  const blocked = (retry: number): RateLimitResult => ({
    ok: false,
    headers: { "X-RateLimit-Limit": String(limit), "X-RateLimit-Remaining": "0", "Retry-After": String(Math.max(1, retry)) },
  });
  if (isKvConfigured()) {
    const got = await kvGetChecked<number | string>(key).catch(() => ({ ok: false, value: null }));
    if (got.ok) {
      const count = Number(got.value ?? 0) || 0;
      return count >= limit ? blocked(windowSec) : { ok: true, headers: {} };
    }
  }
  const b = local.get(key);
  const now = Date.now();
  if (b && now - b.start < 60_000 && b.count >= Math.min(limit, LOCAL_FALLBACK_MAX)) {
    return blocked(Math.ceil((b.start + 60_000 - now) / 1000));
  }
  return { ok: true, headers: {} };
}

/* Fallback window used when KV is unavailable. Per instance, 60s, capped at 100. */
export const LOCAL_FALLBACK_MAX = 100;
const local = new Map<string, { start: number; count: number }>();
export function localLimit(key: string, limit: number, nowMs: number = Date.now()): RateLimitResult {
  const cap = Math.min(limit, LOCAL_FALLBACK_MAX);
  let b = local.get(key);
  if (!b || nowMs - b.start >= 60_000) {
    b = { start: nowMs, count: 0 };
    if (local.size > 10_000) local.clear();
    local.set(key, b);
  }
  b.count += 1;
  const ok = b.count <= cap;
  return {
    ok,
    headers: {
      "X-RateLimit-Limit": String(cap),
      "X-RateLimit-Remaining": String(Math.max(0, cap - b.count)),
      ...(ok ? {} : { "Retry-After": String(Math.max(1, Math.ceil((b.start + 60_000 - nowMs) / 1000))) }),
    },
  };
}

/**
 * Bucket key for an IP. IPv6 clients rotate addresses freely (privacy
 * addresses, VPN egress pools), so a per-/128 key never fills: the
 * 2026-10-16 security review run sent 225 requests in 40 s from rotating
 * 2a09:bac5:... addresses and every one landed in a fresh bucket. IPv6 is
 * bucketed by its /48 prefix; IPv4 stays per address.
 */
export function rateLimitBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return full.slice(0, 3).map((x) => x.replace(/^0+(?=.)/, "")).join(":") + "::/48";
}
