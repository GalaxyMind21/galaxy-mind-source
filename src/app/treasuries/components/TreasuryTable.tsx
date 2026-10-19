"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { track } from "@vercel/analytics";
import { COUNTRY_FLAG, TREASURY_META } from "@/lib/treasuries";
import type { Quote } from "@/lib/market";
import { computeCebe } from "@/lib/cebe";
import { MNavBar } from "./MNavBar";
import { MNavSparkline } from "./MNavSparkline";

// Value-lens helpers — translate the four basic numbers (price,
// market cap, BTC held, mNAV) into "what do I actually get per dollar
// of equity?" terms that compare directly to spot BTC.

/**
 * BTC per share — the accretion metric. Companies that issue shares
 * to buy BTC are only valuable if BTC-per-share grows over time.
 * Displayed in sats since most modern BTC-per-share values are
 * fractional (MSTR is ~0.00124 BTC = 124,000 sats).
 *
 * Derivation:
 *   sharesOutstanding ≈ marketCapM * 1_000_000 / price
 *   btcPerShare = btcHoldings / sharesOutstanding
 *               = btcHoldings * price / (marketCapM * 1_000_000)
 */
function btcPerShareSats(row: Quote): number | null {
  if (
    row.btcHoldings == null ||
    row.price == null ||
    row.marketCapM == null ||
    row.marketCapM <= 0
  )
    return null;
  const btc = (row.btcHoldings * row.price) / (row.marketCapM * 1_000_000);
  return btc * 100_000_000; // BTC → sats
}

/**
 * Effective BTC price — what you ACTUALLY pay per BTC when buying
 * this equity, accounting for the mNAV premium/discount. Below the
 * spot BTC price means you're getting a discount (treasury equity
 * is a deal); above means you're paying a premium for the wrapper.
 *
 * Formula: btcPrice * mNAV. If mNAV is null we can't compute.
 */
function effectiveBtcPrice(row: Quote, btcPrice: number | null): number | null {
  if (row.mNAV == null || btcPrice == null) return null;
  return btcPrice * row.mNAV;
}

function fmtSats(s: number | null): string {
  if (s == null) return "·";
  if (s >= 100_000) return `${Math.round(s / 1000)}k sats`;
  return `${Math.round(s)} sats`;
}

// Sats per $1 invested · the dollar-normalized "what does my dollar
// actually buy" metric. Independent of share price (market cap = price ×
// shares, so the share count cancels): it's purely how much bitcoin
// backs each dollar of equity. When it exceeds spot's sats-per-dollar
// (i.e. mNAV < 1) the wrapper stacks MORE sats per dollar than buying
// BTC outright — the mNAV-discount lens expressed in sats.
//   sats per $1 = BTC held × 1e8 ÷ market cap (USD)
//              = btcHoldings × 100 ÷ marketCapM.
function satsPerDollar(row: Quote): number | null {
  if (row.btcHoldings == null || row.marketCapM == null || row.marketCapM <= 0)
    return null;
  return (row.btcHoldings * 100) / row.marketCapM;
}

function fmtUsdShort(p: number | null): string {
  if (p == null) return "·";
  if (p >= 1000) return `$${(p / 1000).toFixed(p >= 10000 ? 0 : 1)}k`;
  return `$${p.toFixed(0)}`;
}

/**
 * Spread label · "Effective BTC $ vs spot." Returns both the absolute
 * dollar delta and the percentage premium/discount in one short string,
 * formatted for the value-lens hint below "Effective BTC $".
 *
 * Why include both:
 * - $ delta is concrete ("$4k more than just buying BTC")
 * - % is comparable across price regimes ("3.6% premium" reads the same
 *   whether BTC is $30k or $300k)
 *
 * Returns null when we can't compute (missing mNAV or missing spot).
 */
function spreadVsSpot(
  effective: number | null,
  spot: number | null,
): { delta: number; pct: number; isDiscount: boolean } | null {
  if (effective == null || spot == null || spot <= 0) return null;
  const delta = effective - spot;
  const pct = (delta / spot) * 100;
  return { delta, pct, isDiscount: delta < 0 };
}

