/**
 * BTC on-chain rail, site side (PLAN v3.1 §4, §6, §9.3-9.4, §11; §18). Behind RENTALS_BTC_ONCHAIN_ENABLED (off).
 *
 * Human checkout only (v1): a binding is created only after the renter picks Bitcoin on /hashrate/rent and passes
 * Turnstile (route), within the caps the last VERIFIED heartbeat reports (N1). No MCP/bot rail, no API for bots.
 *
 * Flow: createBtcBinding (row, no index) -> the node agent attests (index + address, signed "addr") -> first display
 * re-verifies (a)-(e) -> the renter pays -> the agent reports a signed "paid" event -> processBtcEvents accepts it
 * (signature, nonce, iat/exp against the DB received_at, every field equal to the attestation, outpoints globally
 * unique, received >= amount) and provisions through the same rental_settle commit as x402, with a rev 1.7 btc_onchain
 * job. The rental clock (settle + 30 min / 2 h 15 min held) counts from paid-event acceptance (P6).
 */
import crypto from "node:crypto";
import { assertCustomerSafe } from "../../index";
import { CapExceeded, KillSwitchError, StaleVersion, UniqueViolation, type Commit } from "../store";
import type { Deps } from "../service";
import { routeJob, freeBays, fleetCapacity, ownedOrder, refundRow, PAY_TTL_MS } from "../service";
import type { BtcJobPayment } from "../jobs";
import type { Order, PaymentRecord, RefundRecord } from "../types";
import { btcConfig, type BtcReady, type BtcBootError } from "./config";
import { deriveReceive } from "./hd";
import { quoteBtc, satsToBtcStr, type BtcPricingRow } from "./quote";
import { verifyEnvelope, maskAddress, BTC_MAX_OUTPOINTS, type AddrPayload, type PaidPayload, type ReorgedPayload, type HeartbeatPayload, type AddrRefusedPayload, type SeenPayload, type UnderpaidPayload } from "./envelope";
import { agentBehind } from "./tip";
import { BtcBindConflict, BtcOutpointReused, type BtcStore, type BtcBinding, type BtcEvent } from "./store";

export type BtcDeps = {
  store: BtcStore;
  /** Flag + pins + descriptor + keys + Turnstile (config.ts). Called per request (cached inside). */
  config: () => ReturnType<typeof btcConfig>;
  pricingRows: () => Promise<BtcPricingRow[] | null>;
  /** P5 public tip for the profile's chain (tip.ts publicTip bound to the profile URLs). */
  publicTip: () => Promise<number | null>;
};

export const HEARTBEAT_FRESH_MS = 90_000;
export const HEARTBEAT_FUTURE_MS = 60_000;
/** (d) Effective max term for a BTC-paid rental (the DB keeps 1-30 days for every rail). Longer orders: USDC only. */
export const BTC_MAX_DAYS = 7;
export const CAPS = { outstanding: 50, attestHour: 20, attestDay: 100 } as const;
/** Dust: never auto-queued for refund (PLAN §5.5); overpay is queued only above 1% AND above this. */
export const DUST_SAT = 5000;
/** First display: the attestation must arrive within this many seconds of the pick, else "temporarily unavailable" (§4.3). */
export const ATTEST_WAIT_SEC = 5;
/** Agent refusal reasons we mirror as "temporarily unavailable" (never shown verbatim). */
const UNAVAILABLE = "Bitcoin is temporarily unavailable. Pay with USDC, or try Bitcoin again in a few minutes.";
const PAUSED_REFUND = "Rentals are paused. Your payment will be refunded.";

type Err = { ok: false; error: string; message?: string };
const err = (error: string, message?: string): Err => ({ ok: false, error, ...(message ? { message } : {}) });
const sec = (ms: number) => Math.floor(ms / 1000);

// ── heartbeat + availability (N1, §11, P5) ─────────────────────────────────────────────────────────────────────────
export type HbState = { ok: true; hb: HeartbeatPayload; receivedAt: number } | { ok: false; reason: string };
export async function heartbeatState(d: Deps, ready: BtcReady): Promise<HbState> {
  const b = d.btc!;
  let row;
  try { row = await b.store.latestHeartbeat(); } catch { return { ok: false, reason: "heartbeat_unreadable" }; }
  if (!row) return { ok: false, reason: "heartbeat_missing" };
  const v = verifyEnvelope<HeartbeatPayload>(row.env, { keys: ready.keys, refSec: sec(row.receivedAt), expectType: "heartbeat" });
  if (!v.ok) return { ok: false, reason: "heartbeat_" + v.reason };
  // SF3: a heartbeat signed more than 60 s after it was received is refused (it would look fresh after the agent stopped).
  if (v.payload.iat * 1000 > row.receivedAt + HEARTBEAT_FUTURE_MS) return { ok: false, reason: "heartbeat_future" };
  const now = d.now();
  if (now - row.receivedAt > HEARTBEAT_FRESH_MS || now - v.payload.iat * 1000 > HEARTBEAT_FRESH_MS) return { ok: false, reason: "heartbeat_stale" };
  return { ok: true, hb: v.payload, receivedAt: row.receivedAt };
}

export type Availability = { ok: true; ready: BtcReady; hb: HeartbeatPayload } | { ok: false; reason: BtcBootError | string };
/** Show "Pay with Bitcoin" only when ALL hold (§9.5): flag/config, rentals enabled, verified fresh heartbeat with no
 *  caps/gap/kill/stop, floor history OK, onchain OK, and the agent not > 2 blocks behind a known public tip. */
export async function btcAvailability(d: Deps): Promise<Availability> {
  if (!d.btc) return { ok: false, reason: "btc_not_wired" };
  const c = d.btc.config();
  if (!c.ok) return { ok: false, reason: c.error };
  try { if (await d.killSwitch()) return { ok: false, reason: "rentals_paused" }; } catch { return { ok: false, reason: "rentals_paused" }; }
  const h = await heartbeatState(d, c.ready);
  if (!h.ok) return { ok: false, reason: h.reason };
  const hb = h.hb;
  if (!hb.onchain_ok) return { ok: false, reason: "onchain_not_ok" };
  if (hb.killed || hb.stop_file) return { ok: false, reason: "agent_killed" };
  // (g) The agent's gap-limit stop (it alerts at 75 % and stops at 90 % of its configured gap). The site honours the flag
  // and also re-derives the 90 % line from unused_run / gap_limit, so a missing flag can't keep BTC on.
  if (hb.caps_hit || hb.gap_stopped) return { ok: false, reason: "agent_caps" };
  if (!(hb.gap_limit > 0) || hb.unused_run * 10 >= hb.gap_limit * 9) return { ok: false, reason: "agent_gap" };
  if (!hb.floor_history_ok) return { ok: false, reason: "floor_history" };
  if (hb.outstanding >= CAPS.outstanding || hb.attest_hour >= CAPS.attestHour || hb.attest_day >= CAPS.attestDay) return { ok: false, reason: "agent_caps" };
  let pub: number | null = null;
  try { pub = await d.btc.publicTip(); } catch { pub = null; }
  if (pub == null) return { ok: false, reason: "public_tip_unavailable" }; // both down: hide for NEW picks only
  if (agentBehind(hb.tip_height, pub)) return { ok: false, reason: "agent_behind" };
  return { ok: true, ready: c.ready, hb };
}

