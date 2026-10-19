// Phase 2 paid rentals · STAGING ONLY. Every path: happy, idempotency replay,
// double-pay, expiry race, underpay, late pay, overpay, refunds, cap,
// kill switch, extend, blocked-term output, job signing and replay.
import { TEST_PAYTO_EVM as PINNED_PAYTO, TEST_PAYTO_SOLANA as PINNED_SOLANA_PAYTO, TEST_PAYTO_PINS } from "./lib/test-payto";
import "./lib/server-only-stub"; // first: the pricing loader lazily imports a server-only module
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { MemoryStore } from "../src/lib/rentals/phase2/store";
import { MockProvider } from "../src/lib/rentals/phase2/providers";
import { createRental, confirmPayment, getRental, extendRental, sweepExpired, markDelivered, cancelRental, PAY_TTL_MS, type Deps } from "../src/lib/rentals/phase2/service";
import { priceOrder, effectiveFloor, MAX_TERM_SEC } from "../src/lib/rentals/phase2/pricing";
import { MAX_RIGS, MAX_DAYS } from "../src/lib/rentals/limits";
import { TRANSITIONS } from "../src/lib/rentals/phase2/types";
import { validateCreate } from "../src/lib/rentals/phase2/validate";
import { canonicalize, verifyJob, signJob, FileLedger, type NonceLedger, type SignedJob, type JobPayload } from "../src/lib/rentals/phase2/jobs";
import { POOL_HOST_SUFFIXES, POOL_PORTS } from "../src/lib/rentals/phase2/validate";
import { MockAlerter, Limiter, killSwitchFrom, supabaseFlagReader } from "../src/lib/rentals/phase2/safety";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RENTAL_TERMS_VERSION } from "../src/lib/rentals/phase2/terms";
import { phase2Enabled } from "../src/lib/rentals/phase2/flag";
import { useSyntheticNeverReveal, leaksNeverReveal, SYNTH } from "./lib/never-reveal-test";
useSyntheticNeverReveal();

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const PRIV = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUB = publicKey.export({ type: "spki", format: "pem" }).toString();
const T0 = Date.parse("2026-10-16T10:00:00Z");
const PRICING = { marketAskBtcPhDay: 0.00052, floorBtcPhDay: 0.000501, hashpriceSatsThDay: 47, writtenAt: T0 - 3600_000 };

function mk(over: Partial<Deps> = {}) {
  let now = T0;
  const ln = new MockProvider("lightning"), x = new MockProvider("x402_usdc");
  const store = new MemoryStore();
  const alerter = new MockAlerter();
  let kill = false;
  const d: Deps = { store, providers: { lightning: ln, x402_usdc: x }, pricing: async () => PRICING, btcUsd: async () => 82000, now: () => now,
    signingKeyPem: PRIV, signingKid: "t1", codeHmacKey: "k".repeat(32), killSwitch: async () => kill, alerter, lightningEnabled: true, pilot: false, bays: [1, 2, 3, 4, 5, 6], ...over };
  return { d, ln, x, store, alerter, tick: (ms: number) => { now += ms; }, setKill: (k: boolean) => { kill = k; } };
}
// Most paths below exercise the deferred Lightning code with the flag ON; the launch default (flag OFF) is tested separately.
const base = { th: 270, days: 1, pool_url: "stratum+tcp://stratum.braiins.com:3333", worker: "renter.w1", rail: "lightning" as string | undefined, accept_terms: true as unknown, terms_version: RENTAL_TERMS_VERSION as unknown };
const idem = () => crypto.randomBytes(12).toString("hex");
const ref = (s: MemoryStore, pid: string) => [...s.bindings.entries()].filter(([, b]) => s.orders.get(b.orderId)!.publicId === pid).map(([r]) => r);
type R = { rentalId: string; totalSats: number; creatorSecret: string; payment: { paymentRef: string } };
const res = (c: unknown) => (c as { result: R }).result;
const refundTotal = (s: MemoryStore, r: string) => s.refunds.filter((x) => x.providerRef === r).reduce((a, x) => a + x.atomic, 0);
const CAPS = { maxRigs: 4, maxSec: MAX_TERM_SEC, hostSuffixes: POOL_HOST_SUFFIXES, ports: POOL_PORTS };
const memLedger = (): NonceLedger => { const m = new Set<string>(); return { has: (n, j, a) => (!!n && m.has("n" + n)) || (!!j && m.has("j" + j)) || (!!a && m.has("a" + a)), add: (n, j, a) => { m.add("n" + n); m.add("j" + j); if (a) m.add("a" + a); } }; };
const vo = (keys: Record<string, string>, nowSec: number, ledger = memLedger()) => ({ keys, expectEnv: "staging" as const, nowSec, ledger, caps: CAPS });
/** create + pay in full + settle; returns code via creator secret */
async function paidRental(m: ReturnType<typeof mk>, extra: Record<string, unknown> = {}) {
  const c = await createRental(m.d, { ...base, idempotency_key: idem(), ...extra });
  assert.ok(c.ok, JSON.stringify(c));
  const r = res(c); const p = r.payment.paymentRef;
  (extra.rail === "x402_usdc" ? m.x : m.ln).simulatePay(p, m.store.bindings.get(p)!.expectedAtomic, m.d.now());
  assert.equal((await confirmPayment(m.d, p)).outcome, "settled");
  const g = await getRental(m.d, { rental_id: r.rentalId, creator_secret: r.creatorSecret });
  const code = (g as unknown as { result: { accessCode: string } }).result.accessCode;
  assert.ok(code && code.length >= 22);
  return { r, p, code };
}

