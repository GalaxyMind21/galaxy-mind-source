// /treasuries/[ticker] · per-treasury SEO landing pages
//
// Why this exists: the audit (2026-05-25) found that competitors like
// Newhedge use per-company URLs (/bitcoin/treasuries/{ticker}) that
// rank well for ticker-specific queries ("MSTR mNAV", "twenty one
// capital bitcoin", "metaplanet mNAV"). The umbrella /treasuries page
// alone can't compete on those queries because Google sees no
// dedicated content for each ticker.
//
// Architecture:
//   - generateStaticParams returns the 4 tracked tickers (MSTR / XXI /
//     MPJPY / ASST) so all 4 pages prerender at build time
//   - generateMetadata produces per-ticker title + description + OG
//     for query-intent matching
//   - Page body: hero stats, blurb, sparkline, peer-comparison row,
//     SEC filings (US-listed only), FAQ specific to this treasury,
//     internal links back to /treasuries + /stack + /fit
//   - JSON-LD: WebApplication + Dataset (single-ticker scope) +
//     FAQPage with ticker-specific questions
//
// generateStaticParams + revalidate=300 means each page prerenders
// once per 5 minutes against fresh upstream data, matching the
// /treasuries umbrella's cadence. ISR keeps the per-ticker pages
// fresh without blowing up the build matrix.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { safeJsonLd, buildBreadcrumb } from "@/lib/json-ld";
import { fetchDailyCloses, getMarketSnapshot } from "@/lib/market";
import { TREASURY_META, COUNTRY_FLAG, mNavInterpretation } from "@/lib/treasuries";
import { computeCebe, SENIOR_CLAIMS } from "@/lib/cebe";
import { SHARE_COUNTS, SHARE_BASIS_CORRECTED_ON } from "@/lib/treasury-shares";
import { computeBtcYield } from "@/lib/btc-yield";
import { kvList } from "@/lib/kv";
import type { Ticker } from "@/lib/market";
import { MNavSparkline, deriveMNavHistory } from "../components/MNavSparkline";
import { SECFilingsPanel } from "../components/SECFilingsPanel";
import { GlossaryTerm } from "@/components/GlossaryTerm";
import { OG_TREASURY } from "@/lib/og";
import {
  BtcSpotPriceHero,
  deriveBtc24hDelta,
} from "@/components/BtcSpotPriceHero";

export const revalidate = 300;

const SITE_URL = "https://galaxymind.space";
const VALID_TICKERS: Ticker[] = ["MSTR", "XXI", "MPJPY", "ASST"];

// Prerender all 4 ticker pages at build time. ISR re-renders each on
// revalidate=300 (5 min) when upstream data changes.
export function generateStaticParams() {
  return VALID_TICKERS.map((ticker) => ({ ticker }));
}

type RouteParams = { params: Promise<{ ticker: string }> };

// Per-ticker SEO copy. Title leads with ticker + name + "Bitcoin
// treasury" because that's the exact query intent. Description packs
// mNAV mention + BTC holdings descriptor for snippet density.
const TICKER_META: Record<Ticker, { title: string; description: string }> = {
  MSTR: {
    title:
      "MSTR (Strategy) Bitcoin Treasury · Galaxy Mind",
    description:
      "Live MSTR mNAV, bitcoin holdings, and accretion context for Strategy, the largest public Bitcoin treasury company. Compare against spot and peer treasuries.",
  },
  XXI: {
    title:
      "XXI (Twenty One Capital) Bitcoin Treasury · Galaxy Mind",
    description:
      "Live XXI mNAV and CEBE net-of-claims analysis for Twenty One Capital, the Tether-controlled bitcoin treasury led by Jack Mallers. Compare vs MSTR.",
  },
  MPJPY: {
    title:
      "MPJPY (Metaplanet) Bitcoin Treasury · Galaxy Mind",
    description:
      "Live MPJPY mNAV, bitcoin holdings, and premium analysis for Metaplanet, Japan's most aggressive public bitcoin treasury. Often the richest premium of the four.",
  },
  ASST: {
    title:
      "ASST mNAV · Strive Bitcoin Treasury Tracker · Galaxy Mind",
    description:
      "Live ASST mNAV for Strive Inc. Bitcoin holdings, premium, and comparison vs MSTR, XXI, and Metaplanet on one scoreboard.",
  },
};

