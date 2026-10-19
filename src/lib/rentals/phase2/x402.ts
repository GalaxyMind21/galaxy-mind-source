/**
 * Real x402 v2 "exact" adapter (USDC, EIP-3009 transferWithAuthorization).
 * Staging: x402.org facilitator on Base Sepolia (free, no key).
 * Mainnet: CDP facilitator on Base, behind RENTALS_MAINNET_ENABLED, which this
 * build refuses (mainnetEnabled() is always false until the $1 test passes).
 *
 * Money is accepted only when ALL hold: the payload matches the challenge we
 * bound to this ref exactly (scheme, network, amount, asset, payTo and
 * extra.orderRef), the facilitator's /verify says valid, its
 * /settle says success, and (independent check) the Base RPC receipt for that
 * tx shows status 1 and a USDC Transfer to payTo for at least the amount.
 * The settlement is stored (tx hash unique) and confirmPayment() reads it via lookup().
 *
 * Solana (optional, o.solana): the SAME order and amount is also offered as x402 exact on Solana
 * (solana.ts). The binding stores every requirement; pay() picks the stored one whose network equals
 * accepted.network exactly, and each network's payTo and asset are re-checked against the pinned config.
 * The pay guard, idempotency (one settlement per ref, unique tx) and extension rules are shared.
 */
import crypto from "node:crypto";
import type { PaymentProvider, Challenge, Lookup, X402Requirements } from "./providers";
import { PendingReadError, type RentalStore, type X402Pending } from "./store";
import { mainnetEnabled } from "./flag";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { SOLANA_MAINNET, SOLANA_DEVNET, type SolanaExact, type SolanaPayload } from "./solana";
import { PAYTO_PIN_SHA256, payToProblem, payToMatchesPin, payToMismatch, type PayToPins } from "./payto-pins";
import { validTxId } from "./solana-tx";

/** EIP-55 checksum of a 20-byte hex address. */
export function toChecksum(addr: string): string {
  const a = addr.toLowerCase().replace(/^0x/, "");
  const h = Buffer.from(keccak_256(new TextEncoder().encode(a))).toString("hex");
  return "0x" + [...a].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
}

export type X402Net = { network: "eip155:84532" | "eip155:8453"; chainIdHex: string; asset: string; facilitator: string; rpc: string; env: "testnet" | "mainnet"; auth: "none" | "cdp"; eip712Name: string };
export const BASE_SEPOLIA: X402Net = { network: "eip155:84532", chainIdHex: "0x14a34", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", facilitator: "https://x402.org/facilitator", rpc: "https://sepolia.base.org", env: "testnet", auth: "none", eip712Name: "USDC" };
/** Base mainnet via the CDP facilitator. USDC address verified on-chain: src/lib/rentals/phase2/onchain/base-mainnet-usdc.json (scripts/verify-base-usdc.mjs). (JWT auth from CDP_API_KEY_ID / CDP_API_KEY_SECRET). Reachable only when mainnetEnabled(). */
export const BASE_MAINNET: X402Net = { network: "eip155:8453", chainIdHex: "0x2105", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", facilitator: "https://api.cdp.coinbase.com/platform/v2/x402", rpc: "https://mainnet.base.org", env: "mainnet", auth: "cdp", eip712Name: "USD Coin" }; // name() on-chain = "USD Coin", version 2
export const MIN_CONFIRMATIONS = 3;
/** rev 1.6: x402 networks a signed job may name: Base (0x hex tx, 0x payTo) and Solana (base58 signature, base58 payTo). Same list as the DB checks. */
/**
 * USDC job networks (signed-job schema). Rev 1.8 adds Ethereum (mainnet eip155:1, and Sepolia for staging). Rail-first:
 * an Ethereum network is valid ONLY with rail eth_usdc, and eth_usdc ONLY with an Ethereum network (ETH_JOB_NETWORKS).
 */
export const ETH_JOB_NETWORKS: ReadonlySet<string> = new Set(["eip155:1", "eip155:11155111"]);
export const X402_JOB_NETWORKS: ReadonlySet<string> = new Set([BASE_SEPOLIA.network, BASE_MAINNET.network, "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", ...ETH_JOB_NETWORKS]);

export function x402Net(env: Record<string, string | undefined> = process.env): X402Net {
  if (env.RENTALS_X402_NETWORK === "mainnet") {
    if (!mainnetEnabled(env)) throw new Error("mainnet_disabled");
    return { ...BASE_MAINNET, rpc: env.RENTALS_BASE_MAINNET_RPC || BASE_MAINNET.rpc };
  }
  return BASE_SEPOLIA;
}

/** CDP API JWT (2 min), bound to one method + host + path. Ed25519 (base64 64-byte secret) or ES256 (EC PEM). */
export function cdpJwt(keyId: string, secret: string, method: string, url: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const u = new URL(url);
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const pem = secret.includes("BEGIN");
  const header = { alg: pem ? "ES256" : "EdDSA", kid: keyId, typ: "JWT", nonce: crypto.randomBytes(16).toString("hex") };
  const claims = { sub: keyId, iss: "cdp", nbf: nowSec, exp: nowSec + 120, uris: [`${method} ${u.host}${u.pathname}`] };
  const msg = Buffer.from(`${b(header)}.${b(claims)}`);
  let sig: Buffer;
  if (pem) sig = crypto.sign("sha256", msg, { key: crypto.createPrivateKey(secret.replace(/\\n/g, "\n")), dsaEncoding: "ieee-p1363" });
  else {
    const raw = Buffer.from(secret, "base64");
    if (raw.length !== 64) throw new Error("cdp_key_format");
    const key = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw.subarray(0, 32)]), format: "der", type: "pkcs8" });
    sig = crypto.sign(null, msg, key);
  }
  return `${msg.toString()}.${sig.toString("base64url")}`;
}

