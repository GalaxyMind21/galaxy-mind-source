import type { Metadata } from "next";
import { headers } from "next/headers";
import { safeJsonLd } from "@/lib/json-ld";

// Title rewritten 2026-05-25 for query-intent matching · "The Bitcoin
// Buying Gauge" is a brand-internal phrase nobody types into Google,
// but "should I buy bitcoin now" is a top-5 Bitcoin search query that
// this page DIRECTLY answers. New title puts the question first
// (matches SERP intent) and keeps the brand-internal phrase as a
// secondary anchor for users who heard about the tool. 60 chars · at
// Google's desktop truncation edge but readable on mobile.
const TITLE = "Should I Buy Bitcoin Now? · Live Buying Gauge · Galaxy Mind";
const DESCRIPTION =
  "Should I buy Bitcoin today? A live 10-signal verdict updated daily gives a 0-100 score plus a 7-day opportunity forecast. Open methodology, free.";
const URL = "https://galaxymind.space/stack";
const SITE_URL = "https://galaxymind.space";

const SOCIAL_TITLE = "Should I buy Bitcoin now? · Live Bitcoin Buying Gauge";
const SOCIAL_DESCRIPTION =
  "Live contrarian verdict + 7-day forecast for Bitcoin accumulators. Built by Galaxy Mind.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: URL,
    title: SOCIAL_TITLE,
    description: SOCIAL_DESCRIPTION,
    siteName: "Galaxy Mind",
  },
  twitter: {
    card: "summary_large_image",
    title: SOCIAL_TITLE,
    description: SOCIAL_DESCRIPTION,
    creator: "@GalaxyMind",
  },
  alternates: {
    canonical: URL,
  },
};

