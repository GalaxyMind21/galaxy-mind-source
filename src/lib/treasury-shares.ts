// Treasury share-count overrides · market-cap source of record.
//
// WHY THIS EXISTS: the /treasuries dashboard sources market cap from
// bitcointreasuries.net (lib/market.ts uses min(market_cap_basic,
// market_cap_fully_diluted)). That feed lags ATM dilution and new
// issuance on fast-growing treasury names — it keeps stamping a stale,
// LOWER share count, which under-prints market cap and therefore biases
// our gross mNAV (and the CEBE net mNAV, the cheapest-callout, and the
// /fit diversifier pick) LOW.
//
// Audit 2026-06-14 (operator flagged ASST) confirmed two live breaks,
// both the same failure mode — the feed's implied share count
// (feedMarketCap / price) was materially below the company's latest
// SEC/exchange filing:
//   · ASST  feed implied ~62.0M shares vs filed 79.19M (A+B) → mkt cap
//           ~22% low, mNAV read 0.77 when the truth is ~0.98 (at NAV).
//   · MPJPY feed implied ~1,141M shares vs ~1,281M on the TSE → mkt cap
//           ~7% low, mNAV read 0.67 when the truth is ~0.72.
// MSTR and XXI were accurate as fed (MSTR ~351M basis correct; XXI
// correctly uses Class-A-only ~346.8M — its Class B is voting-only with
// no economic rights), so they keep using the feed (override = null).
//
// THE FIX: for an overridden ticker we recompute
//   market cap = (filed economic common shares) × (live price)
// using the live Yahoo price already in the Quote, so the figure still
// tracks the market daily — only the share count is the dated constant.
// This also keeps the page internally consistent (price × shares = cap).
//
// DATA SOURCING: same pattern as lib/cebe.ts — share counts are
// point-in-time, hand-sourced from primary filings, dated, and reviewed
// whenever a new filing lands. A `null` entry means "trust the feed for
// this ticker." Refresh cadence for the overridden names is FAST: ASST
// runs a weekly ATM and files an 8-K most weeks; Metaplanet is issuing
// heavily. The drift guard below logs when the feed overtakes our
// constant, i.e. when our number has gone stale and needs a bump.

import type { Ticker } from "./market";

// The date the filing-sourced share-count override went live. For the
// overridden names (ASST, MPJPY) the published market cap (and therefore
// gross BPS) steps on this day as a one-time methodology correction, NOT
// real dilution. BTC-Yield windows that span it would read a spurious
// jump, so the yield helper excludes snapshots before this floor for
// overridden tickers. The first corrected daily snapshot is dated here.
export const SHARE_BASIS_CORRECTED_ON = "2026-06-14";

export type ShareCount = {
  /** Total economic common shares (all economic classes), MILLIONS. */
  sharesM: number;
  /** ISO date of the source filing. */
  asOf: string;
  /** Citation for the figure. */
  source: string;
  /** Optional caveat (dual-class basis, OTC-vs-home-listing, etc.). */
  note?: string;
};

