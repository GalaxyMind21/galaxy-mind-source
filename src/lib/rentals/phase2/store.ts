/**
 * Storage interface mirroring supabase/migrations/*_phase2_rentals.sql.
 * All settle-time writes go through ONE atomic commit (SQL: the
 * rental_settle() RPC, one transaction). Preconditions (order version,
 * payment seq, refund seq, job nonce, idempotency key) are all checked
 * before anything is written; any failure writes nothing.
 */
import { TRANSITIONS, type Order, type PaymentRecord, type RefundRecord, type OrderState } from "./types";
import { PILOT_CAP_RIGS } from "./pricing";
import type { SignedJob } from "./jobs";

export class UniqueViolation extends Error { constructor(what: string) { super("unique_violation:" + what); } }
export class StaleVersion extends Error { constructor() { super("stale_version"); } }
/** Fleet cap enforced inside the atomic commit (SQL: rental_settle locks rental_settings FOR UPDATE, then sums committed rigs). */
export class CapExceeded extends Error { constructor() { super("cap_exceeded"); } }
/** Kill flag re-checked inside the commit (SQL: rental_settings.rentals_enabled under the same lock). */
export class KillSwitchError extends Error { constructor() { super("kill_switch"); } }
export class IllegalTransition extends Error { constructor(from: string, to: string) { super(`illegal_transition:${from}->${to}`); } }
export const COMMITTED_STATES: OrderState[] = ["paid", "delivering", "active"];
/** Allowed next states. Settle may go awaiting_payment -> paid -> delivering in one commit. */
export function transitionOk(from: OrderState, to: OrderState): boolean {
  if (from === to) return true;
  const next = TRANSITIONS[from] ?? [];
  // Only the settle shortcut awaiting_payment -> (paid) -> delivering is allowed in one commit.
  return next.includes(to) || (next.includes("paid") && to === "delivering");
}

export type X402Settlement = { providerRef: string; network: string; payer: string; txHash: string; amountAtomic: number; settledAt: number };
/** Review #101 F2: a Solana signature the facilitator settled but our on-chain check hasn't passed yet. Not money until re-checked. */
export type X402Pending = { providerRef: string; network: string; payer: string; payerSig: string; txHash: string; at: number;
  /** FB1: upper bound for the tx's lastValidBlockHeight (decimal string); null = never auto-dropped. */
  lastValidBlockHeight?: string | null;
  /** Resolution outcomes recorded so far (append-only log). Unresolved = no terminal outcome (settled, dropped, lost_race). */
  outcomes?: PendingOutcome[] };
export type PendingOutcome = "settled" | "dropped" | "lost_race" | "failed_onchain" | "alerted" | "manual_review";
/** #103 S3: failed_onchain = finalized WITH an error (no token moved) is terminal too. */
export const TERMINAL_OUTCOMES: PendingOutcome[] = ["settled", "dropped", "lost_race", "failed_onchain"];
/** #103 B1: the unresolved list returns at most this many rows (oldest first) plus the total; total >= cap raises an alert. */
export const PENDING_LIST_CAP = 500;
export type PendingPage = { rows: X402Pending[]; total: number };
export type PendingResolution = { txHash: string; outcome: PendingOutcome; detail: string | null; at: number };
export const pendingUnresolved = (p: X402Pending) => !(p.outcomes ?? []).some((o) => TERMINAL_OUTCOMES.includes(o));
/** SF2: thrown when pending signatures can't be read (the table exists but the read failed): callers fail closed. */
export class PendingReadError extends Error { constructor() { super("pending_read_failed"); } }
export type JobResult = { jobId: string; orderRef: string; result: "applied" | "rejected" | "reverted" | "delivered" | "pending_approval"; reason: string | null; deliveredTh: number | null; at: number };
/** B7: one bay's availability as the node last reported it. fresh = reported within maxAge by the DB clock. */
export type BayReason = "ok" | "mrr_rented" | "mrr_disabled" | "mrr_offline" | "direct_active" | "node_hold" | "revert_failed" | "killed" | "read_error";
export type BayAvailability = { bay: number; free: boolean; reason: BayReason; mrrRentedUntil: number | null; fresh: boolean };
export type Binding = { orderId: string; kind: "initial" | "extension"; expectedAtomic: number; expiresAt: number; extendDays: number | null; challenge: unknown };
export type IdemRow = { key: string; tool: "create_rental" | "extend_rental"; requestHash: string; orderId: string; providerRef: string | null };
export type Commit = {
  order?: { id: string; fromVersion: number; patch: Partial<Order> };
  payment?: PaymentRecord;
  refunds?: RefundRecord[];
  job?: SignedJob;
  binding?: { ref: string; b: Binding };
  idem?: IdemRow;
  events?: { orderId: string; from: string; to: string; actor: string; at: number }[];
  alerts?: { kind: string; orderRef: string; at: number }[];
};

