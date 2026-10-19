/**
 * BTC on-chain rail (PLAN v3.1 §2): watch-only address derivation from a pinned output descriptor.
 * Pure, no network, no new dependency (@noble/curves + @noble/hashes, already in the tree).
 *
 *  - base58check (BIP32 extended keys), BIP32 public child derivation (non-hardened only: the site never holds a private key)
 *  - BIP173 bech32 v0 for P2WPKH addresses (bc1q… mainnet, tb1q… test chains)
 *  - BIP380 descriptor checksum and a strict parser for exactly one descriptor shape:
 *        wpkh([<fp8>/84h/<coin>h/0h]<xpub|tpub>/0/*)#<checksum8>   (h or ' accepted; the checksum covers the exact text)
 *    receive chain /0/* only (never /1/*), account 0', depth 3, child 0' (hardened), fingerprint + path must match the pins.
 *  - zpub/vpub → xpub/tpub conversion (for wallets that export SLIP-132 keys, and tests; the env value is always the
 *    descriptor; many wallets export the descriptor with an xpub already).
 *
 * Shared by the site and its tests. The node agent and poller have their own copies (independent derivation, §2).
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58MAP = new Map([...B58].map((c, i) => [c, i]));

function b58decodeRaw(s: string): Uint8Array | null {
  if (typeof s !== "string" || s.length === 0 || s.length > 140) return null;
  let n = BigInt(0);
  for (const ch of s) { const v = B58MAP.get(ch); if (v === undefined) return null; n = n * BigInt(58) + BigInt(v); }
  const bytes: number[] = [];
  while (n > BigInt(0)) { bytes.push(Number(n & BigInt(0xff))); n >>= BigInt(8); }
  for (const ch of s) { if (ch === "1") bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}
function b58encodeRaw(b: Uint8Array): string {
  let n = BigInt(0);
  for (const x of b) n = (n << BigInt(8)) | BigInt(x);
  let out = "";
  while (n > BigInt(0)) { out = B58[Number(n % BigInt(58))] + out; n /= BigInt(58); }
  for (const x of b) { if (x === 0) out = "1" + out; else break; }
  return out;
}
const dsha = (b: Uint8Array) => sha256(sha256(b));
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** base58check decode; null on a bad checksum or character. */
export function b58checkDecode(s: string): Uint8Array | null {
  const raw = b58decodeRaw(s);
  if (!raw || raw.length < 5) return null;
  const body = raw.slice(0, -4), sum = raw.slice(-4);
  return eq(dsha(body).slice(0, 4), sum) ? body : null;
}
export function b58checkEncode(body: Uint8Array): string {
  const out = new Uint8Array(body.length + 4);
  out.set(body); out.set(dsha(body).slice(0, 4), body.length);
  return b58encodeRaw(out);
}

/** BIP32 / SLIP-132 version bytes. Only xpub (mainnet) and tpub (test chains) are accepted in a descriptor. */
export const VERSIONS = {
  xpub: 0x0488b21e, tpub: 0x043587cf,
  zpub: 0x04b24746, vpub: 0x045f1cf6,
  // Refused everywhere (PLAN §2): ypub/upub (P2SH-P2WPKH), Ypub/Zpub/Upub/Vpub (multisig), private keys.
  ypub: 0x049d7cb2, upub: 0x044a5262, Ypub: 0x0295b43f, Zpub: 0x02aa7ed3, Upub: 0x024289ef, Vpub: 0x02575483,
  xprv: 0x0488ade4, tprv: 0x04358394, zprv: 0x04b2430c, vprv: 0x045f18bc,
} as const;

export type ExtPub = { version: number; depth: number; parentFp: number; child: number; chainCode: Uint8Array; key: Uint8Array };

