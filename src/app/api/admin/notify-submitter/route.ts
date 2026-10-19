// POST /api/admin/notify-submitter · auth-gated one-shot submitter
// notification for the review CLI (scripts/review-submissions.ts).
//
// The /submit form stores a required "email me the outcome" address
// in KV as `vendor-notify:<handle>:<slug>` (lib/vendor-notify-key) (90-day TTL). Before this endpoint
// existed, that key was only consumed by the WEEKLY new-vendor-digest
// cron, so an approval email could lag the actual approval by up to
// ~7 days · a broken promise for a form that says "one-shot
// notification when your submission lands." The review CLI now calls
// this endpoint at decision time; the digest cron's per-submitter loop
// stays as the fallback (CLI offline, this endpoint erroring, operator
// approved-but-didn't-push). Whichever path sends first deletes the
// key, so the other can't double-send.
//
// The CLI runs on the operator's laptop with no KV credentials · it
// can only reach KV through an admin endpoint, same reason
// finalize-submission exists.
//
// Body:
//   { handle: string, name: string, kind: "live" }
//   { handle: string, name: string, kind: "rejected", reason: string }
//
// Responses (200 unless noted):
//   { ok: true,  sent: true }                 · email delivered, KV key cleared
//   { ok: true,  sent: false, reason: "..." } · nothing to send (no key / no KV)
//   { ok: false, error: "..." }               · 4xx validation / 502 send failure
//     (on 502 the KV key is intentionally LEFT so the digest cron retries)
//
// Auth: Bearer ADMIN_SECRET (preferred) or CRON_SECRET fallback.

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuthLimited } from "@/lib/cron-auth";
import { isKvConfigured } from "@/lib/kv";
import {
  renderSubmissionRejectedEmail,
  renderVendorLiveEmail,
  sendTransactionalEmail,
} from "@/lib/email";
import { vendorSlug } from "@/lib/vendors";
import { clearVendorNotify, readVendorNotify } from "@/lib/vendor-notify-key";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await verifyAdminAuthLimited(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "body must be object" },
      { status: 400 },
    );
  }
  const b = body as Record<string, unknown>;

  const handle = typeof b.handle === "string" ? b.handle.trim() : "";
  if (!handle || handle.length > 200) {
    return NextResponse.json(
      { ok: false, error: "handle required (max 200 chars)" },
      { status: 400 },
    );
  }
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 100) {
    return NextResponse.json(
      { ok: false, error: "name required (max 100 chars)" },
      { status: 400 },
    );
  }
  const kind = b.kind;
  if (kind !== "live" && kind !== "rejected") {
    return NextResponse.json(
      { ok: false, error: 'kind must be "live" or "rejected"' },
      { status: 400 },
    );
  }
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (kind === "rejected" && (!reason || reason.length > 1000)) {
    return NextResponse.json(
      { ok: false, error: "reason required for rejection (max 1000 chars)" },
      { status: 400 },
    );
  }

  if (!isKvConfigured()) {
    return NextResponse.json({
      ok: true,
      sent: false,
      reason: "KV not configured · no notify addresses exist",
    });
  }

  const addr = await readVendorNotify(handle, name);
  const notifyEmail = addr?.email ?? null;
  if (!addr || !notifyEmail) {
    return NextResponse.json({
      ok: true,
      sent: false,
      reason: "no notify email on file for this handle",
    });
  }

  const rendered =
    kind === "live"
      ? renderVendorLiveEmail({
          vendorName: name,
          vendorSlug: vendorSlug({ name }),
        })
      : renderSubmissionRejectedEmail({ vendorName: name, reason });

  const send = await sendTransactionalEmail({
    to: notifyEmail,
    subject: rendered.subject,
    html: rendered.html,
  });
  if (!send.ok) {
    // Leave `vendor-notify:<handle>:<slug>` (lib/vendor-notify-key) in place · for "live" the Sunday
    // digest cron retries the send; for "rejected" the key just ages
    // out on its 90-day TTL (a rejected vendor never enters VENDORS,
    // so the cron can't accidentally fire a "you're live" for it).
    console.error(
      `[admin/notify-submitter] send failed · kind=${kind} handle=${handle} · ${send.error}`,
    );
    return NextResponse.json(
      { ok: false, error: send.error },
      { status: 502 },
    );
  }

  // One-shot: clear the key so the digest cron can't double-send.
  await clearVendorNotify(addr);
  return NextResponse.json({ ok: true, sent: true });
}
