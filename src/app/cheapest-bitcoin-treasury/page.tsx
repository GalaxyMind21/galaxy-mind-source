// /cheapest-bitcoin-treasury · live ranked-by-cheapness landing for
// "cheapest bitcoin treasury stock" / "bitcoin treasury companies list".
// Galaxy Mind computes "cheapest" (lowest mNAV) every 5 minutes; trackers
// list treasuries but none frame the list as a ranked-by-discount DECISION.
// Server-rendered, ISR revalidate=300, FAQPage JSON-LD. Built 2026-05-30.
import type { Metadata } from "next";
import { pageOgImage } from "@/lib/og";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd } from "@/lib/json-ld";
import { getMarketSnapshot } from "@/lib/market";
import { TREASURY_META, COUNTRY_FLAG, mNavInterpretation } from "@/lib/treasuries";

const URL = "https://galaxymind.space/cheapest-bitcoin-treasury";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Cheapest Bitcoin Treasury Stock Right Now · Galaxy Mind",
  description:
    "Which Bitcoin treasury is cheapest right now? A live scoreboard of MSTR, Metaplanet, XXI and Strive ranked by mNAV. The lowest is the biggest discount to BTC.",
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    url: URL,
    title: "Cheapest Bitcoin Treasury Stock Right Now",
    description: "Live ranking of public Bitcoin treasuries by mNAV · the lowest is the biggest discount to the bitcoin it holds.",
    siteName: "Galaxy Mind",
    images: pageOgImage("/cheapest-bitcoin-treasury/opengraph-image", "Cheapest Bitcoin Treasury Stock Right Now"),
  },
  twitter: {
    card: "summary_large_image",
    title: "Cheapest Bitcoin Treasury Stock Right Now",
    description: "MSTR / Metaplanet / Twenty One / Strive ranked by mNAV, live. Lowest means biggest discount to bitcoin.",
    creator: "@GalaxyMind",
  },
};

function fmtUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "·";
  return `$${Math.round(n).toLocaleString()}`;
}

