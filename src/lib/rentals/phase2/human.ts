/**
 * Human browser-wallet checkout (/hashrate/rent) · server side.
 *
 * Thin wrappers only. Pricing (getQuote / priceOrder), createRental,
 * x402.ts, the pay route and confirmPayment are reused unchanged.
 *
 * Open only when ALL hold: phase2Enabled(), RENTALS_HUMAN_CHECKOUT=1,
 * stagingDeps() configured, and the kill switch (RENTALS_KILL env OR the
 * rental_settings.rentals_enabled row, unreadable = killed) is off.
 * The extra RENTALS_HUMAN_CHECKOUT flag lets the bot-only launch go live
 * without opening the browser checkout.
 *
 * POST /api/rentals/order is rate-limited in KV: 5 orders per 10 minutes per
 * IP and 30 per 10 minutes in total, because every unpaid order holds rigs
 * for the 15-minute pay window. It fails closed: no KV or a KV error = no order.
 * On top of that, each IP bucket may hold at most ONE unpaid open order
 * (review S1): a KV slot claimed atomically before createRental, released
 * when that order is paid, cancelled or past its pay window (and by TTL).
 */
import { phase2Enabled, mainnetEnabled } from "./flag";
import { stagingDeps } from "./staging";
import { x402Net, BASE_SEPOLIA, BASE_MAINNET } from "./x402";
import { PAYTO_PIN_SHA256, evmPayToFromEnv, solanaPayToFromEnv, type PayToPins } from "./payto-pins";
import { getQuote, createRental, getRental, confirmPayment, cancelRental, maxDaysFor, fleetCapacity, bayBoard, confirmingHeldRigs, PAY_TTL_MS, type Deps, type BayBoard } from "./service";
import { PILOT_CAP_RIGS, RIG_TH, MIN_DAYS } from "./pricing";
import { RENTAL_TERMS_VERSION, RENTAL_TERMS_PATH } from "./terms";
import { catalogForUi, type UiPool } from "./pools";
import { SOLANA_MAINNET, SOLANA_DEVNET, solanaFromEnv } from "./solana";
import type { SolanaChain } from "./solana-wallet";
import { ethChainFromEnv, ethClaimPending, type EthOffer } from "./eth/service";
import { ethDepsOf } from "./eth/wire";
import { btcOffer } from "./btc/service";
import { unifiedRentalStatus } from "../direct";

type Env = Record<string, string | undefined>;

export const ORDER_LIMIT = { perIp: 5, global: 30, windowSec: 600 } as const;
export const QUOTE_LIMIT = { limit: 60, windowSec: 60 } as const;
export const ACCESS_LIMIT = { limit: 20, windowSec: 600 } as const;

export function humanCheckoutFlag(env: Env = process.env): boolean {
  return env.RENTALS_HUMAN_CHECKOUT === "1" && phase2Enabled(env);
}

/** Cheap, synchronous, no network: safe to call from ISR pages like /hashrate. The full check (Supabase flag) runs on /hashrate/rent and in every route. */
export function humanCheckoutLinkable(env: Env = process.env): boolean {
  return humanCheckoutFlag(env) && env.RENTALS_KILL !== "1" && stagingDeps(env) != null;
}

export type ChainInfo = { network: string; chainIdHex: string; name: string; rpcUrl: string; explorer: string; testnet: boolean; payTo: string; asset: string; solana?: SolanaChain;
  /** USDC on Ethereum, direct transfer (eth/*): present only when RENTALS_ETH_USDC_ENABLED and its config are complete. */
  eth?: EthOffer };
/** Wallet chain params from config. The public RPC only (never an env override, which may carry a key). */
export function chainInfo(env: Env = process.env, payToPins: PayToPins = PAYTO_PIN_SHA256): ChainInfo {
  const net = x402Net(env);
  const main = net.env === "mainnet" && mainnetEnabled(env);
  const base = main ? BASE_MAINNET : BASE_SEPOLIA;
  // payTo and the USDC contract are pinned for the page too: it refuses to sign a request that differs (review S4).
  return { network: base.network, chainIdHex: base.chainIdHex, name: main ? "Base" : "Base Sepolia", rpcUrl: base.rpc, explorer: main ? "https://basescan.org" : "https://sepolia.basescan.org", testnet: !main, payTo: evmPayToFromEnv(env, payToPins.evm), asset: base.asset, ...solanaChain(env, main, payToPins), ...ethChainFromEnv(env, payToPins.evm) };
}

