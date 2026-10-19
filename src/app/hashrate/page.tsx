import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import HashrateContent from "./HashrateContent";
import { OfferJsonLd } from "./components/OfferJsonLd";
import { SiteHeader } from "@/components/SiteHeader";
import {
  MASTHEAD,
  PAGE_TITLE,
  PAGE_DESCRIPTION,
  FAQ_ITEMS,
  BRAND_EYEBROW,
  HERO_CTA_LABEL,
  PAGE_H1,
} from "@/lib/hashrate-copy";
import { safeJsonLd } from "@/lib/json-ld";
import { MARKETPLACE_FAQ } from "@/lib/marketplace-listing";
import { mrrOnly } from "@/lib/rentals/mode";
import MrrHashrateContent, { MRR_FAQ_ALL } from "./components/MrrHashrateContent";
import { MRR_PAGE_TITLE, MRR_PAGE_DESCRIPTION, MRR_SOCIAL_DESCRIPTION, MRR_OG_ALT, MRR_PAGE_H1 } from "@/lib/mrr-page-copy";
import { getUnitSnapshot, unitsView } from "@/lib/mrr-units";
import { MARKETPLACE_NAME } from "@/lib/marketplace-listing";

const SITE_URL = "https://galaxymind.space";

const DIRECT_METADATA: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/hashrate` },
  openGraph: {
    type: "website",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/hashrate`,
    // Sibling opengraph-image.tsx — the dedicated card. OG_TREASURY (the
    // mNAV scoreboard) shipped here first and argued with the page's own
    // headline on every social unfurl.
    images: [
      {
        url: "/hashrate/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Rent Bitcoin hashrate from Galaxy Mind · live block odds",
      },
    ],
  },
  // Override root layout twitter (directory defaults) so X cards match
  // the rent-hashrate SERP copy instead of the merchant-directory pitch.
  twitter: {
    card: "summary_large_image",
    site: "@GalaxyMind",
    creator: "@GalaxyMind",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [
      {
        url: "/hashrate/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Rent Bitcoin hashrate from Galaxy Mind · live block odds",
      },
    ],
  },
};

