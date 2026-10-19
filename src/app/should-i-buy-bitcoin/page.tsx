// /should-i-buy-bitcoin · single-purpose SEO landing for the highest-
// volume Bitcoin search query.
//
// Why this exists as its own URL (vs just /stack):
// "Should I buy Bitcoin today?" is the top-3 Bitcoin search query
// globally. Google's algorithm rewards exact-match URL slugs for
// query-intent matching. /stack with its rebranded title ("Should I
// Buy Bitcoin Now? · Live Buying Gauge · Galaxy Mind") competes for
// the query but is at a disadvantage vs a URL that literally IS the
// question. This page is the SEO-optimized doorway · once visitors
// land here, the embedded live verdict drives them into /stack
// (where the full tool experience lives).
//
// Server-rendered for SEO:
//   - All copy + the live verdict reading render in first paint as
//     crawlable HTML, no JS-gated content
//   - FAQ schema with 8 questions hits multiple long-tail intents
//   - Inline CTA buttons drive to /stack (full tool), /fit (allocation
//     decision), /treasuries (alternative exposure), /float (supply
//     context)
//
// Audit 2026-05-28 created this page to capture an estimated HIGH-
// opportunity query that /stack alone couldn't fully claim.
// Growth 2026-09-23: quiet VendorHashrateModule after the next-step
// grid (which already links the spend directory) so buy-intent SERP
// visitors also see a live open-TH path onto paid USA ASIC rentals —
// same module as how-to-accept, help-grow, /v, online-stores, LATAM,
// /map, coffee, how-many, state-of, nostr-vendors, spend-and-replace.

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
import { VENDORS } from "@/lib/vendors";

const URL = "https://galaxymind.space/should-i-buy-bitcoin";
const SITE_URL = "https://galaxymind.space";

export const revalidate = 300;

export const metadata: Metadata = {
  // Title is the exact query · zero ambiguity. 60 chars under
  // Google's truncation edge with the brand suffix.
  title: "Should I Buy Bitcoin Today? · Live Verdict · Galaxy Mind",
  description:
    "Should I buy Bitcoin today? A live 10-signal verdict (MVRV, Mayer, Puell, funding, Fear & Greed, MSTR mNAV) gives a 0-100 score, updated daily. Free.",
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    url: URL,
    title: "Should I Buy Bitcoin Today? · Live 10-signal Verdict",
    description:
      "A free, open-methodology Bitcoin buying gauge updated daily. 0-100 score · STACK NOW / STACK HUGE / HOLD verdict.",
    siteName: "Galaxy Mind",
    images: pageOgImage("/should-i-buy-bitcoin/opengraph-image", "Should I Buy Bitcoin Today? · Live 10-signal Verdict"),
  },
  twitter: {
    card: "summary_large_image",
    title: "Should I Buy Bitcoin Today?",
    description: "Live 10-signal verdict updated daily. 0-100 score · open methodology.",
    creator: "@GalaxyMind",
  },
};

