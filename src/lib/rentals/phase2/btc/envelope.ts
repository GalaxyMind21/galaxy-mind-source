/**
 * gm-btc-v1 envelopes from the node gm-btc-agent (PLAN v3.1 §7). Verified ONLY against the kid -> SPKI map pinned in
 * source (config.ts BTC_ATTEST_KEYS), never an env var and never a key the database hands us. The DB is untrusted:
 * anyone holding the gm_btc password can write rows, but cannot forge an envelope.
 *
 * Wire form (what btc_attach_attestation / btc_report_event / btc_heartbeat store): {"payload": {...}, "sig": "<base64url>"}
 *   message = "gm-btc-v1\n" + canonical(payload)    (same canonicalizer as gm-job-v1, jobs.ts)
 *   sig     = Ed25519 over message, 64 bytes, base64url without padding (86 chars)
 * `type`, `v` and `kid` are inside the signed payload. Unknown or missing keys are rejected (exact keyset per type).
 * Times are unix seconds. nonce = 128-bit lowercase hex.
 */
import crypto from "node:crypto";
import { canonicalize } from "../jobs";

export const BTC_DOMAIN = "gm-btc-v1\n";
export const ENVELOPE_IAT_SKEW_SEC = 300;
export const ENVELOPE_MAX_TTL_SEC = 900;
export const HEARTBEAT_MAX_TTL_SEC = 120;

const COMMON = ["type", "v", "kid", "iat", "exp", "nonce"];
export const ENVELOPE_KEYS = {
  addr: [...COMMON, "order_id", "order_ref", "binding_id", "kind", "index", "address", "amount_sat", "required_confs",
    "floor_btc_per_ph_day", "floor_day", "quote_at", "quote_expires_at", "quote_tip_height", "confirm_by_height", "descriptor_checksum"],
  addr_refused: [...COMMON, "order_id", "order_ref", "binding_id", "reason"],
  paid: [...COMMON, "order_id", "order_ref", "binding_id", "index", "address", "amount_sat", "required_confs",
    "floor_btc_per_ph_day", "floor_day", "quote_at", "quote_tip_height", "confirm_by_height",
    "received_sat", "outpoints", "tip_height", "tip_hash"],
  reorged: [...COMMON, "order_id", "order_ref", "binding_id", "index", "address", "lost_outpoints", "tip_height", "tip_hash"],
  // (e) informational: money to the address seen in the mempool or with fewer than required_confs. Never credited.
  // outpoints[].height = 0 while unconfirmed. seen_sat = sum of outpoints.
  seen: [...COMMON, "order_id", "order_ref", "binding_id", "index", "address", "amount_sat", "seen_sat", "outpoints", "tip_height", "tip_hash"],
  // (e) final shortfall: after confirm_by_height, the confirmed money on time is short of amount_sat. Same outpoint shape as
  // paid (every height 1..confirm_by_height, confirmations >= required_confs). The site refunds it (btc_underpaid + queue).
  underpaid: [...COMMON, "order_id", "order_ref", "binding_id", "index", "address", "amount_sat", "required_confs", "confirm_by_height",
    "received_sat", "outpoints", "tip_height", "tip_hash"],
  heartbeat: [...COMMON, "onchain_ok", "tip_height", "tip_hash", "tip_time", "unused_run", "gap_limit", "gap_stopped",
    "attest_hour", "attest_day", "outstanding", "caps_hit", "burned_hour", "killed", "stop_file", "floor_history_ok", "agent_version"],
} as const;
export type EnvelopeType = keyof typeof ENVELOPE_KEYS;