export interface RentalStore {
  insertOrder(o: Order, idem: IdemRow): Promise<void>;
  getOrder(id: string): Promise<Order | null>;
  getOrderByPublicId(pid: string): Promise<Order | null>;
  getOrderByCodeHmac(h: string): Promise<Order | null>;
  getBinding(ref: string): Promise<Binding | null>;
  refsForOrder(orderId: string): Promise<string[]>;
  getIdem(key: string): Promise<IdemRow | null>;
  paymentsForRef(ref: string): Promise<PaymentRecord[]>;
  refundsForRef(ref: string): Promise<RefundRecord[]>;
  listRefunds(): Promise<RefundRecord[]>;
  listJobs(orderRef?: string): Promise<SignedJob[]>;
  rigsCommitted(now: number): Promise<number>;
  rigsSoftHeld(now: number): Promise<number>;
  listOrders(states: OrderState[]): Promise<Order[]>;
  /** Node write (SQL: insert into rental_job_results as the node role, gm_node). */
  recordResult(r: JobResult): Promise<void>;
  resultsForOrder(orderRef: string): Promise<JobResult[]>;
  /** x402 refs the facilitator settled. tx hash unique: one transfer pays one ref. */
  getSettlement(ref: string): Promise<X402Settlement | null>;
  recordSettlement(s: X402Settlement): Promise<void>;
  /** Settled-but-unchecked Solana signatures, keyed by tx_hash (SF3). Never counts as paid. UNRESOLVED ones for a ref.
   *  Throws PendingReadError when the read fails (SF2); returns [] only when the table isn't migrated yet. */
  pendingForRef(ref: string): Promise<X402Pending[]>;
  /** Unresolved pending signatures, any order state (FB1 sweep): oldest PENDING_LIST_CAP rows + the total. Same error rules. */
  listUnresolvedPending(): Promise<PendingPage>;
  /** #103 S7: is the pending-signature schema (migration 20261017170000) in place and readable? false on any doubt. */
  pendingSchemaReady(): Promise<boolean>;
  /** #103 N1: mainnet Solana has seen the schema in place. From now on a missing pending schema is a READ ERROR
   *  (PendingReadError, fail closed), never "no pending rows". */
  requirePendingSchema(): void;
  recordPendingSettlement(p: X402Pending): Promise<void>;
  /** Append-only; one row per (txHash, outcome); settled and dropped are mutually exclusive. */
  recordPendingResolution(r: PendingResolution): Promise<void>;
  /** B7: the node's availability report (SQL rental_bay_availability_read). Throws on any read error; callers fail closed. */
  bayAvailability(maxAgeS: number): Promise<BayAvailability[]>;
  /** Atomic. Throws StaleVersion / UniqueViolation and writes nothing on failure. */
  commit(c: Commit): Promise<Order | null>;
}

