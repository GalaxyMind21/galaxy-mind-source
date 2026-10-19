// /bitcoin-halving-countdown · live countdown catalyst page (2026-06-10).
//
// "Bitcoin halving countdown" is one of the highest-volume evergreen
// Bitcoin queries and every input was already computed in
// lib/bitcoin-supply.ts (block height via the float snapshot, halving
// schedule, subsidy math). This page is the search-intent doorway;
// /float carries the deeper supply story and /stack the timing tool.
//
// Date precision: we render the estimate as "Month YYYY", not a full
// date · block times wobble enough that a to-the-day countdown would
// be false precision. The days/blocks numbers are exact-as-of-render
// (ISR every 30 min, same cadence as the float page).

import type { Metadata } from "next";
import { pageOgImage } from "@/lib/og";
import Link from "next/link";
import { headers } from "next/headers";
import { safeJsonLd } from "@/lib/json-ld";
import { SiteHeader } from "@/components/SiteHeader";
import { CrossPageCTA } from "@/components/CrossPageCTA";
import { getFloatData } from "@/lib/float-data";
import { XSELL_HALVING_LEAD, XSELL_HALVING_LINK } from "@/lib/hashrate-copy";
import {
  HALVING_SCHEDULE,
  blockSubsidyAt,
  daysUntilNextHalving,
  nextHalvingHeight,
} from "@/lib/bitcoin-supply";

export const revalidate = 1800;

const SITE_URL = "https://galaxymind.space";
const URL = `${SITE_URL}/bitcoin-halving-countdown`;
const TITLE = "Bitcoin Halving Countdown · Live Days, Blocks & Date Estimate";
const DESCRIPTION =
  "Live countdown to the next Bitcoin halving: days remaining, blocks left, estimated date, and what the issuance cut does to the supply still available to buy.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { type: "website", url: URL, title: TITLE, description: DESCRIPTION, siteName: "Galaxy Mind", images: pageOgImage("/bitcoin-halving-countdown/opengraph-image", TITLE) },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, creator: "@GalaxyMind" },
  alternates: { canonical: URL },
};

