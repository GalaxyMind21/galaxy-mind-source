/**
 * Ethereum USDC direct-transfer rail · service. Human checkout only (v1).
 *
 * Binding (why both a unique amount AND the tx hash):
 *  - Each order that picks Ethereum gets ONE quote: its USDC price plus a tag of 1..99 cents, unique per network among
 *    all quotes still reserved (pay window + 2 h). The customer sends exactly that amount to payTo.
 *  - The customer then pastes the tx hash. We accept a hash for an order only if that tx contains exactly one USDC
 *    Transfer to payTo for EXACTLY that order's tagged amount, mined inside that quote's window.
 *  - Hash alone would let anyone who watches the chain claim someone else's payment for their own order of the same
 *    price. Amount alone would mean scanning logs (eth_getLogs range limits) and guessing when two orders share a price.
 *    Together: a hash can only ever match the one order whose tagged amount and window it fits, so a front-runner gains
 *    nothing, and the tx hash is unique (DB primary key on claims, UNIQUE on settlements), so one transfer can never
 *    pay two orders and a replayed hash just returns the first answer.
 * Confirmation: settled only when the block is at or below "finalized" AND >= 12 deep (~13-15 min). Until then the
 * claim is durable (rental_eth_claims) and re-checked on every status poll and every sweep.
 * Refunds are NEVER sent automatically: confirmPayment writes pending_owner rows exactly as for Base/Solana. The payer of
 * an Ethereum transfer may be an exchange hot wallet, so a manual refund must confirm the address with the customer.
 */
import crypto from "node:crypto";
import { assertCustomerSafe } from "../../index";
import { confirmPayment, getRental, orderCapacity, type Deps } from "../service";
import { validTxId } from "../solana-tx";
import type { Lookup } from "../providers";
import type { Order } from "../types";
import type { RentalStore } from "../store";
import {
  ETH_CLAIM_GRACE_MS, ETH_CLOCK_SKEW_MS, ETH_HOLD_MAX_MS, ETH_MIN_CONFIRMATIONS, ETH_MIN_WINDOW_MS, ETH_RECHECK_CACHE_MS, ETH_RESERVE_AFTER_MS, ETH_STUCK_MS,
  ethConfig, ethNetFor, isEthRef, usdc2, usdc6, validPayTo, type EthConfig, type EthNet,
} from "./config";
import { canonicalAt, inspectEthTx, normTxHash, withDeadline, type Rpc } from "./verify";
import type { EthChallenge, EthClaim, EthQuote, EthSchemaState, EthStore } from "./store";

/**
 * cfg = the money side (new quotes): flag + pin + payTo + RPC, else null.
 * net + rpc = the READ side (resolve recorded claims, sweep hold): present whenever an allowlisted RPC is configured,
 * even with the flag off, so switching the rail off never strands a claim that is still confirming.
 * pin = the env address that passed the sha256 pin (ethPinFromEnv; tests inject the hash or the deps). Every quote, claim and settlement must pay exactly this address.
 */
export type EthDeps = { store: EthStore; cfg: EthConfig | null; net: EthNet | null; rpc: Rpc | null; pin: string | null; pinHistory?: readonly string[]; now: () => number };
/** The CURRENT pin: the only address a new quote may use. */
const pinned = (e: EthDeps, payTo: string | undefined) => validPayTo(e.pin) && payTo === e.pin;
/** Current pin or a historical one (ETH_PAYTO_HISTORY): existing quotes, claims and settlements keep resolving after a rotation. */
const knownPayTo = (e: EthDeps, payTo: string | undefined) => pinned(e, payTo) || (!!payTo && validPayTo(payTo) && (e.pinHistory ?? []).includes(payTo));
type Err = { ok: false; error: string };
const err = (error: string): Err => ({ ok: false, error });

