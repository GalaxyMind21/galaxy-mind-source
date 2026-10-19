/**
 * Phase 2 rental service · STAGING ONLY.
 *
 * Invariants (review PR #76 review):
 * - Money is tracked per provider ref as increments (payments rows, seq =
 *   cumulative before). Refunds per ref never exceed
 *   received - (settled ? expected : 0) - already refunded.
 * - Each ref settles at most once (row with settles=true, unique per ref).
 * - Every decision is written in ONE atomic commit (SQL: rental_settle RPC).
 *   A concurrent loser gets StaleVersion/UniqueViolation, writes nothing,
 *   and returns "retry". For confirmPayment after a settled x402 payment
 *   this means the pay route answers 200 success with outcome "retry"
 *   (money moved; the next confirm resolves it).
 * - The access code is derived from a creator secret returned once by
 *   create_rental. Knowing a payment ref never reveals the code.
 * - Kill switch and caps (rigs, days) are checked at create AND at settle,
 *   for initial payments and extensions.
 */
import type { PayToPins } from "./payto-pins";
import crypto from "node:crypto";
import { assertCustomerSafe } from "../index";
import { priceOrder, usdcAtomicFor, usdcPerPhDayCents, PILOT_CAP_RIGS, SQL_COMMIT_CAP, MAX_DAYS, PILOT_MAX_DAYS, MIN_DAYS, RIG_TH, type DailyPricing } from "./pricing";
import { RENTAL_TERMS_VERSION, RENTAL_TERMS_URL } from "./terms";
import { COMMITTED_STATES, PENDING_LIST_CAP } from "./store";
import { validateCreate, IDEM_RE, type CreateInput } from "./validate";
import { poolApproval, poolNote, maskRenterAddress, renterRejectReason, HELD_TIMEOUT_MS, HELD_JOB_TTL_SEC, HELD_NOTE } from "./pools";
import { BASE_SEPOLIA, X402Provider } from "./x402";
import { validTxId } from "./solana-tx";
import type { PaymentProvider, Challenge } from "./providers";
import { UniqueViolation, StaleVersion, CapExceeded, KillSwitchError, type RentalStore, type Commit, type Binding } from "./store";
import { signJob, newNonce, JOB_MAX_TTL_SEC, type JobPayload, type SignedJob, type BtcJobPayment, type X402JobPayment } from "./jobs";
import type { BtcDeps } from "./btc/service";
import { btcNetworkForEnv } from "./btc/networks";
import type { Order, OrderState, Rail, RefundRecord, PaymentRecord } from "./types";
import { Limiter, type Alerter } from "./safety";
import { SUPPORT_EMAIL } from "../../support";

export const PAY_TTL_MS = 15 * 60 * 1000;
/** Settled but never applied by the node: stop re-offering and mark refund_due after this. */
export const UNAPPLIED_TIMEOUT_MS = 30 * 60_000;
/** Held orders (manual pool waiting for the owner's approval) use HELD_TIMEOUT_MS from settlement instead (pools.ts). */
export { HELD_TIMEOUT_MS };
export const CODE_GRACE_MS = 7 * 86_400_000;   // codes work until rental end + 7 days
const RUNNING: OrderState[] = ["paid", "delivering", "active"];

export type Deps = {
  /** sha256 pins the payTo env values are checked against (payto-pins.ts). Unset = the code pins; tests inject their own. */
  payToPins?: PayToPins;
  /** Signed-job env (jobEnv()); default staging. */
  jobEnv?: "staging" | "mainnet";
  /** CAIP-2 network for x402 (from x402Net config). Defaults to Base Sepolia. */
  payNetwork?: string;
  store: RentalStore;
  providers: Partial<Record<Rail, PaymentProvider>>;
  pricing: () => Promise<DailyPricing | null>;
  /** Staging: fixed test rate. MAINNET: must be a fresh (<60 s) BTC/USD from two sources, fail closed. */
  btcUsd: () => Promise<number>;
  now: () => number;
  signingKeyPem: string;
  signingKid: string;
  codeHmacKey: string;
  killSwitch: () => Promise<boolean>;
  alerter?: Alerter;
  limiter?: { global: Limiter; perKey: Limiter };
  /** Lightning is deferred. Default false: lightning orders cannot be created, extended or settled. */
  lightningEnabled?: boolean;
  /** Pilot mode (default true): 7 day cap. */
  pilot?: boolean;
  /** Server-side bay allowlist (PILOT_RIG_ALLOWLIST). Empty = no capacity, fail closed. */
  bays: number[];
  /** BTC on-chain rail (btc/service.ts). Absent = BTC not wired (flag off): nothing about BTC is offered or accepted. */
  btc?: BtcDeps;
  /** Mirrors the rental_settle SQL commit cap (RENTALS_DB_COMMIT_CAP, default 4). */
  dbCommitCap?: number;
  /** Optional rail hook (Ethereum USDC, eth/wire.ts): true = keep this unpaid order open past its pay window for now. */
  expiryHold?: (o: Order) => Promise<boolean>;
  /**
   * Optional rail hook (Ethereum USDC, eth/wire.ts): true = another rail owns this order, so no NEW BTC binding (an
   * Ethereum quote exists). BTC and ETH are mutually exclusive per order (review #108). Throws = fail closed.
   */
  btcBlockedByOtherRail?: (orderId: string) => Promise<boolean>;
  /**
   * Optional rail hook (Ethereum USDC, eth/wire.ts): ids of orders whose payment is already sent on another rail and still
   * confirming (an unresolved Ethereum claim). Their rigs are held like BTC confirmation holds (SF8). Throws = fail closed.
   */
  railHeldOrders?: () => Promise<string[]>;
  /** B7 (RENTALS_AVAIL_GATE=1, default off): offer, hold and settle only bays the node reports fresh-free. */
  availGate?: boolean;
};
/** Refund network of a BTC ref: the env's bip122 chain (the binding's network is the same by construction). */
function btcRefNetwork(d: Deps): string { return btcNetworkForEnv(d.jobEnv ?? "staging") ?? "btc"; }
export const maxDaysFor = (d: Deps) => (d.pilot === false ? MAX_DAYS : PILOT_MAX_DAYS);
/**
 * Fleet capacity is data-driven (operator 2026-10-17: if the experiment works, every rig rents this way):
 * the bays are PILOT_RIG_ALLOWLIST, so expanding is a config change. The one backstop is the commit-lock
 * cap inside the rental_settle SQL (4 today); Deps.dbCommitCap mirrors
 * it (env RENTALS_DB_COMMIT_CAP, default 4) and is raised only together with that migration.
 */
export const DEFAULT_DB_COMMIT_CAP = PILOT_CAP_RIGS;
export const fleetCapacity = (d: Pick<Deps, "bays" | "dbCommitCap">) => Math.min(d.bays.length, d.dbCommitCap ?? DEFAULT_DB_COMMIT_CAP, SQL_COMMIT_CAP);
/** Per-order cap: limits.ts MAX_RIGS (one order), never more than the fleet. */
const maxRigsFor = (d: Deps) => Math.min(PILOT_CAP_RIGS, fleetCapacity(d));
/** B7: availability older than this (DB clock) is NOT free. */
export const AVAIL_MAX_AGE_S = 180;
/** B7: a bay lost to the marketplace race is substituted at most once, within this long after settlement. */
export const SUBSTITUTE_WINDOW_MS = 10 * 60_000;
/** B7: node reject reason when the marketplace rented the bay between settle and provisioning. */
export const BAY_TAKEN_MRR = "bay_taken_mrr";
const rentableBays = (d: Deps) => d.bays.slice(0, fleetCapacity(d));
/**
 * Fresh-free bays (B7). Gate off: the whole rentable allowlist (the pre-B7 behaviour). Gate on: only bays
 * the node reported free within AVAIL_MAX_AGE_S. Stale, missing or unreadable = not free (fail closed).
 */
export async function freeBaysFresh(d: Deps): Promise<number[]> {
  const allow = rentableBays(d);
  if (!d.availGate) return allow;
  try {
    const ok = new Set((await d.store.bayAvailability(AVAIL_MAX_AGE_S)).filter((r) => r.free && r.fresh).map((r) => r.bay));
    return allow.filter((b) => ok.has(b));
  } catch { return []; }
}
const usedBays = async (d: Deps, exceptOrder?: string) => {
  const used = new Set<number>();
  for (const o of await d.store.listOrders(COMMITTED_STATES)) if (o.id !== exceptOrder && o.bays) for (const b of o.bays.split(",")) used.add(Number(b));
  return used;
};
/** Free bays = fresh-free (B7, gate on) or allowlisted bays, minus bays held by committed orders (G4). */
export async function freeBays(d: Deps, exceptOrder?: string): Promise<number[]> {
  const used = await usedBays(d, exceptOrder);
  return (await freeBaysFresh(d)).filter((b) => !used.has(b));
}
/** G1/G2 (gate on): rigs we can still sell = free bays minus unpaid soft holds and BTC/ETH confirmation holds (#107 SF8), floored at 0. */
async function availableRigs(d: Deps, now: number): Promise<number> {
  return Math.max(0, (await freeBays(d)).length - (await d.store.rigsSoftHeld(now)) - (await confirmingHeldRigs(d, now)));
}
/** Earliest time a marketplace-rented bay frees up (a hint for "no rigs free"), or null. */
async function nextFreeAt(d: Deps): Promise<string | null> {
  try {
    const allow = new Set(rentableBays(d));
    const t = (await d.store.bayAvailability(AVAIL_MAX_AGE_S)).filter((r) => allow.has(r.bay) && r.fresh && r.mrrRentedUntil != null && r.mrrRentedUntil > d.now()).map((r) => r.mrrRentedUntil as number);
    return t.length ? new Date(Math.min(...t)).toISOString() : null;
  } catch { return null; }
}
const noCapacity = async (d: Deps, avail: number) => ({
  ...err("no_capacity", avail < 1 ? "No rigs are free right now. Please try again later." : `Only ${avail} ${avail === 1 ? "rig is" : "rigs are"} free right now. Try fewer rigs.`),
  available: avail, nextFreeAt: await nextFreeAt(d),
});
/**
 * G3: before any money moves on an initial payment, the free bays must still cover the order (gate on).
 * Others' unpaid soft holds don't count against it: the first to pay wins. Other orders' payments that are already sent
 * and still confirming (BTC SF8 holds, Ethereum claims) DO count: that money moved first. Extensions keep their bays.
 */
