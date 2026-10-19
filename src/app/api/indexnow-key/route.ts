// IndexNow site-ownership verification endpoint.
//
// Bing / Yandex / etc. fetch this URL to confirm we own the site
// before accepting URL re-index submissions. The response body must
// be the literal key string (no JSON wrapping, no whitespace).
//
// This route is referenced as `keyLocation` in our IndexNow POST
// payloads (see src/lib/indexnow.ts). If INDEXNOW_KEY isn't set in
// env, the route returns 404 · IndexNow submissions will silently
// no-op until the key is configured.
//
// Cache the response · the key is stable across the lifetime of the
// env var. 1 hour edge cache is plenty.

import { NextResponse } from "next/server";
import { getIndexNowKey } from "@/lib/indexnow";

export const revalidate = 3600;

export function GET() {
  const key = getIndexNowKey();
  if (!key) {
    return new NextResponse("IndexNow not configured", { status: 404 });
  }
  return new NextResponse(key, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
