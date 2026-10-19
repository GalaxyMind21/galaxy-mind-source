/**
 * Pricing per Bitbot / DESIGN.md §10 + the USDC rule:
 *   charge_btc = max(ask x 0.985, ceil_sat(floor x 1.03), ceil_sat(MRR_MIN_BTC_PH_DAY))
 *   USDC = ceil_cent(charge_btc x max(Coinbase, Kraken))   // 1.03 only on the floor term
 * Floor term is rounded UP to 1e-8 BTC (1 sat) so toFixed-style round-down can never
 * put a charge below the node minimum (gm-price.mjs).
 * The market ask and floor come from the pricing_daily row (the node's
 * daily manager). Stale (>36 h) or missing row = fail closed.
 * Ask more than 3x the effective floor = fail closed (ask_out_of_band).
 * Field names here are internal; nothing in this file is returned verbatim.
 */
// Shared pilot limits (src/lib/rentals/limits.ts, PR #77). Change them there only.
import { RIG_TH, MIN_DAYS, MAX_DAYS, MAX_RIGS } from "../limits";
export { RIG_TH, MIN_DAYS, MAX_DAYS };
export const MAX_HOURS = MAX_DAYS * 24;      // Node MAX_HOURS 720
export const MAX_TERM_SEC = MAX_HOURS * 3600;
/** Pilot verifier cap: 1 to 7 days during the pilot, up to 30 later (168 h). */
export const PILOT_TERM_SEC = PILOT_MAX_DAYS * 86_400;
export const PILOT_CAP_RIGS = MAX_RIGS;      // 4 rigs, ~1.08 PH
/**
 * The rental_settle SQL fleet cap (`others + cur_rigs > 4`, migrations 20261016190000 and later). Code never sells above it
 * (review #106 N1). Raise this constant ONLY in the same PR as the migration that raises the DB cap.
 */
export const SQL_COMMIT_CAP = 4;
/** Pilot cap while RENTALS_PILOT is on (default): limits.ts PILOT_MAX_DAYS (7). */
export { PILOT_MAX_DAYS } from "../limits";
import { PILOT_MAX_DAYS } from "../limits";
export const DIRECT_DISCOUNT = 0.015;
export const FLOOR_USDC_MARKUP_BPS = 103;    // x1.03 as integer bps/100; only on the floor term
export const ASK_MAX_MULTIPLE = 3;           // ask > 3 x effective floor -> refuse
export const PRICING_MAX_AGE_MS = 36 * 3600 * 1000;

export type DailyPricing = { marketAskBtcPhDay: number; floorBtcPhDay: number; hashpriceSatsThDay: number; writtenAt: number };
export const FLOOR_MARKUP = 1.05;

/**
 * Hard price floor (batch B1, 2026-10-17): the direct price never goes below the
 * marketplace listing minimum. Env MRR_MIN_BTC_PH_DAY (the operator keeps it equal to the
 * listing minimum); unset, malformed or out of range uses the default below, so the clamp is always on.
 * Review #106 N5: accepted range is (0, MAX_MIN_BTC_PH_DAY]; 0.002 is ~3.9x the default, so a typo
 * (an extra digit, sats for BTC) can't multiply the price.
 */
export const DEFAULT_MIN_BTC_PH_DAY = 0.00051644;
export const MAX_MIN_BTC_PH_DAY = 0.002;
export function minBtcPhDay(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.MRR_MIN_BTC_PH_DAY ?? "").trim();
  const n = /^\d*\.?\d+(e-?\d+)?$/i.test(raw) ? Number(raw) : NaN;
  return n > 0 && n <= MAX_MIN_BTC_PH_DAY ? n : DEFAULT_MIN_BTC_PH_DAY;
}
/** The clamp in integer sats, rounded UP so the charge is never a fraction of a sat under it. */
export function minTermSats(min: number): number {
  return Math.ceil(min * 1e8 - 1e-9);
}

/** Effective floor = max(published floor, live hashprice x 1.05). Null = fail closed. */
export function effectiveFloor(p: DailyPricing): number | null {
  if (!(p.floorBtcPhDay > 0) || !(p.hashpriceSatsThDay > 0)) return null;
  const hp = (p.hashpriceSatsThDay * 1000) / 1e8; // sats/TH/day -> BTC/PH/day
  return Math.max(p.floorBtcPhDay, hp * FLOOR_MARKUP);
}

/** BTC -> integer sats, rounded to nearest (inputs are already 8 dp). */
export function btcToSats(btc: number): number {
  return Math.round(btc * 1e8);
}

/**
 * floor x 1.03 in integer sats, rounded UP.
 * Guarantees floorTermSats/1e8 >= floor x 1.03 so the node's floor x Coinbase x 1.03 never undershoots.
 */
export function floorTermSats(floorBtcPhDay: number): number {
  const fs = BigInt(btcToSats(floorBtcPhDay));
  return Number((fs * BigInt(FLOOR_USDC_MARKUP_BPS) + BigInt(99)) / BigInt(100)); // ceil(fs * 1.03)
}

/** ask x 0.985 in integer sats (nearest). */
export function askTermSats(askBtcPhDay: number): number {
  const as = BigInt(btcToSats(askBtcPhDay));
  return Number((as * BigInt(985) + BigInt(500)) / BigInt(1000)); // round(as * 0.985)
}

/** charge_btc sats = max(ask x 0.985, ceil_sat(floor x 1.03), ceil_sat(min)). */
export function chargeSatsPhDay(askBtcPhDay: number, floorBtcPhDay: number, min: number = minBtcPhDay()): number {
  return Math.max(askTermSats(askBtcPhDay), floorTermSats(floorBtcPhDay), minTermSats(min), btcToSats(floorBtcPhDay));
}