export async function payCapacity(d: Deps, ref: string): Promise<"ok" | "no_capacity"> {
  if (!d.availGate) return "ok";
  try {
    const b = await d.store.getBinding(ref);
    if (!b || b.kind !== "initial") return "ok";
    const o = await d.store.getOrder(b.orderId);
    if (!o || o.state !== "awaiting_payment") return "ok"; // payableState refuses it on its own
    return await orderCapacity(d, o);
  } catch { return "no_capacity"; }
}
/** G3 for one unpaid order (x402 payCapacity and the Ethereum bind): fresh-free bays minus OTHER orders' confirmation holds. Errors = no capacity. */
export async function orderCapacity(d: Deps, o: Pick<Order, "id" | "rigCount">): Promise<"ok" | "no_capacity"> {
  if (!d.availGate) return "ok";
  try {
    const free = (await freeBays(d, o.id)).length - (await confirmingHeldRigs(d, d.now(), o.id));
    return free >= o.rigCount ? "ok" : "no_capacity";
  } catch { return "no_capacity"; }
}
const TERMS = { version: RENTAL_TERMS_VERSION, url: RENTAL_TERMS_URL };

/** Bays shown to customers (B3): the rentable fleet (fleetCapacity), numbered 1..n, never a rig id. */
export type BayState = "open" | "rented" | "unavailable";
export type BayBoard = { bays: { bay: number; state: BayState; backAt?: string }[]; available: number; total: number };
/**
 * Bay board for /hashrate, checkoutView and list_available_rigs. Before the availability gate (B7)
 * a bay is "rented" when a committed order holds it and "open" otherwise. Customer bay numbers are
 * positions (1..n), not allowlist values.
 */
export async function bayBoard(d: Deps): Promise<BayBoard> {
  const allow = rentableBays(d);
  if (!d.availGate) {
    const free = new Set(await freeBays(d));
    const bays = allow.map((b, i) => ({ bay: i + 1, state: (free.has(b) ? "open" : "rented") as BayState }));
    return { bays, available: bays.filter((b) => b.state === "open").length, total: bays.length };
  }
  // B7 (gate on): open = fresh-free and not committed; rented = ours, or the marketplace/our own hold per a fresh
  // report (with "back at" when known); unavailable = stale, offline, killed, read error or no report.
  const used = await usedBays(d);
  let rows: Awaited<ReturnType<Deps["store"]["bayAvailability"]>> = [];
  try { rows = await d.store.bayAvailability(AVAIL_MAX_AGE_S); } catch { rows = []; }
  const byBay = new Map(rows.map((r) => [r.bay, r]));
  const now = d.now();
  const bays = allow.map((b, i) => {
    const r = byBay.get(b);
    if (used.has(b)) return { bay: i + 1, state: "rented" as BayState };
    if (r?.fresh && r.free) return { bay: i + 1, state: "open" as BayState };
    if (r?.fresh && (r.reason === "mrr_rented" || r.reason === "direct_active"))
      return { bay: i + 1, state: "rented" as BayState, ...(r.mrrRentedUntil != null && r.mrrRentedUntil > now ? { backAt: new Date(r.mrrRentedUntil).toISOString() } : {}) };
    return { bay: i + 1, state: "unavailable" as BayState };
  });
  const soft = await d.store.rigsSoftHeld(now).catch(() => 0);
  const open = bays.filter((b) => b.state === "open").length;
  // Confirmation holds (BTC SF8, Ethereum claims) are subtracted like soft holds; unreadable = nothing available (fail closed).
  const held = await confirmingHeldRigs(d, now).catch(() => open);
  return { bays, available: Math.max(0, open - soft - held), total: bays.length };
}

type Err = { ok: false; error: string; message: string };
const err = (error: string, message: string): Err => ({ ok: false, error, message });
// B5b: no "coming soon" rail announcements. An unreleased rail is simply unavailable.
const LN_SOON = err("rail_unavailable", "That payment rail is not available. Pay with USDC on Base (rail x402_usdc).");
/** The only way to reach a provider: lightning stays unreachable while the flag is off. */
export const railProvider = (d: Deps, rail: Rail): PaymentProvider | undefined => (rail === "lightning" && !d.lightningEnabled ? undefined : d.providers[rail]);
const hmac = (key: string, s: string) => crypto.createHmac("sha256", key).update(s, "utf8").digest("hex");
export const hmacCode = (code: string, key: string) => hmac(key, "code|" + code);
const deriveCode = (key: string, orderId: string, secret: string) =>
  crypto.createHmac("sha256", key).update("access|" + orderId + "|" + secret).digest("base64url").slice(0, 32);
const safeEq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const reqHash = (o: unknown) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex");

function limited(d: Deps, key: string): boolean {
  if (!d.limiter) return false;
  const now = d.now();
  return !d.limiter.global.ok("g", now) || !d.limiter.perKey.ok(key, now);
}

function challengeView(c: Challenge) {
  return c.rail === "lightning"
    ? { rail: "lightning" as const, paymentRef: c.providerRef, invoice: c.bolt11, amountSats: c.amountSats, expiresAt: new Date(c.expiresAt).toISOString() }
    : { rail: "x402_usdc" as const, paymentRef: c.providerRef, http402: c.x402, ...(c.alts?.length ? { accepts: [c.x402, ...c.alts] } : {}), expiresAt: new Date(c.expiresAt).toISOString() };
}

function orderView(o: Order) {
  return {
    rentalId: o.publicId, status: o.state, th: o.th, rigs: o.rigCount, days: o.days,
    pricePerPhDayBtc: o.priceBtcPhDay, totalSats: o.totalSats,
    totalUsdc: o.totalUsdcAtomic == null ? null : (o.totalUsdcAtomic / 1e6).toFixed(6),
    payBy: new Date(o.expiresAt).toISOString(),
    startsAt: o.startsAt ? new Date(o.startsAt).toISOString() : null,
    endsAt: o.endsAt ? new Date(o.endsAt).toISOString() : null,
    termsVersion: o.termsVersion,
    renterPool: { host: o.poolHost, port: o.poolPort, worker: o.worker },
    // manual = not on the pool catalog: held for the owner's approval after payment (up to 2 h, refunded if not approved).
    poolApproval: poolApproval(o.poolHost, o.poolPort),
  };
}

/** assertCustomerSafe for outputs that echo the renter's pool: their own payout address is masked for the scan only (pools.ts). */
function customerSafe<T extends { renterPool: { worker: string } }>(out: T): T {
  assertCustomerSafe({ ...out, renterPool: { ...out.renterPool, worker: maskRenterAddress(out.renterPool.worker) } });
  return out;
}

export async function getQuote(d: Deps, input: { rigs: unknown; days: unknown }) {
  const rigs = Number(input.rigs ?? 1), days = Number(input.days ?? 1), maxRigs = maxRigsFor(d), maxDays = maxDaysFor(d);
  if (maxRigs < 1) return err("no_capacity", "No rigs are available for rent right now.");
  if (!Number.isInteger(rigs) || rigs < 1 || rigs > maxRigs) return err("invalid_input", `rigs must be a whole number from 1 to ${maxRigs} (270 TH each).`);
  if (!Number.isInteger(days) || days < MIN_DAYS || days > maxDays) return err("invalid_input", (maxDays === PILOT_MAX_DAYS ? "days must be whole days, 1 to 7 days during the pilot, up to 30 later." : `days must be a whole number from ${MIN_DAYS} to ${maxDays}.`));
  // G1 (B7, gate on): only fresh-free bays minus committed and soft-held rigs can be quoted.
  if (d.availGate) { const avail = await availableRigs(d, d.now()); if (avail < rigs) return noCapacity(d, avail); }
  const price = priceOrder(await d.pricing(), rigs * RIG_TH, days, d.now());
  if (!price.ok) return err(price.error, price.error === "ask_out_of_band"
    ? "Market ask is more than 3x the floor, so pricing is refused right now."
    : "Pricing is unavailable right now.");
  let usdc: number, btc: number;
  try { btc = await d.btcUsd(); usdc = usdcAtomicFor(price.priceBtcPhDay, btc, rigs * RIG_TH, days); } catch { return err("pricing_unavailable", "Pricing is unavailable right now."); }
  // charge_btc = max(ask x 0.985, ceil_sat(floor x 1.03), listing minimum); USDC = ceil_cent(charge_btc x px). totalSats from priceOrder.
  return { ok: true as const, result: assertCustomerSafe({
    rigs, th: rigs * RIG_TH, days, priceBasis: "max_ask0.985_floor_x_1.03_min",
    pricePerPhDayBtc: price.priceBtcPhDay,
    pricePerPhDayUsdc: (Number(usdcPerPhDayCents(price.priceBtcPhDay, btc)) / 100).toFixed(2),
    totalSats: price.totalSats,
    btcUsd: btc, totalUsdc: (usdc / 1e6).toFixed(6),
    payment: { rail: "x402_usdc", asset: "USDC", network: payNetwork(d) },
    validMinutes: 15, terms: TERMS, next: "Call create_rental with accept_terms=true and terms_version to get the x402 payment request.",
  }) };
}

