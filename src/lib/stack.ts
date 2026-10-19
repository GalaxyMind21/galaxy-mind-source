import type { MarketSnapshot } from "./market";

export type StackTier = "COLD" | "CHILL" | "WARM" | "HOT" | "MOLTEN";

export type SignalReading = {
  name: string;
  raw: number | null;
  normalized: number; // 0-100; higher = more bullish for buying
  weight: number;     // share of final score
  rationale: string;
};

export type BestWindow = {
  dayOfWeek: number;       // 0=Sun ... 6=Sat
  hourLocalET: number;     // 0-23
  label: string;           // e.g. "Sun 2–5am ET"
  // Cell offset from the forecast's current hour (h=0). For the
  // standard 168-cell forecast this is 1..167. Used by the client
  // countdown to render "in Xh Ym" without re-deriving from the
  // label string. Server-computed and serializable.
  hoursFromNow: number;
  // The forecast score of the best cell (0-100). Lets callers (UI
  // countdown, future "imminent window" alert cron) show "projected
  // score N" alongside the time-to.
  score: number;
};

export type StackVerdict = {
  score: number;             // 0-100, integer
  tier: StackTier;
  signals: SignalReading[];  // length 10, ordered for cockpit
  summary: string;
  bestWindow: BestWindow | null;
  computedAt: string;
  blockHeight: number | null;
};

// All normalizers return 0-100. Higher = more attractive entry.
// They MUST handle null (return 50, neutral) so callers can pass raw inputs.

export function normMVRV(v: number | null): number {
  if (v == null) return 50;
  if (v < 1.0) return 100;
  if (v < 1.5) return 80;
  if (v < 2.5) return 50;
  if (v < 3.5) return 25;
  return 0;
}

export function normMayer(price: number | null, ma200: number | null): number {
  if (price == null || ma200 == null || ma200 <= 0) return 50;
  const ratio = price / ma200;
  if (ratio < 1.0) return 100;
  if (ratio < 1.4) return 70;
  if (ratio < 2.4) return 30;
  return 0;
}

export function normFunding(v: number | null): number {
  if (v == null) return 50;
  if (v < -0.0005) return 100;
  if (v < 0.0001) return 70;
  if (v < 0.0005) return 50;
  return 20;
}

export function normFearGreed(v: number | null): number {
  if (v == null) return 50;
  // 0=fear → 100 (good buying), 100=greed → 0 (avoid)
  return Math.max(0, Math.min(100, 100 - v));
}

export function normPriceVs30d(price: number | null, ma30: number | null): number {
  if (price == null || ma30 == null || ma30 <= 0) return 50;
  const pct = price / ma30 - 1;
  // Below MA = bullish for buying. -10% → 70, -5% → 60, 0 → 50, +5% → 40, +10% → 30.
  return Math.max(0, Math.min(100, 50 - pct * 200));
}

export function normVol(v: number | null): number {
  if (v == null) return 50;
  if (v < 40) return 70;
  if (v < 70) return 50;
  if (v < 100) return 30;
  return 80; // vol spikes often bracket capitulation lows
}

export function normMNAV(v: number | null): number {
  if (v == null) return 50;
  if (v < 1.05) return 100;
  if (v < 1.6) return 50;
  return 20;
}

/**
 * Puell Multiple — daily issuance USD ÷ 365d MA.
 *
 * Threshold mapping calibrated against the historical record:
 *  • <0.5  → 100 (miner capitulation; every major bottom — Dec 2018,
 *            Mar 2020, Nov 2022 — was below 0.5)
 *  • <1.0  → 80  (below trend, accumulation favored)
 *  • <2.0  → 50  (typical mid-cycle)
 *  • <4.0  → 20  (late-cycle warning)
 *  • ≥4.0  → 0   (top zone; Dec 2017 and Apr 2021 tops both > 4.0)
 *
 * Symmetry with normMVRV deliberate — both indicators share the
 * "extreme-low buys, extreme-high sells" topology.
 */
export function normPuell(v: number | null): number {
  if (v == null) return 50;
  if (v < 0.5) return 100;
  if (v < 1.0) return 80;
  if (v < 2.0) return 50;
  if (v < 4.0) return 20;
  return 0;
}

export function scoreToTier(score: number): StackTier {
  if (score <= 20) return "COLD";
  if (score <= 40) return "CHILL";
  if (score <= 60) return "WARM";
  if (score <= 80) return "HOT";
  return "MOLTEN";
}

