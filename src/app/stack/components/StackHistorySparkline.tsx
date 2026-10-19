"use client";

// 30/90-day Buying Gauge score history sparkline.
//
// Solves the "is the gauge stuck?" UX problem: the verdict score moves
// slowly because most weight is on daily-updating signals (MVRV, F&G,
// mNAV) — a single number with no trail makes a stable score look
// frozen. A sparkline shows the user the gauge IS alive, AND answers
// the most common follow-up question ("is 72 high or low historically?")
// with one glance.
//
// Powered by /api/stack/history which reads from KV. Gracefully shows
// a "history accumulating" placeholder when KV is unconfigured or
// fewer than 7 days of data have been collected — no broken chart.
//
// Hand-rolled SVG instead of recharts because:
// (a) /stack already lazy-loads recharts for the heatmap; we don't
//     want to force it onto the initial bundle,
// (b) sparklines are small enough that 100 lines of SVG is cheaper
//     than wiring a recharts component and configuring its scales.

import { useEffect, useId, useState } from "react";
import { motion } from "framer-motion";
import { TIER_LABEL } from "@/lib/stack";

type Snapshot = {
  date: string;
  score: number;
  tier: string;
};

type State =
  | { kind: "loading" }
  | { kind: "ready"; snapshots: Snapshot[] }
  | { kind: "empty" }
  | { kind: "error" };

const ACCENT = "#F7931A";
const COLD = "var(--cool-ink)";
const MOLTEN = "#EF4444";

// Minimum snapshots to draw a meaningful trend line. Below this we
// show the "accumulating" placeholder — a 1-cell line is misleading.
const MIN_FOR_DISPLAY = 7;

