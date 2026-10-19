// Async server component: does the heavy data fetching + renders the
// data-dependent sections. Lives behind a <Suspense> boundary in
// page.tsx so the page shell paints immediately while this streams in.
//
// Why this split exists:
// Previously the entire page awaited getMarketSnapshot() at the top of
// the page component. That snapshot calls 7-8 external APIs and on a
// cache miss can take 5-12 seconds (each upstream has a 5s timeout, but
// Promise.all means we wait for the slowest). With the await at the top,
// the SERVER held the response open the whole time — TTFB was fast (29ms)
// but FCP was 12 seconds. Users saw a blank page for 12 full seconds.
//
// Now: page.tsx renders synchronously, including the static header,
// title, hero copy, and a placeholder for this section. The placeholder
// is a Suspense fallback (StackSkeleton). When the data fetch resolves,
// React streams in the resolved HTML. Browser shows the shell at ~100ms,
// gauge appears whenever the data lands.
//
// SECONDARY SPLIT (May 2026): the cockpit + compare-needle are now in
// their own inner Suspense boundary. They depend on a KV read AND on
// the verdict signals. The gauge — single most important element —
// can render as soon as the snapshot resolves; the cockpit's sparkline
// computation + 10-card render happens in parallel via the inner
// Suspense, replaced when ready. On a cold cache where getMarketSnapshot
// is the dominant cost, both still resolve close together; on warm
// snapshots where KV is the slower path, the gauge wins by a few hundred ms.

import { Suspense, cache } from "react";
import { getMarketSnapshot } from "@/lib/market";
import { computeStackVerdict, TIER_LABEL } from "@/lib/stack";
import { buildRarityLine } from "@/lib/stack-rarity";
import { computeForecast, pickBestWindow } from "@/lib/forecast";
import { BestWindowCountdown } from "./BestWindowCountdown";
import { InlineSubscribePrompt } from "@/components/InlineSubscribePrompt";
import { kvList } from "@/lib/kv";
import type { StackSnapshot } from "../../api/cron/snapshot-stack/route";
import type { StackVerdict, StackTier } from "@/lib/stack";
import nextDynamic from "next/dynamic";

// PressureGauge is a 2,800-line SVG/canvas instrument · code-split it
// so /stack's route bundle hydrates without parsing the gauge first
// (perf 2026-06-12). Still SSRs (no ssr:false) so the painted gauge
// appears with the stream; drag/sound interactivity arrives a beat
// later when its chunk lands.
const PressureGauge = nextDynamic(() =>
  import("./PressureGauge").then((m) => ({ default: m.PressureGauge })),
);
import { LiveGaugeShell } from "./LiveGaugeShell";
import { StackWindow } from "./StackWindow";
import { SignalCockpit, type SignalHistoryMap } from "./SignalCockpit";
import {
  SatCalculator,
  type PriceAnchor,
} from "./SatCalculator";
import { FadeIn } from "./FadeIn";
import { ContrarianPitch } from "./ContrarianPitch";
import { AlertSubscribe } from "./AlertSubscribe";
import { StackHistorySparkline } from "./StackHistorySparkline";
import { HowItWorks } from "./HowItWorks";
import { ShareVerdictButton } from "./ShareVerdictButton";
import { SharedSnapshotNotice } from "./SharedSnapshotNotice";
import { DcaCalculator, type CompactHourlySeries } from "./DcaCalculator";
import { ScoreEasterEgg } from "./ScoreEasterEgg";
import { EasterEggHints } from "./EasterEggHints";
import { StickyScoreBar } from "./StickyScoreBar";
import { CitationBlock } from "@/components/CitationBlock";
import { CrossPageCTA } from "@/components/CrossPageCTA";
import {
  XSELL_OUT_HASHRATE_HOOK,
  XSELL_OUT_HASHRATE_TITLE,
} from "@/lib/hashrate-copy";
import { FirstVisitGaugeHint } from "./FirstVisitGaugeHint";
import { GaugeCheckStreak } from "./GaugeCheckStreak";
import { LastCheckedDelta } from "./LastCheckedDelta";
import {
  BtcSpotPriceHero,
  deriveBtc24hDelta,
} from "@/components/BtcSpotPriceHero";
import { DataStatusBanner } from "@/components/DataStatusBanner";
import { PushAlertToggle } from "@/components/PushAlertToggle";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";