async function main() {
  // flag off by default
  assert.equal(phase2Enabled({}), false);
  assert.equal(phase2Enabled({ RENTALS_PHASE2_ENABLED: "1", RENTALS_PHASE2_MODE: "mainnet" }), false);
  assert.equal(phase2Enabled({ RENTALS_PHASE2_ENABLED: "1", RENTALS_PHASE2_MODE: "staging" }), true);

  // pricing: charge_btc = max(ask x 0.985, ceil_sat(floor x 1.03)); floor = max(published, hashprice*1.05); ask > 3x floor fails closed
  const { floorTermSats, askTermSats, chargeSatsPhDay } = await import("../src/lib/rentals/phase2/pricing");
  // The formula block runs with the MRR-minimum clamp off (min = 0); the clamp has its own asserts below.
  const p = priceOrder(PRICING, 270, 1, T0, 0);
  // default PRICING: ask x 0.985 < ceil_sat(floor x 1.03) -> floor term
  assert.ok(p.ok && p.priceBtcPhDay === floorTermSats(0.000501) / 1e8, "ceil_sat(floor x 1.03) wins on default PRICING");
  assert.ok(p.ok && p.totalSats === Math.ceil(floorTermSats(0.000501) * 0.27 - 1e-9));
  assert.equal(effectiveFloor({ ...PRICING, hashpriceSatsThDay: 50 }), 0.0005 * 1.05);
  const hpFloor = priceOrder({ ...PRICING, marketAskBtcPhDay: 0.00054, hashpriceSatsThDay: 51 }, 270, 1, T0, 0); // eff floor ~0.0005355; ceil_sat(x1.03) > ask*0.985
  assert.ok(hpFloor.ok && Math.abs(hpFloor.floorBtcPhDay - 0.0005355) < 1e-12, "hashprice sets effective floor");
  assert.ok(hpFloor.ok && hpFloor.priceBtcPhDay === floorTermSats(hpFloor.floorBtcPhDay) / 1e8, "hashprice ceil_sat(floor x 1.03)");
  assert.ok(hpFloor.ok && hpFloor.priceBtcPhDay >= askTermSats(0.00054) / 1e8, "floor term beats ask term");
  assert.ok(!priceOrder({ ...PRICING, hashpriceSatsThDay: 0 }, 270, 1, T0, 0).ok, "missing hashprice fails closed");
  assert.ok(!priceOrder({ ...PRICING, writtenAt: T0 - 37 * 3600_000 }, 270, 1, T0, 0).ok, "stale fails closed");
  assert.ok(!priceOrder(null, 270, 1, T0, 0).ok);
  {
    const { minTermSats: mts, DEFAULT_MIN_BTC_PH_DAY } = await import("../src/lib/rentals/phase2/pricing");
    const clamped = priceOrder(PRICING, 270, 1, T0);
    assert.ok(clamped.ok && clamped.priceBtcPhDay === Math.max(floorTermSats(0.000501), mts(DEFAULT_MIN_BTC_PH_DAY)) / 1e8, "B1: the MRR minimum clamps the charge from below");
    const hi = priceOrder(PRICING, 270, 1, T0, 0.0006);
    assert.ok(hi.ok && hi.priceBtcPhDay === mts(0.0006) / 1e8, "B1: a higher minimum wins");
  }
  const ns = priceOrder({ ...PRICING, marketAskBtcPhDay: 0.0004 }, 270, 1, T0, 0);
  assert.ok(ns.ok && ns.priceBtcPhDay === floorTermSats(0.000501) / 1e8, "ceil_sat(floor x 1.03) wins over a low ask");
  assert.ok(!priceOrder({ ...PRICING, marketAskBtcPhDay: NaN }, 270, 1, T0, 0).ok, "missing ask fails closed");
  assert.ok(chargeSatsPhDay(0.00060, 0.00050, 0) === askTermSats(0.00060), "charge picks ask term when above");
  assert.ok(chargeSatsPhDay(0.00040, 0.00050, 0) === floorTermSats(0.00050), "charge picks floor term when below");
  // ask just under / just over 3x effective floor
  const fl = PRICING.floorBtcPhDay; // 0.000501 (hashprice 47 -> 0.0004935 < published)
  const under = priceOrder({ ...PRICING, marketAskBtcPhDay: fl * 3 }, 270, 1, T0, 0);
  assert.ok(under.ok, "ask == 3x floor allowed");
  const over = priceOrder({ ...PRICING, marketAskBtcPhDay: fl * 3 + 1e-12 }, 270, 1, T0, 0);
  assert.ok(!over.ok && over.error === "ask_out_of_band", "ask just over 3x floor refused");
  // live loader maps columns and fails closed
  const { loadPricingDaily } = await import("../src/lib/rentals/phase2/pricing");
  const env = { RENTALS_SUPABASE_URL: "https://x.supabase.co", RENTALS_SUPABASE_KEY: "k" };
  const fk = (rows: unknown, ok = true) => (async () => ({ ok, json: async () => rows })) as unknown as typeof fetch;
  const lp = await loadPricingDaily(env, fk([{ mrr_ask_btc_ph_day: "0.00052", floor_btc_ph_day: "0.000501", hashprice_sats_th_day: "47", written_at: "2026-10-16T09:00:00Z" }]));
  assert.ok(lp && lp.marketAskBtcPhDay === 0.00052 && lp.hashpriceSatsThDay === 47);
  assert.equal(await loadPricingDaily(env, fk([{ mrr_ask_btc_ph_day: null, floor_btc_ph_day: "0.0005", hashprice_sats_th_day: "47", written_at: "2026-10-16T09:00:00Z" }])), null);
  assert.equal(await loadPricingDaily(env, fk([], true)), null);
  assert.equal(await loadPricingDaily(env, fk(null, false)), null);
  assert.equal(await loadPricingDaily({}, fk([])), null);

  // validation
  for (const bad of [{ th: 100 }, { th: 0 }, { th: 271 }, { days: 0 }, { days: 1.5 }, { days: 31 },
    { pool_url: "stratum+tcp://192.0.2.42:8332" }, { pool_url: "http://stratum.braiins.com:3333" }, { pool_url: "stratum+ssl://stratum.braiins.com:3333" },
    { pool_url: "stratum+tcp://pool.lan:3333" }, { worker: "x;curl evil" }, { worker: "" }]) {
    assert.equal(validateCreate({ ...base, idempotency_key: idem(), ...bad }).ok, false, JSON.stringify(bad));
  }
  // Outside pools: a non-catalog host, or a catalog host on an unlisted port, is accepted and held for approval (manual).
  for (const u of ["stratum+tcp://evil.example.com:3333", "stratum+tcp://stratum.braiins.com:22"]) {
    const v = validateCreate({ ...base, idempotency_key: idem(), pool_url: u });
    assert.ok(v.ok && v.v.approval === "manual" && v.v.poolId === null, u);
  }
  { const v = validateCreate({ ...base, idempotency_key: idem() }); assert.ok(v.ok && v.v.approval === "auto" && v.v.poolId === "braiins"); }
  assert.equal((validateCreate({ ...base, th: 1350, idempotency_key: idem() }) as { error: string }).error, "cap_exceeded");
  assert.equal(validateCreate({ ...base, idempotency_key: "short" }).ok, false);

  // ---- happy path + signed job verify (rev 1.7: lightning jobs are refused by schemaOk (J18), so this runs on x402)
  {
    const m = mk(); const { d, store } = m;
    { // the deferred lightning flow still settles, but its job no longer passes rev 1.7
      const ln = await paidRental(m); const lj = (await store.listJobs(ln.r.rentalId))[0];
      assert.deepEqual(verifyJob(lj, vo({ t1: PUB }, Math.floor(d.now() / 1000))), { ok: false, reason: "schema_payment", stage: "schema" }, "J18 lightning refused");
    }
    const { r, code } = await paidRental(m, { rail: "x402_usdc" });
    const g = await getRental(d, { access_code: code });
    assert.ok(g.ok && (g.result as { status: string }).status === "delivering");
    const jobs = await store.listJobs(r.rentalId);
    assert.equal(jobs.length, 1);
    const now = Math.floor(d.now() / 1000);
    assert.deepEqual(verifyJob(jobs[0], vo({ t1: PUB }, now)), { ok: true });
    const led = memLedger(); verifyJob(jobs[0], vo({ t1: PUB }, now, led));
    assert.equal((verifyJob(jobs[0], vo({ t1: PUB }, now, led)) as { reason: string }).reason, "replay");
    assert.equal((verifyJob(jobs[0], vo({ t1: PUB }, now + 16 * 60)) as { reason: string }).reason, "expired");
    assert.equal((verifyJob(jobs[0], vo({ other: PUB }, now)) as { reason: string }).reason, "unknown_kid");
    assert.equal((verifyJob(jobs[0], { ...vo({ t1: PUB }, now), expectEnv: "mainnet" }) as { reason: string }).reason, "wrong_env");
    const tampered = structuredClone(jobs[0]); tampered.payload.upstream!.host = "evil.braiins.com";
    assert.equal((verifyJob(tampered, vo({ t1: PUB }, now)) as { reason: string }).reason, "bad_signature");
    // valid signature but off-allowlist pool / over cap / extra key -> rejected (schema after sig)
    const sign = (mut: (p: SignedJob["payload"]) => void) => { const j = structuredClone(jobs[0]); mut(j.payload); return signJob(j.payload, PRIV, "t1"); };
    assert.equal((verifyJob(sign((p) => { p.upstream!.host = "evil.example.com"; }), vo({ t1: PUB }, now)) as { reason: string }).reason, "pool_not_allowlisted");
    assert.equal((verifyJob(sign((p) => { p.upstream!.port = 8332; }), vo({ t1: PUB }, now)) as { reason: string }).reason, "pool_port");
    assert.equal((verifyJob(sign((p) => { p.rig_count = 5; }), vo({ t1: PUB }, now)) as { reason: string }).reason, "cap_rigs");
    assert.equal((verifyJob(sign((p) => { p.end = p.start + 31 * 86400; }), vo({ t1: PUB }, now)) as { reason: string }).reason, "cap_length");
    assert.equal((verifyJob(sign((p) => { (p as unknown as Record<string, unknown>).extra = "x"; }), vo({ t1: PUB }, now)) as { reason: string }).reason, "schema_keys");
    assert.equal((verifyJob(sign((p) => { p.upstream!.user = "a".repeat(65); }), vo({ t1: PUB }, now)) as { reason: string }).reason, "pool_user");
    // Ed25519 pinned: an RSA key under a valid kid is refused
    const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
    assert.equal((verifyJob(jobs[0], vo({ t1: rsa }, now)) as { reason: string }).reason, "bad_key_type");
    // durable ledger survives a restart
    const dir = mkdtempSync(join(tmpdir(), "gmled-")); const lp = join(dir, "ledger.jsonl");
    assert.ok(verifyJob(jobs[0], vo({ t1: PUB }, now, new FileLedger(lp))).ok);
    assert.equal((verifyJob(jobs[0], vo({ t1: PUB }, now, new FileLedger(lp))) as { reason: string }).reason, "replay", "ledger reloaded from disk");
    rmSync(dir, { recursive: true });
    assert.ok(!JSON.stringify(store).includes(code), "code never stored");
    assert.ok((await markDelivered(d, r.rentalId)).ok);
    const coarse = await getRental(d, { rental_id: r.rentalId });
    assert.ok(coarse.ok && !("renterPool" in coarse.result) && !("accessCode" in coarse.result));
    assert.equal(((await getRental(d, { rental_id: r.rentalId, creator_secret: "wrong".repeat(6) })) as { result: object }).result.hasOwnProperty("accessCode"), false);
  }

  // ---- Review A: underpay then top-up -> settles, refunds never exceed received
  {
    const m = mk(); const { d, ln, store } = m;
    const c = await createRental(d, { ...base, idempotency_key: idem() }); const r = res(c); const p = r.payment.paymentRef;
    ln.simulatePay(p, 100, d.now());
    assert.equal((await confirmPayment(d, p)).outcome, "underpaid_waiting");
    assert.equal(store.refunds.length, 0, "no refund while still inside the window");
    ln.simulatePay(p, r.totalSats, d.now());
    assert.equal((await confirmPayment(d, p)).outcome, "settled");
    assert.equal(refundTotal(store, p), 100, "only the excess is refunded");
    assert.equal((await confirmPayment(d, p)).outcome, "already_settled");
    assert.equal(refundTotal(store, p), 100, "repeat confirm adds nothing");
    assert.ok(refundTotal(store, p) <= r.totalSats + 100);
    // a late top-up after settle refunds only the new money
    ln.simulatePay(p, 50, d.now()); await confirmPayment(d, p);
    assert.equal(refundTotal(store, p), 150);
  }
  // underpay that never tops up -> refunded in full at expiry, once
  {
    const m = mk(); const { d, ln, store, tick } = m;
    const c = await createRental(d, { ...base, idempotency_key: idem() }); const p = res(c).payment.paymentRef;
    ln.simulatePay(p, 100, d.now()); await confirmPayment(d, p);
    tick(PAY_TTL_MS + 1);
    await Promise.all([sweepExpired(d), sweepExpired(d), confirmPayment(d, p)]);
    assert.equal(refundTotal(store, p), 100); assert.equal(store.refunds[0].reason, "underpaid");
    assert.equal([...store.orders.values()][0].state, "refund_pending"); assert.equal(store.jobs.length, 0);
  }

  // ---- Review B: extend honors idempotency; 30-day cap + kill re-checked at settle
  {
    const m = mk(); const { d, ln, store } = m;
    const { r, code } = await paidRental(m);
    const k = idem();
    const [e1, e2] = await Promise.all([extendRental(d, { access_code: code, days: 29, idempotency_key: k }), extendRental(d, { access_code: code, days: 29, idempotency_key: k })]);
    assert.ok(e1.ok && e2.ok);
    const ext = ref(store, r.rentalId).filter((x) => store.bindings.get(x)!.kind === "extension");
    assert.equal(ext.length, 1, "same key -> one invoice");
    assert.equal(JSON.stringify((e1 as { result: { payment: unknown } }).result.payment), JSON.stringify((e2 as { result: { payment: unknown } }).result.payment));
    const conflict = await extendRental(d, { access_code: code, days: 2, idempotency_key: k });
    assert.ok(!conflict.ok && conflict.error === "idempotency_conflict");
    // a second, different-key extension issued while the first is unpaid
    const e3 = await extendRental(d, { access_code: code, days: 29, idempotency_key: idem() });
    assert.ok(e3.ok);
    const all = ref(store, r.rentalId).filter((x) => store.bindings.get(x)!.kind === "extension");
    assert.equal(all.length, 2);
    for (const x of all) ln.simulatePay(x, store.bindings.get(x)!.expectedAtomic, d.now());
    let outs = await Promise.all(all.map((x) => confirmPayment(d, x)));
    // a concurrent loser returns "retry" and writes nothing; the next webhook/sweep resolves it
    for (let i = 0; i < outs.length; i++) if (outs[i].outcome === "retry") outs[i] = await confirmPayment(d, all[i]);
    assert.deepEqual(outs.map((o) => o.outcome).sort(), ["cap_exceeded", "extended"].sort());
    const o = [...store.orders.values()][0];
    assert.equal(o.days, 30, "never past 30 days");
    assert.ok(store.refunds.some((x) => x.reason === "cap_exceeded"));
    // kill switch at extension settle
    const m2 = mk(); const pr = await paidRental(m2);
    const e = await extendRental(m2.d, { access_code: pr.code, days: 1, idempotency_key: idem() });
    const xr = (e as unknown as { result: { payment: { paymentRef: string } } }).result.payment.paymentRef;
    m2.setKill(true); m2.ln.simulatePay(xr, m2.store.bindings.get(xr)!.expectedAtomic, m2.d.now());
    assert.equal((await confirmPayment(m2.d, xr)).outcome, "kill_switch");
    assert.equal([...m2.store.orders.values()][0].days, 1);
    assert.ok(m2.alerter.sent.some((a) => a.kind === "refund_kill_switch"));
  }

  // ---- Review C: payment_ref never reveals the code, even if a webhook settles first
  {
    const m = mk(); const { d, ln, store } = m;
    const c = await createRental(d, { ...base, idempotency_key: idem() }); const r = res(c); const p = r.payment.paymentRef;
    ln.simulatePay(p, r.totalSats, d.now());
    const w = await confirmPayment(d, p); // webhook wins
    assert.equal(w.outcome, "settled"); assert.ok(!("accessCode" in w));
    assert.equal((await confirmPayment(d, p)).outcome, "already_settled");
    const anon = await getRental(d, { rental_id: r.rentalId });
    assert.ok(anon.ok && !JSON.stringify(anon).includes("accessCode"));
    const owner = await getRental(d, { rental_id: r.rentalId, creator_secret: r.creatorSecret });
    const code = (owner as unknown as { result: { accessCode: string } }).result.accessCode;
    assert.ok(code, "creator still gets the code after a webhook settle");
    assert.ok((await getRental(d, { access_code: code })).ok);
    // replay of create never repeats the secret
    const again = await createRental(d, { ...base, idempotency_key: store.orders.values().next().value!.idemKey });
    assert.ok(again.ok && !JSON.stringify(again).includes(r.creatorSecret));
    // codes expire at end + grace
    m.tick(1 * 86_400_000 + 7 * 86_400_000 + 1);
    const ex = await getRental(d, { access_code: code });
    assert.ok(!ex.ok && ex.error === "code_expired");
  }

  // ---- idempotency replay + conflict + concurrent replay (create)
  {
    const { d, store } = mk();
    const k = idem();
    const [a, b] = await Promise.all([createRental(d, { ...base, idempotency_key: k }), createRental(d, { ...base, idempotency_key: k })]);
    assert.ok(a.ok && b.ok);
    assert.equal(store.orders.size, 1, "one order per key");
    assert.equal(store.bindings.size, 1, "one invoice per key");
    const again = await createRental(d, { ...base, idempotency_key: k });
    assert.ok(again.ok && again.replay);
    const conflict = await createRental(d, { ...base, days: 2, idempotency_key: k });
    assert.ok(!conflict.ok && conflict.error === "idempotency_conflict");
  }

  // ---- double-pay: concurrent confirms settle once, one job
  {
    const { d, ln, store } = mk();
    const c = await createRental(d, { ...base, idempotency_key: idem() }); const p = res(c).payment.paymentRef;
    ln.simulatePay(p, store.bindings.get(p)!.expectedAtomic, d.now());
    const outs = await Promise.all([confirmPayment(d, p), confirmPayment(d, p), confirmPayment(d, p)]);
    assert.equal(outs.filter((o) => o.outcome === "settled").length, 1, "single settle");
    assert.equal(store.payments.filter((x) => x.settles).length, 1);
    assert.equal(store.jobs.length, 1, "one job");
    assert.equal(store.refunds.length, 0);
  }

  // ---- overpay -> settles, excess queued once
  {
    const { d, ln, store } = mk();
    const c = await createRental(d, { ...base, idempotency_key: idem() }); const p = res(c).payment.paymentRef;
    ln.simulatePay(p, store.bindings.get(p)!.expectedAtomic + 500, d.now());
    assert.equal((await confirmPayment(d, p)).outcome, "settled");
    assert.equal(store.refunds[0].reason, "overpaid"); assert.equal(refundTotal(store, p), 500);
  }

  // ---- late pay and expiry race
  {
    const { d, ln, store, tick } = mk();
    const c = await createRental(d, { ...base, idempotency_key: idem() }); const p = res(c).payment.paymentRef;
    tick(PAY_TTL_MS + 1);
    ln.simulatePay(p, store.bindings.get(p)!.expectedAtomic, d.now());
    const [, cp] = await Promise.all([sweepExpired(d), confirmPayment(d, p)]);
    assert.ok(["late", "retry"].includes(cp.outcome));
    await confirmPayment(d, p);
    assert.equal(refundTotal(store, p), store.bindings.get(p)!.expectedAtomic, "refund equals received, once");
    assert.equal([...store.orders.values()][0].state, "refund_pending");
    assert.equal(store.jobs.length, 0, "late pay never routes");
  }
  // paid on time, sweeper ran before confirm: order is expired -> refund, never routed
  {
    const { d, ln, store, tick } = mk();
    const c = await createRental(d, { ...base, idempotency_key: idem() }); const p = res(c).payment.paymentRef;
    tick(PAY_TTL_MS - 1); ln.simulatePay(p, store.bindings.get(p)!.expectedAtomic, d.now()); tick(5);
    await sweepExpired(d);
    assert.equal(store.jobs.length, 0);
    assert.equal(refundTotal(store, p), store.bindings.get(p)!.expectedAtomic);
  }

  // ---- cap: soft at create, hard at settle; StaleVersion in cap branch handled
  {
    const m = mk(); const { d, ln, store } = m;
    assert.ok(validateCreate({ ...base, th: 1080, idempotency_key: idem() }).ok, "4 rigs allowed");
    const a = await createRental(d, { ...base, th: 810, idempotency_key: idem() });
    assert.ok(a.ok);
    const b = await createRental(d, { ...base, th: 540, idempotency_key: idem() });
    assert.ok(!b.ok && b.error === "cap_exceeded");
    const pa = res(a).payment.paymentRef;
    ln.simulatePay(pa, store.bindings.get(pa)!.expectedAtomic, d.now());
    assert.equal((await confirmPayment(d, pa)).outcome, "settled");
    // second order squeezed past the soft check (simulates a race), then paid -> cap refund
    const o2 = { ...[...store.orders.values()][0], id: crypto.randomUUID(), publicId: "gm_forcedorder2", idemKey: idem(), state: "awaiting_payment" as const, rigCount: 2, version: 0 };
    await store.insertOrder(o2, { key: o2.idemKey, tool: "create_rental", requestHash: "x", orderId: o2.id, providerRef: null });
    const ch = await ln.create({ orderRef: o2.publicId, amountAtomic: 10, expiresAt: d.now() + PAY_TTL_MS });
    await store.commit({ binding: { ref: ch.providerRef, b: { orderId: o2.id, kind: "initial", expectedAtomic: 10, expiresAt: d.now() + PAY_TTL_MS, extendDays: null, challenge: null } } });
    ln.simulatePay(ch.providerRef, 10, d.now());
    const outs = await Promise.all([confirmPayment(d, ch.providerRef), confirmPayment(d, ch.providerRef)]);
    assert.ok(outs.some((o) => o.outcome === "cap_exceeded") && outs.every((o) => ["cap_exceeded", "retry", "late", "underpaid"].includes(o.outcome) || o.outcome === "cap_exceeded"));
    assert.equal(refundTotal(store, ch.providerRef), 10, "cap refund once, never twice");
    // refund_pending orders don't count against the cap (no rig was ever assigned)
    assert.equal(await store.rigsCommitted(d.now()), 3);
  }

  // ---- Review #76 must-fix 1: two concurrent 1080 TH creates must not both settle
  {
    const m = mk(); const { d, ln, store } = m;
    const c1 = await createRental(d, { ...base, th: 1080, idempotency_key: idem() });
    assert.ok(c1.ok);
    // second order squeezes past the soft hold (simulates the create race)
    const o1 = [...store.orders.values()][0];
    const o2 = { ...o1, id: crypto.randomUUID(), publicId: "gm_raceorder0002", idemKey: idem(), version: 0 };
    await store.insertOrder(o2, { key: o2.idemKey, tool: "create_rental", requestHash: "x", orderId: o2.id, providerRef: null });
    const ch2 = await ln.create({ orderRef: o2.publicId, amountAtomic: 10, expiresAt: d.now() + PAY_TTL_MS });
    await store.commit({ binding: { ref: ch2.providerRef, b: { orderId: o2.id, kind: "initial", expectedAtomic: 10, expiresAt: d.now() + PAY_TTL_MS, extendDays: null, challenge: null } } });
    const p1 = res(c1).payment.paymentRef;
    ln.simulatePay(p1, store.bindings.get(p1)!.expectedAtomic, d.now()); ln.simulatePay(ch2.providerRef, 10, d.now());
    const outs = await Promise.all([confirmPayment(d, p1), confirmPayment(d, ch2.providerRef)]);
    assert.deepEqual(outs.map((o) => o.outcome).sort(), ["cap_exceeded", "settled"]);
    assert.equal(await store.rigsCommitted(d.now()), 4, "never past the 4-rig pilot cap");
    // the store itself refuses a direct over-cap commit
    const loser = [...store.orders.values()].find((o) => o.state === "refund_pending")!;
    await assert.rejects(store.commit({ order: { id: loser.id, fromVersion: loser.version, patch: { state: "delivering" } } }));
    // illegal transition refused at the commit layer
    const won = [...store.orders.values()].find((o) => o.state === "delivering")!;
    await assert.rejects(store.commit({ order: { id: won.id, fromVersion: won.version, patch: { state: "awaiting_payment" } } }), /illegal_transition/);
  }

  // ---- kill flag flipped after the app-side check: the commit (rental_settle) refuses and we refund
  {
    const m = mk(); const { d, ln, store } = m;
    const c = await createRental(d, { ...base, idempotency_key: idem() }); const r = res(c); const p = r.payment.paymentRef;
    ln.simulatePay(p, r.totalSats, d.now());
    store.rentalsEnabled = false; // DB row off; app-side killSwitch() still says on
    assert.equal((await confirmPayment(d, p)).outcome, "kill_switch");
    assert.equal(refundTotal(store, p), r.totalSats); assert.equal(store.jobs.length, 0);
    assert.equal([...store.orders.values()][0].state, "refund_pending");
    // extension settle is re-checked too
    const m2 = mk(); const pr = await paidRental(m2);
    const e = await extendRental(m2.d, { access_code: pr.code, days: 2, idempotency_key: idem() });
    const xr = (e as unknown as { result: { payment: { paymentRef: string } } }).result.payment.paymentRef;
    m2.ln.simulatePay(xr, m2.store.bindings.get(xr)!.expectedAtomic, m2.d.now());
    m2.store.rentalsEnabled = false;
    assert.equal((await confirmPayment(m2.d, xr)).outcome, "kill_switch");
    assert.equal([...m2.store.orders.values()][0].days, 1);
    assert.ok(refundTotal(m2.store, xr) > 0);
    // awaiting_payment -> failed is refused (TS and SQL agree)
    const m3 = mk(); await createRental(m3.d, { ...base, idempotency_key: idem() });
    const o3 = [...m3.store.orders.values()][0];
    await assert.rejects(m3.store.commit({ order: { id: o3.id, fromVersion: o3.version, patch: { state: "failed" } } }), /illegal_transition/);
  }

  // ---- Review #87 S1: an extension paid after the rental end is refunded, never applied from the stale end
  {
    const m = mk(); const { d, ln, store } = m;
    const { r, code } = await paidRental(m);
    const e = await extendRental(d, { access_code: code, days: 1, idempotency_key: idem() });
    assert.ok(e.ok, JSON.stringify(e));
    const xr = ref(store, r.rentalId).find((x) => store.bindings.get(x)!.kind === "extension")!;
    const o = [...store.orders.values()][0];
    const end0 = o.endsAt!; const days0 = o.days;
    // the rental end passes; the sweep hasn't moved the order yet (still active/delivering)
    m.tick(end0 - d.now() + 1000);
    store.bindings.get(xr)!.expiresAt = d.now() + PAY_TTL_MS; // the invoice itself is still inside its window
    ln.simulatePay(xr, store.bindings.get(xr)!.expectedAtomic, d.now());
    const jobs0 = store.jobs.length;
    assert.equal((await confirmPayment(d, xr)).outcome, "late", "extension after the end = refund");
    const o2 = [...store.orders.values()][0];
    assert.equal(o2.days, days0, "days unchanged"); assert.equal(o2.endsAt, end0, "end unchanged");
    assert.equal(store.jobs.length, jobs0, "no extend job");
    assert.equal(refundTotal(store, xr), store.bindings.get(xr)!.expectedAtomic, "full extension amount refunded");
  }

  // ---- underpaid extension past its TTL is swept to a refund
  {
    const m = mk(); const { d, ln, store } = m;
    const { r, code } = await paidRental(m);
    const e = await extendRental(d, { access_code: code, days: 2, idempotency_key: idem() });
    assert.ok(e.ok);
    const xr = ref(store, r.rentalId).find((x) => store.bindings.get(x)!.kind === "extension")!;
    ln.simulatePay(xr, 5, d.now());
    assert.equal((await confirmPayment(d, xr)).outcome, "underpaid_waiting");
    m.tick(PAY_TTL_MS + 1000);
    await sweepExpired(d);
    assert.equal(refundTotal(store, xr), 5, "partial extension money refunded after TTL");
    assert.equal([...store.orders.values()][0].days, 1);
  }

  // ---- kill switch: create refused; payment after kill -> refund (StaleVersion-safe)
  {
    const m = mk(); const { d, ln, store, setKill } = m;
    const c = await createRental(d, { ...base, idempotency_key: idem() }); const p = res(c).payment.paymentRef;
    setKill(true);
    assert.equal((await createRental(d, { ...base, idempotency_key: idem() })).ok, false);
    ln.simulatePay(p, store.bindings.get(p)!.expectedAtomic, d.now());
    const outs = await Promise.all([confirmPayment(d, p), confirmPayment(d, p)]);
    assert.ok(outs.some((o) => o.outcome === "kill_switch"));
    await confirmPayment(d, p);
    assert.equal(refundTotal(store, p), store.bindings.get(p)!.expectedAtomic);
    assert.equal(store.jobs.length, 0);
    assert.ok(m.alerter.sent.some((a) => a.kind === "refund_kill_switch"));
  }
  // kill switch sources: env, Supabase flag, unreadable flag
  {
    assert.equal(await killSwitchFrom({ RENTALS_KILL: "1" }, async () => true)(), true);
    assert.equal(await killSwitchFrom({}, async () => true)(), false);
    assert.equal(await killSwitchFrom({}, async () => false)(), true);
    assert.equal(await killSwitchFrom({}, async () => null)(), true, "unreadable = killed");
    assert.equal(await killSwitchFrom({}, async () => { throw new Error("net"); })(), true);
    const env = { RENTALS_PHASE2_SUPABASE_URL: "https://x.supabase.co", RENTALS_PHASE2_SUPABASE_SERVICE_KEY: "k" };
    const f = (rows: unknown) => (async () => ({ ok: true, json: async () => rows })) as unknown as typeof fetch;
    assert.equal(await supabaseFlagReader({ RENTALS_SUPABASE_URL: "https://x.supabase.co", RENTALS_SUPABASE_KEY: "anon" }, f([{ rentals_enabled: true }]))(), null, "public anon key is never used for the flag");
    assert.equal(await supabaseFlagReader(env, f([{ rentals_enabled: true }]))(), true);
    assert.equal(await supabaseFlagReader(env, f([{ rentals_enabled: false }]))(), false);
    assert.equal(await supabaseFlagReader(env, f([]))(), null);
    assert.equal(await supabaseFlagReader({}, f([]))(), null);
  }

  // ---- rate limits on lookups
  {
    const m = mk({ limiter: { global: new Limiter(1000, 60_000), perKey: new Limiter(3, 60_000) } });
    const { code } = await paidRental(m);
    for (let i = 0; i < 3; i++) assert.ok((await getRental(m.d, { access_code: code })).ok);
    const lim = await getRental(m.d, { access_code: code });
    assert.ok(!lim.ok && lim.error === "rate_limited");
    m.tick(61_000);
    assert.ok((await getRental(m.d, { access_code: code })).ok);
  }

  // ---- x402 rail on Base Sepolia, USDC rounded up
  {
    const { d, x } = mk();
    const c = await createRental(d, { ...base, rail: "x402_usdc", idempotency_key: idem() });
    assert.ok(c.ok);
    const pay = (c.result as unknown as { payment: { paymentRef: string; http402: { network: string; amount: string } } }).payment;
    assert.equal(pay.http402.network, "eip155:84532");
    x.simulatePay(pay.paymentRef, Number(pay.http402.amount), d.now());
    assert.equal((await confirmPayment(d, pay.paymentRef)).outcome, "settled");
  }
  // unknown ref / missing pricing
  {
    const { d } = mk({ pricing: async () => null });
    assert.equal((await confirmPayment(d, "nope")).outcome, "unknown_ref");
    const c = await createRental(d, { ...base, idempotency_key: idem() });
    assert.ok(!c.ok && c.error === "pricing_unavailable");
  }

  // ---- blocked-term output
  {
    const { d } = mk();
    const bl = await createRental(d, { ...base, worker: "MRR.w1", idempotency_key: idem() });
    assert.ok(!bl.ok && bl.error === "invalid_input" && !JSON.stringify(bl).includes("MRR.w1"));
    assert.equal((d.store as MemoryStore).orders.size, 0);
    const ok = await createRental(d, { ...base, idempotency_key: idem() });
    assert.ok(!/MRR|MiningRigRentals|us-south/i.test(JSON.stringify(ok)) && !leaksNeverReveal(JSON.stringify(ok)));
  }

  // ---- migration sanity (static checks security review asked for)
  {
    const sql = ["20261016120000_phase2_rentals_staging.sql", "20261016160000_phase2_mvp_usdc.sql", "20261016170000_phase2_store_x402.sql", "20261016180000_phase2_tx_hash_lower.sql", "20261016190000_phase2_reoffer.sql"].map((f) => readFileSync("supabase/migrations/" + f, "utf8")).join("\n");
    for (const needle of ["set search_path = ''", "for update", "illegal_transition", "cap_exceeded", "days between 1 and 30", "nonce = (payload->>'nonce')", "pool_port between 1 and 65535", "extend_days", "create role gm_node login", "rental_settle", "rental_settings", "rental_alerts"]) {
      assert.ok(sql.toLowerCase().includes(needle.toLowerCase()), "migration missing: " + needle);
    }
    assert.ok(!/with check \(true\)/i.test(sql), "job_results insert policy must be scoped");
    const lower = sql.toLowerCase().replace(/--[^\n]*/g, "");
    assert.ok(!/revoke[^;]*on\s+all\s+(functions|sequences|tables)\s+in\s+schema/.test(lower), "no blanket revoke in public");
    assert.ok(!/alter\s+default\s+privileges/.test(lower), "no default-privilege change in public");
    assert.ok(!/revoke[^;]*upsert_pricing_daily/.test(lower), "never revoke upsert_pricing_daily");
    assert.ok(!/upsert_pricing_daily/.test(lower), "migration never revokes, regrants or names upsert_pricing_daily");
    assert.ok(!/grant[^;]*on\s+function\s+(?!public\.rental_)/.test(lower), "grants only on rental functions");
    // only the sealed pool password is stored
    assert.ok(/pool_pass_sealed\s+bytea/.test(lower) && !/\bpool_pass\b(?!_sealed)/.test(lower) && !/pool_password/.test(lower), "no plaintext pool password column");
    // kill flag re-checked under the settle lock
    assert.ok(/select s\.rentals_enabled into enabled from public\.rental_settings s where s\.id = 1 for update/.test(lower) && /raise exception 'kill_switch'/.test(lower));
    // SQL state machine == TS TRANSITIONS (+ the one settle shortcut awaiting_payment -> delivering)
    const sqlT: Record<string, Set<string>> = {};
    for (const m of lower.matchAll(/\(cur_state = '([a-z_]+)' and next_state (?:in \(([^)]*)\)|= '([a-z_]+)')\)/g)) {
      const to = m[2] ? [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [m[3]];
      sqlT[m[1]] = new Set([...(sqlT[m[1]] ?? []), ...to]);
    }
    for (const [from, tos] of Object.entries(TRANSITIONS)) {
      const want = new Set<string>([...tos, ...(from === "awaiting_payment" ? ["delivering"] : [])]);
      const got = sqlT[from] ?? new Set<string>();
      assert.deepEqual([...got].sort(), [...want].sort(), `SQL transitions for ${from} match TS`);
    }
    // the hardcoded SQL cap equals the shared limit
    const capM = /others \+ cur_rigs > (\d+)/.exec(lower); assert.ok(capM && Number(capM[1]) === MAX_RIGS, "SQL cap matches limits.ts MAX_RIGS");
    const rigM = /rig_count between 1 and (\d+)/.exec(lower); assert.ok(rigM && Number(rigM[1]) === MAX_RIGS);
    const dayM = /days between 1 and (\d+)/.exec(lower); assert.ok(dayM && Number(dayM[1]) === MAX_DAYS);
    assert.ok(existsSync("supabase/migrations"));
    // MVP migration: terms recorded, bays (not rig ids), cancel refunds, delivered TH, node claim/lease.
    assert.ok(/tx_hash ~ '\^0x\[0-9a-f\]\{64\}\$'/.test(lower) && /tx_hash text unique/.test(lower), "tx_hash lowercase + unique");
    for (const needle of ["terms_version", "bays", "'cancelled'", "delivered_th", "rental_claim_jobs", "skip locked", "grant execute on function public.rental_claim_jobs(int, int) to gm_node"]) assert.ok(lower.includes(needle), "mvp migration missing: " + needle);
    assert.ok(!/rig_id/.test(lower), "no rig id column anywhere");
  }

  // amounts that look like rig ids (37xxxx/38xxxx sats) are not blocked; string ids still are
  {
    const { blockedHit } = await import("../src/lib/rentals");
    assert.equal(blockedHit(JSON.stringify({ amountSats: 378000, payment: { amountAtomic: 942067 } })), undefined);
    assert.ok(blockedHit(JSON.stringify({ rig: "942067" })) && blockedHit("rig 942067 is up"));
    assert.ok(blockedHit('{"id":907300}'), "bare number under a non-amount key is blocked");
    assert.ok(blockedHit('{"x":"a\\":907300}"}'), "id smuggled inside a string that mimics a JSON number is blocked");
    assert.ok(blockedHit(JSON.stringify({ items: [{ id: 371234 }], totalSats: 378000 })), "non-amount number in an array is blocked");
    assert.equal(blockedHit(JSON.stringify({ totalSats: 378000, totalUsdcAtomic: 942067, amount_atomic: 372000, rows: [{ expectedAtomic: 380001 }] })), undefined, "allowlisted amounts pass");
  }

  // Launch default: USDC via x402 only. Lightning is unreachable while RENTALS_LIGHTNING_ENABLED is off.
  {
    const { lightningEnabled } = await import("../src/lib/rentals/phase2/flag");
    assert.equal(lightningEnabled({}), false, "lightning flag defaults off");
    assert.equal(lightningEnabled({ RENTALS_LIGHTNING_ENABLED: "true" }), false, "only '1' enables lightning");
    const m = mk({ lightningEnabled: false });
    const ln = await createRental(m.d, { ...base, rail: "lightning", idempotency_key: idem() });
    assert.equal((ln as { error: string }).error, "rail_unavailable", "lightning rail returns rail_unavailable (no coming-soon copy)");
    assert.equal(m.store.bindings.size, 0, "no lightning invoice is created while the flag is off");
    const dflt = await createRental(m.d, { ...base, rail: undefined, idempotency_key: idem() });
    assert.ok(dflt.ok, JSON.stringify(dflt));
    const pay = (res(dflt) as unknown as { payment: { rail: string; http402: { network: string } } }).payment;
    assert.equal(pay.rail, "x402_usdc", "default rail is x402 USDC");
    assert.equal(pay.http402.network, "eip155:84532", "default network is Base Sepolia");
    assert.equal((await createRental(m.d, { ...base, rail: "bogus", idempotency_key: idem() }) as { error: string }).error, "invalid_input");
    // A lightning order made while the flag was on cannot be extended or settled once it is off.
    const on = mk();
    const pr = await paidRental(on);
    const pending = await createRental(on.d, { ...base, idempotency_key: idem() });
    const pref = res(pending).payment.paymentRef;
    on.ln.simulatePay(pref, on.store.bindings.get(pref)!.expectedAtomic, on.d.now());
    on.d.lightningEnabled = false;
    assert.equal((await extendRental(on.d, { access_code: pr.code, days: 1, idempotency_key: idem() }) as { error: string }).error, "rail_unavailable");
    assert.equal((await confirmPayment(on.d, pref)).outcome, "rail_unavailable", "lightning settle unreachable with flag off");
    // Staging wiring: no lightning provider unless the flag is on; payTo is the owner's Base address on Sepolia.
    const { stagingDeps } = await import("../src/lib/rentals/phase2/staging");
    const sd = stagingDeps({ RENTALS_JOB_SIGNING_KEY_PEM: PRIV, RENTALS_CODE_HMAC_KEY: "k".repeat(32), RENTALS_PAYTO_PIN_EVM: PINNED_PAYTO }, TEST_PAYTO_PINS)!;
    assert.equal(sd.providers.lightning, undefined, "staging has no lightning provider by default");
    assert.equal(sd.lightningEnabled, false);
    assert.equal((sd.providers.x402_usdc as unknown as { payTo: string }).payTo, PINNED_PAYTO, "staging payTo = the env address that passed the pin");
  }

  // MVP: get_quote / create_rental (terms) / get_rental_status / cancel_rental, pilot 7 days, bay allowlist.
  {
    const svc = await import("../src/lib/rentals/phase2/service");
    const flag = await import("../src/lib/rentals/phase2/flag");
    const { PHASE2_TOOL_NAMES } = await import("../src/lib/rentals/phase2/mcp");
    assert.deepEqual([...PHASE2_TOOL_NAMES], ["get_quote", "create_rental", "get_rental_status", "cancel_rental"]);
    assert.equal(flag.pilotEnabled({}), true, "pilot defaults on");
    assert.equal(flag.mainnetEnabled({ RENTALS_MAINNET_ENABLED: "1" }), false, "flag alone does not enable mainnet");
    assert.equal(flag.mainnetEnabled({ RENTALS_MAINNET_ENABLED: "1", RENTALS_X402_NETWORK: "mainnet", RENTALS_MAINNET_ACK: "yes", CDP_API_KEY_ID: "k", CDP_API_KEY_SECRET: "s" }), false, "wrong ack");
    assert.equal(flag.mainnetEnabled({ RENTALS_MAINNET_ENABLED: "1", RENTALS_X402_NETWORK: "mainnet", RENTALS_MAINNET_ACK: flag.MAINNET_ACK }), false, "no CDP keys");
    const MN = { RENTALS_PHASE2_ENABLED: "1", RENTALS_PHASE2_MODE: "mainnet", RENTALS_MAINNET_ENABLED: "1", RENTALS_X402_NETWORK: "mainnet", RENTALS_MAINNET_ACK: flag.MAINNET_ACK, CDP_API_KEY_ID: "k", CDP_API_KEY_SECRET: "s" };
    assert.equal(flag.MAINNET_ACK, "i-authorize-mainnet-1-dollar-test");
    assert.equal(flag.mainnetEnabled({ ...MN, RENTALS_PHASE2_MODE: "staging" }), false, "staging mode never reaches mainnet");
    assert.equal(flag.mainnetEnabled(MN), true, "deliberate path");
    assert.equal(flag.phase2Enabled(MN), true, "mainnet mode behind every gate");
    assert.equal(flag.jobEnv(MN), "mainnet");
    assert.equal(flag.phase2Enabled({ ...MN, CDP_API_KEY_SECRET: undefined }), false, "mainnet mode without a gate stays off");
    assert.equal(flag.jobEnv({ ...MN, RENTALS_MAINNET_ACK: "x" }), "staging");
    assert.equal(flag.mainnetEnabled({}), false, "off by default");
    assert.deepEqual(flag.rigAllowlist({ PILOT_RIG_ALLOWLIST: " 7,3,x,3,0,1234,12 " }), [3, 7, 12]);
    const x = { ...base, rail: undefined };
    const m = mk({ lightningEnabled: false, pilot: true, bays: [3, 7, 12] });
    // quote
    const q = await svc.getQuote(m.d, { rigs: 2, days: 7 });
    assert.ok(q.ok, JSON.stringify(q));
    const qr = (q as { result: { pricePerPhDayBtc: number; payment: { network: string } } }).result;
    assert.ok(qr.pricePerPhDayBtc >= PRICING.floorBtcPhDay, "quote at or above floor");
    assert.equal(qr.payment.network, "eip155:84532"); assert.equal("lightning" in qr.payment, false, "B5b: no lightning coming-soon field");
    assert.equal((await svc.getQuote(m.d, { rigs: 4, days: 1 }) as { error: string }).error, "invalid_input", "rigs above allowlist size");
    assert.equal((await svc.getQuote(m.d, { rigs: 1, days: 8 }) as { error: string }).error, "invalid_input", "pilot 7 day cap on quote");
    assert.equal((await svc.getQuote(mk({ bays: [] }).d, { rigs: 1, days: 1 }) as { error: string }).error, "no_capacity", "empty allowlist fails closed");
    // terms
    assert.equal((await createRental(m.d, { ...x, accept_terms: false, idempotency_key: idem() }) as { error: string }).error, "terms_not_accepted");
    assert.equal((await createRental(m.d, { ...x, accept_terms: "true", idempotency_key: idem() }) as { error: string }).error, "terms_not_accepted", "accept_terms must be boolean true");
    assert.equal((await createRental(m.d, { ...x, terms_version: "old", idempotency_key: idem() }) as { error: string }).error, "terms_version_mismatch");
    {
      const before = m.store.bindings.size, ordersBefore = m.store.orders.size;
      for (const days of [8, 30]) {
        const qd = await svc.getQuote(m.d, { rigs: 1, days });
        assert.equal((qd as { error: string }).error, "invalid_input", `get_quote rejects ${days} days in the pilot`);
        assert.match((qd as { message: string }).message, /1 to 7 days during the pilot/);
        const cd = await createRental(m.d, { ...x, days, idempotency_key: idem() });
        assert.equal((cd as { error: string }).error, "cap_exceeded", `create_rental rejects ${days} days in the pilot`);
      }
      assert.equal(m.store.bindings.size, before, "no payment request issued for days > 7");
      assert.equal(m.store.orders.size, ordersBefore, "no order created for days > 7");
    }
    // create (rigs) -> pay x402 -> status shows bays-only job, delivered TH
    const c = await createRental(m.d, { ...x, th: undefined, rigs: 2, days: 2, idempotency_key: idem() });
    assert.ok(c.ok, JSON.stringify(c));
    const cr = (c as unknown as { result: { rentalId: string; creatorSecret: string; termsVersion: string; payment: { rail: string; paymentRef: string; http402: { payTo: string; network: string } } } }).result;
    assert.equal(cr.termsVersion, RENTAL_TERMS_VERSION, "terms version recorded");
    assert.equal(cr.payment.rail, "x402_usdc");
    const own = { rental_id: cr.rentalId, creator_secret: cr.creatorSecret };
    assert.equal((await svc.getRentalStatus(m.d, { ...own, creator_secret: "wrong" }) as { error: string }).error, "not_found", "status needs creator_secret");
    m.x.simulatePay(cr.payment.paymentRef, m.store.bindings.get(cr.payment.paymentRef)!.expectedAtomic, m.d.now());
    assert.equal((await confirmPayment(m.d, cr.payment.paymentRef)).outcome, "settled");
    const job = m.store.jobs.find((j) => j.payload.order_ref === cr.rentalId)!;
    assert.equal(job.payload.bays, "3,7", "job carries bay numbers from the allowlist only");
    assert.ok(!/rig_?id|\b3[78]\d{4}\b/i.test(JSON.stringify(job.payload)), "no rig ids in jobs");
    let st = (await svc.getRentalStatus(m.d, own) as { result: { status: string; deliveredTh: number | null; startsAt: string; endsAt: string } }).result;
    assert.equal(st.status, "delivering"); assert.equal(st.deliveredTh, null); assert.ok(st.startsAt && st.endsAt);
    await m.store.recordResult({ jobId: job.payload.job_id, orderRef: cr.rentalId, result: "delivered", reason: null, deliveredTh: 531, at: m.d.now() });
    st = (await svc.getRentalStatus(m.d, own) as typeof st extends never ? never : { result: typeof st }).result;
    assert.equal(st.deliveredTh, 531, "delivered TH from job_results");
    // second order: only 1 free bay left -> 2 rigs refused at create (fleetCapacity = the allowlist), before any payment is requested
    const bindsBefore = m.store.bindings.size;
    const c2 = await createRental(m.d, { ...x, th: undefined, rigs: 2, days: 1, idempotency_key: idem() });
    assert.equal((c2 as { error: string }).error, "cap_exceeded", "bays exhausted refuses the order instead of double-booking");
    assert.equal(m.store.bindings.size, bindsBefore, "no payment request for an order we cannot fill");
    // cancel active half way: pro-rata refund + revert job
    await svc.markDelivered(m.d, cr.rentalId);
    m.tick(86_400_000);
    const paid = m.store.bindings.get(cr.payment.paymentRef)!.expectedAtomic;
    const cx = await svc.cancelRental(m.d, own);
    assert.ok(cx.ok, JSON.stringify(cx));
    const ref = m.store.refunds.find((r) => r.reason === "cancelled")!;
    assert.equal(ref.atomic, Math.floor(paid / 2), "pro-rata refund of unused paid time");
    assert.equal(ref.status, "pending_owner");
    assert.ok(m.store.jobs.some((j) => j.payload.order_ref === cr.rentalId && j.payload.action === "revert" && j.payload.bays === "3,7"), "revert job issued");
    assert.equal((await svc.cancelRental(m.d, own) as { error: string }).error, "not_cancellable");
    // cancel unpaid: nothing owed
    const c3 = await createRental(m.d, { ...x, idempotency_key: idem() });
    const r3 = (c3 as unknown as { result: { rentalId: string; creatorSecret: string } }).result;
    const cu = await svc.cancelRental(m.d, { rental_id: r3.rentalId, creator_secret: r3.creatorSecret });
    assert.ok(cu.ok && (cu.result as { refundUsdc: string | null }).refundUsdc === null);
    assert.equal((await m.store.getOrderByPublicId(r3.rentalId))!.state, "expired");
    // cancel paid-not-started: full refund
    const m2 = mk({ lightningEnabled: false, pilot: true, bays: [1] });
    const c4 = (await createRental(m2.d, { ...x, idempotency_key: idem() }) as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
    const amt4 = m2.store.bindings.get(c4.payment.paymentRef)!.expectedAtomic;
    m2.x.simulatePay(c4.payment.paymentRef, amt4, m2.d.now());
    await confirmPayment(m2.d, c4.payment.paymentRef);
    await svc.cancelRental(m2.d, { rental_id: c4.rentalId, creator_secret: c4.creatorSecret });
    assert.equal(m2.store.refunds.find((r) => r.reason === "cancelled")!.atomic, amt4, "cancel before any time used refunds in full");
  }

  // Real x402 adapter (facilitator + RPC mocked at fetch): verify -> settle -> on-chain check -> confirmPayment settles.
  {
    const { X402Provider, BASE_SEPOLIA, BASE_MAINNET, x402Net, cdpJwt } = await import("../src/lib/rentals/phase2/x402");
    assert.throws(() => x402Net({ RENTALS_X402_NETWORK: "mainnet", RENTALS_MAINNET_ENABLED: "1" }), /mainnet_disabled/, "mainnet refused without the deliberate path");
    const mn = x402Net({ RENTALS_PHASE2_MODE: "mainnet", RENTALS_X402_NETWORK: "mainnet", RENTALS_MAINNET_ENABLED: "1", RENTALS_MAINNET_ACK: "i-authorize-mainnet-1-dollar-test", CDP_API_KEY_ID: "k", CDP_API_KEY_SECRET: "s" });
    assert.deepEqual([mn.network, mn.chainIdHex, mn.auth], ["eip155:8453", "0x2105", "cdp"]);
    {
      // Base USDC: EIP-55 checksum computed here + the recorded independent on-chain verification (not a copy of the constant).
      const { toChecksum } = await import("../src/lib/rentals/phase2/x402");
      const rec = JSON.parse(readFileSync(join(__dirname, "../src/lib/rentals/phase2/onchain/base-mainnet-usdc.json"), "utf8"));
      assert.equal(toChecksum(mn.asset), mn.asset, "mainnet USDC is EIP-55 checksummed");
      assert.equal(toChecksum(BASE_SEPOLIA.asset), BASE_SEPOLIA.asset, "Sepolia USDC is EIP-55 checksummed");
      assert.equal(toChecksum("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "EIP-55 reference vector");
      assert.equal(toChecksum("0x833589fcd6edb6e08f4c7c32d4b71b54bda02913") === "0x833589fCD6eDb6E08f4c7C32D4b71b54bdA02913", false, "the …D4b71… variant fails EIP-55 as written");
      assert.deepEqual([rec.address, rec.chainId, rec.symbol, rec.decimals], [mn.asset, "0x2105", "USDC", 6], "matches recorded on-chain verification");
      assert.ok(rec.codeBytes > 0 && /^0x[0-9a-f]{64}$/.test(rec.codeKeccak), "eth_getCode was non-empty");
    }
    assert.throws(() => new X402Provider({ net: BASE_MAINNET, payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://x", store: new MemoryStore() }), /cdp_credentials_missing/);
    assert.throws(() => new X402Provider({ net: BASE_SEPOLIA, payTo: "0x" + "22".repeat(20), resourceBase: "https://x", store: new MemoryStore() }), /bad_payto/, "payTo pinned");
    {
      const { stagingDeps } = await import("../src/lib/rentals/phase2/staging");
      const kp = crypto.generateKeyPairSync("ed25519");
      const env = { RENTALS_JOB_SIGNING_KEY_PEM: kp.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), RENTALS_CODE_HMAC_KEY: "h".repeat(32) };
      const pe = { ...env, RENTALS_PAYTO_PIN_EVM: PINNED_PAYTO };
      assert.equal(stagingDeps({ ...pe, RENTALS_X402_PAYTO_TEST: "0x" + "22".repeat(20) }, TEST_PAYTO_PINS), null, "differing payTo override refuses to start");
      assert.equal(stagingDeps({ ...pe, RENTALS_X402_PAYTO_TEST: PINNED_PAYTO.toLowerCase() }, TEST_PAYTO_PINS), null, "override compared exactly (no lowercase match)");
      assert.equal(stagingDeps(env, TEST_PAYTO_PINS), null, "no payTo env: no staging deps (fail closed)");
      assert.equal(stagingDeps({ ...env, RENTALS_PAYTO_PIN_EVM: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" }, TEST_PAYTO_PINS), null, "a valid address that doesn't hash to the pin: no staging deps");
      assert.equal(stagingDeps(pe), null, "the synthetic address under the production pin: no staging deps");
    }
    // CDP JWT: EdDSA, bound to method + host + path, 2 min, verifiable with the key's public half.
    {
      const kp = crypto.generateKeyPairSync("ed25519");
      const seed = (kp.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer).subarray(16), pub = (kp.publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(12);
      const jwt = cdpJwt("kid-1", Buffer.concat([seed, pub]).toString("base64"), "POST", "https://api.cdp.coinbase.com/platform/v2/x402/settle", 1000);
      const [h, c, sg] = jwt.split(".");
      const hd = JSON.parse(Buffer.from(h, "base64url").toString()), cl = JSON.parse(Buffer.from(c, "base64url").toString());
      assert.deepEqual([hd.alg, hd.kid, cl.sub, cl.iss, cl.exp - cl.nbf, cl.uris[0]], ["EdDSA", "kid-1", "kid-1", "cdp", 120, "POST api.cdp.coinbase.com/platform/v2/x402/settle"]);
      assert.ok(crypto.verify(null, Buffer.from(`${h}.${c}`), kp.publicKey, Buffer.from(sg, "base64url")));
      const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
      const j2 = cdpJwt("kid-2", ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "POST", "https://api.cdp.coinbase.com/platform/v2/x402/verify", 1000).split(".");
      assert.equal(JSON.parse(Buffer.from(j2[0], "base64url").toString()).alg, "ES256");
      assert.ok(crypto.verify("sha256", Buffer.from(`${j2[0]}.${j2[1]}`), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(j2[2], "base64url")));
    }
    {
      const { cronAuthorized } = await import("../src/app/api/rentals/sweep/route");
      assert.equal(cronAuthorized("Bearer s3cret", "s3cret"), true);
      assert.equal(cronAuthorized("Bearer s3cre", "s3cret"), false);
      assert.equal(cronAuthorized(null, "s3cret"), false);
      assert.equal(cronAuthorized("Bearer ", undefined), false);
      const { sweepGate } = await import("../src/app/api/rentals/sweep/route");
      const { Limiter: L2 } = await import("../src/lib/rentals/phase2/safety");
      const lim = new L2(6, 60_000);
      for (let i = 0; i < 6; i++) assert.equal(sweepGate("Bearer nope", "s3cret", 1000, lim), 401);
      assert.equal(sweepGate(null, "s3cret", 1000, lim), 429, "unauthenticated flood is limited");
      assert.equal(sweepGate("Bearer s3cret", "s3cret", 1000, lim), 200, "cron still runs during a flood (auth before limiter)");
      const lim3 = new L2(6, 60_000);
      for (let i = 0; i < 20; i++) assert.equal(sweepGate("Bearer s3cret", "s3cret", 1000, lim3), 200);
      assert.equal(sweepGate("Bearer nope", "s3cret", 1000, lim3), 401, "valid calls never consume the failure quota");
    }
    assert.equal(x402Net({}).network, "eip155:84532");
    const payTo = "0xBb99fB2b8a2A2Cf71C4392B1EB6720c43F409f40", from = "0x" + "11".repeat(20), tx = "0x" + "ab".repeat(32), txUpper = "0x" + "AB".repeat(32);
    const calls: string[] = [];
    let settleOk = true, transferValue = -1, settleStatus = 200;
    let settleTx = txUpper, onVerify: (() => Promise<void>) | null = null, onSettle: (() => Promise<void>) | null = null;
    const P = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
    const T_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", AU_TOPIC = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
    const authNonce = "0x" + "ef".repeat(32);
    type L = { address: string; topics: string[]; data: string; removed?: boolean };
    const transferLog = (v: number, src = from, dst = payTo): L => ({ address: BASE_SEPOLIA.asset, topics: [T_TOPIC, P(src), P(dst)], data: "0x" + v.toString(16) });
    const authLog = (who = from, n = authNonce): L => ({ address: BASE_SEPOLIA.asset, topics: [AU_TOPIC, P(who), n], data: "0x" });
    let receiptLogs: (() => L[]) | null = null, chainId = "0x14a34", head = "0x10", rcBlock = "0x0e", rcStatus = "0x1";
    const fakeFetch = (async (url: string, init: { body: string }) => {
      calls.push(String(url).split("/").pop()!);
      const body = JSON.parse(init.body);
      if (String(url).endsWith("/verify")) { if (onVerify) await onVerify(); return new Response(JSON.stringify({ isValid: true, payer: from })); }
      if (String(url).endsWith("/settle")) { if (onSettle) await onSettle(); } // falls through to the settle response
      if (String(url).endsWith("/settle")) return new Response(JSON.stringify(settleOk ? { success: true, transaction: settleTx, network: "eip155:84532", payer: from } : { success: false, errorReason: "insufficient_funds <script>" }), { status: settleOk ? 200 : settleStatus });
      if (body.method === "eth_chainId") return new Response(JSON.stringify({ result: chainId }));
      if (body.method === "eth_blockNumber") return new Response(JSON.stringify({ result: head }));
      const logs = receiptLogs ? receiptLogs() : [transferLog(transferValue), authLog()];
      return new Response(JSON.stringify({ result: { status: rcStatus, blockNumber: rcBlock, logs } }));
    }) as unknown as typeof fetch;
    const m = mk({ lightningEnabled: false, pilot: true });
    const xp = new X402Provider({ net: BASE_SEPOLIA, payTo, payToPins: TEST_PAYTO_PINS, resourceBase: "https://preview.example", store: m.store, fetchImpl: fakeFetch, now: () => m.d.now(), rpcDeadlineMs: 0, sleep: async () => {} });
    m.d.providers = { x402_usdc: xp };
    const c = await createRental(m.d, { ...base, rail: undefined, idempotency_key: idem() });
    assert.ok(c.ok, JSON.stringify(c));
    const cr = (c as unknown as { result: { rentalId: string; payment: { paymentRef: string; http402: { amount: string; resource: string; extra: { name: string; version: string } } } } }).result;
    const ref = cr.payment.paymentRef, req = cr.payment.http402;
    assert.ok(/^x402_[0-9a-f]{32}$/.test(ref) && req.resource === `https://preview.example/api/rentals/pay/${ref}`);
    assert.deepEqual([req.extra.name, req.extra.version], ["USDC", "2"], "EIP-712 domain hints for USDC");
    const pr = await xp.paymentRequired(ref);
    assert.equal(pr!.accepts[0].amount, req.amount);
    const nowS = Math.floor(m.d.now() / 1000);
    const pay = (over: Partial<{ value: string; to: string }> = {}) => ({ x402Version: 2 as const, accepted: pr!.accepts[0] as Record<string, unknown>,
      payload: { signature: "0x" + "cd".repeat(65), authorization: { from, to: payTo, value: req.amount, validAfter: String(nowS - 10), validBefore: String(nowS + 600), nonce: authNonce, ...over } } });
    assert.equal(((await xp.pay(ref, pay({ value: "1" }))) as { error: string }).error, "wrong_amount", "underpay refused before the facilitator");
    assert.equal(((await xp.pay(ref, pay({ to: from }))) as { error: string }).error, "wrong_payto");
    // Review #87 S2: accepted.extra.orderRef must equal this ref's stored orderRef, exactly.
    {
      const acc0 = pr!.accepts[0] as Record<string, unknown> & { extra: Record<string, unknown> };
      assert.equal(acc0.extra.orderRef, cr.rentalId, "challenge carries the order's public id");
      const withAcc = (accepted: Record<string, unknown>) => ({ ...pay(), accepted });
      const { extra: _x, ...noExtra } = acc0; void _x;
      for (const [why, a] of [
        ["other order", { ...acc0, extra: { ...acc0.extra, orderRef: "gm_someoneElse1" } }],
        ["case changed", { ...acc0, extra: { ...acc0.extra, orderRef: String(acc0.extra.orderRef).toUpperCase() } }],
        ["missing orderRef", { ...acc0, extra: { name: acc0.extra.name, version: acc0.extra.version } }],
        ["missing extra", noExtra],
        ["non-string orderRef", { ...acc0, extra: { ...acc0.extra, orderRef: 1 } }],
      ] as const) assert.equal(((await xp.pay(ref, withAcc(a as Record<string, unknown>))) as { error: string }).error, "requirements_mismatch", "orderRef bound: " + why);
    }
    assert.equal(calls.length, 0, "no facilitator call for a mismatched payload");
    settleOk = false;
    assert.equal(((await xp.pay(ref, pay())) as { error: string }).error, "settle_failed", "fixed code, facilitator text never echoed");
    settleStatus = 503;
    assert.equal(((await xp.pay(ref, pay())) as { error: string }).error, "facilitator_unavailable");
    settleStatus = 200;
    assert.equal((await confirmPayment(m.d, ref)).outcome, "unpaid", "failed settle is not money");
    settleOk = true; transferValue = Number(req.amount) - 1;
    assert.equal(((await xp.pay(ref, pay())) as { error: string }).error, "onchain_check_failed", "receipt must show the full Transfer to payTo");
    transferValue = Number(req.amount);
    // One-time $1 test order: fixed 1.000000 USDC, pinned payTo, single use, no job.
    {
      const to = await import("../src/lib/rentals/phase2/test-order");
      assert.equal(to.tokenOk("x".repeat(40), "x".repeat(40)), true);
      assert.equal(to.tokenOk("x".repeat(39), "x".repeat(40)), false);
      assert.equal(to.tokenOk("short", "short"), false, "token must be >= 32 chars");
      assert.equal(to.tokenOk(null, undefined), false);
      const book = new to.MemoryTestOrderBook(() => m.d.now(), TEST_PAYTO_PINS.evm);
      const jobsBefore = m.store.jobs.length;
      const svcT = new to.TestOrderService({ book, provider: xp, net: BASE_SEPOLIA, resourceBase: "https://preview.example", now: () => m.d.now() });
      const ch = await svcT.challenge();
      assert.ok(ch.status === "open");
      const rq = (ch as { requirements: { amount: string; payTo: string; resource: string } }).requirements;
      assert.deepEqual([rq.amount, rq.payTo, rq.resource], ["1000000", PINNED_PAYTO, "https://preview.example/api/rentals/test-order"], "exactly 1.000000 USDC to the pinned payTo");
      assert.equal(((await svcT.challenge()) as { providerRef: string }).providerRef, (ch as { providerRef: string }).providerRef, "same open challenge");
      const tpay = (over: Partial<{ value: string; to: string }> = {}) => ({ x402Version: 2 as const, accepted: { scheme: "exact", network: BASE_SEPOLIA.network, amount: "1000000", asset: BASE_SEPOLIA.asset, payTo, extra: { orderRef: "gm_test_1usd", name: "USDC", version: "2" } } as Record<string, unknown>,
        payload: { signature: "0x" + "cd".repeat(65), authorization: { from, to: payTo, value: "1000000", validAfter: String(nowS - 10), validBefore: String(nowS + 600), nonce: authNonce, ...over } } });
      assert.equal(((await svcT.pay(tpay({ value: "2000000" }))) as { error: string }).error, "wrong_amount", "amount is fixed");
      transferValue = 1_000_000;
      const ok1 = await svcT.pay(tpay());
      assert.ok(ok1.ok && ok1.txHash === tx, JSON.stringify(ok1));
      assert.equal(((await svcT.pay(tpay())) as { error: string }).error, "used", "single use");
      assert.equal((await svcT.challenge()).status, "used");
      assert.equal(m.store.jobs.length, jobsBefore, "no job emitted, no rig delivery");
      // Kill switch ON (rentals_enabled=false / RENTALS_KILL=1): public create_rental refused, the $1 test order still settles.
      {
        const mk2 = mk({ lightningEnabled: false, pilot: true, killSwitch: async () => true });
        const cr2 = await createRental(mk2.d, { ...base, rail: undefined, idempotency_key: idem() });
        assert.equal((cr2 as { error: string }).error, "rentals_paused", "create_rental refused while killed");
        assert.equal(mk2.store.bindings.size, 0, "no payment request while killed");
        const svcK = new to.TestOrderService({ book: new to.MemoryTestOrderBook(() => m.d.now(), TEST_PAYTO_PINS.evm), provider: xp, net: BASE_SEPOLIA, resourceBase: "https://preview.example", now: () => m.d.now() });
        const okK = await svcK.pay(tpay());
        assert.ok(okK.ok, "test order settles with the kill switch on: " + JSON.stringify(okK));
        const routeSrc = readFileSync(join(__dirname, "../src/app/api/rentals/test-order/route.ts"), "utf8");
        assert.ok(!/killSwitch|stagingDeps|rentals_enabled/.test(routeSrc), "test-order route does not consult the rental kill switch");
      }
      await assert.rejects(book.issue({ providerRef: "x", network: "n", amountAtomic: 2, payTo, requirements: rq as never, expiresAt: 0, txHash: null, payer: null }), /check_violation/);
      // Hidden: not an MCP tool, not in llms.txt, no site link.
      const { PHASE2_TOOL_NAMES } = await import("../src/lib/rentals/phase2/mcp");
      assert.ok(!(PHASE2_TOOL_NAMES as readonly string[]).some((n) => /test/.test(n)));
      assert.ok(!/test-order|test_order/.test(readFileSync(join(__dirname, "../public/llms.txt"), "utf8")), "not in llms.txt");
      const mig = readFileSync(join(__dirname, "../supabase/migrations/20261016200000_phase2_test_order.sql"), "utf8");
      assert.ok(/check \(id = 1\)/.test(mig) && /amount_atomic = 1000000/.test(mig) && /tx_hash text unique/.test(mig), "DB enforces single row, $1, unique tx");
      transferValue = Number(req.amount);
    }
    // checkTransfer is tied to THIS authorization: unrelated txs that pay payTo are rejected.
    {
      const amt = Number(req.amount), other = "0x" + "33".repeat(20), auth = { from, value: req.amount, nonce: authNonce };
      const ck = async (logs: L[]) => { receiptLogs = () => logs; const v = await xp.checkTransfer(tx, payTo, auth); receiptLogs = null; return v; };
      assert.equal(await ck([transferLog(amt), authLog()]), amt, "matching tx accepted");
      assert.equal(await ck([transferLog(amt, other), authLog(other)]), 0, "unrelated tx from another payer paying payTo: rejected");
      assert.equal(await ck([transferLog(amt)]), 0, "Transfer without AuthorizationUsed (plain transfer): rejected");
      assert.equal(await ck([transferLog(amt), authLog(from, "0x" + "aa".repeat(32))]), 0, "different authorization nonce: rejected");
      assert.equal(await ck([transferLog(amt), authLog(other, authNonce)]), 0, "AuthorizationUsed by someone else: rejected");
      assert.equal(await ck([{ ...transferLog(amt), removed: true }, authLog()]), 0, "removed log skipped");
      assert.equal(await ck([transferLog(amt, from, other), authLog()]), 0, "Transfer to another address: rejected");
      assert.equal(await ck([{ ...transferLog(amt), address: "0x" + "44".repeat(20) }, authLog()]), 0, "non-USDC token: rejected");
      assert.equal(await ck([transferLog(amt), transferLog(1), authLog()]), 0, "sum must equal authorization.value exactly");
      assert.equal(await ck([transferLog(amt - 10), transferLog(10), authLog()]), amt, "BigInt sum of split logs");
      chainId = "0x2105"; assert.equal(await ck([transferLog(amt), authLog()]), 0, "wrong chain"); chainId = "0x14a34";
      head = "0x0f"; assert.equal(await ck([transferLog(amt), authLog()]), 0, "2 confirmations: not enough"); head = "0x10";
      rcStatus = "0x0"; assert.equal(await ck([transferLog(amt), authLog()]), 0, "reverted tx"); rcStatus = "0x1";
      assert.equal(await xp.checkTransfer(tx, payTo, { ...auth, value: String(amt + 1) }), 0, "value must match the signed authorization");
    }
    const ok = await xp.pay(ref, pay());
    assert.ok(ok.ok && !ok.replay && ok.txHash === tx, JSON.stringify(ok));
    assert.ok((await xp.pay(ref, pay())).ok && ((await xp.pay(ref, pay())) as { replay: boolean }).replay, "second pay is a replay, no second settle");
    assert.equal(calls.filter((x) => x === "settle").length, 6, "settle called once per real attempt only (incl. the two test-order settles)");
    assert.equal((await confirmPayment(m.d, ref)).outcome, "settled");
    assert.equal((await m.store.getOrderByPublicId(cr.rentalId))!.state, "delivering");
    assert.ok(m.store.jobs.some((j) => j.payload.order_ref === cr.rentalId && j.payload.payment?.provider_ref === ref));
    // rev 1.4 settlement fields: from the binding + facilitator settle + quote record, signed, checked by BOTH verifiers.
    {
      const job = m.store.jobs.find((j) => j.payload.order_ref === cr.rentalId && j.payload.action === "route")!;
      const ord = (await m.store.getOrderByPublicId(cr.rentalId))!;
      assert.equal(job.payload.pay_to, payTo, "pay_to = settled payTo");
      assert.equal(job.payload.amount_usdc, (Number(req.amount) / 1e6).toFixed(6), "amount_usdc = settled amount, decimal string");
      assert.equal(job.payload.floor_btc_per_ph_day, ord.floorBtcPhDay.toFixed(8), "floor from the order's quote record");
      assert.ok(!/rig_?id|\b3[78]\d{4}\b/i.test(JSON.stringify(job.payload)), "no rig ids");
      // rev 1.5
      assert.equal(job.payload.payment!.tx_hash, tx, "payment.tx_hash = facilitator settle tx, lowercased");
      assert.equal(job.payload.payment!.amount_atomic, req.amount, "payment.amount_atomic is an integer string");
      assert.equal((await m.store.getSettlement(ref))!.txHash, tx, "stored lowercase");
      const { verifyGmJob, schemaOk: snipSchema } = await import("./rentals/verify-job-snippet.mjs");
      const { schemaOk } = await import("../src/lib/rentals/phase2/jobs");
      const nowS2 = Math.floor(m.d.now() / 1000) + 1;
      assert.deepEqual(verifyJob(job, vo({ t1: PUB }, nowS2)), { ok: true }, "jobs.ts verifies rev 1.4 job");
      const snipLed = { has: () => false, add: () => {} };
      const sv = verifyGmJob(job, { keys: { t1: PUB }, expectEnv: "staging", nowSec: nowS2, ledger: snipLed, caps: CAPS });
      assert.equal(sv.ok, true, "snippet verifies rev 1.4 job: " + JSON.stringify(sv));
      const tam = { ...job, payload: { ...job.payload, pay_to: "0x" + "22".repeat(20) } };
      assert.equal(verifyJob(tam, vo({ t1: PUB }, nowS2)).ok, false, "pay_to is signed");
      assert.equal((verifyGmJob(tam, { keys: { t1: PUB }, expectEnv: "staging", nowSec: nowS2, ledger: snipLed, caps: CAPS }) as { reason: string }).reason, "bad_signature");
      for (const [pv, why] of [[{ tx_hash: txUpper }, "schema_tx_hash"], [{ tx_hash: "0x12" }, "schema_tx_hash"], [{ tx_hash: null }, "schema_settlement"], [{ amount_atomic: Number(req.amount) }, "schema_payment"]] as const) {
        const bad = { ...job.payload, payment: { ...job.payload.payment!, ...pv } } as unknown as JobPayload;
        assert.equal(schemaOk(bad, CAPS), why, `jobs.ts payment ${JSON.stringify(pv)}`);
        assert.equal(snipSchema(bad, CAPS), why, `snippet payment ${JSON.stringify(pv)}`);
      }
      { const { tx_hash: _t, ...noTx } = job.payload.payment!; void _t; const bad = { ...job.payload, payment: noTx }; assert.equal(schemaOk(bad, CAPS), "schema_payment"); assert.equal(snipSchema(bad, CAPS), "schema_payment"); }
      for (const [k, v, why] of [["pay_to", "0x123", "schema_pay_to"], ["amount_usdc", 1.5, "schema_amount_usdc"], ["floor_btc_per_ph_day", "5e-4", "schema_floor"], ["amount_usdc", "9.000000", "schema_settlement"], ["pay_to", null, "schema_settlement"]] as const) {
        const bad = { ...job.payload, [k]: v };
        assert.equal(schemaOk(bad, CAPS), why, `jobs.ts ${k}=${String(v)}`);
        assert.equal(snipSchema(bad, CAPS), why, `snippet ${k}=${String(v)}`);
      }
      const { pay_to: _a, ...missing } = job.payload; void _a;
      assert.equal(schemaOk(missing, CAPS), "schema_keys"); assert.equal(snipSchema(missing, CAPS), "schema_keys");
    }
    await assert.rejects(m.store.recordSettlement({ providerRef: "x402_" + "0".repeat(32), network: "eip155:84532", payer: from, txHash: tx, amountAtomic: 1, settledAt: 0 }), /unique/, "one tx pays one ref");
    // expired challenge: refused before any facilitator call
    const c2 = (await createRental(m.d, { ...base, rail: undefined, idempotency_key: idem() }) as unknown as { result: { payment: { paymentRef: string } } }).result;
    m.tick(16 * 60_000); const n0 = calls.length;
    assert.equal(((await xp.pay(c2.payment.paymentRef, pay())) as { error: string }).error, "payment_expired");
    assert.equal(calls.length, n0);

    // Pay guard: a ref only takes money while its order is awaiting payment
    // (initial) or running (extension). Refused BEFORE any facilitator call.
    {
      type CR = { rentalId: string; creatorSecret: string; payment: { paymentRef: string } };
      const fresh = async () => { const x = await createRental(m.d, { ...base, rigs: 1, days: 1, rail: undefined, idempotency_key: idem() }); assert.ok(x.ok, "fresh order: " + JSON.stringify(x)); return (x as unknown as { result: CR }).result; };
      const payNow = async (refX: string) => {
        const prX = (await xp.paymentRequired(refX))!; const n = Math.floor(m.d.now() / 1000);
        return { x402Version: 2 as const, accepted: prX.accepts[0] as Record<string, unknown>,
          payload: { signature: "0x" + "cd".repeat(65), authorization: { from, to: payTo, value: String(prX.accepts[0].amount), validAfter: String(n - 10), validBefore: String(n + 600), nonce: authNonce } } };
      };
      const err = async (refX: string) => ((await xp.pay(refX, await payNow(refX))) as { error?: string }).error;
      const err2 = async (refX: string, p: Awaited<ReturnType<typeof payNow>>) => ((await xp.pay(refX, p)) as { error?: string }).error;
      // 1. pay after cancel: refused, zero facilitator calls, nothing recorded.
      const a = await fresh();
      const ca = await cancelRental(m.d, { rental_id: a.rentalId, creator_secret: a.creatorSecret });
      assert.ok(ca.ok, JSON.stringify(ca));
      let n1 = calls.length;
      assert.equal(await err(a.payment.paymentRef), "order_not_payable", "pay after cancel is refused");
      assert.equal(calls.length, n1, "no facilitator /verify or /settle after cancel");
      assert.equal(await m.store.getSettlement(a.payment.paymentRef), null);
      assert.equal(await xp.orderPayable(a.payment.paymentRef), false);
      // 2. pay after expiry: time-expired = payment_expired (above); swept to "expired" = order_not_payable.
      const e = await fresh();
      m.tick(PAY_TTL_MS + 60_000); await sweepExpired(m.d);
      assert.equal((await m.store.getOrderByPublicId(e.rentalId))!.state, "expired");
      n1 = calls.length;
      assert.equal(await err(e.payment.paymentRef), "order_not_payable", "pay after expiry (swept) is refused");
      assert.equal(calls.length, n1, "no facilitator call after expiry");
      // Other non-payable states, set directly.
      for (const st of ["refunded", "refund_pending", "failed", "completed", "active", "delivering", "paid"] as const) {
        const o = await fresh(); const id = (await m.store.getOrderByPublicId(o.rentalId))!.id;
        m.store.orders.get(id)!.state = st;
        n1 = calls.length;
        assert.equal(await err(o.payment.paymentRef), "order_not_payable", "initial ref refused in state " + st);
        assert.equal(calls.length, n1);
        m.store.orders.get(id)!.state = "expired"; // free the pilot rig for the next case
      }
      // Extension refs need a RUNNING order.
      {
        const o = await fresh(); const id = (await m.store.getOrderByPublicId(o.rentalId))!.id;
        const xr = "x402_" + "e".repeat(32);
        m.store.bindings.set(xr, { ...m.store.bindings.get(o.payment.paymentRef)!, kind: "extension", extendDays: 1 });
        m.store.orders.get(id)!.endsAt = m.d.now() + 86_400_000;
        for (const [st, ok] of [["active", true], ["delivering", true], ["awaiting_payment", false], ["completed", false], ["expired", false]] as const) {
          m.store.orders.get(id)!.state = st;
          assert.equal(await xp.orderPayable(xr), ok, "extension ref payable in " + st + " = " + ok);
        }
        // Review #87 S1: running but past its end (not yet swept) = not payable, refused before the facilitator.
        for (const st of ["active", "delivering"] as const) {
          m.store.orders.get(id)!.state = st;
          for (const [why, end] of [["ended 1 ms ago", m.d.now() - 1], ["ends right now", m.d.now()], ["no end time", null]] as const) {
            m.store.orders.get(id)!.endsAt = end;
            assert.equal(await xp.orderPayable(xr), false, `extension ref in ${st}, ${why} = not payable`);
          }
          m.store.orders.get(id)!.endsAt = m.d.now() + 1;
          assert.equal(await xp.orderPayable(xr), true, `extension ref in ${st}, ends in 1 ms = payable`);
        }
        m.store.orders.get(id)!.state = "active"; m.store.orders.get(id)!.endsAt = m.d.now() - 1;
        {
          const n2 = calls.length;
          assert.equal(await err(xr), "order_not_payable", "extension after the end is refused with order_not_payable");
          assert.equal(calls.length, n2, "no facilitator call for an ended rental's extension");
          assert.equal(await m.store.getSettlement(xr), null);
        }
        m.store.orders.get(id)!.endsAt = null;
        m.store.bindings.delete(xr); m.store.orders.get(id)!.state = "expired";
      }
      // Review #88 S3: the extension's end time passes between /verify and /settle:
      // the beforeSettle re-check refuses with order_not_payable and /settle is never called.
      {
        const o = await fresh(); const id = (await m.store.getOrderByPublicId(o.rentalId))!.id;
        const xr = "x402_" + "f".repeat(32);
        m.store.bindings.set(xr, { ...m.store.bindings.get(o.payment.paymentRef)!, kind: "extension", extendDays: 1 });
        m.store.orders.get(id)!.state = "active"; m.store.orders.get(id)!.endsAt = m.d.now() + 60_000;
        assert.equal(await xp.orderPayable(xr), true, "extension payable before /verify");
        const p3 = await payNow(xr);
        const n4 = calls.length;
        onVerify = async () => { onVerify = null; m.tick(61_000); };
        assert.equal(await err2(xr, p3), "order_not_payable", "end passed between /verify and /settle = order_not_payable");
        assert.deepEqual(calls.slice(n4), ["verify"], "facilitator saw /verify only, no /settle");
        assert.equal(await m.store.getSettlement(xr), null, "nothing recorded");
        m.store.bindings.delete(xr); m.store.orders.get(id)!.state = "expired"; m.store.orders.get(id)!.endsAt = null;
      }
      // Review #88 S1: a store read error is "error", not "not payable": the GET answers 503, the POST stays fail-closed.
      {
        const o = await fresh(); const r0 = o.payment.paymentRef;
        assert.equal(await xp.payableState(r0), "payable");
        assert.equal((await xp.requestStatus(r0)).status, 402, "live order = 402 PaymentRequired");
        const st = m.store as unknown as Record<string, unknown>;
        const origGetOrder = st.getOrder;
        st.getOrder = async () => { throw new Error("store down"); };
        try {
          assert.equal(await xp.payableState(r0), "error", "store throw = error");
          assert.equal(await xp.orderPayable(r0), false, "orderPayable stays fail-closed");
          const rs = await xp.requestStatus(r0);
          assert.equal(rs.status, 503, "GET /pay = 503 on a store error, not 409");
          assert.deepEqual(rs.body, { error: "store_unavailable" });
          const n5 = calls.length;
          assert.equal(await err(r0), "order_not_payable", "POST /pay still refuses before the facilitator");
          assert.equal(calls.length, n5, "no facilitator call on a store error");
        } finally { st.getOrder = origGetOrder; }
        const origSettle = st.getSettlement;
        st.getSettlement = async () => { throw new Error("store down"); };
        try { assert.equal((await xp.requestStatus(r0)).status, 503, "settlement read error = 503"); } finally { st.getSettlement = origSettle; }
        assert.equal((await xp.requestStatus(r0)).status, 402, "store back = 402 again");
        m.store.orders.get((await m.store.getOrderByPublicId(o.rentalId))!.id)!.state = "completed";
        assert.equal((await xp.requestStatus(r0)).status, 409, "closed order = 409 order_not_payable");
        assert.equal((await xp.requestStatus("x402_" + "0".repeat(32))).status, 404, "unknown ref = 404");
        m.store.orders.get((await m.store.getOrderByPublicId(o.rentalId))!.id)!.state = "expired";
      }
      // The GET route uses requestStatus and sends Retry-After on 503.
      {
        const src = readFileSync("src/app/api/rentals/pay/[ref]/route.ts", "utf8");
        assert.match(src, /requestStatus\(ref\)/, "GET /pay goes through requestStatus");
        assert.match(src, /Retry-After/, "503 carries Retry-After");
        assert.doesNotMatch(src, /orderPayable\(ref\)\)\) return j\(409/, "no direct 409 on orderPayable in the GET");
      }
      assert.equal(await xp.orderPayable("x402_" + "0".repeat(32)), false, "unknown ref is not payable");
      // Review #87 S2: a payload built for order A can't settle order B with the same amount.
      {
        const A = await fresh(); const B = await fresh();
        const pa = await payNow(A.payment.paymentRef);
        assert.equal(String(pa.accepted.amount), String((await xp.paymentRequired(B.payment.paymentRef))!.accepts[0].amount), "same amount");
        const n3 = calls.length;
        assert.equal(await err2(B.payment.paymentRef, pa), "requirements_mismatch", "A's payload refused on B's ref");
        assert.equal(calls.length, n3, "no facilitator call");
        assert.equal(await m.store.getSettlement(B.payment.paymentRef), null);
        for (const X of [A, B]) m.store.orders.get((await m.store.getOrderByPublicId(X.rentalId))!.id)!.state = "expired";
      }
      // 3. settled replay still works after the order moved on (delivering): no new facilitator call.
      n1 = calls.length;
      const rp = await xp.pay(ref, pay());
      assert.ok(rp.ok && rp.replay && rp.txHash === tx, "settled ref replays its prior result: " + JSON.stringify(rp));
      assert.equal(calls.length, n1);
      // 4. normal pay still works on a fresh awaiting order (and confirmPayment delivers).
      const g = await fresh();
      settleTx = "0x" + "C1".repeat(32);
      const gp = await xp.pay(g.payment.paymentRef, await payNow(g.payment.paymentRef));
      assert.ok(gp.ok && !gp.replay, "normal pay works: " + JSON.stringify(gp));
      assert.equal((await confirmPayment(m.d, g.payment.paymentRef)).outcome, "settled");
      m.store.orders.get((await m.store.getOrderByPublicId(g.rentalId))!.id)!.state = "completed"; // free its rig
      // 5. Cancel lands after /verify, before /settle: the pre-settle re-check refuses; no settle call.
      const r1 = await fresh();
      onVerify = async () => { onVerify = null; await cancelRental(m.d, { rental_id: r1.rentalId, creator_secret: r1.creatorSecret }); };
      const before = calls.filter((x) => x === "settle").length;
      assert.equal(await err(r1.payment.paymentRef), "order_not_payable", "cancel between verify and settle: refused");
      assert.equal(calls.filter((x) => x === "settle").length, before, "settle never called");
      // 6. Residual window: cancel lands DURING the facilitator settle (money moves).
      //    Pay records the settlement; confirmPayment on the cancelled order queues a
      //    pending_owner refund and signs no job. The version-checked commit means
      //    cancel and settle can't both win.
      const r2 = await fresh(); const id2 = (await m.store.getOrderByPublicId(r2.rentalId))!.id;
      settleTx = "0x" + "C2".repeat(32);
      onSettle = async () => { onSettle = null; await cancelRental(m.d, { rental_id: r2.rentalId, creator_secret: r2.creatorSecret }); };
      const jobs0 = m.store.jobs.length;
      const p2 = await xp.pay(r2.payment.paymentRef, await payNow(r2.payment.paymentRef));
      assert.ok(p2.ok, "money moved in the residual window is recorded, not lost");
      const out2 = await confirmPayment(m.d, r2.payment.paymentRef);
      assert.ok(["late", "duplicate"].includes(out2.outcome), "cancelled order is refunded, not delivered: " + out2.outcome);
      assert.equal(m.store.jobs.length, jobs0, "no job signed for a cancelled order");
      assert.equal(m.store.orders.get(id2)!.state, "refund_pending");
      const rf = m.store.refunds.filter((x) => x.providerRef === r2.payment.paymentRef);
      assert.ok(rf.length === 1 && rf[0].status === "pending_owner" && rf[0].atomic > 0, "one pending_owner refund for the full amount");
      settleTx = txUpper;
      // Route wiring: 409 order_not_payable on GET and POST, before any 402 / facilitator work.
      const route = readFileSync(join(__dirname, "../src/app/api/rentals/pay/[ref]/route.ts"), "utf8");
      assert.ok(/requestStatus\(ref\)/.test(route) && /r\.error === "order_not_payable" \|\| r\.error === "no_capacity"\) return j\(409/.test(route), "pay route returns 409 order_not_payable (GET via requestStatus, POST directly)");
      const x402Src = readFileSync(join(__dirname, "../src/lib/rentals/phase2/x402.ts"), "utf8");
      const rsSrc = x402Src.slice(x402Src.indexOf("async requestStatus("));
      assert.ok(rsSrc.indexOf("getSettlement(ref)") < rsSrc.indexOf("payableState(ref)"), "GET: a settled ref still says paid");
      assert.deepEqual(await xp.requestStatus(ref), { status: 200, body: { status: "paid" } }, "settled ref on a moved-on order = 200 paid");
      // Review #88 S4: create_rental, OpenAPI and llms.txt say: accepts[0] unchanged as `accepted`, and 200 + 'retry' = paid.
      // MRR-only (2026-10-17): OpenAPI and llms.txt describe the default mode, where direct checkout is closed (410), so
      // they now say that instead; the x402 payment wording stays on create_rental (registered in RENTALS_MODE=direct).
      for (const f of ["src/app/api/openapi.json/route.ts", "public/llms.txt"]) {
        const t = readFileSync(join(__dirname, "..", f), "utf8");
        assert.ok(/direct_rentals_closed/.test(t), f + " says direct rentals are closed (410 direct_rentals_closed)");
      }
      for (const f of ["src/lib/rentals/phase2/mcp.ts"]) {
        const t = readFileSync(join(__dirname, "..", f), "utf8").replace(/"\s*\+\s*\n\s*"/g, "").replace(/\s+/g, " ");
        assert.ok(/accepts\[0\] (back|from the payment request back) unchanged as \\?`accepted\\?`/.test(t) && /extra\.orderRef is checked/.test(t), f + " says send accepts[0] unchanged as accepted");
        assert.ok(/200 with outcome 'retry' means you have paid/.test(t) && /don't pay again/.test(t), f + " says 200 + retry = paid, don't pay again");
      }
      // Review #87 S3: the cancel race's 200 + outcome "retry" is documented in code and docs.
      const svcSrc = readFileSync(join(__dirname, "../src/lib/rentals/phase2/service.ts"), "utf8");
      assert.ok(/200 with outcome "retry"/.test(route) && /never as unpaid/.test(route), "pay route documents 200 + outcome retry");
      assert.ok(/outcome: "retry"/.test(svcSrc) && /never as unpaid/.test(svcSrc), "confirmPayment documents retry after a settled payment");
    }
  }

  // rev 1.5 fail closed: an x402 settle without a tx hash signs no job.
  {
    const m = mk({ lightningEnabled: false, pilot: true });
    m.x.omitTxHash = true;
    const cr = (await createRental(m.d, { ...base, rail: undefined, idempotency_key: idem() }) as unknown as { result: { rentalId: string; payment: { paymentRef: string } } }).result;
    m.x.simulatePay(cr.payment.paymentRef, m.store.bindings.get(cr.payment.paymentRef)!.expectedAtomic, m.d.now());
    assert.equal((await confirmPayment(m.d, cr.payment.paymentRef)).outcome, "no_tx_hash");
    assert.equal(m.store.jobs.length, 0, "no job signed without a settled tx hash");
    assert.equal((await m.store.getOrderByPublicId(cr.rentalId))!.state, "awaiting_payment");
    m.x.omitTxHash = false;
    assert.equal((await confirmPayment(m.d, cr.payment.paymentRef)).outcome, "settled");
    assert.match(m.store.jobs[0].payload.payment!.tx_hash!, /^0x[0-9a-f]{64}$/);
  }

  // SupabaseStore maps rows <-> Order and sends every write through the RPCs.
  {
    const { SupabaseStore } = await import("../src/lib/rentals/phase2/store-supabase");
    const seen: { url: string; body: unknown }[] = [];
    const f = (async (url: string, init: { method?: string; body?: string }) => {
      seen.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
      if (String(url).includes("rpc/rental_settle")) return new Response(JSON.stringify({ code: "P0001", message: "kill_switch" }), { status: 400 });
      if (String(url).includes("rental_orders?")) return new Response(JSON.stringify([{ id: "o1", public_id: "gm_abcdefgh", idem_key: "k".repeat(16), rail: "x402_usdc", state: "active", rig_count: 2, th: 540, days: 3, price_btc_ph_day: "0.0005", floor_btc_ph_day: "0.0004", total_sats: "1000", total_usdc_atomic: "800", pool_host: "stratum.braiins.com", pool_port: 3333, worker: "w", access_code_hmac: "a", creator_secret_hmac: "c", created_at: "2026-10-16T15:00:00Z", expires_at: "2026-10-16T15:15:00Z", starts_at: "2026-10-16T15:01:00Z", ends_at: null, terms_version: "v", terms_accepted_at: "2026-10-16T15:00:00Z", bays: "1,2", version: 4 }]));
      return new Response("[]");
    }) as unknown as typeof fetch;
    const st = new SupabaseStore("https://x.supabase.co/", "k", f);
    const o = (await st.getOrderByPublicId("gm_abcdefgh"))!;
    assert.equal(o.totalSats, 1000); assert.equal(o.startsAt, Date.parse("2026-10-16T15:01:00Z")); assert.equal(o.bays, "1,2"); assert.equal(o.endsAt, null);
    const { KillSwitchError } = await import("../src/lib/rentals/phase2/store");
    await assert.rejects(st.commit({ order: { id: "o1", fromVersion: 4, patch: { state: "completed", bays: "1,2" } } }), (e: unknown) => e instanceof KillSwitchError);
    const body = seen.find((x) => x.url.includes("rpc/rental_settle"))!.body as { c: { order: { patch: Record<string, unknown> } } };
    assert.deepEqual(body.c.order.patch, { state: "completed", bays: "1,2" });
    assert.equal(await st.getSettlement("x402_" + "0".repeat(32)), null);
  }

  // rev 1.5 re-offer: expired unapplied job re-signed (fresh nonce, same order + tx), node dedupe, then expired_unapplied at 30 min.
  {
    const svc = await import("../src/lib/rentals/phase2/service");
    const { applyKey } = await import("../src/lib/rentals/phase2/jobs");
    const { verifyGmJob, FileLedger: SnipLedger } = await import("./rentals/verify-job-snippet.mjs");
    const m = mk({ lightningEnabled: false, pilot: true });
    const cr = (await createRental(m.d, { ...base, rail: undefined, idempotency_key: idem() }) as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
    m.x.simulatePay(cr.payment.paymentRef, m.store.bindings.get(cr.payment.paymentRef)!.expectedAtomic, m.d.now());
    assert.equal((await confirmPayment(m.d, cr.payment.paymentRef)).outcome, "settled");
    const o0 = (await m.store.getOrderByPublicId(cr.rentalId))!;
    assert.equal(await svc.reofferOrExpire(m.d, o0), "waiting", "job still live: no re-offer");
    const j1 = m.store.jobs.find((j) => j.payload.order_ref === cr.rentalId)!;
    // Node applies j1 (both verifiers record the apply key) ...
    const led = memLedger(), tmp = mkdtempSync(join(tmpdir(), "gmled-")), sled = new SnipLedger(join(tmp, "l.jsonl"));
    const at = (job: typeof j1) => Math.floor(job.payload.iat) + 1;
    assert.deepEqual(verifyJob(j1, vo({ t1: PUB }, at(j1), led)), { ok: true });
    assert.equal(verifyGmJob(j1, { keys: { t1: PUB }, expectEnv: "staging", nowSec: at(j1), ledger: sled, caps: CAPS }).ok, true);
    // ... but its result row is lost. The job expires, the sweeper re-offers.
    m.tick(16 * 60_000);
    assert.equal(await svc.reofferOrExpire(m.d, (await m.store.getOrderByPublicId(cr.rentalId))!), "reoffered");
    const routes = m.store.jobs.filter((j) => j.payload.order_ref === cr.rentalId && j.payload.action === "route");
    assert.equal(routes.length, 2);
    const j2 = routes[1];
    assert.notEqual(j2.payload.nonce, j1.payload.nonce, "fresh nonce"); assert.notEqual(j2.payload.job_id, j1.payload.job_id);
    assert.equal(j2.payload.order_ref, j1.payload.order_ref, "same order");
    assert.equal(j2.payload.payment!.tx_hash, j1.payload.payment!.tx_hash, "same tx_hash");
    assert.deepEqual([j2.payload.pay_to, j2.payload.amount_usdc, j2.payload.start, j2.payload.end], [j1.payload.pay_to, j1.payload.amount_usdc, j1.payload.start, j1.payload.end]);
    assert.equal(applyKey(j2.payload), applyKey(j1.payload));
    assert.deepEqual(verifyJob(j2, vo({ t1: PUB }, at(j2), led)), { ok: false, reason: "already_applied" }, "re-offer cannot double-apply (jobs.ts)");
    assert.equal((verifyGmJob(j2, { keys: { t1: PUB }, expectEnv: "staging", nowSec: at(j2), ledger: sled, caps: CAPS }) as { reason: string }).reason, "already_applied", "re-offer cannot double-apply (snippet)");
    assert.equal((verifyGmJob(j2, { keys: { t1: PUB }, expectEnv: "staging", nowSec: at(j2), ledger: new SnipLedger(join(tmp, "l.jsonl")), caps: CAPS }) as { reason: string }).reason, "already_applied", "dedupe survives a restart (durable ledger)");
    assert.equal(verifyGmJob(j2, { keys: { t1: PUB }, expectEnv: "staging", nowSec: at(j2), ledger: new SnipLedger(join(tmp, "fresh.jsonl")), caps: CAPS }).ok, true, "a node that never applied it accepts the re-offer");
    rmSync(tmp, { recursive: true, force: true });
    // Still unapplied 30 min after settlement: expired_unapplied, refund_due, alert, no more re-offers, nothing sent.
    m.tick(15 * 60_000);
    assert.equal(await svc.reofferOrExpire(m.d, (await m.store.getOrderByPublicId(cr.rentalId))!), "expired_unapplied");
    const o2 = (await m.store.getOrderByPublicId(cr.rentalId))!;
    assert.equal(o2.state, "expired_unapplied");
    const rf = m.store.refunds.filter((r) => r.reason === "expired_unapplied");
    assert.equal(rf.length, 1); assert.equal(rf[0].status, "pending_owner", "refund is due, never auto-sent");
    assert.equal(rf[0].atomic, m.store.bindings.get(cr.payment.paymentRef)!.expectedAtomic, "full refund due");
    assert.ok(m.alerter.sent.some((a) => a.kind === "expired_unapplied") && m.store.alerts.some((a) => a.kind === "expired_unapplied"), "ntfy + outbox alert");
    assert.ok(m.store.jobs.some((j) => j.payload.order_ref === cr.rentalId && j.payload.action === "revert"), "safety revert");
    const routesOf = () => m.store.jobs.filter((j) => j.payload.order_ref === cr.rentalId && j.payload.action === "route").length;
    const revertsOf = () => m.store.jobs.filter((j) => j.payload.order_ref === cr.rentalId && j.payload.action === "revert");
    const nRoutes = routesOf();
    assert.equal(await svc.reofferRevert(m.d, (await m.store.getOrderByPublicId(cr.rentalId))!), "waiting", "revert still live");
    // The node claims the revert (lease) and crashes: no result. Once its exp passes the sweep re-signs it.
    m.tick(60 * 60_000); await svc.sweepExpired(m.d);
    assert.equal(routesOf(), nRoutes, "no route re-offer after expired_unapplied");
    const revs = revertsOf(); assert.equal(revs.length, 2, "expired unanswered revert is re-offered");
    assert.notEqual(revs[1].payload.nonce, revs[0].payload.nonce); assert.equal(revs[1].payload.order_ref, revs[0].payload.order_ref);
    assert.equal(await svc.reofferRevert(m.d, (await m.store.getOrderByPublicId(cr.rentalId))!), "waiting", "one live revert at a time");
    await m.store.recordResult({ jobId: revs[1].payload.job_id, orderRef: cr.rentalId, result: "applied", reason: null, deliveredTh: null, at: m.d.now() });
    m.tick(60 * 60_000);
    assert.equal(await svc.reofferRevert(m.d, (await m.store.getOrderByPublicId(cr.rentalId))!), "none", "answered revert is not re-offered");
    const st = (await svc.getRentalStatus(m.d, { rental_id: cr.rentalId, creator_secret: cr.creatorSecret })) as { result: { status: string; refundDue: boolean; note: string } };
    assert.equal(st.result.status, "expired_unapplied"); assert.equal(st.result.refundDue, true); assert.match(st.result.note, /refund is due/);
    assert.equal((await svc.cancelRental(m.d, { rental_id: cr.rentalId, creator_secret: cr.creatorSecret }) as { error: string }).error, "not_cancellable");
    // An applied result stops both re-offer and expiry.
    const m2 = mk({ lightningEnabled: false, pilot: true });
    const c2 = (await createRental(m2.d, { ...base, rail: undefined, idempotency_key: idem() }) as unknown as { result: { rentalId: string; payment: { paymentRef: string } } }).result;
    m2.x.simulatePay(c2.payment.paymentRef, m2.store.bindings.get(c2.payment.paymentRef)!.expectedAtomic, m2.d.now());
    await confirmPayment(m2.d, c2.payment.paymentRef);
    await m2.store.recordResult({ jobId: m2.store.jobs[0].payload.job_id, orderRef: c2.rentalId, result: "applied", reason: null, deliveredTh: null, at: m2.d.now() });
    m2.tick(40 * 60_000);
    assert.equal(await svc.reofferOrExpire(m2.d, (await m2.store.getOrderByPublicId(c2.rentalId))!), "applied");
    assert.equal((await m2.store.getOrderByPublicId(c2.rentalId))!.state, "delivering");
  }

  // Outside pools (2026-10-16): catalog pin, input rules, held orders (2 h 15 min, shifted re-sign), pending_approval non-final.
  {
    const svc = await import("../src/lib/rentals/phase2/service");
    const pools = await import("../src/lib/rentals/phase2/pools");
    const gm = await import("../src/lib/rentals/phase2/gm-pools.mjs");
    const sha = (f: string) => crypto.createHash("sha256").update(readFileSync(join(__dirname, "..", f))).digest("hex");
    // The export's own copy of the node module (comments differ from the node copy) and the catalog, version 2026-10-16.3 (adds solopool). Bump both pins together.
    assert.equal(sha("src/lib/rentals/phase2/gm-pools.mjs"), "642d2409ba21641532b436232ddaaa64215d4e50d5ecb3f2997db31852584b87", "gm-pools.mjs is the pinned export copy");
    assert.equal(sha("src/lib/rentals/phase2/pools-catalog.json"), "3f851fff84f4314bd21b5a2c089ad3788eb836b4270906702d833cbf9ba84ff8", "pools-catalog.json is the node's exact copy");
    const NODE_COPY = process.env.GM_POOLS_NODE_COPY_DIR; // optional: a staged node copy to compare against
    for (const f of ["gm-pools.mjs", "pools-catalog.json"]) if (NODE_COPY && existsSync(join(NODE_COPY, f))) {
      const local = f === "gm-pools.mjs" ? "src/lib/rentals/phase2/gm-pools.mjs" : "src/lib/rentals/phase2/pools-catalog.json";
      assert.equal(crypto.createHash("sha256").update(readFileSync(join(NODE_COPY, f))).digest("hex"), sha(local), `vendored ${f} matches the staged node copy`);
    }
    const cat = JSON.parse(readFileSync(join(__dirname, "../src/lib/rentals/phase2/pools-catalog.json"), "utf8")) as { version: string; pools: { id: string; name: string; username_format: string; password: string; stratum: string[]; default: string }[] };
    assert.equal(cat.version, "2026-10-16.3"); assert.equal(gm.CATALOG_VERSION, cat.version, "module and catalog are the same version");
    assert.deepEqual(gm.POOL_CATALOG.map((p) => p.id).sort(), cat.pools.map((p) => p.id).sort());
    for (const c of cat.pools) {
      const m = gm.poolById(c.id)!;
      assert.equal(m.name, c.name); assert.equal(m.user_format, c.username_format); assert.equal(m.pass, c.password, c.id + " password");
      assert.deepEqual((m.endpoints as unknown as [string, number[]][]).flatMap(([h, ports]) => ports.map((pt) => `stratum+tcp://${h}:${pt}`)).sort(), [...c.stratum].sort(), c.id + " endpoints");
      const ui = pools.catalogForUi().find((u) => u.id === c.id)!;
      assert.equal(ui.endpoint, c.default, c.id + ": pool_id signs the catalog default");
      const host = c.default.replace("stratum+tcp://", "").split(":")[0], port = Number(c.default.split(":").pop());
      const user = c.username_format === "account[.worker]" ? "renter.w1" : "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq.rig1";
      const r = pools.resolvePool({ pool_id: c.id, username: user });
      assert.ok(r.ok && r.v.host === host && r.v.port === port && r.v.approval === "auto" && r.v.poolId === c.id, c.id + " " + JSON.stringify(r));
      assert.equal(JSON.stringify(pools.catalogForUi()).includes(c.password === "123" ? '"123"' : '"pass"'), false, "no passwords in the UI list");
    }
    // solopool (catalog 2026-10-16.3): btc_address[.worker], default stratum.solopool.com:3333.
    const BTC = ["bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297"];
    // A 62-char taproot address plus ".rig1" exceeds the 64-char job-schema limit, so taproot is tested bare (and refused with a worker).
    assert.equal((pools.resolvePool({ pool_id: "solopool", username: BTC[3] + ".rig1" }) as { error: string }).error, "pool_user");
    for (const a of BTC) for (const u of a === BTC[3] ? [a] : [a, a + ".rig1"]) {
      const r = pools.resolvePool({ pool_id: "solopool", username: u });
      assert.ok(r.ok && r.v.host === "stratum.solopool.com" && r.v.port === 3333 && r.v.approval === "auto", "solopool " + u);
    }
    for (const [u, code] of [["alice", "pool_user_btc_address"], ["bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdx", "pool_user_btc_address"], ["tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", "pool_user_btc_address"], ["bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq.a.b", "pool_user_worker_format"], ["bad worker", "pool_user"]] as const) {
      const r = pools.resolvePool({ pool_id: "solopool", username: u });
      assert.ok(!r.ok && r.error === code, `solopool refuses ${u}: ${JSON.stringify(r)}`);
    }
    assert.equal((pools.resolvePool({ custom_url: "eu.solopool.com:4444", username: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" }) as { v: { approval: string; poolId: string } }).v.poolId, "solopool", "a custom_url on a catalog host+port is that catalog pool");
    // solopool note (spec 0d1c1bf3, security review): shown for solopool only, in the UI list, the create_rental reply and the MCP schema.
    const SOLO_NOTE = "SoloPool.com sets the payout mode per BTC address across the whole pool. This rental connects with password 'x', which puts YOUR payout address in 100% solo mode. If you also mine to the same address elsewhere on solopool.com in Solo Split or Prop mode, those workers switch to 100% solo too. Solo mining pays only when a block is found, so most rentals earn nothing. Use a separate address if you want to keep another mode.";
    for (const u of pools.catalogForUi()) assert.equal(u.note, u.id === "solopool" ? SOLO_NOTE : null, u.id + " note");
    assert.equal(pools.poolNote(null), null); assert.equal(pools.poolNote("toString"), null);
    {
      const tools: Record<string, { desc: string; schema: Record<string, { description?: string }> }> = {};
      const { registerPhase2Tools } = await import("../src/lib/rentals/phase2/mcp");
      registerPhase2Tools({ tool: (name: string, desc: string, schema: Record<string, { description?: string }>) => { tools[name] = { desc, schema }; } }, (v: unknown) => v, () => null, null);
      const pd = tools.create_rental.schema.pool_id.description ?? "";
      assert.ok(pd.includes("Note for solopool: " + SOLO_NOTE), "MCP pool_id description carries the solopool note");
      assert.equal(pd.split("100% solo mode").length - 1, 1, "only one pool note in the schema");
      assert.ok(!leaksNeverReveal(JSON.stringify(Object.values(tools).map((t) => [t.desc, Object.values(t.schema).map((x) => x.description)]))), "MCP copy never names the owner or facility");
    }
    {
      // A fresh store per order: the pilot holds at most 4 unpaid rigs.
      const mkc = async (extra: Record<string, unknown>) => (await createRental(mk({ lightningEnabled: false, pilot: true }).d, { ...base, rail: undefined, pool_url: undefined, worker: undefined, th: undefined, rigs: 1, ...extra, idempotency_key: idem() })) as unknown as { ok: boolean; result: { poolNote?: string } };
      const sp = await mkc({ pool_id: "solopool", username: BTC[0] });
      assert.ok(sp.ok); assert.equal(sp.result.poolNote, SOLO_NOTE, "create_rental shows the note for solopool");
      const spc = await mkc({ custom_url: "la.solopool.com:4444", username: BTC[1] });
      assert.equal(spc.result.poolNote, SOLO_NOTE, "a custom_url on a solopool endpoint is solopool");
      for (const extra of [{ pool_id: "braiins", username: "renter.w1" }, { pool_id: "ckpool-solo", username: BTC[0] }, { custom_url: "pool.example.org:3333", username: "w1" }]) {
        const r = await mkc(extra); assert.ok(r.ok, JSON.stringify(extra)); assert.equal("poolNote" in r.result, false, "no note for " + JSON.stringify(extra));
      }
    }
    // Other formats.
    assert.ok(pools.resolvePool({ pool_id: "braiins", username: "acct_1.rig-2" }).ok);
    assert.equal((pools.resolvePool({ pool_id: "braiins", username: "-acct" }) as { error: string }).error, "pool_user_account_format");
    assert.ok(pools.resolvePool({ pool_id: "nicehash", username: "NHbQGG3whZkMDKPvzhu7EBPuTsdCQh5yW6CG.rig" }).ok);
    assert.equal((pools.resolvePool({ pool_id: "nicehash", username: "alice" }) as { error: string }).error, "pool_user_nicehash_address");
    // custom_url rules (parseCustomUrl): host:port or stratum+tcp://host:port only.
    for (const u of ["pool.example.org:3333", "stratum+tcp://pool.example.org:3333", "  Pool.Example.ORG:1  ", "stratum.braiins.com:22"]) {
      const r = pools.resolvePool({ custom_url: u, username: "a.b.c" });
      assert.ok(r.ok && r.v.approval === "manual" && r.v.poolId === null, u + " " + JSON.stringify(r));
    }
    for (const [u, code] of [["1.2.3.4:3333", "pool_host_ip_literal"], ["pool.local:3333", "pool_host_internal"], ["box.tail1234.ts.net:3333", "pool_host_internal"], ["pool.lan:3333", "pool_host_internal"],
      ["pool.example.org:0", "pool_port"], ["pool.example.org:65536", "pool_port"], ["pool.example.123:3333", "pool_host_tld"], ["stratum+ssl://pool.example.org:3333", "invalid_input"], ["http://pool.example.org:3333", "invalid_input"],
      ["user@pool.example.org:3333", "invalid_input"], ["pool.example.org:3333/x", "invalid_input"], ["pool.example.org:3333?a=1", "invalid_input"], ["[::1]:3333", "invalid_input"], ["pool.example.org", "invalid_input"]] as const) {
      const r = pools.resolvePool({ custom_url: u, username: "w" });
      assert.ok(!r.ok && r.error === code, `${u}: ${JSON.stringify(r)}`);
    }
    for (const bad of [{}, { pool_id: "braiins", custom_url: "pool.example.org:3333", username: "w" }, { custom_url: "pool.example.org:3333" }, { pool_id: "nope", username: "w" },
      { custom_url: "pool.example.org:3333", pool_url: "pool.example.org:3333", username: "w" }, { pool_id: "braiins", username: "w", worker: "w" }]) {
      const r = pools.resolvePool(bad); assert.ok(!r.ok && r.error === "invalid_input", JSON.stringify(bad));
    }
    assert.ok(pools.resolvePool({ pool_url: "stratum+tcp://stratum.braiins.com:3333", worker: "renter.w1" }).ok, "legacy aliases still work");

    // Held order: custom pool, x402, settle.
    const m = mk({ lightningEnabled: false, pilot: true });
    const held = { ...base, rail: undefined, pool_url: undefined, worker: undefined, custom_url: "stratum+tcp://pool.example.org:3333", username: "renter.w1" };
    const c = await createRental(m.d, { ...held, idempotency_key: idem() });
    assert.ok(c.ok, JSON.stringify(c));
    const cr = (c as unknown as { result: { rentalId: string; creatorSecret: string; poolApproval: string; note: string; payment: { paymentRef: string } } }).result;
    assert.equal(cr.poolApproval, "manual"); assert.match(cr.note, /manual approval, which can take up to about 2 hours/);
    const T_SETTLE = m.d.now();
    m.x.simulatePay(cr.payment.paymentRef, m.store.bindings.get(cr.payment.paymentRef)!.expectedAtomic, T_SETTLE);
    assert.equal((await confirmPayment(m.d, cr.payment.paymentRef)).outcome, "settled");
    const routes = () => m.store.jobs.filter((j) => j.payload.order_ref === cr.rentalId && j.payload.action === "route");
    const ord = async () => (await m.store.getOrderByPublicId(cr.rentalId))!;
    const j1 = routes()[0];
    assert.deepEqual(j1.payload.upstream, { host: "pool.example.org", port: 3333, user: "renter.w1" }, "custom host goes through to the node's classifier");
    assert.equal(j1.payload.exp - j1.payload.iat, pools.HELD_JOB_TTL_SEC, "held route job lives 8 min");
    assert.ok(pools.HELD_JOB_TTL_SEC < 600, "always inside the node's ±10 min start window");
    const caps = { maxRigs: 4, maxSec: MAX_TERM_SEC, hostSuffixes: ["example.org"], ports: new Set([3333]) };
    assert.deepEqual(verifyJob(j1, { keys: { t1: PUB }, expectEnv: "staging", nowSec: j1.payload.iat + 1, ledger: memLedger(), caps }), { ok: true });
    const dur = j1.payload.end - j1.payload.start;
    assert.equal(dur, 86_400);
    const st0 = (await svc.getRentalStatus(m.d, { rental_id: cr.rentalId, creator_secret: cr.creatorSecret })) as { result: { awaitingPoolApproval: boolean; poolApproval: string; note: string; rejectedReason: string | null } };
    assert.equal(st0.result.awaitingPoolApproval, true); assert.equal(st0.result.poolApproval, "manual"); assert.equal(st0.result.rejectedReason, null);
    assert.equal(st0.result.note, "Waiting for owner approval of your pool (up to 2 hours, refunded if not approved).");
    assert.ok(!leaksNeverReveal(JSON.stringify(st0)), "status copy never names the owner or facility");
    // Node holds it and (optionally) writes a non-final pending_approval result: never treated as applied or final.
    await m.store.recordResult({ jobId: j1.payload.job_id, orderRef: cr.rentalId, result: "pending_approval", reason: "pool_not_in_catalog", deliveredTh: null, at: m.d.now() });
    m.tick(5 * 60_000);
    assert.equal(await svc.reofferOrExpire(m.d, await ord()), "waiting", "job still live");
    m.tick(4 * 60_000); // 9 min: job expired -> shifted re-sign
    const before = await ord();
    assert.equal(await svc.reofferOrExpire(m.d, before), "reoffered");
    const j2 = routes()[1], after = await ord();
    assert.equal(j2.payload.start, Math.floor(m.d.now() / 1000), "start = now");
    assert.equal(j2.payload.end - j2.payload.start, dur, "same duration in seconds");
    assert.equal(j2.payload.payment!.tx_hash, j1.payload.payment!.tx_hash, "same payment"); assert.equal(j2.payload.amount_usdc, j1.payload.amount_usdc); assert.equal(j2.payload.pay_to, j1.payload.pay_to);
    assert.deepEqual([after.startsAt, after.endsAt], [j2.payload.start * 1000, j2.payload.end * 1000], "order window moves with the job");
    assert.equal(after.version, before.version + 1, "version-checked commit");
    assert.equal(j2.payload.exp - j2.payload.iat, pools.HELD_JOB_TTL_SEC);
    // A stale order version loses the race and writes nothing.
    m.tick(9 * 60_000);
    const nJobs = m.store.jobs.length;
    assert.equal(await svc.reofferOrExpire(m.d, before), "waiting", "stale version: no job, no patch");
    assert.equal(m.store.jobs.length, nJobs);
    // Past the normal 30 min it keeps waiting and re-signing (sweeper path).
    for (let t = 0; t < 8; t++) { m.tick(10 * 60_000); await svc.sweepExpired(m.d); } // to settlement + 98 min
    assert.equal((await ord()).state, "delivering", "held order is not expired at 30 min");
    assert.ok(routes().length > 5, "re-signed while held");
    for (const j of routes().slice(1)) assert.equal(j.payload.end - j.payload.start, dur, "every re-sign keeps the duration");
    // Jump to just before settlement + 2 h 15 min: still held.
    m.tick(T_SETTLE + pools.HELD_TIMEOUT_MS - 60_000 - m.d.now());
    assert.notEqual(await svc.reofferOrExpire(m.d, await ord()), "expired_unapplied");
    assert.equal((await ord()).state, "delivering");
    // At settlement + 2 h 15 min: expired_unapplied with a full refund due (pending_owner), even though startsAt moved.
    m.tick(61_000);
    assert.equal(await svc.reofferOrExpire(m.d, await ord()), "expired_unapplied");
    const rf = m.store.refunds.filter((r) => r.orderId === after.id);
    assert.equal(rf.length, 1); assert.equal(rf[0].status, "pending_owner"); assert.equal(rf[0].atomic, m.store.bindings.get(cr.payment.paymentRef)!.expectedAtomic);
    assert.equal(pools.HELD_TIMEOUT_MS, 8_100_000);

    // A rejected result (refused / timed out / conflict / bad pool) ends the hold: no more re-signs, normal 30 min.
    const m3 = mk({ lightningEnabled: false, pilot: true });
    const c3 = (await createRental(m3.d, { ...held, idempotency_key: idem() }) as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
    m3.x.simulatePay(c3.payment.paymentRef, m3.store.bindings.get(c3.payment.paymentRef)!.expectedAtomic, m3.d.now());
    await confirmPayment(m3.d, c3.payment.paymentRef);
    m3.tick(5 * 60_000);
    await m3.store.recordResult({ jobId: m3.store.jobs[0].payload.job_id, orderRef: c3.rentalId, result: "rejected", reason: "external_refused", deliveredTh: null, at: m3.d.now() });
    m3.tick(15 * 60_000);
    const n3 = m3.store.jobs.length;
    assert.equal(await svc.reofferOrExpire(m3.d, (await m3.store.getOrderByPublicId(c3.rentalId))!), "waiting");
    assert.equal(m3.store.jobs.length, n3, "no re-sign after a rejection");
    const st3 = (await svc.getRentalStatus(m3.d, { rental_id: c3.rentalId, creator_secret: c3.creatorSecret })) as { result: { awaitingPoolApproval: boolean; rejectedReason: string } };
    assert.equal(st3.result.awaitingPoolApproval, false); assert.equal(st3.result.rejectedReason, "external_refused");
    m3.tick(10 * 60_000);
    assert.equal(await svc.reofferOrExpire(m3.d, (await m3.store.getOrderByPublicId(c3.rentalId))!), "expired_unapplied", "refund at settlement + 30 min");

    // Catalog pools are unchanged: 15 min jobs, no shift, 30 min expiry.
    const m4 = mk({ lightningEnabled: false, pilot: true });
    const c4 = (await createRental(m4.d, { ...base, rail: undefined, pool_url: undefined, worker: undefined, pool_id: "solopool", username: BTC[0] + ".rig1", idempotency_key: idem() }) as unknown as { result: { rentalId: string; creatorSecret: string; poolApproval: string; note: string; payment: { paymentRef: string } } }).result;
    assert.equal(c4.poolApproval, "auto"); assert.ok(!/manual approval/.test(c4.note));
    // The renter's own payout address may be echoed back (the filter masks a valid address head only); blocked words elsewhere still refuse.
    const g4 = await getRental(m4.d, { rental_id: c4.rentalId, creator_secret: c4.creatorSecret });
    assert.ok(g4.ok && JSON.stringify(g4).includes(BTC[0] + ".rig1"));
    for (const [extra, why] of [[{ pool_id: "solopool", username: BTC[0] + "." + SYNTH.host }, "blocked worker after an address"], [{ pool_id: "braiins", username: "bc1qzzzzzzzzzz" }, "bc1-looking account name"],
      [{ custom_url: "umbrel-pool.example.org:3333", username: "w1" }, "blocked word in a custom host"], [{ custom_url: "pool.example.org:3333", username: "bc1qnotanaddress1" }, "bc1-looking non-address on a custom pool"]] as const) {
      const r = await createRental(m4.d, { ...base, rail: undefined, pool_url: undefined, worker: undefined, ...extra, idempotency_key: idem() });
      assert.ok(!r.ok, why + ": " + JSON.stringify(r));
    }
    m4.x.simulatePay(c4.payment.paymentRef, m4.store.bindings.get(c4.payment.paymentRef)!.expectedAtomic, m4.d.now());
    await confirmPayment(m4.d, c4.payment.paymentRef);
    const k1 = m4.store.jobs[0];
    assert.deepEqual(k1.payload.upstream, { host: "stratum.solopool.com", port: 3333, user: BTC[0] + ".rig1" });
    assert.equal(k1.payload.exp - k1.payload.iat, 15 * 60);
    m4.tick(16 * 60_000);
    assert.equal(await svc.reofferOrExpire(m4.d, (await m4.store.getOrderByPublicId(c4.rentalId))!), "reoffered");
    const k2 = m4.store.jobs.filter((j) => j.payload.action === "route")[1];
    assert.deepEqual([k2.payload.start, k2.payload.end], [k1.payload.start, k1.payload.end], "catalog re-offer keeps the original window");
    const st4 = (await svc.getRentalStatus(m4.d, { rental_id: c4.rentalId, creator_secret: c4.creatorSecret })) as { result: { awaitingPoolApproval: boolean } };
    assert.equal(st4.result.awaitingPoolApproval, false);
    m4.tick(15 * 60_000);
    assert.equal(await svc.reofferOrExpire(m4.d, (await m4.store.getOrderByPublicId(c4.rentalId))!), "expired_unapplied");

    // ---- Review #89 M1a: a held route job never outlives settlement + HELD_TIMEOUT_MS; nothing claimable after it.
    // claimable = what rental_claim_jobs would offer: exp > now and no result row for that job.
    const claimable = (mm: ReturnType<typeof mk>, rid: string) => mm.store.jobs.filter((j) => j.payload.order_ref === rid && j.payload.action === "route"
      && j.payload.exp * 1000 > mm.d.now() && !mm.store.results.some((r) => r.jobId === j.payload.job_id));
    for (const j of routes()) assert.ok(j.payload.exp * 1000 <= T_SETTLE + pools.HELD_TIMEOUT_MS, "every held re-sign exp <= settle + 2h15m");
    assert.equal(claimable(m, cr.rentalId).length, 0, "after the held deadline no route job is claimable");
    {
      const m5 = mk({ lightningEnabled: false, pilot: true });
      const c5 = (await createRental(m5.d, { ...held, idempotency_key: idem() }) as unknown as { result: { rentalId: string; payment: { paymentRef: string } } }).result;
      const T5 = m5.d.now();
      m5.x.simulatePay(c5.payment.paymentRef, m5.store.bindings.get(c5.payment.paymentRef)!.expectedAtomic, T5);
      await confirmPayment(m5.d, c5.payment.paymentRef);
      const first = m5.store.jobs[0];
      assert.equal(first.payload.exp - first.payload.iat, pools.HELD_JOB_TTL_SEC, "first held job: 8 min (deadline far away)");
      // Node saw it late (offline) and its own 2 h clock runs past ours: re-sign 3 min before the site deadline.
      m5.tick(T5 + pools.HELD_TIMEOUT_MS - 3 * 60_000 - m5.d.now());
      assert.equal(await svc.reofferOrExpire(m5.d, (await m5.store.getOrderByPublicId(c5.rentalId))!), "reoffered");
      const late = m5.store.jobs.filter((j) => j.payload.action === "route").at(-1)!;
      assert.equal(late.payload.exp, Math.floor((T5 + pools.HELD_TIMEOUT_MS) / 1000), "exp capped at settle + HELD_TIMEOUT_MS");
      assert.ok(late.payload.exp - late.payload.iat < pools.HELD_JOB_TTL_SEC && late.payload.exp > late.payload.iat, "shorter than 8 min, still valid");
      assert.equal(claimable(m5, c5.rentalId).length, 1, "live until the deadline");
      m5.tick(3 * 60_000);
      assert.equal(claimable(m5, c5.rentalId).length, 0, "no claimable route job at the held deadline");
      assert.equal(await svc.reofferOrExpire(m5.d, (await m5.store.getOrderByPublicId(c5.rentalId))!), "expired_unapplied");
      assert.equal(claimable(m5, c5.rentalId).length, 0, "and none after expiry");
      // A late node approval now has nothing to apply: the newest route job is dead.
      assert.ok(m5.store.jobs.filter((j) => j.payload.action === "route").every((j) => j.payload.exp * 1000 <= m5.d.now()));
    }

    // ---- Review #89 M1b: cancel during a hold is refused, so an approval can never start a refunded order.
    {
      const m6 = mk({ lightningEnabled: false, pilot: true });
      const c6 = (await createRental(m6.d, { ...held, idempotency_key: idem() }) as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
      m6.x.simulatePay(c6.payment.paymentRef, m6.store.bindings.get(c6.payment.paymentRef)!.expectedAtomic, m6.d.now());
      await confirmPayment(m6.d, c6.payment.paymentRef);
      m6.tick(2 * 60_000);
      const n6 = m6.store.jobs.length;
      const k6 = await cancelRental(m6.d, { rental_id: c6.rentalId, creator_secret: c6.creatorSecret });
      assert.ok(!k6.ok && (k6 as { error: string }).error === "awaiting_pool_approval", "held cancel refused: " + JSON.stringify(k6));
      assert.match((k6 as unknown as { message: string }).message, /Awaiting pool approval; refunded in full if not approved/);
      const o6 = (await m6.store.getOrderByPublicId(c6.rentalId))!;
      assert.equal(o6.state, "delivering", "order stays live"); assert.equal(m6.store.refunds.filter((r) => r.orderId === o6.id).length, 0, "no refund queued");
      assert.equal(m6.store.jobs.length, n6, "no revert job");
      // Owner approves: the node applies the live route job. That is a paid, uncancelled order: correct.
      await m6.store.recordResult({ jobId: m6.store.jobs[0].payload.job_id, orderRef: c6.rentalId, result: "applied", reason: null, deliveredTh: null, at: m6.d.now() });
      assert.equal(m6.store.refunds.filter((r) => r.orderId === o6.id).length, 0, "no refunded order ever gets rigs");
      // Once applied, the normal pro-rata cancel is open again.
      m6.tick(60_000);
      const k6b = await cancelRental(m6.d, { rental_id: c6.rentalId, creator_secret: c6.creatorSecret });
      assert.ok(k6b.ok, "cancel after apply works: " + JSON.stringify(k6b));
      const paid6 = m6.store.bindings.get(c6.payment.paymentRef)!.expectedAtomic;
      const rf6 = m6.store.refunds.filter((r) => r.orderId === o6.id);
      assert.ok(rf6.length === 1 && rf6[0].atomic < paid6 && rf6[0].atomic > 0, "pro-rata after apply");
      // pending_approval on a catalog pool (version skew) is held too.
      const m7 = mk({ lightningEnabled: false, pilot: true });
      const c7 = (await createRental(m7.d, { ...base, rail: undefined, pool_url: undefined, worker: undefined, pool_id: "braiins", username: "renter.w1", idempotency_key: idem() }) as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
      m7.x.simulatePay(c7.payment.paymentRef, m7.store.bindings.get(c7.payment.paymentRef)!.expectedAtomic, m7.d.now());
      await confirmPayment(m7.d, c7.payment.paymentRef);
      await m7.store.recordResult({ jobId: m7.store.jobs[0].payload.job_id, orderRef: c7.rentalId, result: "pending_approval", reason: "port_not_listed", deliveredTh: null, at: m7.d.now() });
      assert.equal(((await cancelRental(m7.d, { rental_id: c7.rentalId, creator_secret: c7.creatorSecret })) as { error?: string }).error, "awaiting_pool_approval");
      // After a rejection the hold is over: cancel is allowed and refunds IN FULL (nothing ever applied, S4).
      await m7.store.recordResult({ jobId: m7.store.jobs[0].payload.job_id, orderRef: c7.rentalId, result: "rejected", reason: "external_refused", deliveredTh: null, at: m7.d.now() });
      m7.tick(10 * 60_000);
      const k7 = await cancelRental(m7.d, { rental_id: c7.rentalId, creator_secret: c7.creatorSecret });
      assert.ok(k7.ok, JSON.stringify(k7));
      const o7 = (await m7.store.getOrderByPublicId(c7.rentalId))!;
      assert.equal(m7.store.refunds.filter((r) => r.orderId === o7.id).reduce((a, r) => a + r.atomic, 0), m7.store.bindings.get(c7.payment.paymentRef)!.expectedAtomic, "full refund after rejection");
    }

    // ---- Review #89 S4: a delivering catalog order cancelled before anything applied gets a FULL refund.
    {
      const m8 = mk({ lightningEnabled: false, pilot: true });
      const c8 = (await createRental(m8.d, { ...base, rail: undefined, pool_url: undefined, worker: undefined, pool_id: "braiins", username: "renter.w1", idempotency_key: idem() }) as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
      m8.x.simulatePay(c8.payment.paymentRef, m8.store.bindings.get(c8.payment.paymentRef)!.expectedAtomic, m8.d.now());
      await confirmPayment(m8.d, c8.payment.paymentRef);
      m8.tick(10 * 60_000); // 10 min in, still nothing applied
      const k8 = await cancelRental(m8.d, { rental_id: c8.rentalId, creator_secret: c8.creatorSecret }) as unknown as { ok: boolean; result: { refundUsdc: string; status: string } };
      assert.ok(k8.ok, JSON.stringify(k8)); assert.equal(k8.result.status, "failed");
      const paid8 = m8.store.bindings.get(c8.payment.paymentRef)!.expectedAtomic;
      assert.equal(k8.result.refundUsdc, (paid8 / 1e6).toFixed(6), "full refund, not pro-rata");
      const o8 = (await m8.store.getOrderByPublicId(c8.rentalId))!;
      assert.equal(m8.store.refunds.filter((r) => r.orderId === o8.id).reduce((a, r) => a + r.atomic, 0), paid8);
    }

    // ---- Review #89 S1: "GalaxyMind." usernames (any case) are refused on every pool.
    for (const [extra, why] of [[{ pool_id: "braiins", username: "GalaxyMind.rig1" }, "catalog"], [{ pool_id: "braiins", username: "galaxymind.x" }, "lowercase"],
      [{ custom_url: "pool.example.org:3333", username: "GALAXYMIND.r" }, "custom pool"], [{ pool_url: "stratum+tcp://stratum.braiins.com:3333", worker: "GalaxyMind.w" }, "legacy alias"]] as const) {
      const r = pools.resolvePool(extra as Record<string, unknown>);
      assert.ok(!r.ok && r.error === "pool_user_reserved" && /reserved/.test(r.message), why + ": " + JSON.stringify(r));
      const cr9 = await createRental(m4.d, { ...base, rail: undefined, pool_url: undefined, worker: undefined, ...extra, idempotency_key: idem() });
      assert.equal((cr9 as { error?: string }).error, "pool_user_reserved", why + " via create_rental");
    }
    for (const ok of ["GalaxyMindFan.rig1", "notgalaxymind.x", "galaxymind"]) assert.ok(pools.resolvePool({ custom_url: "pool.example.org:3333", username: ok }).ok, ok + " is allowed");

    // ---- Review #89 S2: rejectedReason is renter-facing only.
    for (const [raw, want] of [["external_refused", "external_refused"], ["external_approval_timeout", "external_approval_timeout"], ["order_conflict", "order_conflict"],
      ["pool_dns_private", "pool_dns_private"], ["pool_user_btc_address", "pool_user_btc_address"], ["bay_held", "not_provisioned"], ["unknown_bay", "not_provisioned"],
      ["payment_below_floor", "not_provisioned"], ["start_failed", "not_provisioned"], ["__proto__", "not_provisioned"], ["", "not_provisioned"]] as const) assert.equal(pools.renterRejectReason(raw), want, raw);
    assert.equal(pools.renterRejectReason(null), null);
    {
      const m9 = mk({ lightningEnabled: false, pilot: true });
      const c9 = (await createRental(m9.d, { ...held, idempotency_key: idem() }) as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
      m9.x.simulatePay(c9.payment.paymentRef, m9.store.bindings.get(c9.payment.paymentRef)!.expectedAtomic, m9.d.now());
      await confirmPayment(m9.d, c9.payment.paymentRef);
      await m9.store.recordResult({ jobId: m9.store.jobs[0].payload.job_id, orderRef: c9.rentalId, result: "rejected", reason: "bay_held", deliveredTh: null, at: m9.d.now() });
      const s9 = (await svc.getRentalStatus(m9.d, { rental_id: c9.rentalId, creator_secret: c9.creatorSecret })) as { result: { rejectedReason: string } };
      assert.equal(s9.result.rejectedReason, "not_provisioned", "internal reason hidden");
      assert.ok(!JSON.stringify(s9).includes("bay_held"));
    }

    // ---- node fix1 (poller 9f78ddda) result reasons: results are passive on the site (nothing refunds or re-offers on a result).
    {
      const REASON_RE = /^[a-z_]{1,40}$/; // rental_job_results_reason_check
      for (const r of ["order_cancelled", "cancelled_before_start", "pool_user_reserved", "external_approval_timeout"]) assert.match(r, REASON_RE, r + " fits the DB reason check");
      const refundsOf = (mm: ReturnType<typeof mk>, id: string) => mm.store.refunds.filter((r) => r.orderId === id);
      const sweepN = async (mm: ReturnType<typeof mk>, n: number, stepMs: number) => { for (let i = 0; i < n; i++) { mm.tick(stepMs); await svc.sweepExpired(mm.d); } };

      // (1) Catalog order cancelled before anything applied (full refund + revert). The node then answers
      //     reverted:cancelled_before_start on the revert and rejected:order_cancelled on a late route job.
      const ma = mk({ lightningEnabled: false, pilot: true });
      const ca = (await createRental(ma.d, { ...base, rail: undefined, pool_url: undefined, worker: undefined, pool_id: "braiins", username: "renter.w1", idempotency_key: idem() }) as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
      const paidA = ma.store.bindings.get(ca.payment.paymentRef)!.expectedAtomic;
      ma.x.simulatePay(ca.payment.paymentRef, paidA, ma.d.now());
      await confirmPayment(ma.d, ca.payment.paymentRef);
      ma.tick(3 * 60_000);
      assert.ok((await cancelRental(ma.d, { rental_id: ca.rentalId, creator_secret: ca.creatorSecret })).ok);
      const oa = (await ma.store.getOrderByPublicId(ca.rentalId))!;
      const routeA = ma.store.jobs.find((j) => j.payload.order_ref === ca.rentalId && j.payload.action === "route")!;
      const revA = ma.store.jobs.find((j) => j.payload.order_ref === ca.rentalId && j.payload.action === "revert")!;
      assert.ok(revA, "cancel queued a revert");
      assert.equal(refundsOf(ma, oa.id).reduce((x, r) => x + r.atomic, 0), paidA, "cancel queued the full refund");
      await ma.store.recordResult({ jobId: revA.payload.job_id, orderRef: ca.rentalId, result: "reverted", reason: "cancelled_before_start", deliveredTh: null, at: ma.d.now() });
      await ma.store.recordResult({ jobId: routeA.payload.job_id, orderRef: ca.rentalId, result: "rejected", reason: "order_cancelled", deliveredTh: null, at: ma.d.now() });
      const jobsA = ma.store.jobs.length, verA = (await ma.store.getOrderByPublicId(ca.rentalId))!.version;
      await sweepN(ma, 30, 10 * 60_000); // 5 h of sweeps: past 30 min, past 2 h 15 min, past every revert TTL
      assert.equal(ma.store.jobs.length, jobsA, "order_cancelled / cancelled_before_start: no re-offer, no new revert");
      assert.equal(refundsOf(ma, oa.id).length, 1, "no second refund"); assert.equal(refundsOf(ma, oa.id)[0].atomic, paidA);
      const oa2 = (await ma.store.getOrderByPublicId(ca.rentalId))!;
      assert.equal(oa2.state, oa.state, "state unchanged"); assert.equal(oa2.version, verA, "order not touched");
      assert.equal(await svc.reofferRevert(ma.d, oa2), "none", "answered revert is never re-signed");
      assert.equal(await svc.reofferOrExpire(ma.d, oa2), "none", "a cancelled order is never re-offered");
      const sa = (await svc.getRentalStatus(ma.d, { rental_id: ca.rentalId, creator_secret: ca.creatorSecret })) as unknown as { ok: boolean; result: { refundPendingUsdc: string; awaitingPoolApproval: boolean } };
      assert.ok(sa.ok); assert.equal(sa.result.refundPendingUsdc, (paidA / 1e6).toFixed(6), "status shows the one full refund"); assert.equal(sa.result.awaitingPoolApproval, false);
      assert.equal(((await cancelRental(ma.d, { rental_id: ca.rentalId, creator_secret: ca.creatorSecret })) as { error?: string }).error, "not_cancellable", "no second cancel");

      // (2) Held order expired by the site (expired_unapplied: one full refund + revert). The node voids its
      //     pending record (reverted:cancelled_before_start) and refuses the last re-signed route job (order_cancelled).
      const mb = mk({ lightningEnabled: false, pilot: true });
      const cb = (await createRental(mb.d, { ...held, idempotency_key: idem() }) as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
      const paidB = mb.store.bindings.get(cb.payment.paymentRef)!.expectedAtomic, TB = mb.d.now();
      mb.x.simulatePay(cb.payment.paymentRef, paidB, TB);
      await confirmPayment(mb.d, cb.payment.paymentRef);
      await sweepN(mb, 28, 5 * 60_000); // to settle + 2 h 20 min
      const ob = (await mb.store.getOrderByPublicId(cb.rentalId))!;
      assert.equal(ob.state, "expired_unapplied");
      const lastRouteB = mb.store.jobs.filter((j) => j.payload.order_ref === cb.rentalId && j.payload.action === "route").at(-1)!;
      const revB = mb.store.jobs.filter((j) => j.payload.order_ref === cb.rentalId && j.payload.action === "revert").at(-1)!;
      await mb.store.recordResult({ jobId: revB.payload.job_id, orderRef: cb.rentalId, result: "reverted", reason: "cancelled_before_start", deliveredTh: null, at: mb.d.now() });
      await mb.store.recordResult({ jobId: lastRouteB.payload.job_id, orderRef: cb.rentalId, result: "rejected", reason: "order_cancelled", deliveredTh: null, at: mb.d.now() });
      const jobsB = mb.store.jobs.length;
      await sweepN(mb, 30, 10 * 60_000);
      assert.equal(mb.store.jobs.length, jobsB, "no re-offer or revert re-sign after the node's answers");
      assert.equal(refundsOf(mb, ob.id).length, 1, "exactly one refund"); assert.equal(refundsOf(mb, ob.id)[0].atomic, paidB, "full amount, once");
      assert.equal((await mb.store.getOrderByPublicId(cb.rentalId))!.state, "expired_unapplied");

      // (3) rejected:pool_user_reserved maps to the renter-facing pool_user_reserved.
      assert.equal(pools.renterRejectReason("pool_user_reserved"), "pool_user_reserved");
      const mc = mk({ lightningEnabled: false, pilot: true });
      const cc = (await createRental(mc.d, { ...held, idempotency_key: idem() }) as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
      mc.x.simulatePay(cc.payment.paymentRef, mc.store.bindings.get(cc.payment.paymentRef)!.expectedAtomic, mc.d.now());
      await confirmPayment(mc.d, cc.payment.paymentRef);
      await mc.store.recordResult({ jobId: mc.store.jobs[0].payload.job_id, orderRef: cc.rentalId, result: "rejected", reason: "pool_user_reserved", deliveredTh: null, at: mc.d.now() });
      const sc = (await svc.getRentalStatus(mc.d, { rental_id: cc.rentalId, creator_secret: cc.creatorSecret })) as { result: { rejectedReason: string; awaitingPoolApproval: boolean } };
      assert.equal(sc.result.rejectedReason, "pool_user_reserved"); assert.equal(sc.result.awaitingPoolApproval, false);

      // (4) node deadline = payment block time + 2 h (block time <= our settle time), inside our settle + 2 h 15 min.
      //     Before it: re-signs keep start = now (inside its ±10 min window), same duration, exp <= settle + 2 h 15 min.
      //     At it: rejected:external_approval_timeout ends the hold; the next sweep (cron every 5 min) expires the
      //     order with ONE full refund, before our own 2 h 15 min deadline. No re-sign after the rejection.
      const md = mk({ lightningEnabled: false, pilot: true });
      const cd = (await createRental(md.d, { ...held, idempotency_key: idem() }) as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
      const paidD = md.store.bindings.get(cd.payment.paymentRef)!.expectedAtomic, TD = md.d.now(), blockTime = TD - 4_000;
      md.x.simulatePay(cd.payment.paymentRef, paidD, TD);
      await confirmPayment(md.d, cd.payment.paymentRef);
      const nodeDeadline = blockTime + 2 * 3_600_000;
      assert.ok(nodeDeadline < TD + pools.HELD_TIMEOUT_MS, "node deadline is inside ours");
      while (md.d.now() + 5 * 60_000 < nodeDeadline) { md.tick(5 * 60_000); await svc.sweepExpired(md.d); }
      const routesD = () => md.store.jobs.filter((j) => j.payload.order_ref === cd.rentalId && j.payload.action === "route");
      const durD = routesD()[0].payload.end - routesD()[0].payload.start;
      for (const j of routesD()) {
        assert.ok(Math.abs(j.payload.start - j.payload.iat) <= 600, "start within ±10 min of signing");
        assert.equal(j.payload.end - j.payload.start, durD, "same duration");
        assert.ok(j.payload.exp * 1000 <= TD + pools.HELD_TIMEOUT_MS, "exp inside our deadline");
        assert.ok(j.payload.start * 1000 >= blockTime, "node base = min(block time, start, iat) stays the block time");
      }
      assert.equal((await md.store.getOrderByPublicId(cd.rentalId))!.state, "delivering", "still held before the node deadline");
      md.tick(nodeDeadline - md.d.now());
      await md.store.recordResult({ jobId: routesD().at(-1)!.payload.job_id, orderRef: cd.rentalId, result: "rejected", reason: "external_approval_timeout", deliveredTh: null, at: md.d.now() });
      const nD = routesD().length;
      md.tick(5 * 60_000); await svc.sweepExpired(md.d);
      const od = (await md.store.getOrderByPublicId(cd.rentalId))!;
      assert.equal(od.state, "expired_unapplied", "expired on the next sweep after the node timeout");
      assert.ok(md.d.now() < TD + pools.HELD_TIMEOUT_MS, "before our own deadline");
      assert.equal(routesD().length, nD, "no re-sign after the timeout rejection");
      assert.equal(refundsOf(md, od.id).length, 1); assert.equal(refundsOf(md, od.id)[0].atomic, paidD, "one full refund");
      await sweepN(md, 10, 10 * 60_000);
      assert.equal(refundsOf(md, od.id).length, 1, "still one refund after more sweeps");
      const sd = (await svc.getRentalStatus(md.d, { rental_id: cd.rentalId, creator_secret: cd.creatorSecret })) as { result: { rejectedReason: string; refundDue: boolean } };
      assert.equal(sd.result.rejectedReason, "external_approval_timeout"); assert.equal(sd.result.refundDue, true);
    }

    // Migration: additive, widens the result check with pending_approval only, never touches pricing_daily.
    const mig = readFileSync(join(__dirname, "../supabase/migrations/20261017000000_phase2_pending_approval_result.sql"), "utf8").replace(/^--.*$/gm, "");
    assert.match(mig, /check \(result in \('applied','rejected','reverted','delivered','pending_approval'\)\)/);
    assert.ok(!/pricing_daily|drop table|drop column|delete from|update public\./i.test(mig), "additive only");
    // Review #89 S3: no IF EXISTS (a wrong name fails loudly), short lock timeout, exact constraint name.
    assert.ok(!/if exists/i.test(mig), "drop constraint without if exists");
    assert.match(mig, /set local lock_timeout = '5s';[\s\S]*drop constraint rental_job_results_result_check;/);
  }

  // payment.network comes from config: mainnet config signs eip155:8453, staging signs eip155:84532.
  {
    const { X402Provider, x402Net } = await import("../src/lib/rentals/phase2/x402");
    const MNENV = { RENTALS_PHASE2_ENABLED: "1", RENTALS_PHASE2_MODE: "mainnet", RENTALS_MAINNET_ENABLED: "1", RENTALS_X402_NETWORK: "mainnet", RENTALS_MAINNET_ACK: "i-authorize-mainnet-1-dollar-test", CDP_API_KEY_ID: "k", CDP_API_KEY_SECRET: "s" };
    const mainNet = new X402Provider({ net: x402Net(MNENV), payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://x", store: new MemoryStore(), cdp: { keyId: "k", secret: "s" } }).caip2;
    const stageNet = new X402Provider({ net: x402Net({}), payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://x", store: new MemoryStore() }).caip2;
    assert.deepEqual([mainNet, stageNet], ["eip155:8453", "eip155:84532"]);
    for (const [net, want] of [[mainNet, "eip155:8453"], [stageNet, "eip155:84532"], [undefined, "eip155:84532"]] as const) {
      const m = mk({ lightningEnabled: false, pilot: true, payNetwork: net });
      const q = await (await import("../src/lib/rentals/phase2/service")).getQuote(m.d, { rigs: 1, days: 1 }) as unknown as { result: { payment: { network: string } } };
      assert.equal(q.result.payment.network, want, "get_quote network from config");
      const cr = (await createRental(m.d, { ...base, rail: undefined, idempotency_key: idem() }) as unknown as { result: { payment: { paymentRef: string } } }).result;
      m.x.simulatePay(cr.payment.paymentRef, m.store.bindings.get(cr.payment.paymentRef)!.expectedAtomic, m.d.now());
      await confirmPayment(m.d, cr.payment.paymentRef);
      const job = m.store.jobs.find((j) => j.payload.action === "route")!;
      assert.equal(job.payload.payment!.network, want, `signed job network = ${want}`);
      assert.deepEqual(verifyJob(job, vo({ t1: PUB }, job.payload.iat + 1)), { ok: true }, "and it verifies");
    }
    // Guard: no Sepolia constants in any rental source outside the x402.ts network config (case-insensitive).
    const { readdirSync, statSync } = await import("node:fs");
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
    const files = [...walk(join(__dirname, "../src/lib/rentals")), ...walk(join(__dirname, "../src/app/api/rentals"))].filter((p) => !p.endsWith("/phase2/x402.ts"));
    assert.ok(files.some((p) => p.endsWith("test-order.ts")) && files.some((p) => p.endsWith("store-supabase.ts")) && files.some((p) => p.includes("/api/rentals/pay/")), "guard covers test-order, store-supabase, api/rentals/**");
    for (const p of files) assert.ok(!/84532|0x14a34|036cbd53842c5426634e7929541ec2318f3dcf7e/i.test(readFileSync(p, "utf8").replace(/^\s*(\*|\/\/).*$/gm, "")), "no hard-coded Sepolia constant in " + p);
  }

  // Mainnet BTC/USD: live Coinbase+Kraken cross-check, refuse >4%; mainnet refuses unsafe deps.
  {
    const bx = await import("../src/lib/rentals/phase2/btcusd");
    assert.equal(bx.crossCheck(60000, 61000), 61000, "max(Coinbase, Kraken)");
    assert.throws(() => bx.crossCheck(60000, 62500), /rate_divergence/, ">4% refused");
    assert.throws(() => bx.crossCheck(0, 60000), /rate_unavailable/);
    let calls = 0; let kr = "61000.5";
    const ff = (async (u: string) => { calls++; return new Response(JSON.stringify(String(u).includes("coinbase") ? { data: { amount: "60500.10" } } : { error: [], result: { XXBTZUSD: { c: [kr, "1"] } } })); }) as unknown as typeof fetch;
    let t = 0; const live = bx.liveBtcUsd(ff, () => t);
    assert.equal(await live(), 61000.5); assert.equal(await live(), 61000.5); assert.equal(calls, 2, "cached 30s");
    t = 31_000; kr = "70000"; await assert.rejects(live(), /rate_divergence/, "divergent live feeds fail closed");
    const ffDown = (async () => new Response("x", { status: 503 })) as unknown as typeof fetch;
    await assert.rejects(bx.liveBtcUsd(ffDown)(), /http_503/);
    // sanity range 1,000..10,000,000 per feed
    assert.throws(() => bx.crossCheck(999, 1000), /rate_unavailable/); assert.throws(() => bx.crossCheck(10_000_001, 10_000_000), /rate_unavailable/);
    assert.equal(bx.crossCheck(1000, 1000), 1000); assert.equal(bx.crossCheck(10_000_000, 10_000_000), 10_000_000);
    // failures cached 20 s; one shared in-flight request
    { let n = 0, up = false, t2 = 0;
      const fx = (async (u: string) => { n++; await new Promise((r) => setTimeout(r, 5)); if (!up) return new Response("x", { status: 502 }); return new Response(JSON.stringify(String(u).includes("coinbase") ? { data: { amount: "60000" } } : { error: [], result: { X: { c: ["60100", "1"] } } })); }) as unknown as typeof fetch;
      const lv = bx.liveBtcUsd(fx, () => t2);
      await assert.rejects(lv(), /http_502/); const n1 = n;
      up = true; t2 = 19_000; await assert.rejects(lv(), /http_502/, "failure cached"); assert.equal(n, n1, "no refetch within 20 s");
      t2 = 20_001; const [x1, x2, x3] = await Promise.all([lv(), lv(), lv()]);
      assert.deepEqual([x1, x2, x3], [60100, 60100, 60100]); assert.equal(n, n1 + 2, "concurrent callers share one request pair"); }

    // Shared USDC formula vs the real node accept rule (gm-price.mjs):
    //   Node: min per rig-day = ceil(0.27 x floor x Coinbase x 1.03 x 1e6); accept amount > min x n - n.
    //   Website: charge_btc = max(ask x 0.985, floor x 1.03); USDC = ceil_cent(charge_btc x max(CB,Kraken)).
    //   The x1.03 applies only to the floor term. Cross-check always uses floor + Coinbase.
    {
      const pr = await import("../src/lib/rentals/phase2/pricing");
      const svc = await import("../src/lib/rentals/phase2/service");
      const RIG_PH = 0.27, BUFFER = 1.03;
      const minAtomicPerRigDay = (floor: number, coinbase: number) => Math.ceil(RIG_PH * floor * coinbase * BUFFER * 1e6);
      const nodeMinOk = (amountAtomic: number, minPerRigDay: number, rigs: number, days: number) => {
        const n = BigInt(rigs) * BigInt(days);
        return BigInt(amountAtomic) > BigInt(minPerRigDay) * n - n;
      };
      // converter has no built-in 1.03; 0.00052 x 82060 = 42.6712 -> $42.68
      assert.equal(Number(pr.usdcPerPhDayCents(0.00052, 82060)), 4268, "0.00052 x 82060 = 42.6712 -> $42.68");
      assert.equal(pr.usdcAtomicFor(0.00052, 82060, 270, 1), 11_523_600, "$42.68 x 0.27 PH x 1 day = $11.5236");
      for (const [floor, cb, kr, rigs, days] of [[0.00052, 82060, 81990.5, 1, 1], [0.00048123, 82060.01, 82100, 4, 7], [0.0006, 60000, 61000, 2, 3], [0.00000001, 99999.99, 99999.99, 1, 1]] as const) {
        const px = bx.crossCheck(cb, kr), th = rigs * 270;
        // ceil_sat(floor x 1.03) charge clears node on that same floor.
        const ours = pr.usdcAtomicFor(pr.floorTermSats(floor) / 1e8, px, th, days);
        assert.ok(nodeMinOk(ours, minAtomicPerRigDay(floor, cb), rigs, days), `ours ${ours} clears node floor x Coinbase`);
        assert.equal(ours % 100, 0, "whole cents");
      }
      assert.throws(() => pr.usdcAtomicFor(0, 82060, 270, 1)); assert.throws(() => pr.usdcAtomicFor(0.0005, NaN, 270, 1));
      // Review regression: toFixed(8) on floor x 1.03 rounded DOWN and undershot node
      {
        const floor = 0.00073448, cb = 122905.92, rigs = 2, days = 1;
        const charge = pr.floorTermSats(floor) / 1e8;
        assert.ok(charge >= Math.ceil(floor * 1.03 * 1e8) / 1e8 - 1e-15, "charge_btc >= ceil(floor x 1.03)");
        const atomic = pr.usdcAtomicFor(charge, cb, rigs * 270, days);
        assert.ok(atomic >= 50_209_252, `regression charge ${atomic} >= 50209252`);
        assert.ok(nodeMinOk(atomic, minAtomicPerRigDay(floor, cb), rigs, days), "regression clears node");
        // the broken toFixed path must NOT be what we charge
        const broken = Number((floor * 1.03).toFixed(8));
        assert.ok(pr.usdcAtomicFor(broken, cb, rigs * 270, days) < 50_209_252, "toFixed(8) path still undershoots (documents the bug)");
      }
      // Seeded 50k fuzz: both branches, zero node shortfalls
      {
        let seed = 0xc0ffee ^ 76;
        const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
        let askWins = 0, floorWins = 0, shortfalls = 0;
        for (let i = 0; i < 50_000; i++) {
          const floor = Math.round((0.0001 + rnd() * 0.0015) * 1e8) / 1e8;
          const ask = Math.round(floor * (0.5 + rnd() * 2.4) * 1e8) / 1e8; // 0.5x..2.9x floor (inside 3x band)
          const cb = 40_000 + rnd() * 120_000;
          const kr = cb * (0.98 + rnd() * 0.04);
          const rigs = 1 + (seed % 4);
          const days = 1 + (seed % 7);
          const px = bx.crossCheck(cb, kr);
          const chargeS = pr.chargeSatsPhDay(ask, floor);
          const ft = pr.floorTermSats(floor);
          assert.ok(chargeS >= ft, "charge sats >= ceil_sat(floor x 1.03)");
          if (chargeS === pr.askTermSats(ask) && chargeS > ft) askWins++; else floorWins++;
          const atomic = pr.usdcAtomicFor(chargeS / 1e8, px, rigs * 270, days);
          if (!nodeMinOk(atomic, minAtomicPerRigDay(floor, cb), rigs, days)) shortfalls++;
        }
        assert.equal(shortfalls, 0, "50k fuzz: zero node shortfalls");
        assert.ok(askWins > 1000 && floorWins > 1000, `both branches exercised (ask=${askWins}, floor=${floorWins})`);
      }
      // paid jobs charge on charge_btc and still clear node on the signed floor
      const m = mk({ lightningEnabled: false, pilot: true });
      const cr = (await createRental(m.d, { ...base, rail: undefined, idempotency_key: idem() }) as unknown as { result: { payment: { paymentRef: string; http402: { amount: string } } } }).result;
      const ord = [...m.store.orders.values()].pop()!;
      assert.equal(Number(cr.payment.http402.amount), pr.usdcAtomicFor(ord.priceBtcPhDay, await m.d.btcUsd(), ord.th, ord.days), "create_rental charges ceil_cent(charge_btc x px)");
      assert.ok(ord.priceBtcPhDay >= pr.floorTermSats(ord.floorBtcPhDay) / 1e8 - 1e-15);
      assert.ok(nodeMinOk(Number(cr.payment.http402.amount), minAtomicPerRigDay(ord.floorBtcPhDay, await m.d.btcUsd()), ord.rigCount, ord.days), "charged amount clears node on floor");
      // ask above floor: ask x 0.985 wins (1.5% below ask); no extra 1.03 on the ask term
      {
        const ask = 0.00060, floor = 0.00050; // ask x 0.985 = 0.000591 > ceil_sat(floor x 1.03) = 0.000515
        const row = { marketAskBtcPhDay: ask, floorBtcPhDay: floor, hashpriceSatsThDay: 40, writtenAt: T0 - 3600_000 };
        const m2 = mk({ lightningEnabled: false, pilot: true, pricing: async () => row, btcUsd: async () => 80000 });
        const po = pr.priceOrder(row, 270, 1, T0);
        assert.ok(po.ok && po.priceBtcPhDay === pr.askTermSats(ask) / 1e8, "ask x 0.985 wins (1.5% below ask)");
        const q = (await svc.getQuote(m2.d, { rigs: 1, days: 1 }) as unknown as { result: Record<string, unknown> }).result;
        assert.equal(q.priceBasis, "max_ask0.985_floor_x_1.03_min");
        assert.equal(Number(q.pricePerPhDayBtc), pr.askTermSats(ask) / 1e8);
        assert.equal(Math.round(Number(q.totalUsdc) * 1e6), pr.usdcAtomicFor(pr.askTermSats(ask) / 1e8, 80000, 270, 1));
        assert.ok(nodeMinOk(pr.usdcAtomicFor(po.priceBtcPhDay, 80000, 270, 1), minAtomicPerRigDay(floor, 80000), 1, 1));
      }
      // ask below floor: ceil_sat(floor x 1.03) wins
      {
        const ask = 0.00040, floor = 0.00050; // ask x 0.985 = 0.000394 < ceil_sat(floor x 1.03)
        const row = { marketAskBtcPhDay: ask, floorBtcPhDay: floor, hashpriceSatsThDay: 40, writtenAt: T0 - 3600_000 };
        const m2 = mk({ lightningEnabled: false, pilot: true, pricing: async () => row, btcUsd: async () => 80000 });
        const po = pr.priceOrder(row, 270, 2, T0);
        // B1: the listing minimum (DEFAULT_MIN_BTC_PH_DAY) is a third lower bound; here it sits above floor x 1.03.
        const expS = Math.max(pr.floorTermSats(floor), pr.minTermSats(pr.DEFAULT_MIN_BTC_PH_DAY));
        assert.ok(po.ok && po.priceBtcPhDay === expS / 1e8, "max(ceil_sat(floor x 1.03), listing min) wins over low ask");
        const q = (await svc.getQuote(m2.d, { rigs: 1, days: 2 }) as unknown as { result: Record<string, unknown> }).result;
        assert.equal(q.priceBasis, "max_ask0.985_floor_x_1.03_min");
        assert.equal(Number(q.pricePerPhDayBtc), expS / 1e8);
        assert.equal(Math.round(Number(q.totalUsdc) * 1e6), pr.usdcAtomicFor(expS / 1e8, 80000, 270, 2));
        assert.ok(nodeMinOk(pr.usdcAtomicFor(po.priceBtcPhDay, 80000, 270, 2), minAtomicPerRigDay(floor, 80000), 1, 2));
      }
      // ask just under 3x floor: allowed; just over: refused on quote and create
      {
        const floor = 0.00050;
        const underAsk = floor * 3; // exactly 3x
        const overAsk = floor * 3 + 1e-12;
        const underRow = { marketAskBtcPhDay: underAsk, floorBtcPhDay: floor, hashpriceSatsThDay: 40, writtenAt: T0 - 3600_000 };
        const overRow = { ...underRow, marketAskBtcPhDay: overAsk };
        const mUnder = mk({ lightningEnabled: false, pilot: true, pricing: async () => underRow, btcUsd: async () => 80000 });
        const mOver = mk({ lightningEnabled: false, pilot: true, pricing: async () => overRow, btcUsd: async () => 80000 });
        assert.ok((await svc.getQuote(mUnder.d, { rigs: 1, days: 1 })).ok, "ask == 3x floor: quote ok");
        const qOver = await svc.getQuote(mOver.d, { rigs: 1, days: 1 });
        assert.equal((qOver as { error: string }).error, "ask_out_of_band", "ask just over 3x: quote refused");
        assert.match((qOver as { message: string }).message, /3x the floor/);
        const cOver = await createRental(mOver.d, { ...base, rail: undefined, idempotency_key: idem() });
        assert.equal((cOver as { error: string }).error, "ask_out_of_band", "ask just over 3x: create refused");
        assert.equal(mOver.store.orders.size, 0, "no order on ask_out_of_band");
      }
    }
    const { mainnetRefusal, OutboxOnlyAlerter } = await import("../src/lib/rentals/phase2/staging");
    const { SupabaseStore } = await import("../src/lib/rentals/phase2/store-supabase");
    const { NtfyAlerter } = await import("../src/lib/rentals/phase2/safety");
    const env = { RENTALS_JOB_SIGNING_KID: "prod-1" };
    const good = { ...mk({}).d, store: new SupabaseStore("https://x.supabase.co", "k"), alerter: new NtfyAlerter("https://n"), signingKid: "prod-1", payNetwork: "eip155:8453", jobEnv: "mainnet" as const };
    assert.equal(mainnetRefusal(good, env), null, "real deps pass");
    assert.equal(mainnetRefusal({ ...good, store: new MemoryStore() }, env), "memory_store");
    assert.equal(mainnetRefusal({ ...good, alerter: new MockAlerter() }, env), "mock_alerter");
    assert.equal(mainnetRefusal({ ...good, signingKid: "staging-preview-1" }, env), "staging_kid");
    assert.equal(mainnetRefusal(good, {}), "staging_kid", "kid must be set explicitly");
    assert.equal(mainnetRefusal({ ...good, payNetwork: undefined }, env), "sepolia_network");
    assert.equal(mainnetRefusal({ ...good, alerter: new OutboxOnlyAlerter() }, env), "outbox_forwarder_not_ready", "outbox alone refused");
    assert.equal(mainnetRefusal({ ...good, alerter: new OutboxOnlyAlerter() }, { ...env, RENTALS_OUTBOX_FORWARDER_READY: "1" }), null, "outbox + forwarder ready ok");
    // cron: authorized + phase2 off -> 200 skipped; unauthorized still 401
    { const keep = { ...process.env }; delete process.env.RENTALS_PHASE2_ENABLED; process.env.CRON_SECRET = "cron-test-secret-1234567890";
      const { GET } = await import("../src/app/api/rentals/sweep/route");
      const ok = await GET(new Request("https://x/api/rentals/sweep", { headers: { authorization: "Bearer cron-test-secret-1234567890" } }));
      assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { ok: true, skipped: "phase2_off" });
      assert.equal((await GET(new Request("https://x/api/rentals/sweep"))).status, 401);
      process.env = keep; }
    // get_quote: BTC/sats/USDC on charge_btc; totalSats reused from priceOrder (no separate 1e-6 recompute)
    { const m = mk({ lightningEnabled: false, pilot: true });
      const q = (await (await import("../src/lib/rentals/phase2/service")).getQuote(m.d, { rigs: 2, days: 3 }) as unknown as { result: Record<string, unknown> }).result;
      const charge = Number(q.pricePerPhDayBtc), ph = 0.54;
      assert.equal(q.priceBasis, "max_ask0.985_floor_x_1.03_min");
      const po = priceOrder(PRICING, 540, 3, T0);
      assert.ok(po.ok);
      assert.equal(q.totalSats, po.totalSats, "get_quote totalSats equals priceOrder totalSats");
      assert.ok(Math.abs(Number(q.pricePerPhDayUsdc) - charge * Number(q.btcUsd)) < 0.011, "USDC per PH-day = charge_btc x BTC/USD (cent ceil)");
      assert.equal(Number(q.totalUsdc), Number((Number(q.pricePerPhDayUsdc) * ph * 3).toFixed(6)), "totalUsdc = per PH-day x PH x days");
      // default PRICING: ceil_sat(floor x 1.03) > ask x 0.985
      const { floorTermSats: fts, minTermSats: mts, DEFAULT_MIN_BTC_PH_DAY: dmin } = await import("../src/lib/rentals/phase2/pricing");
      assert.equal(charge, Math.max(fts(PRICING.floorBtcPhDay), mts(dmin)) / 1e8, "quote basis = max(ceil_sat(floor x 1.03), listing min) on default PRICING"); }
    assert.equal(mainnetRefusal({ ...good, payNetwork: "eip155:84532" }, env), "sepolia_network");
    const stagingSrc = readFileSync(join(__dirname, "../src/lib/rentals/phase2/staging.ts"), "utf8");
    assert.match(stagingSrc, /btcUsd: mainnetEnabled\(env\) \? liveBtcUsd\(\)/, "mainnet never reads RENTALS_PHASE2_STAGING_BTCUSD");
  }

  // alert forwarder: gm_node-only SECURITY DEFINER pair, search_path='', no table grants
  {
    const af = readFileSync(join(__dirname, "../supabase/migrations/20261016250000_phase2_alert_forwarder.sql"), "utf8");
    assert.match(af, /function public\.rental_alerts_pending\(p_limit int default 50\)\s+returns table \(id bigint, kind text, order_ref text\)/);
    assert.match(af, /where a\.forwarded_at is null\s+order by a\.at, a\.id/, "unforwarded, oldest first");
    assert.match(af, /function public\.rental_alerts_mark_forwarded\(p_ids bigint\[\]\)/);
    assert.match(af, /set forwarded_at = now\(\)/);
    assert.equal((af.match(/security definer set search_path = ''/g) ?? []).length, 2);
    assert.equal((af.match(/revoke all on function [^;]+ from public, anon, authenticated;/g) ?? []).length, 2);
    assert.equal((af.match(/grant execute on function [^;]+ to gm_node;/g) ?? []).length, 2);
    assert.ok(!/grant (select|insert|update|delete|all)[^;]* on (table )?public\./i.test(af), "no direct table grants");
    assert.ok(!/pricing_daily/.test(af.replace(/^--.*$/gm, "")), "pricing_daily untouched");
    assert.match(af, /add column if not exists forwarded_at/);
  }

  // canonicalization is order-independent and rejects floats
  assert.equal(canonicalize({ b: 1, a: { d: "x", c: null } }), '{"a":{"c":null,"d":"x"},"b":1}');
  assert.throws(() => canonicalize({ a: 1.5 }));

  console.log("test-phase2-rentals: all paths ok");
}
main().catch((e) => { console.error(e); process.exit(1); });
