/**
 * BTC binding storage (mirrors supabase/migrations/20261017190000_phase2_btc_onchain.sql).
 * Memory version for tests and the staging preview; Supabase version over PostgREST (service role, server only).
 * Every multi-row write is ONE transaction (btc_insert_binding, btc_accept_paid); any failure writes nothing.
 */
import { MemoryStore, UniqueViolation, StaleVersion, CapExceeded, KillSwitchError, IllegalTransition, type Commit, type Binding, type RentalStore } from "../store";
import type { SupabaseStore } from "../store-supabase";

export type BtcBindingStatus =
  | "awaiting_attest" | "awaiting_payment" | "seen" | "underpaid" | "paid" | "refused" | "expired" | "late_payment" | "duplicate"
  | "reorged" | "killed_refund" | "refund_pending" | "refunded" | "manual_review";
/** Statuses that hold the order for BTC: x402 refuses to take money while one exists (and vice versa). */
export const BTC_RELEASED: BtcBindingStatus[] = ["refused", "expired"];

export type BtcBinding = {
  bindingId: string; providerRef: string; orderId: string; orderRef: string; kind: "initial" | "extension"; network: string;
  index: number | null; address: string | null; amountSat: number; requiredConfs: 1 | 2; floorStr: string; floorDay: string;
  quoteAt: number; quoteExpiresAt: number;          // unix seconds (as signed)
  quoteTipHeight: number | null; confirmByHeight: number | null;
  status: BtcBindingStatus; statusReason: string | null;
  attestEnv: unknown | null; paidEnv: unknown | null;
  receivedSat: number; creditedSat: number; refundedSat: number;
  displayOkAt: number | null; createdAt: number; updatedAt: number; version: number;
};
export type BtcEvent = { id: number; bindingId: string | null; type: "addr_refused" | "paid" | "reorged" | "seen" | "underpaid"; env: unknown; receivedAt: number; processedAt: number | null; outcome: string | null; attempts?: number; firstFailedAt?: number | null; lastFailedAt?: number | null };
export type BtcHeartbeatRow = { env: unknown; receivedAt: number };
export type BtcOutpointRow = { txid: string; vout: number; valueSat: number; height: number };
export type BtcBindingPatch = Partial<Pick<BtcBinding, "status" | "statusReason" | "displayOkAt" | "refundedSat">>;
export type AcceptPaid = {
  bindingId: string; fromVersion: number;
  nonce?: string; nonceType?: "paid" | "reorged" | "seen" | "underpaid";
  outpoints?: BtcOutpointRow[];
  patch: Partial<Pick<BtcBinding, "status" | "statusReason" | "paidEnv" | "receivedSat" | "creditedSat" | "refundedSat">>;
  /** Switch the (x402-created, still unpaid) order to rail btc_onchain with totalSats = amount (initial settle only). */
  orderRail?: { orderId: string; totalSats: number };
  eventId?: number; eventOutcome?: string;
  commit?: Commit;
};
export class BtcOutpointReused extends Error { constructor() { super("btc_outpoint_reused"); } }
export class BtcBindConflict extends Error { constructor(public why: "btc_order_not_payable" | "btc_x402_money" | "btc_binding_exists") { super(why); } }

export interface BtcStore {
  insertBinding(b: BtcBinding, rental: { ref: string; b: Binding }): Promise<void>;
  getBinding(id: string): Promise<BtcBinding | null>;
  bindingsForOrder(orderId: string): Promise<BtcBinding[]>;
  listBindings(statuses: BtcBindingStatus[]): Promise<BtcBinding[]>;
  /** true = a binding that is not refused/expired exists (holds the order for BTC). Errors propagate (callers fail closed). */
  hasLiveBinding(orderId: string): Promise<boolean>;
  updateBinding(id: string, fromVersion: number, patch: BtcBindingPatch): Promise<boolean>;
  recordNonce(nonce: string, type: "addr" | "addr_refused" | "paid" | "reorged" | "seen" | "underpaid", bindingId: string | null): Promise<boolean>;
  latestHeartbeat(): Promise<BtcHeartbeatRow | null>;
  /** Unprocessed events: never-failed first (oldest first), then by last failure (least recently failed first), so a
   *  pile of repeatedly failing events can't starve fresh ones or each other. */
  pendingEvents(limit: number, bindingId?: string): Promise<BtcEvent[]>;
  markEvent(id: number, outcome: string): Promise<boolean>;
  /** FB3: count one failed attempt (an unprocessed event only). Returns the totals, or null if already processed. */
  noteEventFailure(id: number, error: string): Promise<{ attempts: number; firstFailedAt: number } | null>;
  acceptPaid(a: AcceptPaid): Promise<void>;
}