export async function createRental(d: Deps, input: CreateInput & { rail?: unknown; accept_terms?: unknown; terms_version?: unknown }) {
  if (input.accept_terms !== true) return { ...err("terms_not_accepted", `Read the Rental Terms at ${RENTAL_TERMS_URL} and call again with accept_terms=true and terms_version="${RENTAL_TERMS_VERSION}".`), terms: TERMS };
  if (input.terms_version !== RENTAL_TERMS_VERSION) return { ...err("terms_version_mismatch", `The current Rental Terms version is "${RENTAL_TERMS_VERSION}" (${RENTAL_TERMS_URL}).`), terms: TERMS };
  const v = validateCreate(input, maxDaysFor(d));
  if (!v.ok) return v;
  if (v.v.rigCount > maxRigsFor(d)) return err("cap_exceeded", maxRigsFor(d) < 1 ? "No rigs are available for rent right now." : `Only ${maxRigsFor(d)} rigs can be rented right now.`);
  if (input.rail === "lightning" && !d.lightningEnabled) return LN_SOON;
  if (input.rail !== undefined && input.rail !== "x402_usdc" && input.rail !== "lightning") return err("invalid_input", "rail must be x402_usdc.");
  const rail: Rail = input.rail === "lightning" ? "lightning" : "x402_usdc";
  const provider = railProvider(d, rail);
  if (!provider) return err("rail_unavailable", "That payment rail is not available.");
  if (await d.killSwitch()) return err("rentals_paused", "Rentals are paused right now.");
  const now = d.now();
  const rh = reqHash({ t: "create", th: v.v.th, days: v.v.days, h: v.v.host, p: v.v.port, w: v.v.worker, rail });

  const replay = async () => {
    const row = await d.store.getIdem(v.v.idemKey);
    if (!row) return null;
    if (row.tool !== "create_rental" || row.requestHash !== rh) return err("idempotency_conflict", "This idempotency_key was already used with different details.");
    const o = (await d.store.getOrder(row.orderId))!;
    // The create_rental challenge is the x402 one; an Ethereum binding (eth_ ref, human checkout) is never replayed here.
    const refs = await d.store.refsForOrder(o.id);
    const ref = refs.find((r) => !r.startsWith("eth_")) ?? refs[0];
    const b = ref ? await d.store.getBinding(ref) : null;
    // creator secret is never repeated on replay
    return { ok: true as const, replay: true, result: customerSafe({ ...orderView(o), payment: b?.challenge ?? null }) };
  };
  const prior = await replay();
  if (prior) return prior;

  if ((await d.store.rigsCommitted(now)) + (await d.store.rigsSoftHeld(now)) + (await confirmingHeldRigs(d, now)) + v.v.rigCount > fleetCapacity(d))
    return err("cap_exceeded", "Not enough rigs free in the pilot right now. Try fewer rigs or later.");
  // G2 (B7, gate on): the same fresh-free check as the quote, before any payment request exists.
  if (d.availGate) { const avail = await availableRigs(d, now); if (avail < v.v.rigCount) return noCapacity(d, avail); }
  const price = priceOrder(await d.pricing(), v.v.th, v.v.days, now);
  if (!price.ok) return err(price.error, price.error === "ask_out_of_band"
    ? "Market ask is more than 3x the floor, so no order was created."
    : "Pricing is unavailable right now, so no order was created.");
  let usdc: number | null = null;
  if (rail === "x402_usdc") {
    try { usdc = usdcAtomicFor(price.priceBtcPhDay, await d.btcUsd(), v.v.th, v.v.days); } catch { return err("pricing_unavailable", "Pricing is unavailable right now, so no order was created."); }
  }
  const id = crypto.randomUUID();
  const secret = crypto.randomBytes(24).toString("base64url");
  const order: Order = {
    id, publicId: "gm_" + crypto.randomBytes(9).toString("base64url"), idemKey: v.v.idemKey, rail,
    state: "awaiting_payment", rigCount: v.v.rigCount, th: v.v.th, days: v.v.days,
    priceBtcPhDay: price.priceBtcPhDay, floorBtcPhDay: price.floorBtcPhDay, totalSats: price.totalSats, totalUsdcAtomic: usdc,
    poolHost: v.v.host, poolPort: v.v.port, worker: v.v.worker,
    accessCodeHmac: hmacCode(deriveCode(d.codeHmacKey, id, secret), d.codeHmacKey),
    creatorSecretHmac: hmac(d.codeHmacKey, "creator|" + secret),
    createdAt: now, expiresAt: now + PAY_TTL_MS, startsAt: null, endsAt: null,
    termsVersion: RENTAL_TERMS_VERSION, termsAcceptedAt: now, bays: null, version: 0,
  };
  try { await d.store.insertOrder(order, { key: v.v.idemKey, tool: "create_rental", requestHash: rh, orderId: id, providerRef: null }); }
  catch (e) { if (e instanceof UniqueViolation) { const p = await replay(); if (p) return p; } throw e; }
  const amount = rail === "lightning" ? order.totalSats : (usdc as number);
  const ch = await provider.create({ orderRef: order.publicId, amountAtomic: amount, expiresAt: order.expiresAt });
  const view = challengeView(ch);
  await d.store.commit({ binding: { ref: ch.providerRef, b: { orderId: id, kind: "initial", expectedAtomic: amount, expiresAt: order.expiresAt, extendDays: null, challenge: view } } });
  return { ok: true as const, replay: false, result: customerSafe({
    ...orderView(order), payment: view, creatorSecret: secret,
    terms: TERMS,
    note: "A human or an x402-capable agent wallet pays this. Galaxy Mind never spends on your behalf. Keep creatorSecret private: it is shown once and is the only way to receive the access code."
      + (v.v.approval === "manual" ? " This pool is not on our catalog, so after payment it needs manual approval, which can take up to about 2 hours. If it is not approved, the payment is refunded." : ""),
    ...(poolNote(v.v.poolId) ? { poolNote: poolNote(v.v.poolId) } : {}),
  }) };
}

/**
 * The rail of the money on a ref (payments, refunds, jobs), from the REF, never the order (SF1): btc: refs are
 * btc_onchain, eth_ refs are eth_usdc (USDC on Ethereum, rev 1.8), anything else is the order's USDC/lightning rail.
 */
export function railOfRef(o: Pick<Order, "rail">, ref: string): Rail {
  if (ref.startsWith("btc:")) return "btc_onchain";
  if (/^eth_[0-9a-f]{32}$/.test(ref)) return "eth_usdc";
  return o.rail === "btc_onchain" || o.rail === "eth_usdc" ? "x402_usdc" : o.rail;
}
/** USDC money (any network): x402_usdc or eth_usdc. Refund totals, refundUsdc and statusBody count both as USDC. */
export const isUsdcRail = (r: Rail | string): boolean => r === "x402_usdc" || r === "eth_usdc";

/** network: the network the refunded money SETTLED on (review #101 S4), so the manual payout goes back on it. */
export function refundRow(o: Order, ref: string, seq: number, reason: RefundRecord["reason"], atomic: number, now: number, network: string | null = null): RefundRecord {
  // BTC refs ("btc:<uuid>") refund in sats on the binding's bip122 network (DB trigger fills it from btc_bindings too).
  // Rail and units come from the REF, never the order (SF1): an x402 ref on an order that later switched to the BTC rail
  // still refunds USDC atomic on its EVM network, and a btc: ref always refunds sats on its bip122 chain.
  const rail: RefundRecord["rail"] = railOfRef(o, ref);
  return { id: crypto.randomUUID(), orderId: o.id, providerRef: ref, seq, reason, atomic, rail, status: "pending_owner", at: now, network: rail === "lightning" ? null : network };
}
/**
 * SF8: rigs held by a BTC binding whose address was shown (or that already has money) while it waits for confirmations.
 * The order's 15-min USDC pay window (rigsSoftHeld) is shorter than 1-2 confirmations, so without this a USDC renter could
 * take the rigs and the BTC settle would refund cap_exceeded. Only orders past expiresAt are added (others are already
 * in rigsSoftHeld). Errors propagate: callers fail closed.
 */
export async function btcHeldRigs(d: Deps, now: number): Promise<number> {
  return heldRigsOf(d, now, await btcHeldOrderIds(d));
}
async function btcHeldOrderIds(d: Deps): Promise<string[]> {
  if (!d.btc) return [];
  const ids: string[] = [];
  for (const b of await d.btc.store.listBindings(["awaiting_payment", "seen", "underpaid"])) {
    if (b.status === "awaiting_payment" && b.displayOkAt == null) continue;
    ids.push(b.orderId);
  }
  return ids;
}
/** Each order once, and only unpaid orders past their pay window (inside it, rigsSoftHeld already counts them: no double count). */
async function heldRigsOf(d: Deps, now: number, ids: Iterable<string>, exceptOrder?: string): Promise<number> {
  let n = 0;
  for (const id of new Set(ids)) {
    if (id === exceptOrder) continue;
    const o = await d.store.getOrder(id);
    if (o && o.state === "awaiting_payment" && o.expiresAt <= now) n += o.rigCount;
  }
  return n;
}
/**
 * Rigs held by payments already sent and still confirming, on any rail: BTC bindings (SF8) and Ethereum claims
 * (Deps.railHeldOrders). An order is counted once even if both rails list it (they are mutually exclusive anyway).
 * Errors propagate: callers fail closed.
 */
export async function confirmingHeldRigs(d: Deps, now: number, exceptOrder?: string): Promise<number> {
  const ids = [...(await btcHeldOrderIds(d)), ...(d.railHeldOrders ? await d.railHeldOrders() : [])];
  return heldRigsOf(d, now, ids, exceptOrder);
}
/** #103 S2: a settlement read that FAILED (vs. "no settlement"): the refund goes to manual review, never a guessed network. */
export const NETWORK_READ_ERROR = "network_read_error" as const;
/** The settled network of an x402 ref (null if none / lightning); NETWORK_READ_ERROR if the read failed. */
async function settledNetwork(d: Deps, ref: string): Promise<string | null | typeof NETWORK_READ_ERROR> {
  try { return (await d.store.getSettlement(ref))?.network ?? null; } catch { return NETWORK_READ_ERROR; }
}

/** Server-side payTo of the bound challenge (never client input). */
const boundPayTo = (b: Binding | null | undefined): string | null => (b?.challenge as { http402?: { payTo?: string } } | undefined)?.http402?.payTo ?? null;
/** Decimal string for a BTC/PH/day floor (no floats in the signed payload). */
export const floorStr = (x: number) => x.toFixed(8);
/** x402 network from config (Deps.payNetwork, set from x402Net); never hard-coded at call sites. */
export function payNetwork(d: Pick<Deps, "payNetwork">): string { return d.payNetwork ?? BASE_SEPOLIA.network; }

