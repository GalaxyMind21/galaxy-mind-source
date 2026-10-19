// /treasuries/methodology · the canonical, citable reference for how
// Galaxy Mind values Bitcoin treasury companies. The BTC Prague 2026
// fight was "whose methodology is right", so this is the neutral
// open-methodology anchor: every formula we compute, the gross-vs-net
// framing, and how we source + date the hand-maintained constants. Pure
// reference (no live table · /gross-vs-net-mnav and /treasuries have
// those); server-rendered for a live as-of stamp. TechArticle + FAQPage.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { getMarketSnapshot } from "@/lib/market";
import { OG_TREASURY } from "@/lib/og";

const URL = "https://galaxymind.space/treasuries/methodology";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Bitcoin Treasury Valuation Methodology · Galaxy Mind",
  description:
    "Bitcoin treasury valuation methodology: every formula behind gross, EV, and CEBE-net mNAV, BPS, Amplification, and BTC Yield, plus how we source constants.",
  alternates: { canonical: URL },
  openGraph: {
    images: OG_TREASURY,
    type: "article",
    url: URL,
    title: "Bitcoin Treasury Valuation Methodology",
    description:
      "Every formula we compute, the gross-vs-net framing, and how we source and date the constants. Open methodology.",
    siteName: "Galaxy Mind",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bitcoin Treasury Valuation Methodology",
    description: "Gross / EV / CEBE-net mNAV, BPS, Amplification, BTC Yield · every formula, open.",
    creator: "@GalaxyMind",
  },
};

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-xs text-[var(--accent-ink)] bg-[var(--bg-elevated-2)] rounded-md px-3 py-2.5 my-3 overflow-x-auto">
      {children}
    </p>
  );
}