// ── binding creation ───────────────────────────────────────────────────────────────────────────────────────────────
const LIVE_FOR_VIEW = ["awaiting_attest", "awaiting_payment", "seen", "underpaid", "paid", "killed_refund", "late_payment", "duplicate", "refund_pending", "manual_review", "reorged"] as const;

/** Owner only (rental_id + creator_secret). Turnstile and per-IP limits are the route's job, BEFORE this runs. */
export async function createBtcBinding(d: Deps, input: { rental_id?: unknown; creator_secret?: unknown }) {
  if (!d.btc) return err("btc_unavailable", UNAVAILABLE);
  const own = await ownedOrder(d, input);
  if (!own.ok) return own;
  const o = own.o, now = d.now();
  const existing = (await d.btc.store.bindingsForOrder(o.id)).filter((b) => (LIVE_FOR_VIEW as readonly string[]).includes(b.status));
  if (existing.length) return { ok: true as const, result: await btcView(d, o, existing[existing.length - 1]) };
  if (o.state !== "awaiting_payment" || o.rail !== "x402_usdc") return err("not_payable", "This order can't take a payment.");
  if (o.expiresAt <= now) return err("order_expired", "This order's pay window has closed. Start a new order.");
  if (o.days > BTC_MAX_DAYS) return err("not_payable", `Bitcoin is available for rentals up to ${BTC_MAX_DAYS} days. Pay with USDC for longer terms.`);
  // BTC and ETH are mutually exclusive (review #108): an order set up for USDC on Ethereum can't also take Bitcoin.
  if (d.btcBlockedByOtherRail) {
    let blocked: boolean;
    try { blocked = await d.btcBlockedByOtherRail(o.id); } catch { return err("btc_unavailable", UNAVAILABLE); }
    if (blocked) return err("not_payable", "This order is set up to pay with USDC on Ethereum, so it can't switch to Bitcoin. Finish paying there, or start a new order.");
  }
  const av = await btcAvailability(d);
  if (!av.ok) return err("btc_unavailable", UNAVAILABLE);
  const rows = await d.btc.pricingRows().catch(() => null);
  const q = quoteBtc(rows ?? [], o.th, o.days, now);
  if (!q.ok) return err("btc_unavailable", UNAVAILABLE);
  const bindingId = crypto.randomUUID();
  const quoteAt = sec(q.q.quoteAt), quoteExpiresAt = sec(q.q.quoteExpiresAt);
  const amountSat = Number(q.q.amountSat);
  if (!Number.isSafeInteger(amountSat) || amountSat <= 0) return err("btc_unavailable", UNAVAILABLE);
  const b: BtcBinding = {
    bindingId, providerRef: `btc:${bindingId}`, orderId: o.id, orderRef: o.publicId, kind: "initial", network: av.ready.network,
    index: null, address: null, amountSat, requiredConfs: q.q.requiredConfs, floorStr: q.q.floorStr, floorDay: q.q.floorDay,
    quoteAt, quoteExpiresAt, quoteTipHeight: null, confirmByHeight: null, status: "awaiting_attest", statusReason: null,
    attestEnv: null, paidEnv: null, receivedSat: 0, creditedSat: 0, refundedSat: 0, displayOkAt: null, createdAt: now, updatedAt: now, version: 0,
  };
  try {
    await d.btc.store.insertBinding(b, { ref: b.providerRef, b: { orderId: o.id, kind: "initial", expectedAtomic: amountSat, expiresAt: quoteExpiresAt * 1000, extendDays: null, challenge: { rail: "btc_onchain", bindingId } } });
  } catch (e) {
    if (e instanceof BtcBindConflict) return err(e.why === "btc_binding_exists" ? "btc_binding_exists" : "not_payable", e.why === "btc_x402_money" ? "A USDC payment is already in progress for this order." : "This order can't take a Bitcoin payment.");
    if (e instanceof UniqueViolation) return err("retry", "Try again.");
    throw e;
  }
  return { ok: true as const, result: await btcView(d, o, b) };
}

// ── first display / re-display (N2) ────────────────────────────────────────────────────────────────────────────────
type DisplayCheck = { ok: true; att: AddrPayload } | { ok: false; reason: string; temporary?: boolean };

/** Fields the attestation must carry exactly as the binding was created (c). */
function attestationMatches(att: AddrPayload, b: BtcBinding, ready: BtcReady): string | null {
  if (att.binding_id !== b.bindingId || att.order_id !== b.orderId || att.order_ref !== b.orderRef) return "btc_binding_mismatch";
  if (att.kind !== b.kind) return "btc_kind_mismatch";
  if (att.amount_sat !== b.amountSat || att.required_confs !== b.requiredConfs) return "btc_amount_mismatch";
  if (att.floor_btc_per_ph_day !== b.floorStr || att.floor_day !== b.floorDay || att.quote_at !== b.quoteAt) return "btc_quote_mismatch";
  if (att.quote_expires_at !== b.quoteExpiresAt || att.exp !== b.quoteExpiresAt) return "btc_expiry_mismatch";
  if (att.confirm_by_height !== att.quote_tip_height + 144) return "btc_confirm_by_invalid";
  if (att.descriptor_checksum !== ready.descriptor.checksum) return "btc_descriptor_mismatch";
  if (b.index !== att.index || b.address !== att.address || b.quoteTipHeight !== att.quote_tip_height || b.confirmByHeight !== att.confirm_by_height) return "btc_row_mismatch";
  return null;
}
/** (b) the site's OWN derivation from the pinned descriptor; index 0 never (N5). */
function derivationOk(att: { index: number; address: string }, ready: BtcReady): string | null {
  if (!Number.isSafeInteger(att.index) || att.index < 1) return "btc_index_reserved";
  let mine: string;
  try { mine = deriveReceive(ready.descriptor, att.index); } catch { return "btc_derive_failed"; }
  return mine === att.address ? null : "btc_addr_mismatch";
}

/** Re-display (and paid-event pre-check): signature + kid + binding match + site derivation + index != 0. No nonce/exp. */
export function reverifyAttestation(b: BtcBinding, ready: BtcReady): DisplayCheck {
  if (!b.attestEnv || b.index == null || !b.address) return { ok: false, reason: "btc_not_attested" };
  const v = verifyEnvelope<AddrPayload>(b.attestEnv, { keys: ready.keys, refSec: 0, redisplay: true, expectType: "addr" });
  if (!v.ok) return { ok: false, reason: v.reason };
  const m = attestationMatches(v.payload, b, ready) ?? derivationOk(v.payload, ready);
  return m ? { ok: false, reason: m } : { ok: true, att: v.payload };
}