export type EthOffer = { network: string; name: string; chainIdHex: string; explorer: string; testnet: boolean; payTo: string; asset: string };
let schemaAt: { at: number; s: EthSchemaState } | null = null;
/** Test hook. */
export function resetEthCaches() { schemaAt = null; recheck.clear(); alertMem.clear(); }
/** Schema state (migrations 20261017210000 + 20261017211000), cached 60 s when known; "error" is never cached. */
async function schemaState(e: EthDeps): Promise<EthSchemaState> {
  const t = e.now();
  if (schemaAt && t - schemaAt.at >= 0 && t - schemaAt.at < 60_000) return schemaAt.s;
  const s = await e.store.schemaState().catch(() => "error" as const);
  schemaAt = s === "ready" || s === "missing" ? { at: t, s } : null;
  return s;
}
/** The page offers Ethereum only when the rail is configured AND its schema is readable. */
export async function ethOffer(e: EthDeps | null): Promise<EthOffer | null> {
  if (!e?.cfg || !pinned(e, e.cfg.payTo)) return null;
  if ((await schemaState(e)) !== "ready") return null;
  const n = e.cfg.net;
  return { network: n.network, name: n.name, chainIdHex: n.chainIdHex, explorer: n.explorer, testnet: n.testnet, payTo: e.cfg.payTo, asset: n.asset };
}

/** Owner check: rental_id + creator_secret (getRental charges the per-rental limiter). */
async function own(d: Deps, input: { rental_id?: unknown; creator_secret?: unknown }): Promise<{ ok: true; o: Order } | Err> {
  if (typeof input.creator_secret !== "string" || !input.creator_secret) return err("not_found");
  const r = await getRental(d, { rental_id: input.rental_id, creator_secret: input.creator_secret });
  if (!r.ok) return err(r.error);
  if (!("rigs" in (r.result as object))) return err("not_found");
  const o = await d.store.getOrderByPublicId((r.result as { rentalId: string }).rentalId);
  return o ? { ok: true, o } : err("not_found");
}

export type QuoteView = { paymentRef: string; network: string; name: string; chainIdHex: string; asset: string; payTo: string; amountAtomic: string; amountUsdc: string; amountUsdc6: string; priceUsdc: string; tagUsdc: string; payBy: string; explorer: string; testnet: boolean };
function quoteView(q: EthQuote, o: Order): QuoteView | null {
  const n = ethNetFor(q.network);
  if (!n) return null;
  return assertCustomerSafe({
    paymentRef: q.providerRef, network: n.network, name: n.name, chainIdHex: n.chainIdHex, asset: n.asset, payTo: q.payTo,
    amountAtomic: String(q.amountAtomic), amountUsdc: usdc2(q.amountAtomic), amountUsdc6: usdc6(q.amountAtomic),
    priceUsdc: usdc2(q.baseAtomic), tagUsdc: usdc2(q.amountAtomic - q.baseAtomic), payBy: new Date(o.expiresAt).toISOString(), explorer: n.explorer, testnet: n.testnet,
  });
}

/** Pick Ethereum for an unpaid order: reserve its tagged amount (idempotent: one quote per order). */
/**
 * opts.charge runs ONLY when a new quote is about to be created (after the owner check, the existing-quote return and
 * the payable checks), so junk requests and remounts can't burn the bind limiter (review #108 B3).
 */
