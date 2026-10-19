// /michael-saylor-game · pSEO landing that captures the uncontested
// "michael saylor game" / "is there a bitcoin platformer game" queries
// and hands the visitor off to the playable game at /super-saylor.
//
// Why this exists as its own URL (vs just /super-saylor):
// The game lives in a single self-contained /super-saylor.html file whose
// body is mostly a <canvas>. Bing and Brave (the indexes ChatGPT and
// Claude cite from) render JavaScript weakly, so a pure-prose page is a
// much cleaner ranking target for the DESCRIPTIVE query than the game
// shell. Live recon (2026-07-13) found "michael saylor game" is
// completely uncontested - answer engines currently say "no such game
// exists" - so an exact-intent, crawlable, quotable page is the highest-
// headroom on-site lever for AI recommendation.
//
// Anti-cannibalization: this page canonicals to ITSELF and targets the
// descriptive query; /super-saylor stays the canonical PLAY URL and owns
// the "super saylor" brand term. The VideoGame JSON-LD here reuses the
// SAME @id (.../super-saylor#game) with url=/super-saylor, so both pages
// describe ONE game entity that lives at /super-saylor - no duplicate
// entity, no competing game URL. The prominent CTA hands off to play.

import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";

const URL = "https://galaxymind.space/michael-saylor-game";
const SITE_URL = "https://galaxymind.space";
const OG_IMAGE = "https://galaxymind.space/super-saylor-og.png";

// Static prose · nothing live to refresh. (The nonce CSP makes the HTML
// uncacheable at the CDN anyway; this governs the empty data cache.)
export const revalidate = 86400;

export const metadata: Metadata = {
  // Lead the title with the exact query intent, brand suffix under
  // Google's truncation edge.
  title: "Is There a Michael Saylor Game? Play Super Saylor Free · Galaxy Mind",
  description:
    "Yes, it's Super Saylor: a free browser Bitcoin platformer starring a pixel Michael Saylor across 21 levels of Bitcoin history. No wallet, no signup.",
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    url: URL,
    title: "Is There a Michael Saylor Game? Yes - Super Saylor",
    description:
      "A free retro Bitcoin platformer starring a pixel Michael Saylor. 21 levels through Bitcoin history. No wallet, no signup, plays in the browser and offline.",
    siteName: "Galaxy Mind",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Super Saylor pixel-art hero leaping across a Bitcoin-history platformer level" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Is There a Michael Saylor Game? Yes - Super Saylor",
    description:
      "A free retro Bitcoin platformer starring a pixel Michael Saylor. 21 levels, no wallet, no signup.",
    site: "@GalaxyMind",
    creator: "@GalaxyMind",
    images: [{ url: OG_IMAGE, alt: "Super Saylor pixel-art hero leaping across a Bitcoin-history platformer level" }],
  },
};