export type PriceResult =
  | { ok: true; priceBtcPhDay: number; floorBtcPhDay: number; totalSats: number }
  | { ok: false; error: "pricing_unavailable" | "ask_out_of_band" };

/** The ONE price (B1): every quote, page, REST route and MCP tool goes through here via getQuote. */
export function priceOrder(p: DailyPricing | null, th: number, days: number, now: number, min: number = minBtcPhDay()): PriceResult {
  if (!p || !(p.marketAskBtcPhDay > 0)) return { ok: false, error: "pricing_unavailable" };
  if (now - p.writtenAt > PRICING_MAX_AGE_MS || p.writtenAt > now + 5 * 60_000) return { ok: false, error: "pricing_unavailable" };
  const floorRaw = effectiveFloor(p);
  if (floorRaw == null) return { ok: false, error: "pricing_unavailable" };
  const floor = btcToSats(floorRaw) / 1e8; // signed 8 dp floor (node + charge basis)
  // Sanity: a wild ask (more than 3x the effective floor) fails closed.
  if (p.marketAskBtcPhDay > floor * ASK_MAX_MULTIPLE) return { ok: false, error: "ask_out_of_band" };
  // Integer-sats charge: max(ask x 0.985, ceil_sat(floor x 1.03), ceil_sat(min)). Never below ceil(floor x 1.03) or the listing minimum.
  const chargeSats = chargeSatsPhDay(p.marketAskBtcPhDay, floor, min);
  const price = chargeSats / 1e8;
  const totalSats = Math.ceil(chargeSats * (th / 1000) * days - 1e-9);
  if (!(totalSats > 0)) return { ok: false, error: "pricing_unavailable" };
  return { ok: true, priceBtcPhDay: price, floorBtcPhDay: floor, totalSats };
}

/**
 * Shared USDC formula (paid x402 jobs). Caller passes charge_btc from priceOrder:
 *   charge_btc = max(ask x 0.985, ceil_sat(floor x 1.03), ceil_sat(MRR_MIN_BTC_PH_DAY))
 * Per PH-day USD = ceil to the cent of (charge_btc x BTC/USD); total = that x PH x days.
 * BTC is taken UP to whole sats before the product so float undershoot cannot drop a sat.
 * node: amount > ceil(0.27 x floor x Coinbase x 1.03 x 1e6) x n - n; charge_btc >= ceil_sat(floor x 1.03)
 * and max(CB,Kraken) >= Coinbase keep the charge above that bound.
 */
export function usdcPerPhDayCents(btcPhDay: number, btcUsd: number): bigint {
  if (!(btcPhDay > 0) || !(btcUsd > 0) || !Number.isFinite(btcUsd)) throw new Error("rate_unavailable");
  // Ceil to sats (epsilon so an exact k/1e8 stays k); USD to nearest cent.
  const f = BigInt(Math.ceil(btcPhDay * 1e8 - 1e-9));
  const px = BigInt(Math.round(btcUsd * 100));
  const den = BigInt(100000000);
  return (f * px + den - BigInt(1)) / den; // ceil to cents
}
export function usdcAtomicFor(btcPhDay: number, btcUsd: number, th: number, days: number): number {
  if (!Number.isInteger(th) || !Number.isInteger(days) || th < 1 || days < 1) throw new Error("bad_size");
  // cents x 1e4 atomic/cent x th/1000 PH x days = cents x 10 x th x days (exact integer).
  const atomic = usdcPerPhDayCents(btcPhDay, btcUsd) * BigInt(10) * BigInt(th) * BigInt(days);
  return Number(atomic);
}

/** sats -> USDC atomic units (6 dp), rounded up so we never undercharge. */
export function satsToUsdcAtomic(sats: number, btcUsd: number): number {
  if (!(btcUsd > 0)) throw new Error("rate_unavailable");
  return Math.ceil((sats / 1e8) * btcUsd * 1e6);
}

/** Read-only loader for the live pricing_daily row (RENTALS_SUPABASE_URL, key from pricingReadCreds). Null = fail closed. */
export async function loadPricingDaily(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<DailyPricing | null> {
  // Lazy: pricing-read-key is server-only, and this module also exports constants that tests and other code import.
  const { pricingReadCreds } = await import("./pricing-read-key");
  const creds = pricingReadCreds(env); // narrow reader / server-only key first; anon only until the L4 revoke lands
  if (!creds) return null;
  const { url, key } = creds;
  try {
    const r = await fetchImpl(`${url}/rest/v1/pricing_daily?select=mrr_ask_btc_ph_day,floor_btc_ph_day,hashprice_sats_th_day,written_at&order=day.desc&limit=1`, { headers: { apikey: key, authorization: `Bearer ${key}` }, cache: "no-store" });
    if (!r.ok) return null;
    const row = ((await r.json()) as Record<string, unknown>[])[0];
    if (!row) return null;
    const n = (v: unknown) => (v == null ? NaN : Number(v));
    const out = { marketAskBtcPhDay: n(row.mrr_ask_btc_ph_day), floorBtcPhDay: n(row.floor_btc_ph_day), hashpriceSatsThDay: n(row.hashprice_sats_th_day), writtenAt: Date.parse(String(row.written_at)) };
    if (![out.marketAskBtcPhDay, out.floorBtcPhDay, out.hashpriceSatsThDay, out.writtenAt].every(Number.isFinite)) return null;
    if (out.floorBtcPhDay >= 0.01 || out.marketAskBtcPhDay >= 0.01) return null;
    return out;
  } catch { return null; }
}