function fmtSpread(s: ReturnType<typeof spreadVsSpot>): string {
  if (!s) return "";
  const sign = s.delta >= 0 ? "+" : "−";
  const absDelta = Math.abs(s.delta);
  const dollars =
    absDelta >= 1000
      ? `$${(absDelta / 1000).toFixed(absDelta >= 10000 ? 0 : 1)}k`
      : `$${absDelta.toFixed(0)}`;
  const absPct = Math.abs(s.pct);
  const pctStr = absPct < 1 ? absPct.toFixed(1) : absPct.toFixed(0);
  return `${sign}${dollars} (${sign}${pctStr}%) vs spot`;
}

type SortKey =
  | "mnav"
  | "satsLeast"
  | "amp"
  | "marketCap"
  | "btc"
  | "price";

// "Most sats / $1" was dropped 2026-07-13 (UX audit): it produced the
// SAME order as "Cheapest first" by construction (sats/$1 ∝ 1/mNAV), so
// two of the seven pills were identical — pure decision friction.
const SORT_LABEL: Record<SortKey, string> = {
  mnav: "Cheapest first",
  satsLeast: "Least sats / $1",
  amp: "Most amplified first",
  marketCap: "Largest first",
  btc: "Most BTC first",
  price: "Highest price first",
};

// Helpers — all guard against null since live treasury rows can be partial
// (e.g. SMLR was missing in the upstream feed at the time of writing).
function fmtPrice(p: number | null): string {
  if (p == null) return "·";
  return `$${p.toFixed(2)}`;
}
function fmtMarketCap(mcM: number | null): string {
  if (mcM == null) return "·";
  if (mcM >= 1000) return `$${(mcM / 1000).toFixed(2)}B`;
  return `$${mcM.toFixed(0)}M`;
}
function fmtBtc(b: number | null): string {
  if (b == null) return "·";
  return b.toLocaleString();
}
function fmtMNav(m: number | null): string {
  if (m == null) return "·";
  return `${m.toFixed(2)}×`;
}

