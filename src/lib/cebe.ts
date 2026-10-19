// CEBE · Common Equity Bitcoin Exposure.
//
// CEBE (framework: Bobby Tierney, 2025; mirrors Michael Saylor's
// "Digital Credit Amplification" math, Strategy World 2026) measures the
// Bitcoin backing each COMMON share AFTER senior claims — debt and
// preferred stock that get paid before common holders. It's the
// conservative, net-of-leverage counterpart to the gross "BTC per share"
// (BPS) growth metric, and it answers the gross-vs-net mNAV question the
// /treasuries methodology already raises: our standard mNAV divides
// market cap by the GROSS value of the bitcoin held; the CEBE-based NET
// mNAV divides by the bitcoin actually left for common shareholders.
//
//   senior claims (USD) = debt + preferred − cash
//   net BTC value       = BTC holdings × spot − senior claims
//   net mNAV            = common market cap ÷ net BTC value
//   claims %            = senior claims ÷ (BTC holdings × spot)
//
// Reference: https://www.cebetracker.io (framework + methodology).
//
// DATA SOURCING: senior-claims figures are point-in-time balance-sheet
// items hand-sourced from SEC filings and reviewed quarterly — the same
// pattern as the /float slow-mover constants. cebetracker.io has no
// public API, and a company's debt/preferred/cash aren't in the
// bitcointreasuries.net feed, so this is the robust, citable path: we
// own and date the numbers. A `null` entry means CEBE is PENDING for
// that ticker (figures not yet reliably sourced) — the UI shows
// "pending" rather than a guess.

import type { Quote, Ticker } from "./market";

export type SeniorClaims = {
  /** Total debt · convertible notes principal + other borrowings (USD millions). */
  debtUsdM: number;
  /** Preferred stock liquidation/carrying value, senior to common (USD millions). */
  preferredUsdM: number;
  /** Cash & equivalents netted against claims (USD millions). */
  cashUsdM: number;
  /** ISO date of the source balance sheet. */
  asOf: string;
  /** Citation for the figures. */
  source: string;
};

