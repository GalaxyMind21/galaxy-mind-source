// Daily cron — snapshots per-ticker mNAV to KV.
//
// Builds a true historical mNAV series for each treasury company.
// The existing /treasuries page already derives history from
// stock+BTC daily closes (lib/treasury-history.ts? — actually
// MNavSparkline.deriveMNavHistory) but that approximation treats
// shares-outstanding as constant. Real treasury issuers (especially
// Strategy) are aggressive issuers — so the derived series drifts
// from reality over time. Capturing the *true* per-day mNAV from
// bitcointreasuries.net is more accurate over long windows.
//
// Trigger: Vercel cron daily at 00:10 UTC (5 minutes after the stack
// snapshot to spread out the load).
//
// Storage: kvPushCapped("treasury:history:{ticker}", {...}, 365)
// per ticker.

import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market";
import { kvList, kvPushCapped, isKvConfigured } from "@/lib/kv";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { isIndexNowConfigured, pingIndexNow } from "@/lib/indexnow";
import { postTweet } from "@/lib/twitter";
import { TREASURY_META, isTreasuryFeedDown } from "@/lib/treasuries";
import {
  buildMnavAlertSubject,
  listSubscribers,
  renderMnavAlertEmail,
  sendAlertBatch,
} from "@/lib/email";
import type { MnavCrossing } from "@/lib/email";
import { broadcastPush } from "@/lib/push";
import { getSubscriberPrefs } from "@/lib/subscribe-flow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type TreasurySnapshot = {
  date: string;            // YYYY-MM-DD UTC
  mNAV: number | null;
  price: number | null;
  btcHoldings: number | null;
  marketCapM: number | null;
  // Spot BTC price on the snapshot day. Added 2026-06-14 · gross BPS
  // (and therefore BTC Yield) derives from btcHoldings + marketCapM
  // alone, but capturing spot lets a future CEBE-BPS / net history trail
  // recompute senior-claims-in-BTC for the day. Nullable (older rows
  // predate this field; an outage can null it).
  btcPrice?: number | null;
};

const HISTORY_CAP_DAYS = 365;
const HISTORY_KEY = (ticker: string) => `treasury:history:${ticker}`;

