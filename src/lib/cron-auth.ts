// Shared bearer-token auth helper for Vercel cron endpoints.
//
// Two security properties beyond a naïve `===` check:
//
// 1. Constant-time comparison via crypto.timingSafeEqual. Defends
//    against timing-side-channel guessing of CRON_SECRET — not
//    realistically exploitable today (Vercel cron is the only caller),
//    but trivial to do right and removes the foot-gun if these endpoints
//    are ever opened up to additional callers.
//
// 2. Generic "Unauthorized" reply when CRON_SECRET is unset. The previous
//    "CRON_SECRET not configured." string was an unauthenticated
//    information disclosure — it told a probe (a) the route exists,
//    (b) the env var name to look for, and (c) which deploys are
//    misconfigured. Returning the same 401 in both cases denies all
//    of that.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

const UNAUTHORIZED: NextResponse = NextResponse.json(
  { ok: false, error: "Unauthorized." },
  { status: 401 },
);

function bearerMatches(authHeader: string, secret: string): boolean {
  // Constant-time comparison that does NOT leak the secret's length.
  // Pad both buffers to the same length BEFORE timingSafeEqual, then
  // AND with a separate length equality check.
  const expectedHeader = `Bearer ${secret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expectedHeader);
  const padLen = Math.max(a.length, b.length, 1);
  const aPad = Buffer.alloc(padLen, 0);
  const bPad = Buffer.alloc(padLen, 0);
  a.copy(aPad);
  b.copy(bPad);
  const bytesEqual = timingSafeEqual(aPad, bPad);
  const lensEqual = a.length === b.length;
  return bytesEqual && lensEqual;
}

export function verifyCronAuth(request: Request): CronAuthResult {
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Server-side log so operators can still see the misconfiguration —
    // the secret is just not exposed to the unauthenticated caller.
    console.error("[cron-auth] CRON_SECRET not configured");
    return { ok: false, response: UNAUTHORIZED };
  }
  if (!bearerMatches(authHeader, expected)) {
    return { ok: false, response: UNAUTHORIZED };
  }
  return { ok: true };
}

/**
 * Operator UI / admin API auth (audit 2026-07-09, tightened 2026-10-18).
 *
 * When `ADMIN_SECRET` is set it is the ONLY admin bearer: the master
 * `CRON_SECRET` no longer opens /admin or /api/admin (security audit
 * 2026-10-18, M4). While `ADMIN_SECRET` is unset the old fallback to
 * `CRON_SECRET` stays, so nothing breaks before the operator sets it.
 */
export function verifyAdminAuth(request: Request): CronAuthResult {
  const authHeader = request.headers.get("authorization") ?? "";
  const admin = process.env.ADMIN_SECRET;
  if (admin) {
    return bearerMatches(authHeader, admin)
      ? { ok: true }
      : { ok: false, response: UNAUTHORIZED };
  }
  const cron = process.env.CRON_SECRET;
  if (!cron) {
    console.error("[cron-auth] ADMIN_SECRET and CRON_SECRET both unset");
    return { ok: false, response: UNAUTHORIZED };
  }
  if (!warnedAdminFallback) {
    warnedAdminFallback = true;
    console.warn("[cron-auth] ADMIN_SECRET unset · admin routes still accept CRON_SECRET");
  }
  return bearerMatches(authHeader, cron)
    ? { ok: true }
    : { ok: false, response: UNAUTHORIZED };
}
let warnedAdminFallback = false;

const THROTTLE = { limit: 20, windowSec: 900 } as const;

/**
 * Shared failure throttle, per IP bucket (security audit 2026-10-18 L10,
 * Review follow-up). The bucket is checked BEFORE the bearer is
 * compared: an IP that already has 20 rejected bearers in the window is
 * refused outright, so further guesses are never evaluated, even a
 * correct one. Only rejected bearers are counted, so the scheduler's own
 * IP never fills its bucket by succeeding.
 */
async function throttled(
  request: Request,
  check: (request: Request) => CronAuthResult,
  name: string,
): Promise<CronAuthResult> {
  const { rateLimit, rateLimitPeek } = await import("./rate-limit");
  const opts = { name, ...THROTTLE };
  const peek = await rateLimitPeek(request, opts);
  if (!peek.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401, headers: peek.headers },
      ),
    };
  }
  const auth = check(request);
  if (auth.ok) return auth;
  const rl = await rateLimit(request, opts);
  if (!rl.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401, headers: rl.headers },
      ),
    };
  }
  return auth;
}

/**
 * Cron auth plus the same failure throttle as admin (security audit
 * 2026-10-18, L10). 20 rejected bearers / 15 min / IP. Successful calls
 * (Vercel cron, the operator's scripts) are never counted, so a flood of
 * bad guesses from another IP cannot lock the scheduler out. An IP over
 * the cap is refused before its bearer is compared.
 */
export async function verifyCronAuthLimited(
  request: Request,
): Promise<CronAuthResult> {
  return throttled(request, verifyCronAuth, "cron-auth-fail");
}

/**
 * Admin auth plus a failure throttle. 20 rejected bearers / 15 min / IP
 * so a short pasted secret cannot be sprayed unbounded. Successes are
 * not counted. Past the cap the IP is refused before any compare (401).
 */
export async function verifyAdminAuthLimited(
  request: Request,
): Promise<CronAuthResult> {
  return throttled(request, verifyAdminAuth, "admin-auth-fail");
}