// Display vocabulary. The underlying StackTier values stay temperature-named
// (COLD/CHILL/WARM/HOT/MOLTEN) so the engine, tests, KV history, OG cards,
// and share URLs are unchanged · these maps are the ONLY visitor-facing
// words and they are deliberately Bitcoin-meme-culture, not dry-fintech
// (operator direction 2026-05: the gauge should be punchy, dramatic, and
// in on the joke · HODL not HOLD). Still a real instruction gradient:
// HODL (don't add) → DCA → STACK SATS → SEND IT → FULL SEND (max). One
// source of truth · changing a word here changes the gauge, the OG share
// card, alert emails, the sticky bar, and the a11y label together, so
// keep them intelligible to a screen reader / first emailer too.
export const TIER_LABEL: Record<StackTier, string> = {
  COLD: "HODL",
  CHILL: "DCA",
  WARM: "STACK SATS",
  HOT: "SEND IT",
  MOLTEN: "FULL SEND",
};

function ma(closes: number[], hours: number): number | null {
  if (closes.length < hours) return null;
  const slice = closes.slice(-hours);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

const MA_30D_HOURS = 24 * 30;
const MA_200D_HOURS = 24 * 200;

// PERF (2026-07-11): hourOfDayScore/dayOfWeekScore used to re-derive the
// ET hour + day-of-week of EVERY point in the ~9,600-point hourly series
// on every call — an Intl.DateTimeFormat.formatToParts per point. Fine
// for computeStackVerdict (2 calls), catastrophic for computeForecast,
// which calls each of them once per 168 cells: 168 × 2 × 9,600 ≈ 3.2M
// Intl calls ≈ multiple SECONDS of main-thread CPU per render. That was
// the entire /stack Suspense stall (measured 6.3s on Vercel).
//
// The ET hour of a fixed timestamp never changes, and only the TARGET
// hour/dow varies across calls — so one pass over the series computes
// the average log-return per ET hour (24 buckets) and per ET day (7
// buckets), memoized per series via WeakMap. Each score call is then an
// O(1) lookup. Accumulation runs in the same ascending-index order as
// the old per-call reduce, so the averages are bit-identical and every
// score is unchanged. The <5-samples → 50 and short-series → 50 guards
// are preserved verbatim. DST correctness is untouched (same
// lib/datetime.ts Intl helpers, just called once per point).
type SeriesBuckets = {
  closes: number[]; // identity guard · recompute if closes ref changes
  hourAvg: (number | null)[]; // avg log-return per ET hour · null when <5 samples
  dowAvg: (number | null)[]; // avg log-return per ET dow · null when <5 samples
};

const seriesBucketsCache = new WeakMap<number[], SeriesBuckets>();

function getSeriesBuckets(
  closes: number[],
  timestamps: number[],
): SeriesBuckets {
  const cached = seriesBucketsCache.get(timestamps);
  if (cached && cached.closes === closes) return cached;

  const hourSum = new Float64Array(24);
  const hourN = new Int32Array(24);
  const dowSum = new Float64Array(7);
  const dowN = new Int32Array(7);
  for (let i = 1; i < closes.length; i++) {
    const tsMs = timestamps[i] * 1000;
    const etHour = etHourFromUtcMs(tsMs);
    const dow = etDayOfWeekFromUtcMs(tsMs);
    const ret = Math.log(closes[i] / closes[i - 1]);
    if (!Number.isFinite(ret)) continue;
    hourSum[etHour] += ret;
    hourN[etHour]++;
    dowSum[dow] += ret;
    dowN[dow]++;
  }
  const hourAvg = Array.from(hourSum, (sum, h) =>
    hourN[h] >= 5 ? sum / hourN[h] : null,
  );
  const dowAvg = Array.from(dowSum, (sum, d) =>
    dowN[d] >= 5 ? sum / dowN[d] : null,
  );
  const buckets: SeriesBuckets = { closes, hourAvg, dowAvg };
  seriesBucketsCache.set(timestamps, buckets);
  return buckets;
}

// Returns avg log-return at the given local-ET hour over the lookback.
// Lower avg return historically → score this hour higher (good buying).
export function hourOfDayScore(
  closes: number[] | null,
  timestamps: number[] | null,
  targetEtHour: number,
): number {
  if (!closes || !timestamps || closes.length < 24 * 14) return 50;
  const avg = getSeriesBuckets(closes, timestamps).hourAvg[targetEtHour];
  if (avg == null) return 50;
  // avg in roughly [-0.005, 0.005]. Map negative → high (good entry).
  return Math.max(0, Math.min(100, 50 - avg * 10000));
}

export function dayOfWeekScore(
  closes: number[] | null,
  timestamps: number[] | null,
  targetDow: number,
): number {
  if (!closes || !timestamps || closes.length < 24 * 14) return 50;
  const avg = getSeriesBuckets(closes, timestamps).dowAvg[targetDow];
  if (avg == null) return 50;
  return Math.max(0, Math.min(100, 50 - avg * 10000));
}

// ET helpers live in lib/datetime.ts. They use Intl.DateTimeFormat with
// timeZone: "America/New_York", which respects DST — the previous fixed
// `-5h` shift was wrong from mid-March to early November every year.
import { etHourFromUtcMs, etDayOfWeekFromUtcMs } from "./datetime";

export function computeStackVerdict(
  snapshot: MarketSnapshot,
  // Audit 2026-05-14 finding H-2 · accept nowMs as a parameter so
  // callers that derive multiple things from "this moment" (e.g.
  // weekly-digest calling computeStackVerdict + computeForecast in
  // sequence) can ensure both calls agree on what "now" is. Default
  // remains Date.now() at call time for the no-context call sites.
  nowMs: number = Date.now(),
): StackVerdict {
  const closes = snapshot.hourlyCloses;
  const timestamps = snapshot.hourlyTimestamps;
  const ma30 = closes ? ma(closes, MA_30D_HOURS) : null;
  const ma200 = closes ? ma(closes, MA_200D_HOURS) : null;
  const mstrQuote = snapshot.treasuries.find((t) => t.ticker === "MSTR");
  const mNAV = mstrQuote?.mNAV ?? null;

  const nowEtHour = etHourFromUtcMs(nowMs);
  const nowEtDow = etDayOfWeekFromUtcMs(nowMs);

  const raw = {
    mvrv: snapshot.mvrv,
    puell: snapshot.puell,
    mayerPrice: snapshot.btcPrice,
    mayerMa: ma200,
    funding: snapshot.fundingRate,
    fg: snapshot.fearGreed,
    px30Price: snapshot.btcPrice,
    px30Ma: ma30,
    vol: snapshot.btcVol30d,
    hourScore: hourOfDayScore(closes, timestamps, nowEtHour),
    dowScore: dayOfWeekScore(closes, timestamps, nowEtDow),
    mNAV,
  };

  // Weights sum to 1.0 across all 10 signals. Puell Multiple was added
  // at 0.13 (slotted between MVRV and Mayer Multiple in importance —
  // it's a Bitcoin-native cycle indicator with the same conceptual
  // "extreme low buys, extreme high sells" topology). All other weights
  // were trimmed proportionally to make room. Total: 0.87 + 0.13 = 1.00.
  const readings: SignalReading[] = [
    {
      name: "MVRV", raw: raw.mvrv, weight: 0.16,
      normalized: normMVRV(raw.mvrv),
      rationale: raw.mvrv == null
        ? "MVRV unavailable."
        : `MVRV ${raw.mvrv.toFixed(2)} · ${raw.mvrv < 1 ? "below realized value (historically a strong entry)" : raw.mvrv > 3 ? "elevated; market richly priced vs cost basis" : "near long-run average"}.`,
    },
    {
      name: "Mayer Multiple", raw: raw.mayerPrice && raw.mayerMa ? raw.mayerPrice / raw.mayerMa : null, weight: 0.14,
      normalized: normMayer(raw.mayerPrice, raw.mayerMa),
      rationale: raw.mayerMa == null || raw.mayerPrice == null
        ? "200-day MA unavailable."
        : `Price is ${((raw.mayerPrice / raw.mayerMa) * 100 - 100).toFixed(1)}% vs 200d MA.`,
    },
    {
      name: "Puell Multiple", raw: raw.puell, weight: 0.13,
      normalized: normPuell(raw.puell),
      rationale: raw.puell == null
        ? "Puell unavailable."
        : `${raw.puell.toFixed(2)}× · ${raw.puell < 0.5 ? "miner capitulation regime (every major bottom landed here)" : raw.puell < 1.0 ? "below trend; miner economics favor accumulation" : raw.puell > 4.0 ? "miner over-earning; top zone historically" : raw.puell > 2.0 ? "above trend; late-cycle warning" : "near long-run average"}.`,
    },
    {
      name: "Funding Rate", raw: raw.funding, weight: 0.12,
      normalized: normFunding(raw.funding),
      rationale: raw.funding == null
        ? "Funding unavailable."
        : `${(raw.funding * 100).toFixed(4)}% · ${raw.funding < 0 ? "shorts paying longs (bearish positioning, contrarian buy)" : "longs paying shorts (crowded long)"}.`,
    },
    {
      name: "Fear & Greed", raw: raw.fg, weight: 0.10,
      normalized: normFearGreed(raw.fg),
      rationale: raw.fg == null
        ? "Sentiment unavailable."
        : `${raw.fg}${snapshot.fearGreedLabel ? ` (${snapshot.fearGreedLabel})` : ""}.`,
    },
    {
      name: "Price vs 30d MA", raw: raw.px30Price && raw.px30Ma ? raw.px30Price / raw.px30Ma - 1 : null, weight: 0.09,
      normalized: normPriceVs30d(raw.px30Price, raw.px30Ma),
      rationale: raw.px30Ma == null || raw.px30Price == null
        ? "30d MA unavailable."
        : `${((raw.px30Price / raw.px30Ma - 1) * 100).toFixed(1)}% vs 30d MA.`,
    },
    {
      name: "30d Realized Vol", raw: raw.vol, weight: 0.07,
      normalized: normVol(raw.vol),
      rationale: raw.vol == null ? "Vol unavailable." : `${raw.vol.toFixed(1)}% annualized.`,
    },
    {
      name: "Hour-of-Day", raw: nowEtHour, weight: 0.07,
      normalized: raw.hourScore,
      rationale: `Current ET hour: ${nowEtHour}:00.`,
    },
    {
      name: "Day-of-Week", raw: nowEtDow, weight: 0.06,
      normalized: raw.dowScore,
      rationale: `Today: ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][nowEtDow]}.`,
    },
    {
      name: "MSTR mNAV", raw: mNAV, weight: 0.06,
      normalized: normMNAV(mNAV),
      rationale: mNAV == null
        ? "mNAV unavailable."
        : `${mNAV.toFixed(2)}× · ${mNAV < 1.05 ? "compressed (treasury-cheap, often correlates with BTC bottoms)" : mNAV > 1.6 ? "rich premium" : "near average"}.`,
    },
  ];

  // Redistribute weight from null-raw signals proportionally across surviving ones.
  // Hour-of-Day and Day-of-Week are always considered "live" because they have raw
  // values (the current ET hour / weekday) even when the snapshot's hourly history
  // is missing — their normalized score just falls back to 50 in that case.
  const isLive = (s: SignalReading) =>
    !(s.raw == null && s.name !== "Hour-of-Day" && s.name !== "Day-of-Week");
  const liveTotal = readings.filter(isLive).reduce((a, s) => a + s.weight, 0);
  const adjusted = readings.map((s) => ({
    ...s,
    weight: isLive(s) && liveTotal > 0 ? s.weight / liveTotal : 0,
  }));
  // Ensure final weights sum to 1 even when some are zeroed.
  const finalTotal = adjusted.reduce((a, s) => a + s.weight, 0);
  const normalized = finalTotal > 0
    ? adjusted.map((s) => ({ ...s, weight: s.weight / finalTotal, normalized: Math.round(s.normalized) }))
    : adjusted.map((s, _, arr) => ({ ...s, weight: 1 / arr.length, normalized: Math.round(s.normalized) })); // all-null fallback

  const score = Math.round(
    normalized.reduce((a, s) => a + s.normalized * s.weight, 0),
  );
  const tier = scoreToTier(score);

  const summary = buildSummary(normalized, score);

  return {
    score,
    tier,
    signals: normalized,
    summary,
    bestWindow: null,
    computedAt: new Date().toISOString(),
    blockHeight: snapshot.blockHeight,
  };
}

// Tier-specific verdicts. The page is a contrarian instrument · the
// highest scores happen during widespread fear, which almost never
// feels good to act on. The copy leans into that explicitly AND into
// Bitcoin meme culture (operator direction 2026-05): dramatic, punchy,
// Saylor-flavored, in on the joke · still factually a contrarian-entry
// readout, not a shitpost. Keep it useful first, funny second.
function buildSummary(signals: SignalReading[], score: number): string {
  const live = signals.filter((s) => s.raw != null && s.weight > 0);
  if (live.length === 0) return "Neutral · insufficient data to read the room.";
  const top = [...live]
    .sort(
      (a, b) =>
        b.weight * Math.abs(b.normalized - 50) -
        a.weight * Math.abs(a.normalized - 50),
    )
    .slice(0, 3)
    .map((s) => s.name)
    .join(", ");

  const verdict =
    score >= 81
      ? "🩸 Blood in the streets. The gauge says FULL SEND · maximum fear, generational price. It feels insane, which is exactly the point. There is no second best."
      : score >= 61
        ? "The gauge says SEND IT. Sentiment is darkening and the all-clear hasn't sounded · this is where the disciplined stack while everyone else waits to feel safe. Few understand this."
        : score >= 41
          ? "The gauge says STACK SATS at your usual pace. The market is making up its mind. Keep the DCA running and zoom out · nothing to hero here."
          : score >= 21
            ? "Below-average entry · the gauge says just DCA. The market is feeling itself. No rush · stay humble, keep stacking. Better windows tend to follow stretches like this."
            : "Euphoria and laser eyes everywhere · the gauge says HODL, do not add. Historically the worst moment to deploy fresh fiat. Patience is a position · don't chase green candles.";

  return `${verdict} Top contributors: ${top}.`;
}
