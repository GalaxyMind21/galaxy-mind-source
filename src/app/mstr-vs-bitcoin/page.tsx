// /mstr-vs-bitcoin · live comparison landing for the highest-intent
// treasury-decision query ("MSTR vs Bitcoin", "should I buy MSTR or
// bitcoin", "ibit or microstrategy"). Built 2026-05-30 to ride the
// mNAV-below-1 catalyst: when Strategy's mNAV drops under 1.0, buying
// MSTR is an effectively-discounted way to hold bitcoin · the wedge.
//
// Server-rendered (crawlable first paint), ISR revalidate=300, FAQPage
// JSON-LD. Effective BTC price = live spot × MSTR mNAV.
import type { Metadata } from "next";
import { pageOgImage } from "@/lib/og";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { getMarketSnapshot } from "@/lib/market";
import { mNavInterpretation } from "@/lib/treasuries";
import { BtcSpotPriceHero, deriveBtc24hDelta } from "@/components/BtcSpotPriceHero";

const URL = "https://galaxymind.space/mstr-vs-bitcoin";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "MSTR vs Bitcoin · Live mNAV Comparison · Galaxy Mind",
  description:
    "MSTR vs Bitcoin: which is the better buy now? A live comparison of Strategy's effective BTC price against spot. Below 1.0x mNAV, MSTR holds BTC at a discount.",
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    url: URL,
    title: "MSTR vs Bitcoin · Live mNAV Comparison",
    description:
      "Live: Strategy's effective BTC price vs spot Bitcoin, driven by mNAV. Below 1.0x means MSTR is a discounted way to hold BTC.",
    siteName: "Galaxy Mind",
    images: pageOgImage("/mstr-vs-bitcoin/opengraph-image", "MSTR vs Bitcoin · Live mNAV Comparison"),
  },
  twitter: {
    card: "summary_large_image",
    title: "MSTR vs Bitcoin · Live mNAV Comparison",
    description:
      "Strategy's effective BTC price vs spot, updated every 5 minutes. mNAV below 1.0 means MSTR holds BTC at a discount.",
    creator: "@GalaxyMind",
  },
};

function fmtUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "·";
  return `$${Math.round(n).toLocaleString()}`;
}

