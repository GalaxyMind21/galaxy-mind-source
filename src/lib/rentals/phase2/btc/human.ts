/**
 * Route handlers for the human "Pay with Bitcoin" checkout (POST /api/rentals/btc/bind, /api/rentals/btc/status).
 * Both answer 404 unless the human checkout flag AND RENTALS_BTC_ONCHAIN_ENABLED=1 are on and BTC is wired.
 *
 * bind: Turnstile REQUIRED (a missing secret refuses; never the "skip" path), then 3 picks per IP per hour + a global
 * ceiling in KV (fail closed), then createBtcBinding (owner only: rental_id + creator_secret).
 */
import { humanCheckoutFlag, btcPickLimit, type Incr, type Out } from "../human";
import { stagingDeps } from "../staging";
import type { Deps } from "../service";
import { btcFlag } from "./config";
import { localLimit } from "../../../rate-limit";
import { createBtcBinding, btcStatus } from "./service";

type Env = Record<string, string | undefined>;
export type TurnstileCheck = (token: string | undefined) => Promise<{ ok: true; kind: "verified" | "skip" } | { ok: false; reason: string }>;
export type BtcBindCtx = { env?: Env; deps?: Deps | null; incr: Incr; ipBucket: string; turnstile: TurnstileCheck };

const STATUS: Record<string, number> = {
  invalid_input: 400, not_found: 404, rate_limited: 429, rate_limit_unavailable: 503, captcha_failed: 403,
  btc_unavailable: 503, not_payable: 409, order_expired: 410, btc_binding_exists: 409, retry: 503, rentals_paused: 503, server_error: 500,
};
const fail = (error: string, message?: string, headers?: Record<string, string>): Out => ({ status: STATUS[error] ?? 400, body: { error, ...(message ? { message } : {}) }, headers });

function depsFor(ctx: { env?: Env; deps?: Deps | null }): Deps | null {
  const env = ctx.env ?? process.env;
  if (!humanCheckoutFlag(env) || !btcFlag(env)) return null;
  const d = ctx.deps === undefined ? stagingDeps(env) : ctx.deps;
  return d && d.btc ? d : null;
}
const body = (b: unknown) => (b && typeof b === "object" ? b : {}) as Record<string, unknown>;

export async function handleBtcBind(raw: unknown, ctx: BtcBindCtx): Promise<Out> {
  const d = depsFor(ctx);
  if (!d) return fail("not_found");
  const b = body(raw);
  if (typeof b.rental_id !== "string" || typeof b.creator_secret !== "string") return fail("invalid_input");
  const token = typeof b.turnstile_token === "string" && b.turnstile_token.length <= 4096 ? b.turnstile_token : undefined;
  let t;
  try { t = await ctx.turnstile(token); } catch { t = { ok: false as const, reason: "error" }; }
  if (!t.ok || t.kind !== "verified") return fail("captcha_failed", "Complete the check, then try again.");
  const lim = await btcPickLimit(ctx.incr, ctx.ipBucket);
  if (!lim.ok) return fail(lim.error, lim.error === "rate_limited" ? "Too many Bitcoin requests. Try again later or pay with USDC." : undefined, { "Retry-After": String(lim.retryAfter) });
  try {
    const r = await createBtcBinding(d, { rental_id: b.rental_id, creator_secret: b.creator_secret });
    if (!r.ok) return fail(r.error, (r as { message?: string }).message);
    return { status: 200, body: r.result as Record<string, unknown>, headers: { "Cache-Control": "no-store" } };
  } catch { return fail("server_error"); }
}

/** SF4: per-IP ceiling on status polls (the page polls every ~1-8 s; 60/min leaves headroom for two tabs). */
export const BTC_STATUS_LIMIT = { perIp: 60, windowSec: 60 } as const;

/** Body: { rental_id, creator_secret, abandon? }. Polled by the page (every few seconds while open). */
export async function handleBtcStatus(raw: unknown, ctx: { env?: Env; deps?: Deps | null; incr?: Incr; ipBucket?: string; nowMs?: () => number }): Promise<Out> {
  const d = depsFor(ctx);
  if (!d) return fail("not_found");
  {
    // Never fails open: status is NOT read-only (first display records a nonce and can release/refuse a binding), so a
    // KV outage (no incr, a throw, null or a zero count) falls back to the per-instance in-memory window (localLimit).
    const key = `ratelimit:rentals-btc-status:ip:${ctx.ipBucket ?? "unknown"}`;
    let r: { count: number; ttlSec: number } | null = null;
    try { r = ctx.incr ? await ctx.incr(key, BTC_STATUS_LIMIT.windowSec) : null; } catch { r = null; }
    if (r && r.count > 0) {
      if (r.count > BTC_STATUS_LIMIT.perIp) return fail("rate_limited", "Too many requests. Wait a moment.", { "Retry-After": String(Math.max(1, r.ttlSec)) });
    } else {
      const l = localLimit(key, BTC_STATUS_LIMIT.perIp, ctx.nowMs?.());
      if (!l.ok) return fail("rate_limited", "Too many requests. Wait a moment.", { "Retry-After": l.headers["Retry-After"] ?? "60" });
    }
  }
  const b = body(raw);
  if (typeof b.rental_id !== "string" || typeof b.creator_secret !== "string") return fail("invalid_input");
  try {
    const r = await btcStatus(d, { rental_id: b.rental_id, creator_secret: b.creator_secret, abandon: b.abandon === true });
    if (!r.ok) return fail(r.error, (r as { message?: string }).message);
    return { status: 200, body: r.result as Record<string, unknown>, headers: { "Cache-Control": "no-store" } };
  } catch { return fail("server_error"); }
}
