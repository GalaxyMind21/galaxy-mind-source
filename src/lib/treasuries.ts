// Metadata for the public bitcoin treasury companies tracked on /treasuries.
// The live numbers (price, market cap, BTC holdings, mNAV) come from
// lib/market.ts via the existing bitcointreasuries.net + Yahoo Finance
// pipeline. This file is the static "what does this ticker actually mean"
// layer — names, descriptions, a one-liner on the company's bitcoin thesis.

import type { Ticker } from "./market";

export type TreasuryMeta = {
  ticker: Ticker;
  name: string;
  // Country of primary listing — drives the flag emoji shown next to the name.
  country: "US" | "JP";
  // Plain-language description of what the company does. One sentence.
  blurb: string;
  // Marketing url (the company's IR page if available, otherwise main site).
  href: string;
  // SEC EDGAR Central Index Key · null for non-US-listed treasuries (JP
  // filers go through TDnet/JPX which we don't ingest yet). Numeric form
  // is what EDGAR's API uses; we zero-pad to 10 digits at fetch time.
  // Lookup source: sec.gov/files/company_tickers.json (canonical map).
  cik: number | null;
};

// Order chosen by current notable-ness in the bitcoin treasury conversation;
// the table re-sorts dynamically based on user selection.
export const TREASURY_META: Record<Ticker, TreasuryMeta> = {
  MSTR: {
    ticker: "MSTR",
    name: "Strategy",
    country: "US",
    blurb:
      "The original. Software company that pivoted to a leveraged bitcoin treasury strategy in 2020 · now the largest public BTC holder.",
    href: "https://www.strategy.com/",
    cik: 1050446,
  },
  XXI: {
    ticker: "XXI",
    name: "Twenty One Capital",
    country: "US",
    blurb:
      "Tether-controlled, Cantor-backed bitcoin-native treasury led by Jack Mallers (founder of Strike). Built from day one to accumulate BTC. Tether bought out SoftBank's founding stake in May 2026 to take majority control.",
    // Operator correction (audit 2026-05): the canonical site is
    // xxi.money, not twentyonecap.com.
    href: "https://xxi.money",
    cik: 2070457,
  },
  MPJPY: {
    ticker: "MPJPY",
    name: "Metaplanet",
    country: "JP",
    blurb:
      "Japan's largest bitcoin treasury (~40k BTC). Pivoted from hospitality to relentless BTC accumulation, funded by serial zero-coupon bond issuances and a new perpetual-preferred stack (the MERCURY series, with a senior MARS series planned).",
    href: "https://metaplanet.jp/",
    // Japan-listed · TDnet/JPX disclosures, not in EDGAR. Out of scope
    // for the SEC filings panel; future work could ingest TDnet.
    cik: null,
  },
  ASST: {
    ticker: "ASST",
    name: "Strive Inc",
    country: "US",
    blurb:
      "Vivek Ramaswamy's asset manager turned bitcoin treasury, listed via the Asset Entities reverse merger. Debt-free, funding its BTC stack through the 13% SATA perpetual preferred. The anti-ESG investment products run alongside the treasury thesis.",
    href: "https://strive.com/",
    cik: 1920406,
  },
};

export const COUNTRY_FLAG: Record<TreasuryMeta["country"], string> = {
  US: "🇺🇸",
  JP: "🇯🇵",
};

// Plain-language interpretation of mNAV. Used by both the cheapest callout
// and the table's hover state. The thresholds here mirror the normMNAV
// thresholds in lib/stack.ts so the /treasuries copy stays consistent
// with the verdict on /stack.
export function mNavInterpretation(mNav: number | null): {
  label: string;
  detail: string;
  bias: "cheap" | "fair" | "rich" | "unknown";
} {
  if (mNav == null || !Number.isFinite(mNav)) {
    return {
      label: "Unavailable",
      detail: "Live data not reporting.",
      bias: "unknown",
    };
  }
  if (mNav < 1.0) {
    const pct = ((1 - mNav) * 100).toFixed(0);
    return {
      label: "Below NAV",
      detail: `Market cap is ${pct}% below the value of the bitcoin it holds. Historically a strong accumulation signal. The smart money has stopped paying a premium.`,
      bias: "cheap",
    };
  }
  if (mNav < 1.05) {
    return {
      label: "At NAV",
      detail:
        "Market cap roughly equal to the bitcoin it holds. No premium, no discount.",
      bias: "fair",
    };
  }
  if (mNav < 1.6) {
    const pct = ((mNav - 1) * 100).toFixed(0);
    return {
      label: `+${pct}% premium`,
      detail: `Market cap trades ${pct}% above the bitcoin it holds. The market is paying for management, leverage capacity, or growth.`,
      bias: "fair",
    };
  }
  const pct = ((mNav - 1) * 100).toFixed(0);
  return {
    label: `+${pct}% premium`,
    detail: `Market cap is ${pct}% above the bitcoin it holds. Rich · historically a yellow flag for fresh entries at this premium.`,
    bias: "rich",
  };
}

/**
 * Is the treasury FEED gone, as opposed to one company having a quiet day?
 *
 * `snapshot-treasuries` already refuses to write a row whose every numeric
 * field is null, so a single bad ticker never poisons the history. What had
 * no consequence until 2026-09-11 was the difference between one refusal
 * and all of them: the cron reported `ok: true` either way, so the month
 * the bitcointreasuries parser was broken (SvelteKit moved the entity rows
 * from nodes[1] to nodes[2]) the dashboard stayed green while /treasuries,
 * /fit's diversifier, /today's cheapest mNAV, the /stack mNAV signal and
 * the treasury OG card were all dark.
 *
 * Pure so it can be swept in verify — the route around it cannot be.
 *
 * Quiet on an empty roster (nothing tracked is not a failure) and quiet
 * when rows were merely skipped for idempotency, which is what a same-day
 * re-run produces.
 */
export function isTreasuryFeedDown(opts: {
  /** Tickers the snapshot carried at all. */
  tracked: number;
  /** Tickers refused because every numeric field was null. */
  refused: number;
}): boolean {
  return opts.tracked > 0 && opts.refused === opts.tracked;
}

/**
 * Live board emptiness · every tracked ticker has no mNAV.
 *
 * Distinct from `isTreasuryFeedDown` (cron write refusals) and from
 * `isMarketSnapshotDegraded` (4-of-8 gauge signals). A total treasury
 * outage trips only MSTR mNAV of those eight, so /api/status and the
 * /treasuries banner stayed green while every row said Unavailable.
 */
export function isTreasuryBoardEmpty(
  treasuries: ReadonlyArray<{ mNAV: number | null }>,
): boolean {
  return treasuries.length > 0 && treasuries.every((t) => t.mNAV == null);
}
