// Single-source-of-truth for /float page data.
//
// Both /api/float (the public read endpoint) and /float/page.tsx
// (the server component) consume this · same KV reads, same fallback,
// no HTTP roundtrip from the page to the API route. Skips the
// VERCEL_URL gotcha that bit other Next.js apps that self-fetched
// their own API routes.

import { cache } from "react";
import { kvList } from "./kv";
import {
  composeFloatSnapshot,
  computeDailyDelta,
  isCohortDataPlausible,
  recomputeFromCohorts,
  syntheticHistory,
  type FloatSnapshot,
} from "./float-snapshot";

const HISTORY_KEY = "float:history";
const HISTORY_FOR_TREND_DAYS = 365;

export type GetFloatDataOpts = {
  /** Max KV rows to load (newest-first). Default 365 for /float chart.
   *  Heartbeat / pulse / status only need 2. */
  days?: number;
  /** Build synthetic genesis→today series. Default true for /float;
   *  false for slim consumers (heartbeat, pulse). */
  synthetic?: boolean;
};

export type FloatData = {
  /** Snapshot anchor timestamp (ISO) · equals current.asOf.
   *  Used by the Supply Clock embed for drain extrapolation.
   *  NOT wall-clock request time (that would freeze the embed at 0
   *  elapsed after every CDN miss). */
  asOf: string;
  /** When this response was composed (wall clock). Optional diagnostics. */
  composedAt: string;
  current: FloatSnapshot;
  yesterday: FloatSnapshot | null;
  dailyDelta: number | null;
  /** KV-sourced daily history · only as deep as the cron has accumulated.
   *  Filtered to drop corrupt snapshots (cohort > total supply etc). */
  history: FloatSnapshot[];
  /** Synthetic monthly history from genesis (2009) to today, computed
   *  from current cohort sizes + known launch dates. ~200 points.
   *  Empty when opts.synthetic === false. */
  syntheticHistory: FloatSnapshot[];
  isFallback: boolean;
};

/** Fallback snapshot when KV is empty or unconfigured. Computed
 *  from a hardcoded recent block height + cohort baselines so the
 *  page renders something credible. The visible "Awaiting first
 *  snapshot" badge tells the user the data isn't fresh.
 *
 *  Adjust quarterly: bump FALLBACK_BLOCK_HEIGHT to current mainnet
 *  height and bump FALLBACK_LAST_REVIEWED to today. Cohort baselines
 *  live in lib/float-snapshot.ts (LOST_BTC_ESTIMATE etc.) · keep
 *  in sync. */
function fallbackSnapshot(): FloatSnapshot {
  const FALLBACK_BLOCK_HEIGHT = 952_000;
  const FALLBACK_LAST_REVIEWED = "2026-05-11T00:00:00.000Z";
  return composeFloatSnapshot({
    blockHeight: FALLBACK_BLOCK_HEIGHT,
    asOf: FALLBACK_LAST_REVIEWED,
    governmentsBtc: 250_000,
    etfsBtc: 1_200_000,
    publicCompaniesBtc: 750_000,
  });
}

/**
 * Read the latest FloatSnapshot + history from KV. Returns a
 * fallback baseline when KV is empty/unconfigured (with isFallback
 * = true so the page can render a freshness badge).
 *
 * Distinct freshness signals on the result:
 *   - isFallback = true · KV has no entries (cron hasn't run yet OR
 *     KV unconfigured). Hardcoded baseline numbers.
 *   - current.partial = true · cron ran but one or more upstream
 *     cohort fetches failed or were withheld (those bars stay null).
 *
 * Page should render distinct UI for each.
 *
 * `asOf` is ALWAYS the snapshot's asOf (not wall clock) so the embed
 * Supply Clock can extrapolate drain between daily snapshots.
 *
 * React.cache: same (days, synthetic) key dedupes within one RSC
 * request. KV is cache:no-store so without this, nested callers
 * double-LRANGE.
 */
async function getFloatDataUncached(
  opts: GetFloatDataOpts = {},
): Promise<FloatData> {
  const days = Math.max(1, Math.min(HISTORY_FOR_TREND_DAYS, opts.days ?? HISTORY_FOR_TREND_DAYS));
  const wantSynthetic = opts.synthetic !== false;

  const rawHistory = await kvList<FloatSnapshot>(HISTORY_KEY, days);

  // Two-stage cleaning of KV history:
  //   1. Drop snapshots with implausible cohort data (upstream parser
  //      failures at bitcointreasuries.net have produced entries with
  //      cohorts in the BILLIONS, well past the 21M total supply ·
  //      these corrupt the chart with floor-line outliers and break
  //      the cylinder fill calc on the live page).
  //   2. Re-derive inPlay + lthOther using CURRENT formula. Old
  //      snapshots (pre-May-2026) lack `lthOther` and used a wider
  //      inPlay; without this pass the trend chart shows a phantom
  //      ~9M single-day "drain" at the cutover. Stored cohort numbers
  //      are preserved as-is · only derived fields are recomputed.
  //
  // ORDER MATTERS (review 2026-06-10): recompute BEFORE the
  // plausibility filter. The old filter-first order dropped every
  // pre-May-2026 record · their missing `lthOther` made the
  // `lthOther >= 0` check false (undefined >= 0) and the cohort sum
  // NaN, so the migration in step 2 never ran on exactly the records
  // it was written for. recomputeFromCohorts derives lthOther from
  // the stored cohorts (pure arithmetic, throw-safe), after which the
  // plausibility check still catches genuinely corrupt entries · the
  // billions-scale cohort values it exists for still blow past
  // TOTAL_BTC_SUPPLY post-recompute.
  const history = rawHistory.map(recomputeFromCohorts).filter(isCohortDataPlausible);

  // history is newest-first (LPUSH order). [0] = today, [1] = yesterday.
  const isFallback = history.length === 0;
  const current: FloatSnapshot = history[0] ?? fallbackSnapshot();
  const yesterday: FloatSnapshot | null = history[1] ?? null;
  const dailyDelta = computeDailyDelta(current, yesterday);

  // Synthetic historical curve from genesis to today, monthly samples.
  // Anchored to today's cohort sizes so the right edge matches the
  // hero number exactly. Used by FloatTrendChart to show inception →
  // today regardless of how much KV history has accumulated.
  const syntheticHistoryPoints = wantSynthetic
    ? syntheticHistory({
        governments: current.cohorts.governments ?? 0,
        etfs: current.cohorts.etfs ?? 0,
        publicCompanies: current.cohorts.publicCompanies ?? 0,
      })
    : [];

  return {
    asOf: current.asOf,
    composedAt: new Date().toISOString(),
    current,
    yesterday,
    dailyDelta,
    history,
    syntheticHistory: syntheticHistoryPoints,
    isFallback,
  };
}

/** Cached full float payload (365d + synthetic) · default for pages/charts. */
export const getFloatData = cache(
  async (opts?: GetFloatDataOpts): Promise<FloatData> => {
    return getFloatDataUncached(opts ?? {});
  },
);

/** Slim path for heartbeat / pulse · 2 KV rows, no synthetic. */
export async function getFloatLatest(): Promise<FloatData> {
  return getFloatData({ days: 2, synthetic: false });
}
