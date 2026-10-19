// /gross-vs-net-mnav · the head-on doorway for the BTC Prague 2026
// "which mNAV is right" debate. Shows all three lenses live and side by
// side (gross, EV / fully-diluted, CEBE net) for every tracked treasury,
// neutrally, so the page adjudicates by showing every number rather than
// taking a side. Server-rendered, ISR revalidate=300, FAQPage JSON-LD.
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

const URL = "https://galaxymind.space/gross-vs-net-mnav";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Gross vs EV vs Net mNAV · Bitcoin Treasuries · Galaxy Mind",
  description:
    "Gross vs EV vs net mNAV for Bitcoin treasuries: all three lenses side by side, live, for MSTR, XXI, Metaplanet and Strive, with the methodology in the open.",
  alternates: { canonical: URL },
  openGraph: {
    images: OG_TREASURY,
    type: "website",
    url: URL,
    title: "Gross vs Net mNAV · all three lenses, live",
    description:
      "Gross, EV / fully-diluted, and CEBE net mNAV side by side for every tracked Bitcoin treasury. Neutral, open methodology.",
    siteName: "Galaxy Mind",
  },
  twitter: {
    card: "summary_large_image",
    title: "Gross vs Net mNAV · all three lenses, live",
    description:
      "The treasury-valuation debate with every number on the table, so you can judge it yourself. MSTR / XXI / MPJPY / ASST.",
    creator: "@GalaxyMind",
  },
};

const fmtMnav = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "·" : `${n.toFixed(2)}x`;