const cl = <T>(x: T): T => (x == null ? x : structuredClone(x));

/** In-memory twin of the SQL. Agent-side calls (attach, report, heartbeat) are test hooks here. */
export class MemoryBtcStore implements BtcStore {
  bindings = new Map<string, BtcBinding>();
  outpoints = new Map<string, { bindingId: string } & BtcOutpointRow>();
  nonces = new Set<string>();
  events: BtcEvent[] = [];
  heartbeat: BtcHeartbeatRow | null = null;
  private seq = 0;
  constructor(private rental: MemoryStore, private now: () => number = Date.now) {}

  async insertBinding(b: BtcBinding, rental: { ref: string; b: Binding }) {
    const o = this.rental.orders.get(b.orderId);
    if (!o || o.state !== "awaiting_payment" || o.rail !== "x402_usdc") throw new BtcBindConflict("btc_order_not_payable");
    const refs = [...this.rental.bindings.entries()].filter(([, x]) => x.orderId === b.orderId).map(([r]) => r);
    if (refs.some((r) => this.rental.settlements.has(r) || [...this.rental.pending.values()].some((p) => p.providerRef === r))) throw new BtcBindConflict("btc_x402_money");
    if ([...this.bindings.values()].some((x) => x.orderId === b.orderId && !BTC_RELEASED.includes(x.status))) throw new BtcBindConflict("btc_binding_exists");
    if (this.bindings.has(b.bindingId) || this.rental.bindings.has(rental.ref)) throw new UniqueViolation("btc_binding");
    await this.rental.commit({ binding: rental });
    this.bindings.set(b.bindingId, cl(b));
  }
  async getBinding(id: string) { return cl(this.bindings.get(id) ?? null); }
  async bindingsForOrder(orderId: string) { return [...this.bindings.values()].filter((b) => b.orderId === orderId).sort((a, b) => a.createdAt - b.createdAt).map(cl); }
  async listBindings(st: BtcBindingStatus[]) { return [...this.bindings.values()].filter((b) => st.includes(b.status)).map(cl); }
  async hasLiveBinding(orderId: string) { return [...this.bindings.values()].some((b) => b.orderId === orderId && !BTC_RELEASED.includes(b.status)); }
  async updateBinding(id: string, v: number, p: BtcBindingPatch) {
    const b = this.bindings.get(id);
    if (!b || b.version !== v) return false;
    this.bindings.set(id, { ...b, ...p, version: v + 1, updatedAt: this.now() });
    return true;
  }
  async recordNonce(n: string) { if (this.nonces.has(n)) return false; this.nonces.add(n); return true; }
  async latestHeartbeat() { return cl(this.heartbeat); }
  async pendingEvents(limit: number, bindingId?: string) {
    return this.events.filter((e) => e.processedAt == null && (!bindingId || e.bindingId === bindingId)).sort((a, b) => (a.lastFailedAt ?? -Infinity) - (b.lastFailedAt ?? -Infinity) || a.receivedAt - b.receivedAt || a.id - b.id).slice(0, limit).map(cl);
  }
  async markEvent(id: number, outcome: string) {
    const e = this.events.find((x) => x.id === id);
    if (!e || e.processedAt != null) return false;
    e.processedAt = this.now(); e.outcome = outcome; return true;
  }
  async noteEventFailure(id: number, _error: string) {
    const e = this.events.find((x) => x.id === id);
    if (!e || e.processedAt != null) return null;
    e.attempts = (e.attempts ?? 0) + 1; e.firstFailedAt = e.firstFailedAt ?? this.now(); e.lastFailedAt = this.now();
    return { attempts: e.attempts, firstFailedAt: e.firstFailedAt };
  }
  async acceptPaid(a: AcceptPaid) {
    // 1. preconditions (no writes)
    const b = this.bindings.get(a.bindingId);
    if (!b || b.version !== a.fromVersion) throw new StaleVersion();
    if (a.nonce && this.nonces.has(a.nonce)) throw new UniqueViolation("btc_nonce");
    for (const o of a.outpoints ?? []) { const x = this.outpoints.get(`${o.txid}:${o.vout}`); if (x && x.bindingId !== a.bindingId) throw new BtcOutpointReused(); }
    if (a.orderRail) {
      const o = this.rental.orders.get(a.orderRail.orderId);
      const refs = [...this.rental.bindings.entries()].filter(([, x]) => x.orderId === a.orderRail!.orderId).map(([r]) => r);
      if (!o || o.state !== "awaiting_payment" || o.rail !== "x402_usdc" || refs.some((r) => this.rental.settlements.has(r))) throw new StaleVersion();
    }
    if (a.eventId != null) { const e = this.events.find((x) => x.id === a.eventId); if (!e || e.processedAt != null) throw new StaleVersion(); }
    // 2. the rental commit (its own all-or-nothing checks), with the rail switch folded into its order patch
    let commit = a.commit;
    if (a.orderRail) {
      const o = this.rental.orders.get(a.orderRail.orderId)!;
      const railPatch = { rail: "btc_onchain" as const, totalSats: a.orderRail.totalSats, totalUsdcAtomic: null };
      commit = commit?.order
        ? { ...commit, order: { ...commit.order, patch: { ...commit.order.patch, ...railPatch } } }
        : { ...(commit ?? {}), order: { id: o.id, fromVersion: o.version, patch: railPatch } };
    }
    if (commit) await this.rental.commit(commit);
    // 3. apply
    if (a.nonce) this.nonces.add(a.nonce);
    for (const o of a.outpoints ?? []) if (!this.outpoints.has(`${o.txid}:${o.vout}`)) this.outpoints.set(`${o.txid}:${o.vout}`, { ...o, bindingId: a.bindingId });
    this.bindings.set(a.bindingId, { ...b, ...cl(a.patch), version: b.version + 1, updatedAt: this.now() });
    if (a.eventId != null) { const e = this.events.find((x) => x.id === a.eventId)!; e.processedAt = this.now(); e.outcome = a.eventOutcome ?? "accepted"; }
  }