// Per-ticker economic common-share count of record. Reviewed on each
// new filing · update `sharesM`, `asOf`, `source` on refresh. `null` ⇒
// no override (the bitcointreasuries.net feed market cap is accurate
// for this ticker and is used as-is).
export const SHARE_COUNTS: Record<Ticker, ShareCount | null> = {
  // Feed accurate (~351M basis, ATM-adjusted). No override.
  MSTR: null,
  // Feed accurate. XXI is a SPAC dual-class structure: Class A
  // (~346.8M, public, economic) + Class B (~304.8M, Tether/Bitfinex)
  // that "carry no economic rights and are not entitled to dividends or
  // distributions" per the 10-Q — so economic market cap is Class-A
  // ONLY, which the feed already uses. Do NOT add Class B here, and
  // never source XXI cap from Finviz/WallStreetZen (they wrongly sum
  // A+B to ~$3.76B, which would halve mNAV).
  XXI: null,
  // OVERRIDE · Metaplanet (TSE:3350). Feed used a stale ~1,141M share
  // basis; the H1-2026 issuance took the count to ~1.281B. NOTE: our
  // displayed price is the OTC MTPLF USD quote (~$1.51), which trades
  // at a ~4% premium to the FX-converted TSE local price, so shares ×
  // our-price lands a few % above the pure TSE-derived market cap — an
  // accepted, documented residual (far better than the feed's −7%), and
  // it keeps price × shares internally consistent on the page. Heavy
  // dilution overhang (stock-acquisition-rights) → refresh often.
  MPJPY: {
    sharesM: 1281.28,
    asOf: "2026-08-18",
    source:
      "Issued common 1,281,283,624 as of 2026-06-30 (company IR, cited in the 2026-08-18 10th-Series SAR amendment). July 2026: no 25th–27th series exercises (company notice 2026-08-03), so issued stayed ~1.281B. The 2026-08-18 notice treats 319,464,000 fixed potential shares as ~24.9% of end-July issued, which matches that same 1.281B basis.",
    note: "OTC MTPLF price carries a ~4% premium to FX-converted TSE local; mkt cap = shares × OTC price runs ~4% above the TSE-derived figure. The Superplanet transaction (see below) does NOT touch this count — it is paid in bitcoin and cash, not in new Metaplanet equity.",
  },
  /* ── THE SUPERPLANET TRANSACTION · read before touching MPJPY ───────
   * On 2026-08-18 Super League Enterprise, Inc. (NASDAQ:SLE, CIK
   * 0001621672) agreed to issue 44,859,400 common shares at $3.00, 100
   * shares of "Strategic Alliance Preferred", and warrants over up to
   * 381,000,000 shares, to Metaplanet Holdings, Inc. — a Florida
   * corporation wholly owned by Metaplanet, Inc. (TSE:3350).
   *
   * Consideration is 2,100 BITCOIN plus $2,500,000 in cash. That is the
   * detail that matters here: Metaplanet is spending balance-sheet BTC,
   * NOT issuing new Metaplanet shares, so sharesM above is unaffected and
   * must not be adjusted for this deal.
   *
   * On closing the company is renamed "Superplanet, Inc." and Metaplanet
   * holds ~95.7% of common (~93.6% assuming pre-funded warrants), making
   * it a Nasdaq "controlled company" and a CONSOLIDATED SUBSIDIARY.
   *
   * NOT CLOSED. Quoting the 8-K: expected to close "in the fourth quarter
   * of 2026, subject to the satisfaction or waiver of customary closing
   * conditions, including ... receipt of the Company stockholders'
   * approval". Until that vote, none of it is final.
   *
   * TWO CONSEQUENCES FOR THIS PAGE, both watch-items rather than edits:
   *  1. DOUBLE-COUNT RISK. Post-close those 2,100 BTC sit inside a
   *     consolidated subsidiary. If bitcointreasuries.net reports the
   *     parent and the subsidiary as separate rows, tracking both would
   *     count the same coins twice. Metaplanet's own row is the one to
   *     watch for a step-change around Q4 2026.
   *  2. DO NOT ADD IT AS A TICKER YET. The feed already carries a stub
   *     row — name "Superplanet", symbol "SUPA" (not SLE) — with holdings
   *     but NO stock_price and NO market_cap_basic/fully_diluted, which
   *     is exactly the incomplete-entry shape that got BSTR pulled back.
   *     See the treasury-expansion note in the README for the bar.
   */
  // OVERRIDE · Strive Inc (NASDAQ:ASST). Feed used a stale ~62M
  // pre-ATM/weighted-average count — below Class A alone (69.4M). True
  // economic common = Class A 69,410,645 + Class B 9,780,018 =
  // 79,190,663. SATA (the 13% perpetual preferred, NASDAQ:SATA) is
  // correctly EXCLUDED from common market cap. Weekly ATM dilution →
  // refresh from the latest 8-K (CIK 0001920406) on each filing.
  ASST: {
    sharesM: 94.934558,
    asOf: "2026-09-04",
    source:
      "Strive Inc 8-K filed 2026-09-08, Item 8.01 table as of 2026-09-04: Class A 85,696,647 + Class B 9,237,911 = 94,934,558 Effective Common Shares Outstanding. CIK 0001920406, accession 0001628280-26-060809. SATA preferred is excluded (not common).",
    note: "Dual-class, both economic. Excludes SATA perpetual preferred. Weekly ATM → refresh per 8-K. Take the 8-K Effective Common (A+B), never assumed-fully-diluted and never the 10-Q weighted average.",
  },
};

/**
 * Resolve the market cap (USD millions) to display for a treasury,
 * preferring a filing-sourced share count × live price over the
 * (sometimes stale) bitcointreasuries.net feed value.
 *
 * - If a SHARE_COUNTS override exists AND we have a live price, returns
 *   `sharesM × price` (the accurate, internally-consistent figure).
 * - Otherwise returns the feed value unchanged (MSTR / XXI, or any
 *   ticker where price is missing so the override can't be applied).
 *
 * Also emits a one-line drift warning when the feed's IMPLIED share
 * count overtakes our dated constant by >5% — the signal that new
 * issuance has happened and our hardcoded `sharesM` should be bumped
 * from the latest filing.
 */
export function resolveTreasuryMarketCapM(
  ticker: Ticker,
  feedMarketCapM: number | null,
  price: number | null,
): number | null {
  const sc = SHARE_COUNTS[ticker];
  if (!sc) return feedMarketCapM;

  // Staleness guard: feed implies MORE shares than our constant ⇒ our
  // number has gone stale (new ATM/issuance). Doesn't fire on the
  // understated case we're correcting (feed implies FEWER).
  if (feedMarketCapM != null && price != null && price > 0) {
    const feedImpliedSharesM = feedMarketCapM / price;
    if (feedImpliedSharesM > sc.sharesM * 1.05) {
      console.warn(
        `[treasury-shares] ${ticker}: feed implies ${feedImpliedSharesM.toFixed(
          1,
        )}M shares > our ${sc.sharesM}M constant (asOf ${sc.asOf}) — refresh sharesM from the latest filing.`,
      );
    }
  }

  if (price != null && price > 0) return sc.sharesM * price;
  return feedMarketCapM; // no live price → can't apply override; keep feed
}