// Enriched per-ticker profile · the longer narrative + key facts that
// go beyond the one-line hero blurb. Leadership / listing / capital
// model are the facts a visitor researching a treasury actually wants.
// Reviewed alongside TREASURY_META + the CEBE senior-claims constants.
const TICKER_ABOUT: Record<
  Ticker,
  { lead: string; facts: { label: string; value: string }[] }
> = {
  MSTR: {
    lead: "Strategy (formerly MicroStrategy) invented the modern bitcoin-treasury playbook in August 2020 and remains the largest public holder by a wide margin. It raises capital through convertible notes and a deep preferred-stock stack (STRC, STRF, STRK, STRD) and turns the proceeds into BTC, aiming to grow bitcoin-per-share over time. That leverage is the whole thesis: accretive while the premium holds, painful when it compresses · which is exactly why the gross and net (CEBE) mNAV diverge so sharply here.",
    facts: [
      { label: "Leadership", value: "Michael Saylor · Exec. Chairman" },
      { label: "Listing", value: "Nasdaq · MSTR" },
      { label: "Capital model", value: "Convertibles + preferred stack" },
    ],
  },
  XXI: {
    lead: "Twenty One Capital is a bitcoin-native treasury built from inception to maximize bitcoin-per-share, led by Strike founder Jack Mallers. It listed via the Cantor Equity Partners SPAC and is now majority-controlled by Tether, which bought out SoftBank's founding stake for $711M in May 2026. Funding is primarily convertible notes plus equity, with no preferred stack · so its senior claims are lighter than Strategy's.",
    facts: [
      { label: "Leadership", value: "Jack Mallers · CEO, Strike founder" },
      { label: "Listing", value: "NYSE · XXI" },
      { label: "Backers", value: "Tether (control) + Cantor" },
    ],
  },
  MPJPY: {
    lead: "Metaplanet is Japan's largest corporate bitcoin holder, having pivoted from hospitality into relentless BTC accumulation. It funds purchases through a long series of zero-coupon bonds and a new perpetual-preferred stack (the MERCURY series, with a senior MARS series planned). MPJPY is the US-sponsored ADR; the common trades in Tokyo as 3350.T.",
    facts: [
      { label: "Leadership", value: "Simon Gerovich · CEO" },
      { label: "Listing", value: "Tokyo 3350.T · US ADR MPJPY" },
      { label: "Capital model", value: "Zero-coupon bonds + perpetual preferred" },
    ],
  },
  ASST: {
    lead: "Strive is Vivek Ramaswamy's asset manager turned bitcoin treasury, listed through the Asset Entities reverse merger and expanded via the Semler Scientific acquisition. It runs debt-free, funding its bitcoin stack through the 13% SATA perpetual preferred, and operates its anti-ESG investment products alongside the treasury thesis.",
    facts: [
      { label: "Leadership", value: "Matt Cole · CEO · Vivek Ramaswamy · Chair" },
      { label: "Listing", value: "Nasdaq · ASST" },
      { label: "Capital model", value: "Debt-free · SATA perpetual preferred" },
    ],
  },
};

export async function generateMetadata({
  params,
}: RouteParams): Promise<Metadata> {
  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase() as Ticker;
  if (!VALID_TICKERS.includes(ticker)) return {};
  const meta = TICKER_META[ticker];
  const url = `${SITE_URL}/treasuries/${ticker}`;
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: url },
    openGraph: {
    images: OG_TREASURY,
      type: "website",
      url,
      title: meta.title,
      description: meta.description,
      siteName: "Galaxy Mind",
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      creator: "@GalaxyMind",
    },
  };
}

