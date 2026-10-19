"use client";

/* =====================================================================
 * FloatTrendChart · "The Float Over Time"
 *
 * Shows the historical Bitcoin float curve from genesis (2009) to today.
 * Default range is INCEPTION so the visitor immediately sees the
 * "started near 21M, now 6M" arc that drives the page's thesis.
 *
 * Two data sources:
 *   - syntheticHistory · monthly samples from genesis, computed from
 *     known cohort-launch dates + today's cohort sizes. Used as the
 *     primary curve at all date ranges. Always present, deterministic,
 *     17 years of x-axis span without depending on KV depth.
 *   - history · KV-sourced daily snapshots, only as deep as the cron
 *     has accumulated. Useful for short-range zoom but contributes
 *     basically nothing on the inception view (~3 days of data on a
 *     17-year axis is invisible). We keep the prop wired in case a
 *     future range button wants to surface daily granularity.
 *
 * Range buttons: ALL (inception), 5Y, 1Y. ALL is default because it's
 * the framing the operator and the user both want to see first.
 * ===================================================================== */

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { FloatSnapshot } from "@/lib/float-snapshot";
import { HALVING_SCHEDULE } from "@/lib/bitcoin-supply";

type Props = {
  /** KV-sourced daily history (newest-first). Empty until cron has run. */
  history: FloatSnapshot[];
  /** Synthetic monthly history from genesis to today. Always populated. */
  syntheticHistory: FloatSnapshot[];
};

type Range = "1Y" | "5Y" | "ALL";

// Spot Bitcoin ETFs launched on this date · we render a green
// vertical marker on the chart at this point because the float
// declined notably afterward (ETFs absorb supply).
const ETF_LAUNCH = "2024-01-11";

export function FloatTrendChart({ history, syntheticHistory }: Props) {
  // Default to ALL so the visitor sees the inception story immediately.
  // The whole reason this chart exists is the multi-year downward arc.
  const [range, setRange] = useState<Range>("ALL");

  // Pick the data source per range:
  //   - ALL · synthetic only (KV data invisible at this timescale)
  //   - 5Y · synthetic (covers 2021+ which includes the MSTR/ETF era)
  //   - 1Y · synthetic if KV is sparse, KV daily if we have ≥30 days
  // Always render newest-LAST so chart x-axis flows left→right
  // chronologically. KV/synthetic are stored newest-first.
  //
  // We plot `available` = yetToMine + inPlay · the "bitcoin still up
  // for grabs" curve. Starts at 21M (genesis · everything yet-to-mine,
  // nothing in circulation) and trends down to ~7M today. Matches the
  // user's framing: "yet to be mined AND bought." A pure inPlay-only
  // curve would rise then fall, which buries the supply-shock story.
  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoffMs: Record<Range, number> = {
      "1Y": now - 365 * 86_400_000,
      "5Y": now - 5 * 365 * 86_400_000,
      ALL: 0,
    };
    // For 1Y: prefer KV daily granularity if we have substantial
    // daily history, otherwise fall back to synthetic monthly.
    const usableKv = history.filter(
      (h) => new Date(h.date).getTime() >= cutoffMs[range],
    );
    const source =
      range === "1Y" && usableKv.length >= 30 ? usableKv : syntheticHistory;
    return source
      .filter((h) => new Date(h.date).getTime() >= cutoffMs[range])
      .map((h) => ({
        date: h.date,
        // available = yetToMine + inPlay (millions BTC)
        available: (h.cohorts.yetToMine + h.inPlay) / 1_000_000,
        inPlay: h.inPlay / 1_000_000,
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [history, syntheticHistory, range]);

  // Halving event vertical lines · only render markers that fall
  // inside the rendered date range
  const halvingMarkers = useMemo(
    () =>
      HALVING_SCHEDULE
        .filter((h) => h.date !== null)
        .filter(
          (h) =>
            filtered.length > 0 &&
            h.date! >= filtered[0].date &&
            h.date! <= filtered[filtered.length - 1].date,
        )
        .map((h) => ({ date: h.date!, label: `⬇ HALVING ${h.ordinal}` })),
    [filtered],
  );

  // X-axis tick formatter · year-only on long ranges (less clutter),
  // year-month on short ranges where months matter for context.
  const xTickFormatter = (d: string) =>
    range === "1Y" ? d.slice(0, 7) : d.slice(0, 4);

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
            The Float Over Time
          </h2>
          <p className="text-xs text-[var(--text-tertiary)]">
            Bitcoin still up for grabs, yet to be mined or bought · halving events marked
          </p>
        </div>
        <div className="flex gap-2 sm:gap-1.5 font-mono t-xs">
          {(["1Y", "5Y", "ALL"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 px-3 sm:py-1 rounded-full border transition-colors flex items-center justify-center ${
                range === r
                  ? "border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent)]/10"
                  : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--accent-ink)]"
              }`}
              aria-label={`Show ${r} range`}
              aria-pressed={range === r}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      {filtered.length < 2 ? (
        <div className="h-[200px] flex items-center justify-center text-[var(--text-tertiary)] text-sm italic">
          History accumulating · check back tomorrow.
        </div>
      ) : (
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={filtered} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="floatGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F7931A" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#F7931A" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
                tickFormatter={xTickFormatter}
                axisLine={{ stroke: "var(--border-subtle)" }}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
                tickFormatter={(v) => `${v.toFixed(0)}M`}
                axisLine={{ stroke: "var(--border-subtle)" }}
                domain={[0, "dataMax + 1"]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0a0807",
                  border: "1px solid #2a1a0a",
                  fontFamily: "JetBrains Mono",
                  fontSize: 11,
                }}
                labelStyle={{ color: "#a07a4a" }}
                itemStyle={{ color: "#F7931A" }}
                formatter={(v) => [
                  typeof v === "number" ? `${v.toFixed(2)}M BTC` : String(v),
                  "up for grabs",
                ]}
              />
              {halvingMarkers.map((h) => (
                <ReferenceLine
                  key={h.date}
                  x={h.date}
                  stroke="#F7931A"
                  strokeDasharray="3 3"
                  strokeOpacity={0.5}
                  label={{ value: h.label, fill: "#F7931A", fontSize: 9, position: "top" }}
                />
              ))}
              {filtered.length > 0 &&
                filtered[0].date <= ETF_LAUNCH &&
                filtered[filtered.length - 1].date >= ETF_LAUNCH && (
                  <ReferenceLine
                    x={ETF_LAUNCH}
                    stroke="#4ADE80"
                    strokeDasharray="3 3"
                    strokeOpacity={0.5}
                    label={{
                      value: "⬇ SPOT ETFs",
                      fill: "#4ADE80",
                      fontSize: 9,
                      position: "top",
                    }}
                  />
                )}
              <Area
                type="monotone"
                dataKey="available"
                stroke="#F7931A"
                strokeWidth={2.5}
                fill="url(#floatGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {range !== "1Y" && (
        <p className="mt-3 t-xs text-[var(--text-tertiary)] leading-relaxed">
          Synthetic reconstruction · monthly samples computed from cohort
          launch dates (Silk Road seizure 2013, MSTR Aug 2020, Spot ETFs
          Jan 2024) and current cohort sizes. Daily KV-snapshot
          granularity available on the 1Y view once enough history accumulates.
        </p>
      )}
    </section>
  );
}
