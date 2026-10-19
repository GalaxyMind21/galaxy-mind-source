"use client";

// Side-by-side scenario comparison for /fit.
//
// Why this exists:
// The recommendation engine answers "what's the right portfolio for
// MY profile?" — but users typically want to know the next question
// too: "what changes if I take more / less risk?" The existing
// ScenarioPills component lets users TAP into adjacent scenarios
// (which then becomes the new current view), but doesn't let them
// see two scenarios SIDE BY SIDE.
//
// This component does. Two columns: left = current recommendation,
// right = adjacent scenario (default +1 tolerance tier). Asset-by-
// asset diff with delta arrows + colored deltas in the right column.
// Top-line: return + Sharpe deltas as well. Lets users feel the
// concrete tradeoff of "one more tier of risk = ~3% more expected
// return" without playing pinball with the controls.
//
// Collapsed by default (a CTA bar invites the click) so it doesn't
// add to the page's visual weight unless a user wants the analysis.

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { track } from "@vercel/analytics";
import {
  recommend,
  TOLERANCE_LABELS,
  type Tolerance,
  type AccountType,
  type Recommendation,
  type Sleeve,
} from "@/lib/recommend";
import { DiffStat } from "./DiffStat";

type CompareAxis = "tolerance-up" | "tolerance-down" | "horizon-up" | "horizon-down";

const AXIS_LABELS: Record<CompareAxis, string> = {
  "tolerance-up":   "+1 risk tier",
  "tolerance-down": "−1 risk tier",
  "horizon-up":     "+5 yrs horizon",
  "horizon-down":   "−5 yrs horizon",
};