export function TreasuryTable({
  rows,
  mNavHistories,
  btcPrice,
}: {
  rows: Quote[];
  // Per-row 90-day mNAV history (parallel to rows). Each entry can be
  // null if the historical fetch failed for that ticker.
  mNavHistories?: (number[] | null)[];
  // Spot BTC price — used to compute "effective BTC price" via mNAV.
  // Optional so the component degrades gracefully if the snapshot is
  // missing the price.
  btcPrice?: number | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("mnav");

  // Map ticker → history so the sort below doesn't lose alignment.
  const historyByTicker = useMemo(() => {
    const m = new Map<string, number[] | null>();
    if (mNavHistories) {
      rows.forEach((r, i) => m.set(r.ticker, mNavHistories[i] ?? null));
    }
    return m;
  }, [rows, mNavHistories]);

  const sorted = useMemo(() => {
    // Extract the sort value for a row. "amp" (Amplification = BPS ÷ CEBE
    // BPS) is derived via computeCebe; it is null for pending-CEBE tickers
    // (MPJPY), which then fall to the bottom like any other null.
    const sortVal = (q: Quote): number | null => {
      switch (sortKey) {
        case "mnav":
          return q.mNAV;
        case "satsLeast":
          return satsPerDollar(q);
        case "amp":
          return computeCebe(q, btcPrice ?? null).amplificationRatio;
        case "marketCap":
          return q.marketCapM;
        case "btc":
          return q.btcHoldings;
        default:
          return q.price;
      }
    };
    // Ascending keys: lowest value first. "mnav" (cheapest) and
    // "satsLeast" (fewest sats per $1) read low-to-high; every other key
    // reads high-to-low.
    const ascending = sortKey === "mnav" || sortKey === "satsLeast";
    const list = [...rows];
    list.sort((a, b) => {
      // Always push nulls to the bottom regardless of sort direction.
      const aVal = sortVal(a);
      const bVal = sortVal(b);
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      return ascending ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [rows, sortKey, btcPrice]);

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
      {/* Sort controls */}
      <div className="flex flex-wrap items-baseline gap-2 px-5 py-4 border-b border-[var(--border-subtle)]">
        <span className="micro-label text-[var(--text-tertiary)] mr-1">
          Sort by
        </span>
        {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => {
          const active = sortKey === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => {
                setSortKey(k);
                track("treasuries_sort", { key: k });
              }}
              className={`inline-flex items-center justify-center px-3 py-2.5 sm:py-1 min-h-11 sm:min-h-0 rounded-full font-mono t-xs uppercase tracking-widest border transition-colors ${
                active
                  ? "border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent)]/10"
                  : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]"
              }`}
            >
              {SORT_LABEL[k]}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div className="divide-y divide-[var(--border-subtle)]">
        {sorted.map((row, i) => {
          const meta = TREASURY_META[row.ticker];
          const flag = meta?.country ? COUNTRY_FLAG[meta.country] : "";
          // Top row is the standout when sorted by "Cheapest first"
          // (lowest mNAV) — the ★ cheapest cue.
          const cheapest =
            i === 0 && sortKey === "mnav" && row.mNAV != null;
          return (
            <div
              key={row.ticker}
              className={`p-5 ${cheapest ? "bg-[rgba(126,192,255,0.04)]" : ""}`}
            >
              {/* Top row: ticker + name + headline mNAV value */}
              {/* The identity side wraps and may shrink; the mNAV readout
                  may not. Without min-w-0 the left group refused to give
                  ground at 390px and squeezed the 2xl mNAV into a 58px box
                  it needed 76px for, so "0.63×" ran over the label under
                  it. Letting the ★ cheapest pill drop to a second line is
                  the cheap concession; compressing the headline number the
                  page is FOR is not. */}
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
                  {/* Ticker symbol links to the per-treasury page
                      (audit 2026-05-28). Yahoo-Finance-style affordance
                      that builds internal-link flow from /treasuries
                      (priority 1.0 in sitemap) down to /treasuries/{ticker}
                      (priority 0.7) · standard SEO link-equity pattern.
                      Click-tracked separately so we can see whether the
                      ticker-detail flow gets used. */}
                  <Link
                    href={`/treasuries/${row.ticker}`}
                    onClick={() =>
                      track("treasury_ticker_detail_click", { ticker: row.ticker })
                    }
                    title={`${row.ticker} details · mNAV, CEBE, profile`}
                    aria-label={`${row.ticker} treasury details`}
                    // Persistent dotted underline · the ticker was already a
                    // link to /treasuries/[ticker] but only changed color on
                    // hover, so it didn't read as clickable while scanning
                    // (operator catch 2026-06-14). The dotted underline is
                    // the standard "interactive" cue; it firms up to a solid
                    // accent underline on hover.
                    className="font-mono text-base font-semibold text-[var(--text-primary)] tracking-wider underline decoration-dotted decoration-[var(--text-tertiary)] underline-offset-[5px] hover:text-[var(--accent-ink)] hover:decoration-solid hover:decoration-[var(--accent-ink)] transition-colors"
                  >
                    {row.ticker}
                  </Link>
                  <span className="text-sm text-[var(--text-secondary)]">
                    {meta?.name ?? row.ticker}
                  </span>
                  {flag && (
                    <span className="self-center text-base leading-none">{flag}</span>
                  )}
                  {cheapest && (
                    // self-center · the row is items-baseline for the
                    // ticker + name text, but a bordered pill aligned to
                    // the text baseline rides misaligned (iOS Safari
                    // especially · operator catch 2026-06-13).
                    <span className="self-center font-mono t-xs uppercase tracking-widest px-2 py-0.5 rounded-full border border-[#7ec0ff] text-[var(--cool-ink)] bg-[rgba(126,192,255,0.08)] leading-none whitespace-nowrap">
                      ★ cheapest
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {/* 90-day mNAV trend sparkline · premium compression
                      vs expansion over time, with a 1.0× NAV reference
                      line. Hidden on the smallest screens to keep the
                      row scannable. */}
                  <div className="hidden sm:block">
                    <MNavSparkline
                      history={historyByTicker.get(row.ticker) ?? null}
                      currentMNav={row.mNAV}
                    />
                  </div>
                  <div className="text-right min-w-0">
                    <div
                      className="font-mono tabular-nums text-2xl"
                      style={{
                        color:
                          row.mNAV == null
                            ? "var(--text-tertiary)"
                            : row.mNAV < 1.0
                              ? "var(--cool-ink)"
                              : row.mNAV < 1.05
                                ? "var(--text-primary)"
                                : "var(--accent-ink)",
                      }}
                    >
                      {fmtMNav(row.mNAV)}
                    </div>
                    <div className="micro-label text-[var(--text-tertiary)]">
                      mNAV
                    </div>
                    {/* 90-day percentile badge · answers the decision
                        question a treasury watcher returns for
                        ("is it cheap YET?") without making them eyeball
                        the sparkline. Mirrors the percentile pattern
                        proven in StackHistorySparkline. Only renders
                        with enough history (>=7 points) so a fresh KV
                        or a thin trail doesn't display a misleading
                        "near low" off 2 data points. */}
                    {(() => {
                      const hist = historyByTicker.get(row.ticker);
                      if (
                        row.mNAV == null ||
                        !hist ||
                        hist.length < 7
                      ) {
                        return null;
                      }
                      const m = row.mNAV;
                      const pct = Math.round(
                        (hist.filter((h) => h <= m).length /
                          hist.length) *
                          100,
                      );
                      let label: string | null = null;
                      let color = "var(--text-tertiary)";
                      if (pct <= 10) {
                        label = "near its 90-day cheapest";
                        color = "var(--cool-ink)";
                      } else if (pct <= 25) {
                        label = "cheaper than usual lately";
                        color = "var(--cool-ink)";
                      } else if (pct >= 90) {
                        label = "near its 90-day richest";
                        color = "var(--accent-ink)";
                      } else if (pct >= 75) {
                        label = "pricier than usual lately";
                        color = "var(--accent-ink)";
                      }
                      if (!label) return null;
                      return (
                        <div
                          // leading-tight + whitespace-normal lets a
                          // longer plain-language label ("cheaper than
                          // usual lately") wrap onto a second line at
                          // 390px mobile instead of busting the row
                          // width. min-w-0 on the parents above lets
                          // THIS div shrink.
                          className="font-mono t-xs uppercase tracking-widest mt-1 leading-tight whitespace-normal"
                          style={{ color }}
                        >
                          {label}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Visual mNAV bar */}
              <div className="mb-7">
                <MNavBar mNav={row.mNAV} />
              </div>

              {/* Basic stats row · what the company HAS. grid-cols-2 on
                  mobile (UX audit 2026-07-13): grid-cols-3 crammed 3
                  values into ~69px cells at 375px, wrapping $X.XXB and
                  comma BTC counts to 2-3 lines. Mirrors the CEBE row's
                  responsive pattern below. */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono">
                <Stat label="Price" value={fmtPrice(row.price)} />
                <Stat label="Market cap" value={fmtMarketCap(row.marketCapM)} />
                <Stat label="BTC held" value={fmtBtc(row.btcHoldings)} />
              </div>

              {/* Value-lens row · what YOU get per dollar of equity.
                  These two stats translate the basic numbers into
                  "actionable comparison vs spot BTC" terms:
                  - BTC/share = the accretion metric (what each share
                    represents in BTC)
                  - Eff. BTC $ = what you actually pay per BTC by
                    buying this equity (spot * mNAV) */}
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono">
                <Stat
                  label="BTC / share"
                  value={fmtSats(btcPerShareSats(row))}
                  emphasized
                />
                {(() => {
                  // Sats per $1 invested · the dollar-normalized "what
                  // does my dollar buy" number. Hint compares to spot's
                  // sats-per-$1 so a below-NAV name visibly stacks MORE
                  // sats per dollar than buying BTC outright.
                  const spd = satsPerDollar(row);
                  const spotSpd =
                    btcPrice != null && btcPrice > 0 ? 1e8 / btcPrice : null;
                  const hint =
                    spd != null && spotSpd != null
                      ? `vs ${Math.round(spotSpd).toLocaleString()} at spot`
                      : undefined;
                  // More sats/$ than spot ⇔ mNAV < 1 (discount = good).
                  const tone =
                    row.mNAV == null
                      ? "neutral"
                      : row.mNAV < 1
                        ? "good"
                        : row.mNAV > 1.05
                          ? "warn"
                          : "neutral";
                  return (
                    <Stat
                      label="Sats / $1"
                      value={fmtSats(spd)}
                      emphasized
                      hint={hint}
                      hintTone={tone}
                    />
                  );
                })()}
                {(() => {
                  // Compute once · used for both the headline value and
                  // the spread-vs-spot hint. Inline IIFE keeps the JSX
                  // tree shallow without hoisting another helper to the
                  // top of the row component.
                  const eff = effectiveBtcPrice(row, btcPrice ?? null);
                  const spread = spreadVsSpot(eff, btcPrice ?? null);
                  const hint = spread
                    ? fmtSpread(spread)
                    : row.mNAV == null
                      ? undefined
                      : "spot price unavailable";
                  return (
                    <Stat
                      label="Effective BTC $"
                      value={fmtUsdShort(eff)}
                      emphasized
                      hint={hint}
                      hintTone={
                        spread
                          ? spread.isDiscount
                            ? "good"
                            : Math.abs(spread.pct) < 5
                              ? "neutral"
                              : "warn"
                          : "neutral"
                      }
                    />
                  );
                })()}
              </div>

              {/* CEBE row · the NET-of-senior-claims lens. Standard mNAV
                  (above) is gross · this divides by the bitcoin left for
                  common after debt + preferred. Pending for tickers whose
                  senior-claims figures aren't sourced yet. */}
              {(() => {
                const c = computeCebe(row, btcPrice ?? null);
                if (!c.available) {
                  return (
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                      <Stat
                        label="Net mNAV · CEBE"
                        value="pending"
                        hint="senior-claims data pending"
                      />
                      <Stat label="EV mNAV" value="·" />
                      <Stat label="Amplification" value="·" />
                      <Stat label="Senior claims %" value="·" />
                    </div>
                  );
                }
                const netMnav =
                  c.netMNav != null ? `${c.netMNav.toFixed(2)}×` : "·";
                const ev = c.evMNav != null ? `${c.evMNav.toFixed(2)}×` : "·";
                const amp =
                  c.amplificationRatio != null
                    ? `${c.amplificationRatio.toFixed(2)}×`
                    : "·";
                const claims =
                  c.claimsPct != null
                    ? `${(c.claimsPct * 100).toFixed(0)}%`
                    : "·";
                // After-claims discount (<1×) is the genuinely strong
                // read; ≥1× means the leverage erases the headline
                // discount; >1.6× is a rich net premium.
                const tone =
                  c.netMNav == null
                    ? "neutral"
                    : c.netMNav < 1
                      ? "good"
                      : c.netMNav > 1.6
                        ? "warn"
                        : "neutral";
                return (
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                    <Stat
                      label="Net mNAV · CEBE"
                      value={netMnav}
                      hint={
                        c.asOf
                          ? `after senior claims · ${c.asOf}`
                          : "after senior claims"
                      }
                      hintTone={tone}
                    />
                    <Stat
                      label="EV mNAV"
                      value={ev}
                      hint="incl. debt + preferred"
                    />
                    <Stat
                      label="Amplification"
                      value={amp}
                      hint="BPS ÷ CEBE BPS · senior leverage"
                    />
                    <Stat
                      label="Senior claims %"
                      value={claims}
                      hint="debt + preferred vs BTC"
                    />
                  </div>
                );
              })()}

              {/* Description */}
              {meta?.blurb && (
                <p className="mt-3 text-xs text-[var(--text-secondary)] leading-relaxed">
                  {meta.blurb}
                  {meta.href && (
                    <>
                      {" "}
                      <a
                        href={meta.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() =>
                          track("treasuries_link_out", { ticker: row.ticker })
                        }
                        className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                      >
                        {meta.name} →
                      </a>
                    </>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasized,
  hint,
  hintTone = "neutral",
}: {
  label: string;
  value: string;
  // Emphasized stats get the orange-tinted card treatment — used for
  // the "value lens" row to draw the eye to BTC/share + effective BTC $.
  emphasized?: boolean;
  // Optional hint shown below the value (e.g. "+$4k (+3.6%) vs spot").
  hint?: string;
  // hintTone colorizes the hint to read as a signal:
  //   "good"    = cyan (discount · accumulation territory)
  //   "neutral" = muted (within ±5% of spot · fair value)
  //   "warn"    = accent orange (rich premium · yellow flag)
  hintTone?: "good" | "neutral" | "warn";
}) {
  const hintColor =
    hintTone === "good"
      ? "text-[var(--cool-ink)]"
      : hintTone === "warn"
        ? "text-[var(--accent-ink)]"
        : "text-[var(--text-tertiary)]";
  return (
    <div
      className={`rounded-md px-3 py-2 ${
        emphasized
          ? "border border-[var(--accent)]/30 bg-[var(--accent)]/5"
          : "border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40"
      }`}
    >
      <div
        className={`t-xs uppercase tracking-widest ${
          emphasized ? "text-[var(--accent-ink)]" : "text-[var(--text-tertiary)]"
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-1 tabular-nums text-sm ${
          emphasized ? "text-[var(--text-primary)] font-semibold" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </div>
      {hint && (
        <div
          className={`mt-0.5 t-xs tabular-nums leading-tight ${hintColor}`}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