export class MemoryStore implements RentalStore {
  orders = new Map<string, Order>();
  bindings = new Map<string, Binding>();
  idem = new Map<string, IdemRow>();
  payments: PaymentRecord[] = [];
  refunds: RefundRecord[] = [];
  jobs: SignedJob[] = [];
  results: JobResult[] = [];
  settlements = new Map<string, X402Settlement>();
  pending = new Map<string, X402Pending>();          // by txHash
  resolutions: PendingResolution[] = [];
  /** Test hook: make pending reads fail (SF2). */
  pendingReadFails = false;
  /** Test hook: pretend migration 20261017170000 isn't applied (S7). */
  pendingMigrated = true;
  /** N1: set once mainnet Solana has seen the schema. */
  pendingSchemaRequired = false;
  requirePendingSchema() { this.pendingSchemaRequired = true; }
  private pendingCheck() {
    if (this.pendingReadFails) throw new PendingReadError();
    if (!this.pendingMigrated && this.pendingSchemaRequired) throw new PendingReadError();
  }
  private withOutcomes(p: X402Pending): X402Pending { return { ...this.c(p), outcomes: this.resolutions.filter((r) => r.txHash === p.txHash).map((r) => r.outcome) }; }
  async pendingForRef(ref: string) {
    this.pendingCheck();
    if (!this.pendingMigrated) return [];
    return [...this.pending.values()].filter((p) => p.providerRef === ref).map((p) => this.withOutcomes(p)).filter(pendingUnresolved);
  }
  async listUnresolvedPending(): Promise<PendingPage> {
    this.pendingCheck();
    if (!this.pendingMigrated) return { rows: [], total: 0 };
    const all = [...this.pending.values()].map((p) => this.withOutcomes(p)).filter(pendingUnresolved).sort((a, b) => a.at - b.at || (a.txHash < b.txHash ? -1 : 1));
    return { rows: all.slice(0, PENDING_LIST_CAP), total: all.length };
  }
  async pendingSchemaReady() { return this.pendingMigrated && !this.pendingReadFails; }
  async recordPendingSettlement(p: X402Pending) { if (!this.pending.has(p.txHash)) this.pending.set(p.txHash, this.c({ ...p, outcomes: undefined })); }
  async recordPendingResolution(r: PendingResolution) {
    if (!this.pending.has(r.txHash)) throw new Error("unknown_pending");
    const mine = this.resolutions.filter((x) => x.txHash === r.txHash);
    if (mine.some((x) => x.outcome === r.outcome)) return;
    if (TERMINAL_OUTCOMES.includes(r.outcome) && mine.some((x) => TERMINAL_OUTCOMES.includes(x.outcome))) throw new Error("pending_resolution_conflict");
    this.resolutions.push({ ...r });
  }
  async getSettlement(ref: string) { return this.c(this.settlements.get(ref) ?? null); }
  async recordSettlement(s: X402Settlement) {
    if (this.settlements.has(s.providerRef) || [...this.settlements.values()].some((x) => x.txHash === s.txHash)) throw new UniqueViolation("x402_settlement");
    this.settlements.set(s.providerRef, this.c(s));
  }
  async recordResult(r: JobResult) { if (!this.jobs.some((j) => j.payload.job_id === r.jobId)) throw new Error("unknown_job"); this.results.push({ ...r }); }
  async resultsForOrder(ref: string) { return this.c(this.results.filter((r) => r.orderRef === ref)); }
  events: { orderId: string; from: string; to: string; actor: string; at: number }[] = [];
  alerts: { kind: string; orderRef: string; at: number }[] = [];
  /** Mirrors rental_settings.rentals_enabled (the DB row). */
  rentalsEnabled = true;
  /** B7 test hooks: rows as the node reported them (reportedAt ms) and a read failure. */
  bayReports: { bay: number; free: boolean; reason: BayReason; mrrRentedUntil?: number | null; reportedAt: number }[] = [];
  bayReadFails = false;
  /** Clock for freshness (the DB clock in SQL). Tests set it to the deps clock. */
  dbNow: () => number = () => Date.now();
  async bayAvailability(maxAgeS: number): Promise<BayAvailability[]> {
    if (this.bayReadFails) throw new Error("bay_read_failed");
    const now = this.dbNow();
    return this.bayReports.slice().sort((a, b) => a.bay - b.bay).map((r) => ({ bay: r.bay, free: r.free, reason: r.reason, mrrRentedUntil: r.mrrRentedUntil ?? null, fresh: r.reportedAt > now - maxAgeS * 1000 }));
  }
  private c<T>(o: T): T { return o == null ? o : structuredClone(o); }

