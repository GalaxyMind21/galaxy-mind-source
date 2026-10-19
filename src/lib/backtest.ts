import type { HistoryResponse } from "@/app/api/history/route";
import type { Sleeve } from "./recommend";

export type BacktestPoint = {
  date: number; // unix seconds
  portfolio: number; // index normalized to 100 at start
  btc: number;
  ibit: number;
  sp500: number; // synthetic: 100 growing at 7%/yr (S&P long-run avg)
};

export type BacktestResult = {
  series: BacktestPoint[];
  // Fraction of original portfolio weight included in the chart.
  coverage: number;
  // Tickers whose history was missing entirely.
  missingTickers: string[];
  // Tickers that had history but were excluded because their start date
  // would have collapsed the window — listed so the user knows why.
  excludedTickers: { ticker: string; weight: number; startDate: number }[];
  totalReturnPct: number;
  btcReturnPct: number;
  ibitReturnPct: number;
  sp500ReturnPct: number;
  maxDrawdownPct: number;
  startDate: number;
  endDate: number;
};

// S&P 500 long-run nominal annualized return — used as a stable benchmark.
const SP500_ARR = 0.07;

// Default target backtest window: 18 months (~547 days). Caller can
// override via the `targetDays` parameter to support 1y / 3y modes
// from BacktestChart's window selector.
const DEFAULT_TARGET_DAYS = 547;
const MIN_DAYS = 90;
const MAX_EXCLUDED_WEIGHT = 0.25; // never drop more than 25% of allocation

