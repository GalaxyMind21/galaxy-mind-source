// /arcade · the single front door to all eight games (2026-07-09 · WEN joined 2026-07-11 · SUPER SAYLOR, the flagship, 2026-07-11 · BITCOIN KART, the 3D kart racer, 2026-07-14 · THE HODL TRAIL, the daily history expedition, 2026-07-25 · CHOP, the live-block slicer, 2026-08-04).
//
// The Arcade group in the nav points at three routes; this hub gives
// them one crawlable landing page so a shared "/arcade" link, a search
// result, or a no-JS visitor lands somewhere that explains the whole
// cabinet in the site's own voice. Pure server component · no client
// JS, every pitch matches the game's own page.

import type { Metadata } from "next";
import Link from "next/link";
import { isStaticHtmlRoute } from "@/lib/nav";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { gauntletNumber } from "@/app/gauntlet/engine";
import { kartComboFor, summitLevelFor } from "@/lib/gauntlet-day";
import { ArcadeSeasonalEgg } from "@/components/ArcadeSeasonalEgg";
import { ArcadePreview } from "@/components/ArcadePreview";
import { KonamiEgg } from "@/components/KonamiEgg";
import { PushAlertToggle } from "@/components/PushAlertToggle";
import { headers } from "next/headers";
import { safeJsonLd, buildBreadcrumb } from "@/lib/json-ld";
import { InAppBrowserBanner } from "@/components/InAppBrowserBanner";
import { pageOgImage } from "@/lib/og";

const URL_ = "https://galaxymind.space/arcade";

// Regenerate hourly so "Gauntlet #N is open" stays current without
// going fully dynamic · the daily gauntlet rolls at UTC midnight.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "The Arcade · eight Bitcoin games, one door · Galaxy Mind",
  description:
    "Eight bitcoin games, one door: slice the live chain in CHOP, race Bitcoin Kart, run the timeline as Super Saylor, or survive the HODL Trail.",
  alternates: { canonical: URL_ },
  openGraph: {
    title: "The Arcade · play the bitcoin tape",
    description:
      "Eight bitcoin games · CHOP, Super Saylor, Bitcoin Kart, The HODL Trail, WEN, The Bitcoin Gauntlet, Node Runner, and Timechain.",
    url: URL_,
    siteName: "Galaxy Mind",
    type: "website",
    images: pageOgImage("/arcade/opengraph-image", "The Arcade · eight Bitcoin games"),
  },
  twitter: {
    card: "summary_large_image",
    title: "The Arcade · play the bitcoin tape",
    description:
      "Eight bitcoin games · slice the live chain, race the circuit, run the timeline, survive the trail, date the chart, trade blind, outrun the candles, stack the timechain.",
    site: "@GalaxyMind",
  },
};

type Cabinet = {
  href: string;
  eyebrow: string;
  name: string;
  pitch: string;
};

