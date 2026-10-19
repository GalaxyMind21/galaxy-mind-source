// GET /api/float · public read endpoint for the /float page.
//
// Why this exists separately from /api/cron/snapshot-float:
// snapshot-float WRITES (one upstream pull per day). This endpoint
// READS from KV with no upstream calls · viral spike on /float
// drives ZERO mempool.space or bitcointreasuries.net traffic.
//
// Implementation lives in lib/float-data.ts so the /float page
// can import + call getFloatData() directly without an HTTP
// roundtrip · same source of truth, two consumers.

import { NextResponse, type NextRequest } from "next/server";
import { getFloatData } from "@/lib/float-data";

// CSV export (2026-07-29). /stack and /treasuries both ship a text/csv
// DataDownload; /float shipped JSON only, and the Dataset node on
// /float documents why — there is no /api/float/history endpoint to
// point a CSV at. But /api/float ALREADY returns the daily `history`
// array in-body, so the series exists; it just had no spreadsheet form.
//
// The allow-list is copied deliberately from stack/history: an
// unbounded ?days=1..N would multiply CDN cache keys by N for one
// endpoint. Four buckets, everything else snaps to the default.
const ALLOWED_DAYS = new Set([30, 90, 180, 365]);
const DEFAULT_DAYS = 90;

const CSV_HEADER =
  "date,blockHeight,minedSupply,inPlay,totalSupply,partial";

export const runtime = "nodejs";
export const revalidate = 1800;

export async function GET(req: NextRequest) {
  try {
    return await buildFloatResponse(req);
  } catch (e) {
    // Carries the same `degraded` flag the success path computes, so a
    // consumer reading that field gets the truth either way. 503 rather
    // than a fabricated zero-supply payload.
    console.error("[api/float] unexpected failure", e);
    return NextResponse.json(
      { degraded: true, error: "float data unavailable" },
      { status: 503, headers: { "Cache-Control": "public, max-age=15, s-maxage=30" } },
    );
  }
}

async function buildFloatResponse(req: NextRequest) {
  const data = await getFloatData();

  if (new URL(req.url).searchParams.get("format") === "csv") {
    const url = new URL(req.url);
    const requested = Number(url.searchParams.get("days") ?? DEFAULT_DAYS);
    const days =
      Number.isFinite(requested) && ALLOWED_DAYS.has(Math.floor(requested))
        ? Math.floor(requested)
        : DEFAULT_DAYS;
    // KV stores newest-first; oldest-first is what a chart or a
    // spreadsheet wants.
    const rows = [...data.history]
      .slice(0, days)
      .reverse()
      .map(
        (h) =>
          `${h.date},${h.blockHeight},${h.minedSupply},${h.inPlay},${h.totalSupply},${h.partial}`,
      );
    return new NextResponse([CSV_HEADER, ...rows].join("\n") + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'inline; filename="galaxymind-float-history.csv"',
        "Cache-Control":
          "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // Float's degraded analog · this surface runs on KV snapshots, not
  // the market snapshot, so "degraded" = serving the hardcoded
  // fallback baseline OR a partial snapshot (an upstream cohort fetch
  // failed in the daily cron). Mirrors the degraded flag added to
  // /api/stack + /api/market + /api/treasuries on 2026-06-10.
  return NextResponse.json({
    ...data,
    degraded: data.isFallback || data.current.partial === true,
  }, {
    headers: {
      // max-age (browser) deliberately shorter than s-maxage (CDN) so
      // a returning visitor's stale tab refreshes from CDN within 5
      // min while the CDN itself only revalidates upstream once per
      // 30 min. SWR keeps the page snappy if the CDN is mid-revalidate.
      "Cache-Control":
        "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600",
      // CORS (2026-07-25) · see the note in /api/stack. The docs
      // advertise this endpoint as CORS-open and it sent no ACAO, so
      // "how much bitcoin is left to buy" was unanswerable from a
      // browser-side client. Public, unauthenticated, cookie-less JSON;
      // `*` is not origin-reflective so the CDN entry is unaffected.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}
