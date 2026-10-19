/**
 * rentals · shared rental core (availability, quote, status) used by every
 * front end (MCP today, the Discord rental bot next). No transport code.
 *
 * Customer-safe by construction: every output is built from an explicit
 * allow-list of fields. Nothing here returns a listing id, listing name,
 * marketplace name, site, location, IP, pool credential or customer
 * name. Fleet state is read from our own rigs on the hashrate desk
 * (desk.ourRigs) and reduced to rig-type counts.
 *
 * No payments and no order-taking here. A quote is informational; the sale
 * closes through closeTheSale, which points bots at the create_rental MCP
 * tool (phase2) or says rentals are paused when the kill switch is on.
 */
import crypto from "node:crypto";
import type { HashrateDesk } from "@/lib/hashrate";
import { RENTAL_TERMS_URL } from "./phase2/terms";
import { hardwareLabel } from "@/lib/hashrate";
import { RIG_TH, MAX_RIGS, MAX_PH, DAYS_COPY, RENTAL_LIMITS } from "./limits";
import { MARKETPLACE_REGISTER_URL, MARKETPLACE_NAME } from "@/lib/marketplace-listing";
import { mrrOnly, marketplaceSale } from "./mode";
import { findNeverReveal, activeNeverReveal, neverRevealFromEnv } from "@/lib/never-reveal";
import { RIG_ROSTER, XP_UNIT_IDS_FROM_ENV } from "@/lib/fleet-ids";
export * from "./limits";

/** Quote lifetime. */
export const QUOTE_TTL_SEC = 15 * 60;

/** Rig types offered for direct rental. Home rigs are excluded. */
export const OFFERED_RIG_TYPES: readonly string[] = ["S21 XP"];

/** Smallest rentable unit: one whole S21 XP. Fallback rig size 270 TH. */
export const DEFAULT_RIG_TH = 270;
/** Hard cap per quote; also capped by S21 XPs available right now. */
export const MAX_RIGS_PER_QUOTE = MAX_RIGS;
/** S21 XP rig size from fleet data (largest advertised), else 270 TH. */
export function s21RigTh(desk: Pick<HashrateDesk, "ourRigs">): number {
  const th = desk.ourRigs
    .filter((r) => hardwareLabel(r.id, r.name) === "S21 XP" && r.advertisedPh != null)
    .map((r) => Math.round((r.advertisedPh as number) * 1000));
  return th.length ? Math.max(...th) : DEFAULT_RIG_TH;
}

/* Pricing lives in ONE place (batch B1, 2026-10-17): phase2 getQuote -> priceOrder, reached
 * through ./direct.ts. The old desk-based composeDirectQuote formula was removed so no second price
 * can drift from the binding one. */

/* Blocked-term filter: last net on every customer-facing output.
 * NFKC-normalised, zero-width stripped, Cyrillic homoglyphs folded to
 * Latin, then matched case-insensitively. */
const HOMOGLYPHS: Record<string, string> = {
  // Greek
  "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "γ": "y", "ς": "s", "σ": "o", "μ": "u", "ω": "w",
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
  // Cyrillic
  "а": "a", "в": "b", "е": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ԛ": "q", "ԝ": "w",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X", "І": "I", "Ј": "J", "Ѕ": "S",
};
export function normalizeForFilter(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // combining marks (accents, overlays)
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD\u034F\u180E]/g, "")
    .replace(/[\u0370-\u03FF\u0400-\u04FF\u0500-\u052F]/g, (c) => HOMOGLYPHS[c] ?? c);
}
/**
 * Spelled-out patterns. Private words (kept off the repo) are screened separately by the keyed never-reveal list
 * (src/lib/never-reveal.ts, see neverRevealHit below).
 */
