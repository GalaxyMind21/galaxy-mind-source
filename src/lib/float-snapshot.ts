// FloatSnapshot type + composition logic for the /float page.
// One snapshot per day, written by /api/cron/snapshot-float and
// read by /api/float (and by <BitcoinReservoir> via the page).
//
// HEADLINE DEFINITION (May 14, 2026 · tightened):
// inPlay = mined − lost − governments − ETFs − publicCompanies − lthOther
//
// where `lthOther` represents Long-Term-Holder coins NOT already
// counted in the named cohorts above. Glassnode's LTH metric (~14M
// BTC, coins not moved 155+ days) by construction INCLUDES the
// lost / government / ETF / treasury cohorts (those are all
// definitionally dormant for 155d+). Subtracting LTH wholesale on
// top of those cohorts would double-count, so we back the overlap
// out:
//
//   lthOther = max(0, LTH_BTC_BASELINE − (lost + gov + ETFs + publicCo))
//
// This produces a defensible "supply willing to sell" headline
// (~5-7M BTC) without inviting the "you're double-counting MSTR
// with the LTH cohort" critique that would tank credibility on
// Bitcoin Twitter.
//
// History before 2026-05-14 used a wider headline (mined − lost −
// gov − ETFs − publicCo only). lib/float-data.ts retroactively
// recomputes inPlay for old KV snapshots using the current formula
// so the trend chart reflects current methodology consistently
// rather than showing a 9M phantom drain on the cutover day.
//
// All slow-moving cohorts (lost, LTH baseline, exchange reserves)
// are hardcoded constants here with a `lastReviewed` ISO date.
// The cron pulls the fast-moving cohorts (governments, ETFs,
// public companies) live and composes the snapshot.

import {
  TOTAL_BTC_SUPPLY,
  minedSupplyAt,
  yetToMineAt,
} from "./bitcoin-supply";

// ════════════════════════════════════════════════════════════════
// HARDCODED SLOW-MOVERS (reviewed quarterly · see the README)
// ════════════════════════════════════════════════════════════════

/** Provably lost / dormant >7y. Sourced from Glassnode published
 *  research. Conservative estimate (some sources go as high as 4M). */
export const LOST_BTC_ESTIMATE = 3_000_000;

/** Plausible upper bounds per live cohort (BTC). A reading above the
 *  ceiling is treated as an upstream parse error · the cohort is
 *  clamped to the ceiling AND the snapshot is flagged `partial` so the
 *  degraded banner shows and the alert crons skip. Caught 2026-06-13:
 *  bitcointreasuries.net occasionally parsed ~4.6M into publicCompanies
 *  (real public-company holdings are ~1.0-1.3M), which inflated the
 *  cohort breakdown and, on days the explicit cohorts summed past the
 *  LTH baseline, deflated the headline inPlay. Ceilings are generous
 *  (roughly 2× the realistic max) so they only ever catch gross
 *  parser failures, never normal growth. */
export const COHORT_CEILINGS = {
  governments: 1_800_000,
  etfs: 3_000_000,
  publicCompanies: 2_500_000,
} as const;
export const LOST_BTC_LAST_REVIEWED = "2026-05-11";
export const LOST_BTC_SOURCE = "Glassnode (lth-supply-7y derived)";

/** Long-term holder supply baseline. Glassnode LTH = coins not moved
 *  in 155+ days. As of May 2026, used IN the hero math (the `lthOther`
 *  cohort backs out overlap with lost/gov/ETFs/treasuries before
 *  subtracting). Slow-mover · reviewed quarterly. */
export const LTH_BTC_BASELINE = 14_000_000;
export const LTH_BTC_LAST_REVIEWED = "2026-05-11";
export const LTH_BTC_SOURCE = "Glassnode lth-supply";

/** Exchange reserves baseline. V1 hardcoded · V2 will pursue live source
 *  (CoinGlass /Balance scrape or alternative). Reviewed quarterly. */
export const EXCHANGE_BTC_BASELINE = 2_500_000;
export const EXCHANGE_BTC_LAST_REVIEWED = "2026-05-11";
export const EXCHANGE_BTC_SOURCE = "CoinGlass /Balance";

// ════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════

