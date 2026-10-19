// /gauntlet · The Bitcoin Gauntlet (v2 · 2026-07-08).
//
// A blind-history trading roguelike built to travel on X. Each run
// drops the player at a seeded random point in the real daily-close
// series with the dates MASKED: trade eight months of real bitcoin
// history without knowing which eight months, against a DCA bot given
// the identical salary and bills. The reveal unmasks the calendar and
// plots every trade against what actually happened. One shared window
// per UTC day (Wordle model) with streaks and a spoiler-free share
// grid; practice mode is unlimited.
//
// The cabinet is a client component; this server shell owns metadata
// and the crawlable rules below the fold, so search engines and no-JS
// visitors get the full pitch even though the game needs a browser.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { ArcadeCrossLink } from "@/components/ArcadeCrossLink";
import { ArcadeScoreboard } from "@/components/ArcadeScoreboard";
import { GauntletGame } from "./GauntletGame";
import { PushAlertToggle } from "@/components/PushAlertToggle";
import { InAppBrowserBanner } from "@/components/InAppBrowserBanner";
import { pageOgImage } from "@/lib/og";

const URL_ = "https://galaxymind.space/gauntlet";

export const metadata: Metadata = {
  title: "The Bitcoin Gauntlet · trade bitcoin history blind · Galaxy Mind",
  description:
    "The Bitcoin Gauntlet: trade eight months of actual bitcoin history with the dates hidden, against a DCA bot. New shared window daily, streaks, one run.",
  alternates: { canonical: URL_ },
  openGraph: {
    title: "The Bitcoin Gauntlet · can you beat the bot that never thinks?",
    description:
      "Actual prices, hidden dates. Trade eight months of bitcoin history blind against a DCA bot. New shared window every day.",
    url: URL_,
    siteName: "Galaxy Mind",
    type: "website",
    images: pageOgImage("/gauntlet/opengraph-image", "The Bitcoin Gauntlet · trade bitcoin history blind"),
  },
  twitter: {
    card: "summary_large_image",
    title: "The Bitcoin Gauntlet · beat the bot that never thinks",
    description:
      "Actual prices, hidden dates, a DCA bot to outtrade. New shared window every day.",
    site: "@GalaxyMind",
  },
};

export default function GauntletPage() {
  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-4 sm:pt-6 pb-16">
        <InAppBrowserBanner />
        <div className="micro-label text-[var(--text-tertiary)] mb-2">
          The Arcade · A New Window Every Day · Dates Hidden
        </div>
        {/* Compact hero · the cabinet + start button sit above the fold
            on a laptop (games audit 2026-07-09). The reveal + rules
            below the game carry the full story. */}
        <h1 className="display-title font-semibold text-[var(--text-primary)] mb-2">
          Survive the{" "}
          <span className="headline-gradient glow-text">gauntlet</span>.
        </h1>
        <p className="text-[var(--text-secondary)] text-sm sm:text-base max-w-2xl mb-4 leading-snug">
          Dropped into eight months of actual bitcoin history with the
          dates hidden. Trade blind against a DCA bot, then the mask
          comes off and you see exactly which top you sold.
        </p>

        <GauntletGame />

        <ArcadeCrossLink from="gauntlet" />
        {/* The hashrate bridge that sat here was REMOVED 2026-08-13 ·
            see the register note in lib/hashrate-copy. */}

        <ArcadeScoreboard
          game="gauntlet"
          title="Today's public board · one scored run each"
          verified
        />

        {/* Crawlable rules + thesis handoff · the game needs JS, the
            pitch does not. */}
        <section className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <h2 className="micro-label text-[var(--accent-ink)] mb-2">
              Blind, but never fake
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Every candle is an actual daily close from the same data
              every Galaxy Mind chart uses. The game hides when you
              are, never what happened. The reveal pins the true
              calendar · FTX, the halving, the ETF day · onto the
              window you just traded.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <h2 className="micro-label text-[var(--accent-ink)] mb-2">
              The bot never thinks
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Your benchmark gets the same $10,000, the same paychecks,
              the same bills · and simply buys every payday. No feed,
              no fear, no opinion. Your score is how you did against
              it. Most runs lose. That is the whole thesis, playable.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <h2 className="micro-label text-[var(--accent-ink)] mb-2">
              One window a day
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Everyone on Earth gets the same hidden window each UTC
              day, one scored run, streaks, badges, and a spoiler-free
              result grid built for posting. Practice windows are
              unlimited and unscored.
            </p>
          </div>
        </section>

        <section className="mt-10 max-w-2xl">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            Why a game?
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-3">
            Because everyone believes they would have held, and the
            chart archive cannot check. The gauntlet can. Blind to the
            calendar, your instincts are all you have: euphoria feels
            identical at every top, and capitulation feels like
            prudence at every bottom. Eighty seconds in the cabinet
            teaches what four years of charts argue · and the DCA bot
            keeps the receipts.
          </p>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Done trading blind? The other daily blindfold is{" "}
            <Link href="/wen" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              WEN
            </Link>{" "}
            · the same tape, five guesses at when it happened, thirty
            seconds.
          </p>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            When the mask comes off, check whether{" "}
            <Link href="/stack" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              the gauge
            </Link>{" "}
            thinks today looks like fear or euphoria · then go run the
            only strategy that beat you:{" "}
            <Link href="/spend-and-replace" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              stack on schedule, spend and replace
            </Link>
            , at a{" "}
            <Link href="/" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              verified merchant
            </Link>
            .
          </p>
        </section>


        {/* Daily-drop ping · same push topic as /wen's toggle (one
            channel for the daily drops · the 00:20 UTC ping names both
            games). Gauge-alert subscribers are untouched. */}
        <PushAlertToggle
          topic="wen"
          heading="🔔 Daily drop alert"
          pitch="One ping when the new dailies drop at 00:00 UTC · WEN and the Gauntlet, same puzzle for everyone."
          sideNote="One notification a day, exactly at the new drops. Nothing else rides this."
          onLabel="✓ Drop alert on · tap to disable"
          offLabel="Ping me at the next drop"
        />
        <FooterDisclaimer />
      </div>
    </main>
  );
}
