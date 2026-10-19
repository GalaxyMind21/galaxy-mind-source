// Human browser-wallet checkout (/hashrate/rent). Route validation, the order
// rate limit (per IP, global, fail closed), the kill-switch / flag states,
// EIP-3009 typed data that X402Provider.verifyAndSettle accepts unchanged
// (requirements exact-match, nonce, window) and whose EIP-712 digest a real
// secp256k1 key signs and recovers, and the error copy for every PayError.
import { TEST_PAYTO_EVM as PINNED_PAYTO, TEST_PAYTO_SOLANA as PINNED_SOLANA_PAYTO, TEST_PAYTO_PINS } from "./lib/test-payto";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { MemoryStore } from "../src/lib/rentals/phase2/store";
import { MockAlerter } from "../src/lib/rentals/phase2/safety";
import { X402Provider, BASE_SEPOLIA, toChecksum, type PayError, type EvmPaymentPayload as PaymentPayload } from "../src/lib/rentals/phase2/x402";
import { RENTAL_TERMS_VERSION, RENTAL_TERMS_PATH } from "../src/lib/rentals/phase2/terms";
import type { Deps } from "../src/lib/rentals/phase2/service";
import { handleOrder, handleQuote, handleAccess, checkoutView, orderLimit, humanCheckoutFlag, humanCheckoutLinkable, chainInfo, ORDER_LIMIT, HOLD_TTL_SEC, type Incr, type HoldKv } from "../src/lib/rentals/phase2/human";
import {
  pickRequirement, buildTransferAuthorization, buildPaymentPayload, encodePaymentHeader, randomNonce, chainIdFromCaip2,
  PAY_ERROR_COPY, payErrorCopy, orderErrorCopy, ORDER_ERROR_COPY, walletErrorCopy, customUrlHint, usernameHint, usdcDisplay, balanceOfData, countdown, VALID_AFTER_SLACK_SEC,
  txLink, parseSaved, resumePlan, savedOrderExpiresAt, expiredOrderVerdict, collectDelayMs, collectStep, SAVED_MAX_AGE_MS, CLIENT_PAY_COPY,
  payOutcome, cancelResult, signedStillChecking, SIGNED_GRACE_MS, signedUnpaidAction, requestOutcome,
  phonePayUrl, wantsPhoneQr, isTabletDevice, payUrlFor, payOrigin, parsePayLink, scheduleFragmentStrip, AI_POOL_CHECK_COPY, payLookup, notPayableCopy, RENTAL_ID_RE, CREATOR_SECRET_RE,
  isMobileDevice, handoffUrl, walletAppLinks, SIGNATURE_RE, isCounterfactualSignature, COUNTERFACTUAL_VERIFY_COPY,
  type PaymentRequiredBody, type SavedOrder,
} from "../src/lib/rentals/phase2/human-wallet";
import { resolvePool, catalogForUi } from "../src/lib/rentals/phase2/pools";
import { blockedHit } from "../src/lib/rentals/index";

const ROOT = join(__dirname, "..");
const T0 = Date.parse("2026-10-16T10:00:00Z");
const PRICING = { marketAskBtcPhDay: 0.00052, floorBtcPhDay: 0.000501, hashpriceSatsThDay: 47, writtenAt: T0 - 3600_000 };
const ON = { RENTALS_PHASE2_ENABLED: "1", RENTALS_PHASE2_MODE: "staging", RENTALS_HUMAN_CHECKOUT: "1", RENTALS_PAYTO_PIN_EVM: PINNED_PAYTO };
const { privateKey } = crypto.generateKeyPairSync("ed25519");
const PRIV = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

// Fake facilitator + Base RPC that settles whatever verifies.
const P = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
const T_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", AU_TOPIC = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
type Seen = { path: string; body: { paymentPayload: PaymentPayload; paymentRequirements: Record<string, unknown> } };
function facilitator() {
  const seen: Seen[] = [];
  let last: PaymentPayload | null = null;
  const tx = "0x" + "ab".repeat(32);
  const f = (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    if (String(url).endsWith("/verify")) { seen.push({ path: "verify", body }); last = body.paymentPayload; return new Response(JSON.stringify({ isValid: true })); }
    if (String(url).endsWith("/settle")) { seen.push({ path: "settle", body }); return new Response(JSON.stringify({ success: true, transaction: tx })); }
    if (body.method === "eth_chainId") return new Response(JSON.stringify({ result: BASE_SEPOLIA.chainIdHex }));
    if (body.method === "eth_blockNumber") return new Response(JSON.stringify({ result: "0x10" }));
    const a = last!.payload.authorization;
    return new Response(JSON.stringify({ result: { status: "0x1", blockNumber: "0x0e", logs: [
      { address: BASE_SEPOLIA.asset, topics: [T_TOPIC, P(a.from), P(PINNED_PAYTO)], data: "0x" + BigInt(a.value).toString(16) },
      { address: BASE_SEPOLIA.asset, topics: [AU_TOPIC, P(a.from), a.nonce.toLowerCase()], data: "0x" },
    ] } }));
  }) as unknown as typeof fetch;
  return { f, seen, tx };
}

