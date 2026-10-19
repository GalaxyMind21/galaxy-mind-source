// GET /api/hashrate · public JSON twin of the Hashrate Desk.
//
// Same lib the page and the MCP tool call, so a human, a crawler and an
// AI client can never see different numbers.
//
// Deliberately NOT per-IP rate limited: it takes no user input, so the
// CDN absorbs floods via s-maxage. Adding a KV limiter here would force
// the route dynamic and disable that cache — counterproductive, per the
// existing posture on /api/market and /api/float.

import { NextResponse } from "next/server";
import { getHashrateDesk } from "@/lib/hashrate";
import { publicDesk } from "@/lib/public-desk";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET() {
  try {
    return await buildDeskResponse();
  } catch (e) {
    // This endpoint is listed in openapi.json + llms.txt (the /hashrate
    // Dataset JSON-LD that also advertised it was dropped 2026-10-18), so a bare
    // 500 breaks a documented contract. `degraded` is the desk's own
    // honesty channel — carry it rather than inventing a shape. CORS
    // header repeated on purpose: without it a browser consumer sees a
    // CORS error instead of the honest body. Short TTL so a transient
    // failure is not pinned at the CDN by the success path's SWR.
    console.error("[api/hashrate] unexpected failure", e);
    return NextResponse.json(
      { degraded: ["desk"], asOf: null, ourRigs: [] },
      {
        status: 503,
        headers: {
          "Cache-Control": "public, max-age=15, s-maxage=30",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
}

async function buildDeskResponse() {
  const desk = await getHashrateDesk();
  return NextResponse.json(publicDesk(desk), {
    headers: {
      "Cache-Control":
        "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