/** First display (a)-(e). Records the nonce (d) only after (a)-(c) pass. */
export async function firstDisplay(d: Deps, b: BtcBinding, ready: BtcReady): Promise<DisplayCheck> {
  const v = verifyEnvelope<AddrPayload>(b.attestEnv, { keys: ready.keys, refSec: sec(d.now()), expectType: "addr" });
  if (!v.ok) return { ok: false, reason: v.reason };
  const m = attestationMatches(v.payload, b, ready) ?? derivationOk(v.payload, ready);
  if (m) return { ok: false, reason: m };
  let pub: number | null = null;
  try { pub = await d.btc!.publicTip(); } catch { pub = null; }
  if (agentBehind(v.payload.quote_tip_height, pub)) return { ok: false, reason: "agent_behind", temporary: true }; // (e); unknown tip doesn't block
  // SF2: never show a fresh address while rentals are paused or the agent reports killed / stop file / gap stop.
  let killed = true;
  try { killed = await d.killSwitch(); } catch { killed = true; }
  if (killed) return { ok: false, reason: "rentals_paused", temporary: true };
  const hb = await heartbeatState(d, ready);
  if (hb.ok && (hb.hb.killed || hb.hb.stop_file || hb.hb.gap_stopped)) return { ok: false, reason: "agent_stopped", temporary: true };
  if (!(await d.btc!.store.recordNonce(v.payload.nonce, "addr", b.bindingId))) {
    // SF5: two overlapping polls (two tabs) race on the nonce. If the other one already displayed this exact attestation,
    // that's fine; otherwise treat it as temporary (never refuse the binding over our own race).
    const fresh = await d.btc!.store.getBinding(b.bindingId).catch(() => null);
    if (fresh && fresh.displayOkAt != null && JSON.stringify(fresh.attestEnv) === JSON.stringify(b.attestEnv)) return { ok: true, att: v.payload };
    return { ok: false, reason: "btc_nonce_race", temporary: true };
  }
  return { ok: true, att: v.payload };
}

// ── renter view ────────────────────────────────────────────────────────────────────────────────────────────────────
export type BtcViewState = "attesting" | "pay" | "window_closed" | "underpaid" | "confirming" | "paid" | "paused_refund" | "refund" | "unavailable";
const bip21 = (address: string, sats: number) => `bitcoin:${address}?amount=${satsToBtcStr(sats).replace(/\.?0+$/, "")}`;

async function alert(d: Deps, kind: string, orderRef: string) {
  const a = { kind, orderRef, at: d.now() };
  try { await d.store.commit({ alerts: [a] }); } catch { /* outbox best effort */ }
  try { await d.alerter?.send(a); } catch { /* ignore */ }
}

/**
 * What the renter sees. Address and BIP21 are the renter's own payment target (excluded from the customer-safe scan,
 * which would flag any bc1 string); everything else goes through assertCustomerSafe.
 */
export async function btcView(d: Deps, o: Order, b0: BtcBinding) {
  const c = d.btc!.config();
  let b = b0;
  const now = d.now(), nowS = sec(now);
  // Random ids are not scanned (a random id can spell a blocked token, e.g. "-tx-"); everything else is.
  const ids = { rentalId: o.publicId, bindingId: b.bindingId };
  const base = { quoteExpiresAt: new Date(b.quoteExpiresAt * 1000).toISOString(), requiredConfs: b.requiredConfs, amountSats: b.amountSat };
  const out = (state: BtcViewState, extra: Record<string, unknown> = {}, pay?: { address: string; bip21?: string }) => {
    const safe = assertCustomerSafe({ ...base, state, ...extra });
    return { ...ids, ...safe, ...(pay ? { address: pay.address, ...(pay.bip21 ? { bip21: pay.bip21 } : {}) } : {}) };
  };
  if (!c.ok) return out("unavailable", { message: UNAVAILABLE });
  const ready = c.ready;
  if (b.status === "awaiting_attest") {
    if (nowS >= b.quoteAt + ATTEST_WAIT_SEC * 6 || nowS >= b.quoteExpiresAt) {
      // Never attested in time: release it so USDC works again (the agent refuses quotes > 5 min old anyway, A1).
      await d.btc!.store.updateBinding(b.bindingId, b.version, { status: "refused", statusReason: "attest_timeout" }).catch(() => false);
      return out("unavailable", { message: UNAVAILABLE });
    }
    return out("attesting", { waitSeconds: ATTEST_WAIT_SEC });
  }
  if (b.status === "refused" || (b.status === "expired" && b.receivedSat === 0 && b.displayOkAt == null)) return out("unavailable", { message: UNAVAILABLE });
  // Every later state shows the address: it must re-verify (N2) or nothing is shown.
  let chk: DisplayCheck;
  if (b.status === "awaiting_payment" && b.displayOkAt == null) {
    chk = await firstDisplay(d, b, ready);
    if (chk.ok) {
      const ok = await d.btc!.store.updateBinding(b.bindingId, b.version, { displayOkAt: now });
      if (!ok) { const fresh = await d.btc!.store.getBinding(b.bindingId); if (!fresh || fresh.displayOkAt == null) return out("unavailable", { message: UNAVAILABLE }); b = fresh; }
    } else {
      if (!chk.temporary) {
        // Failed (a)-(d): never show it; refuse the binding (the index is burned on the agent side) and alert.
        await d.btc!.store.updateBinding(b.bindingId, b.version, { status: "refused", statusReason: chk.reason.slice(0, 40).replace(/[^a-z_]/g, "_") }).catch(() => false);
        await alert(d, "btc_display_refused", o.publicId);
      }
      return out("unavailable", { message: UNAVAILABLE });
    }
  } else {
    chk = reverifyAttestation(b, ready);
    if (!chk.ok) { await alert(d, "btc_redisplay_failed", o.publicId); return out("unavailable", { message: "We couldn't verify this payment address. Do not send to it. Contact us if you already paid." }); }
  }
  const address = chk.att.address;
  const hb = await heartbeatState(d, ready);
  const hbTip = hb.ok ? hb.hb.tip_height : null;
  const stale = !hb.ok;
  switch (b.status) {
    case "awaiting_payment":
      if (nowS < b.quoteExpiresAt) return out("pay", { stale }, { address, bip21: bip21(address, b.amountSat) });
      // After exp: no QR, "do not send more" (N2). A payment seen before the window closed still confirms.
      return out("window_closed", { stale, message: "The payment window for this address has closed. Do not send to it. If you already sent, it will confirm here or be refunded." }, { address });
    case "underpaid": {
      const short = b.amountSat - b.receivedSat;
      if (b.confirmByHeight != null && hbTip != null && hbTip > b.confirmByHeight) return out("refund", { message: "This payment was short and the window has closed. Contact us: a refund is pending." }, { address });
      return out("underpaid", { stale, receivedSats: { amountSats: b.receivedSat }, shortfall: { amountSats: short } }, { address, bip21: bip21(address, short) });
    }
    case "seen":
      // (e) the agent saw the payment (mempool or under-confirmed): no QR, "do not send again".
      return out("confirming", { stale, message: "Payment seen. Waiting for confirmations. Do not send again." }, { address });
    case "paid":
      return out("paid", { orderStatus: o.state, message: "Payment received." }, { address });
    case "killed_refund":
      return out("paused_refund", { message: PAUSED_REFUND }, { address });
    default:
      return out("refund", { message: "Payment received to this address. Do not send more. A refund is pending review; contact us with your rental id." }, { address });
  }
}

