// Pending vendor-submission queue · operator-triggerable inspection
// AND scheduled review-digest + email-independent staleness alarm.
//
// ─────────────────────────────────────────────────────────────────
// Why this route does MORE than list (incident 2026-05-16, 3rd
// recurrence of "I'm not getting vendor submission emails"):
//
// Root cause of the recurrence was NEVER the send path. The
// per-submission notification (POST /api/submit-vendor → after() →
// notifyOnSubmission → Resend) was provably healthy every time:
// Resend accepted every message and the inbox received every message.
// The break was at a boundary the codebase cannot see: the receiving
// mailbox's own handling kept the notification from surfacing. Prior fixes (M4
// result-typing, M5 after()) hardened the send path and so could
// not fix a mail-surfacing problem. A single best-effort push email,
// whose human-visibility depends on drifting external mail config,
// with no pull backstop and no health signal, recurs silently
// forever no matter how robust the send code is.
//
// The durable fix is architectural, two-channel:
//
//   1. Scheduled DIGEST (best-effort convenience). One consolidated
//      email/day when the queue is non-empty, in a DISTINCT subject
//      namespace from the per-submission "[Galaxy Mind] New vendor:"
//      pushes — so the operator can pin ONE stable inbox rule to
//      force it visible. Only sent when count>0: a daily "0 pending"
//      email would retrain the operator to ignore the channel, which
//      is exactly the failure mode that buried the per-submission
//      mails in the first place.
//
//   2. Email-INDEPENDENT staleness alarm (the load-bearing layer).
//      When the oldest unreviewed submission is past the review SLA
//      we console.error AND return 503. A failing cron trips
//      Vercel's own cron-failure alerting + shows red in the Vercel
//      dashboard — a channel that does NOT pass through Resend or
//      any inbox at all, so it cannot be silently
//      filtered the way the notification emails were. This mirrors
//      the project's existing "crons fail loud on degraded
//      snapshot" posture (lib/snapshot-quality.ts).
//
// Net: even if every notification email is mis-surfaced again, a
// stranded queue now self-announces through a path the operator's
// mail configuration cannot suppress. Silent recurrence is
// structurally impossible.
// ─────────────────────────────────────────────────────────────────
//
// Still also the CLI-friendly inspection twin of
// /api/admin/pending-submissions: `vercel crons run` is the only
// Vercel-CLI mechanism that attaches CRON_SECRET automatically, so
// the operator can eyeball the queue any time via:
//
//   vercel crons run /api/cron/list-pending-submissions
//
// The JSON response contract (ok/count/submissions/asOf) is
// preserved unchanged so that CLI use and any existing consumer
// keep working; the digest + alarm are additive.

import { NextRequest, NextResponse } from "next/server";
import { kvList } from "@/lib/kv";
import { NOTIFY_FAILED_KEY } from "@/lib/submission-notify";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { listPendingSubmissions } from "@/lib/vendor-submissions";
import { isKvConfigured, kvGet, kvSet } from "@/lib/kv";
import { sendTransactionalEmail } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The /submit endpoint promises vendors "We review within 24-48
// hours". 48h is therefore the contractually-consistent SLA: a
// submission older than this isn't just "waiting", it's past the
// commitment already shown to the submitter. Past SLA → loud +
// failing cron.
const REVIEW_SLA_HOURS = 48;

