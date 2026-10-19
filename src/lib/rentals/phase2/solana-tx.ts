/**
 * Minimal Solana primitives for the x402 "exact" SVM rail. Pure, no network, no new dependency:
 * base58, PDA / associated-token-account derivation, and a strict parser + builder for the one
 * transaction shape we accept (x402 exact SVM spec §3.1 "static layout"):
 *   [0] ComputeBudget SetComputeUnitLimit  [1] ComputeBudget SetComputeUnitPrice
 *   [2] spl-token TransferChecked          [3..6] Memo / Lighthouse (exactly one Memo overall)
 * Shared by the server (pre-verify decode) and the browser (building the tx Phantom signs).
 * Spec: https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP = new Map([...ALPHABET].map((c, i) => [c, i]));

export function b58encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => ALPHABET[d]).join("");
}

/** Strict base58 decode; null on any invalid character. */
export function b58decode(s: string): Uint8Array | null {
  if (typeof s !== "string" || s.length === 0 || s.length > 128) return null;
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    const v = MAP.get(s[i]);
    if (v === undefined) return null;
    let carry = v;
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  return new Uint8Array([...new Array(zeros).fill(0), ...bytes.reverse()]);
}

/** A base58 32-byte public key (does not check the curve). */
export function isPubkey(s: unknown): s is string {
  return typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && b58decode(s)?.length === 32;
}
/** A base58 64-byte transaction signature (the Solana tx id): 64 to 88 characters. */
export const SOLANA_SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
export function isSolanaSig(s: unknown): s is string {
  return typeof s === "string" && SOLANA_SIG_RE.test(s) && b58decode(s)?.length === 64;
}

export function isOnCurve(pk: Uint8Array): boolean {
  try { ed25519.Point.fromBytes(pk); return true; } catch { return false; }
}

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

const enc = new TextEncoder();
const concat = (...a: Uint8Array[]) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };

/** findProgramAddress: the first bump (255 down) whose hash is off the ed25519 curve. */
export function findPda(seeds: Uint8Array[], programId: string): string {
  const pid = b58decode(programId)!;
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256(concat(...seeds, new Uint8Array([bump]), pid, enc.encode("ProgramDerivedAddress")));
    if (!isOnCurve(h)) return b58encode(h);
  }
  throw new Error("no_pda");
}

/** The associated token account of owner for mint under the classic spl-token program. */
export function associatedTokenAddress(owner: string, mint: string, tokenProgram = TOKEN_PROGRAM): string {
  const o = b58decode(owner), m = b58decode(mint), t = b58decode(tokenProgram);
  if (o?.length !== 32 || m?.length !== 32 || t?.length !== 32) throw new Error("bad_pubkey");
  return findPda([o, t, m], ATA_PROGRAM);
}

// ── wire format ────────────────────────────────────────────────────────────
function readShortVec(b: Uint8Array, at: number): [number, number] {
  let len = 0, size = 0;
  for (;;) {
    if (at + size >= b.length || size > 2) throw new Error("shortvec");
    const v = b[at + size]; len |= (v & 0x7f) << (size * 7); size++;
    if ((v & 0x80) === 0) break;
  }
  return [len, size];
}
export function shortVec(n: number): Uint8Array {
  const out: number[] = [];
  for (;;) { let e = n & 0x7f; n >>= 7; if (n === 0) { out.push(e); break; } e |= 0x80; out.push(e); }
  return new Uint8Array(out);
}

export type Ix = { programId: string; accounts: string[]; accountIdx: number[]; data: Uint8Array };
export type ParsedTx = {
  signatures: Uint8Array[];       // 64-byte each, zero-filled when not yet signed
  message: Uint8Array;            // exactly the bytes that are signed
  version: "legacy" | 0;
  numRequiredSignatures: number;
  numReadonlySigned: number;
  numReadonlyUnsigned: number;
  accountKeys: string[];
  recentBlockhash: string;
  instructions: Ix[];
  lookups: number;                // address-table lookups (we refuse any)
};

