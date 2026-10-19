// Shared logic for the weekly featured-vendor rotation.
//
// Used by:
//   - src/components/FeaturedVendor.tsx · the spotlight card on /
//
// (The previously-paired /api/cron/featured-vendor-tweet route was
// deleted May 13, 2026 along with the rest of the X-posting crons —
// the rotation is now visual-only on the page. Module is kept as a
// shared helper in case a future channel wants the same algorithm.)
//
// ISO week + (year × 53) compound index ensures rotation is
// monotonically increasing across year boundaries (week 1 of 2027
// doesn't reset to vendor 0).

import { HOUSE_HANDLE, isStale, type Vendor } from "./vendors";

/** ISO week-of-year (1-53). Boundary is Monday 00:00 UTC. */
export function isoWeek(d: Date): { year: number; week: number } {
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const dayDiff = (target.getTime() - firstThursday.getTime()) / 86_400_000;
  const week =
    1 + Math.round((dayDiff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: target.getUTCFullYear(), week };
}

/**
 * Deterministic featured-vendor pick for a given date.
 *
 * Filters out stale vendors (past STALE_THRESHOLD_DAYS) so a
 * featured pick never points at a dead link. Falls back to the full
 * pool if every vendor is stale (pathological case · shouldn't happen
 * with healthy maintenance).
 *
 * Sorted by `addedAt` for deterministic ordering independent of array
 * input order. The same input on the same date always returns the
 * same vendor.
 */
export function pickFeaturedVendor(
  vendors: Vendor[],
  date: Date,
): Vendor | null {
  // The house listing (Block Shot · our own hashrate rental) is never
  // eligible for this spotlight. It is a legitimate directory entry,
  // but a rotation WE control choosing US as "the featured merchant"
  // is self-dealing, not curation. Filtered before staleness so the
  // pathological all-stale fallback can't smuggle it back in.
  const candidates = vendors.filter((v) => v.handle !== HOUSE_HANDLE);
  const eligible = candidates.filter((v) => !isStale(v.verifiedAt));
  const pool = eligible.length > 0 ? eligible : candidates;
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => a.addedAt - b.addedAt);
  const { year, week } = isoWeek(date);
  const idx = (year * 53 + week) % sorted.length;
  return sorted[idx];
}