export async function bindEth(d: Deps, e: EthDeps, input: { rental_id?: unknown; creator_secret?: unknown }, opts: { charge?: () => Promise<Err | null> } = {}): Promise<{ ok: true; quote: QuoteView } | Err> {
  if (!e.cfg || !(await ethOffer(e))) return err("rail_unavailable");
  try { if (await d.killSwitch()) return err("rentals_paused"); } catch { return err("rentals_paused"); }
  const m = await own(d, input);
  if (!m.ok) return m;
  const o = m.o, now = e.now();
  const prior = await e.store.quoteForOrder(o.id);
  if (prior) { const v = quoteView(prior, o); return v ? { ok: true, quote: v } : err("rail_unavailable"); }
  if (o.state !== "awaiting_payment" || o.rail !== "x402_usdc" || !o.totalUsdcAtomic || o.totalUsdcAtomic <= 0) return err("not_payable");
  // Money already settled, or a Solana payment still confirming, on another ref (e.g. Base): never offer a second way to pay.
  for (const ref of await d.store.refsForOrder(o.id)) {
    if (await d.store.getSettlement(ref)) return err("not_payable");
    if ((await d.store.pendingForRef(ref)).length) return err("payment_pending");
  }
  // BTC and ETH are mutually exclusive (review #108): a live BTC binding owns this order (read error = fail closed).
  if (d.btc) { try { if (await d.btc.store.hasLiveBinding(o.id)) return err("not_payable"); } catch { return err("not_payable"); } }
  if (o.expiresAt - now < ETH_MIN_WINDOW_MS) return err("window_too_short");
  // B7 G3 (gate on): the same capacity rule as an x402 payment, before the customer is shown an address to pay.
  if ((await orderCapacity(d, o)) !== "ok") return err("no_capacity");
  if (opts.charge) { const c = await opts.charge(); if (c) return c; }
  const providerRef = "eth_" + crypto.randomBytes(16).toString("hex");
  const n = e.cfg.net;
  const challenge: EthChallenge = { rail: "eth_usdc_direct", paymentRef: providerRef, expiresAt: new Date(o.expiresAt).toISOString(),
    eth: { network: n.network, chainId: n.chainIdHex, asset: n.asset, payTo: e.cfg.payTo, orderRef: o.publicId } };
  const r = await e.store.bind({ providerRef, orderId: o.id, network: n.network, payTo: e.cfg.payTo, asset: n.asset, baseAtomic: o.totalUsdcAtomic,
    expiresAt: o.expiresAt, reservedUntil: o.expiresAt + ETH_RESERVE_AFTER_MS, now, challenge });
  if (!r.ok) return err(r.error === "tags_exhausted" ? "rail_busy" : r.error === "payto_not_pinned" ? "rail_unavailable" : "not_payable");
  const v = quoteView(r.quote, o);
  return v ? { ok: true, quote: v } : err("rail_unavailable");
}

export type ClaimState = "not_seen_yet" | "checking" | "confirming" | "settled" | "dropped" | "failed_onchain" | "lost_race";
export type EthStatus = { rentalId: string; status: string; quote: QuoteView | null; claim: { txHash: string; state: ClaimState; confirmations?: number } | null };

const outcomeState = (c: EthClaim): ClaimState => {
  const o = c.outcomes ?? [];
  return o.includes("settled") ? "settled" : o.includes("lost_race") ? "lost_race" : o.includes("dropped") ? "dropped" : o.includes("failed_onchain") ? "failed_onchain" : "confirming";
};

/**
 * Write one alert to the outbox (rental_alerts) and push it. Returns true only when the outbox write COMMITTED
 * (review #108 R3-1): the push is best effort, but a caller that must not go silent (terminal()) checks this.
 */
async function outbox(d: Deps, kind: string, orderRef: string): Promise<boolean> {
  const a = { kind, orderRef, at: d.now() };
  let committed = false;
  try { await d.store.commit({ alerts: [a] }); committed = true; } catch { /* reported to the caller */ }
  try { await d.alerter?.send(a); } catch { /* best effort */ }
  return committed;
}

/** Repeating alerts (schema incomplete, sweep backlog, a terminal write that keeps failing) fire about once per hour per key. */
export const ETH_ALERT_THROTTLE_MS = 60 * 60_000;
/** In-process fallback, used only when the durable read (rental_alerts) fails. Set only after a committed write. */
const alertMem = new Map<string, number>();
/**
 * Throttled outbox (review #108 R3-2). The throttle state is the outbox itself: an alert of the same kind + orderRef
 * COMMITTED to rental_alerts within the last hour (EthStore.lastAlertAt) means "already told", across instances and
 * restarts, and only a committed alert ever counts, so R3-1 holds (a failed write never suppresses the next try).
 * If that read fails, the in-process map decides; if neither knows, the alert goes out (alerts fail open).
 * orderRef "unknown" is never throttled (it can't tell two orders apart).
 */