/**
 * THE Solana-offered check (review #106 N4): RENTALS_SOLANA_ENABLED=1 AND the rail can actually be built
 * (solanaFromEnv: https RPC, keyed on mainnet, mainnet allowed). The checkout picker and every "Base or Solana"
 * line of copy (rails.ts) read this one function, so copy never promises a rail the checkout won't offer.
 */
export function solanaOffered(env: Env = process.env, payToPins: PayToPins = PAYTO_PIN_SHA256): boolean {
  if (env.RENTALS_SOLANA_ENABLED !== "1") return false;
  try { return solanaFromEnv(env, mainnetEnabled(env), payToPins) != null; } catch { return false; }
}

/** Solana option for the page (pinned payTo + mint), only when solanaOffered. Its network follows Base's. */
function solanaChain(env: Env, main: boolean, payToPins: PayToPins): { solana?: SolanaChain } {
  if (!solanaOffered(env, payToPins)) return {};
  const n = main ? SOLANA_MAINNET : SOLANA_DEVNET;
  return { solana: { network: n.network, walletChain: main ? "solana:mainnet" : "solana:devnet", name: main ? "Solana" : "Solana devnet", explorer: "https://solscan.io", testnet: !main, payTo: solanaPayToFromEnv(env, payToPins.solana), asset: n.asset } };
}

export type CheckoutView =
  | { open: false; reason: "disabled" | "not_configured" | "paused" }
  | { open: true; maxRigs: number; freeRigs: number; minDays: number; maxDays: number; rigTh: number; termsVersion: string; termsPath: string; chain: ChainInfo; pools: UiPool[]; board: BayBoard | null; price: CheckoutPrice | null; availGate: boolean;
    /** Present ONLY when Bitcoin can be offered right now (flag on, configured, agent healthy). Never mentioned otherwise. */
    btc?: { siteKey: string; maxDays: number } };
/** 1 rig x 24 h from getQuote (USDC strings, 6 dp). */
export type CheckoutPrice = { perRigDayUsdc: string; pricePerPhDayUsdc: string };

/** Full state for /hashrate/rent. Reads the kill switch; never creates anything. */
export async function checkoutView(env: Env = process.env, deps?: Deps | null): Promise<CheckoutView> {
  if (!humanCheckoutFlag(env)) return { open: false, reason: "disabled" };
  const d = deps === undefined ? stagingDeps(env) : deps;
  if (!d) return { open: false, reason: "not_configured" };
  if (await killed(d)) return { open: false, reason: "paused" };
  let chain: ChainInfo;
  try { chain = chainInfo(env, d.payToPins ?? PAYTO_PIN_SHA256); } catch { return { open: false, reason: "not_configured" }; }
  const maxRigs = Math.min(PILOT_CAP_RIGS, fleetCapacity(d));
  let freeRigs = 0;
  try { const now = d.now(); freeRigs = Math.max(0, Math.min(maxRigs, fleetCapacity(d) - (await d.store.rigsCommitted(now)) - (await d.store.rigsSoftHeld(now)) - (await confirmingHeldRigs(d, now)))); } catch { freeRigs = 0; }
  let board: BayBoard | null = null;
  try { board = await bayBoard(d); } catch { board = null; }
  // B7 G1 (gate on): only fresh-free bays count; no board = no rigs (fail closed).
  if (d.availGate) freeRigs = board ? Math.min(freeRigs, board.available) : 0;
  // B1: the same getQuote as every other surface, 1 rig x 1 day; null = "price unavailable".
  let price: CheckoutPrice | null = null;
  try { const q = await getQuote(d, { rigs: 1, days: 1 }); if (q.ok) price = { perRigDayUsdc: q.result.totalUsdc, pricePerPhDayUsdc: q.result.pricePerPhDayUsdc }; } catch { price = null; }
  const btc = d.btc ? await btcOffer(d).catch(() => null) : null;
  return { open: true, maxRigs, freeRigs, minDays: MIN_DAYS, maxDays: maxDaysFor(d), rigTh: RIG_TH, termsVersion: RENTAL_TERMS_VERSION, termsPath: RENTAL_TERMS_PATH, chain, pools: catalogForUi(), board, price, availGate: d.availGate === true, ...(btc ? { btc } : {}) };
}