/** POST /api/rentals/btc/status. abandon=true releases a binding whose address was never shown (renter went back to USDC). */
export async function btcStatus(d: Deps, input: { rental_id?: unknown; creator_secret?: unknown; abandon?: unknown }) {
  if (!d.btc) return err("not_found");
  const own = await ownedOrder(d, input);
  if (!own.ok) return own;
  const o = own.o;
  const all = await d.btc.store.bindingsForOrder(o.id);
  let b = all[all.length - 1];
  if (!b) return err("not_found");
  await processBtcEvents(d, { bindingId: b.bindingId, limit: 10 }).catch(() => null);
  b = (await d.btc.store.getBinding(b.bindingId)) ?? b;
  if (input.abandon === true && (b.status === "awaiting_attest" || (b.status === "awaiting_payment" && b.displayOkAt == null))) {
    if (await d.btc.store.updateBinding(b.bindingId, b.version, { status: "refused", statusReason: "abandoned" })) return { ok: true as const, result: { rentalId: o.publicId, state: "unavailable" as const, abandoned: true } };
    b = (await d.btc.store.getBinding(b.bindingId)) ?? b;
  }
  const fresh = (await d.store.getOrder(o.id)) ?? o;
  return { ok: true as const, result: await btcView(d, fresh, b) };
}

// ── paid / refused / reorged events ────────────────────────────────────────────────────────────────────────────────
/** "seen" (e) = money in the mempool / under-confirmed: still payable, never credited until a paid event. */
const PAYABLE = ["awaiting_payment", "seen", "underpaid"];
/** A binding whose money was reorged: any later paid event goes to manual review, never a silent duplicate (FB2). */
const REORG_MANUAL = ["reorged", "manual_review"];

function paidMatches(p: PaidPayload, att: AddrPayload, b: BtcBinding): string | null {
  if (p.binding_id !== b.bindingId || p.order_id !== att.order_id || p.order_ref !== att.order_ref) return "btc_binding_mismatch";
  if (p.index !== att.index || p.address !== att.address) return "btc_addr_mismatch";
  if (p.amount_sat !== att.amount_sat || p.required_confs !== att.required_confs) return "btc_amount_mismatch";
  if (p.floor_btc_per_ph_day !== att.floor_btc_per_ph_day || p.floor_day !== att.floor_day || p.quote_at !== att.quote_at) return "btc_quote_mismatch";
  if (p.quote_tip_height !== att.quote_tip_height || p.confirm_by_height !== att.confirm_by_height) return "btc_deadline_mismatch";
  // FB1: an output past confirm_by is NOT a reason to reject the event; handlePaid splits it out as late money.
  for (const o of p.outpoints) if (p.tip_height - o.height + 1 < p.required_confs) return "btc_unconfirmed";
  return null;
}
/** Sum of outputs confirmed after confirm_by_height (late money, FB1). */
function lateSum(p: { outpoints: { value_sat: number; height: number }[]; confirm_by_height: number } | null | undefined): number {
  return (p?.outpoints ?? []).reduce((a, o) => a + (o.height > p!.confirm_by_height ? o.value_sat : 0), 0);
}
const paidPayloadOf = (env: unknown): PaidPayload | null => ((env as { payload?: PaidPayload } | null)?.payload ?? null);

/** rev 1.7 job payment from the accepted paid event (outpoints strictly ascending, no heights; on-time outputs only). */
export function btcJobPayment(b: BtcBinding, att: AddrPayload, p: PaidPayload): BtcJobPayment {
  const outpoints = p.outpoints.filter((o) => o.height <= p.confirm_by_height).map((o) => ({ txid: o.txid, vout: o.vout, value_sat: o.value_sat }))
    .sort((a, c) => (a.txid === c.txid ? a.vout - c.vout : a.txid < c.txid ? -1 : 1));
  return {
    rail: "btc_onchain", network: b.network, unit: "sat", payment_id: b.providerRef, order_id: b.orderId, binding_id: b.bindingId,
    index: att.index, address: att.address, amount_sat: att.amount_sat, required_confs: att.required_confs,
    floor_btc_per_ph_day: att.floor_btc_per_ph_day, floor_day: att.floor_day, quote_at: att.quote_at, quote_expires_at: att.quote_expires_at,
    quote_tip_height: att.quote_tip_height, confirm_by_height: att.confirm_by_height, outpoints,
  };
}

/**
 * Apply one verified paid event. Signature, kid, nonce, iat/exp (processOne), the attestation and every field are checked
 * FIRST; only then is the money split (FB1):
 *   on-time = outputs with height <= confirm_by_height   -> counts toward the amount as before
 *   late    = outputs with height >  confirm_by_height   -> recorded (btc_outpoints), refund row "late", btc_late_payment
 * Events are cumulative, so the NEW money of an event is the increase over the last accepted event of this binding.
 */
