// Weekly digest cron — Sundays at 13:00 UTC (~9am ET / 6am PT).
//
// Pulls the last 7 days from stack:history KV, summarizes (min/avg/max),
// finds the top signal contributor for the current verdict, and emails
// only subscribers who opted IN to the digest (digestEnabled in their
// prefs). Keeps the alert-only audience untouched — digest is opt-in,
// alerts are opt-in by signing up at all.
//
// Trigger: Vercel cron, "0 13 * * 0" (Sundays 13:00 UTC). See vercel.json.

import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market";
import { computeStackVerdict, TIER_LABEL } from "@/lib/stack";
import { computeForecast, pickBestWindow } from "@/lib/forecast";
import { kvList } from "@/lib/kv";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";
import {
  listSubscribers,
  renderDigestEmail,
  sendAlertBatch,
  type SendAlertResult,
} from "@/lib/email";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { getSubscriberPrefs } from "@/lib/subscribe-flow";
import type { StackSnapshot } from "../snapshot-stack/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Degraded-snapshot guard imported from lib/snapshot-quality.ts ·
// shared with check-thresholds and snapshot-stack so the threshold
// can't drift between consumers. A digest based on a degraded score
// is misleading — better to skip a week than publish bad numbers.

export async function GET(request: Request) {
  const auth = await verifyCronAuthLimited(request);
  if (!auth.ok) return auth.response;
  // Cron liveness · best-effort, never throws (see lib/cron-health).
  await recordCronRun("weekly-digest");

  const snapshot = await getMarketSnapshot();
  if (isMarketSnapshotDegraded(snapshot)) {
    return NextResponse.json(
      { ok: false, error: "snapshot degraded · skipping digest" },
      { status: 503 },
    );
  }
  // Capture "now" once so the verdict's hour-of-day signal and the
  // forecast's "current cell" agree even if a clock-hour boundary
  // falls between the two computations · audit 2026-05-14 finding H-2.
  const nowMs = Date.now();
  const verdict = computeStackVerdict(snapshot, nowMs);
  const forecast = computeForecast(snapshot, verdict, nowMs);
  const bestWindow = pickBestWindow(forecast);

  // Pull 7 days of history. If KV is unset / empty, we still send a
  // digest with current-only stats (low/avg/max all = current score).
  const recent = (await kvList<StackSnapshot>("stack:history", 7)).reverse();
  const includedDays = recent.length;
  const scores = recent.length > 0
    ? recent.map((s) => s.score).filter((n) => Number.isFinite(n))
    : [verdict.score];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  // Top contributor: from the LIVE verdict's signals, pick the one
  // with the largest |normalized - 50| × weight. Mirrors the
  // buildSummary() logic in lib/stack.ts.
  const topContributor = (() => {
    const live = verdict.signals.filter((s) => s.raw != null && s.weight > 0);
    if (live.length === 0) return null;
    const sorted = [...live].sort(
      (a, b) =>
        b.weight * Math.abs(b.normalized - 50) -
        a.weight * Math.abs(a.normalized - 50),
    );
    return sorted[0]?.name ?? null;
  })();

  // Filter subscribers to those who opted into the digest.
  const subs = await listSubscribers();
  if (!subs.ok) {
    return NextResponse.json(
      { ok: false, error: subs.error },
      { status: 500 },
    );
  }
  const allPrefs = await Promise.all(
    subs.data.emails.map(async (email) => ({
      email,
      prefs: await getSubscriberPrefs(email),
    })),
  );
  const recipients = allPrefs
    .filter(({ prefs }) => prefs.digestEnabled)
    .map(({ email }) => email);

  if (recipients.length === 0) {
    // Loud-but-graceful: log, return ok with reason. This isn't a
    // failure mode (just nobody opted in yet) but worth surfacing
    // so we know whether digest is being adopted.
    console.log(
      `[cron/weekly-digest] no digest opt-ins (${subs.data.emails.length} total subs). Skipping.`,
    );
    return NextResponse.json({
      ok: true,
      action: "skip",
      reason: "no digest opt-ins",
      totalSubscribers: subs.data.emails.length,
    });
  }

  // Build per-recipient renderer (each gets a unique unsub link).
  const renderHtml = (recipientEmail: string) =>
    renderDigestEmail({
      recipientEmail,
      weekRange: { min, max, avg },
      currentScore: verdict.score,
      currentTier: TIER_LABEL[verdict.tier],
      topContributor,
      bestWindow: bestWindow?.label ?? null,
      daysIncluded: includedDays > 0 ? includedDays : 0,
    }).html;

  // Subject is per-recipient too, since we want the dynamic score in it.
  // sendAlertBatch wants a single subject string — we approximate by
  // building one for the cron's invocation context (current score).
  const sampleSubject = renderDigestEmail({
    recipientEmail: recipients[0],
    weekRange: { min, max, avg },
    currentScore: verdict.score,
    currentTier: TIER_LABEL[verdict.tier],
    topContributor,
    bestWindow: bestWindow?.label ?? null,
    daysIncluded: includedDays > 0 ? includedDays : 0,
  }).subject;

  const send: SendAlertResult = await sendAlertBatch(
    recipients,
    sampleSubject,
    renderHtml,
  );

  if (!send.ok) {
    console.error(
      `[cron/weekly-digest] partial send failure: ${send.sent}/${recipients.length}. error: ${send.error}`,
    );
    return NextResponse.json(
      {
        ok: false,
        error: send.error,
        statusCode: send.statusCode,
        sent: send.sent,
        attempted: recipients.length,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    action: "sent",
    sent: send.sent,
    digestRecipients: recipients.length,
    totalSubscribers: subs.data.emails.length,
    weekRange: { min, max, avg, daysIncluded: includedDays },
  });
}