async function killed(d: Deps): Promise<boolean> {
  try { return await d.killSwitch(); } catch { return true; }
}

/** N1: Bitcoin picks (binding creation) per IP per hour, after Turnstile; plus a global ceiling. */
export const BTC_PICK_LIMIT = { perIp: 3, global: 20, windowSec: 3600 } as const;
export async function btcPickLimit(incr: Incr, ipBucket: string): Promise<{ ok: true } | { ok: false; error: "rate_limited" | "rate_limit_unavailable"; retryAfter: number }> {
  let ip, all;
  try {
    ip = await incr(`ratelimit:rentals-btc:ip:${ipBucket}`, BTC_PICK_LIMIT.windowSec);
    all = ip ? await incr("ratelimit:rentals-btc:global", BTC_PICK_LIMIT.windowSec) : null;
  } catch { ip = null; all = null; }
  if (!ip || !all || !(ip.count > 0) || !(all.count > 0)) return { ok: false, error: "rate_limit_unavailable", retryAfter: 30 };
  if (ip.count > BTC_PICK_LIMIT.perIp) return { ok: false, error: "rate_limited", retryAfter: Math.max(1, ip.ttlSec) };
  if (all.count > BTC_PICK_LIMIT.global) return { ok: false, error: "rate_limited", retryAfter: Math.max(1, all.ttlSec) };
  return { ok: true };
}

export type Incr = (key: string, windowSec: number) => Promise<{ count: number; ttlSec: number } | null>;

/** Per-IP + global order limiter. null from incr (no KV / error) = refused. */
export async function orderLimit(incr: Incr, ipBucket: string): Promise<{ ok: true } | { ok: false; error: "rate_limited" | "rate_limit_unavailable"; retryAfter: number }> {
  let ip, all;
  try {
    ip = await incr(`ratelimit:rentals-order:ip:${ipBucket}`, ORDER_LIMIT.windowSec);
    all = ip ? await incr("ratelimit:rentals-order:global", ORDER_LIMIT.windowSec) : null;
  } catch { ip = null; all = null; }
  if (!ip || !all || !(ip.count > 0) || !(all.count > 0)) return { ok: false, error: "rate_limit_unavailable", retryAfter: 30 };
  if (ip.count > ORDER_LIMIT.perIp) return { ok: false, error: "rate_limited", retryAfter: Math.max(1, ip.ttlSec) };
  if (all.count > ORDER_LIMIT.global) return { ok: false, error: "rate_limited", retryAfter: Math.max(1, all.ttlSec) };
  return { ok: true };
}

/** Tiny KV surface for the one-open-order hold. get() ok:false = could not read (fail closed). */
export type HoldKv = {
  get: (key: string) => Promise<{ ok: boolean; value: string | null }>;
  set: (key: string, value: string, ttlSec: number) => Promise<boolean>;
  del: (key: string) => Promise<boolean>;
};
export const HOLD_TTL_SEC = Math.ceil(PAY_TTL_MS / 1000) + 60;
const holdKeys = (ip: string) => ({ slot: `rentals-order:open:${ip}`, ref: `rentals-order:open-ref:${ip}` });

/** Is the order behind this payment ref still unpaid and inside its pay window? */
export async function refStillOpen(d: Deps, ref: string): Promise<boolean> {
  const b = await d.store.getBinding(ref);
  const o = b ? await d.store.getOrder(b.orderId) : null;
  return !!o && o.state === "awaiting_payment" && o.expiresAt > d.now();
}

/**
 * Claim this IP's single unpaid-order slot. The INCR is atomic, so two
 * concurrent creates cannot both win. A slot whose order was paid, cancelled
 * or expired is released and re-claimed once.
 */
export async function claimHold(d: Deps, incr: Incr, kv: HoldKv, ip: string): Promise<"claimed" | "open_order" | "unavailable"> {
  const k = holdKeys(ip);
  for (let attempt = 0; attempt < 2; attempt++) {
    let n;
    try { n = await incr(k.slot, HOLD_TTL_SEC); } catch { n = null; }
    if (!n || !(n.count > 0)) return "unavailable";
    if (n.count === 1) return "claimed";
    let cur;
    try { cur = await kv.get(k.ref); } catch { cur = { ok: false, value: null }; }
    if (!cur.ok) return "unavailable";
    // No ref yet = another create from this IP is in flight. Conservative: refuse.
    if (!cur.value) return "open_order";
    let open = true;
    try { open = await refStillOpen(d, cur.value); } catch { return "unavailable"; }
    if (open) return "open_order";
    try { await kv.del(k.slot); await kv.del(k.ref); } catch { return "unavailable"; }
  }
  return "open_order";
}