async function handlePaid(d: Deps, ev: BtcEvent, p: PaidPayload, b: BtcBinding, ready: BtcReady): Promise<string> {
  const store = d.btc!.store;
  const att = reverifyAttestation(b, ready);
  if (!att.ok) return "rejected:" + att.reason;
  const m = paidMatches(p, att.att, b);
  if (m) return "rejected:" + m;
  const reorgCase = REORG_MANUAL.includes(b.status);
  // Received never goes down, except after a reorg (that path only routes to manual review).
  if (p.received_sat < b.receivedSat && !reorgCase) return "rejected:btc_amount_went_down";
  const o = await d.store.getOrder(b.orderId);
  if (!o) return "rejected:no_order";
  const now = d.now();
  const ref = b.providerRef;
  const pays = await d.store.paymentsForRef(ref);
  const refunds = await d.store.refundsForRef(ref);
  const seen = pays.reduce((a, x) => a + x.deltaAtomic, 0);
  const refunded = refunds.reduce((a, x) => a + x.atomic, 0);
  const received = p.received_sat;
  const late = lateSum(p), onTime = received - late;
  const prevLate = lateSum(paidPayloadOf(b.paidEnv)), prevOnTime = b.receivedSat - prevLate;
  const lateNew = Math.max(0, late - prevLate), onTimeNew = Math.max(0, onTime - prevOnTime);
  const switchRail = o.state === "awaiting_payment" && o.rail === "x402_usdc" && PAYABLE.includes(b.status);
  const railOrder: Order = switchRail ? { ...o, rail: "btc_onchain", totalSats: b.amountSat, totalUsdcAtomic: null } : o;
  const net = b.network;
  const payRow = (settles: boolean): PaymentRecord => ({
    id: `${ref}#${seen}`, orderId: o.id, kind: b.kind, rail: "btc_onchain", providerRef: ref, seq: seen, deltaAtomic: received - seen, cumulativeAtomic: received,
    expectedAtomic: b.amountSat, extendDays: null, settles, at: now,
  });
  // Refund rows in sats on the binding's chain. SF7: amounts <= DUST_SAT are never auto-queued (the alert still fires).
  const refundRows = (...items: [RefundRecord["reason"], number][]): RefundRecord[] => {
    const out: RefundRecord[] = [];
    let seq = refunded;
    for (const [reason, amt] of items) {
      if (!(amt > DUST_SAT)) continue;
      out.push({ ...refundRow(railOrder, ref, seq, reason, amt, now, net), rail: "btc_onchain" as const, network: net });
      seq += amt;
    }
    return out;
  };
  const toRefundPending = (c: Commit) => {
    if (o.state === "awaiting_payment" || o.state === "expired") {
      c.order = { id: o.id, fromVersion: o.version, patch: { state: "refund_pending" } };
      c.events = [{ orderId: o.id, from: o.state, to: "refund_pending", actor: "payments", at: now }];
    }
  };
  const outpoints = p.outpoints.map((x) => ({ txid: x.txid, vout: x.vout, valueSat: x.value_sat, height: x.height }));
  const base = { bindingId: b.bindingId, fromVersion: b.version, nonce: p.nonce, nonceType: "paid" as const, outpoints, eventId: ev.id };
  const moneyIn = received > seen;
  const accept = async (status: BtcBinding["status"], reason: string | null, c: Commit, outcome: string, credited = b.creditedSat) => {
    if (moneyIn) c.payment = c.payment ?? payRow(false);
    const refundSum = (c.refunds ?? []).reduce((a, r) => a + r.atomic, 0);
    await store.acceptPaid({ ...base, eventOutcome: outcome, patch: { status, statusReason: reason, paidEnv: ev.env, receivedSat: received, creditedSat: Math.min(credited, received), refundedSat: refunded + refundSum },
      ...(switchRail ? { orderRail: { orderId: o.id, totalSats: b.amountSat } } : {}), commit: Object.keys(c).length ? c : undefined });
    for (const a of c.alerts ?? []) try { await d.alerter?.send(a); } catch { /* outbox has it */ }
    return outcome;
  };
  const alerts = (...kinds: string[]) => kinds.map((kind) => ({ kind, orderRef: o.publicId, at: now }));
  const lateAlert = lateNew > 0 ? ["btc_late_payment"] : [];

  // FB2: money on a reorged binding (re-confirmed or not) -> manual review with a refund row for anything not yet
  // credited or refunded; never "duplicate with refund 0".
  if (reorgCase) {
    const outstanding = Math.max(0, received - b.creditedSat - refunded);
    const c: Commit = { refunds: refundRows(["duplicate", outstanding]), alerts: alerts("btc_reorg_manual") };
    toRefundPending(c);
    return accept("manual_review", "reorg_reconfirmed", c, "manual_review");
  }
  // Money to a binding that no longer takes it (cancelled/expired/refused/settled/refunding): refund the NEW money only.
  if (!PAYABLE.includes(b.status)) {
    const c: Commit = { refunds: refundRows(["late", lateNew], ["duplicate", onTimeNew]), alerts: alerts(...lateAlert, ...(onTimeNew > 0 ? ["btc_duplicate"] : [])) };
    if (lateNew > 0 && b.status !== "paid") toRefundPending(c);
    const status: BtcBinding["status"] = b.status === "paid" ? "paid" : lateNew > 0 || b.status === "late_payment" ? "late_payment" : onTimeNew > 0 ? "duplicate" : b.status;
    const outcome = lateNew > 0 ? "late" : onTimeNew > 0 ? "duplicate" : "noop";
    return accept(status, lateNew > 0 && b.status !== "paid" ? "late_after_close" : onTimeNew > 0 ? "payment_after_close" : b.statusReason, c, outcome);
  }
  // From here the binding is payable and nothing has been refunded or credited yet; `cred` is the money that can count.
  const cred = onTime;
  const lateRows = (): [RefundRecord["reason"], number][] => [["late", late]];
  // N6: paid while killed -> killed_refund, never auto-provisioned on unkill; one alert per case.
  let killed = true;
  try { killed = await d.killSwitch(); } catch { killed = true; }
  if (killed) {
    const c: Commit = { refunds: refundRows(["kill_switch", cred - refunded], ...lateRows()), alerts: alerts("btc_killed_refund", ...lateAlert) };
    toRefundPending(c);
    return accept("killed_refund", "paid_while_killed", c, "killed_refund", 0);
  }
  if (o.state !== "awaiting_payment") {
    const c: Commit = { refunds: refundRows(["late", received - refunded]), alerts: alerts("btc_late_payment") };
    toRefundPending(c);
    return accept("late_payment", "order_not_payable", c, "late", 0);
  }
  // FB1: late money on a payable binding means confirm_by has passed. Short on time -> the window is over: refund all of it.
  if (late > 0 && cred < b.amountSat) {
    const c: Commit = { refunds: refundRows(["underpaid", cred - refunded], ...lateRows()), alerts: alerts("btc_late_payment", ...(cred > 0 ? ["btc_underpaid"] : [])) };
    toRefundPending(c);
    return accept("late_payment", "late_after_confirm_by", c, "late", 0);
  }
  // Underpaid: shortfall QR until confirm_by; never provisions (strict received >= amount on the site, NB1).
  if (cred < b.amountSat) return accept("underpaid", null, {}, "underpaid_waiting", 0);
  // Capacity at settle (same rules as x402 confirmPayment).
  const bays = await freeBays(d, o.id);
  if ((await d.store.rigsCommitted(now)) + o.rigCount > fleetCapacity(d) || bays.length < o.rigCount) {
    const c: Commit = { refunds: refundRows(["cap_exceeded", cred - refunded], ...lateRows()), alerts: alerts("btc_refund_cap_exceeded", ...lateAlert) };
    toRefundPending(c);
    return accept("refund_pending", "cap_exceeded", c, "cap_exceeded", 0);
  }
  // Settle: provision now (P6: the rental clock and the unapplied timeout start at acceptance).
  const startsAt = now, endsAt = now + o.days * 86_400_000, bayStr = bays.slice(0, o.rigCount).join(",");
  const n: Order = { ...railOrder, state: "delivering", startsAt, endsAt, bays: bayStr };
  const excess = cred - b.amountSat;
  const queueExcess = excess > DUST_SAT && excess * 100 > b.amountSat;
  const c: Commit = {
    order: { id: o.id, fromVersion: o.version, patch: { state: "delivering", startsAt, endsAt, bays: bayStr } },
    job: routeJob(d, n, "route", ref, b.amountSat, null, null, undefined, undefined, null, btcJobPayment(b, att.att, p)),
    events: [{ orderId: o.id, from: o.state, to: "paid", actor: "payments", at: now }, { orderId: o.id, from: "paid", to: "delivering", actor: "jobs", at: now }],
    payment: payRow(true),
    refunds: refundRows(...(queueExcess ? [["overpaid", excess] as [RefundRecord["reason"], number]] : []), ...lateRows()),
    alerts: alerts(...(queueExcess ? ["btc_overpaid"] : []), ...lateAlert),
  };
  try {
    return await accept("paid", null, c, late > 0 ? "settled_with_late" : "settled", queueExcess ? b.amountSat : cred);
  } catch (e) {
    const why = e instanceof CapExceeded ? "cap_exceeded" as const : e instanceof KillSwitchError ? "kill_switch" as const : null;
    if (!why) throw e;
    // Lost the race under the commit lock: refund instead (fresh binding/order versions are unchanged: nothing was written).
    const r: Commit = { refunds: refundRows([why, cred - refunded], ...lateRows()), alerts: alerts(why === "kill_switch" ? "btc_killed_refund" : "btc_refund_cap_exceeded", ...lateAlert) };
    toRefundPending(r);
    return accept(why === "kill_switch" ? "killed_refund" : "refund_pending", why, r, why, 0);
  }
}

/**
 * Reorg (FB2). Credited money or a running order -> manual_review: the rental (if running) fails with a revert job, the
 * credited sats get a refund row (pending_owner; the operator checks whether the tx re-confirmed) and btc_reorg_manual fires.
 * Before acceptance -> reorged (sweepBtc closes it so USDC isn't held forever).
 */
