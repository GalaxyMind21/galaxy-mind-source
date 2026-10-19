// BTC Yield · the rate a treasury company grows its bitcoin-per-share
// (BPS) over a window, net of dilution. Strategy's headline KPI, and the
// thing the glossary + methodology already DEFINE but nothing computed
// until now. We derive it from the daily KV snapshots we already write:
// gross BPS = btcHoldings × 1e4 / marketCapM, so a BPS series falls out
// of (btcHoldings, marketCapM) with no extra data capture.
//
// It is a BPS-execution metric, NOT a cash yield · no dividend is paid.

export type BtcYield = {
  /** Percent change in BPS over the realized window. */
  pct: number;
  /** Oldest snapshot date used (the baseline). */
  fromDate: string;
  /** Latest snapshot date used. */
  toDate: string;
  /** Actual number of days between baseline and latest. */
  spanDays: number;
};

type BpsPoint = {
  date: string;
  btcHoldings: number | null;
  marketCapM: number | null;
};

const DAY_MS = 86_400_000;
const ts = (date: string) => new Date(`${date}T00:00:00Z`).getTime();

/** Gross BPS (sats per $100 of stock, before claims) for one snapshot. */
function bps(p: BpsPoint): number | null {
  return p.btcHoldings != null &&
    p.btcHoldings > 0 &&
    p.marketCapM != null &&
    p.marketCapM > 0
    ? (p.btcHoldings * 10_000) / p.marketCapM
    : null;
}

/**
 * BTC Yield over `days`, from oldest-first daily snapshots. Picks the
 * latest snapshot at/before (latest − days) as the baseline (or the
 * oldest available when history is shorter), and reports the realized
 * spanDays so callers can label the actual window.
 *
 * `opts.notBeforeDate` drops snapshots before a one-time share-basis
 * correction (see SHARE_BASIS_CORRECTED_ON) so the yield is not polluted
 * by a methodology step. Returns null when there is not enough clean
 * history to form a real window.
 */
export function computeBtcYield(
  snapshots: BpsPoint[],
  days: number,
  opts?: { notBeforeDate?: string },
): BtcYield | null {
  const floor = opts?.notBeforeDate;
  const clean = (floor
    ? snapshots.filter((s) => s.date >= floor)
    : snapshots
  ).filter((s) => bps(s) != null);
  if (clean.length < 2) return null;

  const latest = clean[clean.length - 1];
  const latestBps = bps(latest)!;
  const targetMs = ts(latest.date) - days * DAY_MS;

  // Latest snapshot at/before the target date · the loop keeps the most
  // recent qualifying point. If none qualifies (all history is newer than
  // the window) we fall back to the oldest available point.
  let baseline = clean[0];
  for (const s of clean) {
    if (ts(s.date) <= targetMs) baseline = s;
    else break;
  }
  if (baseline.date === latest.date) return null;

  const baseBps = bps(baseline)!;
  if (baseBps <= 0) return null;

  return {
    pct: (latestBps / baseBps - 1) * 100,
    fromDate: baseline.date,
    toDate: latest.date,
    spanDays: Math.round((ts(latest.date) - ts(baseline.date)) / DAY_MS),
  };
}