/** Fixed error codes returned to payers. Facilitator text is never echoed. */
export type PayError = "unknown_ref" | "payment_expired" | "invalid_payload" | "requirements_mismatch" | "wrong_payto" | "wrong_amount" | "bad_window"
  | "verify_failed" | "settle_failed" | "facilitator_unavailable" | "onchain_check_failed" | "record_failed" | "order_not_payable" | "store_unavailable" | "no_capacity";

/** SF6: per-ref re-check cache, so polls (GET, status, lookups) can't turn into an RPC storm. */
export const RECHECK_CACHE_MS = 10_000;
const recheckCache = new Map<string, { at: number; v: Promise<boolean> }>();
/** Test hook. */
export function clearRecheckCache() { recheckCache.clear(); }
export type PendingOutcomeNow = "settled" | "lost_race" | "dropped" | "failed_onchain" | "unresolved" | "rail_off";
/** #103 S7: a "schema ready" answer is cached this long (only true is cached; false is re-probed). */
export const SCHEMA_READY_CACHE_MS = 60_000;

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const AUTH_USED_TOPIC = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5"; // AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)
const B32 = /^0x[0-9a-fA-F]{64}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
type Auth = { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string };
export type EvmPaymentPayload = { x402Version: 2; accepted: Record<string, unknown>; payload: { signature: string; authorization: Auth }; resource?: unknown; extensions?: unknown };
export type PaymentPayload = EvmPaymentPayload | SolanaPayload;
export type PayResult = { ok: true; txHash: string; payer: string; amountAtomic: number; replay: boolean; network: string } | { ok: false; error: PayError };