// FAQ schema captures the related "People Also Ask" cluster around
// the core query. Each question maps to either a direct answer or
// a pointer to the appropriate Galaxy Mind tool.
// Built per-request so the supply figure can come from /float rather than
// from prose (fixed 2026-07-25). This block previously hardcoded "~14.6M
// of 21M BTC are in active circulation" INSIDE the FAQPage answer while
// citing galaxymind.space/float as the source — live /float says ~6.1M in
// play, so our own structured data contradicted our own flagship dataset
// by 2.4x, and ~14.6M is actually the ILLIQUID cohort sum (the label was
// inverted). An answer engine quoting us got a wrong number with our name
// on it, which is the most expensive kind of error for a site whose whole
// pitch is being the trustworthy source.
function buildFaqSchema(supplySentence: string) {
  return {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      url: URL,
      name: "Should I Buy Bitcoin Today?",
      description:
        "Live Bitcoin buying verdict from a 10-signal weighted gauge. Updated daily. Open methodology, free.",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      provider: { "@id": `${SITE_URL}/#org` },
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Should I buy Bitcoin today?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The Galaxy Mind Bitcoin Buying Gauge gives a live 0-100 score updated daily. Above 65 the gauge tells you to STACK NOW (historically-attractive entry). Above 81 it tells you to STACK HUGE (rare extreme-opportunity zone). Below 40 it tells you to HOLD (wait for better entry). The score weighs 10 signals: MVRV ratio (16%), Mayer Multiple (14%), Puell Multiple (13%), perpetual funding rate (12%), Crypto Fear & Greed (10%), price vs 30-day MA (9%), 30-day realized volatility (7%), hour-of-day (7%), day-of-week (6%), and MSTR mNAV (6%). Full weights and methodology are public at galaxymind.space/llms.txt.",
          },
        },
        {
          "@type": "Question",
          name: "Is it a good time to buy Bitcoin?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Historically, the best Bitcoin entries align with extreme bearish sentiment (Fear & Greed below 30), miner capitulation (Puell Multiple below 0.5), MVRV below 1.0, price below the 200-day moving average, and negative perpetual funding. When multiple signals stack in the accumulation zone, the Galaxy Mind buying gauge reads above 65. That's the historical 'good time to buy' marker · though it does not eliminate downside risk and Bitcoin can lose substantial value.",
          },
        },
        {
          "@type": "Question",
          name: "How much Bitcoin should I buy?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Position sizing depends on three things: your time horizon, your risk tolerance, and your account type. The Galaxy Mind allocation engine at /fit takes those three inputs (1-30y horizon, Min-Ludicrous tolerance, Taxable/Traditional/Roth) and returns a sleeve mix of Bitcoin and Bitcoin-adjacent securities (BTC, MSBT, MSTR, MPJPY, XXI, ASST, STRC/F/D/K, SATA, MSTY) summing to 100%. It's mNAV-aware · rich treasury premiums auto-trim into pure spot. Educational, not financial advice.",
          },
        },
        {
          "@type": "Question",
          name: "Is Bitcoin a good investment in 2026?",
          acceptedAnswer: {
            "@type": "Answer",
            text: `Whether Bitcoin is a 'good investment' depends on your horizon and risk tolerance. Structurally: ${supplySentence} demand is absorbing several times new mining supply daily, and the next halving cuts new supply in half · the supply-demand math is live at galaxymind.space/float. Tactically: timing matters · use the live Bitcoin Buying Gauge at galaxymind.space/stack for the current 10-signal verdict. Not financial advice · Bitcoin can lose substantial value.`,
          },
        },
        {
          "@type": "Question",
          name: "How do I buy Bitcoin?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Spot Bitcoin can be bought via centralized exchanges (Coinbase, Kraken, Strike), Bitcoin-only platforms (Swan, River, Cash App), or spot Bitcoin ETFs in a brokerage account (IBIT 0.25%, FBTC 0.25%, MSBT 0.14% expense ratio). For self-custody, withdraw to a hardware wallet (Bitkey, Coldcard, Foundation Passport) and never share your seed phrase. For exposure WITHOUT directly holding BTC, public Bitcoin treasury companies (MSTR, XXI, MPJPY, ASST) trade as regular equities · see the live mNAV scoreboard at galaxymind.space/treasuries to find the one trading at the best discount-to-NAV right now.",
          },
        },
        {
          "@type": "Question",
          name: "What's the Bitcoin Buying Gauge?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The Bitcoin Buying Gauge is a single 0-100 score that maps 10 on-chain + market signals into a verdict. Above 65 = STACK NOW. Above 81 = STACK HUGE. Below 40 = HOLD. Open methodology · the weights and calculations are published in galaxymind.space/llms.txt and reproducible from public data. Free, no signup wall, no paywall. Built by Galaxy Mind · independent, single-operator project.",
          },
        },
        {
          "@type": "Question",
          name: "Is Bitcoin going to crash?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Bitcoin's price history includes multiple drawdowns of -50% or more, including 2018 (-84%), 2022 (-77%), and more shallow corrections in between. The Galaxy Mind buying gauge tries to identify accumulation zones, not predict tops · its 'STACK HUGE' (>81) readings have historically coincided with cycle lows, but past performance does not guarantee future results. If you cannot tolerate a 50-80% drawdown, your position size is probably too large. Use the /fit allocation engine to find a sleeve mix that matches your actual risk tolerance.",
          },
        },
        {
          "@type": "Question",
          name: "Should I dollar-cost average into Bitcoin?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Dollar-cost averaging (DCA) eliminates timing risk by spreading purchases over time at fixed dollar intervals. It's historically a strong strategy for Bitcoin given the asset's volatility · the DCA calculator on galaxymind.space/stack lets you backtest a chosen DCA schedule against actual Bitcoin price history. For accumulators who want to TILT the DCA based on market conditions, use the gauge reading: when the gauge is above 81 (STACK HUGE), front-load your DCA; when below 40 (HOLD), throttle back or pause.",
          },
        },
      ],
    },
  ],
  };
}

