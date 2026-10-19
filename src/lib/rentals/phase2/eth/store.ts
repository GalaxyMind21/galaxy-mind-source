/**
 * Storage for the Ethereum USDC direct-transfer rail. Mirrors migration 20261017210000_phase2_eth_usdc.sql:
 *  - rental_eth_quotes: ONE row per order (unique order_id), immutable. The tag (1..99 cents) is unique per network
 *    among quotes whose reserved_until is still in the future, allocated under an advisory lock in rental_eth_bind,
 *    which also inserts the payment binding (provider_ref eth_<32 hex>) in the same transaction.
 *  - rental_eth_claims: a customer-submitted tx hash that DID pay payTo the exact quoted amount inside the quote window
 *    but is not final yet. Keyed by tx_hash (one tx can never be claimed twice, for any order). Not money until settled.
 *  - rental_eth_claim_resolutions: append-only outcomes; one terminal outcome per tx (partial unique index).
 *  - rental_eth_unmatched (migration 20261017211000): a real USDC transfer to payTo that a customer pasted but that
 *    can't pay their quote (wrong amount, or mined outside the window). Durable record for a manual refund; keyed by
 *    tx_hash so the alert fires once per tx however often the hash is pasted.
 * Read errors throw (callers fail closed). "Not migrated" is only ever "not ready" (the rail is then not offered).
 */
import { MemoryStore, UniqueViolation } from "../store";
import { ETH_TAG_MAX, ETH_TAG_MIN, taggedAmount } from "./config";

export type EthQuote = { providerRef: string; orderId: string; network: string; payTo: string; asset: string; baseAtomic: number; tag: number; amountAtomic: number; createdAt: number; expiresAt: number; reservedUntil: number };
export type EthOutcome = "settled" | "dropped" | "failed_onchain" | "lost_race" | "alerted" | "manual_review";
export const ETH_TERMINAL: EthOutcome[] = ["settled", "dropped", "failed_onchain", "lost_race"];
export type EthClaim = { txHash: string; providerRef: string; network: string; payer: string; logIndex: number; amountAtomic: number; blockNumber: number; blockHash: string; blockTimeMs: number; at: number; outcomes?: EthOutcome[] };
export const ethUnresolved = (c: EthClaim) => !(c.outcomes ?? []).some((o) => ETH_TERMINAL.includes(o));
export const ETH_LIST_CAP = 200;
/** lastAlertAt looks back this far (longer than any alert throttle window). */
export const ETH_ALERT_LOOKBACK_MS = 2 * 60 * 60_000;
export type BindInput = { providerRef: string; orderId: string; network: string; payTo: string; asset: string; baseAtomic: number; expiresAt: number; reservedUntil: number; now: number; challenge: EthChallenge };
export type BindResult = { ok: true; quote: EthQuote; created: boolean } | { ok: false; error: "tags_exhausted" | "order_not_payable" | "payto_not_pinned" };
/** Keyed on payer + tx (the refund belongs to whoever sent that transfer); providerRef is only the first order that pasted it. */
export type EthUnmatched = { txHash: string; providerRef: string; network: string; reason: "amount_mismatch" | "outside_window"; amountAtomic: number | null; payer: string; blockNumber: number; at: number };
/** ready = 210000 + 211000; missing = no 210000 (rail absent); partial = 210000 without 211000 (alerting error); error = can't tell. */
export type EthSchemaState = "ready" | "missing" | "partial" | "error";
/** Stored as the binding's challenge. No http402 key, so the x402 provider never treats this ref as its own. */
export type EthChallenge = { rail: "eth_usdc_direct"; paymentRef: string; expiresAt: string; eth: { network: string; chainId: string; asset: string; payTo: string; orderRef: string; amount?: string; tag?: number } };

export interface EthStore {
  bind(p: BindInput): Promise<BindResult>;
  quoteForOrder(orderId: string): Promise<EthQuote | null>;
  quoteForRef(ref: string): Promise<EthQuote | null>;
  /** Insert-or-get by tx_hash. Returns the stored row, which may belong to ANOTHER ref (then the caller refuses). */
  recordClaim(c: EthClaim): Promise<EthClaim>;
  unresolvedForRef(ref: string): Promise<EthClaim[]>;
  /** The claim for this tx on ANY ref, or null. */
  claimByTx(txHash: string): Promise<EthClaim | null>;
  claimsForRef(ref: string): Promise<EthClaim[]>;
  listUnresolved(): Promise<{ rows: EthClaim[]; total: number }>;
  recordResolution(r: { txHash: string; outcome: EthOutcome; detail: string | null; at: number }): Promise<void>;
  /** Insert-or-ignore by tx_hash; inserted=false when this tx was already recorded (then don't alert again). */
  recordUnmatched(u: EthUnmatched): Promise<{ inserted: boolean }>;
  /**
   * When an alert of this kind + order_ref was last COMMITTED to the outbox (public.rental_alerts), or null if none in
   * the last ETH_ALERT_LOOKBACK_MS. The durable throttle state for repeating alerts (review #108 R3-2). Throws on a read error.
   */
  lastAlertAt(kind: string, orderRef: string): Promise<number | null>;
  schemaReady(): Promise<boolean>;
  /** "missing" = the migration isn't there (rail simply absent, e.g. prod before it ships); "error" = can't tell (fail closed). */
  schemaState(): Promise<EthSchemaState>;
}

