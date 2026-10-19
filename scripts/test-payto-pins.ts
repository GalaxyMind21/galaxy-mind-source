// payto-pins.ts: every rail's payTo comes from env and is used only if it is well-formed, exact EIP-55 (EVM, non-zero)
// and its sha256 equals the pin in code. Tests inject their own hash; there is no env override for the pin.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PAYTO_PIN_SHA256, payToProblem, payToMatchesPin, verifiedPayTo, evmPayToFromEnv, solanaPayToFromEnv, sha256Hex,
  eip55Checksum, payToMismatch, clearPayToMismatchReports,
} from "../src/lib/rentals/phase2/payto-pins";
import { TEST_PAYTO_EVM as EVM, TEST_PAYTO_SOLANA as SOL, TEST_PAYTO_PINS as PINS } from "./lib/test-payto";

let n = 0;
(async () => {
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };

// The pins are sha256 hex, frozen, and the file spells out no address.
ok(/^[0-9a-f]{64}$/.test(PAYTO_PIN_SHA256.evm) && /^[0-9a-f]{64}$/.test(PAYTO_PIN_SHA256.solana), "pins are sha256 hex");
ok(Object.isFrozen(PAYTO_PIN_SHA256), "pins are frozen");
const src = readFileSync("src/lib/rentals/phase2/payto-pins.ts", "utf8");
ok(!/0x[0-9a-fA-F]{40}/.test(src) && !/\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/.test(src), "payto-pins.ts holds no address");
ok(!/process\.env\.\w*(SHA|PIN_HASH)/.test(src), "no env override for the hash");
// No rail module keeps an address constant or compares lowercased payTo.
for (const f of ["x402.ts", "solana.ts", "staging.ts", "test-order.ts", "human.ts", "eth/config.ts"]) {
  const s = readFileSync(`src/lib/rentals/phase2/${f}`, "utf8");
  ok(!/PINNED_(SOLANA_|ETH_)?PAYTO\b/.test(s), `${f}: no address pin constant`);
  ok(!/payTo\.toLowerCase\(\) [!=]==/.test(s), `${f}: no lowercased payTo comparison`);
}
const route = readFileSync("src/app/api/rentals/test-order/route.ts", "utf8");
ok(/evmPayToFromEnv\(env\)/.test(route) && !/PINNED_PAYTO/.test(route), "test-order route reads the verified env payTo");

// EVM
eq(payToProblem("evm", EVM, PINS.evm), null, "test EVM payTo passes under its own pin");
eq(payToProblem("evm", EVM), "pin_mismatch", "the test address does not hash to the production pin");
eq(payToProblem("evm", EVM.toLowerCase(), sha256Hex(EVM.toLowerCase())), "bad_checksum", "lowercase is not EIP-55, even when it is the pin");
eq(payToProblem("evm", "0x" + "0".repeat(40), sha256Hex("0x" + "0".repeat(40))), "zero_address", "zero address refused");
eq(payToProblem("evm", "0x1234", PINS.evm), "bad_format", "short address refused");
eq(payToProblem("evm", "", PINS.evm), "unset", "empty = unset");
eq(payToProblem("evm", EVM, EVM), "bad_pin", "an address passed as the pin is not a sha256");
eq(payToProblem("evm", EVM, null), "bad_pin", "null pin refuses");
const flip = (() => { const i = EVM.slice(2).search(/[a-fA-F]/) + 2; const c = EVM[i]; return EVM.slice(0, i) + (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) + EVM.slice(i + 1); })();
eq(payToProblem("evm", flip, sha256Hex(flip)), "bad_checksum", "a one-letter case typo fails EIP-55");
eq(eip55Checksum(EVM.toLowerCase()), EVM, "eip55Checksum restores the test address");
eq(verifiedPayTo("evm", `  ${EVM}  `, PINS.evm), EVM, "surrounding whitespace is trimmed before the checks");
eq(evmPayToFromEnv({ RENTALS_PAYTO_PIN_EVM: EVM }, PINS.evm), EVM, "Base payTo from env");
eq(evmPayToFromEnv({ RENTALS_PAYTO_PIN_EVM: EVM }), "", "Base payTo refused under the production pin");
eq(evmPayToFromEnv({}, PINS.evm), "", "unset = closed");

// Solana
eq(payToProblem("solana", SOL, PINS.solana), null, "test Solana payTo passes under its own pin");
eq(payToProblem("solana", SOL), "pin_mismatch", "and not under the production pin");
eq(payToProblem("solana", "2".repeat(32), sha256Hex("2".repeat(32))), "bad_format", "base58 that isn't 32 bytes refused");
eq(payToProblem("solana", EVM, sha256Hex(EVM)), "bad_format", "a 0x address is not a Solana key");
eq(solanaPayToFromEnv({ RENTALS_PAYTO_PIN_SOLANA: SOL }, PINS.solana), SOL, "Solana payTo from env");
ok(payToMatchesPin("solana", SOL, PINS.solana) && !payToMatchesPin("solana", SOL), "payToMatchesPin");

// Mismatch reporting: a log line without the address, and one ntfy alert per kind+problem per instance.
{
  clearPayToMismatchReports();
  const logs: string[] = [], posts: { url: string; body: string }[] = [];
  const orig = console.error; console.error = (m: string) => { logs.push(String(m)); };
  const f = (async (url: string, init: { body: string }) => { posts.push({ url, body: init.body }); return new Response("ok"); }) as unknown as typeof fetch;
  try {
    const env = { RENTALS_NTFY_URL: "https://ntfy.example", RENTALS_NTFY_TOPIC: "t" };
    payToMismatch("evm", "pin_mismatch", env, f);
    payToMismatch("evm", "pin_mismatch", env, f);
    payToMismatch("evm", "unset", env, f);
    await new Promise((r) => setTimeout(r, 10));
  } finally { console.error = orig; }
  eq(logs.length, 2, "each refusal logs (unset doesn't)");
  ok(logs.every((l) => JSON.parse(l).event === "payto_pin_mismatch" && !l.includes(EVM)), "log names the event, never the address");
  eq(posts.length, 1, "one alert per kind+problem per instance");
  ok(posts[0].url === "https://ntfy.example/t" && posts[0].body.includes("payto_pin_mismatch_evm") && !posts[0].body.includes(EVM), "alert goes to the rentals ntfy topic, without the address");
}
console.log(`payto-pins: ${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
