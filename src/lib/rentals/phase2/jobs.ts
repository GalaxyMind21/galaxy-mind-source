/**
 * Signed jobs (job schema). Vercel signs with an Ed25519 private key held
 * in a Sensitive env var; the node holds only the public key and verifies.
 * Canonical form: JSON with keys sorted (UTF-16 code unit order), no
 * whitespace, values limited to strings, safe integers, booleans, null,
 * nested objects and (rev 1.7) arrays in their given order. No floats, so there
 * is exactly one encoding. Arrays only add an encoding; every pre-1.7 payload
 * encodes byte-for-byte as before. Order inside an array is part of the schema
 * (BTC outpoints must be strictly ascending), never re-sorted here.
 *
 * Rev 1.7 (PLAN v3.1 §6 + §18.3): rail-first dispatch. Allowed rails are
 * x402_usdc (rev 1.6 networks, unit usdc_6dp) and btc_onchain (one bip122
 * network per env, unit sat). lightning is dropped from the allowlist.
 * Rev 1.8: rail eth_usdc (USDC on Ethereum, direct transfer): the x402 payment shape (same keys, unit usdc_6dp, 0x tx
 * hash, pay_to, amount_usdc), with network in ETH_JOB_NETWORKS. x402_usdc never carries an Ethereum network.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { validTxId, validPayTo } from "./solana-tx";
import { ETH_JOB_NETWORKS, X402_JOB_NETWORKS } from "./x402";
import { btcNetworkForEnv, btcHrpForNetwork } from "./btc/networks";

export const JOB_DOMAIN = "gm-job-v1\n";
export const JOB_MAX_TTL_SEC = 15 * 60;

export type JobPayload = {
  v: 1;
  job_id: string;
  order_ref: string;
  action: "route" | "extend" | "revert";
  rig_class: "s21xp";
  rig_count: number;
  bays: string;           // bay numbers, "3,7" (count = rig_count). Never rig ids; the node maps bays to rigs.
  upstream: { host: string; port: number; user: string } | null;
  start: number;          // unix seconds
  end: number;            // unix seconds
  /** rev 1.5: amount_atomic is an integer string; tx_hash is the facilitator settle tx, required for x402, null for lightning.
   *  rev 1.6: network is the CAIP-2 network the money settled on (Base or Solana, up to 64 chars); tx_hash is lowercase 0x hex on Base, a base58 signature on Solana.
   *  rev 1.7: rail-first; btc_onchain payments use BtcJobPayment (no x402 keys), lightning is refused by schemaOk. */
  payment: X402JobPayment | BtcJobPayment | null;
  pay_to: string | null;               // settled x402 payTo for payment.network (Base: 0x 20 bytes; Solana: base58 public key); null for lightning or revert
  amount_usdc: string | null;          // settled amount, decimal string "12.345678"; null for lightning or revert
  floor_btc_per_ph_day: string;        // pricing_daily floor the order was quoted at, decimal string
  nonce: string;          // 128-bit hex
  iat: number;
  exp: number;
  env: "staging" | "mainnet";
};
export type SignedJob = { kid: string; payload: JobPayload; sig: string };
/** x402 (and the deferred lightning shape, which rev 1.7 verifiers refuse). The `never` keys only make cross-rail reads type-check as undefined. */
export type X402JobPayment = {
  rail: "lightning" | "x402_usdc" | "eth_usdc"; provider_ref: string; amount_atomic: string; tx_hash: string | null; unit: "sat" | "usdc_6dp"; network: string;
  payment_id?: never; binding_id?: never; outpoints?: never; amount_sat?: never;
};
export type BtcOutpoint = { txid: string; vout: number; value_sat: number };
/** rev 1.7 btc_onchain payment (PLAN §6). Times are unix seconds; floor is the 8-dp string the attestation signed. */
export type BtcJobPayment = {
  rail: "btc_onchain"; network: string; unit: "sat";
  payment_id: string; order_id: string; binding_id: string; index: number; address: string;
  amount_sat: number; required_confs: 1 | 2; floor_btc_per_ph_day: string; floor_day: string;
  quote_at: number; quote_expires_at: number; quote_tip_height: number; confirm_by_height: number;
  outpoints: BtcOutpoint[];
  provider_ref?: never; tx_hash?: never; amount_atomic?: never;
};
export const BTC_PAYMENT_KEYS = ["address", "amount_sat", "binding_id", "confirm_by_height", "floor_btc_per_ph_day", "floor_day", "index", "network", "order_id", "outpoints", "payment_id", "quote_at", "quote_expires_at", "quote_tip_height", "rail", "required_confs", "unit"];
export const X402_PAYMENT_KEYS = ["amount_atomic", "network", "provider_ref", "rail", "tx_hash", "unit"];
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Rail-agnostic payment id (PLAN §6 audit b): x402 = tx_hash, BTC = "btc:<binding_id>". */
export function paymentIdOf(p: JobPayload["payment"]): string | null {
  if (!p) return null;
  if (p.rail === "btc_onchain") return typeof p.payment_id === "string" && p.payment_id ? p.payment_id : null;
  return typeof p.tx_hash === "string" && p.tx_hash ? p.tx_hash : null;
}

