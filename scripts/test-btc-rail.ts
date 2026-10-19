/**
 * BTC on-chain rail (site side): vectors from test-vectors-v3.1-build.json (scripts/fixtures copy) + end-to-end flows on the
 * memory stores. PLAN v3.1 + security review Fixes 1-7 + §18. Run: npx tsx scripts/test-btc-rail.ts
 */
import { TEST_PAYTO_EVM as PINNED_PAYTO, TEST_PAYTO_SOLANA as PINNED_SOLANA_PAYTO, TEST_PAYTO_PINS } from "./lib/test-payto";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MemoryStore, StaleVersion } from "../src/lib/rentals/phase2/store";
import { MockProvider } from "../src/lib/rentals/phase2/providers";
import { MockAlerter } from "../src/lib/rentals/phase2/safety";
import { createRental, getRentalStatus, cancelRental, sweepExpired, reofferOrExpire, confirmPayment, refundRow, btcHeldRigs, BAY_TAKEN_MRR, type Deps } from "../src/lib/rentals/phase2/service";
import { RENTAL_TERMS_VERSION } from "../src/lib/rentals/phase2/terms";
import { verifyJob, schemaOk, signJob, applyKey, type JobPayload, type BtcJobPayment, type NonceLedger } from "../src/lib/rentals/phase2/jobs";
import { POOL_HOST_SUFFIXES, POOL_PORTS } from "../src/lib/rentals/phase2/validate";
import { MAX_TERM_SEC } from "../src/lib/rentals/phase2/pricing";
import { X402Provider, BASE_SEPOLIA } from "../src/lib/rentals/phase2/x402";
import { minSat, askSat, requiredConfs, floorRule, btcDeadline, quoteBtc, btcStrToSats, satsToBtcStr, type FloorHistory, type BtcPricingRow } from "../src/lib/rentals/phase2/btc/quote";
import { parseDescriptor, deriveReceive, descriptorChecksum } from "../src/lib/rentals/phase2/btc/hd";
import { checkDescriptor, btcConfig, STAGING_TEST_DESCRIPTOR, BTC_PINS, BTC_ATTEST_KEYS } from "../src/lib/rentals/phase2/btc/config";
import { BTC_MAINNET_NETWORK, BTC_SIGNET_NETWORK } from "../src/lib/rentals/phase2/btc/networks";
import { signEnvelope, verifyEnvelope, BTC_MAX_OUTPOINTS, type EnvelopePayload } from "../src/lib/rentals/phase2/btc/envelope";
import { MemoryBtcStore } from "../src/lib/rentals/phase2/btc/store";
import { createBtcBinding, btcStatus, processBtcEvents, sweepBtc, btcAvailability, firstDisplay, heartbeatState, btcOffer, BTC_MAX_DAYS, STUCK_EVENT_MS, STUCK_EVENT_ATTEMPTS, BTC_STALL_MS } from "../src/lib/rentals/phase2/btc/service";
import { handleBtcBind, handleBtcStatus } from "../src/lib/rentals/phase2/btc/human";
import { assertCustomerSafe } from "../src/lib/rentals";
import { MAINNET_ACK } from "../src/lib/rentals/phase2/flag";
import { leaksNeverReveal } from "./lib/never-reveal-test";

const V = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/btc-vectors-v3.1-build.json"), "utf8"));
const ms = (s: string) => Date.parse(s);
let passed = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); passed++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); passed++; };

// ── 1. integer pricing (S1-S11) ─────────────────────────────────────────────────────────────────────────────────────
for (const s of V.sats) {
  if (s.min_sat !== undefined) eq(Number(minSat(s.F, s.rigs, s.days)), s.min_sat, `${s.id} min_sat`);
  if (s.ask_sat !== undefined) {
    eq(Number(askSat(s.A, s.rigs, s.days)), s.ask_sat, `${s.id} ask_sat`);
    const amt = [askSat(s.A, s.rigs, s.days), minSat(s.F, s.rigs, s.days)].reduce((a, b) => (a > b ? a : b));
    eq(Number(amt), s.amount_sat, `${s.id} amount = max`);
  }
  if (s.required_confs !== undefined && s.amount_sat !== undefined) eq(requiredConfs(s.amount_sat), s.required_confs, `${s.id} confs`);
  if (s.paid !== undefined) {
    const r = floorRule({ role: "poller", quoteAt: ms("2026-10-17T15:00:00Z"), floorDay: "2026-10-16", fSigned: s.F, now: ms("2026-10-17T15:10:00Z"),
      history: { "2026-10-16": [{ F: s.F, first_seen_at: "2026-10-16T13:12:00Z" }] }, amountSat: s.paid, rigs: s.rigs, days: s.days });
    eq(r.result, s.expect, `${s.id} step 6`);
  }
}
eq(btcStrToSats("0.00051551"), BigInt(51551), "8dp -> sats"); eq(btcStrToSats("0.0005155"), BigInt(51550), "7dp pads"); eq(btcStrToSats("5e-4"), null, "no exponent");
eq(btcStrToSats("0.000515511"), null, "9dp refused"); eq(satsToBtcStr(BigInt(51551)), "0.00051551", "sats -> 8dp");

// ── 2. floor rule (F1-F18, A1-A2) ───────────────────────────────────────────────────────────────────────────────────
for (const f of V.floor) {
  const history = (f.history_override ?? V.floor_history) as FloorHistory | "UNREADABLE";
  const amt = f.paid !== undefined ? { amountSat: f.paid, rigs: f.rigs, days: f.days } : {};
  for (const role of ["agent", "poller"] as const) {
    const r = floorRule({ role, quoteAt: ms(f.quote_at), floorDay: f.floor_day, fSigned: f.F_signed, now: ms(role === "agent" ? f.agent_now : f.poller_now), history, ...amt });
    eq(r.result, role === "agent" ? f.expect_agent : f.expect_poller, `${f.id} ${role}`);
    if (f.expect_ntfy && r.result !== "refuse:floor_history_unavailable" && r.result !== "defer:floor_history_unavailable") eq(r.ntfy, f.expect_ntfy, `${f.id} ${role} ntfy`);
  }
}
for (const a of V.agent_skew) {
  const r = floorRule({ role: "agent", quoteAt: ms(a.quote_at), floorDay: a.floor_day ?? "2026-10-17", fSigned: a.F_signed ?? 52000, now: ms(a.agent_now), history: V.floor_history });
  eq(r.result, a.expect_agent, `${a.id}`);
}
// ── 3. P6 deadline (D1-D3) ─────────────────────────────────────────────────────────────────────────────────────────
for (const x of V.deadline_p6) {
  let dl = btcDeadline(ms(x.signed_start), ms(x.first_seen_job_iat));
  if (x.reoffer_iat) dl = btcDeadline(ms(x.signed_start), ms(x.reoffer_iat), dl);
  eq(new Date(dl).toISOString().replace(".000", ""), x.expect_deadline, `${x.id}`);
}

