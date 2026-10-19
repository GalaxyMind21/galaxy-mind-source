// Daily cron · drafts an X post + Nostr note featuring 2-3 vendors
// each (category diversity, 14-day cooldown enforced) and emails them
// to the operator so they can copy-paste-post in a few seconds.
//
// Designed to remove the daily-effort floor on growing the audience.
// The operator opens the email, reviews the two drafts, optionally
// tweaks, and posts. Zero context-switching into the codebase.
//
// Trigger: Vercel cron daily at 12:00 UTC (~7am ET — the operator's
// most-likely posting window). See vercel.json for the exact schedule.
// Manual invocation:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//        https://galaxymind.space/api/cron/social-post-drafts
//
// Auth: CRON_SECRET. Same envelope as every other privileged route.
//
// Env vars used:
//   SOCIAL_DRAFTS_EMAIL · who to email the drafts to (required)
//   SOCIAL_AUTOMATION_DISABLED · "1"/"true" kills the cron
//   DRY_RUN_SOCIAL · "1"/"true" generates drafts without marking
//                    used or sending email · returns the drafts in
//                    the response body for inspection
//
// Side effects on success:
//   1. Email sent to SOCIAL_DRAFTS_EMAIL
//   2. Each featured handle gets a 14-day cooldown record in KV
//      (key: social:cd:<platform>:<handle>)
//
// Idempotency story: marking-used happens AFTER successful email
// send. A Resend failure leaves the cooldown untouched so a retry
// at the next cron tick (or operator-triggered manual run) gets a
// fresh shot at the same vendor pool. Re-running on the same day
// will mostly produce the same picks (deterministic seed = day of
// year) but freshly-marks the cooldowns · acceptable since the
// 14-day TTL prevents drift.

import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import {
  VENDORS,
  filterActive,
  getPlatform,
  isNew,
  type Vendor,
  type VendorPlatform,
} from "@/lib/vendors";
import { getDormantHandles } from "@/lib/vendor-dormancy";
import { pickFeaturedVendor } from "@/lib/featured-vendor";
import {
  filterAvailable,
  markUsed,
} from "@/lib/social-rotation";
import {
  draftArcadePost,
  draftFeaturedVendorPost,
  draftBlockShotPost,
  draftReverifyBatchCard,
  draftTopicalPost,
  draftFloatPost,
  draftGaugePost,
  draftInsightPost,
  type TopicalDraft,
  draftNostrPost,
  draftXPostFitted,
  filterSocialEligible,
  pickWithCategoryDiversity,
  renderDraftsEmail,
  type DraftBundle,
  type InsightData,
  buildSocialDraftRecipients,
} from "@/lib/social-drafts";
import { sendTransactionalEmail, fetchEmailDelivery } from "@/lib/email";
import { kvGet, kvSet } from "@/lib/kv";
import {
  badgeDmText,
  badgeLaunchPost,
  badgeOutreachChannel,
  pickBadgeOutreachBatch,
} from "@/lib/badge-outreach";
import {
  loadBadgeOutreachSent,
  markBadgeLaunchShown,
  markBadgeOutreachSent,
  shouldShowBadgeLaunch,
} from "@/lib/badge-outreach-state";
import { KART_GHOST_KEY } from "@/lib/kart-ghost";
import { gauntletNumber } from "@/lib/gauntlet-day";
import { getHashrateDesk } from "@/lib/hashrate";
import { summarizeOpenFleet } from "@/lib/open-fleet";
import { rentalCostBtc, blockOdds } from "@/lib/block-odds";
import { getMarketSnapshot } from "@/lib/market";
import { computeStackVerdict, TIER_LABEL } from "@/lib/stack";
import { getFloatData } from "@/lib/float-data";
import { computeCebe } from "@/lib/cebe";
import { TREASURY_META } from "@/lib/treasuries";

export const dynamic = "force-dynamic";

/**
 * Derive the daily insight inputs from the live snapshot + float + the
 * vendor directory. Everything is best-effort: a missing piece just
 * removes the angles that need it (draftInsightPost falls through to the
 * next angle that has data, ending on the always-available circular-
 * economy count).
 */