/** Cohort breakdown of the 21M cap. Sums to TOTAL_BTC_SUPPLY *together
 *  with* `FloatSnapshot.inPlay` (which lives one level up). */
export type FloatCohorts = {
  lost: number;            // hardcoded (LOST_BTC_ESTIMATE)
  /** null = upstream withheld or failed · never coerce to 0 in the public number. */
  governments: number | null;
  etfs: number | null;
  publicCompanies: number | null;
  /** Long-term-holder coins NOT already counted in the cohorts above.
   *  = max(0, LTH_BTC_BASELINE − (lost + gov + ETFs + publicCo))
   *  Subset of total LTH supply that isn't claimed by a more specific
   *  cohort. Prevents double-counting MSTR's coins (which are LTH-
   *  classified) when both the publicCompanies and LTH subtractions
   *  are applied to the inPlay headline. */
  lthOther: number;
  yetToMine: number;       // computed from block height
};

/** A single daily snapshot stored in KV under `float:history`. */
export type FloatSnapshot = {
  /** ISO date (YYYY-MM-DD UTC) the snapshot represents. */
  date: string;
  /** ISO timestamp the snapshot was created. */
  asOf: string;
  /** Block height at snapshot time. */
  blockHeight: number;
  /** 21M (constant, included for self-contained snapshot files). */
  totalSupply: number;
  /** Total BTC mined at blockHeight. */
  minedSupply: number;
  /** Cohort breakdown · sums (with inPlay) to totalSupply. */
  cohorts: FloatCohorts;
  /** The headline number · in-circulation BTC not in any "removed" cohort. */
  inPlay: number;
  /** True if any live cohort fetch failed or was withheld. UI shows
   *  a "partial data" badge. Missing live cohorts stay `null`, not 0. */
  partial: boolean;
};

/** Raw inputs to compose a snapshot. Cron passes these in. `null`
 *  means the upstream fetch failed for that cohort. */
export type FloatRawInputs = {
  blockHeight: number;
  asOf: string;
  governmentsBtc: number | null;
  etfsBtc: number | null;
  publicCompaniesBtc: number | null;
};

// ════════════════════════════════════════════════════════════════
// COMPOSITION
// ════════════════════════════════════════════════════════════════

/**
 * Single source of truth for the "supply willing to sell" formula.
 * Derives the LTH-overlap-adjusted `lthOther` cohort and the resulting
 * `inPlay` headline from the named cohorts + mined supply, so the live
 * (composeFloatSnapshot), retroactive (recomputeFromCohorts), and
 * synthetic-history (syntheticHistoricalSnapshot) paths can never drift
 * apart:
 *
 *   lthOther = max(0, lthBaseline − (lost + gov + ETFs + publicCo))
 *   inPlay   = max(0, minedSupply − (lost + gov + ETFs + publicCo + lthOther))
 *
 * `inPlay` is floored at 0 and is implicitly ≤ minedSupply (the removed
 * terms are all ≥ 0), so you can't lock up coins that don't exist yet.
 * `lthBaseline` is a parameter rather than the constant because the
 * synthetic path ramps it historically; live + recompute pass the
 * present-day LTH_BTC_BASELINE.
 */
function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function deriveInPlay(
  minedSupply: number,
  named: {
    lost: number;
    governments: number | null;
    etfs: number | null;
    publicCompanies: number | null;
  },
  lthBaseline: number,
): { lthOther: number; inPlay: number } {
  const namedSum =
    named.lost + n(named.governments) + n(named.etfs) + n(named.publicCompanies);
  const lthOther = Math.max(0, lthBaseline - namedSum);
  const inPlay = Math.max(0, minedSupply - (namedSum + lthOther));
  return { lthOther, inPlay };
}

/**
 * Compose a FloatSnapshot from raw cron inputs. Missing live cohorts
 * stay null (never 0) and the snapshot is flagged `partial: true`. Hero
 * number is the "supply willing to sell" definition · subtracts
 * lost + gov + ETFs + treasuries + LTH-other (back out overlap).
 */