// Build per-signal historical normalized arrays (oldest → newest) for
// the cockpit sparklines AND extract the score from ~30 days ago for
// the gauge's "vs 30d ago" ghost-needle toggle.
//
// Wrapped in React.cache() so the two consumers (GaugeWithBaseline +
// CockpitOnly) share a single KV round-trip per request · kvList uses
// `cache: "no-store"` under the hood so the native fetch dedupe doesn't
// fire. Audit 2026-05-22 caught the double-fetch comment was wrong.
const buildSignalHistory = cache(async (): Promise<{
  signalHistory: SignalHistoryMap;
  compareBaseline: { score: number; date: string } | null;
  scoreHistory: { date: string; score: number }[];
  verifiedTip: { date: string; score: number; tier: StackTier } | null;
  // date → the exact stored reading for that day. Lets the shared-snapshot
  // notice echo a ?s=&t=&d= URL only when the triple matches a real row,
  // mirroring the OG history gate (2026-07-10 Grok audit · M7).
  verifiedByDate: Record<string, { score: number; tier: StackTier }>;
}> => {
  try {
    // 91 days fetched in ONE kvList call · the cockpit sparklines and
    // the 30d ghost-needle baseline keep their 31-day window (sliced
    // below, unchanged behavior); the full window feeds the rarity
    // line ("highest since {date}" · review 2026-06-12).
    const recent91 = (await kvList<StackSnapshot>("stack:history", 91)).reverse();
    const recent = recent91.slice(-31);
    const map: SignalHistoryMap = {};
    for (const snap of recent) {
      for (const sig of snap.signals ?? []) {
        if (!map[sig.name]) map[sig.name] = [];
        map[sig.name].push(sig.normalized);
      }
    }
    const oldest = recent[0];
    const compareBaseline =
      recent.length >= 25 && oldest && typeof oldest.score === "number"
        ? { score: oldest.score, date: oldest.date }
        : null;
    const scoreHistory = recent91
      .filter((s) => typeof s.score === "number" && typeof s.date === "string")
      .map((s) => ({ date: s.date, score: s.score }));
    // Newest FINALIZED daily snapshot (rows are dated UTC-yesterday, so
    // this is the most recent official reading · not the live intraday
    // verdict). The share URL must be built from these exact values: the
    // OG history gate (/api/og/stack) only renders a card when s/t/d
    // match a stored row, and the live intraday score usually won't, so a
    // live-valued card silently falls back to the generic image
    // (2026-07-10 Grok audit · C1).
    const newest = recent91[recent91.length - 1];
    const verifiedTip =
      newest &&
      typeof newest.score === "number" &&
      typeof newest.date === "string" &&
      typeof newest.tier === "string"
        ? {
            date: newest.date,
            score: newest.score,
            tier: newest.tier as StackTier,
          }
        : null;
    // date → stored reading, for the shared-snapshot integrity check.
    const verifiedByDate: Record<string, { score: number; tier: StackTier }> =
      {};
    for (const s of recent91) {
      if (
        typeof s.date === "string" &&
        typeof s.score === "number" &&
        typeof s.tier === "string"
      ) {
        verifiedByDate[s.date] = { score: s.score, tier: s.tier as StackTier };
      }
    }
    return {
      signalHistory: map,
      compareBaseline,
      scoreHistory,
      verifiedTip,
      verifiedByDate,
    };
  } catch (e) {
    console.error("[stack] buildSignalHistory failed:", e);
    return {
      signalHistory: {},
      compareBaseline: null,
      scoreHistory: [],
      verifiedTip: null,
      verifiedByDate: {},
    };
  }
});

