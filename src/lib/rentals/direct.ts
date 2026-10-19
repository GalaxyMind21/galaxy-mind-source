/**
 * direct.ts · the one direct-rental price and the one status lookup (batch B1/B2, 2026-10-17).
 *
 * Price: getQuote (phase2/service.ts -> priceOrder) is the ONLY price source. The /hashrate hero,
 * bay board, checkout, GET /api/rentals/quote, GET /api/hashrate/quote, MCP get_quote and MCP
 * get_rental_quote all come through here or getQuote directly. No second formula and no fallback:
 * no pricing means "price unavailable" everywhere.
 *
 * Status: rental_status and the site "Check a rental" box read the direct store first (site and MCP
 * access codes), then the legacy status feed (hand-listed customers). One limiter hit per lookup.
 */
import crypto from "node:crypto";
import type { Deps, BayBoard } from "./phase2/service";
import { getQuote, getRentalStatusByCode, bayBoard, maxDaysFor } from "./phase2/service";
import { stagingDeps } from "./phase2/staging";
import { assertCustomerSafe, closeTheSale, fetchRentalStatus, parseQuoteInput, ACCESS_CODE_RE, QUOTE_TTL_SEC } from "./index";
import { RIG_TH, MIN_DAYS, MAX_RIGS, MAX_PH, RENTAL_LIMITS, PILOT_MAX_DAYS, DAYS_COPY, DEFAULT_DAYS } from "./limits";
import { SUPPORT_EMAIL } from "../support";

type Env = Record<string, string | undefined>;
type Fail = { ok: false; error: string; message: string; supported?: Record<string, unknown> };

export const PRICE_UNAVAILABLE = "Price unavailable right now. Please retry shortly.";

/**
 * MCP get_rental_quote and GET /api/hashrate/quote: a thin alias of get_quote. Same body
 * (getQuote), plus quoteId and validUntil. Accepts ph as well as rigs (rounded to whole rigs,
 * stated in `rounded`). Friendly below_minimum / above_maximum errors carry `supported`.
 */
export async function directQuote(
  d: Deps | null,
  raw: Record<string, unknown>,
  opts: { now?: number; env?: Env } = {},
): Promise<{ ok: true; result: Record<string, unknown> } | Fail> {
  const parsed = parseQuoteInput(raw);
  if (!parsed.ok) return parsed;
  if (!d) return { ok: false, error: "pricing_unavailable", message: PRICE_UNAVAILABLE };
  const input = parsed.input;
  const capDays = maxDaysFor(d);
  const termCopy = capDays === PILOT_MAX_DAYS ? DAYS_COPY : `${MIN_DAYS} to ${capDays} days`;
  const supported = { ...RENTAL_LIMITS, maxDays: capDays };
  const days = input.days ?? DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < MIN_DAYS) return { ok: false, error: "below_minimum", message: `Rentals run ${termCopy}, in whole days. Ask for at least ${MIN_DAYS}.`, supported };
  if (days > capDays) return { ok: false, error: "above_maximum", message: `That is ${days} days; rentals run ${termCopy}. Ask for ${capDays} days or fewer.`, supported };
  let rigs = input.rigs ?? 1;
  let rounded: string | null = null;
  if (input.ph != null) {
    if (!(input.ph > 0) || input.ph * 1000 < RIG_TH - 0.5) return { ok: false, error: "below_minimum", message: `${RIG_TH} TH minimum (one whole rig). Ask for ${MAX_PH} PH or less.`, supported };
    if (input.ph * 1000 > MAX_RIGS * RIG_TH + 0.5) return { ok: false, error: "above_maximum", message: `That is ${input.ph} PH; the most one order can take is ${MAX_PH} PH (${MAX_RIGS} S21 XP). Ask for ${MAX_PH} PH or less.`, supported };
    rigs = Math.max(1, Math.round((input.ph * 1000) / RIG_TH));
    const ph = (rigs * RIG_TH) / 1000;
    if (Math.abs(input.ph * 1000 - rigs * RIG_TH) > 0.5) rounded = `Rounded your ${input.ph} PH request to ${rigs} whole rig${rigs > 1 ? "s" : ""} (${ph} PH); quotes are in whole-rig steps of ${RIG_TH} TH.`;
  }
  if (!Number.isInteger(rigs) || rigs < 1) return { ok: false, error: "below_minimum", message: `Ask for at least 1 whole rig (${RIG_TH} TH minimum). Quotes run 1 to ${MAX_RIGS} rigs.`, supported };
  if (rigs > MAX_RIGS) return { ok: false, error: "above_maximum", message: `That is ${rigs} rigs; one order can take up to ${MAX_RIGS} S21 XP (${MAX_PH} PH). Ask for ${MAX_RIGS} rigs or fewer.`, supported };
  const q = await getQuote(d, { rigs, days });
  if (!q.ok) return q.error === "pricing_unavailable" || q.error === "ask_out_of_band"
    ? { ok: false, error: "pricing_unavailable", message: PRICE_UNAVAILABLE }
    : { ok: false, error: q.error, message: q.message, supported };
  const now = opts.now ?? d.now();
  return { ok: true, result: assertCustomerSafe({
    ...q.result,
    ...(rounded ? { rounded } : {}),
    quoteId: "gmq_" + crypto.randomBytes(8).toString("hex"),
    validUntil: new Date(now + QUOTE_TTL_SEC * 1000).toISOString(),
  }) };
}

