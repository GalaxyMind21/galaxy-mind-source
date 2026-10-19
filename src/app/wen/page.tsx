// /wen · WEN, the daily chart-dating game (cabinet #4 · 2026-07-11).
// A real 90-day slice of the tape with the dates redacted, five
// guesses at wen it was, closeness scored in sats, one puzzle per UTC
// day for everyone. The share grid is the growth engine · see
// the /wen design notes

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { ArcadeCrossLink } from "@/components/ArcadeCrossLink";
import { ArcadeScoreboard } from "@/components/ArcadeScoreboard";
import { AddToHomeScreen } from "@/components/AddToHomeScreen";
import { PushAlertToggle } from "@/components/PushAlertToggle";
import { WenGame } from "./WenGame";
import { InAppBrowserBanner } from "@/components/InAppBrowserBanner";
import { pageOgImage } from "@/lib/og";

const URL_ = "https://galaxymind.space/wen";

export const metadata: Metadata = {
  title: "WEN · guess when the bitcoin chart happened · Galaxy Mind",
  description:
    "WEN: guess when an actual 90-day slice of the bitcoin price tape happened. Dates redacted, five guesses scored in sats, same puzzle for everyone each day.",
  alternates: { canonical: URL_ },
  openGraph: {
    title: "WEN · the daily bitcoin chart-dating game",
    description:
      "Five guesses at when an actual slice of the tape happened. Same puzzle for everyone, every UTC day. Scored in sats.",
    url: URL_,
    siteName: "Galaxy Mind",
    type: "website",
    images: pageOgImage("/wen/opengraph-image", "WEN · the daily bitcoin chart-dating game"),
  },
  twitter: {
    card: "summary_large_image",
    title: "WEN · wen was this chart?",
    description:
      "A genuine bitcoin chart, dates redacted · five guesses, scored in sats, new tape every day.",
    site: "@GalaxyMind",
  },
};

export default function WenPage() {
  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-3 sm:pt-6 pb-16">
        <InAppBrowserBanner />
        {/* Compact hero · the coach mark inside the cabinet carries the
            rules, so the puzzle sits above the fold. Phone traffic gets
            the game first · eyebrow + paragraph stay for sm+ and
            crawlers (Runner precedent). */}
        <div className="micro-label hidden sm:block text-[var(--text-tertiary)] mb-2">
          The Arcade · Daily Puzzle · True Tape
        </div>
        <h1 className="display-title font-semibold text-[var(--text-primary)] mb-2">
          <span className="headline-gradient glow-text">Wen</span>
          {" "}was this?
        </h1>
        <p className="hidden sm:block text-[var(--text-secondary)] text-sm sm:text-base max-w-2xl mb-4 leading-snug">
          An actual 90 day slice of the bitcoin tape, dates redacted. Five
          guesses. Same puzzle for everyone, every UTC day · scored in
          sats.
        </p>

        <WenGame />

        <ArcadeCrossLink from="wen" />
        {/* The hashrate bridge that sat here was REMOVED 2026-08-13 ·
            see the register note in lib/hashrate-copy. */}

        <ArcadeScoreboard
          game="wen"
          title="WEN board · sharpest tape-daters"
          daily
          verified
        />

        <AddToHomeScreen gameName="WEN" />

        {/* Daily-drop ping · its own push TOPIC, so enabling it never
            spams gauge-alert subscribers and disabling it never kills
            their threshold alerts (lib/push topics · 2026-07-11). */}
        <PushAlertToggle
          topic="wen"
          heading="🔔 Daily drop alert"
          pitch="One ping when the new WEN drops at 00:00 UTC · come back, date the tape, keep the streak."
          sideNote="One notification a day, exactly at the new puzzle. Nothing else rides this."
          onLabel="✓ Drop alert on · tap to disable"
          offLabel="Ping me at the next drop"
        />

        <section className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <h2 className="micro-label text-[var(--accent-ink)] mb-2">
              The chart is genuine
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Every puzzle is 90 actual daily closes from the same series
              the site&apos;s tools read. Nothing is generated · if the
              slice looks like a bloodbath, it was one.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <h2 className="micro-label text-[var(--accent-ink)] mb-2">
              Price is the trap
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              The price axis stays visible, and that feels like a
              giveaway until you remember bitcoin revisits its levels.
              The number that screamed euphoria one year printed
              despair in another.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <h2 className="micro-label text-[var(--accent-ink)] mb-2">
              One tape a day
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              No archive, no replays. Everyone worldwide dates the same
              slice each UTC day, the board settles at midnight, and
              the streak is the flex. If you lived the tape, prove it.
            </p>
          </div>
        </section>

        {/* Soft bridge into the tools · same pattern as /runner. */}
        <section className="mt-10 max-w-2xl rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Good at reading old tape? The{" "}
            <Link href="/stack" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              Bitcoin Buying Gauge
            </Link>{" "}
            reads the live one · ten signals, one number, stack-or-wait,
            updated all day.
          </p>
        </section>

        <FooterDisclaimer />
      </div>
    </main>
  );
}
