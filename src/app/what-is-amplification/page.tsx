// /what-is-amplification · live explainer doorway for "what is
// amplification bitcoin treasury", "BPS vs CEBE BPS", "gross vs net mNAV".
// Saylor's BPS / CEBE BPS / Amplification framework is rare to compute
// anywhere; we already do (lib/cebe.ts), so this turns it into a
// rankable, citable surface. Server-rendered, ISR revalidate=300,
// FAQPage JSON-LD. Built 2026-06-14.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { getMarketSnapshot } from "@/lib/market";
import { computeCebe } from "@/lib/cebe";
import { TREASURY_META, COUNTRY_FLAG } from "@/lib/treasuries";
import { OG_TREASURY } from "@/lib/og";

const URL = "https://galaxymind.space/what-is-amplification";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "What Is Amplification? · Bitcoin Treasuries · Galaxy Mind",
  description:
    "Amplification is BPS divided by CEBE BPS: the extra bitcoin-per-share senior leverage adds. Live for MSTR, XXI, Metaplanet and Strive, gross vs net mNAV.",
  alternates: { canonical: URL },
  openGraph: {
    images: OG_TREASURY,
    type: "website",
    url: URL,
    title: "What Is Amplification in Bitcoin Treasury Companies?",
    description:
      "BPS vs CEBE BPS, and the Amplification between them · Michael Saylor's growth-vs-risk framework, computed live for every tracked treasury.",
    siteName: "Galaxy Mind",
  },
  twitter: {
    card: "summary_large_image",
    title: "What Is Amplification in Bitcoin Treasury Companies?",
    description:
      "BPS (before claims) vs CEBE BPS (after). The gap is Amplification, the senior leverage that can beat or lag bitcoin. Live for MSTR / XXI / MPJPY / ASST.",
    creator: "@GalaxyMind",
  },
};

const fmtMnav = (n: number | null): string =>
  n == null || !Number.isFinite(n) ? "·" : `${n.toFixed(2)}x`;
const fmtSats = (n: number | null): string =>
  n == null || !Number.isFinite(n) ? "·" : Math.round(n).toLocaleString();