export function composeFloatSnapshot(inputs: FloatRawInputs): FloatSnapshot {
  const minedSupply = minedSupplyAt(inputs.blockHeight);
  const lost = LOST_BTC_ESTIMATE;
  // Clamp each live cohort to its plausible ceiling. An over-ceiling
  // reading is an upstream parse error, not real data · clamp it and
  // remember so the snapshot can be flagged partial below.
  const clampCohort = (
    raw: number | null,
    ceiling: number,
  ): { value: number | null; clamped: boolean } => {
    if (raw === null) return { value: null, clamped: false };
    if (raw > ceiling) return { value: ceiling, clamped: true };
    return { value: Math.max(0, raw), clamped: false };
  };
  const gov = clampCohort(inputs.governmentsBtc, COHORT_CEILINGS.governments);
  const etf = clampCohort(inputs.etfsBtc, COHORT_CEILINGS.etfs);
  const pubco = clampCohort(inputs.publicCompaniesBtc, COHORT_CEILINGS.publicCompanies);
  const governments = gov.value;
  const etfs = etf.value;
  const publicCompanies = pubco.value;
  const cohortClamped = gov.clamped || etf.clamped || pubco.clamped;

  // Back out the LTH overlap with the named cohorts, then derive the
  // headline · single formula in deriveInPlay(). yetToMine is NOT a
  // "removed" cohort (those coins aren't in anyone's wallet yet, they
  // just don't exist), so it sits in the breakdown but never in the
  // subtraction.
  const { lthOther, inPlay } = deriveInPlay(
    minedSupply,
    { lost, governments, etfs, publicCompanies },
    LTH_BTC_BASELINE,
  );

  const cohorts: FloatCohorts = {
    lost,
    governments,
    etfs,
    publicCompanies,
    lthOther,
    yetToMine: yetToMineAt(inputs.blockHeight),
  };

  // Date in UTC YYYY-MM-DD form. Validate the prefix matches that
  // shape · a malformed `asOf` would write to the wrong KV key
  // forever (KV is the source of truth for the trend chart, so a
  // garbage date corrupts history). Throw early so the cron fails
  // visibly in Vercel logs rather than silently storing bad data.
  const date = inputs.asOf.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(
      `composeFloatSnapshot: asOf must start with YYYY-MM-DD, got ${JSON.stringify(inputs.asOf)}`,
    );
  }

  const partial =
    inputs.governmentsBtc === null ||
    inputs.etfsBtc === null ||
    inputs.publicCompaniesBtc === null ||
    // A clamped cohort means the upstream value was implausible · treat
    // the snapshot as degraded so the banner shows and crons skip.
    cohortClamped;

  return {
    date,
    asOf: inputs.asOf,
    blockHeight: inputs.blockHeight,
    totalSupply: TOTAL_BTC_SUPPLY,
    minedSupply,
    cohorts,
    inPlay,
    partial,
  };
}

/**
 * May a later run replace the row already stored for this UTC day?
 *
 * A complete row stays. Rewriting it would move `asOf` (the supply
 * clock's anchor) and a second LPUSH would make the chart treat today
 * as two days. A partial row is replaced only by a complete one, so a
 * parser fix the same morning can land without waiting for tomorrow
 * and without publishing a clamped stand-in over an honest gap.
 */
export function floatSnapshotImproves(
  stored: FloatSnapshot,
  next: FloatSnapshot,
): boolean {
  return stored.date === next.date && stored.partial === true && next.partial === false;
}

/**
 * Daily delta in inPlay BTC. Negative = float shrank (typical day
 * given the 6× absorption ratio). Positive = float grew (rare, e.g.
 * if ETF outflows + treasury sales exceeded mining + LTH releases).
 *
 * Returns null when there's no prior snapshot to compare against
 * (cron hasn't been running long enough yet).
 */
export function computeDailyDelta(
  today: FloatSnapshot,
  yesterday: FloatSnapshot | null,
): number | null {
  if (!yesterday) return null;
  return today.inPlay - yesterday.inPlay;
}

