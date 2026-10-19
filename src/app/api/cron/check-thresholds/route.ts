// Daily cron — checks the live Buying Gauge score and sends alert
// emails to all subscribers when the score is in extreme territory.
//
// Trigger: Vercel cron daily at ~14:00 UTC (~9:00am ET) per
// vercel.json. Verifies a bearer token to prevent unauthorized
// invocations.
//
// Logic:
//   • score >= 80 → "STACK NOW / STACK HUGE" alert (warm)
//   • score <= 20 → "HOLD" alert (cold extreme — euphoric crowd)
//   • else → no alert sent
//
// DEDUPE: extreme conditions can persist for many consecutive days
// (a multi-day MOLTEN run, or a stretch of euphoric COLD). Without
// deduping, subscribers would receive the same alert every day —
// quickly trains them to ignore us and unsub. We persist the LAST
// alert kind sent (warm / cold) to KV; we only re-fire if EITHER:
//   (a) the kind changes (warm → cold or vice versa), OR
//   (b) the score has cooled out of extreme then returned (i.e., we
//       saw at least one non-extreme day since the last alert).
// Both conditions are tracked via a single KV key, alerts:lastFired.
// KV unset → no dedup; original behavior preserved (fail-open).
//
// V1 limitations (still): no per-user thresholds. Deferred.
import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market";
import { computeStackVerdict, TIER_LABEL } from "@/lib/stack";
import {
  buildAlertSubject,
  buildForecastAlertSubject,
  buildTierFlipSubject,
  listSubscribers,
  renderAlertEmail,
  renderForecastAlertEmail,
  renderTierFlipEmail,
  sendAlertBatch,
} from "@/lib/email";
import { computeForecast, pickBestWindow } from "@/lib/forecast";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { kvGet, kvSet, isKvConfigured } from "@/lib/kv";
import { getSubscriberPrefs } from "@/lib/subscribe-flow";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";
import { broadcastPush, type PushBroadcastResult } from "@/lib/push";

const ALERT_STATE_KEY = "alerts:lastFired";