// Historical price anchors for the Sat Calculator. Derived server-side
// from the snapshot's ~730d hourly closes — no extra fetch.
function buildAnchors(hourlyCloses: number[] | null): PriceAnchor[] {
  if (!hourlyCloses || hourlyCloses.length === 0) return [];
  const lookbacks: { label: string; days: number }[] = [
    { label: "7 days ago", days: 7 },
    { label: "30 days ago", days: 30 },
    { label: "90 days ago", days: 90 },
    { label: "1 year ago", days: 365 },
  ];
  const anchors: PriceAnchor[] = [];
  const lastIdx = hourlyCloses.length - 1;
  for (const lb of lookbacks) {
    const idx = lastIdx - lb.days * 24;
    if (idx >= 0 && idx <= lastIdx) {
      const price = hourlyCloses[idx];
      if (Number.isFinite(price) && price > 0) {
        anchors.push({ label: lb.label, days: lb.days, price });
      }
    }
  }
  return anchors;
}

// Compact the ~9.5K-point hourly series for the DcaCalculator props.
// Shipping the parallel absolute-timestamp array was the single
// largest flight chunk on /stack (~233 KB · audit 2026-07-12); the
// spacing is 3600s except for a handful of upstream gaps, so we send
// {start, step, exceptions} and the client rebuilds every timestamp
// exactly. Closes rounded to cents — float64 tails like .3203125 are
// serialization weight, not signal, for a DCA backtest.
function compactHourlySeries(
  hourlyCloses: number[] | null,
  hourlyTimestamps: number[] | null,
): CompactHourlySeries | null {
  if (
    !hourlyCloses ||
    !hourlyTimestamps ||
    hourlyCloses.length === 0 ||
    hourlyTimestamps.length !== hourlyCloses.length
  ) {
    return null;
  }
  const stepSeconds = 3600;
  const irregularSteps: [number, number][] = [];
  for (let i = 1; i < hourlyTimestamps.length; i++) {
    const delta = hourlyTimestamps[i] - hourlyTimestamps[i - 1];
    if (delta !== stepSeconds) irregularSteps.push([i, delta]);
  }
  return {
    startTimestamp: hourlyTimestamps[0],
    stepSeconds,
    irregularSteps,
    closes: hourlyCloses.map((c) => Math.round(c * 100) / 100),
  };
}

// Tiny placeholder for the cockpit while history is loading.
// Shown for at most a few hundred ms — the KV read is fast. We
// dim-pulse a 10-card grid so the layout is identical at swap time.
function CockpitFallback() {
  return (
    <FadeIn delay={0.2}>
      <section className="mt-12">
        <div className="mb-5">
          <h2 className="micro-label text-[var(--text-tertiary)]">
            Signal Cockpit
          </h2>
          <p className="mt-2 text-sm text-[var(--text-tertiary)] leading-relaxed max-w-2xl">
            Loading signal history…
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] h-[200px] sk-cockpit-pulse"
              style={{ animationDelay: `${i * 0.08}s` }}
              aria-hidden
            />
          ))}
        </div>
        <style>{`
          @keyframes sk-cockpit-pulse {
            0%, 100% { opacity: 0.35; }
            50%      { opacity: 0.55; }
          }
          .sk-cockpit-pulse {
            animation: sk-cockpit-pulse 1.6s ease-in-out infinite;
          }
        `}</style>
      </section>
    </FadeIn>
  );
}

