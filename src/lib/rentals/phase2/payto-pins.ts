/**
 * Receive addresses: the address lives in server-only env, and its sha256 is pinned here in code (pre-public cleanup,
 * 2026-10-19; security review round 7). The repository never spells out an address.
 *
 *   RENTALS_PAYTO_PIN_EVM     the Base receive address, exact EIP-55 form (Base x402 and the one-time test order).
 *   RENTALS_ETH_PAYTO         the Ethereum USDC receive address (eth/config.ts). The same address as Base (the
 *                             operator's confirmation, 2026-10-17), so it is checked against the same EVM pin.
 *   RENTALS_PAYTO_PIN_SOLANA  the Solana USDC receive address (base58 public key, 32 bytes).
 *
 * Every rail reads its payTo from env and uses it only if it passes ALL of:
 *   - format: EVM = 0x + 40 hex, in its exact EIP-55 checksum form, never the zero address; Solana = base58 that
 *     decodes to exactly 32 bytes;
 *   - sha256(utf8(address)) === PAYTO_PIN_SHA256[kind].
 * Anything else is "" (rail closed, fail closed), and a value that is well-formed but hashes to something else is
 * logged as payto_pin_mismatch and raised on the operator alert path (payToMismatch below).
 *
 * So changing an address needs a reviewed commit (new hash here) AND the env change. Nothing compares the env with
 * itself and nothing uses the hash as an address. Tests pass their own expected hash as a parameter; there is no env
 * override for the hash.
 *
 * Privacy note: a sha256 can't be reversed and the address space can't be enumerated, but anyone holding a candidate
 * address can confirm it is ours. Every quote hands the address out once a rail is open anyway.
 */
import crypto from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { b58decode } from "./solana-tx";
import { NtfyAlerter } from "./safety";

export type PayToKind = "evm" | "solana";
export type PayToPins = Readonly<Record<PayToKind, string>>;

/** sha256(utf8(address)), lowercase hex. Changing one is a reviewed code change. */
export const PAYTO_PIN_SHA256: PayToPins = Object.freeze({
  evm: "eaa2cc8655d3d70d4e6f07f97ae3a3484fa6f4e85f8182ed6a031bb9d410db40",
  solana: "9bbd8de80ec39313529d5d8642da36f6f4ea3b754c99be4ef12ea988428f2038",
});

const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SHA = /^[0-9a-f]{64}$/;

/** EIP-55 checksum form of a 20-byte hex address (same algorithm as x402.ts toChecksum and eth/config.ts eip55). */
export function eip55Checksum(addr: string): string {
  const a = addr.toLowerCase().replace(/^0x/, "");
  const h = Buffer.from(keccak_256(new TextEncoder().encode(a))).toString("hex");
  return "0x" + [...a].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
}

export const sha256Hex = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

export type PayToProblem = "unset" | "bad_format" | "bad_checksum" | "zero_address" | "bad_pin" | "pin_mismatch";

/** Format + checksum only (no pin). */
export function payToFormatProblem(kind: PayToKind, v: string): PayToProblem | null {
  if (!v) return "unset";
  if (kind === "evm") {
    if (!EVM.test(v)) return "bad_format";
    if (/^0x0{40}$/i.test(v)) return "zero_address";
    return eip55Checksum(v) === v ? null : "bad_checksum";
  }
  if (!SOLANA.test(v)) return "bad_format";
  const b = b58decode(v);
  return b && b.length === 32 ? null : "bad_format";
}

/** Why `v` may not be used as a `kind` payTo under `pinSha`, or null when it may. */
export function payToProblem(kind: PayToKind, v: string | null | undefined, pinSha: string | null | undefined = PAYTO_PIN_SHA256[kind]): PayToProblem | null {
  const f = payToFormatProblem(kind, v ?? "");
  if (f) return f;
  if (!pinSha || !SHA.test(pinSha)) return "bad_pin";
  const got = Buffer.from(sha256Hex(v as string), "hex"), want = Buffer.from(pinSha, "hex");
  return crypto.timingSafeEqual(got, want) ? null : "pin_mismatch";
}

/** True only for a well-formed address whose sha256 equals the pin. */
export const payToMatchesPin = (kind: PayToKind, v: string | null | undefined, pinSha?: string | null) => payToProblem(kind, v, pinSha) === null;

const reported = new Set<string>();
/** Test hook. */
export function clearPayToMismatchReports() { reported.clear(); }

/**
 * Report a configured-but-refused payTo: one structured log line (never the address) on every refusal and, once per
 * serverless instance and kind:problem, the operator alert path (NtfyAlerter when RENTALS_NTFY_URL is set, the same channel
 * the rentals alerter uses). The "once" lives in this module's memory, so it is NOT once overall: every cold instance that
 * sees the bad value alerts again (expect one alert per instance, and more after each deploy or scale-out). "unset" is not
 * reported: an empty env is the normal closed state.
 */
export function payToMismatch(kind: PayToKind, problem: PayToProblem, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): void {
  if (problem === "unset") return;
  console.error(JSON.stringify({ event: "payto_pin_mismatch", kind, problem }));
  const key = `${kind}:${problem}`;
  if (reported.has(key)) return;
  reported.add(key);
  if (!env.RENTALS_NTFY_URL) return;
  void new NtfyAlerter(env.RENTALS_NTFY_URL, env.RENTALS_NTFY_TOPIC ?? "gm-alerts", env.RENTALS_NTFY_TOKEN, fetchImpl)
    .send({ kind: `payto_pin_mismatch_${kind}`, orderRef: problem, at: Date.now() }).catch(() => {});
}

/** The verified payTo for `kind`, or "" (and a mismatch report when the value was set but refused). */
export function verifiedPayTo(kind: PayToKind, raw: string | null | undefined, pinSha?: string | null, env: Record<string, string | undefined> = process.env): string {
  const v = (raw ?? "").trim();
  const p = payToProblem(kind, v, pinSha === undefined ? PAYTO_PIN_SHA256[kind] : pinSha);
  if (p) { payToMismatch(kind, p, env); return ""; }
  return v;
}

/** Base / test-order payTo from RENTALS_PAYTO_PIN_EVM. */
export const evmPayToFromEnv = (env: Record<string, string | undefined> = process.env, pinSha?: string | null) => verifiedPayTo("evm", env.RENTALS_PAYTO_PIN_EVM, pinSha, env);
/** Solana payTo from RENTALS_PAYTO_PIN_SOLANA. */
export const solanaPayToFromEnv = (env: Record<string, string | undefined> = process.env, pinSha?: string | null) => verifiedPayTo("solana", env.RENTALS_PAYTO_PIN_SOLANA, pinSha, env);