const STATUS: Record<string, number> = {
  invalid_input: 400, terms_not_accepted: 400, terms_version_mismatch: 409, idempotency_conflict: 409,
  cap_exceeded: 409, no_capacity: 409, rentals_paused: 503, pricing_unavailable: 503, ask_out_of_band: 503,
  rail_unavailable: 503, rate_limited: 429, rate_limit_unavailable: 503,
  not_found: 404, upstream_unavailable: 503, not_configured: 503, server_error: 500, code_expired: 410, open_order: 409, not_cancellable: 409, awaiting_pool_approval: 409, retry: 503,
  // Pool refusals from create_rental (pools.ts); pool_host_* default to 400 too.
  pool_user: 400, pool_user_btc_address: 400, pool_user_account_format: 400, pool_user_worker_format: 400, pool_user_nicehash_address: 400, pool_user_reserved: 400, pool_port: 400,
};
export type Out = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };
const fail = (error: string, headers?: Record<string, string>): Out => ({ status: STATUS[error] ?? 400, body: { error }, headers });

export type OrderCtx = { env?: Env; deps?: Deps | null; incr: Incr; kv: HoldKv; ipBucket: string };

/** POST /api/rentals/order. Body: { rigs, days, pool_id | custom_url, username, accept_terms, terms_version, idempotency_key }. */
export async function handleOrder(body: unknown, ctx: OrderCtx): Promise<Out> {
  const env = ctx.env ?? process.env;
  if (!humanCheckoutFlag(env)) return fail("not_found");
  const d = ctx.deps === undefined ? stagingDeps(env) : ctx.deps;
  if (!d) return fail("not_configured");
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  // Kill switch first: a paused desk never touches the limiter or the store.
  if (await killed(d)) return fail("rentals_paused");
  // Cheap terms check before spending a limiter slot.
  if (b.accept_terms !== true) return fail("terms_not_accepted");
  if (b.terms_version !== RENTAL_TERMS_VERSION) return fail("terms_version_mismatch");
  const lim = await orderLimit(ctx.incr, ctx.ipBucket);
  if (!lim.ok) return fail(lim.error, { "Retry-After": String(lim.retryAfter) });
  // One unpaid open order per IP. A retry with the same idempotency key replays and needs no new slot.
  let isReplay = false;
  try { isReplay = typeof b.idempotency_key === "string" && !!(await d.store.getIdem(b.idempotency_key)); } catch { return fail("server_error"); }
  let claimed = false;
  if (!isReplay) {
    const h = await claimHold(d, ctx.incr, ctx.kv, ctx.ipBucket);
    if (h === "unavailable") return fail("rate_limit_unavailable", { "Retry-After": "30" });
    if (h === "open_order") return fail("open_order");
    claimed = true;
  }
  const release = async () => { if (claimed) { const k = holdKeys(ctx.ipBucket); try { await ctx.kv.del(k.slot); await ctx.kv.del(k.ref); } catch { /* TTL frees it */ } } };
  let r;
  try {
    r = await createRental(d, {
      rigs: b.rigs, days: b.days, pool_id: b.pool_id, custom_url: b.custom_url, username: b.username, idempotency_key: b.idempotency_key,
      accept_terms: b.accept_terms, terms_version: b.terms_version, rail: "x402_usdc",
    });
  } catch { await release(); return fail("server_error"); }
  if (!r.ok) { await release(); return fail(r.error); }
  const o = r.result as { rentalId: string; status: string; rigs: number; th: number; days: number; totalUsdc: string | null; payBy: string; payment: { rail?: string; paymentRef?: string } | null; creatorSecret?: string; renterPool: { host: string; port: number; worker: string }; poolApproval: "auto" | "manual" };
  if (o.payment?.rail !== "x402_usdc" || !o.payment.paymentRef) { await release(); return fail("server_error"); }
  if (claimed) {
    // Bind the slot to this order; if this write fails the slot still expires by TTL.
    try { await ctx.kv.set(holdKeys(ctx.ipBucket).ref, o.payment.paymentRef, HOLD_TTL_SEC); } catch { /* TTL */ }
  }
  return { status: 200, body: {
    rentalId: o.rentalId, status: o.status, rigs: o.rigs, th: o.th, days: o.days, totalUsdc: o.totalUsdc, payBy: o.payBy,
    paymentRef: o.payment.paymentRef, pool: { ...o.renterPool, approval: o.poolApproval }, replay: r.replay,
    // Shown once, to the renter only: needed to collect the access code after payment.
    ...(r.replay ? {} : { creatorSecret: o.creatorSecret }),
  } };
}