export class X402Provider implements PaymentProvider {
  readonly rail = "x402_usdc" as const;
  readonly network: "testnet" | "mainnet";
  /** The verified receive address (env value that passed payto-pins.ts). */
  get payTo(): string { return this.o.payTo; }
  constructor(private o: { net: X402Net; payTo: string; resourceBase: string; store: RentalStore; fetchImpl?: typeof fetch; now?: () => number; rpcDeadlineMs?: number; sleep?: (ms: number) => Promise<void>; cdp?: { keyId: string; secret: string }; payToPins?: PayToPins; solana?: SolanaExact;
    /** BTC rail hold: true = a live BTC binding holds this order, so USDC must not take money for it (fail closed on error). */
    otherRailHold?: (orderId: string) => Promise<boolean> }) {
    // payTo comes from env (payto-pins.ts evmPayToFromEnv). Exact EIP-55, non-zero, and its sha256 must equal the code pin.
    const payToBad = payToProblem("evm", o.payTo, (o.payToPins ?? PAYTO_PIN_SHA256).evm);
    if (payToBad) { payToMismatch("evm", payToBad); throw new Error("bad_payto"); }
    if (o.net.auth === "cdp" && !(o.cdp?.keyId && o.cdp?.secret)) throw new Error("cdp_credentials_missing");
    if (toChecksum(o.net.asset) !== o.net.asset) throw new Error("bad_asset_checksum");
    this.network = o.net.env;
    // #104 N1: Solana configured on MAINNET -> the pending-signature schema is required from construction, on every
    // (cold) instance: a missing schema (PGRST202 blip, rollback) is a read error, never "no pending rows", so neither a
    // Base payment nor the sweep can run over an unresolved Solana signature. Devnet and flag-off stay tolerant.
    if (o.solana?.mainnet) o.store.requirePendingSchema();
  }
  private f() { return this.o.fetchImpl ?? fetch; }
  /**
   * B7 G3: capacity guard (set by staging.ts when RENTALS_AVAIL_GATE=1). Re-checks that fresh-free bays still cover
   * the order's rigs BEFORE the facilitator is called, and again right before /settle. Any error = no capacity
   * (fail closed: no money moves; the order stays payable so the renter can retry).
   */
  private capacityGuard: ((ref: string) => Promise<boolean>) | null = null;
  setCapacityGuard(g: ((ref: string) => Promise<boolean>) | null) { this.capacityGuard = g; }
  private async capacityOk(ref: string): Promise<boolean> {
    if (!this.capacityGuard) return true;
    try { return await this.capacityGuard(ref); } catch { return false; }
  }
  private schemaOkAt: number | null = null;
  /**
   * #103 S7: Solana may take money only when its pending-signature schema (migration 20261017170000) is in place.
   * Mainnet fails closed (no Solana offer, no Solana pay) when it isn't; devnet keeps the old tolerant behaviour.
   */
  async solanaReady(): Promise<boolean> {
    const s = this.o.solana;
    if (!s) return false;
    if (!s.mainnet) return true;
    const t = this.now();
    if (this.schemaOkAt !== null && t - this.schemaOkAt >= 0 && t - this.schemaOkAt < SCHEMA_READY_CACHE_MS) return true;
    const ok = await this.o.store.pendingSchemaReady().catch(() => false);
    this.schemaOkAt = ok ? t : null;
    // N1: once seen on mainnet, a later "not migrated" answer is a read error (pending rows may exist), never "none".
    if (ok) this.o.store.requirePendingSchema();
    return ok;
  }
  /** CAIP-2 network from config (used in the PAYMENT-RESPONSE). */
  get caip2() { return this.o.net.network; }
  private now() { return (this.o.now ?? Date.now)(); }

  async create({ orderRef, amountAtomic, expiresAt }: { orderRef: string; amountAtomic: number; expiresAt: number }): Promise<Challenge> {
    const providerRef = "x402_" + crypto.randomBytes(16).toString("hex");
    const x402: X402Requirements = {
      x402Version: 2, scheme: "exact", network: this.o.net.network, asset: this.o.net.asset, amount: String(amountAtomic), payTo: this.o.payTo,
      maxTimeoutSeconds: 900, extra: { orderRef, name: this.o.net.eip712Name, version: "2" }, resource: `${this.o.resourceBase.replace(/\/$/, "")}/api/rentals/pay/${providerRef}`,
    };
    // Solana is offered only when its sponsor (facilitator feePayer) is known right now; otherwise Base only (fail closed).
    const sol = this.o.solana && (await this.solanaReady()) ? await this.o.solana.requirement(orderRef, amountAtomic, x402.resource) : null;
    return { rail: "x402_usdc", providerRef, x402, expiresAt, ...(sol ? { alts: [sol] } : {}) };
  }

  /** Stored requirements for a ref: h = the Base one (first), all = every network offered for it. */
  private async requirementsFor(ref: string) {
    const b = await this.o.store.getBinding(ref);
    const ch = b?.challenge as { http402?: X402Requirements; accepts?: X402Requirements[] } | undefined;
    const h = ch?.http402;
    if (!b || !h) return null;
    const all = [h, ...(Array.isArray(ch?.accepts) ? ch!.accepts : []).filter((x) => x && x.network !== h.network)];
    return { b, h, all };
  }
  /** A stored requirement is only honoured on a network this deployment is configured for, with that network's pinned payTo and asset. */
  private pinned(x: X402Requirements): "evm" | "svm" | null {
    if (x.network === this.o.net.network) return x.payTo === this.o.payTo && x.asset === this.o.net.asset ? "evm" : null;
    const s = this.o.solana;
    if (s && x.network === s.network) return x.payTo === s.payTo && x.asset === s.asset ? "svm" : null;
    return null;
  }
  /**
   * Review #101 S2: a RECORDED settlement is judged against the pinned constants, not against whether the
   * Solana rail is on right now. Turning the flag off must never make a paid order read as unpaid. Base: the
   * configured network, pinned payTo + asset. Solana: the Solana network paired with this deployment's Base
   * network (Base Sepolia = devnet, Base = mainnet), the pinned Solana payTo and that network's pinned USDC mint.
   */
  private pinnedSettled(x: X402Requirements): boolean {
    if (x.network === this.o.net.network) return x.payTo === this.o.payTo && x.asset === this.o.net.asset;
    const sol = this.o.net.network === BASE_MAINNET.network ? SOLANA_MAINNET : SOLANA_DEVNET;
    return x.network === sol.network && payToMatchesPin("solana", x.payTo, (this.o.payToPins ?? PAYTO_PIN_SHA256).solana) && x.asset === sol.asset;
  }