async function throttledOutbox(d: Deps, e: EthDeps, kind: string, orderRef: string): Promise<"sent" | "throttled" | "failed"> {
  if (orderRef !== "unknown") {
    const t = d.now(), k = `${kind}|${orderRef}`;
    const last = await e.store.lastAlertAt(kind, orderRef).catch(() => null);
    const recent = (x: number | null | undefined) => x != null && t - x >= 0 && t - x < ETH_ALERT_THROTTLE_MS;
    if (recent(last) || recent(alertMem.get(k))) return "throttled";
    const ok = await outbox(d, kind, orderRef);
    if (ok) { alertMem.set(k, t); if (alertMem.size > 500) alertMem.delete(alertMem.keys().next().value as string); }
    return ok ? "sent" : "failed";
  }
  return (await outbox(d, kind, orderRef)) ? "sent" : "failed";
}

/**
 * One claim, one RPC pass, no waiting. settled -> the ref's settlement is recorded (settledAt = BLOCK time, so an
 * on-time payment that finalizes after the window is still on time) and the caller confirms the order.
 */
export async function resolveClaim(d: Deps, e: EthDeps, c: EthClaim): Promise<"settled" | "lost_race" | "dropped" | "failed_onchain" | "unresolved" | "rail_off"> {
  if (!e.net || !e.rpc || c.network !== e.net.network) return "rail_off";
  const q = await e.store.quoteForRef(c.providerRef);
  if (!q || q.network !== c.network) return "unresolved";
  // A quote whose payTo is not the pinned address is never money (B2): a person looks at it (sweep alerts on rail_off).
  if (!knownPayTo(e, q.payTo)) return "rail_off";
  const res = (outcome: "settled" | "dropped" | "failed_onchain" | "lost_race" | "manual_review" | "alerted", detail: string | null) =>
    e.store.recordResolution({ txHash: c.txHash, outcome, detail, at: e.now() });
  // Every non-settled terminal outcome: manual_review + alerted + the outbox alert FIRST, the terminal outcome LAST
  // (review #108 SF-A). A failure part-way leaves the claim unresolved but already flagged and alerted, so it is
  // retried next sweep; it can never end terminal and silent. Nothing is refunded automatically.
  // R3-1: if the outbox write did not commit, throw BEFORE the terminal write (the claim stays unresolved, retried).
  // R3-2: a terminal write that keeps failing re-alerts at most about once an hour ("throttled" = an alert for this
  // kind + order already committed within the hour, so the terminal write may proceed).
  const terminal = async (outcome: "dropped" | "failed_onchain" | "lost_race", detail: string, kind = "eth_claim_failed") => {
    await res("manual_review", detail); await res("alerted", detail);
    const o = await d.store.getOrder(q.orderId).catch(() => null);
    if ((await throttledOutbox(d, e, kind, o?.publicId ?? "unknown")) === "failed") throw new Error("eth_alert_write_failed");
    await res(outcome, detail);
  };
  const seen = await inspectEthTx(e.rpc, c.txHash, { net: e.net, payTo: q.payTo, amountAtomic: q.amountAtomic });
  if (seen.kind === "match") {
    if (!seen.final) return "unresolved";
    if (seen.blockTimeMs < q.createdAt - ETH_CLOCK_SKEW_MS || seen.blockTimeMs > q.reservedUntil) { await terminal("failed_onchain", "outside_window"); return "failed_onchain"; }
    if (!(await d.store.getSettlement(c.providerRef))) {
      try { await d.store.recordSettlement({ providerRef: c.providerRef, network: c.network, payer: seen.payer, txHash: c.txHash, amountAtomic: seen.amountAtomic, settledAt: seen.blockTimeMs }); }
      catch { /* a concurrent writer won, or the tx is someone else's settlement: read back */ }
    }
    const cur = await d.store.getSettlement(c.providerRef);
    if (cur?.txHash === c.txHash) { await res("settled", null); return "settled"; }
    if (!cur) return "unresolved";
    // Another tx is already this ref's settlement and this one paid too: money moved twice. A person decides; never auto-refund.
    await terminal("lost_race", "lost_race", "refund_manual_review");
    return "lost_race";
  }
  // Negatives on a claim that already matched once are terminal ONLY with finality behind them (review #108 B1).
  // A single empty/odd answer from a lagging or load-balanced provider (no receipt, no status, no logs) stays unresolved;
  // the sweep alerts on it at ETH_STUCK_MS.
  if (seen.kind === "reverted" && seen.final) { await terminal("failed_onchain", "reverted"); return "failed_onchain"; }
  if (seen.kind === "not_found") {
    // The claim's block was finalized and the canonical block at that height is now a different one: the tx is not in
    // the finalized chain where we saw it. Terminal (dropped), for a person to check.
    const at = await canonicalAt(e.rpc, e.net, c.blockNumber);
    if (at && at.finalized && at.confirmations >= ETH_MIN_CONFIRMATIONS && at.hash !== c.blockHash.toLowerCase()) { await terminal("dropped", "reorged_out"); return "dropped"; }
  }
  return "unresolved";
}

