// gm-pools.mjs — Galaxy Mind renter pool catalog + matcher (2026-10-16, chosen by the operator).
// Shared by rental-poller.mjs and direct-rental.mjs (both import "./gm-pools.mjs"). No I/O except the injected resolver.
//
// Pools on the pinned catalog are AUTO-APPROVED; anything else is held (pending_approval) and sent to the operator for review.
// Catalog match = exact hostname (lower-case, no suffix/wildcard match) + port listed for that host. Usernames must match the
// pool's format (BTC address checksum-checked, or account[.worker] charset). DNS must return >=1 public IPv4 and nothing private
// (any family). Raw IPs, userinfo, schemes other than stratum+tcp, internal TLDs and Tailscale names are refused outright.
// Changing the catalog changes this file's sha256 → security re-review + new installer pin. Bump CATALOG_VERSION on every edit.
import { isIP } from "node:net";
import { createHash } from "node:crypto";

export const CATALOG_VERSION = "2026-10-16.3";

// user_format: "account[.worker]" (pool account / sub-account name) | "btc_address[.worker]" (payout address is the username)
//              | "nicehash_address[.worker]" (NiceHash mining address, or a BTC address).
// pass: the stratum password the node sends (renters never set it). Sources: each pool's own docs and site (2026-10-16).
export const POOL_CATALOG = Object.freeze([
  { id: "braiins", name: "Braiins Pool", user_format: "account[.worker]", pass: "x",
    endpoints: [["stratum.braiins.com", [3333, 443]]] },
  { id: "braiins-solo", name: "Braiins Solo", user_format: "btc_address[.worker]", pass: "x",
    endpoints: [["solo.stratum.braiins.com", [3333, 443, 25]]] },
  { id: "ocean", name: "OCEAN", user_format: "btc_address[.worker]", pass: "x",
    endpoints: [["mine.ocean.xyz", [3334]], ["no-signal.mine.ocean.xyz", [3000]], ["bip110.mine.ocean.xyz", [3110]]] },
  { id: "f2pool", name: "F2Pool", user_format: "account[.worker]", pass: "x",
    endpoints: [["btc.f2pool.com", [1314, 3333, 25]], ["btc-asia.f2pool.com", [1314, 1315, 3333, 25]], ["btc-na.f2pool.com", [1314, 1315, 3333, 25]],
                ["btc-euro.f2pool.com", [1314, 1315, 3333, 25]], ["btc-africa.f2pool.com", [1314, 1315, 3333, 25]], ["btc-latin.f2pool.com", [1314, 1315, 3333, 25]]] },
  { id: "antpool", name: "AntPool", user_format: "account[.worker]", pass: "123",
    endpoints: [["ss.antpool.com", [3333, 443, 25]]] },
  { id: "viabtc", name: "ViaBTC", user_format: "account[.worker]", pass: "123",
    endpoints: [["btc.viabtc.io", [3333, 443]], ["btc.viabtc.cc", [3333, 443]], ["btc.viabtc.top", [3333, 443]], ["btc.powhashing.com", [3333, 443]]] },
  { id: "luxor", name: "Luxor", user_format: "account[.worker]", pass: "123",
    endpoints: [["btc.global.luxor.tech", [700]]] },
  { id: "spiderpool", name: "SpiderPool", user_format: "account[.worker]", pass: "x",
    endpoints: [["btc-us.spiderpool.com", [2309, 3333, 1800, 443]], ["btc-eu.spiderpool.com", [2309, 3333, 1800, 443]], ["btc-as.spiderpool.com", [2309, 3333, 1800, 443]]] },
  { id: "nicehash", name: "NiceHash", user_format: "nicehash_address[.worker]", pass: "x",
    endpoints: [["sha256asicboost.auto.nicehash.com", [9200]]] },
  { id: "parasite", name: "Parasite Pool", user_format: "btc_address[.worker]", pass: "x",
    endpoints: [["parasite.wtf", [42069, 42068]]] },
  { id: "ckpool-solo", name: "Solo CKPool", user_format: "btc_address[.worker]", pass: "x",
    endpoints: [["stratum.ckpool.org", [3333, 4334]], ["solo.ckpool.org", [3333, 4334]], ["uwsolo.ckpool.org", [3333, 4334]], ["uesolo.ckpool.org", [3333, 4334]],
                ["eusolo.ckpool.org", [3333, 4334]], ["sgsolo.ckpool.org", [3333, 4334]], ["ausolo.ckpool.org", [3333, 4334]]] },
  { id: "public-pool", name: "Public Pool", user_format: "btc_address[.worker]", pass: "x",
    endpoints: [["public-pool.io", [3333, 13333]]] },
  // solopool.com (added by the operator 2026-10-16). Password "x" = 100% solo (its documented default; 0-100 selects Solo Split/Prop).
  { id: "solopool", name: "SoloPool.com", user_format: "btc_address[.worker]", pass: "x",
    endpoints: [["stratum.solopool.com", [3333, 4444]], ["la.solopool.com", [3333, 4444]], ["eu.solopool.com", [3333, 4444]], ["east.solopool.com", [3333, 4444]],
                ["asia.solopool.com", [3333, 4444]], ["me.solopool.com", [3333, 4444]], ["sp.solopool.com", [3333, 4444]]] },
].map((p) => Object.freeze({ ...p, endpoints: Object.freeze(p.endpoints.map(([h, ports]) => Object.freeze([h, Object.freeze([...ports])]))) })));

