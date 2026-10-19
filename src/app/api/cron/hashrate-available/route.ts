// Hourly cron · email the hashrate waitlist when the number of open
// USA machines goes up, at most once per UTC day.
//
// The rule is lib/hashrate-waitlist.shouldNotifyHashrateOpen:
// first run (no baseline) records and sends nothing, so deploying this
// while boxes are already open cannot blast the list. A flat or falling
// count sends nothing. An upstream outage that reports zero machines
// must not be written as prev — we skip the write when `our-rigs` is
// degraded.
//
// Recipients opted in via SOURCE_PREFS.hashrate
// (notifyOnHashrateAvailable). Prefs that still look like the old
// hashrate bundle ({ digestEnabled: true } only) are treated as opted
// in by interpretStoredPrefs. Do not default the new flag to true.
//
// A failed send does NOT advance the open-count baseline or the
// last-notified day, so the next hour retries. A quiet tick always
// writes the count and leaves the day key alone.

import { NextResponse } from "next/server";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { kvSet, isKvConfigured, kvGetChecked } from "@/lib/kv";
import { getHashrateDesk } from "@/lib/hashrate";
import { shouldNotifyHashrateOpen } from "@/lib/hashrate-waitlist";
import { getSubscriberPrefs } from "@/lib/subscribe-flow";
import {
  buildHashrateAvailableSubject,
  listSubscribers,
  renderHashrateAvailableEmail,
  sendAlertBatch,
} from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPEN_COUNT_KEY = "hashrate:open-count";
const NOTIFIED_DAY_KEY = "hashrate:last-notified-day";
const UTC_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const auth = await verifyCronAuthLimited(req);
  if (!auth.ok) return auth.response;

  await recordCronRun("hashrate-available");

  if (!isKvConfigured()) {
    return NextResponse.json({ ok: true, skipped: "kv-unconfigured" });
  }

  const desk = await getHashrateDesk();
  if (desk.degraded.includes("our-rigs")) {
    console.error(
      "[hashrate-available] our-rigs degraded · not recording a baseline",
      desk.degraded,
    );
    return NextResponse.json(
      { ok: false, error: "degraded", degraded: desk.degraded },
      { status: 503 },
    );
  }

  const openCount = desk.ourRigs.filter((r) => r.status === "available").length;
  // A FAILED read must not look like "no baseline yet". Both surface as
  // null, and the difference decides whether this hour's transition is
  // kept or destroyed: with prev=null the rule declines to notify
  // (first-run behaviour), and the unconditional write below then
  // stores today's count as the new baseline — so next hour sees a
  // flat count, and the rise the waitlist exists to catch is gone
  // for good with nothing sent. Same rule the failed-send
  // path already follows: leave the baseline untouched and retry next
  // hour. A genuinely ABSENT key still records a baseline and sends
  // nothing, which is the documented first-run behaviour.
  const { ok: readOk, value: stored } = await kvGetChecked<number>(
    OPEN_COUNT_KEY,
  );
  if (!readOk) {
    console.error(
      "[hashrate-available] baseline read failed · leaving it untouched so the transition survives",
    );
    return NextResponse.json(
      { ok: false, error: "baseline-read-failed", openCount },
      { status: 503 },
    );
  }
  const prev = typeof stored === "number" && Number.isFinite(stored) ? stored : null;

  const dayRead = await kvGetChecked<string>(NOTIFIED_DAY_KEY);
  if (!dayRead.ok) {
    console.error(
      "[hashrate-available] last-notified day read failed · leaving the baseline untouched",
    );
    return NextResponse.json(
      { ok: false, error: "notified-day-read-failed", openCount, prev },
      { status: 503 },
    );
  }
  const lastNotifiedDay =
    typeof dayRead.value === "string" && UTC_DAY.test(dayRead.value)
      ? dayRead.value
      : null;
  const today = new Date().toISOString().slice(0, 10);

  let sent = 0;
  let notified = false;
  if (shouldNotifyHashrateOpen(prev, openCount, lastNotifiedDay, today)) {
    notified = true;
    const subs = await listSubscribers();
    if (!subs.ok) {
      return NextResponse.json(
        { ok: false, error: subs.error, openCount, prev },
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
      .filter(({ prefs }) => prefs.notifyOnHashrateAvailable === true)
      .map(({ email }) => email);
    if (recipients.length > 0) {
      const subject = buildHashrateAvailableSubject(openCount);
      const send = await sendAlertBatch(recipients, subject, (recipientEmail) =>
        renderHashrateAvailableEmail({ openCount, recipientEmail }).html,
      );
      if (!send.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: send.error,
            sent: send.sent,
            openCount,
            prev,
          },
          { status: 500 },
        );
      }
      sent = send.sent;
    }
    const marked = await kvSet(NOTIFIED_DAY_KEY, today);
    if (!marked) {
      return NextResponse.json(
        { ok: false, error: "notified-day write failed", openCount, prev, sent },
        { status: 500 },
      );
    }
  }

  const wrote = await kvSet(OPEN_COUNT_KEY, openCount);
  if (!wrote) {
    return NextResponse.json(
      { ok: false, error: "KV write failed", openCount, prev, sent },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    openCount,
    prev,
    notified,
    sent,
    today,
    lastNotifiedDay,
  });
}