export function backtest(
  allocation: Sleeve[],
  history: HistoryResponse,
  targetDays: number = DEFAULT_TARGET_DAYS,
): BacktestResult | null {
  // Internal alias keeps the existing variable name in the function body
  // so the diff below is minimal.
  const TARGET_DAYS = targetDays;
  const seriesByTicker: Record<string, { t: number; p: number }[]> = {};
  for (const s of history.series) {
    if (s.points && s.points.length >= 30) {
      seriesByTicker[s.ticker] = s.points;
    }
  }

  const missingTickers = allocation
    .filter((s) => !seriesByTicker[s.asset.ticker])
    .map((s) => s.asset.ticker);

  // Candidates: allocation entries that have any history at all.
  const present = allocation.filter((s) => seriesByTicker[s.asset.ticker]);
  if (present.length === 0) return null;

  // Pre-fetch each candidate's first available date so we can decide what
  // to drop. We also need BTC + IBIT history; if either is missing we bail.
  const btcSeries = seriesByTicker.BTC;
  const ibitSeries = seriesByTicker.IBIT;
  if (!btcSeries || !ibitSeries) return null;

  // Sort candidates by start date ASC (oldest first). The asset with the
  // LATEST start is the one that would shrink the window most.
  const candidates = present
    .map((s) => ({
      sleeve: s,
      start: seriesByTicker[s.asset.ticker][0].t,
    }))
    .sort((a, b) => a.start - b.start);

  // Greedy: try including everything; if the window is below TARGET_DAYS,
  // drop the latest-starting asset (provided it's small-weight) and retry.
  let included = candidates.slice();
  const excluded: { ticker: string; weight: number; startDate: number }[] = [];

  // Fixed baseline from BTC + IBIT — these are required and not part
  // of `included`, so dropping portfolio assets won't help if either
  // BTC or IBIT is the constraining series. Without this, the loop
  // would happily strip out portfolio assets one by one without ever
  // shrinking the window, until MAX_EXCLUDED_WEIGHT was hit.
  const baselineMinStart = Math.max(btcSeries[0].t, ibitSeries[0].t);

  while (included.length > 1) {
    const includedMaxStart = Math.max(...included.map((c) => c.start));
    const minStart = Math.max(includedMaxStart, baselineMinStart);
    const maxEnd = Math.min(
      ...included.map(
        (c) =>
          seriesByTicker[c.sleeve.asset.ticker][
            seriesByTicker[c.sleeve.asset.ticker].length - 1
          ].t,
      ),
      btcSeries[btcSeries.length - 1].t,
      ibitSeries[ibitSeries.length - 1].t,
    );
    const windowDays = (maxEnd - minStart) / 86400;
    if (windowDays >= TARGET_DAYS) break;

    // Bail if BTC/IBIT is what's actually constraining the window —
    // dropping portfolio assets can't help and would just misreport
    // them as the cause in `excludedTickers`.
    if (includedMaxStart <= baselineMinStart) break;

    // Identify the latest-start asset
    const worst = included[included.length - 1];
    const totalExcludedWeight =
      excluded.reduce((a, e) => a + e.weight, 0) + worst.sleeve.weight;
    // Don't drop assets that would push exclusion past the cap
    if (totalExcludedWeight > MAX_EXCLUDED_WEIGHT) break;

    excluded.push({
      ticker: worst.sleeve.asset.ticker,
      weight: worst.sleeve.weight,
      startDate: worst.start,
    });
    included = included.slice(0, -1);
  }

  // Compute final window
  const minStart = Math.max(
    ...included.map((c) => c.start),
    btcSeries[0].t,
    ibitSeries[0].t,
  );
  const maxEnd = Math.min(
    ...included.map(
      (c) =>
        seriesByTicker[c.sleeve.asset.ticker][
          seriesByTicker[c.sleeve.asset.ticker].length - 1
        ].t,
    ),
    btcSeries[btcSeries.length - 1].t,
    ibitSeries[ibitSeries.length - 1].t,
  );
  if ((maxEnd - minStart) / 86400 < MIN_DAYS) return null;

  // Build axis from BTC (longest, daily-7-days). Filter to [minStart, maxEnd].
  const axis = btcSeries
    .filter((p) => p.t >= minStart && p.t <= maxEnd)
    .map((p) => p.t);
  if (axis.length < 5) return null;

  const priceAt = (ticker: string, t: number): number | null => {
    const s = seriesByTicker[ticker];
    if (!s) return null;
    let lo = 0,
      hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (s[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return s[lo]?.p ?? null;
  };

  const anchors: Record<string, number> = {};
  for (const c of included) {
    const p = priceAt(c.sleeve.asset.ticker, minStart);
    if (p != null) anchors[c.sleeve.asset.ticker] = p;
  }
  const anchorBTC = priceAt("BTC", minStart);
  const anchorIBIT = priceAt("IBIT", minStart);
  if (anchorBTC == null || anchorIBIT == null) return null;

  const includedWeightSum = included.reduce(
    (a, c) => a + c.sleeve.weight,
    0,
  );

  const points: BacktestPoint[] = [];
  let maxPortfolio = -Infinity;
  let maxDrawdown = 0;

  for (const t of axis) {
    let portfolio = 0;
    for (const c of included) {
      const p = priceAt(c.sleeve.asset.ticker, t);
      const a = anchors[c.sleeve.asset.ticker];
      if (p == null || !a) continue;
      portfolio += c.sleeve.weight * (p / a);
    }
    portfolio = (portfolio / includedWeightSum) * 100;

    const btc = ((priceAt("BTC", t) ?? anchorBTC) / anchorBTC) * 100;
    const ibit = ((priceAt("IBIT", t) ?? anchorIBIT) / anchorIBIT) * 100;
    const yearsSinceStart = (t - minStart) / (365.25 * 86400);
    const sp500 = 100 * Math.pow(1 + SP500_ARR, yearsSinceStart);
    points.push({ date: t, portfolio, btc, ibit, sp500 });

    if (portfolio > maxPortfolio) maxPortfolio = portfolio;
    if (maxPortfolio > 0) {
      const dd = (maxPortfolio - portfolio) / maxPortfolio;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

  if (points.length < 5) return null;
  const last = points[points.length - 1];

  return {
    series: points,
    coverage: includedWeightSum,
    missingTickers,
    excludedTickers: excluded,
    totalReturnPct: last.portfolio - 100,
    btcReturnPct: last.btc - 100,
    ibitReturnPct: last.ibit - 100,
    sp500ReturnPct: last.sp500 - 100,
    maxDrawdownPct: maxDrawdown * 100,
    startDate: minStart,
    endDate: maxEnd,
  };
}