  /**
   * Re-check every UNRESOLVED pending Solana signature of a ref (saved before the on-chain check, security review #101 F2).
   * true = the ref now has a recorded settlement. Cached per ref for RECHECK_CACHE_MS (SF6) unless force.
   * Throws PendingReadError when pending rows can't be read (SF2: callers fail closed).
   */
  async recheckPending(ref: string, force = false): Promise<boolean> {
    const t = this.now(), hit = recheckCache.get(ref);
    if (!force && hit && t - hit.at >= 0 && t - hit.at < RECHECK_CACHE_MS) return hit.v;
    const v = (async () => {
      const list = await this.o.store.pendingForRef(ref);
      for (const p of list) await this.resolvePending(p);
      return !!(await this.o.store.getSettlement(ref));
    })();
    recheckCache.set(ref, { at: t, v });
    v.catch(() => recheckCache.delete(ref));
    if (recheckCache.size > 500) recheckCache.delete(recheckCache.keys().next().value as string);
    return v;
  }

  /**
   * FB1 / SF3: one pending signature. One RPC pass, no waiting:
   *  - on-chain check passes and it is (or becomes) the ref's settlement -> "settled";
   *  - passes but ANOTHER signature is the ref's settlement -> "lost_race" (money moved twice; manual review, never auto-refund);
   *  - finalized WITH an error -> "failed_onchain" (#103 S3; no token moved, the ref can take a payment again);
   *  - getSignatureStatuses(searchTransactionHistory) = null AND finalized height > lastValidBlockHeight + 150 -> "dropped"
   *    (the ref can take a payment again);
   *  - anything else -> "unresolved". Rail off -> "rail_off" (left for a person).
   */
  async resolvePending(p: X402Pending): Promise<PendingOutcomeNow> {
    const s = this.o.solana;
    if (!s || p.network !== s.network) return "rail_off";
    const r = await this.requirementsFor(p.providerRef);
    const h = r?.all.find((x) => x.network === p.network);
    if (!h || this.pinned(h) !== "svm") return "unresolved";
    const res = (outcome: "settled" | "dropped" | "lost_race" | "failed_onchain" | "manual_review", detail: string | null) =>
      this.o.store.recordPendingResolution({ txHash: p.txHash, outcome, detail, at: this.now() });
    const { amount, failed } = await s.inspectOnchain(p.txHash, h, p.payer, p.payerSig, 0);
    if (amount) {
      if (!(await this.o.store.getSettlement(p.providerRef))) {
        try { await this.o.store.recordSettlement({ providerRef: p.providerRef, network: p.network, payer: p.payer, txHash: p.txHash, amountAtomic: amount, settledAt: p.at }); }
        catch { /* a concurrent writer won; read back below */ }
      }
      const cur = await this.o.store.getSettlement(p.providerRef);
      if (cur?.txHash === p.txHash) { await res("settled", null); return "settled"; }
      if (!cur) return "unresolved";
      await res("lost_race", null); await res("manual_review", "lost_race");
      await this.outbox("refund_manual_review", h.extra.orderRef);
      return "lost_race";
    }
    if (failed) { await res("failed_onchain", null); return "failed_onchain"; }
    if ((await s.dropStatus(p.txHash, p.lastValidBlockHeight ?? null)) === "dropped") { await res("dropped", null); return "dropped"; }
    return "unresolved";
  }

  /** Alerts through the existing path: a rental_alerts outbox row (relayed to ntfy by the node). Best effort. */
  private async outbox(kind: string, orderRef: string) {
    try { await this.o.store.commit({ alerts: [{ kind, orderRef, at: this.now() }] }); } catch { /* nothing else to do */ }
  }

