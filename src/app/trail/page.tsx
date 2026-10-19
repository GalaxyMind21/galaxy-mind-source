// /trail · THE HODL TRAIL, the daily expedition through bitcoin
// history (cabinet #7 · 2026-07-25). One caravan of four plebs, ten
// legs from 2011 to today, choices scored in sats against real
// history, one shared expedition per UTC day · replay-verified boards
// like WEN/Gauntlet. Positioning rule from the launch research: lead
// with "survive bitcoin history", never "wagon game but crypto".

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { ArcadeCrossLink } from "@/components/ArcadeCrossLink";
import { ArcadeScoreboard } from "@/components/ArcadeScoreboard";
import { AddToHomeScreen } from "@/components/AddToHomeScreen";
import { TrailGame } from "./TrailGame";
import { InAppBrowserBanner } from "@/components/InAppBrowserBanner";
import { pageOgImage } from "@/lib/og";

const URL_ = "https://galaxymind.space/trail";

export const metadata: Metadata = {
  title: "THE HODL TRAIL · survive 15 years of bitcoin history · Galaxy Mind",
  description:
    "Lead four plebs from 2011 to the citadel. Ten legs of actual bitcoin history, choices scored in sats, one shared expedition per UTC day.",
  alternates: { canonical: URL_ },
  openGraph: {
    title: "THE HODL TRAIL · the daily bitcoin history expedition",
    description:
      "Four plebs, fifteen years, one stack. Survive exchange collapses, manias and winters · same trail for everyone, every UTC day, scored in sats.",
    url: URL_,
    siteName: "Galaxy Mind",
    type: "website",
    images: pageOgImage("/trail/opengraph-image", "THE HODL TRAIL · the daily bitcoin history expedition"),
  },
  twitter: {
    card: "summary_large_image",
    title: "THE HODL TRAIL · can your caravan survive bitcoin history?",
    description:
      "Ten legs from 2011 to today. Stake sats on the choices history graded · one expedition a day, verified board.",
    site: "@GalaxyMind",
  },
};

export default function TrailPage() {
  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-3 sm:pt-6 pb-16">
        <InAppBrowserBanner />
        <div className="micro-label hidden sm:block text-[var(--text-tertiary)] mb-2">
          The Arcade · Daily Expedition · True History
        </div>
        <h1 className="display-title font-semibold text-[var(--text-primary)] mb-2">
          The <span className="headline-gradient glow-text">HODL</span>
          {" "}Trail
        </h1>
        <p className="hidden sm:block text-[var(--text-secondary)] text-sm sm:text-base max-w-2xl mb-4 leading-snug">
          Lead four plebs from the 2011 backwoods to the citadel. Ten
          legs of actual bitcoin history · every choice stakes sats, and
          the right call is whatever history actually rewarded. Same
          trail for everyone, every UTC day.
        </p>

        <TrailGame />

        <ArcadeCrossLink from="trail" />
        {/* The hashrate bridge that sat here was REMOVED 2026-08-13 ·
            see the register note in lib/hashrate-copy. */}

        <ArcadeScoreboard
          game="trail"
          title="Trail board · richest caravans"
          daily
          verified
        />

        <AddToHomeScreen gameName="THE HODL TRAIL" />

        <section className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <h2 className="micro-label text-[var(--accent-ink)] mb-2">
              The history happened
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Every leg is a documented moment · the card-shop exchange,
              the twenty percent machine, the balance-sheet story. If a
              choice sounds absurd, someone made it with actual sats.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <h2 className="micro-label text-[var(--accent-ink)] mb-2">
              Knowledge is the edge
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Scary-looking calls were sometimes the trade of the
              decade, and comfortable ones cost plebs everything. If
              you lived the tape, your stack will show it.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <h2 className="micro-label text-[var(--accent-ink)] mb-2">
              One trail a day
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              No replays, no do-overs. Everyone worldwide rides the
              same expedition each UTC day, scores are replay-verified
              server-side, and the tombstones are shareable.
            </p>
          </div>
        </section>

        <section className="mt-10 max-w-2xl rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Survived the history? The{" "}
            <Link href="/stack" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              Bitcoin Buying Gauge
            </Link>{" "}
            reads the live tape · ten signals, one number, stack-or-wait.
            And the{" "}
            <Link href="/" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              vendor directory
            </Link>{" "}
            is where the citadel actually gets built.
          </p>
        </section>

        <FooterDisclaimer />
      </div>
    </main>
  );
}
