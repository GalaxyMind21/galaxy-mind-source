import type { Metadata } from "next";
import { headers } from "next/headers";
import { safeJsonLd } from "@/lib/json-ld";

// Title rewritten 2026-05-25 for query-intent matching · "Find Your
// Bitcoin Fit" uses a brand-internal phrase ("Fit") nobody searches
// for. "How Much Bitcoin Should I Own" and "Bitcoin Portfolio
// Allocation" are the actual queries this engine answers. 60 chars ·
// at Google's desktop truncation edge but the question framing
// improves CTR even when truncated.
const TITLE = "Bitcoin Portfolio Allocation · How Much to Own · Galaxy Mind";
const DESCRIPTION =
  "How much Bitcoin should you own? A live allocation engine for Bitcoin and Bitcoin-adjacent securities, factoring in mNAV, Fear & Greed, and 30-day volatility.";
const URL = "https://galaxymind.space/fit";
const SITE_URL = "https://galaxymind.space";

// Page-specific metadata for the allocation engine, now that the root
// layout's metadata describes the vendor directory home page.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: URL,
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Galaxy Mind",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    creator: "@GalaxyMind",
  },
  alternates: {
    canonical: URL,
  },
};

// JSON-LD structured data — same defensive pattern as /stack/layout.tsx.
// Tells search engines this is a financial decision tool, not an article.
// FAQPage entries lift common search-intent questions about Bitcoin
// allocation, MSTR, and treasury-equity so AI agents (Perplexity,
// ChatGPT search) can surface direct answers attributable to this page.
//
// publisher @id back-references the Organization defined in the root
// layout's site-wide JSON-LD, so all per-page schema rolls up to one
// brand entity.
//
// SECURITY: Content below is a static, server-controlled object literal.
// No user input ever flows into STRUCTURED_DATA. The safeJsonLd() helper
// additionally escapes `<` and U+2028/U+2029 so the serialized JSON
// cannot break out of the <script> tag or be mis-parsed by JS engines.
// Inline JSON-LD is mandatory: search engines (Google, Bing, Perplexity)
// do not fetch external JSON-LD documents — they parse <script> tags in
// the HTML response. Same pattern already shipped in /stack/layout.tsx
// and root layout.tsx without incident.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["WebApplication", "FinanceApplication"],
      name: "Galaxy Mind Bitcoin Allocation Engine",
      url: URL,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      description: DESCRIPTION,
      featureList: [
        "Live portfolio recommendations across BTC, MSBT, MSTR, MPJPY, XXI, ASST, STRC/F/D/K, SATA, MSTY",
        "Six volatility-tolerance tiers (Minimal → Ludicrous)",
        "Account-type aware allocations (Taxable / Traditional / Roth)",
        "Time-horizon filter from 1 to 30 years",
        "mNAV-aware sleeve sizing (rich premium trims treasury equity)",
        "Live signal inputs: MSTR mNAV, Fear & Greed, 30-day BTC realized vol",
        "6-month buy-and-hold backtest per recommendation",
        "Three quick-start presets (Sleep at night / Balanced / Send it)",
        "Shareable URL state (?h=X&t=Y&a=Z)",
      ],
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      provider: { "@id": `${SITE_URL}/#org` },
      publisher: { "@id": `${SITE_URL}/#org` },
      isAccessibleForFree: true,
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "How much Bitcoin should I own?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "There's no universal answer · the right Bitcoin allocation depends on your time horizon, risk tolerance, and account type. The Galaxy Mind allocation engine treats this as a decision problem: input your horizon (1-30y), volatility tolerance (Minimal → Ludicrous, six tiers), and account type (Taxable / Traditional / Roth), and it returns a portfolio of Bitcoin and Bitcoin-adjacent securities with sleeves summing to 100%. Quick-start presets cover the common shapes: 💤 Sleep-at-night (Minimal tolerance, 5y, Taxable) yields STRC + SATA only · 🌗 Balanced (Moderate, 10y, Roth) blends MSBT spot Bitcoin with MSTR + treasury diversifiers · 🚀 Send-it (Maxi, 15y, Roth) anchors heavily on MSTR for mNAV-driven accretion. The engine is mNAV-aware: when MSTR's premium runs rich (≥1.6×) it auto-trims MSTR in favor of pure-spot BTC. Educational, not financial advice.",
          },
        },
        {
          "@type": "Question",
          name: "What's the best Bitcoin allocation for a long-term portfolio?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "There is no single right answer · it depends on horizon, account type, and how much volatility you can stomach. The Galaxy Mind allocation engine takes those three inputs (1-30y horizon, Min-Ludicrous tolerance, Taxable/Traditional/Roth) and returns a portfolio of Bitcoin and Bitcoin-adjacent securities (BTC, MSBT, MSTR, MPJPY, XXI, ASST, STRC/F/D/K, SATA, MSTY) with sleeves summing to 100%. At long horizons and high tolerance, MSTR anchors the portfolio because of mNAV-driven accretion. At short horizons and low tolerance, STRC + SATA dominate (Sharpe-optimal blend).",
          },
        },
        {
          "@type": "Question",
          name: "Should I buy MSTR or MSBT?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "MSTR is operating leverage on Bitcoin via Saylor's accumulation strategy · its mNAV premium varies and the company keeps issuing equity to buy more BTC. MSBT is spot Bitcoin with no premium, no operating leverage, no issuer risk — Morgan Stanley's wrapper at a 0.14% expense ratio, the lowest-fee mainstream spot ETF (vs IBIT's 0.25%). The allocation engine picks between them based on mNAV: when MSTR mNAV is rich (≥1.6×) it trims MSTR in favor of BTC/MSBT; when compressed (<1.05×) it holds full MSTR weight. Roth accounts get a heavier MSBT tilt because the sleeve compounds tax-free.",
          },
        },
        {
          "@type": "Question",
          name: "What's the difference between MSTR, MPJPY, XXI, and ASST?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "All four are public Bitcoin treasury companies. MSTR (Strategy) is the largest by far, with the longest history. MPJPY (Metaplanet) is the Japanese-listed treasury, often trading at the largest mNAV premium. XXI (Twenty One Capital) and ASST (Strive Inc, Vivek Ramaswamy's asset manager) are smaller US-listed treasuries with their own mNAV cycles. The /treasuries page shows live mNAV side-by-side · the cheapest treasury at any moment can be a better entry than MSTR.",
          },
        },
        {
          "@type": "Question",
          name: "Is Galaxy Mind financial advice?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. The allocation engine is an educational tool that maps inputs (horizon, tolerance, account type) to a recommended sleeve mix using public data. Nothing on the page is investment advice, tax advice, or a solicitation to buy or sell any security. Bitcoin and these securities can lose substantial value. Consult a licensed advisor before making material financial decisions.",
          },
        },
      ],
    },
  ],
};


export default async function FitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Per-request CSP nonce from proxy.ts. Without this, strict-CSP
  // browsers block the inline JSON-LD <script> and search engines
  // see no structured data.
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  return (
    <>
      {/* SAFE: Static, server-controlled JSON-LD object · no user input
          ever flows in. safeJsonLd() escapes `<` and U+2028/U+2029 for
          defense in depth. Inline <script> is mandatory because search
          engines do not fetch external JSON-LD documents. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(STRUCTURED_DATA) }}
      />
      {children}
    </>
  );
}
