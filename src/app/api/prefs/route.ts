// GET/POST /api/prefs — view + update a subscriber's alert prefs.
//
// Auth model: reuses the stateless HMAC unsubscribe token from
// lib/subscribe-flow. Same secret, same per-email derivation, same
// blast radius (an attacker who can mint an unsub token can also
// edit prefs · both keyed off email knowledge + UNSUB_SECRET).
// Adding a separate "prefs token" with the same trust model would
// add nothing but complexity, so the token is shared. The email
// templates can render BOTH the unsub URL and the prefs URL from
// the same token via the existing buildUnsubscribeUrl /
// buildPrefsUrl helpers.
//
// Why this exists: the operator audit flagged "I want to flip one
// opt-in without re-subscribing." Before this route, the only way
// to change prefs was to re-sign-up with the updated pref bundle
// at /stack · clunky for an existing subscriber.

import { NextRequest, NextResponse } from "next/server";
import {
  getSubscriberPrefs,
  normalizePrefs,
  setSubscriberPrefs,
  verifyUnsubscribeToken,
} from "@/lib/subscribe-flow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_096;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "missing token" },
      { status: 400 },
    );
  }
  const email = verifyUnsubscribeToken(token);
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "invalid or expired link" },
      { status: 410 },
    );
  }
  const prefs = await getSubscriberPrefs(email);
  // Echo back email mostly for the page's UX ("editing settings for
  // foo@bar.com"). The token already proves possession; this just
  // saves the client a render round-trip to display it.
  return NextResponse.json(
    { ok: true, email, prefs },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

export async function POST(req: NextRequest) {
  // Body cap · measure actual bytes (same pattern as submit-vendor).
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid body" },
      { status: 400 },
    );
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "body too large" },
      { status: 413 },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "body must be JSON object" },
      { status: 400 },
    );
  }
  const b = body as Record<string, unknown>;
  const token = typeof b.token === "string" ? b.token : "";
  const email = verifyUnsubscribeToken(token);
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "invalid or expired link" },
      { status: 410 },
    );
  }
  const normalized = normalizePrefs(b.prefs);
  if (!normalized) {
    // Validation failed · normalizePrefs is strict, returns null on
    // malformed input. Communicate "invalid" without leaking which
    // field broke (the form already has client-side bounds).
    return NextResponse.json(
      { ok: false, error: "invalid prefs" },
      { status: 400 },
    );
  }
  const ok = await setSubscriberPrefs(email, normalized);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "could not save prefs" },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { ok: true, prefs: normalized },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
