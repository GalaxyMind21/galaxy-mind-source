// ---- Galaxy Mind signed-job verifier (job schema v1, rev 1.8) · paste into direct-rental.mjs ----
// rev 1.8: rail eth_usdc (USDC on Ethereum, direct transfer): x402 payment shape, network eip155:1 (or Sepolia
// eip155:11155111 on staging); an Ethereum network is valid ONLY with eth_usdc, and eth_usdc ONLY with an Ethereum network.
// rev 1.7: rail-first dispatch; rails {x402_usdc (rev 1.6 networks, unit usdc_6dp), btc_onchain (one bip122 id per env)};
// lightning dropped; arrays canonicalize in order; applyKey uses the rail-agnostic payment_id; schema rejects after a
// valid signature carry stage:"schema" (SIGNED-JOB-SCHEMA-REJECT, sent only after the signature verifies).
// No dependencies. Uses direct-rental.mjs constants when pasted there:
//   POOL_HOST_SUFFIXES, POOL_PORTS, MAX_ACTIVE (4), MAX_HOURS.
// Pilot term: 1 to 7 days during the pilot, up to 30 later. Pilot cap = 168 h.
// If MAX_HOURS is not defined where pasted, use:
//   const MAX_HOURS = 168; // 7-day pilot cap (720 = 30 days, later only)
// Keys file: GM_JOB_PUBKEYS -> 0600 JSON {"<kid>": "<SPKI PEM>"} (public keys only).
// Ledger: state/gm-job-ledger.jsonl, 0600, append-only, fsync per write, reloaded on start.
import { createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";

const JOB_DOMAIN = "gm-job-v1\n";
const JOB_MAX_TTL_SEC = 900;
const KEYS = ["action","amount_usdc","bays","end","floor_btc_per_ph_day","pay_to","env","exp","iat","job_id","nonce","order_ref","payment","rig_class","rig_count","start","upstream","v"];

function canonicalize(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") { if (!Number.isSafeInteger(v)) throw new Error("float"); return String(v); }
  if (Array.isArray(v)) return "[" + v.map((x) => canonicalize(x)).join(",") + "]";
  if (typeof v === "object")
    return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonicalize(v[k])).join(",") + "}";
  throw new Error("unsupported");
}
const exact = (o, keys) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join() === [...keys].sort().join();
const int = Number.isSafeInteger;