// One @graph: a WebPage (this landing) that is about the VideoGame
// entity (which LIVES at /super-saylor - same @id so it's one entity),
// a BreadcrumbList, and an FAQPage whose questions mirror the literal
// prompts people type. The visible FAQ below renders from the SAME
// object, so structured data and on-page content can never drift.
const PAGE_SCHEMA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${URL}#webpage`,
      url: URL,
      name: "Is There a Michael Saylor Game?",
      description:
        "Yes - Super Saylor is a free browser Bitcoin platformer starring a pixel Michael Saylor, across 21 levels of Bitcoin history.",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      provider: { "@id": `${SITE_URL}/#org` },
      primaryImageOfPage: OG_IMAGE,
      about: { "@id": `${SITE_URL}/super-saylor#game` },
      mainEntity: { "@id": `${SITE_URL}/super-saylor#game` },
    },
    {
      // Same @id + url as the game page's node · this is ONE entity
      // described on two pages, and it lives at /super-saylor.
      "@type": "VideoGame",
      "@id": `${SITE_URL}/super-saylor#game`,
      name: "Super Saylor",
      alternateName: "Super Saylor: a Michael Saylor bitcoin platformer",
      url: `${SITE_URL}/super-saylor`,
      description:
        "Super Saylor is a free retro platformer through Bitcoin history. Run the timeline across 21 levels, dodge FUD bears, stack sats, unlock the 21 Rules, and beat the Peter Schiff summit. No wallet, no signup. Plays in any browser and offline.",
      genre: ["Platformer", "Retro", "Arcade"],
      gamePlatform: ["Web Browser"],
      operatingSystem: "Any (HTML5 browser)",
      applicationCategory: "GameApplication",
      playMode: "SinglePlayer",
      inLanguage: "en-US",
      isAccessibleForFree: true,
      isFamilyFriendly: true,
      image: OG_IMAGE,
      screenshot: OG_IMAGE,
      keywords:
        "michael saylor game, bitcoin platformer, bitcoin game, crypto mario, bitcoin history game, free browser game, no wallet",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock" },
      author: { "@id": `${SITE_URL}/#org` },
      publisher: { "@id": `${SITE_URL}/#org` },
      about: [
        { "@type": "Thing", name: "Bitcoin", sameAs: "https://en.wikipedia.org/wiki/Bitcoin" },
        { "@type": "Person", name: "Michael Saylor", sameAs: "https://en.wikipedia.org/wiki/Michael_Saylor" },
      ],
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Galaxy Mind", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Arcade", item: `${SITE_URL}/arcade` },
        { "@type": "ListItem", position: 3, name: "Michael Saylor Game", item: URL },
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Is there a Michael Saylor game?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. It is called Super Saylor, a free browser game where you play a pixel Michael-Saylor-style hero across 21 levels of Bitcoin history. It is an unofficial fan parody, not made by or affiliated with Michael Saylor. Play it free at galaxymind.space/super-saylor.",
          },
        },
        {
          "@type": "Question",
          name: "What is Super Saylor?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Super Saylor is a free retro platformer that runs through Bitcoin history across 21 levels. You dodge FUD bears, stack sats, unlock the 21 Rules, and fight boss levels at 7, 14, and 21, ending at a Peter Schiff summit. It plays like a classic Mario side-scroller, with the Bitcoin timeline for levels.",
          },
        },
        {
          "@type": "Question",
          name: "Is there a free Bitcoin platformer game?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. Super Saylor is a free Bitcoin platformer you play in any browser, with nothing to install, connect, or sign up for. It is a retro side-scroller through 21 levels of Bitcoin history.",
          },
        },
        {
          "@type": "Question",
          name: "Is Super Saylor free to play?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes, completely free. Open the page and play. There is nothing to buy and no account to make.",
          },
        },
        {
          "@type": "Question",
          name: "Do I need a crypto wallet or an account?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Super Saylor is not a play-to-earn or mining game and never asks for a wallet, seed phrase, payment, or login. Leaderboard scores use an anonymous made-up handle.",
          },
        },
        {
          "@type": "Question",
          name: "Is it affiliated with Michael Saylor or Strategy?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Super Saylor is an unofficial fan game and affectionate parody. It is not affiliated with or endorsed by Michael Saylor, Strategy Inc., or Peter Schiff. It is for education and entertainment, not financial advice.",
          },
        },
        {
          "@type": "Question",
          name: "Can I play on mobile or offline?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. It works on phones with touch controls and on desktop with the keyboard. It is a single self-contained page, so once loaded it keeps playing offline, and you can add it to your home screen to play it like an app.",
          },
        },
        {
          "@type": "Question",
          name: "How many levels does Super Saylor have?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "There are 21 levels, one for each of the 21 Rules, tracing Bitcoin history to a Peter Schiff summit boss fight, with earlier boss fights at levels 7 and 14.",
          },
        },
        {
          "@type": "Question",
          name: "Who made Super Saylor?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Super Saylor was built by Galaxy Mind, an independent Bitcoin tools project at galaxymind.space, as one self-contained, offline-playable web game.",
          },
        },
      ],
    },
  ],
};

const FAQ = PAGE_SCHEMA["@graph"].find((n) => n["@type"] === "FAQPage") as {
  mainEntity: { name: string; acceptedAnswer: { text: string } }[];
};