const BY_HOST = new Map(); for (const p of POOL_CATALOG) for (const [h] of p.endpoints) { if (BY_HOST.has(h)) throw new Error("duplicate catalog host " + h); BY_HOST.set(h, p); }
export const CATALOG_PORTS = new Set(POOL_CATALOG.flatMap((p) => p.endpoints.flatMap(([, ports]) => ports)));
export const poolById = (id) => POOL_CATALOG.find((p) => p.id === id) || null;
export const catalogPool = (host) => BY_HOST.get(String(host)) || null;
export function catalogMatch(host, port) { const p = catalogPool(host); if (!p) return null; const ep = p.endpoints.find(([h]) => h === host); return ep[1].includes(port) ? p : null; }
export const isOwnBraiins = (host, user, ownPrefix = "GalaxyMind.") => host === "stratum.braiins.com" && typeof user === "string" && user.startsWith(ownPrefix) && user.length > ownPrefix.length;
export const userSha = (u) => createHash("sha256").update(String(u)).digest("hex");

// ---- Bitcoin mainnet address checks (BIP173 bech32 / BIP350 bech32m / base58check) ---------------------------------------------
const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values) { const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let chk = 1;
  for (const v of values) { const b = chk >>> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= G[i]; } return chk >>> 0; }
function convertBits(data, from, to) { let acc = 0, bits = 0; const out = [], maxv = (1 << to) - 1;
  for (const v of data) { if (v < 0 || v >> from) return null; acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); } }
  if (bits >= from || ((acc << (to - bits)) & maxv)) return null; return out; }
function segwitOk(addr) {
  if (addr.length < 14 || addr.length > 90) return false;
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) return false;       // mixed case is invalid (BIP173)
  const a = addr.toLowerCase(); const pos = a.lastIndexOf("1"); if (pos !== 2 || a.slice(0, 2) !== "bc") return false;   // mainnet only
  const data = []; for (const c of a.slice(pos + 1)) { const d = B32.indexOf(c); if (d < 0) return false; data.push(d); }
  if (data.length < 7) return false;
  const pm = polymod([...[..."bc"].map((c) => c.charCodeAt(0) >> 5), 0, ...[..."bc"].map((c) => c.charCodeAt(0) & 31), ...data]);
  const ver = data[0]; const prog = convertBits(data.slice(1, -6), 5, 8); if (!prog) return false;
  if (ver === 0) return pm === 1 && (prog.length === 20 || prog.length === 32);         // P2WPKH / P2WSH, bech32
  if (ver === 1) return pm === 0x2bc830a3 && prog.length === 32;                         // P2TR, bech32m
  return false;                                                                           // future versions: not accepted for payouts
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Ok(addr) {
  if (addr.length < 26 || addr.length > 35 || !/^[13]/.test(addr)) return false;
  let n = 0n; for (const c of addr) { const d = B58.indexOf(c); if (d < 0) return false; n = n * 58n + BigInt(d); }
  const bytes = []; while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of addr) { if (c !== "1") break; bytes.unshift(0); }
  if (bytes.length !== 25) return false;
  const body = Buffer.from(bytes.slice(0, 21)); const sum = createHash("sha256").update(createHash("sha256").update(body).digest()).digest();
  if (!sum.subarray(0, 4).equals(Buffer.from(bytes.slice(21)))) return false;
  return body[0] === 0x00 || body[0] === 0x05;                                            // P2PKH '1' / P2SH '3' (mainnet)
}
export const isBtcAddress = (a) => typeof a === "string" && (/^(bc1|BC1)/.test(a) ? segwitOk(a) : base58Ok(a));

// ---- Usernames ------------------------------------------------------------------------------------------------------------------
const WORKER_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;
const NH_RE = /^NHb[1-9A-HJ-NP-Za-km-z]{20,60}$/;                                        // NiceHash mining address: charset only (no public checksum spec)
// Returns null when valid, else a short reason. Whole username is also held to the job-schema limit (<=64, [A-Za-z0-9._-]).
export function usernameError(format, user) {
  if (typeof user !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(user)) return "user_charset";
  const i = user.indexOf("."); const head = i < 0 ? user : user.slice(0, i); const worker = i < 0 ? null : user.slice(i + 1);
  if (worker !== null && !WORKER_RE.test(worker)) return "worker_format";                // one optional ".worker", no further dots
  if (format === "account[.worker]") return ACCOUNT_RE.test(head) ? null : "account_format";
  if (format === "btc_address[.worker]") return isBtcAddress(head) ? null : "btc_address";
  if (format === "nicehash_address[.worker]") return NH_RE.test(head) || isBtcAddress(head) ? null : "nicehash_address";
  return "unknown_format";
}

