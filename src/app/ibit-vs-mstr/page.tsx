// /ibit-vs-mstr · live comparison landing for the high-intent instrument
// query ("IBIT vs MSTR", "ibit or microstrategy", "spot etf vs strategy
// for bitcoin exposure"). Sibling to /mstr-vs-bitcoin, but the axis here
// is wrapper-vs-wrapper: BlackRock's spot ETF (pure, fee-only) against
// Strategy's leveraged treasury equity (mNAV premium/discount). The live
// wedge is MSTR's mNAV · below ~1.05x the MSTR discount can outweigh
// IBIT's simplicity; at a steep premium IBIT is the cleaner exposure.
//
// Server-rendered (crawlable first paint), ISR revalidate=300, FAQPage
// JSON-LD. Effective BTC price via MSTR = live spot × MSTR mNAV; via
// IBIT ≈ spot (a 0.25% expense ratio, not a price premium).
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

const URL = "https://galaxymind.space/ibit-vs-mstr";
const SITE_URL = "https://galaxymind.space";

// IBIT's published expense ratio (BlackRock iShares Bitcoin Trust). This
// is an annual fee on assets, NOT a price premium · it's why IBIT's
// "effective BTC price" is spot, with the fee shown separately.
const IBIT_FEE_PCT = 0.25;

export const revalidate = 300;

export const metadata: Metadata = {
  title: "IBIT vs MSTR · Best Way to Hold Bitcoin? · Galaxy Mind",
  description:
    "IBIT vs MSTR: a live comparison of the spot Bitcoin ETF against Strategy's leveraged treasury equity, showing when MSTR's mNAV discount beats IBIT's simplicity.",
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    url: URL,
    title: "IBIT vs MSTR · Which Bitcoin Exposure Is Better?",
    description:
      "Live: BlackRock's spot ETF vs Strategy's leveraged treasury equity. IBIT is pure spot at 0.25%; MSTR adds leverage but carries mNAV premium risk.",
    siteName: "Galaxy Mind",
    images: pageOgImage("/ibit-vs-mstr/opengraph-image", "IBIT vs MSTR · Which Bitcoin Exposure Is Better?"),
  },
  twitter: {
    card: "summary_large_image",
    title: "IBIT vs MSTR · Which Bitcoin Exposure Is Better?",
    description:
      "Spot ETF or leveraged treasury equity? Live mNAV decides when MSTR's discount beats IBIT's simplicity. Updated every 5 minutes.",
    creator: "@GalaxyMind",
  },
};

function fmtUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "·";
  return `$${Math.round(n).toLocaleString()}`;
}

