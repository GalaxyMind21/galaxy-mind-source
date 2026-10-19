// Solana USDC rail (x402 "exact" on SVM). Tx parser + builder, ATA derivation against mainnet vectors,
// pre-verify (EXACT amount, pinned mint, payTo ATA, memo = orderRef, fee-payer isolation, no lookup
// tables, 2 signers, CU caps, payer signature), the independent on-chain check, X402Provider dispatch
// across Base + Solana (pinning, pay guard, idempotency, extensions), confirmPayment -> signed job with
// the settled network, and the network-aware job schema (rev 1.6).
import { TEST_PAYTO_EVM as PINNED_PAYTO, TEST_PAYTO_SOLANA as PINNED_SOLANA_PAYTO, TEST_PAYTO_PINS } from "./lib/test-payto";
const SOLENV = { RENTALS_PAYTO_PIN_SOLANA: PINNED_SOLANA_PAYTO };
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  parseTransaction, buildPaymentTx, b58encode, b58decode, associatedTokenAddress, isPubkey, isSolanaSig, validTxId, validPayTo, shortVec,
  TOKEN_PROGRAM, MEMO_PROGRAM,
} from "../src/lib/rentals/phase2/solana-tx";
import { SolanaExact, SOLANA_DEVNET, SOLANA_MAINNET, DROP_MARGIN_BLOCKS, solanaFromEnv, keyedMainnetRpc, mainnetRpcProvider, clearBlockhashCache, SOLANA_COMMITMENT, SOLANA_PAY_BUDGET_MS, type SolanaPayload } from "../src/lib/rentals/phase2/solana";
import { X402Provider, BASE_SEPOLIA, clearRecheckCache } from "../src/lib/rentals/phase2/x402";
import fs from "node:fs";
import type { X402Requirements } from "../src/lib/rentals/phase2/providers";
import { MemoryStore, PendingReadError, PENDING_LIST_CAP } from "../src/lib/rentals/phase2/store";
import { MockAlerter } from "../src/lib/rentals/phase2/safety";
import { createRental, confirmPayment, cancelRental, sweepPending, reofferOrExpire, PENDING_ALERT_MS, SOL_MAYBE_PAID, SWEEP_PENDING_BUDGET_MS, type Deps } from "../src/lib/rentals/phase2/service";
import { SupabaseStore } from "../src/lib/rentals/phase2/store-supabase";
import { schemaOk, verifyJob, type NonceLedger } from "../src/lib/rentals/phase2/jobs";
import { MAX_TERM_SEC } from "../src/lib/rentals/phase2/pricing";
import { POOL_HOST_SUFFIXES, POOL_PORTS } from "../src/lib/rentals/phase2/validate";
import { schemaOk as nodeSchemaOk } from "./rentals/verify-job-snippet.mjs";
import { RENTAL_TERMS_VERSION } from "../src/lib/rentals/phase2/terms";
import { pickSolanaRequirement, buildSolanaPayment, solanaPaymentHeader, solanaTxLink, canPay, type SolanaChain } from "../src/lib/rentals/phase2/solana-wallet";
import { pickRequirement, safeTxId, payErrorCopy, PAY_ERROR_COPY } from "../src/lib/rentals/phase2/human-wallet";
import { chainInfo } from "../src/lib/rentals/phase2/human";

const CAPS = { maxRigs: 4, maxSec: MAX_TERM_SEC, hostSuffixes: POOL_HOST_SUFFIXES, ports: POOL_PORTS };
const memLedger = (): NonceLedger => { const m = new Set<string>(); return { has: (n, j, a) => m.has("n" + n) || m.has("j" + j) || (!!a && m.has("a" + a)), add: (n, j, a) => { m.add("n" + n); m.add("j" + j); if (a) m.add("a" + a); } }; };
const T0 = Date.parse("2026-10-17T10:00:00Z");
const PRICING = { marketAskBtcPhDay: 0.00052, floorBtcPhDay: 0.000501, hashpriceSatsThDay: 47, writtenAt: T0 - 3600_000 };
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const PRIV = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUB = publicKey.export({ type: "spki", format: "pem" }).toString();

const kp = () => { const sk = ed25519.utils.randomSecretKey(); return { sk, pk: b58encode(ed25519.getPublicKey(sk)) }; };
const SPONSOR = kp();
const BH = b58encode(crypto.randomBytes(32));
const NET = SOLANA_DEVNET;

/** Client side: build + sign exactly like the browser does. */
function clientTx(req: X402Requirements, payer: { sk: Uint8Array; pk: string }, over: Partial<Parameters<typeof buildPaymentTx>[0]> = {}) {
  const raw = buildPaymentTx({ feePayer: req.extra.feePayer!, payer: payer.pk, mint: req.asset, payTo: req.payTo, amount: BigInt(req.amount), decimals: 6, memo: req.extra.memo!, recentBlockhash: BH, ...over });
  const p = parseTransaction(raw);
  raw.set(ed25519.sign(p.message, payer.sk), 1 + 64);
  return raw;
}
const payloadOf = (req: X402Requirements, raw: Uint8Array): SolanaPayload => ({ x402Version: 2, accepted: { ...req } as unknown as Record<string, unknown>, payload: { transaction: Buffer.from(raw).toString("base64") } });

/** Fake facilitator (supported/verify/settle) + Solana RPC that confirms whatever the sponsor co-signed. */
function fakeSolana(o: { tamper?: (tx: any) => void; verifyValid?: boolean; settle?: boolean; hold?: { on: boolean }; sigStatus?: { v: unknown }; height?: { v: number }; net?: string } = {}) {
  const calls: string[] = [];
  const commitments: string[] = [];
  let lastRaw: Uint8Array | null = null;
  const f = (async (url: string, init: { method?: string; body?: string }) => {
    const u = String(url);
    if (u.endsWith("/supported")) { calls.push("supported"); return new Response(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: o.net ?? NET.network, extra: { feePayer: SPONSOR.pk } }] })); }
    const body = JSON.parse(init.body ?? "{}");
    if (u.endsWith("/verify")) { calls.push("verify"); lastRaw = Uint8Array.from(Buffer.from(body.paymentPayload.payload.transaction, "base64")); return new Response(JSON.stringify({ isValid: o.verifyValid ?? true })); }
    if (u.endsWith("/settle")) {
      calls.push("settle");
      if (o.settle === false) return new Response(JSON.stringify({ success: false }), { status: 400 });
      const p = parseTransaction(lastRaw!);
      return new Response(JSON.stringify({ success: true, transaction: b58encode(ed25519.sign(p.message, SPONSOR.sk)), network: NET.network }));
    }
    if (body.method === "getLatestBlockhash") calls.push("blockhash");
    if (body.method === "getSignatureStatuses") { calls.push("sigStatus"); assert.equal(body.params[1]?.searchTransactionHistory, true); return new Response(JSON.stringify({ result: { value: [o.sigStatus ? o.sigStatus.v : { confirmationStatus: "processed" }] } })); }
    if (body.method === "getBlockHeight") { calls.push("height"); assert.equal(body.params[0]?.commitment, "finalized"); return new Response(JSON.stringify({ result: o.height?.v ?? 1 })); }
    if (body.method === "getLatestBlockhash") return new Response(JSON.stringify({ result: { value: { blockhash: BH, lastValidBlockHeight: 1234 } } }));
    if (body.method === "getTransaction") {
      calls.push("getTransaction");
      commitments.push(String(body.params[1]?.commitment));
      if (o.hold?.on) return new Response(JSON.stringify({ result: null })); // not finalized yet
      const p = parseTransaction(lastRaw!);
      const sig0 = b58encode(ed25519.sign(p.message, SPONSOR.sk));
      if (body.params[0] !== sig0) return new Response(JSON.stringify({ result: null }));
      const t = p.instructions[2], [src, mint, dst, auth] = t.accounts;
      const amount = new DataView(t.data.buffer, t.data.byteOffset).getBigUint64(1, true).toString();
      const memo = new TextDecoder().decode(p.instructions[3].data);
      const keys = p.accountKeys.map((k) => ({ pubkey: k }));
      const dstIdx = p.accountKeys.indexOf(dst);
      const tx: any = {
        meta: { err: null, innerInstructions: [], preTokenBalances: [{ accountIndex: dstIdx, mint, owner: PINNED_SOLANA_PAYTO, programId: TOKEN_PROGRAM, uiTokenAmount: { amount: "5000000" } }], postTokenBalances: [{ accountIndex: dstIdx, mint, owner: PINNED_SOLANA_PAYTO, programId: TOKEN_PROGRAM, uiTokenAmount: { amount: (BigInt(5000000) + BigInt(amount)).toString() } }] },
        transaction: { signatures: [sig0, b58encode(p.signatures[1])], message: { accountKeys: keys, instructions: [
          { programId: "ComputeBudget111111111111111111111111111111", accounts: [], data: "x" },
          { programId: "ComputeBudget111111111111111111111111111111", accounts: [], data: "y" },
          { program: "spl-token", programId: TOKEN_PROGRAM, parsed: { type: "transferChecked", info: { source: src, mint, destination: dst, authority: auth, tokenAmount: { amount, decimals: 6 } } } },
          { program: "spl-memo", programId: MEMO_PROGRAM, parsed: memo },
        ] } },
      };
      o.tamper?.(tx);
      return new Response(JSON.stringify({ result: tx }));
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls, commitments };
}
const sx = (f: typeof fetch, over: Partial<ConstructorParameters<typeof SolanaExact>[0]> = {}) => new SolanaExact({ net: NET, payTo: PINNED_SOLANA_PAYTO, payToPins: TEST_PAYTO_PINS, fetchImpl: f, rpcDeadlineMs: 0, sleep: async () => {}, now: () => T0, ...over });

