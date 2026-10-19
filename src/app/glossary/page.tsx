// /glossary · plain-language definitions for every Bitcoin / treasury
// metric used across Galaxy Mind. Optimized for two audiences:
//
//   1. Human visitors who land here from a search query like "what is
//      mNAV" or "Puell Multiple meaning" · they get a single-page
//      reference they can scan or anchor-link to.
//
//   2. AI agents (Perplexity, ChatGPT search, Claude search, Google
//      AI Overviews) · the per-term DefinedTerm JSON-LD in the layout
//      gives them structured definitions they can quote directly with
//      attribution back to Galaxy Mind.
//
// Source of truth: src/lib/glossary.ts (GLOSSARY array). The JSON-LD
// in layout.tsx reads the same data so the visible page and the
// machine-readable schema stay in sync automatically.

import type { Metadata } from "next";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { GLOSSARY } from "@/lib/glossary";
import { GlossarySearchableList } from "./GlossarySearchableList";
import { SiteHeader } from "@/components/SiteHeader";
import { OG_DIRECTORY } from "@/lib/og";

const URL = "https://galaxymind.space/glossary";

export const metadata: Metadata = {
  title: "Bitcoin glossary · Galaxy Mind",
  description:
    "Plain-language definitions of the Bitcoin and treasury metrics Galaxy Mind uses: mNAV, MVRV, Puell, Mayer, accretion, sleeve, and more. Written to be cited.",
  alternates: { canonical: URL },
  openGraph: {
    images: OG_DIRECTORY,
    title: "Bitcoin glossary · Galaxy Mind",
    description:
      "Definitions for mNAV, MVRV, Puell Multiple, Mayer Multiple, Buying Gauge tier, BTC-per-share accretion, and more · written to be quotable.",
    url: URL,
    siteName: "Galaxy Mind",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bitcoin glossary · Galaxy Mind",
    description:
      "Definitions for the Bitcoin metrics that drive the Buying Gauge, Treasury Scoreboard, and Allocation Engine.",
    creator: "@GalaxyMind",
  },
};

export default function GlossaryPage() {
  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />

      <article className="max-w-2xl mx-auto px-6 pt-12 pb-20">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Glossary
        </div>
        <h1 className="display-title mb-4 text-[var(--text-primary)]">
          Bitcoin{" "}
          <span className="text-[var(--accent-ink)] glow-text">vocabulary</span>.
        </h1>
        <p className="text-[var(--text-secondary)] text-base mb-10 leading-relaxed">
          Plain-language definitions for every metric Galaxy Mind uses ·
          mNAV, MVRV, Puell, Mayer, Buying Gauge tier, accretion, and more.
          Standalone definitions, written to be quoted. Every entry links
          back to where the metric drives a live decision on the site.
        </p>

        {/* Section table-of-contents · jump links so visitors can find
            the term cluster they need without scrolling. Anchor IDs
            match section.slug values from src/lib/glossary.ts. */}
        <nav
          aria-label="Glossary sections"
          className="mb-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-4"
        >
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-2">
            Sections
          </div>
          {/* Chips, not bare text. These are the page's table of contents and
              they were --text-secondary with no underline, no border and no
              accent — pixel-identical to the body copy beside them, so the
              one row on the page whose whole purpose is to be clicked gave
              no sign that it could be. The site already owns this shape in
              the directory's filter rail. */}
          <ul className="flex flex-wrap gap-2 text-xs">
            {GLOSSARY.map((s) => (
              <li key={s.slug}>
                <a
                  href={`#${s.slug}`}
                  className="inline-flex items-center rounded-full border border-[var(--nb-hair)] bg-[var(--nb-surface)] px-3 py-1.5 text-[var(--text-secondary)] hover:border-[var(--accent)]/45 hover:text-[var(--accent-ink)] transition-colors"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Searchable term list · client component for type-to-filter.
            Initial paint matches the prior static dl/dt/dd structure
            (input empty → all sections render) so SEO + AI-agent
            crawlability is preserved. Interactivity hydrates after
            mount, letting visitors who land here from a /stack or
            /treasuries GlossaryTerm "Read more →" link short-circuit
            to a specific term without scrolling. */}
        <GlossarySearchableList sections={GLOSSARY} />

        {/* Cross-link footer · the FAQ + About pages are the natural
            next step for a visitor who's just learned the vocabulary
            and now wants to see it applied. */}
        <div className="mt-16 pt-8 border-t border-[var(--border-subtle)] flex flex-wrap items-baseline gap-4 text-xs">
          <span className="t-xs font-medium text-[var(--text-tertiary)]">
            More
          </span>
          <a href="/faq" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
            FAQ →
          </a>
          <a href="/about" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
            About Galaxy Mind →
          </a>
          <a href="/stack" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
            Buying Gauge →
          </a>
          <a href="/treasuries" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
            Treasuries →
          </a>
        </div>
      </article>

      <FooterDisclaimer />
    </main>
  );
}