export default async function HalvingCountdownPage() {
  const data = await getFloatData();
  const height = data.current.blockHeight;
  const nextHeight = nextHalvingHeight(height);
  const blocksLeft = nextHeight - height;
  const days = daysUntilNextHalving(height);
  const est = new Date(Date.now() + days * 86_400_000);
  const estLabel = est.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const subsidyNow = blockSubsidyAt(height);
  const subsidyNext = blockSubsidyAt(nextHeight);
  const dailyNow = Math.round(subsidyNow * 144);
  const dailyNext = Math.round(subsidyNext * 144);
  const nextOrdinal = HALVING_SCHEDULE.find((h) => h.height === nextHeight)?.ordinal;

  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${URL}#webpage`,
        url: URL,
        name: TITLE,
        description: DESCRIPTION,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        publisher: { "@id": `${SITE_URL}/#org` },
        dateModified: data.asOf,
        inLanguage: "en-US",
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "When is the next Bitcoin halving?",
            acceptedAnswer: {
              "@type": "Answer",
              text: `The next Bitcoin halving happens at block ${nextHeight.toLocaleString("en-US")} · about ${blocksLeft.toLocaleString("en-US")} blocks (~${days} days) from now, landing around ${estLabel}. The estimate assumes the long-run average of one block every 10 minutes; actual block times wobble, so the month is reliable while an exact day would be false precision.`,
            },
          },
          {
            "@type": "Question",
            name: "What happens at a Bitcoin halving?",
            acceptedAnswer: {
              "@type": "Answer",
              text: `The block subsidy · the brand-new bitcoin paid to miners with each block · is cut in half. At the next halving it drops from ${subsidyNow} BTC to ${subsidyNext} BTC per block, which cuts new daily issuance from roughly ${dailyNow} BTC to ${dailyNext} BTC. Demand that previously absorbed all new supply suddenly faces half the inflow.`,
            },
          },
          {
            "@type": "Question",
            name: "Why does the halving matter for the price of bitcoin?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Issuance is the only source of new bitcoin, and the halving cuts it in half on a fixed schedule while lost coins, ETFs, and corporate treasuries keep removing supply from circulation. If demand merely holds steady, the demand-to-new-supply ratio doubles overnight. That structural squeeze · not the event day itself · is why accumulators track the countdown.",
            },
          },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)] pb-16">
      {/* SAFE: static, server-controlled JSON-LD · safeJsonLd escapes. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
      />
      <SiteHeader />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 text-center">
        <div className="micro-label text-[var(--text-tertiary)] mb-2">
          Live Countdown{nextOrdinal ? ` · Halving #${nextOrdinal}` : ""}
        </div>
        <h1 className="display-title">
          The Next Bitcoin Halving
        </h1>

        <div className="mt-8 font-mono text-6xl sm:text-7xl text-[var(--accent-ink)] font-semibold tabular-nums leading-none">
          {days.toLocaleString("en-US")}
        </div>
        <div className="micro-label mt-2 text-[var(--text-secondary)]">
          days · estimated {estLabel}
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-3 t-xs font-medium text-[var(--text-tertiary)]">
          <span className="px-3 py-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
            <span className="text-[var(--text-secondary)] tabular-nums">
              {blocksLeft.toLocaleString("en-US")}
            </span>{" "}
            blocks left
          </span>
          <span className="px-3 py-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
            height{" "}
            <span className="text-[var(--text-secondary)] tabular-nums">
              {height.toLocaleString("en-US")}
            </span>
          </span>
          <span className="px-3 py-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
            subsidy{" "}
            <span className="text-[var(--text-secondary)] tabular-nums">
              {subsidyNow} → {subsidyNext} BTC
            </span>
          </span>
        </div>
        {data.isFallback && (
          <div className="mt-4 inline-block px-3 py-1 rounded-full border border-[var(--warning)]/40 bg-[var(--warning)]/10 font-mono t-xs tracking-[0.2em] uppercase text-[var(--warning)]">
            ⚠ Block height from fallback baseline · refreshing
          </div>
        )}
      </section>

      <section className="max-w-2xl mx-auto px-4 sm:px-6 mt-12">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6">
          <h2 className="font-mono text-sm uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-3">
            What actually changes
          </h2>
          <p className="text-sm sm:text-base text-[var(--text-secondary)] font-sans leading-relaxed">
            Every block pays miners a fixed subsidy of brand-new bitcoin.
            The halving cuts that subsidy in half · from{" "}
            <strong className="text-[var(--accent-ink)]">{subsidyNow} BTC</strong>{" "}
            to{" "}
            <strong className="text-[var(--accent-ink)]">{subsidyNext} BTC</strong>{" "}
            per block · which drops new daily supply from roughly{" "}
            <strong className="text-[var(--text-primary)]">{dailyNow} BTC</strong>{" "}
            to{" "}
            <strong className="text-[var(--text-primary)]">{dailyNext} BTC</strong>
            . Demand that used to absorb the full daily inflow suddenly
            faces half as much for sale from miners. That ratchet has
            fired every four years since 2012 and is fixed in the
            protocol; no committee can change it.
          </p>
          {/* Revenue cross-link · the one audience segment already
              thinking about blocks and miners. Copy is gated hashrate
              prose (lib/hashrate-copy). */}
          <p className="mt-3 text-sm text-[var(--text-secondary)] font-sans leading-relaxed">
            {XSELL_HALVING_LEAD}{" "}
            <Link
              href="/hashrate#your-shot"
              className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              {XSELL_HALVING_LINK}
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="max-w-2xl mx-auto px-4 sm:px-6 mt-8">
        <h2 className="font-mono text-sm uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-4">
          Halving schedule
        </h2>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
          <table className="w-full text-left font-mono t-xs">
            <thead>
              <tr className="t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="px-4 py-2.5 font-medium">Block</th>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium text-right">Subsidy after</th>
              </tr>
            </thead>
            <tbody>
              {/* Show through one past the NEXT halving (min 6 rows) so
                  the highlighted row can never fall off the table as
                  halvings pass (review 2026-06-10). */}
              {HALVING_SCHEDULE.filter(
                (h) => h.ordinal <= Math.max(6, (nextOrdinal ?? 5) + 1),
              ).map((h) => {
                const isNext = h.height === nextHeight;
                return (
                  <tr
                    key={h.ordinal}
                    className={`border-b border-[var(--border-subtle)] last:border-b-0 ${
                      isNext ? "bg-[var(--accent)]/10" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 text-[var(--text-tertiary)]">
                      {h.ordinal}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
                      {h.height.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                      {h.date
                        ? new Date(h.date).toLocaleDateString("en-US", {
                            month: "short",
                            year: "numeric",
                            timeZone: "UTC",
                          })
                        : isNext
                          ? `~${estLabel} · next`
                          : "projected"}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-right text-[var(--accent-ink)]">
                      {h.subsidy} BTC
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="max-w-2xl mx-auto px-4 sm:px-6 mt-12">
        <CrossPageCTA
          cards={[
            {
              href: "/float",
              eyebrow: "THE SUPPLY SIDE",
              title: "The Bitcoin Float",
              hook: "How much bitcoin is actually left to buy · live tracker with the halving runway built in.",
            },
            {
              href: "/stack",
              eyebrow: "THE TIMING SIDE",
              title: "The Buying Gauge",
              hook: "10 weighted signals scored 0-100, updated daily. The halving sets the supply; this answers the when.",
            },
          ]}
        />
      </section>
    </main>
  );
}