/** network: the CAIP-2 network the payment SETTLED on (Lookup / the prior job), else the configured Base network. */
export function routeJob(d: Deps, o: Order, action: JobPayload["action"], ref: string, atomic: number, payTo: string | null = null, txHash: string | null = null, held?: boolean, heldDeadlineMs?: number, network: string | null = null, btcPayment: BtcJobPayment | null = null) {
  const btc = action !== "revert" && btcPayment != null;
  const usdc = action !== "revert" && !btc && isUsdcRail(o.rail);
  // rev 1.8: an eth_ ref's job carries rail eth_usdc (same x402-shaped payment; network is the Ethereum chain it settled on).
  const jobRail: X402JobPayment["rail"] = o.rail === "lightning" ? "lightning" : railOfRef(o, ref) === "eth_usdc" ? "eth_usdc" : "x402_usdc";
  const iat = Math.floor(d.now() / 1000);
  // A held order's route job lives < 10 min so the node never applies it with a stale start (pools.ts HELD_JOB_TTL_SEC),
  // and never past the held deadline (settlement + HELD_TIMEOUT_MS; default = now, i.e. settling right now):
  // no held route job is claimable after the site has expired and refunded the order (review #89 M1a).
  const isHeld = action === "route" && (held ?? poolApproval(o.poolHost, o.poolPort) === "manual");
  const exp = isHeld
    ? Math.min(iat + HELD_JOB_TTL_SEC, Math.floor((heldDeadlineMs ?? d.now() + HELD_TIMEOUT_MS) / 1000))
    : iat + JOB_MAX_TTL_SEC;
  const payload: JobPayload = {
    v: 1, job_id: crypto.randomUUID(), order_ref: o.publicId, action, rig_class: "s21xp", rig_count: o.rigCount, bays: o.bays ?? "",
    upstream: action === "revert" ? null : { host: o.poolHost, port: o.poolPort, user: o.worker },
    start: Math.floor((o.startsAt ?? d.now()) / 1000), end: Math.floor((o.endsAt ?? d.now()) / 1000),
    // rev 1.7: btc_onchain carries the BtcJobPayment verbatim (no pay_to / amount_usdc; top-level floor = the signed floor).
    payment: action === "revert" ? null : btc ? btcPayment : { rail: jobRail, provider_ref: ref, amount_atomic: String(atomic), tx_hash: isUsdcRail(o.rail) ? txHash : null, unit: o.rail === "lightning" ? "sat" : "usdc_6dp", network: o.rail === "lightning" ? "testnet" : (network ?? payNetwork(d)) },
    // From the server-side settlement (binding + facilitator settle) and the order's quote record.
    pay_to: usdc ? payTo : null,
    amount_usdc: usdc ? (atomic / 1e6).toFixed(6) : null,
    floor_btc_per_ph_day: btc ? btcPayment!.floor_btc_per_ph_day : floorStr(o.floorBtcPhDay),
    nonce: newNonce(), iat, exp, env: d.jobEnv ?? "staging",
  };
  return signJob(payload, d.signingKeyPem, d.signingKid);
}

/**
 * Called by webhook, sweeper or a poll. Safe to call any number of times
 * concurrently. Returns an outcome only; never the access code.
 */
export async function confirmPayment(d: Deps, ref: string): Promise<{ outcome: string }> {
  // BTC money is accepted only from signed agent events (btc/service.ts processBtcEvents), never by a provider lookup.
  if (ref.startsWith("btc:")) return { outcome: "btc_rail" };
  const bind = await d.store.getBinding(ref);
  if (!bind) return { outcome: "unknown_ref" };
  const o = (await d.store.getOrder(bind.orderId))!;
  const provider = railProvider(d, o.rail);
  if (!provider) return { outcome: "rail_unavailable" };
  const look = await provider.lookup(ref);
  if (!look.found) return { outcome: "unpaid" };
  if (look.boundRef !== o.publicId) return { outcome: "binding_mismatch" };
  // rev 1.5: never sign an x402 job without the settled tx hash. No hash = not money yet (fail closed).
  // Network-aware: Base = lowercase 0x hex; Solana = base58 signature. The network is the settled one from lookup().
  const settledNet = look.network ?? payNetwork(d);
  const txOk = validTxId(settledNet, look.txHash) ? (look.txHash as string) : null;
  // payTo: the stored requirement for the settled network (server-side), never client input.
  const payTo = look.payTo ?? boundPayTo(bind);
  if (isUsdcRail(o.rail) && look.receivedAtomic > 0 && !txOk) return { outcome: "no_tx_hash" };

  const now = d.now();
  const pays = await d.store.paymentsForRef(ref);
  const refunds = await d.store.refundsForRef(ref);
  const seen = pays.reduce((a, p) => a + p.deltaAtomic, 0);
  const refunded = refunds.reduce((a, r) => a + r.atomic, 0);
  const settled = pays.some((p) => p.settles);
  const received = look.receivedAtomic;
  if (received < seen) {
    await d.alerter?.send({ kind: "provider_amount_went_down", orderRef: o.publicId, at: now });
    return { outcome: "invalid" };
  }
  const late = (look.settledAt ?? now) > bind.expiresAt;
  const pay = (settles: boolean): PaymentRecord => ({
    id: `${ref}#${seen}`, orderId: o.id, kind: bind.kind, rail: railOfRef(o, ref), providerRef: ref, seq: seen,
    deltaAtomic: received - seen, cumulativeAtomic: received, expectedAtomic: bind.expectedAtomic, extendDays: bind.extendDays, settles, at: look.settledAt ?? now,
  });
  const outstanding = (applied: number) => received - applied - refunded;
  const c: Commit = {};
  let outcome = "unpaid";

  const refundAll = (reason: RefundRecord["reason"], applied: number) => {
    const amt = outstanding(applied);
    if (amt > 0) c.refunds = [refundRow(o, ref, refunded, reason, amt, now, look.network ?? null)];
  };
  const toRefundPending = () => {
    if (o.state === "awaiting_payment" || o.state === "expired") {
      c.order = { id: o.id, fromVersion: o.version, patch: { state: "refund_pending" } };
      c.events = [{ orderId: o.id, from: o.state, to: "refund_pending", actor: "payments", at: now }];
    }
  };

  if (settled) {
    // Money after this ref already settled: refund the excess only.
    refundAll("overpaid", bind.expectedAtomic);
    outcome = "already_settled";
  } else if (bind.kind === "initial") {
    if (o.state === "awaiting_payment" && !late) {
      if (received < bind.expectedAtomic) { outcome = received > 0 ? "underpaid_waiting" : "unpaid"; }
      else if (await d.killSwitch()) { refundAll("kill_switch", 0); toRefundPending(); outcome = "kill_switch"; }
      else if ((await d.store.rigsCommitted(now)) + o.rigCount > fleetCapacity(d) || (await freeBays(d, o.id)).length < o.rigCount) { refundAll("cap_exceeded", 0); toRefundPending(); outcome = "cap_exceeded"; }
      else {
        const startsAt = now, endsAt = now + o.days * 86_400_000;
        const bays = (await freeBays(d, o.id)).slice(0, o.rigCount).join(",");
        const n: Order = { ...o, state: "delivering", startsAt, endsAt, bays };
        c.order = { id: o.id, fromVersion: o.version, patch: { state: "delivering", startsAt, endsAt, bays } };
        c.job = routeJob(d, n, "route", ref, bind.expectedAtomic, payTo, txOk, undefined, undefined, settledNet);
        c.events = [{ orderId: o.id, from: o.state, to: "paid", actor: "payments", at: now }, { orderId: o.id, from: "paid", to: "delivering", actor: "jobs", at: now }];
        refundAll("overpaid", bind.expectedAtomic);
        outcome = "settled";
      }
    } else if (received === 0 && (o.state === "awaiting_payment" || o.state === "expired")) {
      outcome = "unpaid"; // nothing arrived: an expired order stays expired
    } else if (o.state === "awaiting_payment" || o.state === "expired" || o.state === "refund_pending") {
      refundAll(received < bind.expectedAtomic ? "underpaid" : "late", 0); toRefundPending(); outcome = received < bind.expectedAtomic ? "underpaid" : "late";
    } else { refundAll("duplicate", 0); outcome = "duplicate"; }
  } else {
    // An extension only applies while the rental is still running AND its end time hasn't passed
    // when the money settled. An active-but-unswept rental past its end is treated as not running,
    // so money that slipped in anyway is refunded instead of extending from the stale end (the
    // renter would lose the gap). X402Provider.orderPayable refuses these before any money moves.
    const ended = o.endsAt != null && (look.settledAt ?? now) >= o.endsAt;
    const running = (o.state === "active" || o.state === "delivering") && !ended;
    const ttlOver = now > bind.expiresAt;
    if (running && !late && !ttlOver && received < bind.expectedAtomic) { outcome = received > 0 ? "underpaid_waiting" : "unpaid"; }
    else if (running && !late && ttlOver && received < bind.expectedAtomic && received === 0) { outcome = "unpaid"; }
    else if (!running || late || (ttlOver && received < bind.expectedAtomic)) { refundAll(received < bind.expectedAtomic ? "underpaid" : "late", 0); outcome = "late"; }
    else if (await d.killSwitch()) { refundAll("kill_switch", 0); outcome = "kill_switch"; }
    else if (o.days + (bind.extendDays ?? 0) > maxDaysFor(d)) { refundAll("cap_exceeded", 0); outcome = "cap_exceeded"; }
    else {
      const days = o.days + (bind.extendDays ?? 0);
      const endsAt = (o.endsAt ?? now) + (bind.extendDays ?? 0) * 86_400_000;
      c.order = { id: o.id, fromVersion: o.version, patch: { days, endsAt } };
      c.job = routeJob(d, { ...o, days, endsAt }, "extend", ref, bind.expectedAtomic, payTo, txOk, undefined, undefined, settledNet);
      refundAll("overpaid", bind.expectedAtomic);
      outcome = "extended";
    }
  }

  const moneyChanged = received > seen;
  const settling = outcome === "settled" || outcome === "extended";
  if (moneyChanged || settling) c.payment = pay(settling);
  if (!c.payment && !c.order && !c.refunds) return { outcome };
  if (c.refunds?.length || ["kill_switch", "cap_exceeded", "late", "underpaid", "duplicate"].includes(outcome)) c.alerts = [{ kind: "refund_" + outcome, orderRef: o.publicId, at: now }];
  try { await d.store.commit(c); }
  catch (e) {
    const why = e instanceof CapExceeded ? "cap_exceeded" as const : e instanceof KillSwitchError ? "kill_switch" as const : null;
    if (why && (outcome === "settled" || outcome === "extended")) {
      // Lost the race under the commit lock (cap taken or rentals switched off): refund instead.
      const r: Commit = { payment: pay(false), events: [], alerts: [{ kind: "refund_" + why, orderRef: o.publicId, at: now }] };
      const amt = outstanding(0);
      if (amt > 0) r.refunds = [refundRow(o, ref, refunded, why, amt, now, look.network ?? null)];
      if (o.state === "awaiting_payment") { r.order = { id: o.id, fromVersion: o.version, patch: { state: "refund_pending" } }; r.events = [{ orderId: o.id, from: o.state, to: "refund_pending", actor: "payments", at: now }]; }
      // Lost a second race: write nothing and report "retry" (see the note below).
      try { await d.store.commit(r); } catch (e2) { if (e2 instanceof StaleVersion || e2 instanceof UniqueViolation) return { outcome: "retry" }; throw e2; }
      for (const a of r.alerts ?? []) await d.alerter?.send(a);
      return { outcome: why };
    }
    // "retry" is NOT a failure of the payment. Typical cause: the renter cancelled (or the sweep
    // moved the order) while the facilitator was settling, so this commit's version check lost.
    // The money is already settled and recorded (rental_x402_settlements); nothing was decided here.
    // POST /api/rentals/pay/<ref> therefore still answers 200 { success: true, outcome: "retry",
    // transaction } and the next confirmPayment (sweep / poller / access check) resolves the order:
    // a cancelled order ends in refund_pending with one pending_owner refund and no job.
    // Clients must treat outcome "retry" as "paid, still being processed", never as unpaid.
    if (e instanceof StaleVersion || e instanceof UniqueViolation) return { outcome: "retry" };
    throw e;
  }
  for (const a of c.alerts ?? []) await d.alerter?.send(a);
  return { outcome };
}

