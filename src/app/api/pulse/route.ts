// GET /api/pulse · public read endpoint for the Weekly Pulse archive.
//
// Why this exists (2026-07-29): readPulseArchive() already backed the
// /pulse page, but there was no JSON twin — so the one surface that
// answers "what happened this week in the bitcoin circular economy"
// was human-only, while every other instrument on the site had a
// machine reader.
//
// The KV-cost argument runs the SAME direction as the feature: /pulse's
// HTML is uncacheable under the nonce CSP (see the README), so every
// visit to that page does the KV read. A CDN-cached JSON twin is
// strictly CHEAPER per additional consumer than pointing them at the
// page, not more expensive.
//
// No upstream calls · this reads the archive the weekly-pulse cron
// writes, exactly like /api/float reads the float snapshots.

import { NextResponse } from "next/server";
import { readPulseArchive } from "@/lib/pulse";

export const runtime = "nodejs";
// Matches the cron cadence's granularity · the archive only changes
// once a week (Mondays 00:30 UTC), so a 30-minute CDN window is
// generous and still bounds staleness well under a day.
export const revalidate = 1800;

export async function GET() {
  try {
    return await buildPulseResponse();
  } catch (e) {
    // 503, never a 200 with `count: 0` — an empty archive under a 200
    // reads as "no weeks have ever been published", which is a false
    // statement about the data rather than an outage.
    console.error("[api/pulse] unexpected failure", e);
    return NextResponse.json(
      { count: 0, weeks: [], degraded: true, asOf: null },
      { status: 503, headers: { "Cache-Control": "public, max-age=15, s-maxage=30" } },
    );
  }
}

async function buildPulseResponse() {
  const weeks = await readPulseArchive();
  return NextResponse.json(
    {
      count: weeks.length,
      // Newest first · same ordering the /pulse page presents.
      weeks,
      asOf: new Date().toISOString(),
    },
    {
      headers: {
        // Same shape as /api/float: browser window shorter than the CDN
        // window so a stale tab refreshes from the edge quickly while
        // the edge itself revalidates rarely.
        "Cache-Control":
          "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600",
        // Public, unauthenticated, cookie-less JSON · `*` is not
        // origin-reflective so the CDN entry is unaffected.
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Max-Age": "86400",
      },
    },
  );
}
