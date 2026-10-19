// One-time $1 x402 test order. Hidden: not in MCP, llms.txt or the site. See src/lib/rentals/phase2/test-order.ts.
// POST with x-test-order-token: RENTALS_TEST_ORDER_TOKEN. No payment header -> 402 requirements.
// PAYMENT-SIGNATURE header -> verify + settle + on-chain check, recorded once. No job, no rig delivery.
// OFF BY DEFAULT: the route answers 404 unless RENTALS_TEST_ORDER_ROUTE_ENABLED=1 (and phase 2 + the token are set).
// Turn the flag on only for the one test, then unset both it and RENTALS_TEST_ORDER_TOKEN.
import { phase2Enabled, publicBaseUrl } from "@/lib/rentals/phase2/flag";
import { evmPayToFromEnv } from "@/lib/rentals/phase2/payto-pins";
import { x402Net, X402Provider, type EvmPaymentPayload as PaymentPayload } from "@/lib/rentals/phase2/x402";
import { MemoryStore } from "@/lib/rentals/phase2/store";
import { Limiter } from "@/lib/rentals/phase2/safety";
import { TestOrderService, SupabaseTestOrderBook, tokenOk } from "@/lib/rentals/phase2/test-order";
import { mrrOnly, directRentalsClosedResponse } from "@/lib/rentals/mode";

export const dynamic = "force-dynamic";
/** Explicit opt-in for the hidden test route. Anything but "1" keeps it a 404. */
function testOrderRouteEnabled(env: Record<string, string | undefined>): boolean { return env.RENTALS_TEST_ORDER_ROUTE_ENABLED === "1"; }
const failLimiter = new Limiter(5, 60_000);
const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" } });

export async function POST(req: Request) {
  if (mrrOnly()) return directRentalsClosedResponse(); // RENTALS_MODE=mrr_only (default): 410 + marketplace link
  const env = process.env;
  if (!testOrderRouteEnabled(env)) return j(404, { error: "not_found" });
  if (!phase2Enabled(env) || !env.RENTALS_TEST_ORDER_TOKEN) return j(404, { error: "not_found" });
  if (!tokenOk(req.headers.get("x-test-order-token"), env.RENTALS_TEST_ORDER_TOKEN)) {
    return failLimiter.ok("test_order_fail", Date.now()) ? j(404, { error: "not_found" }) : j(429, { error: "rate_limited" });
  }
  const url = env.RENTALS_PHASE2_SUPABASE_URL, key = env.RENTALS_PHASE2_SUPABASE_SERVICE_KEY;
  if (!url || !key) return j(503, { error: "not_configured" });
  let net; try { net = x402Net(env); } catch { return j(503, { error: "not_configured" }); }
  const base = publicBaseUrl(env); // same base as staging.ts; production never uses VERCEL_URL
  const payTo = evmPayToFromEnv(env); // exact EIP-55 + sha256 pin, else "" (refused, reported)
  if (!payTo) return j(503, { error: "not_configured" });
  let provider: X402Provider;
  try { provider = new X402Provider({ net, payTo, resourceBase: base, store: new MemoryStore(), cdp: { keyId: env.CDP_API_KEY_ID ?? "", secret: env.CDP_API_KEY_SECRET ?? "" } }); }
  catch { return j(503, { error: "not_configured" }); }
  const svc = new TestOrderService({ book: new SupabaseTestOrderBook(url, key), provider, net, resourceBase: base });
  const h = req.headers.get("payment-signature") ?? req.headers.get("x-payment");
  if (!h) {
    const c = await svc.challenge();
    if (c.status === "used") return j(409, { error: "used" });
    const { x402Version, resource, ...wire } = c.requirements;
    return j(402, { x402Version, resource: { url: resource, description: "Galaxy Mind one-time $1 test", mimeType: "application/json" }, accepts: [wire] });
  }
  let p: PaymentPayload;
  try { p = JSON.parse(Buffer.from(h, "base64").toString("utf8")); } catch { return j(400, { error: "invalid_payload" }); }
  const r = await svc.pay(p);
  if (!r.ok) return j(r.error === "used" ? 409 : 402, { error: r.error });
  return j(200, { success: true, test: true, transaction: r.txHash, network: r.network, payer: r.payer, delivery: "none" });
}
