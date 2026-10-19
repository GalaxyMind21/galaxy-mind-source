// Shared logic for the four "Is {ticker} overvalued?" SEO landing
// pages (/is-mstr-overvalued, /is-metaplanet-overvalued,
// /is-xxi-overvalued, /is-strive-overvalued).
//
// Why these exist as their own URLs (vs /treasuries/{ticker}):
// "is mstr overvalued" is a high-volume, high-intent query · the
// overvaluation debate IS the central MSTR question (the mNAV
// premium). Google rewards exact-match URL slugs for query intent.
// /treasuries/{ticker} is the live data dashboard; these pages are
// the editorial "answer the question" doorway that funnels into it.
//
// Why a shared module: the four pages are ~95% identical. Next.js
// can't parameterize PART of a path segment (`is-[ticker]-overvalued`
// is not a valid dynamic route · a segment is either fully static or
// a single [param]), so each is its own static folder importing this
// shared config + the <OvervaluedPage> component. One render per URL
// means exactly one ticker-specific FAQPage per URL (the duplicate-
// FAQPage trap we hit on /treasuries/{ticker} on 2026-05-29 · keep
// the structured data co-located with the page, never in a layout).
//
// The "overvalued?" verdict is strictly a reading of mNAV (market cap
// divided by the value of the bitcoin the company holds) · an
// objective premium/discount measure, not a stock recommendation.
// Every page carries the "not financial advice" disclaimer, same as
// /treasuries and /should-i-buy-bitcoin.

import type { Metadata } from "next";
import { TREASURY_META, COUNTRY_FLAG, mNavInterpretation } from "./treasuries";
import { OG_TREASURY } from "./og";

export type OverTicker = "MSTR" | "MPJPY" | "XXI" | "ASST";

const SITE_URL = "https://galaxymind.space";

// Per-ticker page config. `slug` is the exact-match search query.
// `searchName` is the token the company is actually searched by · the
// ticker for MSTR/XXI (heavily traded, ticker-first audiences; "XXI"
// is also unambiguous where "twenty one" collides with blackjack /
// the film), the brand for Metaplanet/Strive (nobody searches "MPJPY
// overvalued" or "ASST overvalued"). `altName` rides along in parens.
export const OVERVALUED_CONFIG: Record<
  OverTicker,
  { slug: string; searchName: string; altName: string }
> = {
  MSTR: { slug: "is-mstr-overvalued", searchName: "MSTR", altName: "Strategy" },
  MPJPY: {
    slug: "is-metaplanet-overvalued",
    searchName: "Metaplanet",
    altName: "MPJPY",
  },
  XXI: { slug: "is-xxi-overvalued", searchName: "XXI", altName: "Twenty One Capital" },
  ASST: { slug: "is-strive-overvalued", searchName: "Strive", altName: "ASST" },
};

export const OVER_TICKERS = Object.keys(OVERVALUED_CONFIG) as OverTicker[];

// "Strategy (MSTR)" · the brand name plus the ticker. TreasuryMeta has
// no fullName field, so we compose it from name + ticker.
export function fullNameOf(ticker: OverTicker): string {
  return `${TREASURY_META[ticker].name} (${ticker})`;
}

export function flagOf(ticker: OverTicker): string {
  return COUNTRY_FLAG[TREASURY_META[ticker].country];
}

// The verdict derived from mNAV. The objective "overvalued?" answer is
// premium-vs-discount to the bitcoin the company holds · nothing more.
export type OverVerdict = {
  answer: string; // short chip label
  headline: string; // one-sentence verdict
  color: string; // CSS var or hex · matches site mNAV vocabulary
  detail: string; // the mNavInterpretation detail
  bias: "cheap" | "fair" | "rich" | "unknown";
};

function fmtX(mNav: number | null | undefined): string | null {
  return mNav != null && Number.isFinite(mNav) ? `${mNav.toFixed(2)}x` : null;
}