export default async function WhatIsAmplificationPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const snapshot = await getMarketSnapshot();
  const rows = snapshot.treasuries.map((q) => ({
    q,
    cebe: computeCebe(q, snapshot.btcPrice),
  }));
  // Rank by amplification descending (most leveraged first); pending last.
  const ranked = [...rows].sort((a, b) => {
    const av = a.cebe.amplificationRatio;
    const bv = b.cebe.amplificationRatio;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
  const mostAmp = ranked.find((r) => r.cebe.amplificationRatio != null) ?? null;
  const mostAmpMeta = mostAmp ? TREASURY_META[mostAmp.q.ticker] : null;

  const bluf =
    mostAmp == null || mostAmpMeta == null || mostAmp.cebe.amplificationRatio == null
      ? "Live treasury data is temporarily unavailable; see the full scoreboard for current readings."
      : `Amplification is the gap between a treasury company's BPS (bitcoin per share before senior claims) and its CEBE BPS (after debt and preferred). Right now ${mostAmpMeta.name} (${mostAmp.q.ticker}) is the most amplified treasury we track, at ${mostAmp.cebe.amplificationRatio.toFixed(2)}x: each common share carries about ${Math.round((mostAmp.cebe.amplificationRatio - 1) * 100)}% more gross bitcoin than it nets after senior claims. A company with no debt or preferred sits at 1.0x and tracks bitcoin like an ETF. The more senior leverage it carries, the higher the amplification. That cuts both ways: it beats bitcoin when the company's bitcoin return clears its cost of capital, and lags when short-duration or high-cost claims come due.`;

  const FAQ = [
    {
      q: "What is Amplification in a Bitcoin treasury company?",
      a: `Amplification is BPS divided by CEBE BPS · the extra gross bitcoin-per-share that senior leverage (debt and preferred stock) adds for common shareholders. Equivalently it is bitcoin held divided by the bitcoin left after senior claims. ${mostAmp && mostAmp.cebe.amplificationRatio != null ? `${mostAmpMeta?.name} (${mostAmp.q.ticker}) is currently the most amplified at ${mostAmp.cebe.amplificationRatio.toFixed(2)}x. ` : ""}1.0x means no senior leverage and the stock should track bitcoin like an ETF; higher means more leverage. Michael Saylor frames it as the difference between BPS (the growth metric) and CEBE BPS (the risk metric). Live table at galaxymind.space/treasuries. Not financial advice.`,
    },
    {
      q: "What is the difference between BPS and CEBE BPS?",
      a: "BPS (Bitcoin Per Share) is the bitcoin backing each common share BEFORE senior claims · Saylor's growth metric. CEBE BPS (Common Equity Bitcoin Exposure per share) is the same figure AFTER debt and preferred stock are paid · the conservative risk metric. Galaxy Mind reports both as sats per $100 of stock. With no debt or preferred the two are equal.",
    },
    {
      q: "What is the difference between gross and net (CEBE) mNAV?",
      a: "Gross mNAV divides a company's market cap by the full value of the bitcoin it holds. Net (CEBE) mNAV divides by the bitcoin left for common shareholders after senior claims (debt + preferred, net of cash). The more leverage a company carries, the wider the gap · a stock that looks like a discount on gross mNAV can be at or above NAV once its converts and preferred stack are subtracted.",
    },
    {
      q: "Is high amplification good or bad?",
      a: "Neither by itself. Amplification is the lever that lets a treasury outperform bitcoin, but only when it is well structured. Short-duration, high-cost liabilities turn amplification into risk and underperformance; long-duration, low-cost liabilities turn it into common-equity upside. Saylor's rule of thumb: if a company's bitcoin annualized return (BTC ARR) exceeds its cost of capital, a well-capitalized company should outperform holding bitcoin directly.",
    },
    {
      q: "How is amplification calculated here?",
      a: "For each treasury: BPS = bitcoin holdings times 1e8 sats divided by market cap, per $100 of stock. CEBE BPS subtracts senior claims (debt + preferred, net of cash, converted to bitcoin at spot) before dividing. Amplification = BPS divided by CEBE BPS. Holdings and market cap come from our live scoreboard; senior-claims figures are hand-sourced from SEC filings and dated on each per-ticker page. Pending where claims are not yet reliably sourced.",
    },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        url: URL,
        name: "What Is Amplification in Bitcoin Treasury Companies?",
        description:
          "Live explainer of BPS, CEBE BPS, and Amplification for public Bitcoin treasury companies.",
        isPartOf: { "@id": `${SITE_URL}/#website` },
        provider: { "@id": `${SITE_URL}/#org` },
        dateModified: snapshot.asOf,
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

  const updated = new Date(snapshot.asOf).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

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
          {" · Amplification"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          BPS · CEBE BPS · Amplification · live
        </div>
        <h1 className="display-title mb-4">
          What is Amplification?
        </h1>
        <section className="my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">
            The short answer
          </div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">
            {bluf}
          </p>
          <div className="mt-4 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)]">
            Updated {updated} · live
          </div>
        </section>

        <section className="mb-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] p-5">
          <p className="font-mono text-xs text-[var(--accent-ink)]">
            Amplification = BPS ÷ CEBE BPS = BTC held ÷ (BTC held − senior claims in BTC)
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">
            Live, ranked by amplification
          </h2>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-elevated-2)]/50">
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal">
                    Company
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">
                    Gross mNAV
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">
                    Net mNAV
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">
                    BPS
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">
                    CEBE BPS
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">
                    Amplification
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(({ q, cebe }) => {
                  const meta = TREASURY_META[q.ticker];
                  return (
                    <tr key={q.ticker} className="border-t border-[var(--border-subtle)]">
                      <td className="p-3">
                        <Link
                          href={`/treasuries/${q.ticker}`}
                          className="font-mono text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent-ink)] transition-colors"
                        >
                          {q.ticker}
                        </Link>
                        <span className="text-xs text-[var(--text-tertiary)] ml-2">
                          {meta?.name} {meta ? COUNTRY_FLAG[meta.country] : ""}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono text-sm tabular-nums text-[var(--text-secondary)]">
                        {fmtMnav(q.mNAV)}
                      </td>
                      <td className="p-3 text-right font-mono text-sm tabular-nums text-[var(--text-secondary)]">
                        {fmtMnav(cebe.netMNav)}
                      </td>
                      <td className="p-3 text-right font-mono text-sm tabular-nums text-[var(--text-secondary)]">
                        {fmtSats(cebe.grossSatsPer100)}
                      </td>
                      <td className="p-3 text-right font-mono text-sm tabular-nums text-[var(--text-secondary)]">
                        {fmtSats(cebe.cebeSatsPer100)}
                      </td>
                      <td className="p-3 text-right font-mono text-sm tabular-nums font-semibold text-[var(--accent-ink)]">
                        {cebe.amplificationRatio != null
                          ? `${cebe.amplificationRatio.toFixed(2)}x`
                          : "pending"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 t-xs text-[var(--text-tertiary)] font-sans">
            BPS and CEBE BPS are sats per $100 of stock. Amplification = BPS ÷
            CEBE BPS. Refreshed every 5 minutes · senior-claims figures
            hand-sourced from filings, dated on each per-ticker page. Pending
            where claims are not yet sourced.
          </p>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Go deeper</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/treasuries"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                $ /treasuries
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                The full live scoreboard
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Gross + net mNAV, amplification, and 90-day history per ticker.
              </div>
            </Link>
            <Link
              href="/glossary/amplification"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ✎ /glossary
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                Amplification, BPS, CEBE BPS defined
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Citable definitions for every metric on the board.
              </div>
            </Link>
            <Link
              href="/cheapest-bitcoin-treasury"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                $ /cheapest-bitcoin-treasury
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                Cheapest treasury right now
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Ranked by mNAV · the discount view, live.
              </div>
            </Link>
            <Link
              href="/fit"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ⊕ /fit
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                How much should I hold?
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Live allocation engine across bitcoin and treasury sleeves.
              </div>
            </Link>
          </div>
        </section>

        <section className="border-t border-[var(--border-subtle)] pt-10 mb-8">
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
        </section>
      </article>
      <FooterDisclaimer />
    </main>
  );
}
