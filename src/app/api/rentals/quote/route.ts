/** GET /api/rentals/quote?rigs=&days= · getQuote for /hashrate/rent (same pricing as the MCP get_quote). */
import { handleQuote, json, QUOTE_LIMIT } from "@/lib/rentals/phase2/human";
import { rateLimit } from "@/lib/rate-limit";
import { mrrOnly, directRentalsClosedResponse } from "@/lib/rentals/mode";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (mrrOnly()) return directRentalsClosedResponse(); // RENTALS_MODE=mrr_only (default): 410 + marketplace link
  const rl = await rateLimit(req, { name: "rentals-quote", limit: QUOTE_LIMIT.limit, windowSec: QUOTE_LIMIT.windowSec });
  if (!rl.ok) return json({ status: 429, body: { error: "rate_limited" }, headers: rl.headers });
  return json(await handleQuote(new URL(req.url).searchParams, {}));
}
