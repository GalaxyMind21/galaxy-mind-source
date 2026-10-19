// Freshness tracking for the hand-sourced, dated constants the treasury
// math depends on. These are point-in-time figures pulled from filings
// (the same own-and-date pattern as lib/cebe.ts and lib/treasury-shares.ts)
// and they go STALE: ASST runs a weekly ATM, Metaplanet issues heavily,
// and senior-claims balance sheets refresh quarterly. The only in-pipeline
// alarm is the resolveTreasuryMarketCapM drift guard (a console.warn that
// fires when the live feed overtakes our share-count constant). This
// module is the complementary as-of-age view: a single source both the CI
// check (scripts/check-constant-freshness.ts) and the operator's
// /api/admin/cron-health endpoint read, so a constant quietly aging past
// its refresh cadence becomes visible without reading Vercel logs.

import { SENIOR_CLAIMS } from "./cebe";
import { SHARE_COUNTS } from "./treasury-shares";

export type ConstantFreshness = {
  /** Stable id, e.g. "share-count:ASST" or "senior-claims:MSTR". */
  name: string;
  /** Human label for UI. */
  label: string;
  /** ISO date the figure was sourced. */
  asOf: string;
  /** Whole days between asOf and now. */
  ageDays: number;
  /** Expected refresh cadence in days. */
  cadenceDays: number;
  /** True once ageDays exceeds cadenceDays. */
  stale: boolean;
  /** Citation. */
  source: string;
};

// Refresh cadences. Share counts for the overridden names move fast
// (weekly ATM / heavy issuance); senior-claims balance-sheet items move
// roughly quarterly. Tuned a touch above the real cadence so a normal
// review window does not trip a false "stale".
const SHARE_COUNT_CADENCE_DAYS = 35;
const SENIOR_CLAIMS_CADENCE_DAYS = 100;

function ageInDays(asOf: string, now: Date): number {
  const then = new Date(`${asOf}T00:00:00Z`).getTime();
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

/**
 * Snapshot the freshness of every dated treasury constant. `now` is
 * injected so callers (and tests) control the clock.
 */
export function checkConstantsFreshness(now: Date): ConstantFreshness[] {
  const out: ConstantFreshness[] = [];

  for (const [ticker, sc] of Object.entries(SHARE_COUNTS)) {
    if (!sc) continue; // null = no override (feed used) · nothing to age
    const ageDays = ageInDays(sc.asOf, now);
    out.push({
      name: `share-count:${ticker}`,
      label: `${ticker} share count`,
      asOf: sc.asOf,
      ageDays,
      cadenceDays: SHARE_COUNT_CADENCE_DAYS,
      stale: ageDays > SHARE_COUNT_CADENCE_DAYS,
      source: sc.source,
    });
  }

  for (const [ticker, claims] of Object.entries(SENIOR_CLAIMS)) {
    if (!claims) continue; // null = CEBE pending · nothing to age
    const ageDays = ageInDays(claims.asOf, now);
    out.push({
      name: `senior-claims:${ticker}`,
      label: `${ticker} senior claims`,
      asOf: claims.asOf,
      ageDays,
      cadenceDays: SENIOR_CLAIMS_CADENCE_DAYS,
      stale: ageDays > SENIOR_CLAIMS_CADENCE_DAYS,
      source: claims.source,
    });
  }

  return out;
}
