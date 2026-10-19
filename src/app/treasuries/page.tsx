import { headers } from "next/headers";
import { fetchDailyCloses, getMarketSnapshot } from "@/lib/market";
import { safeJsonLd } from "@/lib/json-ld";
import { CheapestCallout } from "./components/CheapestCallout";
import { TreasuryLastVisitDelta } from "./components/TreasuryLastVisitDelta";
import { TreasuryTable } from "./components/TreasuryTable";
import { ExportButtons } from "@/components/ExportButtons";
import { HowMNavWorks } from "./components/HowMNavWorks";
import { AlertSubscribeCompact } from "@/components/AlertSubscribeCompact";
import { InlineSubscribePrompt } from "@/components/InlineSubscribePrompt";
import { deriveMNavHistory } from "./components/MNavSparkline";
import { MNavHistoryChart } from "./components/MNavHistoryChart";
import { OutperformanceStrip } from "./components/OutperformanceStrip";
import { SECFilingsPanel } from "./components/SECFilingsPanel";
import { TreasuryLastVisitPulse } from "./components/TreasuryLastVisitPulse";
import { CitationBlock } from "@/components/CitationBlock";
import { DataStatusBanner } from "@/components/DataStatusBanner";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";
import { isTreasuryBoardEmpty } from "@/lib/treasuries";
import { CrossPageCTA } from "@/components/CrossPageCTA";
import {
  XSELL_OUT_HASHRATE_HOOK,
  XSELL_OUT_HASHRATE_TITLE,
} from "@/lib/hashrate-copy";
import { SaylorQuoteStrip } from "@/components/SaylorQuoteStrip";
import { GlossaryTerm } from "@/components/GlossaryTerm";
import { SiteHeader } from "@/components/SiteHeader";
import { StickyAnswerBar } from "@/components/StickyAnswerBar";
import {
  BtcSpotPriceHero,
  deriveBtc24hDelta,
} from "@/components/BtcSpotPriceHero";

export const revalidate = 300;

const SPARKLINE_DAYS = 90;
const URL = "https://galaxymind.space/treasuries";
const SITE_URL = "https://galaxymind.space";
const DESCRIPTION =
  "Live mNAV scoreboard for Bitcoin treasury companies MSTR, XXI, MPJPY and ASST. See which trades cheapest relative to the bitcoin it holds, updated daily.";

