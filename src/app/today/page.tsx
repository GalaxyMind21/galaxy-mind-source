// /today · the daily briefing. One page composing the four numbers the
// site already computes every day: the Buying Gauge verdict, the
// Bitcoin Float, the cheapest treasury, and the directory pulse.
//
// Why it exists (B3 · 2026-07-07): repeat traffic needs a habit page.
// /stack answers "should I buy", /float answers "how much is left",
// /treasuries answers "which wrapper is cheap" · but a returning
// visitor's first question each morning is "what changed?". This is
// that page, and its OG card doubles as a daily share artifact for
// the operator's X account (fresh numbers every day = fresh billboard
// every day).
//
// Composition only · every number here comes from the same libs the
// source pages render, so /today can never disagree with the
// instrument pages. No new upstream calls, no new KV writes.

import type { Metadata } from "next";
import Link from "next/link";
import { getMarketSnapshot } from "@/lib/market";
import { computeStackVerdict, TIER_LABEL } from "@/lib/stack";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";
import { getFloatData } from "@/lib/float-data";
import { VENDORS } from "@/lib/vendors";
import { kvList } from "@/lib/kv";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { InlineSubscribePrompt } from "@/components/InlineSubscribePrompt";
import { CitationBlock } from "@/components/CitationBlock";
import { PushAlertToggle } from "@/components/PushAlertToggle";
import { DataStatusBanner } from "@/components/DataStatusBanner";
import { TodayShareRow } from "./TodayShareRow";
import { DailyLoop } from "@/components/DailyLoop";
import { TodayHabitExtras } from "./TodayHabitExtras";
import type { StackSnapshot } from "@/app/api/cron/snapshot-stack/route";
import { pageOgImage } from "@/lib/og";

export const revalidate = 1800;

const URL_ = "https://galaxymind.space/today";

export const metadata: Metadata = {
  title: "Today in Bitcoin · gauge, float, cheapest treasury · Galaxy Mind",
  description:
    "The daily Bitcoin briefing: today's Buying Gauge verdict, the float still left to buy, the cheapest public treasury, and new merchants. Four live numbers.",
  alternates: { canonical: URL_ },
  openGraph: {
    title: "Today in Bitcoin · the daily briefing",
    description:
      "Buying Gauge verdict · Bitcoin Float · cheapest treasury · new merchants. Four live numbers, updated all day.",
    url: URL_,
    siteName: "Galaxy Mind",
    type: "website",
    images: pageOgImage("/today/opengraph-image", "Today in Bitcoin · Galaxy Mind"),
  },
  twitter: {
    card: "summary_large_image",
    title: "Today in Bitcoin · the daily briefing",
    description:
      "Buying Gauge verdict · Bitcoin Float · cheapest treasury · new merchants. Four live numbers, one page.",
    site: "@GalaxyMind",
  },
};

/** Format in-play BTC as "X.YM" using floor on both parts.
 *  Never use toLocaleString rounding for the whole-millions digit —
 *  pairing a rounded integer with a floored tenth invents numbers
 *  (e.g. 6.95M → "7.9M"). Matches the honest SupplyClock style. */
function fmtInPlayMillions(inPlay: number): { whole: string; tenths: string } {
  const safe = Number.isFinite(inPlay) && inPlay > 0 ? inPlay : 0;
  const whole = Math.floor(safe / 1_000_000);
  const tenths = Math.floor((safe % 1_000_000) / 100_000);
  return {
    whole: whole.toLocaleString("en-US"),
    tenths: String(tenths),
  };
}

