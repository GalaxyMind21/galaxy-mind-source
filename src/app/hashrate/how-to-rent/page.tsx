// /hashrate/how-to-rent · the hand-holding walkthrough (2026-08-08,
// operator ask: "guide them step by step as to how to rent, aka what
// to do once they click rent now and get forwarded to MRR").
//
// The four-step summary on /hashrate answers "what happens"; this page
// answers "what do I click", including everything that occurs AFTER
// the visitor leaves us for the marketplace — the exact stretch where
// a first-timer bounces.
//
// Static by design: every word is house copy from lib/hashrate-copy
// (gated by the banned-vocabulary scan) and nothing here reads a live
// feed, so the page cannot be wrong about a price it never quotes. The
// live numbers stay on /hashrate, one click away, and this page links
// there rather than restating them — published numbers come from the
// lib that owns them, never from a prose page (the README).

import type { Metadata } from "next";
import { mrrOnly } from "@/lib/rentals/mode";
import { MarketplaceGuide } from "../components/MarketplaceGuide";
import { MRR_GUIDE_TITLE, MRR_GUIDE_DESCRIPTION, MRR_GUIDE_H1, MRR_GUIDE_LEDE, MRR_GUIDE_STEPS } from "@/lib/mrr-page-copy";
import Link from "next/link";
import { headers } from "next/headers";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd, buildBreadcrumb, buildHowTo } from "@/lib/json-ld";
import { mrrGuideJsonLd } from "@/lib/how-to-rent-jsonld";
import {
  GUIDE_PAGE_TITLE,
  GUIDE_PAGE_DESCRIPTION,
  GUIDE_MASTHEAD,
  GUIDE_PREREQ_TITLE,
  GUIDE_PREREQS,
  GUIDE_STEPS,
  GUIDE_MISTAKES_TITLE,
  GUIDE_MISTAKES,
  GUIDE_CLOSING_TITLE,
  GUIDE_CLOSING,
} from "@/lib/hashrate-copy";

const SITE_URL = "https://galaxymind.space";
const URL_ = `${SITE_URL}/hashrate/how-to-rent`;

const DIRECT_METADATA: Metadata = {
  title: GUIDE_PAGE_TITLE,
  description: GUIDE_PAGE_DESCRIPTION,
  alternates: { canonical: URL_ },
  openGraph: {
    type: "website",
    title: GUIDE_PAGE_TITLE,
    description: GUIDE_PAGE_DESCRIPTION,
    url: URL_,
    // Reuses the desk's own card · an openGraph block without images
    // ships NO og:image at all (the README).
    images: [
      {
        url: "/hashrate/opengraph-image",
        width: 1200,
        height: 630,
        alt: "How to rent bitcoin hashrate, step by step · Galaxy Mind",
      },
    ],
  },
};

// RENTALS_MODE=mrr_only (default): the marketplace guide replaces the direct-rental page; direct content stays below.
export function generateMetadata(): Metadata {
  if (!mrrOnly()) return DIRECT_METADATA;
  return {
    ...DIRECT_METADATA,
    title: MRR_GUIDE_TITLE,
    description: MRR_GUIDE_DESCRIPTION,
    openGraph: { ...DIRECT_METADATA.openGraph, title: MRR_GUIDE_TITLE, description: MRR_GUIDE_DESCRIPTION },
  };
}

export default async function HowToRentPage() {
  const nonce = (await headers()).get("x-galaxymind-nonce") ?? undefined;
  if (mrrOnly()) {
    return (
      <MarketplaceGuide
        h1={MRR_GUIDE_H1}
        lede={MRR_GUIDE_LEDE}
        steps={MRR_GUIDE_STEPS}
        jsonLd={mrrGuideJsonLd()}
        nonce={nonce}
      />
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <script
          type="application/ld+json"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            // buildBreadcrumb returns a bare node (it is normally
            // spliced into a page's @graph), so the context is added
            // here rather than assumed.
            __html: safeJsonLd({
              "@context": "https://schema.org",
              ...buildBreadcrumb([
                { name: "Rent hashrate", url: `${SITE_URL}/hashrate` },
                { name: "How to rent", url: URL_ },
              ]),
            }),
          }}
        />
        <script
          type="application/ld+json"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            // buildHowTo returns a bare node (same spirit as
            // buildBreadcrumb), so the context is added here.
            __html: safeJsonLd({
              "@context": "https://schema.org",
              ...buildHowTo({
                name: GUIDE_PAGE_TITLE,
                description: GUIDE_PAGE_DESCRIPTION,
                url: URL_,
                totalTime: "PT10M",
                steps: GUIDE_STEPS.map((s) => ({
                  name: s.title,
                  text: s.note ? `${s.body} ${s.note}` : s.body,
                })),
                supply: [{ name: GUIDE_PREREQS[0] }],
                tool: [{ name: GUIDE_STEPS[1].title }],
              }),
            }),
          }}
        />

        <p className="micro-label text-[var(--text-tertiary)]">
          <Link
            href="/hashrate"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            Rent hashrate
          </Link>{" "}
          · step by step
        </p>
        <h1 className="display-title mt-3">
          How to <span className="headline-gradient">rent</span>
        </h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)] sm:text-base">
          {GUIDE_MASTHEAD}
        </p>

        <section className="mt-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <p className="micro-label text-[var(--text-tertiary)]">
            {GUIDE_PREREQ_TITLE}
          </p>
          <ul className="mt-3 space-y-2">
            {GUIDE_PREREQS.map((p) => (
              <li
                key={p}
                className="flex gap-2 text-sm text-[var(--text-secondary)]"
              >
                <span aria-hidden="true" className="text-[var(--accent)]">
                  ·
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </section>

        <ol className="mt-8 space-y-4">
          {GUIDE_STEPS.map((s, i) => (
            <li
              key={s.title}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
            >
              <div className="flex items-baseline gap-3">
                <span
                  aria-hidden="true"
                  className="font-mono text-2xl tabular-nums text-[var(--accent)]"
                >
                  {i + 1}
                </span>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {s.title}
                </h2>
              </div>
              <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
                {s.body}
              </p>
              {s.note && (
                <p className="mt-3 border-l-2 border-[var(--accent)]/40 pl-3 text-sm text-[var(--text-tertiary)]">
                  {s.note}
                </p>
              )}
            </li>
          ))}
        </ol>

        <section className="mt-8 rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-5">
          <p className="micro-label text-[var(--text-tertiary)]">
            {GUIDE_MISTAKES_TITLE}
          </p>
          <ul className="mt-3 space-y-2">
            {GUIDE_MISTAKES.map((m) => (
              <li
                key={m}
                className="flex gap-2 text-sm text-[var(--text-secondary)]"
              >
                <span aria-hidden="true" className="text-[var(--accent)]">
                  ·
                </span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <p className="micro-label text-[var(--text-tertiary)]">
            {GUIDE_CLOSING_TITLE}
          </p>
          <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
            {GUIDE_CLOSING}
          </p>
          <Link
            href="/hashrate#your-shot"
            className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-[15px] font-semibold text-black"
          >
            See the machines and prices →
          </Link>
        </section>

        <FooterDisclaimer />
      </main>
    </>
  );
}