export type PaidOutpoint = { txid: string; vout: number; value_sat: number; height: number };
type Common = { v: 1; kid: string; iat: number; exp: number; nonce: string };
export type AddrPayload = Common & {
  type: "addr"; order_id: string; order_ref: string; binding_id: string; kind: "initial" | "extension"; index: number; address: string;
  amount_sat: number; required_confs: 1 | 2; floor_btc_per_ph_day: string; floor_day: string; quote_at: number; quote_expires_at: number;
  quote_tip_height: number; confirm_by_height: number; descriptor_checksum: string;
};
export type AddrRefusedPayload = Common & { type: "addr_refused"; order_id: string; order_ref: string; binding_id: string; reason: string };
export type PaidPayload = Common & {
  type: "paid"; order_id: string; order_ref: string; binding_id: string; index: number; address: string; amount_sat: number; required_confs: 1 | 2;
  floor_btc_per_ph_day: string; floor_day: string; quote_at: number; quote_tip_height: number; confirm_by_height: number;
  received_sat: number; outpoints: PaidOutpoint[]; tip_height: number; tip_hash: string;
};
export type ReorgedPayload = Common & {
  type: "reorged"; order_id: string; order_ref: string; binding_id: string; index: number; address: string;
  lost_outpoints: { txid: string; vout: number }[]; tip_height: number; tip_hash: string;
};
export type SeenPayload = Common & {
  type: "seen"; order_id: string; order_ref: string; binding_id: string; index: number; address: string; amount_sat: number;
  seen_sat: number; outpoints: PaidOutpoint[]; tip_height: number; tip_hash: string;
};
export type UnderpaidPayload = Common & {
  type: "underpaid"; order_id: string; order_ref: string; binding_id: string; index: number; address: string; amount_sat: number;
  required_confs: 1 | 2; confirm_by_height: number; received_sat: number; outpoints: PaidOutpoint[]; tip_height: number; tip_hash: string;
};
export type HeartbeatPayload = Common & {
  type: "heartbeat"; onchain_ok: boolean; tip_height: number; tip_hash: string; tip_time: number; unused_run: number; gap_limit: number;
  gap_stopped: boolean; attest_hour: number; attest_day: number; outstanding: number; caps_hit: boolean; burned_hour: number;
  killed: boolean; stop_file: boolean; floor_history_ok: boolean; agent_version: string;
};
export type EnvelopePayload = AddrPayload | AddrRefusedPayload | PaidPayload | ReorgedPayload | SeenPayload | UnderpaidPayload | HeartbeatPayload;
export type Envelope = { payload: EnvelopePayload; sig: string };

const isInt = (x: unknown): x is number => Number.isSafeInteger(x);
const nat = (x: unknown, min = 0) => isInt(x) && x >= min;
const str = (x: unknown, re: RegExp) => typeof x === "string" && re.test(x);
const exact = (o: unknown, keys: readonly string[]) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join() === [...keys].sort().join();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ADDR = /^(bc|tb)1q[02-9ac-hj-np-z]{38}$/;

/**
 * Business cap on outpoints per event = the node verifier's cap (it refuses a job carrying more). A signed event with
 * more than this is never settled: the service routes it to manual_review + btc_outpoint_cap (service.ts).
 */
export const BTC_MAX_OUTPOINTS = 20;
/** Structural ceiling of the envelope parser only (size bound); above it the envelope is malformed (env_outpoints). */
export const ENVELOPE_OUTPOINTS_CEILING = 32;
/** Outpoint list: 1..ENVELOPE_OUTPOINTS_CEILING unique {txid, vout, value_sat, height}, heights >= minHeight. Returns the sum, or null. */
function outpointsSum(list: unknown, minHeight: number): number | null {
  if (!Array.isArray(list) || list.length < 1 || list.length > ENVELOPE_OUTPOINTS_CEILING) return null;
  let sum = 0;
  const seen = new Set<string>();
  for (const o of list as unknown[]) {
    if (!exact(o, ["height", "txid", "value_sat", "vout"])) return null;
    const x = o as PaidOutpoint;
    if (!str(x.txid, HEX64) || !nat(x.vout, 0) || x.vout > 0xffff || !nat(x.value_sat, 1) || !nat(x.height, minHeight)) return null;
    const k = `${x.txid}:${x.vout}`;
    if (seen.has(k)) return null;
    seen.add(k); sum += x.value_sat;
  }
  return Number.isSafeInteger(sum) ? sum : null;
}