export default async function TodayPage() {
  const [snapshot, float, stackHist] = await Promise.all([
    getMarketSnapshot(),
    // Briefing only needs latest float + daily delta · not 365d chart.
    getFloatData({ days: 2, synthetic: false }),
    kvList<StackSnapshot>("stack:history", 8),
  ]);
  const verdict = computeStackVerdict(snapshot);
  const degraded = isMarketSnapshotDegraded(snapshot);

  // Day-over-day gauge · stack:history is newest-first; each cron row
  // is tagged as *yesterday's* EOD at write time. Prefer an exact
  // calendar match for UTC yesterday; fall back to tip [0] when the
  // tip is at most 2 days old (missed one cron still usable).
  const utcNow = new Date();
  const yesterdayUTC = new Date(
    Date.UTC(
      utcNow.getUTCFullYear(),
      utcNow.getUTCMonth(),
      utcNow.getUTCDate() - 1,
    ),
  )
    .toISOString()
    .slice(0, 10);
  const byDate = stackHist.find((h) => h.date === yesterdayUTC);
  const tip = stackHist[0];
  const tipAgeDays =
    tip?.date != null
      ? Math.floor(
          (Date.UTC(
            utcNow.getUTCFullYear(),
            utcNow.getUTCMonth(),
            utcNow.getUTCDate(),
          ) -
            Date.parse(tip.date + "T00:00:00Z")) /
            86_400_000,
        )
      : Infinity;
  const priorScore =
    typeof byDate?.score === "number"
      ? byDate.score
      : tipAgeDays <= 2 && typeof tip?.score === "number"
        ? tip.score
        : null;
  const scoreVsYesterday =
    !degraded &&
    typeof priorScore === "number" &&
    priorScore !== verdict.score
      ? verdict.score - priorScore
      : null;

  // Cheapest treasury · same pick rule as CheapestCallout on
  // /treasuries (lowest non-null gross mNAV).
  const cheapest = [...snapshot.treasuries]
    .filter((r) => r.mNAV != null)
    .sort((a, b) => (a.mNAV ?? Infinity) - (b.mNAV ?? Infinity))[0];

  // Directory pulse · most recently LISTED vendors + scale line.
  const newest = [...VENDORS]
    .sort((a, b) => b.listedAt - a.listedAt)
    .slice(0, 3);
  const countryCount = new Set(
    VENDORS.map((v) => v.country).filter(Boolean),
  ).size;

  const floatSyncing = float.isFallback;
  const dateLabel = new Date().toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <p className="night-bench-kicker">
          Daily briefing · {dateLabel} · UTC
        </p>
        <h1 className="display-title mb-3">
          Today in bitcoin.
        </h1>
        <p className="night-bench-lede mb-4">
          What changed · four live readings, personal deltas, and
          today&apos;s daily drops. Bookmark this page as
          your morning tab.
        </p>

        {degraded && (
          <div className="mb-4">
            <DataStatusBanner degraded />
            <p className="mt-2 font-mono t-xs text-[var(--text-tertiary)]">
              <Link href="/status" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
                System status →
              </Link>
            </p>
          </div>
        )}

        <TodayHabitExtras
          currentScore={degraded ? null : verdict.score}
          currentTier={degraded ? null : verdict.tier}
          degraded={degraded}
        />

        {/* Invisible section heading · anchors the outline between the
            h1 and the shared CitationBlock h3 (design audit 2026-07-08). */}
        <h2 className="sr-only">Today&apos;s four readings</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Buying Gauge */}
          <Link
            href="/stack"
            className="nb-panel p-5 block"
          >
            <h3 className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
              Buying Gauge
            </h3>
            {degraded ? (
              <div className="font-mono text-2xl text-[var(--text-tertiary)]">
                Updating
              </div>
            ) : (
              <>
                <div className="font-mono text-4xl font-bold text-[var(--accent-ink)] tabular-nums">
                  {verdict.score}
                  <span className="text-base font-normal text-[var(--text-tertiary)]">
                    /100
                  </span>
                </div>
                <div className="mt-1 font-mono t-xs tabular-nums text-[var(--text-secondary)]">
                  {TIER_LABEL[verdict.tier]}
                  {scoreVsYesterday != null && (
                    <span
                      className={
                        scoreVsYesterday > 0
                          ? " text-[var(--accent-ink)]"
                          : " text-[var(--cool-ink)]"
                      }
                    >
                      {" "}
                      · {scoreVsYesterday > 0 ? "+" : ""}
                      {scoreVsYesterday} vs yesterday EOD
                    </span>
                  )}
                </div>
              </>
            )}
            <div className="mt-3 t-xs text-[var(--text-tertiary)]">
              Should I buy? →
            </div>
          </Link>

          {/* Bitcoin Float */}
          <Link
            href="/float"
            className="nb-panel p-5 block"
          >
            <h3 className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
              Still in play
            </h3>
            {floatSyncing ? (
              <div className="font-mono text-2xl text-[var(--text-tertiary)]">
                Syncing
              </div>
            ) : (
              <>
                <div className="font-mono text-4xl font-bold text-[var(--accent-ink)] tabular-nums">
                  {(() => {
                    const f = fmtInPlayMillions(float.current.inPlay);
                    return (
                      <>
                        {f.whole}
                        <span className="text-base font-normal text-[var(--text-tertiary)]">
                          .{f.tenths}M
                        </span>
                      </>
                    );
                  })()}
                </div>
                <div className="mt-1 font-mono t-xs tabular-nums text-[var(--text-secondary)]">
                  {float.dailyDelta == null
                    ? "BTC · first snapshot"
                    : float.dailyDelta < 0
                      ? `BTC · ${Math.abs(Math.round(float.dailyDelta)).toLocaleString("en-US")} drained in 24h`
                      : "BTC · refilled in 24h"}
                </div>
              </>
            )}
            <div className="mt-3 t-xs text-[var(--text-tertiary)]">
              How much is left? →
            </div>
          </Link>

          {/* Cheapest treasury */}
          <Link
            href="/treasuries"
            className="nb-panel p-5 block"
          >
            <h3 className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
              Cheapest treasury
            </h3>
            {cheapest?.mNAV == null ? (
              <div className="font-mono text-2xl text-[var(--text-tertiary)]">
                Updating
              </div>
            ) : (
              <>
                <div className="font-mono text-4xl font-bold text-[var(--accent-ink)] tabular-nums">
                  {cheapest.mNAV.toFixed(2)}
                  <span className="text-base font-normal text-[var(--text-tertiary)]">
                    ×
                  </span>
                </div>
                <div className="mt-1 font-mono t-xs tabular-nums text-[var(--text-secondary)]">
                  {cheapest.ticker} ·{" "}
                  {cheapest.mNAV < 1 ? "below NAV" : "smallest premium"}
                </div>
              </>
            )}
            <div className="mt-3 t-xs text-[var(--text-tertiary)]">
              mNAV head-to-head →
            </div>
          </Link>

          {/* Directory pulse */}
          <Link
            href="/"
            className="nb-panel p-5 block"
          >
            <h3 className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
              Circular economy
            </h3>
            <div className="font-mono text-4xl font-bold text-[var(--accent-ink)] tabular-nums">
              {VENDORS.length}
              <span className="text-base font-normal text-[var(--text-tertiary)]">
                {" "}
                · {countryCount}
              </span>
            </div>
            <div className="mt-1 font-mono t-xs tabular-nums text-[var(--text-secondary)]">
              vendors · countries · growing weekly
            </div>
            <div className="mt-3 t-xs text-[var(--text-tertiary)]">
              Spend bitcoin →
            </div>
          </Link>
        </div>

        {/* Live desk strip · the revenue surface joins the briefing as a
            fifth reading. Client-fetched from the CDN-cached
            /api/hashrate (the DailyLoop board-read pattern) so the
            page's zero-new-server-fetch contract holds; renders nothing
            when the feed is degraded. */}
        {/* hashrate strip REMOVED 2026-08-13 · see HomeClient note */}

        {/* The daily loop · one checklist for every daily ritual (WEN,
            Trail, Gauntlet, Runner, Summit, Circuit) with live state +
            the countdown to the next drops. Replaced the Gauntlet-only
            banner 2026-07-11 · an incomplete checklist is the strongest
            come-back pull. */}
        <DailyLoop />

        {/* Daily-drop ping · the habit page offered only the RARE
            gauge-extreme push while the actual daily retention channel
            (the 00:20 UTC drop ping, topic "wen") was mounted on /wen
            and /arcade but not here. Same topic + copy family as the
            arcade mount; gauge subscribers untouched. */}
        <div className="mt-4">
          <PushAlertToggle
            topic="wen"
            heading="🔔 Daily drop alert"
            pitch="One ping when the new dailies drop at 00:00 UTC · the same set this checklist tracks."
            sideNote="One notification a day, exactly at the new drops. Nothing else rides this."
            onLabel="✓ Drop alert on · tap to disable"
            offLabel="Ping me at the next drop"
          />
        </div>

        {/* Flagship cabinet · Super Saylor is not a daily, so it sits
            under the loop as its own door. Not NEW: it launched in July. */}
        <div className="mt-3 text-center">
          <Link
            href="/super-saylor"
            prefetch={false}
            className="micro-label inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/40 bg-[var(--bg-elevated)] px-4 py-2.5 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 transition-colors"
          >
            Super Saylor · the flagship platformer
            <span aria-hidden>→</span>
          </Link>
        </div>

        <TodayShareRow
          score={degraded ? null : verdict.score}
          tierLabel={degraded ? null : TIER_LABEL[verdict.tier]}
          inPlay={floatSyncing ? null : float.current.inPlay}
          cheapestTicker={cheapest?.ticker ?? null}
          cheapestMNav={cheapest?.mNAV ?? null}
        />

        <div className="mt-8 flex flex-wrap items-center gap-3 t-xs text-[var(--text-tertiary)]">
          <a
            href="/feed-gauge.xml"
            className="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 hover:border-[var(--accent)]/40 hover:text-[var(--accent-ink)]"
          >
            RSS · gauge
          </a>
          <Link
            href="/pulse"
            className="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 hover:border-[var(--accent)]/40 hover:text-[var(--accent-ink)]"
          >
            This week&apos;s archive →
          </Link>
          <Link
            href="/methodology"
            className="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 hover:border-[var(--accent)]/40 hover:text-[var(--accent-ink)]"
          >
            How we compute this
          </Link>
        </div>

        {/* PushAlertToggle renders its own card + heading (Shell) ·
            the old outer wrapper double-carded it (audit 2026-07-11). */}
        <div className="mt-2">
          <PushAlertToggle />
        </div>

        <div className="mt-10">
          <InlineSubscribePrompt
            source="today"
            headline="Make this a habit without opening a tab"
            subhead="One signup covers gauge extremes, tier flips, new merchants, the weekly digest, and the monthly roundup · pick your channels."
          />
        </div>

        <div className="mt-10">
          <CitationBlock
            pageUrl={URL_}
            dataLabel="Galaxy Mind daily briefing"
            lastUpdatedISO={snapshot.asOf}
            surface="today"
          />
        </div>
      </div>

      <FooterDisclaimer />
    </main>
  );
}