export function canonicalize(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("canonical: only safe integers allowed");
    return String(v);
  }
  if (Array.isArray(v)) return "[" + v.map((x) => canonicalize(x)).join(",") + "]";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
  }
  throw new Error("canonical: unsupported type");
}

export function signJob(payload: JobPayload, privateKeyPem: string, kid: string): SignedJob {
  const msg = Buffer.from(JOB_DOMAIN + canonicalize(payload), "utf8");
  const sig = crypto.sign(null, msg, crypto.createPrivateKey(privateKeyPem)).toString("base64url");
  return { kid, payload, sig };
}

/** Durable replay ledger (node: append-only 0600 JSONL, fsync per write). */
/** apply: order_ref|action|payment_id for paid route/extend jobs (x402: tx_hash; BTC: btc:<binding_id>). A re-offered job (fresh nonce, same order + payment) is refused as already_applied. */
export interface NonceLedger { has(nonce: string, jobId: string, apply?: string | null): boolean; add(nonce: string, jobId: string, apply?: string | null): void }
/** Dedupe key the node applies at most once (rev 1.5 re-offer). */
export function applyKey(p: JobPayload): string | null {
  if (p.action === "revert") return null;
  const id = paymentIdOf(p.payment);
  return id ? `${p.order_ref}|${p.action}|${id}` : null;
}
export class FileLedger implements NonceLedger {
  private seen = new Set<string>();
  constructor(private path: string) {
    if (fs.existsSync(path)) for (const l of fs.readFileSync(path, "utf8").split("\n")) { if (!l) continue; try { const j = JSON.parse(l); this.seen.add("n:" + j.nonce); this.seen.add("j:" + j.job); if (j.apply) this.seen.add("a:" + j.apply); } catch { /* skip torn line */ } }
  }
  has(n: string, j: string, a?: string | null) { return this.seen.has("n:" + n) || this.seen.has("j:" + j) || (!!a && this.seen.has("a:" + a)); }
  add(n: string, j: string, a?: string | null) {
    const fd = fs.openSync(this.path, "a", 0o600);
    try { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), nonce: n, job: j, apply: a ?? null }) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.seen.add("n:" + n); this.seen.add("j:" + j); if (a) this.seen.add("a:" + a);
  }
}

const PAYLOAD_KEYS = ["action", "amount_usdc", "bays", "end", "floor_btc_per_ph_day", "pay_to", "env", "exp", "iat", "job_id", "nonce", "order_ref", "payment", "rig_class", "rig_count", "start", "upstream", "v"];
const isInt = (x: unknown) => Number.isSafeInteger(x);
const exact = (o: unknown, keys: string[]) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join() === [...keys].sort().join();