export class FileLedger {
  constructor(path) {
    this.path = path; this.seen = new Set();
    if (existsSync(path)) for (const l of readFileSync(path, "utf8").split("\n")) { if (!l) continue; try { const j = JSON.parse(l); this.seen.add("n:" + j.nonce); this.seen.add("j:" + j.job); if (j.apply) this.seen.add("a:" + j.apply); } catch {} }
  }
  has(n, j, a) { return this.seen.has("n:" + n) || this.seen.has("j:" + j) || (!!a && this.seen.has("a:" + a)); }
  add(n, j, a) {
    const fd = openSync(this.path, "a", 0o600);
    try { writeSync(fd, JSON.stringify({ at: new Date().toISOString(), nonce: n, job: j, apply: a ?? null }) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    this.seen.add("n:" + n); this.seen.add("j:" + j); if (a) this.seen.add("a:" + a);
  }
}

// rev 1.6: Base + Solana. Same list and shapes as the site (jobs.ts / solana-tx.ts) and the DB checks.
// rev 1.8: + Ethereum (eth_usdc only).
const ETH_NETWORKS = new Set(["eip155:1","eip155:11155111"]);
const X402_NETWORKS = new Set(["eip155:84532","eip155:8453","solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1","solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", ...ETH_NETWORKS]);
const B58 = "[1-9A-HJ-NP-Za-km-z]";
function validTxId(net, tx) {
  if (typeof tx !== "string") return false;
  if (net.startsWith("solana:")) return new RegExp(`^${B58}{64,88}$`).test(tx);
  if (net.startsWith("eip155:")) return /^0x[0-9a-f]{64}$/.test(tx);
  return false;
}
function validPayTo(net, a) {
  if (typeof a !== "string") return false;
  if (net.startsWith("solana:")) return new RegExp(`^${B58}{32,44}$`).test(a);
  if (net.startsWith("eip155:")) return /^0x[0-9a-fA-F]{40}$/.test(a);
  return false;
}

// rev 1.7 BTC: CAIP-2 ids pinned per env (PLAN §18.5). Same values as src/lib/rentals/phase2/btc/networks.ts.
const BTC_NET = { mainnet: "bip122:000000000019d6689c085ae165831e93", staging: "bip122:00000008819873e925422c1ff0f99f7c" };
const BTC_HRP = { "bip122:000000000019d6689c085ae165831e93": "bc", "bip122:00000008819873e925422c1ff0f99f7c": "tb" };
const BTC_KEYS = ["address","amount_sat","binding_id","confirm_by_height","floor_btc_per_ph_day","floor_day","index","network","order_id","outpoints","payment_id","quote_at","quote_expires_at","quote_tip_height","rail","required_confs","unit"];
const X402_KEYS = ["amount_atomic","network","provider_ref","rail","tx_hash","unit"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function btcPaymentSchema(p) {
  if (!exact(p.payment, BTC_KEYS)) return "schema_payment";
  const m = p.payment;
  const want = p.env === "mainnet" ? BTC_NET.mainnet : p.env === "staging" ? BTC_NET.staging : undefined;
  if (!want || m.network !== want) return "schema_payment";
  const hrp = BTC_HRP[m.network];
  if (m.unit !== "sat" || !hrp) return "schema_payment";
  if (typeof m.binding_id !== "string" || !UUID.test(m.binding_id) || m.payment_id !== "btc:" + m.binding_id) return "schema_payment";
  if (typeof m.order_id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(m.order_id)) return "schema_payment";
  if (!int(m.index) || m.index < 1 || m.index > 0x7fffffff) return "schema_payment";
  if (typeof m.address !== "string" || !new RegExp(`^${hrp}1q[02-9ac-hj-np-z]{38}$`).test(m.address)) return "schema_payment";
  if (!int(m.amount_sat) || m.amount_sat < 1) return "schema_payment";
  if (m.required_confs !== (m.amount_sat < 1000000 ? 1 : 2)) return "schema_payment";
  if (typeof m.floor_btc_per_ph_day !== "string" || !/^0\.[0-9]{8}$/.test(m.floor_btc_per_ph_day) || !(Number(m.floor_btc_per_ph_day) > 0)) return "schema_payment";
  if (p.floor_btc_per_ph_day !== m.floor_btc_per_ph_day) return "schema_payment";
  if (typeof m.floor_day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(m.floor_day)) return "schema_payment";
  if (![m.quote_at, m.quote_expires_at, m.quote_tip_height, m.confirm_by_height].every(int)) return "schema_payment";
  if (m.quote_expires_at <= m.quote_at || m.quote_tip_height < 1 || m.confirm_by_height !== m.quote_tip_height + 144) return "schema_payment";
  if (!Array.isArray(m.outpoints) || m.outpoints.length < 1 || m.outpoints.length > 32) return "schema_payment";
  let prev = "", sum = 0;
  for (const o of m.outpoints) {
    if (!exact(o, ["txid","value_sat","vout"])) return "schema_payment";
    if (typeof o.txid !== "string" || !/^[0-9a-f]{64}$/.test(o.txid)) return "schema_payment";
    if (!int(o.vout) || o.vout < 0 || o.vout > 0xffff || !int(o.value_sat) || o.value_sat < 1) return "schema_payment";
    const k = o.txid + ":" + String(o.vout).padStart(5, "0");
    if (k <= prev) return "schema_payment";
    prev = k; sum += o.value_sat;
  }
  if (!Number.isSafeInteger(sum) || sum < m.amount_sat) return "schema_payment";
  if (p.pay_to !== null) return "schema_settlement";
  if (p.amount_usdc !== null) return "schema_settlement";
  return null;
}

export function schemaOk(p, caps) {
  if (!exact(p, KEYS)) return "schema_keys";
  if (p.v !== 1) return "bad_version";
  if (typeof p.job_id !== "string" || !/^[0-9a-f-]{36}$/.test(p.job_id)) return "schema_job_id";
  if (typeof p.order_ref !== "string" || !/^gm_[A-Za-z0-9_-]{8,20}$/.test(p.order_ref)) return "schema_order_ref";
  if (!["route","extend","revert"].includes(p.action)) return "schema_action";
  if (p.rig_class !== "s21xp") return "schema_rig_class";
  if (!int(p.rig_count) || p.rig_count < 1 || p.rig_count > caps.maxRigs) return "cap_rigs";
  if (typeof p.bays !== "string" || !/^\d{1,3}(,\d{1,3}){0,3}$/.test(p.bays)) return "schema_bays";
  { const b = p.bays.split(",").map(Number); if (b.length !== p.rig_count || new Set(b).size !== b.length || b.some((n) => n < 1)) return "schema_bays"; }
  if (p.pay_to !== null && (typeof p.pay_to !== "string" || p.pay_to.length > 64)) return "schema_pay_to"; // shape checked per network below (rev 1.6)
  if (p.amount_usdc !== null && (typeof p.amount_usdc !== "string" || !/^\d{1,9}\.\d{6}$/.test(p.amount_usdc))) return "schema_amount_usdc";
  if (typeof p.floor_btc_per_ph_day !== "string" || !/^0\.\d{1,12}$/.test(p.floor_btc_per_ph_day) || !(Number(p.floor_btc_per_ph_day) > 0)) return "schema_floor";
  if (![p.start, p.end, p.iat, p.exp].every(int)) return "schema_times";
  if (p.action !== "revert" && (p.end - p.start < 86400 || p.end - p.start > caps.maxSec)) return "cap_length";
  if (typeof p.nonce !== "string" || !/^[0-9a-f]{32}$/.test(p.nonce)) return "schema_nonce";
  if (p.action === "revert" ? p.upstream !== null : !exact(p.upstream, ["host","port","user"])) return "schema_upstream";
  if (p.upstream) {
    const { host, port, user } = p.upstream;
    if (typeof host !== "string" || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || /^\d+(\.\d+){3}$/.test(host)) return "pool_host";
    if (!caps.hostSuffixes.some((s) => host === s || host.endsWith("." + s))) return "pool_not_allowlisted";
    if (!int(port) || !caps.ports.has(port)) return "pool_port";
    if (typeof user !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(user)) return "pool_user";
  }
  if (p.action !== "revert") {
    // rev 1.7: rail FIRST, then network; exact keys per rail.
    const rail = p.payment && typeof p.payment === "object" && !Array.isArray(p.payment) ? p.payment.rail : undefined;
    if (rail === "btc_onchain") { const bad = btcPaymentSchema(p); if (bad) return bad; }
    else {
      if (rail !== "x402_usdc" && rail !== "eth_usdc") return "schema_payment"; // lightning dropped
      const m = p.payment;
      if (!exact(m, X402_KEYS)) return "schema_payment";
      if (typeof m.network !== "string" || m.network.length > 64) return "schema_payment";
      if (!X402_NETWORKS.has(m.network)) return "schema_network";
      if ((rail === "eth_usdc") !== ETH_NETWORKS.has(m.network)) return "schema_network"; // rev 1.8 rail/network pairing
      // rev 1.6: tx_hash / pay_to shape follows the network (Base: 0x hex; Solana: base58).
      if (m.tx_hash !== null && !validTxId(m.network, m.tx_hash)) return "schema_tx_hash";
      if (p.pay_to !== null && !validPayTo(m.network, p.pay_to)) return "schema_pay_to";
      if (m.unit !== "usdc_6dp" || typeof m.amount_atomic !== "string" || !/^[1-9][0-9]{0,15}$/.test(m.amount_atomic)
        || typeof m.provider_ref !== "string" || m.provider_ref.length > 80) return "schema_payment";
    }
  } else if (p.payment !== null || p.pay_to !== null) return p.payment !== null ? "schema_payment" : "schema_pay_to";
  if (p.payment && (p.payment.rail === "x402_usdc" || p.payment.rail === "eth_usdc") && (p.pay_to === null || p.amount_usdc === null || Math.round(Number(p.amount_usdc) * 1e6) !== Number(p.payment.amount_atomic) || typeof p.payment.tx_hash !== "string")) return "schema_settlement";
  return null;
}

/** opts: { keys: {kid: pem}, expectEnv: "staging", nowSec, ledger: FileLedger, caps: {maxRigs, maxSec, hostSuffixes, ports} }
 *  Returns {ok:true, job} or {ok:false, reason}. Records nonce+job_id ONLY on success, BEFORE the caller acts. */
/** Rail-agnostic payment id: x402 tx_hash, BTC "btc:<binding_id>". */
export function paymentId(m) {
  if (!m) return null;
  if (m.rail === "btc_onchain") return typeof m.payment_id === "string" && m.payment_id ? m.payment_id : null;
  return typeof m.tx_hash === "string" && m.tx_hash ? m.tx_hash : null;
}
/** Dedupe key: order_ref|action|payment_id for paid route/extend jobs (x402 "0x…"/base58 vs BTC "btc:<uuid>": disjoint). */
export function applyKey(p) { const id = p.action !== "revert" ? paymentId(p.payment) : null; return id ? `${p.order_ref}|${p.action}|${id}` : null; }

export function verifyGmJob(job, o) {
  if (!exact(job, ["kid","payload","sig"]) || typeof job.kid !== "string" || typeof job.sig !== "string") return { ok: false, reason: "malformed" };
  if (!/^[a-z0-9-]{1,32}$/.test(job.kid) || !Object.prototype.hasOwnProperty.call(o.keys, job.kid)) return { ok: false, reason: "unknown_kid" };
  if (!/^[A-Za-z0-9_-]{86}$/.test(job.sig)) return { ok: false, reason: "bad_signature" };
  try {
    const key = createPublicKey(o.keys[job.kid]);
    if (key.asymmetricKeyType !== "ed25519") return { ok: false, reason: "bad_key_type" };   // pin Ed25519
    if (!edVerify(null, Buffer.from(JOB_DOMAIN + canonicalize(job.payload), "utf8"), key, Buffer.from(job.sig, "base64url"))) return { ok: false, reason: "bad_signature" };
  } catch { return { ok: false, reason: "bad_signature" }; }
  const bad = schemaOk(job.payload, o.caps); if (bad) return { ok: false, reason: bad, stage: "schema" }; // signature verified: SIGNED-JOB-SCHEMA-REJECT
  const p = job.payload;
  if (p.env !== o.expectEnv) return { ok: false, reason: "wrong_env" };
  if (p.exp <= o.nowSec) return { ok: false, reason: "expired" };
  if (p.iat > o.nowSec + 60 || p.exp - p.iat > JOB_MAX_TTL_SEC || p.exp <= p.iat) return { ok: false, reason: "bad_window" };
  if (o.ledger.has(p.nonce, p.job_id)) return { ok: false, reason: "replay" };
  // rev 1.5 re-offer: a re-signed job (fresh nonce, same order_ref + tx_hash) is applied at most once.
  const ak = applyKey(p);
  if (ak && o.ledger.has("", "", ak)) return { ok: false, reason: "already_applied" };
  o.ledger.add(p.nonce, p.job_id, ak);
  return { ok: true, job: p };
}
// Suggested wiring in direct-rental.mjs:
//   const keys = JSON.parse(readFileSync(process.env.GM_JOB_PUBKEYS, "utf8"));
//   const ledger = new FileLedger(join(STATE, "gm-job-ledger.jsonl"));
//   const caps = { maxRigs: MAX_ACTIVE, maxSec: MAX_HOURS * 3600, hostSuffixes: POOL_HOST_SUFFIXES, ports: POOL_PORTS };
//   const v = verifyGmJob(row, { keys, expectEnv: "staging", nowSec: Math.floor(Date.now() / 1000), ledger, caps });
//   if (!v.ok) -> insert rental_job_results {result:"rejected", reason:v.reason} + alert; else -> §5 local checks (kill file, re-read, cap with live holds, DNS re-validate, payment re-check)
// ---- end snippet ----