export class MemoryEthStore implements EthStore {
  quotes = new Map<string, EthQuote>();        // by providerRef
  claims = new Map<string, EthClaim>();        // by txHash
  resolutions: { txHash: string; outcome: EthOutcome; detail: string | null; at: number }[] = [];
  unmatched = new Map<string, EthUnmatched>();  // by payer:txHash
  sightings = new Set<string>();                // txHash:providerRef (every order that pasted it)
  hardened = true;                              // migration 20261017211000 present
  readFails = false;
  migrated = true;
  /** Test hook: the SQL pin (public.rental_eth_payto_pin()). null = refuse every bind, like the SQL while unpinned. */
  sqlPin: string | null = null;
  constructor(private base: MemoryStore) {}
  private chk() { if (this.readFails) throw new Error("eth_store_read_failed"); }
  private c<T>(o: T): T { return o == null ? o : structuredClone(o); }
  private withOutcomes(c: EthClaim): EthClaim { return { ...this.c(c), outcomes: this.resolutions.filter((r) => r.txHash === c.txHash).map((r) => r.outcome) }; }
  async bind(p: BindInput): Promise<BindResult> {
    this.chk();
    const o = this.base.orders.get(p.orderId);
    const prior = [...this.quotes.values()].find((q) => q.orderId === p.orderId);
    if (prior) return { ok: true, quote: this.c(prior), created: false };
    // Mirrors the SQL: total and rail come from the locked order row, never the caller; payTo must equal the SQL pin.
    if (!o || o.state !== "awaiting_payment" || o.rail !== "x402_usdc" || !o.totalUsdcAtomic || o.totalUsdcAtomic !== p.baseAtomic) return { ok: false, error: "order_not_payable" };
    if (!this.sqlPin || p.payTo !== this.sqlPin) return { ok: false, error: "payto_not_pinned" };
    let tag = 0;
    for (let t = ETH_TAG_MIN; t <= ETH_TAG_MAX; t++) {
      const amt = taggedAmount(p.baseAtomic, t);
      if (![...this.quotes.values()].some((q) => q.network === p.network && q.amountAtomic === amt && q.reservedUntil > p.now)) { tag = t; break; }
    }
    if (!tag) return { ok: false, error: "tags_exhausted" };
    const amountAtomic = taggedAmount(p.baseAtomic, tag);
    if (this.base.bindings.has(p.providerRef)) throw new UniqueViolation("provider_ref");
    const challenge = { ...p.challenge, eth: { ...p.challenge.eth, amount: String(amountAtomic), tag } };
    this.base.bindings.set(p.providerRef, { orderId: p.orderId, kind: "initial", expectedAtomic: amountAtomic, expiresAt: p.expiresAt, extendDays: null, challenge });
    const q: EthQuote = { providerRef: p.providerRef, orderId: p.orderId, network: p.network, payTo: p.payTo, asset: p.asset, baseAtomic: p.baseAtomic, tag, amountAtomic, createdAt: p.now, expiresAt: p.expiresAt, reservedUntil: p.reservedUntil };
    this.quotes.set(p.providerRef, q);
    return { ok: true, quote: this.c(q), created: true };
  }
  async quoteForOrder(orderId: string) { this.chk(); return this.c([...this.quotes.values()].find((q) => q.orderId === orderId) ?? null); }
  async quoteForRef(ref: string) { this.chk(); return this.c(this.quotes.get(ref) ?? null); }
  async recordClaim(c: EthClaim) {
    this.chk();
    if (!this.base.bindings.has(c.providerRef)) throw new Error("unknown_ref");
    if (!this.claims.has(c.txHash)) this.claims.set(c.txHash, this.c({ ...c, outcomes: undefined }));
    return this.withOutcomes(this.claims.get(c.txHash)!);
  }
  async claimsForRef(ref: string) { this.chk(); return [...this.claims.values()].filter((c) => c.providerRef === ref).map((c) => this.withOutcomes(c)); }
  async unresolvedForRef(ref: string) { return (await this.claimsForRef(ref)).filter(ethUnresolved); }
  async claimByTx(txHash: string) { this.chk(); const c = this.claims.get(txHash); return c ? this.withOutcomes(c) : null; }
  async listUnresolved() {
    this.chk();
    // Same order as the SQL (211000): claims not yet in manual review first, then oldest first.
    const mr = (c: EthClaim) => ((c.outcomes ?? []).includes("manual_review") ? 1 : 0);
    const all = [...this.claims.values()].map((c) => this.withOutcomes(c)).filter(ethUnresolved).sort((a, b) => mr(a) - mr(b) || a.at - b.at || (a.txHash < b.txHash ? -1 : 1));
    return { rows: all.slice(0, ETH_LIST_CAP), total: all.length };
  }
  async recordResolution(r: { txHash: string; outcome: EthOutcome; detail: string | null; at: number }) {
    if (!this.claims.has(r.txHash)) throw new Error("unknown_claim");
    const mine = this.resolutions.filter((x) => x.txHash === r.txHash);
    if (mine.some((x) => x.outcome === r.outcome)) return;
    if (ETH_TERMINAL.includes(r.outcome) && mine.some((x) => ETH_TERMINAL.includes(x.outcome))) throw new Error("eth_resolution_conflict");
    this.resolutions.push({ ...r });
  }
  async recordUnmatched(u: EthUnmatched) {
    this.chk();
    this.sightings.add(`${u.txHash}:${u.providerRef}`);
    const k = `${u.payer.toLowerCase()}:${u.txHash}`;
    if (this.unmatched.has(k)) return { inserted: false };
    this.unmatched.set(k, { ...u, payer: u.payer.toLowerCase() });
    return { inserted: true };
  }
  /** Test hook: the alert-outbox read fails (the service then falls back to its in-process throttle). */
  alertReadFails = false;
  async lastAlertAt(kind: string, orderRef: string) {
    if (this.alertReadFails) throw new Error("alert_read_failed");
    const at = this.base.alerts.filter((a) => a.kind === kind && a.orderRef === orderRef).map((a) => a.at);
    return at.length ? Math.max(...at) : null;
  }
  async schemaReady() { return this.migrated && !this.readFails; }
  async schemaState(): Promise<EthSchemaState> { return !this.migrated ? "missing" : this.readFails ? "error" : !this.hardened ? "partial" : "ready"; }
}