const recheck = new Map<string, { at: number; v: Promise<void> }>();
/**
 * Re-check every unresolved claim of a ref (cached per ref). Records outcomes only; it never confirms the order itself
 * (lookup() calls this from inside confirmPayment). Callers that may confirm use confirmIfSettled afterwards.
 */
async function recheckRef(d: Deps, e: EthDeps, ref: string, force = false): Promise<void> {
  const t = e.now(), hit = recheck.get(ref);
  if (!force && hit && t - hit.at >= 0 && t - hit.at < ETH_RECHECK_CACHE_MS) return hit.v;
  const v = (async () => {
    for (const c of await e.store.unresolvedForRef(ref)) await resolveClaim(d, e, c).catch(() => "unresolved" as const);
  })();
  recheck.set(ref, { at: t, v });
  v.catch(() => recheck.delete(ref));
  if (recheck.size > 500) recheck.delete(recheck.keys().next().value as string);
  return v;
}
/** A recorded settlement on an order still awaiting payment: run the normal confirm (idempotent; it decides settle/late/refund). */
async function confirmIfSettled(d: Deps, ref: string, orderId: string) {
  try {
    const o = await d.store.getOrder(orderId);
    if (o && (o.state === "awaiting_payment" || o.state === "expired") && (await d.store.getSettlement(ref))) await confirmPayment(d, ref);
  } catch { /* the sweep retries */ }
}

/** The customer pastes their tx hash. Idempotent per tx; a tx already claimed for another order is refused. */
export async function claimEth(d: Deps, e: EthDeps, input: { rental_id?: unknown; creator_secret?: unknown; tx_hash?: unknown }): Promise<{ ok: true; result: EthStatus } | Err> {
  const tx = normTxHash(input.tx_hash);
  if (!tx) return err("invalid_tx_hash");
  const m = await own(d, input);
  if (!m.ok) return m;
  const o = m.o;
  const q = await e.store.quoteForOrder(o.id);
  if (!q) return err("no_quote");
  // Claims ride the READ side: a customer who already has a quote can still claim after the rail is switched off.
  if (!e.net || !e.rpc || q.network !== e.net.network || !knownPayTo(e, q.payTo)) return err("rail_unavailable");
  // Same tx already claimed on this order: just report (and re-check).
  const mine = (await e.store.claimsForRef(q.providerRef)).find((c) => c.txHash === tx);
  if (!mine) {
    // A tx already claimed for another order: refuse before touching the chain (and never record it as "unmatched" here).
    let other: EthClaim | null;
    try { other = await e.store.claimByTx(tx); } catch { return err("store_unavailable"); }
    if (other && other.providerRef !== q.providerRef) return err("tx_already_used");
    const seen = await inspectEthTx(e.rpc, tx, { net: e.net, payTo: q.payTo, amountAtomic: q.amountAtomic });
    if (seen.kind === "rpc_error" || seen.kind === "unstable") return { ok: true, result: await statusOf(d, e, o, q, { txHash: tx, state: "checking" }) };
    if (seen.kind === "not_found") return { ok: true, result: await statusOf(d, e, o, q, { txHash: tx, state: "not_seen_yet" }) };
    if (seen.kind === "reverted") return err("tx_failed");
    if (seen.kind === "no_match") {
      // A real transfer to payTo with the wrong amount: money arrived but can't be matched. Durable record + one alert per tx.
      if (seen.reason === "amount_mismatch") {
        if (!(await unmatched(d, e, o, q, { txHash: tx, reason: "amount_mismatch", amountAtomic: seen.amountAtomic ?? null, payer: seen.payer, blockNumber: seen.blockNumber }))) return err("store_unavailable");
        return err("amount_mismatch");
      }
      return err("no_matching_transfer");
    }
    if (seen.blockTimeMs < q.createdAt - ETH_CLOCK_SKEW_MS) return err("tx_before_quote");
    if (seen.blockTimeMs > q.reservedUntil) {
      if (!(await unmatched(d, e, o, q, { txHash: tx, reason: "outside_window", amountAtomic: seen.amountAtomic, payer: seen.payer, blockNumber: seen.blockNumber }))) return err("store_unavailable");
      return err("outside_window");
    }
    let row: EthClaim;
    try {
      row = await e.store.recordClaim({ txHash: tx, providerRef: q.providerRef, network: q.network, payer: seen.payer, logIndex: seen.logIndex, amountAtomic: seen.amountAtomic,
        blockNumber: seen.blockNumber, blockHash: seen.blockHash, blockTimeMs: seen.blockTimeMs, at: e.now() });
    } catch { return err("store_unavailable"); }
    if (row.providerRef !== q.providerRef) return err("tx_already_used");
  }
  await recheckRef(d, e, q.providerRef, true).catch(() => null);
  await confirmIfSettled(d, q.providerRef, o.id);
  return { ok: true, result: await statusOf(d, e, o, q, null, tx) };
}

