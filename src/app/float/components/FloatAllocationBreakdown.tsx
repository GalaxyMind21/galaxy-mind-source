"use client";

/* =====================================================================
 * FloatAllocationBreakdown · "Where it all lives"
 *
 * Interactive horizontal stacked bar showing how the 21M Bitcoin
 * cap breaks down: lost / governments / ETFs / public companies /
 * in play / unmined. Hover or tap any segment to see a detail
 * panel below the bar with deeper context, sources, and links.
 *
 * Why interactive: the static labels-on-tiny-segments version was
 * hard to read · users couldn't tell which color was which cohort,
 * couldn't see the magnitude beyond a vague proportion, and didn't
 * get the "why is THIS segment important" context that makes the
 * scarcity story land.
 *
 * Satoshi's coins are explicitly broken out as a sub-cohort of
 * "lost" (the Patoshi-pattern ~1.1M BTC mined in 2009-2011 that
 * has never moved). They're the most provably immobile coins on
 * the network · Satoshi's continued absence is itself a structural
 * supply constraint worth highlighting.
 *
 * Mobile: tap to select a segment, tap again or tap another to
 * switch. Desktop: hover to preview, click to "pin" the selection.
 * ===================================================================== */

import { useEffect, useRef, useState } from "react";
import type { FloatSnapshot } from "@/lib/float-snapshot";
import {
  LOST_BTC_SOURCE,
  LTH_BTC_BASELINE,
  EXCHANGE_BTC_BASELINE,
} from "@/lib/float-snapshot";

type Props = {
  snapshot: FloatSnapshot;
};

// Satoshi's mined coins · the Patoshi pattern. ~1.1M BTC across
// the first ~22,000 blocks (Jan 2009 - mid 2010), provably mined
// by a single entity (Sergio Demian Lerner's pattern analysis ·
// 2013) and never moved. Subset of LOST_BTC_ESTIMATE; we display
// it explicitly because it's the most provably immobile cohort
// on the network.
const SATOSHI_BTC = 1_100_000;
const SATOSHI_SOURCE = "Sergio Demian Lerner · Patoshi pattern (2013)";

type SegmentKey =
  | "lost"
  | "satoshi"
  | "governments"
  | "etfs"
  | "publicCompanies"
  | "lthOther"
  | "inPlay"
  | "yetToMine";

type Segment = {
  key: SegmentKey;
  label: string;
  shortLabel: string;
  color: string; // tailwind bg color
  textColor?: string;
  description: string;
  source?: string;
  /** Link to read more · /v/[slug] for vendors, external URLs etc. */
  link?: { href: string; label: string };
};