  async insertOrder(o: Order, idem: IdemRow) {
    if (this.idem.has(idem.key)) throw new UniqueViolation("idem_key");
    for (const x of this.orders.values()) if (x.publicId === o.publicId) throw new UniqueViolation("public_id");
    this.orders.set(o.id, this.c(o));
    this.idem.set(idem.key, this.c(idem));
  }
  async getOrder(id: string) { return this.c(this.orders.get(id) ?? null); }
  async getOrderByPublicId(p: string) { return this.c([...this.orders.values()].find((o) => o.publicId === p) ?? null); }
  async getOrderByCodeHmac(h: string) { return this.c([...this.orders.values()].find((o) => o.accessCodeHmac === h) ?? null); }
  async getBinding(ref: string) { return this.c(this.bindings.get(ref) ?? null); }
  async refsForOrder(id: string) { return [...this.bindings.entries()].filter(([, b]) => b.orderId === id).map(([r]) => r); }
  async getIdem(k: string) { return this.c(this.idem.get(k) ?? null); }
  async paymentsForRef(r: string) { return this.c(this.payments.filter((p) => p.providerRef === r)); }
  async refundsForRef(r: string) { return this.c(this.refunds.filter((p) => p.providerRef === r)); }
  async listRefunds() { return this.c(this.refunds); }
  async listJobs(ref?: string) { return this.c(this.jobs.filter((j) => !ref || j.payload.order_ref === ref)); }
  async rigsCommitted(_now?: number) { void _now; return [...this.orders.values()].filter((o) => ["paid", "delivering", "active"].includes(o.state)).reduce((a, o) => a + o.rigCount, 0); }
  async rigsSoftHeld(now: number) { return [...this.orders.values()].filter((o) => o.state === "awaiting_payment" && o.expiresAt > now).reduce((a, o) => a + o.rigCount, 0); }
  async listOrders(states: OrderState[]) { return this.c([...this.orders.values()].filter((o) => states.includes(o.state))); }

  async commit(c: Commit) {
    // 1. check every precondition (no writes yet)
    if (c.order) {
      const o = this.orders.get(c.order.id); if (!o || o.version !== c.order.fromVersion) throw new StaleVersion();
      const to = c.order.patch.state;
      if (to && !transitionOk(o.state, to)) throw new IllegalTransition(o.state, to);
      const starting = !!to && COMMITTED_STATES.includes(to) && !COMMITTED_STATES.includes(o.state);
      const addingDays = c.order.patch.days != null && c.order.patch.days > o.days;
      if ((starting || addingDays) && !this.rentalsEnabled) throw new KillSwitchError();
      // Bays never overlap between committed orders (SQL: rental_orders_bays_guard trigger, B7 substitution).
      const nextState = to ?? o.state, nextBays = c.order.patch.bays;
      if (nextBays && nextBays !== o.bays && COMMITTED_STATES.includes(nextState)) {
        const mine = new Set(nextBays.split(","));
        for (const x of this.orders.values()) if (x.id !== o.id && COMMITTED_STATES.includes(x.state) && x.bays && x.bays.split(",").some((b) => mine.has(b))) throw new CapExceeded();
      }
      if (starting) {
        const others = [...this.orders.values()].filter((x) => x.id !== o.id && COMMITTED_STATES.includes(x.state)).reduce((a, x) => a + x.rigCount, 0);
        if (others + o.rigCount > PILOT_CAP_RIGS) throw new CapExceeded();
      }
    }
    if (c.payment && this.payments.some((p) => p.id === c.payment!.id)) throw new UniqueViolation("payment_seq");
    for (const r of c.refunds ?? []) if (this.refunds.some((x) => x.providerRef === r.providerRef && x.seq === r.seq)) throw new UniqueViolation("refund_seq");
    if (c.job && this.jobs.some((x) => x.payload.nonce === c.job!.payload.nonce || x.payload.job_id === c.job!.payload.job_id)) throw new UniqueViolation("job");
    if (c.binding && this.bindings.has(c.binding.ref)) throw new UniqueViolation("provider_ref");
    if (c.idem && this.idem.has(c.idem.key)) throw new UniqueViolation("idem_key");
    // 2. apply all (synchronous: no interleaving possible)
    let out: Order | null = null;
    if (c.order) { const o = this.orders.get(c.order.id)!; out = { ...o, ...c.order.patch, version: o.version + 1 }; this.orders.set(o.id, out); }
    if (c.payment) this.payments.push(this.c(c.payment));
    for (const r of c.refunds ?? []) this.refunds.push(this.c(r));
    if (c.job) this.jobs.push(this.c(c.job));
    if (c.binding) this.bindings.set(c.binding.ref, this.c(c.binding.b));
    if (c.idem) this.idem.set(c.idem.key, this.c(c.idem));
    this.events.push(...(c.events ?? []));
    this.alerts.push(...(c.alerts ?? []));
    return this.c(out);
  }
}
