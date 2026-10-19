"use client";

import { useEffect, useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { track } from "@vercel/analytics";
import type { Sleeve } from "@/lib/recommend";
import type { HistoryResponse } from "@/app/api/history/route";
import { backtest, BacktestResult } from "@/lib/backtest";

const BENCHMARKS = ["BTC", "IBIT"] as const;

// Backtest window options. 18mo (~547d) is the historical default ·
// long enough to span a meaningful market regime, short enough that
// most allocation-engine sleeves have history. 1y is the "what just
// happened" view. 3y captures a full halving-era cycle. The
// `targetDays` value is passed into backtest() · the actual window
// rendered may be shorter if a sleeve's history is the binding
// constraint.
const WINDOWS = [
  { key: "1y", label: "1y", targetDays: 365 },
  { key: "18mo", label: "18mo", targetDays: 547 },
  { key: "3y", label: "3y", targetDays: 1095 },
] as const;
type WindowKey = (typeof WINDOWS)[number]["key"];
const DEFAULT_WINDOW: WindowKey = "18mo";

export function BacktestChart({ allocation }: { allocation: Sleeve[] }) {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowKey, setWindowKey] = useState<WindowKey>(DEFAULT_WINDOW);

  // Fetch only when allocation tickers change
  const tickerKey = useMemo(
    () =>
      [...allocation.map((s) => s.asset.ticker), ...BENCHMARKS]
        .sort()
        .join(","),
    [allocation],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/history?tickers=${tickerKey}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: HistoryResponse | null) => {
        if (!cancelled) {
          setHistory(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tickerKey]);

  const targetDays = useMemo(
    () => WINDOWS.find((w) => w.key === windowKey)?.targetDays ?? 547,
    [windowKey],
  );

  const result: BacktestResult | null = useMemo(() => {
    if (!history) return null;
    return backtest(allocation, history, targetDays);
  }, [allocation, history, targetDays]);

  if (loading) {
    return (
      <div className="micro-label rounded-lg bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] p-5 text-[var(--text-tertiary)]">
        Computing backtest…
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-lg bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] p-5 text-xs text-[var(--text-tertiary)]">
        Backtest unavailable · insufficient price history for this allocation.
      </div>
    );
  }

  const days = Math.round(
    (result.endDate - result.startDate) / 86400,
  );
  const months = Math.round(days / 30);
  const beatBTC = result.totalReturnPct - result.btcReturnPct;
  const beatIBIT = result.totalReturnPct - result.ibitReturnPct;

  return (
    <div className="rounded-lg bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] p-5">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <span className="t-xs font-medium text-[var(--text-tertiary)]">
          {months}-month Hypothetical Backtest
        </span>
        {/* Window selector · 1y / 18mo / 3y. Switching re-runs backtest()
            against the same already-fetched history, so toggling is
            effectively instant (no re-fetch). The 3y window may render
            shorter if a sleeve's history is the binding constraint ·
            the "X% covered" label below tells the user when that's
            happening. */}
        <div
          className="inline-flex rounded-full border border-[var(--border-subtle)] p-0.5"
          role="tablist"
          aria-label="Backtest window"
        >
          {WINDOWS.map((w) => {
            const active = w.key === windowKey;
            return (
              <button
                key={w.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setWindowKey(w.key);
                  track("backtest_window_change", { window: w.key });
                }}
                className={`px-3 py-1 rounded-full font-mono t-xs uppercase tracking-widest transition-colors ${
                  active
                    ? "bg-[var(--accent)]/15 text-[var(--accent-ink)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-baseline justify-end mb-1">
        <span className="font-mono t-xs text-[var(--text-tertiary)]">
          {result.coverage < 0.99
            ? `${(result.coverage * 100).toFixed(0)}% covered · buy & hold`
            : "100% covered · buy & hold"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat
          label="Portfolio"
          value={`${result.totalReturnPct >= 0 ? "+" : ""}${result.totalReturnPct.toFixed(1)}%`}
          accent
        />
        <Stat
          label="vs BTC"
          value={`${beatBTC >= 0 ? "+" : ""}${beatBTC.toFixed(1)}%`}
          tone={beatBTC >= 0 ? "good" : "bad"}
        />
        <Stat
          label="Max DD"
          value={`-${result.maxDrawdownPct.toFixed(1)}%`}
          tone={result.maxDrawdownPct > 30 ? "bad" : "neutral"}
        />
      </div>

      <div className="h-44 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={result.series}>
            <XAxis
              dataKey="date"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t) => fmtDate(t)}
              tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
              axisLine={{ stroke: "var(--border-subtle)" }}
              tickLine={false}
              minTickGap={48}
            />
            <YAxis
              tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={40}
              tickFormatter={(v) => v.toFixed(0)}
            />
            <ReferenceLine y={100} stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                fontSize: "11px",
                fontFamily: "var(--font-jetbrains-mono)",
              }}
              labelFormatter={(t) => fmtDate(Number(t))}
              formatter={(v) => (typeof v === "number" ? v.toFixed(1) : String(v))}
            />
            <Line
              type="monotone"
              dataKey="portfolio"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="Portfolio"
            />
            <Line
              type="monotone"
              dataKey="btc"
              stroke="#A5A096"
              strokeWidth={1.25}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
              name="BTC"
            />
            <Line
              type="monotone"
              dataKey="ibit"
              stroke="#5C5C66"
              strokeWidth={1.25}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
              name="IBIT"
            />
            <Line
              type="monotone"
              dataKey="sp500"
              stroke="#3B82F6"
              strokeWidth={1.25}
              strokeDasharray="2 4"
              dot={false}
              isAnimationActive={false}
              name="S&P 500 (7% ARR)"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 t-xs">
        <Legend color="var(--accent)" label="Portfolio" />
        <Legend color="#A5A096" dashed label={`BTC ${result.btcReturnPct >= 0 ? "+" : ""}${result.btcReturnPct.toFixed(0)}%`} />
        <Legend color="#5C5C66" dashed label={`IBIT ${result.ibitReturnPct >= 0 ? "+" : ""}${result.ibitReturnPct.toFixed(0)}%`} />
        <Legend color="#3B82F6" dashed label={`S&P 500 ${result.sp500ReturnPct >= 0 ? "+" : ""}${result.sp500ReturnPct.toFixed(0)}%`} />
      </div>

      {(result.missingTickers.length > 0 ||
        result.excludedTickers.length > 0) && (
        <div className="mt-3 space-y-1 t-xs text-[var(--text-tertiary)]">
          {result.excludedTickers.length > 0 && (
            <p>
              Excluded to extend the window:{" "}
              {result.excludedTickers
                .map(
                  (e) =>
                    `${e.ticker} (${(e.weight * 100).toFixed(0)}%, listed ${fmtDate(e.startDate)})`,
                )
                .join(", ")}
              . The remaining sleeves were re-normalized.
            </p>
          )}
          {result.missingTickers.length > 0 && (
            <p>No history available for: {result.missingTickers.join(", ")}.</p>
          )}
        </div>
      )}

      <p className="mt-3 t-xs text-[var(--text-tertiary)] leading-relaxed">
        Buy-and-hold from{" "}
        <span className="font-mono">{fmtDate(result.startDate)}</span>. Past
        performance is not predictive. The engine targets a window of ~18
        months when most of the portfolio has that much history; otherwise it
        falls back to the longest common window.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: "good" | "bad" | "neutral";
}) {
  const color = accent
    ? "var(--accent-ink)"
    : tone === "good"
      ? "var(--success)"
      : tone === "bad"
        ? "var(--danger)"
        : "var(--text-primary)";
  return (
    <div>
      <div className="t-xs text-[var(--text-tertiary)] mb-1">
        {label}
      </div>
      <div
        className="font-mono text-lg sm:text-xl font-semibold"
        style={{ color, textShadow: accent ? "0 0 12px var(--accent-glow)" : undefined }}
      >
        {value}
      </div>
    </div>
  );
}

function Legend({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
      <span
        className="inline-block w-4 h-0.5"
        style={{
          background: dashed ? "transparent" : color,
          borderTop: dashed ? `1.5px dashed ${color}` : undefined,
        }}
      />
      {label}
    </span>
  );
}

function fmtDate(t: number): string {
  const d = new Date(t * 1000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
