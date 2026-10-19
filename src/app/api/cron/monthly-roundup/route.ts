// Monthly market-roundup cron · the only DEFAULT-ON channel.
// Sends on the FIRST SUNDAY of each month at 15:00 UTC.
//
// Cron schedule trick: vercel.json fires this every Sunday (`0 15 * * 0`).
// The handler bails early unless today is the first Sunday of the
// month (day-of-month 1-7). This is necessary because POSIX cron has
// no "first Sunday of month" expression · combining day-of-month
// and day-of-week is OR'd, not AND'd.
//
// Operator-requested as a regular touch-point for subscribers, since
// the existing extreme-alert channel can go weeks without firing in
// calm markets. Default-ON in DEFAULT_PREFS · existing subscribers
// are auto-enrolled via the `{ ...DEFAULT_PREFS, ...stored }` merge
// pattern in getSubscriberPrefs (their stored prefs predate this
// field, so the default `true` wins on read).
//
// Snapshot-quality gated · skips when ≥4/8 market signals are null,
// same as every other emit-cron. Don't ship a "monthly dispatch"
// based on the WARM-50 fallback during an upstream outage.

import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market";
import { computeStackVerdict, TIER_LABEL } from "@/lib/stack";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";
import {
  listSubscribers,
  renderMonthlyRoundupEmail,
  sendTransactionalEmail,
  unsubscribeHeadersFor,
  type MonthlyRoundupTreasuryMover,
  type MonthlyRoundupVendor,
} from "@/lib/email";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { getSubscriberPrefsChecked } from "@/lib/subscribe-flow";
import { kvList } from "@/lib/kv";
import { VENDORS, getDisplayHandle, vendorSlug } from "@/lib/vendors";
import type { StackSnapshot } from "../snapshot-stack/route";
import type { TreasurySnapshot } from "../snapshot-treasuries/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TREASURY_TICKERS = ["MSTR", "MPJPY", "XXI", "ASST"] as const;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * True iff the UTC date `d` is the first Sunday of its month.
 * (Day-of-week is 0=Sunday in UTC and the day-of-month is 1-7.)
 */
function isFirstSundayOfMonth(d: Date): boolean {
  return d.getUTCDay() === 0 && d.getUTCDate() <= 7;
}

/**
 * Find the cheapest treasury by mNAV from the LIVE market snapshot.
 * Returns null if no treasury has a non-null mNAV (degraded data).
 *
 * Note: snapshot.treasuries[].ticker is a literal-union; we widen to
 * plain string to match the loosely-typed MonthlyRoundupInput shape
 * (which doesn't need to know the closed set).
 */
function cheapestTreasury(
  snapshot: Awaited<ReturnType<typeof getMarketSnapshot>>,
): { ticker: string; mNAV: number } | null {
  let best: { ticker: string; mNAV: number } | null = null;
  for (const t of snapshot.treasuries) {
    if (t.mNAV == null) continue;
    if (!best || t.mNAV < best.mNAV) {
      best = { ticker: t.ticker, mNAV: t.mNAV };
    }
  }
  return best;
}

/**
 * Across all tracked treasuries, find the one whose mNAV moved most
 * (by % delta) over the last ~30 days. Returns null if no history is
 * available yet (early-deploy / KV unset case).
 *
 * Compares the OLDEST snapshot from the trailing 30 days to the most
 * recent · uses % delta rather than absolute pp so a 1.4 → 1.1 (-21%)
 * treasury beats a 0.95 → 1.10 (+16%) treasury, which matches the
 * "how much did this re-price" reader question better than absolute pp.
 */
async function biggestTreasuryMover(): Promise<MonthlyRoundupTreasuryMover | null> {
  let best: MonthlyRoundupTreasuryMover | null = null;
  for (const ticker of TREASURY_TICKERS) {
    // kvList is NEWEST-first (LPUSH + LRANGE 0..n-1); reverse to get
    // oldest→newest so ordered[0] is the "~30 days ago" anchor and the
    // last item is the most recent. Bug fix 2026-06-02: this read was
    // previously unreversed (the old comment wrongly claimed oldest→
    // newest), which inverted the mover's from/to AND flipped the % sign
    // in the monthly email · a treasury that got cheaper read as richer.
    const hist = (
      await kvList<TreasurySnapshot>(`treasury:history:${ticker}`, 30)
    ).reverse();
    if (hist.length < 2) continue;
    // Skip entries missing mNAV.
    const ordered = hist.filter((s) => s.mNAV != null) as Array<TreasurySnapshot & { mNAV: number }>;
    if (ordered.length < 2) continue;
    const from = ordered[0];
    const to = ordered[ordered.length - 1];
    if (from.mNAV === 0) continue;
    const deltaPct = ((to.mNAV - from.mNAV) / from.mNAV) * 100;
    if (!best || Math.abs(deltaPct) > Math.abs(best.deltaPct)) {
      best = { ticker, fromMnav: from.mNAV, toMnav: to.mNAV, deltaPct };
    }
  }
  return best;
}

/**
 * Vendors LISTED (first added) in the current calendar month, ordered
 * most-recent first. listedAt is immutable once set and is unaffected
 * by re-verification, unlike verifiedAt — which the rolling ~25/week
 * re-verification sweep (the README §"Re-verification sweep") bumps to
 * today for vendors that aren't new at all. Filtering/sorting on
 * verifiedAt here would email every re-verified vendor to every
 * subscriber as a "new merchant" each month; this is the only
 * default-ON email channel, so that mistake reaches everyone.
 */