  // ── agent-side test hooks (the SQL functions gm_btc calls) ──
  attach(bindingId: string, envelope: { payload: Record<string, unknown> }) {
    const b = this.bindings.get(bindingId);
    const p = envelope.payload;
    if (!b || b.status !== "awaiting_attest" || p.type !== "addr" || p.binding_id !== bindingId) throw new Error("btc_binding_not_awaiting_attest");
    const idx = Number(p.index), addr = String(p.address);
    if ([...this.bindings.values()].some((x) => x.bindingId !== bindingId && (x.index === idx || x.address === addr))) throw new UniqueViolation("btc_index_burned");
    this.bindings.set(bindingId, { ...b, attestEnv: cl(envelope), index: idx, address: addr, quoteTipHeight: Number(p.quote_tip_height), confirmByHeight: Number(p.confirm_by_height), status: "awaiting_payment", version: b.version + 1, updatedAt: this.now() });
  }
  report(envelope: { payload: Record<string, unknown> }, receivedAt = this.now()) {
    const p = envelope.payload;
    const id = ++this.seq;
    const bid = typeof p.binding_id === "string" && /^[0-9a-f-]{36}$/.test(p.binding_id) ? p.binding_id : null;
    this.events.push({ id, bindingId: bid, type: p.type as BtcEvent["type"], env: cl(envelope), receivedAt, processedAt: null, outcome: null });
    return id;
  }
  beat(envelope: unknown, receivedAt = this.now()) { this.heartbeat = { env: cl(envelope), receivedAt }; }
}

const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());
const msOf = (s: unknown) => (s == null ? null : Date.parse(String(s)));
type Row = Record<string, unknown>;

