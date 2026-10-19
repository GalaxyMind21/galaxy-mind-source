// /runner · Node Runner, on its own page (split from /gauntlet ·
// operator request 2026-07-08). The reflex game earns a full-size
// playfield and its own front door: one tap, real candles as
// terrain, a run that only ends at the present day.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { ArcadeCrossLink } from "@/components/ArcadeCrossLink";
import { ArcadeScoreboard } from "@/components/ArcadeScoreboard";
import { AddToHomeScreen } from "@/components/AddToHomeScreen";
import { RunnerCabinet } from "./RunnerCabinet";
import { InAppBrowserBanner } from "@/components/InAppBrowserBanner";
import { pageOgImage } from "@/lib/og";

const URL_ = "https://galaxymind.space/runner";

export const metadata: Metadata = {
  title: "Node Runner · surf actual bitcoin history · Galaxy Mind",
  description:
    "Node Runner: a one-tap arcade run over the actual bitcoin price tape. Bear markets run downhill, reach the present and launch to the moon, endless.",
  alternates: { canonical: URL_ },
  openGraph: {
    title: "Node Runner · reach the present, go to the moon",
    description:
      "Actual candles as terrain. One tap to jump, instant restart. Catch the present and launch to the moon.",
    url: URL_,
    siteName: "Galaxy Mind",
    type: "website",
    images: pageOgImage("/runner/opengraph-image", "Node Runner · reach the present, go to the moon"),
  },
  twitter: {
    card: "summary_large_image",
    title: "Node Runner · to the moon",
    description:
      "Actual candles as terrain · one tap · reach the present and go to the moon.",
    site: "@GalaxyMind",
  },
};

export default function RunnerPage() {
  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-3 sm:pt-6 pb-16">
        <InAppBrowserBanner />
        {/* Compact hero · the intro overlay inside the cabinet carries the
            full rules, so the play window sits above the fold. On phones
            (most of our traffic) the eyebrow + paragraph are hidden so the
            game fills the screen · they stay for sm+ and crawlers
            (2026-07-10). */}
        <div className="micro-label hidden sm:block text-[var(--text-tertiary)] mb-2">
          The Arcade · One Tap · Actual Candles
        </div>
        <h1 className="display-title font-semibold text-[var(--text-primary)] mb-2">
          To the{" "}
          <span className="headline-gradient glow-text">moon</span>.
        </h1>
        <p className="hidden sm:block text-[var(--text-secondary)] text-sm sm:text-base max-w-2xl mb-4 leading-snug">
          One tap to jump the actual bitcoin price tape. Reach the present
          and you launch to the moon · low-gravity overtime, endless.
        </p>

        <RunnerCabinet />

        <ArcadeCrossLink from="runner" />

        <ArcadeScoreboard
          game="runner"
          title="Runner board · longest runs"
          daily
        />

        {/* Install affordance · renders only when actually installable
            and not already an app (2026-07-10). */}
        <AddToHomeScreen />

        <section className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <h2 className="micro-label text-[var(--accent-ink)] mb-2">
              The level is history
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Every rise and fall under the coin is an actual daily close
              from the same series the site&apos;s charts use. Nothing is
              generated · the 2022 bear really is that downhill.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <h2 className="micro-label text-[var(--accent-ink)] mb-2">
              Dates hidden until you fall
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              You run blind. The death screen lifts the mask for one
              line · the true date, and the named week if history
              itself took you down. Killed by FTX is a badge of honor.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <h2 className="micro-label text-[var(--accent-ink)] mb-2">
              Reach the present · then the moon
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              The tape runs out at today&apos;s candle · reaching it means
              surviving years of history at ramping speed. Catch the
              present and you launch to the moon: low gravity, endless,
              sats still stacking.
            </p>
          </div>
        </section>

        <section className="mt-10 max-w-2xl">
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Prefer thinking to reflexes? The other cabinet is{" "}
            <Link href="/gauntlet" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              The Bitcoin Gauntlet
            </Link>
            {" "}· trade a hidden window of actual history against the DCA
            bot, one scored run per day. Or pilot the future in the{" "}
            <Link href="/horizon" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              Timechain
            </Link>
            .
          </p>
        </section>

        {/* Soft bridge from the game into the tools · the terrain you
            just ran IS the real price series the Buying Gauge reads
            (2026-07-10). Converts a player into a tool user. */}
        <section className="mt-6 max-w-2xl rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            That terrain is the actual bitcoin price tape. Curious what it
            says to do with your actual stack today? The{" "}
            <Link href="/stack" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              Bitcoin Buying Gauge
            </Link>
            {" "}reads the same live market · ten signals, one number,
            stack-or-wait.
          </p>
          {/* The hashrate cross-sell + live strip that sat here were
              REMOVED 2026-08-13 · see the note in HomeClient. */}
        </section>

        <FooterDisclaimer />
      </div>
    </main>
  );
}
