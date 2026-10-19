"use client";

import { useEffect, useRef, useState } from "react";
import { useModalA11y } from "@/lib/use-modal-a11y";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import { Asset } from "@/lib/assets";
import type { MarketSnapshot } from "@/app/api/market/route";
import { Tag } from "./AssetCard";

// Treasury-equity tickers · only these have a meaningful mNAV reading.
// Other tickers in the universe (BTC, IBIT, STRC, STRF, etc.) have a
// price history but no mNAV concept.
const TREASURY_TICKERS = new Set(["MSTR", "XXI", "MPJPY", "ASST"]);

type HistoryPoint = { t: number; p: number };

// Lazy-loaded daily price history. Cache per-ticker for the lifetime
// of the modal · re-opening jumps straight back. Module-level cache
// is fine because Asset modals are read-only.
const historyCache = new Map<string, HistoryPoint[]>();

async function fetchHistory(ticker: string): Promise<HistoryPoint[] | null> {
  if (historyCache.has(ticker)) return historyCache.get(ticker)!;
  try {
    const r = await fetch(`/api/history?tickers=${encodeURIComponent(ticker)}`);
    if (!r.ok) return null;
    const d = await r.json();
    const series = d?.series?.[0];
    if (!series?.points || series.points.length < 5) return null;
    historyCache.set(ticker, series.points);
    return series.points;
  } catch {
    return null;
  }
}

