/**
 * POST /api/rentals/eth · USDC on Ethereum (direct transfer) for /hashrate/rent. Human checkout only.
 * { action: "bind" | "claim" | "status", rental_id, creator_secret, tx_hash? }. See phase2/eth/human.ts.
 * 404 unless the human checkout is on; bind/claim 404 (rail_unavailable) unless RENTALS_ETH_USDC_ENABLED and its config are complete.
 */
import { json } from "@/lib/rentals/phase2/human";
import { handleEth, ETH_ROUTE_LIMIT } from "@/lib/rentals/phase2/eth/human";
import { rateLimit, rateLimitBucket } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { kvIncrWithTtlFull, isKvConfigured } from "@/lib/kv";
import { mrrOnly, directRentalsClosedResponse } from "@/lib/rentals/mode";

export const dynamic = "force-dynamic";
/** A claim may do a handful of sequential RPC reads plus a confirm. */
export const maxDuration = 30;

export async function POST(req: Request) {
  if (mrrOnly()) return directRentalsClosedResponse(); // RENTALS_MODE=mrr_only (default): 410 + marketplace link
  const rl = await rateLimit(req, { name: "rentals-eth", limit: ETH_ROUTE_LIMIT.limit, windowSec: ETH_ROUTE_LIMIT.windowSec });
  if (!rl.ok) return json({ status: 429, body: { error: "rate_limited" }, headers: rl.headers });
  let body: unknown = null;
  try { body = JSON.parse((await req.text()).slice(0, 2048)); } catch { body = null; }
  return json(await handleEth(body, {
    ipBucket: rateLimitBucket(getClientIp(req)),
    incr: async (key, windowSec) => (isKvConfigured() ? kvIncrWithTtlFull(key, windowSec).catch(() => null) : null),
  }));
}
