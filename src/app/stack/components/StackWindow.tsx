"use client";
import { useMemo, useState } from "react";
import type { ForecastCell } from "@/lib/forecast";

// Module-scope so both the component body and the useMemo (which
// builds the aria-label window strings) can format hours.
const labelHourFor = (h: number) =>
  h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;

export function StackWindow({ cells }: { cells: ForecastCell[] }) {
  const [hover, setHover] = useState<ForecastCell | null>(null);

  // Group cells by day (7 rows × 24 cols).
  const days: ForecastCell[][] = [];
  for (let d = 0; d < 7; d++) days.push(cells.slice(d * 24, (d + 1) * 24));

  // Real cell-score variance is narrow (typically a 15-20 point range), so
  // the absolute mapping `score/100` produced an almost-uniform wash. We
  // stretch against the actual min/max in the visible window so the dimmest
  // cell is faint and the brightest is fully saturated regardless of where
  // the absolute scores land. The trade-off: it's now a *relative* heatmap
  // ("which hours look best in the next 7 days?"), which is the question
  // the user is asking anyway.
  const { minScore, maxScore, topThreeKeys, gridLabel } = useMemo(() => {
    if (cells.length === 0) {
      return {
        minScore: 0,
        maxScore: 100,
        topThreeKeys: new Set<string>(),
        gridLabel: "7-day hourly forecast heatmap · no data",
      };
    }
    const scores = cells.map((c) => c.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    // Mark the top three cells (excluding the current cell, since "best
    // upcoming window" is what we want to draw the eye to).
    const future = cells.filter((c) => !c.isCurrent);
    const sorted = [...future].sort((a, b) => b.score - a.score);
    const topCells = sorted.slice(0, 3);
    const top = new Set(topCells.map((c) => `${c.utcDate}-${c.etHour}`));
    // Screen-reader summary · 168 unlabeled hover-only cells were pure
    // noise to AT users (a11y 2026-06-12). One sentence carries the
    // chart's actual takeaway: the range and the three best windows.
    const windows = topCells
      .map((c) => `${c.utcDate} ${labelHourFor(c.etHour)} ET (score ${c.score})`)
      .join(", ");
    const gridLabel =
      `7-day hourly forecast heatmap. Scores range ${min} to ${max}. ` +
      `Best three upcoming windows: ${windows}.`;
    return { minScore: min, maxScore: max, topThreeKeys: top, gridLabel };
  }, [cells]);

  const labelHour = labelHourFor;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
      {/* Header stacks on mobile (operator report 2026-06-11: the long
          tracked title next to the nowrap legend wrapped mid-phrase at
          375px). The title's break point is now deliberate · name on
          one segment, timeframe on the other. */}
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between mb-4 gap-1.5 sm:gap-3">
        <h2 className="font-mono t-xs uppercase tracking-[0.18em] sm:tracking-[0.25em] text-[var(--text-tertiary)]">
          <span className="whitespace-nowrap">The Stack Window</span>{" "}
          <span className="whitespace-nowrap">· 7 days × hourly</span>
        </h2>
        {hover ? (
          <span className="text-xs font-mono text-[var(--text-secondary)] whitespace-nowrap">
            {hover.utcDate} {labelHour(hover.etHour)} ET · score {hover.score}
            {topThreeKeys.has(`${hover.utcDate}-${hover.etHour}`) && (
              <span className="ml-2 text-[var(--accent-ink)]">★ top window</span>
            )}
          </span>
        ) : (
          <span className="micro-label flex items-center gap-2 text-[var(--text-tertiary)] whitespace-nowrap">
            worst
            <span
              className="inline-block h-2 w-24 rounded-sm"
              style={{
                background:
                  "linear-gradient(to right, rgba(247,147,26,0.05), rgba(247,147,26,0.95))",
              }}
            />
            best
            <span className="ml-2 text-[var(--accent-ink)]">★</span>
            <span className="normal-case tracking-normal text-[var(--text-tertiary)]">top 3</span>
          </span>
        )}
      </div>
      <p className="t-xs text-[var(--text-tertiary)] mb-3 leading-relaxed">
        Each cell is one hour. Brighter = predicted better entry window relative to the rest of this 7-day view.
        Hover any cell for its score; the current hour pulses; the three best upcoming hours are marked ★.
      </p>
      {/* On mobile the 25-column grid (40px label + 24 hour cols) needs
          ~400px to render without label overlap. Wrap in overflow-x-auto
          with a min-width so the heatmap scrolls horizontally on narrow
          viewports rather than collapsing labels into each other.
          Container's overflow-y stays hidden so the chart doesn't double-
          scroll vertically. -mx + px restores the card's edge bleed.
          Hour labels: bumped from 8px (unreadable) to 10px, and we now
          show every 6 hours instead of every 3 so they don't crowd. */}
      <div className="-mx-1 overflow-x-auto overflow-y-hidden">
        <div
          role="img"
          aria-label={gridLabel}
          className="grid grid-cols-[40px_repeat(24,minmax(14px,1fr))] gap-[2px] min-w-[432px] px-1"
        >
          <div />
          {Array.from({ length: 24 }).map((_, h) => (
            <div
              key={h}
              className="t-xs font-mono text-center text-[var(--text-tertiary)]"
            >
              {h % 6 === 0 ? labelHour(h) : ""}
            </div>
          ))}
          {days.map((row, di) => (
            <Row
              key={di}
              row={row}
              setHover={setHover}
              minScore={minScore}
              maxScore={maxScore}
              topThreeKeys={topThreeKeys}
              labelHour={labelHour}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  row,
  setHover,
  minScore,
  maxScore,
  topThreeKeys,
  labelHour,
}: {
  row: ForecastCell[];
  setHover: (c: ForecastCell | null) => void;
  minScore: number;
  maxScore: number;
  topThreeKeys: Set<string>;
  labelHour: (h: number) => string;
}) {
  // timeZone: "UTC" is critical here — without it, server (Vercel UTC)
  // and client (user's local TZ) format the weekday differently for cells
  // near a date boundary, producing a React #418 hydration mismatch.
  const dayLabel = row[0]
    ? new Date(row[0].utcDate + "T00:00:00Z").toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "UTC",
      })
    : "";
  const range = Math.max(1, maxScore - minScore);
  return (
    <>
      <div className="t-xs font-mono text-[var(--text-tertiary)] flex items-center">
        {dayLabel}
      </div>
      {row.map((c, i) => {
        // Stretched intensity: dimmest visible cell ≈ 0.08, brightest ≈ 0.95.
        const stretched = (c.score - minScore) / range;
        const alpha = 0.08 + stretched * 0.87;
        const isTop = topThreeKeys.has(`${c.utcDate}-${c.etHour}`);
        return (
          <div
            key={i}
            onMouseEnter={() => setHover(c)}
            onMouseLeave={() => setHover(null)}
            className={`relative aspect-square rounded-[2px] transition-transform duration-150 hover:ring-1 hover:ring-[var(--text-secondary)] hover:scale-105 ${
              c.isCurrent ? "ring-1 ring-[var(--accent)] animate-pulse" : ""
            } ${isTop ? "ring-1 ring-[var(--accent)]" : ""}`}
            style={{
              background: `rgba(247, 147, 26, ${alpha})`,
            }}
            title={`${c.utcDate} ${labelHour(c.etHour)} ET · score ${c.score}${
              isTop ? " (top 3 window)" : ""
            }`}
          >
            {isTop && !c.isCurrent && (
              <span
                className="absolute inset-0 flex items-center justify-center t-xs text-white pointer-events-none"
                style={{ textShadow: "0 0 3px rgba(0,0,0,0.7)" }}
              >
                ★
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