export function parseExtPub(s: string): ExtPub | null {
  const b = b58checkDecode(s);
  if (!b || b.length !== 78) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const key = b.slice(45, 78);
  if (key[0] !== 2 && key[0] !== 3) return null;   // compressed public key only (rejects private keys: 0x00 prefix)
  try { secp256k1.Point.fromBytes(key); } catch { return null; }
  return { version: dv.getUint32(0), depth: b[4], parentFp: dv.getUint32(5), child: dv.getUint32(9), chainCode: b.slice(13, 45), key };
}
function serializeExtPub(k: ExtPub): string {
  const b = new Uint8Array(78), dv = new DataView(b.buffer);
  dv.setUint32(0, k.version); b[4] = k.depth; dv.setUint32(5, k.parentFp); dv.setUint32(9, k.child); b.set(k.chainCode, 13); b.set(k.key, 45);
  return b58checkEncode(b);
}
/** zpub → xpub, vpub → tpub (same key material, descriptor-standard version bytes). null for anything else. */
export function slip132ToDescriptorKey(s: string): string | null {
  const k = parseExtPub(s);
  if (!k) return null;
  if (k.version === VERSIONS.zpub) return serializeExtPub({ ...k, version: VERSIONS.xpub });
  if (k.version === VERSIONS.vpub) return serializeExtPub({ ...k, version: VERSIONS.tpub });
  return null;
}

const HARDENED = 0x80000000;
/** BIP32 CKDpub (non-hardened). Throws on the (astronomically unlikely) invalid child; callers treat a throw as fail-closed. */
export function ckdPub(parent: { key: Uint8Array; chainCode: Uint8Array }, index: number): { key: Uint8Array; chainCode: Uint8Array } {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new Error("hardened_or_bad_index");
  const data = new Uint8Array(37);
  data.set(parent.key); new DataView(data.buffer).setUint32(33, index);
  const I = hmac(sha512, parent.chainCode, data);
  const il = I.slice(0, 32), ir = I.slice(32);
  const n = secp256k1.Point.CURVE().n;
  const t = BigInt("0x" + hex(il));
  if (t >= n) throw new Error("invalid_child");
  const child = secp256k1.Point.fromBytes(parent.key).add(secp256k1.Point.BASE.multiply(t === BigInt(0) ? (() => { throw new Error("invalid_child"); })() : t));
  if (child.equals(secp256k1.Point.ZERO)) throw new Error("invalid_child");
  return { key: child.toBytes(true), chainCode: ir };
}
export const hash160 = (b: Uint8Array) => ripemd160(sha256(b));
export function fingerprintOf(pubkey: Uint8Array): number { return new DataView(hash160(pubkey).buffer).getUint32(0); }

// ---- bech32 (BIP173, witness v0 only) ----
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values: number[]): number {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) { const b = chk >>> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= G[i]; }
  return chk >>> 0;
}
const hrpExpand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
function convertBits(data: Uint8Array | number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0, bits = 0; const out: number[] = []; const maxv = (1 << to) - 1;
  for (const v of data) { if (v < 0 || v >> from) return null; acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); } }
  if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); } else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return out;
}
export function segwitV0Encode(hrp: "bc" | "tb", program: Uint8Array): string {
  const data = [0, ...convertBits(program, 8, 5, true)!];
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const chk = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31);
  return hrp + "1" + [...data, ...chk].map((d) => CHARSET[d]).join("");
}
/** Strict P2WPKH decode (lowercase, v0, 20-byte program, bech32 not bech32m). Returns the hash160 or null. */
export function decodeP2wpkh(addr: string, hrp: "bc" | "tb"): Uint8Array | null {
  if (typeof addr !== "string" || addr !== addr.toLowerCase() || addr.length !== hrp.length + 1 + 39) return null;
  if (!addr.startsWith(hrp + "1")) return null;
  const data: number[] = [];
  for (const c of addr.slice(hrp.length + 1)) { const v = CHARSET.indexOf(c); if (v < 0) return null; data.push(v); }
  if (polymod([...hrpExpand(hrp), ...data]) !== 1) return null;
  if (data[0] !== 0) return null;
  const prog = convertBits(data.slice(1, -6), 5, 8, false);
  return prog && prog.length === 20 ? Uint8Array.from(prog) : null;
}
export const p2wpkhAddress = (pubkey: Uint8Array, hrp: "bc" | "tb") => segwitV0Encode(hrp, hash160(pubkey));

