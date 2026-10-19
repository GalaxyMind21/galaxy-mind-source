// /is-it-too-late-to-buy-bitcoin · reassurance-query landing. High-volume
// query whose SERP is entirely generic prose; Galaxy Mind's live 0-100
// gauge is a far better answer object. Year-stamped doorway into /stack
// + /float. Server-rendered, ISR revalidate=300, FAQPage. Built 2026-05-30.
// Growth 2026-09-24: quiet VendorHashrateModule after the data grid so
// the same buy-intent visitors as /should-i-buy-bitcoin see a live
// open-TH path onto paid USA ASIC rentals.
import type { Metadata } from "next";
import { pageOgImage } from "@/lib/og";
import { headers } from "next/headers";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { HabitCaptureStrip } from "@/components/HabitCaptureStrip";
import { VendorHashrateModule } from "@/components/VendorHashrateModule";
import { safeJsonLd } from "@/lib/json-ld";
import { getMarketSnapshot } from "@/lib/market";
import { getFloatData } from "@/lib/float-data";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";
import { DataStatusBanner } from "@/components/DataStatusBanner";
import { computeStackVerdict, TIER_LABEL } from "@/lib/stack";
import { TIER_VERDICT } from "@/lib/tier";
import { BtcSpotPriceHero, deriveBtc24hDelta } from "@/components/BtcSpotPriceHero";

const URL = "https://galaxymind.space/is-it-too-late-to-buy-bitcoin";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 300;
const YEAR = new Date().getUTCFullYear();

export const metadata: Metadata = {
  title: `Is It Too Late to Buy Bitcoin in ${YEAR}? · Live Answer · Galaxy Mind`,
  description: `Is it too late to buy Bitcoin in ${YEAR}? No, and here is why: a live 0-100 gauge of 10 market signals plus 21M supply-scarcity math answers with data.`,
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    url: URL,
    title: `Is It Too Late to Buy Bitcoin in ${YEAR}?`,
    description: "A live answer built from supply-scarcity math and a 10-signal buying gauge. Updated daily.",
    siteName: "Galaxy Mind",
    images: pageOgImage("/is-it-too-late-to-buy-bitcoin/opengraph-image", `Is It Too Late to Buy Bitcoin in ${YEAR}?`),
  },
  twitter: {
    card: "summary_large_image",
    title: `Is It Too Late to Buy Bitcoin in ${YEAR}?`,
    description: "A live 0-100 buying gauge plus supply-scarcity math gives the question a measurable answer.",
    creator: "@GalaxyMind",
  },
};