export async function markDelivered(d: Deps, publicId: string) {
  const o = await d.store.getOrderByPublicId(publicId);
  if (!o || o.state !== "delivering") return { ok: false };
  try { await d.store.commit({ order: { id: o.id, fromVersion: o.version, patch: { state: "active" } }, events: [{ orderId: o.id, from: o.state, to: "active", actor: "node", at: d.now() }] }); }
  catch (e) { if (e instanceof StaleVersion) return { ok: false }; throw e; }
  return { ok: true };
}

/**
 * opts.countLimit (default true) charges the per-ID lookup limiter. Pass false only for a re-read of a
 * rental the same request already looked up (and charged) with the right secret, so one request uses
 * one slot (review S5). Access-code lookups always count.
 */
export async function getRental(d: Deps, input: { access_code?: unknown; rental_id?: unknown; creator_secret?: unknown }, opts: { countLimit?: boolean } = {}) {
  const code = typeof input.access_code === "string" ? input.access_code.trim() : "";
  const now = d.now();
  if (code) {
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(code)) return err("invalid_input", "That access code is not valid.");
    const h = hmacCode(code, d.codeHmacKey);
    if (limited(d, "code:" + h.slice(0, 16))) return err("rate_limited", "Too many lookups. Try again in a minute.");
    const o = await d.store.getOrderByCodeHmac(h);
    if (!o || !RUNNING.concat(["completed", "failed"]).includes(o.state)) return err("not_found", "No rental matches that.");
    if (o.endsAt != null && now > o.endsAt + CODE_GRACE_MS) return err("code_expired", "That access code has expired.");
    return { ok: true as const, result: customerSafe(orderView(o)) };
  }
  const rid = typeof input.rental_id === "string" ? input.rental_id : "";
  if (!/^gm_[A-Za-z0-9_-]{8,20}$/.test(rid)) return err("invalid_input", "Give the access_code, or the rental_id (with creator_secret to collect the code).");
  if (opts.countLimit !== false && limited(d, "rid:" + rid)) return err("rate_limited", "Too many lookups. Try again in a minute.");
  const o = await d.store.getOrderByPublicId(rid);
  if (!o) return err("not_found", "No rental matches that.");
  const secret = typeof input.creator_secret === "string" ? input.creator_secret : "";
  if (secret && safeEq(hmac(d.codeHmacKey, "creator|" + secret), o.creatorSecretHmac)) {
    const paid = RUNNING.includes(o.state) || o.state === "completed";
    if (paid && !(o.endsAt != null && now > o.endsAt + CODE_GRACE_MS)) {
      return { ok: true as const, result: customerSafe({ ...orderView(o), accessCode: deriveCode(d.codeHmacKey, o.id, secret), accessCodeNote: "Use this for status and extend. Keep it private." }) };
    }
    return { ok: true as const, result: customerSafe(orderView(o)) };
  }
  // Without a secret: coarse state only.
  return { ok: true as const, result: assertCustomerSafe({ rentalId: o.publicId, status: o.state }) };
}

export async function extendRental(d: Deps, input: { access_code: unknown; days: unknown; idempotency_key: unknown }) {
  const code = String(input.access_code ?? "").trim();
  const days = Number(input.days);
  const key = String(input.idempotency_key ?? "");
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(code)) return err("invalid_input", "That access code is not valid.");
  if (!Number.isInteger(days) || days < 1) return err("invalid_input", "days must be a whole number of at least 1.");
  if (!IDEM_RE.test(key)) return err("invalid_input", "idempotency_key must be 16 to 64 characters.");
  const h = hmacCode(code, d.codeHmacKey);
  if (limited(d, "code:" + h.slice(0, 16))) return err("rate_limited", "Too many requests. Try again in a minute.");
  const o = await d.store.getOrderByCodeHmac(h);
  if (!o) return err("not_found", "No rental matches that.");
  const rh = reqHash({ t: "extend", o: o.id, days });
  const replay = async () => {
    const row = await d.store.getIdem(key);
    if (!row) return null;
    if (row.tool !== "extend_rental" || row.requestHash !== rh) return err("idempotency_conflict", "This idempotency_key was already used with different details.");
    const b = await d.store.getBinding(row.providerRef!);
    return { ok: true as const, replay: true, result: assertCustomerSafe({ rentalId: o.publicId, extendDays: days, payment: b?.challenge ?? null }) };
  };
  const prior = await replay();
  if (prior) return prior;
  if (await d.killSwitch()) return err("rentals_paused", "Rentals are paused right now.");
  if (o.state !== "active" && o.state !== "delivering") return err("not_extendable", "Only a running rental can be extended.");
  if (o.days + days > maxDaysFor(d)) return err("cap_exceeded", `Rentals are capped at ${maxDaysFor(d)} days in the pilot.`);
  if (o.rail === "lightning" && !d.lightningEnabled) return LN_SOON;
  const provider = railProvider(d, o.rail);
  if (!provider) return err("rail_unavailable", "That payment rail is not available.");
  const price = priceOrder(await d.pricing(), o.th, days, d.now());
  if (!price.ok) return err(price.error, price.error === "ask_out_of_band"
    ? "Market ask is more than 3x the floor, so pricing is refused right now."
    : "Pricing is unavailable right now.");
  let amount: number;
  try { amount = o.rail === "lightning" ? price.totalSats : usdcAtomicFor(price.priceBtcPhDay, await d.btcUsd(), o.th, days); } catch { return err("pricing_unavailable", "Pricing is unavailable right now."); }
  const expiresAt = d.now() + PAY_TTL_MS;
  const ch = await provider.create({ orderRef: o.publicId, amountAtomic: amount, expiresAt });
  const view = challengeView(ch);
  const b: Binding = { orderId: o.id, kind: "extension", expectedAtomic: amount, expiresAt, extendDays: days, challenge: view };
  try { await d.store.commit({ binding: { ref: ch.providerRef, b }, idem: { key, tool: "extend_rental", requestHash: rh, orderId: o.id, providerRef: ch.providerRef } }); }
  catch (e) { if (e instanceof UniqueViolation) { const p = await replay(); if (p) return p; } throw e; }
  return { ok: true as const, replay: false, result: assertCustomerSafe({ rentalId: o.publicId, extendDays: days, payment: view }) };
}

/** Node job-result reason: it could not confirm a Solana payment (G6). */
export const SOL_MAYBE_PAID = "sol_maybe_paid";
/** G6: re-check a Solana settlement at finalized; the alert kind names the result. Never refunds. */
async function solMaybePaidCheck(d: Deps, ref: string): Promise<string> {
  const xp = d.providers.x402_usdc;
  const v = xp instanceof X402Provider ? await xp.verifySettledSolana(ref).catch(() => null) : null;
  return v === true ? "sol_maybe_paid_verified" : v === false ? "sol_maybe_paid_unverified" : "sol_maybe_paid_unchecked";
}

/** FB1: a pending Solana signature unresolved this long gets one ntfy alert and goes to manual review. */
export const PENDING_ALERT_MS = 10 * 60_000;
/** #103 S5: wall-clock budget for one sweepPending pass (the sweep route has maxDuration 60); the rest waits for the next run. */
export const SWEEP_PENDING_BUDGET_MS = 20_000;
/**
 * FB1: every sweep re-checks ALL unresolved pending Solana signatures, whatever the order's state. Settled -> the
 * order is confirmed from the verified settlement; lost_race -> manual review (alerted in resolvePending); dropped ->
 * the ref can take a payment again; still unresolved after PENDING_ALERT_MS -> one alert + manual review. Never
 * creates a refund from a pending row.
 */
