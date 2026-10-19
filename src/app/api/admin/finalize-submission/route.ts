// POST /api/admin/finalize-submission · auth-gated decision endpoint
// for the review CLI. Marks a submission approved or rejected in
// the KV moderation queue.
//
// Body:
//   { id: string, status: "approved", approvedAsAddedAt: number,
//     ownershipConfirmedByDm?: true }   (required when the record is
//     flagged existing-handle without ownership evidence · 409 otherwise)
//   { id: string, status: "rejected", reason: string,
//     outcome?: { code: OutcomeCode, note?: string } }
//
// NOTIFICATION (2026-08-20). All four reject paths — the review CLI,
// reject-submission.ts, clear-pending-submissions.ts and the browser
// admin UI — funnel through here, so this is where telling the
// submitter becomes structural instead of a prompt someone remembers.
// Supply `outcome.code` and the decision notifies by construction; the
// code itself decides whether it is a notifying or a silent outcome
// (see lib/submission-outcomes). Omitting `outcome` preserves the old
// behaviour for any caller not yet updated.
//
// `reason` remains the PRIVATE audit note and is never sent. The
// submitter-facing copy comes from the outcome code.
//
// APPROVALS deliberately do NOT notify here: the browser admin UI only
// MARKS a submission approved, while the vendors.ts write still happens
// in scripts/review-submissions.ts. Sending "you are live" at mark time
// would be a false statement. The CLI notifies at the point the vendor
// actually goes live, and the Sunday digest is its fallback.
//
// Auth: Bearer CRON_SECRET

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuthLimited } from "@/lib/cron-auth";
import { finalizeSubmission, getSubmission } from "@/lib/vendor-submissions";
import { sendSubmissionOutcome } from "@/lib/submission-notify";
import { isOutcomeCode, type OutcomeCode } from "@/lib/submission-outcomes";

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
  const id = typeof b.id === "string" ? b.id : "";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "id required" },
      { status: 400 },
    );
  }
  const status = b.status;
  if (status === "approved") {
    const approvedAsAddedAt =
      typeof b.approvedAsAddedAt === "number" ? b.approvedAsAddedAt : 0;
    if (!approvedAsAddedAt) {
      return NextResponse.json(
        { ok: false, error: "approvedAsAddedAt required for approval" },
        { status: 400 },
      );
    }
    // Multi-shop ownership gate (2026-10 · lib/vendor-dedupe). A new
    // storefront under a handle that already owns a listing needs proof:
    // the intake backlink / nostr.json check, or the reviewer attesting a
    // DM from the ACCOUNT (not the submitter, who may be an impostor).
    const record = await getSubmission(id);
    if (!record) return NextResponse.json({ ok: false }, { status: 404 });
    const needsProof =
      record.flags?.includes("existing-handle") === true &&
      record.ownershipCheck?.ok !== true;
    const dmConfirmed = b.ownershipConfirmedByDm === true;
    if (needsProof && !dmConfirmed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "ownership proof required · this handle already owns a listing and no backlink/nostr.json was found. Confirm with the account by DM, then resend with ownershipConfirmedByDm: true",
        },
        { status: 409 },
      );
    }
    const ok = await finalizeSubmission(id, {
      status: "approved",
      approvedAsAddedAt,
      ...(needsProof && dmConfirmed
        ? {
            ownershipCheck: {
              checkedAt: Math.floor(Date.now() / 1000),
              ok: true,
              method: "dm" as const,
              detail: "reviewer confirmed by DM from the account",
            },
          }
        : {}),
    });
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  }
  if (status === "rejected") {
    const reason = typeof b.reason === "string" ? b.reason.trim() : "";
    // Cap free-text · admin-auth'd but still bound the KV write. Raised
    // from 1000 to 4000 on 2026-08-20: the old cap existed because this
    // string was also the email body, and it silently made the three
    // most carefully reasoned rejections on file undeliverable (2,177 /
    // 1,538 / 1,349 chars against a 1,000 cap). Now that the submitter
    // sees outcome-code copy instead, this field is a private audit
    // note and should have room to actually say what was found.
    if (!reason || reason.length > 4000) {
      return NextResponse.json(
        {
          ok: false,
          error: "reason required for rejection (max 4000 chars)",
        },
        { status: 400 },
      );
    }

    let outcomeCode: OutcomeCode | undefined;
    let outcomeNote: string | undefined;
    if (b.outcome !== undefined) {
      if (!b.outcome || typeof b.outcome !== "object") {
        return NextResponse.json(
          { ok: false, error: "outcome must be an object" },
          { status: 400 },
        );
      }
      const o = b.outcome as Record<string, unknown>;
      if (!isOutcomeCode(o.code)) {
        return NextResponse.json(
          { ok: false, error: "outcome.code is not a known outcome code" },
          { status: 400 },
        );
      }
      outcomeCode = o.code;
      const note = typeof o.note === "string" ? o.note.trim() : "";
      if (note.length > 500) {
        return NextResponse.json(
          { ok: false, error: "outcome.note too long (max 500 chars)" },
          { status: 400 },
        );
      }
      outcomeNote = note || undefined;
    }

    // Read BEFORE finalizing · we need handle/name/platform to notify,
    // and after the write the record is the same shape anyway. Reading
    // first also means a missing id 404s without a wasted write.
    const record = await getSubmission(id);
    if (!record) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    const ok = await finalizeSubmission(id, {
      status: "rejected",
      reason,
      ...(outcomeCode
        ? { outcome: { code: outcomeCode, note: outcomeNote } }
        : {}),
    });
    if (!ok) return NextResponse.json({ ok }, { status: 404 });

    // Notification never fails the decision · the record is already
    // finalized, and a 502 here would push the operator into re-running
    // the command against an already-rejected submission.
    const notify = outcomeCode
      ? await sendSubmissionOutcome({
          handle: record.vendor.handle,
          platform: record.vendor.platform,
          vendorName: record.vendor.name,
          code: outcomeCode,
          note: outcomeNote,
        })
      : { notified: "skipped" as const, reason: "no outcome code supplied" };

    return NextResponse.json({ ok, notify });
  }
  return NextResponse.json(
    { ok: false, error: 'status must be "approved" or "rejected"' },
    { status: 400 },
  );
}