/** Shape check per type (field types only; binding and derivation matches are service.ts). */
function shapeOk(p: Record<string, unknown>): string | null {
  const t = p.type as EnvelopeType;
  if (!Object.prototype.hasOwnProperty.call(ENVELOPE_KEYS, t)) return "env_type";
  if (!exact(p, ENVELOPE_KEYS[t])) return "env_keys";
  if (p.v !== 1) return "env_version";
  if (!str(p.kid, /^[a-z0-9-]{1,32}$/)) return "env_kid";
  if (!isInt(p.iat) || !isInt(p.exp)) return "env_times";
  if (!str(p.nonce, /^[0-9a-f]{32}$/)) return "env_nonce";
  if (t !== "heartbeat") {
    if (!str(p.binding_id, UUID) || !str(p.order_id, /^[A-Za-z0-9_-]{1,64}$/) || !str(p.order_ref, /^gm_[A-Za-z0-9_-]{8,20}$/)) return "env_ids";
  }
  if (t === "addr" || t === "paid" || t === "reorged" || t === "seen" || t === "underpaid") {
    if (!nat(p.index, 1)) return "btc_index_reserved"; // N5: index 0 never attested, never displayed
    if (!str(p.address, ADDR)) return "env_address";
  }
  if (t === "addr" || t === "paid") {
    if (!nat(p.amount_sat, 1) || (p.required_confs !== 1 && p.required_confs !== 2)) return "env_amount";
    if (!str(p.floor_btc_per_ph_day, /^0\.[0-9]{8}$/) || !str(p.floor_day, /^\d{4}-\d{2}-\d{2}$/)) return "env_floor";
    if (!isInt(p.quote_at) || !nat(p.quote_tip_height, 1) || !isInt(p.confirm_by_height)) return "env_quote";
  }
  switch (t) {
    case "addr":
      if (p.kind !== "initial" && p.kind !== "extension") return "env_kind";
      if (!isInt(p.quote_expires_at) || !str(p.descriptor_checksum, /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{8}$/)) return "env_quote";
      return null;
    case "addr_refused":
      return str(p.reason, /^[a-z_]{1,40}$/) ? null : "env_reason";
    case "paid": {
      if (!nat(p.received_sat, 0) || !nat(p.tip_height, 1) || !str(p.tip_hash, HEX64)) return "env_paid";
      const sum = outpointsSum(p.outpoints, 1);
      if (sum == null) return "env_outpoints";
      if (sum !== p.received_sat) return "env_paid"; // credit by outputs: received = sum of reported outputs
      return null;
    }
    case "seen": {
      if (!nat(p.amount_sat, 1) || !nat(p.seen_sat, 1) || !nat(p.tip_height, 1) || !str(p.tip_hash, HEX64)) return "env_seen";
      const sum = outpointsSum(p.outpoints, 0);
      if (sum == null) return "env_outpoints";
      return sum === p.seen_sat ? null : "env_seen";
    }
    case "underpaid": {
      if (!nat(p.amount_sat, 1) || (p.required_confs !== 1 && p.required_confs !== 2) || !nat(p.confirm_by_height, 1)) return "env_underpaid";
      if (!nat(p.received_sat, 1) || (p.received_sat as number) >= (p.amount_sat as number)) return "env_underpaid";
      if (!nat(p.tip_height, 1) || (p.tip_height as number) <= (p.confirm_by_height as number) || !str(p.tip_hash, HEX64)) return "env_underpaid";
      const sum = outpointsSum(p.outpoints, 1);
      if (sum == null) return "env_outpoints";
      if (sum !== p.received_sat) return "env_underpaid";
      for (const o of p.outpoints as PaidOutpoint[]) {
        if (o.height > (p.confirm_by_height as number) || (p.tip_height as number) - o.height + 1 < (p.required_confs as number)) return "env_underpaid";
      }
      return null;
    }
    case "reorged": {
      if (!nat(p.tip_height, 1) || !str(p.tip_hash, HEX64)) return "env_reorged";
      if (!Array.isArray(p.lost_outpoints) || p.lost_outpoints.length < 1 || p.lost_outpoints.length > 32) return "env_reorged";
      for (const o of p.lost_outpoints as unknown[]) if (!exact(o, ["txid", "vout"]) || !str((o as { txid: unknown }).txid, HEX64) || !nat((o as { vout: unknown }).vout, 0)) return "env_reorged";
      return null;
    }
    case "heartbeat": {
      for (const k of ["onchain_ok", "gap_stopped", "caps_hit", "killed", "stop_file", "floor_history_ok"]) if (typeof p[k] !== "boolean") return "env_heartbeat";
      for (const k of ["tip_height", "tip_time", "unused_run", "gap_limit", "attest_hour", "attest_day", "outstanding", "burned_hour"]) if (!nat(p[k], 0)) return "env_heartbeat";
      if (!str(p.tip_hash, HEX64) || !str(p.agent_version, /^[A-Za-z0-9._+-]{1,40}$/)) return "env_heartbeat";
      return null;
    }
  }
  return "env_type";
}

