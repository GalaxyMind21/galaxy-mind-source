// /solo-mining-calculator · the odds-calculator pSEO page (2026-08-04).
//
// The one search family that feeds the revenue surface directly:
// "solo mining calculator", "odds of solo mining a block", "chances of
// finding a bitcoin block". Nothing on the SERP answers it with live
// numbers — the calculators that rank are profitability spreadsheets,
// a different question. This page answers the lottery question with the
// SAME pure blockOdds() the /hashrate cards quote, so the two surfaces
// can never disagree, and funnels "could I?" curiosity into the desk's
// rent CTAs.
//
// Every user-facing sentence is an export of lib/hashrate-copy.ts —
// same banned-vocabulary gate as the desk itself.

import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { SiteHeader } from "@/components/SiteHeader";
import { TrackedLink } from "@/components/TrackedLink";
import { getCalculatorDesk } from "@/lib/hashrate";
import { summarizeOpenFleet } from "@/lib/open-fleet";
import { CalculatorClient } from "./CalculatorClient";
import {
  CALC_TITLE,
  CALC_DESCRIPTION,
  CALC_MASTHEAD,
  CALC_SYNCING_NOTE,
  CALC_RENT_LEAD,
  CALC_RENT_LINK,
  CALC_RENT_PRICE,
  CALC_RENT_OPEN,
  CALC_HOWTO_LEAD,
  CALC_HOWTO_LINK,
  CALC_FAQ_ITEMS,
  FAQ_TITLE,
} from "@/lib/hashrate-copy";
import { safeJsonLd } from "@/lib/json-ld";

const SITE_URL = "https://galaxymind.space";
const URL_ = `${SITE_URL}/solo-mining-calculator`;

export const metadata: Metadata = {
  title: CALC_TITLE,
  description: CALC_DESCRIPTION,
  alternates: { canonical: URL_ },
  openGraph: {
    type: "website",
    title: CALC_TITLE,
    description: CALC_DESCRIPTION,
    url: URL_,
    // Sibling opengraph-image.tsx — a card that carries this page's own
    // question. An openGraph block without images ships NO og:image.
    images: [
      {
        url: "/solo-mining-calculator/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Solo mining odds calculator · could you find a bitcoin block?",
      },
    ],
  },
};

export const revalidate = 300;

async function CalculatorContent() {
  const desk = await getCalculatorDesk();

  if (
    desk.networkPhs == null ||
    desk.btcUsd == null ||
    desk.blockRewardBtc == null
  ) {
    return (
      <section className="mt-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <p className="micro-label text-[var(--text-tertiary)]">SYNCING</p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {CALC_SYNCING_NOTE}
        </p>
      </section>
    );
  }

  // Live entry-ticket + open capacity for the rent CTA · same pure
  // summary the HashrateStrip and BlockShot chooser use. Absent when
  // nothing is rentable — never invented.
  const open = summarizeOpenFleet(desk.ourRigs);
  // Flagship, not the floor · the cheapest open machine is 12 TH and
  // quoting its ten-cent window as the entry price undersold the fleet
  // on both surfaces. See the note on minDayBtc in lib/open-fleet.
  const minThreeHourUsd =
    open.flagshipDayBtc != null ? open.flagshipDayBtc * desk.btcUsd : null;

  return (
    <div className="mt-8 space-y-6">
      <CalculatorClient
        networkPhs={desk.networkPhs}
        prizeUsd={desk.blockRewardBtc * desk.btcUsd}
        ourOpenTh={open.openTh}
      />

      <section className="rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-5">
        <p className="text-sm text-[var(--text-secondary)]">
          {CALC_RENT_LEAD}{" "}
          <TrackedLink
            event="calc_rent_click"
            href="/hashrate#your-shot"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            {CALC_RENT_LINK}
          </TrackedLink>
          .
          {open.openTh > 0 && (
            <>
              {" "}
              {CALC_RENT_OPEN.replace(
                "{TH}",
                open.openTh.toLocaleString("en-US"),
              )}
            </>
          )}
          {minThreeHourUsd != null && (
            <>
              {" "}
              {CALC_RENT_PRICE.replace(
                "{PRICE}",
                `$${minThreeHourUsd.toFixed(2)}`,
              )}
            </>
          )}
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {CALC_HOWTO_LEAD}{" "}
          <Link
            href="/hashrate/how-to-rent"
            className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          >
            {CALC_HOWTO_LINK}
          </Link>
          .
        </p>
      </section>

      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <p className="micro-label text-[var(--text-tertiary)]">{FAQ_TITLE}</p>
        <dl className="mt-3 space-y-4">
          {CALC_FAQ_ITEMS.map((item) => (
            <div key={item.q}>
              <dt className="text-sm font-semibold text-[var(--text-primary)]">
                {item.q}
              </dt>
              <dd className="mt-1 text-sm text-[var(--text-secondary)]">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-sm text-[var(--text-tertiary)]">
        Related:{" "}
        <Link
          href="/bitcoin-halving-countdown"
          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
        >
          the halving countdown
        </Link>{" "}
        ·{" "}
        <Link
          href="/float"
          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
        >
          how much bitcoin is left
        </Link>
      </p>
    </div>
  );
}

export default async function SoloMiningCalculatorPage() {
  const nonce = (await headers()).get("x-galaxymind-nonce") ?? undefined;
  return (
    <>
      {/* SiteHeader is NOT inherited from the root layout — every page
          mounts it itself (see the /hashrate lesson). */}
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {/* FAQPage · same CALC_FAQ_ITEMS the page renders — markup and
            prose share one gated source and can never disagree. */}
        <script
          type="application/ld+json"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: safeJsonLd({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: CALC_FAQ_ITEMS.map((item) => ({
                "@type": "Question",
                name: item.q,
                acceptedAnswer: { "@type": "Answer", text: item.a },
              })),
            }),
          }}
        />
        <h1 className="display-title">
          Solo mining <span className="headline-gradient">odds</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--text-secondary)]">
          {CALC_MASTHEAD}
        </p>
        <Suspense
          fallback={
            <div className="mt-8 h-64 animate-pulse rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]" />
          }
        >
          <CalculatorContent />
        </Suspense>
      </main>
    </>
  );
}