export default async function TickerPage({ params }: RouteParams) {
  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase() as Ticker;
  if (!VALID_TICKERS.includes(ticker)) notFound();

  const meta = TREASURY_META[ticker];
  const snapshot = await getMarketSnapshot();
  const row = snapshot.treasuries.find((t) => t.ticker === ticker);
  const peers = snapshot.treasuries.filter((t) => t.ticker !== ticker);

  // Per-ticker mNAV sparkline data (90 daily samples). Falls back to
  // null gracefully when upstream stock fetch fails or snapshot is
  // partial · the sparkline component renders an "accumulating"
  // placeholder in that case.
  const stockHistory = await fetchDailyCloses(ticker, 90);
  const btcDaily = (() => {
    const closes = snapshot.hourlyCloses;
    const timestamps = snapshot.hourlyTimestamps;
    if (!closes || !timestamps || closes.length < 90) return null;
    const seen = new Set<string>();
    const out: number[] = [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const ts = timestamps[i];
      if (!Number.isFinite(ts) || !Number.isFinite(closes[i])) continue;
      const date = new Date(ts * 1000).toISOString().slice(0, 10);
      if (seen.has(date)) continue;
      seen.add(date);
      out.unshift(closes[i]);
      if (out.length >= 90) break;
    }
    return out.length >= 2 ? out : null;
  })();
  const mNavHistory = deriveMNavHistory(
    stockHistory,
    btcDaily,
    row?.marketCapM ?? null,
    row?.price ?? null,
    row?.btcHoldings ?? null,
  );

  const interp = mNavInterpretation(row?.mNAV ?? null);

  // BTC Yield · growth in gross BPS (bitcoin per share) from our daily
  // KV snapshots. For the override names (ASST, MPJPY) we ignore
  // snapshots before the share-basis correction so the one-time step
  // isn't misread as yield · null (accumulating) until clean post-fix
  // history exists. Dev KV is a no-op, so this is empty locally.
  const yieldHist = (
    await kvList<{
      date: string;
      btcHoldings: number | null;
      marketCapM: number | null;
    }>(`treasury:history:${ticker}`, 120)
  ).reverse(); // oldest-first
  const btcYield30 = computeBtcYield(yieldHist, 30, {
    notBeforeDate: SHARE_COUNTS[ticker] ? SHARE_BASIS_CORRECTED_ON : undefined,
  });

  // CEBE · net-of-senior-claims mNAV. Pending (cebe.available=false) for
  // tickers whose debt/preferred figures aren't sourced yet. `claimsLine`
  // renders the senior-claims breakdown from the SENIOR_CLAIMS constants.
  const cebe = row ? computeCebe(row, snapshot.btcPrice) : null;
  const sc = SENIOR_CLAIMS[ticker];
  const fmtClaimM = (m: number) =>
    m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${Math.round(m)}M`;
  const claimsLine = sc
    ? `${fmtClaimM(sc.debtUsdM)} debt + ${fmtClaimM(sc.preferredUsdM)} preferred${
        sc.cashUsdM ? ` − ${fmtClaimM(sc.cashUsdM)} cash` : ""
      }`
    : "";
  const about = TICKER_ABOUT[ticker];

  // FAQ items · hoisted out of the @graph literal (2026-07-29). The
  // page used to render these by indexing the graph positionally
  // (`FAQ_SCHEMA["@graph"][1].mainEntity`), which meant adding ANY node
  // to the graph silently changed what the FAQ section rendered — and
  // in TypeScript it broke the build outright when a third node made
  // the array's element type a union. One named const now feeds both
  // the schema and the visible section, so they cannot disagree and the
  // graph can grow freely.
  const FAQ_ITEMS: {
    "@type": "Question";
    name: string;
    acceptedAnswer: { "@type": "Answer"; text: string };
  }[] = [
          {
            "@type": "Question",
            name: `What is ${ticker} (${meta.name})?`,
            acceptedAnswer: {
              "@type": "Answer",
              text: `${meta.blurb} ${ticker} is one of the four major public Bitcoin treasury companies tracked on Galaxy Mind alongside MSTR (Strategy), XXI (Twenty One Capital), MPJPY (Metaplanet), and ASST (Strive). See the live mNAV scoreboard at galaxymind.space/treasuries.`,
            },
          },
          {
            "@type": "Question",
            name: `What is ${ticker}'s current mNAV?`,
            acceptedAnswer: {
              "@type": "Answer",
              text: row?.mNAV != null
                ? `${ticker}'s mNAV (market cap divided by the value of its bitcoin holdings) is currently ${row.mNAV.toFixed(2)}x. ${interp.detail} See live updates and 90-day history at galaxymind.space/treasuries/${ticker}.`
                : `${ticker}'s live mNAV is published at galaxymind.space/treasuries/${ticker} and updates every 5 minutes. mNAV is the company's market cap divided by the value of its bitcoin holdings · below 1.0x means the stock trades for less than the bitcoin it holds.`,
            },
          },
          {
            "@type": "Question",
            name: `What is ${ticker}'s net (CEBE) mNAV?`,
            acceptedAnswer: {
              "@type": "Answer",
              text:
                cebe?.available && cebe.netMNav != null
                  ? `${ticker}'s CEBE-adjusted net mNAV is ${cebe.netMNav.toFixed(2)}x · market cap divided by the bitcoin left for common shareholders after senior claims (${claimsLine}), which run ${cebe.claimsPct != null ? (cebe.claimsPct * 100).toFixed(0) : "—"}% of its BTC value. The gross mNAV${row?.mNAV != null ? ` (${row.mNAV.toFixed(2)}x)` : ""} ignores those claims · CEBE (Common Equity Bitcoin Exposure) is the conservative, net-of-leverage view. See galaxymind.space/treasuries/${ticker}.`
                  : `${ticker}'s CEBE (net-of-senior-claims) mNAV is pending · its debt and preferred figures aren't reliably sourced yet, so Galaxy Mind publishes the gross mNAV rather than a guess. Track it at galaxymind.space/treasuries/${ticker}.`,
            },
          },
          {
            "@type": "Question",
            name: `Is ${ticker} a good Bitcoin investment?`,
            acceptedAnswer: {
              "@type": "Answer",
              text: `Whether ${ticker} is a good investment depends on its current mNAV (premium or discount to its bitcoin holdings), your time horizon, and your account type (Taxable / Traditional / Roth). The Galaxy Mind allocation engine at /fit factors mNAV explicitly · when ${ticker === "MSTR" ? "MSTR" : "treasury"} mNAV is rich (≥1.6x) it auto-trims the sleeve in favor of pure-spot Bitcoin (BTC or IBIT/MSBT). Not financial advice.`,
            },
          },
          {
            "@type": "Question",
            name: `How many Bitcoin does ${ticker} hold?`,
            acceptedAnswer: {
              "@type": "Answer",
              text: row?.btcHoldings != null
                ? `${ticker} (${meta.name}) currently holds ${row.btcHoldings.toLocaleString()} BTC on its balance sheet. Data sourced from bitcointreasuries.net, updated every 5 minutes. View the full per-treasury comparison at galaxymind.space/treasuries.`
                : `${ticker}'s live bitcoin holdings are published at galaxymind.space/treasuries/${ticker}, updated every 5 minutes from bitcointreasuries.net.`,
            },
          },
        ];

  // FAQ schema · per-ticker questions chosen from "People Also Ask"
  // patterns for ticker-specific Bitcoin queries.
  const FAQ_SCHEMA = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": ["WebApplication", "FinanceApplication"],
        name: `${ticker} Bitcoin Treasury · Live mNAV`,
        url: `${SITE_URL}/treasuries/${ticker}`,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        description: TICKER_META[ticker].description,
        provider: { "@id": `${SITE_URL}/#org` },
        publisher: { "@id": `${SITE_URL}/#org` },
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ_ITEMS,
      },
      // BreadcrumbList (2026-07-29) · this page renders a VISIBLE
      // breadcrumb, so the markup mirrors a real trail the user can
      // walk, which is exactly what Google's guidance asks for. It
      // replaces the raw URL in the SERP line; it does not create a
      // rich snippet on its own.
      buildBreadcrumb([
        { name: "Galaxy Mind", url: SITE_URL },
        { name: "Bitcoin Treasuries", url: `${SITE_URL}/treasuries` },
        {
          name: `${ticker} · ${meta.name}`,
          url: `${SITE_URL}/treasuries/${ticker}`,
        },
      ]),
    ],
  };

  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)]">
      {/* SAFE inline JSON-LD · static server-controlled object,
          safeJsonLd() escapes JSON-LD-risky chars, CSP nonce gates
          the script tag. Same audited pattern as 9 other layouts. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(FAQ_SCHEMA) }}
      />
      <SiteHeader />

      <article className="mx-auto max-w-4xl px-4 sm:px-6 pt-10 pb-16">
        {/* BREADCRUMB · helps users orient + helps Google understand
            the hierarchy. The matching BreadcrumbList schema is emitted
            in FAQ_SCHEMA above (2026-07-29) · keep the two in step, the
            markup is supposed to mirror this visible trail. */}
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
          {" · "}
          <span className="text-[var(--text-secondary)]">{ticker}</span>
        </nav>

        <div className="flex items-baseline gap-3 flex-wrap mb-2">
          <h1 className="display-title">
            {ticker} <span className="text-[var(--text-secondary)] text-2xl sm:text-3xl">·</span>{" "}
            <span className="text-[var(--accent-ink)]">{meta.name}</span>
          </h1>
          <span
            className="text-2xl leading-none"
            aria-label={`Listed in ${meta.country}`}
            title={meta.country}
          >
            {COUNTRY_FLAG[meta.country]}
          </span>
        </div>
        <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed max-w-2xl mb-6 font-sans">
          {meta.blurb}
        </p>

        {/* BTC spot anchor · same prominent positioning as the main
            /treasuries page so the effective-price math has context. */}
        <BtcSpotPriceHero
          price={snapshot.btcPrice}
          delta24h={deriveBtc24hDelta(snapshot.btcPrice, snapshot.hourlyCloses)}
          size="md"
          label={`BTC SPOT · ANCHORS ${ticker} mNAV`}
        />

        {/* HERO STAT GRID · the numbers a visitor came for. */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 mb-8">
          <StatTile
            label="Current mNAV"
            value={row?.mNAV != null ? `${row.mNAV.toFixed(2)}x` : "—"}
            sub={interp.label}
            highlight={interp.bias === "cheap"}
          />
          <StatTile
            label="Bitcoin Holdings"
            value={row?.btcHoldings != null ? `${(row.btcHoldings / 1000).toFixed(1)}K` : "—"}
            sub="BTC on balance sheet"
          />
          <StatTile
            label="Market Cap"
            value={row?.marketCapM != null ? `$${(row.marketCapM / 1000).toFixed(2)}B` : "—"}
            sub="USD billions"
          />
          <StatTile
            label="BTC Yield"
            value={
              btcYield30
                ? `${btcYield30.pct >= 0 ? "+" : ""}${btcYield30.pct.toFixed(1)}%`
                : "—"
            }
            sub={
              btcYield30
                ? `BPS growth · ${btcYield30.spanDays}d`
                : "BPS growth · accumulating"
            }
            highlight={btcYield30 != null && btcYield30.pct > 0}
          />
        </section>

        {/* Market-cap provenance · for fast-diluting names we recompute
            market cap from a filing-sourced share count (the
            bitcointreasuries.net feed lags ATM dilution); for the rest
            the feed's basic figure is accurate. See lib/treasury-shares.ts. */}
        {row &&
          (() => {
            const scOverride = SHARE_COUNTS[row.ticker];
            return (
              <p className="-mt-6 mb-8 font-mono t-xs text-[var(--text-tertiary)] leading-relaxed">
                {scOverride
                  ? `Market cap uses a filing-sourced share count (~${Math.round(
                      scOverride.sharesM,
                    ).toLocaleString()}M shares · ${scOverride.source}) because the bitcointreasuries.net feed lags this name's ongoing dilution.`
                  : "Market cap from bitcointreasuries.net (basic share count)."}
              </p>
            );
          })()}

        {/* CEBE · net-of-senior-claims mNAV. The hero mNAV above is
            GROSS; this is the conservative view after debt + preferred
            (the gross-vs-net distinction at the heart of the mNAV
            debate). Pending for tickers we haven't sourced claims for. */}
        <section className="mb-8">
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
            CEBE · net of senior claims
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            {cebe?.available ? (
              <>
                {/* The three valuation lenses from the BTC Prague 2026
                    debate, low-to-high: gross (ignores capital structure),
                    EV / fully-diluted (Saylor's "include the notional"),
                    and CEBE net (conservative common-equity view). */}
                <div className="grid grid-cols-3 gap-3">
                  <StatTile
                    label="Gross mNAV"
                    value={row?.mNAV != null ? `${row.mNAV.toFixed(2)}x` : "—"}
                    sub="ignores claims"
                  />
                  <StatTile
                    label="EV mNAV"
                    value={cebe.evMNav != null ? `${cebe.evMNav.toFixed(2)}x` : "—"}
                    sub="incl. debt + preferred"
                  />
                  <StatTile
                    label="Net mNAV · CEBE"
                    value={cebe.netMNav != null ? `${cebe.netMNav.toFixed(2)}x` : "—"}
                    sub="after senior claims"
                    highlight={cebe.netMNav != null && cebe.netMNav < 1}
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatTile
                    label="Amplification"
                    value={
                      cebe.amplificationRatio != null
                        ? `${cebe.amplificationRatio.toFixed(2)}x`
                        : "—"
                    }
                    sub="BPS / CEBE BPS"
                    highlight={cebe.amplificationRatio != null && cebe.amplificationRatio >= 1.5}
                  />
                  <StatTile
                    label="Senior claims"
                    value={cebe.claimsPct != null ? `${(cebe.claimsPct * 100).toFixed(0)}%` : "—"}
                    sub="of BTC value"
                  />
                  <StatTile
                    label="BPS · gross"
                    value={
                      cebe.grossSatsPer100 != null
                        ? Math.round(cebe.grossSatsPer100).toLocaleString()
                        : "—"
                    }
                    sub="sats / $100 before"
                  />
                  <StatTile
                    label="CEBE BPS · net"
                    value={
                      cebe.cebeSatsPer100 != null
                        ? Math.round(cebe.cebeSatsPer100).toLocaleString()
                        : "—"
                    }
                    sub="sats / $100 after"
                  />
                </div>

                {/* Net value lens · the CEBE-adjusted counterparts of the
                    gross effective-price / sats-per-$1 stats. */}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <StatTile
                    label="Net effective BTC $"
                    value={
                      cebe.netMNav != null && snapshot.btcPrice != null
                        ? `$${((snapshot.btcPrice * cebe.netMNav) / 1000).toFixed(1)}k`
                        : "—"
                    }
                    sub="spot × net mNAV"
                  />
                  <StatTile
                    label="Net sats / $1"
                    value={
                      cebe.cebeSatsPer100 != null
                        ? Math.round(cebe.cebeSatsPer100 / 100).toLocaleString()
                        : "—"
                    }
                    sub="after claims · per $1"
                  />
                </div>

                <p className="mt-4 text-xs text-[var(--text-secondary)] leading-relaxed font-sans">
                  BPS is the bitcoin backing each common share before senior
                  claims (Michael Saylor&apos;s growth metric). CEBE BPS is what
                  is left after debt and preferred (the conservative risk
                  metric). The difference between them is Amplification
                  {cebe.amplificationRatio != null
                    ? `, ${cebe.amplificationRatio.toFixed(2)}x for ${ticker}`
                    : ""}
                  : the senior leverage that can make a treasury outperform
                  bitcoin when its BTC annualized return beats its cost of
                  capital, and underperform when short-duration or high-cost
                  liabilities come due. With no debt or preferred, BPS equals
                  CEBE BPS and the stock should track bitcoin like an ETF. Net
                  mNAV divides market cap by the bitcoin left for common
                  shareholders after senior claims ({claimsLine}). Figures as of{" "}
                  {cebe.asOf}; source: {cebe.source}.{" "}
                  <Link
                    href="/treasuries"
                    className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                  >
                    Full methodology →
                  </Link>
                </p>
              </>
            ) : (
              <>
                {cebe?.grossSatsPer100 != null && (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <StatTile
                      label="Gross mNAV"
                      value={row?.mNAV != null ? `${row.mNAV.toFixed(2)}x` : "—"}
                      sub="ignores claims"
                    />
                    <StatTile
                      label="BPS · gross"
                      value={Math.round(cebe.grossSatsPer100).toLocaleString()}
                      sub="sats / $100 · before claims"
                    />
                  </div>
                )}
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans">
                  CEBE BPS and Amplification are pending for {ticker} · its
                  senior-claims figures (debt + preferred) aren&apos;t reliably
                  sourced yet, so we publish gross BPS and mNAV rather than a
                  guess. CEBE BPS is the bitcoin per share after senior claims;
                  the gap from gross BPS is Amplification, the senior leverage
                  Michael Saylor frames as the risk metric.
                </p>
              </>
            )}
          </div>
        </section>

        {/* ABOUT · enriched profile beyond the one-line hero blurb:
            longer narrative + leadership / listing / capital-model facts. */}
        <section className="mb-8">
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
            About {meta.name}
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-sans mb-4">
              {about.lead}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {about.facts.map((f) => (
                <div key={f.label}>
                  <div className="font-mono t-xs uppercase tracking-[0.18em] text-[var(--text-tertiary)] mb-1">
                    {f.label}
                  </div>
                  <div className="text-sm text-[var(--text-primary)] font-sans">
                    {f.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* mNAV SPARKLINE · 90-day per-ticker trail. Pulls from KV
            history when available; otherwise derives from stock-price +
            BTC daily closes via the existing helper. */}
        <section className="mb-8">
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
            90-day mNAV history
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
            <MNavSparkline
              history={mNavHistory}
              currentMNav={row?.mNAV ?? null}
            />
          </div>
        </section>

        {/* PEER COMPARISON · brief table showing this ticker's mNAV
            against the other three. Drives internal traffic to the
            other /treasuries/[ticker] pages + the umbrella /treasuries. */}
        <section className="mb-8">
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
            How {ticker} compares
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] divide-y divide-[var(--border-subtle)]">
            {peers.map((p) => {
              const pMeta = TREASURY_META[p.ticker];
              return (
                <Link
                  key={p.ticker}
                  href={`/treasuries/${p.ticker}`}
                  className="flex items-center justify-between gap-3 p-4 hover:bg-[var(--bg-elevated-2)]/50 transition-colors group"
                >
                  <div className="flex items-baseline gap-3 min-w-0">
                    <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
                      {p.ticker}
                    </span>
                    <span className="text-sm text-[var(--text-secondary)] truncate">
                      {pMeta.name}
                    </span>
                    <span className="text-base leading-none">{COUNTRY_FLAG[pMeta.country]}</span>
                  </div>
                  <div className="flex items-baseline gap-3 shrink-0">
                    <span className="font-mono text-sm tabular-nums text-[var(--text-primary)]">
                      {p.mNAV != null ? `${p.mNAV.toFixed(2)}x` : "—"}
                    </span>
                    <span className="font-mono t-xs uppercase tracking-widest text-[var(--accent-ink)] opacity-0 group-hover:opacity-100 transition-opacity">
                      View →
                    </span>
                  </div>
                </Link>
              );
            })}
            <Link
              href="/treasuries"
              className="flex items-center justify-between p-4 hover:bg-[var(--bg-elevated-2)]/50 transition-colors group"
            >
              <span className="t-xs font-medium text-[var(--text-tertiary)] group-hover:text-[var(--accent-ink)] transition-colors">
                Full scoreboard · all 4 treasuries side-by-side →
              </span>
            </Link>
          </div>
        </section>

        {/* SEC FILINGS · US-listed only. MPJPY (Japan-listed) gets
            no panel since EDGAR doesn't cover JPX. Scoped to THIS
            ticker · without the prop the panel renders all 3 US
            treasuries' filings (audit 2026-05-29: /MSTR was showing
            XXI + ASST filings too). */}
        {meta.cik && (
          <section className="mb-8">
            <SECFilingsPanel ticker={ticker} />
          </section>
        )}

        {/* FAQ · renders both as visible HTML and matches the JSON-LD
            FAQPage schema above. Same per-page pattern as /stack and
            /treasuries umbrella. */}
        <section className="border-t border-[var(--border-subtle)] pt-12 mb-8">
          <h2 className="text-2xl font-semibold tracking-tight mb-6">
            Frequently asked about {ticker}
          </h2>
          <div className="space-y-6">
            {FAQ_ITEMS.map((q) => (
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

        {/* OUTBOUND CTAs · primary action is "see the live scoreboard"
            (back to /treasuries) since this page is a discovery surface
            for visitors who searched the ticker. /fit secondary CTA
            because that's where the "should I own this" question gets
            answered with portfolio context. */}
        <section className="border-t border-[var(--border-subtle)] pt-8">
          <div className="flex flex-wrap gap-3">
            <Link
              href="/treasuries"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] transition-colors"
            >
              Live scoreboard · 4 treasuries →
            </Link>
            <Link
              href="/fit"
              className="micro-label inline-flex items-center gap-2 px-4 py-2 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
            >
              ⊕ Should I own this? Live allocation engine
            </Link>
            <Link
              href="/stack"
              className="micro-label inline-flex items-center gap-2 px-4 py-2 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
            >
              ◐ Should I buy Bitcoin now?
            </Link>
          </div>
        </section>
      </article>

      <FooterDisclaimer />
    </main>
  );
}

// Hero stat tile · compact metric card with label / value / sub. The
// `highlight` prop tints the value orange when the metric is in a
// notable state (e.g., mNAV below 1.0x = cheap territory).
function StatTile({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
      <div className="font-mono t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)] mb-2">
        {label}
      </div>
      <div
        className={`text-3xl sm:text-4xl font-semibold tracking-tight tabular-nums leading-none mb-2 ${
          highlight ? "text-[var(--accent-ink)]" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </div>
      <div className="font-mono t-xs text-[var(--text-tertiary)] uppercase tracking-widest">
        {sub}
      </div>
    </div>
  );
}
