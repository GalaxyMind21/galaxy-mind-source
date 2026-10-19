"use client";

// DiffStat · a 3-row stat block: label, current value, comparison value
// with a colored delta. Color codes the delta by whether higher is better
// for that metric (return / Sharpe = good when up; volatility = bad when
// up). Shared by the /fit "Compare scenarios" (ScenarioCompare) and
// "Stress-test the market" (WhatIfSignals) panels so both read identically.

export function DiffStat({
  label,
  current,
  comparison,
  fmt,
  betterIfHigher,
}: {
  label: string;
  current: number;
  comparison: number;
  fmt: (v: number) => string;
  betterIfHigher: boolean;
}) {
  const delta = comparison - current;
  const better = betterIfHigher ? delta > 0 : delta < 0;
  const same = Math.abs(delta) < 1e-6;
  const color = same
    ? "var(--text-tertiary)"
    : better
      ? "var(--accent)"
      : "var(--cool-ink)";
  const arrow = same ? "→" : delta > 0 ? "↑" : "↓";
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/40 px-3 py-2.5">
      <div className="t-xs uppercase tracking-widest text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-sm tabular-nums text-[var(--text-secondary)]">
          {fmt(current)}
        </span>
        <span className="text-[var(--text-tertiary)] text-xs">→</span>
        <span className="text-sm tabular-nums font-semibold" style={{ color }}>
          {fmt(comparison)}
        </span>
      </div>
      <div
        className="micro-label mt-0.5"
        style={{ color }}
      >
        {arrow} {fmt(Math.abs(delta))}
      </div>
    </div>
  );
}