// ---- Hosts / custom URL ---------------------------------------------------------------------------------------------------------
const BLOCKED_SUFFIX = ["localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "private", "arpa", "onion",
  "test", "invalid", "example", "ts.net", "beta.tailscale.net", "home.arpa", "docker", "svc", "cluster.local"];
export function hostError(host) {
  if (typeof host !== "string" || host.length < 4 || host.length > 253) return "host_length";
  if (host !== host.toLowerCase() || !/^[a-z0-9.-]+$/.test(host)) return "host_charset";
  if (isIP(host)) return "host_ip_literal";
  const labels = host.split("."); if (labels.length < 2) return "host_no_dot";
  if (labels.some((l) => !l || l.length > 63 || l.startsWith("-") || l.endsWith("-"))) return "host_label";
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return "host_tld";               // kills 0x7f.1, 2130706433.0 style tricks
  if (BLOCKED_SUFFIX.some((s) => host === s || host.endsWith("." + s))) return "host_internal";
  return null;
}
// custom_url (renter's "other pool" field): "host:port" or "stratum+tcp://host:port". No userinfo, path, query, IPv6, other schemes.
export function parseCustomUrl(s) {
  if (typeof s !== "string" || s.length > 300) return { error: "url_length" };
  const m = /^(?:stratum\+tcp:\/\/)?([A-Za-z0-9.-]+):([0-9]{1,5})$/.exec(s.trim());
  if (!m) return { error: "url_format" };
  const host = m[1].toLowerCase(), port = Number(m[2]);
  const he = hostError(host); if (he) return { error: he };
  if (!(port >= 1 && port <= 65535)) return { error: "port_range" };
  return { host, port };
}

// ---- DNS: >=1 public IPv4 and nothing non-public in ANY family ---------------------------------------------------------------
export function isPublicV4(ip) {
  if (isIP(ip) !== 4) return false; const [a, b, c] = ip.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224);
}
export function isBadV6(ip) {
  const x = String(ip).toLowerCase();
  return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff") || x.startsWith("::ffff:") || x.startsWith("64:ff9b")
    || x.startsWith("2001:db8") || x.startsWith("2001:0:") || x.startsWith("2002:") || x.startsWith("100::");
}
export function dnsError(addrs) {
  if (!Array.isArray(addrs) || !addrs.length) return "dns_empty";
  const v4 = addrs.filter((a) => isIP(a) === 4), v6 = addrs.filter((a) => isIP(a) === 6);
  if (v4.length + v6.length !== addrs.length) return "dns_garbage";
  if (v4.some((a) => !isPublicV4(a)) || v6.some(isBadV6)) return "dns_private";
  if (!v4.length) return "dns_no_ipv4";
  return null;
}

// ---- Classifier: one call per route job, before any action -----------------------------------------------------------------
// resolve(host) → Promise<string[]> (all addresses). Errors with code ENOTFOUND/ENODATA → reject; anything else → defer.
// Returns { route: "internal"|"auto"|"approval"|"reject"|"defer", reason?, pool_id?, pass }
export async function classifyUpstream(u, { resolve, ownPrefix = "GalaxyMind." } = {}) {
  if (!u || typeof u !== "object") return { route: "reject", reason: "pool_missing" };
  const host = u.host, port = u.port, user = u.user;
  const he = hostError(host); if (he) return { route: "reject", reason: "pool_" + he };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { route: "reject", reason: "pool_port" };
  if (typeof user !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(user)) return { route: "reject", reason: "pool_user" };
  const pool = catalogMatch(host, port);
  if (pool) { const ue = usernameError(pool.user_format, user); if (ue) return { route: "reject", reason: "pool_user_" + ue, pool_id: pool.id }; }
  let addrs; try { addrs = await resolve(host); } catch (e) { return ["ENOTFOUND", "ENODATA"].includes(e?.code) ? { route: "reject", reason: "pool_dns_nxdomain" } : { route: "defer", reason: "pool_dns_temp" }; }
  const de = dnsError(addrs); if (de) return { route: "reject", reason: "pool_" + de };
  if (pool && isOwnBraiins(host, user, ownPrefix)) return { route: "internal", pool_id: pool.id, pass: pool.pass };
  if (pool) return { route: "auto", pool_id: pool.id, pass: pool.pass };
  return { route: "approval", reason: catalogPool(host) ? "port_not_listed" : "pool_not_in_catalog", pass: "x" };
}

// ---- Approval inbox names (written by root's gm-rental-approvals relay; content ignored) --------------------------------------
export const APPROVAL_TIMEOUT_MS = 2 * 3600e3;
export function parseApprovalName(n) { const m = /^(approve|refuse)\.([A-Za-z0-9_-]{3,40})\.([0-9a-f]{8})$/.exec(String(n)); return m ? { action: m[1], order: m[2], code: m[3] } : null; }
