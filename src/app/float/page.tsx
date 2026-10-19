// /float · How much bitcoin is left to buy?
//
// Server component. Fetches FloatSnapshot from KV via /api/float
// and passes to <SupplyClock>, the hero instrument (2026-06-29
// redesign · debt-clock pattern: the in-play number, huge, falling
// live). The page is sequenced as one urgency arc: the falling
// number → where the other coins went (grid + allocation) → the
// trend only goes down → the supply cut is scheduled → your slice.

import nextDynamic from "next/dynamic";

// Code-split the hero client tree (perf 2026-06-12). SupplyClock
// still SSRs (it's the above-fold hero · no ssr:false) but its
// interval/animation JS loads as a separate chunk instead of
// blocking the route bundle. FloatTrendChart goes further: it's
// below-fold and pulls recharts (~105 KB gz), so it loads through
// the FloatTrendChartLazy client shim with ssr:false — page-level
// nextDynamic can't do that from a server component (audit
// 2026-07-12 · /fit's BacktestChart pattern).
const SupplyClock = nextDynamic(() =>
  import("./components/SupplyClock").then((m) => ({
    default: m.SupplyClock,
  })),
);
import { FloatTrendChartLazy } from "./components/FloatTrendChartLazy";
import { HalvingRunway } from "./components/HalvingRunway";
import { FloatAllocationBreakdown } from "./components/FloatAllocationBreakdown";
import { MyFloatShare } from "./components/MyFloatShare";
import { ExportButtons } from "@/components/ExportButtons";
import { FloatMethodology } from "./components/FloatMethodology";
import { ShareFloatButton } from "./components/ShareFloatButton";
import { CrossPageCTA } from "@/components/CrossPageCTA";
import { AlertSubscribeCompact } from "@/components/AlertSubscribeCompact";
import { InlineSubscribePrompt } from "@/components/InlineSubscribePrompt";
import { FloatLastVisitDelta } from "./components/FloatLastVisitDelta";
import {
  TwentyOneMillionGrid,
  computeSupplyBuckets,
} from "./components/TwentyOneMillionGrid";
import { SupplyStory } from "./components/SupplyStory";
import { SaylorQuoteStrip } from "@/components/SaylorQuoteStrip";
import { GlossaryTerm } from "@/components/GlossaryTerm";
import { SiteHeader } from "@/components/SiteHeader";
import { getFloatData } from "@/lib/float-data";
import { fetchBTCPrice } from "@/lib/market";
import { CitationBlock } from "@/components/CitationBlock";
import { StickyAnswerBar } from "@/components/StickyAnswerBar";
import { DataStatusBanner } from "@/components/DataStatusBanner";
import { safeJsonLd } from "@/lib/json-ld";
import { headers } from "next/headers";

// Page-level ISR cache · revalidates the rendered HTML every 30
// min. The data fetch (kv read inside getFloatData) is naturally
// fast enough not to need a separate fetch-cache layer · we read
// directly from KV with no HTTP hop.
export const revalidate = 1800;

const SITE_URL = "https://galaxymind.space";
const FLOAT_URL = `${SITE_URL}/float`;

