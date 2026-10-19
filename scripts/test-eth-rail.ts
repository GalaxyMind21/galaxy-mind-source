// USDC on Ethereum (ERC-20), DIRECT TRANSFER rail · human checkout only.
// Config fail-closed gates + RPC allowlist, EIP-55 / amount / calldata vectors, the independent on-chain check
// (exact amount, one Transfer to payTo, canonical block, finalized + 12 deep), binding by unique cent tag + tx hash
// (front-running and tx reuse across orders refused), durable claims through finality (sweep hold), settlement ->
// signed job, late / dropped / stuck / lost-race paths (never an automatic refund), flag-off lookup, cancel guard,
// the route gates, and the x402 surfaces never seeing the eth_ ref.
import { PAYTO_PIN_SHA256, sha256Hex, eip55Checksum } from "../src/lib/rentals/phase2/payto-pins";
import { TEST_PAYTO_EVM as PINNED_PAYTO, TEST_PAYTO_SOLANA as PINNED_SOLANA_PAYTO, TEST_PAYTO_PINS } from "./lib/test-payto";
import assertBase from "node:assert/strict";
// Every assertion is counted; the run fails if fewer than ETH_MIN_ASSERTIONS ran (a skipped block can't pass silently).
let ASSERTS = 0;
const ETH_MIN_ASSERTIONS = 600;
const assert: typeof assertBase = new Proxy(assertBase, {
  apply(t, th, args) { ASSERTS++; return Reflect.apply(t as (...a: unknown[]) => unknown, th, args); },
  get(t, p, r) { const v = Reflect.get(t, p, r); return typeof v === "function" ? (...a: unknown[]) => { ASSERTS++; return (v as (...x: unknown[]) => unknown).apply(t, a); } : v; },
}) as typeof assertBase;
import crypto from "node:crypto";
import { ethConfig, ethRpcProvider, eip55, validPayTo, taggedAmount, usdc2, usdc6, ETH_MAINNET, ETH_SEPOLIA, ETH_TAG_UNIT, ETH_MIN_CONFIRMATIONS, ETH_STUCK_MS, ETH_CLOCK_SKEW_MS, ethVerifyConfig, ETH_HOLD_MAX_MS, SEPOLIA_PUBLIC_RPC, isEthRef } from "../src/lib/rentals/phase2/eth/config";
import { inspectEthTx, makeRpc, normTxHash, TRANSFER_TOPIC, withDeadline } from "../src/lib/rentals/phase2/eth/verify";
import { MemoryEthStore } from "../src/lib/rentals/phase2/eth/store";
import { bindEth, claimEth, statusEth, sweepEth, ethExpiryHold, ethClaimPending, resetEthCaches, ethChainFromEnv, ETH_ALERT_THROTTLE_MS } from "../src/lib/rentals/phase2/eth/service";
import { payToHistoryProblems } from "../src/lib/rentals/phase2/eth/config";
import { readFileSync } from "node:fs";
import { wireEth, ethDepsOf } from "../src/lib/rentals/phase2/eth/wire";
import { handleEth, ETH_BIND_LIMIT } from "../src/lib/rentals/phase2/eth/human";
import { erc20TransferData, ethErrorCopy, ETH_COPY } from "../src/lib/rentals/phase2/eth/client";
import { X402Provider, BASE_SEPOLIA } from "../src/lib/rentals/phase2/x402";
import { MemoryStore } from "../src/lib/rentals/phase2/store";
import { MockAlerter } from "../src/lib/rentals/phase2/safety";
import { createRental, sweepExpired, type Deps } from "../src/lib/rentals/phase2/service";
import { handleAccess, chainInfo } from "../src/lib/rentals/phase2/human";
import { RENTAL_TERMS_VERSION } from "../src/lib/rentals/phase2/terms";
import { assertCustomerSafe } from "../src/lib/rentals/index";

const T0 = Date.parse("2026-10-17T14:00:00Z");
const PRICING = { marketAskBtcPhDay: 0.00052, floorBtcPhDay: 0.000501, hashpriceSatsThDay: 47, writtenAt: T0 - 3600_000 };
const { privateKey } = crypto.generateKeyPairSync("ed25519");
const PRIV = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PAYTO = PINNED_PAYTO;   // synthetic test payTo (scripts/test.env); Ethereum and Base share one address and one EVM pin
const RPC = "https://eth-sepolia.g.alchemy.com/v2/" + "a".repeat(32);
const ENV: Record<string, string> = { RENTALS_ETH_USDC_ENABLED: "1", RENTALS_ETH_NODE_READY: "1", RENTALS_ETH_PAYTO: PAYTO, RENTALS_ETH_RPC: RPC,
  RENTALS_PHASE2_ENABLED: "1", RENTALS_PHASE2_MODE: "staging", RENTALS_HUMAN_CHECKOUT: "1" };
const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const hx = (n: number | bigint) => "0x" + BigInt(n).toString(16);
const rnd = () => "0x" + crypto.randomBytes(32).toString("hex");
/** The unmatched record for a tx (keyed payer:tx in the store). */
const um = (es: MemoryEthStore, tx: string) => [...es.unmatched.values()].find((u) => u.txHash === tx);

