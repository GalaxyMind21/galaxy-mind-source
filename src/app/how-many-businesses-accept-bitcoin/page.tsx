// /how-many-businesses-accept-bitcoin · the live stats page (2026-08-04,
// roadmap item 8 of the directory-#1 strategy).
//
// The query has no honest answer on the SERP: ranking pages quote
// unverifiable industry claims ("15,000+ businesses!") scraped from one
// another, none dated, none checkable. Our angle is the OPPOSITE claim:
// a small number every reader can verify, plus the honest statement
// that nobody on earth knows the big one. That framing is the site's
// verification-as-headline positioning applied to a stats query.
//
// Numbers come from VENDORS at render — never prose (the README rule).
// The description uses process claims, not absolute freshness claims
// (static metadata strings must never assert "checked today").
//
// Growth 2026-09-11: quiet VendorHashrateModule after the freshness section so
// "how many businesses accept bitcoin" SERP visitors (vs BTC Map's 26k+ walk-in
// scale claims and Cryptwerk's multi-coin catalogues) convert onto paid USA
// ASIC rentals — same module as /v, category, country, online-stores, LATAM,
// /map, and /buy-coffee-with-bitcoin.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { CrossPageCTA } from "@/components/CrossPageCTA";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import { safeJsonLd } from "@/lib/json-ld";
import { OG_DIRECTORY } from "@/lib/og";
import {
  CATEGORY_LABELS,
  COUNTRIES,
  VENDORS,
  isStale,
  STALE_THRESHOLD_DAYS,
  type VendorCategory,
} from "@/lib/vendors";

const URL_ = "https://galaxymind.space/how-many-businesses-accept-bitcoin";

export const revalidate = 3600;

export const metadata: Metadata = {
  title:
    "How Many Businesses Accept Bitcoin? The Verified Count · Galaxy Mind",
  description:
    "Most answers are unverifiable marketing numbers. This is the count we can prove: every listing monitored daily and human-verified, methodology open.",
  alternates: { canonical: URL_ },
  openGraph: {
    title: "How many businesses accept bitcoin? The number we can prove.",
    description:
      "Industry pages quote thousands with no receipts. This page counts only merchants a human has verified, and shows the work.",
    url: URL_,
    siteName: "Galaxy Mind",
    type: "website",
    images: OG_DIRECTORY,
  },
  twitter: {
    card: "summary_large_image",
    title: "How many businesses accept bitcoin?",
    description:
      "The verified count, the honest caveat, and the methodology in the open.",
    site: "@GalaxyMind",
  },
};