/**
 * Re-derive `inPlay` and `cohorts.lthOther` for a snapshot using the
 * CURRENT formula + constants. Old KV snapshots written before the
 * May 14, 2026 methodology tightening have the wider inPlay baked in
 * and lack the `lthOther` cohort entirely. Reading them through this
 * function makes the trend chart reflect the current methodology
 * consistently across history rather than showing a phantom 9M
 * single-day drain on the cutover day.
 *
 * Stored cohort numbers (lost, gov, ETFs, publicCo) are preserved
 * as-is · only the derived fields are recomputed. Idempotent · safe
 * to call on snapshots that already have lthOther populated.
 */
export function recomputeFromCohorts(snapshot: FloatSnapshot): FloatSnapshot {
  const { cohorts, minedSupply } = snapshot;
  // Pre-fix KV rows stored withheld live cohorts as 0 + partial:true.
  // A real zero on those cohorts is not a thing we publish; 0 + partial
  // means "we did not have a number."
  const governments = withheldZero(cohorts.governments, snapshot.partial);
  const etfs = withheldZero(cohorts.etfs, snapshot.partial);
  const publicCompanies = withheldZero(cohorts.publicCompanies, snapshot.partial);
  const { lthOther, inPlay } = deriveInPlay(
    minedSupply,
    {
      lost: cohorts.lost,
      governments,
      etfs,
      publicCompanies,
    },
    LTH_BTC_BASELINE,
  );
  return {
    ...snapshot,
    cohorts: { ...cohorts, governments, etfs, publicCompanies, lthOther },
    inPlay,
  };
}

function withheldZero(v: number | null | undefined, partial: boolean): number | null {
  if (v == null) return null;
  if (partial && v === 0) return null;
  return v;
}

/**
 * Heuristic: is a snapshot's stored cohort data internally credible?
 * Returns false if any single cohort exceeds total supply (21M) ·
 * upstream parser failures at bitcointreasuries.net have produced
 * snapshots with billions in a single cohort, which corrupt the
 * trend chart and the cylinder fill calc. Used as a filter on KV
 * reads before we hand history to the UI.
 */
export function isCohortDataPlausible(snapshot: FloatSnapshot): boolean {
  const { cohorts } = snapshot;
  // Audit 2026-05 M-1: individual bounds aren't enough. Each cohort
  // could pass ≤21M yet SUM to an impossible figure (e.g. four
  // cohorts at 10M each → 40M), and the downstream
  // `inPlay = mined − Σcohorts` would just `Math.max(0, …)`-floor to
  // 0 and render "0.00M in play" with NO `partial` flag. The cohorts
  // are subsets of mined supply, so their sum cannot exceed total
  // supply — check that too (and include lthOther, previously
  // omitted from the non-negative checks entirely).
  const governments = n(cohorts.governments);
  const etfs = n(cohorts.etfs);
  const publicCompanies = n(cohorts.publicCompanies);
  const sum =
    cohorts.lost +
    governments +
    etfs +
    publicCompanies +
    cohorts.lthOther;
  return (
    cohorts.lost <= TOTAL_BTC_SUPPLY &&
    governments <= TOTAL_BTC_SUPPLY &&
    etfs <= TOTAL_BTC_SUPPLY &&
    publicCompanies <= TOTAL_BTC_SUPPLY &&
    cohorts.lost >= 0 &&
    governments >= 0 &&
    etfs >= 0 &&
    publicCompanies >= 0 &&
    cohorts.lthOther >= 0 &&
    sum <= TOTAL_BTC_SUPPLY
  );
}