export function overvaluedVerdict(
  ticker: OverTicker,
  mNav: number | null | undefined,
): OverVerdict {
  const name = TREASURY_META[ticker].name;
  const interp = mNavInterpretation(mNav ?? null);
  const x = fmtX(mNav);
  switch (interp.bias) {
    case "cheap":
      return {
        answer: "No · trading at a discount",
        headline: `No. ${name} is trading at or below the value of the bitcoin it holds${x ? ` (mNAV ${x})` : ""}.`,
        // Cheap = opportunity · orange, matching the /treasuries +
        // mNAV-alert vocabulary (cheap is bullish for accumulators).
        color: "var(--accent)",
        detail: interp.detail,
        bias: "cheap",
      };
    case "fair":
      return {
        answer: "Fairly valued",
        headline: `${name} is trading at a modest premium to its bitcoin${x ? ` (mNAV ${x})` : ""} · not cheap, not rich.`,
        color: "var(--text-primary)",
        detail: interp.detail,
        bias: "fair",
      };
    case "rich":
      return {
        answer: "Arguably yes · trading rich",
        headline: `${name} is trading at a steep premium to the bitcoin it holds${x ? ` (mNAV ${x})` : ""}.`,
        // Rich = caution · cyan, matching the site's "cooling" accent.
        color: "#7ec0ff",
        detail: interp.detail,
        bias: "rich",
      };
    default:
      return {
        answer: "Live data loading",
        headline: `${name}'s live mNAV is temporarily unavailable.`,
        color: "var(--text-tertiary)",
        detail: interp.detail,
        bias: "unknown",
      };
  }
}

// Static per-page metadata · computed from config at module load, no
// network. The live verdict (which needs the snapshot) renders inside
// the page component, not here.
export function buildOvervaluedMetadata(ticker: OverTicker): Metadata {
  const cfg = OVERVALUED_CONFIG[ticker];
  const name = TREASURY_META[ticker].name;
  const url = `${SITE_URL}/${cfg.slug}`;
  return {
    title: `Is ${cfg.searchName} Overvalued? · Live mNAV Verdict · Galaxy Mind`,
    description: `Is ${cfg.searchName} (${cfg.altName}) overvalued? A live mNAV answer: the stock's market cap vs the bitcoin it holds, updated every 5 min.`,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title: `Is ${cfg.searchName} Overvalued? · Live mNAV Verdict`,
      description: `A live, data-driven answer from ${name}'s premium or discount to the bitcoin it holds.`,
      siteName: "Galaxy Mind",
      // REQUIRED (2026-07-29). Next REPLACES the openGraph object rather
      // than merging it, so declaring one without `images` does not
      // inherit app/opengraph-image.tsx — it ships no og:image at all.
      // These four pages also set twitter.card "summary_large_image",
      // which renders as an empty card with no image. Finance family, so
      // OG_TREASURY (not OG_DIRECTORY, whose vendor-count art would
      // contradict an mNAV page). See the README openGraph rule.
      images: OG_TREASURY,
    },
    twitter: {
      card: "summary_large_image",
      title: `Is ${cfg.searchName} Overvalued?`,
      description: `Live mNAV verdict for ${name}. Updated every 5 minutes.`,
      creator: "@GalaxyMind",
    },
  };
}

// One FAQ Q&A item · plain typed shape so the page component can render
// these as HTML without non-null assertions on the JSON-LD union.
export type OverFaqItem = {
  "@type": "Question";
  name: string;
  acceptedAnswer: { "@type": "Answer"; text: string };
};

