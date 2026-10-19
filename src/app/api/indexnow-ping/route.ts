// Manual / cron IndexNow ping endpoint.
//
// POST { urls: string[] } with a CRON_SECRET bearer token to push
// updated URLs to Bing / Yandex / Naver / Seznam / Yep for fast
// re-indexing. Useful after major content updates (vendor adds,
// significant snapshot moves, etc.) and as a future hook into the
// daily snapshot crons.
//
// Auth uses the existing cron-auth helper (timing-safe bearer +
// generic 401) so this endpoint can't be discovered or used by
// anyone outside the project's CI / cron context.
//
// Example invocation (after CRON_SECRET is set):
//   curl -X POST https://galaxymind.space/api/indexnow-ping \
//     -H "Authorization: Bearer $CRON_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"urls":["https://galaxymind.space/stack","https://galaxymind.space/treasuries"]}'

import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { isIndexNowConfigured, pingIndexNow } from "@/lib/indexnow";

export async function POST(req: NextRequest) {
  const auth = await verifyCronAuthLimited(req);
  if (!auth.ok) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!isIndexNowConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "INDEXNOW_KEY not set" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid JSON body" },
      { status: 400 },
    );
  }
  const urls =
    body &&
    typeof body === "object" &&
    "urls" in body &&
    Array.isArray((body as { urls: unknown }).urls)
      ? ((body as { urls: unknown[] }).urls.filter(
          (u) => typeof u === "string",
        ) as string[])
      : null;
  if (!urls || urls.length === 0) {
    return NextResponse.json(
      { ok: false, reason: "body must be { urls: string[] }" },
      { status: 400 },
    );
  }
  // Cap submissions to a sane batch · IndexNow's per-request limit
  // is 10,000 URLs, but typical batches are 1-50. Reject huge ones
  // here to catch accidental misuse.
  if (urls.length > 100) {
    return NextResponse.json(
      { ok: false, reason: "max 100 URLs per request" },
      { status: 400 },
    );
  }

  const result = await pingIndexNow(urls);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