async function handleReorged(d: Deps, ev: BtcEvent, p: ReorgedPayload, b: BtcBinding, ready: BtcReady): Promise<string> {
  const att = reverifyAttestation(b, ready);
  if (!att.ok) return "rejected:" + att.reason;
  if (p.index !== att.att.index || p.address !== att.att.address || p.order_id !== b.orderId || p.order_ref !== b.orderRef) return "rejected:btc_binding_mismatch";
  const o = await d.store.getOrder(b.orderId);
  if (!o) return "rejected:no_order";
  const now = d.now();
  const running = (o.state === "delivering" || o.state === "active") && !!o.bays;
  const base = { bindingId: b.bindingId, fromVersion: b.version, nonce: p.nonce, nonceType: "reorged" as const, eventId: ev.id };
  if (b.creditedSat > 0 || running) {
    const refunded = (await d.store.refundsForRef(b.providerRef)).reduce((a, x) => a + x.atomic, 0);
    const amt = b.creditedSat;
    const c: Commit = { alerts: [{ kind: "btc_reorg_manual", orderRef: o.publicId, at: now }] };
    if (amt > DUST_SAT) c.refunds = [{ ...refundRow({ ...o, rail: "btc_onchain" }, b.providerRef, refunded, "delivery_failed", amt, now, b.network), rail: "btc_onchain" as const, network: b.network }];
    if (running) {
      c.order = { id: o.id, fromVersion: o.version, patch: { state: "failed", endsAt: now } };
      c.events = [{ orderId: o.id, from: o.state, to: "failed", actor: "payments", at: now }];
      c.job = routeJob(d, { ...o, endsAt: now }, "revert", b.providerRef, 0);
    }
    const queued = (c.refunds ?? []).reduce((a, r) => a + r.atomic, 0);
    await d.btc!.store.acceptPaid({ ...base, eventOutcome: "reorg_manual", patch: { status: "manual_review", statusReason: "reorg_after_credit", creditedSat: 0, refundedSat: refunded + queued }, commit: c });
    for (const a of c.alerts ?? []) try { await d.alerter?.send(a); } catch { /* outbox */ }
    return "reorg_manual";
  }
  const c: Commit = { alerts: [{ kind: "btc_reorged", orderRef: o.publicId, at: now }] };
  await d.btc!.store.acceptPaid({ ...base, eventOutcome: "reorged", patch: { status: "reorged", statusReason: "btc_reorged" }, commit: c });
  for (const a of c.alerts ?? []) try { await d.alerter?.send(a); } catch { /* outbox */ }
  return "reorged";
}

/** (e) "seen": informational. awaiting_payment -> seen (renter sees "confirming"); never credits, never records outpoints. */
async function handleSeen(d: Deps, ev: BtcEvent, p: SeenPayload, b: BtcBinding, ready: BtcReady): Promise<string> {
  const att = reverifyAttestation(b, ready);
  if (!att.ok) return "rejected:" + att.reason;
  const a = att.att;
  if (p.order_id !== a.order_id || p.order_ref !== a.order_ref || p.index !== a.index || p.address !== a.address) return "rejected:btc_binding_mismatch";
  if (p.amount_sat !== a.amount_sat) return "rejected:btc_amount_mismatch";
  const to = b.status === "awaiting_payment" ? { status: "seen" as const, statusReason: null } : {};
  await d.btc!.store.acceptPaid({ bindingId: b.bindingId, fromVersion: b.version, nonce: p.nonce, nonceType: "seen", eventId: ev.id, eventOutcome: to.status ? "seen" : "seen_noop", patch: to });
  return to.status ? "seen" : "seen_noop";
}

/**
 * (e) "underpaid": the agent's signed final shortfall after confirm_by (NB1). Payable binding -> refund_pending with the
 * received sats in the refund queue (SF7: > DUST_SAT) and a btc_underpaid alert; the order goes refund_pending. Outputs
 * are recorded like a paid event (globally unique). A binding that is no longer payable: nonce recorded, nothing else.
 */
async function handleUnderpaid(d: Deps, ev: BtcEvent, p: UnderpaidPayload, b: BtcBinding, ready: BtcReady): Promise<string> {
  const att = reverifyAttestation(b, ready);
  if (!att.ok) return "rejected:" + att.reason;
  const a = att.att;
  if (p.order_id !== a.order_id || p.order_ref !== a.order_ref || p.index !== a.index || p.address !== a.address) return "rejected:btc_binding_mismatch";
  if (p.amount_sat !== a.amount_sat || p.required_confs !== a.required_confs) return "rejected:btc_amount_mismatch";
  if (p.confirm_by_height !== a.confirm_by_height) return "rejected:btc_deadline_mismatch";
  const store = d.btc!.store;
  const base = { bindingId: b.bindingId, fromVersion: b.version, nonce: p.nonce, nonceType: "underpaid" as const, eventId: ev.id };
  if (!PAYABLE.includes(b.status)) { await store.acceptPaid({ ...base, eventOutcome: "underpaid_noop", patch: {} }); return "underpaid_noop"; }
  if (p.received_sat < b.receivedSat) return "rejected:btc_amount_went_down";
  const o = await d.store.getOrder(b.orderId);
  if (!o) return "rejected:no_order";
  const now = d.now(), ref = b.providerRef;
  const seen = (await d.store.paymentsForRef(ref)).reduce((x, r) => x + r.deltaAtomic, 0);
  const refunded = (await d.store.refundsForRef(ref)).reduce((x, r) => x + r.atomic, 0);
  const received = p.received_sat, amt = received - refunded;
  const c: Commit = { alerts: [{ kind: "btc_underpaid", orderRef: o.publicId, at: now }] };
  if (amt > DUST_SAT) c.refunds = [{ ...refundRow(o, ref, refunded, "underpaid", amt, now, b.network), rail: "btc_onchain" as const, network: b.network }];
  if (received > seen) c.payment = { id: `${ref}#${seen}`, orderId: o.id, kind: b.kind, rail: "btc_onchain", providerRef: ref, seq: seen, deltaAtomic: received - seen, cumulativeAtomic: received, expectedAtomic: b.amountSat, extendDays: null, settles: false, at: now };
  if (o.state === "awaiting_payment" || o.state === "expired") {
    c.order = { id: o.id, fromVersion: o.version, patch: { state: "refund_pending" } };
    c.events = [{ orderId: o.id, from: o.state, to: "refund_pending", actor: "payments", at: now }];
  }
  const outpoints = p.outpoints.map((x) => ({ txid: x.txid, vout: x.vout, valueSat: x.value_sat, height: x.height }));
  await store.acceptPaid({ ...base, outpoints, eventOutcome: "underpaid_refund", patch: { status: "refund_pending", statusReason: "underpaid_final", receivedSat: received, refundedSat: refunded + (amt > DUST_SAT ? amt : 0) }, commit: c });
  for (const x of c.alerts ?? []) try { await d.alerter?.send(x); } catch { /* outbox */ }
  return "underpaid_refund";
}

/**
 * SF9 + FB3: an event that keeps failing (a thrown error, or a StaleVersion that never clears) is given up only after
 * at least STUCK_EVENT_ATTEMPTS failures spread over at least STUCK_EVENT_MS, counted from its FIRST failure (btc_events
 * attempts / first_failed_at), never from received_at: after a long outage one transient error can't reject a real event.
 */