export function StackHistorySparkline({
  currentScore,
  currentTier,
}: {
  currentScore: number;
  currentTier: keyof typeof TIER_LABEL;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [days, setDays] = useState<30 | 90>(30);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/stack/history?days=${days}`)
      .then((r) => r.json())
      .then((body: { history?: Snapshot[] }) => {
        if (cancelled) return;
        const snapshots = Array.isArray(body.history) ? body.history : [];
        if (snapshots.length < MIN_FOR_DISPLAY) {
          setState({ kind: "empty" });
        } else {
          setState({ kind: "ready", snapshots });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6">
      <div className="flex items-baseline justify-between mb-4 gap-2">
        <div>
          <div className="micro-label text-[var(--text-tertiary)] mb-1">
            Score history
          </div>
          <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)]">
            Where {currentScore} sits in context
          </h3>
        </div>
        {/* Time-range toggle · 30 or 90 day windows.
            flex-shrink-0 + whitespace-nowrap so the toggle keeps its
            full width when the parent flex squeezes (mobile especially).
            Without these, the buttons overflow the rounded container
            and the "30d 90d" text gets clipped. */}
        <div
          className="shrink-0 flex rounded-full border border-[var(--border-subtle)] overflow-hidden"
          role="radiogroup"
          aria-label="History range"
        >
          {([30, 90] as const).map((d) => (
            <button
              key={d}
              role="radio"
              aria-checked={days === d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 font-mono t-xs uppercase tracking-widest transition-colors whitespace-nowrap ${
                days === d
                  ? "bg-[var(--accent)]/10 text-[var(--accent-ink)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {state.kind === "loading" && (
        <div className="micro-label h-32 flex items-center justify-center text-[var(--text-tertiary)]">
          Loading history…
        </div>
      )}

      {state.kind === "error" && (
        <div className="micro-label h-32 flex items-center justify-center text-[var(--warning)]">
          Couldn&apos;t load history
        </div>
      )}

      {state.kind === "empty" && (
        <EmptyState
          currentScore={currentScore}
          currentTier={TIER_LABEL[currentTier]}
        />
      )}

      {state.kind === "ready" && (
        <Sparkline
          snapshots={state.snapshots}
          currentScore={currentScore}
          currentTier={TIER_LABEL[currentTier]}
        />
      )}
    </section>
  );
}

function EmptyState({
  currentScore,
  currentTier,
}: {
  currentScore: number;
  currentTier: string;
}) {
  return (
    <div className="space-y-3">
      <div
        className="h-32 rounded-lg border border-dashed border-[var(--border-subtle)] flex items-center justify-center"
        style={{
          background:
            "linear-gradient(180deg, rgba(247,147,26,0.04), transparent)",
        }}
      >
        <div className="text-center">
          <div className="micro-label text-[var(--text-tertiary)] mb-1">
            History accumulating
          </div>
          <div className="t-xs text-[var(--text-tertiary)]">
            Daily snapshots build over time. Today: {currentScore} {currentTier}.
          </div>
        </div>
      </div>
      <p className="t-xs text-[var(--text-tertiary)] text-center font-mono">
        Each daily verdict is recorded so you can see whether {currentScore} is
        high, low, or typical.
      </p>
    </div>
  );
}

function Sparkline({
  snapshots,
  currentScore,
  currentTier,
}: {
  snapshots: Snapshot[];
  currentScore: number;
  currentTier: string;
}) {
  // Per-instance unique id for the SVG <linearGradient>. Hardcoded ids
  // collide if this component is ever mounted twice on the same page
  // (the second instance would silently override the first's gradient
  // because SVG ids are document-scoped). useId() guarantees uniqueness
  // across instances and is SSR-stable, no hydration mismatch risk.
  const uid = useId();
  const gradId = `sparkline-gradient-${uid.replace(/:/g, "")}`;

  // Compute summary stats client-side so the user sees them next to
  // the chart without a second endpoint round-trip.
  const scores = snapshots.map((s) => s.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  // Percentile of currentScore within history. "75th percentile" reads
  // more intuitively than "73 vs 64 avg" for a casual visitor.
  const percentile = Math.round(
    (scores.filter((s) => s <= currentScore).length / scores.length) * 100,
  );

  // SVG geometry. Fixed viewBox; container width drives display size.
  const W = 800;
  const H = 160;
  const PADDING = { top: 12, right: 8, bottom: 24, left: 28 };
  const innerW = W - PADDING.left - PADDING.right;
  const innerH = H - PADDING.top - PADDING.bottom;

  const xStep = innerW / Math.max(1, snapshots.length - 1);
  const yScale = (s: number) => PADDING.top + innerH - (s / 100) * innerH;

  // Line path
  const linePath = snapshots
    .map((s, i) => {
      const x = PADDING.left + i * xStep;
      const y = yScale(s.score);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Filled area under the line (fades to transparent at the bottom)
  const areaPath =
    linePath +
    ` L${(PADDING.left + (snapshots.length - 1) * xStep).toFixed(1)},${(PADDING.top + innerH).toFixed(1)}` +
    ` L${PADDING.left.toFixed(1)},${(PADDING.top + innerH).toFixed(1)} Z`;

  // Tier zones (background bands so the user sees which tier they're
  // in at any score).
  const tierBands: { from: number; to: number; color: string; label: string }[] = [
    { from: 81, to: 100, color: MOLTEN, label: "MOLTEN" },
    { from: 61, to: 80, color: ACCENT, label: "HOT" },
    { from: 41, to: 60, color: "#888", label: "WARM" },
    { from: 21, to: 40, color: "#6e9aca", label: "CHILL" },
    { from: 0, to: 20, color: COLD, label: "COLD" },
  ];

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <Stat label="Today" value={`${currentScore}`} sub={currentTier} accent />
        <Stat label="Avg" value={`${avg}`} sub={`${snapshots.length}d window`} />
        <Stat label="Range" value={`${min}–${max}`} sub="lo · hi" />
        <Stat
          label="Percentile"
          value={`${percentile}th`}
          sub={percentile >= 80 ? "near high" : percentile <= 20 ? "near low" : "in range"}
        />
      </div>

      {/* Chart */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-40"
          role="img"
          aria-label={`Buying Gauge score history over the past ${snapshots.length} days`}
        >
          {/* Tier bands (very subtle) */}
          {tierBands.map((band) => {
            const y1 = yScale(band.to);
            const y2 = yScale(band.from);
            return (
              <rect
                key={band.label}
                x={PADDING.left}
                y={y1}
                width={innerW}
                height={y2 - y1}
                fill={band.color}
                opacity={0.04}
              />
            );
          })}

          {/* Y-axis labels (0, 50, 100) */}
          {[0, 50, 100].map((s) => {
            const y = yScale(s);
            return (
              <g key={s}>
                <line
                  x1={PADDING.left}
                  x2={PADDING.left + innerW}
                  y1={y}
                  y2={y}
                  stroke="#26262C"
                  strokeWidth={s === 50 ? 0.5 : 0.3}
                  strokeDasharray={s === 50 ? "" : "2,3"}
                />
                <text
                  x={PADDING.left - 6}
                  y={y + 3}
                  textAnchor="end"
                  fill="var(--text-tertiary)"
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                >
                  {s}
                </text>
              </g>
            );
          })}

          {/* Filled area */}
          <motion.path
            d={areaPath}
            fill={`url(#${gradId})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
          />

          {/* Line */}
          <motion.path
            d={linePath}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            style={{
              filter: `drop-shadow(0 0 6px ${ACCENT}88)`,
            }}
          />

          {/* Latest point · small dot at the right edge */}
          {snapshots.length > 0 && (
            <circle
              cx={PADDING.left + (snapshots.length - 1) * xStep}
              cy={yScale(snapshots[snapshots.length - 1].score)}
              r="3.5"
              fill={ACCENT}
              style={{
                filter: `drop-shadow(0 0 8px ${ACCENT})`,
              }}
            />
          )}

          {/* Date labels (just first + last to keep it readable) */}
          {snapshots.length > 0 && (
            <>
              <text
                x={PADDING.left}
                y={H - 8}
                fill="var(--text-tertiary)"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
              >
                {fmtDate(snapshots[0].date)}
              </text>
              <text
                x={PADDING.left + innerW}
                y={H - 8}
                textAnchor="end"
                fill="var(--text-tertiary)"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
              >
                {fmtDate(snapshots[snapshots.length - 1].date)}
              </text>
            </>
          )}

          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity="0.35" />
              <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <p className="micro-label text-[var(--text-tertiary)] text-center">
        Daily snapshots · 365-day rolling window
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="micro-label text-[var(--text-tertiary)]">
        {label}
      </div>
      <div
        className={`font-mono text-xl font-semibold tabular-nums ${
          accent ? "text-[var(--accent-ink)] glow-text" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </div>
      {sub && (
        <div className="micro-label text-[var(--text-tertiary)]">
          {sub}
        </div>
      )}
    </div>
  );
}

// "2026-05-09" → "May 9". Lightweight; no Intl.DateTimeFormat needed.
function fmtDate(iso: string): string {
  const [_y, m, d] = iso.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[Number(m) - 1] ?? m} ${Number(d)}`;
}