export async function sweepPending(d: Deps, opts: { budgetMs?: number; clock?: () => number } = {}): Promise<{ checked: number; settled: number; dropped: number; alerted: number; total: number; deferred: number }> {
  const out = { checked: 0, settled: 0, dropped: 0, alerted: 0, total: 0, deferred: 0 };
  const clock = opts.clock ?? Date.now, t0 = clock(), budget = opts.budgetMs ?? SWEEP_PENDING_BUDGET_MS;
  const xp = d.providers.x402_usdc;
  if (!(xp instanceof X402Provider)) return out;
  const send = async (kind: string, orderRef: string) => {
    const a = { kind, orderRef, at: d.now() };
    try { await d.store.commit({ alerts: [a] }); } catch { /* outbox best effort */ }
    await d.alerter?.send(a);
  };
  let page;
  try { page = await d.store.listUnresolvedPending(); } catch { await send("solana_pending_read_failed", "sweep"); return out; }
  out.total = page.total;
  // #103 B1: the list is capped server-side (oldest first); a full page means some rows wait for a later sweep.
  if (page.total >= PENDING_LIST_CAP) await send("solana_pending_list_capped", "sweep");
  for (const p of page.rows) {
    if (clock() - t0 >= budget) { out.deferred = page.rows.length - out.checked; break; }   // S5: next run continues (oldest first)
    out.checked++;
    const b = await d.store.getBinding(p.providerRef).catch(() => null);
    const o = b ? await d.store.getOrder(b.orderId).catch(() => null) : null;
    const orderRef = o?.publicId ?? "unknown";
    let r: string;
    try { r = await xp.resolvePending(p); } catch { r = "unresolved"; }
    if (r === "settled") { out.settled++; await confirmPayment(d, p.providerRef).catch(() => null); continue; }
    if (r === "dropped" || r === "failed_onchain") { out.dropped++; continue; }
    if (r === "lost_race") continue;
    if (d.now() - p.at >= PENDING_ALERT_MS && !(p.outcomes ?? []).includes("alerted")) {
      try {
        await d.store.recordPendingResolution({ txHash: p.txHash, outcome: "alerted", detail: null, at: d.now() });
        await d.store.recordPendingResolution({ txHash: p.txHash, outcome: "manual_review", detail: r === "rail_off" ? "rail_off" : "stuck", at: d.now() });
      } catch { /* alert anyway */ }
      await send("solana_pending_stuck", orderRef); out.alerted++;
    }
  }
  return out;
}

/** Sweeper: expire unpaid orders past TTL, then refund any money already seen on their refs. */
/** Sweep cadence (vercel.json: every 5 minutes); paidInLastWindow counts each aligned window once. */
export const SWEEP_WINDOW_MS = 5 * 60_000;
/**
 * Funnel (review #106 F1): initial payments that settled in the previous aligned sweep window
 * [W - 5 min, W), W = now floored to 5 min. Web and agent payments alike; read-only, counts only.
 * A run that is skipped or late can miss a window (an analytics count, never money).
 */
export async function paidInLastWindow(d: Deps, now: number = d.now()): Promise<number> {
  const end = Math.floor(now / SWEEP_WINDOW_MS) * SWEEP_WINDOW_MS, start = end - SWEEP_WINDOW_MS;
  let n = 0;
  for (const o of await d.store.listOrders(COMMITTED_STATES)) {
    for (const ref of await d.store.refsForOrder(o.id)) {
      if ((await d.store.paymentsForRef(ref)).some((p) => p.kind === "initial" && p.settles && p.at >= start && p.at < end)) { n++; break; }
    }
  }
  return n;
}

export async function sweepExpired(d: Deps) {
  let n = 0;
  for (const o of await d.store.listOrders(["awaiting_payment"])) {
    if (o.expiresAt > d.now()) continue;
    // A live BTC binding holds the order past the x402 pay window: it expires with the binding (confirm_by_height, S10).
    if (d.btc) { try { if (await d.btc.store.hasLiveBinding(o.id)) continue; } catch { continue; } }
    if (d.expiryHold && (await d.expiryHold(o).catch(() => true))) continue;   // a payment on another rail is still confirming
    try { await d.store.commit({ order: { id: o.id, fromVersion: o.version, patch: { state: "expired" } }, events: [{ orderId: o.id, from: o.state, to: "expired", actor: "sweeper", at: d.now() }] }); n++; }
    catch (e) { if (!(e instanceof StaleVersion)) throw e; }
    for (const ref of await d.store.refsForOrder(o.id)) await confirmPayment(d, ref);
  }
  for (const o of await d.store.listOrders(["delivering"])) await reofferOrExpire(d, o);
  for (const o of await d.store.listOrders(["failed", "completed", "refund_pending", "expired_unapplied", "refunded"])) await reofferRevert(d, o);
  // Running orders: an extension ref past its TTL with partial money is refunded (never left waiting).
  for (const o of await d.store.listOrders(["delivering", "active", "completed", "failed"])) {
    for (const ref of await d.store.refsForOrder(o.id)) {
      const b = await d.store.getBinding(ref);
      if (b?.kind === "extension" && b.expiresAt <= d.now()) await confirmPayment(d, ref);
    }
  }
  // #103 S5: pending Solana signatures last, under their own time budget, so the expiry work above always runs.
  await sweepPending(d);
  return n;
}

export async function ownedOrder(d: Deps, input: { rental_id?: unknown; creator_secret?: unknown }) { return ownOrder(d, input); }
async function ownOrder(d: Deps, input: { rental_id?: unknown; creator_secret?: unknown }) {
  const rid = typeof input.rental_id === "string" ? input.rental_id : "";
  const secret = typeof input.creator_secret === "string" ? input.creator_secret : "";
  if (!/^gm_[A-Za-z0-9_-]{8,20}$/.test(rid) || !secret) return err("invalid_input", "Give rental_id and creator_secret from create_rental.");
  if (limited(d, "rid:" + rid)) return err("rate_limited", "Too many requests. Try again in a minute.");
  const o = await d.store.getOrderByPublicId(rid);
  if (!o || !safeEq(hmac(d.codeHmacKey, "creator|" + secret), o.creatorSecretHmac)) return err("not_found", "No rental matches that.");
  return { ok: true as const, o };
}

/** Renter status: state, start/end, delivered TH (latest node 'delivered' result). Needs creator_secret. */
export async function getRentalStatus(d: Deps, input: { rental_id?: unknown; creator_secret?: unknown }) {
  const r = await ownOrder(d, input);
  if (!r.ok) return r;
  return { ok: true as const, result: await statusBody(d, r.o) };
}

/**
 * B2: the same status body, looked up by the private access code (rental_status and the site
 * "Check a rental" box). One limiter slot per lookup, the same key getRental charges.
 */
export async function getRentalStatusByCode(d: Deps, accessCode: string) {
  const code = accessCode.trim();
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(code)) return err("invalid_input", "That access code is not valid.");
  const h = hmacCode(code, d.codeHmacKey);
  if (limited(d, "code:" + h.slice(0, 16))) return err("rate_limited", "Too many lookups. Try again in a minute.");
  const o = await d.store.getOrderByCodeHmac(h);
  if (!o || !RUNNING.concat(["completed", "failed", "expired_unapplied"]).includes(o.state)) return err("not_found", "No rental matches that.");
  if (o.endsAt != null && d.now() > o.endsAt + CODE_GRACE_MS) return err("code_expired", "That access code has expired.");
  return { ok: true as const, result: await statusBody(d, o) };
}

async function statusBody(d: Deps, o: Order) {
  const res = (await d.store.resultsForOrder(o.publicId)).sort((a, b) => a.at - b.at);
  const last = [...res].reverse().find((x) => x.result === "delivered" && x.deliveredTh != null);
  const applied = res.some((x) => x.result === "applied" || x.result === "delivered");
  const rejection = [...res].reverse().find((x) => x.result === "rejected");
  const approval = poolApproval(o.poolHost, o.poolPort);
  const awaitingApproval = o.state === "delivering" && !applied && !rejection && (approval === "manual" || res.some((x) => x.result === "pending_approval"));
  const payRefs = await d.store.refsForOrder(o.id);
  let refundedAtomic = 0, refundedSats = 0;
  for (const ref of payRefs) for (const x of await d.store.refundsForRef(ref)) { if (x.rail === "btc_onchain") refundedSats += x.atomic; else refundedAtomic += x.atomic; }
  return assertCustomerSafe({
    rentalId: o.publicId, status: o.state, rigs: o.rigCount, th: o.th, days: o.days,
    startsAt: o.startsAt ? new Date(o.startsAt).toISOString() : null,
    endsAt: o.endsAt ? new Date(o.endsAt).toISOString() : null,
    deliveredTh: last ? last.deliveredTh : null,
    deliveredAt: last ? new Date(last.at).toISOString() : null,
    refundPendingUsdc: refundedAtomic > 0 && o.rail !== "lightning" ? (refundedAtomic / 1e6).toFixed(6) : null,
    ...(refundedSats > 0 ? { refundPending: { amountSats: refundedSats } } : {}),
    refundDue: o.state === "expired_unapplied",
    poolApproval: approval,
    awaitingPoolApproval: awaitingApproval,
    // Renter-facing set only (review #89 S2): internal node reasons show as not_provisioned.
    rejectedReason: rejection ? renterRejectReason(rejection.reason ?? null) ?? "not_provisioned" : null,
    note: o.state === "failed" && rejection?.reason === BAY_TAKEN_MRR && !applied
      ? `We couldn't start your rigs. A full refund is queued and will be sent manually. Questions: ${SUPPORT_EMAIL}`
      : o.state === "expired_unapplied"
      ? (approval === "manual" ? `Payment settled but your pool was not approved and switched in time. A full refund is due and will be sent manually. Questions: ${SUPPORT_EMAIL}` : `Payment settled but the rigs were not switched within 30 minutes. A full refund is due and will be sent manually. Questions: ${SUPPORT_EMAIL}`)
      : awaitingApproval ? HELD_NOTE : undefined,
    termsVersion: o.termsVersion,
  });
}

/**
 * Renter cancel, per the Rental Terms: unpaid = nothing owed; paid = pro-rata
 * refund of the paid time not used (whole order if not started), queued for
 * the operator's approval (status pending_owner). Running rigs get a signed revert job.
 */