// JSON-LD structured data · three umbrella-page schemas:
//   1. WebApplication · the tool itself (live scoreboard).
//   2. Dataset · the mNAV scoreboard IS a dataset, and Google gives
//      Datasets rich-result treatment in Dataset Search + AI Overviews.
//      distribution[] points to the public JSON endpoints so AI agents
//      can discover programmatic access without scraping.
//   3. FAQPage · the educational copy on the page (HowMNavWorks)
//      reformatted as Q&A so search-intent queries like "what is mNAV"
//      surface direct answers.
//
// This used to live in src/app/treasuries/layout.tsx but the layout's
// markup renders on EVERY child route, which meant /treasuries/{ticker}
// emitted TWO FAQPage schemas (one from this layout, one from each
// per-ticker page) · Google's rich-results validator rejects that
// ("Duplicate field FAQPage", 2026-05-29). Co-locating with the page
// scopes the script to ONLY /treasuries · per-ticker pages emit their
// own ticker-specific FAQPage. Each URL: exactly one FAQPage.
//
// publisher / creator @id back-refs the Organization defined in the
// root layout, keeping the brand graph consistent.
//
// SECURITY: Static, server-controlled object literal · no user input
// ever flows in. safeJsonLd() escapes `<` and U+2028/U+2029 for defense
// in depth. Inline <script> is mandatory because search engines do not
// fetch external JSON-LD. Same already-shipped pattern as
// src/app/stack/layout.tsx and src/app/layout.tsx.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["WebApplication", "FinanceApplication"],
      name: "Galaxy Mind Bitcoin Treasury Scoreboard",
      url: URL,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      description: DESCRIPTION,
      featureList: [
        "Live mNAV table for MSTR, XXI, MPJPY, ASST",
        "90-day mNAV history sparkline per ticker, BTC-overlaid",
        "Cheapest-treasury callout updated every 5 minutes",
        "Per-ticker BTC holdings, market cap, premium-vs-NAV interpretation",
        "Public JSON endpoint at /api/treasuries (free, no auth)",
      ],
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      provider: { "@id": `${SITE_URL}/#org` },
      publisher: { "@id": `${SITE_URL}/#org` },
      isAccessibleForFree: true,
    },
    {
      "@type": "Dataset",
      // Self @id · see /stack's Dataset for why temporalCoverage is
      // deliberately omitted (2026-07-29).
      "@id": `${SITE_URL}/#treasury-dataset`,
      name: "Bitcoin Treasury mNAV Scoreboard",
      description:
        "Live multiple-of-net-asset-value (mNAV) for the major public Bitcoin treasury companies: Strategy (MSTR), Twenty One (XXI), Metaplanet (MPJPY), and Strive Inc (ASST). mNAV = market cap / value of BTC holdings. Updated every 5 minutes from upstream sources (Yahoo Finance for stock prices, bitcointreasuries.net for BTC holdings, CoinGecko for BTC spot price).",
      url: URL,
      keywords: [
        "Bitcoin",
        "mNAV",
        "treasury company",
        "MSTR",
        "Strategy",
        "XXI",
        "Twenty One",
        "MPJPY",
        "Metaplanet",
        "ASST",
        "Strive Inc",
        "Strive",
        "Bitcoin treasury",
        "premium to NAV",
      ],
      creator: { "@id": `${SITE_URL}/#org` },
      publisher: { "@id": `${SITE_URL}/#org` },
      // A resolvable LICENSE DOCUMENT, not a page about us (2026-07-25).
      // This pointed at /about, which states no reuse terms anywhere — so
      // an agent deciding whether it may quote and attribute this data
      // found nothing, and the safe default for a cautious client is to
      // omit the source. Not a new policy: /api/openapi.json already
      // declares CC-BY-4.0; this makes the JSON-LD agree with it.
      license: "https://creativecommons.org/licenses/by/4.0/",
      isAccessibleForFree: true,
      distribution: [
        {
          "@type": "DataDownload",
          encodingFormat: "application/json",
          contentUrl: `${SITE_URL}/api/treasuries`,
          name: "Live mNAV snapshot (JSON)",
        },
        {
          "@type": "DataDownload",
          encodingFormat: "application/json",
          contentUrl: `${SITE_URL}/api/treasuries/history?ticker=MSTR&days=90`,
          name: "Per-ticker mNAV history (JSON)",
        },
        {
          "@type": "DataDownload",
          encodingFormat: "text/csv",
          contentUrl: `${SITE_URL}/api/treasuries/history?ticker=MSTR&days=90&format=csv`,
          name: "Per-ticker mNAV history (CSV)",
        },
      ],
      variableMeasured: [
        {
          "@type": "PropertyValue",
          name: "mNAV",
          description:
            "Multiple of net asset value · market cap divided by value of bitcoin holdings. Below 1.0x means the stock trades for less than the bitcoin it holds (treasury-cheap). Above 1.6x = rich premium.",
          unitText: "ratio",
        },
        {
          "@type": "PropertyValue",
          name: "btcHoldings",
          description: "Bitcoin held on the company's balance sheet.",
          unitText: "BTC",
        },
        {
          "@type": "PropertyValue",
          name: "marketCapM",
          description:
            "Company market cap in millions USD · uses filing-sourced share counts where the bitcointreasuries.net feed lags ATM dilution (ASST, MPJPY), otherwise min(basic, fully_diluted).",
          unitText: "USD millions",
        },
        {
          "@type": "PropertyValue",
          name: "netMNav",
          description:
            "CEBE net mNAV · market cap divided by the bitcoin left for common shareholders after senior claims (debt + preferred). The conservative, net-of-leverage counterpart to gross mNAV.",
          unitText: "ratio",
        },
        {
          "@type": "PropertyValue",
          name: "bps",
          description:
            "BPS (Bitcoin Per Share), Michael Saylor's growth metric · gross bitcoin backing each common share BEFORE senior claims, expressed as sats per $100 of stock.",
          unitText: "sats per $100",
        },
        {
          "@type": "PropertyValue",
          name: "cebeBps",
          description:
            "CEBE BPS, Saylor's risk metric · bitcoin per common share AFTER senior claims, expressed as sats per $100 of stock.",
          unitText: "sats per $100",
        },
        {
          "@type": "PropertyValue",
          name: "amplification",
          description:
            "Amplification · BPS divided by CEBE BPS (equivalently holdings divided by net-of-claims holdings). 1.0x means no senior leverage (the stock tracks bitcoin like an ETF); higher means more leverage.",
          unitText: "ratio",
        },
        {
          "@type": "PropertyValue",
          name: "seniorClaimsPct",
          description:
            "Senior claims (debt + preferred, net of cash) as a share of the company's gross bitcoin value.",
          unitText: "percent",
        },
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Which Bitcoin treasury company is cheapest right now?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The cheapest treasury company is whichever of MSTR, XXI, MPJPY, or ASST has the lowest mNAV (market cap / value of BTC holdings) at the moment. The Galaxy Mind scoreboard surfaces this live · the 'cheapest' callout updates every 5 minutes. mNAV below 1.0x means the stock trades for less than the bitcoin it holds, which is historically a strong setup. mNAV above 1.6x is rich premium territory.",
          },
        },
        {
          "@type": "Question",
          name: "MSTR vs IBIT: which is a better Bitcoin investment?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "MSTR (Strategy) is operating leverage on Bitcoin · Saylor's accumulation strategy means the company keeps issuing equity above NAV and using proceeds to buy more BTC, which compounds when mNAV > 1.0x. IBIT (BlackRock's spot Bitcoin ETF) is pure spot Bitcoin exposure with no operating leverage, no mNAV premium, no issuer-specific strategy. IBIT has a 0.25% expense ratio (MSBT charges 0.14%, the lowest mainstream spot ETF). The right choice depends on (a) whether you want leverage / accretion exposure (favors MSTR when mNAV is compressed) or pure spot (favors IBIT/MSBT), and (b) account type · Roth IRA tilts toward spot ETFs because the compound growth is tax-free. The /fit allocation engine handles this tradeoff explicitly based on horizon, tolerance, and live mNAV.",
          },
        },
        {
          "@type": "Question",
          name: "What is mNAV?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "mNAV (multiple of net asset value) is a Bitcoin treasury company's market cap divided by the value of its bitcoin holdings. mNAV = 1.0x means the company trades for exactly the value of its BTC. Above 1.0x = the market is paying a premium for operating leverage / future BTC accumulation. Below 1.0x = treasury-cheap (the stock is worth less than the bitcoin it holds).",
          },
        },
        {
          "@type": "Question",
          name: "Why does MSTR trade above its bitcoin value?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Strategy (MSTR) historically trades at a premium to its bitcoin holdings because the market is pricing in (a) Saylor's continued accumulation strategy · he keeps issuing equity above NAV and using proceeds to buy more BTC, which is accretive when mNAV > 1.0x, (b) operating leverage on the underlying BTC price, and (c) institutional access via a regulated US equity wrapper. The premium varies with cycle sentiment · it can compress to near 1.0x in cooler periods.",
          },
        },
        {
          "@type": "Question",
          name: "How is the data updated?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The mNAV scoreboard polls upstream sources every 5 minutes: Yahoo Finance for stock prices and shares outstanding, bitcointreasuries.net for per-company BTC holdings, CoinGecko for BTC spot. Daily snapshots are persisted at 00:10 UTC for the 90-day history sparkline. All data is publicly available · no proprietary feeds.",
          },
        },
      ],
    },
  ],
};