/** Strict schema check for JobPayload (job schema §2). */
export function schemaOk(p: unknown, caps: { maxRigs: number; maxSec: number; hostSuffixes: string[]; ports: Set<number> }): string | null {
  if (!exact(p, PAYLOAD_KEYS)) return "schema_keys";
  const q = p as JobPayload;
  if (q.v !== 1) return "bad_version";
  if (typeof q.job_id !== "string" || !/^[0-9a-f-]{36}$/.test(q.job_id)) return "schema_job_id";
  if (typeof q.order_ref !== "string" || !/^gm_[A-Za-z0-9_-]{8,20}$/.test(q.order_ref)) return "schema_order_ref";
  if (!["route", "extend", "revert"].includes(q.action)) return "schema_action";
  if (q.rig_class !== "s21xp") return "schema_rig_class";
  if (!isInt(q.rig_count) || q.rig_count < 1 || q.rig_count > caps.maxRigs) return "cap_rigs";
  if (typeof q.bays !== "string" || !/^\d{1,3}(,\d{1,3}){0,3}$/.test(q.bays)) return "schema_bays";
  { const b = q.bays.split(",").map(Number); if (b.length !== q.rig_count || new Set(b).size !== b.length || b.some((n) => n < 1)) return "schema_bays"; }
  if (q.pay_to !== null && (typeof q.pay_to !== "string" || q.pay_to.length > 64)) return "schema_pay_to"; // shape checked per network below
  if (q.amount_usdc !== null && (typeof q.amount_usdc !== "string" || !/^\d{1,9}\.\d{6}$/.test(q.amount_usdc))) return "schema_amount_usdc";
  if (typeof q.floor_btc_per_ph_day !== "string" || !/^0\.\d{1,12}$/.test(q.floor_btc_per_ph_day) || !(Number(q.floor_btc_per_ph_day) > 0)) return "schema_floor";
  if (!isInt(q.start) || !isInt(q.end) || !isInt(q.iat) || !isInt(q.exp)) return "schema_times";
  if (q.action !== "revert" && (q.end - q.start < 86_400 || q.end - q.start > caps.maxSec)) return "cap_length";
  if (typeof q.nonce !== "string" || !/^[0-9a-f]{32}$/.test(q.nonce)) return "schema_nonce";
  if (q.action === "revert" ? q.upstream !== null : !exact(q.upstream, ["host", "port", "user"])) return "schema_upstream";
  if (q.upstream) {
    const { host, port, user } = q.upstream;
    if (typeof host !== "string" || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || /^\d+(\.\d+){3}$/.test(host)) return "pool_host";
    if (!caps.hostSuffixes.some((s) => host === s || host.endsWith("." + s))) return "pool_not_allowlisted";
    if (!isInt(port) || !caps.ports.has(port)) return "pool_port";
    if (typeof user !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(user)) return "pool_user";
  }
  if (q.action !== "revert") {
    // rev 1.7: dispatch on rail FIRST, then network; exact keys per rail (J19 cross-rail mutations reject).
    const rail = q.payment && typeof q.payment === "object" && !Array.isArray(q.payment) ? (q.payment as { rail?: unknown }).rail : undefined;
    if (rail === "btc_onchain") {
      const bad = btcPaymentSchema(q);
      if (bad) return bad;
    } else {
      if (rail !== "x402_usdc" && rail !== "eth_usdc") return "schema_payment"; // lightning dropped (J18); anything else (J3)
      if (!exact(q.payment, X402_PAYMENT_KEYS)) return "schema_payment";
      const pm = q.payment as X402JobPayment;
      if (typeof pm.network !== "string" || pm.network.length > 64) return "schema_payment";
      if (!X402_JOB_NETWORKS.has(pm.network)) return "schema_network";
      // rev 1.8: rail and network must agree (an Ethereum network only on eth_usdc, eth_usdc only on Ethereum).
      if ((rail === "eth_usdc") !== ETH_JOB_NETWORKS.has(pm.network)) return "schema_network";
      // rev 1.6: tx_hash shape follows the network (Base: lowercase 0x hex 32 bytes; Solana: base58 signature 64-88 chars).
      if (pm.tx_hash !== null && !validTxId(pm.network, pm.tx_hash)) return "schema_tx_hash";
      if (q.pay_to !== null && !validPayTo(pm.network, q.pay_to)) return "schema_pay_to";
      if (pm.unit !== "usdc_6dp" || typeof pm.amount_atomic !== "string" || !/^[1-9][0-9]{0,15}$/.test(pm.amount_atomic) || typeof pm.provider_ref !== "string" || pm.provider_ref.length > 80) return "schema_payment";
    }
  } else if (q.payment !== null || q.pay_to !== null) return q.payment !== null ? "schema_payment" : "schema_pay_to";
  if ((q.payment?.rail === "x402_usdc" || q.payment?.rail === "eth_usdc") && (q.pay_to === null || q.amount_usdc === null || Math.round(Number(q.amount_usdc) * 1e6) !== Number(q.payment.amount_atomic) || typeof q.payment.tx_hash !== "string")) return "schema_settlement";
  return null;
}

