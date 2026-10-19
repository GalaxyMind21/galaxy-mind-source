/**
 * POST /api/rentals/btc/status · the renter's Bitcoin payment state (owner only: rental_id + creator_secret).
 * Re-verifies the signed address on every display. abandon=true releases a binding whose address was never shown.
 * 404 unless RENTALS_BTC_ONCHAIN_ENABLED=1.
 */
import { json } from "@/lib/rentals/phase2/human";
import { handleBtcStatus } from "@/lib/rentals/phase2/btc/human";
import { getClientIp } from "@/lib/client-ip";
import { rateLimitBucket } from "@/lib/rate-limit";
import { kvIncrWithTtlFull, isKvConfigured } from "@/lib/kv";
import { mrrOnly, directRentalsClosedResponse } from "@/lib/rentals/mode";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (mrrOnly()) return directRentalsClosedResponse(); // RENTALS_MODE=mrr_only (default): 410 + marketplace link
  let body: unknown = null;
  try { body = JSON.parse((await req.text()).slice(0, 4096)); } catch { body = null; }
  return json(await handleBtcStatus(body, {
    ipBucket: rateLimitBucket(getClientIp(req)),
    incr: async (key, windowSec) => (isKvConfigured() ? kvIncrWithTtlFull(key, windowSec).catch(() => null) : null),
  }));
}
