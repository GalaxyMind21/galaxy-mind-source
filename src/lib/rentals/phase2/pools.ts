/**
 * Renter pool input for create_rental (outside pools, decided 2026-10-16).
 *
 * The renter gives EITHER pool_id (a catalog pool) OR custom_url, plus a
 * username (worker or wallet). There is no password field: the node sends
 * the catalog password, or "x" for a custom pool.
 *
 * Every rule comes from gm-pools.mjs, a byte-identical copy of the node's
 * module, catalog 2026-10-16.3 (sha256 of it and of pools-catalog.json pinned in
 * scripts/test-phase2-rentals.ts), so the site refuses
 * exactly what the node would refuse before any money moves:
 * - custom_url: parseCustomUrl() ("host:port" or "stratum+tcp://host:port").
 * - The pool is "auto" when catalogMatch(host, port) finds it (exact host and a
 *   listed port), and then the username must match that pool's format
 *   (usernameError). Anything else is "manual": the node holds the paid
 *   order for the owner's approval for up to 2 h and refunds on refusal or
 *   timeout. Manual pools only need the job-schema username charset, as on
 *   the node (classifyUpstream).
 * - pool_id signs the catalog "default" endpoint (the first host and port).
 * DNS checks stay on the node (it re-resolves right before switching).
 *
 * Server-only: gm-pools.mjs imports node:net and node:crypto. The browser gets
 * the plain catalogForUi() list instead.
 */
import { POOL_CATALOG, CATALOG_VERSION, poolById, catalogMatch, usernameError, parseCustomUrl, isBtcAddress } from "./gm-pools.mjs";

export { CATALOG_VERSION };

/** Held orders (manual pools) may wait this long after settlement before expired_unapplied. The node refuses at 2 h. */
export const HELD_TIMEOUT_MS = 2 * 3_600_000 + 15 * 60_000;
/**
 * TTL for a held order's route job. The node requires start within ±10 min of
 * now when it applies an approved order, and it can re-claim the same job until
 * exp. Keeping exp under 10 min after start means it never sees a stale start;
 * the sweeper re-signs a fresh one (start = now) after exp.
 */
export const HELD_JOB_TTL_SEC = 8 * 60;

export type PoolApproval = "auto" | "manual";
export type PoolPick = { host: string; port: number; user: string; poolId: string | null; approval: PoolApproval };
export type PoolErr = { ok: false; error: string; message: string };

/** Refusal reasons the node can write as `rejected` results. Every one goes to a pending_owner refund. */
export const POOL_REJECT_REASONS = [
  "external_refused", "external_approval_timeout", "order_conflict",
  "pool_user", "pool_user_btc_address", "pool_user_account_format", "pool_user_worker_format", "pool_user_nicehash_address",
  "pool_dns_private", "pool_dns_nxdomain", "pool_dns_no_ipv4", "pool_dns_empty", "pool_dns_garbage",
  "pool_host_length", "pool_host_charset", "pool_host_ip_literal", "pool_host_no_dot", "pool_host_label", "pool_host_tld", "pool_host_internal",
  "pool_port", "pool_missing",
] as const;

const FORMAT_HELP: Record<string, string> = {
  "account[.worker]": "your pool account name, optionally followed by a dot and a rig name",
  "btc_address[.worker]": "your bitcoin payout address, optionally followed by a dot and a rig name",
  "nicehash_address[.worker]": "your NiceHash mining address (or a bitcoin address), optionally followed by a dot and a rig name",
};

/** Usernames in our own worker namespace ("GalaxyMind.<rig>", any case), refused on every pool. */
export const RESERVED_USER_RE = /^galaxymind\./i;

/**
 * Renter-facing rejection reasons (review #89 S2). The node can write
 * other internal reasons (bay_held, start_failed, ...); those show as
 * "not_provisioned" so no internals reach the renter.
 */
const RENTER_REJECT = new Set<string>(["external_refused", "external_approval_timeout", "order_conflict"]);
export function renterRejectReason(reason: string | null | undefined): string | null {
  if (reason == null) return null;
  if (RENTER_REJECT.has(reason) || /^pool_[a-z_]{1,40}$/.test(reason)) return reason;
  return "not_provisioned";
}

const USER_ERR: Record<string, { error: string; message: string }> = {
  reserved: { error: "pool_user_reserved", message: "That username is reserved. Use your own pool account name or payout address." },
  user_charset: { error: "pool_user", message: "username must be 1 to 64 characters of A-Z, a-z, 0-9, dot, dash or underscore." },
  worker_format: { error: "pool_user_worker_format", message: "Only one rig name is allowed after the dot, 1 to 32 characters of A-Z, a-z, 0-9, dash or underscore." },
  account_format: { error: "pool_user_account_format", message: "This pool needs your pool account name (2 to 40 letters, numbers, dashes or underscores, starting with a letter or number), optionally followed by a dot and a rig name." },
  btc_address: { error: "pool_user_btc_address", message: "This pool pays the username directly, so it must be a valid bitcoin mainnet address (1…, 3…, bc1q… or bc1p…), optionally followed by a dot and a rig name." },
  nicehash_address: { error: "pool_user_nicehash_address", message: "NiceHash needs your NiceHash mining address (NHb…) or a bitcoin address, optionally followed by a dot and a rig name." },
};

const HOST_ERR_MESSAGE = "custom_url must be a public pool hostname with a port, like stratum.example.com:3333 or stratum+tcp://stratum.example.com:3333. IP addresses, local or private names, logins, paths and other schemes are not accepted.";

/** Catalog "default" endpoint for a pool, as {host, port}. */
function defaultEndpoint(p: { endpoints: readonly unknown[] }): { host: string; port: number } {
  const [host, ports] = p.endpoints[0] as readonly [string, readonly number[]];
  return { host, port: ports[0] };
}