// ── 4. derivation + descriptor boot pins ────────────────────────────────────────────────────────────────────────────
const TD = checkDescriptor(STAGING_TEST_DESCRIPTOR, "staging");
assert.ok(TD.ok, "staging test descriptor passes the pins");
const DESC = TD.d;
const TADDR: Record<number, string> = { 0: "tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl", 1: "tb1qd7spv5q28348xl4myc8zmh983w5jx32cjhkn97", 2: "tb1qxdyjf6h5d6qxap4n2dap97q4j5ps6ua8sll0ct", 7: "tb1qfsryn6hh2yhpxpp7m9dh54x89wettyfk45jn6y", 1000: "tb1qzp43qjl6t0yfpyjmhvlfc8h4emlf8e9tldz09s" };
for (const [i, a] of Object.entries(TADDR)) eq(deriveReceive(DESC, Number(i)), a, `tpub /0/${i}`);
eq(descriptorChecksum("raw(deadbeef)"), "89f8spxm", "BIP380 checksum vector");
{
  const body = STAGING_TEST_DESCRIPTOR.split("#")[0];
  eq(checkDescriptor(body, "staging").ok, false, "no checksum refused");
  eq(checkDescriptor(body + "#aaaaaaaa", "staging").ok, false, "wrong checksum refused");
  const otherFp = body.replace("73c5da0a", "deadbeef");
  eq(checkDescriptor(otherFp + "#" + descriptorChecksum(otherFp), "staging").ok, false, "wrong fingerprint refused");
  // The real mainnet descriptor is env-only (BTC_ONCHAIN_DESCRIPTOR); its pins are in source. Tests use the PUBLIC BIP84
  // test vector (mnemonic "abandon … about", m/84'/0'/0', fingerprint 73c5da0a) and inject its pins.
  const nk = "wpkh([73c5da0a/84'/0'/0']xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V/0/*)";
  const nkp = parseDescriptor(nk + "#" + descriptorChecksum(nk));
  eq(nkp.ok, true, "BIP84 vector descriptor parses");
  if (nkp.ok) {
    eq(nkp.d.fingerprint, "73c5da0a", "BIP84 vector fingerprint");
    eq(nkp.d.path, "84h/0h/0h", "path m/84'/0'/0'");
    eq(nkp.d.keyVersion, "xpub", "an xpub (no SLIP-132 conversion)");
    eq(deriveReceive(nkp.d, 0), "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "BIP84 vector m/84'/0'/0'/0/0");
    eq(deriveReceive(nkp.d, 1), "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g", "BIP84 vector m/84'/0'/0'/0/1");
  }
  const ENV_DESC = nk + "#wc3n3van";
  eq(descriptorChecksum(nk), "wc3n3van", "BIP380 checksum of the apostrophe form");
  const envPins = { fingerprint: "73c5da0a", checksum: "wc3n3van", addrSha256: [
    "9fccb3234066f7b5e1d029d019390324abd980d45a5d10f12610ca4a8e949400",
    "0eb066812962c2bdf5237717179a2a7345ea46717049a521459d3f374c649e27",
    "93a37fc0c4716a5a5f9810eef66639207ab9f7c9c6467f9ad95be660baca1826",
  ] as const };
  const mp = BTC_PINS.mainnet;
  ok(mp === null, "export copy: no mainnet wallet pinned");
  eq((checkDescriptor(ENV_DESC, "mainnet") as { error: string }).error, "btc_pins_unset", "with no mainnet pins every descriptor is refused on mainnet");
  eq(checkDescriptor(ENV_DESC, "mainnet", envPins).ok, true, "matching pins accept the descriptor (fp, checksum, /0/0-/0/2)");
  const hForm = nk.replace(/'/g, "h");
  eq((checkDescriptor(hForm + "#" + descriptorChecksum(hForm), "mainnet", envPins) as { error: string }).error, "btc_pin_checksum", "h form refused on mainnet (pin is the apostrophe text)");
  eq((checkDescriptor(STAGING_TEST_DESCRIPTOR, "mainnet", envPins) as { error: string }).error, "btc_profile_mismatch", "staging descriptor never boots mainnet");
  eq(descriptorChecksum(nk) === descriptorChecksum(nk.replace(/'/g, "h")), false, "h vs ' notation changes the checksum (pin the exact env text)");
  eq(Object.keys(BTC_ATTEST_KEYS.mainnet).length + Object.keys(BTC_ATTEST_KEYS.staging).length, 0, "no attestation key in source yet (fail closed)");
  eq(parseDescriptor(body).ok, false, "parser requires a checksum");
}
const { privateKey: AK, publicKey: AP } = crypto.generateKeyPairSync("ed25519");
const APRIV = AK.export({ type: "pkcs8", format: "pem" }).toString(), APUB = AP.export({ type: "spki", format: "pem" }).toString();
const KEYS = { k1: APUB };
const ENV_ON = { RENTALS_BTC_ONCHAIN_ENABLED: "1", TURNSTILE_SECRET_KEY: "x", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-k", BTC_ONCHAIN_DESCRIPTOR: STAGING_TEST_DESCRIPTOR };
eq(btcConfig({}).ok, false, "flag off");
eq((btcConfig(ENV_ON) as { error: string }).error, "btc_no_attest_key", "no pinned key -> refuses");
eq((btcConfig({ ...ENV_ON, TURNSTILE_SECRET_KEY: "" }, { keys: KEYS }) as { error: string }).error, "btc_turnstile_unset", "Turnstile required");
eq(btcConfig({ ...ENV_ON, BTC_ONCHAIN_DESCRIPTOR: undefined }, { keys: KEYS }).ok, false, "descriptor required");
{
  const MAIN = { ...ENV_ON, RENTALS_PHASE2_MODE: "mainnet", RENTALS_MAINNET_ENABLED: "1", RENTALS_X402_NETWORK: "mainnet", RENTALS_MAINNET_ACK: MAINNET_ACK, CDP_API_KEY_ID: "x", CDP_API_KEY_SECRET: "y" };
  const MDESC = "wpkh([73c5da0a/84'/0'/0']xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V/0/*)#wc3n3van";
  const MPINS = { fingerprint: "73c5da0a", checksum: "wc3n3van", addrSha256: ["9fccb3234066f7b5e1d029d019390324abd980d45a5d10f12610ca4a8e949400", "0eb066812962c2bdf5237717179a2a7345ea46717049a521459d3f374c649e27", "93a37fc0c4716a5a5f9810eef66639207ab9f7c9c6467f9ad95be660baca1826"] as const };
  eq((btcConfig(MAIN) as { error?: string }).error, "btc_no_attest_key", "mainnet still fails closed: attest PEM pending");
  eq((btcConfig({ ...MAIN, BTC_ONCHAIN_DESCRIPTOR: MDESC }, { keys: KEYS }) as { error?: string }).error, "btc_pins_unset", "mainnet refuses every descriptor while no mainnet wallet is pinned (export copy)");
  eq((btcConfig(MAIN, { keys: KEYS, pins: MPINS }) as { error?: string }).error, "btc_profile_mismatch", "mainnet refuses the staging descriptor");
  eq(btcConfig({ ...MAIN, BTC_ONCHAIN_DESCRIPTOR: MDESC }, { keys: KEYS, pins: MPINS }).ok, true, "mainnet boots only with a descriptor matching the pins + a key");
  eq((btcConfig({ ...ENV_ON, VERCEL_ENV: "production" }, { keys: KEYS }) as { error?: string }).error, "btc_production_not_mainnet", "SF6 Vercel production never runs the staging profile");
}
ok(btcConfig(ENV_ON, { keys: KEYS }).ok, "staging boots with pins + key + Turnstile");

// ── 5. envelopes ───────────────────────────────────────────────────────────────────────────────────────────────────
const nonce = () => crypto.randomBytes(16).toString("hex");
const hb = (nowS: number, over: Record<string, unknown> = {}) => signEnvelope({ type: "heartbeat", v: 1, kid: "k1", iat: nowS, exp: nowS + 60, nonce: nonce(), onchain_ok: true, tip_height: 200000, tip_hash: "ab".repeat(32), tip_time: nowS - 100, unused_run: 0, gap_limit: 20, gap_stopped: false, attest_hour: 0, attest_day: 0, outstanding: 0, caps_hit: false, burned_hour: 0, killed: false, stop_file: false, floor_history_ok: true, agent_version: "0.1.0", ...over } as EnvelopePayload, APRIV);
{
  const t = 1_800_000_000, e = hb(t);
  ok(verifyEnvelope(e, { keys: KEYS, refSec: t }).ok, "heartbeat verifies");
  eq((verifyEnvelope(e, { keys: { other: APUB }, refSec: t }) as { reason: string }).reason, "env_unknown_kid", "kid pinned");
  eq((verifyEnvelope({ ...e, payload: { ...e.payload, tip_height: 1 } }, { keys: KEYS, refSec: t }) as { reason: string }).reason, "env_bad_signature", "tamper");
  eq((verifyEnvelope(e, { keys: KEYS, refSec: t + 301 }) as { reason: string }).reason, "env_iat_skew", "skew 300 s");
  eq((verifyEnvelope(hb(t, { exp: t + 121 }), { keys: KEYS, refSec: t }) as { reason: string }).reason, "env_window", "heartbeat ttl <= 120");
  eq((verifyEnvelope({ ...e, extra: 1 }, { keys: KEYS, refSec: t }) as { reason: string }).reason, "env_malformed", "exact wire keys");
}

// ── 6. rev 1.7 job schema (J1-J25) ─────────────────────────────────────────────────────────────────────────────────
const { privateKey: JK, publicKey: JP } = crypto.generateKeyPairSync("ed25519");
const JPRIV = JK.export({ type: "pkcs8", format: "pem" }).toString(), JPUB = JP.export({ type: "spki", format: "pem" }).toString();
const CAPS = { maxRigs: 4, maxSec: MAX_TERM_SEC, hostSuffixes: POOL_HOST_SUFFIXES, ports: POOL_PORTS };
const memLedger = (): NonceLedger => { const m = new Set<string>(); return { has: (n, j, a) => (!!n && m.has("n" + n)) || (!!j && m.has("j" + j)) || (!!a && m.has("a" + a)), add: (n, j, a) => { m.add("n" + n); m.add("j" + j); if (a) m.add("a" + a); } }; };
const BID = "6f1c2a7e-3b0d-4c55-9a51-2f7d0e9b8c41";
function btcJob(env: "staging" | "mainnet", pm: Partial<BtcJobPayment> = {}, top: Partial<JobPayload> = {}): JobPayload {
  const iat = 1_800_000_000;
  const payment: BtcJobPayment = {
    rail: "btc_onchain", network: env === "mainnet" ? BTC_MAINNET_NETWORK : BTC_SIGNET_NETWORK, unit: "sat", payment_id: "btc:" + BID, order_id: "8b0b3a52-1111-4222-8333-944455556666", binding_id: BID,
    index: 7, address: env === "mainnet" ? "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu" : TADDR[7], amount_sat: 446796, required_confs: 1, floor_btc_per_ph_day: "0.00051551", floor_day: "2026-10-16",
    quote_at: iat - 600, quote_expires_at: iat + 300, quote_tip_height: 200000, confirm_by_height: 200144,
    outpoints: [{ txid: "5f".repeat(32), vout: 0, value_sat: 446796 }], ...pm,
  };
  return { v: 1, job_id: crypto.randomUUID(), order_ref: "gm_testorder01", action: "route", rig_class: "s21xp", rig_count: 4, bays: "1,2,3,4",
    upstream: { host: "stratum.braiins.com", port: 3333, user: "renter.w1" }, start: iat, end: iat + 7 * 86400, payment, pay_to: null, amount_usdc: null,
    floor_btc_per_ph_day: payment.floor_btc_per_ph_day, nonce: crypto.randomBytes(16).toString("hex"), iat, exp: iat + 900, env, ...top } as JobPayload;
}
const sch = (p: unknown) => schemaOk(p, CAPS);
eq(sch(btcJob("mainnet")), null, "J1 mainnet btc schema ok");
eq(sch(btcJob("staging")), null, "J1 staging btc schema ok");
eq(sch(btcJob("mainnet", { network: "eip155:8453" })), "schema_payment", "J2");
eq(sch(btcJob("mainnet", { rail: "btc_lightning" as "btc_onchain" })), "schema_payment", "J3");
eq(sch(btcJob("mainnet", { outpoints: [{ txid: "0x" + "5f".repeat(31), vout: 0, value_sat: 446796 }] })), "schema_payment", "J4");
eq(sch(btcJob("mainnet", { outpoints: [{ txid: "5F".repeat(32), vout: 0, value_sat: 446796 }] })), "schema_payment", "J5");
{ const a = btcJob("mainnet"), b = btcJob("mainnet"); eq(applyKey(a), applyKey(b), "J6 dedupe on payment_id"); eq(applyKey(a), "gm_testorder01|route|btc:" + BID, "J6 key"); }
eq(sch(btcJob("mainnet", {}, { pay_to: "0x" + "ae".repeat(20) })), "schema_settlement", "J10");
eq(sch(btcJob("mainnet", {}, { amount_usdc: "1.000000" })), "schema_settlement", "J11");
eq(sch(btcJob("mainnet", {}, { floor_btc_per_ph_day: "0.00052000" })), "schema_payment", "J12");
eq(sch(btcJob("mainnet", { binding_id: BID.toUpperCase(), payment_id: "btc:" + BID.toUpperCase() })), "schema_payment", "J14");
eq(sch(btcJob("mainnet", { payment_id: "btc:6f1c2a7e-3b0d-4c55-9a51-2f7d0e9b8c42" })), "schema_payment", "J15");
{
  const x402 = { ...btcJob("staging"), payment: { rail: "x402_usdc", provider_ref: "x402mock_1", amount_atomic: "1000000", tx_hash: "0x" + "ab".repeat(32), unit: "sat", network: BASE_SEPOLIA.network }, pay_to: PINNED_PAYTO, amount_usdc: "1.000000", floor_btc_per_ph_day: "0.000501" };
  eq(sch(x402), "schema_payment", "J17 x402 unit must be usdc_6dp");
  eq(sch({ ...x402, payment: { ...x402.payment, unit: "usdc_6dp" } }), null, "J16 x402 still ok");
  eq(sch({ ...x402, payment: { ...x402.payment, unit: "sat", rail: "lightning", network: "testnet", tx_hash: null } }), "schema_payment", "J18 lightning dropped");
  for (const k of ["binding_id", "outpoints", "payment_id", "index", "address"]) eq(sch({ ...x402, payment: { ...x402.payment, unit: "usdc_6dp", [k]: 1 } }), "schema_payment", `J19 x402 + ${k}`);
  for (const k of ["tx_hash", "provider_ref", "amount_atomic"]) eq(sch({ ...btcJob("staging"), payment: { ...btcJob("staging").payment!, [k]: "x" } }), "schema_payment", `J19 btc + ${k}`);
  eq(sch({ ...x402, payment: { ...x402.payment, unit: "usdc_6dp", network: "eip155:1" } }), "schema_network", "J20");
  const k402 = applyKey({ ...x402, payment: { ...x402.payment, unit: "usdc_6dp" } } as unknown as JobPayload)!, kbtc = applyKey(btcJob("staging"))!;
  ok(k402.endsWith("|0x" + "ab".repeat(32)) && kbtc.endsWith("|btc:" + BID) && k402 !== kbtc, "J21 disjoint keys");
}
eq(sch(btcJob("mainnet", { network: BTC_SIGNET_NETWORK, address: TADDR[7] })), "schema_payment", "J22 prod refuses signet");
eq(sch(btcJob("staging", { network: BTC_MAINNET_NETWORK, address: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu" })), "schema_payment", "J23 staging refuses mainnet");
eq(sch(btcJob("staging", { amount_sat: 1_200_000, required_confs: 1, outpoints: [{ txid: "5f".repeat(32), vout: 0, value_sat: 1_200_000 }] })), "schema_payment", "S11 confs recomputed");
eq(sch(btcJob("staging", { address: TADDR[7].replace("tb1", "bc1") })), "schema_payment", "address hrp follows network");
eq(sch(btcJob("staging", { outpoints: [{ txid: "5f".repeat(32), vout: 0, value_sat: 1 }] })), "schema_payment", "outpoints must cover amount");
eq(sch(btcJob("staging", { outpoints: [{ txid: "6f".repeat(32), vout: 0, value_sat: 300000 }, { txid: "5f".repeat(32), vout: 0, value_sat: 300000 }] })), "schema_payment", "outpoints strictly ascending");
eq(sch(btcJob("staging", { confirm_by_height: 200145 })), "schema_payment", "confirm_by = tip + 144");
{
  const j = signJob(btcJob("staging"), JPRIV, "t1");
  eq(verifyJob(j, { keys: { t1: JPUB }, expectEnv: "staging", nowSec: 1_800_000_000, ledger: memLedger(), caps: CAPS }), { ok: true }, "signed btc job verifies");
  const bad = signJob(btcJob("staging", { unit: "usdc_6dp" as "sat" }), JPRIV, "t1");
  eq(verifyJob(bad, { keys: { t1: JPUB }, expectEnv: "staging", nowSec: 1_800_000_000, ledger: memLedger(), caps: CAPS }), { ok: false, reason: "schema_payment", stage: "schema" }, "J9 stage schema after a valid signature");
  const tam = { ...bad, payload: { ...bad.payload, rig_count: 3 } };
  eq((verifyJob(tam, { keys: { t1: JPUB }, expectEnv: "staging", nowSec: 1_800_000_000, ledger: memLedger(), caps: CAPS }) as { stage?: string }).stage, undefined, "J24 bad signature never reports a schema stage");
}

async function snippetParity() {
  const { schemaOk: snip, verifyGmJob } = await import("./rentals/verify-job-snippet.mjs");
  const cases: unknown[] = [btcJob("mainnet"), btcJob("staging"), btcJob("mainnet", { network: "eip155:8453" }), btcJob("staging", { confirm_by_height: 1 }), btcJob("mainnet", {}, { pay_to: "0x" + "ae".repeat(20) }),
    btcJob("mainnet", { payment_id: "btc:x" }), btcJob("staging", { network: BTC_MAINNET_NETWORK }), btcJob("mainnet", { outpoints: [] })];
  for (const c of cases) eq(snip(c, CAPS), sch(c), "snippet parity " + sch(c));
  const j = signJob(btcJob("staging"), JPRIV, "t1");
  eq(verifyGmJob(j, { keys: { t1: JPUB }, expectEnv: "staging", nowSec: 1_800_000_000, ledger: memLedger(), caps: CAPS }).ok, true, "snippet verifies btc job");
}

// ── 7. end-to-end flows on memory stores ────────────────────────────────────────────────────────────────────────────
const T0 = ms("2026-10-17T15:00:00Z");
const ROWS: BtcPricingRow[] = [
  { day: "2026-10-17", floorStr: "0.00052000", askStr: "0.00053000", floorBtcPhDay: 0.00052, marketAskBtcPhDay: 0.00053, hashpriceSatsThDay: 47, writtenAt: T0 - 2 * 3600_000 },
  { day: "2026-10-16", floorStr: "0.00051551", askStr: "0.00052000", floorBtcPhDay: 0.00051551, marketAskBtcPhDay: 0.00052, hashpriceSatsThDay: 47, writtenAt: T0 - 26 * 3600_000 },
];
function mk(opts: { tip?: number | null; kill?: boolean } = {}) {
  let now = T0, kill = !!opts.kill, tip: number | null = opts.tip === undefined ? 200000 : opts.tip;
  const store = new MemoryStore();
  const btcStore = new MemoryBtcStore(store, () => now);
  const x = new MockProvider("x402_usdc");
  const alerter = new MockAlerter();
  const d: Deps = {
    store, providers: { x402_usdc: x }, pricing: async () => ({ marketAskBtcPhDay: 0.00053, floorBtcPhDay: 0.00052, hashpriceSatsThDay: 47, writtenAt: T0 - 3600_000 }),
    btcUsd: async () => 82000, now: () => now, signingKeyPem: JPRIV, signingKid: "t1", codeHmacKey: "k".repeat(32), killSwitch: async () => kill, alerter, pilot: false, bays: [1, 2, 3, 4, 5, 6],
    jobEnv: "staging",
    btc: { store: btcStore, config: () => btcConfig(ENV_ON, { keys: KEYS }), pricingRows: async () => ROWS, publicTip: async () => tip },
  };
  const nowS = () => Math.floor(now / 1000);
  const beat = (over: Record<string, unknown> = {}) => btcStore.beat(hb(nowS(), over), now);
  beat();
  return { d, store, btcStore, x, alerter, tick: (n: number) => { now += n; }, nowS, beat, setKill: (k: boolean) => { kill = k; }, setTip: (t: number | null) => { tip = t; } };
}
type M = ReturnType<typeof mk>;
async function order(m: M, rigs = 1, days = 1) {
  const c = await createRental(m.d, { th: 270 * rigs, days, pool_url: "stratum+tcp://stratum.braiins.com:3333", worker: "renter.w1", rail: "x402_usdc", accept_terms: true, terms_version: RENTAL_TERMS_VERSION, idempotency_key: crypto.randomBytes(12).toString("hex") });
  assert.ok(c.ok, JSON.stringify(c));
  const r = (c as unknown as { result: { rentalId: string; creatorSecret: string; payment: { paymentRef: string } } }).result;
  return { rid: r.rentalId, sec: r.creatorSecret, x402Ref: r.payment.paymentRef };
}
function attest(m: M, bindingId: string, index: number, over: Record<string, unknown> = {}) {
  const b = m.btcStore.bindings.get(bindingId)!;
  const p = { type: "addr", v: 1, kid: "k1", iat: m.nowS(), exp: b.quoteExpiresAt, nonce: nonce(), order_id: b.orderId, order_ref: b.orderRef, binding_id: b.bindingId, kind: b.kind,
    index, address: deriveReceive(DESC, index), amount_sat: b.amountSat, required_confs: b.requiredConfs, floor_btc_per_ph_day: b.floorStr, floor_day: b.floorDay,
    quote_at: b.quoteAt, quote_expires_at: b.quoteExpiresAt, quote_tip_height: 200000, confirm_by_height: 200144, descriptor_checksum: "evh9fu0w", ...over };
  const e = signEnvelope(p as EnvelopePayload, APRIV);
  m.btcStore.attach(bindingId, e as unknown as { payload: Record<string, unknown> });
  return e;
}
function paid(m: M, bindingId: string, outs: { txid: string; vout: number; value_sat: number; height: number }[], tipH = 200010, over: Record<string, unknown> = {}) {
  const b = m.btcStore.bindings.get(bindingId)!;
  const att = (b.attestEnv as { payload: Record<string, unknown> }).payload;
  const p = { type: "paid", v: 1, kid: "k1", iat: m.nowS(), exp: m.nowS() + 600, nonce: nonce(), order_id: b.orderId, order_ref: b.orderRef, binding_id: b.bindingId,
    index: att.index, address: att.address, amount_sat: b.amountSat, required_confs: b.requiredConfs, floor_btc_per_ph_day: b.floorStr, floor_day: b.floorDay, quote_at: b.quoteAt,
    quote_tip_height: att.quote_tip_height, confirm_by_height: att.confirm_by_height, received_sat: outs.reduce((a, o) => a + o.value_sat, 0), outpoints: outs, tip_height: tipH, tip_hash: "cd".repeat(32), ...over };
  const e = signEnvelope(p as EnvelopePayload, APRIV);
  return { e, id: m.btcStore.report(e as unknown as { payload: Record<string, unknown> }) };
}
const tx = (n: number) => crypto.createHash("sha256").update("tx" + n).digest("hex");
async function bound(m: M, rigs = 1, days = 1, index = 7) {
  const o = await order(m, rigs, days);
  const c = await createBtcBinding(m.d, { rental_id: o.rid, creator_secret: o.sec });
  assert.ok(c.ok, JSON.stringify(c));
  const v = (c as { result: { bindingId: string; state: string; amountSats: number } }).result;
  eq(v.state, "attesting", "new binding waits for the attestation");
  m.tick(1500);
  attest(m, v.bindingId, index);
  const s = await btcStatus(m.d, { rental_id: o.rid, creator_secret: o.sec });
  assert.ok(s.ok, JSON.stringify(s));
  return { ...o, bindingId: v.bindingId, view: (s as { result: Record<string, unknown> }).result, amount: v.amountSats };
}

/** #109 B7 x #107: bay_taken_mrr on a BTC order (gate on: one swap with the same BtcJobPayment; then one sats refund, pending_owner). */
async function bayGate() {
  for (const gate of [true, false]) {
    const m = mk();
    m.d.availGate = gate;
    m.store.dbNow = () => m.d.now();
    const report = (rows: [number, "ok" | "mrr_rented"][]) => {
      for (const [bay, reason] of rows) {
        m.store.bayReports = m.store.bayReports.filter((r) => r.bay !== bay);
        m.store.bayReports.push({ bay, free: reason === "ok", reason, mrrRentedUntil: null, reportedAt: m.d.now() });
      }
    };
    report([[1, "ok"], [2, "ok"], [3, "ok"], [4, "ok"], [5, "ok"], [6, "ok"]]);
    const o = await bound(m);
    m.tick(10 * 60_000);
    report([[1, "ok"], [2, "ok"], [3, "ok"], [4, "ok"], [5, "ok"], [6, "ok"]]);
    paid(m, o.bindingId, [{ txid: tx(901), vout: 0, value_sat: o.amount, height: 200005 }]);
    eq((await processBtcEvents(m.d)).outcomes, ["settled"], `B7 gate ${gate ? "on" : "off"}: BTC settles`);
    const o1 = (await m.store.getOrderByPublicId(o.rid))!;
    eq(o1.bays, "1", "BTC settle takes a fresh-free bay");
    const j1 = (await m.store.listJobs(o.rid))[0];
    report([[1, "mrr_rented"]]);
    await m.store.recordResult({ jobId: j1.payload.job_id, orderRef: o.rid, result: "rejected", reason: BAY_TAKEN_MRR, deliveredTh: null, at: m.d.now() });
    m.tick(60_000);
    let last = j1, cur = o1;
    if (gate) {
      eq(await reofferOrExpire(m.d, o1), "reoffered", "BTC bay_taken_mrr: substituted once (gate on)");
      cur = (await m.store.getOrderByPublicId(o.rid))!;
      const routes = (await m.store.listJobs(o.rid)).filter((j) => j.payload.action === "route");
      last = routes[1];
      eq([cur.state, cur.bays, routes.length, last.payload.bays], ["delivering", "2", 2, "2"], "new bay, second route job");
      eq(last.payload.payment, j1.payload.payment, "same BtcJobPayment verbatim");
      eq([last.payload.pay_to, last.payload.amount_usdc, last.payload.end - last.payload.start], [null, null, j1.payload.end - j1.payload.start], "no x402 keys; same duration");
      eq(verifyJob(last, { keys: { t1: JPUB }, expectEnv: "staging", nowSec: m.nowS(), ledger: memLedger(), caps: CAPS }), { ok: true }, "substituted BTC job verifies");
      eq(refundsOf(m, o.bindingId), [], "no refund on a swap");
      report([[2, "mrr_rented"]]);
      await m.store.recordResult({ jobId: last.payload.job_id, orderRef: o.rid, result: "rejected", reason: BAY_TAKEN_MRR, deliveredTh: null, at: m.d.now() });
    }
    eq(await reofferOrExpire(m.d, cur), "bay_unavailable", gate ? "second take: refund" : "gate off: refund directly, no swap");
    eq((await m.store.getOrderByPublicId(o.rid))!.state, "failed", "order failed");
    eq(refundsOf(m, o.bindingId), [["bay_unavailable", o.amount]], "one full refund in sats");
    const rf = m.store.refunds.find((r) => r.providerRef === "btc:" + o.bindingId)!;
    eq([rf.status, rf.network], ["pending_owner", BTC_SIGNET_NETWORK], "pending_owner, BTC network (sent manually)");
    ok((await m.store.listJobs(o.rid)).some((j) => j.payload.action === "revert"), "safety revert job");
  }
}

async function flows() {
  // Happy path: quote, binding, attestation, first display, paid, settle, rev 1.7 job.
  {
    const m = mk();
    ok((await btcAvailability(m.d)).ok, "available with a fresh verified heartbeat");
    const o = await bound(m);
    eq(o.view.state, "pay", "address shown after (a)-(e)");
    eq(o.view.address, TADDR[7], "site's own derivation");
    // amount = max(ask_sat(today ask), min_sat(F_signed of today's row)) for 1 rig-day
    const want = [askSat(53000, 1, 1), minSat(52000, 1, 1)].reduce((a, b) => (a > b ? a : b));
    eq(o.amount, Number(want), "integer BTC amount");
    eq(o.view.bip21, `bitcoin:${TADDR[7]}?amount=${(o.amount / 1e8).toFixed(8).replace(/\.?0+$/, "")}`, "BIP21 exact amount");
    // x402 can't take money while the BTC binding is live (otherRailHold).
    const xp = new X402Provider({ net: BASE_SEPOLIA, payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://p", store: m.store, now: () => T0, otherRailHold: (id) => m.btcStore.hasLiveBinding(id) });
    eq(await xp.payableState(o.x402Ref), "not_payable", "USDC held while BTC is live");
    eq((await confirmPayment(m.d, "btc:" + o.bindingId)).outcome, "btc_rail", "provider path never accepts BTC");
    m.tick(10 * 60_000);
    paid(m, o.bindingId, [{ txid: tx(1), vout: 0, value_sat: o.amount, height: 200005 }]);
    const pr = await processBtcEvents(m.d);
    eq(pr.outcomes, ["settled"], "paid event settles");
    const ord = await m.store.getOrderByPublicId(o.rid);
    eq([ord!.state, ord!.rail, ord!.totalSats, ord!.totalUsdcAtomic], ["delivering", "btc_onchain", o.amount, null], "order switched to the BTC rail atomically");
    eq(ord!.startsAt, m.d.now(), "P6: clock starts at paid-event acceptance");
    const jobs = await m.store.listJobs(o.rid);
    eq(jobs.length, 1, "one route job");
    eq(verifyJob(jobs[0], { keys: { t1: JPUB }, expectEnv: "staging", nowSec: m.nowS(), ledger: memLedger(), caps: CAPS }), { ok: true }, "rev 1.7 BTC job verifies");
    const pm = jobs[0].payload.payment as BtcJobPayment;
    eq([pm.rail, pm.network, pm.payment_id, pm.amount_sat, pm.index, jobs[0].payload.pay_to, jobs[0].payload.amount_usdc], ["btc_onchain", BTC_SIGNET_NETWORK, "btc:" + o.bindingId, o.amount, 7, null, null], "job payment fields");
    eq(jobs[0].payload.floor_btc_per_ph_day, pm.floor_btc_per_ph_day, "top-level floor = payment floor");
    const s2 = await btcStatus(m.d, { rental_id: o.rid, creator_secret: o.sec });
    eq((s2 as { result: { state: string } }).result.state, "paid", "renter sees paid");
    // Replayed paid event (same envelope) is rejected; nothing changes.
    const again = m.btcStore.report(m.btcStore.bindings.get(o.bindingId)!.paidEnv as { payload: Record<string, unknown> });
    void again;
    const pr2 = await processBtcEvents(m.d);
    ok(pr2.outcomes[0].startsWith("rejected:") || pr2.outcomes[0] === "duplicate", "replay never settles twice: " + pr2.outcomes[0]);
    eq((await m.store.listJobs(o.rid)).length, 1, "still one job");
    // Unapplied 30 min: expired_unapplied with a sats refund on the signet network.
    m.tick(31 * 60_000);
    const ord2 = (await m.store.getOrderByPublicId(o.rid))!;
    eq(await reofferOrExpire(m.d, ord2), "expired_unapplied", "BTC order expires unapplied");
    const rf = m.store.refunds.filter((r) => r.providerRef === "btc:" + o.bindingId && r.reason === "expired_unapplied");
    eq(rf.map((r) => [r.rail, r.atomic, r.network]), [["btc_onchain", o.amount, BTC_SIGNET_NETWORK]], "refund in sats on the paid chain");
    const st = await getRentalStatus(m.d, { rental_id: o.rid, creator_secret: o.sec });
    eq((st as { result: { refundPending?: { amountSats: number } } }).result.refundPending?.amountSats, o.amount, "status shows sats refund");
  }
  // Re-offer of an expired BTC route job keeps the payment verbatim.
  {
    const m = mk();
    const o = await bound(m);
    paid(m, o.bindingId, [{ txid: tx(2), vout: 1, value_sat: o.amount, height: 200005 }]);
    await processBtcEvents(m.d);
    m.tick(16 * 60_000);
    eq(await reofferOrExpire(m.d, (await m.store.getOrderByPublicId(o.rid))!), "reoffered", "re-offer");
    const js = await m.store.listJobs(o.rid);
    eq(js.length, 2, "two jobs"); eq(applyKey(js[0].payload), applyKey(js[1].payload), "same apply key"); eq(js[0].payload.payment, js[1].payload.payment, "payment verbatim");
    eq(verifyJob(js[1], { keys: { t1: JPUB }, expectEnv: "staging", nowSec: m.nowS(), ledger: memLedger(), caps: CAPS }), { ok: true }, "re-offer verifies");
  }
  // Underpaid -> shortfall QR -> top-up settles. Overpay within 1% kept.
  {
    const m = mk();
    const o = await bound(m);
    paid(m, o.bindingId, [{ txid: tx(3), vout: 0, value_sat: o.amount - 1000, height: 200005 }]);
    eq((await processBtcEvents(m.d)).outcomes, ["underpaid_waiting"], "underpaid waits");
    const s = (await btcStatus(m.d, { rental_id: o.rid, creator_secret: o.sec })) as unknown as { result: { state: string; shortfall: { amountSats: number }; bip21: string } };
    eq([s.result.state, s.result.shortfall.amountSats], ["underpaid", 1000], "shortfall shown");
    ok(s.result.bip21.endsWith("amount=0.00001"), "shortfall BIP21");
    m.tick(60_000);
    paid(m, o.bindingId, [{ txid: tx(3), vout: 0, value_sat: o.amount - 1000, height: 200005 }, { txid: tx(4), vout: 2, value_sat: 1000, height: 200008 }]);
    eq((await processBtcEvents(m.d)).outcomes, ["settled"], "top-up settles");
    eq(m.store.payments.filter((p) => p.providerRef === "btc:" + o.bindingId).map((p) => [p.deltaAtomic, p.settles]), [[o.amount - 1000, false], [1000, true]], "two payment rows");
  }
  // Outpoint reused across bindings -> rejected + alert; never settles.
  {
    const m = mk();
    const a = await bound(m, 1, 1, 7);
    paid(m, a.bindingId, [{ txid: tx(5), vout: 0, value_sat: a.amount, height: 200005 }]);
    await processBtcEvents(m.d);
    const b = await bound(m, 1, 1, 8);
    paid(m, b.bindingId, [{ txid: tx(5), vout: 0, value_sat: b.amount, height: 200005 }]);
    eq((await processBtcEvents(m.d)).outcomes, ["rejected:btc_outpoint_reused"], "outpoint reuse refused");
    ok(m.store.alerts.some((x) => x.kind === "btc_outpoint_reused"), "alerted");
  }
  // Not enough confirmations / after confirm_by -> rejected.
  {
    const m = mk();
    const o = await bound(m);
    paid(m, o.bindingId, [{ txid: tx(6), vout: 0, value_sat: o.amount, height: 200010 }], 200009);
    eq((await processBtcEvents(m.d)).outcomes, ["rejected:btc_unconfirmed"], "confs enforced");
    paid(m, o.bindingId, [{ txid: tx(6), vout: 0, value_sat: o.amount, height: 200005 }], 200010, { amount_sat: o.amount - 1 });
    eq((await processBtcEvents(m.d)).outcomes, ["rejected:btc_amount_mismatch"], "fields must equal the attestation");
  }
  // Killed while paid -> killed_refund, never provisioned (N6).
  {
    const m = mk();
    const o = await bound(m);
    m.setKill(true);
    paid(m, o.bindingId, [{ txid: tx(7), vout: 0, value_sat: o.amount, height: 200005 }]);
    eq((await processBtcEvents(m.d)).outcomes, ["killed_refund"], "N6");
    eq((await m.store.getOrderByPublicId(o.rid))!.state, "refund_pending", "order refund_pending");
    eq((await m.store.listJobs(o.rid)).length, 0, "no job");
    eq(m.store.refunds.map((r) => [r.reason, r.rail, r.atomic, r.network]), [["kill_switch", "btc_onchain", o.amount, BTC_SIGNET_NETWORK]], "refund row");
    m.setKill(false);
    eq((await processBtcEvents(m.d)).processed, 0, "nothing re-provisions after unkill");
    const s = (await btcStatus(m.d, { rental_id: o.rid, creator_secret: o.sec })) as { result: { state: string } };
    eq(s.result.state, "paused_refund", "renter told");
  }
  // Cancel with an address shown -> binding expired; later money = duplicate refund.
  {
    const m = mk();
    const o = await bound(m);
    const c = await cancelRental(m.d, { rental_id: o.rid, creator_secret: o.sec });
    ok(c.ok, "cancel ok");
    eq(m.btcStore.bindings.get(o.bindingId)!.status, "expired", "binding closed");
    paid(m, o.bindingId, [{ txid: tx(8), vout: 0, value_sat: o.amount, height: 200005 }]);
    eq((await processBtcEvents(m.d)).outcomes, ["duplicate"], "late money refunded");
    eq(m.store.refunds.map((r) => [r.reason, r.atomic]), [["duplicate", o.amount]], "duplicate refund row");
  }
  // Attestation that doesn't match the site's derivation is never shown.
  {
    const m = mk();
    const ord = await order(m);
    const c = (await createBtcBinding(m.d, { rental_id: ord.rid, creator_secret: ord.sec })) as { result: { bindingId: string } };
    attest(m, c.result.bindingId, 7, { address: deriveReceive(DESC, 8) });
    const s = (await btcStatus(m.d, { rental_id: ord.rid, creator_secret: ord.sec })) as { result: Record<string, unknown> };
    eq([s.result.state, s.result.address], ["unavailable", undefined], "mismatched address never displayed");
    eq(m.btcStore.bindings.get(c.result.bindingId)!.status, "refused", "binding refused");
    ok(m.store.alerts.some((a) => a.kind === "btc_display_refused"), "alert");
    // Index 0 is never attested (N5): the envelope itself is refused.
    const e = signEnvelope({ ...(m.btcStore.bindings.get(c.result.bindingId)!.attestEnv as { payload: EnvelopePayload }).payload, index: 0 } as EnvelopePayload, APRIV);
    eq((verifyEnvelope(e, { keys: KEYS, refSec: m.nowS() }) as { reason: string }).reason, V.index[0].expect.split(" ")[0].replace("reject:", ""), "I1 index 0");
  }
  // Agent behind the public tip (P5) -> first display refused (temporary), then abandon -> USDC works again.
  {
    const m = mk({ tip: 200005 });
    const ord = await order(m);
    const c = (await createBtcBinding(m.d, { rental_id: ord.rid, creator_secret: ord.sec })) as { ok: boolean; error?: string };
    eq(c.error, "btc_unavailable", "not offered while the agent is behind");
    m.setTip(200001);
    const c2 = (await createBtcBinding(m.d, { rental_id: ord.rid, creator_secret: ord.sec })) as { result: { bindingId: string } };
    attest(m, c2.result.bindingId, 9);
    m.setTip(200003);
    const s = (await btcStatus(m.d, { rental_id: ord.rid, creator_secret: ord.sec })) as { result: { state: string } };
    eq(s.result.state, "unavailable", "agent behind at display -> not shown");
    const ab = (await btcStatus(m.d, { rental_id: ord.rid, creator_secret: ord.sec, abandon: true })) as { result: { abandoned?: boolean } };
    eq(ab.result.abandoned, true, "abandoned");
    const xp = new X402Provider({ net: BASE_SEPOLIA, payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://p", store: m.store, now: () => T0, otherRailHold: (id) => m.btcStore.hasLiveBinding(id) });
    eq(await xp.payableState(ord.x402Ref), "payable", "USDC payable again");
  }
  // addr_refused -> refused.
  {
    const m = mk();
    const ord = await order(m);
    const c = (await createBtcBinding(m.d, { rental_id: ord.rid, creator_secret: ord.sec })) as { result: { bindingId: string } };
    const b = m.btcStore.bindings.get(c.result.bindingId)!;
    m.btcStore.report(signEnvelope({ type: "addr_refused", v: 1, kid: "k1", iat: m.nowS(), exp: m.nowS() + 300, nonce: nonce(), order_id: b.orderId, order_ref: b.orderRef, binding_id: b.bindingId, reason: "floor_day_not_in_effect" } as EnvelopePayload, APRIV) as unknown as { payload: Record<string, unknown> });
    eq((await processBtcEvents(m.d)).outcomes, ["refused"], "agent refusal");
    eq(m.btcStore.bindings.get(b.bindingId)!.status, "refused", "binding refused");
  }
  // Expiry: stale heartbeat -> nothing expires (S10); fresh heartbeat past confirm_by -> expired, then the order.
  {
    const m = mk();
    const o = await bound(m);
    m.tick(30 * 60_000); // past quote window and x402 pay window
    eq(await sweepExpired(m.d), 0, "order held by the live binding");
    m.btcStore.heartbeat = { env: hb(m.nowS() - 600, { tip_height: 200200 }), receivedAt: m.d.now() - 600_000 };
    eq((await sweepBtc(m.d)).expired, 0, "S10: stale heartbeat, no expiry");
    m.beat({ tip_height: 200200 });
    eq((await sweepBtc(m.d)).expired, 1, "fresh heartbeat past confirm_by -> expired");
    eq(await sweepExpired(m.d), 1, "order expires after its binding");
    const s = (await btcStatus(m.d, { rental_id: o.rid, creator_secret: o.sec })) as { result: Record<string, unknown> };
    ok(s.result.state !== "pay" && !("bip21" in s.result), "no QR after expiry");
  }
  // Underpaid past confirm_by -> refund everything received.
  {
    const m = mk();
    const o = await bound(m);
    paid(m, o.bindingId, [{ txid: tx(9), vout: 0, value_sat: 6000, height: 200005 }]);
    await processBtcEvents(m.d);
    m.tick(60_000); m.beat({ tip_height: 200145 });
    eq((await sweepBtc(m.d)).refunded, 1, "underpaid refunded at confirm_by");
    eq(m.store.refunds.map((r) => [r.reason, r.atomic, r.rail]), [["underpaid", 6000, "btc_onchain"]], "refund row");
    ok(m.store.alerts.some((a) => a.kind === "btc_underpaid"), "NB1 btc_underpaid alert");
  }
  // Reorg after provisioning -> failed + revert job + alert.
  {
    const m = mk();
    const o = await bound(m);
    paid(m, o.bindingId, [{ txid: tx(10), vout: 0, value_sat: o.amount, height: 200005 }]);
    await processBtcEvents(m.d);
    const b = m.btcStore.bindings.get(o.bindingId)!;
    m.btcStore.report(signEnvelope({ type: "reorged", v: 1, kid: "k1", iat: m.nowS(), exp: m.nowS() + 300, nonce: nonce(), order_id: b.orderId, order_ref: b.orderRef, binding_id: b.bindingId, index: 7, address: TADDR[7], lost_outpoints: [{ txid: tx(10), vout: 0 }], tip_height: 200011, tip_hash: "ef".repeat(32) } as EnvelopePayload, APRIV) as unknown as { payload: Record<string, unknown> });
    eq((await processBtcEvents(m.d)).outcomes, ["reorg_manual"], "FB2 reorg after credit -> manual");
    eq((await m.store.getOrderByPublicId(o.rid))!.state, "failed", "order failed");
    eq((await m.store.listJobs(o.rid)).map((j) => j.payload.action), ["route", "revert"], "revert job");
    ok(m.store.alerts.some((a) => a.kind === "btc_reorg_manual"), "btc_reorg_manual alert");
    const rb = m.btcStore.bindings.get(o.bindingId)!;
    eq([rb.status, rb.creditedSat, rb.refundedSat], ["manual_review", 0, o.amount], "binding manual_review, credit moved to the refund queue");
    eq(m.store.refunds.map((r) => [r.reason, r.atomic, r.rail, r.network]), [["delivery_failed", o.amount, "btc_onchain", BTC_SIGNET_NETWORK]], "FB2 refund/manual row");
    // The tx re-confirms: the agent re-reports the same outpoints -> manual review again, never "duplicate with 0".
    m.tick(60_000);
    paid(m, o.bindingId, [{ txid: tx(10), vout: 0, value_sat: o.amount, height: 200012 }], 200013);
    eq((await processBtcEvents(m.d)).outcomes, ["manual_review"], "FB2 re-confirmed reorged binding -> manual_review");
    eq(m.btcStore.bindings.get(o.bindingId)!.status, "manual_review", "still manual_review");
    eq(m.store.refunds.length, 1, "no second refund for the same money");
    eq(m.store.alerts.filter((a) => a.kind === "btc_reorg_manual").length, 2, "alerted again");
    eq((await m.store.listJobs(o.rid)).length, 2, "never re-provisioned automatically");
  }
  // Event signed by an unknown key -> rejected; heartbeat caps hide BTC; whole rigs only.
  {
    const m = mk();
    const o = await bound(m);
    const { privateKey: EK } = crypto.generateKeyPairSync("ed25519");
    const b = m.btcStore.bindings.get(o.bindingId)!;
    const att = (b.attestEnv as { payload: Record<string, unknown> }).payload;
    m.btcStore.report(signEnvelope({ type: "paid", v: 1, kid: "k1", iat: m.nowS(), exp: m.nowS() + 600, nonce: nonce(), order_id: b.orderId, order_ref: b.orderRef, binding_id: b.bindingId, index: 7, address: att.address, amount_sat: b.amountSat, required_confs: b.requiredConfs, floor_btc_per_ph_day: b.floorStr, floor_day: b.floorDay, quote_at: b.quoteAt, quote_tip_height: 200000, confirm_by_height: 200144, received_sat: b.amountSat, outpoints: [{ txid: tx(11), vout: 0, value_sat: b.amountSat, height: 200005 }], tip_height: 200010, tip_hash: "cd".repeat(32) } as EnvelopePayload, EK.export({ type: "pkcs8", format: "pem" }).toString()) as unknown as { payload: Record<string, unknown> });
    eq((await processBtcEvents(m.d)).outcomes, ["rejected:env_bad_signature"], "forged paid event refused");
    m.beat({ attest_hour: 20 });
    eq((await btcAvailability(m.d)).ok, false, "N1 caps hide BTC");
    m.beat({ killed: true });
    eq((await btcAvailability(m.d)).ok, false, "agent kill hides BTC");
    m.beat();
    m.setTip(null);
    eq((await btcAvailability(m.d)).ok, false, "public tip unknown hides BTC for new picks");
    eq(quoteBtc(ROWS, 300, 1, T0).ok, false, "whole rigs only");
  }
  // Route handlers: flag off -> 404; Turnstile required ("skip" refused); 3 picks/IP/h.
  {
    const m = mk();
    const o = await order(m);
    const incrMap = new Map<string, number>();
    const incr = async (k: string) => { const n = (incrMap.get(k) ?? 0) + 1; incrMap.set(k, n); return { count: n, ttlSec: 3600 }; };
    const env = { RENTALS_HUMAN_CHECKOUT: "1", RENTALS_PHASE2_ENABLED: "1", RENTALS_PHASE2_MODE: "staging", ...ENV_ON };
    const body = { rental_id: o.rid, creator_secret: o.sec, turnstile_token: "t" };
    eq((await handleBtcBind(body, { env: { ...env, RENTALS_BTC_ONCHAIN_ENABLED: "0" }, deps: m.d, incr, ipBucket: "ip1", turnstile: async () => ({ ok: true, kind: "verified" }) })).status, 404, "flag off -> 404");
    eq((await handleBtcStatus(body, { env: { ...env, RENTALS_BTC_ONCHAIN_ENABLED: "" }, deps: m.d })).status, 404, "status 404 when off");
    eq((await handleBtcBind(body, { env, deps: m.d, incr, ipBucket: "ip1", turnstile: async () => ({ ok: true, kind: "skip" }) })).status, 403, "Turnstile skip refused");
    const okr = await handleBtcBind(body, { env, deps: m.d, incr, ipBucket: "ip1", turnstile: async () => ({ ok: true, kind: "verified" }) });
    eq(okr.status, 200, "bind ok: " + JSON.stringify(okr.body));
    for (let i = 0; i < 2; i++) await handleBtcBind(body, { env, deps: m.d, incr, ipBucket: "ip1", turnstile: async () => ({ ok: true, kind: "verified" }) });
    eq((await handleBtcBind(body, { env, deps: m.d, incr, ipBucket: "ip1", turnstile: async () => ({ ok: true, kind: "verified" }) })).status, 429, "4th pick in the hour limited");
    eq((await handleBtcBind(body, { env, deps: m.d, incr: async () => null, ipBucket: "ip2", turnstile: async () => ({ ok: true, kind: "verified" }) })).status, 503, "no KV -> fail closed");
  }
  // MCP/bot: no BTC rail in v1.
  {
    const m = mk();
    const c = await createRental(m.d, { th: 270, days: 1, pool_url: "stratum+tcp://stratum.braiins.com:3333", worker: "renter.w1", rail: "btc_onchain", accept_terms: true, terms_version: RENTAL_TERMS_VERSION, idempotency_key: crypto.randomBytes(12).toString("hex") });
    eq((c as { ok: boolean }).ok, false, "create_rental rail btc_onchain refused");
  }
  // Customer-safe: every view passes the filter (address excluded only as the renter's own payment target).
  {
    const m = mk();
    const o = await bound(m);
    const { address: _a, bip21: _b, rentalId: _r, bindingId: _i, ...rest } = o.view as Record<string, unknown>; void _a; void _b; void _r; void _i;
    ok(assertCustomerSafe(rest) && !/umbrel/i.test(JSON.stringify(o.view)) && !leaksNeverReveal(JSON.stringify(o.view)), "view is customer-safe");
  }
}

// ── 8. security review fixes (FB1, FB2, SF1-SF10) and the follow-up items (d, e, g) ───────────────────────────────────────────
function reorg(m: M, bindingId: string, lost: { txid: string; vout: number }[]) {
  const b = m.btcStore.bindings.get(bindingId)!;
  const att = (b.attestEnv as { payload: Record<string, unknown> }).payload;
  return m.btcStore.report(signEnvelope({ type: "reorged", v: 1, kid: "k1", iat: m.nowS(), exp: m.nowS() + 300, nonce: nonce(), order_id: b.orderId, order_ref: b.orderRef, binding_id: b.bindingId, index: att.index, address: att.address, lost_outpoints: lost, tip_height: 200011, tip_hash: "ef".repeat(32) } as EnvelopePayload, APRIV) as unknown as { payload: Record<string, unknown> });
}
function agentEnv(m: M, bindingId: string, type: "seen" | "underpaid", over: Record<string, unknown>) {
  const b = m.btcStore.bindings.get(bindingId)!;
  const att = (b.attestEnv as { payload: Record<string, unknown> }).payload;
  const common = { type, v: 1, kid: "k1", iat: m.nowS(), exp: m.nowS() + 600, nonce: nonce(), order_id: b.orderId, order_ref: b.orderRef, binding_id: b.bindingId, index: att.index, address: att.address, amount_sat: b.amountSat };
  const extra = type === "underpaid" ? { required_confs: b.requiredConfs, confirm_by_height: att.confirm_by_height } : {};
  return signEnvelope({ ...common, ...extra, ...over } as unknown as EnvelopePayload, APRIV);
}
const refundsOf = (m: M, bindingId: string) => m.store.refunds.filter((r) => r.providerRef === "btc:" + bindingId).map((r) => [r.reason, r.atomic]);

async function fixes() {
  // FB1 (a): unpaid binding expired by the sweep, then a LATE first payment -> refund "late", no provisioning, alert;
  // a later cumulative event (another late output) is still processed.
  {
    const m = mk();
    const o = await bound(m);
    m.tick(30 * 60_000); m.beat({ tip_height: 200200 });
    eq((await sweepBtc(m.d)).expired, 1, "FB1a binding expired at confirm_by");
    paid(m, o.bindingId, [{ txid: tx(20), vout: 0, value_sat: o.amount, height: 200150 }], 200200);
    eq((await processBtcEvents(m.d)).outcomes, ["late"], "FB1a late first payment is NOT rejected");
    eq(refundsOf(m, o.bindingId), [["late", o.amount]], "FB1a late refund row");
    eq(m.btcStore.bindings.get(o.bindingId)!.status, "late_payment", "FB1a binding late_payment");
    ok(m.store.alerts.some((a) => a.kind === "btc_late_payment"), "FB1a btc_late_payment alert");
    eq((await m.store.listJobs(o.rid)).length, 0, "FB1a never provisioned");
    eq((await m.store.getOrderByPublicId(o.rid))!.state, "refund_pending", "FB1a order refund_pending");
    ok(m.btcStore.outpoints.has(`${tx(20)}:0`), "FB1a late outputs recorded (globally unique)");
    m.tick(60_000);
    paid(m, o.bindingId, [{ txid: tx(20), vout: 0, value_sat: o.amount, height: 200150 }, { txid: tx(21), vout: 1, value_sat: 9000, height: 200160 }], 200200);
    eq((await processBtcEvents(m.d)).outcomes, ["late"], "FB1a later cumulative event processed");
    eq(refundsOf(m, o.bindingId), [["late", o.amount], ["late", 9000]], "FB1a only the new late money refunded");
  }
  // FB1 (b): underpaid on time, then a LATE top-up -> late refund + the on-time part refunded; later events still processed.
  {
    const m = mk();
    const o = await bound(m, 4, 7);
    paid(m, o.bindingId, [{ txid: tx(22), vout: 0, value_sat: o.amount - 10000, height: 200005 }]);
    eq((await processBtcEvents(m.d)).outcomes, ["underpaid_waiting"], "FB1b underpaid waits");
    m.tick(60_000);
    paid(m, o.bindingId, [{ txid: tx(22), vout: 0, value_sat: o.amount - 10000, height: 200005 }, { txid: tx(23), vout: 0, value_sat: 10000, height: 200150 }], 200160);
    eq((await processBtcEvents(m.d)).outcomes, ["late"], "FB1b late top-up not rejected");
    eq(refundsOf(m, o.bindingId), [["underpaid", o.amount - 10000], ["late", 10000]], "FB1b on-time part + late part refunded");
    eq((await m.store.listJobs(o.rid)).length, 0, "FB1b never provisioned (window over)");
    ok(m.store.alerts.some((a) => a.kind === "btc_late_payment") && m.store.alerts.some((a) => a.kind === "btc_underpaid"), "FB1b alerts");
    m.tick(60_000);
    paid(m, o.bindingId, [{ txid: tx(22), vout: 0, value_sat: o.amount - 10000, height: 200005 }, { txid: tx(23), vout: 0, value_sat: 10000, height: 200150 }, { txid: tx(24), vout: 0, value_sat: 7000, height: 200161 }], 200170);
    eq((await processBtcEvents(m.d)).outcomes, ["late"], "FB1b later cumulative event processed");
    eq(refundsOf(m, o.bindingId).at(-1), ["late", 7000], "FB1b new late money refunded");
  }
  // FB1 (c): underpaid refunded by the sweep at confirm_by, then a late top-up -> only the late value is refunded.
  {
    const m = mk();
    const o = await bound(m, 4, 7);
    paid(m, o.bindingId, [{ txid: tx(25), vout: 0, value_sat: 20000, height: 200005 }]);
    await processBtcEvents(m.d);
    m.tick(60_000); m.beat({ tip_height: 200145 });
    await sweepBtc(m.d);
    paid(m, o.bindingId, [{ txid: tx(25), vout: 0, value_sat: 20000, height: 200005 }, { txid: tx(26), vout: 0, value_sat: o.amount, height: 200146 }], 200150);
    eq((await processBtcEvents(m.d)).outcomes, ["late"], "FB1c late top-up after the underpaid refund");
    eq(refundsOf(m, o.bindingId), [["underpaid", 20000], ["late", o.amount]], "FB1c earlier part at confirm_by + late value");
  }
  // FB1 (d): full payment on time plus an extra late output in the same event -> settles; late output refunded, not in the job.
  {
    const m = mk();
    const o = await bound(m);
    paid(m, o.bindingId, [{ txid: tx(27), vout: 0, value_sat: o.amount, height: 200100 }, { txid: tx(28), vout: 0, value_sat: 8000, height: 200150 }], 200160);
    eq((await processBtcEvents(m.d)).outcomes, ["settled_with_late"], "FB1d settles on the on-time money");
    eq(refundsOf(m, o.bindingId), [["late", 8000]], "FB1d late output refunded");
    const pm = (await m.store.listJobs(o.rid))[0].payload.payment as BtcJobPayment;
    eq(pm.outpoints.map((x) => x.txid), [tx(27)], "FB1d job carries on-time outputs only");
  }
  // FB2: reorg BEFORE acceptance (underpaid) -> reorged; the sweep closes it (refund_pending + refund), USDC not held forever.
  {
    const m = mk();
    const o = await bound(m, 4, 7);
    paid(m, o.bindingId, [{ txid: tx(29), vout: 0, value_sat: 30000, height: 200005 }]);
    await processBtcEvents(m.d);
    reorg(m, o.bindingId, [{ txid: tx(29), vout: 0 }]);
    eq((await processBtcEvents(m.d)).outcomes, ["reorged"], "FB2 pre-acceptance reorg");
    m.tick(60_000); m.beat();
    eq((await sweepBtc(m.d)).refunded, 1, "FB2 sweep closes the reorged binding");
    eq(m.btcStore.bindings.get(o.bindingId)!.status, "refund_pending", "FB2 refund_pending");
    eq(refundsOf(m, o.bindingId), [["expired_unapplied", 30000]], "FB2 money still unrefunded goes to the queue (received, never applied)");
    eq(m.btcStore.bindings.get(o.bindingId)!.statusReason, "reorg_unaccepted_refund", "FB2 clear binding note");
    eq((await m.store.getOrderByPublicId(o.rid))!.state, "refund_pending", "FB2 order refund_pending");
    ok(m.store.alerts.some((a) => a.kind === "btc_reorg_unaccepted_refund"), "FB2 clear alert");
  }
  // FB2: a reorged binding with nothing left is released -> USDC payable again.
  {
    const m = mk();
    const o = await bound(m);
    reorg(m, o.bindingId, [{ txid: tx(30), vout: 0 }]);
    eq((await processBtcEvents(m.d)).outcomes, ["reorged"], "FB2 reorg with no money");
    const xp = new X402Provider({ net: BASE_SEPOLIA, payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://p", store: m.store, now: () => m.d.now(), otherRailHold: (id) => m.btcStore.hasLiveBinding(id) });
    eq(await xp.payableState(o.x402Ref), "not_payable", "FB2 held while reorged");
    m.beat();
    eq((await sweepBtc(m.d)).released, 1, "FB2 sweep releases it");
    eq(m.btcStore.bindings.get(o.bindingId)!.status, "expired", "FB2 released");
    eq(await xp.payableState(o.x402Ref), "payable", "FB2 USDC payable again");
  }
  // FB2: a re-confirm on a reorged (pre-acceptance) binding -> manual_review, never a silent duplicate.
  {
    const m = mk();
    const o = await bound(m, 4, 7);
    paid(m, o.bindingId, [{ txid: tx(31), vout: 0, value_sat: 40000, height: 200005 }]);
    await processBtcEvents(m.d);
    reorg(m, o.bindingId, [{ txid: tx(31), vout: 0 }]);
    await processBtcEvents(m.d);
    paid(m, o.bindingId, [{ txid: tx(31), vout: 0, value_sat: 40000, height: 200012 }], 200013);
    eq((await processBtcEvents(m.d)).outcomes, ["manual_review"], "FB2 re-confirm -> manual_review");
    eq(refundsOf(m, o.bindingId), [["duplicate", 40000]], "FB2 refund row for the uncredited money");
  }
  // SF1: refund rail and units follow the ref.
  {
    const o = { id: "o1", rail: "btc_onchain" } as unknown as Parameters<typeof refundRow>[0];
    const r = refundRow(o, "x402mock_abc", 0, "duplicate", 5_000_000, 1, "eip155:84532");
    eq([r.rail, r.network], ["x402_usdc", "eip155:84532"], "SF1 x402 ref on a BTC-rail order refunds USDC on its network");
    eq(refundRow({ ...o, rail: "x402_usdc" } as typeof o, "btc:x", 0, "late", 9000, 1, BTC_SIGNET_NETWORK).rail, "btc_onchain", "SF1 btc ref refunds sats");
  }
  // SF2 + (g): killed / agent stopped / gap stop between pick and first display -> not shown, binding NOT refused.
  {
    const m = mk();
    const ord = await order(m);
    const c = (await createBtcBinding(m.d, { rental_id: ord.rid, creator_secret: ord.sec })) as { result: { bindingId: string } };
    attest(m, c.result.bindingId, 11);
    m.setKill(true);
    const s1 = (await btcStatus(m.d, { rental_id: ord.rid, creator_secret: ord.sec })) as { result: Record<string, unknown> };
    eq([s1.result.state, s1.result.address], ["unavailable", undefined], "SF2 killed -> no fresh address");
    eq(m.btcStore.bindings.get(c.result.bindingId)!.status, "awaiting_payment", "SF2 temporary: binding kept");
    m.setKill(false);
    for (const over of [{ stop_file: true }, { gap_stopped: true }]) {
      m.beat(over);
      const s = (await btcStatus(m.d, { rental_id: ord.rid, creator_secret: ord.sec })) as { result: Record<string, unknown> };
      eq(s.result.state, "unavailable", "SF2/(g) agent stop flag -> not shown: " + Object.keys(over)[0]);
    }
    m.beat();
    const s2 = (await btcStatus(m.d, { rental_id: ord.rid, creator_secret: ord.sec })) as { result: Record<string, unknown> };
    eq(s2.result.state, "pay", "SF2 shown once healthy");
  }
  // (g) the gap-limit line: unused_run >= 90 % of gap_limit hides BTC even without the flag.
  {
    const m = mk();
    m.beat({ gap_limit: 20, unused_run: 17 });
    ok((await btcAvailability(m.d)).ok, "(g) 85 % of the gap: still offered (agent alerts at 75 %)");
    m.beat({ gap_limit: 20, unused_run: 18 });
    eq((await btcAvailability(m.d) as { reason?: string }).reason, "agent_gap", "(g) 90 % of the gap: stop");
    m.beat({ gap_limit: 200, unused_run: 150 });
    ok((await btcAvailability(m.d)).ok, "(g) gap raised to 200: offered");
    m.beat({ gap_limit: 0 });
    eq((await btcAvailability(m.d)).ok, false, "(g) gap_limit 0 fails closed");
  }
  // SF3: heartbeat signed > 60 s in the future is refused.
  {
    const m = mk();
    m.btcStore.beat(hb(m.nowS() + 120), m.d.now());
    const c = btcConfig(ENV_ON, { keys: KEYS });
    eq(c.ok && (await heartbeatState(m.d, c.ready) as { reason?: string }).reason, "heartbeat_future", "SF3 future heartbeat refused");
    m.btcStore.beat(hb(m.nowS() + 30), m.d.now());
    eq(c.ok && (await heartbeatState(m.d, c.ready)).ok, true, "SF3 +30 s accepted");
  }
  // SF4: per-IP status limit (60/min); a KV outage falls back to the in-memory window (never fails open).
  {
    const m = mk();
    const o = await bound(m);
    const env = { RENTALS_HUMAN_CHECKOUT: "1", RENTALS_PHASE2_ENABLED: "1", RENTALS_PHASE2_MODE: "staging", ...ENV_ON };
    let n = 0;
    const incr = async () => ({ count: ++n, ttlSec: 60 });
    const body = { rental_id: o.rid, creator_secret: o.sec };
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await handleBtcStatus(body, { env, deps: m.d, incr, ipBucket: "ip9" })).status;
    eq(last, 429, "SF4 61st status poll in a minute limited");
    const kvDown = { env, deps: m.d, incr: async () => null, ipBucket: "ip-sf4-local", nowMs: () => 1_000_000 };
    eq((await handleBtcStatus(body, kvDown)).status, 200, "SF4 KV outage: renter can still read (local window)");
    for (let i = 0; i < 59; i++) await handleBtcStatus(body, kvDown);
    eq((await handleBtcStatus(body, kvDown)).status, 429, "SF4 KV outage: 61st poll limited by the in-memory window");
    eq((await handleBtcStatus(body, { ...kvDown, ipBucket: "ip-sf4-throw", incr: async () => { throw new Error("kv"); } })).status, 200, "SF4 KV throwing: local window, first poll ok");
    eq((await handleBtcStatus(body, { ...kvDown, ipBucket: "ip-sf4-local", nowMs: () => 1_061_000 })).status, 200, "SF4 local window resets after a minute");
  }
  // SF5: overlapping first displays (two tabs) never refuse the binding.
  {
    const m = mk();
    const o = await bound(m);
    const c = btcConfig(ENV_ON, { keys: KEYS });
    assert.ok(c.ok);
    const stale = { ...m.btcStore.bindings.get(o.bindingId)!, displayOkAt: null };
    eq((await firstDisplay(m.d, stale, c.ready)).ok, true, "SF5 the other tab already displayed it: ok");
    m.btcStore.bindings.set(o.bindingId, { ...m.btcStore.bindings.get(o.bindingId)!, displayOkAt: null });
    const r = await firstDisplay(m.d, stale, c.ready) as { ok: boolean; temporary?: boolean };
    eq([r.ok, r.temporary], [false, true], "SF5 nonce race without a display: temporary, not refused");
  }
  // SF7: <= 5,000 sat is never auto-queued (the alert still fires).
  {
    const m = mk();
    const o = await bound(m);
    paid(m, o.bindingId, [{ txid: tx(32), vout: 0, value_sat: 5000, height: 200005 }]);
    await processBtcEvents(m.d);
    m.tick(60_000); m.beat({ tip_height: 200145 });
    await sweepBtc(m.d);
    eq(refundsOf(m, o.bindingId), [], "SF7 dust not queued");
    ok(m.store.alerts.some((a) => a.kind === "btc_underpaid"), "SF7 alert still sent");
  }
  // SF8: rigs stay held while a shown BTC address waits for confirmations (past the 15-min USDC window).
  {
    const m = mk();
    const o = await bound(m, 2);
    eq(await btcHeldRigs(m.d, m.d.now()), 0, "SF8 inside the pay window rigsSoftHeld covers it");
    m.tick(20 * 60_000);
    eq(await btcHeldRigs(m.d, m.d.now()), 2, "SF8 held after the USDC window while BTC confirms");
    void o;
  }
  // FB3 (a): age counts from the FIRST failure, not received_at: an event that waited out a 3 h outage survives one error.
  {
    const m = mk();
    const o = await bound(m);
    paid(m, o.bindingId, [{ txid: tx(33), vout: 0, value_sat: o.amount, height: 200005 }]);
    m.tick(3 * 60 * 60_000); m.beat();
    const real = m.store.getOrder.bind(m.store);
    m.store.getOrder = async () => { throw new Error("db down"); };
    eq((await processBtcEvents(m.d)).outcomes, ["error"], "FB3a one transient error after a long outage: retried, not rejected");
    m.store.getOrder = real;
    eq((await processBtcEvents(m.d)).outcomes, ["settled"], "FB3a the real paid event still settles");
  }
  // FB3 (a)+(b): >= 5 failures but under an hour -> still retried; past an hour from the first failure -> given up, and the
  // binding moves to manual_review (event_stuck) with the event marked in the same step.
  {
    const m = mk();
    const o = await bound(m);
    paid(m, o.bindingId, [{ txid: tx(39), vout: 0, value_sat: o.amount, height: 200005 }]);
    const real = m.store.getOrder.bind(m.store);
    m.store.getOrder = async () => { throw new Error("db down"); };
    for (let i = 0; i < STUCK_EVENT_ATTEMPTS + 1; i++) { eq((await processBtcEvents(m.d)).outcomes, ["error"], `FB3a failure ${i + 1} within the hour: retried`); m.tick(5 * 60_000); }
    m.tick(STUCK_EVENT_MS);
    eq((await processBtcEvents(m.d)).outcomes, ["rejected:btc_event_stuck"], "FB3a >= 5 failures over >= 1 h: given up");
    m.store.getOrder = real;
    const b = m.btcStore.bindings.get(o.bindingId)!;
    eq([b.status, b.statusReason], ["manual_review", "event_stuck"], "FB3b binding -> manual_review (event_stuck)");
    eq(m.btcStore.events[0].outcome, "rejected:btc_event_stuck", "FB3b event marked");
    ok(m.store.alerts.some((a) => a.kind === "btc_event_stuck") && m.store.alerts.some((a) => a.kind === "btc_event_stuck_manual"), "FB3b alerts");
    eq((await m.store.listJobs(o.rid)).length, 0, "FB3b never provisioned");
  }
  // FB3 (a)+(b): a StaleVersion that never clears counts as a failure too (can't block the queue forever); the binding
  // CAS fallback moves it to manual_review even when the accept transaction keeps failing.
  {
    const m = mk();
    const o = await bound(m);
    paid(m, o.bindingId, [{ txid: tx(40), vout: 0, value_sat: o.amount, height: 200005 }]);
    const realAccept = m.btcStore.acceptPaid.bind(m.btcStore);
    m.btcStore.acceptPaid = async () => { throw new StaleVersion(); };
    const outs: string[] = [];
    for (let i = 0; i < STUCK_EVENT_ATTEMPTS - 1; i++) { outs.push(...(await processBtcEvents(m.d)).outcomes); m.tick(20 * 60_000); }
    eq(outs, Array(STUCK_EVENT_ATTEMPTS - 1).fill("retry"), "FB3a persistent StaleVersion retried (counted)");
    eq(m.btcStore.events[0].attempts, STUCK_EVENT_ATTEMPTS - 1, "FB3a StaleVersion attempts counted");
    eq((await processBtcEvents(m.d)).outcomes, ["rejected:btc_event_stuck"], "FB3a persistent StaleVersion given up");
    m.btcStore.acceptPaid = realAccept;
    eq([m.btcStore.bindings.get(o.bindingId)!.status, m.btcStore.bindings.get(o.bindingId)!.statusReason], ["manual_review", "event_stuck"], "FB3b fallback CAS -> manual_review");
    ok(m.btcStore.events[0].processedAt != null, "FB3b event no longer blocks the queue");
  }
  // FB3 (b): a stuck NON-money event (seen) is only marked; a stuck money event whose binding can't be read is kept
  // (unmarked, alerted) rather than dropped.
  {
    const m = mk();
    const o = await bound(m);
    const id = m.btcStore.report(agentEnv(m, o.bindingId, "seen", { seen_sat: 1000, outpoints: [{ txid: tx(41), vout: 0, value_sat: 1000, height: 0 }], tip_height: 200003, tip_hash: "aa".repeat(32) }) as unknown as { payload: Record<string, unknown> });
    const realGet = m.btcStore.getBinding.bind(m.btcStore);
    m.btcStore.getBinding = async () => { throw new Error("db down"); };
    for (let i = 0; i < STUCK_EVENT_ATTEMPTS; i++) { await processBtcEvents(m.d); m.tick(20 * 60_000); }
    eq(m.btcStore.events.find((e) => e.id === id)!.outcome, "rejected:btc_event_stuck", "FB3b stuck seen event marked");
    const pid = paid(m, o.bindingId, [{ txid: tx(43), vout: 0, value_sat: o.amount, height: 200005 }]).id;
    const last: string[] = [];
    const stuckAlerts = () => m.store.alerts.filter((a) => a.kind === "btc_event_stuck").length;
    const before = stuckAlerts();
    for (let i = 0; i < STUCK_EVENT_ATTEMPTS; i++) { last.splice(0, 9, ...(await processBtcEvents(m.d)).outcomes); m.tick(20 * 60_000); }
    eq(last, ["stuck_unmarked"], "FB3b money event with an unreadable binding is kept, not dropped");
    for (let i = STUCK_EVENT_ATTEMPTS; i < 20; i++) await processBtcEvents(m.d); // status polls: many retries in a minute
    eq(stuckAlerts() - before, 3, "R3(1) repeated stuck alert throttled: attempts 5, 8, 16 only (of 20)");
    ok(m.btcStore.events.find((e) => e.id === pid)!.processedAt == null, "FB3b paid event still pending");
    m.btcStore.getBinding = realGet;
    eq(m.btcStore.bindings.get(o.bindingId)!.status, "awaiting_payment", "FB3b binding untouched (seen never moved it)");
    m.beat();
    const after = (await processBtcEvents(m.d)).outcomes;
    ok(after.length === 1 && !after[0].startsWith("rejected"), "FB3b once readable, the kept paid event is processed normally: " + after.join());
  }
  // R3(2): pending order = never-failed first, then least recently failed, so failing events can't starve the queue.
  {
    const m = mk();
    const o = await bound(m);
    const ids = [1, 2, 3].map((i) => m.btcStore.report(agentEnv(m, o.bindingId, "seen", { seen_sat: 1000, outpoints: [{ txid: tx(3000 + i), vout: 0, value_sat: 1000, height: 0 }], tip_height: 200003, tip_hash: "aa".repeat(32) }) as unknown as { payload: Record<string, unknown> }));
    await m.btcStore.noteEventFailure(ids[0], "x"); m.tick(1000);
    await m.btcStore.noteEventFailure(ids[1], "x"); m.tick(1000);
    await m.btcStore.noteEventFailure(ids[0], "x");
    eq((await m.btcStore.pendingEvents(10)).map((e) => e.id), [ids[2], ids[1], ids[0]], "R3(2) fresh first, then least recently failed");
    eq((await m.btcStore.pendingEvents(1)).map((e) => e.id), [ids[2]], "R3(2) a full page of failures never hides a fresh event");
  }
  // Outpoint cap: 20 (= the node verifier). 21 outputs -> manual_review + alert, never settled; 20 settles.
  {
    const m = mk();
    const o = await bound(m, 4, 7);
    const many = (n: number, base: number) => Array.from({ length: n }, (_, i) => ({ txid: tx(base + i), vout: 0, value_sat: Math.ceil(o.amount / n) + 1, height: 200005 }));
    eq(BTC_MAX_OUTPOINTS, 20, "outpoint cap = 20");
    paid(m, o.bindingId, many(21, 1000));
    eq((await processBtcEvents(m.d)).outcomes, ["manual:outpoint_cap"], "21 outpoints -> manual");
    const b = m.btcStore.bindings.get(o.bindingId)!;
    eq([b.status, b.statusReason, b.creditedSat], ["manual_review", "outpoint_cap", 0], "outpoint cap: manual_review, nothing credited");
    eq([(await m.store.listJobs(o.rid)).length, m.btcStore.outpoints.size, (await m.store.getOrderByPublicId(o.rid))!.state], [0, 0, "awaiting_payment"], "outpoint cap: never settled, no outpoints recorded");
    ok(m.store.alerts.some((a) => a.kind === "btc_outpoint_cap"), "outpoint cap alert");
    const m2 = mk();
    const o2 = await bound(m2, 4, 7);
    paid(m2, o2.bindingId, Array.from({ length: 20 }, (_, i) => ({ txid: tx(2000 + i), vout: 0, value_sat: Math.ceil(o2.amount / 20), height: 200005 })));
    ok((await processBtcEvents(m2.d)).outcomes[0].startsWith("settled"), "20 outpoints settle");
    eq(verifyJob((await m2.store.listJobs(o2.rid))[0], { keys: { t1: JPUB }, expectEnv: "staging", nowSec: m2.nowS(), ledger: memLedger(), caps: CAPS }), { ok: true }, "20-outpoint job verifies");
  }
  // Agent r1 fallback: a money-holding binding (underpaid) with a silent agent for 24 h -> manual_review, no refund queued.
  {
    const m = mk();
    const o = await bound(m, 4, 7);
    paid(m, o.bindingId, [{ txid: tx(42), vout: 0, value_sat: 30000, height: 200005 }]);
    eq((await processBtcEvents(m.d)).outcomes, ["underpaid_waiting"], "r1 underpaid waiting for a top-up");
    m.tick(BTC_STALL_MS - 60_000);
    eq((await sweepBtc(m.d)).manual, 0, "r1 stale agent, under 24 h: waits (S10)");
    m.tick(120_000);
    eq((await sweepBtc(m.d)).manual, 1, "r1 stale agent, 24 h: manual_review");
    eq([m.btcStore.bindings.get(o.bindingId)!.status, m.btcStore.bindings.get(o.bindingId)!.statusReason], ["manual_review", "agent_stalled"], "r1 agent_stalled");
    eq(refundsOf(m, o.bindingId), [], "r1 nothing auto-refunded on a stall");
    ok(m.store.alerts.some((a) => a.kind === "btc_agent_stalled"), "r1 alert");
  }
  // (d) BTC max term 7 days (the DB keeps 1-30); the offer carries maxDays.
  {
    const m = mk();
    const o8 = await order(m, 1, BTC_MAX_DAYS + 1);
    eq((await createBtcBinding(m.d, { rental_id: o8.rid, creator_secret: o8.sec }) as { error?: string }).error, "not_payable", "(d) 8-day order: Bitcoin refused");
    eq((await btcOffer(m.d))?.maxDays, 7, "(d) offer says 7 days");
    const o7 = await order(m, 1, BTC_MAX_DAYS);
    ok((await createBtcBinding(m.d, { rental_id: o7.rid, creator_secret: o7.sec })).ok, "(d) 7-day order: ok");
  }
  // (e) "seen" -> confirming (no QR, not credited), then paid settles.
  {
    const m = mk();
    const o = await bound(m);
    m.btcStore.report(agentEnv(m, o.bindingId, "seen", { seen_sat: o.amount, outpoints: [{ txid: tx(34), vout: 0, value_sat: o.amount, height: 0 }], tip_height: 200003, tip_hash: "aa".repeat(32) }) as unknown as { payload: Record<string, unknown> });
    eq((await processBtcEvents(m.d)).outcomes, ["seen"], "(e) seen accepted");
    const s = (await btcStatus(m.d, { rental_id: o.rid, creator_secret: o.sec })) as { result: Record<string, unknown> };
    eq([s.result.state, "bip21" in s.result, m.btcStore.bindings.get(o.bindingId)!.creditedSat], ["confirming", false, 0], "(e) confirming, no QR, nothing credited");
    eq(m.btcStore.outpoints.size, 0, "(e) seen records no outpoints");
    paid(m, o.bindingId, [{ txid: tx(34), vout: 0, value_sat: o.amount, height: 200005 }]);
    eq((await processBtcEvents(m.d)).outcomes, ["settled"], "(e) paid after seen settles");
    const bad = agentEnv(m, o.bindingId, "seen", { seen_sat: 1, outpoints: [{ txid: tx(35), vout: 0, value_sat: 2, height: 0 }], tip_height: 200003, tip_hash: "aa".repeat(32) });
    eq((verifyEnvelope(bad, { keys: KEYS, refSec: m.nowS() }) as { reason: string }).reason, "env_seen", "(e) seen_sat must equal the outputs");
  }
  // (e) "underpaid" (agent's final shortfall after confirm_by) -> refund queue + btc_underpaid (NB1).
  {
    const m = mk();
    const o = await bound(m, 4, 7);
    const outs = [{ txid: tx(36), vout: 0, value_sat: o.amount - 50000, height: 200005 }];
    m.btcStore.report(agentEnv(m, o.bindingId, "underpaid", { received_sat: o.amount - 50000, outpoints: outs, tip_height: 200145, tip_hash: "bb".repeat(32) }) as unknown as { payload: Record<string, unknown> });
    eq((await processBtcEvents(m.d)).outcomes, ["underpaid_refund"], "(e) underpaid event");
    eq(refundsOf(m, o.bindingId), [["underpaid", o.amount - 50000]], "(e) shortfall -> refund queue");
    eq([m.btcStore.bindings.get(o.bindingId)!.status, (await m.store.getOrderByPublicId(o.rid))!.state], ["refund_pending", "refund_pending"], "(e) binding + order refund_pending");
    ok(m.store.alerts.some((a) => a.kind === "btc_underpaid"), "(e) btc_underpaid alert");
    const early = agentEnv(m, o.bindingId, "underpaid", { received_sat: 10, outpoints: [{ txid: tx(37), vout: 0, value_sat: 10, height: 200005 }], tip_height: 200144, tip_hash: "bb".repeat(32) });
    eq((verifyEnvelope(early, { keys: KEYS, refSec: m.nowS() }) as { reason: string }).reason, "env_underpaid", "(e) underpaid only after confirm_by");
    const full = agentEnv(m, o.bindingId, "underpaid", { received_sat: o.amount, outpoints: [{ txid: tx(38), vout: 0, value_sat: o.amount, height: 200005 }], tip_height: 200145, tip_hash: "bb".repeat(32) });
    eq((verifyEnvelope(full, { keys: KEYS, refSec: m.nowS() }) as { reason: string }).reason, "env_underpaid", "(e) underpaid must be short");
  }
}

(async () => {
  await snippetParity();
  await flows();
  await fixes();
  await bayGate();
  console.log(`test-btc-rail: ok (${passed} assertions)`);
})().catch((e) => { console.error(e); process.exit(1); });
