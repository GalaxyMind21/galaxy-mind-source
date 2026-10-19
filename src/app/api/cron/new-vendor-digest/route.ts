// Weekly new-vendor digest cron · Sundays at 14:30 UTC.
//
// One email per opted-in subscriber listing vendors added or
// re-verified since the last digest. The directory is mostly static
// between deploys, so without a "what's new" push the lowest-intent
// traffic (browse-without-buy) has no reason to return. This is the
// directory equivalent of the gauge alert: a push channel for a
// surface that otherwise only rewards return visits with what's
// already there.
//
// Cadence is weekly to stay well below the noise threshold for a
// non-extreme signal. The "since last digest" baseline is stored in
// KV as digest:newvendors:lastSentAt (unix ms); on first run (or KV
// unset) we fall back to "vendors verified in the last 7 days."
//
// Skip-on-empty: if zero vendors qualify, we DO NOT send "0 new
// merchants this week" · that's the kind of noise that trains
// subscribers to unsubscribe. We update the lastSentAt baseline
// only on a successful send so a quiet week doesn't reset the
// window unfairly.

import { NextResponse } from "next/server";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { kvGet, kvSet, isKvConfigured } from "@/lib/kv";
import {
  buildNewVendorDigestSubject,
  buildVendorLiveSubject,
  listSubscribers,
  renderNewVendorDigestEmail,
  renderVendorLiveEmail,
  sendAlertBatch,
  sendTransactionalEmail,
  type NewVendorDigestEntry,
} from "@/lib/email";
import { getSubscriberPrefs } from "@/lib/subscribe-flow";
import { VENDORS, getDisplayHandle, vendorSlug } from "@/lib/vendors";
import { clearVendorNotify, readVendorNotify } from "@/lib/vendor-notify-key";
import { pingIndexNow, isIndexNowConfigured } from "@/lib/indexnow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LAST_SENT_KEY = "digest:newvendors:lastSentAt";
// Fallback window when no baseline exists yet (first run on fresh KV
// or fresh deploy). 7 days matches the weekly cadence.
const FALLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const auth = await verifyCronAuthLimited(request);
  if (!auth.ok) return auth.response;
  // Cron liveness · best-effort, never throws (see lib/cron-health).
  await recordCronRun("new-vendor-digest");

  const nowMs = Date.now();
  // Baseline · vendors listed after this timestamp count as "new"
  // for this digest. Fall back to "last 7 days" when there's no prior
  // run to compare against.
  let baselineMs = nowMs - FALLBACK_WINDOW_MS;
  if (isKvConfigured()) {
    const stored = await kvGet<number>(LAST_SENT_KEY);
    if (typeof stored === "number" && Number.isFinite(stored) && stored > 0) {
      baselineMs = stored;
    }
  }

  // VENDORS' listedAt is unix SECONDS · convert for comparison. Keyed on
  // listedAt, not verifiedAt: on 2026-08-13 a full-roster re-verification
  // would otherwise have emailed subscribers all 129 vendors as "new".
  const newVendors = VENDORS.filter(
    (v) => typeof v.listedAt === "number" && v.listedAt * 1000 > baselineMs,
  );

  // ─── IndexNow push · /v/[slug] is the fastest-growing URL class ──
  // Added 2026-07-29. pingIndexNow existed and was wired into exactly
  // two crons, each pushing ONE hardcoded URL (/stack, /treasuries) —
  // vendor pages, the only URL class that actually grows, were never
  // submitted at all.
  //
  // Placement is load-bearing: this MUST run before the early returns
  // below. The handler returns early when there are no new vendors and
  // again when there are no subscribers, and only advances the KV
  // baseline on a successful SEND — so putting the ping after those
  // returns would skip submission in exactly the weeks the digest
  // doesn't go out, which are ordinary weeks, not edge cases.
  //
  // Best-effort by construction: pingIndexNow no-ops when INDEXNOW_KEY
  // is unset and never throws, so this cannot fail the digest. Bing /
  // Yandex / Seznam only — Google does not consume IndexNow.
  let indexNowSubmitted = 0;
  if (newVendors.length > 0) {
    const urls = newVendors.map(
      (v) => `https://galaxymind.space/v/${vendorSlug(v)}`,
    );
    try {
      const res = await pingIndexNow(urls);
      if (res.ok) indexNowSubmitted = urls.length;
      else if (isIndexNowConfigured()) {
        console.warn(
          `[cron/new-vendor-digest] IndexNow rejected ${urls.length} URLs: ${res.status} ${res.reason ?? ""}`,
        );
      }
    } catch (e) {
      console.warn(
        "[cron/new-vendor-digest] IndexNow ping threw",
        e instanceof Error ? e.message : e,
      );
    }
  }

  // ─── Per-submitter "you're live" emails · FALLBACK path ─────────
  // Independent of the broadcast digest below · these go to the
  // submitter who opted in at /submit (vendor-notify:<handle>:<slug> in KV)
  // and fire ONCE per submission the first time the vendor shows up
  // here. Since 2026-07 the PRIMARY send happens at approval time
  // (review CLI → /api/admin/notify-submitter, which deletes the key
  // on success), so this loop normally finds nothing · it only fires
  // when that path didn't complete (endpoint down at approval time,
  // operator approved without pushing, manual vendors.ts edit that
  // bypassed the CLI). Whichever path sends first clears the key ·
  // no double-send. We process them whether or not there are any
  // digest subscribers · the submitter notification is a separate
  // channel.
  const vendorLiveResults: Array<{
    handle: string;
    sent: boolean;
    error?: string;
  }> = [];
  for (const v of newVendors) {
    const addr = await readVendorNotify(v.handle, v.name);
    if (!addr) continue;
    const notifyEmail = addr.email;
    const rendered = renderVendorLiveEmail({
      vendorName: v.name,
      vendorSlug: vendorSlug(v),
    });
    const send = await sendTransactionalEmail({
      to: notifyEmail,
      subject: rendered.subject,
      html: rendered.html,
    });
    if (send.ok) {
      vendorLiveResults.push({ handle: v.handle, sent: true });
      // One-shot · delete only on successful send so a Resend hiccup
      // lets the next cron retry. (TTL on the key already caps the
      // retry window at 90 days.)
      await clearVendorNotify(addr);
    } else {
      vendorLiveResults.push({
        handle: v.handle,
        sent: false,
        error: send.error,
      });
    }
  }

  if (newVendors.length === 0) {
    return NextResponse.json({
      ok: true,
      action: "skip",
      reason: "no new vendors since last digest",
      indexNowSubmitted,
      baselineMs,
      asOfMs: nowMs,
      vendorLiveResults,
    });
  }

  // Resolve subscribers and their prefs.
  const subs = await listSubscribers();
  if (!subs.ok) {
    return NextResponse.json(
      { ok: false, error: subs.error, newVendorCount: newVendors.length, indexNowSubmitted },
      { status: 500 },
    );
  }
  if (subs.data.emails.length === 0) {
    // Loud warning mirroring check-thresholds · "0 subscribers" is
    // the silent failure mode worth alarming on.
    console.warn(
      `[cron/new-vendor-digest] no subscribers · would have sent ${newVendors.length} new-vendor digest. Verify /api/subscribe is healthy.`,
    );
    return NextResponse.json({
      ok: true,
      warning: true,
      action: "skip",
      reason: "no subscribers",
      newVendorCount: newVendors.length,
      indexNowSubmitted,
    });
  }

  const allPrefs = await Promise.all(
    subs.data.emails.map(async (email) => ({
      email,
      prefs: await getSubscriberPrefs(email),
    })),
  );
  const recipients = allPrefs
    .filter(({ prefs }) => prefs.notifyOnNewVendors === true)
    .map(({ email }) => email);

  if (recipients.length === 0) {
    return NextResponse.json({
      ok: true,
      action: "skip",
      reason: "no subscribers opted into new-vendor digest",
      newVendorCount: newVendors.length,
      indexNowSubmitted,
      subscribers: subs.data.emails.length,
    });
  }

  // Newest-first · matches the directory's default sort and rewards
  // the eye with the freshest entries up top.
  const sorted = [...newVendors].sort(
    (a, b) => (b.listedAt ?? 0) - (a.listedAt ?? 0),
  );
  const entries: NewVendorDigestEntry[] = sorted.map((v) => ({
    name: v.name,
    displayHandle: getDisplayHandle(v),
    description: v.description,
    category: v.category,
    country: v.country,
    slug: vendorSlug(v),
  }));

  const subject = buildNewVendorDigestSubject(entries.length);
  const send = await sendAlertBatch(
    recipients,
    subject,
    (recipientEmail) =>
      renderNewVendorDigestEmail({
        vendors: entries,
        recipientEmail,
      }).html,
  );

  // Advance the baseline ONLY on at-least-one successful send so a
  // total Resend failure lets the next cron retry with the same
  // window · no missed announcement.
  if (isKvConfigured() && send.sent > 0) {
    await kvSet(LAST_SENT_KEY, nowMs);
  }

  if (!send.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: send.error,
        statusCode: send.statusCode,
        newVendorCount: newVendors.length,
      indexNowSubmitted,
        sent: send.sent,
        attempted: recipients.length,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    action: "sent",
    newVendorCount: newVendors.length,
      indexNowSubmitted,
    sent: send.sent,
    recipients: recipients.length,
    baselineMs,
    asOfMs: nowMs,
    vendorLiveResults,
  });
}