// Persisted state shape — what we know about the last alert we sent.
// `seenNonExtremeAfter` flips true the first cron run that observes a
// non-extreme score after a fired alert; it's the gate that re-arms
// us to fire again at the SAME extreme kind.
type AlertState = {
  lastKind: "warm" | "cold";
  lastDate: string;          // YYYY-MM-DD
  seenNonExtremeAfter: boolean;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await verifyCronAuthLimited(request);
  if (!auth.ok) return auth.response;
  // Cron liveness · best-effort, never throws (see lib/cron-health).
  await recordCronRun("check-thresholds");

  // ?testPush=1 · operator-only end-to-end push test (2026-06-10).
  // Sends ONE clearly-labeled test notification to every stored
  // subscription and returns without touching emails, dedupe state,
  // or anything else. Exists because the real broadcast only fires on
  // 80/20 crossings · without this, verifying a fresh device
  // subscription means waiting for an extreme score. Bearer-gated
  // like everything else here; same ergonomics as the ?dryRun params
  // on sibling crons.
  const url = new URL(request.url);
  if (url.searchParams.get("testPush") === "1") {
    const test = await broadcastPush({
      title: "₿ Galaxy Mind · test alert",
      body: "Push is working. Live alerts fire when the gauge crosses 80 or 20.",
      url: "/stack",
      tag: "gauge-test",
    });
    return NextResponse.json({ ok: true, action: "test-push", ...test });
  }

  const snapshot = await getMarketSnapshot();
  // Block alerts on a degraded snapshot · imported from
  // lib/snapshot-quality.ts. Same 4-of-8 threshold used by
  // weekly-digest and snapshot-stack. Returning 503 here surfaces
  // in Vercel cron logs as a failure → ops alarm. Without this guard,
  // a multi-day Yahoo/CoinGecko outage would silently suppress every
  // genuine MOLTEN/COLD alert (engine returns score=50 fallback).
  if (isMarketSnapshotDegraded(snapshot)) {
    return NextResponse.json(
      {
        ok: false,
        error: "snapshot degraded · too many upstreams null to alert",
      },
      { status: 503 },
    );
  }
  const verdict = computeStackVerdict(snapshot);
  const score = verdict.score;
  const tier = verdict.tier;
  const tierLabel = TIER_LABEL[tier];
  const today = new Date().toISOString().slice(0, 10);

  // ─── Web-push broadcast · FIXED thresholds, email-independent ──────
  // (2026-07-10 · H6) Push is the email-INDEPENDENT rail (see lib/push
  // header). It must fire on the PLATFORM crossing (80/20) whenever the
  // gauge is extreme — regardless of whether any EMAIL subscriber's
  // personal threshold is crossed, and regardless of whether there are
  // any email subscribers at all. The old code derived the push regime
  // from the email buckets and sat BELOW the `emails.length === 0`
  // early-return, so a genuine 80/20 crossing delivered zero pushes
  // whenever the email list was empty or every subscriber had an
  // out-of-range custom threshold. Runs here, before the email audience
  // is even fetched, with its OWN dedupe key so its cadence is fully
  // decoupled from the email dedupe state. (Still gated by the degraded-
  // snapshot 503 above · a bogus fallback score must not push.)
  const PUSH_WARM = 80;
  const PUSH_COLD = 20;
  const PUSH_STATE_KEY = "alerts:lastFiredPush";
  const pushKind: "warm" | "cold" | null =
    score >= PUSH_WARM ? "warm" : score <= PUSH_COLD ? "cold" : null;
  let pushResult: PushBroadcastResult | null = null;
  let pushDeduped = false;
  if (pushKind === null) {
    // Non-extreme day · re-arm any still-open fire so the next crossing
    // can push again (mirrors the email seenNonExtremeAfter gate).
    if (isKvConfigured()) {
      const prev = await kvGet<AlertState>(PUSH_STATE_KEY);
      if (prev && !prev.seenNonExtremeAfter) {
        await kvSet(PUSH_STATE_KEY, { ...prev, seenNonExtremeAfter: true });
      }
    }
  } else {
    if (isKvConfigured()) {
      const prev = await kvGet<AlertState>(PUSH_STATE_KEY);
      if (prev && prev.lastKind === pushKind && !prev.seenNonExtremeAfter) {
        pushDeduped = true;
      }
    }
    if (!pushDeduped) {
      pushResult = await broadcastPush(
        pushKind === "warm"
          ? {
              title: `₿ Buying Gauge: ${score} · ${tierLabel}`,
              body: "Extreme opportunity zone · the score crossed the alert threshold.",
              url: "/stack",
              tag: "gauge-threshold",
            }
          : {
              title: `₿ Buying Gauge: ${score} · ${tierLabel}`,
              body: "Cold extreme · euphoric crowd territory. The gauge says wait.",
              url: "/stack",
              tag: "gauge-threshold",
            },
      );
      if (pushResult.firstError) {
        console.error(
          `[cron/check-thresholds] push partial failure · delivered ${pushResult.delivered}/${pushResult.attempted} · ${pushResult.firstError}`,
        );
      }
      if (isKvConfigured() && pushResult.delivered > 0) {
        await kvSet(PUSH_STATE_KEY, {
          lastKind: pushKind,
          lastDate: today,
          seenNonExtremeAfter: false,
        });
      }
    }
  }
  // Compact push summary spread into every response below so the operator
  // can see the push rail fired even on an email-path skip.
  const pushInfo = {
    pushKind,
    pushDeduped,
    pushAttempted: pushResult?.attempted ?? 0,
    pushDelivered: pushResult?.delivered ?? 0,
    pushPruned: pushResult?.pruned ?? 0,
    pushError: pushResult?.firstError,
  };

  // Pull subscribers + their prefs FIRST so we can decide what regime
  // (if any) is alertable based on the most-permissive subscriber
  // thresholds. This is what enables custom thresholds: if no
  // subscriber has set a custom warm < 80, the gate stays at 80.
  const subs = await listSubscribers();
  if (!subs.ok) {
    return NextResponse.json(
      { ok: false, error: subs.error, score },
      { status: 500 },
    );
  }
  if (subs.data.emails.length === 0) {
    // Loud warning. "0 subscribers" is the EXACT failure mode that
    // hid the body-cap-1KB bug for weeks: every signup silently
    // rejected → audience stayed empty → cron skipped happily →
    // dashboard shows 200 forever. We log a console.warn so future
    // regressions of that pattern surface immediately, and we
    // include `warning: true` in the response so any external
    // monitor can flag it.
    console.warn(
      `[cron/check-thresholds] no subscribers · would have alerted ${tier} (${score}/100). Verify /api/subscribe is healthy.`,
    );
    return NextResponse.json({
      ok: true,
      warning: true,
      action: "skip",
      score,
      tier,
      reason: "no email subscribers",
      hint: "If subscribers were expected, check /api/subscribe is accepting signups.",
      ...pushInfo,
    });
  }

  // Resolve per-subscriber preferences in parallel. Each subscriber
  // either has a custom warm/cold threshold in KV (fetched here) or
  // inherits the platform defaults (80/20). KV reads are fast; for a
  // small audience this is well under 100ms total.
  const allPrefs = await Promise.all(
    subs.data.emails.map(async (email) => ({
      email,
      prefs: await getSubscriberPrefs(email),
    })),
  );

  // Bucket subscribers by alert kind based on their PERSONAL thresholds.
  // A score of 75 might be "warm" for a custom-threshold subscriber
  // (warm=70) but "neutral" for a default subscriber (warm=80).
  const warmRecipients = allPrefs
    .filter(({ prefs }) => score >= prefs.warmThreshold)
    .map(({ email }) => email);
  const coldRecipients = allPrefs
    .filter(({ prefs }) => score <= prefs.coldThreshold)
    .map(({ email }) => email);

  // ─── Tier-flip alerts ───────────────────────────────────────────
  // Fires when the gauge tier crosses between cron runs (WARM→HOT
  // is "the dip got real", HOT→MOLTEN is "now or never", etc).
  // Independent of the warm/cold extreme dedupe below · uses its
  // own KV key (alerts:lastTier) and its own opt-in pref
  // (notifyOnTierChange, default false). Recipients who already
  // qualify for an extreme alert in this run are excluded so a
  // tier crossing that coincides with an extreme threshold crossing
  // never produces two emails per recipient. Whether or not
  // anything fires, the current tier is always written back to KV
  // so the next run has a baseline · primes on first deploy without
  // spamming.
  let tierFlipSent = 0;
  let tierFlipError: string | undefined;
  if (isKvConfigured()) {
    const prevTier = await kvGet<string>("alerts:lastTier");
    if (prevTier && prevTier !== tier) {
      const ORDER = ["COLD", "CHILL", "WARM", "HOT", "MOLTEN"];
      const fromIdx = ORDER.indexOf(prevTier);
      const toIdx = ORDER.indexOf(tier);
      // Only act on flips between known canonical tiers · if KV held
      // a malformed legacy value, fall through to the re-persist
      // below without trying to email.
      if (fromIdx >= 0 && toIdx >= 0) {
        const direction: "up" | "down" = toIdx > fromIdx ? "up" : "down";
        // Web-push tier-flip broadcast (2026-08-04) · its own opt-in
        // topic, so gauge-extreme subscribers keep their rare-alerts
        // contract. Best-effort: a failed broadcast is a log line.
        const fromLabelPush =
          TIER_LABEL[prevTier as keyof typeof TIER_LABEL] ?? prevTier;
        const tierPush = await broadcastPush(
          {
            title: `₿ Gauge tier flip: ${fromLabelPush} → ${tierLabel}`,
            body:
              direction === "up"
                ? `The Buying Gauge climbed to ${tierLabel} at ${score}/100.`
                : `The Buying Gauge cooled to ${tierLabel} at ${score}/100.`,
            url: "/stack",
            tag: "gauge-tier-flip",
          },
          { topic: "tier" },
        );
        if (tierPush.firstError) {
          console.error(
            `[cron/check-thresholds] tier push partial failure · delivered ${tierPush.delivered}/${tierPush.attempted} · ${tierPush.firstError}`,
          );
        }
        const excluded = new Set<string>([
          ...warmRecipients,
          ...coldRecipients,
        ]);
        const tierFlipRecipients = allPrefs
          .filter(({ prefs }) => prefs.notifyOnTierChange === true)
          .map(({ email }) => email)
          .filter((e) => !excluded.has(e));
        if (tierFlipRecipients.length > 0) {
          const fromTierLabel =
            TIER_LABEL[prevTier as keyof typeof TIER_LABEL] ?? prevTier;
          const subject = buildTierFlipSubject({
            fromTierLabel,
            toTierLabel: tierLabel,
            score,
          });
          const send = await sendAlertBatch(
            tierFlipRecipients,
            subject,
            (recipientEmail) =>
              renderTierFlipEmail({
                fromTier: prevTier,
                toTier: tier,
                fromTierLabel,
                toTierLabel: tierLabel,
                score,
                direction,
                recipientEmail,
              }).html,
          );
          tierFlipSent = send.sent;
          if (!send.ok) tierFlipError = send.error;
        }
      }
    }
    // Always persist current tier as the baseline for the next run.
    await kvSet("alerts:lastTier", tier);
  }

  // ─── Forecast-window "imminent strong window" alerts ───────────
  // Fires when pickBestWindow returns a future cell within 24h whose
  // projected score is in HOT territory (>=70). The dedupe key is
  // the EXACT cell identity (utcDate+etHour) so the same window can
  // never fire twice across consecutive cron runs · a window 23h out
  // today won't re-fire 22h out tomorrow if nothing else changes.
  // Recipients already getting an extreme alert in this run are
  // excluded to preserve the one-email-per-run guarantee.
  let forecastWindowSent = 0;
  let forecastWindowError: string | undefined;
  let forecastWindowCellId: string | null = null;
  if (isKvConfigured()) {
    // Capture once · matches the determinism contract in
    // computeForecast (audit 2026-05 H-2) and keeps the cell index
    // consistent with the cell we read out of the array.
    const nowMs = Date.now();
    const forecast = computeForecast(snapshot, verdict, nowMs);
    const bestWindow = pickBestWindow(forecast);
    if (
      bestWindow &&
      bestWindow.hoursFromNow < 24 &&
      bestWindow.score >= 70
    ) {
      const bestCell = forecast[bestWindow.hoursFromNow];
      forecastWindowCellId = `${bestCell.utcDate}T${bestCell.etHour}`;
      const lastSent = await kvGet<string>("alerts:forecastWindow:lastSent");
      if (lastSent !== forecastWindowCellId) {
        const excluded = new Set<string>([
          ...warmRecipients,
          ...coldRecipients,
        ]);
        const fwRecipients = allPrefs
          .filter(({ prefs }) => prefs.notifyOnForecastWindow === true)
          .map(({ email }) => email)
          .filter((e) => !excluded.has(e));
        if (fwRecipients.length > 0) {
          const subject = buildForecastAlertSubject({
            hoursFromNow: bestWindow.hoursFromNow,
            score: bestWindow.score,
          });
          const send = await sendAlertBatch(
            fwRecipients,
            subject,
            (recipientEmail) =>
              renderForecastAlertEmail({
                windowLabel: bestWindow.label,
                hoursFromNow: bestWindow.hoursFromNow,
                score: bestWindow.score,
                recipientEmail,
              }).html,
          );
          forecastWindowSent = send.sent;
          if (!send.ok) forecastWindowError = send.error;
          if (send.sent > 0) {
            // Persist only on at-least-one successful send so a total
            // failure (Resend hiccup) lets the next cron retry.
            await kvSet(
              "alerts:forecastWindow:lastSent",
              forecastWindowCellId,
            );
          }
        }
      }
    }
  }

  // Determine the "regime" we're in — any-warm OR any-cold OR neither.
  // Used for global dedupe + the early bail.
  const anyWarm = warmRecipients.length > 0;
  const anyCold = coldRecipients.length > 0;

  // Non-extreme run for every subscriber: if a previous fire is still
  // open, mark seenNonExtremeAfter so the next extreme can re-fire.
  if (!anyWarm && !anyCold) {
    if (isKvConfigured()) {
      const prev = await kvGet<AlertState>(ALERT_STATE_KEY);
      if (prev && !prev.seenNonExtremeAfter) {
        await kvSet(ALERT_STATE_KEY, { ...prev, seenNonExtremeAfter: true });
      }
    }
    return NextResponse.json({
      ok: true,
      action:
        tierFlipSent > 0 || forecastWindowSent > 0
          ? "side-channel-only"
          : "skip",
      score,
      tier,
      reason: "score not in any subscriber's extreme territory",
      subscribers: subs.data.emails.length,
      tierFlipSent,
      tierFlipError,
      forecastWindowSent,
      forecastWindowError,
      forecastWindowCellId,
      ...pushInfo,
    });
  }

  // Global dedupe based on regime. If we already fired warm (any
  // subscriber's warm threshold) and haven't seen a calm day since,
  // skip — even subscribers with a NEWLY-permissive threshold will
  // wait until the next regime cycle. Trade-off: keeps the no-spam
  // guarantee at the cost of one missed initial alert for subscribers
  // who lower their threshold mid-regime. Acceptable for a small list.
  const thisKind: "warm" | "cold" = anyWarm ? "warm" : "cold";
  if (isKvConfigured()) {
    const prev = await kvGet<AlertState>(ALERT_STATE_KEY);
    if (prev) {
      const sameKindAndStillRunning =
        prev.lastKind === thisKind && !prev.seenNonExtremeAfter;
      if (sameKindAndStillRunning) {
        return NextResponse.json({
          ok: true,
          action: "skip",
          score,
          tier,
          reason: `already alerted ${thisKind} on ${prev.lastDate}; awaiting non-extreme day before re-firing`,
          ...pushInfo,
        });
      }
    }
  }

  // Send the appropriate alert flavor to each bucket. We can have
  // BOTH buckets non-empty in theory if score is exactly at one
  // subscriber's warm threshold AND another's cold threshold (very
  // unlikely with current 60/40 ranges but defensively handled).
  let totalSent = 0;
  let firstError: string | undefined;
  let lastStatusCode: number | undefined;

  for (const [recipients, flavor] of [
    [warmRecipients, "molten"] as const,
    [coldRecipients, "frozen"] as const,
  ]) {
    if (recipients.length === 0) continue;
    const subject = buildAlertSubject({
      score,
      tierLabel,
      subjectFlavor: flavor,
    });
    const send = await sendAlertBatch(
      recipients,
      subject,
      (recipientEmail) =>
        renderAlertEmail({
          score,
          tier,
          tierLabel,
          subjectFlavor: flavor,
          recipientEmail,
        }).html,
    );
    totalSent += send.sent;
    if (!send.ok && firstError === undefined) {
      firstError = send.error;
      lastStatusCode = send.statusCode;
    }
  }

  // Push already fired at the top on fixed 80/20 thresholds with its own
  // dedupe key (H6) · the email path no longer drives it.

  // Record email dedupe state when at least one email delivered. Push has
  // its own state key (alerts:lastFiredPush) so it is intentionally NOT a
  // factor here · the two rails re-arm independently.
  if (isKvConfigured() && totalSent > 0) {
    const newState: AlertState = {
      lastKind: thisKind,
      lastDate: today,
      seenNonExtremeAfter: false,
    };
    await kvSet(ALERT_STATE_KEY, newState);
  }

  if (firstError !== undefined) {
    console.error(
      `[cron/check-thresholds] partial send failure: ${totalSent}/${warmRecipients.length + coldRecipients.length} sent. first error: ${firstError}`,
    );
    return NextResponse.json(
      {
        ok: false,
        error: firstError,
        statusCode: lastStatusCode,
        score,
        sent: totalSent,
        attempted: warmRecipients.length + coldRecipients.length,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    action: "sent",
    score,
    tier,
    sent: totalSent,
    warmRecipients: warmRecipients.length,
    coldRecipients: coldRecipients.length,
    ...pushInfo,
    tierFlipSent,
    tierFlipError,
    forecastWindowSent,
    forecastWindowError,
    forecastWindowCellId,
  });
}
