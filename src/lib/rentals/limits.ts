// Shared pilot rental limits (QA 2026-10-16). One source for the MCP tools,
// the direct quote (direct.ts directQuote), PR #73 (/hashrate) and PR #76
// (Phase 2 jobs). Change the pilot here and nowhere else.

/** S21 XP whole-rig size in TH. */
export const RIG_TH = 270;
/** Pilot cap: at most 4 rigs per rental (about 1.08 PH). */
export const MAX_RIGS = 4;
export const MIN_RIGS = 1;
/** Rental length in whole days: 1 to 30, default 1 (24 h minimum, 30-day max). */
export const MIN_DAYS = 1;
export const MAX_DAYS = 30;
export const DEFAULT_DAYS = 1;
/** Pilot cap (on now): quotes and rentals run 1 to 7 days. MAX_DAYS (30) is the later ceiling. */
export const PILOT_MAX_DAYS = 7;
export const DAYS_COPY = "1 to 7 days during the pilot, up to 30 later";
/** Pilot mode, default ON (off only with RENTALS_PILOT=0). flag.ts pilotEnabled() delegates here, so every
 *  quote path and createRental read one rule. Server env; in the browser it reads as pilot on. */
export function pilotOn(env: Record<string, string | undefined> = typeof process !== "undefined" && process.env ? process.env : {}): boolean {
  return env.RENTALS_PILOT !== "0";
}
/** Today's day cap: PILOT_MAX_DAYS while the pilot is on, MAX_DAYS after. Quote and create both use it. */
export function maxDaysNow(env?: Record<string, string | undefined>): number {
  return pilotOn(env) ? PILOT_MAX_DAYS : MAX_DAYS;
}
/** Max PH accepted on input: exactly MAX_RIGS whole rigs. */
export const MAX_PH = (MAX_RIGS * RIG_TH) / 1000;
/** A pricing_daily row older than this fails closed. */
export const PRICING_MAX_AGE_HOURS = 26;

export const RENTAL_LIMITS = {
  rigTh: RIG_TH, minRigs: MIN_RIGS, maxRigs: MAX_RIGS, maxPh: MAX_PH,
  minDays: MIN_DAYS, maxDays: PILOT_MAX_DAYS, laterMaxDays: MAX_DAYS, defaultDays: DEFAULT_DAYS,
} as const;