export const STUCK_EVENT_MS = 60 * 60_000;
export const STUCK_EVENT_ATTEMPTS = 5;
const MONEY_EVENTS = ["paid", "underpaid", "reorged"];
const errCode = (e: unknown) => (e instanceof StaleVersion ? "stale_version" : String((e as Error)?.message ?? "error")).toLowerCase().replace(/[^a-z0-9_:]/g, "_").slice(0, 60) || "error";

/**
 * FB3 (b): give up on a money event. A paid / underpaid / reorged event whose SIGNATURE verifies and whose binding is
 * known moves that binding to manual_review (event_stuck) in the same transaction that marks the event, so money is
 * never silently dropped. If that transaction itself can't run, the binding CAS + mark are tried separately; if the
 * binding still can't be moved the event is left unprocessed (counted, alerted) rather than marked.
 */
async function giveUp(d: Deps, ev: BtcEvent, ready: BtcReady): Promise<boolean> {
  const store = d.btc!.store, now = d.now(), outcome = "rejected:btc_event_stuck";
  const v = verifyEnvelope<PaidPayload | ReorgedPayload | UnderpaidPayload | SeenPayload | AddrRefusedPayload>(ev.env, { keys: ready.keys, refSec: sec(ev.receivedAt) });
  const p = v.ok ? v.payload : null;
  const money = !!p && MONEY_EVENTS.includes(ev.type) && p.type === ev.type && !!ev.bindingId && p.binding_id === ev.bindingId;
  let b: BtcBinding | null = null;
  if (money) {
    try { b = await store.getBinding(ev.bindingId!); } catch { return false; } // can't read the binding: keep the money event
  }
  if (!b || b.status === "manual_review") return store.markEvent(ev.id, outcome).catch(() => false);
  const patch = { status: "manual_review" as const, statusReason: "event_stuck" };
  try {
    await store.acceptPaid({ bindingId: b.bindingId, fromVersion: b.version, eventId: ev.id, eventOutcome: outcome, patch, commit: { alerts: [{ kind: "btc_event_stuck_manual", orderRef: b.orderRef, at: now }] } });
    return true;
  } catch {
    try {
      if (!(await store.updateBinding(b.bindingId, b.version, patch))) return false;
      await store.markEvent(ev.id, outcome).catch(() => false);
      return true;
    } catch { return false; }
  }
}

/** Verify and apply pending agent events (oldest first). Safe to run concurrently: every write is a CAS. */
export async function processBtcEvents(d: Deps, opts: { bindingId?: string; limit?: number } = {}): Promise<{ processed: number; outcomes: string[] }> {
  const res = { processed: 0, outcomes: [] as string[] };
  if (!d.btc) return res;
  const c = d.btc.config();
  if (!c.ok) return res; // flag off / not configured: events wait (nothing is accepted without the pinned key)
  const store = d.btc.store;
  for (const ev of await store.pendingEvents(opts.limit ?? 50, opts.bindingId)) {
    let outcome: string;
    try { outcome = await processOne(d, ev, c.ready); }
    catch (e) {
      if (e instanceof BtcOutpointReused) outcome = "rejected:btc_outpoint_reused";
      else if (e instanceof UniqueViolation) outcome = "rejected:replay";
      else {
        // Transient (or a StaleVersion that keeps coming back): count it; give up only at >= 5 failures over >= 1 h.
        const f = await store.noteEventFailure(ev.id, errCode(e)).catch(() => null);
        const stuck = f != null && f.attempts >= STUCK_EVENT_ATTEMPTS && d.now() - f.firstFailedAt >= STUCK_EVENT_MS;
        if (!stuck) { res.outcomes.push(e instanceof StaleVersion ? "retry" : "error"); continue; }
        const orderRef0 = (ev.env as { payload?: { order_ref?: unknown } })?.payload?.order_ref;
        const ref0 = typeof orderRef0 === "string" && /^gm_[A-Za-z0-9_-]{8,20}$/.test(orderRef0) ? orderRef0 : "btc";
        if (!(await giveUp(d, ev, c.ready))) {
          // Kept unprocessed (binding unreadable): alert at the first give-up and then on power-of-two attempts only
          // (5, 8, 16, 32, ...), so status polls retrying it up to 60/min can't flood ntfy.
          if (f.attempts === STUCK_EVENT_ATTEMPTS || (f.attempts & (f.attempts - 1)) === 0) await alert(d, "btc_event_stuck", ref0);
          res.outcomes.push("stuck_unmarked"); continue;
        }
        await alert(d, "btc_event_stuck", ref0);
        res.processed++; res.outcomes.push("rejected:btc_event_stuck");
        continue;
      }
    }
    if (outcome.startsWith("rejected:")) {
      await store.markEvent(ev.id, outcome.slice(0, 60)).catch(() => false);
      const orderRef = (ev.env as { payload?: { order_ref?: unknown } })?.payload?.order_ref;
      await alert(d, outcome.includes("outpoint") ? "btc_outpoint_reused" : "btc_event_rejected", typeof orderRef === "string" && /^gm_[A-Za-z0-9_-]{8,20}$/.test(orderRef) ? orderRef : "btc");
    }
    res.processed++; res.outcomes.push(outcome);
  }
  return res;
}

/**
 * Outpoint cap: a signed paid / underpaid / seen event with more than BTC_MAX_OUTPOINTS outputs is never settled (the
 * node verifier would refuse the job). The binding goes to manual_review (outpoint_cap) + btc_outpoint_cap; the nonce
 * and the event are consumed in the same transaction; no outpoints are recorded, nothing is credited or refunded.
 */
async function handleOutpointCap(d: Deps, ev: BtcEvent, p: { nonce: string; type: "paid" | "underpaid" | "seen"; order_id: string; order_ref: string }, b: BtcBinding): Promise<string> {
  if (p.order_id !== b.orderId || p.order_ref !== b.orderRef) return "rejected:btc_binding_mismatch";
  const now = d.now(), outcome = "manual:outpoint_cap";
  const a = { kind: "btc_outpoint_cap", orderRef: b.orderRef, at: now };
  await d.btc!.store.acceptPaid({ bindingId: b.bindingId, fromVersion: b.version, nonce: p.nonce, nonceType: p.type, eventId: ev.id, eventOutcome: outcome,
    patch: b.status === "manual_review" ? {} : { status: "manual_review", statusReason: "outpoint_cap" }, commit: { alerts: [a] } });
  try { await d.alerter?.send(a); } catch { /* outbox */ }
  return outcome;
}

async function processOne(d: Deps, ev: BtcEvent, ready: BtcReady): Promise<string> {
  const v = verifyEnvelope<PaidPayload | ReorgedPayload | AddrRefusedPayload | SeenPayload | UnderpaidPayload>(ev.env, { keys: ready.keys, refSec: sec(ev.receivedAt) });
  if (!v.ok) return "rejected:" + v.reason;
  const p = v.payload;
  if (p.type !== ev.type || p.binding_id !== ev.bindingId) return "rejected:btc_event_mismatch";
  const b = await d.btc!.store.getBinding(p.binding_id);
  if (!b) return "rejected:no_binding";
  if (b.network !== ready.network) return "rejected:btc_network_mismatch";
  if (p.type === "addr_refused") {
    if (p.order_id !== b.orderId || p.order_ref !== b.orderRef) return "rejected:btc_binding_mismatch";
    if (!(await d.btc!.store.recordNonce(p.nonce, "addr_refused", b.bindingId))) return "rejected:replay";
    if (b.status === "awaiting_attest") await d.btc!.store.updateBinding(b.bindingId, b.version, { status: "refused", statusReason: p.reason });
    await d.btc!.store.markEvent(ev.id, "refused");
    return "refused";
  }
  if ((p.type === "paid" || p.type === "underpaid" || p.type === "seen") && Array.isArray(p.outpoints) && p.outpoints.length > BTC_MAX_OUTPOINTS) return handleOutpointCap(d, ev, p, b);
  if (p.type === "reorged") return handleReorged(d, ev, p, b, ready);
  if (p.type === "seen") return handleSeen(d, ev, p, b, ready);
  if (p.type === "underpaid") return handleUnderpaid(d, ev, p, b, ready);
  if (p.type !== "paid") return "rejected:env_type";
  return handlePaid(d, ev, p, b, ready);
}