export function ScenarioCompare({
  current,
  inputs,
  signals,
}: {
  current: Recommendation;
  inputs: {
    horizonYears: number;
    tolerance: Tolerance;
    account: AccountType;
  };
  // Live signals (passed through to the engine so the comparison uses
  // the same market state as the current verdict)
  signals?: {
    mNAVByTicker?: Record<string, number | null | undefined>;
    fearGreed?: number | null;
    btcVol30d?: number | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const [axis, setAxis] = useState<CompareAxis>("tolerance-up");

  // Compute available axes (e.g. can't go +1 tier if already at 6)
  const availableAxes: CompareAxis[] = useMemo(() => {
    const out: CompareAxis[] = [];
    if (inputs.tolerance < 6) out.push("tolerance-up");
    if (inputs.tolerance > 1) out.push("tolerance-down");
    if (inputs.horizonYears < 30) out.push("horizon-up");
    if (inputs.horizonYears > 1) out.push("horizon-down");
    return out;
  }, [inputs.tolerance, inputs.horizonYears]);

  // Snap axis to an available one if user's choice is no longer valid
  const safeAxis = availableAxes.includes(axis) ? axis : availableAxes[0];

  // Compute the comparison recommendation. Live signals mirror current
  // so any market-driven tilts (mNAV, F&G, vol) are applied to both.
  const comparison = useMemo(() => {
    if (!safeAxis) return null;
    const compInputs = {
      horizonYears: inputs.horizonYears,
      volatilityTolerance: inputs.tolerance,
      accountType: inputs.account,
      ...(signals ?? {}),
    };
    if (safeAxis === "tolerance-up") {
      compInputs.volatilityTolerance = (inputs.tolerance + 1) as Tolerance;
    } else if (safeAxis === "tolerance-down") {
      compInputs.volatilityTolerance = (inputs.tolerance - 1) as Tolerance;
    } else if (safeAxis === "horizon-up") {
      compInputs.horizonYears = inputs.horizonYears + 5;
    } else if (safeAxis === "horizon-down") {
      compInputs.horizonYears = Math.max(1, inputs.horizonYears - 5);
    }
    return recommend(compInputs);
  }, [safeAxis, inputs, signals]);

  // Asset-by-asset diff: union of tickers from both, sorted by current
  // weight desc (so the biggest positions appear at the top).
  const diffRows = useMemo(() => {
    if (!comparison) return [];
    const cur = new Map(current.allocation.map((s) => [s.asset.ticker, s]));
    const cmp = new Map(comparison.allocation.map((s) => [s.asset.ticker, s]));
    const allTickers = new Set([...cur.keys(), ...cmp.keys()]);
    const rows: {
      ticker: string;
      curWeight: number;
      cmpWeight: number;
      delta: number;
      curSleeve: Sleeve | undefined;
      cmpSleeve: Sleeve | undefined;
    }[] = [];
    for (const ticker of allTickers) {
      const c = cur.get(ticker);
      const m = cmp.get(ticker);
      const curWeight = c?.weight ?? 0;
      const cmpWeight = m?.weight ?? 0;
      rows.push({
        ticker,
        curWeight,
        cmpWeight,
        delta: cmpWeight - curWeight,
        curSleeve: c,
        cmpSleeve: m,
      });
    }
    rows.sort((a, b) => Math.max(b.curWeight, b.cmpWeight) - Math.max(a.curWeight, a.cmpWeight));
    return rows;
  }, [current, comparison]);

  if (availableAxes.length === 0) {
    // At the extremes (e.g. tolerance 6 + horizon 30), no comparison
    // available. Don't render at all.
    return null;
  }

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
      {/* Toggle bar */}
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) track("fit_compare_open", { axis: safeAxis });
        }}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[var(--bg-elevated-2)]/50 transition-colors"
        aria-expanded={open}
      >
        <div>
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-1">
            Compare scenarios
          </div>
          <div className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
            What changes if I {open ? "·" : "→"}{" "}
            <span className="text-[var(--accent-ink)]">
              {AXIS_LABELS[safeAxis]}
            </span>
            ?
          </div>
        </div>
        <span className="font-mono text-[var(--accent-ink)] text-base">
          {open ? "−" : "+"}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && comparison && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <div className="border-t border-[var(--border-subtle)] p-5">
              {/* Axis selector */}
              <div className="flex flex-wrap gap-1.5 mb-5">
                {availableAxes.map((a) => (
                  <button
                    key={a}
                    onClick={() => {
                      setAxis(a);
                      track("fit_compare_axis", { axis: a });
                    }}
                    className={`font-mono t-xs uppercase tracking-widest px-3 py-1 rounded-full border transition-colors whitespace-nowrap ${
                      safeAxis === a
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-ink)]"
                        : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]"
                    }`}
                  >
                    {AXIS_LABELS[a]}
                  </button>
                ))}
              </div>

              {/* Headline metrics: return + Sharpe + Vol diff. The
                  Recommendation type nests these under .expectedReturn:
                  annualCentral, sharpeRatio, portfolioVolatility. */}
              <div className="grid grid-cols-3 gap-3 mb-5 font-mono">
                <DiffStat
                  label="Expected return"
                  current={current.expectedReturn.annualCentral}
                  comparison={comparison.expectedReturn.annualCentral}
                  fmt={(v) => `${(v * 100).toFixed(1)}%`}
                  betterIfHigher
                />
                <DiffStat
                  label="Sharpe"
                  current={current.expectedReturn.sharpeRatio}
                  comparison={comparison.expectedReturn.sharpeRatio}
                  fmt={(v) => v.toFixed(2)}
                  betterIfHigher
                />
                <DiffStat
                  label="Volatility"
                  current={current.expectedReturn.portfolioVolatility}
                  comparison={comparison.expectedReturn.portfolioVolatility}
                  fmt={(v) => `${(v * 100).toFixed(0)}%`}
                  betterIfHigher={false}
                />
              </div>

              {/* Side-by-side asset table */}
              <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                <div className="grid grid-cols-[1fr_70px_70px_60px] sm:grid-cols-[1fr_90px_90px_80px] gap-2 px-3 sm:px-4 py-2 t-xs text-[var(--text-tertiary)] bg-[rgba(255,255,255,0.015)]">
                  <div>Ticker</div>
                  <div className="text-right">Current</div>
                  <div className="text-right">{AXIS_LABELS[safeAxis]}</div>
                  <div className="text-right">Δ</div>
                </div>
                <div className="divide-y divide-[var(--border-subtle)]">
                  {diffRows.map((row) => {
                    const isAdded = row.curWeight === 0 && row.cmpWeight > 0;
                    const isDropped = row.curWeight > 0 && row.cmpWeight === 0;
                    return (
                      <div
                        key={row.ticker}
                        className="grid grid-cols-[1fr_70px_70px_60px] sm:grid-cols-[1fr_90px_90px_80px] gap-2 px-3 sm:px-4 py-2.5 text-xs items-baseline"
                      >
                        <div className="font-mono font-semibold text-[var(--text-primary)] flex items-center gap-2 min-w-0">
                          <span className="truncate">{row.ticker}</span>
                          {isAdded && (
                            <span className="t-xs font-medium text-[var(--accent-ink)] px-1 py-0.5 rounded bg-[var(--accent)]/10 border border-[var(--accent)]/30">
                              new
                            </span>
                          )}
                          {isDropped && (
                            <span className="t-xs text-[var(--text-tertiary)] px-1 py-0.5 rounded border border-[var(--border-subtle)]">
                              dropped
                            </span>
                          )}
                        </div>
                        <div className="text-right font-mono tabular-nums text-[var(--text-secondary)]">
                          {row.curWeight > 0
                            ? `${(row.curWeight * 100).toFixed(0)}%`
                            : "·"}
                        </div>
                        <div className="text-right font-mono tabular-nums text-[var(--text-primary)]">
                          {row.cmpWeight > 0
                            ? `${(row.cmpWeight * 100).toFixed(0)}%`
                            : "·"}
                        </div>
                        <div
                          className="text-right font-mono tabular-nums text-xs"
                          style={{
                            color:
                              Math.abs(row.delta) < 0.005
                                ? "var(--text-tertiary)"
                                : row.delta > 0
                                  ? "var(--accent)"
                                  : "var(--cool-ink)",
                          }}
                        >
                          {Math.abs(row.delta) < 0.005
                            ? "·"
                            : `${row.delta > 0 ? "+" : ""}${(row.delta * 100).toFixed(0)}%`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <p className="mt-4 t-xs text-[var(--text-tertiary)] leading-relaxed">
                Δ shows the percentage-point shift in each sleeve&apos;s
                allocation when you move{" "}
                <span className="text-[var(--text-secondary)]">
                  {AXIS_LABELS[safeAxis]}
                </span>
                .{" "}
                <span className="text-[var(--accent-ink)]">Orange</span> means
                MORE allocation,{" "}
                <span style={{ color: "var(--cool-ink)" }}>blue</span> means LESS.
                &quot;new&quot; tags indicate sleeves the engine adds at
                this scenario; &quot;dropped&quot; means the opposite.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