  /**
   * G6: re-check a RECORDED Solana settlement at finalized (e.g. after the node reported sol_maybe_paid).
   * true = verified, false = not verified, null = not a Solana settlement / rail off. Never refunds anything.
   */
  async verifySettledSolana(ref: string): Promise<boolean | null> {
    const s = this.o.solana, st = await this.o.store.getSettlement(ref);
    if (!s || !st || st.network !== s.network) return null;
    const r = await this.requirementsFor(ref);
    const h = r?.all.find((x) => x.network === st.network);
    if (!h || !this.pinnedSettled(h)) return false;
    return (await s.checkOnchain(st.txHash, h, st.payer, null, 0)) === st.amountAtomic;
  }
  /** The PaymentRequirements object the facilitator expects (no x402Version / resource inside). */
  static wire(h: X402Requirements) {
    return { scheme: h.scheme, network: h.network, amount: h.amount, asset: h.asset, payTo: h.payTo, maxTimeoutSeconds: h.maxTimeoutSeconds, extra: h.extra };
  }
  async paymentRequired(ref: string) {
    const r = await this.requirementsFor(ref);
    if (!r) return null;
    const solOk = r.all.some((x) => this.pinned(x) === "svm") ? await this.solanaReady() : false;
    const offered = r.all.filter((x) => { const k = this.pinned(x); return k === "evm" || (k === "svm" && solOk); });
    const svm = offered.some((x) => x.network.startsWith("solana:")) ? await this.o.solana!.latestBlockhash() : null;
    const accepts = offered.map((x) => {
      const w = X402Provider.wire(x);
      // Spec hint only (never compared): a fresh blockhash so the payer's wallet need not hit an RPC.
      return x.network.startsWith("solana:") && svm ? { ...w, extra: { ...w.extra, ...svm } } : w;
    });
    return { x402Version: 2, error: "PAYMENT-SIGNATURE header is required", resource: { url: r.h.resource, description: "Galaxy Mind hashrate rental " + r.h.extra.orderRef, mimeType: "application/json" }, accepts };
  }

  async lookup(ref: string): Promise<Lookup> {
    const r = await this.requirementsFor(ref);
    if (!r) return { found: false };
    let s = await this.o.store.getSettlement(ref);
    // A pending read error just means "not paid yet" here (lookups never move money).
    if (!s && (await this.recheckPending(ref).catch(() => false))) s = await this.o.store.getSettlement(ref);
    const settledOn = s ? r.all.find((x) => x.network === s!.network) : undefined;
    if (s && (!settledOn || !this.pinnedSettled(settledOn) || !validTxId(s.network, s.txHash))) return { found: true, paid: false, receivedAtomic: 0, settledAt: null, boundRef: r.h.extra.orderRef }; // fail closed
    return s
      ? { found: true, paid: true, receivedAtomic: s.amountAtomic, settledAt: s.settledAt, boundRef: r.h.extra.orderRef, txHash: s.txHash, network: s.network, payTo: settledOn!.payTo }
      : { found: true, paid: false, receivedAtomic: 0, settledAt: null, boundRef: r.h.extra.orderRef };
  }

  /**
   * Can this ref take money right now? Initial ref: its order must be
   * awaiting_payment (not cancelled/expired/refunded/paid/running).
   * Extension ref: its order must be running (delivering/active) AND its
   * rental end time must still be in the future. An active-but-not-yet-swept
   * rental whose end has passed can't take an extension: the renter would pay
   * for the gap between the old end and now (review PR #87 S1).
   * A store error counts as not payable (fail closed: no money moves).
   */
  async orderPayable(ref: string): Promise<boolean> {
    return (await this.payableState(ref)) === "payable";
  }

  /**
   * orderPayable with the store error split out (review #88 S1): "error"
   * means we could not read the order, not that it can't be paid. The pay
   * POST still fails closed (orderPayable = false); the payment-request GET
   * answers 503 so the checkout keeps a live order instead of dropping it.
   */
  async payableState(ref: string): Promise<"payable" | "not_payable" | "error"> {
    try {
      const b = await this.o.store.getBinding(ref);
      const o = b ? await this.o.store.getOrder(b.orderId) : null;
      if (!b || !o) return "not_payable";
      if (b.kind === "initial") {
        if (o.state !== "awaiting_payment" || o.rail !== "x402_usdc") return "not_payable";
        if (this.o.otherRailHold && (await this.o.otherRailHold(o.id))) return "not_payable";
        return "payable";
      }
      return (o.state === "delivering" || o.state === "active") && o.endsAt != null && this.now() < o.endsAt ? "payable" : "not_payable";
    } catch { return "error"; }
  }