// Pitches lifted from each game's own page.tsx so the hub can never
// drift from what the cabinets actually are.
const CABINETS: Cabinet[] = [
  {
    // The 3D cabinet · launch 2026-07-14 · promoted to slot 1
    // (2026-07-26: measured most-played cabinet · operator confirmed). Pitch lifted from the game's
    // own index.html so the hub can't drift.
    href: "/bitcoin-kart",
    eyebrow: "Most played · full 3D kart racer",
    name: "BITCOIN KART",
    pitch:
      "One chair. Ten racers. No second best. A 3D kart racer through bitcoin culture: Saylor's throne-kart versus Schiff's gold dragster across 12 tracks, with drift sparks, Orange Blocks, the Regulatory Hammer, and a locked ghost of the protocol.",
  },
  {
    // Launch flagship (2026-07-11) · slot 2 since 2026-07-26.
    href: "/super-saylor",
    eyebrow: "The flagship · new DAILY SUMMIT",
    name: "SUPER SAYLOR",
    pitch:
      "A full Mario-style platformer through bitcoin history. Run 21 levels from the genesis block to the moon, stomp FUD bears, unlock the 21 Rules, and face Peter Schiff at the summit. New: the Daily Summit, one level a day raced by everyone, fastest climb tops the board.",
  },
  {
    // Launch 2026-08-04 · slot 3 for the launch window (new cabinet gets
    // the discovery slot under the two proven heavyweights).
    href: "/chop",
    eyebrow: "NEW · slice the live chain",
    name: "CHOP",
    pitch:
      "Slice the latest bitcoin block to the beat. Every cube is one of its transactions, brighter ones paid more, the last cut seals the block. Swipe to the music, chain a combo that climbs in pitch, and post your sats to today's board.",
  },
  {
    href: "/wen",
    eyebrow: "Daily · 30 seconds",
    name: "WEN",
    pitch:
      "An actual 90 day slice of the tape with the dates redacted. Five guesses at wen it was, every arrow narrows the timeline, closeness pays in sats. Same puzzle worldwide each UTC day.",
  },
  {
    href: "/gauntlet",
    eyebrow: "Daily · Blind history",
    name: "The Bitcoin Gauntlet",
    pitch:
      "A daily blind-history trading game. You are dropped somewhere in actual bitcoin history with the dates hidden, trade eight months against a DCA bot on the same salary and bills, then the mask comes off. Beat the bot that never thinks.",
  },
  {
    href: "/runner",
    eyebrow: "One tap · Actual candles",
    name: "Node Runner",
    pitch:
      "A one-tap arcade run over the actual price tape. Bear markets run downhill, red candles grew into the spikes at their true dates, reach the present and you go to the moon · a low-gravity overtime that never ends.",
  },
  {
    href: "/horizon",
    eyebrow: "One tap · Build the chain",
    name: "Timechain",
    pitch:
      "A one-tap block stacker on the halving clock. Blocks pay 50, then 25, then 12.5 as the chain speeds up · stack them clean, bank the sats, and see how high the timechain goes before it orphans.",
  },
  {
    // Cabinet #7 · demoted from slot 3 (share-funnel audit 2026-07-26:
    // the arcade's hero slots belong to the cabinets players actually
    // play · Kart leads on measured traction).
    href: "/trail",
    eyebrow: "Daily · story expedition",
    name: "THE HODL TRAIL",
    pitch:
      "Lead four plebs from the 2011 backwoods to the citadel. Ten legs of actual bitcoin history · stake sats on the choices history actually graded, and share the tombstones. One expedition per UTC day, replay-verified board.",
  },
];