// ════════════════════════════════════════════════════════════════
// SYNTHETIC HISTORICAL BACKFILL
// ════════════════════════════════════════════════════════════════
//
// Reconstructs FloatSnapshots for any historical date from public
// reference points. Used by FloatTrendChart's "ALL" range so the
// curve shows inception → today instead of waiting for the daily
// cron to accumulate years of KV data.
//
// Each cohort is modeled with a "scheduled growth" function:
//
//   - mined supply: exact, derived from block-height-at-date
//     (genesis = 2009-01-03, anchored to known halving timestamps,
//     interpolated linearly between)
//   - lost: linear ramp from 0 (genesis) to LOST_BTC_ESTIMATE (today).
//     Reality is more sigmoid-shaped (lost coins accumulated faster
//     in the lost-keys / Mt.Gox / early-mining-era), but linear is
//     a defensible first-order approximation that doesn't overstate
//     pre-2014 lost supply.
//   - governments: 0 before 2013-10-02 (Silk Road seizure), then
//     linear ramp to today. Pre-Silk-Road the cohort was effectively
//     zero (no sovereign held BTC).
//   - publicCompanies: 0 before 2020-08-11 (MicroStrategy's first
//     buy), then linear ramp to today. The corporate-treasury era
//     unambiguously began with that announcement.
//   - ETFs: 0 before 2024-01-11 (spot ETF approval day), then linear
//     ramp to today. Bright-line cutoff.
//   - lthOther: derived from LTH_BTC_BASELINE − named cohorts at
//     each timestamp (with the same max(0, ...) floor as the live
//     calculation). Held constant at LTH_BTC_BASELINE pre-2014 since
//     LTH didn't really differentiate from "all BTC" in the early
//     era.
//
// All numbers are deterministic given current-day cohort sizes ·
// callers pass in today's snapshot (or compute it) and the function
// returns the historical curve consistent with it. Updating today's
// numbers (e.g. ETF AUM grows) automatically reshapes the historical
// curve in the same call.

const GENESIS_DATE = "2009-01-03";
const SILK_ROAD_SEIZURE = "2013-10-02";
const MSTR_FIRST_BUY = "2020-08-11";
const SPOT_ETF_LAUNCH = "2024-01-11";

/** Days between two YYYY-MM-DD dates (UTC). Negative if a > b. */
function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return ms / 86_400_000;
}

/** Estimate mainnet block height at a given UTC date by linearly
 *  interpolating between known halving anchors. Pre-genesis returns 0. */
function estimateBlockHeightAtDate(date: string): number {
  // Anchor points: genesis + each past halving + a "today" anchor
  // computed from average 10-min blocks since the last halving.
  // Using interpolation rather than pure 144 blocks/day arithmetic
  // makes the estimate closer to historical reality (block times
  // varied · 12 min average pre-2013, ~9.5 min post-2024 halving).
  const anchors: { date: string; height: number }[] = [
    { date: "2009-01-03", height: 0 },
    { date: "2012-11-28", height: 210_000 },
    { date: "2016-07-09", height: 420_000 },
    { date: "2020-05-11", height: 630_000 },
    { date: "2024-04-19", height: 840_000 },
  ];
  // Add a synthetic "now" anchor at the average pace post-last-halving.
  // 144 blocks/day × days since 2024-04-19 added to 840000.
  const nowDate = new Date().toISOString().slice(0, 10);
  const daysSinceLastHalving = daysBetween("2024-04-19", nowDate);
  anchors.push({
    date: nowDate,
    height: 840_000 + Math.floor(daysSinceLastHalving * 144),
  });

  if (date <= anchors[0].date) return 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (date >= a.date && date <= b.date) {
      const span = daysBetween(a.date, b.date);
      const into = daysBetween(a.date, date);
      const t = span > 0 ? into / span : 0;
      return Math.floor(a.height + (b.height - a.height) * t);
    }
  }
  // Future-dated · extrapolate at 144 blocks/day past the last anchor.
  const last = anchors[anchors.length - 1];
  return Math.floor(last.height + daysBetween(last.date, date) * 144);
}

/** Linear-ramp helper: 0 before `start`, currentValue at `today`,
 *  proportional in between, clamped >= 0. */
function rampFromDate(
  date: string,
  start: string,
  today: string,
  currentValue: number,
): number {
  if (date < start) return 0;
  if (date >= today) return currentValue;
  const span = daysBetween(start, today);
  const into = daysBetween(start, date);
  return span > 0 ? (into / span) * currentValue : currentValue;
}

/**
 * Compose a SYNTHETIC historical FloatSnapshot for `date` using
 * today's cohort sizes as the right-edge anchor. Cohorts ramp from
 * their respective launch dates (or genesis for slow-movers) to
 * today's value. This is the "what would the float have looked like
 * historically?" reconstruction · not pulled from KV, computed from
 * known reference points.
 *
 * IMPORTANT: also ramps the LTH baseline historically. Holding it at
 * the present-day 14M constant for all of history would understate
 * inPlay in the early years (the model would claim "14M long-term
 * holders" before genesis, which is nonsensical). Linear ramp from
 * 0 → LTH_BTC_BASELINE matches the rough historical trajectory of
 * coin-age maturing alongside total mined supply.
 */