export const BLOCKED_OUTPUT: RegExp[] = [
  /mining[\s._-]*rig[\s._-]*rentals/i, /\bm[._-]?r[._-]?r\b/i, /umbrel(?!la)/i,
  /\b(us-?south|us\s+facility)\b/i,
  /\b\d{1,3}(\.\d{1,3}){3}\b/, /(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{0,4}/i, /(?:^|[^0-9a-z:])(?=[0-9a-f:]*\d|::|[0-9a-f:]*::[0-9a-f])(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?(?![0-9a-z:])/i,
  /\b3[78]\d{4}\b/, /\brig[_\s-]?\d{3,}\b/i, /\bbc1[a-z0-9]{8,}/i,
];
/**
 * Our configured listing ids (GALAXY_MIND_RIG_IDS / GALAXY_MIND_XP_UNIT_IDS) are blocked as whole numbers too, whatever
 * their range, so the screen covers the roster from env and not only the spelled-out pattern above.
 */
const FLEET_IDS: readonly string[] = [...new Set([...RIG_ROSTER.ids, ...XP_UNIT_IDS_FROM_ENV])];
export const FLEET_ID_HIT = /fleet-id/;
function fleetIdHit(normalized: string): boolean {
  if (FLEET_IDS.length === 0) return false;
  const nums = normalized.match(/(?<!\d)\d{6}(?!\d)/g);
  return !!nums && nums.some((x) => FLEET_IDS.includes(x));
}
/** Numeric amount fields (sats, atomic USDC). Only these may carry a bare 6-digit number. */
export const AMOUNT_KEYS = new Set(["totalSats", "amountSats", "amountAtomic", "amount_atomic", "totalUsdcAtomic", "expectedAtomic", "cumulativeAtomic", "deltaAtomic"]);
function maskAmounts(v: unknown, key?: string): unknown {
  if (typeof v === "number") return key !== undefined && AMOUNT_KEYS.has(key) ? 0 : v;
  if (Array.isArray(v)) return v.map((x) => maskAmounts(x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, maskAmounts(x, k)]));
  return v;
}
/**
 * MRR-only exemption (2026-10-17, narrow by design): exactly our referral signup URL and the standalone marketplace
 * name are removed before the scan. The name only as a whole word (not inside a hostname or path), so any other
 * marketplace URL, a /rigs/<id> link, another ref code, rig ids, IPs, locations and names all still fail.
 */
const SAFE_EXACT: readonly string[] = [MARKETPLACE_REGISTER_URL];
const SAFE_NAME = new RegExp(`(?<![\\w./-])${MARKETPLACE_NAME}(?![\\w/-]|\\.\\w)`, "g");
export function stripAllowedMarketplace(text: string): string {
  let out = text;
  for (const u of SAFE_EXACT) out = out.split(u).join("");
  return out.replace(SAFE_NAME, "");
}
export function blockedHit(s: string): RegExp | undefined {
  // Walk the parsed value: a number under an allowlisted amount key is masked
  // (a 378000 sat invoice is not a rig id); every other number, key and string is scanned.
  let text = s;
  try { text = JSON.stringify(maskAmounts(JSON.parse(s))); } catch { /* not JSON: scan raw */ }
  const n = normalizeForFilter(stripAllowedMarketplace(text));
  return BLOCKED_OUTPUT.find((re) => re.test(n)) ?? (fleetIdHit(n) ? FLEET_ID_HIT : undefined) ?? (neverRevealHit(n) ? NEVER_REVEAL_HIT : undefined);
}
/** Returned by blockedHit when the never-reveal list matched, or failed closed (the term itself is never echoed). */
export const NEVER_REVEAL_HIT = /never-reveal/;
/**
 * True when the never-reveal list must refuse everything: a deployment (VERCEL_ENV set) in direct mode with
 * NEVER_REVEAL_KEY / NEVER_REVEAL_DIGESTS missing or malformed. Direct-rental output and renter input then never pass,
 * so a missing secret can't let a private word through. mrr_only (the default) renders only the static marketplace
 * copy, which comes from source and is checked by the tests and the repo guard, so it keeps working. Local runs and
 * tests (no VERCEL_ENV) use the spelled-out patterns plus any registered list.
 */
export function neverRevealFailClosed(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.VERCEL_ENV && !mrrOnly(env) && !neverRevealFromEnv(env);
}
/** Keyed never-reveal screen ("output" scope). Expects normalizeForFilter output. */
export function neverRevealHit(normalized: string, env: Record<string, string | undefined> = process.env): boolean {
  if (neverRevealFailClosed(env)) return true;
  return findNeverReveal(normalized, "output", activeNeverReveal(env)) !== null;
}
/** True when a single value trips the spelled-out patterns or the hashed list (pool hosts, worker names). */
export function isBlockedTerm(s: string): boolean {
  const n = normalizeForFilter(s);
  return BLOCKED_OUTPUT.some((re) => re.test(n)) || fleetIdHit(n) || neverRevealHit(n);
}
export function assertCustomerSafe<T>(out: T): T {
  if (blockedHit(JSON.stringify(out))) throw new Error("blocked_output");
  return out;
}

/** Where the sale closes: RENT_URL, then DISCORD_RENT_URL. Null until one is set (https, not a link back to /hashrate). */
export function rentUrl(env: Record<string, string | undefined> = process.env): string | null {
  for (const k of ["RENT_URL", "DISCORD_RENT_URL"]) {
    const u = (env[k] ?? "").trim();
    if (!/^https:\/\/[^\s]+$/.test(u)) continue;
    try {
      const url = new URL(u);
      if (/(^|\.)galaxymind\.space$/.test(url.hostname) && url.pathname.replace(/\/+$/, "") === "/hashrate") continue;
      return u;
    } catch { /* ignore bad url */ }
  }
  return null;
}

/** How a bot finishes a rental. Neutral: true whether rentals are open or paused. */
export const FINISH_HOW = `To rent, call create_rental on the Galaxy Mind MCP with accept_terms=true and terms_version (Rental Terms: ${RENTAL_TERMS_URL}), then pay the x402 payment request in USDC on Base (a human, or an x402-capable agent wallet). Or rent in a browser at https://galaxymind.space/hashrate/rent. If rentals are paused, create_rental says so.`;
/** Rentals open (kill switch off, rentals_enabled on). */
export const FINISH_OPEN = `Rentals are open. To rent, call create_rental on the Galaxy Mind MCP with accept_terms=true and terms_version (Rental Terms: ${RENTAL_TERMS_URL}). It returns an x402 payment request in USDC on Base that a human or an x402-capable agent wallet can pay.`;
/** Rentals paused (kill switch on, rentals_enabled off, or flag unreadable). */
export const FINISH_PAUSED = `Rentals are paused right now, so create_rental is not taking new orders. Availability and quotes still work. Rental Terms: ${RENTAL_TERMS_URL}.`;

/**
 * Where the sale closes. paused: true = kill switch on, false = rentals open,
 * undefined/null = unknown (neutral copy that is true either way).
 */
export type SaleClose = { how: string; url?: string; channel?: string; tool?: string; payment?: string; terms?: string; rentals?: string; note?: string; referral?: string };
export function closeTheSale(env: Record<string, string | undefined> = process.env, paused?: boolean | null): SaleClose {
  // RENTALS_MODE=mrr_only (default): every bot answer points at the marketplace, with the referral disclosed.
  if (mrrOnly(env)) return marketplaceSale();
  const url = rentUrl(env);
  return {
    how: url
      ? "Finish your rental with Galaxy Mind at the url below. You receive an access code to check status."
      : paused === true ? FINISH_PAUSED : paused === false ? FINISH_OPEN : FINISH_HOW,
    ...(url ? { url, channel: "#rent" } : {}),
    ...(url ? {} : { tool: "create_rental", payment: "x402 USDC on Base", terms: RENTAL_TERMS_URL }),
    ...(paused === true || paused === false ? { rentals: paused ? "paused" : "open" } : {}),
    note: "Quote and availability tools take no payment. create_rental returns a payment request and never spends funds. Keep any creatorSecret or access code private; it works like a password.",
  };
}

export const THIRD_PARTY_MARKET_LABEL = "Third-party rental market aggregates. This is not Galaxy Mind's price. For our direct price call get_quote.";

/** Market book for customers: drops floor and suggested (they read as our price) and labels the rest as third-party data. */
export function thirdPartyMarket(book: unknown) {
  if (!book || typeof book !== "object") return null;
  const { floor: _f, suggested: _s, ...rest } = book as Record<string, unknown>;
  void _f; void _s;
  return { ...rest, label: THIRD_PARTY_MARKET_LABEL };
}

export type RigTypeAvailability = {
  rigType: string;
  thPerRig: number | null;
  total: number;
  available: number;
};

/**
 * list_available_rigs (B3): the rentable bays from the direct service's bay board, never the
 * marketplace feed. Bays are numbered 1..n; the fleet size grows with the allowlist (config).
 */
export function listAvailableRigs(board: { bays: { bay: number; state: string }[]; available: number; total: number } | null, asOf: string = new Date().toISOString()) {
  const rigTypes: RigTypeAvailability[] = board && board.total > 0 ? [{ rigType: "S21 XP", thPerRig: RIG_TH, total: board.total, available: board.available }] : [];
  return {
    asOf,
    rigTypes,
    bays: board?.bays ?? [],
    totalAvailable: board?.available ?? 0,
    availableNote: "available = bays you can rent right now through Galaxy Mind directly.",
    dataComplete: board != null,
  };
}

export type QuoteInput = { rigs?: number; days?: number; ph?: number };

/** Clock skew allowed on pricing_daily.written_at; anything later fails closed. */
export const PRICING_MAX_FUTURE_MS = 5 * 60 * 1000;

/** Raw MCP/HTTP input to QuoteInput. Numbers or canonical numeric strings; anything else is a friendly invalid_input. */
export function parseQuoteInput(raw: Record<string, unknown>):
  | { ok: true; input: QuoteInput }
  | { ok: false; error: "invalid_input"; message: string; supported: typeof RENTAL_LIMITS } {
  const input: QuoteInput = {};
  for (const k of ["rigs", "ph", "days"] as const) {
    const v = raw[k];
    if (v === undefined || v === null || v === "") continue;
    // Number() parse (decimal or exponent form, no hex/sign/blank), then isFinite.
    // Range checks (above_maximum etc.) happen later, so 1e9 is "too big", not "not a number".
    const t = typeof v === "string" ? v.trim() : "";
    const n = typeof v === "number" ? v : typeof v === "string" && /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : NaN;
    if (!Number.isFinite(n)) {
      return { ok: false, error: "invalid_input", message: `${k} must be a number. Quotes run 1 to ${MAX_RIGS} rigs (up to ${MAX_PH} PH) for ${DAYS_COPY} (whole days).`, supported: { ...RENTAL_LIMITS } };
    }
    input[k] = n;
  }
  return { ok: true, input };
}

/* ── rental_status: same feed as the Discord /status command ────────── */

/** Public blob origin the Discord bot's /status reads (confirmed 2026-10-16). */
export const DEFAULT_STATUS_FEED_ORIGIN = "https://dec2mdw3kligqvsk.public.blob.vercel-storage.com";

export const ACCESS_CODE_RE = /^[A-Za-z0-9_-]{22,64}$/;

type FeedMiner = {
  label?: string; online?: boolean; ths?: number; goal_ths?: number; avg24_ths?: number;
  uptime24_pct?: number; starts?: string | null; ends?: string | null;
  workers?: Array<{ online?: boolean; ths?: number; best_difficulty?: unknown; last_seen?: string }>;
};

/** Allow-list projection: no pool, wallet, worker name, label or hardware detail. */
export function sanitizeStatus(feed: { miners?: FeedMiner[]; at?: number } | null) {
  const miners = (feed?.miners ?? []).map((m, i) => {
    const lastSeen = (m.workers ?? []).map((w) => w.last_seen).filter(Boolean).sort().pop() ?? null;
    const best = (m.workers ?? []).map((w) => Number(w.best_difficulty)).filter((x) => Number.isFinite(x));
    return {
      miner: i + 1,
      rigType: hardwareLabel("", m.label ?? "") ?? "SHA256 ASIC",
      online: Boolean(m.online),
      hashrateThs: typeof m.ths === "number" ? m.ths : null,
      targetThs: typeof m.goal_ths === "number" ? m.goal_ths : null,
      avg24Ths: typeof m.avg24_ths === "number" ? m.avg24_ths : null,
      uptime24Pct: typeof m.uptime24_pct === "number" ? m.uptime24_pct : null,
      bestDifficulty: best.length ? Math.max(...best) : null,
      lastShare: lastSeen,
      rentalStarts: m.starts ?? null,
      rentalEnds: m.ends ?? null,
    };
  });
  return { found: true, miners };
}

export async function fetchRentalStatus(
  code: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
) {
  if (!ACCESS_CODE_RE.test(code)) return { ok: false as const, error: "invalid_code", message: "That is not a valid access code." };
  const origin = ((env.RENTAL_STATUS_FEED_ORIGIN ?? "").trim() || DEFAULT_STATUS_FEED_ORIGIN).replace(/\/$/, "");
  if (!/^https:\/\//.test(origin)) return { ok: false as const, error: "upstream_unavailable", message: "Status data is not configured on this server yet. Please try again later." };
  const h = crypto.createHash("sha256").update(code).digest("hex");
  const r = await fetchImpl(`${origin}/c/${h}.json?t=${Math.floor(Date.now() / 30000)}`, { cache: "no-store" });
  if (r.status === 404 || r.status === 403) return { ok: false as const, error: "not_found", message: "Not found. Please check your access code." };
  if (!r.ok) return { ok: false as const, error: "upstream_unavailable", message: "Status data is unavailable right now. Please try again shortly." };
  return { ok: true as const, result: sanitizeStatus(await r.json()) };
}
