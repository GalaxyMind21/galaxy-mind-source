// Snapshot quality predicates · "is this MarketSnapshot trustworthy
// enough to act on?"
//
// Extracted from check-thresholds + weekly-digest in commit (this one)
// so a third caller — snapshot-stack — can apply the same guard
// without duplicating the threshold definition. Audit 2026-05-14
// found that snapshot-stack was missing this guard, polluting the
// stack:history KV list with score=50 fallback rows during multi-day
// upstream outages (those rows then leaked into the /stack sparkline
// and the weekly-digest min/avg/max).
//
// Cross-cutting reason this lives in lib/ rather than inline in each
// route: the THRESHOLD itself is a load-bearing decision. Drift between
// the routes (e.g. one stays at 3/6, another moves to 4/8) silently
// changes alarm sensitivity. Single source of truth here.

import type { MarketSnapshot } from "./market";

// "Degraded" = ≥ 4 of 8 weight-bearing market signals are null.
//
// The 8 signals counted here are the ones that meaningfully drive the
// stack score (and the verdict that derives from it). NOT every
// MarketSnapshot field is counted — purely-presentational fields like
// `asOf` or `source` are excluded.
//
// Threshold history:
//   · 3 of 6 — original (BTC price, vol, F&G, MVRV, funding, hourly)
//   · 4 of 8 — current (added Puell at 13% weight + MSTR mNAV at 6%
//              weight in May 2026 · scaled threshold proportionally
//              so a Coinmetrics-only outage no longer slips through
//              with its 13% weight silently redistributed)
//
// If you add a new weight-bearing signal to lib/stack.ts, ADD IT HERE
// and reconsider the threshold numerator. The signal-count and the
// numerator must move together to preserve the "half-of-data-down"
// intent. Pure cosmetic signals (e.g. tier-label hint without weight)
// don't belong in this list.
//
// These two are EXPORTED so the canonical agent file (public/llms.txt)
// can be drift-checked against them · scripts/check-llms-txt.ts asserts
// llms.txt states the same "≥N of M" the engine actually uses. Keep the
// `signals` array length below equal to WEIGHT_BEARING_SIGNAL_COUNT.
export const DEGRADED_NULL_THRESHOLD = 4;
export const WEIGHT_BEARING_SIGNAL_COUNT = 8;

export function isMarketSnapshotDegraded(s: MarketSnapshot): boolean {
  return weightBearingSources(s).filter((x) => !x.ok).length >= DEGRADED_NULL_THRESHOLD;
}

/**
 * The 8 weight-bearing signals, each named for humans (signal + upstream)
 * and flagged ok = currently reporting (non-null). Single source of truth
 * for both the /status page rows and the machine-readable /api/status
 * `sources` array, so the named list can't drift between them. Keep the
 * length equal to WEIGHT_BEARING_SIGNAL_COUNT.
 */
export function weightBearingSources(
  s: MarketSnapshot,
): { name: string; ok: boolean }[] {
  const mstrMnav = s.treasuries.find((t) => t.ticker === "MSTR")?.mNAV ?? null;
  const pairs: [string, unknown][] = [
    ["BTC spot (CoinGecko)", s.btcPrice],
    ["30d realized vol (Yahoo)", s.btcVol30d],
    ["Fear & Greed (alternative.me)", s.fearGreed],
    ["MVRV (Coinmetrics)", s.mvrv],
    ["Funding rate (OKX)", s.fundingRate],
    ["Hourly closes (Yahoo)", s.hourlyCloses],
    ["Puell Multiple (Coinmetrics)", s.puell],
    ["MSTR mNAV (bitcointreasuries)", mstrMnav],
  ];
  return pairs.map(([name, v]) => ({ name, ok: v != null }));
}
