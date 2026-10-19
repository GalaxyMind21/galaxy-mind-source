/**
 * POST /api/rentals/access · for /hashrate/rent.
 * { rental_id, creator_secret } collects the access code once paid;
 * { access_code } checks status. { action: "pay", rental_id, creator_secret }
 * returns an AI-placed order's summary and paymentRef so the page can pay it
 * (nothing without the right secret). Wraps getRental unchanged.
 * RENTALS_MODE=mrr_only (default): pay and cancel answer 410 with the marketplace link; status reads stay.
 */
import { handleAccess, json, ACCESS_LIMIT } from "@/lib/rentals/phase2/human";
import { rateLimit } from "@/lib/rate-limit";
import { mrrOnly, directRentalsClosedResponse } from "@/lib/rentals/mode";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = await rateLimit(req, { name: "rentals-access", limit: ACCESS_LIMIT.limit, windowSec: ACCESS_LIMIT.windowSec });
  if (!rl.ok) return json({ status: 429, body: { error: "rate_limited" }, headers: rl.headers });
  let body: unknown = null;
  try { body = JSON.parse((await req.text()).slice(0, 2048)); } catch { body = null; }
  // mrr_only: status reads (access_code, or rental_id + creator_secret) stay open for past renters and the Discord
  // /status fallthrough; the pay and cancel actions are part of the closed direct checkout.
  const action = body && typeof body === "object" ? (body as { action?: unknown }).action : undefined;
  if (mrrOnly() && (action === "pay" || action === "cancel")) return directRentalsClosedResponse();
  return json(await handleAccess(body, {}));
}