/** Fake Ethereum JSON-RPC: blocks, receipts, head and finalized are all controllable. */
function chain(chainId = ETH_SEPOLIA.chainIdHex) {
  const st = { chainId, head: 5000, finalized: 4900, receipts: new Map<string, any>(), blocks: new Map<number, { hash: string; ts: number }>(), calls: [] as string[], down: false, urls: new Set<string>() };
  const f = (async (url: string, init: { body?: string; redirect?: string }) => {
    st.urls.add(String(url));
    assert.equal(init.redirect, "error", "RPC never follows redirects");
    if (st.down) throw new Error("down");
    const { method, params, id } = JSON.parse(init.body ?? "{}");
    st.calls.push(method);
    let result: unknown = null;
    if (method === "eth_chainId") result = st.chainId;
    else if (method === "eth_blockNumber") result = hx(st.head);
    else if (method === "eth_getTransactionReceipt") result = st.receipts.get(params[0]) ?? null;
    else if (method === "eth_getBlockByNumber") {
      if (params[0] === "finalized") result = { number: hx(st.finalized), hash: rnd(), timestamp: hx(0) };
      else { const n = Number(BigInt(params[0])); const b = st.blocks.get(n); result = b ? { number: hx(n), hash: b.hash, timestamp: hx(b.ts) } : null; }
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }) as unknown as typeof fetch;
  /** Mine a USDC transfer. */
  const mine = (o: { amount: number; to?: string; from?: string; block?: number; tsMs: number; status?: string; asset?: string; extra?: any[]; removed?: boolean }) => {
    const tx = rnd(), block = o.block ?? st.head, bh = rnd();
    st.blocks.set(block, { hash: bh, ts: Math.floor(o.tsMs / 1000) });
    const log = { address: (o.asset ?? ETH_SEPOLIA.asset).toLowerCase(), topics: [TRANSFER_TOPIC, pad(o.from ?? "0x" + "b".repeat(40)), pad(o.to ?? PAYTO)], data: pad(hx(o.amount)), logIndex: "0x3", removed: o.removed ?? false };
    st.receipts.set(tx, { transactionHash: tx, status: o.status ?? "0x1", blockNumber: hx(block), blockHash: bh, logs: [log, ...(o.extra ?? [])] });
    return { tx, block, bh, log };
  };
  const finalize = (block: number) => { st.finalized = Math.max(st.finalized, block); st.head = Math.max(st.head, block + ETH_MIN_CONFIRMATIONS + 20); };
  return { st, f, mine, finalize };
}

function mk(env: Record<string, string> = ENV, c = chain()) {
  let now = T0;
  const store = new MemoryStore();
  const xp = new X402Provider({ net: BASE_SEPOLIA, payTo: PINNED_PAYTO, payToPins: TEST_PAYTO_PINS, resourceBase: "https://preview.example", store, fetchImpl: c.f, now: () => now, rpcDeadlineMs: 0, sleep: async () => {} });
  const alerter = new MockAlerter();
  const d: Deps = {
    store, providers: { x402_usdc: xp }, pricing: async () => PRICING, btcUsd: async () => 82000, now: () => now,
    signingKeyPem: PRIV, signingKid: "t1", codeHmacKey: "k".repeat(32), killSwitch: async () => false,
    alerter, lightningEnabled: false, pilot: true, bays: [1, 2, 3, 4], payNetwork: BASE_SEPOLIA.network,
  };
  const e = wireEth(d, env, c.f, { pinSha: TEST_PAYTO_PINS.evm })!;
  (e.store as MemoryEthStore).sqlPin = PAYTO;
  resetEthCaches();
  return { d, e, store, xp, c, es: e.store as MemoryEthStore, tick: (ms: number) => { now += ms; }, nowMs: () => now };
}
const newOrder = async (m: ReturnType<typeof mk>, user = "alice.rig1") => {
  const r = (await createRental(m.d, { rigs: 1, days: 1, pool_id: "braiins", username: user, accept_terms: true, terms_version: RENTAL_TERMS_VERSION, idempotency_key: crypto.randomBytes(12).toString("hex") } as never)) as any;
  assert.ok(r.ok, "order created");
  return { rid: r.result.rentalId as string, secret: r.result.creatorSecret as string, idem: r, totalUsdc: r.result.totalUsdc as string };
};
const who = (o: { rid: string; secret: string }) => ({ rental_id: o.rid, creator_secret: o.secret });

(async () => {
  // ── Config: fail closed on every gate (B2: payTo must equal the code pin) ──
  {
    // The address is deployment config (RENTALS_ETH_PAYTO); its sha256 is the pin in code (payto-pins.ts). Offline runs
    // use the synthetic address from scripts/test.env and inject its hash (TEST_PAYTO_PINS), never through env.
    const PIN = TEST_PAYTO_PINS.evm;
    assert.ok(validPayTo(PAYTO), "test payTo is valid EIP-55");
    assert.match(PAYTO_PIN_SHA256.evm, /^[0-9a-f]{64}$/, "the code pin is a sha256, not an address");
    assert.ok(!/0x[0-9a-fA-F]{40}/.test(readFileSync("src/lib/rentals/phase2/payto-pins.ts", "utf8")), "payto-pins.ts spells out no address");
    const sql211 = readFileSync("supabase/migrations/20261017211000_phase2_eth_usdc_hardening.sql", "utf8");
    const pins = [...sql211.matchAll(/function public\.rental_eth_payto_pin\(\) returns text\s+language sql (\w+) set search_path = '' as \$\$ select (null|'[^']*')::text \$\$/g)];
    const lastPin = pins[pins.length - 1];
    assert.equal(lastPin?.[1], "stable", "and stays STABLE (SF-F)");
    // Review pin check: computed, never hand-typed. viem's getAddress (the overrides-pinned 2.55.19, resolved through
    // @coinbase/wallet-sdk, which depends on it) derives the EIP-55 form from the lowercase address.
    {
      const { createRequire } = await import("node:module");
      const r0 = createRequire(import.meta.url);
      const viem = createRequire(r0.resolve("@coinbase/wallet-sdk/package.json"))("viem") as { getAddress: (a: string) => string };
      const EIP55 = viem.getAddress(PAYTO.toLowerCase());
      assert.equal(PAYTO, EIP55, "the test payTo is exactly viem's EIP-55 form");
      assert.equal(eip55(PAYTO.toLowerCase()), EIP55, "our own eip55() agrees with viem");
      assert.equal(eip55Checksum(PAYTO.toLowerCase()), EIP55, "payto-pins eip55Checksum() agrees with viem");
      const sqlLit = /\$\$ select '([^']*)'::text \$\$/.exec(lastPin?.[0] ?? "")?.[1];
      assert.ok(sqlLit, "SQL rental_eth_payto_pin() return literal found");
      // The SQL twin and the code pin name the same address: the SQL literal hashes to PAYTO_PIN_SHA256.evm.
      if (sqlLit !== "0x0000000000000000000000000000000000000000") { // export copy: placeholder address, checks run upstream
        assert.equal(sha256Hex(sqlLit!), PAYTO_PIN_SHA256.evm, "SQL rental_eth_payto_pin() literal hashes to the code EVM pin (last definition wins)");
        assert.ok(validPayTo(sqlLit), "SQL literal passes validPayTo");
        assert.equal(viem.getAddress(sqlLit!), sqlLit, "SQL literal is viem-valid EIP-55");
        assert.equal(validPayTo(sqlLit!.toLowerCase()), false, "a lowercase copy would NOT pass validPayTo (so case matters)");
      }
      assert.equal(ethConfig({ ...ENV, RENTALS_ETH_PAYTO: PAYTO.toLowerCase() }, PIN), null, "RENTALS_ETH_PAYTO must be exact EIP-55: lowercase refused");
    }
    assert.equal(ethConfig({ ...ENV, RENTALS_ETH_USDC_ENABLED: "" }, PIN), null, "pinned, but the flag is still required (rail stays off)");
    assert.equal(ethChainFromEnv({ ...ENV, RENTALS_ETH_USDC_ENABLED: "" }, PIN).eth, undefined, "and the page doesn't offer it with the flag off");
    assert.equal(ethConfig(ENV, PIN)?.payTo, PAYTO, "flag + env payTo hashing to the pin: configured");
    assert.equal(ethConfig(ENV), null, "the synthetic address does not hash to the production pin: refused");
    assert.equal(ethConfig({ ...ENV, RENTALS_ETH_PAYTO: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" }, PIN), null, "env payTo other than the pinned one: refused");
    assert.equal(ethConfig(ENV, null), null, "a null pin still refuses everything (fail closed)");
    assert.equal(ethConfig(ENV, PAYTO), null, "an address passed as the pin is not a sha256: refused");
    const P = (env: Record<string, string>) => ethConfig(env, PIN);
    assert.equal(P({}), null, "off by default");
    assert.equal(P({ ...ENV, RENTALS_ETH_USDC_ENABLED: "" }), null, "flag required");
    assert.equal(P({ ...ENV, RENTALS_ETH_NODE_READY: "" }), null, "node-ready ack required");
    assert.equal(P({ ...ENV, RENTALS_ETH_PAYTO: "" }), null, "payTo env required");
    assert.equal(P({ ...ENV, RENTALS_ETH_PAYTO: PAYTO.toLowerCase() }), null, "payTo must be exact EIP-55");
    assert.equal(P({ ...ENV, RENTALS_ETH_PAYTO: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" }), null, "a valid address that isn't the pinned one is refused (env swap can't redirect funds)");
    const flipped = (() => { const i = PAYTO.slice(2).search(/[a-fA-F]/) + 2; const ch = PAYTO[i]; return PAYTO.slice(0, i) + (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()) + PAYTO.slice(i + 1); })();
    assert.equal(P({ ...ENV, RENTALS_ETH_PAYTO: flipped }), null, "a mis-checksummed payTo is refused");
    assert.equal(P({ ...ENV, RENTALS_ETH_PAYTO: "0x" + "0".repeat(40) }), null, "zero address refused");
    assert.equal(ethConfig({ ...ENV, RENTALS_ETH_PAYTO: "0x" + "0".repeat(40) }, sha256Hex("0x" + "0".repeat(40))), null, "zero address refused even when it is the pin");
    const c = P(ENV)!;
    assert.equal(c.net.network, "eip155:11155111", "Base Sepolia deployment -> Ethereum Sepolia");
    assert.equal(c.rpcProvider, "alchemy");
    assert.equal(P({ ...ENV, RENTALS_ETH_RPC: "" })!.rpc, SEPOLIA_PUBLIC_RPC, "Sepolia may use the public endpoint");
    assert.equal(P({ ...ENV, RENTALS_ETH_RPC: "https://evil.example/v2/" + "a".repeat(32) }), null, "non-allowlisted RPC refused");
    // The read side needs only the chain + RPC (S3).
    assert.equal(ethVerifyConfig({ RENTALS_ETH_RPC: RPC })!.net.network, "eip155:11155111");
    assert.equal(ethVerifyConfig({ RENTALS_X402_NETWORK: "mainnet" }), null, "mainnet read side needs a keyed RPC too");
    const MAIN = { ...ENV, RENTALS_X402_NETWORK: "mainnet", RENTALS_ETH_RPC: "https://eth-mainnet.g.alchemy.com/v2/" + "k".repeat(32) };
    assert.equal(P(MAIN), null, "mainnet without mainnetEnabled() is off");
    const MAINON = { ...MAIN, RENTALS_PHASE2_MODE: "mainnet", RENTALS_MAINNET_ENABLED: "1", RENTALS_MAINNET_ACK: "i-authorize-mainnet-1-dollar-test", CDP_API_KEY_ID: "x", CDP_API_KEY_SECRET: "y" };
    assert.equal(P(MAINON)!.net.network, "eip155:1");
    assert.equal(P({ ...MAINON, RENTALS_ETH_RPC: "" }), null, "mainnet never falls back to a public RPC");
    assert.equal(P({ ...MAINON, RENTALS_ETH_RPC: "https://eth-sepolia.g.alchemy.com/v2/" + "k".repeat(32) }), null, "testnet RPC refused on mainnet");
    assert.ok(ETH_CLOCK_SKEW_MS <= 15_000, "pre-quote allowance is 15 s or less (S1)");
  }
  // ── RPC allowlist vectors ──────────────────────────────────────────────
  {
    const K = "Ab3_" + "x".repeat(28);
    const ok: [string, boolean, string][] = [
      ["https://eth-mainnet.g.alchemy.com/v2/" + K, true, "alchemy"], ["https://mainnet.infura.io/v3/" + "f".repeat(32), true, "infura"],
      ["https://red-bold-sea.quiknode.pro/" + K + "/", true, "quicknode"], ["https://rpc.ankr.com/eth/" + K, true, "ankr"],
      ["https://eth-sepolia.g.alchemy.com/v2/" + K, false, "alchemy"], ["https://sepolia.infura.io/v3/" + K, false, "infura"], ["https://rpc.ankr.com/eth_sepolia/" + K, false, "ankr"],
    ];
    for (const [u, main, name] of ok) assert.equal(ethRpcProvider(u, main), name, u.replace(K, "<key>"));
    const bad: [string, boolean][] = [
      ["http://eth-mainnet.g.alchemy.com/v2/" + K, true], ["https://user:pw@eth-mainnet.g.alchemy.com/v2/" + K, true], ["https://eth-mainnet.g.alchemy.com:8443/v2/" + K, true],
      ["https://eth-mainnet.g.alchemy.com/v2/", true], ["https://eth-mainnet.g.alchemy.com/v2/short", true], ["https://1.2.3.4/v2/" + K, true],
      ["https://eth-mainnet.g.alchemy.com.evil.io/v2/" + K, true], ["https://eth-sepolia.g.alchemy.com/v2/" + K, true], ["https://sepolia.quiknode.pro/" + K + "/", true],
      ["https://eth-mainnet.g.alchemy.com/v2/" + K, false], ["https://cloudflare-eth.com", true], ["not a url", true], ["https://rpc.ankr.com/eth/" + K + "#x", true],
    ];
    for (const [u, main] of bad) assert.equal(ethRpcProvider(u, main), null, "refused: " + u.replace(K, "<key>"));
  }
  // ── Vectors: EIP-55, amounts, calldata, tx hash ──────────────────────
  {
    assert.equal(eip55(ETH_MAINNET.asset.toLowerCase()), ETH_MAINNET.asset, "mainnet USDC checksum");
    assert.equal(eip55(ETH_SEPOLIA.asset.toLowerCase()), ETH_SEPOLIA.asset, "Sepolia USDC checksum");
    assert.equal(eip55("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "EIP-55 spec vector");
    assert.ok(validPayTo(PAYTO) && !validPayTo(PAYTO.toLowerCase()) && !validPayTo(undefined));
    assert.equal(ETH_TAG_UNIT, 10_000);
    assert.equal(taggedAmount(123_450_000, 1), 123_460_000);
    assert.equal(taggedAmount(123_450_000, 99), 124_440_000);
    assert.throws(() => taggedAmount(123_450_000, 0)); assert.throws(() => taggedAmount(123_450_000, 100)); assert.throws(() => taggedAmount(0, 1));
    assert.equal(usdc2(123_460_000), "123.46"); assert.equal(usdc2(10_000), "0.01"); assert.equal(usdc6(123_456_789), "123.456789"); assert.equal(usdc2(1), "0.000001");
    assert.equal(erc20TransferData("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "123460000"),
      "0xa9059cbb0000000000000000000000005aaeb6053f3e94c9b9a09f33669435e7ef1beaed" + "00000000000000000000000000000000000000000000000000000000075bd9a0", "transfer(to, amount) calldata");
    assert.throws(() => erc20TransferData("0x123", "1")); assert.throws(() => erc20TransferData(PAYTO, "1.5")); assert.throws(() => erc20TransferData(PAYTO, "0"));
    const h = rnd();
    assert.equal(normTxHash(" " + h.toUpperCase().replace("0X", "0x") + " "), h, "hash normalised lowercase");
    assert.equal(normTxHash("0x1234"), null); assert.equal(normTxHash(h + "00"), null); assert.equal(normTxHash(42), null);
    assert.ok(isEthRef("eth_" + "a".repeat(32)) && !isEthRef("x402_" + "a".repeat(32)) && !isEthRef("eth_" + "A".repeat(32)));
    for (const code of ["window_too_short", "rail_busy", "amount_mismatch", "outside_window", "nope"]) { const c = ethErrorCopy(code); assert.ok(c.title.length > 5 && /[.]$/.test(c.body), "complete sentences: " + code); }
    assert.match(ETH_COPY.gasNote, /You pay Ethereum gas/);
    assertCustomerSafe(ETH_COPY);
  }
  // ── The on-chain check ─────────────────────────────────────────────────
  {
    const c = chain();
    const rpc = makeRpc(RPC, c.f);
    const want = { net: ETH_SEPOLIA, payTo: PAYTO, amountAtomic: 5_010_000 };
    const ok = c.mine({ amount: 5_010_000, tsMs: T0, block: 4950 });
    let s = await inspectEthTx(rpc, ok.tx, want);
    assert.equal(s.kind, "match"); assert.equal((s as any).final, false, "mined but above finalized: not final");
    assert.equal((s as any).payer, "0x" + "b".repeat(40)); assert.equal((s as any).blockTimeMs, Math.floor(T0 / 1000) * 1000);
    c.finalize(4950);
    s = await inspectEthTx(rpc, ok.tx, want);
    assert.equal(s.kind === "match" && s.final, true, "finalized + 12 deep = final");
    c.st.finalized = 4950; c.st.head = 4950 + ETH_MIN_CONFIRMATIONS - 2;
    s = await inspectEthTx(rpc, ok.tx, want);
    assert.equal(s.kind === "match" && s.final, false, "finalized but under 12 confirmations is not final (belt and braces)");
    c.finalize(4950);
    assert.equal((await inspectEthTx(rpc, rnd(), want)).kind, "not_found");
    assert.deepEqual(await inspectEthTx(rpc, c.mine({ amount: 5_010_000, tsMs: T0, status: "0x0" }).tx, want), { kind: "reverted", final: false }, "revert above finalized: not final");
    assert.deepEqual(await inspectEthTx(rpc, c.mine({ amount: 5_010_000, tsMs: T0, status: "0x0", block: 4940 }).tx, want), { kind: "reverted", final: true }, "finalized revert");
    const nost = c.mine({ amount: 5_010_000, tsMs: T0, block: 4941 }); delete c.st.receipts.get(nost.tx).status;
    assert.equal((await inspectEthTx(rpc, nost.tx, want)).kind, "rpc_error", "a receipt with no status is not a revert (B1)");
    const mm = c.mine({ amount: 5_000_000, tsMs: T0 });
    assert.deepEqual(await inspectEthTx(rpc, mm.tx, want), { kind: "no_match", reason: "amount_mismatch", amountAtomic: 5_000_000, payer: "0x" + "b".repeat(40), blockNumber: mm.block });
    assert.equal((await inspectEthTx(rpc, c.mine({ amount: 5_010_001, tsMs: T0 }).tx, want)).kind, "no_match", "1 atomic over is not exact");
    assert.deepEqual(await inspectEthTx(rpc, c.mine({ amount: 5_010_000, tsMs: T0, to: "0x" + "c".repeat(40) }).tx, want), { kind: "no_match", reason: "no_transfer_to_payto" });
    assert.deepEqual(await inspectEthTx(rpc, c.mine({ amount: 5_010_000, tsMs: T0, asset: "0x" + "d".repeat(40) }).tx, want), { kind: "no_match", reason: "no_transfer_to_payto" }, "other token ignored");
    assert.deepEqual(await inspectEthTx(rpc, c.mine({ amount: 5_010_000, tsMs: T0, removed: true }).tx, want), { kind: "no_match", reason: "no_transfer_to_payto" }, "removed log ignored");
    const two = c.mine({ amount: 5_010_000, tsMs: T0 });
    c.st.receipts.get(two.tx).logs.push({ ...two.log, logIndex: "0x4" });
    assert.deepEqual(await inspectEthTx(rpc, two.tx, want), { kind: "no_match", reason: "multiple_transfers" }, "two transfers to payTo in one tx refused");
    const reorg = c.mine({ amount: 5_010_000, tsMs: T0, block: 4800 });
    c.st.blocks.set(4800, { hash: rnd(), ts: Math.floor(T0 / 1000) });
    assert.equal((await inspectEthTx(rpc, reorg.tx, want)).kind, "unstable", "receipt from a non-canonical block");
    c.st.chainId = "0x1";
    assert.equal((await inspectEthTx(rpc, ok.tx, want)).kind, "rpc_error", "wrong chain fails closed");
    c.st.chainId = ETH_SEPOLIA.chainIdHex; c.st.down = true;
    assert.equal((await inspectEthTx(rpc, ok.tx, want)).kind, "rpc_error");
  }
  // ── Bind: unique tags, idempotent, gates ─────────────────────────────
  const m = mk();
  const A = await newOrder(m), B = await newOrder(m, "bob.rig1");
  {
    const qa = await bindEth(m.d, m.e, who(A)) as any, qb = await bindEth(m.d, m.e, who(B)) as any;
    assert.ok(qa.ok && qb.ok);
    const base = Math.round(Number(A.totalUsdc) * 1e6);
    assert.equal(Number(qa.quote.amountAtomic), base + 10_000, "first order: price + 1 cent");
    assert.equal(Number(qb.quote.amountAtomic), base + 20_000, "same price, second order: price + 2 cents (unique)");
    assert.equal(qa.quote.payTo, PAYTO); assert.equal(qa.quote.network, "eip155:11155111"); assert.ok(isEthRef(qa.quote.paymentRef));
    const again = await bindEth(m.d, m.e, who(A)) as any;
    assert.equal(again.quote.paymentRef, qa.quote.paymentRef, "one quote per order (idempotent)");
    assert.equal((await bindEth(m.d, m.e, { rental_id: A.rid, creator_secret: "wrong" }) as any).error, "not_found", "owner only");
    const bind = await m.store.getBinding(qa.quote.paymentRef);
    assert.equal(bind!.expectedAtomic, base + 10_000, "binding expects the tagged amount");
    // x402 never treats the eth_ ref as its own.
    assert.deepEqual(await m.xp.pay(qa.quote.paymentRef, { x402Version: 2, accepted: {}, payload: {} } as never), { ok: false, error: "unknown_ref" });
    assert.equal((await m.xp.requestStatus(qa.quote.paymentRef)).status, 404);
    // createRental replay returns the x402 challenge, never the Ethereum one.
    const rep = (await createRental(m.d, { rigs: 1, days: 1, pool_id: "braiins", username: "alice.rig1", accept_terms: true, terms_version: RENTAL_TERMS_VERSION, idempotency_key: (await m.store.getOrderByPublicId(A.rid))!.idemKey } as never)) as any;
    assert.ok(rep.replay && /^x402_/.test(rep.result.payment.paymentRef), "replay keeps the x402 challenge");
  }
  const qa = (await bindEth(m.d, m.e, who(A)) as any).quote, qb = (await bindEth(m.d, m.e, who(B)) as any).quote;
  // ── Claim: front-run refused, not-yet-mined, confirming, sweep hold, settle ──
  {
    const bTx = m.c.mine({ amount: Number(qb.amountAtomic), tsMs: m.nowMs() + 30_000, block: 5001 });
    const fr = await claimEth(m.d, m.e, { ...who(A), tx_hash: bTx.tx }) as any;
    assert.equal(fr.error, "amount_mismatch", "B's payment can't be claimed for A (front-running gains nothing)");
    assert.equal(m.store.alerts.filter((a) => a.kind === "eth_amount_mismatch").length, 1);
    assert.equal(um(m.es, bTx.tx)?.reason, "amount_mismatch", "wrong-amount transfer durably recorded (S2)");
    assert.equal(um(m.es, bTx.tx)?.amountAtomic, Number(qb.amountAtomic));
    for (let i = 0; i < 3; i++) assert.equal((await claimEth(m.d, m.e, { ...who(A), tx_hash: bTx.tx }) as any).error, "amount_mismatch");
    assert.equal(m.store.alerts.filter((a) => a.kind === "eth_amount_mismatch").length, 1, "alert once per tx, however often it is pasted");
    const unseen = rnd();
    const ns = await claimEth(m.d, m.e, { ...who(A), tx_hash: unseen }) as any;
    assert.equal(ns.result.claim.state, "not_seen_yet"); assert.equal(m.es.claims.size, 0, "no row for an unmined hash (no junk rows)");
    assert.equal((await claimEth(m.d, m.e, { ...who(A), tx_hash: "0xnope" }) as any).error, "invalid_tx_hash");
    const justBefore = m.c.mine({ amount: Number(qa.amountAtomic), tsMs: T0 - 20_000 });
    assert.equal((await claimEth(m.d, m.e, { ...who(A), tx_hash: justBefore.tx }) as any).error, "tx_before_quote", "20 s before the quote is outside the 15 s allowance (S1)");
    const old = m.c.mine({ amount: Number(qa.amountAtomic), tsMs: T0 - 10 * 60_000 });
    assert.equal((await claimEth(m.d, m.e, { ...who(A), tx_hash: old.tx }) as any).error, "tx_before_quote", "a tx mined before the quote can't pay it");
    // A pays correctly, mined 14 min into the window, finalizes after the window.
    m.tick(14 * 60_000);
    const aTx = m.c.mine({ amount: Number(qa.amountAtomic), tsMs: m.nowMs(), block: 5100, from: "0x" + "e".repeat(40) });
    m.c.st.head = 5105;
    const cl = await claimEth(m.d, m.e, { ...who(A), tx_hash: aTx.tx.toUpperCase().replace("0X", "0x") }) as any;
    assert.equal(cl.result.claim.state, "confirming"); assert.equal(cl.result.status, "awaiting_payment");
    assert.ok(await ethClaimPending(m.e, (await m.store.getOrderByPublicId(A.rid))!.id));
    // Cancel is refused while it confirms.
    const cx = await handleAccess({ action: "cancel", ...who(A) }, { env: ENV, deps: m.d });
    assert.deepEqual([cx.status, cx.body.error], [409, "payment_pending"]);
    // Past the window: the sweep keeps A open (claim confirming) and expires nothing paid.
    m.tick(20 * 60_000);
    await sweepExpired(m.d);
    assert.equal((await m.store.getOrderByPublicId(A.rid))!.state, "awaiting_payment", "A held open while its transfer finalizes");
    assert.equal((await m.store.getOrderByPublicId(B.rid))!.state, "expired", "B's quote grace is over and B has no claim: expired");
    // The same tx can't be claimed for B.
    assert.equal((await claimEth(m.d, m.e, { ...who(B), tx_hash: aTx.tx }) as any).error, "tx_already_used", "a tx claimed for A is refused for B before any chain read");
    assert.ok(!um(m.es, aTx.tx), "and never recorded as unmatched");
    // Finality -> settled -> delivering with a signed job naming the Ethereum settlement.
    m.c.finalize(5100);
    const r = await sweepEth(m.d, m.e);
    assert.equal(r.settled, 1);
    const oa = (await m.store.getOrderByPublicId(A.rid))!;
    assert.equal(oa.state, "delivering", "an on-time payment that finalized after the window still starts the rental");
    const s = await m.store.getSettlement(qa.paymentRef);
    assert.deepEqual([s!.network, s!.txHash, s!.payer, s!.amountAtomic], ["eip155:11155111", aTx.tx, "0x" + "e".repeat(40), Number(qa.amountAtomic)]);
    assert.equal(s!.settledAt, Math.floor((T0 + 14 * 60_000) / 1000) * 1000, "settledAt = block time");
    const job = m.store.jobs.find((j) => j.payload.order_ref === A.rid)!;
    assert.deepEqual([job.payload.payment!.network, job.payload.payment!.tx_hash, job.payload.pay_to, job.payload.payment!.amount_atomic], ["eip155:11155111", aTx.tx, PAYTO, qa.amountAtomic]);
    assert.equal(m.store.refunds.length, 0, "no refund rows");
    const st = await statusEth(m.d, m.e, who(A)) as any;
    assert.equal(st.result.claim.state, "settled");
    const rp = await claimEth(m.d, m.e, { ...who(A), tx_hash: aTx.tx }) as any;
    assert.equal(rp.result.claim.state, "settled", "replayed claim: same answer, nothing new");
    assert.equal(m.store.jobs.filter((j) => j.payload.order_ref === A.rid).length, 1, "one job");
    assert.ok(!(await ethClaimPending(m.e, oa.id)));
    // Flag off: a recorded Ethereum settlement still reads as paid.
    const look = await m.xp.lookup(qa.paymentRef);
    assert.ok(look.found && look.paid && look.network === "eip155:11155111");
  }
  // ── Same tx can't pay two orders even if amounts collided (DB key on tx_hash) ──
  {
    const m2 = mk();
    const C = await newOrder(m2), D = await newOrder(m2, "dan.rig1");
    const qc = (await bindEth(m2.d, m2.e, who(C)) as any).quote, qd = (await bindEth(m2.d, m2.e, who(D)) as any).quote;
    const t = m2.c.mine({ amount: Number(qc.amountAtomic), tsMs: m2.nowMs() + 1000, block: 5001 });
    m2.c.st.head = 5003;
    await claimEth(m2.d, m2.e, { ...who(C), tx_hash: t.tx });
    // Force D's quote to the same amount (simulate a collision) and try to reuse the tx.
    m2.es.quotes.get(qd.paymentRef)!.amountAtomic = Number(qc.amountAtomic);
    const reuse = await claimEth(m2.d, m2.e, { ...who(D), tx_hash: t.tx }) as any;
    assert.equal(reuse.error, "tx_already_used", "one transfer pays one order: " + JSON.stringify(reuse));
  }
  // ── Late payment: recorded, refund row pending_owner on the Ethereum network, never sent ──
  {
    const m3 = mk();
    const E = await newOrder(m3);
    const q = (await bindEth(m3.d, m3.e, who(E)) as any).quote;
    m3.tick(40 * 60_000);
    await sweepExpired(m3.d);
    assert.equal((await m3.store.getOrderByPublicId(E.rid))!.state, "expired");
    const late = m3.c.mine({ amount: Number(q.amountAtomic), tsMs: m3.nowMs() - 60_000, block: 5200 });
    m3.c.finalize(5200);
    const r = await claimEth(m3.d, m3.e, { ...who(E), tx_hash: late.tx }) as any;
    assert.equal(r.result.claim.state, "settled");
    const o = (await m3.store.getOrderByPublicId(E.rid))!;
    assert.equal(o.state, "refund_pending", "late money -> refund queue");
    assert.equal(m3.store.refunds.length, 1); assert.equal(m3.store.refunds[0].status, "pending_owner", "never auto-sent");
    assert.equal(m3.store.refunds[0].network, "eip155:11155111", "refund goes back on Ethereum");
    assert.equal(m3.store.jobs.length, 0, "no job for late money");
    // After reserved_until a tx is outside the window (manual).
    m3.tick(3 * 3600_000);
    const F = await newOrder(m3, "fay.rig1");
    const qf = (await bindEth(m3.d, m3.e, who(F)) as any).quote;
    m3.tick(3 * 3600_000);
    const tooLate = m3.c.mine({ amount: Number(qf.amountAtomic), tsMs: m3.nowMs() });
    assert.equal((await claimEth(m3.d, m3.e, { ...who(F), tx_hash: tooLate.tx }) as any).error, "outside_window");
    assert.equal(um(m3.es, tooLate.tx)?.reason, "outside_window", "late transfer durably recorded (S2)");
    await claimEth(m3.d, m3.e, { ...who(F), tx_hash: tooLate.tx });
    assert.equal(m3.store.alerts.filter((a) => a.kind === "eth_outside_window").length, 1, "alert once per tx");
  }
  // ── B1: negatives on a recorded claim are terminal only with finality; flaky answers stay unresolved ──
  {
    const m4 = mk();
    const G = await newOrder(m4);
    const q = (await bindEth(m4.d, m4.e, who(G)) as any).quote;
    const t = m4.c.mine({ amount: Number(q.amountAtomic), tsMs: m4.nowMs() + 1000, block: 5300 });
    m4.c.st.head = 5301;
    await claimEth(m4.d, m4.e, { ...who(G), tx_hash: t.tx });
    const rc = m4.c.st.receipts.get(t.tx);
    const flaky: [string, () => void, () => void][] = [
      ["receipt with no status", () => { delete rc.status; }, () => { rc.status = "0x1"; }],
      ["empty logs", () => { rc.logs_ = rc.logs; rc.logs = []; }, () => { rc.logs = rc.logs_; }],
      ["receipt missing (lagging node)", () => { m4.c.st.receipts.delete(t.tx); }, () => { m4.c.st.receipts.set(t.tx, rc); }],
      ["non-final revert", () => { rc.status = "0x0"; }, () => { rc.status = "0x1"; }],
    ];
    for (const [name, brk, fix] of flaky) {
      brk(); m4.c.finalize(5250);   // claim block still above finalized
      const r = await sweepEth(m4.d, m4.e, { clock: m4.nowMs });
      assert.equal(r.settled, 0, name);
      assert.equal(m4.es.resolutions.filter((x) => x.txHash === t.tx).length, 0, "no outcome on a flaky answer: " + name);
      fix();
    }
    // Missing receipt even after the claim's block finalized, but the canonical block there is still ours: not terminal.
    m4.c.st.receipts.delete(t.tx); m4.c.finalize(5300);
    await sweepEth(m4.d, m4.e, { clock: m4.nowMs });
    assert.ok(!m4.es.resolutions.some((x) => x.txHash === t.tx && x.outcome === "dropped"), "missing receipt alone never becomes dropped");
    // Stuck: one alert + manual_review, still unresolved (the hold keeps the order while it is under the cap).
    m4.tick(ETH_STUCK_MS + 1000);
    let r = await sweepEth(m4.d, m4.e, { clock: m4.nowMs });
    assert.equal(r.alerted, 1, "stuck claim alerts once");
    assert.ok(m4.store.alerts.some((a) => a.kind === "eth_claim_stuck"));
    r = await sweepEth(m4.d, m4.e, { clock: m4.nowMs });
    assert.equal(r.alerted, 0, "only once");
    // Finality-backed: the claim's finalized height now holds a DIFFERENT block -> dropped + manual_review + alert.
    m4.c.st.blocks.set(5300, { hash: rnd(), ts: Math.floor(m4.nowMs() / 1000) });
    await sweepEth(m4.d, m4.e, { clock: m4.nowMs });
    const outs = m4.es.resolutions.filter((x) => x.txHash === t.tx).map((x) => x.outcome);
    assert.ok(outs.includes("dropped") && outs.includes("manual_review"), "reorged out of a finalized block: dropped + manual review");
    assert.ok(m4.store.alerts.some((a) => a.kind === "eth_claim_failed"), "and an outbox alert");
    assert.equal(await m4.store.getSettlement(q.paymentRef), null);
    const o = (await m4.store.getOrderByPublicId(G.rid))!;
    assert.equal(await ethExpiryHold(m4.e, o), false, "no unresolved claim, grace over: no hold");
    m4.es.readFails = true;
    assert.equal(await ethExpiryHold(m4.e, o), true, "read error holds (fail closed)");
    assert.equal(await ethExpiryHold(m4.e, { ...o, expiresAt: m4.nowMs() - ETH_HOLD_MAX_MS - 1 }), false, "but never past the hold cap");
    assert.equal(await ethClaimPending(m4.e, o.id), true, "cancel guard fails closed on read error");
    m4.es.readFails = false;
    // Finalized revert of a recorded claim -> failed_onchain + manual_review + alert.
    const m4b = mk();
    const G2 = await newOrder(m4b);
    const q2 = (await bindEth(m4b.d, m4b.e, who(G2)) as any).quote;
    const t2 = m4b.c.mine({ amount: Number(q2.amountAtomic), tsMs: m4b.nowMs() + 1000, block: 5300 });
    m4b.c.st.head = 5301;
    await claimEth(m4b.d, m4b.e, { ...who(G2), tx_hash: t2.tx });
    m4b.c.st.receipts.get(t2.tx).status = "0x0";
    m4b.c.finalize(5300);
    await sweepEth(m4b.d, m4b.e, { clock: m4b.nowMs });
    const o2 = m4b.es.resolutions.filter((x) => x.txHash === t2.tx).map((x) => x.outcome);
    assert.deepEqual(o2, ["manual_review", "alerted", "failed_onchain"], "finalized revert is terminal, flagged + alerted first");
    assert.ok(m4b.store.alerts.some((a) => a.kind === "eth_claim_failed"));
    assert.equal(m4b.store.refunds.length, 0, "never an automatic refund");
    // Mainnet ETH not wired without Supabase: verify side is off too.
    assert.equal(mk({ ...ENV, RENTALS_X402_NETWORK: "mainnet", RENTALS_ETH_RPC: "https://eth-mainnet.g.alchemy.com/v2/" + "k".repeat(32) }).e.rpc, null);
  }
  // ── B2: payTo pin enforced on quotes, claims, resolution and lookup ──
  {
    const mp = mk();
    const P = await newOrder(mp);
    mp.es.sqlPin = null;
    assert.equal((await bindEth(mp.d, mp.e, who(P)) as any).error, "rail_unavailable", "SQL pin unset: no quote");
    mp.es.sqlPin = PAYTO;
    const qp = (await bindEth(mp.d, mp.e, who(P)) as any).quote;
    const tp = mp.c.mine({ amount: Number(qp.amountAtomic), tsMs: mp.nowMs() + 1000, block: 5300 });
    mp.c.finalize(5300);
    const other = { ...mp.e, pin: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" };
    assert.equal((await claimEth(mp.d, other, { ...who(P), tx_hash: tp.tx }) as any).error, "rail_unavailable", "quote payTo != pin: no claim");
    await claimEth(mp.d, { ...mp.e, rpc: null }, { ...who(P), tx_hash: tp.tx });
    // Record a claim directly, then resolve with a different pin: never settles, alerts at once.
    await mp.es.recordClaim({ txHash: tp.tx, providerRef: qp.paymentRef, network: qp.network, payer: "0x" + "b".repeat(40), logIndex: 3, amountAtomic: Number(qp.amountAtomic), blockNumber: 5300, blockHash: tp.bh, blockTimeMs: mp.nowMs(), at: mp.nowMs() });
    const r = await sweepEth(mp.d, other, { clock: mp.nowMs });
    assert.deepEqual([r.settled, r.alerted], [0, 1], "pin mismatch: never settles, alerts immediately");
    // Settled with the right pin; lookup with another pin reads unpaid.
    await sweepEth(mp.d, mp.e, { clock: mp.nowMs });
    assert.ok(await mp.store.getSettlement(qp.paymentRef));
    const { ethLookup } = await import("../src/lib/rentals/phase2/eth/service");
    assert.equal(((await ethLookup(mp.store, null, mp.e, qp.paymentRef)) as any).paid, true);
    assert.equal(((await ethLookup(mp.store, null, other, qp.paymentRef)) as any).paid, false, "lookup refuses a payTo that isn't the pin");
    assert.equal(((await ethLookup(mp.store, null, null, qp.paymentRef)) as any).paid, false, "no deps, no pin: unpaid (fail closed)");
  }
  // ── S6 mirror: bind amount comes from the order row ──
  {
    const ms = mk();
    const S = await newOrder(ms);
    const o = (await ms.store.getOrderByPublicId(S.rid))!;
    const r = await ms.es.bind({ providerRef: "eth_" + "1".repeat(32), orderId: o.id, network: "eip155:11155111", payTo: PAYTO, asset: ETH_SEPOLIA.asset, baseAtomic: 1_000_000, expiresAt: o.expiresAt, reservedUntil: o.expiresAt + 1, now: ms.nowMs(), challenge: {} as never });
    assert.deepEqual(r, { ok: false, error: "order_not_payable" }, "caller base_atomic that disagrees with the order is refused");
  }
  // ── S3: rail switched off with a claim confirming: still resolved, still held ──
  {
    const m9 = mk();
    const R = await newOrder(m9);
    const qr = (await bindEth(m9.d, m9.e, who(R)) as any).quote;
    const tr = m9.c.mine({ amount: Number(qr.amountAtomic), tsMs: m9.nowMs() + 1000, block: 5300 });
    m9.c.st.head = 5301;
    await claimEth(m9.d, m9.e, { ...who(R), tx_hash: tr.tx });
    const off = wireEth(m9.d, { ...ENV, RENTALS_ETH_USDC_ENABLED: "" }, m9.c.f, { pinSha: TEST_PAYTO_PINS.evm })!;
    (off as any).store = m9.e.store;
    assert.equal(off.cfg, null); assert.ok(off.rpc, "read side stays on");
    assert.ok(m9.d.expiryHold, "sweep hold stays installed");
    m9.tick(20 * 60_000);
    await sweepExpired(m9.d);
    assert.equal((await m9.store.getOrderByPublicId(R.rid))!.state, "awaiting_payment", "held while it confirms, rail off");
    m9.c.finalize(5300);
    const r = await sweepEth(m9.d, off, { clock: m9.nowMs });
    assert.equal(r.settled, 1, "rail off: a confirming claim still settles");
    assert.equal((await m9.store.getOrderByPublicId(R.rid))!.state, "delivering");
    // No RPC at all: alerts at once instead of stranding.
    const m10 = mk();
    const U = await newOrder(m10);
    const qu = (await bindEth(m10.d, m10.e, who(U)) as any).quote;
    const tu = m10.c.mine({ amount: Number(qu.amountAtomic), tsMs: m10.nowMs() + 1000, block: 5300 }); m10.c.st.head = 5301;
    await claimEth(m10.d, m10.e, { ...who(U), tx_hash: tu.tx });
    const r2 = await sweepEth(m10.d, { ...m10.e, cfg: null, rpc: null, net: null }, { clock: m10.nowMs });
    assert.equal(r2.alerted, 1, "rail off with no RPC: alert immediately");
  }
  // ── S4: sweep deadline caps RPC work ──
  {
    const m11 = mk();
    const V = await newOrder(m11);
    const qv = (await bindEth(m11.d, m11.e, who(V)) as any).quote;
    const tv = m11.c.mine({ amount: Number(qv.amountAtomic), tsMs: m11.nowMs() + 1000, block: 5300 }); m11.c.st.head = 5301;
    await claimEth(m11.d, m11.e, { ...who(V), tx_hash: tv.tx });
    m11.c.finalize(5300);
    let t = 0;
    const before = m11.c.st.calls.length;
    const r = await sweepEth(m11.d, m11.e, { budgetMs: 10_000, clock: () => (t += 6_000) });
    assert.equal(r.settled, 0, "budget spent: no settlement this pass");
    assert.ok(m11.c.st.calls.length - before <= 1, "RPC calls stop at the deadline");
    let dead = 0;
    await assert.rejects(withDeadline(async () => { dead++; return 1; }, 5, () => 10)("eth_chainId", []));
    assert.equal(dead, 0);
  }
  // ── S5: x402 refs of an order with an ETH claim confirming are not payable ──
  {
    const m12 = mk();
    const W = await newOrder(m12);
    const xref = W.idem.result.payment.paymentRef as string;
    assert.equal((await m12.xp.requestStatus(xref)).status, 402, "payable before any ETH claim");
    const qw = (await bindEth(m12.d, m12.e, who(W)) as any).quote;
    const tw = m12.c.mine({ amount: Number(qw.amountAtomic), tsMs: m12.nowMs() + 1000, block: 5300 }); m12.c.st.head = 5301;
    await claimEth(m12.d, m12.e, { ...who(W), tx_hash: tw.tx });
    const rs = await m12.xp.requestStatus(xref);
    assert.deepEqual([rs.status, (rs.body as any).error], [503, "payment_pending"], "GET answers payment_pending");
    assert.equal(await m12.xp.payableState(xref), "not_payable", "pay refuses before the facilitator");
    assert.equal(await m12.xp.orderPayable(xref), false);
  }
  // ── Lost race: two valid transfers for one quote -> manual review, never auto-refund ──
  {
    const m5 = mk();
    const H = await newOrder(m5);
    const q = (await bindEth(m5.d, m5.e, who(H)) as any).quote;
    const t1 = m5.c.mine({ amount: Number(q.amountAtomic), tsMs: m5.nowMs() + 1000, block: 5400 });
    const t2 = m5.c.mine({ amount: Number(q.amountAtomic), tsMs: m5.nowMs() + 2000, block: 5401 });
    m5.c.st.head = 5402;
    await claimEth(m5.d, m5.e, { ...who(H), tx_hash: t1.tx });
    await claimEth(m5.d, m5.e, { ...who(H), tx_hash: t2.tx });
    m5.c.finalize(5401);
    await sweepEth(m5.d, m5.e);
    assert.ok(m5.es.resolutions.some((x) => x.outcome === "settled") && m5.es.resolutions.some((x) => x.outcome === "lost_race"));
    assert.ok(m5.store.alerts.some((a) => a.kind === "refund_manual_review"));
    assert.equal(m5.store.refunds.length, 0, "the second payment is never refunded automatically");
  }
  // ── Gates: window too short, flag off, route ─────────────────────────
  {
    const m6 = mk();
    const I = await newOrder(m6);
    m6.tick(13 * 60_000);
    assert.equal((await bindEth(m6.d, m6.e, who(I)) as any).error, "window_too_short");
    const off = mk({ ...ENV, RENTALS_ETH_USDC_ENABLED: "" });
    const J = await newOrder(off);
    assert.equal((await bindEth(off.d, off.e, who(J)) as any).error, "rail_unavailable");
    assert.equal(await off.d.expiryHold!((await off.store.getOrderByPublicId(J.rid))!), false, "rail off, no quote: the sweep hold never holds");
    (off.es as MemoryEthStore).migrated = false; resetEthCaches();
    assert.equal(await ethClaimPending(off.e, "x"), false, "ETH schema absent (e.g. prod before it ships): no hold, no cancel block");
    assert.deepEqual(ethChainFromEnv({}), {}, "page shows no Ethereum option with the rail off");
    assert.equal(ethChainFromEnv(ENV, TEST_PAYTO_PINS.evm).eth!.payTo, PAYTO, "picker option comes from the same config");
    assert.equal(chainInfo({ ...ENV, RENTALS_ETH_USDC_ENABLED: "" }, TEST_PAYTO_PINS).eth, undefined, "pinned but flag off: the page never offers Ethereum");
    assert.equal(chainInfo({ ...ENV }, TEST_PAYTO_PINS).eth?.payTo, PAYTO, "flag on with a pinned payTo: the offer pays exactly that address");
    assert.equal(chainInfo({ ...ENV }).eth, undefined, "the synthetic payTo under the production pin: no Ethereum offer");
    assert.equal(chainInfo({ RENTALS_PHASE2_ENABLED: "1", RENTALS_PHASE2_MODE: "staging" }).eth, undefined);
    const incr = (() => { const m = new Map<string, number>(); return async (k: string) => { m.set(k, (m.get(k) ?? 0) + 1); return { count: m.get(k)!, ttlSec: 60 }; }; })();
    assert.equal((await handleEth({ action: "bind", ...who(J) }, { env: { ...ENV, RENTALS_HUMAN_CHECKOUT: "" }, deps: off.d, incr, ipBucket: "1" })).status, 404, "human checkout off: 404");
    assert.equal((await handleEth({ action: "bind", ...who(J) }, { env: ENV, deps: off.d, eth: off.e, incr, ipBucket: "1" })).body.error, "rail_unavailable");
    const m7 = mk();
    const ords = [] as Awaited<ReturnType<typeof newOrder>>[];
    for (let i = 0; i < ETH_BIND_LIMIT.perIp + 1; i++) ords.push(await newOrder(m7, `u${i}.rig1`));
    const outs = [];
    for (const o of ords) outs.push((await handleEth({ action: "bind", ...who(o) }, { env: ENV, deps: m7.d, eth: m7.e, incr, ipBucket: "9" })).status);
    assert.deepEqual(outs, [200, 200, 200, 429], "3 binds per IP per hour");
    // B3: junk / wrong-secret binds and remounts of an existing quote never charge the limiter.
    const counts = new Map<string, number>();
    const cIncr = async (k: string) => { counts.set(k, (counts.get(k) ?? 0) + 1); return { count: counts.get(k)!, ttlSec: 60 }; };
    for (let i = 0; i < 10; i++) assert.equal((await handleEth({ action: "bind", rental_id: ords[0].rid, creator_secret: "junk" + i }, { env: ENV, deps: m7.d, eth: m7.e, incr: cIncr, ipBucket: "5" })).status, 404);
    for (let i = 0; i < 10; i++) assert.equal((await handleEth({ action: "bind", ...who(ords[0]) }, { env: ENV, deps: m7.d, eth: m7.e, incr: cIncr, ipBucket: "5" })).status, 200, "remount returns the existing quote");
    assert.equal(counts.size, 0, "limiter untouched by junk and remounts");
    assert.equal(ETH_BIND_LIMIT.global, 100);
    assert.equal((await handleEth({ action: "bind", ...who(ords[3]) }, { env: ENV, deps: m7.d, eth: m7.e, incr: async () => null, ipBucket: "8" })).body.error, "rate_limit_unavailable", "no KV = refused");
    assert.equal((await handleEth({ action: "nope" }, { env: ENV, deps: m7.d, eth: m7.e, incr, ipBucket: "7" })).status, 400);
    // ethDepsOf finds the wiring; secrets never appear in outputs.
    assert.ok(ethDepsOf(m7.d));
    const st = await handleEth({ action: "status", ...who(ords[0]) }, { env: ENV, deps: m7.d, eth: m7.e, incr, ipBucket: "7" });
    assert.ok(!JSON.stringify(st.body).includes("a".repeat(32)), "RPC key never in a response");
    assert.ok(![...m7.c.st.urls].length || [...m7.c.st.urls].every((u) => u === RPC));
  }
  // ── Tag exhaustion fails closed ────────────────────────────────────────
  {
    const m8 = mk();
    const K = await newOrder(m8);
    const base = Math.round(Number(K.totalUsdc) * 1e6);
    for (let t = 1; t <= 99; t++) m8.es.quotes.set("eth_" + t.toString(16).padStart(32, "0"), { providerRef: "x", orderId: "o" + t, network: "eip155:11155111", payTo: PAYTO, asset: ETH_SEPOLIA.asset, baseAtomic: base, tag: t, amountAtomic: base + t * 10_000, createdAt: T0, expiresAt: T0 + 9e6, reservedUntil: T0 + 9e6 });
    assert.equal((await bindEth(m8.d, m8.e, who(K)) as any).error, "rail_busy", "all 99 tags reserved: Ethereum not offered for this order");
  }
  // ── Round 2: SF-A terminal ordering ─────────────────────────────────
  {
    const ma = mk();
    const A2 = await newOrder(ma);
    const qa2 = (await bindEth(ma.d, ma.e, who(A2)) as any).quote;
    const ta = ma.c.mine({ amount: Number(qa2.amountAtomic), tsMs: ma.nowMs() + 1000, block: 5300 }); ma.c.st.head = 5301;
    await claimEth(ma.d, ma.e, { ...who(A2), tx_hash: ta.tx });
    ma.c.st.receipts.get(ta.tx).status = "0x0"; ma.c.finalize(5300);
    const real = ma.es.recordResolution.bind(ma.es);
    ma.es.recordResolution = async (r) => { if (r.outcome === "failed_onchain") throw new Error("write failed"); return real(r); };
    await sweepEth(ma.d, ma.e, { clock: ma.nowMs });
    const o1 = ma.es.resolutions.filter((x) => x.txHash === ta.tx).map((x) => x.outcome);
    assert.deepEqual(o1, ["manual_review", "alerted"], "terminal write failed: already flagged + alerted, not terminal");
    assert.equal(ma.store.alerts.filter((a) => a.kind === "eth_claim_failed").length, 1, "alert sent before the terminal write");
    assert.equal((await ma.es.listUnresolved()).total, 1, "still unresolved: retried next sweep");
    ma.es.recordResolution = real;
    await sweepEth(ma.d, ma.e, { clock: ma.nowMs });
    assert.deepEqual(ma.es.resolutions.filter((x) => x.txHash === ta.tx).map((x) => x.outcome), ["manual_review", "alerted", "failed_onchain"], "terminal outcome written last");
    assert.equal((await ma.es.listUnresolved()).total, 0);
  }
  // ── SF-B: manual-review claims go last; backlog alerts ───────────────
  {
    const mb = mk();
    const B1 = await newOrder(mb), B2 = await newOrder(mb, "bea.rig1");
    const q1 = (await bindEth(mb.d, mb.e, who(B1)) as any).quote, q2 = (await bindEth(mb.d, mb.e, who(B2)) as any).quote;
    const t1 = mb.c.mine({ amount: Number(q1.amountAtomic), tsMs: mb.nowMs() + 1000, block: 5300 }); mb.c.st.head = 5301;
    await claimEth(mb.d, mb.e, { ...who(B1), tx_hash: t1.tx });
    await mb.es.recordResolution({ txHash: t1.tx, outcome: "manual_review", detail: "stuck", at: mb.nowMs() });
    mb.tick(60_000);
    const t2 = mb.c.mine({ amount: Number(q2.amountAtomic), tsMs: mb.nowMs(), block: 5310 }); mb.c.st.head = 5311;
    await claimEth(mb.d, mb.e, { ...who(B2), tx_hash: t2.tx });
    const page = await mb.es.listUnresolved();
    assert.deepEqual(page.rows.map((c) => c.txHash), [t2.tx, t1.tx], "newer claim not in manual review is checked first");
    const r0 = await sweepEth(mb.d, mb.e, { budgetMs: 0, clock: mb.nowMs });
    assert.deepEqual([r0.checked, r0.total], [0, 2]);
    assert.ok(mb.store.alerts.some((a) => a.kind === "eth_sweep_backlog"), "checked < unresolved total: backlog alert");
    // One claim's worth of budget: the fresh one settles even though the stuck one is older.
    mb.c.finalize(5310);
    let calls = 0;
    const r1 = await sweepEth(mb.d, mb.e, { budgetMs: 1000, clock: () => (calls++ < 12 ? 0 : 5000) });
    assert.equal(r1.settled, 1); assert.ok(await mb.store.getSettlement(q2.paymentRef), "fresh claim settled first");
  }
  // ── SF-C: schema states ──────────────────────────────────────────────
  {
    const mc = mk();
    const C1 = await newOrder(mc);
    (mc.es as MemoryEthStore).hardened = false; resetEthCaches();
    assert.equal(await mc.es.schemaState(), "partial");
    assert.equal((await bindEth(mc.d, mc.e, who(C1)) as any).error, "rail_unavailable", "half-applied schema: no offer");
    const o = (await mc.store.getOrderByPublicId(C1.rid))!;
    assert.equal(await ethExpiryHold(mc.e, { ...o, expiresAt: mc.nowMs() - 1000 }), true, "half-applied schema holds (fail closed)");
    assert.equal(await ethClaimPending(mc.e, o.id), true);
    await sweepEth(mc.d, mc.e, { clock: mc.nowMs });
    assert.ok(mc.store.alerts.some((a) => a.kind === "eth_schema_incomplete"), "and alerts");
    (mc.es as MemoryEthStore).migrated = false; resetEthCaches();
    assert.equal(await mc.es.schemaState(), "missing", "no 210000 = rail absent");
    assert.equal(await ethExpiryHold(mc.e, { ...o, expiresAt: mc.nowMs() - 1000 }), false);
    // Supabase store: 210000 probe decides missing; a missing 211000 is "partial".
    const { SupabaseEthStore } = await import("../src/lib/rentals/phase2/eth/store");
    const sb = (miss: string[]) => new SupabaseEthStore("https://x.supabase.co", "k", (async (u: string) => {
      const fn = String(u).split("/rpc/")[1];
      return miss.includes(fn) ? new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 }) : new Response(JSON.stringify(fn === "rental_eth_list_claims" ? { total: 0, rows: [] } : { inserted: false, probe: true }));
    }) as unknown as typeof fetch);
    assert.equal(await sb([]).schemaState(), "ready");
    assert.equal(await sb(["rental_eth_record_unmatched"]).schemaState(), "partial");
    assert.equal(await sb(["rental_eth_list_claims", "rental_eth_record_unmatched"]).schemaState(), "missing");
    const down = new SupabaseEthStore("https://x.supabase.co", "k", (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch);
    assert.equal(await down.schemaState(), "error");
  }
  // ── SF-D: pin rotation keeps history readable ────────────────────────
  {
    const md = mk();
    const D1 = await newOrder(md);
    const qd = (await bindEth(md.d, md.e, who(D1)) as any).quote;
    const td = md.c.mine({ amount: Number(qd.amountAtomic), tsMs: md.nowMs() + 1000, block: 5300 }); md.c.finalize(5300);
    await claimEth(md.d, md.e, { ...who(D1), tx_hash: td.tx });
    assert.ok(await md.store.getSettlement(qd.paymentRef));
    const P2 = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    const { ethLookup } = await import("../src/lib/rentals/phase2/eth/service");
    assert.equal(((await ethLookup(md.store, null, { ...md.e, pin: P2, pinHistory: [] }, qd.paymentRef)) as any).paid, false, "rotated without history: unpaid (why the history exists)");
    assert.equal(((await ethLookup(md.store, null, { ...md.e, pin: P2, pinHistory: [PAYTO] }, qd.paymentRef)) as any).paid, true, "rotated with the old pin in history: still paid");
    assert.equal(ethConfig({ ...ENV, RENTALS_ETH_PAYTO: PAYTO }, sha256Hex(P2)), null, "a historical address is never used for new quotes");
    const { ETH_PAYTO_HISTORY } = await import("../src/lib/rentals/phase2/eth/config");
    assert.deepEqual([...ETH_PAYTO_HISTORY], [], "no history yet");
  }
  // ── SF-E: unmatched keyed on payer + tx, every pasting order logged ──
  {
    const me = mk();
    const E1 = await newOrder(me), E2 = await newOrder(me, "eve.rig1");
    await bindEth(me.d, me.e, who(E1)); await bindEth(me.d, me.e, who(E2));
    const tx = me.c.mine({ amount: 1_234_567, tsMs: me.nowMs() + 1000, from: "0x" + "c".repeat(40) });
    assert.equal((await claimEth(me.d, me.e, { ...who(E1), tx_hash: tx.tx }) as any).error, "amount_mismatch");
    assert.equal((await claimEth(me.d, me.e, { ...who(E2), tx_hash: tx.tx }) as any).error, "amount_mismatch");
    assert.deepEqual([...me.es.unmatched.keys()], [("0x" + "c".repeat(40)) + ":" + tx.tx], "one record, keyed payer:tx");
    assert.equal(me.es.sightings.size, 2, "both pasting orders logged");
    assert.equal(me.store.alerts.filter((a) => a.kind === "eth_amount_mismatch").length, 1, "one alert per payer+tx");
  }

  // ── Round 3 helpers: a claim whose terminal outcome (failed_onchain) is due on the next sweep ──
  const failingClaim = async () => {
    const m = mk();
    const O = await newOrder(m);
    const q = (await bindEth(m.d, m.e, who(O)) as any).quote;
    const t = m.c.mine({ amount: Number(q.amountAtomic), tsMs: m.nowMs() + 1000, block: 5300 }); m.c.st.head = 5301;
    await claimEth(m.d, m.e, { ...who(O), tx_hash: t.tx });
    m.c.st.receipts.get(t.tx).status = "0x0"; m.c.finalize(5300);
    const outcomes = () => m.es.resolutions.filter((x) => x.txHash === t.tx).map((x) => x.outcome);
    const alerts = (kind: string) => m.store.alerts.filter((a) => a.kind === kind).length;
    const realCommit = m.store.commit.bind(m.store);
    const failAlerts = (on: boolean) => { m.store.commit = on ? (async (c: any) => { if (c.alerts?.length) throw new Error("alert write failed"); return realCommit(c); }) as any : realCommit; };
    return { m, O, q, t, outcomes, alerts, failAlerts };
  };
  // ── R3-1: the terminal outcome is never written when its alert write failed ──
  {
    const f = await failingClaim();
    f.failAlerts(true);
    const terminalWrites: string[] = [];
    const real = f.m.es.recordResolution.bind(f.m.es);
    f.m.es.recordResolution = async (r) => { terminalWrites.push(r.outcome); return real(r); };
    const r = await sweepEth(f.m.d, f.m.e, { clock: f.m.nowMs });
    assert.equal(r.settled, 0);
    assert.ok(!terminalWrites.includes("failed_onchain"), "alert write failed: the terminal write is never attempted");
    assert.deepEqual(f.outcomes(), ["manual_review", "alerted"], "flagged for a person, not terminal");
    assert.equal(f.alerts("eth_claim_failed"), 0, "no alert stored (the forced failure)");
    assert.equal((await f.m.es.listUnresolved()).total, 1, "claim stays unresolved: retried next sweep");
    assert.equal(await ethClaimPending(f.m.e, (await f.m.store.getOrderByPublicId(f.O.rid))!.id), true, "still counts as pending (cancel guard / x402 refusal hold)");
    // Still failing on the next sweep: still not terminal, and a failed write never feeds the throttle.
    f.m.tick(5 * 60_000);
    await sweepEth(f.m.d, f.m.e, { clock: f.m.nowMs });
    assert.deepEqual(f.outcomes(), ["manual_review", "alerted"], "second failed alert write: still not terminal");
    // The outbox recovers: alert committed first, then the terminal outcome.
    f.failAlerts(false);
    f.m.tick(5 * 60_000);
    await sweepEth(f.m.d, f.m.e, { clock: f.m.nowMs });
    assert.equal(f.alerts("eth_claim_failed"), 1, "alert committed once the outbox works (not throttled by the failed tries)");
    assert.deepEqual(f.outcomes(), ["manual_review", "alerted", "failed_onchain"], "then the terminal outcome");
    assert.equal((await f.m.es.listUnresolved()).total, 0);
    // claimEth path: same rule (lost race uses refund_manual_review).
    const g = await failingClaim();
    g.failAlerts(true);
    assert.ok((await claimEth(g.m.d, g.m.e, { ...who(g.O), tx_hash: g.t.tx }) as any).ok, "claim poll still answers");
    assert.ok(!g.outcomes().includes("failed_onchain"), "and never writes the terminal outcome without its alert");
  }
  // ── R3-2: repeating alerts throttled to about once an hour per key ──
  {
    // eth_claim_failed from a terminal write that keeps failing.
    const f = await failingClaim();
    const real = f.m.es.recordResolution.bind(f.m.es);
    f.m.es.recordResolution = async (r) => { if (r.outcome === "failed_onchain") throw new Error("write failed"); return real(r); };
    for (let i = 0; i < 6; i++) { await sweepEth(f.m.d, f.m.e, { clock: f.m.nowMs }); f.m.tick(5 * 60_000); }
    assert.equal(f.alerts("eth_claim_failed"), 1, "6 sweeps over 30 min with the terminal write failing: one eth_claim_failed");
    resetEthCaches();   // a cold instance: the throttle state is durable (the committed outbox row)
    await sweepEth(f.m.d, f.m.e, { clock: f.m.nowMs });
    assert.equal(f.alerts("eth_claim_failed"), 1, "cold instance: still throttled from rental_alerts");
    f.m.tick(ETH_ALERT_THROTTLE_MS);
    await sweepEth(f.m.d, f.m.e, { clock: f.m.nowMs });
    assert.equal(f.alerts("eth_claim_failed"), 2, "an hour later it alerts again");
    f.m.tick(5 * 60_000);
    f.m.es.recordResolution = real;
    await sweepEth(f.m.d, f.m.e, { clock: f.m.nowMs });
    assert.deepEqual(f.outcomes(), ["manual_review", "alerted", "failed_onchain"], "write recovers inside the hour: terminal written (its alert already committed)");
    assert.equal(f.alerts("eth_claim_failed"), 2, "without a third alert");
  }
  {
    // eth_schema_incomplete: every 5-minute sweep would re-send it.
    const m = mk();
    m.es.hardened = false; resetEthCaches();
    const n = () => m.store.alerts.filter((a) => a.kind === "eth_schema_incomplete").length;
    for (let i = 0; i < 12; i++) { await sweepEth(m.d, m.e, { clock: m.nowMs }); m.tick(5 * 60_000); resetEthCaches(); }
    assert.equal(n(), 1, "12 sweeps in an hour, every one a cold start: one eth_schema_incomplete");
    await sweepEth(m.d, m.e, { clock: m.nowMs });
    assert.equal(n(), 2, "after the hour: once more");
    // Durable read down: the in-process map throttles; a cold instance with no state alerts (fail open).
    m.es.alertReadFails = true;
    m.tick(ETH_ALERT_THROTTLE_MS);
    await sweepEth(m.d, m.e, { clock: m.nowMs });
    assert.equal(n(), 3, "durable read down, nothing in memory: alerts (fail open)");
    m.tick(5 * 60_000); resetEthCaches(); m.es.hardened = false;
    // keep the in-process map this time (no reset between sweeps)
    await sweepEth(m.d, m.e, { clock: m.nowMs });
    assert.equal(n(), 4, "after a cold start with the read down it alerts again (memory only)");
    m.tick(5 * 60_000);
    await sweepEth(m.d, m.e, { clock: m.nowMs });
    assert.equal(n(), 4, "warm instance, read down: the in-process map throttles");
  }
  {
    // eth_sweep_backlog
    const m = mk();
    const B = await newOrder(m);
    const q = (await bindEth(m.d, m.e, who(B)) as any).quote;
    const t = m.c.mine({ amount: Number(q.amountAtomic), tsMs: m.nowMs() + 1000, block: 5300 }); m.c.st.head = 5301;
    await claimEth(m.d, m.e, { ...who(B), tx_hash: t.tx });
    const n = () => m.store.alerts.filter((a) => a.kind === "eth_sweep_backlog").length;
    const realCommit = m.store.commit.bind(m.store);
    m.store.commit = (async (c: any) => { if (c.alerts?.length) throw new Error("alert write failed"); return realCommit(c); }) as any;
    await sweepEth(m.d, m.e, { budgetMs: 0, clock: m.nowMs });
    assert.equal(n(), 0, "backlog alert write failed");
    m.store.commit = realCommit;
    m.tick(5 * 60_000);
    await sweepEth(m.d, m.e, { budgetMs: 0, clock: m.nowMs });
    assert.equal(n(), 1, "a failed write doesn't count: next sweep sends it");
    for (let i = 0; i < 10; i++) { m.tick(5 * 60_000); await sweepEth(m.d, m.e, { budgetMs: 0, clock: m.nowMs }); }
    assert.equal(n(), 1, "throttled for the hour");
    m.tick(10 * 60_000);
    await sweepEth(m.d, m.e, { budgetMs: 0, clock: m.nowMs });
    assert.equal(n(), 2, "then again");
    // Keys are per kind + order ref: a different kind is not suppressed.
    m.es.hardened = false; resetEthCaches();
    await sweepEth(m.d, m.e, { budgetMs: 0, clock: m.nowMs });
    assert.equal(m.store.alerts.filter((a) => a.kind === "eth_schema_incomplete").length, 1, "other kinds alert independently");
  }
  {
    // SupabaseEthStore.lastAlertAt: one service-role read of rental_alerts, newest first, inside the lookback.
    const { SupabaseEthStore } = await import("../src/lib/rentals/phase2/eth/store");
    const urls: string[] = [];
    const at = "2026-10-17T13:30:00+00:00";
    const sb = (body: unknown, status = 200) => new SupabaseEthStore("https://x.supabase.co", "k", (async (u: string) => { urls.push(String(u)); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch);
    assert.equal(await sb([{ at }]).lastAlertAt("eth_sweep_backlog", "sweep"), Date.parse(at));
    assert.match(urls[0], /\/rest\/v1\/rental_alerts\?kind=eq\.eth_sweep_backlog&order_ref=eq\.sweep&at=gte\.[^&]+&select=at&order=at\.desc&limit=1$/);
    assert.equal(await sb([]).lastAlertAt("eth_claim_failed", "GM-1"), null, "none in the lookback");
    await assert.rejects(sb({ code: "42501" }, 403).lastAlertAt("eth_claim_failed", "GM-1"), "a read error throws (the service falls back)");
  }
  // ── Nit: ETH_PAYTO_HISTORY entries are valid, unique, and never the current pin ──
  {
    const { ETH_PAYTO_HISTORY } = await import("../src/lib/rentals/phase2/eth/config");
    assert.deepEqual(payToHistoryProblems(ETH_PAYTO_HISTORY, null), [], "the shipped history is clean");
    for (const a of ETH_PAYTO_HISTORY) assert.ok(validPayTo(a), `history entry ${a} is a valid EIP-55 payTo`);
    assert.equal(new Set(ETH_PAYTO_HISTORY.map((a) => a.toLowerCase())).size, ETH_PAYTO_HISTORY.length, "no duplicates");
    assert.ok(ETH_PAYTO_HISTORY.every((a) => sha256Hex(a) !== PAYTO_PIN_SHA256.evm), "the current pinned address is not in the history");
    const P2 = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    assert.deepEqual(payToHistoryProblems([P2], PAYTO), [], "a valid rotated-out address passes");
    assert.deepEqual(payToHistoryProblems([P2.toLowerCase()], PAYTO), [`invalid:${P2.toLowerCase()}`], "non-checksummed entry flagged");
    assert.deepEqual(payToHistoryProblems([P2, P2], PAYTO), [`duplicate:${P2}`], "duplicate flagged");
    assert.deepEqual(payToHistoryProblems([PAYTO], PAYTO), [`current_pin:${PAYTO}`], "current pin in history flagged");
    assert.deepEqual(payToHistoryProblems(["0x" + "0".repeat(40)], null), ["invalid:0x" + "0".repeat(40)], "zero address flagged");
  }
  // ── Nit: rental_eth_unmatched.provider_ref ends NOT NULL, like the sightings table ──
  {
    const sql = readFileSync("supabase/migrations/20261017211000_phase2_eth_usdc_hardening.sql", "utf8");
    const alters = [...sql.matchAll(/alter table public\.rental_eth_unmatched alter column provider_ref (set|drop) not null;/g)].map((x) => x[1]);
    assert.equal(alters[alters.length - 1], "set", "the last word on provider_ref is NOT NULL");
    assert.match(sql, /create table if not exists public\.rental_eth_unmatched_sightings \([^;]*provider_ref text not null/, "sightings provider_ref is NOT NULL");
  }
  // ── R3-3: rollbacks are one transaction: begin, lock, guard, drops, commit; run with ON_ERROR_STOP ──
  {
    for (const [f, locks] of [
      ["supabase/rollback/20261017211000_phase2_eth_usdc_hardening_rollback.sql", ["rental_eth_claims", "rental_eth_claim_resolutions", "rental_eth_unmatched"]],
      ["supabase/rollback/20261017210000_phase2_eth_usdc_rollback.sql", ["rental_eth_quotes", "rental_eth_claims", "rental_eth_claim_resolutions"]],
    ] as const) {
      const body = readFileSync(f, "utf8").split("\n").filter((l) => !l.startsWith("--") && l.trim()).join("\n");
      const i = (re: RegExp) => body.search(re);
      assert.equal(i(/^begin;$/m), 0, `${f}: begin first`);
      assert.ok(i(/^set local lock_timeout/m) > 0 && i(/^lock table /m) > i(/^set local lock_timeout/m), `${f}: lock_timeout, then the locks`);
      const lockLine = body.match(/^lock table ([^\n]*) in exclusive mode;$/m)?.[1] ?? "";
      for (const t of locks) assert.ok(lockLine.includes(`public.${t}`), `${f}: locks ${t}`);
      if (f.includes("210000")) assert.ok(!lockLine.includes("rental_eth_unmatched"), `${f}: no lock on a table that no longer exists`);
      assert.ok(i(/^do \$\$/m) > i(/^lock table /m), `${f}: guard after the locks`);
      assert.ok(i(/^(drop|alter) /m) > i(/^end \$\$;$/m), `${f}: drops after the guard`);
      assert.match(body, /\ncommit;$/, `${f}: commit last`);
      assert.match(readFileSync(f, "utf8"), /psql "\$DB_URL" -1 -v ON_ERROR_STOP=1 -f /, `${f}: documents psql -1 -v ON_ERROR_STOP=1`);
    }
  }

  // ── After #107: BTC and ETH mutually exclusive per order; expiry holds compose ──
  {
    const m = mk();
    const X1 = await newOrder(m);
    let live = true;
    (m.d as any).btc = { store: { hasLiveBinding: async () => live, bindingsForOrder: async () => [], listBindings: async () => [] } };
    assert.equal((await bindEth(m.d, m.e, who(X1)) as any).error, "not_payable", "live BTC binding: no Ethereum quote");
    (m.d as any).btc.store.hasLiveBinding = async () => { throw new Error("down"); };
    assert.equal((await bindEth(m.d, m.e, who(X1)) as any).error, "not_payable", "BTC read error: fail closed");
    (m.d as any).btc.store.hasLiveBinding = async () => (live = false);
    const q = (await bindEth(m.d, m.e, who(X1)) as any).quote;
    assert.ok(q, "no live BTC binding: quote created");
    const o = (await m.store.getOrderByPublicId(X1.rid))!;
    assert.equal(typeof m.d.btcBlockedByOtherRail, "function", "wireEth installs the BTC exclusion hook");
    assert.equal(await m.d.btcBlockedByOtherRail!(o.id), true, "an Ethereum quote blocks a new BTC binding");
    const X2 = await newOrder(m, "bob.rig1");
    assert.equal(await m.d.btcBlockedByOtherRail!((await m.store.getOrderByPublicId(X2.rid))!.id), false, "no quote: BTC allowed");
    const { createBtcBinding } = await import("../src/lib/rentals/phase2/btc/service");
    const r = (await createBtcBinding(m.d, who(X1))) as any;
    assert.equal(r.ok, false); assert.equal(r.error, "not_payable", "createBtcBinding refuses an order with an Ethereum quote");
    assert.match(String(r.message ?? r.error_message ?? JSON.stringify(r)), /USDC on Ethereum/, "and says why");
    m.es.hardened = false; resetEthCaches();
    assert.equal(await m.d.btcBlockedByOtherRail!((await m.store.getOrderByPublicId(X2.rid))!.id), true, "half-applied ETH schema: BTC blocked (fail closed)");
    m.es.migrated = false; resetEthCaches();
    assert.equal(await m.d.btcBlockedByOtherRail!(o.id), false, "ETH not migrated: nothing blocks BTC");
  }
  {
    const m = mk();
    const H1 = await newOrder(m);
    const o = (await m.store.getOrderByPublicId(H1.rid))!;
    const late = { ...o, expiresAt: m.nowMs() - ETH_HOLD_MAX_MS / 2 };
    const d2 = { ...m.d } as Deps;
    wireEth(d2, ENV, m.c.f, { pinSha: TEST_PAYTO_PINS.evm });
    assert.equal(await d2.expiryHold!(late), false, "ETH alone: no quote, no hold");
    const d3 = { ...m.d, expiryHold: async () => true } as Deps;
    wireEth(d3, ENV, m.c.f, { pinSha: TEST_PAYTO_PINS.evm });
    assert.equal(await d3.expiryHold!(late), true, "a prior hold still holds after wireEth (composed, not replaced)");
    const d4 = { ...m.d, expiryHold: async () => { throw new Error("x"); } } as Deps;
    wireEth(d4, ENV, m.c.f, { pinSha: TEST_PAYTO_PINS.evm });
    assert.equal(await d4.expiryHold!(late), true, "a prior hold that throws holds (fail closed)");
    const d5 = { ...m.d, expiryHold: async () => false } as Deps;
    const e5 = wireEth(d5, ENV, m.c.f, { pinSha: TEST_PAYTO_PINS.evm })!;
    (e5.store as MemoryEthStore).sqlPin = PAYTO;
    assert.equal(await d5.expiryHold!(late), false);
    await bindEth(d5, e5, who(H1));
    assert.equal(await d5.expiryHold!({ ...o, expiresAt: m.nowMs() - 1000 }), true, "prior says no, ETH quote in its grace window says hold");
  }

  // ── Rev 1.8: ETH jobs, payments and refunds carry rail eth_usdc; eip155:1 in the job networks ──
  {
    const { schemaOk } = await import("../src/lib/rentals/phase2/jobs");
    const { MAX_TERM_SEC } = await import("../src/lib/rentals/phase2/pricing");
    const { POOL_HOST_SUFFIXES, POOL_PORTS } = await import("../src/lib/rentals/phase2/validate");
    const { schemaOk: snip } = await import("./rentals/verify-job-snippet.mjs");
    const { X402_JOB_NETWORKS, ETH_JOB_NETWORKS } = await import("../src/lib/rentals/phase2/x402");
    const { railOfRef, isUsdcRail, getRentalStatus } = await import("../src/lib/rentals/phase2/service");
    const CAPS = { maxRigs: 4, maxSec: MAX_TERM_SEC, hostSuffixes: POOL_HOST_SUFFIXES, ports: POOL_PORTS };
    assert.ok(X402_JOB_NETWORKS.has("eip155:1") && ETH_JOB_NETWORKS.has("eip155:1"), "eip155:1 is a job network");
    // On-time ETH payment -> route job with rail eth_usdc, valid on the site AND the node snippet.
    const m = mk();
    const R = await newOrder(m);
    const q = (await bindEth(m.d, m.e, who(R)) as any).quote;
    const t = m.c.mine({ amount: Number(q.amountAtomic), tsMs: m.nowMs() + 1000, block: 5300 }); m.c.finalize(5300);
    await claimEth(m.d, m.e, { ...who(R), tx_hash: t.tx });
    const job = m.store.jobs.find((j) => j.payload.order_ref === R.rid)!;
    assert.ok(job, "route job signed");
    assert.equal(job.payload.payment!.rail, "eth_usdc", "ETH job rail is eth_usdc");
    assert.equal(job.payload.payment!.unit, "usdc_6dp");
    assert.equal(job.payload.amount_usdc, (Number(q.amountAtomic) / 1e6).toFixed(6), "amount_usdc set (USDC, not sats)");
    assert.equal(job.payload.pay_to, PAYTO);
    assert.equal(schemaOk(job.payload, CAPS), null, "site schema accepts the eth_usdc job");
    assert.equal(snip(job.payload, CAPS), null, "node snippet (rev 1.8) accepts it too");
    const onMain = { ...job.payload, payment: { ...job.payload.payment!, network: "eip155:1" } };
    assert.equal(schemaOk(onMain, CAPS), null, "eth_usdc on eip155:1 is valid");
    assert.equal(snip(onMain, CAPS), null);
    for (const [bad, why] of [
      [{ ...job.payload, payment: { ...job.payload.payment!, rail: "x402_usdc", network: "eip155:1" } }, "x402_usdc on an Ethereum network"],
      [{ ...job.payload, payment: { ...job.payload.payment!, network: "eip155:8453" } }, "eth_usdc on Base"],
      [{ ...job.payload, payment: { ...job.payload.payment!, network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" } }, "eth_usdc on Solana"],
    ] as const) {
      assert.equal(schemaOk(bad, CAPS), "schema_network", `site refuses ${why}`);
      assert.equal(snip(bad, CAPS), "schema_network", `snippet refuses ${why}`);
    }
    assert.equal(schemaOk({ ...job.payload, pay_to: null }, CAPS), "schema_settlement", "eth_usdc needs pay_to like x402");
    const pays = await m.store.paymentsForRef(q.paymentRef);
    assert.ok(pays.length > 0 && pays.every((p) => p.rail === "eth_usdc"), "payment rows on the eth_ ref carry rail eth_usdc");
    const o = (await m.store.getOrderByPublicId(R.rid))!;
    assert.equal(o.rail, "x402_usdc", "the order keeps its USDC creation rail");
    assert.equal(railOfRef(o, q.paymentRef), "eth_usdc");
    assert.equal(railOfRef(o, "x402_" + "a".repeat(32)), "x402_usdc", "other refs on the same order stay x402_usdc");
    assert.equal(railOfRef(o, "btc:" + crypto.randomUUID()), "btc_onchain");
    assert.ok(isUsdcRail("eth_usdc") && isUsdcRail("x402_usdc") && !isUsdcRail("btc_onchain") && !isUsdcRail("lightning"));
    // Late ETH money -> refund row rail eth_usdc, counted as USDC in the status (refundPendingUsdc), never sats.
    const m3 = mk();
    const L = await newOrder(m3);
    const ql = (await bindEth(m3.d, m3.e, who(L)) as any).quote;
    m3.tick(40 * 60_000);
    await sweepExpired(m3.d);
    const late = m3.c.mine({ amount: Number(ql.amountAtomic), tsMs: m3.nowMs() - 60_000, block: 5200 }); m3.c.finalize(5200);
    await claimEth(m3.d, m3.e, { ...who(L), tx_hash: late.tx });
    assert.equal(m3.store.refunds.length, 1);
    assert.equal(m3.store.refunds[0].rail, "eth_usdc", "refund row rail eth_usdc");
    assert.equal(m3.store.refunds[0].network, "eip155:11155111", "refund network = the Ethereum chain it settled on");
    const g = (await getRentalStatus(m3.d, who(L))) as any;
    assert.equal(g.ok, true);
    assert.equal(g.result.refundPendingUsdc, (Number(ql.amountAtomic) / 1e6).toFixed(6), "status counts the ETH refund as USDC");
    assert.equal(g.result.refundPending, undefined, "and never as sats");
  }
  // ── B7 (#109) x ETH: with RENTALS_AVAIL_GATE on, Ethereum follows the same bay rules as USDC and BTC ──
  {
    const svc = await import("../src/lib/rentals/phase2/service");
    const { MemoryStore: MS } = await import("../src/lib/rentals/phase2/store");
    const { schemaOk } = await import("../src/lib/rentals/phase2/jobs");
    const { MAX_TERM_SEC } = await import("../src/lib/rentals/phase2/pricing");
    const { POOL_HOST_SUFFIXES, POOL_PORTS } = await import("../src/lib/rentals/phase2/validate");
    const CAPS2 = { maxRigs: 4, maxSec: MAX_TERM_SEC, hostSuffixes: POOL_HOST_SUFFIXES, ports: POOL_PORTS };
    /** The node's report: these bays fresh-free now, the rest rented on the marketplace (fresh). */
    const report = (m: ReturnType<typeof mk>, free: number[]) => {
      m.store.dbNow = m.nowMs;
      m.store.bayReports = [1, 2, 3, 4].map((bay) => ({ bay, free: free.includes(bay), reason: (free.includes(bay) ? "ok" : "mrr_rented") as "ok" | "mrr_rented", reportedAt: m.nowMs() }));
    };
    const gated = () => { const m = mk(); m.d.availGate = true; return m; };
    assert.equal(typeof gated().d.railHeldOrders, "function", "wireEth installs the ETH confirmation-hold hook");

    // Bind: fresh-free bays must cover the order, else no_capacity and no quote (nothing shown to pay).
    {
      const m = gated(); report(m, [1, 2, 3, 4]);
      const A = await newOrder(m);
      report(m, []);
      const r = (await bindEth(m.d, m.e, who(A))) as any;
      assert.equal(r.error, "no_capacity", "gate on, no fresh-free bay: ETH bind refused");
      assert.equal(m.es.quotes.size, 0, "no quote reserved");
      assert.equal(ethErrorCopy("no_capacity").charged, "no", "copy says nothing was charged");
      assertCustomerSafe(ethErrorCopy("no_capacity").body);
      const h = await handleEth({ action: "bind", ...who(A) }, { env: ENV, deps: m.d, eth: m.e, incr: async () => ({ count: 1, ttlSec: 60 }), ipBucket: "g" });
      assert.equal(h.status, 409, "HTTP 409 no_capacity"); assert.equal(h.body.error, "no_capacity");
      m.store.bayReports = m.store.bayReports.map((x) => ({ ...x, reportedAt: m.nowMs() - 10 * 60_000, free: true, reason: "ok" as const }));
      assert.equal(((await bindEth(m.d, m.e, who(A))) as any).error, "no_capacity", "stale reports are not free (fail closed)");
      m.store.bayReadFails = true;
      assert.equal(((await bindEth(m.d, m.e, who(A))) as any).error, "no_capacity", "unreadable availability: refused");
      m.store.bayReadFails = false; report(m, [3]);
      assert.equal(((await bindEth(m.d, m.e, who(A))) as any).ok, true, "one fresh-free bay covers a 1-rig order: bound");
      const off = mk(); const B = await newOrder(off); off.store.bayReports = [];
      assert.equal(((await bindEth(off.d, off.e, who(B))) as any).ok, true, "gate off: unchanged (no availability needed)");
    }

    // Confirmation holds: an ETH claim still confirming holds its rig past the pay window, like a BTC hold, counted once.
    {
      const m = gated(); report(m, [1, 2]);
      const A = await newOrder(m);
      const qa = (await bindEth(m.d, m.e, who(A)) as any).quote;
      const ta = m.c.mine({ amount: Number(qa.amountAtomic), tsMs: m.nowMs() + 1000, block: 4990 });   // in the chain, not final
      const ca = (await claimEth(m.d, m.e, { ...who(A), tx_hash: ta.tx })) as any;
      assert.equal(ca.ok, true, "claim accepted"); assert.equal(ca.result.claim.state, "confirming", "not final yet");
      assert.equal((await m.es.listUnresolved()).rows.length, 1, "one unresolved claim recorded");
      const oA = (await m.store.getOrderByPublicId(A.rid))!;
      assert.equal(await svc.confirmingHeldRigs(m.d, m.nowMs()), 0, "inside its pay window the order is a soft hold only (no double count)");
      m.tick(10 * 60_000); report(m, [1, 2]);
      const B = await newOrder(m);
      m.tick(6 * 60_000); report(m, [1, 2]);
      await sweepExpired(m.d);
      assert.equal((await m.store.getOrder(oA.id))!.state, "awaiting_payment", "the ETH hold keeps A open past its window");
      assert.equal(await svc.confirmingHeldRigs(m.d, m.nowMs()), 1, "A's confirming claim holds 1 rig");
      assert.deepEqual(await m.d.railHeldOrders!(), [oA.id], "the hook lists A");
      const q1 = (await svc.getQuote(m.d, { rigs: 1, days: 1 })) as any;
      assert.equal(q1.error, "no_capacity", "2 fresh-free - B soft hold - A ETH hold = 0: nothing quoted");
      assert.equal(q1.available, 0);
      const board = await svc.bayBoard(m.d);
      assert.equal(board.available, 0, "the board subtracts the ETH hold too");
      const oB = (await m.store.getOrderByPublicId(B.rid))!;
      const refB = (await m.store.refsForOrder(oB.id))[0];
      assert.equal(await svc.payCapacity(m.d, refB), "ok", "B's x402 pay: 2 free - A's hold (not its own) = 1 >= 1");
      report(m, [2]);
      assert.equal(await svc.payCapacity(m.d, refB), "no_capacity", "1 free - A's ETH hold = 0: B can't pay (A's money moved first)");
      const noHook = { ...m.d, railHeldOrders: undefined } as Deps;
      assert.equal(await svc.payCapacity(noHook, refB), "ok", "...and it is the ETH hold that blocks it");
      const both = { ...m.d, btc: { store: { listBindings: async () => [{ orderId: oA.id, status: "seen", displayOkAt: 1 }] } } } as unknown as Deps;
      assert.equal(await svc.confirmingHeldRigs(both, m.nowMs()), 1, "listed by BTC and ETH: still counted once");
      const broken = { ...m.d, railHeldOrders: async () => { throw new Error("down"); } } as Deps;
      assert.equal(await svc.payCapacity(broken, refB), "no_capacity", "unreadable ETH holds: fail closed");
      assert.equal((await svc.bayBoard(broken)).available, 0, "board fails closed too");
      m.es.readFails = true; resetEthCaches();
      await assert.rejects(() => m.d.railHeldOrders!(), "unreadable ETH schema: the hook throws (callers fail closed)");
      m.es.readFails = false; resetEthCaches();
      // Settle under the gate: A finalizes while no bay is fresh-free -> the same cap_exceeded path as USDC/BTC:
      // order refund_pending + ONE full refund on Ethereum, pending_owner (never sent automatically).
      report(m, []);
      m.c.finalize(4990);
      await sweepEth(m.d, m.e);
      const oA2 = (await m.store.getOrder(oA.id))!;
      assert.equal(oA2.state, "refund_pending", "settled into no capacity: refund_pending, rigs never promised");
      const rf = m.store.refunds.filter((x) => x.orderId === oA.id);
      assert.equal(rf.length, 1, "one refund row");
      assert.equal(rf[0].reason, "cap_exceeded");
      assert.equal(rf[0].rail, "eth_usdc"); assert.equal(rf[0].network, "eip155:11155111");
      assert.equal(rf[0].status, "pending_owner", "never auto-sent");
      assert.equal(rf[0].atomic, Number(qa.amountAtomic), "full amount");
      assert.equal(m.store.jobs.filter((j) => j.payload.order_ref === A.rid).length, 0, "no route job");
      assert.deepEqual(await m.d.railHeldOrders!(), [], "a resolved claim holds nothing");
    }

    // Settle with capacity under the gate: bays come from the fresh-free set only.
    const settled = async (m: ReturnType<typeof mk>, free: number[]) => {
      report(m, free);
      const R = await newOrder(m);
      const q = (await bindEth(m.d, m.e, who(R)) as any).quote;
      const t = m.c.mine({ amount: Number(q.amountAtomic), tsMs: m.nowMs() + 1000, block: 5400 }); m.c.finalize(5400);
      report(m, free);
      await claimEth(m.d, m.e, { ...who(R), tx_hash: t.tx });
      return { R, q, t, o: async () => (await m.store.getOrderByPublicId(R.rid))! };
    };
    {
      const m = gated();
      const s = await settled(m, [3]);
      assert.equal((await s.o()).state, "delivering");
      assert.equal((await s.o()).bays, "3", "the only fresh-free bay is assigned");
    }

    // bay_taken_mrr on an ETH job: gate on -> ONE swap reusing the same ETH payment, then ONE full USDC refund on Ethereum.
    {
      const m = gated();
      const s = await settled(m, [1, 2, 3, 4]);
      const j1 = m.store.jobs.filter((j) => j.payload.order_ref === s.R.rid).pop()!;
      const firstBays = j1.payload.bays;
      m.tick(60_000); report(m, [1, 2, 3, 4]);
      await m.store.recordResult({ jobId: j1.payload.job_id, orderRef: s.R.rid, result: "rejected", reason: svc.BAY_TAKEN_MRR, deliveredTh: null, at: m.nowMs() });
      assert.equal(await svc.reofferOrExpire(m.d, await s.o()), "reoffered", "substituted once");
      const j2 = m.store.jobs.filter((j) => j.payload.order_ref === s.R.rid).pop()!;
      assert.notEqual(j2.payload.job_id, j1.payload.job_id);
      assert.notEqual(j2.payload.bays, firstBays, "a different bay");
      assert.equal(j2.payload.payment!.rail, "eth_usdc", "same rail");
      const p1 = j1.payload.payment as any, p2 = j2.payload.payment as any;
      assert.equal(p2.provider_ref, p1.provider_ref, "same ETH payment ref");
      assert.equal(p2.tx_hash, p1.tx_hash, "same tx hash"); assert.equal(p2.tx_hash, s.t.tx);
      assert.equal(p2.amount_atomic, p1.amount_atomic); assert.equal(p2.network, "eip155:11155111");
      assert.equal(j2.payload.pay_to, PAYTO);
      assert.equal(schemaOk(j2.payload, CAPS2), null, "the swap job is valid rev 1.8");
      assert.equal(m.store.refunds.length, 0, "no refund on a swap");
      m.tick(60_000); report(m, [1, 2, 3, 4]);
      await m.store.recordResult({ jobId: j2.payload.job_id, orderRef: s.R.rid, result: "rejected", reason: svc.BAY_TAKEN_MRR, deliveredTh: null, at: m.nowMs() });
      assert.equal(await svc.reofferOrExpire(m.d, await s.o()), "bay_unavailable", "second time: refund, never a second swap");
      assert.equal((await s.o()).state, "failed");
      assert.equal(m.store.refunds.length, 1, "ONE refund");
      const rf = m.store.refunds[0];
      assert.equal(rf.reason, "bay_unavailable"); assert.equal(rf.rail, "eth_usdc");
      assert.equal(rf.network, "eip155:11155111", "refund on the Ethereum chain it was paid on");
      assert.equal(rf.atomic, Number(s.q.amountAtomic), "full amount"); assert.equal(rf.status, "pending_owner", "never auto-sent");
      const g = (await svc.getRentalStatus(m.d, who(s.R))) as any;
      assert.equal(g.result.refundPendingUsdc, (Number(s.q.amountAtomic) / 1e6).toFixed(6), "status shows a USDC refund");
      assertCustomerSafe(String(g.result.note ?? ""));
      assert.equal(await svc.reofferOrExpire(m.d, await s.o()), "none", "nothing more once failed");
    }
    {
      // No fresh-free bay to swap to (gate on): straight to the one refund.
      const m = gated();
      const s = await settled(m, [2]);
      const j1 = m.store.jobs.filter((j) => j.payload.order_ref === s.R.rid).pop()!;
      report(m, [2]);
      await m.store.recordResult({ jobId: j1.payload.job_id, orderRef: s.R.rid, result: "rejected", reason: svc.BAY_TAKEN_MRR, deliveredTh: null, at: m.nowMs() });
      assert.equal(await svc.reofferOrExpire(m.d, await s.o()), "bay_unavailable", "no other free bay: refund");
      assert.equal(m.store.refunds.length, 1); assert.equal(m.store.refunds[0].rail, "eth_usdc"); assert.equal(m.store.refunds[0].status, "pending_owner");
    }
    {
      // Gate off: bay_taken_mrr is refunded directly (never a blind swap), on Ethereum, pending_owner.
      const m = mk();
      const s = await settled(m, []);
      const j1 = m.store.jobs.filter((j) => j.payload.order_ref === s.R.rid).pop()!;
      await m.store.recordResult({ jobId: j1.payload.job_id, orderRef: s.R.rid, result: "rejected", reason: svc.BAY_TAKEN_MRR, deliveredTh: null, at: m.nowMs() });
      assert.equal(await svc.reofferOrExpire(m.d, await s.o()), "bay_unavailable", "gate off: refund, never a swap");
      assert.equal(m.store.refunds.length, 1); assert.equal(m.store.refunds[0].rail, "eth_usdc");
      assert.equal(m.store.refunds[0].network, "eip155:11155111"); assert.equal(m.store.refunds[0].status, "pending_owner");
      assert.equal(m.store.jobs.filter((j) => j.payload.order_ref === s.R.rid && j.payload.action === "route").length, 1, "no second route job");
    }
    assert.ok(MS, "store module loaded");
  }
  console.log(`test-eth-rail: all ${ASSERTS} assertions passed`);
  assertBase.ok(ASSERTS >= ETH_MIN_ASSERTIONS, `only ${ASSERTS} assertions ran (minimum ${ETH_MIN_ASSERTIONS})`);
})().catch((e) => { console.error(e); process.exit(1); });