export default async function CheapestTreasuryPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const snapshot = await getMarketSnapshot();
  const btcPrice = snapshot.btcPrice;
  const ranked = [...snapshot.treasuries].sort((a, b) => {
    if (a.mNAV == null && b.mNAV == null) return 0;
    if (a.mNAV == null) return 1;
    if (b.mNAV == null) return -1;
    return a.mNAV - b.mNAV;
  });
  const cheapest = ranked.find((t) => t.mNAV != null) ?? null;
  const cheapestMeta = cheapest ? TREASURY_META[cheapest.ticker] : null;
  const belowNavCount = snapshot.treasuries.filter((t) => t.mNAV != null && t.mNAV < 1.0).length;
  const cheapestEff = cheapest?.mNAV != null && btcPrice != null ? btcPrice * cheapest.mNAV : null;
  const cheapestDiscount = cheapestEff != null && btcPrice != null && btcPrice > 0 ? Math.round((1 - cheapestEff / btcPrice) * 100) : null;

  const bluf =
    cheapest == null || cheapestMeta == null || cheapest.mNAV == null
      ? "Live treasury data is temporarily unavailable; see the full scoreboard for current readings."
      : `As of today, the cheapest Bitcoin treasury is ${cheapestMeta.name} (${cheapest.ticker}) at an mNAV of ${cheapest.mNAV.toFixed(2)}x${cheapest.mNAV < 1.0 ? ` · its market cap is below the value of the bitcoin it holds, an effective bitcoin price of ${fmtUsd(cheapestEff)}${cheapestDiscount != null ? `, about ${cheapestDiscount}% below spot` : ""}.` : `, the smallest premium of the tracked treasuries.`}${belowNavCount > 0 ? ` ${belowNavCount} of the ${snapshot.treasuries.length} tracked treasuries currently trade below the value of their bitcoin.` : ""}`;

  const FAQ = [
    { q: "Which Bitcoin treasury company is cheapest right now?", a: `${bluf} "Cheapest" here means lowest mNAV · market cap divided by the value of the bitcoin the company holds. An mNAV below 1.0 means the stock trades for less than its bitcoin. Live ranking and 90-day history at galaxymind.space/treasuries. Not financial advice.` },
    { q: "What is a Bitcoin treasury company?", a: "A Bitcoin treasury company is a publicly traded firm that holds bitcoin as a primary reserve asset on its balance sheet. The largest is Strategy (MSTR); others tracked here are Metaplanet (Japan), Twenty One Capital (XXI), and Strive (ASST). Buying their shares is an indirect way to get bitcoin exposure through a regulated equity wrapper · with the catch that the stock can trade at a premium or discount to the bitcoin it actually holds." },
    { q: "What does mNAV mean for a treasury stock?", a: "mNAV (multiple of net asset value) is the company's market cap divided by the market value of its bitcoin holdings. mNAV = 1.0 means the stock is priced exactly at its bitcoin. Above 1.0 is a premium (you pay extra for the wrapper and future accumulation); below 1.0 is a discount (you get more than a dollar of bitcoin per dollar spent). Lower is cheaper." },
    { q: "Is the cheapest treasury always the best buy?", a: "Not necessarily. A low mNAV can reflect a genuine discount · or the market pricing in genuine risk (dilution, an unproven strategy, or a newer company). The cheapest by mNAV is the best bitcoin-per-dollar value at that instant, but you should weigh issuer quality, liquidity, and your account type. The Galaxy Mind /fit engine factors live mNAV into a full allocation. Not financial advice." },
    { q: "How is the ranking calculated?", a: "Each treasury's mNAV is computed live: market cap (Yahoo Finance) divided by bitcoin holdings (bitcointreasuries.net) times spot bitcoin (CoinGecko). The list sorts ascending by mNAV, so the cheapest is first. Refreshed every 5 minutes. Open methodology, reproducible from public data." },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", url: URL, name: "Cheapest Bitcoin Treasury Stock Right Now", description: "Live ranking of public Bitcoin treasury companies by mNAV · lowest is the biggest discount to bitcoin held.", isPartOf: { "@id": `${SITE_URL}/#website` }, provider: { "@id": `${SITE_URL}/#org` }, dateModified: snapshot.asOf },
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
          {" · Cheapest"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">Ranked by discount · live</div>
        <h1 className="display-title mb-4">Cheapest Bitcoin Treasury Right Now</h1>
        <section className="my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-6 sm:p-8">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">The short answer</div>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">{bluf}</p>
          <div className="mt-4 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)]">Updated {updated} · live</div>
        </section>
        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">Ranked cheapest to richest</h2>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-elevated-2)]/50">
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal">#</th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal">Company</th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">mNAV</th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal text-right">Eff. BTC price</th>
                  <th className="p-3 font-mono t-xs uppercase tracking-widest text-[var(--text-tertiary)] font-normal">Read</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((t, i) => {
                  const meta = TREASURY_META[t.ticker];
                  const interp = mNavInterpretation(t.mNAV);
                  const eff = t.mNAV != null && btcPrice != null ? btcPrice * t.mNAV : null;
                  const color = t.mNAV == null ? "var(--text-tertiary)" : t.mNAV < 1.0 ? "var(--cool-ink)" : t.mNAV < 1.05 ? "var(--text-primary)" : "var(--accent)";
                  return (
                    <tr key={t.ticker} className="border-t border-[var(--border-subtle)]">
                      <td className="p-3 font-mono text-sm text-[var(--text-tertiary)] tabular-nums">{i + 1}</td>
                      <td className="p-3">
                        <Link href={`/treasuries/${t.ticker}`} className="font-mono text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent-ink)] transition-colors">{t.ticker}</Link>
                        <span className="text-xs text-[var(--text-tertiary)] ml-2">{meta?.name} {meta ? COUNTRY_FLAG[meta.country] : ""}</span>
                      </td>
                      <td className="p-3 text-right font-mono text-sm tabular-nums font-semibold" style={{ color }}>{t.mNAV != null ? `${t.mNAV.toFixed(2)}x` : "·"}</td>
                      <td className="p-3 text-right font-mono text-sm text-[var(--text-secondary)] tabular-nums">{fmtUsd(eff)}</td>
                      <td className="p-3 text-xs text-[var(--text-tertiary)] font-sans">{interp.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 t-xs text-[var(--text-tertiary)] font-sans">mNAV = market cap divided by value of bitcoin held. Effective BTC price = spot times mNAV. Lower is cheaper. Refreshed every 5 minutes.</p>
        </section>
        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">Go deeper</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link href="/treasuries" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">$ /treasuries</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">The full live scoreboard</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">Sortable table, 90-day mNAV sparklines, SEC filings, and per-ticker detail pages.</div>
            </Link>
            <Link href="/mstr-vs-bitcoin" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">⚖ /mstr-vs-bitcoin</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">MSTR vs buying bitcoin directly</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">The head-to-head on effective bitcoin price, live.</div>
            </Link>
            <Link href="/fit" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">⊕ /fit</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">How much should I hold?</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">Live allocation engine · picks the cheapest treasury sleeve by mNAV automatically.</div>
            </Link>
            <Link href="/should-i-buy-bitcoin" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">₿ /should-i-buy-bitcoin</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">Should I buy bitcoin at all right now?</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">The live 0-100 buying gauge.</div>
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
