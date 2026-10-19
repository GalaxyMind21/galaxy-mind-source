// JSON API for the stack verdict + 7-day forecast. Pure server route;
// the page can server-render off this same data, but exposing it as an
// endpoint also gives external consumers (and OG image) a clean handle.
import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";
import { computeStackVerdict, type StackVerdict } from "@/lib/stack";
import { computeForecast, pickBestWindow, type ForecastCell } from "@/lib/forecast";

export const revalidate = 120;

export type StackResponse = {
  verdict: StackVerdict;
  forecast: ForecastCell[];
  asOf: string;
  /** True when ≥4 of the 8 weight-bearing market signals are null
   *  (lib/snapshot-quality.ts · same threshold that blocks the crons).
   *  Consumers should treat the verdict as best-effort neutral, not a
   *  live reading. Pentest 2026-06-01 M1 residual, closed 2026-06-10. */
  degraded: boolean;
};

export async function GET() {
  // Audit 2026-05 M-10: a programmer-error exception in
  // getMarketSnapshot()/compute* used to surface as Next's opaque
  // default 500 — no JSON body, no log line — so a real outage and a
  // code bug looked identical to consumers (the OG card, agents) and
  // left nothing in Vercel logs to debug. Wrap → log loudly + return
  // a typed JSON error with 503 (transient-server semantics).
  try {
    const snapshot = await getMarketSnapshot();
    const verdict = computeStackVerdict(snapshot);
    const forecast = computeForecast(snapshot, verdict);
    const bestWindow = pickBestWindow(forecast);
    const verdictWithWindow: StackVerdict = { ...verdict, bestWindow };
    const body: StackResponse = {
      verdict: verdictWithWindow,
      forecast,
      asOf: new Date().toISOString(),
      degraded: isMarketSnapshotDegraded(snapshot),
    };
    return NextResponse.json(body, {
      // CDN absorption + stale-while-revalidate (availability hardening
      // 2026-06-14). s-maxage matches `revalidate`. No per-IP limiter ·
      // statically cacheable, and a limiter would force it dynamic.
      // max-age: Vercel strips s-maxage/SWR from the browser-facing
      // header, so an explicit browser TTL is needed or clients refetch
      // fully every time.
      headers: {
        "Cache-Control":
          "public, max-age=120, s-maxage=120, stale-while-revalidate=86400",
        // CORS (2026-07-25): llms.txt and /docs/api both advertise these
        // endpoints as "CORS-open", but this one sent no ACAO — so a
        // browser-side consumer (an LLM-generated dashboard, a Claude
        // artifact, a third-party embed) asking the site's headline
        // question hit a CORS wall after the docs said it would work.
        // Same posture already shipped on /api/status, /api/heartbeat,
        // /api/float-heartbeat, /api/vendors.json and /api/openapi.json:
        // public, unauthenticated, cookie-less JSON. `*` is not
        // origin-reflective, so no Vary: Origin and the CDN entry is
        // unaffected.
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Max-Age": "86400",
      },
    });
  } catch (e) {
    console.error(
      "[/api/stack] unhandled:",
      e instanceof Error ? e.stack ?? e.message : e,
    );
    return NextResponse.json(
      { ok: false, error: "stack verdict unavailable" },
      { status: 503 },
    );
  }
}
