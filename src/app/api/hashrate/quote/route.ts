// GET /api/hashrate/quote · the direct rental quote for non-MCP agents.
//
// Rewritten 2026-10-16 (review on PR #77): this route used to return
// per-machine rows (ids, names, marketplace links, asks) and hour-based
// quotes at the ask with no floor. Since 2026-10-17 (B1) it calls directQuote(),
// the same getQuote -> priceOrder as MCP get_quote / get_rental_quote, with the shared
// limits in src/lib/rentals/limits.ts. Aggregate only: no rig ids, names,
// links or asks, and every response passes assertCustomerSafe.
//
// Rate limited per IP (hashrate-quote, 60/min).
// Params: rigs (1 to 4), ph (up to 1.08, overrides rigs), days (1 to 7 during the pilot,
// default 1). Each quote carries a fresh quoteId and 15-minute expiry, so
// responses are not cached.

import { NextResponse, type NextRequest } from "next/server";
import { buildDirectQuoteResponse } from "@/lib/rentals/http-quote";
import { rateLimit } from "@/lib/rate-limit";
import { QUOTE_LIMIT } from "@/lib/rentals/phase2/human";
import { mrrOnly, directRentalsClosedResponse } from "@/lib/rentals/mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (mrrOnly()) return directRentalsClosedResponse(); // RENTALS_MODE=mrr_only (default): 410 + marketplace link
  // Review #106 N2: per-IP limit, same as /api/rentals/quote (each call prices the order; pricing is cached ~60 s).
  const rl = await rateLimit(req, { name: "hashrate-quote", limit: QUOTE_LIMIT.limit, windowSec: QUOTE_LIMIT.windowSec });
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...rl.headers, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
  const { status, body } = await buildDirectQuoteResponse(new URL(req.url).searchParams);
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}
