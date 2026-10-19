/**
 * Phase 2 paid rentals · STAGING ONLY. Shared types.
 * Nothing in this folder moves real money: providers are interfaces with
 * mock/testnet adapters, and the whole surface sits behind a flag that
 * defaults off (see flag.ts).
 */
/** btc_onchain (PLAN v3.1): the rail of a BTC payment, its refunds, and of an order once BTC money is accepted on it. */
/** eth_usdc (review #108, verifier rev 1.8): USDC on Ethereum, direct transfer. Set on PAYMENTS, REFUNDS and JOBS of eth_ refs;
 *  the ORDER keeps x402_usdc (its USDC-priced creation rail, shared by Base/Solana/Ethereum), exactly like a BTC ref before a switch. */
export type Rail = "lightning" | "x402_usdc" | "btc_onchain" | "eth_usdc";

export type OrderState =
  | "awaiting_payment" // invoice/challenge issued, 15 min TTL
  | "expired"          // TTL passed with no valid payment
  | "paid"             // single settle recorded, job not yet signed
  | "delivering"       // signed route job published, waiting for shares
  | "active"           // renter pool accepted shares; access code live
  | "completed"        // end reached, reverted to self, verified
  | "failed"           // delivery failed or cap/kill-switch rejection
  | "refund_pending"   // money in, no rental: goes to the operator's queue
  | "expired_unapplied" // settled, but the node never applied it within 30 min: refund_due (manual, never auto-sent)
  | "refunded";

export const TERMINAL: OrderState[] = ["expired", "completed", "refunded"];

export const TRANSITIONS: Record<OrderState, OrderState[]> = {
  awaiting_payment: ["paid", "expired", "refund_pending"],
  expired: ["refund_pending"],                 // late pay after expiry
  paid: ["delivering", "refund_pending", "failed"],
  delivering: ["active", "failed", "expired_unapplied"],
  active: ["completed", "failed"],
  completed: [],
  failed: ["refund_pending"],
  refund_pending: ["refunded"],
  expired_unapplied: ["refunded"],
  refunded: [],
};

export type Order = {
  id: string;            // internal uuid
  publicId: string;      // gm_… shown to customer
  idemKey: string;
  rail: Rail;
  state: OrderState;
  rigCount: number;
  th: number;
  days: number;
  priceBtcPhDay: number;
  floorBtcPhDay: number;
  totalSats: number;
  totalUsdcAtomic: number | null;
  poolHost: string;
  poolPort: number;
  worker: string;
  accessCodeHmac: string | null;   // HMAC of the code; the code is derived from the creator secret
  creatorSecretHmac: string;       // HMAC of the creator secret returned once by create_rental
  createdAt: number;
  expiresAt: number;     // payment deadline
  startsAt: number | null;
  endsAt: number | null;
  /** Rental Terms version the renter accepted (create_rental accept_terms + terms_version). */
  termsVersion: string | null;
  termsAcceptedAt: number | null;
  /** Bay numbers assigned at settle, "3,7". Never rig ids; the node maps bays to rigs. */
  bays: string | null;
  version: number;
};

/** One row per money increment seen on a provider ref (seq = cumulative atomic before it). */
export type PaymentRecord = {
  id: string;            // `${providerRef}#${seq}`, unique
  orderId: string;
  kind: "initial" | "extension";
  rail: Rail;
  providerRef: string;
  seq: number;
  deltaAtomic: number;
  cumulativeAtomic: number;
  expectedAtomic: number;
  extendDays: number | null;
  settles: boolean;      // true on the single row that settled this ref (unique per ref)
  at: number;
};

export type RefundRecord = {
  id: string;
  orderId: string;
  providerRef: string;
  seq: number;           // cumulative refunded on this ref before this row (unique with ref)
  reason: "underpaid" | "overpaid" | "late" | "duplicate" | "cap_exceeded" | "delivery_failed" | "kill_switch" | "cancelled" | "expired_unapplied" | "bay_unavailable";
  atomic: number;
  rail: Rail;
  status: "pending_owner" | "approved" | "paid";
  at: number;
  /** Review #101 S4: the network the money SETTLED on, so the refund goes back on it (DB: refund_network, filled from
   *  rental_x402_settlements on insert). null = lightning / unknown (treat as Base). A Solana refund can only be marked
   *  paid with payout_network = this network (DB check). */
  network?: string | null;
  /** The network the manual payout was sent on (set by hand when paid). */
  payoutNetwork?: string | null;
};
