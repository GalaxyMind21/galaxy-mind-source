/* =====================================================================
 * btc-history-server · server-side BTC daily closes for replay
 * verification (lib/arcade-replay · 2026-07-11).
 *
 * IDENTICAL fetch (URL + headers + revalidate) to /api/history's BTC
 * branch, on purpose: Next's data cache keys on the request, so the
 * replay reads the SAME cached Yahoo payload the players' /api/history
 * responses were built from · no second upstream stream to drift.
 * Returns the RAW 5y series (unix seconds, no cutoff trim) · the
 * verifier applies the client-side 1825d cutoff / trailing trims per
 * candidate itself.
 * ===================================================================== */

export type BtcPoint = { t: number; p: number };

export async function loadBtcHistoryServer(): Promise<BtcPoint[] | null> {
  try {
    const r = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1d&range=5y",
      {
        next: { revalidate: 21600 },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
          Accept: "application/json",
        },
        // Same 5s ceiling as every upstream fetch in this codebase · a
        // slow Yahoo turns into a retriable 503 at the score route, not
        // a pegged function.
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!r.ok) return null;
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result) return null;
    const ts: number[] | undefined = result.timestamp;
    const closes: (number | null)[] | undefined =
      result.indicators?.quote?.[0]?.close;
    if (!Array.isArray(ts) || !Array.isArray(closes)) return null;
    const out: BtcPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (typeof c === "number" && c > 0) out.push({ t: ts[i], p: c });
    }
    // A replay needs years of runway · a stub payload is a failure, not
    // a series.
    return out.length >= 400 ? out : null;
  } catch {
    return null;
  }
}