function buildInsightData(
  snap: Awaited<ReturnType<typeof getMarketSnapshot>> | null,
  verdict: ReturnType<typeof computeStackVerdict> | null,
  floatData: Awaited<ReturnType<typeof getFloatData>> | null,
  desk: Awaited<ReturnType<typeof getHashrateDesk>> | null = null,
): InsightData {
  const btcPrice = snap?.btcPrice ?? null;
  const treasuries = (snap?.treasuries ?? []).map((t) => ({
    ticker: t.ticker,
    name: TREASURY_META[t.ticker]?.name ?? t.ticker,
    mNav: t.mNAV ?? null,
    amplification: computeCebe(t, btcPrice).amplificationRatio,
  }));

  // Gauge driver · the live signal furthest from neutral (50), the same
  // "what moved it" logic the weekly gauge draft uses.
  let gauge: InsightData["gauge"] = null;
  if (verdict) {
    const live = verdict.signals.filter((s) => s.raw != null);
    const top = live.length
      ? live.reduce((a, b) =>
          Math.abs(b.normalized - 50) > Math.abs(a.normalized - 50) ? b : a,
        )
      : null;
    const driver = top
      ? `${top.name} ${top.normalized >= 50 ? "is leaning toward stacking" : "is flashing caution"}`
      : "ten signals, all roughly neutral";
    gauge = { score: verdict.score, tier: TIER_LABEL[verdict.tier], driver };
  }

  // Float drain · history is newest-first; state a positive 30-day drop
  // or leave null (the angle drops out when null).
  let floatDrain30d: number | null = null;
  const hist = floatData?.history ?? [];
  if (hist.length > 30) {
    const drop = hist[30].inPlay - floatData!.current.inPlay;
    if (drop > 0) floatDrain30d = drop;
  }

  const countries = new Set(
    VENDORS.map((v) => v.country).filter((c): c is string => !!c),
  );

  let blockShot: InsightData["blockShot"] = null;
  if (
    desk &&
    desk.blockRewardBtc != null &&
    desk.btcUsd != null &&
    desk.networkPhs != null
  ) {
    const open = summarizeOpenFleet(desk.ourRigs);
    if (open.openCount > 0 && open.bestPh != null && open.bestAsk != null) {
      const c3 = rentalCostBtc({
        ph: open.bestPh,
        hours: 3,
        askBtcPerPhDay: open.bestAsk,
      });
      const o24 = blockOdds({
        ph: open.bestPh,
        hours: 24,
        networkPhs: desk.networkPhs,
      });
      if (c3 != null && o24 != null && Number.isFinite(o24.oneInN)) {
        blockShot = {
          prizeK: Math.floor((desk.blockRewardBtc * desk.btcUsd) / 1000),
          openTh: open.openTh,
          usd3: (c3 * desk.btcUsd).toFixed(2),
          oneIn24: Math.round(o24.oneInN).toLocaleString("en-US"),
        };
      }
    }
  }

  return {
    treasuries,
    totalTreasuries: treasuries.length,
    btcPrice,
    gauge,
    floatDrain30d,
    vendorCount: VENDORS.length,
    countryCount: countries.size,
    blockShot,
  };
}
export const runtime = "nodejs";

// Picks per platform. 3 is the sweet spot: enough for category
// diversity in the draft, few enough that mentions on X stay under
// the algo's spam threshold (tag etiquette: max 2-3 @ mentions).
const PICKS_PER_PLATFORM = 3;

/**
 * The id of the message the PREVIOUS run handed to Resend, so this run
 * can ask what became of it.
 *
 * Resend accepts a message and bounces it minutes later, out of band,
 * and this project has no Resend webhook to hear that. So "did the
 * operator actually get yesterday's drafts?" is only answerable on the
 * next run, by asking. Without it the cron reported `action: "sent"`
 * and 200 on 2026-09-03 and 2026-09-11 while the mail bounced, which
 * is the same class of silent success the
 * list-pending-submissions 503 alarm exists to break.
 */
const LAST_SEND_KEY = "gm:social-drafts:last-send";

type LastSend = { id: string; date: string; to: string };

