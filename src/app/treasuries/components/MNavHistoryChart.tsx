"use client";

// Multi-ticker mNAV history chart.
//
// The big-picture view: pick one or more treasury tickers, plot their
// real KV-snapshotted mNAV over the last 30/90 days on a single
// chart. Lets users answer "which treasury is at a multi-week low
// right now?" — the question this whole page exists to answer.
//
// Three sources of historical mNAV exist on this page:
//   1. The per-row sparkline (MNavSparkline) which derives history
//      from stock+BTC daily closes — fast, no KV dependency, but
//      assumes constant shares-outstanding (drifts on aggressive
//      issuers).
//   2. This component, which prefers KV-snapshotted real mNAV when
//      available (accurate even with share dilution) and falls back
//      to a placeholder when KV history is empty/unconfigured.
//   3. The current live mNAV from getMarketSnapshot — what the table
//      shows in the "now" column.
//
// Hand-rolled SVG (no recharts) for the same reason as the stack
// sparkline — keep recharts off the initial bundle.

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { TREASURY_META } from "@/lib/treasuries";
import { TARGET_TICKERS } from "@/lib/market";

type Snapshot = {
  date: string;
  mNAV: number | null;
  price: number | null;
};

type SeriesState =
  | { kind: "loading" }
  | { kind: "ready"; series: { ticker: string; data: Snapshot[] }[] }
  | { kind: "empty" }
  | { kind: "error" };

// Display mode toggle. mNAV mode (default) shows the premium-to-NAV
// trail per ticker — answers "which is cheap right now?". % change
// mode normalizes each ticker's PRICE to 100 at the start of the
// visible window — answers "which actually delivered for shareholders?"
// Both use the same KV-backed snapshots; no extra API calls.
type Mode = "mnav" | "pct";

// Derived from market.ts's canonical fetch list · was previously a
// duplicate literal `["MSTR", "XXI", "MPJPY", "ASST"]` that drifted
// out of sync on past treasury rotations. Audit 2026-05-22. The
// COLORS palette below remains chart-specific (visual choice, not
// a fetch concern).
const ALL_TICKERS = TARGET_TICKERS;
// Per-ticker palette · chosen for visual distinctness on the dark
// chart background AND under red-green color blindness (~8% of men).
// MSTR keeps Bitcoin canonical orange; XXI sky-blue matches the
// "twenty-one" sky imagery; MPJPY green for the JP yen-funded
// treasury; ASST violet · was previously coral/amber but read too
// close to MSTR orange when both lines were on the chart.
const COLORS: Record<string, string> = {
  MSTR: "#F7931A",
  XXI: "var(--cool-ink)",
  MPJPY: "#4ADE80",
  ASST: "#A78BFA",
};
// The same four identities as TEXT. COLORS is tuned for a stroke on a dark
// chart; painted as a 12px chip label on the light theme's paper the raw
// palette measures 1.53:1 (MPJPY) and 2.32:1 (ASST). These resolve through
// the per-theme ink tokens — the same --accent / --accent-ink split the rest
// of the site uses — so a chip stays legible in both themes while the line it
// toggles keeps the exact hue that makes the chart readable without a legend.
const COLORS_INK: Record<string, string> = {
  MSTR: "var(--accent-ink)",
  XXI: "var(--cool-ink)",
  MPJPY: "var(--series-green-ink)",
  ASST: "var(--series-violet-ink)",
};
// Translucency via color-mix, NOT hex-append: `${COLORS[t]}1A` produces the
// literal string "var(--cool-ink)1A" for XXI, which is invalid CSS, so that
// one chip silently lost its tint and its dot glow while the other three had
// them. color-mix works for hex and var() alike.
const tint = (c: string, pct: number) =>
  `color-mix(in srgb, ${c} ${pct}%, transparent)`;
const MIN_FOR_DISPLAY = 3;