export default async function GrossVsNetMnavPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const snapshot = await getMarketSnapshot();
  const rows = snapshot.treasuries.map((q) => ({ q, cebe: computeCebe(q, snapshot.btcPrice) }));

  // Live, quotable verdict: surface the ticker where the three lenses
  // disagree most (widest gross-to-net spread) with its actual numbers,
  // so the page leads with a citable sentence, not abstract framing.
  const withSpread = rows.flatMap((r) => {
    const g = r.q.mNAV;
    const n = r.cebe.netMNav;
    const ev = r.cebe.evMNav;
    if (g == null || n == null || ev == null || !r.cebe.available) return [];
    return [{ ticker: r.q.ticker, g, n, ev, spread: n - g }];
  });
  const spreadLeader = [...withSpread].sort((a, b) => b.spread - a.spread)[0] ?? null;
  const verdict =
    spreadLeader == null
      ? "Live readings are refreshing right now; the table below shows all three lenses for every tracked treasury."
      : `Right now ${TREASURY_META[spreadLeader.ticker]?.name ?? spreadLeader.ticker} (${spreadLeader.ticker}) reads ${fmtMnav(spreadLeader.g)} on gross mNAV, ${fmtMnav(spreadLeader.ev)} on an enterprise-value basis, and ${fmtMnav(spreadLeader.n)} net of its senior debt and preferred. The gap between those three readings is what the whole debate is about.`;

  const FAQ = [
    {
      q: "What is the difference between gross and net mNAV?",
      a: "Gross mNAV divides a treasury company's market cap by the full value of the bitcoin it holds, ignoring its capital structure. Net (CEBE) mNAV divides by the bitcoin left for common shareholders after senior claims (debt and preferred, net of cash). The more leverage a company carries, the wider the gap · a stock that looks like a discount on gross mNAV can sit at or above NAV once its converts and preferred stack are accounted for.",
    },
    {
      q: "What is fully-diluted or EV mNAV?",
      a: "Enterprise-value (fully-diluted) mNAV adds the notional value of debt and preferred to the numerator instead of subtracting from the bitcoin side: (market cap + debt + preferred − cash) ÷ bitcoin value. At BTC Prague 2026 Michael Saylor argued mNAV should be calculated this way · including the notional value of convertible debt, preferred, and common. It is always greater than or equal to gross mNAV.",
    },
    {
      q: "Does mNAV use enterprise value or market cap?",
      a: "Both are used, and that is the crux of the debate. The standard, headline mNAV uses market cap (gross mNAV = market cap ÷ bitcoin value). Critics, NYDIG among them, argue that plain market-cap mNAV understates the true cost of a leveraged treasury, because it ignores the debt and preferred stack. Their preferred read is an enterprise-value version: (market cap + debt + preferred − cash) ÷ bitcoin value. Galaxy Mind publishes both, plus the CEBE net view, side by side, so the difference is explicit rather than hidden inside one number.",
    },
    {
      q: "Which mNAV is the right one?",
      a: "There is no single agreed standard, which is exactly what the BTC Prague 2026 debate was about. Gross is the simplest and most comparable; EV / fully-diluted reflects the full claim stack as Saylor frames it; CEBE net is the conservative view of what common shareholders actually own. Galaxy Mind publishes all three live, with dated and cited senior-claims figures, so you can read the company through whichever lens you trust. Not financial advice.",
    },
    {
      q: "Why do the three numbers differ so much for MSTR?",
      a: "Strategy carries a large convertible-note and preferred stack. That leverage barely moves a debt-free company's numbers, but it pulls MSTR's three lenses apart. Its gross mNAV can read like a discount while its net (CEBE) mNAV is higher, because the senior claims sit ahead of common shareholders. The live table above shows the current spread.",
    },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        url: URL,
        name: "Gross vs Net mNAV for Bitcoin Treasury Companies",
        description:
          "Live side-by-side of gross, EV / fully-diluted, and CEBE net mNAV for public Bitcoin treasury companies.",
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
          {" · Gross vs net mNAV"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Which mNAV is correct? · live
        </div>
        <h1 className="display-title mb-4">
          Gross vs EV vs net mNAV
        </h1>
        <section className="my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">
            The short answer
          </div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">
            Gross mNAV, enterprise-value (fully-diluted) mNAV, or net (CEBE)
            mNAV: which is the correct way to value a Bitcoin treasury company?
            The BTC Prague 2026 debate left it unsettled, and for a leveraged
            company the three lenses can disagree completely. Galaxy Mind does
            not pick a side. It publishes all three live, with dated and cited
            senior-claims figures, so you can read each company through
            whichever you trust.
          </p>
          <p className="mt-4 text-base sm:text-lg text-[var(--text-primary)] leading-relaxed font-sans font-semibold">
            {verdict}
          </p>
          <div className="mt-4 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)]">
            Updated {updated} · live
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">
            All three lenses, live
          </h2>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-elevated-2)]/50">
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal">
                    Company
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">
                    Gross
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">
                    EV / diluted
                  </th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">
                    Net (CEBE)
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ q, cebe }) => {
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
                        {cebe.available ? fmtMnav(cebe.evMNav) : "pending"}
                      </td>
                      <td className="p-3 text-right font-mono text-sm tabular-nums font-semibold text-[var(--accent-ink)]">
                        {cebe.available ? fmtMnav(cebe.netMNav) : "pending"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 t-xs text-[var(--text-tertiary)] font-sans">
            Gross = market cap ÷ BTC value. EV / diluted = (market cap + debt +
            preferred − cash) ÷ BTC value. Net (CEBE) = market cap ÷ (BTC value
            − senior claims). Refreshed every 5 minutes · senior-claims figures
            hand-sourced from filings and dated on each per-ticker page. Pending
            where claims are not yet sourced.
          </p>
        </section>

        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Go deeper</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/treasuries/methodology"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ✎ /treasuries/methodology
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                Every formula we compute
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                The full, open methodology behind all three lenses.
              </div>
            </Link>
            <Link
              href="/what-is-amplification"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ↕ /what-is-amplification
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                What the gap means
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Amplification = the spread between gross and net, in sats.
              </div>
            </Link>
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
                All four tickers, sortable, with 90-day history.
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
                Ranked by gross mNAV, live.
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
