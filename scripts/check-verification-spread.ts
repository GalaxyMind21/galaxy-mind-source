#!/usr/bin/env tsx
/**
 * Staleness-cliff guard.
 *
 * On 2026-08-13 a single sweep re-stamped 128 of 129 verifiedAt values to
 * one date, so the whole roster now expires on one day. the README had
 * warned that bulk-bumping "just moves the wall" — nothing enforced it.
 * This does.
 *
 * WARNING-ONLY (exit 0) by design: a cliff is a maintenance signal, not a
 * broken build. What was missing was VISIBILITY on every verify run.
 *
 * Always prints the largest verifiedAt cohort (count, date, % of roster)
 * even when no cliff fires: STALE_THRESHOLD_DAYS can put the wall months
 * out, and a green "no cliff" line would hide that 128 vendors still
 * share one date. Do not bulk-bump verifiedAt to silence it.
 */
import { VENDORS, STALE_THRESHOLD_DAYS } from "../src/lib/vendors";

const DAY = 86_400;
const HORIZON_DAYS = 45;
const CLIFF_FRACTION = 0.25;

const nowSec = Math.floor(Date.now() / 1000);
const byDay = new Map<number, number>();
for (const v of VENDORS) {
  byDay.set(v.verifiedAt, (byDay.get(v.verifiedAt) ?? 0) + 1);
}

const threshold = Math.ceil(VENDORS.length * CLIFF_FRACTION);
// NOTE: no `expiresAt >= nowSec` lower bound here — deliberately. A
// cohort that has ALREADY gone stale is the failure this guard exists to
// catch, not a case to filter out. The old lower bound made the script
// print its green "well-spread" line on exactly the day the cliff hit,
// because the expired cohort no longer matched the window: a guard that
// goes quiet at the moment of failure is worse than no guard. Cliffs
// still further out than HORIZON_DAYS stay excluded (that's the intended
// "nothing urgent yet" case).
const cliffs = [...byDay.entries()]
  .map(([verifiedAt, count]) => ({
    count,
    expiresAt: verifiedAt + STALE_THRESHOLD_DAYS * DAY,
  }))
  .filter(
    (c) =>
      c.count >= threshold &&
      c.expiresAt - nowSec <= HORIZON_DAYS * DAY,
  )
  .sort((a, b) => a.expiresAt - b.expiresAt);

console.log("\n🗓  Verification spread");
if (cliffs.length === 0) {
  console.log(
    `  ✓ no day carries ≥${threshold} of ${VENDORS.length} vendors expiring within ${HORIZON_DAYS} days (past or upcoming).`,
  );
} else {
  for (const c of cliffs) {
    const date = new Date(c.expiresAt * 1000).toISOString().slice(0, 10);
    const days = Math.round((c.expiresAt - nowSec) / DAY);
    if (days < 0) {
      console.log(
        `  ⚠ ${c.count} of ${VENDORS.length} vendors went stale on ${date} (${-days}d ago)`,
      );
    } else {
      console.log(
        `  ⚠ ${c.count} of ${VENDORS.length} vendors go stale on ${date} (in ${days}d)`,
      );
    }
  }
  console.log(
    `  → de-cluster with: npx tsx scripts/reverify-vendors.ts --limit 25`,
  );
}

// Always print the wall, even when it sits past HORIZON_DAYS and the
// cliff check stays green. Tie-break toward the oldest date (the one
// that expires first).
if (VENDORS.length > 0) {
  let largestAt = 0;
  let largestCount = 0;
  for (const [verifiedAt, count] of byDay) {
    if (
      count > largestCount ||
      (count === largestCount && verifiedAt < largestAt)
    ) {
      largestAt = verifiedAt;
      largestCount = count;
    }
  }
  const date = new Date(largestAt * 1000).toISOString().slice(0, 10);
  const pct = ((largestCount / VENDORS.length) * 100).toFixed(1);
  console.log(
    `  largest cohort: ${largestCount} of ${VENDORS.length} vendors share verifiedAt ${date} (${pct}%)`,
  );
}
// WARNING-ONLY by design (see header) — this must exit 0 in every
// branch, expired cohort or not. It's a maintenance signal, never a
// broken build.
process.exit(0);