/** Is this host:port a manual (held for approval) pool? Same test as the node's classifier. */
export function poolApproval(host: string, port: number): PoolApproval {
  return catalogMatch(host, port) ? "auto" : "manual";
}

/**
 * Resolve and validate the renter's pool. Legacy pool_url/worker are accepted
 * as aliases of custom_url/username and go through exactly the same rules.
 */
export function resolvePool(i: { pool_id?: unknown; custom_url?: unknown; username?: unknown; pool_url?: unknown; worker?: unknown }): { ok: true; v: PoolPick } | PoolErr {
  const has = (x: unknown) => x !== undefined && x !== null && x !== "";
  const customRaw = has(i.custom_url) ? i.custom_url : i.pool_url;
  const userRaw = has(i.username) ? i.username : i.worker;
  if (has(i.custom_url) && has(i.pool_url)) return { ok: false, error: "invalid_input", message: "Give custom_url only (pool_url is its older name)." };
  if (has(i.username) && has(i.worker)) return { ok: false, error: "invalid_input", message: "Give username only (worker is its older name)." };
  if (has(i.pool_id) === has(customRaw)) return { ok: false, error: "invalid_input", message: "Give exactly one of pool_id (a pool from the catalog) or custom_url (host:port of another pool)." };
  if (typeof userRaw !== "string" || !userRaw) return { ok: false, error: "invalid_input", message: "username is required: your pool worker name or wallet address, depending on the pool." };
  const user = userRaw;

  let host: string, port: number, poolId: string | null = null;
  if (has(i.pool_id)) {
    const p = typeof i.pool_id === "string" ? poolById(i.pool_id) : null;
    if (!p) return { ok: false, error: "invalid_input", message: `pool_id must be one of: ${POOL_CATALOG.map((x) => x.id).join(", ")}. For any other pool use custom_url.` };
    ({ host, port } = defaultEndpoint(p));
    poolId = p.id;
  } else {
    if (typeof customRaw !== "string") return { ok: false, error: "invalid_input", message: HOST_ERR_MESSAGE };
    const u = parseCustomUrl(customRaw);
    if ("error" in u) {
      if (u.error === "port_range") return { ok: false, error: "pool_port", message: "The port must be a number from 1 to 65535." };
      if (u.error === "url_format" || u.error === "url_length") return { ok: false, error: "invalid_input", message: HOST_ERR_MESSAGE };
      return { ok: false, error: "pool_" + u.error, message: HOST_ERR_MESSAGE };
    }
    host = u.host; port = u.port;
  }

  // Job-schema charset first (the node's "pool_user"), then the catalog pool's format.
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(user)) return { ok: false, ...USER_ERR.user_charset };
  // Review #89 S1: our own worker namespace. On a catalog host the node treats these as internal workers, so refuse on every pool.
  if (RESERVED_USER_RE.test(user)) return { ok: false, ...USER_ERR.reserved };
  const cat = catalogMatch(host, port);
  if (cat) {
    const ue = usernameError(cat.user_format, user);
    if (ue) return { ok: false, ...(USER_ERR[ue] ?? USER_ERR.user_charset) };
    return { ok: true, v: { host, port, user, poolId: poolId ?? cat.id, approval: "auto" } };
  }
  return { ok: true, v: { host, port, user, poolId: null, approval: "manual" } };
}

/** Renter-facing notes per catalog pool, wording from the spec (review). Shown when that pool is picked. */
export const POOL_NOTES: Readonly<Record<string, string>> = Object.freeze({
  solopool: "SoloPool.com sets the payout mode per BTC address across the whole pool. This rental connects with password 'x', which puts YOUR payout address in 100% solo mode. If you also mine to the same address elsewhere on solopool.com in Solo Split or Prop mode, those workers switch to 100% solo too. Solo mining pays only when a block is found, so most rentals earn nothing. Use a separate address if you want to keep another mode.",
});
export const poolNote = (poolId: string | null | undefined): string | null => (poolId && Object.prototype.hasOwnProperty.call(POOL_NOTES, poolId) ? POOL_NOTES[poolId] : null);

export type UiPool = { id: string; name: string; endpoint: string; usernameFormat: string; usernameHelp: string; note: string | null };
/** Plain catalog list for the browser and docs (no functions, no passwords). */
export function catalogForUi(): UiPool[] {
  return POOL_CATALOG.map((p) => {
    const e = defaultEndpoint(p);
    return { id: p.id, name: p.name, endpoint: `stratum+tcp://${e.host}:${e.port}`, usernameFormat: p.user_format, usernameHelp: FORMAT_HELP[p.user_format] ?? "your pool username", note: poolNote(p.id) };
  });
}
export const CATALOG_POOL_IDS = POOL_CATALOG.map((p) => p.id);

/**
 * The renter's own payout address in a username (btc_address / nicehash formats)
 * would trip the customer-output word filter (it blocks bc1… strings so our own
 * wallet never leaks). Echoing back the address the renter typed is not a leak,
 * so the filter scans the username with a valid address head replaced by a
 * placeholder; the ".worker" part and everything else is still scanned.
 */
export function maskRenterAddress(user: string): string {
  const i = user.indexOf("."), head = i < 0 ? user : user.slice(0, i), rest = i < 0 ? "" : user.slice(i);
  return isBtcAddress(head) || /^NHb[1-9A-HJ-NP-Za-km-z]{20,60}$/.test(head) ? "renter_address" + rest : user;
}

/** Customer copy for a held order. Never names the owner, the site or the facility. */
export const HELD_NOTE = "Waiting for owner approval of your pool (up to 2 hours, refunded if not approved).";