export default async function IbitVsMstrPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const snapshot = await getMarketSnapshot();
  const btcPrice = snapshot.btcPrice;
  const mstr = snapshot.treasuries.find((t) => t.ticker === "MSTR");
  const mNav = mstr?.mNAV ?? null;
  const interp = mNavInterpretation(mNav);
  const effectiveBtc = btcPrice != null && mNav != null ? btcPrice * mNav : null;
  const premiumPct =
    btcPrice != null && effectiveBtc != null && btcPrice > 0
      ? (effectiveBtc / btcPrice - 1) * 100
      : null;
  const isCheap = interp.bias === "cheap";

  const bluf =
    mNav == null
      ? "Strategy's live mNAV is temporarily unavailable, so the MSTR side of this comparison can't be priced right now. IBIT remains pure 1:1 spot exposure at a 0.25% annual fee; see the live treasury scoreboard for MSTR's current reading."
      : isCheap
        ? `As of today, MSTR trades at an mNAV of ${mNav.toFixed(2)}x · its market cap is below the bitcoin it holds, so buying MSTR is an effective bitcoin price of ${fmtUsd(effectiveBtc)}, about ${premiumPct != null ? Math.abs(Math.round(premiumPct)) : "?"}% below spot (${fmtUsd(btcPrice)}). IBIT, by contrast, is pure 1:1 spot exposure with no premium · just BlackRock's 0.25% annual fee. Right now the MSTR discount plus its operating leverage can outweigh IBIT's simplicity · the rare window where the leveraged wrapper costs less than the asset inside it. The trade-off is MSTR's premium can compress and it carries issuer-specific risk; IBIT cannot trade away from spot.`
        : `As of today, MSTR trades at an mNAV of ${mNav.toFixed(2)}x · buying Strategy costs ${fmtUsd(effectiveBtc)} per bitcoin of exposure, a ${premiumPct != null ? Math.round(premiumPct) : "?"}% premium over spot (${fmtUsd(btcPrice)}). IBIT gives you that same bitcoin at spot for a 0.25% annual fee, with no premium and no issuer-specific risk. At today's premium, IBIT is the cleaner, cheaper way to hold bitcoin unless you specifically want MSTR's leverage and accretion exposure. The premium is the price of the leveraged wrapper · whether it's worth it depends on your conviction in continued accretion.`;

  const ROWS = [
    { what: "What you're buying", ibit: "Shares of a spot Bitcoin ETF · 1 share is a fixed slice of BTC", mstr: "Equity in Strategy (leveraged BTC treasury + software)" },
    { what: "Effective BTC price", ibit: fmtUsd(btcPrice) + " (spot)", mstr: fmtUsd(effectiveBtc) + (mNav != null ? ` (mNAV ${mNav.toFixed(2)}x)` : "") },
    { what: "Premium / discount vs spot", ibit: "None · tracks spot (0.25% annual fee)", mstr: premiumPct == null ? "·" : premiumPct < 0 ? `${Math.abs(Math.round(premiumPct))}% discount` : `${Math.round(premiumPct)}% premium` },
    { what: "Leverage / upside", ibit: "1:1 with bitcoin · no leverage", mstr: "Operating leverage · accretive when issuing equity above NAV" },
    { what: "Ongoing cost", ibit: `${IBIT_FEE_PCT}% expense ratio per year`, mstr: "No fund fee · cost is the mNAV premium you pay at entry" },
    { what: "Tax-advantaged accounts", ibit: "Trades in any brokerage / IRA · ideal for sheltered compounding", mstr: "Also trades in any brokerage / IRA as a stock" },
    { what: "Key risk", ibit: "Pure price volatility · not your keys, but no issuer-specific risk", mstr: "Premium can compress; dilution; issuer-specific risk" },
  ];

  const FAQ = [
    { q: "IBIT vs MSTR: which is better for bitcoin exposure?", a: `${bluf} The decision comes down to which exposure you want. Pure, fee-only spot with no premium risk favors IBIT, most clearly when MSTR trades at a premium. Leverage and accretion favors MSTR, most clearly when mNAV is compressed below ~1.05x. The Galaxy Mind /fit engine weighs this explicitly using live mNAV, your horizon, and your account type. Not financial advice.` },
    { q: "Is IBIT just spot bitcoin?", a: `Effectively yes · IBIT (BlackRock's iShares Bitcoin Trust) holds actual bitcoin and its shares track the spot price 1:1, minus a ${IBIT_FEE_PCT}% annual expense ratio. There is no leverage and no premium to net asset value of any meaningful size, because authorized participants arbitrage it back to spot. The trade-off versus self-custody is that you don't hold the keys · you hold a fund share. For a tax-advantaged account where you can't easily self-custody, that's usually an acceptable trade.` },
    { q: "What is MSTR's mNAV right now?", a: mNav == null ? "MSTR's live mNAV is published at galaxymind.space/treasuries/MSTR and updates every 5 minutes. mNAV is Strategy's market cap divided by the value of the bitcoin it holds · above 1.0 means you pay a premium for the wrapper, below 1.0 means a discount." : `MSTR (Strategy) currently trades at an mNAV of ${mNav.toFixed(2)}x · ${interp.label.toLowerCase()}. ${interp.detail} That works out to an effective bitcoin price of ${fmtUsd(effectiveBtc)} versus ${fmtUsd(btcPrice)} for spot via IBIT. Live value and 90-day history at galaxymind.space/treasuries/MSTR.` },
    { q: "When does MSTR beat IBIT?", a: "MSTR tends to win when two things line up. Its mNAV is low, near or below ~1.05x, so you are not overpaying for the wrapper. And you actually want the operating leverage that lets Strategy accumulate more bitcoin per share over time. IBIT tends to win when MSTR trades at a steep premium, when you want zero issuer-specific risk, or when you simply want the cleanest possible spot exposure in a retirement account. Because the mNAV moves daily, the answer changes · which is why this page prices it live rather than giving a static verdict." },
    { q: "How is this comparison calculated?", a: `IBIT's effective bitcoin price is the live spot price (it tracks spot 1:1; the ${IBIT_FEE_PCT}% fee is shown separately as an annual cost, not a price premium). MSTR's effective bitcoin price is live spot times MSTR's mNAV (market cap divided by value of bitcoin held). Spot from CoinGecko, MSTR market cap and bitcoin holdings from Yahoo Finance + bitcointreasuries.net, all refreshed every 5 minutes. Open methodology, reproducible from public data. Not financial advice.` },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", url: URL, name: "IBIT vs MSTR · Which Bitcoin Exposure Is Better?", description: "Live comparison of the IBIT spot Bitcoin ETF against Strategy's leveraged treasury equity, driven by MSTR's mNAV.", isPartOf: { "@id": `${SITE_URL}/#website` }, provider: { "@id": `${SITE_URL}/#org` }, dateModified: snapshot.asOf },
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
          {" · IBIT vs MSTR"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">Spot ETF vs leveraged equity · answered live</div>
        <h1 className="display-title mb-4">IBIT vs MSTR</h1>
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
                  <th className="p-3 font-mono text-sm font-semibold text-[var(--accent-ink)]">IBIT (spot ETF)</th>
                  <th className="p-3 font-mono text-sm font-semibold text-[var(--text-primary)]">MSTR (Strategy)</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.what} className="border-t border-[var(--border-subtle)]">
                    <td className="p-3 align-top font-mono t-xs uppercase tracking-wider text-[var(--text-tertiary)] whitespace-nowrap">{r.what}</td>
                    <td className="p-3 align-top text-sm text-[var(--text-secondary)] font-sans">{r.ibit}</td>
                    <td className="p-3 align-top text-sm text-[var(--text-secondary)] font-sans">{r.mstr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 t-xs text-[var(--text-tertiary)] font-sans">IBIT tracks spot 1:1 (the {IBIT_FEE_PCT}% fee is an annual cost, not a price premium). MSTR effective price = live spot times MSTR mNAV. Refreshed every 5 minutes from CoinGecko, Yahoo Finance, and bitcointreasuries.net.</p>
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
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">How much IBIT vs MSTR should I hold?</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">Live allocation engine · weighs spot ETF vs MSTR by horizon, tolerance, and account type using current mNAV.</div>
            </Link>
            <Link href="/mstr-vs-bitcoin" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">⚖ /mstr-vs-bitcoin</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">MSTR vs holding bitcoin directly</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">The wrapper-vs-asset version of this question, priced live from mNAV.</div>
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