export default async function FloatPage() {
  // Float only needs BTC spot for the USD readout on SupplyClock —
  // not the full market snapshot (7+ unused upstreams + hourlies).
  // getFloatData is KV-only; fetchBTCPrice is one CoinGecko call.
  const [data, btcPrice] = await Promise.all([
    getFloatData(),
    fetchBTCPrice(),
  ]);

  // Allocation export · client-side CSV/JSON of the supply breakdown the
  // FloatAllocationBreakdown renders (no new request). Cohorts + in-play
  // sum to totalSupply (the 21M cap), so pct_of_21m sums to 100.
  const fs = data.current;
  const floatExportRows = (
    [
      ["lost", fs.cohorts.lost],
      ["governments", fs.cohorts.governments],
      ["etfs", fs.cohorts.etfs],
      ["public_companies", fs.cohorts.publicCompanies],
      ["long_term_holders_other", fs.cohorts.lthOther],
      ["yet_to_mine", fs.cohorts.yetToMine],
      ["in_play", fs.inPlay],
    ] as [string, number | null][]
  ).map(([cohort, btc]) => ({
    cohort,
    btc: btc == null ? null : Math.round(btc),
    pct_of_21m:
      btc == null || fs.totalSupply <= 0
        ? null
        : Math.round((btc / fs.totalSupply) * 10000) / 100,
  }));
  const floatExportDate = (data.asOf ?? "").slice(0, 10) || "latest";
  const floatExportJson = {
    _meta: {
      source: `${SITE_URL}/float`,
      description: "Bitcoin float · supply allocation by holder cohort",
      asOf: data.asOf,
      blockHeight: fs.blockHeight,
      totalSupplyBtc: fs.totalSupply,
      inPlayBtc: fs.inPlay,
      isFallback: data.isFallback,
      partial: fs.partial === true,
      methodology: `${SITE_URL}/float`,
    },
    allocation: floatExportRows,
  };

  // Per-request CSP nonce (proxy.ts injects `x-galaxymind-nonce`) so the
  // inline JSON-LD passes the nonce-based / strict-dynamic CSP. Same
  // pattern as /treasuries and /stack.
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  // JSON-LD · /float had NO structured data before (2026-06-03). Mirrors
  // the WebApplication + Dataset pattern on /treasuries so AI agents and
  // Google Dataset Search discover the float numbers + the public
  // /api/float endpoint. dateModified = data.asOf (the snapshot's own
  // freshness) is an honest per-render signal. distribution[] lists only
  // /api/float. There is still no /api/float/history ENDPOINT — but as
  // of 2026-07-29 /api/float itself serves the daily series as CSV via
  // ?format=csv, so the Dataset can finally advertise a spreadsheet
  // download the way /stack and /treasuries do, without pointing at a
  // 404. That was the original blocker, not a policy.
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": ["WebApplication", "FinanceApplication"],
        name: "The Bitcoin Float",
        url: FLOAT_URL,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        description:
          "Live tracker of the Bitcoin float · the spendable supply realistically able to change hands once lost, government-seized, spot-ETF, and public-treasury coins are set aside. Includes the supply allocation breakdown and a halving-runway projection.",
        featureList: [
          "The Supply Clock · live count of in-play bitcoin, falling by the minute",
          "Supply allocation breakdown: lost, governments, ETFs, public treasuries, yet-to-mine, in-play",
          "Float trend over time with halving markers",
          "Halving runway · demand vs mining-issuance ratio at the next halvings",
        ],
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        provider: { "@id": `${SITE_URL}/#org` },
        publisher: { "@id": `${SITE_URL}/#org` },
        isAccessibleForFree: true,
        dateModified: data.asOf,
      },
      {
        "@type": "Dataset",
      // Self @id · see the note on /stack's Dataset for why
      // temporalCoverage is deliberately omitted (2026-07-29).
      "@id": `${SITE_URL}/#float-dataset`,
        name: "Bitcoin Float & Supply Allocation",
        description:
          "Daily snapshot of the Bitcoin float (the coins realistically in play) and the full supply allocation by holder cohort: long-term-lost, government-seized, spot-ETF, public treasury companies, yet-to-mine, and in-play. Derived from on-chain supply, mempool.space block height, and bitcointreasuries.net aggregates.",
        url: FLOAT_URL,
        keywords: [
          "Bitcoin",
          "Bitcoin float",
          "circulating supply",
          "lost bitcoin",
          "ETF holdings",
          "treasury holdings",
          "halving",
          "how much bitcoin is left to buy",
        ],
        creator: { "@id": `${SITE_URL}/#org` },
        publisher: { "@id": `${SITE_URL}/#org` },
        // Resolvable license document · see the note in treasuries/page.tsx.
        // /about states no reuse terms, so it could not answer "may I
        // quote this?"; CC-BY-4.0 matches /api/openapi.json's declaration.
        license: "https://creativecommons.org/licenses/by/4.0/",
        isAccessibleForFree: true,
        dateModified: data.asOf,
        distribution: [
          {
            "@type": "DataDownload",
            encodingFormat: "application/json",
            contentUrl: `${SITE_URL}/api/float`,
            name: "Current float snapshot (JSON)",
          },
          {
            "@type": "DataDownload",
            encodingFormat: "text/csv",
            contentUrl: `${SITE_URL}/api/float?format=csv&days=365`,
            name: "Daily float history (CSV)",
          },
        ],
        variableMeasured: [
          {
            "@type": "PropertyValue",
            name: "inPlay",
            description:
              "The Bitcoin float · coins realistically able to change hands (circulating supply minus long-term-lost, government-seized, ETF, and public-treasury coins).",
            unitText: "BTC",
          },
          {
            "@type": "PropertyValue",
            name: "cohorts",
            description:
              "Supply allocation by holder: lost, governments, ETFs, public treasuries, yet-to-mine, and in-play.",
            unitText: "BTC",
          },
          {
            "@type": "PropertyValue",
            name: "blockHeight",
            description: "Bitcoin block height at the snapshot time.",
            unitText: "block",
          },
        ],
      },
    ],
  };

  return (
    <main className="night-bench min-h-screen flex-1 text-[var(--text-primary)] pb-12">
      {/* JSON-LD · static, server-controlled. safeJsonLd() escapes
          `<` / U+2028 / U+2029 for defense in depth. Inline <script>
          is required · crawlers do not fetch external JSON-LD. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
      />
      <SiteHeader />

      {/* Hero · one-line framing + the Supply Clock. The clock is
          self-explanatory by design (the old collapsed "how to read
          this" guide died with the hourglass): a number falling in
          real time needs no manual. The intro sentence carries the
          one idea a first-time visitor must have before the number
          means anything: most of the 21M can no longer be bought.
          Component brings its own machined chrome · no page-level
          wrapper panel. */}
      {/* data-occlusion-sensitive: the floating StickySubscribeChip
          yields while the Supply Clock hero is in view instead of
          sitting on the odometer/readouts (UX audit 2026-07-13). */}
      <section
        id="float-hero"
        className="max-w-5xl mx-auto px-4 sm:px-6 pt-3 sm:pt-8 pb-8 sm:pb-12"
        data-occlusion-sensitive
      >
        <div className="text-center mb-4 sm:mb-6 max-w-4xl mx-auto">
          <p className="night-bench-kicker mb-2">
            How much bitcoin is left to buy
          </p>
          <h1 className="display-title">
            The Bitcoin Float
          </h1>
          <p className="night-bench-lede mx-auto mt-3 max-w-xl text-center">
            Most of the 21M can no longer be bought.{" "}
            <strong className="text-[var(--accent-ink)]">
              The falling number below is the{" "}
              <GlossaryTerm slug="bitcoin-float">Bitcoin Float</GlossaryTerm>
            </strong>{" "}
            · what&apos;s actually still up for grabs.
          </p>
          {/* Honesty pills · routed through the shared DataStatusBanner
              (UX audit 2026-07-13 · B5d) so /float speaks the SAME
              calm-orange voice as /treasuries + /stack instead of
              hand-rolled divs. variant="pill" keeps them centered under
              the hero copy. Mutually exclusive: fallback wins over
              partial. */}
          <DataStatusBanner
            degraded={data.isFallback}
            variant="pill"
            message="Awaiting first snapshot · showing baseline"
          />
          <DataStatusBanner
            degraded={!data.isFallback && Boolean(data.current.partial)}
            variant="pill"
            message="Partial data · one or more upstream cohorts unavailable today"
          />
        </div>

        <SupplyClock
          snapshot={data.current}
          dailyDelta={data.dailyDelta}
          btcPrice={btcPrice}
          isFallback={data.isFallback}
        />

        {/* Personal scarcity delta · the /stack "since you last
            checked" pattern on the float number (2026-07-11). */}
        {!data.isFallback && (
          <FloatLastVisitDelta inPlayBtc={data.current.inPlay} />
        )}
      </section>

      {/* Sticky answer-anchor (N3 · UX audit 2026-07-13) · keeps the
          in-play float number in view once the clock scrolls off, on
          this 5-6 screen page. Top-anchored · clears the bottom nav. */}
      {!data.isFallback && (
        <StickyAnswerBar
          targetId="float-hero"
          label="In play"
          value={`${(data.current.inPlay / 1e6).toFixed(2)}M`}
        />
      )}

      {/* Inline subscribe prompt · placed right after the Supply
          Clock because that's peak attention ("6.03M and falling ·
          I want to know when it crosses 6.0M"). */}
      <section className="max-w-xl mx-auto px-4 sm:px-6 -mt-4 mb-10">
        <InlineSubscribePrompt
          source="float"
          headline="Get an email when the float crosses a 500K BTC milestone"
          subhead="Down-crossings only · self-deduping"
        />
      </section>

      {/* URGENCY ARC, ACT 2 · where the other coins went. The 21M
          Grid (2,100 squares, one per 10,000 BTC · the most
          screenshot-able thing on the site) shows it; the allocation
          breakdown directly below names every cohort. Grid and
          breakdown are deliberately adjacent (page restructure
          2026-06-29) so "see it" flows straight into "name it".
          data-occlusion-sensitive: the 21M Grid is the most
          screenshot-able surface on the page · the floating subscribe
          chip must yield over it (mobile UX audit 2026-07-13, B2a —
          SupplyClock hero was tagged, this sibling was missed). */}
      <section
        className="max-w-4xl mx-auto px-4 sm:px-6 mb-12"
        data-occlusion-sensitive
      >
        {/* Scrollytelling wrapper (B7 · 2026-07-07): on lg+ the grid
            pins while four caption beats walk the reader through the
            cohorts · captions cite the SAME bucket numbers the squares
            encode (computeSupplyBuckets, single source). Below lg and
            without JS the grid renders exactly as before. */}
        {(() => {
          const b = computeSupplyBuckets(data.current);
          const fmtM = (n: number) => `${(n / 1e6).toFixed(1)}M`;
          return (
            <SupplyStory
              steps={[
                {
                  id: "lost",
                  title: "Act one · the dark mass",
                  body: b.trackedKnown
                    ? `${fmtM(b.lostHeld)} BTC is lost or held by hands that have not moved coins in years. The biggest region of the grid is effectively off the market forever.`
                    : `${fmtM(b.lostHeld)} BTC on the dark squares is lost, held, or in an institutional slice still syncing.`,
                },
                {
                  id: "tracked",
                  title: "Act two · the lock-up",
                  body: b.trackedKnown
                    ? `Governments, ETFs and public companies vault another ${fmtM(b.tracked)} BTC. These buyers absorb supply and almost never give it back.`
                    : "Governments, ETFs and public companies are syncing. Those squares are not counted as empty.",
                },
                {
                  id: "available",
                  title: "Act three · what is left",
                  body: `The orange squares are the entire liquid market: ${fmtM(b.inPlay)} BTC still realistically buyable. This is what every buyer on Earth is competing for.`,
                },
                {
                  id: "all",
                  title: "Every square · 10,000 BTC",
                  body: "Count the orange ones. That scarcity is the whole page in one picture · and it shrinks a little most days.",
                },
              ]}
            >
              <TwentyOneMillionGrid snapshot={data.current} />
            </SupplyStory>
          );
        })()}
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 mb-12">
        <div className="flex justify-end mb-3">
          <ExportButtons
            surface="float"
            filename={`galaxymind-float-${floatExportDate}`}
            rows={floatExportRows}
            json={floatExportJson}
          />
        </div>
        <FloatAllocationBreakdown snapshot={data.current} />
      </section>

      {/* ACT 3 · the line only goes down. */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 mb-12">
        <FloatTrendChartLazy
          history={data.history}
          syntheticHistory={data.syntheticHistory}
        />
      </section>

      {/* ACT 4 · and the refill rate gets cut on a known schedule.
          Stays linkable via the #halving-runway anchor · scroll-mt-20
          keeps the heading clear of the sticky SiteHeader. */}
      <section
        id="halving-runway"
        className="max-w-4xl mx-auto px-4 sm:px-6 mb-12 scroll-mt-20"
      >
        <HalvingRunway blockHeight={data.current.blockHeight} />
        {/* The hashrate cross-sell that sat here was REMOVED 2026-08-13.
            See the note in HomeClient: while bitcoin.org evaluates this
            site as a merchant directory, our own paid product does not
            get promoted across the instrument pages. /hashrate is still
            reachable from the nav and still ships. */}
      </section>

      {/* ACT 5 · your slice, while it lasts. Client-only,
          localStorage-persisted, no network. */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 mb-12">
        <MyFloatShare inPlay={data.current.inPlay} isFallback={data.isFallback} />
      </section>

      {/* Section 5 · Methodology */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 mb-8">
        <FloatMethodology asOf={data.asOf} />
      </section>

      {/* Citation block · freshness timestamp + copy-paste citation,
          mirroring /stack and /treasuries. Sits right after the
          methodology so "how it's computed" flows into "when it was
          last updated · cite it." */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 mb-12">
        <CitationBlock
          pageUrl="https://galaxymind.space/float"
          dataLabel="The Bitcoin Float"
          lastUpdatedISO={data.asOf}
          surface="float"
        />
      </section>

      {/* Section 5.5 · Share surface · the page's only viral surface.
          Sits AFTER the methodology so a visitor only shares once they've
          internalized what the number means · prevents low-quality
          impulse shares. Mobile devices get the native OS share sheet
          via Web Share API; desktop falls back to X compose. */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 mb-12">
        <ShareFloatButton
          inPlay={data.current.inPlay}
          dailyDelta={data.dailyDelta}
        />
      </section>

      {/* Section 6 · Cross-page CTAs · keep the visitor on Galaxy
          Mind by inviting them to the related tools that answer the
          natural follow-up questions: WHO is buying it (treasuries)
          and SHOULD I buy it (the gauge). */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 mb-12">
        <CrossPageCTA
          cards={[
            {
              href: "/today",
              eyebrow: "MORNING HABIT",
              title: "Today in Bitcoin",
              hook: "Float drain + gauge + cheapest treasury in one briefing. Come back every day.",
            },
            {
              href: "/treasuries",
              eyebrow: "WHO'S BUYING IT",
              title: "Treasuries Scoreboard",
              hook: "MSTR, XXI, MPJPY, Strive · the public companies driving the float down.",
            },
            {
              href: "/stack",
              eyebrow: "SHOULD I BUY NOW?",
              title: "The Buying Gauge",
              hook: "10 weighted signals scored 0-100. The dial moves daily.",
            },
          ]}
          tailLink={{
            hint: "Build the daily habit",
            label: "Open today's briefing",
            href: "/today",
          }}
        />
        <p className="mt-4 text-center text-xs text-[var(--text-tertiary)]">
          <a
            href="/embed"
            className="font-mono uppercase tracking-widest text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            Embed the Supply Clock →
          </a>
        </p>
      </section>

      {/* Float-milestone subscribe · page-relevant push channel.
          Default-checks notifyOnFloatMilestone via the COPY map in
          AlertSubscribeCompact so one click delivers the right
          channel. */}
      <AlertSubscribeCompact source="float" />

      {/* Quiet bitcoin-meme-culture flourish · rotating Saylor lines
          in the calm space before the page ends (shared list + the
          gauge loading screen + the 21-click egg = one voice). */}
      <SaylorQuoteStrip />
    </main>
  );
}