/** RENTALS_MODE=mrr_only (default): same page, marketplace copy (lib/mrr-page-copy.ts). */
// SEO pass 2026-10-17: own social description and image alt, canonical unchanged (absolute /hashrate).
const MRR_OG_IMAGES = [{ url: "/hashrate/opengraph-image", width: 1200, height: 630, alt: MRR_OG_ALT }];
const MRR_METADATA: Metadata = {
  ...DIRECT_METADATA,
  title: MRR_PAGE_TITLE,
  description: MRR_PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/hashrate` },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Galaxy Mind",
    locale: "en_US",
    url: `${SITE_URL}/hashrate`,
    title: MRR_PAGE_TITLE,
    description: MRR_SOCIAL_DESCRIPTION,
    images: MRR_OG_IMAGES,
  },
  twitter: {
    card: "summary_large_image",
    site: "@GalaxyMind",
    creator: "@GalaxyMind",
    title: MRR_PAGE_TITLE,
    description: MRR_SOCIAL_DESCRIPTION,
    images: MRR_OG_IMAGES,
  },
};

export function generateMetadata(): Metadata {
  return mrrOnly() ? MRR_METADATA : DIRECT_METADATA;
}

// 60 s (was 300): the MRR-only unit list must not outlive its 15-minute freshness rule by much.
export const revalidate = 60;

export default async function HashratePage() {
  // Same-tab link to /hashrate/rent, never back to /hashrate (2026-10-16 loop fix).
  const mrr = mrrOnly();
  // mrr_only: the header CTA scrolls to the selector on this page (no loop, no checkout).
  const rentHref = mrr ? "#rent-hero" : "/hashrate/rent";
  const nonce = (await headers()).get("x-galaxymind-nonce") ?? undefined;
  // Service + Offer JSON-LD (mrr_only). No price: rates live on the marketplace and move with it.
  // Availability follows the same fresh-or-hidden rule as the page (stale data claims nothing).
  let serviceLd: Record<string, unknown> | null = null;
  if (mrr) {
    const view = unitsView(await getUnitSnapshot(), Date.now());
    serviceLd = {
      "@context": "https://schema.org",
      "@type": "Service",
      "@id": `${SITE_URL}/hashrate#service`,
      name: "Bitcoin hashrate rental",
      serviceType: "Bitcoin (SHA-256) hashrate rental for solo and pool mining",
      description: MRR_PAGE_DESCRIPTION,
      url: `${SITE_URL}/hashrate`,
      provider: { "@id": `${SITE_URL}/#org` },
      areaServed: "Worldwide",
      category: "Bitcoin mining",
      offers: {
        "@type": "Offer",
        name: MRR_PAGE_H1,
        url: `${SITE_URL}/hashrate`,
        seller: { "@id": `${SITE_URL}/#org` },
        description: `Rent in 270 TH/s chunks, from 3 hours up to 7 days, through ${MARKETPLACE_NAME}.`,
        eligibleQuantity: { "@type": "QuantitativeValue", unitText: "TH/s", value: 270 },
        ...(view.state === "live"
          ? { availability: view.freeCount > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut" }
          : {}),
      },
    };
  }
  return (
    <>
      {/* SiteHeader is NOT in the root layout — all 55 other pages mount it
          themselves, so a new page silently ships with no navigation and
          nothing fails. That is why this was missed by ten task reviews and
          a whole-branch review: a MISSING element never appears in a diff. */}
      <SiteHeader
        ctaSlot={
          <a
            href={rentHref}
            className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3.5 h-9 rounded-md bg-[var(--accent)] text-black font-mono t-xs sm:text-xs uppercase tracking-[0.18em] font-semibold hover:bg-[var(--accent-hover)] transition-all"
          >
            <span className="hidden 2xl:inline">{HERO_CTA_LABEL}</span>
            <span className="2xl:hidden">Rent</span>
            <span aria-hidden className="hidden sm:inline">
              {rentHref.startsWith("#") ? "↓" : "→"}
            </span>
          </a>
        }
      />
      <main className={`night-bench mx-auto w-full min-w-0 max-w-5xl overflow-x-clip px-4 sm:px-6 ${mrr ? "py-4 sm:py-8" : "py-10"}`}>
      {/* No Dataset JSON-LD: /hashrate is a sales page, so Service + FAQPage describe it
          (2026-10-18, Search Console flagged the old Dataset node for a missing license). */}
      {serviceLd && (
        <script
          type="application/ld+json"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: safeJsonLd(serviceLd) }}
        />
      )}
      {/* FAQPage · same FAQ_ITEMS the page renders, so markup and prose
          can never disagree — the gated copy module is the single source. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: safeJsonLd({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: (mrr ? MRR_FAQ_ALL : [...FAQ_ITEMS, MARKETPLACE_FAQ]).map((item) => ({
              "@type": "Question",
              name: item.q,
              acceptedAnswer: { "@type": "Answer", text: item.a },
            })),
          }),
        }}
      />
      {/* mrr_only: the funnel's hero carries the H1 (MRR_PAGE_H1) so the CTA sits above the fold. */}
      {!mrr && (
        <>
          <p className="night-bench-kicker">
            {BRAND_EYEBROW}
          </p>
          <h1 className="display-title max-w-[calc(100vw-2rem)]">
            {PAGE_H1}
          </h1>
          <p className="night-bench-lede">
            {MASTHEAD}
          </p>
        </>
      )}
      <Suspense
        fallback={
          <div className="mt-8 h-64 animate-pulse rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]" />
        }
      >
        {mrr ? <MrrHashrateContent /> : (
          <>
            <OfferJsonLd />
            <HashrateContent />
          </>
        )}
      </Suspense>
    </main>
    </>
  );
}