export default async function ArcadePage() {
  const gauntletNo = gauntletNumber(Date.now());

  // Structured data (2026-07-29). This page had NONE, despite being the
  // designated front door to every cabinet and the only crawlable
  // landing for a no-JS visitor — the header's Arcade entry is a client
  // <button>, so these links exist in server HTML only here and in the
  // footer. CollectionPage + ItemList is the same shape every other
  // directory-style surface on the site emits; the list data is the
  // CABINETS array the page already renders, so the two cannot drift.
  //
  // Deliberately NOT emitting per-cabinet VideoGame nodes: Google has no
  // VideoGame rich result, so that would be markup with no surface.
  const ARCADE_LD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${URL_}/#arcade`,
        url: URL_,
        name: "The Galaxy Mind Arcade",
        description:
          "Eight free browser games built on actual bitcoin data. Race a 3D kart, run 21 levels of bitcoin history, or slice cubes cut from the latest mined block. The daily set adds a chart-dating puzzle, a blind-history trading roguelike, an expedition through the eras, a runner on the tape, and a block stacker on the halving clock.",
        isPartOf: { "@id": "https://galaxymind.space/#website" },
        publisher: { "@id": "https://galaxymind.space/#org" },
        inLanguage: "en-US",
        mainEntity: { "@id": `${URL_}/#cabinets` },
      },
      {
        "@type": "ItemList",
        "@id": `${URL_}/#cabinets`,
        name: "Arcade cabinets",
        numberOfItems: CABINETS.length,
        itemListElement: CABINETS.map((c, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `https://galaxymind.space${c.href}`,
          name: c.name,
          description: c.pitch,
        })),
      },
      buildBreadcrumb([
        { name: "Galaxy Mind", url: "https://galaxymind.space" },
        { name: "The Arcade", url: URL_ },
      ]),
    ],
  };

  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      {/* Static cabinet data + house strings only · no user input. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(ARCADE_LD) }}
      />
      <SiteHeader />
      <KonamiEgg />

      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <InAppBrowserBanner />
        <p className="night-bench-kicker">
          Eight cabinets · actual data
        </p>
        <h1 className="display-title mb-3">
          Play the tape.
        </h1>
        <p className="night-bench-lede mb-4">
          Eight games from the bitcoin story · most run on the actual tape,
          the kart racer runs on pure culture, and the newest one runs on
          the live chain itself. Slice the latest block in CHOP, race the
          Orange Circuit, survive the HODL Trail, run the timeline as
          Super Saylor, date the mystery chart, trade a hidden window
          blind, outrun the candles, or stack the timechain.
        </p>
        {/* Today's full daily set, concretely · the combo/level rotations
            are pure functions of the day number (lib/gauntlet-day, the
            drift-guarded mirrors of the game clients), so this costs
            zero upstream calls and regenerates with the hourly
            revalidate. Concrete beats generic: "Pizza Beach · FULL
            SEND" is an invitation, "dailies are open" is wallpaper. */}
        <p className="micro-label text-[var(--accent-ink)] mb-6">
          Today&apos;s set #{gauntletNo} · WEN · Trail · Gauntlet · Summit
          level {summitLevelFor(gauntletNo)} · Circuit:{" "}
          {kartComboFor(gauntletNo).track} ·{" "}
          {kartComboFor(gauntletNo).klass}
          {kartComboFor(gauntletNo).mirror ? " · MIRROR" : ""}
        </p>

        <ArcadeSeasonalEgg />

        {/* Eight cabinets · clean rows of 3 on lg. */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CABINETS.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              prefetch={isStaticHtmlRoute(c.href) ? false : undefined}
              className="group card-lift nb-panel p-5 flex flex-col"
            >
              {/* real gameplay loop · recorded from the live cabinet */}
              <ArcadePreview
                slug={c.href.slice(1)}
                alt={`${c.name} gameplay preview`}
              />
              <div className="night-bench-kicker mb-2">
                {c.eyebrow}
              </div>
              <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                {c.name}
              </h2>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
                {c.pitch}
              </p>
              {/* mt-auto pins every Enter to the bottom of its card. The
                  grid already stretches the cards to equal height, but the
                  link simply followed the pitch, so a row of three landed
                  at three different heights (measured 597 / 664 / 631 on
                  the second row) and the rank of CTAs read as ragged. */}
              <span className="mt-auto pt-1 text-sm text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
                Enter →
              </span>
            </Link>
          ))}
        </section>

        <section className="mt-10 max-w-2xl">
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            The tape cabinets run on actual daily closes · the game hides
            when you are, never what happened. When you are done playing, see
            whether{" "}
            <Link href="/stack" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              the gauge
            </Link>{" "}
            thinks today looks like fear or euphoria, or find a{" "}
            <Link href="/" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              verified merchant
            </Link>{" "}
            to spend at.
          </p>
          <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed">
            New to the flagship? Read what the{" "}
            <Link
              href="/michael-saylor-game"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              Michael Saylor game
            </Link>{" "}
            is, then jump into Super Saylor.
          </p>
          {/* The hashrate cross-sell + live strip that sat here were
              REMOVED 2026-08-13 · see the note in HomeClient. */}
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