// Per-ticker senior capital stack. Reviewed quarterly · update `asOf`
// and `source` on each refresh. `null` ⇒ CEBE pending for that ticker.
export const SENIOR_CLAIMS: Record<Ticker, SeniorClaims | null> = {
  MSTR: {
    // Refreshed 2026-09-11 off the Q2 2026 10-Q (period ended 6/30/26,
    // filed 8/3/26) — the balance sheet rather than the press release the
    // previous values came from.
    //
    // Convertible senior notes, aggregate PRINCIPAL: $6,713,659,000 across
    // six series (2028 $1,010.0M · 2029 $1,500.0M · 2030A $800.0M ·
    // 2030B $2,000.0M · 2031 $603.7M · 2032 $800.0M).
    //
    // Series A Perpetual Preferred (STRC/STRF/STRK/STRD/STRE): 153,529
    // shares, aggregate liquidation preference $15,462,056,000. The 10-Q
    // does not break the preference out by series, so this is the stack
    // total and cannot be attributed per ticker.
    //
    // DIRECTION MATTERS HERE, and it reversed. This constant used to be
    // refreshed against ISSUANCE, on the assumption Strategy only adds to
    // the stack. It is now REPURCHASING: the 9/8/26 8-K reports 1,810,885
    // STRC shares bought back for $176.3M in the week to 9/7 alone, and the
    // board lifted the Digital Credit Securities Repurchase Program from
    // $1.0B to $2.0B. So the 6/30 preference is an UPPER bound on today's,
    // which is the conservative direction: overstating senior claims
    // understates CEBE, and CEBE is documented as a floor. Do not "correct"
    // it upward toward a newer issuance number without checking the
    // repurchase side of the same period.
    //
    // Cash stays 0 on purpose. The company held $1,711.8M cash and $736.1M
    // short-term investments at 6/30, but that balance is earmarked for
    // dividends and interest on the very claims being netted here, so
    // counting it as free cash would double-count the coverage.
    debtUsdM: 6713.7,
    preferredUsdM: 15462.1,
    cashUsdM: 0,
    // The BALANCE-SHEET date, not the review date · a reader should be able
    // to see how old the figures actually are.
    asOf: "2026-06-30",
    source:
      "Strategy Q2 2026 10-Q (filed 2026-08-03) · $6,713.659M convertible principal + $15,462.056M preferred liquidation preference; repurchase direction confirmed in the 2026-09-08 8-K",
  },
  XXI: {
    // 1.00% convertible senior notes due 2030 (~$484M carrying, 3/31/26).
    // No preferred · Tether/SoftBank/Bitfinex BTC was contributed as
    // equity, not a senior claim. Re-reviewed 2026-07-08 · no cleaner
    // public update found; keep Q1 carrying value.
    debtUsdM: 484,
    preferredUsdM: 0,
    cashUsdM: 0,
    // Filing date remains Q1; freshness cadence tracks last review.
    asOf: "2026-07-08",
    source:
      "Twenty One Capital 424B3 / Q1 2026 carrying value; re-reviewed 2026-07-08 (no cleaner public update)",
  },
  ASST: {
    // Debt-free as of May 2026 · repurchased the $9.7M long-term notes
    // that were on the 3/31 balance sheet. Preferred = SATA, the 13%
    // Variable Rate Series A Perpetual Preferred: 4,373,194 shares ×
    // ~$100 liquidation = $437.3M redemption value (Q1 2026 10-Q). Cash
    // $87.6M (May 12 8-K). Net senior claims ≈ $349.7M.
    debtUsdM: 0,
    preferredUsdM: 437.3,
    cashUsdM: 87.6,
    asOf: "2026-07-08",
    source:
      "Strive Q1 2026 10-Q (SATA $437.3M) + May 2026 8-K (debt-free, cash $87.6M); re-reviewed 2026-07-08",
  },
  // PENDING · Japan-listed (TDnet/JPX, not in EDGAR). Confirmed it does
  // carry a senior stack — serial zero-coupon bonds (20+ issuances) plus
  // the MERCURY $150M perpetual preferred, with a senior MARS series
  // planned — but the TOTAL outstanding bond debt isn't cleanly
  // reconcilable from public JP disclosures, and the preferred listing
  // was delayed (May 2026). Left pending rather than understate claims by
  // guessing debt=0 when bonds exist. Revisit once a clean balance-sheet
  // total is sourceable.
  MPJPY: null,
};

export type CebeMetrics = {
  /** True when senior-claims data exists and the live inputs are present. */
  available: boolean;
  /** As-of date of the senior-claims figures (or null when pending). */
  asOf: string | null;
  /** Citation for the senior-claims figures (or null when pending). */
  source: string | null;
  /** debt + preferred − cash, USD millions. */
  seniorClaimsUsdM: number | null;
  /** Senior claims as a share of gross BTC value (0.34 = 34%). */
  claimsPct: number | null;
  /** Net mNAV · market cap ÷ (BTC value − senior claims). Null if claims ≥ BTC value. */
  netMNav: number | null;
  /** Enterprise / fully-diluted mNAV · (market cap + debt + preferred − cash) ÷ BTC value. Saylor's "include the notional value of convertible debt, preferred, and common" lens (BTC Prague 2026). Always ≥ gross mNAV; brackets the debate alongside the CEBE net view. Null when CEBE pending. */
  evMNav: number | null;
  /** CEBE BPS · net (after-claims) bitcoin per $100 of stock. Saylor's "CEBE BPS" expressed per $100. */
  cebeSatsPer100: number | null;
  /** BPS · GROSS bitcoin per $100 of stock, BEFORE senior claims. Saylor's "BPS" expressed per $100. Needs only market cap + holdings, so it is available even when CEBE is pending (e.g. MPJPY). */
  grossSatsPer100: number | null;
  /** Amplification · BPS ÷ CEBE BPS (= holdings ÷ net-of-claims holdings). 1.0× means no senior leverage — the stock tracks BTC like an ETF. Higher means each share carries more gross BTC than it nets after claims · the lever that can outperform OR underperform BTC. Null when CEBE pending. */
  amplificationRatio: number | null;
};

