/**
 * POST /api/rentals/eth · the Ethereum USDC step of /hashrate/rent (human checkout only; no MCP / REST surface in v1).
 * Body: { action: "bind" | "claim" | "status", rental_id, creator_secret, tx_hash? }. Owner-only (creator secret).
 * Gates: the human-checkout flag; bind needs the rail configured (ethConfig, incl. the pinned payTo). claim needs only
 * the read side (an RPC + an existing quote), so a customer who already has a quote can claim after the rail is
 * switched off. Status is always readable. Errors are fixed codes only.
 * Limits (route): 30 requests / 10 min per IP. The bind limiter (3 / hour per IP, 100 / hour in total) is charged ONLY
 * when a new quote is about to be created: after the owner check and the existing-quote return (review #108 B3).
 */
import { humanCheckoutFlag, type Incr, type Out } from "../human";
import { stagingDeps } from "../staging";
import type { Deps } from "../service";
import { ethDepsOf } from "./wire";
import { bindEth, claimEth, statusEth, type EthDeps } from "./service";

type Env = Record<string, string | undefined>;
export const ETH_ROUTE_LIMIT = { limit: 30, windowSec: 600 } as const;
export const ETH_BIND_LIMIT = { perIp: 3, global: 100, windowSec: 3600 } as const;

const STATUS: Record<string, number> = {
  invalid_input: 400, invalid_tx_hash: 400, not_found: 404, rate_limited: 429, rate_limit_unavailable: 503, rentals_paused: 503,
  rail_unavailable: 404, rail_busy: 503, not_payable: 409, no_capacity: 409, window_too_short: 409, no_quote: 409, tx_failed: 422, no_matching_transfer: 422,
  amount_mismatch: 422, payment_pending: 409, tx_before_quote: 422, outside_window: 422, tx_already_used: 409, store_unavailable: 503, server_error: 500, code_expired: 410,
};
const fail = (error: string, headers?: Record<string, string>): Out => ({ status: STATUS[error] ?? 400, body: { error }, headers });

export async function ethBindLimit(incr: Incr, ipBucket: string): Promise<{ ok: true } | { ok: false; error: "rate_limited" | "rate_limit_unavailable"; retryAfter: number }> {
  let ip, all;
  try {
    ip = await incr(`ratelimit:rentals-eth-bind:ip:${ipBucket}`, ETH_BIND_LIMIT.windowSec);
    all = ip ? await incr("ratelimit:rentals-eth-bind:global", ETH_BIND_LIMIT.windowSec) : null;
  } catch { ip = null; all = null; }
  if (!ip || !all || !(ip.count > 0) || !(all.count > 0)) return { ok: false, error: "rate_limit_unavailable", retryAfter: 30 };
  if (ip.count > ETH_BIND_LIMIT.perIp) return { ok: false, error: "rate_limited", retryAfter: Math.max(1, ip.ttlSec) };
  if (all.count > ETH_BIND_LIMIT.global) return { ok: false, error: "rate_limited", retryAfter: Math.max(1, all.ttlSec) };
  return { ok: true };
}

export type EthCtx = { env?: Env; deps?: Deps | null; eth?: EthDeps | null; incr: Incr; ipBucket: string };

export async function handleEth(body: unknown, ctx: EthCtx): Promise<Out> {
  const env = ctx.env ?? process.env;
  if (!humanCheckoutFlag(env)) return fail("not_found");
  const d = ctx.deps === undefined ? stagingDeps(env) : ctx.deps;
  if (!d) return fail("not_found");
  const e = ctx.eth === undefined ? ethDepsOf(d) : ctx.eth;
  if (!e) return fail("rail_unavailable");
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const who = { rental_id: b.rental_id, creator_secret: b.creator_secret };
  try {
    if (b.action === "status") {
      const r = await statusEth(d, e, who);
      return r.ok ? { status: 200, body: r.result as unknown as Record<string, unknown> } : fail(r.error);
    }
    if (b.action === "bind") {
      if (!e.cfg) return fail("rail_unavailable");
      let retryAfter: number | null = null;
      const r = await bindEth(d, e, who, { charge: async () => {
        const lim = await ethBindLimit(ctx.incr, ctx.ipBucket);
        if (lim.ok) return null;
        retryAfter = lim.retryAfter;
        return { ok: false as const, error: lim.error };
      } });
      if (r.ok) return { status: 200, body: { quote: r.quote } };
      return fail(r.error, retryAfter !== null ? { "Retry-After": String(retryAfter) } : undefined);
    }
    if (b.action === "claim") {
      if (!e.rpc) return fail("rail_unavailable");
      const r = await claimEth(d, e, { ...who, tx_hash: b.tx_hash });
      return r.ok ? { status: 200, body: r.result as unknown as Record<string, unknown> } : fail(r.error);
    }
    return fail("invalid_input");
  } catch { return fail("server_error"); }
}
