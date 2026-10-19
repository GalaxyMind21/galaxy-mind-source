// JSON API for the /treasuries page. Thin wrapper around the existing
// market snapshot — the treasuries data is already fetched there. This
// endpoint just packages it with the static metadata so external
// consumers (and future embed widgets) get a clean payload.
import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";
import { TREASURY_META, COUNTRY_FLAG, mNavInterpretation, isTreasuryBoardEmpty } from "@/lib/treasuries";
import { computeCebe } from "@/lib/cebe";

export const revalidate = 300;

export async function GET() {
  try {
    return await buildResponse();
  } catch (e) {
    // An unexpected throw used to bubble as a bare 500 with no body ·
    // observed once on 2026-08-26 as `SyntaxError: Unexpected end of
    // JSON input`, which the guarded upstream/devalue paths cannot
    // produce, so the source is something further up (a truncated
    // cached read is the leading candidate on this iCloud-synced
    // checkout). Root cause unconfirmed; the blast radius is not.
    //
    // This is public API surface — openapi.json, llms.txt, the Dataset
    // JSON-LD, and the MCP get_treasuries tool all point at it — so a
    // consumer gets the SAME shape it always gets plus the honest
    // degraded flag. 503, never a 200 with empty `rows`, which would
    // read as "there are no treasuries". Short TTL so recovery is fast
    // and the CDN cannot pin the failure for a day the way the success
    // path's stale-while-revalidate would.
    console.error("[api/treasuries] unexpected failure", e);
    return NextResponse.json(
      { btcPrice: null, asOf: null, degraded: true, rows: [] },
      {
        status: 503,
        headers: { "Cache-Control": "public, max-age=15, s-maxage=30" },
      },
    );
  }
}

async function buildResponse() {
  const snapshot = await getMarketSnapshot();
  const rows = snapshot.treasuries.map((q) => {
    const meta = TREASURY_META[q.ticker];
    const interp = mNavInterpretation(q.mNAV);
    // CEBE / net-of-senior-claims mNAV · accounts for debt + preferred
    // ahead of common shareholders. `cebe.available` is false for
    // tickers whose senior-claims figures aren't sourced yet (pending).
    const cebe = computeCebe(q, snapshot.btcPrice);
    return {
      ticker: q.ticker,
      name: meta?.name ?? q.ticker,
      country: meta?.country ?? null,
      countryFlag: meta?.country ? COUNTRY_FLAG[meta.country] : null,
      blurb: meta?.blurb ?? null,
      href: meta?.href ?? null,
      price: q.price,
      marketCapM: q.marketCapM,
      btcHoldings: q.btcHoldings,
      mNAV: q.mNAV,
      premiumPct: q.mNAV != null ? (q.mNAV - 1) * 100 : null,
      interpretation: interp,
      cebe,
    };
  });
  return NextResponse.json(
    {
      btcPrice: snapshot.btcPrice,
      asOf: snapshot.asOf,
      // Same honesty flag as /api/stack + /api/market · when true, mNAV
      // holes are upstream outages, not real market signals.
      //
      // OR'd with this route's OWN emptiness since 2026-08-19. The
      // market-wide measure asks "are ≥4 of 8 weight-bearing signals
      // down"; a total treasury outage trips exactly ONE of those eight
      // (MSTR mNAV), so when the upstream schema drifted and every row
      // came back null, this endpoint served four Unavailable rows under
      // `degraded: false` — and /api/status, which reads the same flag,
      // stayed green through the whole outage. A treasury endpoint that
      // resolved no treasuries is degraded whatever the rest of the
      // market is doing.
      degraded:
        isMarketSnapshotDegraded(snapshot) ||
        isTreasuryBoardEmpty(snapshot.treasuries),
      rows,
    },
    {
      // CDN absorption + SWR (availability hardening 2026-06-14).
      // s-maxage matches `revalidate`. No per-IP limiter · cacheable
      // parameterless read; a limiter would force it dynamic.
      // max-age: Vercel strips s-maxage/SWR from the browser-facing
      // header, so an explicit browser TTL is needed or clients refetch
      // fully every time.
      headers: {
        "Cache-Control":
          "public, max-age=120, s-maxage=300, stale-while-revalidate=86400",
      },
    },
  );
}