function vendorsThisMonth(now: Date): MonthlyRoundupVendor[] {
  const firstOfMonthUtcSec =
    Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
  const recent = VENDORS.filter((v) => v.listedAt >= firstOfMonthUtcSec)
    .sort((a, b) => b.listedAt - a.listedAt);
  return recent.map((v) => ({
    name: v.name,
    displayHandle: getDisplayHandle(v),
    category: v.category,
    slug: vendorSlug(v),
    country: v.country,
  }));
}

export async function GET(request: Request) {
  const auth = await verifyCronAuthLimited(request);
  if (!auth.ok) return auth.response;
  // Cron liveness · best-effort, never throws (see lib/cron-health).
  await recordCronRun("monthly-roundup");

  const now = new Date();
  if (!isFirstSundayOfMonth(now)) {
    return NextResponse.json({
      ok: true,
      action: "skip",
      reason: "not first Sunday of month",
      todayUtc: now.toISOString().slice(0, 10),
    });
  }

  const snapshot = await getMarketSnapshot();
  if (isMarketSnapshotDegraded(snapshot)) {
    return NextResponse.json(
      { ok: false, error: "snapshot degraded · skipping monthly roundup" },
      { status: 503 },
    );
  }

  // ---- Build the per-recipient-invariant inputs ------------------
  // (recipient email is the only per-recipient field.)
  const verdict = computeStackVerdict(snapshot);
  // kvList is NEWEST-first; reverse to oldest→newest so history[0] is
  // the ~30-days-ago entry the "vs a month ago" line compares against.
  // Bug fix 2026-06-02: previously unreversed, so scoreAMonthAgo read
  // TODAY's score and the delta was always ~0. (range30d min/max/avg is
  // order-independent, so it was unaffected.)
  const history = (await kvList<StackSnapshot>("stack:history", 30)).reverse();
  const range30d = history.length > 0
    ? {
        min: Math.min(...history.map((h) => h.score)),
        max: Math.max(...history.map((h) => h.score)),
        avg: Math.round(
          history.reduce((a, b) => a + b.score, 0) / history.length,
        ),
      }
    : null;
  const scoreAMonthAgo = history.length > 0 ? history[0].score : null;
  const cheapest = cheapestTreasury(snapshot);
  const mover = await biggestTreasuryMover();
  const newVendorsAll = vendorsThisMonth(now);
  const monthLabel = `${MONTH_NAMES[now.getUTCMonth()]} ${now.getUTCFullYear()}`;

  // ---- Recipient set ---------------------------------------------
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
      ...(await getSubscriberPrefsChecked(email)),
    })),
  );
  // `ok:false` means the prefs READ failed, not that this subscriber has
  // no prefs. This is the only default-ON channel, so an unreadable record
  // would otherwise fall back to enabled and mail someone who opted out
  // during any Upstash blip. Consent fails CLOSED: skip them this month.
  const unreadable = allPrefs.filter((p) => !p.ok).length;
  if (unreadable > 0) {
    console.error(
      `[monthly-roundup] ${unreadable}/${allPrefs.length} prefs reads failed — those subscribers are skipped rather than mailed on a default.`,
    );
  }
  const recipients = allPrefs
    .filter(({ ok, prefs }) => ok && prefs.monthlyRoundupEnabled)
    .map(({ email }) => email);

  if (recipients.length === 0) {
    return NextResponse.json({
      ok: true,
      action: "skip",
      reason: "no opted-in recipients",
      totalSubscribers: subs.data.emails.length,
    });
  }

  // ---- Per-recipient send ----------------------------------------
  // sendAlertBatch isn't a fit · the welcome unsubscribe header is
  // per-recipient (HMAC of email), AND the email body interpolates
  // the recipient's prefs/unsub URLs. Sequential sendTransactionalEmail
  // is fine at O(tens) of subscribers; chunk via Promise.all when the
  // audience crosses ~200.
  let sent = 0;
  let errors = 0;
  for (const email of recipients) {
    const { subject, html } = renderMonthlyRoundupEmail({
      recipientEmail: email,
      monthLabel,
      gauge: {
        score: verdict.score,
        tier: TIER_LABEL[verdict.tier],
        range30d,
        scoreAMonthAgo,
      },
      treasuries: {
        cheapest,
        biggestMover: mover,
      },
      newVendors: {
        count: newVendorsAll.length,
        top: newVendorsAll.slice(0, 3),
      },
    });
    const r = await sendTransactionalEmail({
      to: email,
      subject,
      html,
      headers: unsubscribeHeadersFor(email),
    });
    if (r.ok) sent++;
    else {
      errors++;
      console.error(
        `[cron/monthly-roundup] send failed for ${email}:`,
        r.error,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    action: "sent",
    monthLabel,
    sent,
    errors,
    totalRecipients: recipients.length,
    totalSubscribers: subs.data.emails.length,
    summary: {
      gaugeScore: verdict.score,
      cheapestTicker: cheapest?.ticker ?? null,
      moverTicker: mover?.ticker ?? null,
      newVendors: newVendorsAll.length,
    },
  });
}
