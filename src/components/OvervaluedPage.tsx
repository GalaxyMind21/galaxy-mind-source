// Shared server component behind the four "Is {ticker} overvalued?"
// pages. Each /is-{x}-overvalued/page.tsx renders this once with its
// ticker prop · so every URL emits exactly one ticker-specific
// FAQPage (the structured data is co-located here, never in a layout,
// per the 2026-05-29 duplicate-FAQPage fix).
//
// Editorial stance: the "overvalued?" verdict is a reading of mNAV
// (premium/discount to the bitcoin the company holds) · objective data
// interpretation, not a stock recommendation. "Not financial advice"
// rides in the verdict, the prose, and the footer.

import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { getMarketSnapshot } from "@/lib/market";
import { TREASURY_META } from "@/lib/treasuries";
import {
  BtcSpotPriceHero,
  deriveBtc24hDelta,
} from "@/components/BtcSpotPriceHero";
import {
  type OverTicker,
  OVERVALUED_CONFIG,
  OVER_TICKERS,
  overvaluedVerdict,
  overvaluedFaqItems,
  buildOvervaluedJsonLd,
  flagOf,
} from "@/lib/overvalued";
import { HabitCaptureStrip } from "@/components/HabitCaptureStrip";

export async function OvervaluedPage({ ticker }: { ticker: OverTicker }) {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  // Live snapshot · the verdict renders in first paint as crawlable
  // HTML. ISR re-renders every 5 min via the page route's revalidate.
  const snapshot = await getMarketSnapshot();
  const row = snapshot.treasuries.find((r) => r.ticker === ticker);
  const mNav = row?.mNAV ?? null;
  const btcHoldings = row?.btcHoldings ?? null;

  const cfg = OVERVALUED_CONFIG[ticker];
  const meta = TREASURY_META[ticker];
  const verdict = overvaluedVerdict(ticker, mNav);
  const jsonLd = buildOvervaluedJsonLd(ticker, mNav, btcHoldings);
  const faqItems = overvaluedFaqItems(ticker, mNav, btcHoldings);

  const mNavDisplay =
    mNav != null && Number.isFinite(mNav) ? `${mNav.toFixed(2)}x` : "n/a";
  const siblings = OVER_TICKERS.filter((t) => t !== ticker);

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)] font-mono">
      {/* SAFE inline JSON-LD · static server-controlled object,
          safeJsonLd() escapes JSON-LD-risky chars, CSP nonce gates the
          script tag. One FAQPage per URL. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
      <SiteHeader />

      <article className="mx-auto max-w-3xl px-4 sm:px-6 pt-10 pb-16">
        <nav
          aria-label="Breadcrumb"
          className="t-xs font-medium text-[var(--text-tertiary)] mb-4"
        >
          <Link href="/" className="hover:text-[var(--accent-ink)] transition-colors">
            Galaxy Mind
          </Link>
          {" · "}
          <Link
            href="/treasuries"
            className="hover:text-[var(--accent-ink)] transition-colors"
          >
            Treasuries
          </Link>
          {" · "}
          <span className="text-[var(--text-secondary)]">
            Is {cfg.searchName} overvalued?
          </span>
        </nav>

        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          The valuation question · answered live
        </div>
        <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-tight mb-2">
          Is {cfg.searchName} Overvalued?
        </h1>
        <p className="text-sm text-[var(--text-tertiary)] mb-4 font-sans">
          {flagOf(ticker)} {meta.name} · {cfg.altName} · ticker {ticker}
        </p>

        <BtcSpotPriceHero
          price={snapshot.btcPrice}
          delta24h={deriveBtc24hDelta(snapshot.btcPrice, snapshot.hourlyCloses)}
          size="md"
          label="BTC SPOT · mNAV IS RELATIVE TO THIS"
        />

        {/* LIVE VERDICT · the mNAV is the answer. Big number, plain
            language, click into the live deep-dive for that ticker. */}
        <section
          className="my-8 rounded-2xl border-2 bg-[var(--bg-elevated)] p-8 text-center"
          style={{
            borderColor: `color-mix(in srgb, ${verdict.color} 40%, transparent)`,
          }}
        >
          <div className="micro-label text-[var(--text-tertiary)] mb-3">
            {cfg.searchName} mNAV · live
          </div>
          <div className="flex items-baseline justify-center gap-3 mb-3">
            <span
              className="font-mono text-6xl sm:text-7xl font-bold tabular-nums leading-none"
              style={{ color: verdict.color }}
            >
              {mNavDisplay}
            </span>
          </div>
          <div
            className="font-mono text-lg sm:text-xl uppercase tracking-[0.2em] font-bold mb-3"
            style={{ color: verdict.color }}
          >
            {verdict.answer}
          </div>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans max-w-xl mx-auto mb-2">
            {verdict.headline}
          </p>
          <p className="text-sm text-[var(--text-tertiary)] leading-relaxed font-sans max-w-xl mx-auto">
            {verdict.detail}
          </p>

          <Link
            href={`/treasuries/${ticker}`}
            className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-md bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] transition-colors lit-primary"
          >
            See live mNAV and 90-day history for {cfg.searchName} →
          </Link>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-4 mt-8">
            How to tell if {cfg.searchName} is overvalued
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed font-sans mb-4">
            For a Bitcoin treasury company, the cleanest valuation measure is{" "}
            <strong className="text-[var(--text-primary)]">mNAV</strong> · its
            market cap divided by the value of the bitcoin it holds. An mNAV of
            1.0x means the stock is priced at exactly the value of its bitcoin.
            Below 1.0x, you are paying less than the bitcoin is worth. Above
            1.6x, you are paying a steep premium for operating leverage and
            future accumulation.
          </p>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed font-sans mb-4">
            {meta.name} {meta.blurb}
          </p>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed font-sans">
            This is educational, not financial advice. mNAV answers one specific
            question · premium or discount to bitcoin held · and ignores
            everything else (debt, dilution terms, management, taxes). Consult a
            licensed advisor before making material financial decisions.
          </p>
        </section>

        <section className="mb-8 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">
            Compare the other treasuries
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {siblings.map((t) => {
              const sCfg = OVERVALUED_CONFIG[t];
              return (
                <Link
                  key={t}
                  href={`/${sCfg.slug}`}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
                >
                  <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                    {flagOf(t)} {t}
                  </div>
                  <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors">
                    Is {sCfg.searchName} overvalued?
                  </div>
                </Link>
              );
            })}
            <Link
              href="/treasuries"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                $ /treasuries
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors">
                All four, side by side
              </div>
            </Link>
            <Link
              href="/should-i-buy-bitcoin"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ₿ /should-i-buy-bitcoin
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors">
                Should I buy Bitcoin today?
              </div>
            </Link>
          </div>
        </section>

        <HabitCaptureStrip eyebrow="Track the premium daily" />

        <section className="border-t border-[var(--border-subtle)] pt-12 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">
            Frequently asked
          </h2>
          <div className="space-y-6">
            {faqItems.map((q) => (
              <div key={q.name}>
                <h3 className="font-mono text-sm uppercase tracking-[0.18em] text-[var(--accent-ink)] mb-2">
                  {q.name}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                  {q.acceptedAnswer.text}
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