export type VerifyEnvelopeOpts = {
  keys: Readonly<Record<string, string>>;
  /** Reference time (unix s) for iat/exp: the DB received_at for events, now for first display. */
  refSec: number;
  /** Re-display (N2): signature, kid and shape only; nonce-unseen and exp are not re-checked. */
  redisplay?: boolean;
  expectType?: EnvelopeType;
};
export type VerifyEnvelopeResult<T extends EnvelopePayload = EnvelopePayload> = { ok: true; payload: T } | { ok: false; reason: string };

export function verifyEnvelope<T extends EnvelopePayload = EnvelopePayload>(raw: unknown, o: VerifyEnvelopeOpts): VerifyEnvelopeResult<T> {
  if (!exact(raw, ["payload", "sig"])) return { ok: false, reason: "env_malformed" };
  const env = raw as { payload: Record<string, unknown>; sig: unknown };
  if (typeof env.sig !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(env.sig)) return { ok: false, reason: "env_bad_signature" };
  const p = env.payload;
  if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, reason: "env_malformed" };
  const kid = p.kid;
  if (typeof kid !== "string" || !Object.prototype.hasOwnProperty.call(o.keys, kid)) return { ok: false, reason: "env_unknown_kid" };
  try {
    const key = crypto.createPublicKey(o.keys[kid]);
    if (key.asymmetricKeyType !== "ed25519") return { ok: false, reason: "env_bad_key_type" };
    const msg = Buffer.from(BTC_DOMAIN + canonicalize(p), "utf8");
    if (!crypto.verify(null, msg, key, Buffer.from(env.sig, "base64url"))) return { ok: false, reason: "env_bad_signature" };
  } catch { return { ok: false, reason: "env_bad_signature" }; }
  const bad = shapeOk(p);
  if (bad) return { ok: false, reason: bad };
  if (o.expectType && p.type !== o.expectType) return { ok: false, reason: "env_type" };
  const iat = p.iat as number, exp = p.exp as number;
  const ttl = p.type === "heartbeat" ? HEARTBEAT_MAX_TTL_SEC : ENVELOPE_MAX_TTL_SEC;
  if (exp <= iat || exp - iat > ttl) return { ok: false, reason: "env_window" };
  if (!o.redisplay) {
    if (Math.abs(o.refSec - iat) > ENVELOPE_IAT_SKEW_SEC) return { ok: false, reason: "env_iat_skew" };
    if (exp <= o.refSec) return { ok: false, reason: "env_expired" };
  }
  return { ok: true, payload: p as unknown as T };
}

/** Test/staging helper: sign a payload the way the agent does. Never used with a production key on the site. */
export function signEnvelope(payload: EnvelopePayload, privateKeyPem: string): Envelope {
  const sig = crypto.sign(null, Buffer.from(BTC_DOMAIN + canonicalize(payload), "utf8"), crypto.createPrivateKey(privateKeyPem)).toString("base64url");
  return { payload, sig };
}

/** Masked address for alerts and logs (PLAN §6.9): bc1q…last4. Never the full address in ntfy. */
export const maskAddress = (a: string) => (a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : "…");