export default async function ShouldIBuyBitcoinPage() {
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  // Fetch live snapshot + compute the verdict server-side so the
  // page renders the current reading in first paint · crawlable as
  // HTML, no JS gating. ISR re-renders every 5min via the route's
  // revalidate=300.
  const [snapshot, float] = await Promise.all([
    getMarketSnapshot(),
    getFloatData({ days: 2, synthetic: false }),
  ]);
  const verdict = computeStackVerdict(snapshot);

  // Supply prose derived from /float (see buildFaqSchema's note). Used by
  // BOTH the FAQPage JSON-LD and the visible "Live reservoir" line, so
  // the page and its structured data can never disagree.
  const floatOk = !float.isFallback;
  const inPlayM = (float.current.inPlay / 1e6).toFixed(1);
  const supplySentence = floatOk
    ? `of 21M BTC only about ${inPlayM}M is realistically in play once lost coins, government stashes, ETF baskets and corporate treasuries are subtracted,`
    : `of 21M BTC only a fraction is realistically in play once lost coins, government stashes, ETF baskets and corporate treasuries are subtracted,`;
  const FAQ_SCHEMA = buildFaqSchema(supplySentence);

  // HONESTY CONTRACT (fixed 2026-07-25).
  //
  // computeStackVerdict's documented all-null fallback is score=50 /
  // tier=WARM (see the /stack engine invariants). That is a PLACEHOLDER,
  // not a reading — but this page labelled it "Today's Bitcoin Buying
  // Gauge" and "answered live", so a multi-day upstream outage published
  // a confident, made-up 50/100 WARM verdict on the page whose entire
  // pitch is that the number is real. /today, /float, /fit, /status and
  // every /api surface already gate on this; these capture pages were
  // the ones that missed it. Same treatment as /today: show the banner
  // and suppress the number rather than print a fabricated one.
  const degraded = isMarketSnapshotDegraded(snapshot);

  // Freshness stamp (2026-07-25). The page's own eyebrow says "answered
  // live" and its metadata says "updated daily", but the verdict box
  // carried no date — so a reader (or an AI weighing two sources) had no
  // way to tell whether the number was minutes or months old. Every other
  // question-shaped pSEO page already renders this. Shown only on the
  // live branch: dating the degraded "—" would timestamp a non-reading.
  const updated = new Date(snapshot.asOf).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  // Translate the tier to a verdict label · mirrors PressureGauge's
  // own mapping. We keep this inline rather than importing because
  // PressureGauge is a 2820-line client component and we don't need
  // any of its physics / SVG / Canvas surface here.
  const verdictLabel = TIER_VERDICT[verdict.tier] ?? verdict.tier;
  const tierColor =
    verdict.score >= 81
      ? "var(--accent)"
      : verdict.score >= 65
        ? "var(--accent)"
        : verdict.score >= 41
          ? "var(--text-primary)"
          : "var(--cool-ink)";

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(FAQ_SCHEMA) }}
      />
      <SiteHeader />

      <article className="mx-auto max-w-3xl px-4 sm:px-6 pt-10 pb-16">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          The buying question · answered live
        </div>
        <h1 className="display-title mb-4">
          Should I Buy Bitcoin Today?
        </h1>

        <BtcSpotPriceHero
          price={snapshot.btcPrice}
          delta24h={deriveBtc24hDelta(snapshot.btcPrice, snapshot.hourlyCloses)}
          size="md"
          label="BTC SPOT · LIVE"
        />

        {/* LIVE VERDICT BLOCK · the answer the visitor came for, in
            their first 3 seconds on the page. Big number, plain
            language. Click drives to /stack for the full breakdown. */}
        <section className="my-8 rounded-2xl border-2 border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-8 text-center pulse-border">
          <div className="micro-label text-[var(--text-tertiary)] mb-3">
            Today&apos;s Bitcoin Buying Gauge
          </div>
          {degraded ? (
            // Degraded · say so instead of printing the WARM-50 fallback
            // as if it were today's reading. The CTA still works: /stack
            // carries the full breakdown and its own honesty banner.
            <>
              <div className="flex items-baseline justify-center gap-4 mb-3">
                <span className="font-mono text-6xl sm:text-7xl font-bold tabular-nums leading-none text-[var(--text-tertiary)]">
                  —
                </span>
                <span className="text-2xl text-[var(--text-tertiary)] font-mono">
                  / 100
                </span>
              </div>
              <DataStatusBanner degraded />
              <p className="mt-3 font-mono t-xs text-[var(--text-tertiary)]">
                <Link
                  href="/status"
                  className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                >
                  System status →
                </Link>
              </p>
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-center gap-4 mb-3">
                <span
                  className="font-mono text-6xl sm:text-7xl font-bold tabular-nums leading-none"
                  style={{ color: tierColor }}
                >
                  {verdict.score}
                </span>
                <span className="text-2xl text-[var(--text-tertiary)] font-mono">
                  / 100
                </span>
              </div>
              <div
                className="font-mono text-xl sm:text-2xl uppercase tracking-[0.3em] font-bold mb-2"
                style={{ color: tierColor }}
              >
                {verdictLabel}
              </div>
              <div className="font-mono text-sm text-[var(--text-tertiary)] uppercase tracking-widest">
                {TIER_LABEL[verdict.tier]} tier · updated {updated}
              </div>
            </>
          )}

          <Link
            href="/stack"
            className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-md bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] transition-colors lit-primary"
          >
            See the full 10-signal breakdown →
          </Link>
        </section>

        {/* PROSE EXPLAINER · keyword-dense for SEO without being
            spammy. Targets supporting queries like "is it a good
            time to buy bitcoin", "bitcoin entry signal", etc. */}
        <section className="mb-8 prose-section">
          <h2 className="text-2xl font-semibold tracking-tight mb-4 mt-8">
            How the verdict works
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed font-sans mb-4">
            The Bitcoin Buying Gauge is a single 0-100 score driven by 10
            weighted signals · MVRV ratio (16%), Mayer Multiple (14%),
            Puell Multiple (13%), perpetual funding rate (12%), Crypto
            Fear &amp; Greed (10%), price vs 30-day moving average (9%),
            30-day realized volatility (7%), hour-of-day (7%), day-of-week
            (6%), and MSTR mNAV (6%). Each signal is normalized 0-100
            against its historical distribution.
          </p>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed font-sans mb-4">
            Above 65, the gauge says <strong className="text-[var(--accent-ink)]">STACK NOW</strong>.
            Above 81, <strong className="text-[var(--accent-ink)]">STACK HUGE</strong>.
            Below 40, <strong className="text-[var(--cool-ink)]">HOLD</strong>. The
            weights are published in{" "}
            <a
              href="https://galaxymind.space/llms.txt"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] underline-offset-4"
            >
              llms.txt
            </a>{" "}
            and reproducible from public data. No paywall, no signup, no
            tracking pixels beyond Vercel Analytics.
          </p>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed font-sans">
            This is educational, not financial advice. Bitcoin can lose
            substantial value · the gauge tries to identify historically
            attractive accumulation zones, not predict tops or eliminate
            risk. Consult a licensed advisor before making material
            financial decisions.
          </p>
        </section>

        {/* NEXT-STEP NAVIGATION · clear routes into the deeper tools.
            Each tool answers a follow-up question the visitor might
            naturally have after the verdict. */}
        <section className="mb-8 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">
            Once you know the verdict
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/fit"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ⊕ /fit
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                How much Bitcoin should I own?
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Live allocation engine · pick horizon, tolerance, account
                type. Returns a sleeve mix of BTC, MSTR, treasury equities,
                and yield instruments summing to 100%.
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
                Which Bitcoin treasury is cheapest?
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Live mNAV scoreboard · MSTR, XXI, MPJPY, ASST. The cheapest
                treasury at any moment can be a better entry than spot BTC
                if you want operating leverage.
              </div>
            </Link>
            <Link
              href="/float"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ⌬ /float
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                How much Bitcoin is left to buy?
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Live reservoir ·{" "}
                {floatOk ? `~${inPlayM}M of 21M BTC still in play` : "the in-play float"},
                draining faster than mining replaces it. The supply-demand
                math context behind today&apos;s verdict.
              </div>
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="font-mono t-xs uppercase tracking-[0.25em] text-[var(--accent-ink)] mb-2">
                ₿ /
              </div>
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-2">
                Where can I spend Bitcoin?
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Human-curated directory of {VENDORS.length}+ Bitcoin merchants across
                X, Nostr, and Lightning. Vendors selling everyday goods for
                BTC · the other half of the buying decision.
              </div>
            </Link>
          </div>
        </section>

        {/* Quiet hashrate CTA · after the spend-directory card in the
            next-step grid, before the habit strip. Buy-intent visitors
            who just saw "Where can I spend Bitcoin?" get a SERVICE-
            language path onto live open-TH rentals without a homepage
            hero. */}
        <VendorHashrateModule className="mb-10" />

        <HabitCaptureStrip eyebrow="Don't decide only once" />

        {/* FAQ · renders both as HTML and as JSON-LD FAQPage schema
            above. Captures related "People Also Ask" queries Google
            displays alongside the main result. */}
        <section className="border-t border-[var(--border-subtle)] pt-12 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">
            Frequently asked
          </h2>
          <div className="space-y-6">
            {FAQ_SCHEMA["@graph"][1].mainEntity!.map((q) => (
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