/** Record a real-but-unmatchable transfer once per tx (rental_eth_unmatched) and alert only on the first record. false = store error. */
async function unmatched(d: Deps, e: EthDeps, o: Order, q: EthQuote, u: { txHash: string; reason: "amount_mismatch" | "outside_window"; amountAtomic: number | null; payer: string; blockNumber: number }): Promise<boolean> {
  let r: { inserted: boolean };
  try { r = await e.store.recordUnmatched({ ...u, providerRef: q.providerRef, network: q.network, at: e.now() }); } catch { return false; }
  if (r.inserted) await outbox(d, u.reason === "amount_mismatch" ? "eth_amount_mismatch" : "eth_outside_window", o.publicId);
  return true;
}

async function statusOf(d: Deps, e: EthDeps, o: Order, q: EthQuote, override: EthStatus["claim"], tx?: string): Promise<EthStatus> {
  const fresh = (await d.store.getOrder(o.id).catch(() => null)) ?? o;
  let claim = override;
  if (!claim) {
    const all = await e.store.claimsForRef(q.providerRef).catch(() => [] as EthClaim[]);
    const c = (tx ? all.find((x) => x.txHash === tx) : undefined) ?? all.find((x) => outcomeState(x) === "settled") ?? all.find((x) => outcomeState(x) === "confirming") ?? all[all.length - 1];
    if (c) claim = { txHash: c.txHash, state: outcomeState(c) };
  }
  return { rentalId: fresh.publicId, status: fresh.state, quote: quoteView(q, fresh), claim };
}

/** Status poll for the page: re-checks unresolved claims (cached 10 s per ref), then reports. Read-only otherwise. */
export async function statusEth(d: Deps, e: EthDeps, input: { rental_id?: unknown; creator_secret?: unknown }): Promise<{ ok: true; result: EthStatus } | Err> {
  const m = await own(d, input);
  if (!m.ok) return m;
  const q = await e.store.quoteForOrder(m.o.id);
  if (!q) return { ok: true, result: { rentalId: m.o.publicId, status: m.o.state, quote: null, claim: null } };
  if (e.rpc) await recheckRef(d, e, q.providerRef).catch(() => null);
  await confirmIfSettled(d, q.providerRef, m.o.id);
  return { ok: true, result: await statusOf(d, e, m.o, q, null) };
}

