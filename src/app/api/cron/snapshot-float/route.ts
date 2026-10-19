// Daily cron · snapshot bitcoin float to KV.
//
// Purpose:
// /float renders a daily-delta + history sparkline backed by KV
// snapshots. Without this cron, the page can only show today's
// computed snapshot (no history, no trend chart).
//
// Trigger: Vercel cron daily at 00:15 UTC (after snapshot-stack
// at 00:05 and snapshot-treasuries at 00:10 · these all share the
// same upstreams and we want to be a polite citizen of our own
// cron schedule).
//
// Storage: kvPushCapped("float:history", FloatSnapshot, 1825) ·
// keeps 5 years of daily snapshots, dropping older entries via
// LTRIM. Plenty for the trend chart's "ALL" view.
//
// Idempotency: a complete row for today is left alone. A partial row
// is replaced in place when a later run is complete. ?force=true
// replaces a same-day row without appending a second copy.

import { NextResponse } from "next/server";
import { kvList, kvListSet, kvPushCapped, isKvConfigured } from "@/lib/kv";
import {
  buildFloatMilestoneSubject,
  listSubscribers,
  renderFloatMilestoneEmail,
  sendAlertBatch,
} from "@/lib/email";
import { getSubscriberPrefs } from "@/lib/subscribe-flow";
import { broadcastPush } from "@/lib/push";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { getTreasuryAggregates } from "@/lib/market";
import {
  composeFloatSnapshot,
  floatSnapshotImproves,
  type FloatSnapshot,
} from "@/lib/float-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HISTORY_KEY = "float:history";
const HISTORY_CAP_DAYS = 1825; // 5 years of daily snapshots

const MEMPOOL_TIPHEIGHT_URL = "https://mempool.space/api/blocks/tip/height";

/** Fetch current Bitcoin block height. Same source as BlockHeightTicker. */
async function fetchCurrentBlockHeight(): Promise<number | null> {
  try {
    const r = await fetch(MEMPOOL_TIPHEIGHT_URL, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: "text/plain" },
    });
    if (!r.ok) return null;
    const txt = await r.text();
    const n = Number.parseInt(txt.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const auth = await verifyCronAuthLimited(request);
  if (!auth.ok) return auth.response;
  // Cron liveness · best-effort, never throws (see lib/cron-health).
  await recordCronRun("snapshot-float");

  if (!isKvConfigured()) {
    return NextResponse.json(
      { ok: false, error: "KV not configured · snapshot skipped" },
      { status: 503 },
    );
  }

  // Pull live data
  const blockHeight = await fetchCurrentBlockHeight();
  if (blockHeight === null) {
    return NextResponse.json(
      { ok: false, error: "block height fetch failed" },
      { status: 503 },
    );
  }

  const aggregates = await getTreasuryAggregates();

  // Compose snapshot
  const asOf = new Date().toISOString();
  const snapshot: FloatSnapshot = composeFloatSnapshot({
    blockHeight,
    asOf,
    governmentsBtc: aggregates.governments,
    etfsBtc: aggregates.etfs,
    publicCompaniesBtc: aggregates.publicCompanies,
  });

  // Same UTC day already stored:
  //   a complete row stays, so a rerun cannot move the clock anchor
  //   or write the day twice
  //   a partial row is replaced in place when this run is complete
  //   ?force=true replaces a same-day row even when it is complete
  // A replacement is one LSET. LPUSH would leave the broken row as
  // yesterday and the daily delta would compare today with itself.
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  const recent = await kvList<FloatSnapshot>(HISTORY_KEY, 2);
  const head = recent[0] ?? null;
  const sameDay = head?.date === snapshot.date;
  const replace =
    sameDay && (force || (head != null && floatSnapshotImproves(head, snapshot)));

  if (sameDay && !replace) {
    return NextResponse.json({
      ok: true,
      action: "skip",
      reason: "already snapshotted today",
      date: snapshot.date,
      partial: head?.partial ?? null,
    });
  }

  // Milestone alerts compare against the previous day. A same-day
  // correction is not a new crossing, so it does not send again.
  const baseline = sameDay ? (recent[1] ?? null) : head;
  const prevInPlay = replace ? null : (baseline?.inPlay ?? null);

  const ok = replace
    ? await kvListSet(HISTORY_KEY, 0, snapshot)
    : await kvPushCapped(HISTORY_KEY, snapshot, HISTORY_CAP_DAYS);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "KV write failed" },
      { status: 500 },
    );
  }

  // ─── Milestone alerts ──────────────────────────────────────────
  // Fires when the buyable float crosses DOWN through a 500K BTC
  // band. Self-deduping: only the day-of-crossing matches the
  // prev > milestone >= today check. Up-crossings don't fire ·
  // the scarcity narrative is one-directional.
  const MILESTONES = [
    7_000_000, 6_500_000, 6_000_000, 5_500_000, 5_000_000,
    4_500_000, 4_000_000, 3_500_000, 3_000_000, 2_500_000, 2_000_000,
  ];
  let milestoneAlert: {
    crossed: number | null;
    sent: number;
    error?: string;
  } = { crossed: null, sent: 0 };
  let milestonePush = 0;
  if (prevInPlay != null && snapshot.inPlay != null) {
    const crossed = MILESTONES.find(
      (m) => prevInPlay > m && snapshot.inPlay <= m,
    );
    if (crossed !== undefined) {
      milestoneAlert.crossed = crossed;
      const subs = await listSubscribers();
      if (subs.ok && subs.data.emails.length > 0) {
        const allPrefs = await Promise.all(
          subs.data.emails.map(async (email) => ({
            email,
            prefs: await getSubscriberPrefs(email),
          })),
        );
        const recipients = allPrefs
          .filter(({ prefs }) => prefs.notifyOnFloatMilestone === true)
          .map(({ email }) => email);
        if (recipients.length > 0) {
          const subject = buildFloatMilestoneSubject({
            milestone: crossed,
            inPlay: snapshot.inPlay,
          });
          const send = await sendAlertBatch(
            recipients,
            subject,
            (recipientEmail) =>
              renderFloatMilestoneEmail({
                milestone: crossed,
                inPlay: snapshot.inPlay!,
                prevInPlay: prevInPlay,
                recipientEmail,
              }).html,
          );
          milestoneAlert.sent = send.sent;
          if (!send.ok) milestoneAlert.error = send.error;
        }
      }
      // Web-push mirror of the float-milestone email · lock-screen twin.
      // Degrades to a no-op when push isn't configured; never throws so a
      // push failure can't abort the cron after the snapshot + email.
      try {
        const r = await broadcastPush({
          title: `₿ Bitcoin float crossed ${(crossed / 1_000_000).toFixed(1)}M`,
          body: "The buyable bitcoin float keeps shrinking · see the depletion runway.",
          url: "/float",
          tag: "float-milestone",
        });
        milestonePush = r.delivered;
      } catch {
        // Best-effort · the email above already fired.
      }
    }
  }

  return NextResponse.json({
    ok: true,
    action: replace ? "replace" : "snapshot",
    date: snapshot.date,
    inPlay: snapshot.inPlay,
    blockHeight: snapshot.blockHeight,
    partial: snapshot.partial,
    milestoneAlert,
    milestonePush,
  });
}
