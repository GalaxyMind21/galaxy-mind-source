"use client";

// "Stress-test the market" for /fit · the market-signal sibling of
// ScenarioCompare.
//
// ScenarioCompare answers "what if I change MY profile (risk tier /
// horizon)?". This answers "what if the MARKET moves?" — let the user drag
// the three live signals the engine actually reads (MSTR mNAV, Fear &
// Greed, 30d realized vol) and watch the recommended sleeves + Sharpe +
// expected return move in response.
//
// 100% client-side: it calls the SAME pure `recommend()` with a patched
// snapshot copy — identical to how ScenarioCompare and the page's own
// `scenarios` memo already explore alternates. The engine is never
// touched, so the /fit invariants in scripts/test-recommend.ts are
// unaffected. Collapsed by default so it adds no weight unless invited.

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { track } from "@vercel/analytics";
import { recommend, type RecommendInput, type Recommendation } from "@/lib/recommend";
import { DiffStat } from "./DiffStat";

// Neutral fallbacks when a live signal is unavailable (degraded snapshot).
// Mid-of-range values so the starting point reads as "ordinary market".
const NEUTRAL = { mnav: 1.2, fg: 50, vol: 55 };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function WhatIfSignals({
  base,
  live,
}: {
  // The exact RecommendInput the live recommendation was computed from.
  base: RecommendInput;
  // The live recommendation, to diff the what-if against.
  live: Recommendation;
}) {
  const [open, setOpen] = useState(false);

  const liveMnav = base.mNAVByTicker?.["MSTR"] ?? null;
  const liveFg = base.fearGreed ?? null;
  const liveVol = base.btcVol30d ?? null;
  const anyLiveMissing = liveMnav == null || liveFg == null || liveVol == null;

  // override = null means "track the live signal"; a number means the
  // user has dragged that slider. Deriving from RAW live (below) keeps the
  // at-rest diff exactly zero AND lets the sliders auto-follow live until
  // touched — important because /api/market resolves AFTER this mounts, so
  // a fixed initial value would strand the sliders at a stale default and
  // show phantom deltas before the user moves anything.
  const [mnavOverride, setMnavOverride] = useState<number | null>(null);
  const [fgOverride, setFgOverride] = useState<number | null>(null);
  const [volOverride, setVolOverride] = useState<number | null>(null);
  const mnav = mnavOverride ?? liveMnav ?? NEUTRAL.mnav;
  const fg = fgOverride ?? liveFg ?? NEUTRAL.fg;
  const vol = volOverride ?? liveVol ?? NEUTRAL.vol;
  const dirty =
    mnavOverride !== null || fgOverride !== null || volOverride !== null;

  const whatIf = useMemo(
    () =>
      recommend({
        ...base,
        mNAVByTicker: { ...(base.mNAVByTicker ?? {}), MSTR: mnav },
        fearGreed: fg,
        btcVol30d: vol,
      }),
    [base, mnav, fg, vol],
  );

  // Asset-by-asset diff · union of tickers, sorted by the larger of the
  // two weights so the biggest positions lead (mirrors ScenarioCompare).
  const diffRows = useMemo(() => {
    const cur = new Map(live.allocation.map((s) => [s.asset.ticker, s.weight]));
    const wi = new Map(whatIf.allocation.map((s) => [s.asset.ticker, s.weight]));
    const rows = [...new Set([...cur.keys(), ...wi.keys()])].map((ticker) => {
      const curWeight = cur.get(ticker) ?? 0;
      const wiWeight = wi.get(ticker) ?? 0;
      return { ticker, curWeight, wiWeight, delta: wiWeight - curWeight };
    });
    rows.sort(
      (a, b) =>
        Math.max(b.curWeight, b.wiWeight) - Math.max(a.curWeight, a.wiWeight),
    );
    return rows;
  }, [live, whatIf]);

  function resetToLive() {
    setMnavOverride(null);
    setFgOverride(null);
    setVolOverride(null);
  }

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) track("fit_whatif_open");
        }}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[var(--bg-elevated-2)]/50 transition-colors"
        aria-expanded={open}
      >
        <div>
          <div className="t-xs font-medium text-[var(--text-tertiary)] mb-1">
            Stress-test the market
          </div>
          <div className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
            What if{" "}
            <span className="text-[var(--accent-ink)]">the signals move</span>?
          </div>
        </div>
        <span className="font-mono text-[var(--accent-ink)] text-base">
          {open ? "−" : "+"}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <div className="border-t border-[var(--border-subtle)] p-5">
              {/* Sliders · the three live signals the engine reads. */}
              <div className="space-y-4 mb-5">
                <SignalSlider
                  label="MSTR mNAV"
                  min={0.5}
                  max={3}
                  step={0.05}
                  value={mnav}
                  onChange={(v) => setMnavOverride(round2(v))}
                  fmt={(v) => `${v.toFixed(2)}×`}
                  live={liveMnav}
                  liveFmt={(v) => `${v.toFixed(2)}×`}
                />
                <SignalSlider
                  label="Fear & Greed"
                  min={0}
                  max={100}
                  step={1}
                  value={fg}
                  onChange={(v) => setFgOverride(Math.round(v))}
                  fmt={(v) => `${Math.round(v)}`}
                  live={liveFg}
                  liveFmt={(v) => `${Math.round(v)}`}
                />
                <SignalSlider
                  label="30d realized vol"
                  min={20}
                  max={150}
                  step={1}
                  value={vol}
                  onChange={(v) => setVolOverride(Math.round(v))}
                  fmt={(v) => `${Math.round(v)}%`}
                  live={liveVol}
                  liveFmt={(v) => `${Math.round(v)}%`}
                />
              </div>

              <div className="flex items-center justify-between gap-3 mb-5">
                <p className="t-xs text-[var(--text-tertiary)]">
                  {dirty ? "Hypothetical market" : "Matches the live market"}
                </p>
                <button
                  onClick={resetToLive}
                  disabled={!dirty}
                  className="micro-label px-3 py-1 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)] enabled:hover:border-[var(--text-tertiary)] disabled:opacity-40 disabled:cursor-default transition-colors"
                >
                  ↺ Reset to live
                </button>
              </div>

              {/* Headline metrics: live → what-if with colored deltas. */}
              <div className="grid grid-cols-3 gap-3 mb-5 font-mono">
                <DiffStat
                  label="Expected return"
                  current={live.expectedReturn.annualCentral}
                  comparison={whatIf.expectedReturn.annualCentral}
                  fmt={(v) => `${(v * 100).toFixed(1)}%`}
                  betterIfHigher
                />
                <DiffStat
                  label="Sharpe"
                  current={live.expectedReturn.sharpeRatio}
                  comparison={whatIf.expectedReturn.sharpeRatio}
                  fmt={(v) => v.toFixed(2)}
                  betterIfHigher
                />
                <DiffStat
                  label="Volatility"
                  current={live.expectedReturn.portfolioVolatility}
                  comparison={whatIf.expectedReturn.portfolioVolatility}
                  fmt={(v) => `${(v * 100).toFixed(0)}%`}
                  betterIfHigher={false}
                />
              </div>

              {/* Side-by-side sleeve table. */}
              <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                <div className="grid grid-cols-[1fr_70px_70px_60px] sm:grid-cols-[1fr_90px_90px_80px] gap-2 px-3 sm:px-4 py-2 t-xs text-[var(--text-tertiary)] bg-[rgba(255,255,255,0.015)]">
                  <div>Ticker</div>
                  <div className="text-right">Live</div>
                  <div className="text-right">What-if</div>
                  <div className="text-right">Δ</div>
                </div>
                <div className="divide-y divide-[var(--border-subtle)]">
                  {diffRows.map((row) => {
                    const isAdded = row.curWeight === 0 && row.wiWeight > 0;
                    const isDropped = row.curWeight > 0 && row.wiWeight === 0;
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
                          {row.curWeight > 0 ? `${(row.curWeight * 100).toFixed(0)}%` : "·"}
                        </div>
                        <div className="text-right font-mono tabular-nums text-[var(--text-primary)]">
                          {row.wiWeight > 0 ? `${(row.wiWeight * 100).toFixed(0)}%` : "·"}
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
                A hypothetical · the live engine run with tweaked market
                inputs, not advice.{" "}
                {anyLiveMissing
                  ? "One or more live signals are unavailable right now, so sliders start from a neutral assumption. "
                  : ""}
                <span className="text-[var(--accent-ink)]">Orange</span> = more
                allocation / better, <span style={{ color: "var(--cool-ink)" }}>blue</span>{" "}
                = less / more risk.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// A labelled range slider with live-value reference. Native range input
// themed via accent-color so it matches without bespoke thumb CSS.
function SignalSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  fmt,
  live,
  liveFmt,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  fmt: (v: number) => string;
  live: number | null;
  liveFmt: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="micro-label text-[var(--text-secondary)]">
          {label}
        </span>
        <span className="font-mono text-sm tabular-nums text-[var(--accent-ink)]">
          {fmt(value)}
          {live != null && (
            <span className="ml-2 t-xs text-[var(--text-tertiary)] normal-case tracking-normal">
              live {liveFmt(live)}
            </span>
          )}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={`${label} what-if value`}
        className="w-full accent-[var(--accent)] cursor-pointer"
      />
    </div>
  );
}
