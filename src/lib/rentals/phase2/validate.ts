/** Input validation for write tools (review MH3). Pure, no DNS here; the
 * node re-validates with DNS resolution at switch time. Pool rules: pools.ts
 * (pool_id from the catalog, or custom_url, plus username). */
import { isBlockedTerm } from "../index";
import { RIG_TH, MIN_DAYS, MAX_DAYS, PILOT_CAP_RIGS } from "./pricing";
import { resolvePool, maskRenterAddress, type PoolApproval } from "./pools";

// Legacy suffix/port allowlist. No longer used to accept orders (pools.ts decides, and custom hosts
// pass through to the node's classifier); kept for the reference verifier caps in tests.
export const POOL_HOST_SUFFIXES = [
  "braiins.com", "ocean.xyz", "f2pool.com", "antpool.com", "viabtc.com", "viabtc.io", "luxor.tech",
  "spiderpool.com", "foundryusapool.com", "nicehash.com", "emcd.io", "sbicrypto.com", "secpool.com",
];
export const POOL_PORTS = new Set([25, 443, 700, 1314, 1800, 3333, 3334, 3335, 3336, 3443, 4444, 5555, 8888, 9200]);
export const IDEM_RE = /^[A-Za-z0-9_-]{16,64}$/;

export type Parsed = { th: number; rigCount: number; days: number; host: string; port: number; worker: string; idemKey: string; poolId: string | null; approval: PoolApproval };
/** error: invalid_input, cap_exceeded, or a pool refusal reason (pool_user_*, pool_host_*, pool_port). */
export type VErr = { ok: false; error: string; message: string };
export type CreateInput = { th?: unknown; rigs?: unknown; days: unknown; pool_id?: unknown; custom_url?: unknown; username?: unknown; pool_url?: unknown; worker?: unknown; idempotency_key: unknown };

export function validateCreate(i: CreateInput, maxDays: number = MAX_DAYS): { ok: true; v: Parsed } | VErr {
  const th = i.rigs !== undefined ? Number(i.rigs) * RIG_TH : Number(i.th), days = Number(i.days);
  if (!Number.isInteger(th) || th < RIG_TH || th % RIG_TH !== 0) return { ok: false, error: "invalid_input", message: `th must be a whole multiple of ${RIG_TH} (270 TH minimum).` };
  const rigCount = th / RIG_TH;
  if (rigCount > PILOT_CAP_RIGS) return { ok: false, error: "cap_exceeded", message: `Pilot limit is ${PILOT_CAP_RIGS} rigs (${PILOT_CAP_RIGS * RIG_TH} TH) per order.` };
  if (Number.isInteger(days) && days > maxDays && days <= MAX_DAYS) return { ok: false, error: "cap_exceeded", message: "Rentals run 1 to 7 days during the pilot, up to 30 later." };
  if (!Number.isInteger(days) || days < MIN_DAYS || days > maxDays) return { ok: false, error: "invalid_input", message: `days must be a whole number from ${MIN_DAYS} to ${maxDays} (24 hour minimum).` };
  const pr = resolvePool(i);
  if (!pr.ok) return pr;
  const pool = pr.v, worker = pool.user;
  if (isBlockedTerm(maskRenterAddress(worker)) || isBlockedTerm(pool.host)) return { ok: false, error: "invalid_input", message: "username or pool contains a word we cannot accept. Pick another." };
  const idemKey = String(i.idempotency_key ?? "");
  if (!IDEM_RE.test(idemKey)) return { ok: false, error: "invalid_input", message: "idempotency_key must be 16 to 64 characters of A-Z, a-z, 0-9, dash or underscore." };
  return { ok: true, v: { th, rigCount, days, host: pool.host, port: pool.port, worker, idemKey, poolId: pool.poolId, approval: pool.approval } };
}