export default async function TreasuriesPage() {
  const snapshot = await getMarketSnapshot();
  const rows = snapshot.treasuries;

  // Cheapest treasury (lowest mNAV) · powers the sticky answer-anchor
  // (N3 · UX audit 2026-07-13). Simple min here so the bar has a static
  // value; CheapestCallout renders the full cheapest card independently.
  let cheapestRow: (typeof rows)[number] | null = null;
  for (const r of rows) {
    if (r.mNAV == null) continue;
    if (cheapestRow == null || r.mNAV < (cheapestRow.mNAV as number)) {
      cheapestRow = r;
    }
  }

  // Live-table export payload · client-side CSV/JSON of the cross-ticker
  // snapshot the table renders, no new request. (The per-ticker time
  // series already has its own CSV at /api/treasuries/history?…&format=csv.)
  const btcSpot = snapshot.btcPrice;
  const treasuryExportRows = rows.map((r) => ({
    ticker: r.ticker,
    mNAV: r.mNAV,
    price_usd: r.price,
    market_cap_musd: r.marketCapM,
    btc_held: r.btcHoldings,
    effective_btc_price_usd:
      r.mNAV != null && btcSpot != null ? Math.round(btcSpot * r.mNAV) : null,
    btc_per_share_sats:
      r.btcHoldings != null &&
      r.price != null &&
      r.marketCapM != null &&
      r.marketCapM > 0
        ? Math.round(((r.btcHoldings * r.price) / (r.marketCapM * 1_000_000)) * 1e8)
        : null,
  }));
  const treasuryExportDate = (snapshot.asOf ?? "").slice(0, 10) || "latest";
  const treasuryExportJson = {
    _meta: {
      source: `${SITE_URL}/treasuries`,
      description: "Live Bitcoin treasury mNAV comparison",
      asOf: snapshot.asOf,
      btcPriceUsd: snapshot.btcPrice,
      methodology: `${SITE_URL}/treasuries/methodology`,
    },
    treasuries: treasuryExportRows,
  };

  // Fetch daily stock-price history for each treasury in parallel — Yahoo
  // chart endpoint at 1d interval, 90d range. ~10-20 KB total over the
  // wire; cached for 1h via the fetcher's revalidate window.
  const stockHistories = await Promise.all(
    rows.map((r) => fetchDailyCloses(r.ticker, SPARKLINE_DAYS)),
  );

  // BTC daily closes for mNAV history derivation. Previously sampled
  // every 24th entry from the hourly array — but lib/market.ts drops
  // null hourly bars during parsing, so a stride of 24 in the
  // null-dropped array does NOT correspond to a calendar day. Result:
  // every "daily" sample drifted off the actual date axis, silently
  // miscalculating mNAV history for ALL four treasuries.
  //
  // Fix: use hourlyTimestamps (already alongside hourlyCloses) to
  // pick one entry per UTC day. We walk newest → oldest, picking the
  // first close we see for each unique YYYY-MM-DD, so the last entry
  // = today's most recent sample.
  const btcDaily = (() => {
    const closes = snapshot.hourlyCloses;
    const timestamps = snapshot.hourlyTimestamps;
    if (!closes || !timestamps || closes.length < SPARKLINE_DAYS) return null;
    const seenDates = new Set<string>();
    const out: number[] = [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const ts = timestamps[i];
      if (!Number.isFinite(ts) || !Number.isFinite(closes[i])) continue;
      const date = new Date(ts * 1000).toISOString().slice(0, 10);
      if (seenDates.has(date)) continue;
      seenDates.add(date);
      out.unshift(closes[i]);
      if (out.length >= SPARKLINE_DAYS) break;
    }
    return out.length >= 2 ? out : null;
  })();

  // Derive per-row mNAV history (90 daily values per treasury). Null
  // for any row whose stock fetch failed or whose snapshot is partial.
  const mNavHistories: (number[] | null)[] = rows.map((r, i) =>
    deriveMNavHistory(
      stockHistories[i],
      btcDaily,
      r.marketCapM,
      r.price,
      r.btcHoldings,
    ),
  );

  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  // dateModified freshness signal · the scoreboard + its dataset refresh
  // from upstream every ~5 min; snapshot.asOf is the honest "last
  // modified" timestamp for both the WebApplication and Dataset nodes.
  const dateModified = snapshot.asOf ?? undefined;
  const structuredData = {
    ...STRUCTURED_DATA,
    "@graph": STRUCTURED_DATA["@graph"].map((node) => {
      const t = (node as { "@type": string | string[] })["@type"];
      const isWebApp = Array.isArray(t) && t.includes("WebApplication");
      return isWebApp || t === "Dataset" ? { ...node, dateModified } : node;
    }),
  };

  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)]">
      {/* SAFE: Static, server-controlled JSON-LD · no user input flows
          in. safeJsonLd() escapes `<` and U+2028/U+2029 for defense in
          depth. Inline <script> is required for JSON-LD discovery. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
      />
      <SiteHeader />

      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        {/* Command-center header · on desktop a 12-col grid: title + live
            spot top-left, explainer beneath them, and the live cheapest-
            treasury verdict spanning the full height on the right. On
            mobile it collapses to one column in source order (title+spot,
            VERDICT, explainer) so the payoff lands above the fold instead
            of below a paragraph (mobile audit 2026-06-20). */}
        {/* grid-rows-[auto_1fr] matters. The verdict card on the right spans
            both rows, and a spanning item grows every AUTO row it crosses,
            so row 1 inflated to share the card's height while items-start
            kept the title block at its natural size — leaving ~170px of
            hole between the spot price and the explainer beneath it, which
            is where the eye fell out of the page. Pinning row 2 to 1fr
            sends the free space there instead. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[auto_1fr] gap-6 lg:gap-x-8 lg:gap-y-6 lg:items-start">
          {/* A · title + live spot + honesty strip */}
          <div className="lg:col-span-7 lg:col-start-1 lg:row-start-1">
            {/* Hero system matches / and /float: mono kicker + fluid
                display-title with ONE gradient word. This was the last
                major surface still running a bare text-3xl h1 (visual
                sweep 2026-07-03). */}
            <p className="night-bench-kicker">
              Treasury desk · live mNAV
            </p>
            <h1 className="display-title mb-3">
              Bitcoin treasuries.
            </h1>

            {/* BTC spot price · mobile-first prominent block; anchors the
                mNAV verdict + table for every visitor. */}
            <BtcSpotPriceHero
              price={snapshot.btcPrice}
              delta24h={deriveBtc24hDelta(snapshot.btcPrice, snapshot.hourlyCloses)}
              size="md"
              label="BTC SPOT · LIVE"
            />

            {/* Degraded honesty strip · when upstreams are down, mNAV holes
                are outages, not market signals. Same predicate as the crons. */}
            <div className="mt-3">
              <DataStatusBanner
                degraded={
                  isMarketSnapshotDegraded(snapshot) ||
                  isTreasuryBoardEmpty(snapshot.treasuries)
                }
              />
            </div>
          </div>

          {/* B · the live verdict. Right column spanning both rows on
              desktop; directly under the spot price on mobile so the
              cheapest-mNAV call is above the fold. */}
          <div className="lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:row-span-2">
            <div id="treasury-answer">
              <CheapestCallout rows={rows} />
            </div>
            {/* Sticky answer-anchor (N3 · UX audit 2026-07-13) · keeps the
                cheapest-mNAV call in view once the callout scrolls off,
                on this 5-6 screen page. Top-anchored · clears the bottom
                nav. */}
            {cheapestRow != null && cheapestRow.mNAV != null && (
              <StickyAnswerBar
                targetId="treasury-answer"
                label="Cheapest"
                value={`${cheapestRow.ticker} ${cheapestRow.mNAV.toFixed(2)}×`}
              />
            )}
            {/* Personal mNAV delta · the /stack "since you last
                checked" pattern on the cheapest race (2026-07-11). */}
            <TreasuryLastVisitDelta
              rows={rows.map((r) => ({ ticker: r.ticker, mNAV: r.mNAV }))}
            />
          </div>

          {/* C · the explainer + return-visitor pulse. Under the title on
              desktop; below the verdict on mobile, second half of the
              gloss gated to sm+ to keep the phone fold tight. */}
          <div className="lg:col-span-7 lg:col-start-1 lg:row-start-2">
            <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed max-w-2xl">
              <strong className="text-[var(--accent-ink)]">Public companies that hold bitcoin on their balance sheet.</strong>{" "}
              The <GlossaryTerm slug="mnav">mNAV</GlossaryTerm>{" "}column tells you which one is &quot;cheapest&quot; relative to its bitcoin holdings.{" "}
              <span className="hidden sm:inline">Basically, are you paying $1 for $1 of BTC, or paying $1.50? These almost always cost more than $1 · &quot;cheapest&quot; just means the smallest markup. Lower is better.</span>
            </p>

            {/* Return-visitor mNAV-mover banner · only shows if >24h
                since last visit AND the biggest mover has |delta| >= 2%. */}
            <TreasuryLastVisitPulse />
          </div>
        </div>

        {/* Historical mNAV chart · KV-backed real per-day mNAV trails.
            Shows above the table because it answers the highest-leverage
            question on this page ("which treasury is at a multi-week low
            right now"). The table below is the row-by-row drill-down.
            data-occlusion-sensitive: the floating StickySubscribeChip
            yields rather than covering the chart's ticker-legend + period
            toggles (UX audit 2026-07-13). */}
        <section className="mt-8" data-occlusion-sensitive>
          <MNavHistoryChart />
        </section>

        {/* Treasury vs BTC race (task #147 · data-gated since
            2026-06-15, first ship 2026-07-07 at a 23-day window).
            Self-gates: renders nothing until >=14 same-instant
            snapshot pairs exist per ticker · no MNavHistoryChart
            surgery, the strip owns its own KV reads. */}
        <OutperformanceStrip tickers={rows.map((r) => r.ticker)} />

        {/* The full comparison table */}
        <section className="mt-8">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="t-xs font-medium text-[var(--text-tertiary)]">
              All Treasuries · live
            </div>
            <ExportButtons
              surface="treasuries"
              filename={`galaxymind-treasuries-${treasuryExportDate}`}
              rows={treasuryExportRows}
              json={treasuryExportJson}
            />
          </div>
          <TreasuryTable
            rows={rows}
            mNavHistories={mNavHistories}
            btcPrice={snapshot.btcPrice}
          />
        </section>

        {/* Inline subscribe prompt · 2026-05-20 audit moved this
            from BETWEEN CheapestCallout and the table to BELOW the
            table. The original "peak-intent" argument was right in
            spirit but the placement inverted the order: a casual
            visitor needs to SEE the per-ticker data before they
            know they want notifications. After scanning the table
            is the real peak-intent moment. */}
        <section className="mt-8 max-w-xl mx-auto">
          <InlineSubscribePrompt
            source="treasuries"
            headline="Get an email when any tracked treasury goes cheap"
            subhead="One email per crossing · self-deduping"
          />
        </section>

        {/* SEC filings panel · turns /treasuries into a destination
            for breaking treasury news, not just a static snapshot.
            Sits between the mNAV table and HowMNavWorks because the
            filings are the upstream cause of mNAV moves (ATM activity,
            BTC purchases disclosed in 8-Ks, capital raises in S-3s) ·
            reading them right after the table makes the causal chain
            visible. JP-listed MPJPY is intentionally absent · its
            disclosures live on TDnet/JPX. */}
        <section className="mt-12">
          <SECFilingsPanel />
        </section>

        {/* Treasury decision-tool cluster · links the high-intent
            comparison/landing pages off this priority-0.8 surface so
            they get crawled fast and inherit link equity (they were
            sitemap-only near-orphans otherwise · SEO 2026-05-31). Plain
            Links, internal hub-and-spoke. */}
        <section className="mt-12">
          <h2 className="font-mono text-sm uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-4">
            Treasury decision tools
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href="/cheapest-bitcoin-treasury"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-1">
                Which treasury is cheapest right now?
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                All four ranked live by mNAV · lowest is the biggest discount to the bitcoin it holds.
              </div>
            </a>
            <a
              href="/mstr-vs-bitcoin"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-1">
                MSTR vs buying Bitcoin directly
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Effective BTC price through Strategy vs spot, live · the head-to-head.
              </div>
            </a>
            <a
              href="/ibit-vs-mstr"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-1">
                IBIT vs MSTR
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                Spot ETF or leveraged treasury equity? Live mNAV says when MSTR&apos;s discount beats IBIT&apos;s simplicity.
              </div>
            </a>
            <a
              href="/is-mstr-overvalued"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-1">
                Is MSTR overvalued?
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                The premium/discount verdict from live mNAV · plus the same for Metaplanet, XXI, and Strive.
              </div>
            </a>
            <a
              href="/is-it-too-late-to-buy-bitcoin"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-1">
                Is it too late to buy Bitcoin?
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                The live 0-100 buying gauge answers the timing question with data.
              </div>
            </a>
            <a
              href="/bitcoin-treasuries-below-nav"
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)]/60 transition-all group"
            >
              <div className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors mb-1">
                Which treasuries trade below NAV?
              </div>
              <div className="text-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                mNAV under 1.0 means the stock is worth less than its bitcoin · gross vs net of debt, live.
              </div>
            </a>
          </div>
          {/* The non-MSTR overvalued verdicts were only reachable via
              the MSTR page's sibling strip · one inbound link each.
              Direct links from this hub give the crawler (and readers)
              a one-hop path to all four (Ahrefs 2026-06-11). */}
          <div className="micro-label mt-4 flex flex-wrap gap-x-6 gap-y-2">
            <span className="text-[var(--text-tertiary)]">More verdicts</span>
            <a href="/is-metaplanet-overvalued" className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors">
              Is Metaplanet overvalued?
            </a>
            <a href="/is-xxi-overvalued" className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors">
              Is XXI overvalued?
            </a>
            <a href="/is-strive-overvalued" className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors">
              Is Strive overvalued?
            </a>
          </div>
          {/* Methodology + valuation-lens children · cross-linked among
              themselves but previously not from this hub (compare was a
              sitemap-only orphan). One-hop path from the priority-0.8 hub. */}
          <div className="micro-label mt-3 flex flex-wrap gap-x-6 gap-y-2">
            <span className="text-[var(--text-tertiary)]">More tools</span>
            <a href="/gross-vs-net-mnav" className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors">
              Gross vs net mNAV
            </a>
            <a href="/what-is-amplification" className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors">
              What is Amplification?
            </a>
            <a href="/treasuries/compare" className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors">
              Compare quadrant
            </a>
            <a href="/treasuries/methodology" className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors">
              Methodology
            </a>
          </div>
        </section>

        {/* Educational + cross-link to /stack */}
        <section className="mt-12">
          <HowMNavWorks />
        </section>

        {/* Citation block · explicit "last updated" timestamp + a
            copy-paste-ready citation string. Encourages external
            citation by journalists / researchers / agents, which is
            the strongest authority signal for SEO + AI-agent ranking. */}
        <section className="mt-8">
          <CitationBlock
            pageUrl="https://galaxymind.space/treasuries"
            dataLabel="Bitcoin Treasury mNAV Scoreboard"
            lastUpdatedISO={snapshot.asOf}
            surface="treasuries"
          />
        </section>

        {/* Cross-page CTAs · the natural follow-up questions for a
            visitor who just absorbed the mNAV scoreboard. /float
            zooms out to "how much is even left to buy?" · /stack
            zooms in to "should I buy right now?". */}
        <section className="mt-8">
          {/* hashrate strip REMOVED 2026-08-13 · see HomeClient note */}
          <CrossPageCTA
            cards={[
              {
                href: "/today",
                eyebrow: "MORNING HABIT",
                title: "Today in Bitcoin",
                hook: "Cheapest treasury + gauge + float in one daily briefing.",
              },
              {
                href: "/float",
                eyebrow: "HOW MUCH IS LEFT?",
                title: "The Bitcoin Float",
                hook: "What's still in play vs locked away · the supply side of these names.",
              },
              {
                href: "/hashrate",
                eyebrow: "RENT HASHRATE",
                title: XSELL_OUT_HASHRATE_TITLE,
                hook: XSELL_OUT_HASHRATE_HOOK,
              },
            ]}
            tailLink={{
              hint: "Build the daily habit",
              label: "Open today's briefing",
              href: "/today",
            }}
          />
        </section>
      </div>

      {/* Quiet bitcoin-meme-culture flourish · rotating Saylor lines
          in the calm space after the data, before the email CTA
          (shared list · one voice with the gauge + eggs). */}
      <SaylorQuoteStrip />

    </main>
  );
}