export async function GET(request: Request) {
  const auth = await verifyCronAuthLimited(request);
  if (!auth.ok) return auth.response;
  // Cron liveness · best-effort, never throws (see lib/cron-health).
  await recordCronRun("snapshot-treasuries");

  if (!isKvConfigured()) {
    return NextResponse.json(
      { ok: false, error: "KV not configured." },
      { status: 503 },
    );
  }

  const snapshot = await getMarketSnapshot();
  // Calendar UTC yesterday (not wall-clock − 12h). Same as snapshot-stack:
  // late retries after 12:00 UTC must not retag the row as "today".
  const now = new Date();
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  )
    .toISOString()
    .slice(0, 10);

  const written: { ticker: string; mNAV: number | null }[] = [];
  // Capture each ticker's PRIOR (yesterday's) mNAV before we write
  // today's snapshot · used after the loop to detect cheapest-changes
  // for the auto-tweet path.
  const priorMNavs = new Map<string, number | null>();
  const skipped: string[] = [];
  // NEW: track tickers where the KV write actually failed. Previously
  // a failed kvPushCapped silently dropped the ticker (it appeared in
  // neither `written` nor `skipped`), and the response said ok:true
  // — the operator couldn't tell the history series for that ticker
  // had silently flatlined. Same shape as the body-cap silent-failure
  // class we hit in production today.
  const failed: { ticker: string; reason: string }[] = [];
  // ALSO NEW: tickers we refused to write because every numeric field
  // was null (upstream snapshot was degraded for that ticker). Writing
  // those poisons the history series with date-rows that are
  // indistinguishable from "we didn't snapshot on day X" — making the
  // sparkline dishonest about what's data vs what's outage.
  const refusedAllNull: string[] = [];

  for (const t of snapshot.treasuries) {
    // Idempotency per-ticker: skip if we've already snapshotted today.
    const recent = await kvList<TreasurySnapshot>(HISTORY_KEY(t.ticker), 1);
    if (recent[0]?.date === date) {
      skipped.push(t.ticker);
      // Store yesterday-or-prior even on skip so cheapest-change
      // detection has the comparison baseline.
      priorMNavs.set(t.ticker, recent[0]?.mNAV ?? null);
      continue;
    }
    // Capture the prior mNAV BEFORE we write today's row · this gives
    // us yesterday's value for the cheapest-change comparison after
    // the loop completes.
    priorMNavs.set(t.ticker, recent[0]?.mNAV ?? null);
    // Refuse all-null rows — they corrupt the history with phantom
    // data points.
    if (
      t.mNAV == null &&
      t.price == null &&
      t.btcHoldings == null &&
      t.marketCapM == null
    ) {
      refusedAllNull.push(t.ticker);
      continue;
    }
    const entry: TreasurySnapshot = {
      date,
      mNAV: t.mNAV,
      price: t.price,
      btcHoldings: t.btcHoldings,
      marketCapM: t.marketCapM,
      btcPrice: snapshot.btcPrice,
    };
    const ok = await kvPushCapped(
      HISTORY_KEY(t.ticker),
      entry,
      HISTORY_CAP_DAYS,
    );
    if (ok) {
      written.push({ ticker: t.ticker, mNAV: t.mNAV });
    } else {
      failed.push({ ticker: t.ticker, reason: "kvPushCapped returned false" });
      console.error(
        `[cron/snapshot-treasuries] KV write failed for ${t.ticker} on ${date}`,
      );
    }
  }

  // ─── mNAV crossing alerts ───────────────────────────────────────
  // Detect tickers whose mNAV crossed INTO cheap (<1.05) or rich
  // (>1.6) territory between yesterday's snapshot and today's. The
  // crossing is self-deduping: prev/today comparison fires only on
  // the day the threshold is crossed, never on consecutive days the
  // ticker stays in that band. On skipped rows (re-run idempotency)
  // priorMNavs holds today's already-written value, so prev === today
  // and no crossing is detected · double-fire on re-run is impossible.
  const cheapCrossings: MnavCrossing[] = [];
  const richCrossings: MnavCrossing[] = [];
  for (const t of snapshot.treasuries) {
    if (t.mNAV == null) continue;
    const prev = priorMNavs.get(t.ticker);
    if (prev == null) continue;
    if (prev >= 1.05 && t.mNAV < 1.05) {
      cheapCrossings.push({ ticker: t.ticker, mNav: t.mNAV, prevMNav: prev });
    }
    if (prev <= 1.6 && t.mNAV > 1.6) {
      richCrossings.push({ ticker: t.ticker, mNav: t.mNAV, prevMNav: prev });
    }
  }
  let mnavAlerts: {
    cheap: { tickers: string[]; sent: number; error?: string };
    rich: { tickers: string[]; sent: number; error?: string };
  } = {
    cheap: { tickers: cheapCrossings.map((c) => c.ticker), sent: 0 },
    rich: { tickers: richCrossings.map((c) => c.ticker), sent: 0 },
  };
  if (cheapCrossings.length > 0 || richCrossings.length > 0) {
    const subs = await listSubscribers();
    if (subs.ok && subs.data.emails.length > 0) {
      const allPrefs = await Promise.all(
        subs.data.emails.map(async (email) => ({
          email,
          prefs: await getSubscriberPrefs(email),
        })),
      );
      // Cheap batch
      if (cheapCrossings.length > 0) {
        const recipients = allPrefs
          .filter(({ prefs }) => prefs.notifyOnMnavCheap === true)
          .map(({ email }) => email);
        if (recipients.length > 0) {
          const subject = buildMnavAlertSubject({
            direction: "cheap",
            crossings: cheapCrossings,
          });
          const send = await sendAlertBatch(
            recipients,
            subject,
            (recipientEmail) =>
              renderMnavAlertEmail({
                direction: "cheap",
                crossings: cheapCrossings,
                recipientEmail,
              }).html,
          );
          mnavAlerts.cheap.sent = send.sent;
          if (!send.ok) mnavAlerts.cheap.error = send.error;
        }
      }
      // Rich batch
      if (richCrossings.length > 0) {
        const recipients = allPrefs
          .filter(({ prefs }) => prefs.notifyOnMnavRich === true)
          .map(({ email }) => email);
        if (recipients.length > 0) {
          const subject = buildMnavAlertSubject({
            direction: "rich",
            crossings: richCrossings,
          });
          const send = await sendAlertBatch(
            recipients,
            subject,
            (recipientEmail) =>
              renderMnavAlertEmail({
                direction: "rich",
                crossings: richCrossings,
                recipientEmail,
              }).html,
          );
          mnavAlerts.rich.sent = send.sent;
          if (!send.ok) mnavAlerts.rich.error = send.error;
        }
      }
    }
  }

  // Web-push mirror of the mNAV crossing alerts · the lock-screen twin of
  // the emails above. broadcastPush degrades to a no-op when push isn't
  // configured; the try/catch keeps a push failure from aborting the cron
  // after the snapshots + emails already succeeded (same never-throw
  // posture as the email path). Tags match per direction so a repeat
  // crossing replaces rather than stacks on the lock screen.
  const mnavPush = { cheap: 0, rich: 0 };
  try {
    if (cheapCrossings.length > 0) {
      const r = await broadcastPush({
        title: `₿ ${cheapCrossings.map((c) => c.ticker).join(", ")} below NAV`,
        body: "mNAV crossed under 1.05x · historically an accumulation signal.",
        url: "/treasuries",
        tag: "treasury-mnav-cheap",
      });
      mnavPush.cheap = r.delivered;
    }
    if (richCrossings.length > 0) {
      const r = await broadcastPush({
        title: `₿ ${richCrossings.map((c) => c.ticker).join(", ")} rich premium`,
        body: "mNAV crossed above 1.6x · historically a stretched entry.",
        url: "/treasuries",
        tag: "treasury-mnav-rich",
      });
      mnavPush.rich = r.delivered;
    }
  } catch {
    // Best-effort · the emails above already fired.
  }

  // CHEAPEST-TREASURY-CHANGE auto-tweet · post when the
  // lowest-mNAV ticker is different from yesterday's lowest-mNAV
  // ticker. This is the single most newsworthy daily event from
  // the /treasuries page · "MSTR was cheapest, now MPJPY is" is
  // exactly the kind of decision-relevant signal the audience cares
  // about. Skip if SOCIAL_AUTOMATION_DISABLED env is set, X creds
  // aren't configured, or the cron just refused all writes.
  let cheapestChange: {
    posted: boolean;
    yesterday: string | null;
    today: string | null;
    reason: string;
    text?: string;
    tweetId?: string;
  } | null = null;
  const automationDisabled =
    process.env.SOCIAL_AUTOMATION_DISABLED === "1" ||
    process.env.SOCIAL_AUTOMATION_DISABLED === "true";
  if (!automationDisabled && written.length > 0) {
    const dryRun =
      process.env.DRY_RUN_SOCIAL === "1" || process.env.DRY_RUN_SOCIAL === "true";

    // Today's cheapest = lowest mNAV among today's snapshot rows
    // that have a non-null mNAV.
    const todayWithMnav = snapshot.treasuries.filter(
      (t) => t.mNAV != null,
    );
    const todayCheapest =
      todayWithMnav.length > 0
        ? todayWithMnav.reduce((a, b) =>
            (a.mNAV ?? Infinity) < (b.mNAV ?? Infinity) ? a : b,
          )
        : null;

    // Yesterday's cheapest = lowest mNAV among priorMNavs (which we
    // captured BEFORE writing today). Only consider tickers that have
    // BOTH a prior AND a today reading — the comparison has to be
    // like-for-like or a FEED GAP reads as a market move.
    //
    // mNAV is per-ticker nullable (it needs marketCapM AND btcHoldings
    // AND btcPrice), and a row carrying holdings but no market cap is a
    // documented upstream shape. Filtering only the prior side let a
    // ticker that went unreadable for one day vanish from "today" while
    // still anchoring "yesterday", so the two sides disagreed and we
    // announced a new cheapest treasury that never changed. Silence on a
    // missing feed beats a public claim about a move that did not happen.
    const todayTickers = new Set<string>(todayWithMnav.map((t) => t.ticker));
    const priorPairs = [...priorMNavs.entries()].filter(
      ([ticker, m]) => m != null && todayTickers.has(ticker),
    ) as [string, number][];
    const yesterdayCheapestEntry =
      priorPairs.length > 0
        ? priorPairs.reduce((a, b) => (a[1] < b[1] ? a : b))
        : null;
    const yesterdayCheapestTicker = yesterdayCheapestEntry?.[0] ?? null;

    if (
      todayCheapest &&
      yesterdayCheapestTicker &&
      todayCheapest.ticker !== yesterdayCheapestTicker
    ) {
      // Compose the tweet. Use the company's display name for
      // readability. Use the actual mNAV values to make the post
      // substantive · "MSTR (1.04×) → MPJPY (0.78×)" is the kind of
      // citable detail that earns RTs.
      const newName =
        TREASURY_META[todayCheapest.ticker as keyof typeof TREASURY_META]?.name ??
        todayCheapest.ticker;
      const oldName =
        TREASURY_META[yesterdayCheapestTicker as keyof typeof TREASURY_META]?.name ??
        yesterdayCheapestTicker;
      const newMnav = todayCheapest.mNAV?.toFixed(2);
      const oldPriorMnav = yesterdayCheapestEntry?.[1].toFixed(2);

      const text = [
        `📊 New cheapest Bitcoin treasury: ${newName} (${todayCheapest.ticker}) at ${newMnav}× mNAV.`,
        "",
        `Was ${oldName} (${yesterdayCheapestTicker}) yesterday at ${oldPriorMnav}×.`,
        "",
        "Live mNAV scoreboard:",
        "https://galaxymind.space/treasuries",
      ].join("\n");

      if (dryRun) {
        cheapestChange = {
          posted: false,
          yesterday: yesterdayCheapestTicker,
          today: todayCheapest.ticker,
          reason: "dry_run",
          text,
        };
      } else {
        const result = await postTweet(text);
        cheapestChange = {
          posted: result.ok,
          yesterday: yesterdayCheapestTicker,
          today: todayCheapest.ticker,
          reason: result.ok ? "cheapest_changed" : `post_failed: ${result.error}`,
          text,
          ...(result.ok ? { tweetId: result.data.id } : {}),
        };
      }
    } else if (todayCheapest && yesterdayCheapestTicker) {
      cheapestChange = {
        posted: false,
        yesterday: yesterdayCheapestTicker,
        today: todayCheapest.ticker,
        reason: "no change · same cheapest as yesterday",
      };
    } else {
      cheapestChange = {
        posted: false,
        yesterday: yesterdayCheapestTicker,
        today: todayCheapest?.ticker ?? null,
        reason: "insufficient data for comparison",
      };
    }
  }

  // Push /treasuries to IndexNow on successful snapshot landings.
  // Best-effort · the cron's own status is independent of IndexNow's
  // response (reported in payload, never fails the cron). The fetch
  // IS awaited (5s timeout in lib/indexnow.ts) so the cron blocks
  // briefly · this is intentional, not a `void promise` fire-and-forget
  // (see submit-vendor route's M5 fix from 2026-05-14 for why that
  // pattern is unsafe on Vercel). No-op if INDEXNOW_KEY isn't
  // configured. We only ping if at least one ticker wrote successfully
  // · pinging on a complete failure would just waste IndexNow's daily
  // quota.
  let indexNow: { ok: boolean; status: number } | null = null;
  if (isIndexNowConfigured() && written.length > 0) {
    const r = await pingIndexNow(["https://galaxymind.space/treasuries"]);
    indexNow = { ok: r.ok, status: r.status };
  }

  // Return 500 if any KV write failed — the response was ok:true even
  // when zero tickers were successfully written, so an alarm only
  // fired on auth/network errors. Now operator sees the partial
  // failure in Vercel cron dashboard immediately.
  // ── ALARM · EVERY ticker came back null ─────────────────────────
  //
  // One ticker refused is an ordinary per-name outage and the loop above
  // already handles it: the row is skipped so the history is not poisoned
  // with a phantom data point. ALL of them refused is a different event —
  // it means the feed itself is gone, not that a company is having a
  // quiet day.
  //
  // That distinction had no consequence until now. `ok` was
  // `failed.length === 0` and `refusedAllNull` fed neither `ok` nor the
  // status, so the day the bitcointreasuries parser broke this route
  // returned 200 ok:true with `written: []` and a full refusal list, and
  // the cron dashboard stayed green. It stayed green for about a month
  // (found 2026-09-10: SvelteKit had moved the entity rows from
  // nodes[1] to nodes[2] and every guard downstream matched zero rows).
  // /treasuries, /fit's diversifier, /today's cheapest mNAV, the /stack
  // mNAV signal and the treasury OG card were all dark the whole time.
  //
  // The 503 is the alarm, matching snapshot-hashrate's "record nothing
  // rather than a null-filled row" rule and the list-pending-submissions
  // SLA alarm: a non-2xx is what makes Vercel's own cron-failure alert
  // fire, and that channel does not depend on anything this route reads.
  //
  // Deliberately NOT tripped by idempotency: a re-run on a day already
  // snapshotted puts every ticker in `skipped`, not `refusedAllNull`, so
  // this stays quiet. It needs a real, total, first-run-of-the-day
  // failure.
  const allRefused = isTreasuryFeedDown({
    tracked: snapshot.treasuries.length,
    refused: refusedAllNull.length,
  });
  if (allRefused) {
    console.error(
      `[cron/snapshot-treasuries] EVERY TICKER NULL · ${refusedAllNull.join(", ")} · ` +
        `wrote nothing. One ticker null is an outage; all of them is the feed being gone. ` +
        `Check the bitcointreasuries devalue parser in lib/market.ts before trusting any mNAV surface.`,
    );
  }

  const status = failed.length > 0 ? 500 : allRefused ? 503 : 200;
  return NextResponse.json(
    {
      ok: failed.length === 0 && !allRefused,
      date,
      written,
      skipped,
      failed,
      refusedAllNull,
      allTickersNull: allRefused,
      indexNow,
      cheapestChange,
      mnavAlerts,
      mnavPush,
    },
    { status },
  );
}
