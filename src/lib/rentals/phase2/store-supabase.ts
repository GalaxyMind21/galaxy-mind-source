/**
 * Persistent RentalStore on the staging Supabase project (PostgREST, service
 * role, server only). Reads hit the tables; every write goes through one of
 * three SECURITY DEFINER RPCs (rental_insert_order, rental_settle,
 * rental_record_x402), each one transaction. Works across serverless instances.
 */
import type { Order, PaymentRecord, RefundRecord, OrderState } from "./types";
import type { SignedJob } from "./jobs";
import { UniqueViolation, StaleVersion, CapExceeded, KillSwitchError, IllegalTransition, COMMITTED_STATES, type RentalStore, type Commit, type Binding, type IdemRow, type JobResult, type X402Settlement, type X402Pending, type PendingResolution, type PendingOutcome, type PendingPage, type BayAvailability, type BayReason, PendingReadError, pendingUnresolved, PENDING_LIST_CAP } from "./store";

const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());
const ms = (s: string | null | undefined) => (s == null ? null : Date.parse(s));
type Row = Record<string, unknown>;

/** Refund approval state as the site sees it. approved/paid pass through; anything else is waiting for the owner,
 *  which also covers rows written before 20261019040000 renamed the pending value (nothing compares it). */
const refundStatus = (v: unknown): RefundRecord["status"] => (v === "approved" || v === "paid" ? v : "pending_owner");