/** Supabase (staging project). Reads via PostgREST tables (service role bypasses RLS); writes only via the RPCs. */
export class SupabaseBtcStore implements BtcStore {
  private url: string;
  constructor(url: string, private key: string, private rental: SupabaseStore, private fetchImpl: typeof fetch = fetch) { this.url = url.replace(/\/$/, ""); }
  private async req(path: string, init: RequestInit = {}): Promise<unknown> {
    const r = await this.fetchImpl(`${this.url}/rest/v1/${path}`, { ...init, cache: "no-store", headers: { apikey: this.key, authorization: `Bearer ${this.key}`, "content-type": "application/json", ...(init.headers ?? {}) } });
    const text = await r.text();
    const body = text ? JSON.parse(text) : null;
    if (!r.ok) {
      const code = (body as Row | null)?.code, msg = String((body as Row | null)?.message ?? "");
      for (const why of ["btc_order_not_payable", "btc_x402_money", "btc_binding_exists"] as const) if (msg.includes(why)) throw new BtcBindConflict(why);
      if (msg.includes("btc_outpoint_reused")) throw new BtcOutpointReused();
      if (code === "23505") throw new UniqueViolation(msg.slice(0, 60));
      if (/stale_version/.test(msg) || code === "40001") throw new StaleVersion();
      if (/cap_exceeded/.test(msg)) throw new CapExceeded();
      if (/kill_switch/.test(msg)) throw new KillSwitchError();
      if (/illegal_transition/.test(msg)) throw new IllegalTransition("?", "?");
      throw new Error(`btc_store_error:${r.status}:${String(code ?? "")}`);
    }
    return body;
  }
  private get(path: string) { return this.req(path) as Promise<Row[]>; }
  private rpc(fn: string, args: unknown) { return this.req(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }); }
  private enc = encodeURIComponent;
  private row(r: Row | undefined): BtcBinding | null {
    if (!r) return null;
    const sec = (v: unknown) => Math.floor(Date.parse(String(v)) / 1000);
    return {
      bindingId: r.binding_id as string, providerRef: r.provider_ref as string, orderId: r.order_id as string, orderRef: r.order_ref as string,
      kind: r.kind as BtcBinding["kind"], network: r.network as string, index: r.addr_index == null ? null : Number(r.addr_index), address: (r.address as string) ?? null,
      amountSat: Number(r.amount_sat), requiredConfs: Number(r.required_confs) as 1 | 2, floorStr: r.floor_btc_per_ph_day as string, floorDay: String(r.floor_day),
      quoteAt: sec(r.quote_at), quoteExpiresAt: sec(r.quote_expires_at),
      quoteTipHeight: r.quote_tip_height == null ? null : Number(r.quote_tip_height), confirmByHeight: r.confirm_by_height == null ? null : Number(r.confirm_by_height),
      status: r.status as BtcBindingStatus, statusReason: (r.status_reason as string) ?? null, attestEnv: r.attest_env ?? null, paidEnv: r.paid_env ?? null,
      receivedSat: Number(r.received_sat), creditedSat: Number(r.credited_sat), refundedSat: Number(r.refunded_sat),
      displayOkAt: msOf(r.display_ok_at), createdAt: msOf(r.created_at)!, updatedAt: msOf(r.updated_at)!, version: Number(r.version),
    };
  }
  async insertBinding(b: BtcBinding, rental: { ref: string; b: Binding }) {
    await this.rpc("btc_insert_binding", {
      p_binding: { binding_id: b.bindingId, provider_ref: b.providerRef, order_id: b.orderId, order_ref: b.orderRef, kind: b.kind, network: b.network,
        amount_sat: b.amountSat, required_confs: b.requiredConfs, floor_btc_per_ph_day: b.floorStr, floor_day: b.floorDay,
        quote_at: iso(b.quoteAt * 1000), quote_expires_at: iso(b.quoteExpiresAt * 1000) },
      p_rental: { provider_ref: rental.ref, kind: rental.b.kind, expected_atomic: rental.b.expectedAtomic, extend_days: rental.b.extendDays, expires_at: iso(rental.b.expiresAt), challenge: rental.b.challenge },
    });
  }
  async getBinding(id: string) { return this.row((await this.get(`btc_bindings?binding_id=eq.${this.enc(id)}`))[0]); }
  async bindingsForOrder(orderId: string) { return (await this.get(`btc_bindings?order_id=eq.${this.enc(orderId)}&order=created_at`)).map((r) => this.row(r)!); }
  async listBindings(st: BtcBindingStatus[]) { return (await this.get(`btc_bindings?status=in.(${st.join(",")})&order=created_at&limit=1000`)).map((r) => this.row(r)!); }
  async hasLiveBinding(orderId: string) { return (await this.get(`btc_bindings?select=binding_id&order_id=eq.${this.enc(orderId)}&status=not.in.(${BTC_RELEASED.join(",")})&limit=1`)).length > 0; }
  async updateBinding(id: string, v: number, p: BtcBindingPatch) {
    const patch: Row = {};
    if (p.status !== undefined) patch.status = p.status;
    if (p.statusReason !== undefined) patch.status_reason = p.statusReason;
    if (p.displayOkAt !== undefined) patch.display_ok_at = iso(p.displayOkAt);
    if (p.refundedSat !== undefined) patch.refunded_sat = p.refundedSat;
    return (await this.rpc("btc_update_binding", { p_binding_id: id, p_from_version: v, p_patch: patch })) === true;
  }
  async recordNonce(n: string, type: string, bindingId: string | null) { return (await this.rpc("btc_record_nonce", { p_nonce: n, p_type: type, p_binding_id: bindingId })) === true; }
  async latestHeartbeat() { const r = (await this.get("btc_heartbeat?id=eq.1"))[0]; return r ? { env: r.env, receivedAt: msOf(r.received_at)! } : null; }
  async pendingEvents(limit: number, bindingId?: string) {
    const rows = await this.get(`btc_events?processed_at=is.null${bindingId ? `&binding_id=eq.${this.enc(bindingId)}` : ""}&order=last_failed_at.asc.nullsfirst,received_at,id&limit=${Math.max(1, Math.min(200, limit))}`);
    return rows.map((r) => ({ id: Number(r.id), bindingId: (r.binding_id as string) ?? null, type: r.type as BtcEvent["type"], env: r.env, receivedAt: msOf(r.received_at)!, processedAt: null, outcome: null, attempts: Number(r.attempts ?? 0), firstFailedAt: msOf(r.first_failed_at), lastFailedAt: msOf(r.last_failed_at) }));
  }
  async markEvent(id: number, outcome: string) { return (await this.rpc("btc_mark_event", { p_id: id, p_outcome: outcome })) === true; }
  async noteEventFailure(id: number, error: string) {
    const r = (await this.rpc("btc_event_failed", { p_id: id, p_error: error.toLowerCase().replace(/[^a-z0-9_:]/g, "_").slice(0, 60) || "error" })) as Row | null;
    return r ? { attempts: Number(r.attempts), firstFailedAt: msOf(r.first_failed_at)! } : null;
  }
  async acceptPaid(a: AcceptPaid) {
    const patch: Row = {};
    if (a.patch.status !== undefined) patch.status = a.patch.status;
    if (a.patch.statusReason !== undefined) patch.status_reason = a.patch.statusReason;
    if (a.patch.paidEnv !== undefined) patch.paid_env = a.patch.paidEnv;
    if (a.patch.receivedSat !== undefined) patch.received_sat = a.patch.receivedSat;
    if (a.patch.creditedSat !== undefined) patch.credited_sat = a.patch.creditedSat;
    if (a.patch.refundedSat !== undefined) patch.refunded_sat = a.patch.refundedSat;
    const p: Row = { binding_id: a.bindingId, from_version: a.fromVersion, patch };
    if (a.nonce) { p.nonce = a.nonce; p.nonce_type = a.nonceType ?? "paid"; }
    if (a.outpoints?.length) p.outpoints = a.outpoints.map((o) => ({ txid: o.txid, vout: o.vout, value_sat: o.valueSat, height: o.height }));
    if (a.orderRail) p.order_rail = { order_id: a.orderRail.orderId, total_sats: a.orderRail.totalSats };
    if (a.eventId != null) { p.event_id = a.eventId; p.event_outcome = a.eventOutcome ?? "accepted"; }
    if (a.commit) p.commit = this.rental.commitBody(a.commit);
    await this.rpc("btc_accept_paid", { p });
  }
}

export type { RentalStore };