  /**
   * The payment-request GET as data, so it is testable: 200 paid, 402 with the
   * PaymentRequired, 409 order_not_payable, 409 no_capacity (B7 G3: the bays were taken; nothing charged, retry later),
   * 503 store_unavailable (store read
   * failed: try again, the order may well be live), 404 unknown ref.
   */
  async requestStatus(ref: string): Promise<{ status: 200 | 404 | 409 | 503; body: Record<string, unknown> } | { status: 402; body: NonNullable<Awaited<ReturnType<X402Provider["paymentRequired"]>>> }> {
    let pr: Awaited<ReturnType<X402Provider["paymentRequired"]>>;
    try { pr = await this.paymentRequired(ref); } catch { return { status: 503, body: { error: "store_unavailable" } }; }
    if (!pr) return { status: 404, body: { error: "not_found" } };
    try { if (await this.o.store.getSettlement(ref) || (await this.recheckPending(ref))) return { status: 200, body: { status: "paid" } }; } catch { return { status: 503, body: { error: "store_unavailable" } }; }
    // A Solana payment that settled but isn't confirmed (or dropped) yet: never offer the order for payment again.
    // 503 + Retry-After keeps the page checking (requestOutcome: request_unavailable), without a pay button.
    // SF2: a pending read error is also 503 (fail closed), never a 402.
    try { if ((await this.o.store.pendingForRef(ref)).length) return { status: 503, body: { error: "payment_pending" } }; } catch { return { status: 503, body: { error: "store_unavailable" } }; }
    const st = await this.payableState(ref);
    if (st === "error") return { status: 503, body: { error: "store_unavailable" } };
    if (st === "not_payable") return { status: 409, body: { error: "order_not_payable" } };
    if (!(await this.capacityOk(ref))) return { status: 409, body: { error: "no_capacity" } };
    return { status: 402, body: pr };
  }