export function syntheticHistoricalSnapshot(
  date: string,
  todayCohorts: { governments: number; etfs: number; publicCompanies: number },
  todayDate: string = new Date().toISOString().slice(0, 10),
): FloatSnapshot {
  const blockHeight = estimateBlockHeightAtDate(date);
  const minedSupply = minedSupplyAt(blockHeight);
  const yetToMine = TOTAL_BTC_SUPPLY - minedSupply;

  // Slow-mover ramps. Lost ramps from 0 (genesis) to current estimate.
  // Governments ramp from Silk Road seizure (Oct 2013).
  // PublicCompanies ramp from MSTR first buy (Aug 2020).
  // ETFs ramp from spot-ETF approval (Jan 2024).
  const lost = rampFromDate(date, GENESIS_DATE, todayDate, LOST_BTC_ESTIMATE);
  const governments = rampFromDate(
    date,
    SILK_ROAD_SEIZURE,
    todayDate,
    todayCohorts.governments,
  );
  const publicCompanies = rampFromDate(
    date,
    MSTR_FIRST_BUY,
    todayDate,
    todayCohorts.publicCompanies,
  );
  const etfs = rampFromDate(
    date,
    SPOT_ETF_LAUNCH,
    todayDate,
    todayCohorts.etfs,
  );

  // LTH baseline ALSO ramps historically · holding it at 14M constant
  // for early years would say "14M long-term holders existed at
  // genesis," which is mathematically impossible. Linear ramp is a
  // first-order approximation that tracks coin-age maturity alongside
  // total mined supply.
  const lthBaselineAtDate = rampFromDate(
    date,
    GENESIS_DATE,
    todayDate,
    LTH_BTC_BASELINE,
  );
  // Same formula as the live path (deriveInPlay), but with the
  // historically-ramped LTH baseline. The max(0, …) floor matters in
  // the early years when the ramped baseline can exceed coins mined to
  // date · you can't lock up coins that don't exist yet, and inPlay is
  // implicitly ≤ minedSupply because every removed term is ≥ 0.
  const { lthOther, inPlay } = deriveInPlay(
    minedSupply,
    { lost, governments, etfs, publicCompanies },
    lthBaselineAtDate,
  );

  return {
    date,
    asOf: `${date}T00:00:00.000Z`,
    blockHeight,
    totalSupply: TOTAL_BTC_SUPPLY,
    minedSupply,
    cohorts: { lost, governments, etfs, publicCompanies, lthOther, yetToMine },
    inPlay,
    partial: false,
  };
}

/**
 * Generate a synthetic historical curve from genesis to today at
 * monthly granularity (sufficient for a chart with 17 years of x-axis
 * span · ~200 data points). Returns NEWEST-FIRST to match the order
 * convention of KV-driven history elsewhere in the app.
 *
 * The trailing edge always lands exactly on `today` so the most-recent
 * point in the chart matches the page's hero number. Density: monthly
 * samples + the today-anchor gives a smooth visual without paying for
 * 6000+ daily points the user can't perceive at chart resolution.
 */
export function syntheticHistory(
  todayCohorts: { governments: number; etfs: number; publicCompanies: number },
  todayDate: string = new Date().toISOString().slice(0, 10),
): FloatSnapshot[] {
  const points: FloatSnapshot[] = [];
  // Walk monthly from genesis. Use UTC arithmetic to avoid DST drift.
  const start = new Date(`${GENESIS_DATE}T00:00:00Z`);
  const end = new Date(`${todayDate}T00:00:00Z`);
  const cursor = new Date(start);
  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    points.push(syntheticHistoricalSnapshot(dateStr, todayCohorts, todayDate));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  // Always anchor the trailing edge exactly on today so the chart's
  // right-most point matches the page's hero number.
  if (points.length === 0 || points[points.length - 1].date !== todayDate) {
    points.push(syntheticHistoricalSnapshot(todayDate, todayCohorts, todayDate));
  }
  // Newest-first to match KV LPUSH ordering.
  return points.reverse();
}