// ── sweep ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Cron: process events, release never-attested bindings, and (ONLY with a fresh verified heartbeat, S10) close
 * bindings whose confirm_by_height has passed: unpaid -> expired (the order then expires normally), underpaid -> refund.
 */
/** Agent r1 fallback (sweep): money-holding bindings untouched this long while the heartbeat is stale -> manual_review. */
export const BTC_STALL_MS = 24 * 60 * 60_000;
export async function sweepBtc(d: Deps): Promise<{ events: number; released: number; expired: number; refunded: number; manual: number }> {
  const out = { events: 0, released: 0, expired: 0, refunded: 0, manual: 0 };
  if (!d.btc) return out;
  const c = d.btc.config();
  if (!c.ok) return out;
  out.events = (await processBtcEvents(d, { limit: 100 })).processed;
  const store = d.btc.store, now = d.now(), nowS = sec(now);
  for (const b of await store.listBindings(["awaiting_attest"])) {
    if (nowS >= b.quoteExpiresAt && (await store.updateBinding(b.bindingId, b.version, { status: "refused", statusReason: "attest_timeout" }))) out.released++;
  }
  const hb = await heartbeatState(d, c.ready);
  if (!hb.ok) {
    // S10: no time-based expiry or refund while the agent is stale. Agent r1 fallback: a binding that already holds money
    // (seen / underpaid / reorged) and has not moved for BTC_STALL_MS while the agent is silent goes to manual_review
    // (agent_stalled) + btc_agent_stalled, so it never waits forever on an event that may not come. No refund is queued.
    for (const b of await store.listBindings(["seen", "underpaid", "reorged"])) {
      if (now - b.updatedAt < BTC_STALL_MS) continue;
      try {
        if (await store.updateBinding(b.bindingId, b.version, { status: "manual_review", statusReason: "agent_stalled" })) { out.manual++; await alert(d, "btc_agent_stalled", b.orderRef); }
      } catch { /* next pass */ }
    }
    return out;
  }
  const tip = hb.hb.tip_height;
  for (const b of await store.listBindings(["awaiting_payment", "seen", "underpaid"])) {
    if (b.confirmByHeight == null || tip <= b.confirmByHeight) continue;
    if ((b.status === "awaiting_payment" || b.status === "seen") && b.receivedSat === 0) {
      if (await store.updateBinding(b.bindingId, b.version, { status: "expired", statusReason: "confirm_by_passed" })) out.expired++;
      continue;
    }
    // Underpaid past confirm_by: everything received goes to the manual refund queue.
    const o = await d.store.getOrder(b.orderId);
    if (!o) continue;
    const ref = b.providerRef;
    const refunded = (await d.store.refundsForRef(ref)).reduce((a, x) => a + x.atomic, 0);
    const amt = b.receivedSat - refunded;
    // NB1: any shortfall at confirm_by -> btc_underpaid alert + refund queue (SF7: > DUST_SAT only is auto-queued).
    const commit: Commit = { alerts: [{ kind: "btc_underpaid", orderRef: o.publicId, at: now }] };
    if (amt > DUST_SAT) commit.refunds = [{ ...refundRow(o, ref, refunded, "underpaid", amt, now, b.network), rail: "btc_onchain" as const, network: b.network }];
    if (o.state === "awaiting_payment" || o.state === "expired") {
      commit.order = { id: o.id, fromVersion: o.version, patch: { state: "refund_pending" } };
      commit.events = [{ orderId: o.id, from: o.state, to: "refund_pending", actor: "sweeper", at: now }];
    }
    try {
      await store.acceptPaid({ bindingId: b.bindingId, fromVersion: b.version, patch: { status: "refund_pending", statusReason: "underpaid_confirm_by", refundedSat: refunded + (amt > DUST_SAT ? amt : 0) }, commit });
      out.refunded++;
      try { await d.alerter?.send(commit.alerts![0]); } catch { /* outbox */ }
    } catch (e) { if (!(e instanceof StaleVersion || e instanceof UniqueViolation)) throw e; }
  }
  // FB2: a binding reorged BEFORE acceptance would hold the order (and block USDC) forever. Close it: money still
  // unrefunded -> refund_pending + refund row (pending_owner checks the chain); nothing left -> expired (released).
  for (const b of await store.listBindings(["reorged"])) {
    const o = await d.store.getOrder(b.orderId);
    if (!o) continue;
    const refunded = (await d.store.refundsForRef(b.providerRef)).reduce((a, x) => a + x.atomic, 0);
    const amt = Math.max(0, b.receivedSat - b.creditedSat - refunded);
    try {
      if (amt === 0) {
        if (await store.updateBinding(b.bindingId, b.version, { status: "expired", statusReason: "reorg_released" })) out.released++;
        continue;
      }
      // Label: the money was received but its confirmations were reorged out before the order accepted it, so it was
      // never applied. DB refund reasons are fixed; expired_unapplied is the closest ("received, never applied"). The
      // binding note (status_reason) and the alert spell out the cause so pending_owner checks the chain first.
      const commit: Commit = { alerts: [{ kind: "btc_reorg_unaccepted_refund", orderRef: o.publicId, at: now }] };
      if (amt > DUST_SAT) commit.refunds = [{ ...refundRow(o, b.providerRef, refunded, "expired_unapplied", amt, now, b.network), rail: "btc_onchain" as const, network: b.network }];
      if (o.state === "awaiting_payment" || o.state === "expired") {
        commit.order = { id: o.id, fromVersion: o.version, patch: { state: "refund_pending" } };
        commit.events = [{ orderId: o.id, from: o.state, to: "refund_pending", actor: "sweeper", at: now }];
      }
      await store.acceptPaid({ bindingId: b.bindingId, fromVersion: b.version, patch: { status: "refund_pending", statusReason: "reorg_unaccepted_refund", refundedSat: refunded + (amt > DUST_SAT ? amt : 0) }, commit });
      out.refunded++;
      try { await d.alerter?.send(commit.alerts![0]); } catch { /* outbox */ }
    } catch (e) { if (!(e instanceof StaleVersion || e instanceof UniqueViolation)) throw e; }
  }
  return out;
}

/** checkoutView hook: { siteKey } only when BTC can be offered right now (nothing about BTC otherwise). */
export async function btcOffer(d: Deps): Promise<{ siteKey: string; maxDays: number } | null> {
  const a = await btcAvailability(d).catch(() => null);
  return a && a.ok ? { siteKey: a.ready.turnstileSiteKey, maxDays: BTC_MAX_DAYS } : null;
}
export { PAY_TTL_MS, maskAddress };