function mk(over: Partial<Deps> = {}) {
  let now = T0, kill = false, killThrows = false;
  const store = new MemoryStore();
  const fac = facilitator();
  const xp = new X402Provider({ net: BASE_SEPOLIA, payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://preview.example", store, fetchImpl: fac.f, now: () => now, rpcDeadlineMs: 0, sleep: async () => {} });
  const d: Deps = {
    store, providers: { x402_usdc: xp }, pricing: async () => PRICING, btcUsd: async () => 82000, now: () => now,
    signingKeyPem: PRIV, signingKid: "t1", codeHmacKey: "k".repeat(32), payToPins: TEST_PAYTO_PINS,
    killSwitch: async () => { if (killThrows) throw new Error("db down"); return kill; },
    alerter: new MockAlerter(), lightningEnabled: false, pilot: true, bays: [1, 2, 3, 4], payNetwork: BASE_SEPOLIA.network, ...over,
  };
  return { d, store, xp, fac, tick: (ms: number) => { now += ms; }, setKill: (k: boolean) => { kill = k; }, setKillThrows: (k: boolean) => { killThrows = k; } };
}
// In-memory KV: INCR (limiter + hold slot) and get/set/del (hold ref) share one map, like Upstash.
function memIncr() {
  const m = new Map<string, number | string>(); let calls = 0; let limiterCalls = 0;
  const incr: Incr = async (k) => { calls++; if (!k.startsWith("rentals-order:open")) limiterCalls++; const n = Number(m.get(k) ?? 0) + 1; m.set(k, n); return { count: n, ttlSec: 600 }; };
  const kv: HoldKv = {
    get: async (k) => ({ ok: true, value: m.has(k) ? String(m.get(k)) : null }),
    set: async (k, v) => { m.set(k, v); return true; },
    del: async (k) => { m.delete(k); return true; },
  };
  return { incr, kv, m, calls: () => limiterCalls, allCalls: () => calls };
}
const idem = () => crypto.randomBytes(12).toString("hex");
const body = (o: Record<string, unknown> = {}) => ({ rigs: 2, days: 3, pool_id: "braiins", username: "alice.rig1", accept_terms: true, terms_version: RENTAL_TERMS_VERSION, idempotency_key: idem(), ...o });

(async () => {
  // ── Flag and kill-switch states ─────────────────────────────────────────
  {
    const m = mk();
    assert.equal(humanCheckoutFlag({}), false, "off by default");
    assert.equal(humanCheckoutFlag({ RENTALS_PHASE2_ENABLED: "1", RENTALS_PHASE2_MODE: "staging" }), false, "phase 2 alone does not open the browser checkout");
    assert.equal(humanCheckoutFlag({ RENTALS_HUMAN_CHECKOUT: "1" }), false, "needs phase 2 too");
    assert.equal(humanCheckoutFlag(ON), true);
    assert.equal(humanCheckoutLinkable({ ...ON, RENTALS_KILL: "1" }), false, "env kill hides every /hashrate link");
    assert.equal(humanCheckoutLinkable(ON), false, "no signing keys = not configured = no link");
    assert.deepEqual(await checkoutView({}, m.d), { open: false, reason: "disabled" });
    assert.deepEqual(await checkoutView(ON, null), { open: false, reason: "not_configured" });
    m.setKill(true);
    assert.deepEqual(await checkoutView(ON, m.d), { open: false, reason: "paused" }, "kill switch on = opening soon");
    m.setKill(false); m.setKillThrows(true);
    assert.deepEqual(await checkoutView(ON, m.d), { open: false, reason: "paused" }, "unreadable kill switch = paused (fail closed)");
    m.setKillThrows(false);
    const v = await checkoutView(ON, m.d);
    assert.ok(v.open);
    if (v.open) {
      assert.deepEqual([v.maxRigs, v.freeRigs, v.minDays, v.maxDays, v.rigTh, v.termsVersion], [4, 4, 1, 7, 270, RENTAL_TERMS_VERSION], "pilot limits from service.ts");
      assert.equal(v.chain.network, BASE_SEPOLIA.network); assert.equal(v.chain.chainIdHex, BASE_SEPOLIA.chainIdHex);
      assert.equal(v.chain.testnet, true); assert.equal(v.chain.rpcUrl, BASE_SEPOLIA.rpc, "public RPC only");
      assert.equal(v.chain.payTo, PINNED_PAYTO, "page pins the pay-to address"); assert.equal(v.chain.asset, BASE_SEPOLIA.asset, "page pins the network's USDC contract");
      assert.equal(v.termsPath, RENTAL_TERMS_PATH, "terms link = RENTAL_TERMS_PATH"); assert.equal(v.termsPath, "/terms/rental");
      assert.equal(v.termsVersion, RENTAL_TERMS_VERSION, "submitted version = RENTAL_TERMS_VERSION");
      assert.ok(!JSON.stringify(v).match(/KEY|SECRET|PEM|hmac/i), "view carries no secrets");
    }
    assert.throws(() => chainInfo({ RENTALS_X402_NETWORK: "mainnet" }), /mainnet_disabled/, "mainnet chain only when mainnetEnabled()");
    // Free rigs drop while unpaid orders hold them.
    const lim = memIncr();
    assert.equal((await handleOrder(body({ rigs: 3 }), { env: ON, deps: m.d, incr: lim.incr, kv: lim.kv, ipBucket: "1.1.1.1" })).status, 200);
    const v2 = await checkoutView(ON, m.d);
    assert.ok(v2.open && v2.freeRigs === 1, "3 rigs soft-held for the pay window");
  }

  // ── Order route validation ──────────────────────────────────────────────
  {
    const m = mk(); const lim = memIncr();
    const ctx = { env: ON, deps: m.d, incr: lim.incr, kv: lim.kv, ipBucket: "2.2.2.2" };
    assert.equal((await handleOrder(body(), { ...ctx, env: {} })).status, 404, "flag off = 404");
    assert.equal((await handleOrder(body(), { ...ctx, deps: null })).status, 503);
    m.setKill(true);
    const k = await handleOrder(body(), ctx);
    assert.deepEqual([k.status, k.body.error], [503, "rentals_paused"]);
    m.setKill(false); m.setKillThrows(true);
    assert.equal((await handleOrder(body(), ctx)).body.error, "rentals_paused", "kill switch unreadable = paused");
    m.setKillThrows(false);
    assert.equal(lim.calls(), 0, "a paused desk never touches the limiter");
    assert.equal(m.store.orders.size, 0, "and never creates an order");
    assert.equal((await handleOrder(body({ accept_terms: "true" }), ctx)).body.error, "terms_not_accepted", "accept_terms must be boolean true");
    assert.equal((await handleOrder(body({ terms_version: "old" }), ctx)).body.error, "terms_version_mismatch");
    assert.equal((await handleOrder(null, ctx)).body.error, "terms_not_accepted");
    assert.equal(lim.calls(), 0, "terms errors cost no limiter slot");
    const BAD: [Record<string, unknown>, string][] = [
      [{ pool_id: undefined, custom_url: "stratum+tcp://1.2.3.4:3333" }, "pool_host_ip_literal"],
      [{ pool_id: undefined, custom_url: "pool.local:3333" }, "pool_host_internal"],
      [{ pool_id: undefined, custom_url: "stratum+ssl://pool.example.org:3333" }, "invalid_input"],
      [{ pool_id: undefined, custom_url: "pool.example.org:0" }, "pool_port"],
      [{ custom_url: "pool.example.org:3333" }, "invalid_input"], // both pool_id and custom_url
      [{ pool_id: undefined }, "invalid_input"], // neither
      [{ pool_id: "nope" }, "invalid_input"],
      [{ pool_url: "stratum+tcp://stratum.braiins.com:3333", pool_id: undefined }, "invalid_input"], // the order route takes the new fields only
      [{ username: undefined }, "invalid_input"],
      [{ username: "bad worker!" }, "pool_user"],
      [{ username: "alice.rig1.x" }, "pool_user_worker_format"],
      [{ pool_id: "ocean", username: "alice" }, "pool_user_btc_address"],
      [{ username: "GalaxyMind.rig1" }, "pool_user_reserved"], [{ pool_id: undefined, custom_url: "pool.example.org:3333", username: "galaxymind.x" }, "pool_user_reserved"],
      [{ rigs: 0 }, "invalid_input"], [{ rigs: 1.5 }, "invalid_input"], [{ days: 0 }, "invalid_input"], [{ idempotency_key: "short" }, "invalid_input"],
    ];
    for (const [bad, code] of BAD) {
      const r = await handleOrder(body(bad), { ...ctx, ipBucket: crypto.randomUUID() });
      assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.body.error, code, JSON.stringify(bad));
      assert.ok(orderErrorCopy(String(r.body.error)) !== ORDER_ERROR_COPY.server_error, "plain copy for " + code);
    }
    assert.equal((await handleOrder(body({ rigs: 5 }), { ...ctx, ipBucket: "x" })).body.error, "cap_exceeded");
    assert.equal((await handleOrder(body({ days: 8 }), { ...ctx, ipBucket: "y" })).body.error, "cap_exceeded", "pilot 7-day cap");
    assert.equal(m.store.orders.size, 0);
    const key = idem();
    const ok = await handleOrder(body({ idempotency_key: key }), { ...ctx, ipBucket: "z" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(Object.keys(ok.body).sort(), ["creatorSecret", "days", "payBy", "paymentRef", "pool", "rentalId", "replay", "rigs", "status", "th", "totalUsdc"].sort(), "only what the page needs");
    assert.ok(/^x402_[0-9a-f]{32}$/.test(String(ok.body.paymentRef)));
    assert.equal(ok.body.th, 540); assert.equal(ok.body.status, "awaiting_payment");
    const raw = JSON.stringify(ok.body);
    assert.ok(!/hmac|signing|PRIVATE|floor|bays|http402/i.test(raw), "no internals or secrets: " + raw);
    const again = await handleOrder(body({ idempotency_key: key }), { ...ctx, ipBucket: "z2" });
    assert.equal(again.body.rentalId, ok.body.rentalId, "same idempotency key = same rental");
    assert.equal(again.body.replay, true); assert.equal("creatorSecret" in again.body, false, "creator secret is shown once");
    assert.deepEqual(ok.body.pool, { host: "stratum.braiins.com", port: 3333, worker: "alice.rig1", approval: "auto" }, "pool_id signs the catalog default endpoint");
    const solo = await handleOrder(body({ rigs: 1, pool_id: "solopool", username: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq.rig1" }), { ...ctx, ipBucket: "solo" });
    assert.equal(solo.status, 200, JSON.stringify(solo.body));
    assert.deepEqual(solo.body.pool, { host: "stratum.solopool.com", port: 3333, worker: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq.rig1", approval: "auto" });
    const other = await handleOrder(body({ rigs: 1, pool_id: undefined, custom_url: "stratum+tcp://pool.example.org:3333", username: "renter.rig.1" }), { ...ctx, ipBucket: "other" });
    assert.equal(other.status, 200, JSON.stringify(other.body));
    assert.deepEqual(other.body.pool, { host: "pool.example.org", port: 3333, worker: "renter.rig.1", approval: "manual" }, "custom pool: held for approval");
    const conflict = await handleOrder(body({ idempotency_key: key, username: "bob.rig1" }), { ...ctx, ipBucket: "z3" });
    assert.equal(conflict.body.error, "idempotency_conflict");
    // Quote mirrors getQuote.
    const q = await handleQuote(new URLSearchParams("rigs=2&days=3"), { env: ON, deps: m.d });
    assert.equal(q.status, 200); assert.equal(q.body.totalUsdc, ok.body.totalUsdc, "quote price = order price");
    assert.equal((await handleQuote(new URLSearchParams("rigs=9&days=1"), { env: ON, deps: m.d })).status, 400);
    assert.equal((await handleQuote(new URLSearchParams("rigs=1&days=1"), { env: {}, deps: m.d })).status, 404);
    assert.equal((await handleQuote(new URLSearchParams("rigs=1&days=1"), { env: ON, deps: null })).status, 404, "quote: not configured = 404");
    m.setKill(true);
    assert.equal((await handleQuote(new URLSearchParams("rigs=1&days=1"), { env: ON, deps: m.d })).status, 404, "quote: kill on = 404 like /order's gate");
    // Paused: reads stay open (status / code collection), only cancel is blocked.
    const ak = await handleAccess({ rental_id: ok.body.rentalId, creator_secret: ok.body.creatorSecret }, { env: ON, deps: m.d });
    assert.deepEqual([ak.status, ak.body.status], [200, "awaiting_payment"], "access read with kill on = open");
    assert.equal((await handleAccess({ access_code: "x".repeat(30) }, { env: ON, deps: m.d })).status, 404, "access by code with kill on = normal lookup (not 503)");
    const kc = await handleAccess({ action: "cancel", rental_id: ok.body.rentalId, creator_secret: ok.body.creatorSecret }, { env: ON, deps: m.d });
    assert.deepEqual([kc.status, kc.body.error, kc.headers?.["Retry-After"]], [503, "rentals_paused", "60"], "cancel with kill on = 503 paused");
    m.setKill(false); m.setKillThrows(true);
    assert.equal((await handleQuote(new URLSearchParams("rigs=1&days=1"), { env: ON, deps: m.d })).status, 404, "quote: unreadable kill = 404");
    assert.equal((await handleAccess({ rental_id: ok.body.rentalId, creator_secret: ok.body.creatorSecret }, { env: ON, deps: m.d })).status, 200, "access read: unreadable kill = still open");
    assert.equal((await handleAccess({ action: "cancel", rental_id: ok.body.rentalId, creator_secret: ok.body.creatorSecret }, { env: ON, deps: m.d })).status, 503, "cancel: unreadable kill = 503");
    m.setKillThrows(false);
    // Paid renter collects the code while paused.
    {
      const { confirmPayment } = await import("../src/lib/rentals/phase2/service");
      const m2 = mk(); const lim2 = memIncr();
      const o2 = await handleOrder(body({ rigs: 1, days: 1 }), { env: ON, deps: m2.d, incr: lim2.incr, kv: lim2.kv, ipBucket: "p1" });
      const ref2 = String(o2.body.paymentRef);
      const b2 = (await m2.store.getBinding(ref2))!;
      await m2.store.recordSettlement({ providerRef: ref2, network: BASE_SEPOLIA.network, payer: "0x" + "12".repeat(20), txHash: "0x" + "9a".repeat(32), amountAtomic: b2.expectedAtomic, settledAt: T0 });
      assert.equal((await confirmPayment(m2.d, ref2)).outcome, "settled");
      m2.setKill(true);
      const got = await handleAccess({ rental_id: o2.body.rentalId, creator_secret: o2.body.creatorSecret }, { env: ON, deps: m2.d });
      assert.equal(got.status, 200, "paid renter's code collection works while paused"); assert.ok(typeof got.body.accessCode === "string");
    }
    assert.equal((await handleAccess({}, { env: ON, deps: null })).status, 404);
  }

  // ── One unpaid open order per IP ────────────────────────────────────────
  {
    const m = mk(); const lim = memIncr();
    const ctx = { env: ON, deps: m.d, incr: lim.incr, kv: lim.kv, ipBucket: "7.7.7.7" };
    const key = idem();
    const a = await handleOrder(body({ rigs: 1, days: 1, idempotency_key: key }), ctx);
    assert.equal(a.status, 200);
    assert.equal(lim.m.get("rentals-order:open-ref:7.7.7.7"), a.body.paymentRef, "slot bound to the new order");
    assert.ok(HOLD_TTL_SEC > 15 * 60, "hold outlives the pay window");
    const b2 = await handleOrder(body({ rigs: 1, days: 1 }), ctx);
    assert.deepEqual([b2.status, b2.body.error], [409, "open_order"], "second unpaid order from one IP refused");
    assert.equal(m.store.orders.size, 1, "and creates nothing");
    assert.equal((await handleOrder(body({ rigs: 1, days: 1 }), { ...ctx, ipBucket: "8.8.8.8" })).status, 200, "another IP is unaffected");
    const re = await handleOrder(body({ rigs: 1, days: 1, idempotency_key: key }), ctx);
    assert.deepEqual([re.status, re.body.rentalId, re.body.replay], [200, a.body.rentalId, true], "same-key replay is not a second order");
    // Wrong secret on an UNPAID order: no payment re-check, no code, no cancel.
    let refsCalls = 0; const orig = m.store.refsForOrder.bind(m.store);
    m.store.refsForOrder = (async (id: string) => { refsCalls++; return orig(id); }) as typeof m.store.refsForOrder;
    const ws = await handleAccess({ rental_id: a.body.rentalId, creator_secret: "wrong-secret-value" }, { env: ON, deps: m.d });
    assert.equal(ws.body.accessCode, undefined, "wrong secret on unpaid = no code");
    assert.equal(refsCalls, 0, "wrong secret never triggers the confirmPayment re-check");
    assert.equal(m.fac.seen.length, 0, "and never reaches the facilitator / RPC");
    const wc = await handleAccess({ action: "cancel", rental_id: a.body.rentalId, creator_secret: "wrong-secret-value" }, { env: ON, deps: m.d });
    assert.notEqual(wc.status, 200, "wrong secret cannot cancel");
    // Right secret on unpaid: re-check runs (keyed on getRental's rentalId), still unpaid, no code.
    const rs = await handleAccess({ rental_id: a.body.rentalId, creator_secret: a.body.creatorSecret }, { env: ON, deps: m.d });
    assert.deepEqual([rs.status, rs.body.status, rs.body.accessCode], [200, "awaiting_payment", undefined]);
    assert.equal(refsCalls, 1, "right secret on unpaid re-checks payment once");
    m.store.refsForOrder = orig;
    // Cancel frees the slot right away.
    const c = await handleAccess({ action: "cancel", rental_id: a.body.rentalId, creator_secret: a.body.creatorSecret }, { env: ON, deps: m.d });
    assert.deepEqual([c.status, c.body.cancelled], [200, true], JSON.stringify(c.body));
    assert.equal((await handleAccess({ action: "cancel", rental_id: a.body.rentalId, creator_secret: a.body.creatorSecret }, { env: ON, deps: m.d })).status, 409, "only unpaid orders cancel here");
    const after = await handleOrder(body({ rigs: 1, days: 1 }), ctx);
    assert.equal(after.status, 200, "slot released after cancel: " + JSON.stringify(after.body));
    // Expiry frees the slot (no sweeper needed: the pay window is checked live).
    // (Reset only the 5/10-min limiter counters here; the hold keys stay.)
    const resetLimiter = () => { for (const k of [...lim.m.keys()]) if (!k.startsWith("rentals-order:open")) lim.m.delete(k); };
    resetLimiter();
    assert.equal((await handleOrder(body({ rigs: 1, days: 1 }), ctx)).body.error, "open_order");
    m.tick(16 * 60_000);
    const late = await handleOrder(body({ rigs: 1, days: 1 }), ctx);
    assert.equal(late.status, 200, "slot released after the pay window expires");
    // Paid frees the slot.
    const pref = String(late.body.paymentRef);
    m.store.orders.get((await m.store.getBinding(pref))!.orderId)!.state = "paid"; resetLimiter();
    assert.equal((await handleOrder(body({ rigs: 1, days: 1 }), ctx)).status, 200, "slot released once the order is paid");
    // A failed create releases its slot.
    const lim2 = memIncr(); const c2 = { ...ctx, incr: lim2.incr, kv: lim2.kv, ipBucket: "9.9.9.9" };
    assert.equal((await handleOrder(body({ pool_id: "nope" }), c2)).status, 400);
    assert.equal(lim2.m.has("rentals-order:open:9.9.9.9"), false, "failed create frees the slot");
    assert.equal((await handleOrder(body({ rigs: 1, days: 1 }), c2)).status, 200);
    // KV read unavailable while a slot is taken = fail closed, no order.
    const n0 = m.store.orders.size;
    const bad = await handleOrder(body({ rigs: 1, days: 1 }), { ...c2, kv: { ...lim2.kv, get: async () => ({ ok: false, value: null }) } });
    assert.deepEqual([bad.status, bad.body.error], [503, "rate_limit_unavailable"]);
    const bad2 = await handleOrder(body({ rigs: 1, days: 1 }), { ...c2, ipBucket: "10.0.0.1", incr: (async (k: string, w: number) => k.startsWith("rentals-order:open") ? null : lim2.incr(k, w)) as Incr });
    assert.deepEqual([bad2.status, bad2.body.error], [503, "rate_limit_unavailable"], "slot INCR down = no order");
    assert.equal(m.store.orders.size, n0, "fail closed creates nothing");
    // In-flight create (slot taken, no ref yet) = refuse, conservatively.
    const lim3 = memIncr(); lim3.m.set("rentals-order:open:11.0.0.1", 1);
    assert.equal((await handleOrder(body({ rigs: 1, days: 1 }), { ...ctx, incr: lim3.incr, kv: lim3.kv, ipBucket: "11.0.0.1" })).body.error, "open_order");
    // Route wiring.
    const src = readFileSync(join(ROOT, "src/app/api/rentals/order/route.ts"), "utf8");
    assert.ok(/kvGetChecked/.test(src) && /kvSet/.test(src) && /kvDel/.test(src) && /\bkv[,:\s]/.test(src), "order route passes a KV hold store");
    const human = readFileSync(join(ROOT, "src/lib/rentals/phase2/human.ts"), "utf8");
    assert.ok(/getOrderByPublicId\(\(r\.result as \{ rentalId: string \}\)\.rentalId\)/.test(human), "re-check keyed on getRental's rentalId, not the raw input");
  }

  // ── Rate limit: 5 / 10 min per IP, 30 / 10 min global, fail closed ─────
  {
    assert.deepEqual([ORDER_LIMIT.perIp, ORDER_LIMIT.global, ORDER_LIMIT.windowSec], [5, 30, 600]);
    const m = mk({ bays: [1, 2, 3, 4] }); const lim = memIncr();
    const ctx = { env: ON, deps: m.d, incr: lim.incr, kv: lim.kv, ipBucket: "3.3.3.3" };
    // Each call fails fast after the limiter (bad pool), so capacity is never the limit here.
    for (let i = 0; i < 5; i++) assert.equal((await handleOrder(body({ pool_id: "nope" }), ctx)).body.error, "invalid_input", "attempt " + (i + 1));
    const sixth = await handleOrder(body(), ctx);
    assert.deepEqual([sixth.status, sixth.body.error], [429, "rate_limited"], "6th order from one IP in 10 min");
    assert.ok(Number(sixth.headers?.["Retry-After"]) > 0);
    assert.equal(m.store.orders.size, 0, "limited request creates nothing");
    for (let i = 0; i < 24; i++) await handleOrder(body({ pool_id: "nope" }), { ...ctx, ipBucket: "ip" + i });
    const glob = await handleOrder(body(), { ...ctx, ipBucket: "fresh" });
    assert.deepEqual([glob.status, glob.body.error], [429, "rate_limited"], "global cap 30 / 10 min");
    for (const broken of [async () => null, async () => { throw new Error("kv down"); }, async () => ({ count: 0, ttlSec: 0 })] as Incr[]) {
      const m2 = mk();
      const r = await handleOrder(body(), { env: ON, deps: m2.d, incr: broken, kv: memIncr().kv, ipBucket: "4.4.4.4" });
      assert.deepEqual([r.status, r.body.error], [503, "rate_limit_unavailable"], "limiter error = no order (fail closed)");
      assert.equal(m2.store.orders.size, 0);
    }
    assert.deepEqual(await orderLimit(lim.incr, "brand-new"), { ok: false, error: "rate_limited", retryAfter: 600 }, "global already over");
    // Route source wires the KV limiter, the trusted IP and returns via handleOrder only.
    const src = readFileSync(join(ROOT, "src/app/api/rentals/order/route.ts"), "utf8");
    assert.ok(/kvIncrWithTtlFull/.test(src) && /isKvConfigured\(\)/.test(src) && /getClientIp/.test(src) && /rateLimitBucket/.test(src), "order route uses KV + trusted IP bucket");
    assert.ok(!/localLimit|rateLimit\(/.test(src), "order route has no local fallback (fail closed)");
  }

  // ── Typed data the wallet signs = what verifyAndSettle accepts ─────────
  {
    const m = mk(); const lim = memIncr();
    const o = await handleOrder(body({ rigs: 1, days: 1 }), { env: ON, deps: m.d, incr: lim.incr, kv: lim.kv, ipBucket: "5.5.5.5" });
    const ref = String(o.body.paymentRef);
    const pr = (await m.xp.paymentRequired(ref)) as unknown as PaymentRequiredBody;
    const exp = { network: BASE_SEPOLIA.network, payTo: PINNED_PAYTO, asset: BASE_SEPOLIA.asset };
    const pv = chainInfo({ RENTALS_PAYTO_PIN_EVM: PINNED_PAYTO }, TEST_PAYTO_PINS);
    assert.deepEqual({ network: pv.network, payTo: pv.payTo, asset: pv.asset }, exp, "page's pinned values = server's");
    const perr = (x: ReturnType<typeof pickRequirement>) => (x as { error?: string }).error;
    assert.equal(perr(pickRequirement(pr, { ...exp, network: "eip155:8453" })), "wrong_network", "wrong network refused client-side");
    assert.equal(perr(pickRequirement({ ...pr, accepts: [{ ...pr.accepts[0], payTo: "0x" + "11".repeat(20) }] }, exp)), "pinned_mismatch", "different payTo = refuse to sign");
    assert.equal(perr(pickRequirement({ ...pr, accepts: [{ ...pr.accepts[0], asset: "0x" + "22".repeat(20) }] }, exp)), "pinned_mismatch", "different token contract = refuse to sign");
    assert.equal(perr(pickRequirement(pr, { ...exp, payTo: "0x" + "33".repeat(20) })), "pinned_mismatch");
    assert.ok(pickRequirement({ ...pr, accepts: [{ ...pr.accepts[0], payTo: PINNED_PAYTO.toLowerCase(), asset: BASE_SEPOLIA.asset.toUpperCase().replace("0X", "0x") }] }, exp).ok, "address compare is case-insensitive");
    assert.equal(perr(pickRequirement({ ...pr, x402Version: 1 }, exp)), "bad_request");
    assert.equal(perr(pickRequirement(null, exp)), "bad_request");
    for (const c of ["pinned_mismatch", "wrong_network", "bad_request"]) { assert.ok(CLIENT_PAY_COPY[c] && payErrorCopy(c) === CLIENT_PAY_COPY[c], c); assert.equal(CLIENT_PAY_COPY[c].charged, "no"); }
    const pick = pickRequirement(pr, exp);
    assert.ok(pick.ok);
    const req = (pick as { req: PaymentRequiredBody["accepts"][0] }).req;
    assert.equal(chainIdFromCaip2(req.network), parseInt(BASE_SEPOLIA.chainIdHex, 16));
    // Real key: sign the EIP-712 digest computed independently here.
    const sk = secp256k1.utils.randomSecretKey();
    const pub = secp256k1.getPublicKey(sk, false);
    const from = toChecksum("0x" + Buffer.from(keccak_256(pub.slice(1))).subarray(12).toString("hex"));
    const nowS = Math.floor(T0 / 1000);
    const nonce = randomNonce(new Uint8Array(32).fill(0x5a));
    assert.equal(nonce, "0x" + "5a".repeat(32));
    assert.throws(() => randomNonce(new Uint8Array(31)), /nonce_length/);
    assert.ok(/^0x[0-9a-f]{64}$/.test(randomNonce()) && randomNonce() !== randomNonce(), "random 32-byte nonce");
    const payBy = Date.parse(String(o.body.payBy)) / 1000;
    const { typedData, authorization } = buildTransferAuthorization(req, from, nowS, nonce, payBy);
    assert.deepEqual(typedData.domain, { name: "USDC", version: "2", chainId: parseInt(BASE_SEPOLIA.chainIdHex, 16), verifyingContract: BASE_SEPOLIA.asset }, "domain from the payment request");
    assert.equal(authorization.to, PINNED_PAYTO); assert.equal(authorization.value, req.amount);
    assert.equal(Number(authorization.validAfter), nowS - VALID_AFTER_SLACK_SEC);
    assert.equal(Number(authorization.validBefore), Math.min(nowS + req.maxTimeoutSeconds, Math.floor(payBy)), "never outlives the pay window");
    // EIP-712 encode (independent of the helper).
    const k = (s: string | Uint8Array) => Buffer.from(keccak_256(typeof s === "string" ? new TextEncoder().encode(s) : s));
    const u256 = (n: string | number) => Buffer.from(BigInt(n).toString(16).padStart(64, "0"), "hex");
    const addr = (a: string) => Buffer.from(a.slice(2).toLowerCase().padStart(64, "0"), "hex");
    const TWA = k("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
    assert.equal("0x" + TWA.toString("hex"), "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267", "EIP-3009 typehash");
    const sameTypes = typedData.types.TransferWithAuthorization.map((t) => `${t.type} ${t.name}`).join(",");
    assert.equal(sameTypes, "address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce", "field order matches the typehash");
    const DOM = k("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    const ds = k(Buffer.concat([DOM, k(typedData.domain.name), k(typedData.domain.version), u256(typedData.domain.chainId), addr(typedData.domain.verifyingContract)]));
    const msg = typedData.message;
    const sh = k(Buffer.concat([TWA, addr(msg.from), addr(msg.to), u256(msg.value), u256(msg.validAfter), u256(msg.validBefore), Buffer.from(msg.nonce.slice(2), "hex")]));
    const digest = k(Buffer.concat([Buffer.from([0x19, 0x01]), ds, sh]));
    const rs = secp256k1.sign(digest, sk, { prehash: false, format: "recovered" });
    const sig = "0x" + Buffer.from(rs.slice(1)).toString("hex") + (27 + rs[0]).toString(16);
    const rec = secp256k1.recoverPublicKey(Uint8Array.from([rs[0], ...rs.slice(1)]), digest, { prehash: false });
    assert.ok(Buffer.from(rec).equals(Buffer.from(secp256k1.getPublicKey(sk))), "signature recovers the payer");
    assert.throws(() => buildPaymentPayload(pr, req, authorization, "0x1234"), /bad_signature/);
    // Smart-wallet signatures (ERC-1271 / ERC-6492, Base app Base Account) are longer than 65 bytes.
    const sw = "0x" + "ab".repeat(1200) + "6492".repeat(16);
    assert.equal(buildPaymentPayload(pr, req, authorization, sw).payload.signature, sw, "smart-wallet signature passes through unchanged");
    assert.throws(() => buildPaymentPayload(pr, req, authorization, "0x" + "ab".repeat(64)), /bad_signature/, "under 65 bytes refused");
    assert.throws(() => buildPaymentPayload(pr, req, authorization, "0x" + "ab".repeat(3073)), /bad_signature/, "over 3 KB refused");
    assert.throws(() => buildPaymentPayload(pr, req, authorization, "0x" + "ab".repeat(65) + "a"), /bad_signature/, "odd length refused");
    assert.throws(() => buildPaymentPayload(pr, req, authorization, sig + "zz"), /bad_signature/, "non-hex refused");
    const payload = buildPaymentPayload(pr, req, authorization, sig);
    const decoded = JSON.parse(Buffer.from(encodePaymentHeader(payload), "base64").toString("utf8"));
    assert.deepEqual(decoded, payload, "PAYMENT-SIGNATURE header round-trips");
    // Exactly what verifyAndSettle checks, through the real provider.
    const b = (await m.store.getBinding(ref))!;
    const h = (b.challenge as { http402: Parameters<X402Provider["verifyAndSettle"]>[0] }).http402;
    const v = await m.xp.verifyAndSettle(h, b.expiresAt, decoded as PaymentPayload);
    assert.ok(v.ok, JSON.stringify(v));
    assert.equal(m.fac.seen[0].path, "verify");
    assert.deepEqual(m.fac.seen[0].body.paymentPayload, payload, "facilitator receives the wallet payload untouched");
    // Tampering is caught by the unchanged server checks.
    const vs = async (p: unknown) => ((await m.xp.verifyAndSettle(h, b.expiresAt, p as PaymentPayload)) as { error?: PayError }).error;
    const tw = (a: Partial<typeof authorization>) => ({ ...payload, payload: { ...payload.payload, authorization: { ...authorization, ...a } } });
    assert.equal(await vs({ ...payload, accepted: { ...payload.accepted, amount: "1" } }), "requirements_mismatch");
    assert.equal(await vs(tw({ value: "1" })), "wrong_amount");
    assert.equal(await vs(tw({ nonce: "0x1234" })), "invalid_payload", "nonce must be 32 bytes");
    assert.equal(await vs(tw({ validBefore: String(nowS + 3) })), "bad_window");
    assert.equal(await vs(tw({ validAfter: String(nowS + 60) })), "bad_window");
    assert.throws(() => buildTransferAuthorization(req, "0xnope", nowS, nonce), /bad_from/);
    assert.throws(() => buildTransferAuthorization(req, from, nowS, "0x12"), /bad_nonce/);
    // Full path: pay() then access code via the access handler.
    const r = await m.xp.pay(ref, decoded as PaymentPayload);
    assert.ok(r.ok);
    const { confirmPayment } = await import("../src/lib/rentals/phase2/service");
    assert.equal((await confirmPayment(m.d, ref)).outcome, "settled");
    const acc = await handleAccess({ rental_id: o.body.rentalId, creator_secret: o.body.creatorSecret }, { env: ON, deps: m.d });
    assert.equal(acc.status, 200); assert.ok(/^[A-Za-z0-9_-]{22,64}$/.test(String(acc.body.accessCode)), "access code after payment");
    const byCode = await handleAccess({ access_code: acc.body.accessCode }, { env: ON, deps: m.d });
    assert.equal(byCode.body.status, "delivering"); assert.equal("accessCode" in byCode.body, false);
    assert.equal((await handleAccess({ rental_id: o.body.rentalId, creator_secret: "wrong" }, { env: ON, deps: m.d })).body.accessCode, undefined, "wrong secret = no code");
    assert.equal((await handleAccess({ access_code: "x".repeat(30) }, { env: ON, deps: m.d })).status, 404);
    assert.equal((await handleAccess({}, { env: {}, deps: m.d })).status, 404);
    // Expired window: the server says payment_expired and the copy says start again.
    const m3 = mk(); const o3 = await handleOrder(body(), { env: ON, deps: m3.d, ...(({ incr, kv }) => ({ incr, kv }))(memIncr()), ipBucket: "6" });
    const b3 = (await m3.store.getBinding(String(o3.body.paymentRef)))!; m3.tick(16 * 60_000);
    assert.equal(((await m3.xp.verifyAndSettle((b3.challenge as { http402: Parameters<X402Provider["verifyAndSettle"]>[0] }).http402, b3.expiresAt, decoded as PaymentPayload)) as { error: string }).error, "payment_expired");
  }

  // ── Error copy ───────────────────────────────────────────────────────────
  {
    // Every PayError x402.ts declares needs copy; order_not_payable (the pay guard, PR #87) is covered ahead of time.
    const x402src = readFileSync(join(ROOT, "src/lib/rentals/phase2/x402.ts"), "utf8");
    const declared = [...(/export type PayError =([^;]+);/.exec(x402src)![1].matchAll(/"([a-z_]+)"/g))].map((x) => x[1]) as PayError[];
    const all = [...new Set([...declared, "order_not_payable"])] as PayError[];
    assert.ok(declared.length >= 12, "PayError parsed");
    assert.equal(PAY_ERROR_COPY.order_not_payable.charged, "no");
    for (const c of all) {
      const e = PAY_ERROR_COPY[c]; assert.ok(e, "copy for " + c);
      assert.ok(e.title.length > 5 && e.body.length > 20);
      assert.ok(!/x402|EIP|3009|facilitator|payload|nonce|\u2014/i.test(e.title + e.body), "no jargon in " + c);
    }
    // Codes reached at or after the settle step: money may have moved.
    for (const c of ["settle_failed", "facilitator_unavailable", "onchain_check_failed", "record_failed"]) {
      assert.equal(PAY_ERROR_COPY[c].charged, "maybe", c + " never says nothing was charged");
      assert.ok(/don't pay again/i.test(PAY_ERROR_COPY[c].body), c);
    }
    for (const c of Object.keys(PAY_ERROR_COPY).filter((c) => PAY_ERROR_COPY[c].charged !== "no")) assert.ok(!/nothing was charged/i.test(PAY_ERROR_COPY[c].body), c + ": maybe-paid copy never says nothing was charged");
    for (const c of all.filter((c) => PAY_ERROR_COPY[c].charged === "no")) assert.ok(/Nothing was charged/.test(PAY_ERROR_COPY[c].body), c);
    assert.equal(payErrorCopy("whatever").title, "Something went wrong");
    for (const c of ["rentals_paused", "cap_exceeded", "pricing_unavailable", "ask_out_of_band", "terms_not_accepted", "terms_version_mismatch", "idempotency_conflict", "rate_limited", "rate_limit_unavailable", "invalid_input", "no_capacity", "server_error", "open_order"]) assert.ok(ORDER_ERROR_COPY[c], "order copy " + c);
    assert.equal(orderErrorCopy("nope"), ORDER_ERROR_COPY.server_error);
    assert.equal(walletErrorCopy({ code: 4001 }).code, "rejected");
    assert.ok(/Nothing was charged/.test(walletErrorCopy({ code: 4001 }).text));
    assert.equal(walletErrorCopy({ code: 4902 }).code, "unsupported_chain");
    assert.equal(walletErrorCopy(new Error("x")).code, "other");
    // Client hints never block what the server accepts, and catch the obvious typos it refuses.
    for (const u of ["stratum+tcp://stratum.braiins.com:3333", "pool.example.org:3333", "stratum+tcp://Pool.Example.org:65535", "stratum+ssl://btc.f2pool.com:1314", "http://ocean.xyz:3333", "stratum+tcp://1.2.3.4:3333", "pool:3333", "pool.example.org:70000", "user@pool.example.org:3333"]) {
      const server = resolvePool({ custom_url: u, username: "w1" }).ok;
      if (server) assert.equal(customUrlHint(u), null, "hint must not block " + u);
    }
    for (const p of catalogForUi()) {
      for (const u of ["alice", "alice.rig1", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq.rig1", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", "NHbQGG3whZkMDKPvzhu7EBPuTsdCQh5yW6CG"]) {
        if (resolvePool({ pool_id: p.id, username: u }).ok) assert.equal(usernameHint(p.usernameFormat, u), null, `${p.id}: hint must not block ${u}`);
      }
    }
    for (const u of ["stratum+ssl://btc.f2pool.com:1314", "http://ocean.xyz:3333", "stratum+tcp://1.2.3.4:3333", "pool:3333", "pool.example.org:70000", "user@pool.example.org:3333"]) assert.ok(customUrlHint(u), "hint catches " + u);
    assert.ok(usernameHint("btc_address[.worker]", "alice"), "btc pools hint a non-address");
    assert.ok(usernameHint(null, "bad worker!"), "custom pools keep the charset hint");
    assert.equal(usernameHint(null, "a.b.c"), null, "custom pools: charset only, like the node");
    assert.equal(usdcDisplay("12345678"), "12.35"); assert.equal(usdcDisplay("1000000"), "1.00"); assert.equal(usdcDisplay("1234567890000"), "1,234,567.89");
    assert.equal(balanceOfData("0x" + "Ab".repeat(20)), "0x70a08231" + "0".repeat(24) + "ab".repeat(20));
    assert.equal(countdown(T0 + 14 * 60_000 + 5_000, T0), "14:05"); assert.equal(countdown(T0, T0 + 1), "0:00");
  }

  // ── Reload resume (unit) ────────────────────────────────────────────────
  {
    const base: SavedOrder = { v: 2, rentalId: "gm_abcDEF123", paymentRef: "x402_" + "a".repeat(32), payBy: new Date(T0 + 10 * 60_000).toISOString(), totalUsdc: "12.34", rigs: 1, th: 270, days: 1, pool: { host: "stratum.braiins.com", port: 3333, worker: "alice.rig1" }, creatorSecret: "s3cret-value-xyz", sig: "k", savedAt: T0 };
    assert.deepEqual(parseSaved(JSON.stringify(base)), base, "round-trips");
    for (const bad of [null, "", "{", "[]", JSON.stringify({ ...base, v: 1 }), JSON.stringify({ ...base, creatorSecret: "" }), JSON.stringify({ ...base, rentalId: "nope" }), JSON.stringify({ ...base, paymentRef: "x402_zz" }), JSON.stringify({ ...base, payBy: "soon" })]) assert.equal(parseSaved(bad), null, String(bad));
    assert.equal(resumePlan(null, T0), "none");
    assert.equal(resumePlan(base, T0), "pay", "unpaid + inside the window = back to the pay step");
    assert.equal(resumePlan(base, T0 + 11 * 60_000), "check", "unpaid + window over = ask the server (payment may have landed)");
    assert.equal(resumePlan({ ...base, paid: true }, T0 + 3 * 86_400_000), "collect", "paid = keep collecting, even days later");
    assert.equal(resumePlan(base, T0 + SAVED_MAX_AGE_MS + 1), "none", "very old unpaid, unsigned saved orders are dropped");
    // Review #84 S2: a paid or signed (maybe-paid) order outlives the unpaid limit, because it holds the only creator secret.
    assert.equal(resumePlan({ ...base, paid: true }, T0 + SAVED_MAX_AGE_MS + 1), "collect", "old paid order kept until the code is collected");
    assert.equal(resumePlan({ ...base, signed: true }, T0 + 8 * 86_400_000), "collect", "old signed order kept through the grace period");
    // CodeQL review 2026-10 (PR #188 M-1/S-5): only PAID orders have a TTL, and past it the page asks the server first.
    assert.equal(savedOrderExpiresAt(base), T0 + 86_400_000 + SAVED_MAX_AGE_MS, "TTL = rental window + grace");
    assert.equal(resumePlan({ ...base, paid: true }, savedOrderExpiresAt(base)), "collect", "paid order still collectable at the TTL edge");
    assert.equal(resumePlan({ ...base, paid: true }, savedOrderExpiresAt(base) + 1), "expire-check", "paid order past its TTL asks the server, never cleared blind");
    assert.equal(resumePlan({ ...base, signed: true }, T0 + 30 * 86_400_000), "collect", "signed order a month old is kept (overdue + Dismiss), never expired");
    assert.equal(resumePlan({ ...base, signed: true }, T0 + 365 * 86_400_000), "collect", "signed order a year old is still kept");
    assert.equal(resumePlan({ ...base, paid: true, days: 7 }, T0 + 14 * 86_400_000), "collect", "a 7-day rental keeps its token through window + grace");
    assert.equal(resumePlan({ ...base, paid: true, days: 7 }, T0 + 15 * 86_400_000 + 1), "expire-check");
    assert.equal(savedOrderExpiresAt({ savedAt: T0, days: 1e9 }), T0 + 90 * 86_400_000 + SAVED_MAX_AGE_MS, "a tampered days value is capped");
    assert.equal(savedOrderExpiresAt({ savedAt: T0, days: Number.NaN }), T0 + 86_400_000 + SAVED_MAX_AGE_MS, "a bad days value falls back to one day");
    // S-5: the server decides. Clear only on 200 + the authenticated view (rigs) + an ended state + no code on offer.
    assert.equal(expiredOrderVerdict(200, { status: "completed", rigs: 1 }), "clear", "server says completed = clear");
    assert.equal(expiredOrderVerdict(200, { status: "refunded", rigs: 2 }), "clear", "server says refunded = clear");
    assert.equal(expiredOrderVerdict(200, { status: "completed", rigs: 1, accessCode: "TEST_" + "c".repeat(17) }), "keep", "a code still on offer = keep (collect it)");
    // S5-a: the coarse view (secret missing, wrong or corrupted) has no rigs and must never clear.
    assert.equal(expiredOrderVerdict(200, { status: "completed" }), "keep", "unauthenticated completed = keep");
    assert.equal(expiredOrderVerdict(200, { status: "refunded" }), "keep", "unauthenticated refunded = keep");
    assert.equal(expiredOrderVerdict(200, { rentalId: "r_test", status: "completed" } as { status: string }), "keep", "coarse {rentalId,status} = keep");
    assert.equal(expiredOrderVerdict(200, { status: "active", rigs: 1 }), "keep", "still running = keep");
    assert.equal(expiredOrderVerdict(200, { status: "delivering", rigs: 1 }), "keep");
    assert.equal(expiredOrderVerdict(200, { status: "refund_pending", rigs: 1 }), "keep", "refund not settled = keep");
    assert.equal(expiredOrderVerdict(0, null), "keep", "offline = keep");
    assert.equal(expiredOrderVerdict(429, { error: "rate_limited" }), "keep", "rate limited = keep");
    assert.equal(expiredOrderVerdict(503, { error: "rentals_paused" }), "keep", "paused = keep");
    assert.equal(expiredOrderVerdict(500, null), "keep", "server error = keep");
    assert.equal(expiredOrderVerdict(404, { error: "not_found" }), "keep", "not found = keep (never clear on a lookup miss)");
    assert.equal(expiredOrderVerdict(200, null), "keep", "unreadable body = keep");
    // The page wires it: expire-check goes through expiredOrderVerdict before clearSaved.
    {
      const page = readFileSync(join(process.cwd(), "src/app/hashrate/rent/RentCheckout.tsx"), "utf8");
      const i = page.indexOf('plan === "expire-check"');
      assert.ok(i > 0, "RentCheckout handles expire-check");
      const block = page.slice(i, i + 1400);
      assert.ok(block.includes("/api/rentals/access") && block.includes('expiredOrderVerdict(status, body) === "clear"'), "expire-check asks the server and clears only on clear");
      assert.ok(block.indexOf("clearSaved()") > block.indexOf("expiredOrderVerdict("), "clearSaved only after the verdict");
    }
    assert.equal(resumePlan({ ...base, signed: true }, T0), "collect", "signed but outcome unknown = check, never back to Pay");
    assert.equal(resumePlan({ ...base, signed: true }, T0 + 60 * 60_000), "collect");
    assert.equal(signedStillChecking(Date.parse(base.payBy) + SIGNED_GRACE_MS - 1, base.payBy), true, "keeps checking through window + grace");
    assert.equal(signedStillChecking(Date.parse(base.payBy) + SIGNED_GRACE_MS + 1, base.payBy), false);
    // Review #84 S2: after window + grace a signed order is "overdue" (keep checking, offer Dismiss), never cleared.
    assert.equal(signedUnpaidAction(Date.parse(base.payBy) + SIGNED_GRACE_MS - 1, base.payBy), "checking");
    assert.equal(signedUnpaidAction(Date.parse(base.payBy) + SIGNED_GRACE_MS + 1, base.payBy), "overdue");
    assert.equal(signedUnpaidAction(Date.parse(base.payBy) + 30 * 86_400_000, base.payBy), "overdue", "still only overdue days later");
    // Review #89 M1b: a held order refuses cancel with awaiting_pool_approval; the checkout keeps the order and checks it.
    assert.equal(cancelResult(409, { error: "awaiting_pool_approval" }), "check", "held cancel refusal = check, never cleared");
    assert.equal(cancelResult(400, { error: "awaiting_pool_approval" }), "keep");
    // Review #84 S1: payment-request GET outcomes. 409 order_not_payable gets its own Start over copy.
    assert.equal(requestOutcome(200, { status: "paid" }), "paid");
    assert.equal(requestOutcome(402, { x402Version: 2, accepts: [] }), "payable");
    assert.equal(requestOutcome(409, { error: "order_not_payable" }), "order_closed");
    assert.equal(requestOutcome(404, { error: "not_found" }), "unknown_ref");
    for (const [st, b] of [[409, { error: "other" }], [409, null], [500, null], [0, null], [200, { status: "nope" }]] as const) assert.equal(requestOutcome(st, b), "bad_request", `${st} ${JSON.stringify(b)}`);
    // Review #88 S1: 503 store_unavailable is transient: its own copy, no Start over, never order_closed.
    assert.equal(requestOutcome(503, { error: "store_unavailable" }), "request_unavailable");
    assert.equal(requestOutcome(503, null), "request_unavailable");
    {
      const ru = payErrorCopy("request_unavailable");
      assert.equal(ru.charged, "no"); assert.equal(ru.action, undefined, "no Start over on a 503");
      assert.ok(!/start|fresh/i.test(ru.body), "503 copy never triggers the Start over button");
      assert.ok(/still saved/.test(ru.body) && /reload/i.test(ru.body), "503 copy: order kept, reload in a moment");
    }
    const closed = payErrorCopy("order_closed");
    assert.equal(closed.action, "start_over", "order_closed offers Start over");
    assert.equal(closed.charged, "no");
    assert.ok(/Nothing was charged/.test(closed.body) && /Start over/.test(closed.body) && !/reload/i.test(closed.body), "order_closed copy: nothing charged, Start over, never reload");
    // S3: 200 success with outcome "retry" (cancel race) means paid-and-pending: keep collecting, never unpaid.
    assert.deepEqual(payOutcome(200, { success: true, outcome: "retry", transaction: "0x" + "ab".repeat(32) }), { kind: "paid", tx: "0x" + "ab".repeat(32), outcome: "retry" });
    // N1: pay POST outcomes. Only a known refused-before-money code is unpaid.
    const k = (st: number, b: unknown) => payOutcome(st, b).kind;
    assert.equal(k(0, null), "maybe", "network error = maybe paid");
    assert.equal(k(200, null), "maybe", "non-JSON 200 = maybe paid");
    assert.equal(k(500, null), "maybe", "non-JSON 5xx = maybe paid");
    assert.equal(k(502, { error: "bad_gateway" }), "maybe", "unknown 5xx = maybe paid");
    assert.equal(k(503, { error: "facilitator_unavailable" }), "maybe");
    assert.equal(k(402, { error: "settle_failed" }), "maybe", "settle step reached = maybe");
    assert.equal(k(402, { error: "onchain_check_failed" }), "maybe");
    assert.equal(k(402, { error: "record_failed" }), "maybe");
    assert.equal(k(402, { error: "something_new" }), "maybe", "unknown code = maybe");
    assert.equal(k(402, { error: "__proto__" }), "maybe"); assert.equal(k(402, { error: "constructor" }), "maybe");
    assert.equal(k(200, { success: false }), "maybe");
    assert.equal(k(500, { error: "verify_failed" }), "maybe", "a refused code on an odd status is not trusted");
    for (const c of ["verify_failed", "payment_expired", "wrong_amount", "bad_window", "requirements_mismatch", "wrong_payto", "invalid_payload", "unknown_ref"]) assert.deepEqual(payOutcome(402, { error: c }), { kind: "refused", code: c }, c);
    assert.deepEqual(payOutcome(409, { error: "order_not_payable" }), { kind: "refused", code: "order_not_payable" });
    assert.deepEqual(payOutcome(200, { success: true, outcome: "settled", transaction: "0x" + "ab".repeat(32) }), { kind: "paid", tx: "0x" + "ab".repeat(32), outcome: "settled" });
    assert.deepEqual(payOutcome(200, { success: true, outcome: "late", transaction: null }), { kind: "refund", tx: null, outcome: "late" });
    // N1: start over clears only on a confirmed cancel.
    assert.equal(cancelResult(200, { cancelled: true, status: "expired" }), "cleared");
    assert.equal(cancelResult(200, { cancelled: false }), "keep");
    assert.equal(cancelResult(200, null), "keep");
    assert.equal(cancelResult(409, { error: "not_cancellable" }), "check", "already moved on (maybe paid) = check it");
    for (const [st, b] of [[0, null], [503, { error: "rentals_paused" }], [500, null], [404, { error: "not_found" }], [409, { error: "retry" }]] as const) assert.equal(cancelResult(st, b), "keep", `${st} keeps the saved order`);
    const delays = Array.from({ length: 12 }, (_, i) => collectDelayMs(i));
    assert.deepEqual(delays.slice(0, 8), [2000, 3000, 5000, 8000, 13000, 20000, 30000, 45000]);
    assert.ok(delays.slice(8).every((x) => x === 60000) && collectDelayMs(1000) === 60000, "caps at 60 s, never gives up");
    assert.deepEqual(collectStep(200, { accessCode: "c".repeat(30), status: "delivering" }), { kind: "done", code: "c".repeat(30) });
    assert.deepEqual(collectStep(200, { status: "paid" }), { kind: "wait", note: "pending" }, "paid but no code yet = keep waiting");
    assert.deepEqual(collectStep(503, { error: "rentals_paused" }), { kind: "wait", note: "paused" }, "kill switch = keep the order, keep waiting");
    for (const s of [0, 429, 500, 502]) assert.deepEqual(collectStep(s, null), { kind: "wait", note: "busy" }, "transient " + s);
    assert.deepEqual(collectStep(404, { error: "not_found" }), { kind: "wait", note: "pending" }, "never drops the saved order on a 404");
    assert.deepEqual(collectStep(200, { status: "awaiting_payment" }), { kind: "unpaid" });
    assert.deepEqual(collectStep(200, { status: "expired" }), { kind: "unpaid" });
    assert.deepEqual(collectStep(200, { status: "refund_pending" }), { kind: "refund" });
    // Only done/refund clear the saved order; everything else keeps it.
    const ui = readFileSync(join(ROOT, "src/app/hashrate/rent/RentCheckout.tsx"), "utf8");
    const clears = [...ui.matchAll(/clearSaved\(\)/g)].length;
    assert.ok(clears >= 2 && clears <= 9, "saved order cleared only in a few places (stale, server-confirmed ended, done, refund x2, unpaid-expired, start over, closed start over, explicit dismiss): " + clears);
    // Review #84 S2: the signed-but-unpaid branch never clears on its own; only the explicit Dismiss does.
    const run = ui.slice(ui.indexOf('if (st.kind === "unpaid" && !collecting.paidKnown && collecting.signed)'), ui.indexOf('if (st.kind === "unpaid" && !collecting.paidKnown) {'));
    assert.ok(run.length > 0 && !/clearSaved\(\)|setOrder\(null\)/.test(run) && /signedUnpaidAction\(/.test(run), "signed + unpaid keeps the saved order and keeps checking");
    assert.ok(/onDismiss=\{collecting\.signed && !collecting\.paidKnown && collectNote === "overdue"/.test(ui) && /Yes, dismiss this order/.test(ui), "dismiss only for an overdue signed order, behind a confirm");
    // Review #88 S1: a 503 problem keeps the order (loadRequest only sets a problem; no clear, no closed start over).
    {
      const eff = ui.slice(ui.indexOf("loadRequest(order).then"), ui.indexOf("return () => { live = false; };", ui.indexOf("loadRequest(order).then")));
      assert.ok(eff.length > 0 && !/clearSaved\(\)|setOrder\(null\)|startOver/.test(eff), "payment-request errors never clear the saved order");
    }
    // Review #88 S2: the Dismiss confirm tells the renter to save both the rental ID and the secret.
    assert.ok(/need both the rental ID and the rental secret shown below/.test(ui) && /Save both first\./.test(ui) && !/Save it first/.test(ui), "dismiss copy names both values");
    { const col = ui.slice(ui.indexOf("function Collecting("), ui.indexOf("function", ui.indexOf("function Collecting(") + 10)); assert.ok(col.indexOf("Save both first") < col.indexOf("<SaveBox order={order} />"), "the SaveBox is below the dismiss copy"); }
    // Review #84 S1: the payment-request GET maps 409 order_not_payable to order_closed (Start over), not bad_request (reload).
    const lr = ui.slice(ui.indexOf("const loadRequest = useCallback"), ui.indexOf("useEffect(", ui.indexOf("const loadRequest = useCallback")));
    assert.ok(/requestOutcome\(r\.status, j\)/.test(lr) && /kind !== "payable"\) return \{ paid: false as const, error: kind \}/.test(lr), "loadRequest uses requestOutcome");
    assert.ok(/problem\.action === "start_over" \? \(\) => void startOver\(\{ closed: true \}\)/.test(ui), "order_closed problem shows Start over");
    const soc = ui.slice(ui.indexOf("if (opts?.closed && order && !done)"), ui.indexOf("// Cancel an unpaid order"));
    assert.ok(soc.length > 0 && ui.indexOf("order.paid || order.signed)) {") < ui.indexOf("if (opts?.closed && order && !done)"), "closed start over runs only after the paid/signed guard");
    // N1 wiring in the page source.
    const payFn = ui.slice(ui.indexOf("const pay = async"), ui.indexOf("const sig = `"));
    // Both rails (Base typed data, Solana transaction) hand the signed payment to ONE post-sign path.
    const postFn = ui.slice(ui.indexOf("const submitSigned = async"), ui.indexOf("const connectSol = async"));
    const solFn = ui.slice(ui.indexOf("const paySol = async"), ui.indexOf("const pay = async"));
    assert.ok(postFn.length > 0 && solFn.length > 0, "submitSigned + paySol present");
    assert.ok(postFn.indexOf("signed: true") > 0 && postFn.indexOf("signed: true") < postFn.indexOf("/api/rentals/pay/"), "signed flag saved before the pay POST");
    assert.ok(postFn.indexOf("saveOrder(signedOrder)") < postFn.indexOf("fetch(`/api/rentals/pay/"), "saved to localStorage before the POST");
    assert.ok(/payOutcome\(status, body\)/.test(postFn) && /catch \{ status = 0; body = null; \}/.test(postFn), "pay POST network error goes through payOutcome as maybe");
    assert.ok(/signed: true, tx: null/.test(postFn), "maybe = switch to checking");
    assert.ok(!/Nothing was charged|charged: "no"/.test(postFn), "post-signature path never claims nothing was charged itself");
    for (const [fn, signCall] of [[payFn, "eth_signTypedData_v4"], [solFn, "signSolana("]] as const) {
      const after = fn.slice(fn.indexOf(signCall), fn.indexOf("} catch (e) {"));
      assert.ok(fn.indexOf(signCall) > 0 && /await submitSigned\(order, /.test(after), signCall + ": the signed payment goes straight to submitSigned");
      assert.ok(!/Nothing was charged|charged: "no"|setProblem/.test(after.slice(after.indexOf(signCall))), signCall + ": nothing after the signature claims nothing was charged");
    }
    const so = ui.slice(ui.indexOf("const startOver = async"), ui.indexOf("return (", ui.indexOf("const startOver = async")));
    assert.ok(so.indexOf("cancelResult(") > 0 && so.indexOf("cancelResult(") < so.lastIndexOf("clearSaved()"), "startOver clears only after cancelResult");
    assert.ok(/res === "keep"\) \{[\s\S]*?return;/.test(so) && /res === "check"\)[^\n]*return;/.test(so), "keep / check never clear");
    assert.ok(/order\.paid \|\| order\.signed\)\) \{[^\n]*return; \}/.test(so), "paid or maybe-paid orders are never dropped");
    const step3 = ui.slice(ui.indexOf("{step === 3 && order && ("), ui.indexOf("{step === 4 && !done && collecting"));
    const sb = step3.indexOf("<SaveBox order={order} beforePay />");
    assert.ok(sb > 0 && sb < step3.indexOf("Connect your wallet") && sb < step3.indexOf("onClick={() => void pay()}"), "Save this shown on the pay step, above the wallet and the Pay button");
    assert.ok(/id="secret" autoComplete="off"/.test(ui) && /id="rid" autoComplete="off"/.test(ui), "secret field has autocomplete off");
    const ncw = [...ui.replace(/^\s*\/\/.*$/gm, "").matchAll(/Nothing was charged/g)].length;
    assert.ok(ncw <= 3, "'Nothing was charged' only pre-signature (wrong network x2) or server-confirmed unpaid (expired notice): " + ncw);
    // Explorer link: only a well-formed 32-byte hash.
    assert.equal(txLink("https://sepolia.basescan.org", "0x" + "ab".repeat(32)), "https://sepolia.basescan.org/tx/0x" + "ab".repeat(32));
    for (const bad of ["0x" + "ab".repeat(31), "0x" + "zz".repeat(32), "javascript:alert(1)", "0x" + "ab".repeat(32) + "/../x", null, 5]) assert.equal(txLink("https://sepolia.basescan.org", bad), null, String(bad));
  }

  // ── Page copy + wiring guards ───────────────────────────────────────────
  {
    const page = readFileSync(join(ROOT, "src/app/hashrate/rent/page.tsx"), "utf8");
    const ui = readFileSync(join(ROOT, "src/app/hashrate/rent/RentCheckout.tsx"), "utf8");
    const copy = readFileSync(join(ROOT, "src/lib/rentals/phase2/human-wallet.ts"), "utf8");
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const [n, s] of [["page", page], ["ui", ui]] as const) {
      const visible = [...strip(s).matchAll(/>\s*([A-Z][^<>{}=;()]*?)\s*</g)].map((x) => x[1]).join(" ") + " " + [...strip(s).matchAll(/"([A-Z][^"]{11,})"/g)].map((x) => x[1]).join(" ");
      assert.ok(!/\bx402\b|EIP-?3009|EIP-?712|WalletConnect|facilitator/i.test(visible), n + ": no jargon in UI copy");
      assert.equal(blockedHit(visible), undefined, n + ": no facility, location, IP or upstream names");
    }
    assert.ok(!/walletconnect/i.test(strip(ui) + strip(copy)), "no WalletConnect");
    assert.ok(/eth_signTypedData_v4/.test(ui) && /PAYMENT-SIGNATURE/.test(ui), "signs typed data, posts to the pay route");
    assert.ok(/\/api\/rentals\/pay\//.test(ui) && /\/api\/rentals\/order/.test(ui));
    assert.ok(/view\.open \? <RentCheckout/.test(page), "closed state never mounts the checkout (never calls the order route)");
    assert.ok(/href=\{view\.termsPath\}/.test(ui) && !/href="\/terms"/.test(ui), "terms link comes from RENTAL_TERMS_PATH via the view");
    assert.ok(/terms_version: view\.termsVersion/.test(ui), "submits the current terms_version");
    assert.ok(/localStorage/.test(ui) && /SAVED_ORDER_KEY/.test(ui) && !/sessionStorage\.setItem\(SAVED/.test(ui) && /localStorage\.setItem\(SAVED_ORDER_KEY/.test(ui), "saved order lives in localStorage (survives reload / tab close)");
    assert.ok(/Save this/.test(ui) && /Rental secret/.test(ui) && /Rental ID/.test(ui), "collecting state shows rental ID + secret with a save note");
    assert.ok(/txLink\(/.test(ui) && !/\/tx\/\$\{/.test(ui), "explorer link only via txLink (validated hash)");
    assert.ok(/pinned_mismatch/.test(copy) && /payTo: view\.chain\.payTo|view\.chain\.payTo/.test(ui) && /view\.chain\.asset/.test(ui), "page pins payTo + asset when picking the requirement");
    assert.ok(!/NEXT_PUBLIC/.test(ui + page + copy), "no public env");
    assert.ok(!/from "node:|stagingDeps|process\.env/.test(ui + copy), "client code imports no server modules");
    // Untouched: pricing, createRental, x402, pay route, confirmPayment.
    const human = readFileSync(join(ROOT, "src/lib/rentals/phase2/human.ts"), "utf8");
    assert.ok(/createRental\(d,/.test(human) && !/priceOrder|usdcAtomicFor/.test(strip(human)), "order reuses createRental; no pricing of its own");
  }

  // ── Pay an order your AI placed (action "pay", payUrl) ─────────────────
  {
    const { confirmPayment } = await import("../src/lib/rentals/phase2/service");
    const { withPayUrl, payLinkOrigin } = await import("../src/lib/rentals/phase2/mcp");
    const m = mk(); const lim = memIncr();
    const o = await handleOrder(body({ rigs: 2, days: 3 }), { env: ON, deps: m.d, incr: lim.incr, kv: lim.kv, ipBucket: "ai1" });
    assert.equal(o.status, 200);
    const rid = String(o.body.rentalId), sec = String(o.body.creatorSecret), ref = String(o.body.paymentRef);
    assert.ok(RENTAL_ID_RE.test(rid) && CREATOR_SECRET_RE.test(sec), "real ids match the page's patterns");
    const pay = (x: Record<string, unknown>, env: Record<string, string> = ON) => handleAccess({ action: "pay", ...x }, { env, deps: m.d });
    const DETAIL = ["rigs", "th", "days", "totalUsdc", "payBy", "paymentRef", "pool", "accessCode", "startsAt", "endsAt", "payable"];
    const noDetails = (r: { body: Record<string, unknown> }, why: string) => { for (const k of DETAIL) assert.equal(k in r.body, false, `${why}: no ${k}`); };
    // Without the right secret: nothing about the order, same answer as an unknown id.
    for (const [x, why] of [
      [{ rental_id: rid }, "no secret"], [{ rental_id: rid, creator_secret: "" }, "empty secret"],
      [{ rental_id: rid, creator_secret: "x".repeat(32) }, "wrong secret"], [{ rental_id: rid, creator_secret: sec.slice(0, -1) }, "near-miss secret"],
      [{ rental_id: "gm_unknown123", creator_secret: sec }, "unknown id"], [{ creator_secret: sec }, "no id"],
    ] as const) {
      const r = await pay(x as Record<string, unknown>);
      assert.notEqual(r.status, 200, why); noDetails(r, why);
    }
    const unk = await pay({ rental_id: "gm_unknown123", creator_secret: sec });
    const wr = await pay({ rental_id: rid, creator_secret: "x".repeat(32) });
    assert.deepEqual([wr.status, wr.body.error], [unk.status, unk.body.error], "wrong secret looks exactly like an unknown rental");
    assert.equal(m.fac.seen.length, 0, "no lookup without the secret reaches the facilitator / RPC");
    // Right secret: the order summary and the same paymentRef the order route issued.
    const ok = await pay({ rental_id: rid, creator_secret: sec });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.payable, true); assert.equal(ok.body.paymentRef, ref, "pays through the order's own x402 ref");
    assert.deepEqual([ok.body.rigs, ok.body.days, ok.body.status], [2, 3, "awaiting_payment"]);
    assert.equal(ok.body.totalUsdc, o.body.totalUsdc, "same price as the order");
    assert.deepEqual(ok.body.pool, o.body.pool, "pool as placed");
    assert.equal("creatorSecret" in ok.body, false, "secret is never echoed");
    assert.equal("accessCode" in ok.body, false, "no code before payment");
    // The page turns that into the same SavedOrder the browser checkout uses.
    const lk = payLookup(ok.status, ok.body, sec, T0);
    assert.equal(lk.kind, "pay");
    if (lk.kind === "pay") {
      assert.deepEqual([lk.order.rentalId, lk.order.paymentRef, lk.order.creatorSecret, lk.order.rigs, lk.order.v], [rid, ref, sec, 2, 2]);
      assert.ok(parseSaved(JSON.stringify(lk.order)), "AI order is a valid saved order (resume, maybe-paid and cancel work unchanged)");
    }
    assert.equal(payLookup(ok.status, { ...ok.body, paymentRef: "x402_nope" }, sec, T0).kind, "error", "malformed ref refused");
    assert.equal(payLookup(ok.status, { ...ok.body, payBy: new Date(T0 - 1).toISOString() }, sec, T0).kind, "error", "past payBy refused");
    assert.equal(payLookup(ok.status, ok.body, "bad secret!", T0).kind, "error");
    assert.deepEqual(payLookup(404, { error: "not_found" }, sec, T0), { kind: "error", error: "not_found" });
    // Kill switch: no new payments (503), flag off or no deps: 404.
    m.setKill(true);
    const k = await pay({ rental_id: rid, creator_secret: sec });
    assert.deepEqual([k.status, k.body.error, k.headers?.["Retry-After"]], [503, "rentals_paused", "60"], "paused = no pay lookup"); noDetails(k, "paused");
    m.setKill(false); m.setKillThrows(true);
    assert.equal((await pay({ rental_id: rid, creator_secret: sec })).status, 503, "unreadable kill = paused (fail closed)");
    m.setKillThrows(false);
    assert.equal((await pay({ rental_id: rid, creator_secret: sec }, {} as Record<string, string>)).status, 404, "flag off = 404");
    assert.equal((await handleAccess({ action: "pay", rental_id: rid, creator_secret: sec }, { env: ON, deps: null })).status, 404);
    // Paid: never offered again; the code comes back for the owner.
    const b = (await m.store.getBinding(ref))!;
    await m.store.recordSettlement({ providerRef: ref, network: BASE_SEPOLIA.network, payer: "0x" + "12".repeat(20), txHash: "0x" + "9a".repeat(32), amountAtomic: b.expectedAtomic, settledAt: T0 });
    const paid = await pay({ rental_id: rid, creator_secret: sec });
    assert.deepEqual([paid.status, paid.body.payable, "paymentRef" in paid.body], [200, false, false], "settled = not payable (re-check runs first)");
    assert.ok(typeof paid.body.accessCode === "string", "owner gets the code");
    assert.equal((await confirmPayment(m.d, ref)).outcome, "already_settled", "the lookup's re-check used the normal confirmPayment");
    const np = payLookup(paid.status, paid.body, sec, T0);
    assert.equal(np.kind, "not_payable"); assert.match(notPayableCopy(np.kind === "not_payable" ? np.status : ""), /already paid/);
    assert.equal(((await pay({ rental_id: rid, creator_secret: "y".repeat(32) })).body as Record<string, unknown>).accessCode, undefined, "paid + wrong secret = no code");
    // Expired window: status only.
    const m2 = mk(); const l2 = memIncr();
    const o2 = await handleOrder(body({ rigs: 1, days: 1 }), { env: ON, deps: m2.d, incr: l2.incr, kv: l2.kv, ipBucket: "ai2" });
    m2.tick(16 * 60_000);
    const ex = await handleAccess({ action: "pay", rental_id: o2.body.rentalId, creator_secret: o2.body.creatorSecret }, { env: ON, deps: m2.d });
    assert.deepEqual([ex.status, ex.body.payable, "paymentRef" in ex.body], [200, false, false], "expired = not payable");
    assert.match(notPayableCopy("expired"), /new order/);
    const res0 = (id: string, sc: string) => ({ ok: true as const, result: { rentalId: id, creatorSecret: sc, payment: { rail: "x402_usdc" } } });
    // Pay links: secret in the fragment only; junk ignored.
    const url = payUrlFor(rid, sec, "https://galaxymind.space")!;
    assert.equal(url, `https://galaxymind.space/hashrate/rent?pay=${rid}#s=${sec}`);
    // S4: the origin comes from the server env, never hard-coded; junk origins mean no link.
    assert.equal(payLinkOrigin({}), "https://galaxymind.space", "no env = production");
    assert.equal(payLinkOrigin({ VERCEL_URL: "gm-preview-abc.vercel.app" }), "https://gm-preview-abc.vercel.app", "preview links stay on the preview");
    assert.equal(payLinkOrigin({ RENTALS_PUBLIC_BASE_URL: "https://staging.example.test/x?y#z", VERCEL_URL: "p.vercel.app" }), "https://staging.example.test", "RENTALS_PUBLIC_BASE_URL wins, origin only");
    assert.equal(payLinkOrigin({ RENTALS_PUBLIC_BASE_URL: "http://evil.test" }), null, "plain http refused");
    assert.equal(payLinkOrigin({ RENTALS_PUBLIC_BASE_URL: "not a url" }), null);
    // S4': production never uses the per-deployment VERCEL_URL.
    assert.equal(payLinkOrigin({ VERCEL_ENV: "production", VERCEL_URL: "galaxy-mind-abc123.vercel.app" }), "https://galaxymind.space", "production ignores VERCEL_URL");
    assert.equal(payLinkOrigin({ VERCEL_ENV: "production", RENTALS_PUBLIC_BASE_URL: "https://galaxymind.space", VERCEL_URL: "x.vercel.app" }), "https://galaxymind.space");
    assert.equal(payLinkOrigin({ VERCEL_ENV: "preview", VERCEL_URL: "gm-preview-abc.vercel.app" }), "https://gm-preview-abc.vercel.app", "previews keep their own origin");
    const { publicBaseUrl } = await import("../src/lib/rentals/phase2/flag");
    assert.equal(publicBaseUrl({ VERCEL_ENV: "production", VERCEL_URL: "galaxy-mind-abc123.vercel.app" }), "https://galaxymind.space", "x402 resource base ignores VERCEL_URL in production too");
    for (const f of ["src/lib/rentals/phase2/staging.ts", "src/app/api/rentals/test-order/route.ts"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      assert.ok(/publicBaseUrl\(env\)/.test(src) && !/env\.VERCEL_URL/.test(src), `${f} uses publicBaseUrl`);
    }
    // Nit: http://localhost only outside production.
    assert.equal(payOrigin("http://localhost:3000"), null, "localhost refused by default");
    assert.equal(payOrigin("http://localhost:3000", { allowLocalhost: true }), "http://localhost:3000");
    assert.equal(payLinkOrigin({ RENTALS_PUBLIC_BASE_URL: "http://localhost:3000" }), "http://localhost:3000", "local dev keeps localhost");
    assert.equal(payLinkOrigin({ VERCEL_ENV: "production", RENTALS_PUBLIC_BASE_URL: "http://localhost:3000" }), null, "production never offers a localhost link");
    assert.equal(payLinkOrigin({ VERCEL_ENV: "production", RENTALS_PUBLIC_BASE_URL: "http://127.0.0.1:3000" }), null);
    assert.equal(payUrlFor(rid, sec, "http://localhost:3000"), null, "payUrlFor refuses localhost unless asked");
    assert.equal("payUrl" in withPayUrl(res0(rid, sec), { ...ON, VERCEL_ENV: "production", RENTALS_PUBLIC_BASE_URL: "http://localhost:3000" }).result, false, "no localhost payUrl in production");
    assert.equal(payOrigin("https://u:p@galaxymind.space"), null, "no credentials in the origin");
    assert.equal(payUrlFor(rid, sec, null), null, "no origin = no link");
    assert.equal(payUrlFor(rid, sec, "https://gm-preview.vercel.app/"), `https://gm-preview.vercel.app/hashrate/rent?pay=${rid}#s=${sec}`);
    const mcpOnly = readFileSync(join(ROOT, "src/lib/rentals/phase2/human-wallet.ts"), "utf8");
    assert.ok(!/https:\/\/galaxymind\.space\/hashrate\/rent/.test(mcpOnly), "no hard-coded production pay link in the client module");
    const u = new URL(url);
    assert.equal(u.search.includes(sec), false, "secret never in the query (server logs)"); assert.equal(u.hash, `#s=${sec}`);
    assert.deepEqual(parsePayLink(u.search, u.hash), { rentalId: rid, secret: sec });
    assert.deepEqual(parsePayLink(u.search, ""), { rentalId: rid, secret: null }, "link without secret asks for it");
    assert.deepEqual(parsePayLink(`?pay=${rid}&s=${sec}`, ""), { rentalId: rid, secret: null }, "secret in the query is ignored");
    assert.equal(parsePayLink("?pay=<script>", `#s=${sec}`), null);
    assert.equal(parsePayLink("", `#s=${sec}`), null);
    assert.deepEqual(parsePayLink(`?pay=${rid}`, "#s=bad%20secret"), { rentalId: rid, secret: null });
    assert.equal(payUrlFor("nope", sec, "https://galaxymind.space"), null); assert.equal(payUrlFor(rid, "a b", "https://galaxymind.space"), null);
    // MCP create_rental: payUrl is additive and only while browser checkout is on.
    const res = { ok: true as const, result: { rentalId: rid, creatorSecret: sec, payment: { rail: "x402_usdc", paymentRef: ref } } };
    assert.equal((withPayUrl(res, ON).result as Record<string, unknown>).payUrl, url, "payUrl uses the fragment format");
    assert.deepEqual(Object.keys(withPayUrl(res, ON).result).slice(0, 3), ["rentalId", "creatorSecret", "payment"], "existing fields unchanged");
    assert.equal("payUrl" in withPayUrl(res, { ...ON, RENTALS_HUMAN_CHECKOUT: "" }).result, false, "checkout off = no payUrl");
    assert.equal((withPayUrl(res, { ...ON, RENTALS_PUBLIC_BASE_URL: "https://gm-staging.vercel.app" }).result as Record<string, unknown>).payUrl, `https://gm-staging.vercel.app/hashrate/rent?pay=${rid}#s=${sec}`, "payUrl follows RENTALS_PUBLIC_BASE_URL");
    assert.equal("payUrl" in withPayUrl(res, { ...ON, RENTALS_PUBLIC_BASE_URL: "http://x.test" }).result, false, "bad origin = no payUrl");
    assert.equal("payUrl" in withPayUrl({ ok: true as const, result: { rentalId: rid, replay: true, payment: { rail: "x402_usdc" } } }, ON).result, false, "replay (no secret) = no payUrl");
    assert.equal("payUrl" in withPayUrl({ ok: true as const, result: { rentalId: rid, creatorSecret: sec, payment: { rail: "lightning" } } }, ON).result, false, "x402 only");
    assert.deepEqual(withPayUrl({ ok: false as const, error: "x", message: "y" }, ON), { ok: false, error: "x", message: "y" });
    const mcpSrc = readFileSync(join(ROOT, "src/lib/rentals/phase2/mcp.ts"), "utf8");
    assert.ok(/reply\(withPayUrl\(out\)\)/.test(mcpSrc) && /payUrl/.test(mcpSrc.slice(mcpSrc.indexOf('server.tool(\n    "create_rental"'), mcpSrc.indexOf('server.tool(\n    "get_rental_status"'))), "create_rental returns and documents payUrl");
    // MRR-only (2026-10-17): llms.txt documents the default mode (create_rental not registered), so it no longer mentions payUrl.
    assert.ok(!/payUrl/.test(readFileSync(join(ROOT, "public/llms.txt"), "utf8")), "llms.txt does not document payUrl in MRR-only mode");
    // Page: reads the fragment, strips it from the address bar, sends the secret only in a POST body.
    const ui = readFileSync(join(ROOT, "src/app/hashrate/rent/RentCheckout.tsx"), "utf8");
    assert.ok(/parsePayLink\(window\.location\.search, window\.location\.hash\)/.test(ui), "reads ?pay and #s");
    assert.ok(/scheduleFragmentStrip\(window\)/.test(ui), "strips the secret from the address bar (S1 helper, tested below)");
    assert.ok(/action: "pay"/.test(ui) && /method: "POST"/.test(ui), "lookup is a POST");
    assert.ok(!/[?&](creator_secret|secret)=\$\{/.test(ui) && !/fetch\(`[^`]*\$\{[^`]*secret/i.test(ui), "secret never put in a request URL");
    assert.ok(/id="ai-secret"[^>]*autoComplete="off"|autoComplete="off"[^>]*id="ai-secret"/.test(ui), "secret field autocomplete off");
    const take = ui.slice(ui.indexOf("takeAiOrder"), ui.indexOf("takeAiOrder") + 600);
    assert.ok(/saveOrder\(/.test(take) && /setStep\(3\)/.test(take) && take.indexOf("saveOrder(") < take.indexOf("setStep(3)"), "AI order is saved before the pay step (save box and resume work as usual)");
  }

  // ── Review should-fixes on #92 (S1, S2, S3, S5) ──────────────────────
  {
    // S1/S1': the #s= strip waits a tick (after Next patches history) and passes null state, so Next's
    // patched replaceState (next/dist/client/components/app-router.js, 16.2) copies its own __NA state in
    // and applies the URL to the router. Passing a state that already has __NA would hit Next's early
    // return and leave canonicalUrl holding #s=. The fake below mirrors that patch.
    const timers: Array<() => void> = [];
    const native: Array<[unknown, string, unknown]> = []; const routerUrls: string[] = [];
    const nextState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { t: 1 } };
    const hist = {
      state: null as unknown,
      replaceState: (data: unknown, unused: string, url?: unknown) => { native.push([data, unused, url]); hist.state = data; },
    };
    const w = {
      location: { pathname: "/hashrate/rent", search: "?pay=gm_abcdefgh12", hash: "#s=" + "x".repeat(32) },
      history: hist,
      setTimeout: (fn: () => void) => { timers.push(fn); return 0; },
    };
    assert.equal(scheduleFragmentStrip(w), true);
    assert.equal(native.length, 0, "nothing replaced synchronously (Next has not patched history yet)");
    // Next mounts: writes its own state and patches replaceState like app-router.js does.
    hist.state = nextState;
    const original = hist.replaceState;
    hist.replaceState = (data: unknown, unused: string, url?: unknown) => {
      const d = data as { __NA?: boolean; _N?: boolean } | null;
      if (d?.__NA || d?._N) return original(data, unused, url); // early return: router NOT told
      const copied = { ...((data as object) ?? {}), __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: (hist.state as typeof nextState).__PRIVATE_NEXTJS_INTERNALS_TREE };
      if (url) routerUrls.push(String(url)); // applyUrlFromHistoryPushReplace
      return original(copied, unused, url);
    };
    timers.forEach((f) => f()); timers.length = 0;
    assert.deepEqual(routerUrls, ["/hashrate/rent?pay=gm_abcdefgh12"], "Next's router gets the clean URL (canonicalUrl drops #s=)");
    assert.equal(native.length, 1);
    assert.equal(native[0][2], "/hashrate/rent?pay=gm_abcdefgh12", "address bar drops only the fragment");
    assert.deepEqual(hist.state, nextState, "Next's own __NA state and tree survive (Back works)");
    // The old S1 form (passing history.state with __NA) would skip the router: guard against regressing to it.
    routerUrls.length = 0; hist.replaceState(hist.state, "", "/x#s=leak");
    assert.deepEqual(routerUrls, [], "fake mirrors Next: __NA state = router not updated");
    assert.equal(scheduleFragmentStrip({ ...w, location: { ...w.location, hash: "" } }), false, "no fragment = no replace");
    const boom = { ...w, history: { state: null, replaceState: () => { throw new Error("SecurityError"); } } };
    assert.doesNotThrow(() => { scheduleFragmentStrip(boom); timers.forEach((f) => f()); }, "a throwing replaceState is ignored");
    const hw = readFileSync(join(ROOT, "src/lib/rentals/phase2/human-wallet.ts"), "utf8");
    assert.ok(/replaceState\(null, "", w\.location\.pathname \+ w\.location\.search\)/.test(hw) && !/replaceState\(w\.history\.state/.test(hw), "strip passes null state");
    const ui = readFileSync(join(ROOT, "src/app/hashrate/rent/RentCheckout.tsx"), "utf8");
    assert.ok(/scheduleFragmentStrip\(window\)/.test(ui) && !/history\.replaceState\(/.test(ui.slice(ui.indexOf("parsePayLink(window.location.search"), ui.indexOf("parsePayLink(window.location.search") + 400)), "page strips only through the tick-later helper");

    // S2: beacons never carry the fragment or ?pay=.
    const { scrubBeaconUrl } = await import("../src/lib/analytics-scrub");
    assert.equal(scrubBeaconUrl("https://galaxymind.space/hashrate/rent?pay=gm_abcdefgh12#s=SECRET"), "https://galaxymind.space/hashrate/rent");
    assert.equal(scrubBeaconUrl("https://galaxymind.space/hashrate/rent?rigs=2&pay=gm_x&days=3#s=SECRET"), "https://galaxymind.space/hashrate/rent?rigs=2&days=3");
    assert.equal(scrubBeaconUrl("https://galaxymind.space/hashrate?rigs=1"), "https://galaxymind.space/hashrate?rigs=1", "other params untouched");
    assert.equal(scrubBeaconUrl("/hashrate/rent?pay=gm_x#s=SECRET"), "/hashrate/rent", "unparseable input is cut, never passed through");
    const sa = readFileSync(join(ROOT, "src/components/SiteAnalytics.tsx"), "utf8");
    assert.ok(/<Analytics beforeSend=\{[^}]*scrubBeaconUrl/.test(sa) && /<SpeedInsights beforeSend=\{[^}]*scrubBeaconUrl/.test(sa), "both beacons scrub");
    const lay = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
    assert.ok(/<SiteAnalytics \/>/.test(lay) && !/<(Analytics|SpeedInsights)[\s/]/.test(lay) && !/from "@vercel\/(analytics|speed-insights)\/next"/.test(lay), "layout renders only the scrubbing wrapper");

    // S3: an AI-placed order asks the human to check the pool and username, next to the price and the pay button.
    assert.equal(AI_POOL_CHECK_COPY, "Check that the pool and username are yours before you pay.");
    assert.ok(/fromAi: true/.test(ui.slice(ui.indexOf("const takeAiOrder"), ui.indexOf("const takeAiOrder") + 300)), "AI orders are marked");
    assert.ok(/order\.fromAi && \(\s*<div data-ai-pool-check/.test(ui) && /order\.fromAi && \(\s*<p data-ai-pool-confirm/.test(ui), "check shown in the order card and by the pay button");
    for (const btn of ["onClick={() => void pay()}", "onClick={() => void paySol()}"]) {
      const payAt = ui.indexOf(btn), confirmAt = ui.lastIndexOf("data-ai-pool-confirm", payAt);
      assert.ok(payAt > 0 && confirmAt > 0 && payAt - confirmAt < 900, "the check sits right above the pay button: " + btn);
    }

    // S5: one "pay" lookup charges the per-ID limiter once.
    const seen: string[] = [];
    const lim = { global: { ok: () => true }, perKey: { ok: (k: string) => { seen.push(k); return true; } } };
    const m5 = mk({ limiter: lim as unknown as Deps["limiter"] }); const l5 = memIncr();
    const o5 = await handleOrder(body({ rigs: 1, days: 1 }), { env: ON, deps: m5.d, incr: l5.incr, kv: l5.kv, ipBucket: "s5" });
    assert.equal(o5.status, 200);
    seen.length = 0;
    const p5 = await handleAccess({ action: "pay", rental_id: o5.body.rentalId, creator_secret: o5.body.creatorSecret }, { env: ON, deps: m5.d });
    assert.equal(p5.status, 200); assert.equal(p5.body.payable, true);
    assert.deepEqual(seen.filter((k) => k.startsWith("rid:")), ["rid:" + o5.body.rentalId], "one per-ID slot per pay lookup");
    seen.length = 0;
    const bad = await handleAccess({ action: "pay", rental_id: o5.body.rentalId, creator_secret: "y".repeat(32) }, { env: ON, deps: m5.d });
    assert.deepEqual([bad.status, bad.body.error], [404, "not_found"], "wrong secret still not_found");
    assert.equal(seen.filter((k) => k.startsWith("rid:")).length, 1, "a wrong secret is still charged");
  }

  // ── Phone hand-off to a wallet app (no secret in any link) ─────────────
  {
    assert.ok(SIGNATURE_RE.test("0x" + "1".repeat(130)));
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    assert.equal(isMobileDevice(iphone), true); assert.equal(isMobileDevice(android), true);
    assert.equal(isMobileDevice(mac, 0), false, "desktop Mac"); assert.equal(isMobileDevice(mac, 5), true, "iPadOS reports as a touch Mac");
    assert.equal(handoffUrl("https://galaxymind.space", { rigs: 2, days: 3 }), "https://galaxymind.space/hashrate/rent?rigs=2&days=3");
    assert.equal(handoffUrl("https://galaxymind.space/x?y=1#s=SECRET", { rigs: 1, days: 1 }), "https://galaxymind.space/hashrate/rent?rigs=1&days=1", "origin only");
    assert.equal(handoffUrl("https://galaxymind.space", { rigs: 1.5, days: -2 }), "https://galaxymind.space/hashrate/rent", "junk counts dropped");
    assert.equal(handoffUrl("https://galaxymind.space", { pay: "gm_abcdefgh12" }), "https://galaxymind.space/hashrate/rent?pay=gm_abcdefgh12");
    assert.equal(handoffUrl("https://galaxymind.space", { pay: "gm_x#s=SECRET" }), null, "bad rental ID refused");
    assert.equal(handoffUrl("http://galaxymind.space", { rigs: 1 }), null, "https only");
    const links = walletAppLinks("https://galaxymind.space/hashrate/rent?pay=gm_abcdefgh12");
    assert.deepEqual(links.map((l) => l.href), [
      "https://go.cb-w.com/dapp?cb_url=https%3A%2F%2Fgalaxymind.space%2Fhashrate%2Frent%3Fpay%3Dgm_abcdefgh12",
      "https://link.metamask.io/dapp/galaxymind.space/hashrate/rent?pay=gm_abcdefgh12",
    ]);
    assert.deepEqual(walletAppLinks("https://galaxymind.space/hashrate/rent#s=SECRET"), [], "never a link with a fragment");
    assert.deepEqual(walletAppLinks("javascript:alert(1)"), [], "https only");
    const ui = readFileSync(join(ROOT, "src/app/hashrate/rent/RentCheckout.tsx"), "utf8");
    const calls = [...ui.matchAll(/handoffUrl\(([^)]*)\)/g)].map((m) => m[1]);
    assert.ok(calls.length >= 2 && calls.every((c) => !/secret|creatorSecret|hash/i.test(c)), "hand-off links never get the secret or the fragment");
    // Base Account (passkey smart wallet): SDK loaded lazily, smart wallet only (no QR relay), no telemetry.
    assert.ok(!/^import[^\n]*@coinbase\/wallet-sdk/m.test(ui) && /import\("@coinbase\/wallet-sdk"\)/.test(ui), "SDK is a lazy chunk, not in the main bundle");
    assert.ok(/preference: \{ options: "smartWalletOnly" \}/.test(ui) && !/telemetry:/.test(ui), "smart wallet only; no option the SDK doesn't have");
    assert.ok((ui.match(/Only paste your rental secret on galaxymind\.space\./g) ?? []).length >= 2, "phishing line by the hand-off steps and the paste form");
    const pj = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.deepEqual([pj.overrides.viem, pj.overrides.ox], ["2.55.19", "0.14.34"], "viem/ox pinned to established releases");
    assert.equal(isCounterfactualSignature("0x" + "ab".repeat(200) + "6492".repeat(16)), true);
    assert.equal(isCounterfactualSignature("0x" + "ab".repeat(65)), false);
    assert.equal(COUNTERFACTUAL_VERIFY_COPY.charged, "no");
    const nc = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    assert.ok(/source: "\/hashrate\/rent",\s*headers: \[\{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" \}\]/.test(nc), "COOP relaxed on the checkout only");
    assert.ok(nc.indexOf('source: "/hashrate/rent"') > nc.indexOf('source: "/:path*"'), "checkout COOP comes after (overrides) the sitewide one");
    assert.equal((nc.match(/same-origin-allow-popups/g) ?? []).length >= 1 && (nc.match(/value: "same-origin" \}/g) ?? []).length, 1, "sitewide COOP unchanged");
    assert.ok(/needsWalletApp = mobile && discovered && wallets\.length === 0 && !injected/.test(ui), "hand-off only on a phone with no wallet at all");
  }

  // ── Pay on your phone (desktop QR) ─────────────────────────────────────
  {
    assert.equal(phonePayUrl("https://galaxymind.space", "gm_abcdefgh12"), "https://galaxymind.space/hashrate/rent?pay=gm_abcdefgh12");
    assert.equal(phonePayUrl("https://galaxymind.space/hashrate/rent?pay=x#s=SECRET", "gm_abcdefgh12"), "https://galaxymind.space/hashrate/rent?pay=gm_abcdefgh12", "origin only, no fragment");
    assert.equal(phonePayUrl("https://galaxymind.space", "gm_x#s=SECRET"), null, "bad rental ID refused");
    assert.equal(phonePayUrl("javascript:alert(1)", "gm_abcdefgh12"), null);
    const ui = readFileSync(join(ROOT, "src/app/hashrate/rent/RentCheckout.tsx"), "utf8");
    const qr = ui.slice(ui.indexOf("function PhonePayQr"), ui.indexOf("function TrustLine"));
    assert.ok(/phonePayUrl\(window\.location\.origin, rentalId\)/.test(qr) && !/secret|creatorSecret|payTo|chain\./i.test(qr.replace(/\{\/\*[\s\S]*?\*\/\}|\/\*\*[\s\S]*?\*\//g, "").replace(/never the secret|paste your rental secret/g, "")), "QR gets the rental ID only");
    assert.ok(/import\("qrcode"\)/.test(qr) && !/https?:\/\/[^"'`]*(qr|chart)/i.test(qr), "drawn locally, lazy, no image service");
    assert.ok(/<PhonePayQr rentalId=\{order\.rentalId\} \/>/.test(ui) && /hidden md:flex/.test(qr), "desktop only, on the Pay step");
    const gate = qr.indexOf("if (!want) return;");
    assert.ok(gate > 0 && /wantsPhoneQr\(navigator\.userAgent/.test(qr) && gate < qr.indexOf('import("qrcode")'), "qrcode is never imported on phones: the dynamic import sits behind the device check");
    assert.ok(/mq\?\.addEventListener\?\.\("change", check\)/.test(qr) && /removeEventListener\?\.\("change", check\)/.test(qr), "re-checked when the md breakpoint is crossed (resize/rotate), listener cleaned up");
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
    const ipad = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
    const ipados = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
    const pixel = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";
    const tab = "Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 Chrome/130 Safari/537.36";
    const win = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
    assert.equal(wantsPhoneQr(win, 0, true), true, "desktop, wide");
    assert.equal(wantsPhoneQr(win, 0, false), false, "desktop, narrow window");
    assert.equal(wantsPhoneQr(ipad, 5, true), true, "iPad, wide");
    assert.equal(wantsPhoneQr(ipados, 5, true), true, "iPadOS as touch Mac, wide");
    assert.equal(wantsPhoneQr(tab, 5, true), true, "Android tablet, wide");
    assert.equal(wantsPhoneQr(ipad, 5, false), false, "iPad split view, narrow");
    assert.equal(wantsPhoneQr(iphone, 5, true), false, "iPhone, even landscape");
    assert.equal(wantsPhoneQr(pixel, 5, true), false, "Android phone, even landscape");
    assert.equal(isTabletDevice(ipados, 0), false, "a real Mac (no touch) is not a tablet");
    assert.ok(/Only paste your rental secret on galaxymind\.space\./.test(qr), "paste-only line on the QR card");
    assert.ok(/the Save this box on the computer or tablet where you started/.test(qr), "QR card says where the secret is");
    assert.ok(ui.includes("Started this order on your computer or in your phone&apos;s browser? Paste the rental secret from its Save this box, then tap Find my order. Only paste your rental secret on galaxymind.space."), "combined paste line");
  }

  console.log("test-human-checkout: ok");
})().catch((e) => { console.error(e); process.exit(1); });