export async function StackContent() {
  // Single critical-path fetch — the snapshot. Every primary section
  // (gauge, contrarian pitch, share, sparkline, forecast, sat calc,
  // DCA) needs this; nothing useful renders until it resolves.
  const snapshot = await getMarketSnapshot();
  const verdict = computeStackVerdict(snapshot);
  // Capture one Date.now() and thread it through · the forecast uses
  // it to build its 168-hour grid and the client countdown uses it to
  // compute the target wallclock of the best cell. Sharing the same
  // instant prevents the countdown from drifting against the forecast.
  const nowMs = Date.now();
  const forecast = computeForecast(snapshot, verdict, nowMs);
  const bestWindow = pickBestWindow(forecast);
  // Wallclock millis of the best cell's hour-boundary start. Server-
  // computed once so the client countdown stays consistent with the
  // forecast no matter how long the page sat in cache.
  const bestWindowTargetMs = bestWindow
    ? Math.floor(nowMs / 3_600_000) * 3_600_000 +
      bestWindow.hoursFromNow * 3_600_000
    : null;
  const anchors = buildAnchors(snapshot.hourlyCloses);

  // Compare-baseline (for the gauge's ghost needle) needs a KV read.
  // We kick it off in parallel with the gauge render — the gauge
  // prop is awaited via Suspense streaming, so the gauge renders
  // immediately with compareBaseline=null and the toggle button just
  // doesn't appear. When the KV read lands, the page re-streams the
  // gauge with the baseline in place.
  //
  // NOTE: in practice both fetches resolve within tens of ms of each
  // other on warm caches, so users typically see the toggle from the
  // start. The Suspense split is what protects the gauge-first paint
  // on cold/slow KV.
  return (
    <>
      <StickyScoreBar score={verdict.score} tier={verdict.tier} />

      {/* BTC spot price hero · the question every casual visitor
          arrives with is "should I buy bitcoin at this price?" ·
          surfacing the price ABOVE the verdict makes the page read
          as a two-beat answer (here's the number → here's the call). */}
      <BtcSpotPriceHero
        price={snapshot.btcPrice}
        delta24h={deriveBtc24hDelta(snapshot.btcPrice, snapshot.hourlyCloses)}
        size="lg"
      />

      {/* Mobile verdict-above-the-fold chip · on a 375px screen the
          gauge (and therefore the score, the page's entire payoff)
          sits below the hero copy. One compact tappable chip puts the
          number in the first viewport and jumps to the instrument.
          sm:hidden. Bumped to py-2.5 + whitespace-nowrap (mobile audit
          2026-06-20) so it clears a 44px tap target and the verdict
          never wraps. */}
      <div className="sm:hidden mt-4 text-center">
        <a
          href="#gauge"
          className="micro-label inline-flex items-baseline gap-2 whitespace-nowrap px-4 py-2.5 rounded-full border border-[var(--accent)]/40 bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
        >
          Gauge
          <span className="text-base font-semibold tabular-nums text-[var(--accent-ink)]">
            {verdict.score}
          </span>
          · {TIER_LABEL[verdict.tier]}
          <span aria-hidden className="text-[var(--text-tertiary)]">↓</span>
        </a>
      </div>

      {/* The interpreting sentence, lifted to the top on mobile (UX audit
          2026-07-13 · B5a): a casual "should I buy?" visitor otherwise had
          to scroll past the whole always-expanded 10-slider what-if panel
          to reach the one line that says what the score MEANS. Desktop
          keeps it in its position below the gauge (hidden sm:block there),
          so this doesn't duplicate on wide screens. */}
      <p className="sm:hidden mt-3 px-4 text-center text-sm text-[var(--text-secondary)] leading-snug">
        {verdict.summary}
      </p>

      {/* Honesty + shared-link strips · placed BELOW the mobile chip so
          that on a degraded-data or shared-link day (exactly when
          traffic spikes) the verdict proxy still leads the first mobile
          screen instead of being pushed down (mobile audit completeness
          pass 2026-06-20). Both render nothing on a normal live day.
          DataStatusBanner: renders only when ≥4/8 weight-bearing signals
          are null (same threshold that blocks the crons) so a WARM-50
          fallback never reads as a live verdict. SharedSnapshotNotice:
          when someone arrives via a frozen ?s=&t=&d= URL and the gauge
          has since moved, it explains the delta instead of silently
          contradicting the card they clicked. */}
      <DataStatusBanner degraded={isMarketSnapshotDegraded(snapshot)} />
      {/* The notice echoes a shared ?s=&t=&d= only when the triple
          matches a real stored row (integrity gate · M7), which needs the
          history read · streamed in its own Suspense with a null fallback
          so it never blocks or flashes an unverified claim. */}
      <Suspense fallback={null}>
        <VerifiedSharedSnapshotNotice verdict={verdict} />
      </Suspense>

      {/* The verdict · single most important element. Renders with
          compareBaseline=null initially; the inner Suspense
          (GaugeWithBaseline below) re-streams once the KV read lands
          but the gauge itself doesn't depend on it. */}
      <FadeIn delay={0}>
        <section id="gauge" className="mt-8 scroll-mt-20">
          <Suspense
            fallback={
              <PressureGauge
                score={verdict.score}
                tier={verdict.tier}
                blockHeight={verdict.blockHeight}
                signals={verdict.signals}
                compareBaseline={null}
              />
            }
          >
            <GaugeWithBaseline verdict={verdict} />
          </Suspense>
          <ScoreEasterEgg score={verdict.score} />
          {/* First-visit nudge · sits just under the gauge so a fresh
              user discovers the dial-drag interactivity. localStorage-
              gated, fades out after 8s, never shows again on that
              device. Returning visitors don't see this. */}
          <FirstVisitGaugeHint />

          {/* "Since you last checked" — one of the highest-leverage
              retention signals possible. Uses the same LS the streak
              uses + the current verdict. Extremely cheap, zero privacy
              cost, massive "what changed?" pull for repeat visits. */}
          <LastCheckedDelta currentScore={verdict.score} currentTier={verdict.tier} />

          {/* Direct email CTA right under the habit signals — highest-intent
              moment on the page. Visitors who just engaged with the gauge
              are the perfect audience for alerts. */}
          <div className="mt-4 flex justify-center">
            <a
              href="#subscribe"
              className="micro-label inline-flex items-center gap-2 px-5 py-2 rounded-full border-2 border-[var(--accent)] bg-[var(--accent)] text-black font-semibold hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
            >
              ✉ Get the signal by email
            </a>
          </div>

          {/* Desktop keeps the summary here, below the gauge · on mobile
              it's lifted above (sm:hidden copy near the score chip). */}
          <p className="hidden sm:block mt-8 text-center text-sm">{verdict.summary}</p>
          {bestWindow && bestWindowTargetMs !== null && (
            <BestWindowCountdown
              targetMs={bestWindowTargetMs}
              windowLabel={bestWindow.label}
              windowScore={bestWindow.score}
            />
          )}
          {bestWindow && (
            <p className="mt-1 text-center t-xs uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              Today&apos;s reading + historical hour/day pattern · not a
              forward prediction
            </p>
          )}
        </section>
      </FadeIn>

      {/* Habit streak · returning-visitor reward (only renders from a
          2-day streak onward). Moved BELOW the gauge (mobile audit
          2026-06-20) so it never outranks the verdict on first paint. */}
      <GaugeCheckStreak />

      <FadeIn delay={0.1}>
        <section className="mt-12">
          <ContrarianPitch
            currentScore={verdict.score}
            currentTier={TIER_LABEL[verdict.tier]}
          />
        </section>
      </FadeIn>

      {/* Inline subscribe prompt · 2026-05-20 audit moved this BELOW
          the ContrarianPitch (was directly under the verdict). The
          original placement competed with the BTC price hero + gauge
          + summary for the most-prominent above-fold pixels · with
          the price hero now anchoring the top of the page, the
          subscribe prompt yields to it. ContrarianPitch is a
          natural "you've digested the verdict, now what?" pivot
          point · the email opt-in slots there much more cleanly. */}
      <FadeIn delay={0.11}>
        <section className="mt-8">
          <div className="max-w-xl mx-auto px-4">
            <InlineSubscribePrompt
              source="stack"
              headline="Get an email next time the gauge flips into a new zone"
            />
          </div>
        </section>
      </FadeIn>

      <FadeIn delay={0.12}>
        <section className="mt-8">
          {/* The share URL must carry the newest FINALIZED daily reading
              (see verifiedTip in buildSignalHistory) so the OG history gate
              renders a real card · streamed in its own Suspense so the KV
              read never blocks first paint. Fallback renders NOTHING (not a
              live-valued button): the live intraday score + today's date is
              exactly the gate-missing triple C1 exists to avoid, so we must
              never expose it as shareable, even for the sub-second pre-resolve
              flash. The verified button is the only shareable one. */}
          <Suspense fallback={null}>
            <ShareVerdictWithSnapshot verdict={verdict} />
          </Suspense>

          {/* Distribution lever · makes the gauge appear on other sites.
              Every embed is free marketing + backlink + new top-of-funnel
              traffic. Placed right next to the share button so the "take
              this with you" intent is captured at the moment of peak
              engagement. */}
          <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2 text-center">
            <a
              href="/embed"
              className="micro-label inline-flex items-center gap-1 text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
            >
              Embed this live gauge →
            </a>
            <a
              href="/feed-gauge.xml"
              className="micro-label inline-flex items-center gap-1 text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
            >
              RSS · daily gauge
            </a>
            <a
              href="/today"
              className="micro-label inline-flex items-center gap-1 text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
            >
              Today&apos;s briefing →
            </a>
          </div>
        </section>
      </FadeIn>

      <FadeIn delay={0.13}>
        <section className="mt-12">
          <StackHistorySparkline
            currentScore={verdict.score}
            currentTier={verdict.tier}
          />
        </section>
      </FadeIn>

      <FadeIn delay={0.15}>
        <section className="mt-12">
          <StackWindow cells={forecast} />
        </section>
      </FadeIn>

      {/* COCKPIT · owns its own KV history fetch behind an inner
          Suspense. Uses the same pulse-grid fallback so the layout
          stays steady at swap time. */}
      <Suspense fallback={<CockpitFallback />}>
        <CockpitOnly verdict={verdict} />
      </Suspense>

      <FadeIn delay={0.3}>
        <section className="mt-12">
          <SatCalculator nowPrice={snapshot.btcPrice} anchors={anchors} />
        </section>
      </FadeIn>

      <FadeIn delay={0.32}>
        <section className="mt-12">
          <DcaCalculator
            series={compactHourlySeries(
              snapshot.hourlyCloses,
              snapshot.hourlyTimestamps,
            )}
            currentPrice={snapshot.btcPrice}
          />
        </section>
      </FadeIn>

      <FadeIn delay={0.35}>
        <section id="subscribe" className="mt-12 scroll-mt-20">
          {/* #alerts · deep-link target for every "Pick yours →" /
              "customize alerts" link site-wide (footer, inline
              prompts). scroll-mt clears the sticky header. */}
          <div id="alerts" className="scroll-mt-20">
            <AlertSubscribe />
            {/* Email-independent channel · lock-screen push for the
                same 80/20 crossings. Renders nothing on unsupported
                browsers; prominent install walkthrough on iOS Safari
                outside the PWA. */}
            <PushAlertToggle />
            {/* Tier-flip channel (2026-08-04) · the extremes topic
                above fires approximately never by design; this one
                pings on tier crossings, roughly weekly. Separate
                opt-in so the rare-alerts contract holds. */}
            <div className="mt-3">
              <PushAlertToggle
                topic="tier"
                heading="🔔 Tier-flip alert"
                pitch="One ping when the gauge changes tier · WARM to HOT, HOT to MOLTEN, and back. Historically about once a week."
                sideNote="Only fires when the tier actually crosses. Nothing else rides this."
                onLabel="✓ Tier alerts on · tap to disable"
                offLabel="Ping me on tier flips"
              />
            </div>
          </div>
        </section>
      </FadeIn>

      <FadeIn delay={0.4}>
        <section className="mt-12">
          <HowItWorks score={verdict.score} />
        </section>
      </FadeIn>

      {/* Citation block · explicit "last updated" timestamp + a
          copy-paste-ready citation string. Encourages external citation
          by journalists / researchers / agents, the strongest authority
          signal for SEO + AI-agent ranking. snapshot.asOf is the moment
          getMarketSnapshot() resolved · matches what the gauge reflects. */}
      <FadeIn delay={0.42}>
        <section className="mt-8">
          <CitationBlock
            pageUrl="https://galaxymind.space/stack"
            dataLabel="Bitcoin Buying Gauge"
            lastUpdatedISO={snapshot.asOf}
            surface="stack"
          />
        </section>
      </FadeIn>

      {/* Cross-page CTAs · the natural follow-ups for someone who
          just read the verdict. /float = "what's left to buy?" ·
          /treasuries = "what is MSTR's mNAV doing right now?" (one
          of the 10 signals the gauge consumed). */}
      <FadeIn delay={0.44}>
        <section className="mt-8">
          <CrossPageCTA
            cards={[
              {
                href: "/today",
                eyebrow: "HABIT",
                title: "Today in Bitcoin",
                hook: "The four numbers in one briefing · come back every morning. Gauge, float, cheapest treasury, merchants.",
              },
              {
                href: "/hashrate",
                eyebrow: "RENT HASHRATE",
                title: XSELL_OUT_HASHRATE_TITLE,
                hook: XSELL_OUT_HASHRATE_HOOK,
              },
              {
                href: "/float",
                eyebrow: "WHAT'S LEFT?",
                title: "The Bitcoin Float",
                hook: "How much bitcoin is still in play vs locked away. Mining drips in · demand drains out faster.",
              },
            ]}
          />
          {/* The hashrate strip + cross-sell that sat here were REMOVED
              2026-08-13 · see the note in HomeClient. */}
        </section>
      </FadeIn>

      <FadeIn delay={0.46}>
        <EasterEggHints />
      </FadeIn>
    </>
  );
}