/**
 * Lookup for eth_ refs (installed on the x402 provider for refs that match ETH_REF_RE). A RECORDED settlement is judged
 * against the stored quote (server-written payTo, pinned USDC for that network), never against whether the rail is on
 * now: turning the flag off must never make a paid order read as unpaid.
 */
export async function ethLookup(store: RentalStore, d: Deps | null, e: EthDeps | null, ref: string): Promise<Lookup> {
  if (!isEthRef(ref)) return { found: false };
  const b = await store.getBinding(ref);
  const ch = (b?.challenge as EthChallenge | undefined)?.eth;
  if (!b || !ch || typeof ch.orderRef !== "string") return { found: false };
  let s = await store.getSettlement(ref);
  if (!s && d && e?.rpc) { await recheckRef(d, e, ref).catch(() => null); s = await store.getSettlement(ref); }
  const n = ethNetFor(ch.network);
  const unpaid: Lookup = { found: true, paid: false, receivedAtomic: 0, settledAt: null, boundRef: ch.orderRef };
  if (!s) return unpaid;
  // payTo must be the PINNED address (B2): an env edit or a forged binding can never make a payment elsewhere read as paid.
  if (!e || !knownPayTo(e, ch.payTo)) return unpaid;
  if (!n || s.network !== n.network || ch.asset !== n.asset || !validTxId(s.network, s.txHash)) return unpaid;   // fail closed
  return { found: true, paid: true, receivedAtomic: s.amountAtomic, settledAt: s.settledAt, boundRef: ch.orderRef, txHash: s.txHash, network: s.network, payTo: ch.payTo };
}

/**
 * Sweep hook (Deps.expiryHold): keep an unpaid order open past its pay window while
 *  - its Ethereum quote exists and we are within ETH_CLAIM_GRACE_MS of the window (the customer may still paste the hash), or
 *  - it has an unresolved claim (finality takes ~13-15 min), up to ETH_HOLD_MAX_MS.
 * A read error holds too (fail closed: never expire an order whose payment we can't see), still capped at ETH_HOLD_MAX_MS.
 */
export async function ethExpiryHold(e: EthDeps, o: Order): Promise<boolean> {
  const t = e.now();
  if (o.state !== "awaiting_payment" || t >= o.expiresAt + ETH_HOLD_MAX_MS) return false;
  const st = await schemaState(e);
  if (st === "missing") return false;   // rail not migrated here (e.g. prod before it ships): nothing to hold for
  if (st !== "ready") return true;      // error / half-applied schema: fail closed (capped)
  try {
    const q = await e.store.quoteForOrder(o.id);
    if (!q) return false;
    if (t < o.expiresAt + ETH_CLAIM_GRACE_MS) return true;
    return (await e.store.unresolvedForRef(q.providerRef)).length > 0;
  } catch { return true; }
}