export function FloatAllocationBreakdown({ snapshot }: Props) {
  const total = snapshot.totalSupply;
  const seg = (n: number) => (n / total) * 100;

  // Selected segment for the detail panel · null = no selection,
  // detail panel shows a default "tap a segment" hint.
  const [selected, setSelected] = useState<SegmentKey | null>(null);

  // Auto-scroll detail panel into view on mobile when a segment is
  // tapped. On desktop the panel is already visible adjacent to the
  // bar; on mobile (vertical list path) it lives 200px+ below the row
  // the user just tapped, so without this scroll the visitor thinks
  // the tap did nothing. `block: 'nearest'` is a no-op when the panel
  // is already on screen, so desktop behavior is unaffected.
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selected === null) return;
    if (typeof window === "undefined") return;
    // Only auto-scroll on viewports below Tailwind's `sm` breakpoint
    // (640px) · keeps desktop hover-preview pristine.
    if (window.matchMedia("(min-width: 640px)").matches) return;
    detailPanelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [selected]);

  // Lost cohort split: total lost minus Satoshi's portion = "other lost"
  const otherLost = Math.max(0, snapshot.cohorts.lost - SATOSHI_BTC);

  const segments: Segment[] = [
    {
      key: "satoshi",
      label: "SATOSHI",
      shortLabel: "S",
      color: "#222",
      textColor: "#aaa",
      description:
        "About 1.1M BTC mined by a single entity (the 'Patoshi pattern') across the first ~22,000 blocks of Bitcoin's history (Jan 2009 - mid 2010). These coins have never moved · 17+ years of dormancy. Whether Satoshi is alive, lost the keys, or simply chooses not to move them, the structural effect on supply is the same: ~5.2% of all Bitcoin will likely never re-enter circulation.",
      source: SATOSHI_SOURCE,
    },
    {
      key: "lost",
      label: "LOST",
      shortLabel: "L",
      color: "#444",
      textColor: "#ccc",
      description:
        "Coins dormant > 7 years (excluding Satoshi's portion) · the standard heuristic for 'lost' since by year 7 the holder is statistically very likely lost (lost device, lost key, deceased without heirs knowing). Conservative estimate · some sources go as high as 4M.",
      source: LOST_BTC_SOURCE,
    },
    {
      key: "governments",
      label: "GOV",
      shortLabel: "G",
      color: "#665",
      textColor: "#ddd",
      description:
        "Sovereign holdings · El Salvador, US (DOJ seizures from Silk Road etc.), Bhutan, Iran, Ukraine, and others. Governments rarely sell · these coins effectively leave circulation indefinitely. Live data from bitcointreasuries.net.",
      source: "bitcointreasuries.net (type=GOVERNMENT)",
    },
    {
      key: "etfs",
      label: "ETFS",
      shortLabel: "E",
      color: "#7a5",
      textColor: "#fff",
      description:
        "Spot Bitcoin ETF holdings · IBIT (BlackRock), FBTC (Fidelity), ARKB (ARK), GBTC (Grayscale), and others. ETF shares trade on traditional exchanges but the underlying BTC is custodied off-market. AUM-derived, updated daily by issuers.",
      source: "bitcointreasuries.net (type=FUND)",
    },
    {
      key: "publicCompanies",
      label: "CO",
      shortLabel: "C",
      color: "#5a7",
      textColor: "#fff",
      description:
        "Public companies with BTC on balance sheet · MSTR (Strategy) is the dominant holder by a wide margin, alongside MARA, RIOT, and dozens of smaller treasuries. Disclosed in SEC filings. These coins are a one-way valve · Strategy hasn't sold a single satoshi. (Live per-company holdings on /treasuries; this cohort's running total is the figure shown above, with no hardcoded number to go stale as Strategy keeps stacking weekly.)",
      source: "bitcointreasuries.net (type=PUBLIC_COMPANY)",
      link: {
        href: "/treasuries",
        label: "See live treasury scoreboard →",
      },
    },
    {
      key: "lthOther",
      label: "LTH",
      shortLabel: "H",
      color: "#3a6",
      textColor: "#fff",
      description:
        "Long-term holders not already counted above · individual hodlers, family-office cold storage, and other coins not moved in 155+ days. Glassnode's LTH metric (~14M BTC) by construction includes the lost / government / ETF / treasury cohorts to its left, so this segment shows ONLY the non-overlapping remainder. These wallets buy in cycles and almost never sell · they're the slow-moving bedrock of the supply-shock thesis.",
      source: `Glassnode lth-supply (~${(LTH_BTC_BASELINE / 1_000_000).toFixed(0)}M total, overlap-adjusted)`,
    },
    {
      key: "inPlay",
      label: "IN PLAY",
      shortLabel: "IN PLAY",
      color: "var(--accent)",
      textColor: "#000",
      description:
        "What's actually still in play · the number falling on the Supply Clock above. Short-term holders (coins moved in the last 155 days), exchange reserves, active traders, recent buyers. This is the cohort that actively responds to demand · everything to the left of it is dormant, lost, government-seized, or institutionally locked.",
    },
    {
      key: "yetToMine",
      label: "UNMINED",
      shortLabel: "U",
      color: "#222",
      textColor: "#888",
      description:
        "BTC that doesn't exist yet · still to be issued by miners over the next ~115 years (the last block subsidy mints in 2140). Mining issuance halves every 4 years · today ~450 BTC/day, post-2028 halving ~225/day, post-2032 ~113/day. Demand absorbs this 6-12× faster than miners produce it.",
    },
  ];

  // Map segment keys to BTC values. Missing live cohorts stay 0 for
  // BAR WIDTH only (a null has no pixels). liveOf is the public number.
  const valueOf = (key: SegmentKey): number => {
    switch (key) {
      case "satoshi": return SATOSHI_BTC;
      case "lost": return otherLost;
      case "governments": return snapshot.cohorts.governments ?? 0;
      case "etfs": return snapshot.cohorts.etfs ?? 0;
      case "publicCompanies": return snapshot.cohorts.publicCompanies ?? 0;
      case "lthOther": return snapshot.cohorts.lthOther;
      case "inPlay": return snapshot.inPlay;
      case "yetToMine": return snapshot.cohorts.yetToMine;
    }
  };
  const liveOf = (key: SegmentKey): number | null => {
    switch (key) {
      case "governments":
        return snapshot.cohorts.governments;
      case "etfs":
        return snapshot.cohorts.etfs;
      case "publicCompanies":
        return snapshot.cohorts.publicCompanies;
      default:
        return valueOf(key);
    }
  };

  const selectedSeg = selected ? segments.find((s) => s.key === selected) : null;
  const selectedValue = selected ? valueOf(selected) : 0;
  const selectedLive = selected ? liveOf(selected) : 0;
  const selectedPct = selected ? seg(selectedValue) : 0;

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6">
      <header className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
            Where it all lives
          </h2>
          <p className="text-xs text-[var(--text-tertiary)]">
            21 million bitcoin, accounted for · {selected ? "tap any row to inspect" : "tap a row for detail"}.
          </p>
        </div>
        <div className="micro-label text-[var(--text-tertiary)] flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] live-pulse" aria-hidden />
          LIVE
        </div>
      </header>

      {/* DESKTOP+TABLET · stacked horizontal bar · interactive segments.
          Hidden on mobile (sm:flex) because the segment widths fall
          below ~15px on iPhone and labels become illegible. The
          mobile-only vertical list below renders the same data with
          full text labels and larger touch targets. */}
      <div className="hidden sm:flex h-[44px] w-full rounded-md overflow-hidden border border-[var(--border-subtle)] mb-3">
        {segments.map((s) => {
          const value = valueOf(s.key);
          const live = liveOf(s.key);
          const width = seg(value);
          const isSelected = selected === s.key;
          const isOther = selected !== null && !isSelected;
          const name =
            live == null
              ? `${s.label} · syncing`
              : `${s.label} · ${value.toLocaleString()} BTC · ${width.toFixed(1)}% of total supply`;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setSelected(isSelected ? null : s.key)}
              onMouseEnter={() => {
                // Desktop hover-preview · only updates if no
                // segment is "pinned" via click. Avoids the "I
                // clicked X but hover keeps changing it" frustration.
                if (selected === null) setSelected(s.key);
              }}
              onMouseLeave={() => {
                // Reset only if this segment is the hover-preview
                // (i.e. if it was set via hover, not click). We
                // can't distinguish so we leave it · preview persists.
              }}
              style={{
                width: `${width}%`,
                background: s.color,
                color: s.textColor,
              }}
              aria-pressed={isSelected}
              aria-label={name}
              className={`flex items-center justify-center t-xs font-mono uppercase tracking-widest min-w-0 overflow-hidden whitespace-nowrap transition-opacity hover:opacity-100 ${
                isOther ? "opacity-45" : "opacity-100"
              } ${isSelected ? "ring-2 ring-[var(--accent)] ring-inset" : ""}`}
              title={
                live == null
                  ? `${s.label} · syncing`
                  : `${s.label} · ${value.toLocaleString()} BTC (${width.toFixed(1)}%)`
              }
            >
              {/* Show full label for IN PLAY (always wide enough) ·
                  short single-letter fallback for narrow segments.
                  Threshold raised 4→7 on 2026-05-22 because at 4-7%
                  the labels SATOSHI/UNMINED were rendering wider
                  than their segments, then visually clipping mid-
                  word ("ATOSH"/"UNMINE") · adding overflow-hidden
                  to the button bounds the clip cleanly, but the
                  cleaner UX is to drop to single-letter at narrow
                  widths and let the segment color + hover-detail
                  carry the meaning. */}
              {s.key === "inPlay"
                ? `${(value / 1_000_000).toFixed(2)}M IN PLAY`
                : width > 7
                  ? s.label
                  : s.shortLabel}
            </button>
          );
        })}
      </div>

      {/* MOBILE · vertical stacked rows · same data, readable labels,
          larger touch targets. Each row has a proportional colored
          fill in the background that shows relative magnitude (so
          visitors still get the "Other LTH is huge, Governments is
          tiny" comparison without squinting at a 12px segment). */}
      <div className="sm:hidden flex flex-col gap-1.5 mb-3">
        {segments.map((s) => {
          const value = valueOf(s.key);
          const live = liveOf(s.key);
          const width = seg(value);
          const isSelected = selected === s.key;
          const isOther = selected !== null && !isSelected;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setSelected(isSelected ? null : s.key)}
              aria-pressed={isSelected}
              aria-label={
                live == null
                  ? `${s.label} · syncing`
                  : `${s.label} · ${value.toLocaleString()} BTC · ${width.toFixed(1)}% of total supply`
              }
              className={`relative flex items-center justify-between gap-3 w-full px-3 py-2.5 rounded-md border text-left overflow-hidden transition-all min-h-[44px] ${
                isSelected
                  ? "border-[var(--accent)] bg-[var(--bg-elevated-2)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40"
              } ${isOther ? "opacity-55" : "opacity-100"}`}
            >
              {/* Proportional fill behind the row content. Faded so
                  the foreground text always reads cleanly. */}
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 pointer-events-none"
                style={{
                  width: `${width}%`,
                  background: s.color,
                  opacity: 0.32,
                }}
              />
              <div className="relative flex items-center gap-2.5 min-w-0">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: s.color }}
                  aria-hidden
                />
                <span className="micro-label text-[var(--text-primary)] truncate">
                  {s.label}
                </span>
              </div>
              <div className="relative flex items-baseline gap-2 shrink-0">
                <span className="font-mono text-sm text-[var(--text-primary)] font-semibold tabular-nums">
                  {live == null ? "syncing" : `${(value / 1_000_000).toFixed(2)}M`}
                </span>
                {live != null && (
                  <span className="font-mono t-xs text-[var(--text-tertiary)] tabular-nums">
                    {width.toFixed(1)}%
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail panel · expands when a segment is selected.
          Ref enables the mobile auto-scroll-into-view on tap. */}
      <div
        ref={detailPanelRef}
        className="min-h-[120px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40 p-4 scroll-mt-20"
      >
        {selectedSeg ? (
          <div>
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
              <div className="flex items-baseline gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-sm shrink-0"
                  style={{ background: selectedSeg.color }}
                  aria-hidden
                />
                <span className="micro-label text-[var(--accent-ink)]">
                  {selectedSeg.label}
                </span>
                <span className="font-mono text-base text-[var(--text-primary)] font-bold tabular-nums">
                  {selectedLive == null
                    ? "syncing"
                    : `${(selectedValue / 1_000_000).toFixed(2)}M BTC`}
                </span>
                {selectedLive != null && (
                  <span className="font-mono t-xs text-[var(--text-tertiary)] tabular-nums">
                    · {selectedPct.toFixed(1)}% of 21M
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="micro-label text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
                aria-label="Close detail"
              >
                ✕ close
              </button>
            </div>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
              {selectedSeg.description}
            </p>
            <div className="micro-label mt-3 flex items-baseline gap-x-4 gap-y-1 flex-wrap">
              {selectedSeg.source && (
                <span className="text-[var(--text-tertiary)]">
                  Source · <span className="text-[var(--text-secondary)] normal-case tracking-normal">{selectedSeg.source}</span>
                </span>
              )}
              {selectedSeg.link && (
                <a
                  href={selectedSeg.link.href}
                  className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                >
                  {selectedSeg.link.label}
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-center text-xs text-[var(--text-tertiary)] py-4">
            <span>
              Tap any colored segment above to see what those coins
              represent + where the data comes from.
            </span>
          </div>
        )}
      </div>

      {/* Stat tiles · the "removed" cohorts at a glance · Satoshi
          + Lost + Gov + ETFs + Public Treasuries + the LTH-other
          remainder that gets backed out before LTH is applied to the
          headline (prevents double-counting MSTR-style HODLers).
          Hidden on mobile (sm:grid) since the vertical list above
          already conveys label + value + % per cohort · the tile
          grid would just duplicate what's already readable. */}
      <div className="mt-5 hidden sm:grid sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          {
            label: "SATOSHI",
            value: SATOSHI_BTC,
            source: "Patoshi pattern (Lerner)",
            sub: "~5.2% · never moved 17y",
          },
          {
            label: "LOST (>7Y DORMANT)",
            value: otherLost,
            source: LOST_BTC_SOURCE,
            sub: null,
          },
          {
            label: "GOVERNMENTS",
            value: snapshot.cohorts.governments,
            source: "bitcointreasuries.net",
            sub: null,
          },
          {
            label: "SPOT ETFs",
            value: snapshot.cohorts.etfs,
            source: "bitcointreasuries.net",
            sub: null,
          },
          {
            label: "PUBLIC TREASURIES",
            value: snapshot.cohorts.publicCompanies,
            source: "bitcointreasuries.net",
            sub: null,
          },
          {
            label: "OTHER LTH (155d+)",
            value: snapshot.cohorts.lthOther,
            source: "Glassnode · overlap-adjusted",
            sub: "individuals + family offices",
          },
        ].map((tile) => (
          <div
            key={tile.label}
            className="bg-[var(--bg-elevated-2)]/40 border border-[var(--border-subtle)] rounded-md p-3"
          >
            <div className="font-mono t-xs tracking-[0.2em] text-[var(--text-tertiary)]">
              {tile.label}
            </div>
            <div className="font-mono text-base text-[var(--text-primary)] font-bold mt-1 tabular-nums">
              {tile.value == null
                ? "syncing"
                : `${(tile.value / 1_000_000).toFixed(2)}M`}
            </div>
            {tile.sub && (
              <div className="t-xs text-[var(--accent-ink)] mt-1">
                {tile.sub}
              </div>
            )}
            <div className="t-xs text-[var(--text-tertiary)] mt-1">
              {tile.source}
            </div>
          </div>
        ))}
      </div>

      {/* Strictest "buyable right now" framing · the only narrower
          definition worth surfacing now that LTH is folded into the
          hero. Exchange reserves are coins sitting in custodial
          venues right now, click-to-buy. The rest of inPlay is in
          short-term-holder wallets · liquid but not pre-listed. */}
      <div className="mt-5 pt-4 border-t border-[var(--border-subtle)]/40 text-xs text-[var(--text-tertiary)]">
        <span className="text-[var(--text-secondary)]">Exchange reserves</span>{" "}
        sit at ~{(EXCHANGE_BTC_BASELINE / 1_000_000).toFixed(2)}M (CoinGlass), the strictest &quot;available to click-buy this moment&quot; subset of the {(snapshot.inPlay / 1_000_000).toFixed(2)}M in-play headline. The rest is in active-trader wallets · liquid but not pre-listed on an order book.
      </div>
    </section>
  );
}