  /** Verify + settle one payment for one ref. Idempotent per ref. */
  async pay(ref: string, p: PaymentPayload): Promise<PayResult> {
    const r = await this.requirementsFor(ref);
    if (!r) return { ok: false, error: "unknown_ref" };
    const prior = await this.o.store.getSettlement(ref);
    if (prior) return { ok: true, txHash: prior.txHash, payer: prior.payer, amountAtomic: prior.amountAtomic, replay: true, network: prior.network };
    // A settled-but-unconfirmed Solana signature for this ref: re-check it, and never settle a second payment over it
    // until it is resolved. Once it resolves as dropped (FB1), the ref can take a payment again.
    // SF2: if pending rows can't be read, fail closed (no facilitator call).
    try {
      if ((await this.o.store.pendingForRef(ref)).length) {
        if (await this.recheckPending(ref, true)) { const s = await this.o.store.getSettlement(ref); if (s) return { ok: true, txHash: s.txHash, payer: s.payer, amountAtomic: s.amountAtomic, replay: true, network: s.network }; }
        if ((await this.o.store.pendingForRef(ref)).length) return { ok: false, error: "onchain_check_failed" };
      }
    } catch { return { ok: false, error: "store_unavailable" }; }
    // Refuse before the facilitator unless the order can take this payment,
    // and re-check right before /settle to shrink the cancel race to the settle call itself.
    if (!(await this.orderPayable(ref))) return { ok: false, error: "order_not_payable" };
    // B7 G3: the bays must still be free BEFORE any facilitator call (verify or settle).
    if (!(await this.capacityOk(ref))) return { ok: false, error: "no_capacity" };
    const { b } = r;
    // Pick the stored requirement for the network the payer chose (exact CAIP-2 match). Unknown network = mismatch.
    const net = String((p?.accepted as Record<string, unknown> | undefined)?.network ?? "");
    const h = r.all.find((x) => x.network === net);
    const kind = h ? this.pinned(h) : null;
    if (!h || !kind) return { ok: false, error: "requirements_mismatch" };
    let noCap = false;
    const guard = async () => {
      if (!(await this.orderPayable(ref))) return false;
      if (!(await this.capacityOk(ref))) { noCap = true; return false; }
      return true;
    };
    let v: { ok: true; tx: string; onchain: number; payer: string } | { ok: false; error: PayError };
    if (kind === "svm") {
      if (!(await this.solanaReady())) return { ok: false, error: "store_unavailable" };   // #103 S7: fail closed, no facilitator call
      const settleNet = h.network;
      const orderRef = h.extra.orderRef;
      v = await this.o.solana!.verifyAndSettle(h, b.expiresAt, p as SolanaPayload, guard, async (x) => {
        try { await this.o.store.recordPendingSettlement({ providerRef: ref, network: settleNet, payer: x.payer, payerSig: x.payerSig, txHash: x.tx, at: this.now(), lastValidBlockHeight: x.lastValidBlockHeight }); }
        catch { await this.outbox("solana_pending_save_failed", orderRef); }   // SF7: money moved and we couldn't save the signature
        recheckCache.delete(ref);
      });
    }
    else {
      const e = await this.verifyAndSettle(h, b.expiresAt, p as EvmPaymentPayload, guard);
      v = e.ok ? { ...e, payer: (p as EvmPaymentPayload).payload.authorization.from } : e;
    }
    if (!v.ok) return noCap && v.error === "order_not_payable" ? { ok: false, error: "no_capacity" } : v;
    const { tx, onchain, payer } = v;
    const resolve = (outcome: "settled" | "lost_race" | "manual_review", detail: string | null) =>
      kind === "svm" ? this.o.store.recordPendingResolution({ txHash: tx, outcome, detail, at: this.now() }).catch(() => {}) : Promise.resolve();
    try { await this.o.store.recordSettlement({ providerRef: ref, network: h.network, payer, txHash: tx, amountAtomic: onchain, settledAt: this.now() }); }
    catch {
      const again = await this.o.store.getSettlement(ref);
      if (again) {
        if (again.txHash !== tx && kind === "svm") {
          // SF3: a concurrent signature won this ref, and ours moved money too. Keep it on record for a person; never auto-refund.
          await resolve("lost_race", null); await resolve("manual_review", "lost_race");
          await this.outbox("refund_manual_review", h.extra.orderRef);
        } else if (again.txHash === tx) await resolve("settled", null);
        return { ok: true, txHash: again.txHash, payer: again.payer, amountAtomic: again.amountAtomic, replay: true, network: again.network };
      }
      return { ok: false, error: "record_failed" };
    }
    await resolve("settled", null);
    recheckCache.delete(ref);
    return { ok: true, txHash: tx, payer, amountAtomic: onchain, replay: false, network: h.network };
  }