/** GET /api/rentals/quote?rigs=&days= · getQuote, trimmed to what the page shows. Same gate as /order (flag, deps, kill switch), all 404. */
export async function handleQuote(params: URLSearchParams, ctx: { env?: Env; deps?: Deps | null }): Promise<Out> {
  const env = ctx.env ?? process.env;
  if (!humanCheckoutFlag(env)) return fail("not_found");
  const d = ctx.deps === undefined ? stagingDeps(env) : ctx.deps;
  if (!d || (await killed(d))) return fail("not_found");
  let q;
  try { q = await getQuote(d, { rigs: params.get("rigs") ?? undefined, days: params.get("days") ?? undefined }); } catch { return fail("server_error"); }
  if (!q.ok) return fail(q.error);
  const x = q.result;
  return { status: 200, body: { rigs: x.rigs, th: x.th, days: x.days, totalUsdc: x.totalUsdc, pricePerPhDayUsdc: x.pricePerPhDayUsdc, validMinutes: x.validMinutes } };
}

/**
 * POST /api/rentals/access
 * { rental_id, creator_secret } collects the access code once paid;
 * { access_code } checks status; { action: "pay", rental_id, creator_secret }
 * returns what the page needs to pay an unpaid order an AI placed (owner only,
 * 503 while paused); { action: "cancel", rental_id, creator_secret }
 * cancels an UNPAID order (cancelRental unchanged), which frees the IP's slot.
 * getRental unchanged. With a valid secret on an unpaid order it re-checks the
 * payment (as the MCP status tool does), keyed on the rentalId getRental
 * returned. Kill switch on: reads stay open (a paid renter can always
 * collect their code); only cancel answers 503 rentals_paused.
 */
