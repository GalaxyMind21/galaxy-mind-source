/**
 * Site-side helpers over the shared pilot limits. The numbers live ONLY in
 * src/lib/rentals/limits.ts (PR #77); this file derives hours and labels.
 */
import { RIG_TH, MAX_RIGS, MIN_DAYS, MAX_DAYS, PILOT_MAX_DAYS, DAYS_COPY, maxDaysNow } from "@/lib/rentals/limits";
export { RIG_TH, MAX_RIGS, MIN_DAYS, MAX_DAYS, PILOT_MAX_DAYS, DAYS_COPY, maxDaysNow };
export const MIN_HOURS = MIN_DAYS * 24;
/** The pilot cap in hours: a fixed bound for client components, which can't read RENTALS_PILOT. */
export const PILOT_MAX_HOURS = PILOT_MAX_DAYS * 24;
/** Today's cap in hours, tied to the pilot flag (RENTALS_PILOT), so quotes and createRental agree. */
export function maxHoursFor(env?: Record<string, string | undefined>): number {
  return maxDaysNow(env) * 24;
}
// No module-level MAX_HOURS: evaluating maxHoursFor() at import time ran pilotOn() inside client bundles, which
// read RENTALS_PILOT there (security audit 2026-10-18, L2). Server code calls maxHoursFor() and passes the result
// to client components as a prop.
/** Chooser presets, whole days, never past MAX_DAYS. */
export const RENTAL_WINDOW_DAYS: readonly number[] = [1, 3, 7, 14, 30].filter((d) => d >= MIN_DAYS && d <= PILOT_MAX_DAYS);
export const RENTAL_TERM_LINE = `${MIN_DAYS}-day minimum, ${DAYS_COPY}, in whole days`;
export function daysLabel(hours: number): string {
  const d = Math.max(MIN_DAYS, Math.round(hours / 24));
  return d === 1 ? "1 day" : `${d} days`;
}
