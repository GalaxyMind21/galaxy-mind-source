// JSON API for the live market snapshot. The work happens in lib/market.ts;
// this route is the thin HTTP wrapper the client page consumes. OG image
// handlers call the lib directly to avoid an internal HTTP round-trip.
import { NextResponse } from "next/server";
import { getMarketSnapshot, type MarketSnapshot } from "@/lib/market";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";

export const revalidate = 300;

export type { MarketSnapshot };

export async function GET() {
  // Audit 2026-05 M-10: see /api/stack — wrap so a code-error
  // exception is logged + returned as typed JSON 503 instead of an
  // opaque, unlogged Next 500.
  try {
    const snapshot = await getMarketSnapshot();
    // Top-level honesty flag · consumers (fit client, embedders, AI
    // agents) shouldn't have to re-implement isMarketSnapshotDegraded
    // to know the snapshot is running on fallbacks. Additive field ·
    // the MarketSnapshot shape itself is unchanged.
    return NextResponse.json(
      {
        ...snapshot,
        degraded: isMarketSnapshotDegraded(snapshot),
      },
      {
        // Strengthen CDN absorption · this is the heaviest payload
        // (~hundreds of KB). s-maxage matches `revalidate`;
        // stale-while-revalidate lets the edge serve a slightly stale
        // copy while it refreshes in the background, so cache-miss
        // traffic can't all stampede the origin at once. Availability
        // hardening (audit 2026-06-14). Deliberately NO per-IP limiter
        // here: a limiter reads request headers, forcing this route
        // dynamic and DISABLING this very cache · the wrong trade for a
        // parameterless read.
        // max-age: Vercel consumes s-maxage/SWR at the CDN and strips
        // them from the browser-facing header, so without an explicit
        // max-age browsers saw bare `public` and re-downloaded this
        // ~234KB payload on every poll (/fit refetches every 3 min per
        // open tab). 120s browser TTL halves that without staling the
        // 5-min data cadence.
        headers: {
          "Cache-Control":
            "public, max-age=120, s-maxage=300, stale-while-revalidate=86400",
        },
      },
    );
  } catch (e) {
    console.error(
      "[/api/market] unhandled:",
      e instanceof Error ? e.stack ?? e.message : e,
    );
    return NextResponse.json(
      { ok: false, error: "market snapshot unavailable" },
      { status: 503 },
    );
  }
}