/** Today's price for 1 rig x 24 h: the hero, the bay board and the sticky bar. Null = price unavailable. */
export type HeadlinePrice = { perRigDayUsdc: string; pricePerPhDayUsdc: string; pricePerPhDayBtc: number };
export async function headlinePrice(d: Deps | null): Promise<HeadlinePrice | null> {
  if (!d) return null;
  try {
    const q = await getQuote(d, { rigs: 1, days: 1 });
    if (!q.ok) return null;
    return { perRigDayUsdc: q.result.totalUsdc, pricePerPhDayUsdc: q.result.pricePerPhDayUsdc, pricePerPhDayBtc: q.result.pricePerPhDayBtc };
  } catch { return null; }
}

/** Everything /hashrate needs about the direct offer. open=false = the tasteful paused state. */
export type RentOffer = { open: boolean; price: HeadlinePrice | null; board: BayBoard | null };
export async function rentOffer(opts: { d?: Deps | null; open: boolean }): Promise<RentOffer> {
  const d = opts.d === undefined ? stagingDeps() : opts.d;
  const closed: RentOffer = { open: false, price: null, board: null };
  if (!d || !opts.open) return closed;
  // RENTALS_KILL / rentals_enabled: one switch closes every surface. A failed read counts as paused.
  let paused = true;
  try { paused = await d.killSwitch(); } catch { paused = true; }
  if (paused) return closed;
  const [price, board] = await Promise.all([
    headlinePrice(d),
    bayBoard(d).catch(() => null),
  ]);
  return { open: true, price, board };
}

/* ── B2: one status lookup ─────────────────────────────────────────── */

export type UnifiedStatus = {
  source: "direct" | "legacy";
  state: string;
  startsAt: string | null;
  endsAt: string | null;
  rigs: number | null;
  deliveredTh: number | null;
  online: boolean | null;
  refundPendingUsdc?: string | null;
  note?: string;
  miners?: unknown[];
};

const NOT_FOUND: Fail = { ok: false, error: "not_found", message: `No rental matches that access code. Need help? ${SUPPORT_EMAIL}` };

/**
 * rental_status(access_code) and the site box. Direct store first; on not_found, the legacy feed.
 * Rate limiting: getRentalStatusByCode charges one slot; the legacy read adds none.
 */
export async function unifiedRentalStatus(
  d: Deps | null,
  accessCode: string,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; result: UnifiedStatus } | Fail> {
  const code = accessCode.trim();
  if (!ACCESS_CODE_RE.test(code)) return { ok: false, error: "invalid_code", message: "That is not a valid access code." };
  if (d) {
    const r = await getRentalStatusByCode(d, code);
    if (r.ok) {
      const x = r.result;
      return { ok: true, result: assertCustomerSafe({
        source: "direct" as const, state: x.status, startsAt: x.startsAt, endsAt: x.endsAt, rigs: x.rigs,
        deliveredTh: x.deliveredTh, online: x.deliveredTh != null ? x.deliveredTh > 0 : null,
        refundPendingUsdc: x.refundPendingUsdc, ...(x.note ? { note: x.note } : {}),
      }) };
    }
    if (r.error !== "not_found") return r; // rate_limited, code_expired: no second source, no second hit
  }
  let legacy;
  try { legacy = await fetchRentalStatus(code, env, fetchImpl); } catch { legacy = null; }
  if (!legacy) return { ok: false, error: "upstream_unavailable", message: "Status is unavailable right now. Please try again shortly." };
  if (!legacy.ok) return legacy.error === "not_found" ? NOT_FOUND : legacy;
  const miners = legacy.result.miners;
  const starts = miners.map((m) => m.rentalStarts).filter(Boolean).sort()[0] ?? null;
  const ends = miners.map((m) => m.rentalEnds).filter(Boolean).sort().pop() ?? null;
  const th = miners.reduce((a, m) => a + (m.hashrateThs ?? 0), 0);
  const online = miners.length ? miners.some((m) => m.online) : null;
  return { ok: true, result: assertCustomerSafe({
    source: "legacy" as const, state: online ? "active" : "offline", startsAt: starts, endsAt: ends, rigs: miners.length || null,
    deliveredTh: miners.length ? Math.round(th) : null, online, miners,
  }) };
}

export { closeTheSale };
