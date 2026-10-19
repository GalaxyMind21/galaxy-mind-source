// POST /api/push/unsubscribe · remove a stored push subscription.
//
// No auth beyond possession of the endpoint URL itself: push
// endpoints carry ~128+ bits of service-issued entropy, so knowing
// one IS the proof you own that browser registration (same model as
// capability URLs). Idempotent · deleting an unknown endpoint is a
// success, the desired state ("not subscribed") already holds.

import { NextRequest, NextResponse } from "next/server";
import { deleteSubscription } from "@/lib/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Same 4KB ceiling the subscribe sibling uses. `req.json()` buffers and
// parses the WHOLE body before the endpoint-length check below can reject
// anything, and this is the one public mutating POST here with neither a
// cap nor a limiter — so a 4MB body (under Vercel's 4.5MB platform
// ceiling, the only thing bounding it today) was parsed in full before
// being thrown away. Measuring bytes first makes the rejection cheap.
const MAX_BODY_BYTES = 4096;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, error: "body too large" },
        { status: 413 },
      );
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }
  const endpoint = (body as { endpoint?: unknown })?.endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 1024) {
    return NextResponse.json(
      { ok: false, error: "endpoint required" },
      { status: 400 },
    );
  }
  await deleteSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