/* =====================================================================
 * Inner async components — each owns a buildSignalHistory call so
 * Suspense can stream them in independently of the parent.
 *
 * Both call buildSignalHistory; the helper is wrapped in React.cache()
 * so the KV is hit exactly once per request and both consumers share
 * the Promise. (Native fetch dedupe doesn't kick in because the
 * Upstash REST request uses `cache: "no-store"`.)
 * ===================================================================== */

async function GaugeWithBaseline({ verdict }: { verdict: StackVerdict }) {
  const { compareBaseline, scoreHistory } = await buildSignalHistory();
  const rarityLine = buildRarityLine(verdict.score, scoreHistory);
  // LiveGaugeShell is a client component that re-fetches /api/stack
  // every 60s and re-renders the PressureGauge with the fresh
  // verdict · turning /stack into a live monitor instead of a
  // server-streamed-once snapshot. Tier-transition sounds + haptics
  // (in PressureGauge) fire automatically when the polled score
  // crosses a tier boundary.
  return (
    <>
      <LiveGaugeShell
        initialVerdict={verdict}
        compareBaseline={compareBaseline}
      />
      {rarityLine && (
        <p className="micro-label mt-3 text-center text-[var(--text-tertiary)]">
          {rarityLine}
        </p>
      )}
    </>
  );
}

async function VerifiedSharedSnapshotNotice({
  verdict,
}: {
  verdict: StackVerdict;
}) {
  const { verifiedByDate } = await buildSignalHistory();
  return (
    <SharedSnapshotNotice
      liveScore={verdict.score}
      liveTier={verdict.tier}
      verifiedByDate={verifiedByDate}
    />
  );
}

async function ShareVerdictWithSnapshot({
  verdict,
}: {
  verdict: StackVerdict;
}) {
  const { verifiedTip } = await buildSignalHistory();
  return (
    <ShareVerdictButton
      score={verdict.score}
      tier={verdict.tier}
      verified={verifiedTip}
    />
  );
}

async function CockpitOnly({ verdict }: { verdict: StackVerdict }) {
  const { signalHistory } = await buildSignalHistory();
  return (
    <FadeIn delay={0.2}>
      <section className="mt-12">
        <SignalCockpit
          signals={verdict.signals}
          history={signalHistory}
        />
      </section>
    </FadeIn>
  );
}
