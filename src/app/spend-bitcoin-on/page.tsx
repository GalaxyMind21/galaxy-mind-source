// /spend-bitcoin-on · category index (was a 404). Lists every
// non-empty CATEGORY_LABELS row with a live count from the same
// VENDORS roster the hubs use. Coffee capture sits under
// consumables so the beans page stays one tap away.
//
// Growth 2026-09-02: FAQ + FAQPage JSON-LD (SERP for "spend bitcoin
// by category") and the quiet VendorHashrateModule path so directory
// visitors convert onto paid hashrate without a homepage hero.

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import { safeJsonLd } from "@/lib/json-ld";
import { HUB_RENT_Q, HUB_RENT_A } from "@/lib/hashrate-copy";
import { OG_DIRECTORY } from "@/lib/og";
import {
  CATEGORY_LABELS,
  VENDORS,
  type VendorCategory,
} from "@/lib/vendors";

export const revalidate = 3600;

const URL_ = "https://galaxymind.space/spend-bitcoin-on";
const SITE = "https://galaxymind.space";

const CATEGORY_ORDER: VendorCategory[] = [
  "apparel",
  "general-goods",
  "hardware",
  "consumables",
  "collectibles",
  "services",
  "books",
];

function countOf(cat: VendorCategory) {
  return VENDORS.filter((v) => v.category === cat).length;
}

const ROWS = CATEGORY_ORDER.map((cat) => ({
  cat,
  label: CATEGORY_LABELS[cat],
  n: countOf(cat),
})).filter((r) => r.n > 0);

const N = VENDORS.length;
const TITLE = `Spend bitcoin by category · ${N} verified shops · Galaxy Mind`;
const DESCRIPTION = `Independent online stores that take bitcoin, grouped by what they sell. Live counts from the human-verified roster. Online shops only · not a street map.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL_ },
  openGraph: {
    images: OG_DIRECTORY,
    type: "website",
    url: URL_,
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Galaxy Mind",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    site: "@GalaxyMind",
  },
};

export default function SpendByCategoryPage() {
  const categoryNames = ROWS.map((r) => r.label.toLowerCase()).join(", ");
  const FAQ = [
    {
      q: "What can I buy with bitcoin here?",
      a: `This index groups ${N} human-verified online shops by what they sell: ${categoryNames}. Open a category for the live roster, then visit each merchant's own checkout.`,
    },
    {
      q: "Is this a walk-in street map?",
      a: "No. Cafes and other places you walk into live on BTC Map and Blink. This page is independent online stores that take native bitcoin, grouped by category.",
    },
    {
      q: "How do shops get listed?",
      a: "A merchant asks through the submit form. We verify native bitcoin acceptance, then they get a listing page plus this category index. Listing is free; we do not cold-add shops.",
    },
    { q: HUB_RENT_Q, a: HUB_RENT_A },
  ];

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Spend bitcoin by category",
    description: DESCRIPTION,
    numberOfItems: ROWS.length,
    url: URL_,
    itemListElement: ROWS.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/spend-bitcoin-on/${r.cat}`,
      name: `${r.label} · ${r.n} verified`,
    })),
  };

  const faqData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqData) }}
      />

      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <p className="night-bench-kicker">
          Spend by category · {N} verified
        </p>
        <h1 className="display-title mb-3">
          Spend bitcoin by category.
        </h1>
        <p className="night-bench-lede mb-10">
          Independent online stores that take native bitcoin, grouped
          by what they sell. Counts are live from the same roster as
          the homepage. Not a walk-in street map.
        </p>

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-12">
          {ROWS.map((r) => (
            <li key={r.cat}>
              <Link
                href={`/spend-bitcoin-on/${r.cat}`}
                className="block rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all elevate"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-base font-semibold text-[var(--text-primary)]">
                    {r.label}
                  </span>
                  <span className="font-mono t-xs tabular-nums text-[var(--text-tertiary)]">
                    {r.n}
                  </span>
                </div>
                {r.cat === "consumables" && (
                  <span className="mt-2 block text-sm text-[var(--text-secondary)]">
                    Coffee beans that ship
                  </span>
                )}
              </Link>
              {r.cat === "consumables" && (
                <Link
                  href="/buy-coffee-with-bitcoin"
                  className="micro-label mt-2 inline-flex text-[var(--accent-ink)] hover:underline underline-offset-2"
                >
                  Buy coffee with bitcoin →
                </Link>
              )}
            </li>
          ))}
        </ul>

        <VendorHashrateModule className="mb-12" />

        <div className="flex flex-wrap gap-2">
          <Link
            href="/"
            className="micro-label px-4 py-2 rounded-lg border border-[var(--accent)]/40 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 transition-colors"
          >
            Filter the full directory →
          </Link>
          <Link
            href="/online-stores-that-accept-bitcoin"
            className="micro-label px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors"
          >
            Every online store →
          </Link>
        </div>

        <section className="mt-12 max-w-2xl">
          <h2 className="t-xs font-medium text-[var(--text-tertiary)] mb-4">
            Questions people ask
          </h2>
          <dl className="space-y-4">
            {FAQ.map((f) => (
              <div key={f.q}>
                <dt className="text-sm font-semibold text-[var(--text-primary)]">
                  {f.q}
                </dt>
                <dd className="mt-1 text-sm text-[var(--text-secondary)] leading-relaxed">
                  {f.a}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <FooterDisclaimer />
      </div>
    </main>
  );
}