export async function cancelRental(d: Deps, input: { rental_id?: unknown; creator_secret?: unknown }) {
  const r = await ownOrder(d, input);
  if (!r.ok) return r;
  const o = r.o, now = d.now();
  if (o.state === "awaiting_payment") {
    if (d.btc) {
      // BTC: an underpaid binding has money in flight -> refunded (or topped up) at confirm_by, not cancelled here.
      // Other live bindings are closed (expired/cancelled); a payment that lands later is refunded as a duplicate.
      const live = (await d.btc.store.bindingsForOrder(o.id)).filter((b) => !["refused", "expired"].includes(b.status));
      if (live.some((b) => b.status !== "awaiting_attest" && b.status !== "awaiting_payment")) return err("not_cancellable", "A Bitcoin payment for this order is already in progress. Wait for it to confirm or be refunded.");
      for (const b of live) if (!(await d.btc.store.updateBinding(b.bindingId, b.version, { status: "expired", statusReason: "cancelled" }))) return err("retry", "Try again.");
    }
    try { await d.store.commit({ order: { id: o.id, fromVersion: o.version, patch: { state: "expired" } }, events: [{ orderId: o.id, from: o.state, to: "expired", actor: "renter", at: now }] }); }
    catch (e) { if (e instanceof StaleVersion) return err("retry", "Try again."); throw e; }
    for (const ref of await d.store.refsForOrder(o.id)) await confirmPayment(d, ref); // money that raced in is refunded
    return { ok: true as const, result: assertCustomerSafe({ rentalId: o.publicId, status: "expired", cancelled: true, refundUsdc: null, note: "Cancelled before payment. Nothing is owed." }) };
  }
  if (!RUNNING.includes(o.state)) return err("not_cancellable", "This rental has already ended.");
  // Held orders (custom pool waiting for the owner's approval) can't be cancelled until the
  // hold resolves: an approval racing the cancel could otherwise start a refunded rental
  // (review #89 M1b). Not approved = expired_unapplied with a full refund, automatically.
  const results = o.state === "delivering" ? await d.store.resultsForOrder(o.publicId) : [];
  const appliedAny = results.some((x) => x.result === "applied" || x.result === "delivered");
  if (o.state === "delivering" && !appliedAny && !results.some((x) => x.result === "rejected")
      && (poolApproval(o.poolHost, o.poolPort) === "manual" || results.some((x) => x.result === "pending_approval"))) {
    return err("awaiting_pool_approval", "Awaiting pool approval; refunded in full if not approved. This order can't be cancelled until the approval check finishes (up to about 2 hours).");
  }
  let paid = 0, initialRef: string | null = null, refundedOnRef = 0;
  const nets = new Set<string>();
  let netReadFailed = false;   // #103 S2
  for (const ref of await d.store.refsForOrder(o.id)) {
    const b = await d.store.getBinding(ref);
    const settled = (await d.store.paymentsForRef(ref)).some((p) => p.settles);
    if (settled) {
      paid += b?.expectedAtomic ?? 0;
      const n = ref.startsWith("btc:") ? btcRefNetwork(d) : isUsdcRail(o.rail) ? await settledNetwork(d, ref) : o.rail;
      if (n === NETWORK_READ_ERROR) netReadFailed = true; else if (n) nets.add(n);
    }
    // The settled initial ref wins over an abandoned one (a refused BTC binding or an unused x402 challenge).
    if (b?.kind === "initial" && (settled || !initialRef)) { initialRef = ref; refundedOnRef = (await d.store.refundsForRef(ref)).reduce((a, x) => a + x.atomic, 0); }
  }
  if (!initialRef) return err("retry", "Try again.");
  const total = o.startsAt != null && o.endsAt != null ? o.endsAt - o.startsAt : 1;
  const unused = o.startsAt != null && o.endsAt != null ? Math.max(0, Math.min(total, o.endsAt - now)) : total;
  // Nothing applied yet on a delivering order = no hashrate delivered: full refund (review #89 S4).
  const neverApplied = o.state === "delivering" && !appliedAny;
  const refund = neverApplied ? Math.max(0, paid - refundedOnRef) : Math.floor((paid * unused) / total);
  const to: OrderState = o.state === "paid" ? "refund_pending" : o.state === "delivering" ? "failed" : "completed";
  const c: Commit = {
    order: { id: o.id, fromVersion: o.version, patch: { state: to, endsAt: o.state === "active" ? now : o.endsAt } },
    events: [{ orderId: o.id, from: o.state, to, actor: "renter", at: now }],
    alerts: [{ kind: "refund_cancelled", orderRef: o.publicId, at: now }],
  };
  // FB2: paid on more than one network (e.g. initial on Base, extension on Solana) -> no automatic refund row: one row
  // on the initial ref would send everything back on one network. A person splits it (refund_manual_review).
  // G6: the node reported sol_maybe_paid -> manual review too (re-checked at finalized first), never an automatic row.
  const solMaybe = (o.state === "delivering" ? results : await d.store.resultsForOrder(o.publicId)).some((x) => x.result === "rejected" && x.reason === SOL_MAYBE_PAID);
  // #103 S2: a failed settlement read never guesses (null) the refund network: manual review instead.
  const initialNet = refund > 0 && initialRef.startsWith("btc:") ? btcRefNetwork(d) : refund > 0 && isUsdcRail(o.rail) ? await settledNetwork(d, initialRef) : null;
  if (initialNet === NETWORK_READ_ERROR) netReadFailed = true;
  const manualRefund = refund > 0 && (nets.size > 1 || solMaybe || netReadFailed);
  if (refund > 0 && !manualRefund) c.refunds = [refundRow(o, initialRef, refundedOnRef, "cancelled", refund, now, initialNet === NETWORK_READ_ERROR ? null : initialNet)];
  if (manualRefund) {
    c.alerts!.push({ kind: "refund_manual_review", orderRef: o.publicId, at: now });
    if (solMaybe) c.alerts!.push({ kind: await solMaybePaidCheck(d, initialRef), orderRef: o.publicId, at: now });
  }
  if (o.state !== "paid" && o.bays) c.job = routeJob(d, { ...o, endsAt: now }, "revert", initialRef, 0);
  try { await d.store.commit(c); }
  catch (e) { if (e instanceof StaleVersion || e instanceof UniqueViolation) return err("retry", "Try again."); throw e; }
  for (const a of c.alerts ?? []) await d.alerter?.send(a);
  return { ok: true as const, result: assertCustomerSafe({
    rentalId: o.publicId, status: to, cancelled: true,
    refundUsdc: isUsdcRail(o.rail) ? (refund / 1e6).toFixed(6) : null,
    ...(o.rail === "btc_onchain" ? { refund: { amountSats: refund } } : {}),
    note: refund > 0 ? (manualRefund
      ? "Pro-rata refund of the unused paid time, per the Rental Terms. Your payments need a manual check first, then the refund is sent manually."
      : "Pro-rata refund of the unused paid time, per the Rental Terms. It is reviewed and sent manually.") : "No unused paid time to refund.",
    terms: TERMS,
  }) };
}

/**
 * Re-offer (rev 1.5). A settled order (delivering) with no applied/delivered
 * result whose latest route job has expired is re-signed with a fresh nonce and
 * job_id, the SAME order_ref and payment (tx_hash, amount, pay_to). The node
 * dedupes on order_ref|action|tx_hash, so a re-offer can never apply twice.
 * 30 min after settlement with still nothing applied: expired_unapplied,
 * a refund_due row (pending_owner; never sent automatically), a revert job for
 * safety, an outbox alert and an ntfy alert to gm-alerts. No more re-offers.
 *
 * Held orders (outside pools): an order whose pool is not on the catalog
 * (poolApproval "manual", the same test the node uses to hold it), or one the
 * node marked with a non-final 'pending_approval' result, waits for the
 * owner's approval. It gets HELD_TIMEOUT_MS (2 h 15 min) from settlement
 * instead of 30 min, unless the node already wrote a 'rejected' result for
 * it (refused, timed out, conflict, bad pool), which ends the hold at the
 * normal 30 min. Each re-sign of a held order shifts the window to start = now
 * and end = now + (end - start), keeping the exact duration in seconds, and
 * moves the order's startsAt/endsAt with it in the same version-checked commit.
 * 'pending_approval' is never terminal: it is not 'applied' or 'delivered'.
 */
