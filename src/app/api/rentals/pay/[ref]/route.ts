/**
 * x402 resource for one rental payment. Network comes from config (Base Sepolia; mainnet only via mainnetEnabled()).
 * GET: 402 with the PaymentRequired (PAYMENT-REQUIRED header, base64 JSON).
 * POST: PAYMENT-SIGNATURE (or X-PAYMENT) header, base64 JSON PaymentPayload,
 * or a JSON body { paymentPayload }. We verify + settle through the facilitator,
 * check the Base receipt, then confirmPayment() settles the order and signs the job.
 * A ref whose order can't take money (cancelled, expired, refunded, already
 * running for an initial ref) gets 409 order_not_payable, before any facilitator
 * call. An already-settled ref still replays its prior result. If the order
 * can't be read (store error) the GET answers 503 store_unavailable instead,
 * so a live order is never shown as closed.
 *
 * 200 with outcome "retry": the payment settled and is recorded, but
 * confirmPayment lost a version-checked race (usually a cancel or sweep that
 * landed while the facilitator was settling) and wrote nothing. The response
 * is still success: true with the transaction. The next confirmPayment (sweep,
 * poller or access check) resolves it; a cancelled order ends refund_pending
 * with one pending_owner refund and no job. Treat "retry" as paid-and-pending,
 * never as unpaid, and never pay again.
 */
import { phase2Enabled } from "@/lib/rentals/phase2/flag";
import { stagingDeps } from "@/lib/rentals/phase2/staging";
import { confirmPayment } from "@/lib/rentals/phase2/service";
import { X402Provider, type PaymentPayload } from "@/lib/rentals/phase2/x402";
import { mrrOnly, directRentalsClosedResponse } from "@/lib/rentals/mode";

export const dynamic = "force-dynamic";
/** SF5: room for verify + settle + the Solana finalize wait (capped at 50 s in solana.ts, SOLANA_PAY_BUDGET_MS). */
export const maxDuration = 60;
const REF = /^x402_[0-9a-f]{32}$/;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const j = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

async function ctx(ref: string) {
  if (!phase2Enabled() || !REF.test(ref)) return null;
  const d = stagingDeps();
  const p = d?.providers.x402_usdc;
  return d && p instanceof X402Provider ? { d, p } : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (mrrOnly()) return directRentalsClosedResponse(); // RENTALS_MODE=mrr_only (default): 410 + marketplace link
  const { ref } = await params;
  const c = await ctx(ref);
  if (!c) return j(404, { error: "not_found" });
  // 503 store_unavailable when the order can't be read (review #88 S1): never 409 for a transient error.
  const r = await c.p.requestStatus(ref);
  if (r.status === 402) return j(402, r.body, { "PAYMENT-REQUIRED": b64(r.body) });
  return j(r.status, r.body, r.status === 503 ? { "Retry-After": "5" } : {});
}

export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (mrrOnly()) return directRentalsClosedResponse(); // RENTALS_MODE=mrr_only (default): 410 + marketplace link
  const { ref } = await params;
  const c = await ctx(ref);
  if (!c) return j(404, { error: "not_found" });
  let payload: PaymentPayload | null = null;
  const h = req.headers.get("payment-signature") ?? req.headers.get("x-payment");
  try {
    if (h) payload = JSON.parse(Buffer.from(h, "base64").toString("utf8"));
    else payload = ((await req.json()) as { paymentPayload?: PaymentPayload }).paymentPayload ?? null;
  } catch { payload = null; }
  if (!payload) return j(400, { error: "invalid_payload" });
  const r = await c.p.pay(ref, payload);
  if (!r.ok) {
    if (r.error === "order_not_payable" || r.error === "no_capacity") return j(409, { error: r.error });
    const pr = await c.p.paymentRequired(ref);
    return j(402, { ...(pr ?? {}), error: r.error }, pr ? { "PAYMENT-REQUIRED": b64({ ...pr, error: r.error }) } : {});
  }
  // out.outcome may be "retry" (see the header): money moved, the order is resolved later.
  const out = await confirmPayment(c.d, ref);
  const resp = { success: true, transaction: r.txHash, network: r.network, payer: r.payer }; // the network it SETTLED on (Base or Solana)
  // No funnel event here (review #106 F1): this URL carries the payment ref. Web payments are counted client-side
  // on /hashrate/rent, all payments by the sweep (rental_paid_total).
  return j(200, { outcome: out.outcome, ...resp }, { "PAYMENT-RESPONSE": b64(resp) });
}