export default function HowManyPage() {
  const total = VENDORS.length;
  const countryCount = new Set(VENDORS.map((v) => v.country).filter(Boolean))
    .size;
  const freshCount = VENDORS.filter((v) => !isStale(v.verifiedAt)).length;

  const byCategory = (
    Object.entries(CATEGORY_LABELS) as [VendorCategory, string][]
  )
    .map(([slug, label]) => ({
      slug,
      label,
      count: VENDORS.filter((v) => v.category === slug).length,
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  const byCountry = Object.entries(COUNTRIES)
    .map(([cc, info]) => ({
      cc,
      ...info,
      count: VENDORS.filter((v) => v.country === cc).length,
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  // Verified-in-the-last-N-days trail · verifiedAt is bumped on
  // re-verification, so this is a freshness statistic, not a growth
  // curve — and it is labeled as exactly that below.
  const now = Date.now() / 1000;
  const within = (days: number) =>
    VENDORS.filter((v) => now - v.verifiedAt <= days * 86400).length;

  const faqData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "How many businesses accept bitcoin?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `Nobody knows the true global number, and pages that quote one rarely say how they counted. What can be proven: this directory lists ${total} online merchants across ${countryCount} countries, each one monitored daily and confirmed by a human on the card. BTC Map, the physical-world counterpart built on OpenStreetMap, separately tracks tens of thousands of physical locations.`,
        },
      },
      {
        "@type": "Question",
        name: "How many online stores accept bitcoin?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `${total} verified online merchants are listed here right now, spanning ${byCategory.length} categories from apparel and hardware to food and professional services. The full roster is at galaxymind.space/online-stores-that-accept-bitcoin.`,
        },
      },
      {
        "@type": "Question",
        name: "Why do published numbers vary so much?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Because most directories never remove dead merchants and never re-check live ones. Lists compound errors as they copy one another. The honest approach is a smaller number with a re-verification policy. Every listing here shows the date a human last confirmed it.",
        },
      },
    ],
  };

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqData) }}
      />

      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
          The Circular Economy · Live Count
        </div>
        <h1 className="display-title font-semibold mb-3">
          How many businesses accept{" "}
          <span className="headline-gradient glow-text">bitcoin</span>?
        </h1>
        <p className="text-[var(--text-secondary)] text-sm sm:text-lg max-w-2xl mb-8 leading-snug sm:leading-relaxed">
          Honest answer: nobody knows the global number, and most pages
          quoting one are repeating somebody else&apos;s guess. Here is
          the number we can prove, and how we count it.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-5 elevate">
            <div className="font-mono text-4xl font-bold text-[var(--accent-ink)] glow-text tabular-nums">
              {total}
            </div>
            <div className="micro-label mt-1 text-[var(--text-secondary)]">
              verified online merchants
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 elevate">
            <div className="font-mono text-4xl font-bold text-[var(--text-primary)] tabular-nums">
              {countryCount}
            </div>
            <div className="micro-label mt-1 text-[var(--text-secondary)]">
              countries
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 elevate">
            <div className="font-mono text-4xl font-bold text-[var(--text-primary)] tabular-nums">
              {freshCount}
            </div>
            <div className="micro-label mt-1 text-[var(--text-secondary)]">
              confirmed within 90 days
            </div>
          </div>
        </div>

        <section className="max-w-2xl mb-10">
          <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
            Why this number is small on purpose
          </h2>
          <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed mb-3">
            Ranking pages for this question quote thousands of merchants
            with no dates, no checks, and no removal policy. The lists
            copy one another until a dead shop can survive online for
            years. We count differently: a listing exists only after a
            human verifies the merchant accepts native bitcoin, then it
            is monitored automatically every day and gets a human look
            at least every {STALE_THRESHOLD_DAYS} days even if nothing
            changed. Every vendor page shows its last-verified date, so
            you can audit the claim yourself.{" "}
            <Link
              href="/state-of-bitcoin-directories"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              We liveness-checked the directories the ranking guides still
              recommend
            </Link>
            . The results explain the gap between the quoted numbers and
            the verifiable ones.
          </p>
          <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
            For physical, walk-in locations, the OpenStreetMap-based{" "}
            <Link
              href="/map"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              BTC Map ecosystem we chart on our world map
            </Link>{" "}
            tracks tens of thousands of pins. That is a different count
            of a different thing: this page counts online merchants you
            can order from today.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-4">
            The verified count, broken down
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
              <h3 className="micro-label text-[var(--accent-ink)] mb-3">
                By category
              </h3>
              <ul className="space-y-2">
                {byCategory.map((c) => (
                  <li key={c.slug} className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/spend-bitcoin-on/${c.slug}`}
                      className="text-sm text-[var(--text-secondary)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                    >
                      {c.label}
                    </Link>
                    <span className="font-mono text-sm tabular-nums text-[var(--text-primary)]">
                      {c.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
              <h3 className="micro-label text-[var(--accent-ink)] mb-3">
                Top countries
              </h3>
              <ul className="space-y-2">
                {byCountry.slice(0, 8).map((c) => (
                  <li key={c.cc} className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-[var(--text-secondary)]">
                      {c.flag} {c.label}
                    </span>
                    <span className="font-mono text-sm tabular-nums text-[var(--text-primary)]">
                      {c.count}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-[var(--text-tertiary)]">
                All {countryCount} countries are on{" "}
                <Link
                  href="/map"
                  className="underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] text-[var(--accent-ink)]"
                >
                  the map
                </Link>
                .
              </p>
            </div>
          </div>
        </section>

        <section className="max-w-2xl mb-10">
          <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
            How fresh is the count
          </h2>
          <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
            {within(30)} of the {total} listings were confirmed by a human
            within the last 30 days, and {freshCount} within the last 90.
            What matters is how recently somebody checked each row, and
            those dates are public on every listing here. Scraped lists
            can&apos;t tell you that.
          </p>
        </section>

        <VendorHashrateModule className="mb-10" />

        <CrossPageCTA
          heading="See the merchants themselves"
          cards={[
            {
              href: "/online-stores-that-accept-bitcoin",
              eyebrow: "THE FULL LIST",
              title: "Online stores that accept bitcoin",
              hook: "Every verified merchant in listicle form, with live counts.",
            },
            {
              href: "/",
              eyebrow: "THE DIRECTORY",
              title: "Browse and filter",
              hook: "Search by category, country, and platform. Human-verified, always.",
            },
          ]}
          tailLink={{
            href: "/submit",
            label: "Run a shop? Get verified",
            hint: "Listing is free",
          }}
        />

        <FooterDisclaimer />
      </div>
    </main>
  );
}