export async function reofferOrExpire(d: Deps, o: Order): Promise<"none" | "applied" | "reoffered" | "waiting" | "expired_unapplied" | "bay_unavailable"> {
  if (o.state !== "delivering" || o.startsAt == null) return "none";
  const results = await d.store.resultsForOrder(o.publicId);
  if (results.some((r) => r.result === "applied" || r.result === "delivered")) return "applied";
  const routes = (await d.store.listJobs(o.publicId)).filter((j) => j.payload.action === "route");
  const last = routes[routes.length - 1];
  if (!last?.payload.payment) return "none";
  const now = d.now(), pm = last.payload.payment;
  // B7: the node found the bay rented on the marketplace before it could switch it. Substitute once or refund.
  if (results.some((r) => r.result === "rejected" && r.reason === BAY_TAKEN_MRR && r.jobId === last.payload.job_id)) return bayTaken(d, o, routes, pm);
  const held = poolApproval(o.poolHost, o.poolPort) === "manual" || results.some((r) => r.result === "pending_approval");
  const rejected = results.some((r) => r.result === "rejected");
  let deadline = o.startsAt + UNAPPLIED_TIMEOUT_MS, heldDeadline = deadline;
  if (held) {
    // Anchor on settlement (startsAt moves with each shifted re-sign): the settling payment row, else the first route job.
    const settledAt = (await d.store.paymentsForRef(pm.rail === "btc_onchain" ? pm.payment_id : pm.provider_ref)).find((p) => p.settles)?.at ?? (routes[0].payload.iat * 1000);
    deadline = settledAt + (rejected ? UNAPPLIED_TIMEOUT_MS : HELD_TIMEOUT_MS);
    heldDeadline = settledAt + HELD_TIMEOUT_MS; // re-signed route jobs never outlive this (M1a)
  }
  if (now >= deadline) {
    const ref = pm.rail === "btc_onchain" ? pm.payment_id : pm.provider_ref, atomic = pm.rail === "btc_onchain" ? pm.amount_sat : Number(pm.amount_atomic);
    const refunded = (await d.store.refundsForRef(ref)).reduce((a, x) => a + x.atomic, 0);
    const c: Commit = {
      order: { id: o.id, fromVersion: o.version, patch: { state: "expired_unapplied" } },
      events: [{ orderId: o.id, from: o.state, to: "expired_unapplied", actor: "sweeper", at: now }],
      alerts: [{ kind: "expired_unapplied", orderRef: o.publicId, at: now }],
      job: routeJob(d, { ...o, endsAt: now }, "revert", ref, 0),
    };
    // G6: the node said sol_maybe_paid (it couldn't confirm the Solana payment). Never an automatic refund row: re-check
    // the settlement at finalized and send it to manual review with the result.
    const solMaybe = pm.network.startsWith("solana:") && results.some((r) => r.result === "rejected" && r.reason === SOL_MAYBE_PAID);
    if (atomic - refunded > 0 && !solMaybe) c.refunds = [refundRow(o, ref, refunded, "expired_unapplied", atomic - refunded, now, pm.rail === "x402_usdc" || pm.rail === "eth_usdc" || pm.rail === "btc_onchain" ? pm.network : null)];
    if (solMaybe) c.alerts!.push({ kind: "refund_manual_review", orderRef: o.publicId, at: now }, { kind: await solMaybePaidCheck(d, ref), orderRef: o.publicId, at: now });
    try { await d.store.commit(c); } catch (e) { if (e instanceof StaleVersion || e instanceof UniqueViolation) return "waiting"; throw e; }
    for (const a of c.alerts ?? []) await d.alerter?.send(a);
    return "expired_unapplied";
  }
  if (last.payload.exp * 1000 > now) return "waiting";
  if (pm.rail === "btc_onchain") {
    // BTC: same payment verbatim (the node dedupes on order_ref|action|payment_id), fresh nonce/job_id.
    const shiftedB = held ? (() => { const startS = Math.floor(now / 1000), dur = last.payload.end - last.payload.start; return { ...o, startsAt: startS * 1000, endsAt: (startS + dur) * 1000 }; })() : o;
    if (held && rejected) return "waiting";
    const job = routeJob(d, shiftedB, "route", pm.payment_id, pm.amount_sat, null, null, held || undefined, held ? heldDeadline : undefined, null, pm);
    try { await d.store.commit(held ? { order: { id: o.id, fromVersion: o.version, patch: { startsAt: shiftedB.startsAt, endsAt: shiftedB.endsAt } }, job } : { job }); }
    catch (e) { if (e instanceof UniqueViolation || e instanceof StaleVersion) return "waiting"; throw e; }
    return "reoffered";
  }
  if (!pm.tx_hash && isUsdcRail(o.rail)) return "waiting"; // fail closed: never sign x402 without the tx hash
  if (held && rejected) return "waiting"; // the node already refused it: no more re-signs, expired_unapplied (refund) at the deadline
  if (held) {
    // Shift: start = now, end = now + (end - start). The node requires the same duration and start within ±10 min.
    const startS = Math.floor(now / 1000), dur = last.payload.end - last.payload.start;
    const shifted: Order = { ...o, startsAt: startS * 1000, endsAt: (startS + dur) * 1000 };
    const job = routeJob(d, shifted, "route", pm.provider_ref, Number(pm.amount_atomic), last.payload.pay_to, pm.tx_hash, true, heldDeadline, pm.network);
    try { await d.store.commit({ order: { id: o.id, fromVersion: o.version, patch: { startsAt: shifted.startsAt, endsAt: shifted.endsAt } }, job }); }
    catch (e) { if (e instanceof UniqueViolation || e instanceof StaleVersion) return "waiting"; throw e; }
    return "reoffered";
  }
  const job = routeJob(d, o, "route", pm.provider_ref, Number(pm.amount_atomic), last.payload.pay_to, pm.tx_hash, undefined, undefined, pm.network);
  try { await d.store.commit({ job }); } catch (e) { if (e instanceof UniqueViolation) return "waiting"; throw e; }
  return "reoffered";
}

/**
 * B7 · the marketplace won the race for a bay (node result rejected/bay_taken_mrr, rigs never switched).
 * Within SUBSTITUTE_WINDOW_MS of settlement and only once per order: if enough other bays are fresh-free,
 * re-assign them in a version-checked commit and sign a new route job for the same order, payment and pool,
 * with the window shifted to start now (same duration). The Terms sell whole ~270 TH rigs, never a named bay.
 * Otherwise: failed + ONE full refund (reason bay_unavailable, status pending_owner: never sent automatically)
 * + an alert + a safety revert job.
 */
async function bayTaken(d: Deps, o: Order, routes: SignedJob[], pm: NonNullable<JobPayload["payment"]>): Promise<"reoffered" | "bay_unavailable" | "waiting"> {
  // #107: a BTC order carries BtcJobPayment (payment_id / amount_sat), re-used verbatim like reofferRoute does.
  const btc = pm.rail === "btc_onchain" ? pm : null;
  const now = d.now(), ref: string = pm.rail === "btc_onchain" ? pm.payment_id : pm.provider_ref, atomic = pm.rail === "btc_onchain" ? pm.amount_sat : Number(pm.amount_atomic);
  const settledAt = (await d.store.paymentsForRef(ref)).find((p) => p.settles)?.at ?? (routes[0].payload.iat * 1000);
  const substituted = routes.some((j) => j.payload.bays !== routes[0].payload.bays);
  const current = new Set((o.bays ?? "").split(",").filter(Boolean).map(Number));
  // Review #109 S3: a swap needs availability data, so it only happens with RENTALS_AVAIL_GATE on. Gate off: the
  // Node still reports bay_taken_mrr, and the order is refunded directly (never a blind swap to an allowlist bay).
  if (d.availGate && !substituted && now - settledAt <= SUBSTITUTE_WINDOW_MS && (btc || !isUsdcRail(o.rail) || pm.tx_hash)) {
    const candidates = (await freeBays(d, o.id)).filter((b) => !current.has(b));
    if (candidates.length >= o.rigCount) {
      const last = routes[routes.length - 1].payload;
      const startS = Math.floor(now / 1000), dur = last.end - last.start;
      const n: Order = { ...o, bays: candidates.slice(0, o.rigCount).join(","), startsAt: startS * 1000, endsAt: (startS + dur) * 1000 };
      const job = btc
        ? routeJob(d, n, "route", ref, atomic, null, null, undefined, undefined, null, btc)
        : routeJob(d, n, "route", ref, atomic, last.pay_to, pm.tx_hash, undefined, undefined, pm.network);
      try {
        await d.store.commit({
          order: { id: o.id, fromVersion: o.version, patch: { bays: n.bays, startsAt: n.startsAt, endsAt: n.endsAt } }, job,
          alerts: [{ kind: "bay_substituted", orderRef: o.publicId, at: now }],
        });
      } catch (e) { if (e instanceof StaleVersion || e instanceof UniqueViolation || e instanceof CapExceeded) return "waiting"; throw e; }
      await d.alerter?.send({ kind: "bay_substituted", orderRef: o.publicId, at: now });
      return "reoffered";
    }
  }
  const refunded = (await d.store.refundsForRef(ref)).reduce((a, x) => a + x.atomic, 0);
  const c: Commit = {
    order: { id: o.id, fromVersion: o.version, patch: { state: "failed" } },
    events: [{ orderId: o.id, from: o.state, to: "failed", actor: "sweeper", at: now }],
    alerts: [{ kind: "bay_unavailable", orderRef: o.publicId, at: now }],
    job: routeJob(d, { ...o, endsAt: now }, "revert", ref, 0),
  };
  if (atomic - refunded > 0) c.refunds = [refundRow(o, ref, refunded, "bay_unavailable", atomic - refunded, now, pm.rail === "x402_usdc" || pm.rail === "eth_usdc" || pm.rail === "btc_onchain" ? pm.network : null)];
  try { await d.store.commit(c); } catch (e) { if (e instanceof StaleVersion || e instanceof UniqueViolation) return "waiting"; throw e; }
  for (const a of c.alerts ?? []) await d.alerter?.send(a);
  return "bay_unavailable";
}

/** Max re-signs of one revert (15-min TTL each: ~24 h), then alert and stop. */
export const MAX_REVERT_REOFFERS = 96;
/**
 * A revert must never be lost. rental_claim_jobs only re-offers a job while
 * exp > now, so a revert claimed and leased but never answered (node crash)
 * dies with its exp. If the order's latest job is a revert with no result and
 * it has expired, re-sign it with a fresh nonce/job_id (same order_ref).
 */
export async function reofferRevert(d: Deps, o: Order): Promise<"none" | "waiting" | "reoffered" | "gave_up"> {
  const jobs = await d.store.listJobs(o.publicId);
  const last = jobs[jobs.length - 1];
  if (!last || last.payload.action !== "revert") return "none";
  const results = await d.store.resultsForOrder(o.publicId);
  if (results.some((r) => r.jobId === last.payload.job_id)) return "none";
  if (last.payload.exp * 1000 > d.now()) return "waiting";
  const n = jobs.filter((j) => j.payload.action === "revert").length;
  if (n > MAX_REVERT_REOFFERS) return "gave_up";
  if (n === MAX_REVERT_REOFFERS) {
    const a = { kind: "revert_unanswered" as const, orderRef: o.publicId, at: d.now() };
    await d.store.commit({ alerts: [a], job: routeJob(d, { ...o, endsAt: o.endsAt ?? d.now() }, "revert", last.payload.payment?.provider_ref ?? "", 0) }).catch(() => {});
    await d.alerter?.send(a);
    return "gave_up";
  }
  const job = routeJob(d, { ...o, endsAt: o.endsAt ?? d.now() }, "revert", last.payload.payment?.provider_ref ?? "", 0);
  try { await d.store.commit({ job }); } catch (e) { if (e instanceof UniqueViolation) return "waiting"; throw e; }
  return "reoffered";
}