const BTC_TXID_RE = /^[0-9a-f]{64}$/;
const BTC_FLOOR_RE = /^0\.[0-9]{8}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** BTC branch of the rev 1.7 schema (PLAN §6, §18.3, §18.5). Mirrored verbatim in verify-job-snippet.mjs. */
function btcPaymentSchema(q: JobPayload): string | null {
  if (!exact(q.payment, BTC_PAYMENT_KEYS)) return "schema_payment";
  const pm = q.payment as BtcJobPayment;
  const want = btcNetworkForEnv(q.env);
  if (!want || pm.network !== want) return "schema_payment"; // J2, J22, J23
  const hrp = btcHrpForNetwork(pm.network);
  if (pm.unit !== "sat" || !hrp) return "schema_payment";
  if (typeof pm.binding_id !== "string" || !UUID_RE.test(pm.binding_id) || pm.payment_id !== "btc:" + pm.binding_id) return "schema_payment"; // J14, J15
  if (typeof pm.order_id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(pm.order_id)) return "schema_payment";
  if (!isInt(pm.index) || pm.index < 1 || pm.index > 0x7fffffff) return "schema_payment"; // N5: index 0 never
  if (typeof pm.address !== "string" || !new RegExp(`^${hrp}1q[02-9ac-hj-np-z]{38}$`).test(pm.address)) return "schema_payment";
  if (!isInt(pm.amount_sat) || pm.amount_sat < 1) return "schema_payment";
  if (pm.required_confs !== (pm.amount_sat < 1_000_000 ? 1 : 2)) return "schema_payment";
  if (typeof pm.floor_btc_per_ph_day !== "string" || !BTC_FLOOR_RE.test(pm.floor_btc_per_ph_day) || !(Number(pm.floor_btc_per_ph_day) > 0)) return "schema_payment";
  if (q.floor_btc_per_ph_day !== pm.floor_btc_per_ph_day) return "schema_payment"; // J12
  if (typeof pm.floor_day !== "string" || !DAY_RE.test(pm.floor_day)) return "schema_payment";
  if (![pm.quote_at, pm.quote_expires_at, pm.quote_tip_height, pm.confirm_by_height].every(isInt)) return "schema_payment";
  if (pm.quote_expires_at <= pm.quote_at || pm.quote_tip_height < 1 || pm.confirm_by_height !== pm.quote_tip_height + 144) return "schema_payment";
  if (!Array.isArray(pm.outpoints) || pm.outpoints.length < 1 || pm.outpoints.length > 20) return "schema_payment"; // = the node verifier cap (BTC_MAX_OUTPOINTS)
  let prev = "", sum = 0;
  for (const o of pm.outpoints) {
    if (!exact(o, ["txid", "value_sat", "vout"])) return "schema_payment";
    if (typeof o.txid !== "string" || !BTC_TXID_RE.test(o.txid)) return "schema_payment"; // J4, J5
    if (!isInt(o.vout) || o.vout < 0 || o.vout > 0xffff || !isInt(o.value_sat) || o.value_sat < 1) return "schema_payment";
    const k = o.txid + ":" + String(o.vout).padStart(5, "0");
    if (k <= prev) return "schema_payment"; // strictly ascending (txid, vout): one encoding, no duplicates
    prev = k; sum += o.value_sat;
  }
  if (!Number.isSafeInteger(sum) || sum < pm.amount_sat) return "schema_payment";
  if (q.pay_to !== null) return "schema_settlement"; // J10
  if (q.amount_usdc !== null) return "schema_settlement"; // J11
  return null;
}