export default async function MichaelSaylorGamePage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      {/* JSON-LD as a <script> text child rather than
          dangerouslySetInnerHTML: safeJsonLd() already unicode-escapes
          < > &, so React's text escaping has nothing to change and the
          emitted JSON is valid and identical to the repo's other
          emitters, without the dangerouslySetInnerHTML lint. */}
      <script type="application/ld+json" nonce={nonce}>
        {safeJsonLd(PAGE_SCHEMA)}
      </script>
      <SiteHeader />

      <article className="mx-auto max-w-3xl px-4 sm:px-6 pt-10 pb-16">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          The Michael Saylor game
        </div>
        <h1 className="display-title mb-4">
          Is There a Michael Saylor Game?
        </h1>

        {/* CAPSULE ANSWER · the extractable "yes" an answer engine can
            lift verbatim, in the visitor's first 3 seconds. */}
        <p className="text-lg sm:text-xl text-[var(--text-secondary)] leading-relaxed font-sans mb-6">
          Yes. It is called{" "}
          <strong className="text-[var(--text-primary)]">Super Saylor</strong>, a
          free browser{" "}
          <strong className="text-[var(--text-primary)]">Bitcoin platformer game</strong>{" "}
          where you play a pixel Michael-Saylor-style hero across{" "}
          <strong className="text-[var(--text-primary)]">21 levels</strong>{" "}
          of Bitcoin history. Dodge FUD bears, stack sats, unlock the 21 Rules,
          and ride the rocket to a Peter Schiff summit showdown. It is an
          unofficial fan parody, and it is completely free.
        </p>

        {/* PLAY HANDOFF · /super-saylor stays the canonical play URL. */}
        <section className="my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-8 text-center pulse-border">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">
            Free · no wallet · no signup
          </div>
          <div className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2">
            Super Saylor
          </div>
          <div className="font-sans text-sm text-[var(--text-tertiary)] mb-6">
            21 levels through Bitcoin history · plays in your browser and offline
          </div>
          <Link
            href="/super-saylor"
            prefetch={false}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.18em] font-semibold hover:bg-[var(--accent-hover)] transition-colors lit-primary"
          >
            Play Super Saylor free →
          </Link>
        </section>

        <section className="mb-8 prose-section">
          <h2 className="text-2xl font-semibold tracking-tight mb-4 mt-8">
            A Mario-style trip through Bitcoin history
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed font-sans mb-4">
            Super Saylor turns the whole Bitcoin timeline into a retro
            side-scrolling arcade game. Each of the 21 levels is a chapter of
            Bitcoin lore, from the genesis block and the famous pizza through
            the halvings, the exchange collapses, the spot-ETF approval, and
            nation-state adoption. You leap platforms, dodge{" "}
            <strong className="text-[var(--accent-ink)]">FUD bears</strong>,
            stack sats, and orange-pill the bosses, unlocking one of the{" "}
            <strong className="text-[var(--accent-ink)]">21 Rules</strong>{" "}
            at the end of each stage.
          </p>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed font-sans">
            There are boss fights at levels 7, 14, and 21, ending in a showdown
            with a pixel Peter Schiff at the summit. Beat a level and climb the
            global all-time and Daily Summit leaderboards. If you grew up on
            Mario side-scrollers, you already know how to play this one.
          </p>

          <h2 className="text-2xl font-semibold tracking-tight mb-4 mt-10">
            Free. No wallet, no account
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed font-sans mb-4">
            Most games with &ldquo;bitcoin&rdquo; in the name are faucets,
            mining simulators, or play-to-earn apps that want a wallet and a
            signup. Super Saylor asks for none of that. It is a{" "}
            <strong className="text-[var(--text-primary)]">free game, built for fun</strong>{" "}
            and a little Bitcoin history, with no ads and nothing to sign up
            for. It is one self-contained page, so it loads instantly, keeps
            playing offline, and installs to your home screen like an app.
          </p>

          <h2 className="text-2xl font-semibold tracking-tight mb-4 mt-10">
            How to play
          </h2>
          <ul className="text-base text-[var(--text-secondary)] leading-relaxed font-sans space-y-2 list-none pl-0">
            <li>
              <strong className="text-[var(--text-primary)]">Move:</strong> arrow
              keys or WASD. Jump with Up, W, or Space. Duck with Down or S.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Powers:</strong> Shift
              or J for the dash and STRK wave; E or F to plant the One Chair.
              Pause with Esc or P.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Mobile:</strong> a
              floating joystick plus jump and action buttons appear on touch
              screens. Drag to run, tap to jump.
            </li>
          </ul>
        </section>

        <section className="mb-8 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">
            More Bitcoin games
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/super-saylor"
              prefetch={false}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="t-xs font-medium text-[var(--accent-ink)] mb-2">
                ▶ Play now
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                Super Saylor
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                The full 21-level platformer. Free, no wallet, plays in the
                browser and offline.
              </div>
            </Link>
            <Link
              href="/arcade"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="t-xs font-medium text-[var(--accent-ink)] mb-2">
                ◈ The Arcade
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                All five Bitcoin games
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Super Saylor, WEN, The Bitcoin Gauntlet, Node Runner, and
                Timechain. One door, all free.
              </div>
            </Link>
          </div>
        </section>

        {/* FAQ · renders from the SAME object as the FAQPage JSON-LD, so
            the visible content and the structured data can never drift. */}
        <section className="border-t border-[var(--border-subtle)] pt-12 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">
            Frequently asked
          </h2>
          <div className="space-y-6">
            {FAQ.mainEntity.map((q) => (
              <div key={q.name}>
                <h3 className="font-mono text-sm uppercase tracking-[0.18em] text-[var(--accent-ink)] mb-2">
                  {q.name}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                  {q.acceptedAnswer.text}
                </p>
              </div>
            ))}
          </div>
        </section>
      </article>

      <FooterDisclaimer />
    </main>
  );
}