export async function GET(req: NextRequest) {
  const auth = await verifyCronAuthLimited(req);
  if (!auth.ok) return auth.response;
  // Cron liveness · best-effort, never throws (see lib/cron-health).
  await recordCronRun("social-post-drafts");

  // Kill switch · matches every other social-poster cron.
  if (
    process.env.SOCIAL_AUTOMATION_DISABLED === "1" ||
    process.env.SOCIAL_AUTOMATION_DISABLED === "true"
  ) {
    return NextResponse.json({
      ok: true,
      action: "skipped",
      reason: "SOCIAL_AUTOMATION_DISABLED env set",
    });
  }

  const url = new URL(req.url);
  const dryRun =
    process.env.DRY_RUN_SOCIAL === "1" ||
    process.env.DRY_RUN_SOCIAL === "true" ||
    url.searchParams.get("dryRun") === "1";

  // One inbox only: SOCIAL_DRAFTS_EMAIL. Dual-send to
  // SUBMISSION_NOTIFY_EMAIL was reverted 2026-09-04 · both addresses reach
  // the same inbox and produced duplicate copies.
  //
  // The two env vars may hold the SAME address, in which case the bounce
  // failover below dedupes to one recipient. That is expected: the
  // failover exists for a future bounce of the primary address.
  // ── Did the LAST one actually land? ─────────────────────────────
  // Never throws and never alarms on ignorance: a Resend outage, an
  // unset key or an unrecognised status all leave `prevBounced` false.
  // Only an explicit bounce escalates, because an alarm that fires when
  // it simply cannot tell gets muted within a week.
  let prevSend: LastSend | null = null;
  let prevBounced = false;
  let prevStatus = "unchecked";
  try {
    prevSend = await kvGet<LastSend>(LAST_SEND_KEY);
    if (prevSend?.id) {
      const delivery = await fetchEmailDelivery(prevSend.id);
      if (delivery.ok) {
        prevStatus = delivery.data.status;
        prevBounced = delivery.data.bounced;
      } else {
        prevStatus = `unreadable (${delivery.error})`;
      }
    } else {
      prevStatus = "no prior send recorded";
    }
  } catch (e) {
    prevStatus = `check threw (${e instanceof Error ? e.message : String(e)})`;
  }

  const primary = process.env.SOCIAL_DRAFTS_EMAIL;
  const recipients = buildSocialDraftRecipients({
    primary,
    // SUBMISSION_NOTIFY_EMAIL is the operator's other inbox. It is added
    // ONLY on the run after a confirmed bounce — see the useFallback
    // comment in lib/social-drafts.ts for why this is not a return to
    // the dual-send that was reverted on 2026-09-04.
    fallback: process.env.SUBMISSION_NOTIFY_EMAIL,
    useFallback: prevBounced,
  });
  if (!primary && !dryRun) {
    // Without a primary destination we can't actually send. Don't
    // 200-skip silently · loud failure surfaces in Vercel cron logs
    // so the operator notices the missing env var.
    return NextResponse.json(
      {
        ok: false,
        error:
          "SOCIAL_DRAFTS_EMAIL env var not set · cannot send drafts",
      },
      { status: 503 },
    );
  }

  // ── Candidate pool · active (non-dormant) vendors by platform ────
  // Two filters chained:
  //   1. filterActive · drops vendors marked dormant by the daily
  //      audit cron (silent on Nostr > 30d, etc.)
  //   2. filterSocialEligible · drops vendors flagged unsuitable
  //      for spotlight rotation (individual devs without commercial
  //      surfaces). See SOCIAL_SKIP_HANDLES in lib/social-drafts.ts.
  const dormant = await getDormantHandles();
  const active = filterSocialEligible(filterActive(VENDORS, dormant));
  const xPool = active.filter((v) => getPlatform(v) === "x");
  const nostrPool = active.filter((v) => getPlatform(v) === "nostr");

  // ── Apply cooldown filter ────────────────────────────────────────
  const xAvailable = await filterAvailable("x", xPool);
  const nostrAvailable = await filterAvailable("nostr", nostrPool);

  // ── Pick with category diversity ─────────────────────────────────
  // Seed = day-of-year so the same day produces the same picks.
  // Day-of-year arithmetic is timezone-stable enough · the cron
  // fires at one UTC moment per day so the seed is deterministic
  // within a UTC day.
  const today = new Date();
  const dayOfYear = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) /
      86_400_000,
  );

  // Genuinely-new merchants (same recency test as the on-site NEW
  // badge · isNew keys off listedAt, immutable and unaffected by
  // re-verification) get the 🆕
  // marker + new-arrival lead in the drafts (operator flagged that the
  // newest vendors never surfaced, 2026-07-09). Separately, the picker
  // FORCES the newest-by-add-order vendor into each batch regardless of
  // age, so the newest listing always gets amplified.
  const freshHandles = new Set(
    active.filter((v) => isNew(v)).map((v) => v.handle),
  );

  const picksX = pickWithCategoryDiversity(
    xAvailable,
    PICKS_PER_PLATFORM,
    dayOfYear,
    { forceNewest: true },
  );
  const picksNostr = pickWithCategoryDiversity(
    nostrAvailable,
    PICKS_PER_PLATFORM,
    dayOfYear + 1000, // separate seed so X picks ≠ Nostr picks
    { forceNewest: true },
  );

  // ── Draft ────────────────────────────────────────────────────────
  // Length safety (drop the lowest-priority pick and re-draft when a
  // long vendor name blows the budget) lives in the lib, so the gate in
  // scripts/test-social-drafts.ts exercises this exact path instead of
  // the raw drafter — see draftXPostFitted's header.
  const xDraft = draftXPostFitted(picksX, today, { freshHandles });

  const nostrDraft = draftNostrPost(picksNostr, today, { freshHandles });

  // ── Live-data drafts ─────────────────────────────────────────────
  // One snapshot + float fetch feeds the DAILY Bier insight (the primary
  // growth post), the weekly gauge weather report (Mondays), and the
  // monthly State of the Float (the 1st). All best-effort · a market/KV
  // hiccup must never block the vendor spotlight (the daily core), so
  // each failure logs and skips. In dry-run we compute everything so
  // `?dryRun=1` previews it all.
  const isMonday = today.getUTCDay() === 1;
  const isFirstOfMonth = today.getUTCDate() === 1;
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  let snap: Awaited<ReturnType<typeof getMarketSnapshot>> | null = null;
  let verdict: ReturnType<typeof computeStackVerdict> | null = null;
  let floatData: Awaited<ReturnType<typeof getFloatData>> | null = null;
  try {
    snap = await getMarketSnapshot();
    verdict = computeStackVerdict(snap);
  } catch (e) {
    console.error(`[cron/social-post-drafts] market snapshot skipped: ${errMsg(e)}`);
  }
  try {
    floatData = await getFloatData();
  } catch (e) {
    console.error(`[cron/social-post-drafts] float data skipped: ${errMsg(e)}`);
  }

  // Desk fetch rides BEFORE the insight so the rental angle can use the
  // same live prize / open-TH / ticket the dedicated Block Shot draft
  // uses. Best-effort: a failed desk just omits that wheel slot.
  let desk: Awaited<ReturnType<typeof getHashrateDesk>> | null = null;
  try {
    desk = await getHashrateDesk();
  } catch {
    /* insight and the dedicated draft both degrade to no rental line */
  }

  // Daily Bier insight · one unexpected, data-backed take in our lane,
  // site as soft proof. Rotates treasury / float / gauge / circular-
  // economy / rental angles by UTC day, self-skips missing numbers.
  let insightDraft: DraftBundle["insight"] = null;
  try {
    insightDraft = draftInsightPost(
      today,
      buildInsightData(snap, verdict, floatData, desk),
    );
  } catch (e) {
    console.error(`[cron/social-post-drafts] insight draft skipped: ${errMsg(e)}`);
  }

  let gaugeDraft: { text: string; charCount: number } | null = null;
  if ((isMonday || dryRun) && verdict) {
    gaugeDraft = draftGaugePost(verdict, today);
  }
  let floatDraft: { text: string; charCount: number } | null = null;
  if ((isFirstOfMonth || dryRun) && floatData) {
    floatDraft = draftFloatPost(floatData, today);
  }

  // The vendors ACTUALLY featured in the final text · a shape can drop
  // a pick (e.g. the new-arrival shape lists the fresh vendor + up to
  // two others), so cooldowns and counts key off `used`, never the raw
  // picks · else a vendor never posted would still burn 14 cooldown days.
  const usedX = xDraft.used;
  const usedNostr = nostrDraft.used;

  // Daily arcade line · the games are the viral surface, so this ships
  // every day (rotates through the angles by UTC day). One best-effort
  // KV existence probe keeps the kart angle honest about whether
  // today's world-best ghost is actually seated — a failed read defaults
  // to the seated copy rather than blocking the draft.
  let kartGhostSeated = true;
  try {
    kartGhostSeated =
      (await kvGet(KART_GHOST_KEY(gauntletNumber(today.getTime())))) != null;
  } catch {
    /* best-effort · keep the default */
  }
  const arcadeDraft = draftArcadePost(today, { kartGhostSeated });

  // Homepage featured-vendor rotation is visual-only unless a draft
  // exists. ISO week rolls Monday UTC, same as pickFeaturedVendor.
  let featuredDraft: { text: string; charCount: number } | null = null;
  if (isMonday || dryRun) {
    const featured = pickFeaturedVendor(active, today);
    if (featured) featuredDraft = draftFeaturedVendorPost(featured);
  }

  // Monday operator card: this week's oldest verifiedAt batch.
  // Never writes verifiedAt. Dry-run includes it so a preview works
  // on any weekday.
  let reverifyBatch: DraftBundle["reverifyBatch"] = null;
  if (isMonday || dryRun) {
    reverifyBatch = draftReverifyBatchCard(VENDORS, today);
  }

  // Daily Block Shot line (operator ask 2026-08-04) · the revenue
  // surface joins the email. Best-effort: a failed desk fetch or a
  // degraded prize simply omits the section — a drafted number from a
  // fallback is the failure mode the snapshot-quality gate exists for.
  let blockShotDraft: { text: string; charCount: number } | null = null;
  try {
    if (desk) blockShotDraft = draftBlockShotPost(desk);
  } catch {
    /* omit the section */
  }

  // The daily topical line (operator ask 2026-08-08). Every input here
  // is already in hand — desk, snapshot, float, verdict — so this adds
  // ZERO upstream calls. Returns null on an ordinary day by design; see
  // draftTopicalPost's header for why the hooks are gated.
  let topicalDraft: TopicalDraft | null = null;
  try {
    const withMNav = (snap?.treasuries ?? [])
      .filter((t): t is typeof t & { mNAV: number } => t.mNAV != null)
      .sort((a, b) => a.mNAV - b.mNAV);
    topicalDraft = draftTopicalPost({
      desk,
      blockHeight: floatData?.current?.blockHeight ?? null,
      prevBlockHeight: floatData?.yesterday?.blockHeight ?? null,
      cheapestMNav: withMNav[0]
        ? { ticker: withMNav[0].ticker, mNav: withMNav[0].mNAV }
        : null,
      gauge: verdict
        ? { score: verdict.score, tier: TIER_LABEL[verdict.tier] }
        : null,
      now: today,
    });
  } catch {
    /* a quiet day and a failed hook look the same to the reader */
  }

  const handles = VENDORS.map((v) => v.handle);
  const outreachRead = await loadBadgeOutreachSent(handles);
  let badgeOutreach: DraftBundle["badgeOutreach"] = null;
  if (!outreachRead.ok) {
    console.error(
      "[cron/social-post-drafts] badge outreach skipped · KV read failed (would repeat already-drafted merchants)",
    );
  } else {
    const batch = pickBadgeOutreachBatch(VENDORS, outreachRead.sent);
    badgeOutreach = batch.map((v) => {
      const channel = badgeOutreachChannel(v);
      return {
        name: v.name,
        handle: v.handle,
        channelHref: channel.href,
        channelLabel: channel.label,
        dm: badgeDmText(v),
      };
    });
  }

  const bundle: DraftBundle = {
    x: xDraft,
    nostr: nostrDraft,
    picksX: usedX,
    picksNostr: usedNostr,
    insight: insightDraft,
    gauge: gaugeDraft,
    float: floatDraft,
    arcade: arcadeDraft,
    blockShot: blockShotDraft,
    topical: topicalDraft,
    featured: featuredDraft,
    badgeOutreach,
    badgeLaunch: (await shouldShowBadgeLaunch()) ? badgeLaunchPost() : null,
    reverifyBatch,
  };

  // M1 · empty-pool detection. If both platform pools are exhausted
  // (cooldowns covering everything · operator hasn't posted in two
  // weeks · or the directory is too small for the requested pick
  // count), refuse with a loud 503 instead of emailing a draft with
  // empty `<pre>` blocks. Without this, the operator gets a
  // mystery-empty email and the cron logs success.
  // picksX, not the post-retry list: the retry never drops below one
  // vendor, so an empty list here means the POOL was empty, which is
  // what this branch is about.
  if (picksX.length === 0 && picksNostr.length === 0) {
    console.error(
      `[cron/social-post-drafts] no eligible vendors · xPool=${xPool.length} xAvailable=${xAvailable.length} nostrPool=${nostrPool.length} nostrAvailable=${nostrAvailable.length} · cooldowns may have exhausted the pool`,
    );
    return NextResponse.json(
      {
        ok: false,
        action: "no_eligible_vendors",
        error:
          "no eligible vendors after cooldown filter · pool exhausted",
        poolSizes: {
          xActive: xPool.length,
          xAvailable: xAvailable.length,
          nostrActive: nostrPool.length,
          nostrAvailable: nostrAvailable.length,
        },
      },
      { status: 503 },
    );
  }

  // ── Dry-run · return drafts in the response, don't send/mark ─────
  if (dryRun) {
    return NextResponse.json({
      ok: true,
      action: "dry_run",
      dayOfYear,
      poolSizes: {
        xActive: xPool.length,
        xAvailable: xAvailable.length,
        nostrActive: nostrPool.length,
        nostrAvailable: nostrAvailable.length,
      },
      picks: {
        x: usedX.map((v) => ({
          handle: v.handle,
          name: v.name,
          category: v.category,
        })),
        nostr: usedNostr.map((v) => ({
          handle: v.handle,
          name: v.name,
          category: v.category,
        })),
      },
      drafts: {
        insight: bundle.insight,
        x: bundle.x,
        nostr: bundle.nostr,
        gauge: bundle.gauge,
        float: bundle.float,
        arcade: bundle.arcade,
        badgeOutreach: bundle.badgeOutreach,
      },
    });
  }

  // ── Send email (single recipient · SOCIAL_DRAFTS_EMAIL) ──────────
  // Loop kept so a future multi-recipient change stays local; today
  // recipients is length 0 or 1. Cooldowns stay untouched on total fail.
  const { subject, html } = renderDraftsEmail(bundle, today);
  const emailIds: string[] = [];
  const failed: { to: string; error: string }[] = [];
  for (const addr of recipients) {
    const send = await sendTransactionalEmail({
      to: addr,
      subject,
      html,
    });
    if (send.ok) {
      emailIds.push(send.data.id);
    } else {
      failed.push({ to: addr, error: send.error });
      console.error(
        `[cron/social-post-drafts] email send failed to ${addr}: ${send.error}`,
      );
    }
  }
  if (emailIds.length === 0) {
    // Don't mark vendors as used · next run gets a fresh shot at
    // the same pool. Failure-and-retry is preferred over "burned
    // cooldown days for a draft that never reached the operator."
    const err =
      failed.map((f) => `${f.to}: ${f.error}`).join("; ") ||
      "no recipients";
    return NextResponse.json(
      {
        ok: false,
        error: err,
        action: "email_failed",
        recipients,
        drafts: bundle,
      },
      { status: 500 },
    );
  }
  if (failed.length > 0) {
    console.error(
      `[cron/social-post-drafts] partial delivery · sent=${emailIds.length} failed=${failed.length} · cooldowns will still mark (at least one inbox got the drafts)`,
    );
  }

  // ── Mark cooldowns AFTER successful email ───────────────────────
  const markedX = await markPickedVendors("x", usedX);
  const markedNostr = await markPickedVendors("nostr", usedNostr);

  // H2 · partial-failure detection. The email is already out (the
  // operator will see the draft in their inbox). But if cooldown
  // writes failed silently, the SAME vendors will surface tomorrow
  // — quietly violating the 14-day rotation guarantee. Loud log
  // here surfaces the mismatch in `vercel logs` so the operator
  // can manually mark the affected vendors used (or just notice
  // the rotation breaking). markUsed itself logs per-handle (H1)
  // so the operator can pinpoint which vendor wasn't marked.
  if (markedX < usedX.length) {
    console.error(
      `[cron/social-post-drafts] cooldown partial failure · x · expected=${usedX.length} marked=${markedX} · email already sent · same vendors may re-surface tomorrow`,
    );
  }
  if (markedNostr < usedNostr.length) {
    console.error(
      `[cron/social-post-drafts] cooldown partial failure · nostr · expected=${usedNostr.length} marked=${markedNostr} · email already sent · same vendors may re-surface tomorrow`,
    );
  }

  if (badgeOutreach && badgeOutreach.length > 0) {
    const marked = await markBadgeOutreachSent(
      badgeOutreach.map((b) => b.handle),
    );
    if (!marked) {
      console.error(
        `[cron/social-post-drafts] badge outreach mark failed · expected=${badgeOutreach.length} · email already sent · same merchants may re-surface tomorrow`,
      );
    }
  }

  if (bundle.badgeLaunch) {
    const markedLaunch = await markBadgeLaunchShown();
    if (!markedLaunch) {
      console.error(
        "[cron/social-post-drafts] badge launch window mark failed · the launch post may reappear past 7 days",
      );
    }
  }

  // ── Record this send so the NEXT run can check it landed ────────
  // Best-effort: a KV miss here costs one run's worth of delivery
  // verification, never the email that already went out.
  const lastSend: LastSend = {
    id: emailIds[0],
    // UTC day, matching the subject line the operator will look for.
    date: today.toISOString().slice(0, 10),
    to: recipients.join(", "),
  };
  const recorded = await kvSet(LAST_SEND_KEY, lastSend);
  if (!recorded) {
    console.error(
      "[cron/social-post-drafts] could not record the send id · tomorrow cannot verify today's delivery",
    );
  }

  // ── Alarm · the PREVIOUS send bounced ───────────────────────────
  // Today's drafts are already out (and this run added the fallback
  // inbox, so they went to both). The 503 is not about today: it is the
  // only channel that reaches the operator when EMAIL is the broken
  // thing, because Vercel's cron-failure alert does not travel through
  // Resend. Same shape as the list-pending-submissions SLA alarm, which
  // also does its work first and then fails loudly.
  if (prevBounced && prevSend) {
    console.error(
      `[cron/social-post-drafts] PREVIOUS SEND BOUNCED · ${prevSend.date} to ${prevSend.to} (id ${prevSend.id}) · ` +
        `that day's drafts reached nobody and its vendor cooldowns were burned anyway · ` +
        `today went to ${recipients.length} inbox(es) as failover`,
    );
    return NextResponse.json(
      {
        ok: false,
        action: "sent_with_previous_bounce",
        error: `previous send (${prevSend.date}) bounced to ${prevSend.to}`,
        previousSend: { ...prevSend, status: prevStatus },
        emailId: emailIds[0],
        emailIds,
        recipients,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    action: "sent",
    previousDelivery: prevStatus,
    emailId: emailIds[0],
    emailIds,
    recipients,
    failed: failed.length ? failed : undefined,
    picks: {
      x: usedX.map((v) => ({ handle: v.handle, name: v.name })),
      nostr: usedNostr.map((v) => ({ handle: v.handle, name: v.name })),
    },
    marked: {
      x: markedX,
      nostr: markedNostr,
      // Surface the gap in the response body too · helpful for
      // anyone curling the endpoint with `vercel crons run` to
      // verify a manual trigger.
      xExpected: usedX.length,
      nostrExpected: usedNostr.length,
      badgeOutreach: badgeOutreach?.length ?? 0,
    },
    drafts: bundle,
  });
}

/**
 * Mark a batch of vendors as used in KV. Returns the count of
 * successful writes · partial failures are surfaced in the response
 * but don't break the run (the email already went out).
 */
async function markPickedVendors(
  platform: VendorPlatform,
  vendors: Vendor[],
): Promise<number> {
  let count = 0;
  for (const v of vendors) {
    const ok = await markUsed(platform, v.handle, "spotlight");
    if (ok) count++;
  }
  return count;
}