export default async function TreasuryMethodologyPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;
  const snapshot = await getMarketSnapshot();
  const updated = new Date(snapshot.asOf).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  const FAQ = [
    {
      q: "Why is the headline mNAV gross, not net?",
      a: "Gross mNAV (market cap ÷ bitcoin value) is the simplest, most comparable line across every company, and it matches the treasury-industry convention. We keep it as the headline but publish the EV / fully-diluted and CEBE net lenses right beside it, with dated and cited senior-claims figures, so no single number is presented as the only truth.",
    },
    {
      q: "How are senior claims and share counts sourced?",
      a: "Debt, preferred and cash (for CEBE / EV) and the economic common-share count (for market cap on fast-diluting names) are hand-sourced from SEC filings, dated with an as-of, and reviewed on each new filing. A continuous-integration check flags any constant that drifts past its refresh cadence, and a drift guard logs when the live feed's implied share count overtakes our number. We never guess: a ticker whose figures are not cleanly sourceable shows pending rather than a fabricated value.",
    },
    {
      q: "Which valuation lens should I use?",
      a: "There is no single agreed standard, which is exactly what the BTC Prague 2026 debate surfaced. Gross is the most comparable; EV / fully-diluted reflects the full claim stack (Saylor's framing); CEBE net is the conservative common-equity view. Read each company through whichever lens you trust · we publish all of them. Not financial advice.",
    },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        "@id": `${URL}#article`,
        headline: "Bitcoin Treasury Valuation Methodology",
        description:
          "Open methodology for valuing public Bitcoin treasury companies: gross / EV / CEBE-net mNAV, BPS, CEBE BPS, Amplification, BTC Yield, effective BTC price, sats per $1.",
        url: URL,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        dateModified: snapshot.asOf,
        inLanguage: "en-US",
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(JSONLD) }}
      />
      <SiteHeader />
      <article className="mx-auto max-w-3xl px-4 sm:px-6 pt-10 pb-16">
        <nav
          aria-label="Breadcrumb"
          className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-4"
        >
          <Link href="/" className="hover:text-[var(--accent-ink)] transition-colors">
            Galaxy Mind
          </Link>
          {" · "}
          <Link href="/treasuries" className="hover:text-[var(--accent-ink)] transition-colors">
            Treasuries
          </Link>
          {" · Methodology"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Open methodology
        </div>
        <h1 className="display-title mb-4">
          How we value treasury companies
        </h1>
        <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans max-w-2xl mb-2">
          Every treasury number on Galaxy Mind is reproducible from public
          data. There is no single agreed way to value a Bitcoin treasury
          company · the BTC Prague 2026 debate made that plain · so rather than
          pick a side we compute every respected lens and show our work here.
        </p>
        <div className="font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] mb-8">
          Reviewed {updated}
        </div>

        <div className="space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed">
          <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] mt-4">
            The three mNAV lenses
          </h2>
          <p>
            mNAV (multiple of net asset value) compares a company&apos;s equity
            value to the bitcoin it holds. The debate is over which capital
            structure to fold in. We publish all three.
          </p>
          <h3 className="micro-label text-[var(--text-primary)] mt-6">
            1 · Gross mNAV (the headline)
          </h3>
          <Formula>gross mNAV = market cap ÷ (BTC held × spot BTC price)</Formula>
          <p>
            Common equity only · ignores debt and preferred. The simplest and
            most comparable line, and the treasury-industry convention. Below
            1.0x the stock trades under the value of its bitcoin.
          </p>
          <h3 className="micro-label text-[var(--text-primary)] mt-6">
            2 · EV / fully-diluted mNAV (Saylor&apos;s lens)
          </h3>
          <Formula>EV mNAV = (market cap + debt + preferred − cash) ÷ BTC value</Formula>
          <p>
            Adds the notional value of the senior stack to the numerator · the
            view Michael Saylor argued for at BTC Prague 2026 (include the
            notional value of convertible debt, preferred, and common). Always
            greater than or equal to gross mNAV.
          </p>
          <h3 className="micro-label text-[var(--text-primary)] mt-6">
            3 · CEBE net mNAV (the conservative view)
          </h3>
          <Formula>net mNAV = market cap ÷ (BTC value − debt − preferred + cash)</Formula>
          <p>
            Common Equity Bitcoin Exposure · the bitcoin left for common
            shareholders after senior claims. The conservative counterpart;
            heavy leverage can flip a gross discount into a net premium.
          </p>

          <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] mt-8">
            Per-share metrics (Saylor&apos;s framework)
          </h2>
          <Formula>BPS = bitcoin held × 1e8 ÷ market cap (sats per $100 of stock, before claims)</Formula>
          <Formula>CEBE BPS = the same after subtracting senior claims (sats per $100, net)</Formula>
          <Formula>Amplification = BPS ÷ CEBE BPS = holdings ÷ (holdings − claims-in-BTC)</Formula>
          <p>
            BPS is the growth metric, CEBE BPS the risk metric, and the gap is
            Amplification · 1.0x means no senior leverage (the stock tracks
            bitcoin like an ETF), higher means more. BTC Yield is the growth in
            BPS over time, net of dilution · we compute it from our daily
            snapshots once enough clean history accrues.
          </p>

          <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] mt-8">
            Decision aids
          </h2>
          <Formula>effective BTC price = spot × mNAV · sats per $1 = BTC held × 1e8 ÷ market cap</Formula>
          <p>
            Two framings of the same fact: the dollars-per-bitcoin you
            effectively pay through the wrapper, and the sats you stack per
            dollar invested. Each has a gross and a CEBE-net variant on the
            per-ticker pages.
          </p>

          <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] mt-8">
            Data sourcing
          </h2>
          <p>
            Live inputs come from public sources: bitcoin spot (CoinGecko),
            stock prices (Yahoo Finance), and per-company BTC holdings
            (bitcointreasuries.net). Two classes of figure cannot be pulled
            live, so we hand-source them from SEC filings, date each with an
            as-of, and review on every new filing:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>
              <strong className="text-[var(--text-primary)] font-normal">
                Senior claims
              </strong>{" "}
              (debt + preferred − cash) for the CEBE and EV lenses.
            </li>
            <li>
              <strong className="text-[var(--text-primary)] font-normal">
                Economic share counts
              </strong>{" "}
              for fast-diluting names, where the live feed lags ATM issuance and
              would under-print market cap.
            </li>
          </ul>
          <p>
            A continuous-integration check flags any constant past its refresh
            cadence, and a drift guard logs when the feed&apos;s implied share
            count overtakes ours. Current freshness is published on{" "}
            <Link href="/status" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              /status
            </Link>
            . Where a figure is not cleanly sourceable we show pending, never a
            guess.
          </p>
        </div>

        <section className="border-t border-[var(--border-subtle)] pt-10 mt-10 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Frequently asked</h2>
          <div className="space-y-6">
            {FAQ.map((f) => (
              <div key={f.q}>
                <h3 className="font-mono text-sm uppercase tracking-[0.18em] text-[var(--accent-ink)] mb-2">
                  {f.q}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                  {f.a}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            <Link href="/gross-vs-net-mnav" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              Gross vs net mNAV, live →
            </Link>
            <Link href="/what-is-amplification" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              What is Amplification →
            </Link>
            <Link href="/glossary" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              Glossary →
            </Link>
            <Link href="/treasuries" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
              Live scoreboard →
            </Link>
          </div>
        </section>
      </article>
      <FooterDisclaimer />
    </main>
  );
}