export async function handleAccess(body: unknown, ctx: { env?: Env; deps?: Deps | null }): Promise<Out> {
  const env = ctx.env ?? process.env;
  if (!humanCheckoutFlag(env)) return fail("not_found");
  const d = ctx.deps === undefined ? stagingDeps(env) : ctx.deps;
  if (!d) return fail("not_found");
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  try {
    if (b.action === "cancel") {
      // Paused: block cancels only. Reads (status, code collection for paid orders) stay open.
      if (await killed(d)) return fail("rentals_paused", { "Retry-After": "60" });
      // Unpaid only: a paid rental's pro-rata cancel stays with the bot tools and the terms.
      const st = await getRental(d, { rental_id: b.rental_id, creator_secret: b.creator_secret });
      if (!st.ok) return fail(st.error);
      const x = st.result as { rentalId: string; status: string; rigs?: number };
      if (!("rigs" in x)) return fail("not_found");
      if (x.status !== "awaiting_payment") return fail("not_cancellable");
      { const eo = await d.store.getOrderByPublicId(x.rentalId); if (eo && (await ethClaimPending(ethDepsOf(d), eo.id))) return { status: 409, body: { error: "payment_pending" } }; }
      const c = await cancelRental(d, { rental_id: x.rentalId, creator_secret: b.creator_secret });
      if (!c.ok) return fail(c.error);
      return { status: 200, body: { rentalId: x.rentalId, status: (c.result as { status: string }).status, cancelled: true } };
    }
    if (b.action === "pay") {
      // "Pay an order your AI placed": the renter brings rental_id + creator_secret (pasted, or from the
      // payUrl fragment). Same gate as placing an order: paused = no new payments. A wrong or missing
      // secret reveals nothing (not_found, same as an unknown id). getRental's per-rental limiter (one slot per
      // request) and the route's per-IP limiter both apply. Nothing is created or changed here.
      if (await killed(d)) return fail("rentals_paused", { "Retry-After": "60" });
      const first = await getRental(d, { rental_id: b.rental_id, creator_secret: b.creator_secret });
      if (!first.ok) return fail(first.error);
      if (!("rigs" in (first.result as object))) return fail("not_found");
      const rid = (first.result as { rentalId: string }).rentalId;
      const o = await d.store.getOrderByPublicId(rid);
      if (!o) return fail("not_found");
      // Re-check first (as the status read does), so a paid order is never offered for payment again.
      if (o.state === "awaiting_payment") for (const ref of await d.store.refsForOrder(o.id)) await confirmPayment(d, ref);
      // Same request, same secret, already charged one per-ID slot above: re-read without a second (S5).
      const r = await getRental(d, { rental_id: rid, creator_secret: b.creator_secret }, { countLimit: false });
      if (!r.ok) return fail(r.error);
      if (!("rigs" in (r.result as object))) return fail("not_found");
      const x = r.result as { rentalId: string; status: string; rigs: number; th: number; days: number; totalUsdc: string | null; payBy: string; startsAt?: string | null; endsAt?: string | null; accessCode?: string; renterPool: { host: string; port: number; worker: string }; poolApproval: "auto" | "manual" };
      const now = d.now();
      let paymentRef: string | null = null;
      if (x.status === "awaiting_payment" && Date.parse(x.payBy) > now) {
        for (const ref of await d.store.refsForOrder(o.id)) {
          const bind = await d.store.getBinding(ref);
          if (bind && bind.kind === "initial" && bind.expiresAt > now && /^x402_[0-9a-f]{32}$/.test(ref)) { paymentRef = ref; break; }
        }
      }
      if (!paymentRef) {
        // Not payable (already paid, expired, cancelled): status only, plus the code if it is ready.
        return { status: 200, body: { rentalId: x.rentalId, status: x.status, payable: false, rigs: x.rigs, th: x.th, days: x.days, startsAt: x.startsAt ?? null, endsAt: x.endsAt ?? null, ...(x.accessCode ? { accessCode: x.accessCode } : {}) } };
      }
      return { status: 200, body: {
        rentalId: x.rentalId, status: x.status, payable: true, rigs: x.rigs, th: x.th, days: x.days, totalUsdc: x.totalUsdc,
        payBy: x.payBy, paymentRef, pool: { ...x.renterPool, approval: x.poolApproval },
      } };
    }
    if (typeof b.access_code === "string" && b.access_code) {
      // B2: the same lookup as MCP rental_status: direct store first, then the legacy feed. One limiter hit.
      const u = await unifiedRentalStatus(d, b.access_code, env);
      if (!u.ok) return fail(u.error === "invalid_code" ? "invalid_input" : u.error);
      const x = u.result;
      return { status: 200, body: { source: x.source, status: x.state, rigs: x.rigs, startsAt: x.startsAt, endsAt: x.endsAt, deliveredTh: x.deliveredTh, online: x.online, ...(x.refundPendingUsdc ? { refundPendingUsdc: x.refundPendingUsdc } : {}), ...(x.note ? { note: x.note } : {}) } };
    }
    const input = { rental_id: b.rental_id, creator_secret: b.creator_secret };
    let r = await getRental(d, input);
    const own = r.ok && "rigs" in (r.result as object);
    if (r.ok && own && (r.result as { status: string }).status === "awaiting_payment") {
      const o = await d.store.getOrderByPublicId((r.result as { rentalId: string }).rentalId);
      if (o) for (const ref of await d.store.refsForOrder(o.id)) await confirmPayment(d, ref);
      r = await getRental(d, input);
    }
    if (!r.ok) return fail(r.error);
    const x = r.result as { rentalId: string; status: string; rigs?: number; th?: number; days?: number; startsAt?: string | null; endsAt?: string | null; accessCode?: string; poolApproval?: "auto" | "manual" };
    return { status: 200, body: { rentalId: x.rentalId, status: x.status, rigs: x.rigs ?? null, th: x.th ?? null, days: x.days ?? null, startsAt: x.startsAt ?? null, endsAt: x.endsAt ?? null, ...(x.poolApproval ? { poolApproval: x.poolApproval } : {}), ...(x.accessCode ? { accessCode: x.accessCode } : {}) } };
  } catch { return fail("server_error"); }
}

export const json = (o: Out) => new Response(JSON.stringify(o.body), { status: o.status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex", ...(o.headers ?? {}) } });
