/**
 * One-time $1 x402 test order (operator-approved). Server-side only.
 * - Gated by RENTALS_TEST_ORDER_TOKEN (constant-time), plus phase2Enabled(); mainnet only via mainnetEnabled().
 * - Amount fixed at exactly 1.000000 USDC (1_000_000 atomic). payTo = the provider's verified address (env, checked
 *   against the sha256 pin in payto-pins.ts).
 * - Single use, DB-enforced: rental_test_orders has one row forever (id = 1), tx_hash unique.
 * - NO rig delivery: no rental order, no signed job is emitted at all. Only the settlement is recorded.
 * - Not in the MCP tool list, llms.txt or the public site.
 */
import crypto from "node:crypto";
import { X402Provider, type X402Net, type EvmPaymentPayload as PaymentPayload, type PayError } from "./x402";
import type { X402Requirements } from "./providers";
import { PAYTO_PIN_SHA256, payToMatchesPin } from "./payto-pins";

export const TEST_ORDER_ATOMIC = 1_000_000;
export const TEST_ORDER_PATH = "/api/rentals/test-order";
export type TestRow = { providerRef: string; network: string; amountAtomic: number; payTo: string; requirements: X402Requirements; expiresAt: number; txHash: string | null; payer: string | null };
export interface TestOrderBook {
  issue(r: TestRow): Promise<{ status: "used" } | { status: "open"; row: TestRow }>;
  settle(providerRef: string, txHash: string, payer: string): Promise<boolean>;
}

export function tokenOk(given: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !given) return false;
  const h = (x: string) => crypto.createHash("sha256").update(x).digest();
  return crypto.timingSafeEqual(h(given), h(secret));
}

export class MemoryTestOrderBook implements TestOrderBook {
  row: TestRow | null = null;
  constructor(private now: () => number = Date.now, private pinSha: string = PAYTO_PIN_SHA256.evm) {}
  async issue(r: TestRow) {
    if (r.amountAtomic !== TEST_ORDER_ATOMIC || !payToMatchesPin("evm", r.payTo, this.pinSha)) throw new Error("check_violation");
    if (this.row?.txHash) return { status: "used" as const };
    if (this.row && this.row.expiresAt > this.now()) return { status: "open" as const, row: this.row };
    this.row = { ...r, txHash: null, payer: null };
    return { status: "open" as const, row: this.row };
  }
  async settle(ref: string, tx: string, payer: string) {
    if (!this.row || this.row.txHash || this.row.providerRef !== ref) return false;
    this.row = { ...this.row, txHash: tx, payer }; return true;
  }
}

export class SupabaseTestOrderBook implements TestOrderBook {
  constructor(private url: string, private key: string, private f: typeof fetch = fetch) {}
  private async rpc(fn: string, r: unknown) {
    const res = await this.f(`${this.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, { method: "POST", cache: "no-store", headers: { apikey: this.key, authorization: `Bearer ${this.key}`, "content-type": "application/json" }, body: JSON.stringify({ r }) });
    if (!res.ok) throw new Error("db_" + res.status);
    return (await res.json()) as Record<string, unknown>;
  }
  async issue(r: TestRow) {
    const j = await this.rpc("rental_test_order_issue", { provider_ref: r.providerRef, network: r.network, amount_atomic: r.amountAtomic, pay_to: r.payTo, requirements: r.requirements, expires_at: new Date(r.expiresAt).toISOString() });
    if (j.status === "used") return { status: "used" as const };
    const w = j.row as Record<string, unknown>;
    return { status: "open" as const, row: { providerRef: w.provider_ref as string, network: w.network as string, amountAtomic: Number(w.amount_atomic), payTo: w.pay_to as string, requirements: w.requirements as X402Requirements, expiresAt: Date.parse(w.expires_at as string), txHash: (w.tx_hash as string) ?? null, payer: (w.payer as string) ?? null } };
  }
  async settle(ref: string, tx: string, payer: string) { return (await this.rpc("rental_test_order_settle", { provider_ref: ref, tx_hash: tx, payer })).ok === true; }
}

export class TestOrderService {
  constructor(private o: { book: TestOrderBook; provider: X402Provider; net: X402Net; resourceBase: string; now?: () => number }) {}
  private now() { return (this.o.now ?? Date.now)(); }
  /** 402 requirements for the single test order, or used. */
  async challenge(): Promise<{ status: "used" } | { status: "open"; requirements: X402Requirements; expiresAt: number; providerRef: string }> {
    const ref = "x402t_" + crypto.randomBytes(16).toString("hex"), expiresAt = this.now() + 15 * 60_000;
    const requirements: X402Requirements = {
      x402Version: 2, scheme: "exact", network: this.o.net.network, asset: this.o.net.asset, amount: String(TEST_ORDER_ATOMIC), payTo: this.o.provider.payTo,
      maxTimeoutSeconds: 900, extra: { orderRef: "gm_test_1usd", name: this.o.net.eip712Name, version: "2" }, resource: `${this.o.resourceBase.replace(/\/$/, "")}${TEST_ORDER_PATH}`,
    };
    const r = await this.o.book.issue({ providerRef: ref, network: this.o.net.network, amountAtomic: TEST_ORDER_ATOMIC, payTo: this.o.provider.payTo, requirements, expiresAt, txHash: null, payer: null });
    return r.status === "used" ? r : { status: "open", requirements: r.row.requirements, expiresAt: r.row.expiresAt, providerRef: r.row.providerRef };
  }
  async pay(p: PaymentPayload): Promise<{ ok: true; txHash: string; payer: string; network: string } | { ok: false; error: PayError | "used" | "record_failed" }> {
    const c = await this.challenge();
    if (c.status === "used") return { ok: false, error: "used" };
    const h = c.requirements;
    if (h.amount !== String(TEST_ORDER_ATOMIC) || h.payTo !== this.o.provider.payTo) return { ok: false, error: "requirements_mismatch" };
    const v = await this.o.provider.verifyAndSettle(h, c.expiresAt, p);
    if (!v.ok) return v;
    if (!(await this.o.book.settle(c.providerRef, v.tx, p.payload.authorization.from))) return { ok: false, error: "record_failed" };
    return { ok: true, txHash: v.tx, payer: p.payload.authorization.from, network: h.network };
  }
}