export default async function IsItTooLatePage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const [snapshot, float] = await Promise.all([
    getMarketSnapshot(),
    // 2 rows is enough · we only need the latest cohort split.
    getFloatData({ days: 2, synthetic: false }),
  ]);
  const verdict = computeStackVerdict(snapshot);

  // SUPPLY FIGURES COME FROM /float, NOT FROM PROSE (fixed 2026-07-25).
  //
  // This page hardcoded "roughly 14-15 million are realistically in
  // circulation" and "About 1.3 million BTC remain to be mined", and both
  // strings feed FAQ[] -> the FAQPage JSON-LD below while CITING
  // galaxymind.space/float as the source. Live /float says ~6.1M in play
  // and ~0.94M left to mine — so the structured data contradicted our own
  // flagship dataset by 2.4x. Worse, ~14.6M is approximately the sum of
  // the ILLIQUID cohorts (lost + long-term holders + treasuries + ETFs),
  // so "in active circulation" was inverted, not merely stale.
  //
  // An AI answer engine quoting us was being handed a wrong number with
  // our name on it. Derive from the same source the citation names.
  const floatOk = !float.isFallback;
  const inPlayM = (float.current.inPlay / 1e6).toFixed(1);
  const yetToMineK = Math.round(float.current.cohorts.yetToMine / 1000);
  const supplyClause = floatOk
    ? `only about ${inPlayM}M is realistically buyable today once lost coins, government stashes, ETF baskets and corporate treasuries are subtracted`
    : `only a fraction of it is realistically buyable once lost coins, government stashes, ETF baskets and corporate treasuries are subtracted`;
  const verdictLabel = TIER_VERDICT[verdict.tier] ?? verdict.tier;
  const tierColor = verdict.score >= 65 ? "var(--accent)" : verdict.score >= 41 ? "var(--text-primary)" : "var(--cool-ink)";

  // HONESTY CONTRACT (fixed 2026-07-25).
  //
  // computeStackVerdict's documented all-null fallback is score=50 /
  // tier=WARM. This page did not gate on that, so a multi-day upstream
  // outage published a fabricated reading in the WORST place: `bluf`
  // below is interpolated into FAQ[0].a, which is baked into the
  // FAQPage JSON-LD at the bottom of this function — so Google would
  // ingest a machine-readable claim that "the gauge currently reads
  // 50/100 (WARM)" while nothing was actually being measured. The
  // degraded variant asserts no number at all (the structural
  // supply argument is true regardless and stands on its own).
  const degraded = isMarketSnapshotDegraded(snapshot);

  const bluf = degraded
    ? `Short answer: no, and the data says why. "Too late" assumes the opportunity is gone, but bitcoin's supply is fixed at 21 million and ${supplyClause}, with new supply cut in half every four years. The question worth asking is whether right now is a good entry. Our live 10-signal gauge measures exactly that; several of its market feeds are unavailable right now, so see galaxymind.space/stack for the current reading rather than a number quoted here.`
    : `Short answer: no, and the data says why. The Galaxy Mind buying gauge currently reads ${verdict.score}/100 (${verdictLabel}) · a live composite of 10 market signals. "Too late" assumes the opportunity is gone, but bitcoin's supply is fixed at 21 million and ${supplyClause}, with new supply cut in half every four years. The question worth asking is whether right now is a good entry, and that is exactly what the live gauge measures. As of ${YEAR}, the gauge says ${verdictLabel}.`;

  const FAQ = [
    { q: `Is it too late to buy Bitcoin in ${YEAR}?`, a: `${bluf} Historically, every "it's too late" moment has been followed by both higher highs and deep drawdowns · so timing matters more than the calendar. Use the live gauge at galaxymind.space/stack for the current read. Not financial advice; bitcoin can lose substantial value.` },
    { q: "Has Bitcoin already peaked?", a: "Bitcoin has made and broken many 'final' peaks · 2013, 2017, 2021 each looked like the top at the time, then were exceeded. Nobody can know if any given price is the peak. What you can measure is whether current conditions resemble historically attractive entries (fear, compressed valuations, miner capitulation) or euphoric tops. The Galaxy Mind gauge scores exactly that, 0-100, updated daily." },
    // The number IS the answer here · derived live from /float, the page
    // this answer cites (see the SUPPLY FIGURES note above).
    { q: "How much Bitcoin is left to buy?", a: floatOk
      ? `About ${yetToMineK}k BTC remain to be mined (out of 21 million), but that overstates availability · a large share of existing supply is lost, held by governments, locked in ETFs, or on corporate treasuries. Only about ${inPlayM}M is realistically in play today, and it is shrinking as demand absorbs several times the new daily mining supply. See the live supply visualization at galaxymind.space/float.`
      : "Less than a million BTC remain to be mined (out of 21 million), and that overstates availability · a large share of existing supply is lost, held by governments, locked in ETFs, or on corporate treasuries. The realistically buyable float is far smaller and shrinking as demand absorbs several times the new daily mining supply. See the live supply visualization at galaxymind.space/float for the current figure." },
    { q: "Should I wait for a dip or buy now?", a: "Timing the exact bottom is nearly impossible. Two disciplined approaches: dollar-cost average (buy a fixed amount on a schedule regardless of price), or tilt your buying using a signal · buy more when the gauge is high (historically attractive) and less when it is low. The /stack page shows the live gauge and a DCA backtester. Not financial advice." },
    { q: "How is the buying gauge calculated?", a: "The gauge maps 10 weighted signals into a single 0-100 score: MVRV ratio, Mayer Multiple, Puell Multiple, perpetual funding rate, Crypto Fear & Greed, price vs 30-day moving average, 30-day realized volatility, hour-of-day, day-of-week, and MSTR mNAV. Above 65 historically marks attractive accumulation zones; below 40 marks caution. Open methodology, reproducible from public data." },
  ];

  const JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", url: URL, name: `Is It Too Late to Buy Bitcoin in ${YEAR}?`, description: "A live, data-driven answer from a 10-signal buying gauge plus bitcoin supply-scarcity context.", isPartOf: { "@id": `${SITE_URL}/#website` }, provider: { "@id": `${SITE_URL}/#org` }, dateModified: snapshot.asOf },
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
          {" · Is it too late?"}
        </nav>
        <div className="micro-label text-[var(--text-tertiary)] mb-3">The fear · answered with data</div>
        <h1 className="display-title mb-4">Is It Too Late to Buy Bitcoin in {YEAR}?</h1>
        <BtcSpotPriceHero price={snapshot.btcPrice} delta24h={deriveBtc24hDelta(snapshot.btcPrice, snapshot.hourlyCloses)} size="md" label="BTC SPOT · LIVE" />
        <section className="my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-8 text-center pulse-border">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">Today&apos;s Bitcoin Buying Gauge</div>
          {degraded ? (
            <>
              <div className="flex items-baseline justify-center gap-4 mb-3">
                <span className="font-mono text-6xl sm:text-7xl font-bold tabular-nums leading-none text-[var(--text-tertiary)]">—</span>
                <span className="text-2xl text-[var(--text-tertiary)] font-mono">/ 100</span>
              </div>
              <DataStatusBanner degraded />
              <p className="mt-3 font-mono t-xs text-[var(--text-tertiary)]">
                <Link href="/status" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">System status →</Link>
              </p>
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-center gap-4 mb-3">
                <span className="font-mono text-6xl sm:text-7xl font-bold tabular-nums leading-none" style={{ color: tierColor }}>{verdict.score}</span>
                <span className="text-2xl text-[var(--text-tertiary)] font-mono">/ 100</span>
              </div>
              <div className="font-mono text-xl sm:text-2xl uppercase tracking-[0.3em] font-bold mb-2" style={{ color: tierColor }}>{verdictLabel}</div>
              <div className="font-mono text-sm text-[var(--text-tertiary)] uppercase tracking-widest">{TIER_LABEL[verdict.tier]} tier · updated {updated}</div>
            </>
          )}
          <Link href="/stack" className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-md bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] transition-colors lit-primary">See the full 10-signal breakdown →</Link>
        </section>
        <section className="mb-10">
          <h2 className="text-2xl font-semibold tracking-tight mb-4">The short answer</h2>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed font-sans">{bluf}</p>
        </section>
        <section className="mb-10 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">What the data says right now</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link href="/stack" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">◷ /stack</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">The live buying gauge</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">10 signals on one dial + a DCA backtester. Is right now a good entry?</div>
            </Link>
            <Link href="/float" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">⌬ /float</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">How much bitcoin is left to buy?</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">The live supply clock · the scarcity math behind "too late."</div>
            </Link>
            <Link href="/fit" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">⊕ /fit</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">How much should I own?</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">Position sizing by horizon, risk tolerance, and account type.</div>
            </Link>
            <Link href="/should-i-buy-bitcoin" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group">
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">₿ /should-i-buy-bitcoin</div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">Should I buy Bitcoin today?</div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">The same verdict, framed for the buying decision.</div>
            </Link>
          </div>
        </section>
        {/* Quiet hashrate CTA · after the data grid, before the habit
            strip. Same module as /should-i-buy-bitcoin. */}
        <VendorHashrateModule className="mb-10" />
        <HabitCaptureStrip eyebrow="Scarcity updates daily" />
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
