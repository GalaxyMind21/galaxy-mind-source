/**
 * POST /api/rentals/order · human browser-wallet checkout (/hashrate/rent).
 * Thin wrapper over createRental (same idempotency key, kill and terms
 * checks). Rate-limited in KV: 5 per 10 min per IP, 30 per 10 min total,
 * and at most one unpaid open order per IP, all fail closed. Returns only
 * what the page needs. See phase2/human.ts.
 */
import { handleOrder, json } from "@/lib/rentals/phase2/human";
import { getClientIp } from "@/lib/client-ip";
import { rateLimitBucket } from "@/lib/rate-limit";
import { kvIncrWithTtlFull, kvGetChecked, kvSet, kvDel, isKvConfigured } from "@/lib/kv";
import { trackFunnel } from "@/lib/rentals/funnel";
import { mrrOnly, directRentalsClosedResponse } from "@/lib/rentals/mode";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (mrrOnly()) return directRentalsClosedResponse(); // RENTALS_MODE=mrr_only (default): 410 + marketplace link
  let body: unknown = null;
  try { body = JSON.parse((await req.text()).slice(0, 4096)); } catch { body = null; }
  const out = await handleOrder(body, {
    ipBucket: rateLimitBucket(getClientIp(req)),
    incr: async (key, windowSec) => (isKvConfigured() ? kvIncrWithTtlFull(key, windowSec).catch(() => null) : null),
    kv: {
      get: async (key) => (isKvConfigured() ? kvGetChecked<string>(key).catch(() => ({ ok: false, value: null })) : { ok: false, value: null }),
      set: async (key, value, ttlSec) => (isKvConfigured() ? kvSet(key, value, ttlSec).catch(() => false) : false),
      del: async (key) => (isKvConfigured() ? kvDel(key).catch(() => false) : false),
    },
  });
  // Funnel (no PII): a new web order, by size only. Replays are not counted twice.
  if (out.status === 200 && out.body.replay === false) await trackFunnel("rental_order_created", { channel: "web", rigs: Number(out.body.rigs), days: Number(out.body.days) });
  return json(out);
}
