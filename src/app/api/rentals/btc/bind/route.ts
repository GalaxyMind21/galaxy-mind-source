/**
 * POST /api/rentals/btc/bind · "Pay with Bitcoin" on /hashrate/rent (human checkout only; no bot/MCP rail in v1).
 * 404 unless RENTALS_BTC_ONCHAIN_ENABLED=1. Turnstile required, 3 picks per IP per hour (KV, fail closed).
 * Creates a binding the payment agent then attests; the address is shown only after the site re-derives and
 * verifies it. See src/lib/rentals/phase2/btc/human.ts.
 */
import { json } from "@/lib/rentals/phase2/human";
import { handleBtcBind } from "@/lib/rentals/phase2/btc/human";
import { getClientIp } from "@/lib/client-ip";
import { rateLimitBucket } from "@/lib/rate-limit";
import { kvIncrWithTtlFull, isKvConfigured } from "@/lib/kv";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { mrrOnly, directRentalsClosedResponse } from "@/lib/rentals/mode";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (mrrOnly()) return directRentalsClosedResponse(); // RENTALS_MODE=mrr_only (default): 410 + marketplace link
  let body: unknown = null;
  try { body = JSON.parse((await req.text()).slice(0, 8192)); } catch { body = null; }
  const ip = getClientIp(req);
  return json(await handleBtcBind(body, {
    ipBucket: rateLimitBucket(ip),
    incr: async (key, windowSec) => (isKvConfigured() ? kvIncrWithTtlFull(key, windowSec).catch(() => null) : null),
    turnstile: (token) => verifyTurnstileToken(token, ip),
  }));
}