const CDP_TEST = { keyId: "test-key", secret: Buffer.from(crypto.randomBytes(64)).toString("base64") };
function mk(fake = fakeSolana(), withSolana = true, solNet = NET) {
  let now = T0;
  const store = new MemoryStore();
  const solana = withSolana ? new SolanaExact({ net: solNet, payTo: PINNED_SOLANA_PAYTO, payToPins: TEST_PAYTO_PINS, fetchImpl: fake.f, rpcDeadlineMs: 0, sleep: async () => {}, now: () => now, ...(solNet.auth === "cdp" ? { cdp: CDP_TEST } : {}) }) : undefined;
  const xp = new X402Provider({ net: BASE_SEPOLIA, payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://preview.example", store, fetchImpl: fake.f, now: () => now, rpcDeadlineMs: 0, sleep: async () => {}, solana });
  const d: Deps = {
    store, providers: { x402_usdc: xp }, pricing: async () => PRICING, btcUsd: async () => 82000, now: () => now,
    signingKeyPem: PRIV, signingKid: "t1", codeHmacKey: "k".repeat(32), killSwitch: async () => false,
    alerter: new MockAlerter(), lightningEnabled: false, pilot: true, bays: [1, 2, 3, 4], payNetwork: BASE_SEPOLIA.network,
  };
  return { d, store, xp, fake, tick: (ms: number) => { now += ms; } };
}
const order = (m: ReturnType<typeof mk>) => createRental(m.d, { rigs: 1, days: 1, pool_id: "braiins", username: "alice.rig1", accept_terms: true, terms_version: RENTAL_TERMS_VERSION, idempotency_key: crypto.randomBytes(12).toString("hex") } as never) as Promise<any>;

(async () => {
  // ── Encoding, ATA vectors (validated against mainnet USDC accounts) ──────
  {
    const v = crypto.randomBytes(32); assert.deepEqual(b58decode(b58encode(v)), Uint8Array.from(v));
    assert.equal(b58encode(new Uint8Array([0, 0, 1])), "112", "leading zeros");
    assert.equal(b58decode("0OIl"), null, "non-base58 refused");
    const M = SOLANA_MAINNET.asset;
    assert.equal(associatedTokenAddress("G1akTFPgLURSYcsnYSvuNrZomVFy4XCGsQF5QJkgWyEP", M), "6HXfJ3S59goJkhz3BcCjwhrRJMQmX38meuqSBqN8ToK");
    assert.equal(associatedTokenAddress("2dyTwqYbDT2NwvCSZ55mep3Cnom1YzBqBA5Rdwn6yqTn", M), "EjyhRdvu3iNPngdoUcwaG6q5bTF7BUUT2vig5t7nXfR8");
    assert.equal(associatedTokenAddress("CmVST5LAWw772YppGkotVmWoS5mE2cTXqZzbz7oSNBzN", M), "5vCCFts7WWeC5rwHusYLxbMtojQnrRwmLaTt4advSuaG");
    assert.equal(associatedTokenAddress(PINNED_SOLANA_PAYTO, M), "3AgYFHXQvUX5Vz6ss5RNJ1RFLzp1SVM2zit6njDK7voG", "payTo's USDC account (synthetic pin from scripts/test.env)");
    assert.ok(isPubkey(PINNED_SOLANA_PAYTO) && !isPubkey("0xBb99fB2b8a2A2Cf71C4392B1EB6720c43F409f40"));
    assert.ok(isSolanaSig(b58encode(crypto.randomBytes(64))) && !isSolanaSig("0x" + "ab".repeat(32)));
    assert.ok(validTxId("eip155:8453", "0x" + "ab".repeat(32)) && !validTxId("eip155:8453", "0x" + "AB".repeat(32)) && !validTxId("eip155:8453", b58encode(crypto.randomBytes(64))));
    assert.ok(validTxId(NET.network, b58encode(crypto.randomBytes(64))) && !validTxId(NET.network, "0x" + "ab".repeat(32)) && !validTxId("bip122:x", "0x" + "ab".repeat(32)));
    assert.ok(validPayTo(NET.network, PINNED_SOLANA_PAYTO) && !validPayTo(NET.network, PINNED_PAYTO) && validPayTo("eip155:8453", PINNED_PAYTO) && !validPayTo("eip155:8453", PINNED_SOLANA_PAYTO));
    assert.throws(() => new SolanaExact({ net: NET, payTo: "Csbv3pGmoxFyknn2K4Y59HKhX5iJ3ERZs7gKcSu3xtbT" }), /bad_solana_payto/, "payTo pinned in code");
    assert.throws(() => new SolanaExact({ net: SOLANA_MAINNET, payTo: PINNED_SOLANA_PAYTO, payToPins: TEST_PAYTO_PINS }), /cdp_credentials_missing/, "mainnet needs CDP keys");
  }

  // ── Flag: off by default; mainnet only with mainnetEnabled ───────────────
  {
    assert.equal(solanaFromEnv({ ...SOLENV }, false, TEST_PAYTO_PINS), null, "off by default");
    assert.equal(solanaFromEnv({ ...SOLENV, RENTALS_SOLANA_ENABLED: "1" }, false, TEST_PAYTO_PINS)?.network, NET.network, "staging = devnet");
    assert.equal(solanaFromEnv({ ...SOLENV, RENTALS_SOLANA_ENABLED: "1", RENTALS_X402_NETWORK: "mainnet" }, false, TEST_PAYTO_PINS), null, "mainnet refused without mainnetEnabled");
    assert.equal(solanaFromEnv({ ...SOLENV, RENTALS_SOLANA_ENABLED: "1", RENTALS_X402_NETWORK: "mainnet" }, true, TEST_PAYTO_PINS), null, "mainnet refused without CDP keys");
    assert.equal(solanaFromEnv({ ...SOLENV, RENTALS_SOLANA_ENABLED: "1", RENTALS_SOLANA_RPC: "http://rpc.example" }, false, TEST_PAYTO_PINS), null, "https RPC only");
    assert.equal(solanaFromEnv({ ...SOLENV, RENTALS_SOLANA_ENABLED: "1", RENTALS_SOLANA_FEE_PAYER: "nope" }, false, TEST_PAYTO_PINS), null, "bad pin refused");
  }

  // ── Requirement: memo = orderRef, sponsor from /supported, pin honoured ──
  const fake = fakeSolana();
  const s = sx(fake.f);
  const req = (await s.requirement("gm_TESTORDER01", 12_340_000, "https://x/api/rentals/pay/x402_" + "a".repeat(32)))!;
  {
    assert.ok(req);
    assert.deepEqual([req.network, req.asset, req.payTo, req.amount, req.extra.memo, req.extra.orderRef, req.extra.feePayer], [NET.network, NET.asset, PINNED_SOLANA_PAYTO, "12340000", "gm_TESTORDER01", "gm_TESTORDER01", SPONSOR.pk]);
    assert.equal(await sx(fake.f, { feePayerPin: kp().pk }).requirement("gm_TESTORDER01", 1), null, "sponsor differs from pin = Solana not offered");
    assert.equal(await sx((async () => new Response("{}", { status: 500 })) as unknown as typeof fetch).requirement("gm_TESTORDER01", 1), null, "facilitator down = not offered");
    const bh = await s.latestBlockhash(); assert.equal(bh?.recentBlockhash, BH);
  }

  // ── Pre-verify: the happy path and every refusal ─────────────────────────
  const payer = kp();
  {
    const ok = s.preVerify(req, payloadOf(req, clientTx(req, payer)));
    assert.ok(ok.ok && ok.payer === payer.pk, "valid tx passes");
    const pv = (raw: Uint8Array, r = req) => { const x = s.preVerify(r, payloadOf(r, raw)); return x.ok ? "ok" : x.error; };
    assert.equal(pv(clientTx(req, payer, { amount: BigInt(req.amount) + BigInt(1) })), "wrong_amount", "overpay refused (EXACT)");
    assert.equal(pv(clientTx(req, payer, { amount: BigInt(req.amount) - BigInt(1) })), "wrong_amount", "underpay refused");
    assert.equal(pv(clientTx(req, payer, { mint: SOLANA_MAINNET.asset })), "requirements_mismatch", "wrong mint");
    assert.equal(pv(clientTx(req, payer, { payTo: kp().pk })), "wrong_payto", "wrong destination");
    assert.equal(pv(clientTx(req, payer, { memo: "gm_OTHERORDER1" })), "requirements_mismatch", "memo of another order");
    assert.equal(pv(clientTx(req, payer, { decimals: 9 })), "requirements_mismatch", "wrong decimals");
    assert.equal(pv(clientTx(req, payer, { feePayer: kp().pk })), "requirements_mismatch", "other sponsor");
    assert.equal(pv(clientTx(req, payer, { cuPriceMicroLamports: BigInt(5_000_001) })), "invalid_payload", "CU price cap");
    assert.equal(pv(clientTx(req, payer, { cuLimit: 400_001 })), "invalid_payload", "CU limit cap");
    // Bad payer signature / unsigned.
    const unsigned = buildPaymentTx({ feePayer: SPONSOR.pk, payer: payer.pk, mint: req.asset, payTo: req.payTo, amount: BigInt(req.amount), decimals: 6, memo: "gm_TESTORDER01", recentBlockhash: BH });
    assert.equal(pv(unsigned), "invalid_payload", "unsigned refused");
    const other = kp(); const wrongSig = clientTx(req, payer); wrongSig.set(ed25519.sign(parseTransaction(wrongSig).message, other.sk), 65);
    assert.equal(pv(wrongSig), "invalid_payload", "signature by someone else refused");
    // Sponsor slot pre-filled.
    const pre = clientTx(req, payer); pre[1] = 7; assert.equal(pv(pre), "invalid_payload", "sponsor signature slot must be empty");
    // Payer = sponsor / fee payer referenced in an instruction (authority = sponsor).
    assert.throws(() => buildPaymentTx({ feePayer: SPONSOR.pk, payer: SPONSOR.pk, mint: req.asset, payTo: req.payTo, amount: BigInt(1), decimals: 6, memo: "m", recentBlockhash: BH }));
    // Hand-craft: authority index -> fee payer (0).
    const t = clientTx(req, payer); const pt = parseTransaction(t);
    const msgStart = t.length - pt.message.length;
    const hack = (mut: (m: Uint8Array) => void) => { const c = Uint8Array.from(t); const m = c.subarray(msgStart); mut(m); c.set(ed25519.sign(m, payer.sk), 65); return c; };
    const find = (m: Uint8Array, seq: number[]) => { for (let i = 0; i < m.length; i++) if (seq.every((b, j) => m[i + j] === b)) return i; return -1; };
    const ixAt = find(pt.message, [5, 4, 2, 4, 3, 1]); assert.ok(ixAt > 0, "found TransferChecked accounts");
    assert.equal(pv(hack((m) => { m[ixAt + 5] = 0; })), "invalid_payload", "fee payer as transfer authority refused");
    assert.equal(pv(hack((m) => { m[ixAt + 2] = 0; })), "invalid_payload", "fee payer as source refused");
    // 3 required signers.
    assert.equal(pv(hack((m) => { m[1] = 3; })), "invalid_payload", "3 signers refused");
    // Lookup tables: flip the trailing lookup count to 1 (+ a fake table).
    const withAlt = (() => { const c = Uint8Array.from(t); const tail = new Uint8Array([...shortVec(1), ...crypto.randomBytes(32), ...shortVec(0), ...shortVec(0)]); const out = new Uint8Array(c.length - 1 + tail.length); out.set(c.subarray(0, c.length - 1)); out.set(tail, c.length - 1); out.set(ed25519.sign(out.subarray(msgStart), payer.sk), 65); return out; })();
    assert.equal(pv(withAlt), "invalid_payload", "address lookup tables refused");
    // Garbage / wrong protocol version.
    assert.equal(pv(Uint8Array.from(Buffer.from("AAAA", "base64"))), "invalid_payload", "garbage refused");
    const bad = { ...payloadOf(req, clientTx(req, payer)), x402Version: 1 } as unknown as SolanaPayload;
    assert.equal((s.preVerify(req, bad) as { error: string }).error, "invalid_payload", "x402Version 2 only");
    // Requirement itself must be the pinned one.
    assert.equal(pv(clientTx(req, payer), { ...req, payTo: kp().pk }), "requirements_mismatch", "unpinned payTo requirement refused");
    assert.equal(pv(clientTx(req, payer), { ...req, extra: { ...req.extra, memo: "x" } }), "requirements_mismatch", "memo must equal orderRef");
  }

  // ── Independent on-chain check ───────────────────────────────────────────
  {
    const run = async (tamper?: (tx: any) => void, accepted?: Partial<X402Requirements>) => {
      const fk = fakeSolana({ tamper });
      const ss = sx(fk.f);
      const r = (await ss.requirement("gm_TESTORDER01", 12_340_000))!;
      const p = payloadOf(r, clientTx(r, payer));
      if (accepted) p.accepted = { ...p.accepted, ...accepted } as Record<string, unknown>;
      const v = await ss.verifyAndSettle(r, T0 + 60_000, p);
      return { v: v.ok ? "ok" : v.error, calls: fk.calls };
    };
    const ok = await run(); assert.equal(ok.v, "ok", "settles when chain agrees");
    assert.equal((await run((tx) => { tx.meta.err = { InstructionError: [2, "x"] }; })).v, "onchain_check_failed", "failed tx");
    assert.equal((await run((tx) => { tx.transaction.message.instructions[2].parsed.info.tokenAmount.amount = "12340001"; })).v, "onchain_check_failed", "chain amount != exact");
    assert.equal((await run((tx) => { tx.transaction.message.instructions[2].parsed.info.mint = SOLANA_MAINNET.asset; })).v, "onchain_check_failed", "chain mint");
    assert.equal((await run((tx) => { tx.transaction.message.instructions[3].parsed = "gm_OTHER"; })).v, "onchain_check_failed", "chain memo");
    assert.equal((await run((tx) => { tx.transaction.message.instructions.push({ ...tx.transaction.message.instructions[3] }); })).v, "onchain_check_failed", "two memos on chain");
    assert.equal((await run((tx) => { tx.meta.innerInstructions = [{ instructions: [{ ...tx.transaction.message.instructions[2] }] }]; })).v, "onchain_check_failed", "second transfer into payTo (inner) refused");
    assert.equal((await run((tx) => { tx.transaction.signatures[1] = b58encode(crypto.randomBytes(64)); })).v, "onchain_check_failed", "settled tx not the one the payer signed");
    assert.equal((await run((tx) => { tx.meta.postTokenBalances[0].uiTokenAmount.amount = "5000001"; })).v, "onchain_check_failed", "balance delta must equal amount");
    assert.equal((await run((tx) => { tx.transaction.message.instructions[2].parsed.type = "transfer"; })).v, "onchain_check_failed", "only transferChecked");
    assert.equal((await run((tx) => { tx.transaction.message.addressTableLookups = [{}]; })).v, "onchain_check_failed", "no lookup tables on chain");
    // V12 (SF4): exactly one pre and one post balance for payTo's account (pinned mint, owner payTo); missing is never zero.
    assert.equal((await run((tx) => { tx.meta.preTokenBalances = []; tx.meta.postTokenBalances[0].uiTokenAmount.amount = "12340000"; })).v, "onchain_check_failed", "V12: missing pre balance is not zero (new account faking the delta)");
    assert.equal((await run((tx) => { tx.meta.postTokenBalances = []; })).v, "onchain_check_failed", "V12: missing post balance");
    assert.equal((await run((tx) => { tx.meta.preTokenBalances.push({ ...tx.meta.preTokenBalances[0] }); })).v, "onchain_check_failed", "V12: duplicate pre entry");
    assert.equal((await run((tx) => { tx.meta.postTokenBalances[0].owner = kp().pk; tx.meta.preTokenBalances[0].owner = tx.meta.postTokenBalances[0].owner; })).v, "onchain_check_failed", "V12: owner must be payTo");
    assert.equal((await run((tx) => { tx.meta.preTokenBalances[0].mint = SOLANA_MAINNET.asset; })).v, "onchain_check_failed", "V12: pre entry of another mint");
    // V12b / V12c (#103 S6): balance entries must belong to the classic SPL Token program (Tokenkeg).
    assert.equal((await run((tx) => { tx.meta.preTokenBalances[0].programId = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"; tx.meta.postTokenBalances[0].programId = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"; })).v, "onchain_check_failed", "V12b: Token-2022 balance entries refused");
    assert.equal((await run((tx) => { delete tx.meta.postTokenBalances[0].programId; })).v, "onchain_check_failed", "V12c: balance entry without programId refused");
    // SF8: accounts loaded from lookup tables in meta are refused too.
    assert.equal((await run((tx) => { tx.meta.loadedAddresses = { writable: [kp().pk], readonly: [] }; })).v, "onchain_check_failed", "SF8: loadedAddresses (writable)");
    assert.equal((await run((tx) => { tx.meta.loadedAddresses = { writable: [], readonly: [kp().pk] }; })).v, "onchain_check_failed", "SF8: loadedAddresses (readonly)");
    assert.equal((await run((tx) => { tx.meta.loadedAddresses = { writable: [], readonly: [] }; })).v, "ok", "empty loadedAddresses is fine");
    const lh = await run((tx) => { tx.transaction.message.instructions.push({ programId: "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95", accounts: [tx.transaction.message.instructions[2].parsed.info.destination], data: "z" }); });
    assert.equal(lh.v, "ok", "a Lighthouse assertion reading payTo's account is fine");
    // Exact-match on the accepted copy before any facilitator call.
    const mm = await run(undefined, { amount: "1" });
    assert.equal(mm.v, "requirements_mismatch"); assert.ok(!mm.calls.includes("verify"), "mismatch never reaches the facilitator");
    const mm2 = await run(undefined, { extra: { orderRef: "gm_TESTORDER01", memo: "gm_TESTORDER01", feePayer: kp().pk } } as never);
    assert.equal(mm2.v, "requirements_mismatch", "feePayer in accepted must match");
  }

  // ── X402Provider: Base + Solana from one order; dispatch, pinning, guard, idempotency ──
  {
    const m = mk();
    const cr = await order(m);
    assert.ok(cr.ok, JSON.stringify(cr));
    const ref = cr.result.payment.paymentRef;
    const accepts = cr.result.payment.accepts as X402Requirements[];
    assert.deepEqual(accepts.map((a) => a.network), [BASE_SEPOLIA.network, NET.network], "Base first, then Solana");
    assert.equal(cr.result.payment.http402.network, BASE_SEPOLIA.network, "http402 stays Base (old clients unchanged)");
    const sol = accepts[1];
    assert.equal(sol.amount, cr.result.payment.http402.amount, "same amount on both networks");
    assert.equal(sol.extra.memo, cr.result.rentalId, "memo = this order's public id");
    const pr = (await m.xp.paymentRequired(ref))!;
    assert.equal(pr.accepts.length, 2); assert.equal((pr.accepts[1].extra as { recentBlockhash?: string }).recentBlockhash, BH, "blockhash hint");
    // A Solana tx with accepted = Base -> refused (no cross-network reuse).
    const raw = clientTx(sol, payer);
    const crossed = { ...payloadOf(sol, raw), accepted: { ...cr.result.payment.http402 } };
    assert.equal((await m.xp.pay(ref, crossed as never) as { error: string }).error, "invalid_payload", "Solana tx under the Base requirement refused");
    // Unknown network.
    assert.equal((await m.xp.pay(ref, { ...payloadOf(sol, raw), accepted: { ...sol, network: "solana:mainnet-fake" } } as never) as { error: string }).error, "requirements_mismatch");
    // Order not payable -> before the facilitator.
    const before = m.fake.calls.filter((c) => c === "verify").length;
    // Happy path.
    const r = await m.xp.pay(ref, payloadOf(sol, raw));
    assert.ok(r.ok && r.network === NET.network && isSolanaSig(r.txHash) && r.payer === payer.pk, JSON.stringify(r));
    assert.equal(m.fake.calls.filter((c) => c === "verify").length, before + 1);
    const again = await m.xp.pay(ref, payloadOf(sol, raw));
    assert.ok(again.ok && again.replay && again.txHash === (r as { txHash: string }).txHash, "idempotent per ref");
    assert.equal(m.fake.calls.filter((c) => c === "verify").length, before + 1, "replay never re-calls the facilitator");
    const look = await m.xp.lookup(ref);
    assert.ok(look.found && look.paid && look.network === NET.network && look.payTo === PINNED_SOLANA_PAYTO);
    // confirmPayment -> signed route job carrying the Solana settlement.
    assert.equal((await confirmPayment(m.d, ref)).outcome, "settled");
    const job = m.store.jobs.find((j) => j.payload.action === "route")!;
    assert.equal(job.payload.payment!.network, NET.network, "job network = settled network");
    assert.equal(job.payload.payment!.tx_hash, (r as { txHash: string }).txHash, "job tx = Solana signature");
    assert.equal(job.payload.pay_to, PINNED_SOLANA_PAYTO, "job pay_to = Solana payTo");
    assert.deepEqual(verifyJob(job, { keys: { t1: PUB }, expectEnv: "staging", nowSec: job.payload.iat + 1, ledger: memLedger(), caps: CAPS }), { ok: true }, "job verifies (rev 1.6 schema)");
    assert.equal(nodeSchemaOk(job.payload, CAPS), null, "node snippet accepts it too");
    // A second order: Solana payment after cancel window -> 409 path (guard).
    const m2 = mk(); const c2 = await order(m2); const ref2 = c2.result.payment.paymentRef;
    const o2 = m2.store.orders.get([...m2.store.orders.keys()][0])!; m2.store.orders.set(o2.id, { ...o2, state: "expired" });
    const calls0 = m2.fake.calls.length;
    assert.equal((await m2.xp.pay(ref2, payloadOf(c2.result.payment.accepts[1], clientTx(c2.result.payment.accepts[1], payer))) as { error: string }).error, "order_not_payable");
    assert.ok(!m2.fake.calls.slice(calls0).includes("verify"), "pay guard runs before the facilitator on Solana too");
    // Expired.
    const m3 = mk(); const c3 = await order(m3); m3.tick(16 * 60_000);
    assert.equal((await m3.xp.pay(c3.result.payment.paymentRef, payloadOf(c3.result.payment.accepts[1], clientTx(c3.result.payment.accepts[1], payer))) as { error: string }).error, "payment_expired", "expired pay window refused before the facilitator");
    // Same tx replayed on another order's ref: memo binds it to the first order.
    const m4 = mk(); const a4 = await order(m4); const b4 = await order(m4);
    const tx4 = clientTx(a4.result.payment.accepts[1], payer);
    assert.equal((await m4.xp.pay(b4.result.payment.paymentRef, { ...payloadOf(a4.result.payment.accepts[1], tx4), accepted: b4.result.payment.accepts[1] } as never) as { error: string }).error, "requirements_mismatch", "tx for order A refused on order B (memo)");
    // Solana disabled after the order was made -> the stored Solana requirement is not honoured.
    const m5 = mk(fakeSolana(), true); const c5 = await order(m5);
    const xpNoSol = new X402Provider({ net: BASE_SEPOLIA, payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://p", store: m5.store, fetchImpl: m5.fake.f, now: () => T0 });
    assert.equal((await xpNoSol.pay(c5.result.payment.paymentRef, payloadOf(c5.result.payment.accepts[1], clientTx(c5.result.payment.accepts[1], payer))) as { error: string }).error, "requirements_mismatch", "rail off = refused (fail closed)");
    assert.equal((await xpNoSol.paymentRequired(c5.result.payment.paymentRef))!.accepts.length, 1, "rail off = Base only in the 402");
    // Without Solana configured, orders offer Base only.
    const m6 = mk(fakeSolana(), false); const c6 = await order(m6);
    assert.equal(c6.result.payment.accepts, undefined, "no accepts[] without Solana: response unchanged");
  }

  // ── Browser side: pick (pinned), build, wallet signs, header -> the server accepts it ──
  {
    const m = mk(); const cr = await order(m); const ref = cr.result.payment.paymentRef;
    const pr = (await m.xp.paymentRequired(ref))! as never;
    const chain: SolanaChain = { network: NET.network, walletChain: "solana:devnet", name: "Solana devnet", explorer: "https://solscan.io", testnet: true, payTo: PINNED_SOLANA_PAYTO, asset: NET.asset };
    const picked = pickSolanaRequirement(pr, chain, cr.result.rentalId);
    assert.ok(picked.ok, JSON.stringify(picked));
    assert.equal(pickSolanaRequirement(pr, { ...chain, payTo: kp().pk }, cr.result.rentalId).ok, false, "page refuses a payTo it wasn't rendered with");
    assert.equal(pickSolanaRequirement(pr, { ...chain, asset: SOLANA_MAINNET.asset }, cr.result.rentalId).ok, false, "page refuses another mint");
    assert.equal(pickSolanaRequirement(pr, chain, "gm_SOMEONEELSE").ok, false, "page refuses a memo for another order");
    assert.equal(pickSolanaRequirement(pr, { ...chain, network: SOLANA_MAINNET.network }, cr.result.rentalId).ok, false, "network must match the page");
    const evm = pickRequirement(pr, { network: BASE_SEPOLIA.network, payTo: PINNED_PAYTO, asset: BASE_SEPOLIA.asset });
    assert.ok(evm.ok && evm.req.network === BASE_SEPOLIA.network, "Base checkout still picks the Base entry with Solana present");
    if (picked.ok) {
      const unsigned = buildSolanaPayment(picked.req, payer.pk);
      const signed = Uint8Array.from(unsigned); signed.set(ed25519.sign(parseTransaction(unsigned).message, payer.sk), 65); // what the wallet does
      const header = solanaPaymentHeader(pr, picked.req, signed);
      const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
      assert.equal(decoded.accepted.extra.recentBlockhash, undefined, "blockhash hint stripped from accepted");
      const r = await m.xp.pay(ref, decoded);
      assert.ok(r.ok && r.network === NET.network, "server accepts the browser-built payment: " + JSON.stringify(r));
      assert.equal(solanaTxLink(chain, (r as { txHash: string }).txHash), `https://solscan.io/tx/${(r as { txHash: string }).txHash}?cluster=devnet`);
      assert.equal(safeTxId((r as { txHash: string }).txHash), (r as { txHash: string }).txHash, "page keeps a Solana signature");
      assert.throws(() => buildSolanaPayment({ ...picked.req, extra: { ...picked.req.extra, recentBlockhash: undefined } }, payer.pk), /no_blockhash/);
      assert.throws(() => buildSolanaPayment(picked.req, picked.req.extra.feePayer), /bad_payer/, "never let the sponsor be the payer");
    }
    assert.equal(solanaTxLink(chain, "0x" + "ab".repeat(32)), null);
    assert.equal(safeTxId("javascript:alert(1)"), null);
    const w = (f: Record<string, unknown>, chains: string[] = ["solana:devnet"]) => ({ name: "W", icon: "", chains, accounts: [], features: f }) as never;
    const st = { "standard:connect": { connect: async () => ({ accounts: [] }) }, "solana:signTransaction": { supportedTransactionVersions: ["legacy", 0], signTransaction: async () => [] } };
    assert.ok(canPay(w(st), "solana:devnet"));
    assert.ok(!canPay(w(st, ["solana:mainnet"]), "solana:devnet"), "wrong cluster hidden");
    assert.ok(!canPay(w({ ...st, "solana:signTransaction": { supportedTransactionVersions: ["legacy"], signTransaction: async () => [] } }), "solana:devnet"), "needs v0");
    assert.ok(!canPay(w({ "standard:connect": st["standard:connect"] }), "solana:devnet"), "needs signTransaction");
    // Page view: Solana only when the rail is on; pinned payTo + mint.
    assert.equal(chainInfo({}, TEST_PAYTO_PINS).solana, undefined);
    assert.deepEqual(chainInfo({ ...SOLENV, RENTALS_SOLANA_ENABLED: "1" }, TEST_PAYTO_PINS).solana, { network: NET.network, walletChain: "solana:devnet", name: "Solana devnet", explorer: "https://solscan.io", testnet: true, payTo: PINNED_SOLANA_PAYTO, asset: NET.asset });
  }

  // ── Review #101 follow-ups ────────────────────────────────────────────
  {
    const payer = kp();
    // S1: the on-chain check reads at "finalized".
    assert.equal(SOLANA_COMMITMENT, "finalized");
    // F2: the settled signature is saved before the on-chain check; polls re-check it; no second payment over it.
    const hold = { on: true };
    const m = mk(fakeSolana({ hold })); const cr = await order(m); const ref = cr.result.payment.paymentRef;
    const req = cr.result.payment.accepts[1];
    const r1 = await m.xp.pay(ref, payloadOf(req, clientTx(req, payer)));
    assert.equal((r1 as { error: string }).error, "onchain_check_failed", "not finalized in time");
    assert.ok(m.fake.commitments.every((c) => c === "finalized"), "getTransaction at finalized");
    const pend = (await m.store.pendingForRef(ref))[0];
    assert.ok(pend && pend.network === NET.network && isSolanaSig(pend.txHash) && pend.payer === payer.pk, "signature saved as pending");
    assert.equal(await m.store.getSettlement(ref), null, "pending is not money");
    assert.equal((await m.xp.lookup(ref) as { paid: boolean }).paid, false, "still unpaid while not finalized");
    assert.deepEqual(await m.xp.requestStatus(ref), { status: 503, body: { error: "payment_pending" } }, "GET never offers a pending order for payment");
    const verifies = m.fake.calls.filter((c) => c === "verify").length;
    assert.equal((await m.xp.pay(ref, payloadOf(req, clientTx(req, payer))) as { error: string }).error, "onchain_check_failed", "repeat POST re-checks, never settles again");
    assert.equal(m.fake.calls.filter((c) => c === "verify").length, verifies, "no facilitator call over a pending signature");
    hold.on = false; clearRecheckCache();
    const look = await m.xp.lookup(ref) as { paid: boolean; network?: string; txHash?: string };
    assert.ok(look.paid && look.network === NET.network && look.txHash === pend!.txHash, "poll re-check records the settlement");
    assert.deepEqual((await m.xp.requestStatus(ref)).status, 200);
    assert.equal((await confirmPayment(m.d, ref)).outcome, "settled", "the order settles from the re-checked payment");
    // S2: a recorded Solana settlement stays paid when the rail is switched off (pinned constants, not the flag).
    const xpNoSol = new X402Provider({ net: BASE_SEPOLIA, payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://p", store: m.store, fetchImpl: m.fake.f, now: () => T0 });
    assert.equal((await xpNoSol.lookup(ref) as { paid: boolean }).paid, true, "rail off: recorded Solana payment still paid");
    // S4: the refund carries the settled network.
    const cx = await cancelRental(m.d, { rental_id: cr.result.rentalId, creator_secret: cr.result.creatorSecret });
    assert.ok((cx as { ok: boolean }).ok, JSON.stringify(cx));
    const rf = await m.store.refundsForRef(ref);
    assert.equal(rf.length, 1); assert.equal(rf[0].network, NET.network, "refund goes back on Solana");
    // F2: mainnet needs a keyed (non-public) RPC.
    const cdp = { CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: Buffer.alloc(64, 1).toString("base64") };
    const mn = { ...SOLENV, RENTALS_SOLANA_ENABLED: "1", RENTALS_X402_NETWORK: "mainnet", ...cdp };
    assert.equal(solanaFromEnv(mn, true, TEST_PAYTO_PINS), null, "mainnet without RENTALS_SOLANA_RPC refused");
    assert.equal(solanaFromEnv({ ...SOLENV, ...mn, RENTALS_SOLANA_RPC: "https://api.mainnet-beta.solana.com" }, true, TEST_PAYTO_PINS), null, "public mainnet RPC refused");
    assert.equal(solanaFromEnv({ ...SOLENV, ...mn, RENTALS_SOLANA_RPC: "http://rpc.example.com/?api-key=abcdefghijklmnop0123" }, true, TEST_PAYTO_PINS), null, "http refused");
    assert.equal(solanaFromEnv({ ...SOLENV, ...mn, RENTALS_SOLANA_RPC: "https://mainnet.helius-rpc.com/?api-key=abcdefghijklmnop0123" }, true, TEST_PAYTO_PINS)?.network, SOLANA_MAINNET.network, "keyed provider RPC accepted");
    assert.equal(solanaFromEnv({ ...SOLENV, ...mn, RENTALS_SOLANA_RPC: "https://mainnet.helius-rpc.com/?api-key=abcdefghijklmnop0123", RENTALS_SOLANA_FEE_PAYER: "nope" }, true, TEST_PAYTO_PINS), null, "F5: bad fee-payer pin refused");
    assert.ok(solanaFromEnv({ ...SOLENV, ...mn, RENTALS_SOLANA_RPC: "https://mainnet.helius-rpc.com/?api-key=abcdefghijklmnop0123", RENTALS_SOLANA_FEE_PAYER: SPONSOR.pk }, true, TEST_PAYTO_PINS), "F5: valid fee-payer pin accepted");
    assert.equal(keyedMainnetRpc(undefined), false); assert.equal(keyedMainnetRpc("https://API.MAINNET-BETA.SOLANA.COM"), false);
    assert.ok(solanaFromEnv({ ...SOLENV, RENTALS_SOLANA_ENABLED: "1" }, false, TEST_PAYTO_PINS), "devnet keeps the public RPC default");
    // S6: the blockhash hint is cached per RPC (GET /pay can't hammer the RPC).
    clearBlockhashCache();
    const mb = mk(); const cb = await order(mb); const before = mb.fake.calls.filter((c) => c === "blockhash").length;
    for (let i = 0; i < 5; i++) await mb.xp.paymentRequired(cb.result.payment.paymentRef);
    assert.equal(mb.fake.calls.filter((c) => c === "blockhash").length - before <= 1, true, "one blockhash fetch for five GETs");
    mb.tick(21_000); await mb.xp.paymentRequired(cb.result.payment.paymentRef);
    assert.ok(mb.fake.calls.filter((c) => c === "blockhash").length - before >= 1, "refreshed after the cache window");
    // S3: pay-error copy names the payment's network.
    assert.match(payErrorCopy("onchain_check_failed", "solana").body, /on Solana/); assert.doesNotMatch(payErrorCopy("onchain_check_failed", "solana").body, /on Base/);
    assert.match(payErrorCopy("verify_failed", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp").body, /USDC on Solana/);
    assert.equal(payErrorCopy("onchain_check_failed"), PAY_ERROR_COPY.onchain_check_failed, "Base copy unchanged");
  }

  // ── Review #102 flag-on blockers ──────────────────────────────────────
  {
    const payer = kp();
    const settleOne = async (m: ReturnType<typeof mk>) => { const cr = await order(m); const req = cr.result.payment.accepts[1]; return { cr, ref: cr.result.payment.paymentRef as string, req, r: await m.xp.pay(cr.result.payment.paymentRef, payloadOf(req, clientTx(req, payer))) }; };
    const kinds = (m: ReturnType<typeof mk>) => m.store.alerts.map((a) => a.kind);
    // FB1: sweep re-checks all unresolved rows; one alert after 10 min; then settles when finalized.
    {
      const hold = { on: true }; clearRecheckCache();
      const m = mk(fakeSolana({ hold })); const { ref, r } = await settleOne(m);
      assert.equal((r as { error: string }).error, "onchain_check_failed");
      const p = (await m.store.pendingForRef(ref))[0];
      assert.equal(p.lastValidBlockHeight, "1234", "lastValidBlockHeight upper bound saved with the pending row");
      assert.equal((await sweepPending(m.d)).alerted, 0, "no alert before 10 min");
      m.tick(PENDING_ALERT_MS);
      assert.equal((await sweepPending(m.d)).alerted, 1, "alert after 10 min unresolved");
      assert.ok(kinds(m).includes("solana_pending_stuck") && (m.d.alerter as MockAlerter).sent.some((a) => a.kind === "solana_pending_stuck"), "outbox + ntfy");
      assert.ok(m.store.resolutions.some((x) => x.outcome === "manual_review" && x.detail === "stuck"), "stuck -> manual review");
      assert.equal((await sweepPending(m.d)).alerted, 0, "alerted once only");
      assert.equal(await m.store.getSettlement(ref), null); assert.equal((await m.store.listRefunds()).length, 0, "never a refund from a pending row");
      // Order expired meanwhile (any order state is swept): it still settles from the verified signature.
      hold.on = false;
      const sw = await sweepPending(m.d);
      assert.equal(sw.settled, 1, "settles once finalized");
      assert.ok(await m.store.getSettlement(ref)); assert.ok(m.store.resolutions.some((x) => x.outcome === "settled"));
      assert.equal((await m.store.listUnresolvedPending()).rows.length, 0);
    }
    // FB1: dropped only when the signature is unknown AND finalized height > lastValidBlockHeight; then the ref pays again.
    {
      const hold = { on: true }, sigStatus = { v: { confirmationStatus: "processed" } as unknown }, height = { v: 1234 }; clearRecheckCache();
      const m = mk(fakeSolana({ hold, sigStatus, height })); const { cr, ref } = await settleOne(m);
      await sweepPending(m.d);
      assert.equal((await m.store.pendingForRef(ref)).length, 1, "status known: not dropped");
      sigStatus.v = null; await sweepPending(m.d);
      assert.equal((await m.store.pendingForRef(ref)).length, 1, "height not past lastValidBlockHeight: not dropped");
      height.v = 1235; await sweepPending(m.d);
      assert.equal((await m.store.pendingForRef(ref)).length, 1, "B2: 1 block past the bound is not enough");
      height.v = 1234 + DROP_MARGIN_BLOCKS; await sweepPending(m.d);
      assert.equal((await m.store.pendingForRef(ref)).length, 1, "B2: exactly bound + 150 is not dropped");
      height.v = 1234 + DROP_MARGIN_BLOCKS + 1; const sw = await sweepPending(m.d);
      assert.equal(sw.dropped, 1, "dropped"); assert.equal((await m.store.pendingForRef(ref)).length, 0);
      assert.ok(m.store.resolutions.some((x) => x.outcome === "dropped"), "recorded in the resolution log");
      hold.on = false; clearRecheckCache();
      const req = cr.result.payment.accepts[1];
      const again = await m.xp.pay(ref, payloadOf(req, clientTx(req, payer)));
      assert.ok(again.ok && !again.replay, "a dropped pending row no longer blocks the ref: " + JSON.stringify(again));
    }
    // A pending row without a lastValidBlockHeight bound is never auto-dropped.
    {
      const m = mk(fakeSolana({ hold: { on: true }, sigStatus: { v: null }, height: { v: 9_999_999 } })); clearRecheckCache();
      const { cr } = await settleOne(m); const ref = cr.result.payment.paymentRef;
      const p = (await m.store.pendingForRef(ref))[0];
      m.store.pending.set(p.txHash, { ...p, lastValidBlockHeight: null, outcomes: undefined });
      await sweepPending(m.d);
      assert.equal((await m.store.pendingForRef(ref)).length, 1, "no bound = never dropped automatically");
    }
    // SF2: pending read errors fail closed.
    {
      const m = mk(); clearRecheckCache(); const cr = await order(m); const ref = cr.result.payment.paymentRef; const req = cr.result.payment.accepts[1];
      m.store.pendingReadFails = true;
      const c0 = m.fake.calls.filter((c) => c === "verify").length;
      assert.equal((await m.xp.pay(ref, payloadOf(req, clientTx(req, payer))) as { error: string }).error, "store_unavailable", "pay refuses on a pending read error");
      assert.equal(m.fake.calls.filter((c) => c === "verify").length, c0, "no facilitator call");
      assert.deepEqual(await m.xp.requestStatus(ref), { status: 503, body: { error: "store_unavailable" } }, "GET 503, never 402");
      assert.equal(payErrorCopy("store_unavailable").charged, "no");
    }
    // SF3: a losing signature (another one is the ref's settlement) -> lost_race + manual review, never a refund row.
    {
      const hold = { on: true }; clearRecheckCache();
      const m = mk(fakeSolana({ hold })); const { ref } = await settleOne(m);
      const p = (await m.store.pendingForRef(ref))[0];
      await m.store.recordSettlement({ providerRef: ref, network: NET.network, payer: payer.pk, txHash: b58encode(crypto.randomBytes(64)), amountAtomic: 1, settledAt: T0 });
      hold.on = false;
      assert.equal(await m.xp.resolvePending(p), "lost_race");
      assert.ok(m.store.resolutions.some((x) => x.outcome === "manual_review" && x.detail === "lost_race"), "manual review entry");
      assert.ok(kinds(m).includes("refund_manual_review")); assert.equal((await m.store.listRefunds()).length, 0, "no automatic refund");
      assert.equal((await m.store.listUnresolvedPending()).rows.length, 0, "lost_race is terminal for the sweep");
    }
    // SF6: re-checks are cached per ref for ~10 s.
    {
      const hold = { on: true }; clearRecheckCache();
      const m = mk(fakeSolana({ hold })); const { ref } = await settleOne(m);
      const n0 = m.fake.calls.filter((c) => c === "getTransaction").length;
      await m.xp.lookup(ref); await m.xp.lookup(ref); await m.xp.requestStatus(ref);
      assert.equal(m.fake.calls.filter((c) => c === "getTransaction").length - n0, 1, "one RPC re-check for three polls");
      m.tick(11_000); await m.xp.lookup(ref);
      assert.equal(m.fake.calls.filter((c) => c === "getTransaction").length - n0, 2, "re-checked after the cache window");
    }
    // SF7: a failed pending save raises an alert.
    {
      const m = mk(fakeSolana({ hold: { on: true } })); clearRecheckCache();
      m.store.recordPendingSettlement = async () => { throw new Error("db down"); };
      await settleOne(m);
      assert.ok(kinds(m).includes("solana_pending_save_failed"), "alert when the signature couldn't be saved");
    }
    // FB2: paid on two networks -> no automatic refund row, refund_manual_review.
    {
      const m = mk(); clearRecheckCache(); const { cr, ref } = await settleOne(m);
      assert.equal((await confirmPayment(m.d, ref)).outcome, "settled");
      const o = (await m.store.getOrderByPublicId(cr.result.rentalId))!;
      const ext = "x402_" + "e".repeat(32);
      m.store.bindings.set(ext, { orderId: o.id, kind: "extension", expectedAtomic: 1_000_000, expiresAt: T0 + 900_000, extendDays: 1, challenge: {} });
      m.store.payments.push({ id: ext + "#0", orderId: o.id, kind: "extension", rail: "x402_usdc", providerRef: ext, seq: 0, deltaAtomic: 1_000_000, cumulativeAtomic: 1_000_000, expectedAtomic: 1_000_000, extendDays: 1, settles: true, at: T0 });
      m.store.settlements.set(ext, { providerRef: ext, network: BASE_SEPOLIA.network, payer: "0x" + "1".repeat(40), txHash: "0x" + "ab".repeat(32), amountAtomic: 1_000_000, settledAt: T0 });
      const cx = await cancelRental(m.d, { rental_id: cr.result.rentalId, creator_secret: cr.result.creatorSecret });
      assert.ok((cx as { ok: boolean }).ok, JSON.stringify(cx));
      assert.equal((await m.store.listRefunds()).length, 0, "mixed networks: no automatic refund row");
      assert.ok(kinds(m).includes("refund_manual_review"), "refund_manual_review raised");
    }
    // G6: node sol_maybe_paid -> no automatic refund; manual review with a finalized re-check.
    {
      const m = mk(); clearRecheckCache(); const { cr, ref } = await settleOne(m);
      assert.equal((await confirmPayment(m.d, ref)).outcome, "settled");
      const job = m.store.jobs.find((j) => j.payload.action === "route")!;
      await m.store.recordResult({ jobId: job.payload.job_id, orderRef: cr.result.rentalId, result: "rejected", reason: SOL_MAYBE_PAID, deliveredTh: null, at: T0 });
      m.tick(31 * 60_000);
      const o = (await m.store.getOrderByPublicId(cr.result.rentalId))!;
      assert.equal(await reofferOrExpire(m.d, o), "expired_unapplied");
      assert.equal((await m.store.listRefunds()).length, 0, "no automatic refund for sol_maybe_paid");
      assert.ok(kinds(m).includes("refund_manual_review") && kinds(m).includes("sol_maybe_paid_verified"), JSON.stringify(kinds(m)));
    }
    // SF1: allowlisted keyed providers only, credential required.
    const K = "abcdefghijklmnop0123";
    assert.equal(mainnetRpcProvider(`https://mainnet.helius-rpc.com/?api-key=${K}`), "helius");
    assert.equal(mainnetRpcProvider("https://mainnet.helius-rpc.com/"), null, "Helius without api-key");
    assert.equal(mainnetRpcProvider(`https://solana-mainnet.g.alchemy.com/v2/${K}`), "alchemy");
    assert.equal(mainnetRpcProvider("https://solana-mainnet.g.alchemy.com/v2/"), null, "Alchemy without key");
    assert.equal(mainnetRpcProvider(`https://abc-def.solana-mainnet.quiknode.pro/${K}/`), "quicknode");
    assert.equal(mainnetRpcProvider(`https://galaxy.mainnet.rpcpool.com/${K}`), "triton");
    assert.equal(mainnetRpcProvider(`https://rpc.ankr.com/solana/${K}`), "ankr");
    assert.equal(mainnetRpcProvider(`https://mainnet.helius-rpc.com./?api-key=${K}`), "helius", "trailing dot stripped");
    assert.equal(mainnetRpcProvider(`https://rpc.example.com/?api-key=${K}`), null, "unknown provider refused");
    assert.equal(mainnetRpcProvider(`https://1.2.3.4/?api-key=${K}`), null, "IPv4 literal refused");
    assert.equal(mainnetRpcProvider(`https://[::1]/?api-key=${K}`), null, "IPv6 literal refused");
    assert.equal(mainnetRpcProvider(`https://user:pw@mainnet.helius-rpc.com/?api-key=${K}`), null, "userinfo refused");
    assert.equal(mainnetRpcProvider(`https://mainnet.helius-rpc.com:8443/?api-key=${K}`), null, "odd port refused");
    assert.equal(mainnetRpcProvider(`https://evilhelius-rpc.com/?api-key=${K}`), null, "lookalike host refused");
    assert.equal(mainnetRpcProvider(`https://mainnet.helius-rpc.com.evil.io/?api-key=${K}`), null, "suffix trick refused");
    assert.equal(mainnetRpcProvider("https://api.mainnet-beta.solana.com"), null, "public RPC refused");
    // #103 S1: Helius pinned to mainnet.helius-rpc.com; devnet / testnet endpoints never pass for mainnet.
    assert.equal(mainnetRpcProvider(`https://devnet.helius-rpc.com/?api-key=${K}`), null, "S1: Helius devnet refused");
    assert.equal(mainnetRpcProvider(`https://staked.helius-rpc.com/?api-key=${K}`), null, "S1: other Helius hosts refused");
    assert.equal(mainnetRpcProvider(`https://abc.devnet.rpcpool.com/${K}`), null, "S1: Triton devnet refused");
    assert.equal(mainnetRpcProvider(`https://rpc.ankr.com/solana_devnet/${K}`), null, "S1: Ankr devnet refused");
    assert.equal(mainnetRpcProvider(`https://abc-devnet.solana-mainnet.quiknode.pro/${K}/`), null, "S1: devnet-labelled host refused");
    // SF1: RPC fetches never follow redirects.
    {
      let redirect: unknown = "unset";
      const f = (async (_u: string, init: { redirect?: string; body?: string }) => { if (init.body?.includes("getLatestBlockhash")) redirect = init.redirect; return new Response(JSON.stringify({ result: null })); }) as unknown as typeof fetch;
      clearBlockhashCache(); await sx(f).latestBlockhash();
      assert.equal(redirect, "error", "redirect: 'error' on RPC fetches");
    }
    // #103 S2: a settlement read error on cancel -> manual review, never a refund row with a guessed (null) network.
    {
      const m = mk(); clearRecheckCache(); const { cr, ref } = await settleOne(m);
      assert.equal((await confirmPayment(m.d, ref)).outcome, "settled");
      const real = m.store.getSettlement.bind(m.store);
      m.store.getSettlement = async () => { throw new Error("db down"); };
      const cx = await cancelRental(m.d, { rental_id: cr.result.rentalId, creator_secret: cr.result.creatorSecret });
      m.store.getSettlement = real;
      assert.ok((cx as { ok: boolean }).ok, JSON.stringify(cx));
      assert.equal((await m.store.listRefunds()).length, 0, "S2: no refund row when the network can't be read");
      assert.ok(kinds(m).includes("refund_manual_review"), "S2: refund_manual_review raised");
    }
    // #103 S3: finalized WITH an error -> terminal failed_onchain; the ref can take a payment again.
    {
      const hold = { on: true }, fail = { on: false }; clearRecheckCache();
      const m = mk(fakeSolana({ hold, tamper: (tx) => { if (fail.on) tx.meta.err = { InstructionError: [2, "Custom"] }; } }));
      const { cr, ref } = await settleOne(m);
      hold.on = false; fail.on = true;
      const sw = await sweepPending(m.d);
      assert.equal(sw.dropped, 1, "failed_onchain counted with the terminal non-payments");
      assert.ok(m.store.resolutions.some((x) => x.outcome === "failed_onchain"), "S3: failed_onchain recorded");
      assert.equal((await m.store.pendingForRef(ref)).length, 0, "S3: terminal");
      assert.equal(await m.store.getSettlement(ref), null, "S3: never a settlement");
      assert.equal((await m.store.listRefunds()).length, 0, "S3: never a refund");
      await assert.rejects(m.store.recordPendingResolution({ txHash: m.store.resolutions[0].txHash, outcome: "settled", detail: null, at: T0 }), /pending_resolution_conflict/, "S4: one terminal outcome only");
      fail.on = false; clearRecheckCache();
      const req = cr.result.payment.accepts[1];
      const again = await m.xp.pay(ref, payloadOf(req, clientTx(req, payer)));
      assert.ok(again.ok && !again.replay, "S3: the ref pays again after failed_onchain: " + JSON.stringify(again));
    }
    // #103 B1 + S5: the unresolved list is capped (oldest first) with a total; a full page alerts; the sweep has a time budget.
    {
      const m = mk(fakeSolana({ hold: { on: true } })); clearRecheckCache();
      for (let i = 0; i < PENDING_LIST_CAP + 3; i++) {
        const tx = b58encode(crypto.randomBytes(64));
        m.store.pending.set(tx, { providerRef: "x402_" + "f".repeat(32), network: NET.network, payer: payer.pk, payerSig: b58encode(crypto.randomBytes(64)), txHash: tx, at: T0 + (PENDING_LIST_CAP + 3 - i), lastValidBlockHeight: "1234" });
      }
      const page = await m.store.listUnresolvedPending();
      assert.equal(page.rows.length, PENDING_LIST_CAP, "B1: capped page"); assert.equal(page.total, PENDING_LIST_CAP + 3, "B1: true total");
      assert.ok(page.rows.every((r, i) => i === 0 || page.rows[i - 1].at <= r.at), "B1: oldest first");
      let t = 0; const sw = await sweepPending(m.d, { budgetMs: 5, clock: () => t++ });
      assert.ok(sw.checked < PENDING_LIST_CAP && sw.deferred > 0 && sw.checked + sw.deferred === PENDING_LIST_CAP, "S5: time budget stops the pass: " + JSON.stringify(sw));
      assert.ok(kinds(m).includes("solana_pending_list_capped") && (m.d.alerter as MockAlerter).sent.some((a) => a.kind === "solana_pending_list_capped"), "B1: cap alert (outbox + ntfy)");
      assert.ok(SWEEP_PENDING_BUDGET_MS <= 25_000);
      assert.match(fs.readFileSync("src/app/api/rentals/sweep/route.ts", "utf8"), /export const maxDuration = 60;/, "S5: sweep route maxDuration");
      const svcSrc = fs.readFileSync("src/lib/rentals/phase2/service.ts", "utf8"), body = svcSrc.slice(svcSrc.indexOf("export async function sweepExpired"));
      assert.ok(body.indexOf("await sweepPending(d)") > body.indexOf("reofferOrExpire(d, o)"), "S5: sweepPending runs after the expiry work");
    }
    // #103 B1 / S7: SupabaseStore uses ONE server-side RPC (no in.() list); not migrated = []; other errors fail closed.
    {
      const urls: string[] = [];
      const fake = (mode: "ok" | "missing" | "down") => (async (u: string, init: { body?: string }) => {
        urls.push(String(u));
        if (mode === "missing") return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function" }), { status: 404 });
        if (mode === "down") return new Response(JSON.stringify({ code: "57014", message: "timeout" }), { status: 500 });
        const a = JSON.parse(init.body ?? "{}");
        assert.ok(a.p_limit === PENDING_LIST_CAP || a.p_limit === 0);
        return new Response(JSON.stringify({ total: 2, rows: [{ tx_hash: "t1", provider_ref: "x402_a", network: NET.network, payer: "p", payer_sig: "s", last_valid_block_height: 9, created_at: new Date(T0).toISOString(), outcomes: ["alerted"] }] }));
      }) as unknown as typeof fetch;
      const ok = new SupabaseStore("https://sb.example", "k", fake("ok"));
      const pg = await ok.listUnresolvedPending();
      assert.equal(pg.total, 2); assert.equal(pg.rows[0].lastValidBlockHeight, "9"); assert.deepEqual(pg.rows[0].outcomes, ["alerted"]);
      assert.ok(urls.every((u) => u.endsWith("/rest/v1/rpc/rental_list_unresolved_pending") && !u.includes("in.(")), "B1: RPC only, no in.() URL");
      assert.equal(await ok.pendingSchemaReady(), true);
      const miss = new SupabaseStore("https://sb.example", "k", fake("missing"));
      assert.deepEqual(await miss.pendingForRef("x402_a"), [], "not migrated = none");
      assert.equal(await miss.pendingSchemaReady(), false, "S7: not migrated = not ready");
      const down = new SupabaseStore("https://sb.example", "k", fake("down"));
      await assert.rejects(down.listUnresolvedPending(), PendingReadError, "SF2: other errors fail closed");
      assert.equal(await down.pendingSchemaReady(), false, "S7: any error = not ready");
      // N1: once mainnet has seen the schema, "not migrated" is a read error (fail closed), never "none".
      miss.requirePendingSchema();
      await assert.rejects(miss.pendingForRef("x402_a"), PendingReadError, "N1: not migrated after required = PendingReadError");
      await assert.rejects(miss.listUnresolvedPending(), PendingReadError, "N1: list too");
    }
    // #103 S7: mainnet Solana refuses to offer or take money when 20261017170000 isn't applied.
    {
      const fk = fakeSolana({ net: SOLANA_MAINNET.network }); clearRecheckCache();
      const m = mk(fk, true, SOLANA_MAINNET);
      m.store.pendingMigrated = false;
      const cr0 = await order(m);
      assert.equal(cr0.result.payment.accepts, undefined, "S7: no Solana offer when not migrated (Base only)");
      assert.equal(m.store.pendingSchemaRequired, true, "N1: mainnet Solana requires the schema from construction");
      assert.deepEqual(await m.xp.requestStatus(cr0.result.payment.paymentRef), { status: 503, body: { error: "store_unavailable" } }, "N1: missing schema on mainnet = 503, never a 402");
      m.store.pendingMigrated = true;
      const cr = await order(m);
      assert.equal(cr.result.payment.accepts[1]?.network, SOLANA_MAINNET.network, "S7: offered once migrated");
      m.store.pendingMigrated = false; m.tick(61_000);
      const ref = cr.result.payment.paymentRef, req = cr.result.payment.accepts[1];
      assert.equal(m.store.pendingSchemaRequired, true, "N1: mainnet saw the schema");
      assert.deepEqual(await m.xp.requestStatus(ref), { status: 503, body: { error: "store_unavailable" } }, "N1: schema vanished after being seen = 503, never a 402");
      const sw = await sweepPending(m.d);
      assert.equal(sw.checked, 0); assert.ok(m.store.alerts.some((a) => a.kind === "solana_pending_read_failed"), "N1: sweep alerts instead of reading 'none'");
      const v0 = fk.calls.filter((c) => c === "verify").length;
      assert.equal((await m.xp.pay(ref, payloadOf(req, clientTx(req, payer))) as { error: string }).error, "store_unavailable", "S7: Solana pay refused");
      assert.equal(fk.calls.filter((c) => c === "verify").length, v0, "S7: no facilitator call");
    }
    // #104 N1: COLD instance (solanaReady never ran) on mainnet: a PGRST202 blip is a read error, not "none".
    {
      const fk = fakeSolana({ net: SOLANA_MAINNET.network }); clearRecheckCache();
      const warm = mk(fk, true, SOLANA_MAINNET);
      const cr = await order(warm); const ref = cr.result.payment.paymentRef as string;
      assert.equal(cr.result.payment.accepts[1]?.network, SOLANA_MAINNET.network);
      // A Solana signature is pending (unresolved) on this ref.
      const tx = b58encode(crypto.randomBytes(64));
      await warm.store.recordPendingSettlement({ providerRef: ref, network: SOLANA_MAINNET.network, payer: payer.pk, payerSig: b58encode(crypto.randomBytes(64)), txHash: tx, at: T0, lastValidBlockHeight: "1234" });
      // Fresh instance over the same store; the schema read now "isn't there".
      const store = warm.store; store.pendingSchemaRequired = false; store.pendingMigrated = false;
      const sol = new SolanaExact({ net: SOLANA_MAINNET, payTo: PINNED_SOLANA_PAYTO, payToPins: TEST_PAYTO_PINS, fetchImpl: fk.f, rpcDeadlineMs: 0, sleep: async () => {}, now: () => T0, cdp: CDP_TEST });
      const cold = new X402Provider({ net: BASE_SEPOLIA, payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://preview.example", store, fetchImpl: fk.f, now: () => T0, rpcDeadlineMs: 0, sleep: async () => {}, solana: sol });
      assert.equal(store.pendingSchemaRequired, true, "N1: required at construction, before any solanaReady()");
      const v0 = fk.calls.filter((c) => c === "verify").length;
      const basePay = { x402Version: 2, accepted: { ...cr.result.payment.http402 }, payload: { signature: "0x" + "11".repeat(65), authorization: { from: "0x" + "22".repeat(20), to: PINNED_PAYTO, value: cr.result.payment.http402.amount, validAfter: "0", validBefore: String(Math.floor(T0 / 1000) + 600), nonce: "0x" + "33".repeat(32) } } };
      assert.equal((await cold.pay(ref, basePay as never) as { error: string }).error, "store_unavailable", "N1 (1): cold Base pay refused over a possibly-unresolved Solana sig");
      assert.equal(fk.calls.filter((c) => c === "verify").length, v0, "N1 (1): no facilitator call");
      assert.equal(await store.getSettlement(ref), null);
      const dCold: Deps = { ...warm.d, providers: { x402_usdc: cold }, alerter: new MockAlerter() };
      const sw = await sweepPending(dCold);
      assert.equal(sw.checked, 0, "N1 (2): nothing read as 'none'");
      assert.ok(store.alerts.some((a) => a.kind === "solana_pending_read_failed") && (dCold.alerter as MockAlerter).sent.some((a) => a.kind === "solana_pending_read_failed"), "N1 (2): sweep raises solana_pending_read_failed");
    }
    // #104 N1: devnet and flag-off stay tolerant (not migrated = none).
    {
      const dev = mk(); assert.equal(dev.store.pendingSchemaRequired, false, "devnet not required");
      const off = mk(fakeSolana(), false); assert.equal(off.store.pendingSchemaRequired, false, "flag off not required");
      off.store.pendingMigrated = false; clearRecheckCache();
      const cr = await order(off);
      assert.equal((await off.xp.requestStatus(cr.result.payment.paymentRef)).status, 402, "flag off: missing schema = none, Base 402 works");
    }
    // SF5: pay route maxDuration 60; the Solana wait stays within 50 s.
    assert.match(fs.readFileSync("src/app/api/rentals/pay/[ref]/route.ts", "utf8"), /export const maxDuration = 60;/);
    assert.ok(SOLANA_PAY_BUDGET_MS <= 50_000);
  }

  // ── Job schema rev 1.6 ───────────────────────────────────────────────────
  {
    const sig = b58encode(crypto.randomBytes(64));
    const base = {
      v: 1, job_id: crypto.randomUUID(), order_ref: "gm_TESTORDER01", action: "route", rig_class: "s21xp", rig_count: 1, bays: "1",
      upstream: { host: "stratum.braiins.com", port: 3333, user: "alice.rig1" }, start: 1_800_000_000, end: 1_800_086_400,
      payment: { rail: "x402_usdc", provider_ref: "x402_" + "a".repeat(32), amount_atomic: "12340000", tx_hash: sig, unit: "usdc_6dp", network: NET.network },
      pay_to: PINNED_SOLANA_PAYTO, amount_usdc: "12.340000", floor_btc_per_ph_day: "0.00050100", nonce: "a".repeat(32), iat: 1_800_000_000, exp: 1_800_000_900, env: "staging",
    };
    const v = (o: Record<string, unknown>) => { const a = schemaOk(o, CAPS), b = nodeSchemaOk(o, CAPS); assert.equal(a, b, "site and node snippet agree"); return a; };
    assert.equal(v(base), null, "Solana job valid");
    assert.equal(v({ ...base, payment: { ...base.payment, network: "eip155:84532" } }), "schema_tx_hash", "base58 tx on Base refused");
    assert.equal(v({ ...base, payment: { ...base.payment, tx_hash: "0x" + "ab".repeat(32) } }), "schema_tx_hash", "hex tx on Solana refused");
    assert.equal(v({ ...base, pay_to: PINNED_PAYTO }), "schema_pay_to", "0x payTo on Solana refused");
    assert.equal(v({ ...base, payment: { ...base.payment, network: "solana:other" } }), "schema_network", "unknown network refused");
    assert.equal(v({ ...base, payment: { ...base.payment, network: "eip155:84532", tx_hash: "0x" + "ab".repeat(32) }, pay_to: PINNED_PAYTO }), null, "Base job unchanged");
  }
  console.log("test-solana-rail: ok");
})().catch((e) => { console.error(e); process.exit(1); });
