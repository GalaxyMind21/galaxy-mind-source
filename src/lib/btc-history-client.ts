"use client";

/* =====================================================================
 * btc-history-client · shared browser-side loader for BTC daily closes
 *
 * One fetch of /api/history?tickers=BTC&days=1825 per session, cached
 * at module scope. Extracted from the spend-and-replace TimeMachine
 * (B4) when the Gauntlet became a second consumer · both now share
 * one cache, one validation pass, one retry policy.
 *
 * The API route is rate-limited (30/min/IP) and its Yahoo upstream is
 * server-cached, so the worst case for a visitor bouncing between the
 * two features is still exactly one request.
 * ===================================================================== */

export type BtcPoint = { t: number; p: number };

let cache: BtcPoint[] | null = null;
let inflight: Promise<BtcPoint[]> | null = null;

export function loadBtcHistory(): Promise<BtcPoint[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("/api/history?tickers=BTC&days=1825")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((j: { series?: { ticker: string; points?: BtcPoint[] }[] }) => {
      const pts =
        j.series?.find((s) => s.ticker === "BTC")?.points?.filter(
          (pt) => Number.isFinite(pt.t) && Number.isFinite(pt.p) && pt.p > 0,
        ) ?? [];
      if (pts.length < 30) throw new Error("history too shallow");
      cache = pts;
      return pts;
    })
    .catch((e) => {
      inflight = null; // allow retry on next call
      throw e;
    });
  return inflight;
}