export function AssetDetailModal({
  asset,
  onClose,
  marketSnapshot,
}: {
  asset: Asset | null;
  onClose: () => void;
  // Optional · when present, the modal renders live price + mNAV
  // (for treasury equities) pulled from the snapshot. The /fit page
  // re-fetches this every 3 minutes via its existing useEffect, so
  // values stay fresh while the modal is open.
  marketSnapshot?: MarketSnapshot | null;
}) {
  // Focus contract · move-in, trap, Escape, restore (this modal had
  // NO Escape handler at all before 2026-06-12).
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(asset !== null, panelRef, onClose);

  // Lazy-fetch price history when modal opens · keeps the page-load
  // surface tiny but gives the modal a richer view.
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  useEffect(() => {
    if (!asset) {
      setHistory(null);
      return;
    }
    setHistoryLoading(true);
    let cancelled = false;
    fetchHistory(asset.ticker).then((points) => {
      if (cancelled) return;
      setHistory(points);
      setHistoryLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [asset]);

  // Pull live treasury data from the snapshot if this is a tracked
  // treasury equity. Falls back to null gracefully if the snapshot
  // isn't loaded yet or the ticker isn't a treasury.
  const treasuryRow =
    asset && TREASURY_TICKERS.has(asset.ticker) && marketSnapshot
      ? marketSnapshot.treasuries.find((t) => t.ticker === asset.ticker)
      : null;

  // Live spot price · for treasuries this is the same as treasuryRow.price,
  // but for non-treasury tickers (BTC, IBIT, STRC, etc.) we don't have a
  // direct live source on /fit. The sparkline's last point is the best
  // proxy for those.
  const livePrice = treasuryRow?.price ?? null;
  const livePriceFromHistory =
    history && history.length > 0 ? history[history.length - 1].p : null;

  return (
    <AnimatePresence>
      {asset && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 glass-scrim"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-modal-title"
            className="relative max-w-lg w-full rounded-xl glass-sheet p-6 outline-none"
            initial={{ y: 8, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex items-baseline justify-between mb-1">
              <h3
                id="asset-modal-title"
                className="font-mono text-2xl font-semibold text-[var(--accent-ink)] glow-text"
              >
                {asset.ticker}
              </h3>
              <span className="micro-label text-[var(--text-tertiary)]">
                vol {asset.volatilityScore}/10
              </span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              {asset.name}
            </p>

            {/* Live-data row · shows current price and (for treasury
                equities) live mNAV pulled from the /fit page's market
                snapshot. Renders as a compact 2-column grid so it
                slots cleanly between the ticker header and the prose.
                Both cells degrade gracefully to "—" when data isn't
                available yet (snapshot still loading, or ticker isn't
                a treasury for the mNAV cell). */}
            {(livePrice !== null ||
              livePriceFromHistory !== null ||
              treasuryRow) && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <LiveStat
                  label="Price"
                  value={
                    livePrice != null
                      ? `$${livePrice.toFixed(2)}`
                      : livePriceFromHistory != null
                        ? `$${livePriceFromHistory.toFixed(2)}`
                        : "—"
                  }
                  hint={
                    livePrice != null
                      ? "live"
                      : livePriceFromHistory != null
                        ? "last close"
                        : undefined
                  }
                />
                <LiveStat
                  label="mNAV"
                  value={
                    treasuryRow?.mNAV != null
                      ? `${treasuryRow.mNAV.toFixed(2)}×`
                      : TREASURY_TICKERS.has(asset.ticker)
                        ? "—"
                        : "n/a"
                  }
                  hint={(() => {
                    // Pre-narrow into a local · the chained ternary
                    // confused TS's flow analysis (it couldn't carry
                    // the non-null branch past the ?. on treasuryRow).
                    const m = treasuryRow?.mNAV ?? null;
                    if (m == null) {
                      return TREASURY_TICKERS.has(asset.ticker)
                        ? "loading"
                        : "not a treasury equity";
                    }
                    if (m < 1.0) return "below NAV";
                    if (m > 1.6) return "rich premium";
                    return "fair";
                  })()}
                  hintTone={(() => {
                    const m = treasuryRow?.mNAV ?? null;
                    if (m == null) return "neutral";
                    if (m < 1.0) return "good";
                    if (m > 1.6) return "warn";
                    return "neutral";
                  })()}
                />
              </div>
            )}

            {/* Price sparkline · 2y daily history from Yahoo via
                /api/history. Renders below the live data so visitors
                see the immediate snapshot first, the trail second.
                Loading state renders a placeholder so the modal
                doesn't jump on hydration. */}
            <div className="mb-4 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/50 p-3">
              <div className="flex items-baseline justify-between mb-2">
                <span className="t-xs text-[var(--text-tertiary)]">
                  2-year price trail
                </span>
                {history && history.length > 0 && (
                  <span className="font-mono t-xs text-[var(--text-tertiary)]">
                    {history.length} closes
                  </span>
                )}
              </div>
              {historyLoading ? (
                <div className="micro-label h-20 flex items-center justify-center text-[var(--text-tertiary)]">
                  Loading…
                </div>
              ) : history && history.length > 1 ? (
                <div style={{ width: "100%", height: 80 }}>
                  <ResponsiveContainer>
                    <LineChart
                      data={history.map((p) => ({
                        t: p.t,
                        p: p.p,
                      }))}
                      margin={{ top: 4, right: 4, left: 4, bottom: 4 }}
                    >
                      <YAxis hide domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--bg-elevated)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "6px",
                          fontSize: "11px",
                          fontFamily: "monospace",
                        }}
                        labelFormatter={(t) =>
                          new Date((t as number) * 1000).toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric", year: "numeric" },
                          )
                        }
                        formatter={(v) => [
                          `$${(v as number).toFixed(2)}`,
                          "Close",
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="p"
                        stroke="var(--accent)"
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="micro-label h-20 flex items-center justify-center text-[var(--text-tertiary)]">
                  History unavailable
                </div>
              )}
            </div>

            <p className="text-sm leading-relaxed text-[var(--text-primary)] mb-4">
              {asset.longDescription}
            </p>

            {/* Expected-return panel · surfaces the engine's forward
                central estimate + 1-sigma-ish range. These are CENTRAL
                ESTIMATES, not promises (notes echo this); but pulling
                them out of the data model and into the modal makes
                the "why is this in my portfolio?" question much more
                concrete than just the descriptive prose. */}
            <div className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 mb-4">
              <div className="flex items-baseline justify-between mb-1">
                <span className="t-xs font-medium text-[var(--accent-ink)]">
                  Expected annual return
                </span>
                <span className="t-xs text-[var(--text-tertiary)]">
                  central · range
                </span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-2xl tabular-nums text-[var(--text-primary)] font-semibold">
                  {(asset.expectedAnnualReturn * 100).toFixed(0)}%
                </span>
                <span className="font-mono text-xs tabular-nums text-[var(--text-tertiary)]">
                  ({(asset.expectedReturnRange[0] * 100).toFixed(0)}% –{" "}
                  {(asset.expectedReturnRange[1] * 100).toFixed(0)}%)
                </span>
              </div>
              <div className="micro-label mt-2 text-[var(--text-tertiary)]">
                Vol{" "}
                <span className="text-[var(--text-secondary)]">
                  {(asset.expectedVolatility * 100).toFixed(0)}%
                </span>{" "}
                / yr · forward-looking thesis, not realized
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs mb-4">
              <Stat
                label="Best horizon"
                value={`${asset.bestHorizonMin}–${asset.bestHorizonMax} yrs`}
              />
              <Stat
                label="Yield range"
                value={
                  asset.yieldRange
                    ? asset.yieldRange[0] === asset.yieldRange[1]
                      ? `${asset.yieldRange[0]}%`
                      : `${asset.yieldRange[0]}–${asset.yieldRange[1]}%`
                    : "·"
                }
              />
              <Stat
                label="Income / growth"
                value={`${Math.round(asset.incomeOrientation * 100)} / ${Math.round(asset.growthOrientation * 100)}`}
              />
              <Stat
                label="ROC eligible"
                value={asset.rocEligible ? "Yes" : "No"}
              />
            </div>

            <div className="flex flex-wrap gap-1.5 mb-4">
              {asset.rocEligible && <Tag>ROC-eligible</Tag>}
              <Tag muted>{asset.category}</Tag>
            </div>

            <p className="text-xs text-[var(--text-tertiary)] italic mb-5">
              {asset.notes}
            </p>

            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs uppercase tracking-widest border border-[var(--border-subtle)] rounded-md hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors"
            >
              Close
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="micro-label text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="font-mono text-sm text-[var(--text-primary)] mt-0.5">
        {value}
      </div>
    </div>
  );
}

// Larger, accent-tinted stat box for the live-data row · same visual
// language as the value-lens cells on /treasuries TreasuryTable.
// hintTone colorizes the secondary-line text:
//   "good"    = cyan (e.g. mNAV below NAV · accumulation territory)
//   "neutral" = muted (e.g. fair value, loading state)
//   "warn"    = accent orange (e.g. rich premium · yellow flag)
function LiveStat({
  label,
  value,
  hint,
  hintTone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  hintTone?: "good" | "neutral" | "warn";
}) {
  const hintColor =
    hintTone === "good"
      ? "text-[var(--cool-ink)]"
      : hintTone === "warn"
        ? "text-[var(--accent-ink)]"
        : "text-[var(--text-tertiary)]";
  return (
    <div className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-2">
      <div className="t-xs font-medium text-[var(--accent-ink)]">
        {label}
      </div>
      <div className="font-mono text-lg tabular-nums text-[var(--text-primary)] font-semibold mt-0.5">
        {value}
      </div>
      {hint && (
        <div
          className={`font-mono t-xs uppercase tracking-widest mt-0.5 ${hintColor}`}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
