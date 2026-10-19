// Lightweight float heartbeat — the Supply Clock embed's poll target.
//
// Why this exists separately from /api/float: the full float payload
// carries a year of KV history plus ~200 synthetic-history points for
// the trend chart (tens of KB). A third-party embed polling that from
// every visitor's browser would waste bandwidth on data it never
// renders. This endpoint is the ~200-byte cut: today's in-play float,
// yesterday's, and the anchor timestamp · exactly what the ticking
// clock needs to extrapolate a live drain.
//
// Mirrors /api/heartbeat's conventions: CORS open (public read-only
// data, third-party origins poll it), errors still carry CORS so the
// widget can tell "down" from "blocked", CDN cache absorbs traffic.
// KV cost per edge cache miss = the one kvList read inside
// getFloatData() · same profile as the existing public /api/float.

import { NextResponse } from "next/server";
import { getFloatLatest } from "@/lib/float-data";

export const runtime = "nodejs";
// Float data changes once per day (00:15 UTC cron). 30 min at the CDN
// matches /api/float; embeds poll gently on top of that.
export const revalidate = 1800;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control":
    "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600",
};

export type FloatHeartbeatResponse = {
  /** BTC still in play (purchasable float), today's snapshot. */
  inPlay: number;
  /** Yesterday's in-play value · null until two snapshots exist. */
  prevInPlay: number | null;
  /** Snapshot anchor timestamp (ISO) · the extrapolation zero-point. */
  asOf: string;
  /** True when serving the hardcoded fallback baseline or a partial
   *  snapshot · consumers show a neutral "syncing" state, no drain. */
  degraded: boolean;
};

export async function GET() {
  try {
    // getFloatLatest: 2 KV rows, no synthetic · asOf = snapshot.asOf
    // (not request wall clock) so the embed clock can drain between
    // daily snapshots.
    const data = await getFloatLatest();
    const body: FloatHeartbeatResponse = {
      inPlay: data.current.inPlay,
      prevInPlay: data.yesterday?.inPlay ?? null,
      asOf: data.asOf,
      degraded: data.isFallback || data.current.partial === true,
    };
    return NextResponse.json(body, { headers: CORS_HEADERS });
  } catch (e) {
    console.error(
      "[/api/float-heartbeat] unhandled:",
      e instanceof Error ? (e.stack ?? e.message) : e,
    );
    return NextResponse.json(
      { ok: false, error: "float heartbeat unavailable" },
      { status: 503, headers: CORS_HEADERS },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}