function fmtAge(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  if (h < 1) return "<1h";
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const rem = h % 24;
  return rem === 0 ? `${d}d` : `${d}d ${rem}h`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type DigestRow = {
  id: string;
  handle: string;
  name: string;
  platform: string;
  category: string;
  ageSeconds: number;
};

function renderDigest(
  rows: DigestRow[],
  oldestSeconds: number,
  pastSla: boolean,
): string {
  const accent = pastSla ? "#FB923C" : "#F7931A";
  const list = rows
    .map(
      (r) => `<tr>
  <td style="padding:8px 12px 8px 0;font-family:monospace;font-size:12px;color:#F2EFE9;vertical-align:top;white-space:nowrap;">${escapeHtml(r.handle)}</td>
  <td style="padding:8px 12px 8px 0;font-family:-apple-system,sans-serif;font-size:13px;color:#F2EFE9;vertical-align:top;">${escapeHtml(r.name)}<div style="color:#A5A096;font-size:11px;font-family:monospace;">${escapeHtml(r.platform)} · ${escapeHtml(r.category)}</div></td>
  <td style="padding:8px 0;font-family:monospace;font-size:12px;color:${r.ageSeconds >= REVIEW_SLA_HOURS * 3600 ? "#FB923C" : "#A5A096"};vertical-align:top;white-space:nowrap;">${fmtAge(r.ageSeconds)}</td>
</tr>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html><body style="background:#12110F;color:#F2EFE9;font-family:-apple-system,sans-serif;margin:0;padding:24px;">
<div style="max-width:600px;margin:0 auto;background:#1C1A16;border:1px solid #26262C;border-radius:12px;padding:24px;">
  <div style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.25em;color:${accent};margin-bottom:8px;">${pastSla ? "&#9888; review queue · past SLA" : "&#128229; review queue digest"}</div>
  <h2 style="margin:0 0 4px;font-size:24px;font-weight:600;letter-spacing:-0.01em;">${rows.length} submission${rows.length === 1 ? "" : "s"} awaiting review</h2>
  <div style="font-family:monospace;color:#A5A096;font-size:13px;margin-bottom:20px;">oldest: ${fmtAge(oldestSeconds)}${pastSla ? ` &#183; past the ${REVIEW_SLA_HOURS}h commitment shown to submitters` : ""}</div>
  <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">
    ${list}
  </table>
  <div style="margin-top:24px;padding:12px;background:#1C1C21;border-radius:6px;font-family:monospace;font-size:11px;color:#7ec0ff;line-height:1.6;">
    Review with:<br>
    <span style="color:#F2EFE9;">CRON_SECRET=&lt;your-secret&gt; npx tsx scripts/review-submissions.ts</span>
  </div>
  <div style="margin-top:16px;font-family:monospace;font-size:10px;color:#666;line-height:1.6;">
    Daily digest · independent of the per-submission notification email.<br>
    If this email itself stops arriving, the Vercel cron dashboard for
    /api/cron/list-pending-submissions is the email-independent backstop.
  </div>
</div>
</body></html>`;
}

// High-water mark for the only-new digest · the newest submittedAt
// already emailed. Submissions newer than this are "new" and get the
// digest; everything else is suppressed from the email (it stays in the
// queue, the log, and the JSON body).
const DIGEST_HWM_KEY = "submission:digest:lastNotifiedAt";

export async function GET(req: NextRequest) {
  const auth = await verifyCronAuthLimited(req);
  if (!auth.ok) return auth.response;
  // Cron liveness · best-effort, never throws (see lib/cron-health).
  await recordCronRun("list-pending-submissions");

  // L4 · explicitly distinguish "KV unavailable / unconfigured"
  // from "queue genuinely empty." Without this guard,
  // listPendingSubmissions returns [] in BOTH cases · the operator
  // running `vercel crons run /api/cron/list-pending-submissions`
  // sees count:0 and assumes nothing's pending, when in fact KV is
  // down and the queue is unreadable. 503 + log surfaces the real
  // state in cron logs.
  if (!isKvConfigured()) {
    console.error(
      `[list-pending-submissions] KV not configured · cannot read pending queue`,
    );
    return NextResponse.json(
      {
        ok: false,
        error: "KV not configured · pending queue is unreadable, NOT empty",
      },
      { status: 503 },
    );
  }

  // Failed submitter notifications (2026-08-20).
  //
  // A failed REJECTION send is otherwise lost forever: the Sunday
  // new-vendor-digest can retry an approval because it re-reads
  // the vendor-notify key for vendors that entered VENDORS, but a
  // rejected vendor never enters VENDORS, so nothing looks at it again.
  // One capped list read per day is the cheapest possible backstop, and
  // it rides an existing cron rather than adding one.
  const notifyFailures = await kvList<{
    handle: string;
    vendorName: string;
    code: string;
    error: string;
  }>(NOTIFY_FAILED_KEY, 50);
  if (notifyFailures.length > 0) {
    console.error(
      `[list-pending-submissions] ${notifyFailures.length} submitter notification(s) FAILED and nobody was told · ` +
        notifyFailures
          .map((f) => `${f.vendorName}(${f.code}): ${f.error}`)
          .join(" | "),
    );
  }

  const submissions = await listPendingSubmissions();

  // Only-new digest (2026-06-02): the daily email used to list the
  // ENTIRE pending backlog, so it grew unbounded whenever the operator
  // fell behind on review. Now we email only submissions newer than the
  // last digest's high-water mark, and skip the email entirely when
  // nothing is new. The full queue is still logged (count + ids),
  // returned in the JSON body, and escalated by the email-independent
  // staleness 503 below · a neglected backlog is not hidden, the routine
  // inbox spam just stops.
  const lastNotifiedAt = (await kvGet<number>(DIGEST_HWM_KEY)) ?? 0;
  const newSubmissions = submissions.filter(
    (s) => typeof s.submittedAt === "number" && s.submittedAt > lastNotifiedAt,
  );

  // Compact summary · one line per submission. The full record is
  // available in `submissions` for any consumer that wants more.
  const summary = submissions.map((s) => ({
    id: s.id,
    submittedAt: new Date(s.submittedAt * 1000).toISOString(),
    handle: s.vendor.handle,
    name: s.vendor.name,
    platform: s.vendor.platform ?? "x",
    category: s.vendor.category,
    country: s.vendor.country ?? null,
    description: s.vendor.description,
    website: s.vendor.website ?? null,
    flags: s.flags ?? [],
    lightningAddress: s.vendor.lightningAddress ?? null,
    founderName: s.vendor.founderName ?? null,
    shipsInternational: s.vendor.shipsInternational ?? false,
    tradeFriendly: s.vendor.tradeFriendly ?? false,
    submitterNote: s.submitterNote ?? null,
  }));

  // Log ONLY count + opaque IDs. The full records (incl. submitterNote
  // — explicitly "optional contact/message from the submitter", plus
  // founderName/website/lightningAddress) are third-party PII; writing
  // them to the Vercel log sink gave them a longer, more widely-
  // readable retention model than the 30-day-TTL KV record, and is a
  // confidentiality regression vs the codebase's PII hygiene elsewhere
  // (e.g. /api/unsubscribe deliberately never echoes emails). Anyone
  // who legitimately needs the full queue calls the authenticated JSON
  // response below (or /api/admin/pending-submissions) — the verbose
  // log dump was redundant for authorized callers and a free PII
  // harvest for anyone with mere log-read access. (Audit 2026-05 H6.)
  console.log(
    `[list-pending-submissions] count=${summary.length} · ids=` +
      JSON.stringify(summary.map((s) => s.id)),
  );

  // ── Digest + staleness alarm ────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  const ages = submissions.map((s) => nowSec - s.submittedAt);
  const oldestSeconds = ages.length ? Math.max(...ages) : 0;
  const pastSla = oldestSeconds >= REVIEW_SLA_HOURS * 3600;

  if (newSubmissions.length > 0) {
    const to = process.env.SUBMISSION_NOTIFY_EMAIL;
    if (to) {
      const rows: DigestRow[] = newSubmissions
        // Oldest first · action the most-overdue of the NEW batch first.
        .map((s) => ({
          id: s.id,
          handle: s.vendor.handle,
          name: s.vendor.name,
          platform: s.vendor.platform ?? "x",
          category: s.vendor.category,
          ageSeconds: nowSec - s.submittedAt,
        }))
        .sort((a, b) => b.ageSeconds - a.ageSeconds);
      const newCount = newSubmissions.length;
      // DISTINCT subject namespace from the per-submission
      // "[Galaxy Mind] New vendor:" pushes so the operator can pin a
      // single stable inbox rule to this digest specifically. Counts
      // only the NEW submissions; the ⚠ variant still fires when the
      // overall queue is past SLA so a stale backlog stays visible.
      const subject = pastSla
        ? `[Galaxy Mind] ⚠ ${newCount} new vendor submission${newCount === 1 ? "" : "s"} · queue oldest ${fmtAge(oldestSeconds)} (past SLA)`
        : `[Galaxy Mind] 📥 ${newCount} new vendor submission${newCount === 1 ? "" : "s"} to review`;
      const r = await sendTransactionalEmail({
        to,
        subject,
        html: renderDigest(rows, oldestSeconds, pastSla),
      });
      // Best-effort · the digest is the convenience channel. Its
      // failure is logged but does NOT itself fail the cron; the
      // staleness 503 below is the load-bearing email-independent
      // signal and must not be masked by a Resend hiccup.
      if (!r.ok) {
        console.error(
          `[list-pending-submissions] digest email failed · ${r.error}`,
        );
      } else {
        console.log(
          `[list-pending-submissions] digest sent · ${newCount} new · resend=${r.data.id}`,
        );
        // Advance the high-water mark ONLY after a successful send, so a
        // Resend failure doesn't permanently skip these new submissions.
        // Set to the newest submittedAt across the whole pending set ·
        // everything currently queued is now "seen" and won't re-email.
        const maxSubmittedAt = Math.max(
          ...submissions.map((s) => s.submittedAt),
        );
        await kvSet(DIGEST_HWM_KEY, maxSubmittedAt);
      }
    } else {
      console.error(
        `[list-pending-submissions] SUBMISSION_NOTIFY_EMAIL unset · digest skipped (${newSubmissions.length} new · ${summary.length} total pending)`,
      );
    }
  } else if (summary.length > 0) {
    console.log(
      `[list-pending-submissions] no new submissions since last digest · ${summary.length} still pending · email suppressed`,
    );
  }

  // Email-independent staleness alarm. Past SLA → loud log + 503 so
  // the Vercel cron dashboard shows this job FAILING and Vercel's own
  // cron-failure notification fires. That alert path does not pass
  // through Resend or any inbox, so it cannot be silently
  // filtered the way the notification emails were. The full queue is
  // still returned in the body so an operator inspecting via
  // `vercel crons run` sees the data alongside the failure.
  if (pastSla) {
    console.error(
      `[list-pending-submissions] STALE QUEUE · ${summary.length} pending · oldest ${fmtAge(oldestSeconds)} · past ${REVIEW_SLA_HOURS}h review SLA · ids=` +
        JSON.stringify(summary.map((s) => s.id)),
    );
    return NextResponse.json(
      {
        ok: false,
        error: `stale queue · oldest pending submission is ${fmtAge(oldestSeconds)} old, past the ${REVIEW_SLA_HOURS}h review SLA`,
        count: summary.length,
        oldestAgeHours: Math.floor(oldestSeconds / 3600),
        submissions: summary,
        asOf: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    count: summary.length,
    submissions: summary,
    notifyFailures: notifyFailures.length,
    asOf: new Date().toISOString(),
  });
}