export default async function MstrVsBitcoinPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const snapshot = await getMarketSnapshot();
  const btcPrice = snapshot.btcPrice;
  const mstr = snapshot.treasuries.find((t) => t.ticker === "MSTR");
  const mNav = mstr?.mNAV ?? null;
  const interp = mNavInterpretation(mNav);
  const effectiveBtc = btcPrice != null && mNav != null ? btcPrice * mNav : null;
  const discountPct =
    btcPrice != null && effectiveBtc != null && btcPrice > 0
      ? (1 - effectiveBtc / btcPrice) * 100
      : null;
  const isCheap = interp.bias === "cheap";

  const bluf =
    mNav == null
      ? "Strategy's live mNAV is temporarily unavailable; see the live treasury scoreboard for the current reading."
      : isCheap
        ? `As of today, MSTR trades at an mNAV of ${mNav.toFixed(2)}x · a share of Strategy holds bitcoin worth more than the share costs. Buying MSTR is currently an effective bitcoin price of ${fmtUsd(effectiveBtc)}, about ${discountPct != null ? Math.round(discountPct) : "?"}% below spot (${fmtUsd(btcPrice)}). That makes MSTR a discounted way to hold bitcoin right now · the rare case where the leveraged wrapper costs less than the asset inside it.`
        : `As of today, MSTR trades at an mNAV of ${mNav.toFixed(2)}x · buying Strategy costs ${fmtUsd(effectiveBtc)} per bitcoin of exposure versus ${fmtUsd(btcPrice)} for spot. You are paying a ${Math.abs(Math.round(discountPct ?? 0))}% premium for the equity wrapper and Strategy's accumulation strategy. Whether that premium is worth it depends on your conviction in continued accretion.`;

  const ROWS = [
    { what: "What you're buying", mstr: "Equity in Strategy (leveraged BTC treasury + software)", btc: "The bitcoin itself (spot or low-fee ETF)" },
    { what: "Effective BTC price", mstr: fmtUsd(effectiveBtc) + (mNav != null ? ` (mNAV ${mNav.toFixed(2)}x)` : ""), btc: fmtUsd(btcPrice) + " (spot)" },
    { what: "Premium / discount vs spot", mstr: discountPct == null ? "·" : discountPct > 0 ? `${Math.round(discountPct)}% discount` : `${Math.abs(Math.round(discountPct))}% premium`, btc: "None · you pay spot" },
    { what: "Leverage / upside", mstr: "Operating leverage · accretive when issuing equity above NAV", btc: "1:1 with bitcoin · no leverage" },
    { what: "Tax-advantaged accounts", mstr: "Trades in any brokerage / IRA as a stock", btc: "Spot ETF (IBIT/FBTC/MSBT) for IRA; self-custody otherwise" },
    { what: "Key risk", mstr: "Premium can compress; dilution; issuer-specific", btc: "Pure price volatility · no issuer risk" },
  ];

  const FAQ = [
    { q: "Is MSTR better than buying Bitcoin?", a: `${bluf} The decision comes down to whether you want leverage and accretion exposure (favors MSTR, especially when mNAV is compressed below ~1.05x) or pure spot exposure with no premium risk (favors holding BTC or a low-fee ETF). The Galaxy Mind /fit engine weighs this explicitly using live mNAV. Not financial advice.` },
    { q: "What is MSTR's mNAV right now?", a: mNav == null ? "MSTR's live mNAV is published at galaxymind.space/treasuries/MSTR and updates every 5 minutes. mNAV is Strategy's market cap divided by the value of the bitcoin it holds." : `MSTR (Strategy) currently trades at an mNAV of ${mNav.toFixed(2)}x · ${interp.label.toLowerCase()}. ${interp.detail} Live value and 90-day history at galaxymind.space/treasuries/MSTR.` },
    { q: "What does it mean when MSTR trades below NAV?", a: "When MSTR's mNAV drops below 1.0, the company's market cap is worth less than the bitcoin on its balance sheet · so each share gives you more than a dollar of bitcoin per dollar spent. Historically this is rare and has correlated with bitcoin accumulation zones, because the marginal sophisticated buyer stops paying a premium for the wrapper. It also removes Strategy's ability to issue equity accretively, which is why the premium matters to the long-term thesis." },
    { q: "MSTR vs IBIT: which should I buy?", a: "IBIT (BlackRock's spot Bitcoin ETF) is pure spot exposure at a 0.25% fee · no premium, no leverage, ideal for a tax-advantaged account where the compounding is shielded. MSTR adds operating leverage and accretion but carries premium/discount risk. When MSTR's mNAV is below ~1.05x, the discount can outweigh IBIT's simplicity; when MSTR trades at a steep premium, IBIT/MSBT is the cleaner bitcoin exposure. The /fit allocation engine picks between them based on your horizon, risk tolerance, and account type." },
    { q: "How is this comparison calculated?", a: "Effective BTC price = live spot bitcoin price times MSTR's mNAV (market cap divided by value of bitcoin held). Spot from CoinGecko, MSTR market cap and bitcoin holdings from Yahoo Finance + bitcointreasuries.net, all refreshed every 5 minutes. Open methodology, reproducible from public data. Not financial advice." },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", url: URL, name: "MSTR vs Bitcoin · Live mNAV Comparison", description: "Live comparison of Strategy's effective bitcoin price (spot times mNAV) versus buying spot Bitcoin directly.", isPartOf: { "@id": `${SITE_URL}/#website` }, provider: { "@id": `${SITE_URL}/#org` }, dateModified: snapshot.asOf },
      { "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ],
  };

  const updated = new Date(snapshot.asOf).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <script type="application/ld+json" nonce={nonce}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(JSONLD) }} />
      <SiteHeader />
      <article className="mx-auto max-w-3xl px-4 sm:px-6 pt-10 pb-16">
        <nav aria-label="Breadcrumb" className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-4">
          <Link href="/" className="hover:text-[var(--accent-ink)] transition-colors">Galaxy Mind</Link>
          {" · "}
          <Link href="/treasuries" className="hover:text-[var(--accent-ink)] transition-colors">Treasuries</Link>
          {" · MSTR vs Bitcoin"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">The decision · answered live</div>
        <h1 className="display-title mb-4">MSTR vs Bitcoin</h1>
        <BtcSpotPriceHero price={snapshot.btcPrice} delta24h={deriveBtc24hDelta(snapshot.btcPrice, snapshot.hourlyCloses)} size="md" label="BTC SPOT · LIVE" />
        <section className="my-8 rounded-2xl border-2 p-6 sm:p-8" style={{ borderColor: isCheap ? "color-mix(in srgb, var(--accent) 40%, transparent)" : "var(--border-subtle)", background: "var(--bg-elevated)" }}>
          <div className="micro-label text-[var(--text-tertiary)] mb-3">The short answer</div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">{bluf}</p>
          <div className="mt-4 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)]">Updated {updated} · live</div>
        </section>
        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">Side by side</h2>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-elevated-2)]/50">
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal" />
                  <th className="p-3 font-mono text-sm font-semibold text-[var(--accent-ink)]">MSTR (Strategy)</th>
                  <th className="p-3 font-mono text-sm font-semibold text-[var(--text-primary)]">Spot Bitcoin</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.what} className="border-t border-[var(--border-subtle)]">
                    <td className="p-3 align-top font-mono t-xs uppercase tracking-wider text-[var(--text-tertiary)] whitespace-nowrap">{r.what}</td>
                    <td className="p-3 align-top text-sm text-[var(--text-secondary)] font-sans">{r.mstr}</td>
                    <td className="p-3 align-top text-sm text-[var(--text-secondary)] font-sans">{r.btc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 t-xs text-[var(--text-tertiary)] font-sans">Effective BTC price = live spot times MSTR mNAV. Refreshed every 5 minutes from CoinGecko, Yahoo Finance, and bitcointreasuries.net.</p>
        </section>
        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Go deeper</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link href="/treasuries/MSTR" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">$ /treasuries/MSTR</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">MSTR live mNAV + 90-day history</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">The full Strategy dashboard · mNAV trail, BTC holdings, SEC filings.</div>
            </Link>
            <Link href="/fit" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">⊕ /fit</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">How much MSTR vs BTC should I hold?</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">Live allocation engine · weighs MSTR vs spot by horizon, tolerance, and account type using current mNAV.</div>
            </Link>
            <Link href="/is-mstr-overvalued" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">? /is-mstr-overvalued</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">Is MSTR overvalued right now?</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">The premium/discount verdict, live from mNAV.</div>
            </Link>
            <Link href="/should-i-buy-bitcoin" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">₿ /should-i-buy-bitcoin</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">Should I buy bitcoin at all right now?</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">The live 0-100 buying gauge · timing before instrument.</div>
            </Link>
          </div>
        </section>
        <section className="border-t border-[var(--border-subtle)] pt-10 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Frequently asked</h2>
          <div className="space-y-6">
            {FAQ.map((f) => (
              <div key={f.q}>
                <h3 className="font-mono text-sm uppercase tracking-[0.18em] text-[var(--accent-ink)] mb-2">{f.q}</h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      </article>
      <FooterDisclaimer />
    </main>
  );
}
