// Daily cron — fetch the most recent SEC filings for each US-listed
// treasury and snapshot them to KV.
//
// Purpose:
// /treasuries renders a "Recent SEC Filings" panel showing the latest
// 8-K / 10-Q / 10-K / S-3 disclosures per ticker. Doing this read at
// page-render time would (a) cost a fresh EDGAR round-trip on every
// page load, (b) bottleneck the page on EDGAR's latency, (c) burn
// through EDGAR's fair-use ceiling on a viral spike. Instead we
// snapshot once a day (3 EDGAR requests total) and read from KV.
//
// Trigger: Vercel cron daily at 06:00 UTC. Why this slot:
//   - 06:00 UTC = 02:00 ET (overnight in the US, off-market hours)
//   - Most 8-K filings land during the trading day (9:30-16:00 ET)
//     OR right after close · by 02:00 ET we've captured the full
//     day's filings without competing with other crons (the 00:05
//     and 00:10 UTC snapshots, the 13:00/14:00 UTC alerting batch).
//   - Far enough from market open in Asia that we don't catch a
//     cluster of pre-market filings prematurely either.
//
// Storage: kvSet("filings:{ticker}", Filing[]) per US-listed ticker.
// We don't use kvPushCapped here because filings DON'T accumulate
// like daily snapshots · each cron run replaces the previous snapshot
// with the current top-N. EDGAR is the source of truth, KV is just
// a cache.
//
// Idempotency: re-running mid-day is safe · it overwrites with the
// same (or newer) data. No skip logic needed.
//
// Failure: per-ticker failures are isolated · MSTR fetch failing
// doesn't stop XXI from snapshotting. The response includes a
// per-ticker status so operators can see which one(s) failed in
// Vercel cron logs.

import { NextResponse } from "next/server";
import { fetchRecentFilings, type Filing } from "@/lib/sec-edgar";
import { kvSet, isKvConfigured } from "@/lib/kv";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { TREASURY_META } from "@/lib/treasuries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Cap per ticker · the panel shows the latest ~3 per column but we
// store more so we can show "View all (N)" or change the page count
// without re-running the cron.
const FILINGS_PER_TICKER = 10;

function key(ticker: string): string {
  return `filings:${ticker}`;
}

type PerTickerResult = {
  ticker: string;
  ok: boolean;
  count?: number;
  reason?: string;
};

export async function GET(request: Request) {
  const auth = await verifyCronAuthLimited(request);
  if (!auth.ok) return auth.response;
  // Cron liveness · best-effort, never throws (see lib/cron-health).
  await recordCronRun("snapshot-filings");

  if (!isKvConfigured()) {
    return NextResponse.json(
      { ok: false, error: "KV not configured · snapshot skipped." },
      { status: 503 },
    );
  }

  // Iterate the treasury map · only US-listed tickers have a CIK
  // (Metaplanet/MPJPY is JP-listed and explicitly cik:null). The
  // null check handles the JP case + any future treasury we haven't
  // CIK-resolved yet.
  const results: PerTickerResult[] = [];
  for (const meta of Object.values(TREASURY_META)) {
    if (meta.cik == null) {
      results.push({
        ticker: meta.ticker,
        ok: false,
        reason: "non-EDGAR filer (no CIK)",
      });
      continue;
    }
    const filings = await fetchRecentFilings(meta.cik, FILINGS_PER_TICKER);
    if (filings == null) {
      results.push({
        ticker: meta.ticker,
        ok: false,
        reason: "EDGAR fetch failed",
      });
      continue;
    }
    const ok = await kvSet(key(meta.ticker), filings);
    if (!ok) {
      results.push({
        ticker: meta.ticker,
        ok: false,
        reason: "KV write failed",
      });
      continue;
    }
    results.push({ ticker: meta.ticker, ok: true, count: filings.length });
  }

  const allOk = results.every((r) => r.ok || r.reason === "non-EDGAR filer (no CIK)");
  return NextResponse.json({
    ok: allOk,
    action: "snapshot",
    asOf: new Date().toISOString(),
    results,
  } satisfies {
    ok: boolean;
    action: string;
    asOf: string;
    results: PerTickerResult[];
  });
}

// Re-export the type so callers (like the read endpoint) can import
// from this route file rather than duplicating the shape. Keeps the
// "single source of truth" closer to the cron that produces the data.
export type { Filing };