// ---- BIP380 descriptor checksum ----
const INPUT_CHARSET = "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const CHECKSUM_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function descPolymod(c: bigint, val: number): bigint {
  const c0 = c >> BigInt(35);
  c = ((c & BigInt("0x7ffffffff")) << BigInt(5)) ^ BigInt(val);
  const G = [BigInt("0xf5dee51989"), BigInt("0xa9fdca3312"), BigInt("0x1bab10e32d"), BigInt("0x3706b1677a"), BigInt("0x644d626ffd")];
  for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & BigInt(1)) c ^= G[i];
  return c;
}
/** BIP380 checksum of a descriptor body (without "#…"). null if a character is outside the input charset. */
export function descriptorChecksum(desc: string): string | null {
  let c = BigInt(1), cls = 0, clscount = 0;
  for (const ch of desc) {
    const pos = INPUT_CHARSET.indexOf(ch);
    if (pos < 0) return null;
    c = descPolymod(c, pos & 31);
    cls = cls * 3 + (pos >> 5);
    if (++clscount === 3) { c = descPolymod(c, cls); cls = 0; clscount = 0; }
  }
  if (clscount > 0) c = descPolymod(c, cls);
  for (let i = 0; i < 8; i++) c = descPolymod(c, 0);
  c ^= BigInt(1);
  let out = "";
  for (let j = 0; j < 8; j++) out += CHECKSUM_CHARSET[Number((c >> BigInt(5 * (7 - j))) & BigInt(31))];
  return out;
}

export type ParsedDescriptor = {
  fingerprint: string;      // 8 lowercase hex (master key fingerprint from the key origin)
  coin: 0 | 1;              // 84h/<coin>h: 0 = mainnet, 1 = test chains
  path: string;             // "84h/0h/0h"
  checksum: string;
  keyVersion: "xpub" | "tpub";
  account: ExtPub;
};
export type DescriptorError =
  | "descriptor_missing" | "descriptor_shape" | "descriptor_checksum" | "descriptor_key" | "descriptor_key_version"
  | "descriptor_depth" | "descriptor_child" | "descriptor_path" | "descriptor_chain";

/**
 * Strict parse. Accepts `'` or `h` as the hardened marker in the origin; the receive chain must be exactly `/0/*`.
 * Rejects (PLAN §2): any other script type, change chain /1/*, multipath, ranges, depth ≠ 3, child ≠ 0', a missing
 * or wrong checksum, ypub/zpub/tpub-in-mainnet and so on (the profile check in config.ts pins the version and coin).
 */
export function parseDescriptor(input: string | undefined | null): { ok: true; d: ParsedDescriptor } | { ok: false; error: DescriptorError } {
  if (!input || typeof input !== "string") return { ok: false, error: "descriptor_missing" };
  const s = input.trim();
  const m = /^wpkh\(\[([0-9a-f]{8})\/84['h]\/([01])['h]\/0['h]\]([1-9A-HJ-NP-Za-km-z]{100,120})\/([0-9]+)\/\*\)#([qpzry9x8gf2tvdw0s3jn54khce6mua7l]{8})$/.exec(s);
  if (!m) {
    if (/\/1\/\*\)/.test(s)) return { ok: false, error: "descriptor_chain" };
    return { ok: false, error: "descriptor_shape" };
  }
  const [, fp, coinS, key, chain, sum] = m;
  if (chain !== "0") return { ok: false, error: "descriptor_chain" };
  const body = s.slice(0, s.indexOf("#"));
  if (descriptorChecksum(body) !== sum) return { ok: false, error: "descriptor_checksum" };
  const k = parseExtPub(key);
  if (!k) return { ok: false, error: "descriptor_key" };
  const keyVersion = k.version === VERSIONS.xpub ? "xpub" : k.version === VERSIONS.tpub ? "tpub" : null;
  if (!keyVersion) return { ok: false, error: "descriptor_key_version" };
  if (k.depth !== 3) return { ok: false, error: "descriptor_depth" };
  if (k.child !== HARDENED) return { ok: false, error: "descriptor_child" };
  const coin = Number(coinS) as 0 | 1;
  if ((coin === 0) !== (keyVersion === "xpub")) return { ok: false, error: "descriptor_path" };
  return { ok: true, d: { fingerprint: fp, coin, path: `84h/${coin}h/0h`, checksum: sum, keyVersion, account: k } };
}

/** Address for receive index i (m/84'/coin'/0'/0/i). Callers must refuse i = 0 for bindings (N5). */
export function deriveReceive(d: ParsedDescriptor, index: number): string {
  const chain = ckdPub({ key: d.account.key, chainCode: d.account.chainCode }, 0);
  const leaf = ckdPub(chain, index);
  return p2wpkhAddress(leaf.key, d.coin === 0 ? "bc" : "tb");
}
export const sha256Hex = (s: string) => hex(sha256(new TextEncoder().encode(s)));