// JSON-LD structured data — tells Google this is a financial WebApp,
// not an article. Helps with SERP treatment for queries like "is now
// a good time to buy bitcoin", "bitcoin buy signal", etc. Two schemas:
//   1. WebApplication / FinanceApplication — the tool itself.
//   2. FAQPage — the contrarian thesis + how-it-works prose answers
//      common search-intent questions (lifted from the on-page copy
//      so the structured-data summary matches what visitors see).
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["WebApplication", "FinanceApplication"],
      name: "The Bitcoin Buying Gauge",
      url: URL,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      description: DESCRIPTION,
      featureList: [
        "10-signal weighted Bitcoin buying gauge (0-100)",
        "7-day x 24-hour opportunity forecast heatmap",
        "Live signal cockpit (MVRV, Mayer Multiple, Puell Multiple, funding rate, Fear & Greed, 30-day MA, realized vol, time-of-day pattern, day-of-week pattern, MSTR mNAV)",
        "Interactive what-if simulator: drag any signal slider to see how the verdict moves",
        "Daily score history + email alerts when score crosses 80 or 20",
        "DCA backtest calculator",
        "Drop-in <script> embed for any site",
      ],
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      provider: {
        "@type": "Organization",
        name: "Galaxy Mind",
        url: "https://galaxymind.space",
        sameAs: ["https://x.com/GalaxyMind"],
      },
      isAccessibleForFree: true,
    },
    {
      "@type": "Dataset",
      // Self @id so agents can reference this dataset by a stable
      // identifier rather than guessing a URL (2026-07-29).
      //
      // temporalCoverage is deliberately ABSENT. Doing it honestly means
      // reading the oldest entry out of the KV series — the three
      // Dataset pages have different start dates, so one shared constant
      // would be wrong for two of them — and this is a module-scope
      // constant on a page whose HTML is uncacheable under the nonce
      // CSP, so deriving it would cost a KV read on EVERY request
      // against a 10K/day budget. A hardcoded start date is the
      // stale-constant pattern this repo bans. Better no claim.
      "@id": `${SITE_URL}/#gauge-dataset`,
      name: "Bitcoin Buying Gauge · daily signal score",
      description:
        "A daily 0-100 Bitcoin buying score derived from 10 weighted market signals (MVRV, Mayer Multiple, Puell Multiple, perpetual funding rate, Crypto Fear & Greed, price vs 30-day moving average, 30-day realized volatility, hour-of-day, day-of-week, MSTR mNAV) plus a 7-day forecast. Updated daily; a 30-day score history is persisted.",
      url: URL,
      keywords: [
        "Bitcoin",
        "buy signal",
        "MVRV",
        "Mayer Multiple",
        "Puell Multiple",
        "funding rate",
        "Fear and Greed",
        "realized volatility",
        "MSTR mNAV",
        "Bitcoin buying gauge",
        "dollar cost averaging",
      ],
      creator: { "@id": `${SITE_URL}/#org` },
      publisher: { "@id": `${SITE_URL}/#org` },
      // Resolvable license document · see the note in treasuries/page.tsx.
      license: "https://creativecommons.org/licenses/by/4.0/",
      isAccessibleForFree: true,
      distribution: [
        {
          "@type": "DataDownload",
          encodingFormat: "application/json",
          contentUrl: `${SITE_URL}/api/stack`,
          name: "Current 10-signal verdict (JSON)",
        },
        {
          "@type": "DataDownload",
          encodingFormat: "application/json",
          contentUrl: `${SITE_URL}/api/stack/history`,
          name: "30-day score history (JSON)",
        },
        {
          "@type": "DataDownload",
          encodingFormat: "text/csv",
          contentUrl: `${SITE_URL}/api/stack/history?format=csv`,
          name: "Score history (CSV)",
        },
      ],
      variableMeasured: [
        {
          "@type": "PropertyValue",
          name: "score",
          description:
            "0-100 Bitcoin buying score · higher = more historically attractive entry. Integer, updated daily.",
          unitText: "score (0-100)",
        },
        {
          "@type": "PropertyValue",
          name: "tier",
          description:
            "Verdict band derived from the score: COLD, CHILL, WARM, HOT, MOLTEN.",
        },
        {
          "@type": "PropertyValue",
          name: "signals",
          description:
            "The 10 weighted inputs (MVRV, Mayer, Puell, funding, Fear & Greed, price vs 30d MA, realized vol, hour-of-day, day-of-week, MSTR mNAV) with per-signal weight and current value.",
        },
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Should I buy Bitcoin today?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The Galaxy Mind Bitcoin Buying Gauge answers exactly this question with a live 0-100 score updated daily. Above 65 = STACK NOW (historically-attractive entry). Above 81 = STACK HUGE (rare extreme-opportunity zone). Below 40 = HOLD (wait for better entry). The score weighs 10 signals: MVRV ratio, Mayer Multiple, Puell Multiple, perpetual funding rate, Crypto Fear & Greed, price vs 30-day MA, 30-day realized vol, hour-of-day, day-of-week, and MSTR mNAV. Open methodology · full signal weights published in llms.txt and reproducible from public data.",
          },
        },
        {
          "@type": "Question",
          name: "When is the best time to buy Bitcoin?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Historically, the best Bitcoin entries align with extreme bearish sentiment, miner capitulation (Puell Multiple < 0.5), MVRV below 1.0, price below the 200-day moving average, and negative perpetual funding. The Bitcoin Buying Gauge weighs 10 such signals to produce a single 0-100 score. Higher = more historically attractive entry. Above 65 the gauge tells you to STACK NOW; above 81 it tells you to STACK HUGE.",
          },
        },
        {
          "@type": "Question",
          name: "What is MVRV in Bitcoin?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "MVRV (Market Value to Realized Value) is the ratio of Bitcoin's market cap to the aggregate cost basis of all coins (their realized value). Below 1.0 means the average holder is underwater - historically a strong accumulation signal. Every major Bitcoin cycle bottom (Dec 2018, Mar 2020, Nov 2022) printed MVRV below 1.0.",
          },
        },
        {
          "@type": "Question",
          name: "What is the Puell Multiple?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The Puell Multiple is daily Bitcoin issuance value (in USD) divided by its 365-day moving average. Below 0.5 = miner capitulation, every major cycle bottom landed in this zone. Above 4.0 = miners are over-earning, top territory.",
          },
        },
        {
          "@type": "Question",
          name: "Is Galaxy Mind financial advice?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Galaxy Mind is an educational tool that maps publicly observable signals to a 0-100 score. Nothing on the page is investment advice, tax advice, or a solicitation to buy or sell any security. Bitcoin can lose substantial value. Consult a licensed advisor and tax professional before making financial decisions.",
          },
        },
      ],
    },
  ],
};

export default async function StackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Pull the per-request CSP nonce that proxy.ts injects via the
  // `x-galaxymind-nonce` header. Without this attribute, the
  // strict-dynamic / nonce-based CSP blocks the inline <script> in
  // production — Google sees no structured data and the SEO benefit
  // of all this markup is zero. Same pattern as <Analytics> /
  // <SpeedInsights> in the root layout.
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  // dateModified freshness signal · the gauge + its dataset refresh
  // daily (snapshot-stack cron, 00:05 UTC), so today's UTC date is an
  // honest "last modified" stamp. The layout already reads headers, so
  // it renders dynamically and this recomputes per request.
  const dateModified = new Date().toISOString().slice(0, 10);
  const structuredData = {
    ...STRUCTURED_DATA,
    "@graph": STRUCTURED_DATA["@graph"].map((node) => {
      const t = (node as { "@type": string | string[] })["@type"];
      const isWebApp = Array.isArray(t) && t.includes("WebApplication");
      return isWebApp || t === "Dataset" ? { ...node, dateModified } : node;
    }),
  };

  return (
    <>
      {/* JSON-LD · search engines (Google primarily) parse this to
          understand the page is a tool/app and to surface the FAQ
          answers as rich results in the SERP. The content is fully
          server-controlled (no user input), and we additionally
          escape any `<` / line-separator characters so the script
          tag can never be broken or interpreted as JS. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // Static server-side object → no XSS surface. Escaped via
        // safeJsonLd() for defense-in-depth.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
      />
      {children}
    </>
  );
}
