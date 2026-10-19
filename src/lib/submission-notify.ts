// Shared submitter-notification path for the moderation queue.
//
// WHY A LIB AND NOT JUST THE ENDPOINT (2026-08-20). There are four ways
// a submission gets finalized — the review CLI, scripts/reject-
// submission.ts, scripts/clear-pending-submissions.ts, and the browser
// admin UI — and before this only ONE of them could notify anybody,
// behind a prompt that defaulted to no. Whether a declined merchant
// heard anything depended on which tool the operator happened to reach
// for, which is not a policy, it is an accident.
//
// All four already funnel through /api/admin/finalize-submission, so
// that route is the choke point where notification becomes structural.
// This module holds the send so the route and the older
// /api/admin/notify-submitter endpoint share one implementation instead
// of drifting apart.

import { isKvConfigured, kvPushCapped } from "@/lib/kv";
import {
  renderSubmissionRejectedEmail,
  renderVendorLiveEmail,
  sendTransactionalEmail,
} from "@/lib/email";
import { vendorSlug } from "@/lib/vendors";
import {
  clearVendorNotify,
  readVendorNotify,
  type NotifyAddress,
} from "@/lib/vendor-notify-key";
import {
  OUTCOMES,
  type OutcomeCode,
  dmHandoffText,
  profileUrlFor,
  renderOutcomeBody,
} from "@/lib/submission-outcomes";

/**
 * Capped list of sends that failed, read by the daily
 * list-pending-submissions cron.
 *
 * This exists because a failed REJECTION send is otherwise lost
 * forever: the Sunday new-vendor-digest can retry an approval (it
 * re-reads the vendor-notify key for vendors that entered VENDORS),
 * but a rejected vendor never enters VENDORS, so nothing ever looks at
 * it again. One capped key costs one KV read per day, which is why this
 * is a list rather than a new cron.
 */
export const NOTIFY_FAILED_KEY = "gm:submission:notify-failed";
const NOTIFY_FAILED_CAP = 50;

export type NotifyResult =
  | { notified: "sent" }
  | { notified: "silent"; code: OutcomeCode }
  | {
      notified: "no-address";
      handoff: { profileUrl: string; text: string };
    }
  | { notified: "failed"; error: string }
  | { notified: "skipped"; reason: string };

/**
 * Notify a submitter about a decision.
 *
 * NEVER throws. A notification problem must not fail the decision that
 * triggered it — the record is already finalized by the time this runs,
 * and surfacing a 502 here would make the operator re-run the whole
 * command against an already-rejected submission.
 */
export async function sendSubmissionOutcome(opts: {
  handle: string;
  platform?: string;
  vendorName: string;
  /** Rejection outcome code. Omit for an approval. */
  code?: OutcomeCode;
  /** Operator's optional extra sentence, submitter-facing. */
  note?: string;
}): Promise<NotifyResult> {
  const { handle, vendorName, platform, code, note } = opts;

  // Silent codes short-circuit BEFORE any KV read. A spam flood must
  // not turn into a KV-command flood.
  if (code && !OUTCOMES[code].notifies) {
    return { notified: "silent", code };
  }

  if (!isKvConfigured()) {
    return { notified: "skipped", reason: "KV not configured" };
  }

  let notifyEmail: string | null = null;
  let addr: NotifyAddress | null = null;
  try {
    addr = await readVendorNotify(handle, vendorName);
    notifyEmail = addr?.email ?? null;
  } catch {
    return { notified: "failed", error: "KV read failed" };
  }

  if (!notifyEmail || typeof notifyEmail !== "string") {
    // No address on file. The handle is always present, but there is no
    // DM sender in this repo (and adding one means an nsec in Vercel env
    // or an X scope we do not hold), so hand the operator a paste-ready
    // message instead of dropping the outcome on the floor.
    if (!code) return { notified: "no-address", handoff: { profileUrl: "", text: "" } };
    return {
      notified: "no-address",
      handoff: {
        profileUrl: profileUrlFor(handle, platform),
        text: dmHandoffText(vendorName, code, note),
      },
    };
  }

  const rendered = code
    ? (() => {
        const { message, remedy } = renderOutcomeBody(code, note);
        return renderSubmissionRejectedEmail({
          vendorName,
          reason: message,
          remedy,
        });
      })()
    : renderVendorLiveEmail({
        vendorName,
        vendorSlug: vendorSlug({ name: vendorName }),
      });

  const send = await sendTransactionalEmail({
    to: notifyEmail,
    subject: rendered.subject,
    html: rendered.html,
  });

  if (!send.ok) {
    console.error(
      `[submission-notify] send failed · handle=${handle} code=${code ?? "live"} · ${send.error}`,
    );
    // Record it so the daily cron can surface it. Best-effort: if even
    // this write fails there is nothing further to do, and the log line
    // above is still on record.
    await kvPushCapped(
      NOTIFY_FAILED_KEY,
      { handle, vendorName, code: code ?? "live", error: send.error },
      NOTIFY_FAILED_CAP,
    ).catch(() => {});
    // The key is deliberately LEFT in place. For an approval the Sunday
    // digest will retry it; for a rejection it ages out on its own TTL.
    return { notified: "failed", error: send.error };
  }

  if (addr) await clearVendorNotify(addr);
  return { notified: "sent" };
}