/** Sweep: re-check every unresolved claim (oldest first, time-budgeted); stuck ones alert once and go to manual review. */
export async function sweepEth(d: Deps, e0: EthDeps, opts: { budgetMs?: number; clock?: () => number } = {}): Promise<{ checked: number; settled: number; alerted: number; total: number }> {
  const out = { checked: 0, settled: 0, alerted: 0, total: 0 };
  const clock = opts.clock ?? Date.now, t0 = clock(), budget = opts.budgetMs ?? 10_000;
  const st = await schemaState(e0);
  if (st === "missing") return out;
  // 210000 without 211000 (or an unreadable schema): a person must look; claims are still swept with what exists.
  // Throttled to about once an hour (R3-2): the cron runs every 5 minutes.
  if (st === "partial") await throttledOutbox(d, e0, "eth_schema_incomplete", "sweep");
  // Every RPC call checks the deadline, so one slow claim can't run the cron past its budget (B4).
  const e: EthDeps = { ...e0, rpc: e0.rpc ? withDeadline(e0.rpc, t0 + budget, clock) : null };
  let page;
  try { page = await e.store.listUnresolved(); } catch { await outbox(d, "eth_claims_read_failed", "sweep"); return out; }
  out.total = page.total;
  // SF-B: claims already in manual review go last (the store orders them that way too), so a pile of stuck claims can
  // never starve new ones inside the budget.
  const mr = (c: EthClaim) => ((c.outcomes ?? []).includes("manual_review") ? 1 : 0);
  const rows = [...page.rows].sort((a, b) => mr(a) - mr(b));
  for (const c of rows) {
    if (clock() - t0 >= budget) break;
    out.checked++;
    const r = await resolveClaim(d, e, c).catch(() => "unresolved" as const);
    if (r === "settled") { out.settled++; await confirmPayment(d, c.providerRef).catch(() => null); continue; }
    if (r !== "unresolved" && r !== "rail_off") continue;
    // rail_off (no RPC, or payTo not pinned): alert at once, a person must resolve it. Unresolved: alert once when stuck.
    if ((r === "rail_off" || e.now() - c.at >= ETH_STUCK_MS) && !(c.outcomes ?? []).includes("alerted")) {
      try {
        await e.store.recordResolution({ txHash: c.txHash, outcome: "alerted", detail: null, at: e.now() });
        await e.store.recordResolution({ txHash: c.txHash, outcome: "manual_review", detail: r === "rail_off" ? "rail_off" : "stuck", at: e.now() });
      } catch { /* alert anyway */ }
      const q = await e.store.quoteForRef(c.providerRef).catch(() => null);
      const o = q ? await d.store.getOrder(q.orderId).catch(() => null) : null;
      await outbox(d, "eth_claim_stuck", o?.publicId ?? "unknown"); out.alerted++;
    }
  }
  // Backlog: fewer claims checked than are unresolved (budget, or the 200-row page). A person should know.
  if (out.checked < out.total) await throttledOutbox(d, e0, "eth_sweep_backlog", "sweep");
  return out;
}

/**
 * BTC exclusion (Deps.btcBlockedByOtherRail): an order with an Ethereum quote (and so any claim) can't take a new BTC
 * binding. Not migrated = nothing to block; half-applied or unreadable = blocked (fail closed).
 */
export async function ethBlocksBtc(e: EthDeps, orderId: string): Promise<boolean> {
  const st = await schemaState(e);
  if (st === "missing") return false;
  if (st !== "ready") return true;
  return !!(await e.store.quoteForOrder(orderId));
}

/**
 * B7 x ETH (Deps.railHeldOrders): orders with an Ethereum transfer already sent and still confirming (an unresolved claim).
 * Their rigs are held under the availability gate exactly like BTC confirmation holds. Not migrated = none; an unreadable
 * schema or claim list throws (callers fail closed: no capacity).
 */
export async function ethHeldOrders(e: EthDeps): Promise<string[]> {
  const st = await schemaState(e);
  if (st === "missing") return [];
  if (st === "error") throw new Error("eth_schema_unreadable");
  const ids = new Set<string>();
  for (const c of (await e.store.listUnresolved()).rows) {
    const q = await e.store.quoteForRef(c.providerRef);
    if (q) ids.add(q.orderId);
  }
  return [...ids];
}

/** Cancel guard: an unpaid order with an Ethereum transfer still confirming can't be cancelled (it would turn a good payment into a refund). Read error = pending (fail closed). */
export async function ethClaimPending(e: EthDeps | null, orderId: string): Promise<boolean> {
  if (!e) return false;
  const st = await schemaState(e);
  if (st === "missing") return false;
  if (st !== "ready") return true;
  try {
    const q = await e.store.quoteForOrder(orderId);
    return !!q && (await e.store.unresolvedForRef(q.providerRef)).length > 0;
  } catch { return true; }
}

/** The page's Ethereum option (sync, config only). bind re-checks the schema and fails closed (rail_unavailable). */
export function ethChainFromEnv(env: Record<string, string | undefined> = process.env, pinSha?: string | null): { eth?: EthOffer } {
  const c = pinSha === undefined ? ethConfig(env) : ethConfig(env, pinSha);
  if (!c) return {};
  const n = c.net;
  return { eth: { network: n.network, name: n.name, chainIdHex: n.chainIdHex, explorer: n.explorer, testnet: n.testnet, payTo: c.payTo, asset: n.asset } };
}
