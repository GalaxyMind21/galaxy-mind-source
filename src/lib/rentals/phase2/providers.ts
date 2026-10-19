/**
 * Payment providers as interfaces. Only mock/testnet adapters ship here.
 * A real adapter (Alby Hub over NWC, BTCPay Greenfield, CDP or x402.org
 * facilitator) must implement the same two calls and pass the same tests.
 *
 * Independent confirmation (review MH2): a webhook or a client-supplied
 * proof is only a wake-up. The service always calls lookup() by the
 * provider reference it created and trusts only that answer.
 */
import { BASE_SEPOLIA } from "./x402";
import crypto from "node:crypto";
import type { Rail } from "./types";

export type Challenge =
  | { rail: "lightning"; providerRef: string; bolt11: string; amountSats: number; expiresAt: number }
  | { rail: "x402_usdc"; providerRef: string; x402: X402Requirements; expiresAt: number; /** Extra networks (Solana) offered for the SAME order and amount. Base stays first, in x402. */ alts?: X402Requirements[] };

/** x402 v2 "exact" payment requirements (subset), returned in a 402. */
export type X402Requirements = {
  x402Version: 2;
  scheme: "exact";
  network: string;          // CAIP-2, from x402Net config
  asset: string;            // USDC contract on that network
  amount: string;           // atomic units, 6 dp
  payTo: string;            // receive address: MUST come from the operator; staging uses a test fixture
  maxTimeoutSeconds: number;
  /** EVM: name/version (EIP-712 domain). SVM: feePayer (facilitator sponsor), memo (= orderRef, binds the tx to this order), decimals. */
  extra: { orderRef: string; name?: string; version?: string; feePayer?: string; memo?: string; decimals?: number };
  /** Where to send the payment (x402 resource). */
  resource?: string;
};

/**
 * txHash: the settlement transaction (EVM: lowercase 0x hex; Solana: base58 signature). Required before an x402 job is signed.
 * network / payTo: the CAIP-2 network the money settled on and the payTo of the STORED requirement for that network (never client input).
 */
export type Lookup = { found: false } | { found: true; paid: boolean; receivedAtomic: number; settledAt: number | null; boundRef: string; txHash?: string | null; network?: string; payTo?: string };

export interface PaymentProvider {
  readonly rail: Rail;
  readonly network: "mock" | "testnet" | "mainnet";
  create(opts: { orderRef: string; amountAtomic: number; expiresAt: number }): Promise<Challenge>;
  lookup(providerRef: string): Promise<Lookup>;
}

/** In-memory mock used by tests and the staging preview. */
export class MockProvider implements PaymentProvider {
  readonly network = "mock" as const;
  private book = new Map<string, { orderRef: string; amount: number; paid: number; settledAt: number | null; tx: string | null }>();
  /** Test hook: settle without a tx hash (must fail closed). */
  omitTxHash = false;
  constructor(readonly rail: Rail, private payTo = "0x000000000000000000000000000000000000dEaD") {}
  async create({ orderRef, amountAtomic, expiresAt }: { orderRef: string; amountAtomic: number; expiresAt: number }): Promise<Challenge> {
    const providerRef = (this.rail === "lightning" ? "lnmock_" : "x402mock_") + crypto.randomBytes(16).toString("hex");
    this.book.set(providerRef, { orderRef, amount: amountAtomic, paid: 0, settledAt: null, tx: null });
    if (this.rail === "lightning") {
      return { rail: "lightning", providerRef, bolt11: "lntbs" + amountAtomic + "n1mock" + providerRef.slice(7, 23), amountSats: amountAtomic, expiresAt };
    }
    return {
      rail: "x402_usdc", providerRef, expiresAt,
      x402: { x402Version: 2, scheme: "exact", network: BASE_SEPOLIA.network, asset: BASE_SEPOLIA.asset, amount: String(amountAtomic), payTo: this.payTo, maxTimeoutSeconds: 900, extra: { orderRef } },
    };
  }
  async lookup(ref: string): Promise<Lookup> {
    const r = this.book.get(ref);
    if (!r) return { found: false };
    return { found: true, paid: r.paid > 0, receivedAtomic: r.paid, settledAt: r.settledAt, boundRef: r.orderRef, txHash: this.rail === "x402_usdc" && !this.omitTxHash ? r.tx : null };
  }
  /** Test hook: simulate the payer. */
  simulatePay(ref: string, atomic: number, at: number) {
    const r = this.book.get(ref);
    if (!r) throw new Error("no such ref");
    r.paid += atomic;
    r.tx = "0x" + crypto.createHash("sha256").update(ref + ":" + r.paid).digest("hex");
    r.settledAt = at;
  }
}