/** Parse a serialized (possibly partially signed) legacy or v0 transaction. Throws on malformed input. */
export function parseTransaction(raw: Uint8Array): ParsedTx {
  let at = 0;
  const [nSig, s1] = readShortVec(raw, at); at += s1;
  if (nSig < 1 || nSig > 8) throw new Error("sig_count");
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < nSig; i++) { if (at + 64 > raw.length) throw new Error("short"); signatures.push(raw.slice(at, at + 64)); at += 64; }
  const msgStart = at;
  let version: "legacy" | 0 = "legacy";
  if (raw[at] & 0x80) { if ((raw[at] & 0x7f) !== 0) throw new Error("tx_version"); version = 0; at++; }
  if (at + 3 > raw.length) throw new Error("short");
  const [numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned] = [raw[at], raw[at + 1], raw[at + 2]]; at += 3;
  const [nKeys, s2] = readShortVec(raw, at); at += s2;
  if (nKeys < 1 || nKeys > 64) throw new Error("key_count");
  const accountKeys: string[] = [];
  for (let i = 0; i < nKeys; i++) { if (at + 32 > raw.length) throw new Error("short"); accountKeys.push(b58encode(raw.slice(at, at + 32))); at += 32; }
  if (at + 32 > raw.length) throw new Error("short");
  const recentBlockhash = b58encode(raw.slice(at, at + 32)); at += 32;
  const [nIx, s3] = readShortVec(raw, at); at += s3;
  if (nIx > 16) throw new Error("ix_count");
  const instructions: Ix[] = [];
  for (let i = 0; i < nIx; i++) {
    const pIdx = raw[at++];
    const [na, s4] = readShortVec(raw, at); at += s4;
    const accountIdx: number[] = [];
    for (let k = 0; k < na; k++) accountIdx.push(raw[at++]);
    const [nd, s5] = readShortVec(raw, at); at += s5;
    if (at + nd > raw.length) throw new Error("short");
    const data = raw.slice(at, at + nd); at += nd;
    if (pIdx === undefined || accountIdx.some((x) => x === undefined)) throw new Error("short");
    // Indices past the static keys point into address-lookup tables: kept as "" (unresolved).
    if (pIdx >= nKeys) throw new Error("ix_program"); // a program id never comes from a lookup table
    instructions.push({ programId: accountKeys[pIdx] ?? "", accounts: accountIdx.map((x) => accountKeys[x] ?? ""), accountIdx, data });
  }
  let lookups = 0, lookedUp = 0;
  if (version === 0) {
    const [nl, s6] = readShortVec(raw, at); at += s6; lookups = nl;
    for (let i = 0; i < nl; i++) {
      at += 32;
      const [nw, a] = readShortVec(raw, at); at += a + nw;
      const [nr, b] = readShortVec(raw, at); at += b + nr;
      lookedUp += nw + nr;
    }
  }
  if (at !== raw.length) throw new Error("trailing_bytes");
  const maxIdx = nKeys + lookedUp;
  if (instructions.some((ix) => !ix.accountIdx.every((x) => x < maxIdx))) throw new Error("ix_index");
  if (numRequiredSignatures !== nSig || numRequiredSignatures > nKeys || numReadonlySigned >= numRequiredSignatures || numReadonlyUnsigned > nKeys - numRequiredSignatures) throw new Error("header");
  return { signatures, message: raw.slice(msgStart), version, numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned, accountKeys, recentBlockhash, instructions, lookups };
}

const u32le = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const u64le = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
export const readU64 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(at, true);
export const readU32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);

/**
 * Build the unsigned v0 payment transaction for the browser wallet to sign:
 * feePayer (sponsor) pays fees and signs last at the facilitator; payer signs the transfer.
 * Accounts: [feePayer w s] [payer w s] [srcAta w] [dstAta w] [mint r] [token r] [computeBudget r] [memo r]
 */
export function buildPaymentTx(o: { feePayer: string; payer: string; mint: string; payTo: string; amount: bigint; decimals: number; memo: string; recentBlockhash: string; cuLimit?: number; cuPriceMicroLamports?: bigint }): Uint8Array {
  if (![o.feePayer, o.payer, o.mint, o.payTo].every(isPubkey) || o.feePayer === o.payer) throw new Error("bad_pubkey");
  const memo = enc.encode(o.memo);
  if (memo.length < 1 || memo.length > 256) throw new Error("bad_memo");
  const src = associatedTokenAddress(o.payer, o.mint), dst = associatedTokenAddress(o.payTo, o.mint);
  const keys = [o.feePayer, o.payer, src, dst, o.mint, TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM];
  const ix = (p: number, accts: number[], data: Uint8Array) => concat(new Uint8Array([p]), shortVec(accts.length), new Uint8Array(accts), shortVec(data.length), data);
  const ixs = [
    ix(6, [], concat(new Uint8Array([2]), u32le(o.cuLimit ?? 20_000))),
    ix(6, [], concat(new Uint8Array([3]), u64le(o.cuPriceMicroLamports ?? BigInt(1)))),
    ix(5, [2, 4, 3, 1], concat(new Uint8Array([12]), u64le(o.amount), new Uint8Array([o.decimals]))),
    ix(7, [], memo),
  ];
  const message = concat(
    new Uint8Array([0x80, 2, 0, 4]), // v0; 2 required sigs (feePayer, payer); 0 readonly signed; 4 readonly unsigned (mint, token, cb, memo)
    shortVec(keys.length), ...keys.map((k) => b58decode(k)!), b58decode(o.recentBlockhash)!,
    shortVec(ixs.length), ...ixs, shortVec(0),
  );
  if (b58decode(o.recentBlockhash)?.length !== 32) throw new Error("bad_blockhash");
  return concat(shortVec(2), new Uint8Array(128), message);
}

export function verifySignature(sig: Uint8Array, message: Uint8Array, pubkey: string): boolean {
  const pk = b58decode(pubkey);
  if (!pk || pk.length !== 32 || sig.length !== 64) return false;
  try { return ed25519.verify(sig, message, pk); } catch { return false; }
}

/** Network-aware tx id check used by the store, the service and the job schema. */
export function validTxId(network: string, tx: unknown): boolean {
  if (typeof tx !== "string") return false;
  if (network.startsWith("solana:")) return isSolanaSig(tx);
  if (network.startsWith("eip155:")) return /^0x[0-9a-f]{64}$/.test(tx);
  return false;
}
/** Network-aware payTo check: EVM 0x address, or a Solana base58 public key. */
export function validPayTo(network: string, a: unknown): boolean {
  if (network.startsWith("solana:")) return isPubkey(a);
  if (network.startsWith("eip155:")) return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
  return false;
}
