// Phase 2 sweeper, run by Vercel Cron only: expire unpaid orders, re-offer expired unapplied
// route/revert jobs, expired_unapplied after 30 min. Bearer CRON_SECRET (constant-time) checked first; only failed auth is rate limited.
import crypto from "node:crypto";
import { phase2Enabled } from "@/lib/rentals/phase2/flag";
import { stagingDeps } from "@/lib/rentals/phase2/staging";
import { sweepExpired, paidInLastWindow } from "@/lib/rentals/phase2/service";
import { sweepBtc } from "@/lib/rentals/phase2/btc/service";
import { Limiter } from "@/lib/rentals/phase2/safety";
import { ethDepsOf } from "@/lib/rentals/phase2/eth/wire";
import { sweepEth } from "@/lib/rentals/phase2/eth/service";
import { trackFunnel } from "@/lib/rentals/funnel";

export const dynamic = "force-dynamic";
/** #103 S5: the sweep (expiry work, then the time-budgeted pending Solana re-check) must finish inside this. */
export const maxDuration = 60;
/** Counts FAILED auth only, so unauthenticated callers cannot exhaust the cron's quota. */
const failLimiter = new Limiter(6, 60_000);
/** Auth is checked BEFORE any limiter. A valid secret always passes. */
export function sweepGate(header: string | null, secret: string | undefined, now: number, lim: Limiter = failLimiter): 200 | 401 | 429 {
  if (cronAuthorized(header, secret)) return 200;
  return lim.ok("sweep_fail", now) ? 401 : 429;
}

export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = crypto.createHash("sha256").update(header).digest(), b = crypto.createHash("sha256").update(`Bearer ${secret}`).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const g = sweepGate(req.headers.get("authorization"), process.env.CRON_SECRET, Date.now());
  if (g === 429) return new Response("rate limited", { status: 429 });
  if (g === 401) return new Response("unauthorized", { status: 401 });
  // Authorized cron while phase 2 is off: 200 + skipped (keeps cron-health green, does nothing).
  if (!phase2Enabled()) return Response.json({ ok: true, skipped: "phase2_off" });
  const d = stagingDeps();
  if (!d) return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
  // BTC first (only when wired: RENTALS_BTC_ONCHAIN_ENABLED=1): agent events, then binding expiry, so an order whose
  // binding just closed expires in the same run. A BTC failure never blocks the x402 sweep.
  const btc = d.btc ? await sweepBtc(d).catch(() => null) : undefined;
  // Expiry (#103 S5). Both holds apply inside sweepExpired: a live BTC binding, and Deps.expiryHold (an Ethereum quote
  // in its grace window or a claim still confirming).
  const n = await sweepExpired(d);
  if (n > 0) await trackFunnel("rental_expired", { count: n }); // unpaid orders that ran out their 15-minute window
  // All payments (web + agents), counted here because the pay route's URL carries the ref (review #106 F1).
  const paid = await paidInLastWindow(d).catch(() => 0);
  if (paid > 0) await trackFunnel("rental_paid_total", { count: paid });
  // Then Ethereum claims, whenever the ETH store is wired (also with the rail switched off, so a confirming claim is
  // never stranded), on a 10 s budget with a per-RPC-call deadline.
  const ee = ethDepsOf(d);
  const eth = ee ? await sweepEth(d, ee).catch(() => null) : undefined;
  return Response.json({ ok: true, expired: n,
    ...(btc !== undefined ? { btc: btc ? { events: btc.events, expired: btc.expired, released: btc.released, refunded: btc.refunded } : "error" } : {}),
    ...(eth !== undefined ? { eth: eth ?? "error" } : {}) });
}