// Ticker-specific FAQ Q&A · built at request time so the live mNAV /
// holdings appear in the answers. Shared by the JSON-LD builder (for
// the <script>) and the page component (for the visible HTML), so the
// rich-snippet text and the on-page text never drift apart.
export function overvaluedFaqItems(
  ticker: OverTicker,
  mNav: number | null | undefined,
  btcHoldings: number | null | undefined,
): OverFaqItem[] {
  const cfg = OVERVALUED_CONFIG[ticker];
  const meta = TREASURY_META[ticker];
  const fullName = fullNameOf(ticker);
  const verdict = overvaluedVerdict(ticker, mNav);
  const interp = mNavInterpretation(mNav ?? null);
  const x = fmtX(mNav);
  const holdings =
    btcHoldings != null && Number.isFinite(btcHoldings)
      ? `${Math.round(btcHoldings).toLocaleString()} BTC`
      : null;

  const q = (name: string, text: string): OverFaqItem => ({
    "@type": "Question",
    name,
    acceptedAnswer: { "@type": "Answer", text },
  });

  return [
    q(
      `Is ${cfg.searchName} overvalued?`,
      `${verdict.headline} ${verdict.detail} The cleanest single measure is mNAV (market cap divided by the value of the bitcoin it holds): below 1.0x the stock trades for less than its bitcoin, above 1.6x is a steep premium. Live value and 90-day history at galaxymind.space/treasuries/${ticker}. Not financial advice.`,
    ),
    q(
      `What is ${cfg.searchName}'s mNAV right now?`,
      x
        ? `${cfg.searchName} (${fullName}) currently trades at an mNAV of ${x} · ${interp.label.toLowerCase()}. mNAV is ${meta.name}'s market cap divided by the value of the bitcoin on its balance sheet. Updated every 5 minutes at galaxymind.space/treasuries/${ticker}.`
        : `${cfg.searchName}'s live mNAV is published at galaxymind.space/treasuries/${ticker} and updates every 5 minutes. mNAV is ${meta.name}'s market cap divided by the value of the bitcoin it holds.`,
    ),
    q(
      `How much Bitcoin does ${cfg.searchName} hold?`,
      holdings
        ? `${fullName} holds ${holdings} on its balance sheet. Sourced from bitcointreasuries.net, updated every 5 minutes. Full per-treasury comparison at galaxymind.space/treasuries.`
        : `${cfg.searchName}'s live bitcoin holdings are published at galaxymind.space/treasuries/${ticker}, updated every 5 minutes from bitcointreasuries.net.`,
    ),
    q(
      `Is ${cfg.searchName} better than buying Bitcoin directly?`,
      `It depends on what you want. ${meta.name} gives you operating leverage on bitcoin · when mNAV is compressed (below ~1.05x) you are effectively buying its bitcoin at a discount through the equity wrapper, plus any future accumulation. Spot bitcoin (or a low-fee ETF like IBIT or MSBT) gives you pure exposure with no premium risk and no issuer-specific strategy. The Galaxy Mind /fit engine weighs this tradeoff explicitly using live mNAV. Not financial advice.`,
    ),
    q(
      `Why does ${cfg.searchName} trade at a premium or discount to its bitcoin?`,
      `A Bitcoin treasury company can trade above the value of its bitcoin for three reasons. The market prices in future accumulation, because issuing equity above NAV buys more BTC per share. It prices in operating leverage. And it prices in access, since some buyers can only hold a regulated equity wrapper. It can trade below when sentiment cools or the company is newer and unproven. ${meta.name}: ${meta.blurb} Watch the live premium at galaxymind.space/treasuries/${ticker}.`,
    ),
  ];
}

// Ticker-specific FAQPage (+ WebPage) JSON-LD. EXACTLY ONE FAQPage per
// URL · co-located with the page (never in a layout) so it can't double
// up across routes.
export function buildOvervaluedJsonLd(
  ticker: OverTicker,
  mNav: number | null | undefined,
  btcHoldings: number | null | undefined,
) {
  const cfg = OVERVALUED_CONFIG[ticker];
  const fullName = fullNameOf(ticker);
  const url = `${SITE_URL}/${cfg.slug}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        url,
        name: `Is ${cfg.searchName} Overvalued?`,
        description: `Live mNAV verdict for ${fullName} · is the stock trading at a premium or a discount to the bitcoin it holds?`,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        provider: { "@id": `${SITE_URL}/#org` },
      },
      {
        "@type": "FAQPage",
        mainEntity: overvaluedFaqItems(ticker, mNav, btcHoldings),
      },
    ],
  };
}