export class SupabaseStore implements RentalStore {
  constructor(private url: string, private key: string, private fetchImpl: typeof fetch = fetch) {
    this.url = url.replace(/\/$/, "");
  }
  private async req(path: string, init: RequestInit = {}): Promise<unknown> {
    const r = await this.fetchImpl(`${this.url}/rest/v1/${path}`, {
      ...init, cache: "no-store",
      headers: { apikey: this.key, authorization: `Bearer ${this.key}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    const text = await r.text();
    const body = text ? JSON.parse(text) : null;
    if (!r.ok) {
      const code = (body as Row | null)?.code, msg = String((body as Row | null)?.message ?? "");
      if (code === "23505") throw new UniqueViolation(msg.slice(0, 60));
      if (/stale_version/.test(msg) || code === "40001") throw new StaleVersion();
      if (/cap_exceeded/.test(msg)) throw new CapExceeded();
      if (/kill_switch/.test(msg)) throw new KillSwitchError();
      if (/illegal_transition/.test(msg)) throw new IllegalTransition("?", "?");
      throw new Error(`store_error:${r.status}:${String(code ?? "")}`);
    }
    return body;
  }
  private get(path: string) { return this.req(path) as Promise<Row[]>; }
  private rpc(fn: string, args: unknown) { return this.req(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }); }

  private order(r: Row | undefined): Order | null {
    if (!r) return null;
    return {
      id: r.id as string, publicId: r.public_id as string, idemKey: r.idem_key as string, rail: r.rail as Order["rail"], state: r.state as OrderState,
      rigCount: r.rig_count as number, th: r.th as number, days: r.days as number,
      priceBtcPhDay: Number(r.price_btc_ph_day), floorBtcPhDay: Number(r.floor_btc_ph_day), totalSats: Number(r.total_sats),
      totalUsdcAtomic: r.total_usdc_atomic == null ? null : Number(r.total_usdc_atomic),
      poolHost: r.pool_host as string, poolPort: r.pool_port as number, worker: r.worker as string,
      accessCodeHmac: r.access_code_hmac as string, creatorSecretHmac: r.creator_secret_hmac as string,
      createdAt: ms(r.created_at as string)!, expiresAt: ms(r.expires_at as string)!, startsAt: ms(r.starts_at as string), endsAt: ms(r.ends_at as string),
      termsVersion: (r.terms_version as string) ?? null, termsAcceptedAt: ms(r.terms_accepted_at as string), bays: (r.bays as string) ?? null,
      version: r.version as number,
    };
  }
  private binding(r: Row | undefined): Binding | null {
    if (!r) return null;
    return { orderId: r.order_id as string, kind: r.kind as Binding["kind"], expectedAtomic: Number(r.expected_atomic), expiresAt: ms(r.expires_at as string)!, extendDays: (r.extend_days as number) ?? null, challenge: r.challenge };
  }
  private payment(r: Row): PaymentRecord {
    return { id: r.id as string, orderId: r.order_id as string, kind: r.kind as PaymentRecord["kind"], rail: r.rail as PaymentRecord["rail"], providerRef: r.provider_ref as string,
      seq: Number(r.seq), deltaAtomic: Number(r.delta_atomic), cumulativeAtomic: Number(r.cumulative_atomic), expectedAtomic: Number(r.expected_atomic),
      extendDays: (r.extend_days as number) ?? null, settles: !!r.settles, at: ms(r.at as string)! };
  }
  private refund(r: Row): RefundRecord {
    return { id: r.id as string, orderId: r.order_id as string, providerRef: r.provider_ref as string, seq: Number(r.seq), reason: r.reason as RefundRecord["reason"],
      atomic: Number(r.atomic), rail: r.rail as RefundRecord["rail"], status: refundStatus(r.status), at: ms(r.at as string)!,
      network: (r.refund_network as string) ?? null, payoutNetwork: (r.payout_network as string) ?? null };
  }
  private enc = encodeURIComponent;

  async insertOrder(o: Order, i: IdemRow) {
    await this.rpc("rental_insert_order", {
      o: { id: o.id, public_id: o.publicId, idem_key: o.idemKey, rail: o.rail, state: o.state, rig_count: o.rigCount, th: o.th, days: o.days,
        price_btc_ph_day: o.priceBtcPhDay, floor_btc_ph_day: o.floorBtcPhDay, total_sats: o.totalSats, total_usdc_atomic: o.totalUsdcAtomic,
        pool_host: o.poolHost, pool_port: o.poolPort, worker: o.worker, access_code_hmac: o.accessCodeHmac, creator_secret_hmac: o.creatorSecretHmac,
        created_at: iso(o.createdAt), expires_at: iso(o.expiresAt), terms_version: o.termsVersion, terms_accepted_at: iso(o.termsAcceptedAt), bays: o.bays },
      i: { key: i.key, tool: i.tool, request_hash: i.requestHash, order_id: i.orderId, provider_ref: i.providerRef },
    });
  }
  async getOrder(id: string) { return this.order((await this.get(`rental_orders?id=eq.${this.enc(id)}`))[0]); }
  async getOrderByPublicId(p: string) { return this.order((await this.get(`rental_orders?public_id=eq.${this.enc(p)}`))[0]); }
  async getOrderByCodeHmac(h: string) { return this.order((await this.get(`rental_orders?access_code_hmac=eq.${this.enc(h)}`))[0]); }
  async getBinding(ref: string) { return this.binding((await this.get(`rental_payment_bindings?provider_ref=eq.${this.enc(ref)}`))[0]); }
  async refsForOrder(id: string) { return (await this.get(`rental_payment_bindings?select=provider_ref&order_id=eq.${this.enc(id)}`)).map((r) => r.provider_ref as string); }
  async getIdem(k: string) {
    const r = (await this.get(`rental_idempotency?key=eq.${this.enc(k)}`))[0];
    return r ? { key: r.key as string, tool: r.tool as IdemRow["tool"], requestHash: r.request_hash as string, orderId: r.order_id as string, providerRef: (r.provider_ref as string) ?? null } : null;
  }
  async paymentsForRef(r: string) { return (await this.get(`rental_payments?provider_ref=eq.${this.enc(r)}&order=seq`)).map((x) => this.payment(x)); }
  async refundsForRef(r: string) { return (await this.get(`rental_refunds?provider_ref=eq.${this.enc(r)}&order=seq`)).map((x) => this.refund(x)); }
  async listRefunds() { return (await this.get(`rental_refunds?order=at`)).map((x) => this.refund(x)); }
  async listJobs(ref?: string) {
    return (await this.get(`rental_jobs?select=kid,payload,sig${ref ? `&order_ref=eq.${this.enc(ref)}` : ""}&order=created_at`)) as unknown as SignedJob[];
  }
  async bayAvailability(maxAgeS: number): Promise<BayAvailability[]> {
    const rows = (await this.rpc("rental_bay_availability_read", { p_max_age_s: maxAgeS })) as Row[] | null;
    if (!Array.isArray(rows)) throw new Error("bay_read_failed");
    return rows.map((r) => ({ bay: Number(r.bay), free: r.free === true, reason: r.reason as BayReason, mrrRentedUntil: ms(r.mrr_rented_until as string), fresh: r.fresh === true }));
  }
  async rigsCommitted() { return (await this.listOrders(COMMITTED_STATES)).reduce((a, o) => a + o.rigCount, 0); }
  async rigsSoftHeld(now: number) { return (await this.get(`rental_orders?select=rig_count&state=eq.awaiting_payment&expires_at=gt.${this.enc(iso(now)!)}`)).reduce((a, r) => a + (r.rig_count as number), 0); }
  async listOrders(states: OrderState[]) { return (await this.get(`rental_orders?state=in.(${states.join(",")})`)).map((r) => this.order(r)!); }
  async recordResult(r: JobResult) {
    // The node writes results as its own role (gm_node) in production; this path is for staging tests only.
    await this.req("rental_job_results", { method: "POST", body: JSON.stringify({ job_id: r.jobId, result: r.result, reason: r.reason, delivered_th: r.deliveredTh }) });
  }
  async resultsForOrder(orderRef: string): Promise<JobResult[]> {
    const ids = (await this.get(`rental_jobs?select=job_id&order_ref=eq.${this.enc(orderRef)}`)).map((r) => r.job_id as string);
    if (!ids.length) return [];
    return (await this.get(`rental_job_results?job_id=in.(${ids.join(",")})&order=at`)).map((r) => ({
      jobId: r.job_id as string, orderRef, result: r.result as JobResult["result"], reason: (r.reason as string) ?? null,
      deliveredTh: r.delivered_th == null ? null : Number(r.delivered_th), at: ms(r.at as string)!,
    }));
  }
  async getSettlement(ref: string): Promise<X402Settlement | null> {
    const r = (await this.get(`rental_x402_settlements?provider_ref=eq.${this.enc(ref)}`))[0];
    return r ? { providerRef: ref, network: r.network as string, payer: r.payer as string, txHash: r.tx_hash as string, amountAtomic: Number(r.amount_atomic), settledAt: ms(r.settled_at as string)! } : null;
  }
  async recordSettlement(s: X402Settlement) {
    await this.rpc("rental_record_x402", { s: { provider_ref: s.providerRef, network: s.network, payer: s.payer, tx_hash: s.txHash, amount_atomic: s.amountAtomic, settled_at: iso(s.settledAt) } });
  }

  /** The pending-signature schema isn't migrated yet (PostgREST: unknown relation / function). Only then is "none" a safe answer. */
  private static notMigrated(e: unknown) { return /store_error:(404|400):(PGRST205|PGRST200|PGRST202|42P01|42883)/.test(String((e as Error)?.message ?? "")); }
  /** #103 B1: one server-side RPC (NOT EXISTS on terminal outcomes, oldest first, capped, with the total). No client-side in.() list. */
  private async pendingPage(ref: string | null, limit = PENDING_LIST_CAP): Promise<PendingPage> {
    let out: { total?: unknown; rows?: Row[] } | null;
    try { out = (await this.rpc("rental_list_unresolved_pending", { p_ref: ref, p_limit: limit })) as typeof out; }
    catch (e) {
      // N1: "not migrated" means "none" only until mainnet Solana has seen the schema; after that it fails closed.
      if (SupabaseStore.notMigrated(e) && !this.pendingSchemaRequired) return { rows: [], total: 0 };
      throw new PendingReadError();   // SF2: fail closed
    }
    const total = Number(out?.total), rows = out?.rows;
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(rows)) throw new PendingReadError();
    return { total, rows: rows.map((r) => ({
      providerRef: r.provider_ref as string, network: r.network as string, payer: r.payer as string, payerSig: r.payer_sig as string, txHash: r.tx_hash as string,
      at: ms(r.created_at as string)!, lastValidBlockHeight: r.last_valid_block_height == null ? null : String(r.last_valid_block_height),
      outcomes: (Array.isArray(r.outcomes) ? r.outcomes : []) as PendingOutcome[],
    })).filter(pendingUnresolved) };
  }
  async pendingForRef(ref: string) { return (await this.pendingPage(ref)).rows; }
  async listUnresolvedPending() { return this.pendingPage(null); }
  private pendingSchemaRequired = false;
  requirePendingSchema() { this.pendingSchemaRequired = true; }
  /** #103 S7: probe the RPC (p_limit 0 = total only). Not migrated, or any error = not ready (mainnet Solana stays off). */
  async pendingSchemaReady() {
    try { await this.rpc("rental_list_unresolved_pending", { p_ref: null, p_limit: 0 }); return true; } catch { return false; }
  }
  async recordPendingSettlement(p: X402Pending) {
    await this.rpc("rental_record_x402_pending_sig", { s: { tx_hash: p.txHash, provider_ref: p.providerRef, network: p.network, payer: p.payer, payer_sig: p.payerSig,
      last_valid_block_height: p.lastValidBlockHeight ?? null, created_at: iso(p.at) } });
  }
  async recordPendingResolution(r: PendingResolution) {
    await this.rpc("rental_record_pending_resolution", { r: { tx_hash: r.txHash, outcome: r.outcome, detail: r.detail ?? "", at: iso(r.at) } });
  }

  async commit(c: Commit) {
    await this.rpc("rental_settle", { c: this.commitBody(c) });
    return c.order ? this.getOrder(c.order.id) : null;
  }
  /** The rental_settle body for a Commit (also embedded in btc_accept_paid, btc/store.ts). */
  commitBody(c: Commit): Row {
    const body: Row = {};
    if (c.order) {
      const p = c.order.patch, patch: Row = {};
      if (p.state) patch.state = p.state;
      if (p.startsAt !== undefined) patch.starts_at = iso(p.startsAt);
      if (p.endsAt !== undefined) patch.ends_at = iso(p.endsAt);
      if (p.days !== undefined) patch.days = p.days;
      if (p.bays !== undefined) patch.bays = p.bays;
      body.order = { id: c.order.id, from_version: c.order.fromVersion, patch };
    }
    if (c.payment) {
      const x = c.payment;
      body.payment = { id: x.id, order_id: x.orderId, kind: x.kind, rail: x.rail, provider_ref: x.providerRef, seq: x.seq, delta_atomic: x.deltaAtomic,
        cumulative_atomic: x.cumulativeAtomic, expected_atomic: x.expectedAtomic, extend_days: x.extendDays, settles: x.settles, at: iso(x.at) };
    }
    if (c.refunds?.length) body.refunds = c.refunds.map((r) => ({ order_id: r.orderId, provider_ref: r.providerRef, seq: r.seq, reason: r.reason, atomic: r.atomic, rail: r.rail }));
    if (c.job) body.job = c.job;
    if (c.binding) {
      const b = c.binding.b;
      body.binding = { provider_ref: c.binding.ref, order_id: b.orderId, kind: b.kind, expected_atomic: b.expectedAtomic, extend_days: b.extendDays, expires_at: iso(b.expiresAt), challenge: b.challenge };
    }
    if (c.idem) body.idem = { key: c.idem.key, tool: c.idem.tool, request_hash: c.idem.requestHash, order_id: c.idem.orderId, provider_ref: c.idem.providerRef };
    if (c.events?.length) body.events = c.events.map((e) => ({ order_id: e.orderId, from: e.from, to: e.to, actor: e.actor }));
    if (c.alerts?.length) body.alerts = c.alerts.map((a) => ({ kind: a.kind, order_ref: a.orderRef }));
    return body;
  }
}
