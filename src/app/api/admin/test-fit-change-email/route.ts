// POST /api/admin/test-fit-change-email · operator-triggered one-time
// test send of the /fit allocation-change email template.
//
// Why this exists:
// The check-fit-changes cron only fires a real email when an actual
// engine shift produces a ≥5pp weight delta or sleeve add/remove vs
// a subscriber's stored baseline. For a freshly opted-in subscriber
// (or a calm market) there's no immediate inbox confirmation that
// the template renders correctly. This endpoint sends a synthetic
// fit-change email (using mock prev/next allocations) to ONE
// operator-specified email so they can eyeball the actual rendering
// in their mail client.
//
// Auth: Bearer CRON_SECRET (same pattern as the other admin routes).
//
// Body:
//   { email: string }    // recipient
//
// Side effects:
//   - One transactional email send via Resend (counts toward quota)
//   - No KV writes, no audience changes, no state mutation
//
// Limits:
//   - Recipient must look like a valid email (cheap regex)
//   - No per-email rate limit (operator-only, behind CRON_SECRET)

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuthLimited } from "@/lib/cron-auth";
import {
  renderFitChangeEmail,
  sendTransactionalEmail,
  unsubscribeHeadersFor,
} from "@/lib/email";
import type { SleeveSnapshot } from "@/lib/fit-alert";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Mock allocations · realistic Moderate (t=4) 10y Roth profile where
// the engine has re-routed MSTR weight into income sleeves after a
// signal shift. Same scenario the preview-emails.ts script uses for
// the weight-diff variant.
const MOCK_PREV: SleeveSnapshot[] = [
  { ticker: "MSTR", weight: 40 },
  { ticker: "BTC", weight: 25 },
  { ticker: "STRC", weight: 20 },
  { ticker: "MPJPY", weight: 15 },
];
const MOCK_NEXT: SleeveSnapshot[] = [
  { ticker: "MSTR", weight: 31 }, // -9pp
  { ticker: "BTC", weight: 25 },
  { ticker: "STRC", weight: 24 }, // +4pp (under threshold)
  { ticker: "MPJPY", weight: 20 }, // +5pp
];

export async function POST(req: NextRequest) {
  const auth = await verifyAdminAuthLimited(req);
  if (!auth.ok) return auth.response;

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (
    email.length === 0 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid email" },
      { status: 400 },
    );
  }

  const rendered = renderFitChangeEmail({
    recipientEmail: email,
    h: 10,
    t: 4,
    a: "roth",
    diff: {
      changed: true,
      kind: "weight",
      added: [],
      removed: [],
      shifted: [
        { ticker: "MSTR", prevWeight: 40, nextWeight: 31, deltaPp: -9 },
        { ticker: "MPJPY", prevWeight: 15, nextWeight: 20, deltaPp: 5 },
      ],
    },
    prev: MOCK_PREV,
    next: MOCK_NEXT,
    lastSentAt: Date.now() - 7 * 24 * 3600 * 1000,
  });

  // Tag the subject so a recipient can tell this is a test, not a
  // real engine-driven email.
  const testSubject = `[TEST] ${rendered.subject}`;

  const sent = await sendTransactionalEmail({
    to: email,
    subject: testSubject,
    html: rendered.html,
    headers: unsubscribeHeadersFor(email),
  });

  if (!sent.ok) {
    console.error(
      "[/api/admin/test-fit-change-email] send failed for",
      email,
      ":",
      sent.error,
    );
    return NextResponse.json(
      { ok: false, error: sent.error, statusCode: sent.statusCode },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    sent: true,
    to: email,
    subject: testSubject,
    note: "Mock weight-diff scenario · MSTR -9pp, MPJPY +5pp. Not real engine output.",
  });
}