  /** Exact-match checks, facilitator verify + settle, then the independent on-chain check. No storage. */
  async verifyAndSettle(h: X402Requirements, expiresAt: number, p: EvmPaymentPayload, beforeSettle?: () => Promise<boolean>): Promise<{ ok: true; tx: string; onchain: number } | { ok: false; error: PayError }> {
    const nowS = Math.floor(this.now() / 1000);
    if (h.network !== this.o.net.network) return { ok: false, error: "requirements_mismatch" };
    if (this.now() > expiresAt) return { ok: false, error: "payment_expired" };
    const a = p?.payload?.authorization, acc = p?.accepted ?? {};
    if (p?.x402Version !== 2 || !a || typeof p.payload.signature !== "string") return { ok: false, error: "invalid_payload" };
    const want = X402Provider.wire(h) as Record<string, unknown>;
    for (const k of ["scheme", "network", "amount", "asset", "payTo"]) if (String(acc[k] ?? "").toLowerCase() !== String(want[k]).toLowerCase()) return { ok: false, error: "requirements_mismatch" };
    // Bind the payload to THIS order (review PR #87 S2): accepted.extra.orderRef must equal the
    // orderRef in the challenge we stored for this ref, exactly (case-sensitive). Without it, a payload
    // built for one order could be posted to another order's ref with the same amount.
    const accRef = (acc.extra as Record<string, unknown> | undefined)?.orderRef;
    if (typeof h.extra?.orderRef !== "string" || !h.extra.orderRef || accRef !== h.extra.orderRef) return { ok: false, error: "requirements_mismatch" };
    if (!ADDR.test(a.from) || !B32.test(String(a.nonce)) || a.to?.toLowerCase() !== h.payTo.toLowerCase()) return { ok: false, error: a.to?.toLowerCase() !== h.payTo.toLowerCase() ? "wrong_payto" : "invalid_payload" };
    if (a.value !== h.amount) return { ok: false, error: "wrong_amount" };
    if (!(Number(a.validBefore) > nowS + 5) || Number(a.validAfter) > nowS) return { ok: false, error: "bad_window" };
    const body = JSON.stringify({ x402Version: 2, paymentPayload: p, paymentRequirements: want });
    const post = async (path: string) => {
      const url = `${this.o.net.facilitator}/${path}`;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.o.net.auth === "cdp") headers.authorization = `Bearer ${cdpJwt(this.o.cdp!.keyId, this.o.cdp!.secret, "POST", url, Math.floor(this.now() / 1000))}`;
      try {
        const res = await this.f()(url, { method: "POST", headers, body, cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return { status: res.status, j };
      } catch { return { status: 0, j: {} as Record<string, unknown> }; }
    };
    const down = (st: number) => st === 0 || st >= 500;
    const v = await post("verify");
    if (v.j.isValid !== true) return { ok: false, error: down(v.status) ? "facilitator_unavailable" : "verify_failed" };
    if (beforeSettle && !(await beforeSettle())) return { ok: false, error: "order_not_payable" };
    const s = await post("settle");
    const tx = String(s.j.transaction ?? "").toLowerCase(); // stored and signed lowercase
    if (s.j.success !== true || !/^0x[0-9a-f]{64}$/.test(tx)) return { ok: false, error: down(s.status) ? "facilitator_unavailable" : "settle_failed" };
    const onchain = await this.checkTransfer(tx, h.payTo, a);
    if (!onchain) return { ok: false, error: "onchain_check_failed" };
    return { ok: true, tx, onchain };
  }

  /**
   * Independent on-chain check, tied to THIS signed authorization. Returns the amount, or 0.
   * eth_chainId must match; receipt status 1 with >= MIN_CONFIRMATIONS; non-removed USDC logs only;
   * Transfer(from = authorization.from, to = payTo) summed with BigInt must equal authorization.value;
   * and USDC AuthorizationUsed(authorization.from, authorization.nonce) must be in the same receipt.
   * An unrelated tx that also pays payTo fails the from/value/nonce tie.
   */
  async checkTransfer(tx: string, payTo: string, a: { from: string; value: string; nonce: string }): Promise<number> {
    type Log = { address: string; topics: string[]; data: string; removed?: boolean };
    type Rc = { status: string; blockNumber: string; logs: Log[] };
    const call = async (method: string, params: unknown[]): Promise<unknown> => {
      try {
        const res = await this.f()(this.o.net.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", signal: AbortSignal.timeout(5_000) });
        return ((await res.json().catch(() => ({}))) as { result?: unknown }).result ?? null;
      } catch { return null; }
    };
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const deadline = Date.now() + (this.o.rpcDeadlineMs ?? 12_000);
    if (String(await call("eth_chainId", [])).toLowerCase() !== this.o.net.chainIdHex) return 0;
    let rc: Rc | null = null;
    for (;;) {
      rc = (await call("eth_getTransactionReceipt", [tx])) as Rc | null;
      if (rc && rc.status !== "0x1") return 0;
      if (rc?.blockNumber) {
        const head = await call("eth_blockNumber", []);
        try { if (typeof head === "string" && BigInt(head) - BigInt(rc.blockNumber) + BigInt(1) >= BigInt(MIN_CONFIRMATIONS)) break; } catch { return 0; }
      }
      if (Date.now() >= deadline) return 0;
      await sleep(1_000);
    }
    const pad = (x: string) => "0x" + x.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const asset = this.o.net.asset.toLowerCase(), from = pad(a.from), to = pad(payTo), nonce = a.nonce.toLowerCase();
    let want: bigint; try { want = BigInt(a.value); } catch { return 0; }
    let seen = BigInt(0), authUsed = false;
    for (const l of rc.logs ?? []) {
      if (l.removed === true || l.address?.toLowerCase() !== asset) continue;
      const t = (l.topics ?? []).map((x) => String(x).toLowerCase());
      if (t[0] === TRANSFER_TOPIC && t[1] === from && t[2] === to) { try { seen += BigInt(l.data); } catch { return 0; } }
      else if (t[0] === AUTH_USED_TOPIC && t[1] === from && t[2] === nonce) authUsed = true;
    }
    return authUsed && seen === want && want > BigInt(0) ? Number(seen) : 0;
  }
}