export function MNavHistoryChart() {
  const [state, setState] = useState<SeriesState>({ kind: "loading" });
  const [days, setDays] = useState<30 | 90>(90);
  const [mode, setMode] = useState<Mode>("mnav");
  // Default to ALL tracked tickers · ASST was previously off-by-default
  // for "readability" but excluding one of the four tracked treasuries
  // made it look deprecated. The four palette colors are distinct
  // enough (orange / blue / green / violet) and the toggle pills below
  // let users mute lines they don't care about. (Violet replaced the
  // earlier coral/amber for ASST in commit ab34e4e — coral read too
  // close to MSTR's orange.)
  const [selected, setSelected] = useState<Set<string>>(
    new Set(ALL_TICKERS),
  );

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    Promise.all(
      ALL_TICKERS.map((t) =>
        fetch(`/api/treasuries/history?ticker=${t}&days=${days}`)
          .then((r) => r.json())
          .then((b: { history?: Snapshot[] }) => ({
            ticker: t,
            data: Array.isArray(b.history) ? b.history : [],
          }))
          .catch(() => ({ ticker: t, data: [] as Snapshot[] })),
      ),
    ).then((series) => {
      if (cancelled) return;
      const totalPoints = series.reduce((a, s) => a + s.data.length, 0);
      if (totalPoints < MIN_FOR_DISPLAY) {
        setState({ kind: "empty" });
      } else {
        setState({ kind: "ready", series });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6">
      <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="micro-label text-[var(--text-tertiary)] mb-1">
            {mode === "mnav" ? "mNAV History" : "Price Performance"}
          </div>
          <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)]">
            {mode === "mnav"
              ? "Premium-to-NAV trails"
              : "% change since start of window"}
          </h3>
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          {/* Mode toggle: mNAV vs % change. The % change mode answers
              "did this leverage actually pay off?" · normalizes each
              treasury's PRICE to 100 at the start of the visible
              window so visitors can compare relative performance. */}
          <div
            className="shrink-0 flex rounded-full border border-[var(--border-subtle)] overflow-hidden"
            role="radiogroup"
            aria-label="Display mode"
          >
            <button
              role="radio"
              aria-checked={mode === "mnav"}
              onClick={() => setMode("mnav")}
              className={`px-3 py-1 font-mono t-xs uppercase tracking-widest transition-colors whitespace-nowrap ${
                mode === "mnav"
                  ? "bg-[var(--accent)]/10 text-[var(--accent-ink)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              mNAV
            </button>
            <button
              role="radio"
              aria-checked={mode === "pct"}
              onClick={() => setMode("pct")}
              className={`px-3 py-1 font-mono t-xs uppercase tracking-widest transition-colors whitespace-nowrap ${
                mode === "pct"
                  ? "bg-[var(--accent)]/10 text-[var(--accent-ink)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              % change
            </button>
          </div>
          <div
            className="shrink-0 flex rounded-full border border-[var(--border-subtle)] overflow-hidden"
            role="radiogroup"
            aria-label="Window length"
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
      </div>

      {/* Ticker toggles · doubles as the chart legend. Bumped swatch
          size + spacing so the color → ticker mapping reads as a legend
          at a glance, not as just-another-pill-row. */}
      <div className="flex flex-wrap gap-2 mb-5">
        {ALL_TICKERS.map((t) => {
          const active = selected.has(t);
          return (
            <button
              key={t}
              onClick={() => {
                const next = new Set(selected);
                if (active) {
                  if (next.size > 1) next.delete(t);
                } else {
                  next.add(t);
                }
                setSelected(next);
              }}
              className="micro-label px-3 py-1.5 rounded-full border transition-colors flex items-center gap-2"
              style={{
                borderColor: active ? COLORS[t] : "var(--border-subtle)",
                color: active ? COLORS_INK[t] : "var(--text-tertiary)",
                background: active ? tint(COLORS[t], 10) : "transparent",
              }}
              aria-pressed={active}
              aria-label={`Toggle ${t} on chart`}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{
                  background: active ? COLORS[t] : "var(--text-tertiary)",
                  opacity: active ? 1 : 0.4,
                  boxShadow: active ? `0 0 6px ${tint(COLORS[t], 50)}` : "none",
                }}
              />
              {t}
            </button>
          );
        })}
      </div>

      {state.kind === "loading" && (
        <div className="micro-label h-48 flex items-center justify-center text-[var(--text-tertiary)]">
          Loading…
        </div>
      )}
      {state.kind === "error" && (
        <div className="micro-label h-48 flex items-center justify-center text-[var(--warning)]">
          Couldn&apos;t load history
        </div>
      )}
      {state.kind === "empty" && (
        <div
          className="h-48 rounded-lg border border-dashed border-[var(--border-subtle)] flex items-center justify-center"
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
              Daily mNAV snapshots build over time. Per-row sparklines below
              use derived history in the meantime.
            </div>
          </div>
        </div>
      )}
      {state.kind === "ready" && (
        <Chart
          series={state.series.filter((s) => selected.has(s.ticker))}
          mode={mode}
        />
      )}

      <p className="micro-label mt-4 text-[var(--text-tertiary)] text-center">
        {mode === "mnav"
          ? "Actual per-day mNAV from "
          : "Daily closing prices, normalized to 100 at start of window · from "}
        <span className="text-[var(--text-secondary)]">bitcointreasuries.net</span> · snapshotted to KV
      </p>
    </section>
  );
}

function Chart({
  series,
  mode,
}: {
  series: { ticker: string; data: Snapshot[] }[];
  mode: Mode;
}) {
  // Responsive, distortion-free sizing. The earlier approach used a
  // fixed viewBox (W=800, then 560) + preserveAspectRatio="none", which
  // stretches the SVG — and its axis TEXT — NON-uniformly to fill the
  // container: text squished on a narrow phone, stretched wide on a
  // roomy Mac Safari window (operator reports 2026-06-14). No fixed W
  // fixes both: with preserveAspectRatio="none" the horizontal and
  // vertical scale factors differ whenever container aspect ≠ viewBox
  // aspect, so text is always warped off-square. Fix: measure the real
  // box and set the viewBox to those pixel dimensions, so user units map
  // 1:1 to pixels — scale is 1 on both axes and text renders at its true
  // size (fontSize 13 = 13px) on every screen. ResizeObserver keeps it
  // correct across resize / orientation / font-zoom.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 720, h: 240 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () =>
      setDims({
        w: Math.max(320, Math.round(el.clientWidth)),
        h: Math.max(160, Math.round(el.clientHeight)),
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = dims.w;
  const H = dims.h;
  const PADDING = { top: 12, right: 8, bottom: 28, left: 38 };
  const innerW = W - PADDING.left - PADDING.right;
  const innerH = H - PADDING.top - PADDING.bottom;

  // y-range depends on mode. mNAV uses fixed [0.5, 2.5] (matches the
  // table's bar visualisation). Price-change uses dynamic bounds
  // tightened to the actual data so divergence is visible.
  let yMin: number;
  let yMax: number;
  if (mode === "mnav") {
    yMin = 0.5;
    yMax = 2.5;
  } else {
    // Compute % change for each series, find global min/max
    const allPcts: number[] = [];
    for (const s of series) {
      if (s.data.length < 2) continue;
      const first = s.data.find((d) => d.price != null && d.price > 0);
      if (!first || first.price == null) continue;
      for (const pt of s.data) {
        if (pt.price != null && pt.price > 0) {
          allPcts.push((pt.price / first.price - 1) * 100);
        }
      }
    }
    if (allPcts.length === 0) {
      yMin = -10;
      yMax = 10;
    } else {
      const lo = Math.min(...allPcts);
      const hi = Math.max(...allPcts);
      // Pad by 10% of the visible range; clamp so 0% line is always
      // visible (it's the reference for "no change since start").
      const pad = Math.max(2, (hi - lo) * 0.1);
      yMin = Math.min(0, lo - pad);
      yMax = Math.max(0, hi + pad);
    }
  }
  const yScale = (v: number) =>
    PADDING.top +
    innerH -
    ((Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * innerH;

  // X-axis spans the union of all dates across visible series. We use
  // each series' own date positions for charting because they're
  // aligned by day (snapshotted at the same UTC offset by the cron).
  // For x-positioning, we use the longest series as the reference
  // grid; shorter series start in from the right.
  const longestLen = Math.max(1, ...series.map((s) => s.data.length));
  const xStep = innerW / Math.max(1, longestLen - 1);

  return (
    <div ref={wrapRef} className="w-full h-60">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-full"
        role="img"
        aria-label="mNAV history chart"
      >
        {/* Reference line: 1.0× in mNAV mode, 0% in pct mode */}
        <line
          x1={PADDING.left}
          x2={PADDING.left + innerW}
          y1={yScale(mode === "mnav" ? 1.0 : 0)}
          y2={yScale(mode === "mnav" ? 1.0 : 0)}
          stroke="var(--border-subtle)"
          strokeWidth="1"
          strokeDasharray="3,3"
        />
        <text
          x={PADDING.left + innerW + 4}
          y={yScale(mode === "mnav" ? 1.0 : 0) + 3}
          fill="var(--text-secondary)"
          fontSize="13"
          fontFamily="ui-monospace, monospace"
        >
          {mode === "mnav" ? "NAV" : "0%"}
        </text>

        {/* y-axis labels · CSS vars so the cream-on-cream / white-
            on-white invisibility in light theme is gone (audit
            2026-05-22 · were hardcoded rgba whites + #5C5C66). */}
        {(mode === "mnav"
          ? [0.5, 1.0, 1.5, 2.0, 2.5]
          : ySnaps(yMin, yMax)
        ).map((v) => (
          <text
            key={v}
            x={PADDING.left - 4}
            y={yScale(v) + 3}
            textAnchor="end"
            fill="var(--text-tertiary)"
            fontSize="13"
            fontFamily="ui-monospace, monospace"
          >
            {mode === "mnav"
              ? `${v.toFixed(1)}×`
              : `${v >= 0 ? "+" : ""}${Math.round(v)}%`}
          </text>
        ))}

        {/* Each ticker's line */}
        {series.map((s) => {
          if (s.data.length < 2) return null;
          // For pct mode, normalize each series to its first valid
          // PRICE point as 100; the y-value is % change from that base.
          // mNAV mode just uses the snapshot's mNAV directly.
          const valueOf = (pt: Snapshot, basePrice: number | null): number | null => {
            if (mode === "mnav") return pt.mNAV;
            if (pt.price == null || basePrice == null || basePrice <= 0) return null;
            return (pt.price / basePrice - 1) * 100;
          };
          const basePrice =
            mode === "pct"
              ? s.data.find((d) => d.price != null && d.price > 0)?.price ?? null
              : null;

          // Right-align: shorter series start later on the x-axis so
          // their last point matches the longest series' last point
          // (today). Both end "today"; older windows just have less data.
          const offset = longestLen - s.data.length;
          const path = s.data
            .map((pt, i) => {
              const v = valueOf(pt, basePrice);
              if (v == null) return null;
              const x = PADDING.left + (i + offset) * xStep;
              const y = yScale(v);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .filter(Boolean) as string[];
          if (path.length === 0) return null;
          const linePath = path
            .map((p, i) => `${i === 0 ? "M" : "L"}${p}`)
            .join(" ");

          // Latest point dot — mode-aware value
          const lastIdx = s.data.length - 1;
          const lastVal = valueOf(s.data[lastIdx], basePrice);
          const lastX = PADDING.left + (lastIdx + offset) * xStep;
          const lastY = lastVal != null ? yScale(lastVal) : null;

          const color = COLORS[s.ticker] ?? "#fff";
          // The end-of-line LABEL is text on the page ground, not a stroke on
          // the plot, so it takes the ink twin: raw MPJPY green measured
          // 1.51:1 and MSTR orange 1.99:1 on the light theme's paper. The line
          // and its dot keep the palette hue that identifies the series.
          const labelColor = COLORS_INK[s.ticker] ?? "var(--text-primary)";

          return (
            <g key={s.ticker}>
              <motion.path
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                style={{ filter: `drop-shadow(0 0 4px ${color}66)` }}
              />
              {lastY != null && (
                <>
                  <circle
                    cx={lastX}
                    cy={lastY}
                    r="4"
                    fill={color}
                    style={{ filter: `drop-shadow(0 0 6px ${color})` }}
                  />
                  <text
                    x={lastX + 8}
                    y={lastY + 3}
                    fill={labelColor}
                    fontSize="12"
                    fontFamily="ui-monospace, monospace"
                    fontWeight="600"
                  >
                    {s.ticker}{" "}
                    {mode === "mnav"
                      ? `${lastVal!.toFixed(2)}×`
                      : `${lastVal! >= 0 ? "+" : ""}${lastVal!.toFixed(1)}%`}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* x-axis date markers (first + last from longest series) */}
        {series.length > 0 && (() => {
          const longest = series.reduce((a, b) => (b.data.length > a.data.length ? b : a));
          if (longest.data.length === 0) return null;
          return (
            <>
              <text
                x={PADDING.left + (longestLen - longest.data.length) * xStep}
                y={H - 8}
                fill="var(--text-tertiary)"
                fontSize="13"
                fontFamily="ui-monospace, monospace"
              >
                {fmtDate(longest.data[0].date)}
              </text>
              <text
                x={PADDING.left + innerW}
                y={H - 8}
                textAnchor="end"
                fill="var(--text-tertiary)"
                fontSize="13"
                fontFamily="ui-monospace, monospace"
              >
                {fmtDate(longest.data[longest.data.length - 1].date)}
              </text>
            </>
          );
        })()}
      </svg>
    </div>
  );
}

// Generate clean y-axis tick values for % change mode. Picks 5 evenly
// spaced ticks across [yMin, yMax] rounded to "nice" integers (5%, 10%,
// 25%, 50%, 100% intervals depending on range size). Always includes
// 0 if it's in range so the "no change" reference is labeled.
function ySnaps(yMin: number, yMax: number): number[] {
  const range = yMax - yMin;
  const targetSteps = 5;
  const rawStep = range / targetSteps;
  // Round to nearest "nice" interval
  const candidates = [1, 2, 5, 10, 25, 50, 100];
  let step = candidates[0];
  for (const c of candidates) {
    if (c >= rawStep) {
      step = c;
      break;
    }
    step = c;
  }
  const ticks: number[] = [];
  const startTick = Math.ceil(yMin / step) * step;
  for (let v = startTick; v <= yMax; v += step) {
    ticks.push(v);
  }
  if (yMin <= 0 && yMax >= 0 && !ticks.includes(0)) ticks.push(0);
  return ticks.sort((a, b) => a - b);
}

function fmtDate(iso: string): string {
  const [_y, m, d] = iso.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[Number(m) - 1] ?? m} ${Number(d)}`;
}

// Re-export TREASURY_META metadata reference so a future enhancement
// can show name/blurb on hover without refactoring the import chain.
export { TREASURY_META };
