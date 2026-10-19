// GET /api/treasuries/filings · KV-backed read endpoint for the
// /treasuries SEC filings panel.
//
// Why this exists separately from /api/cron/snapshot-filings:
// The cron WRITES to KV (one EDGAR fetch per US treasury, daily).
// This endpoint READS from KV with no upstream calls. Splitting them
// keeps the read path zero-latency and means a viral spike on
// /treasuries doesn't trigger any EDGAR traffic at all.
//
// Response shape:
//   {
//     "asOf": "2026-05-11T06:00:00.000Z",
//     "filings": {
//       "MSTR": [Filing, ...],
//       "XXI":  [Filing, ...],
//       "ASST": [Filing, ...]
//     }
//   }
// Tickers without KV data (cron hasn't run yet, KV unconfigured,
// JP-listed) are simply omitted from the `filings` object · the
// client renders a "Loading..." or "Filings unavailable for {ticker}"
// state for missing entries.
//
// Cache: 30-min edge cache. Filings change at most once per day in
// practice (EDGAR receives most filings during US trading hours and
// our cron snapshots once daily). 30 min strikes a balance between
// freshness ("if a 8-K hits at 14:00 UTC, Vercel's cache invalidates
// by 14:30") and CDN-hit ratio.

import { NextResponse } from "next/server";
import { kvGet } from "@/lib/kv";
import { TREASURY_META } from "@/lib/treasuries";
import type { Filing } from "@/lib/sec-edgar";

export const runtime = "nodejs";
// 30-min cache · matches the freshness rationale in the file header.
export const revalidate = 1800;

function key(ticker: string): string {
  return `filings:${ticker}`;
}

export async function GET() {
  const filings: Record<string, Filing[]> = {};
  // Iterate TREASURY_META so ticker order matches the page · no
  // need to send the full meta, just per-ticker filings keyed by
  // ticker symbol.
  for (const meta of Object.values(TREASURY_META)) {
    if (meta.cik == null) continue; // JP-listed · no EDGAR data
    const list = await kvGet<Filing[]>(key(meta.ticker));
    if (Array.isArray(list) && list.length > 0) {
      filings[meta.ticker] = list;
    }
  }

  return NextResponse.json(
    {
      asOf: new Date().toISOString(),
      filings,
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600",
      },
    },
  );
}