export type VerifyOpts = {
  keys: Record<string, string>;      // kid -> SPKI PEM (public only)
  expectEnv: "staging" | "mainnet";
  nowSec: number;
  ledger: NonceLedger;
  caps: { maxRigs: number; maxSec: number; hostSuffixes: string[]; ports: Set<number> };
};

/** Reference verifier, mirrored by verify-job-snippet.mjs for the node. Records the nonce only on success.
 *  rev 1.7: a schema failure AFTER a valid signature carries stage:"schema" so the poller can send SIGNED-JOB-SCHEMA-REJECT (J9);
 *  a bad signature never does (J24). */
/** Verifier. caps.maxSec: 1 to 7 days during the pilot, up to 30 later (pilot = PILOT_TERM_SEC, 168 h; the node uses MAX_HOURS 168 while the pilot runs). */
export function verifyJob(job: SignedJob, o: VerifyOpts): { ok: true } | { ok: false; reason: string; stage?: "schema" } {
  if (!exact(job, ["kid", "payload", "sig"]) || typeof job.kid !== "string" || typeof job.sig !== "string") return { ok: false, reason: "malformed" };
  if (!/^[a-z0-9-]{1,32}$/.test(job.kid) || !Object.prototype.hasOwnProperty.call(o.keys, job.kid)) return { ok: false, reason: "unknown_kid" };
  if (!/^[A-Za-z0-9_-]{86}$/.test(job.sig)) return { ok: false, reason: "bad_signature" };
  try {
    const key = crypto.createPublicKey(o.keys[job.kid]);
    if (key.asymmetricKeyType !== "ed25519") return { ok: false, reason: "bad_key_type" };
    const msg = Buffer.from(JOB_DOMAIN + canonicalize(job.payload), "utf8");
    if (!crypto.verify(null, msg, key, Buffer.from(job.sig, "base64url"))) return { ok: false, reason: "bad_signature" };
  } catch { return { ok: false, reason: "bad_signature" }; }
  const bad = schemaOk(job.payload, o.caps);
  if (bad) return { ok: false, reason: bad, stage: "schema" };
  const p = job.payload;
  if (p.env !== o.expectEnv) return { ok: false, reason: "wrong_env" };
  if (p.exp <= o.nowSec) return { ok: false, reason: "expired" };
  if (p.iat > o.nowSec + 60 || p.exp - p.iat > JOB_MAX_TTL_SEC || p.exp <= p.iat) return { ok: false, reason: "bad_window" };
  if (o.ledger.has(p.nonce, p.job_id)) return { ok: false, reason: "replay" };
  const ak = applyKey(p);
  if (ak && o.ledger.has("", "", ak)) return { ok: false, reason: "already_applied" };
  o.ledger.add(p.nonce, p.job_id, ak);
  return { ok: true };
}

export function newNonce(): string { return crypto.randomBytes(16).toString("hex"); }