const PENDING: Omit<CebeMetrics, "asOf" | "source"> = {
  available: false,
  seniorClaimsUsdM: null,
  claimsPct: null,
  netMNav: null,
  evMNav: null,
  cebeSatsPer100: null,
  grossSatsPer100: null,
  amplificationRatio: null,
};

/**
 * Compute CEBE / net-mNAV metrics for one treasury quote. Returns a
 * pending shape (available:false) when senior-claims data is missing or
 * any live input (market cap, BTC holdings, share price, spot) is null.
 */
export function computeCebe(quote: Quote, btcPrice: number | null): CebeMetrics {
  const claims = SENIOR_CLAIMS[quote.ticker];

  // BPS (gross sats per $100 of stock, before any senior claims) needs
  // only market cap + holdings — no claims data, no spot — so it is
  // available even for tickers whose CEBE is still pending (e.g. MPJPY).
  // sats per $100 = holdings × 1e8 sats ÷ (market cap USD) × $100
  //              = holdings × 1e4 ÷ marketCapM.
  const grossSatsPer100 =
    quote.marketCapM != null &&
    quote.marketCapM > 0 &&
    quote.btcHoldings != null &&
    quote.btcHoldings > 0
      ? (quote.btcHoldings * 10_000) / quote.marketCapM
      : null;

  if (
    !claims ||
    quote.marketCapM == null ||
    quote.btcHoldings == null ||
    quote.price == null ||
    btcPrice == null ||
    btcPrice <= 0 ||
    quote.price <= 0 ||
    quote.btcHoldings <= 0
  ) {
    return {
      ...PENDING,
      grossSatsPer100,
      asOf: claims?.asOf ?? null,
      source: claims?.source ?? null,
    };
  }

  const btcValueM = (quote.btcHoldings * btcPrice) / 1_000_000;
  const seniorClaimsUsdM = claims.debtUsdM + claims.preferredUsdM - claims.cashUsdM;
  const claimsPct = btcValueM > 0 ? seniorClaimsUsdM / btcValueM : null;
  const netBtcValueM = Math.max(0, btcValueM - seniorClaimsUsdM);
  const netMNav = netBtcValueM > 0 ? quote.marketCapM / netBtcValueM : null;

  // Enterprise / fully-diluted mNAV · Saylor's "include the notional"
  // lens: add senior claims to the numerator instead of subtracting from
  // the BTC side. (market cap + debt + preferred − cash) ÷ BTC value.
  // Always ≥ gross; the other bookend to CEBE-net in the valuation debate.
  const evMNav =
    btcValueM > 0 ? (quote.marketCapM + seniorClaimsUsdM) / btcValueM : null;

  // CEBE sats per $100 of stock. shares = market cap ÷ price; net BTC
  // per share = (holdings − claims-in-BTC) ÷ shares; ×1e8 sats ×$100 ÷ price.
  const shares = (quote.marketCapM * 1_000_000) / quote.price;
  const claimsBtc = (seniorClaimsUsdM * 1_000_000) / btcPrice;
  const cebePerShareBtc =
    shares > 0 ? (quote.btcHoldings - claimsBtc) / shares : null;
  const cebeSatsPer100 =
    cebePerShareBtc != null
      ? (cebePerShareBtc * 100_000_000 * 100) / quote.price
      : null;

  // Amplification · how much MORE gross BTC each share carries vs net of
  // senior claims (Saylor: "the difference between BPS and CEBE BPS is
  // Amplification"). 1.0× with no debt/preferred (tracks BTC like an
  // ETF); rises with senior leverage. Equivalent to holdings ÷
  // (holdings − claims-in-BTC); computed as the BPS ÷ CEBE BPS ratio.
  const amplificationRatio =
    grossSatsPer100 != null && cebeSatsPer100 != null && cebeSatsPer100 > 0
      ? grossSatsPer100 / cebeSatsPer100
      : null;

  return {
    available: true,
    asOf: claims.asOf,
    source: claims.source,
    seniorClaimsUsdM,
    claimsPct,
    netMNav,
    evMNav,
    cebeSatsPer100,
    grossSatsPer100,
    amplificationRatio,
  };
}
