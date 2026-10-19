// Weekly /fit allocation-change cron — Sundays at 13:30 UTC.
//
// Iterates every subscriber, reads their per-email fit-alert record
// (the (h, t, a) tuple + last snapshot they were shown), recomputes
// recommend() against the current market snapshot, and emails them
// when the diff is "meaningful" (sleeve added/removed OR any weight
// delta >=5pp · per diffAllocations in lib/fit-alert).
//
// Scheduling: 30 minutes after weekly-digest so they don't compete
// for Resend send slots / Vercel fn cold-starts. Same Sunday cadence
// matches the user-facing "weekly check" mental model.
//
// Snapshot-quality gate: refuses to fire when ≥4/8 market signals
// are null (per isMarketSnapshotDegraded). A degraded snapshot would
// silently swap sleeves around the WARM-50 fallback and emit a flurry
// of nonsense "your portfolio changed" emails during an upstream
// outage · same gate the threshold/digest crons enforce.

import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";
import {
  listSubscribers,
  renderFitChangeEmail,
  sendTransactionalEmail,
  unsubscribeHeadersFor,
} from "@/lib/email";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { getSubscriberPrefs } from "@/lib/subscribe-flow";
import { kvGet, kvSet } from "@/lib/kv";
import { recommend } from "@/lib/recommend";
import {
  diffAllocations,
  fitAlertKey,
  marketSignalsFrom,
  snapshotFromRec,
  type FitAlertRecord,
} from "@/lib/fit-alert";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PerSubResult =
  | { email: string; action: "skip"; reason: string }
  | { email: string; action: "no-change" }
  | {
      email: string;
      action: "sent";
      kind: "composition" | "weight";
    }
  | { email: string; action: "error"; reason: string };

export async function GET(request: Request) {
  const auth = await verifyCronAuthLimited(request);
  if (!auth.ok) return auth.response;
  // Cron liveness · best-effort, never throws (see lib/cron-health).
  await recordCronRun("check-fit-changes");

  const snapshot = await getMarketSnapshot();
  if (isMarketSnapshotDegraded(snapshot)) {
    return NextResponse.json(
      { ok: false, error: "snapshot degraded · skipping fit-change check" },
      { status: 503 },
    );
  }
  const signals = marketSignalsFrom(snapshot);

  const subs = await listSubscribers();
  if (!subs.ok) {
    return NextResponse.json(
      { ok: false, error: subs.error },
      { status: 500 },
    );
  }

  const results: PerSubResult[] = [];
  let sent = 0;
  let errors = 0;
  let optedIn = 0;

  // Per-subscriber sequential loop · with O(tens) of subscribers and
  // the cron's 5-min Vercel budget this is fine. If audience grows
  // 10x, switch to chunked Promise.all (Resend ratelimit is generous
  // but the recommend() call is pure-CPU so chunking gives no async
  // win · just split into batches of ~20 with a short delay).
  for (const email of subs.data.emails) {
    const prefs = await getSubscriberPrefs(email);
    if (!prefs.notifyOnFitChange) {
      // Quietly skip · the vast majority of subs haven't opted in
      // to this channel, so we don't want to log each one.
      continue;
    }
    optedIn++;
    const record = await kvGet<FitAlertRecord>(fitAlertKey(email));
    if (!record) {
      // Pref says yes but no baseline record · either KV race during
      // opt-in (rare) or manual pref toggle without going through the
      // /fit opt-in flow. Skip silently · we can't compute a diff
      // without a baseline, and the next opt-in pass will set one.
      results.push({
        email,
        action: "skip",
        reason: "no fit-alert baseline",
      });
      continue;
    }

    let nextSnapshot: ReturnType<typeof snapshotFromRec>;
    try {
      const rec = recommend({
        horizonYears: record.h,
        volatilityTolerance: record.t,
        accountType: record.a,
        ...signals,
      });
      nextSnapshot = snapshotFromRec(rec);
    } catch (e) {
      console.error(
        `[cron/check-fit-changes] recommend() threw for ${email}:`,
        e,
      );
      errors++;
      results.push({
        email,
        action: "error",
        reason: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    const diff = diffAllocations(record.lastRec, nextSnapshot);
    if (!diff.changed) {
      results.push({ email, action: "no-change" });
      continue;
    }

    const { subject, html } = renderFitChangeEmail({
      recipientEmail: email,
      h: record.h,
      t: record.t,
      a: record.a,
      diff,
      prev: record.lastRec,
      next: nextSnapshot,
      lastSentAt: record.lastSentAt > 0 ? record.lastSentAt : null,
    });

    const send = await sendTransactionalEmail({
      to: email,
      subject,
      html,
      headers: unsubscribeHeadersFor(email),
    });

    if (!send.ok) {
      console.error(
        `[cron/check-fit-changes] send failed for ${email}:`,
        send.error,
      );
      errors++;
      results.push({
        email,
        action: "error",
        reason: send.error,
      });
      // Don't update lastRec on send failure · next week's cron
      // sees the same diff and retries.
      continue;
    }

    // Send succeeded · persist the new baseline so next week's
    // diff is against what we just emailed (not what they originally
    // opted in with). lastSentAt is the timestamp shown in the next
    // email's "since [date]" line.
    const updated: FitAlertRecord = {
      ...record,
      lastRec: nextSnapshot,
      lastSentAt: Date.now(),
    };
    const persisted = await kvSet(fitAlertKey(email), updated);
    if (!persisted) {
      // Sent but couldn't persist · log loudly. Next week we'll
      // re-send the same diff, which is annoying but not harmful
      // (the change is real). Better than the inverse (silently
      // marking sent when KV failed → missing a real change).
      console.error(
        `[cron/check-fit-changes] sent but kvSet failed for ${email}`,
      );
    }
    sent++;
    results.push({ email, action: "sent", kind: diff.kind });
  }

  return NextResponse.json({
    ok: true,
    totalSubscribers: subs.data.emails.length,
    optedIn,
    sent,
    errors,
    // Cap the per-email detail at 50 to keep the response body
    // sane in Vercel cron logs · the aggregate counters above are
    // the durable signal.
    results: results.slice(0, 50),
  });
}