type Row = Record<string, unknown>;
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: unknown) => Date.parse(String(s));

export class SupabaseEthStore implements EthStore {
  constructor(private url: string, private key: string, private fetchImpl: typeof fetch = fetch) { this.url = url.replace(/\/$/, ""); }
  private async req(path: string, init: RequestInit = {}): Promise<unknown> {
    const r = await this.fetchImpl(`${this.url}/rest/v1/${path}`, { ...init, cache: "no-store", headers: { apikey: this.key, authorization: `Bearer ${this.key}`, "content-type": "application/json", ...(init.headers ?? {}) } });
    const text = await r.text();
    let body: unknown = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!r.ok) {
      const code = String((body as Row | null)?.code ?? "");
      if (code === "23505") throw new UniqueViolation("eth");
      throw new Error(`store_error:${r.status}:${code}`);
    }
    return body;
  }
  private rpc(fn: string, args: unknown) { return this.req(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }); }
  private enc = encodeURIComponent;
  private quote(r: Row | undefined): EthQuote | null {
    if (!r) return null;
    return { providerRef: r.provider_ref as string, orderId: r.order_id as string, network: r.network as string, payTo: r.pay_to as string, asset: r.asset as string,
      baseAtomic: Number(r.base_atomic), tag: Number(r.tag), amountAtomic: Number(r.amount_atomic), createdAt: ms(r.created_at), expiresAt: ms(r.expires_at), reservedUntil: ms(r.reserved_until) };
  }
  private claim(r: Row): EthClaim {
    return { txHash: r.tx_hash as string, providerRef: r.provider_ref as string, network: r.network as string, payer: r.payer as string, logIndex: Number(r.log_index),
      amountAtomic: Number(r.amount_atomic), blockNumber: Number(r.block_number), blockHash: r.block_hash as string, blockTimeMs: ms(r.block_time), at: ms(r.created_at),
      outcomes: (Array.isArray(r.outcomes) ? r.outcomes : []) as EthOutcome[] };
  }
  async bind(p: BindInput): Promise<BindResult> {
    const out = (await this.rpc("rental_eth_bind", { p: { provider_ref: p.providerRef, order_id: p.orderId, network: p.network, pay_to: p.payTo, asset: p.asset,
      base_atomic: p.baseAtomic, expires_at: iso(p.expiresAt), reserved_until: iso(p.reservedUntil), challenge: p.challenge } })) as Row | null;
    if (!out || out.ok !== true) {
      const e = String(out?.error ?? "");
      if (e === "tags_exhausted" || e === "order_not_payable" || e === "payto_not_pinned") return { ok: false, error: e };
      throw new Error("eth_bind_failed");
    }
    const q = this.quote(out.quote as Row);
    if (!q) throw new Error("eth_bind_failed");
    return { ok: true, quote: q, created: out.created === true };
  }
  async quoteForOrder(orderId: string) { return this.quote(((await this.req(`rental_eth_quotes?order_id=eq.${this.enc(orderId)}`)) as Row[])[0]); }
  async quoteForRef(ref: string) { return this.quote(((await this.req(`rental_eth_quotes?provider_ref=eq.${this.enc(ref)}`)) as Row[])[0]); }
  async recordClaim(c: EthClaim) {
    const out = (await this.rpc("rental_eth_record_claim", { c: { tx_hash: c.txHash, provider_ref: c.providerRef, network: c.network, payer: c.payer, log_index: c.logIndex,
      amount_atomic: c.amountAtomic, block_number: c.blockNumber, block_hash: c.blockHash, block_time: iso(c.blockTimeMs), created_at: iso(c.at) } })) as Row | null;
    if (!out || !out.claim) throw new Error("eth_claim_failed");
    return this.claim(out.claim as Row);
  }
  private async page(ref: string | null, all: boolean, limit = ETH_LIST_CAP): Promise<{ rows: EthClaim[]; total: number }> {
    const out = (await this.rpc("rental_eth_list_claims", { p_ref: ref, p_limit: limit, p_all: all })) as { total?: unknown; rows?: Row[] } | null;
    const total = Number(out?.total), rows = out?.rows;
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(rows)) throw new Error("eth_store_read_failed");
    return { total, rows: rows.map((r) => this.claim(r)) };
  }
  async claimsForRef(ref: string) { return (await this.page(ref, true)).rows; }
  async unresolvedForRef(ref: string) { return (await this.page(ref, false)).rows.filter(ethUnresolved); }
  async claimByTx(txHash: string) {
    const r = ((await this.req(`rental_eth_claims?tx_hash=eq.${this.enc(txHash)}&select=*`)) as Row[])[0];
    return r ? this.claim(r) : null;
  }
  async listUnresolved() { const p = await this.page(null, false); return { rows: p.rows.filter(ethUnresolved), total: p.total }; }
  async recordResolution(r: { txHash: string; outcome: EthOutcome; detail: string | null; at: number }) {
    await this.rpc("rental_eth_record_resolution", { r: { tx_hash: r.txHash, outcome: r.outcome, detail: r.detail ?? "", at: iso(r.at) } });
  }
  async recordUnmatched(u: EthUnmatched) {
    const out = (await this.rpc("rental_eth_record_unmatched", { u: { tx_hash: u.txHash, provider_ref: u.providerRef, network: u.network, reason: u.reason,
      amount_atomic: u.amountAtomic, payer: u.payer, block_number: u.blockNumber, created_at: iso(u.at) } })) as Row | null;
    if (!out || typeof out.inserted !== "boolean") throw new Error("eth_unmatched_failed");
    return { inserted: out.inserted };
  }
  async lastAlertAt(kind: string, orderRef: string) {
    // Service-role read of the outbox (same table the alert forwarder drains); no schema change needed.
    const since = iso(Date.now() - ETH_ALERT_LOOKBACK_MS);
    const rows = (await this.req(`rental_alerts?kind=eq.${this.enc(kind)}&order_ref=eq.${this.enc(orderRef)}&at=gte.${this.enc(since)}&select=at&order=at.desc&limit=1`)) as Row[] | null;
    if (!Array.isArray(rows)) throw new Error("alert_read_failed");
    const t = rows[0] ? ms(rows[0].at) : NaN;
    return Number.isFinite(t) ? t : null;
  }
  async schemaReady() { return (await this.schemaState()) === "ready"; }
  async schemaState(): Promise<EthSchemaState> {
    // PostgREST: PGRST202 = function not found; 404 likewise. Anything else: can't tell.
    const absent = (e: unknown) => /:404:|:PGRST202$|:42883$/.test(String((e as Error)?.message ?? ""));
    // 210000 decides "missing" (the rail simply isn't migrated here)...
    try { await this.rpc("rental_eth_list_claims", { p_ref: null, p_limit: 0, p_all: false }); }
    catch (e) { return absent(e) ? "missing" : "error"; }
    // ...and with 210000 present, a missing 211000 is a half-applied schema: an alerting error, never "missing".
    try { await this.rpc("rental_eth_record_unmatched", { u: null }); return "ready"; }
    catch (e) { return absent(e) ? "partial" : "error"; }
  }
}
