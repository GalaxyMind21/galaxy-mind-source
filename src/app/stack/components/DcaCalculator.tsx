"use client";

// "If you'd DCA'd $X/week since [date]…" calculator.
//
// Why this exists:
// Most bitcoiners DCA. The Buying Gauge tells them "is this moment a
// good entry?" but doesn't help them grok the LONG-RUN compounding
// of regular buys. This calculator does — given $/week and a start
// date, it walks the historical price series and computes:
//   - total invested
//   - total BTC + sats accumulated
//   - current value at today's price
//   - unrealized return %
//
// Pure client-side: takes the snapshot's hourly closes (compact
// CompactHourlySeries form · timestamps derived, not shipped) and a
// start date, samples weekly closing prices, accumulates BTC
// purchased per week. No server round-trip.
//
// History depth is the limiting factor — we have 400d of hourly data,
// so the earliest meaningful start date is ~13 months ago. The UI
// caps the date picker accordingly.

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { track } from "@vercel/analytics";

const BTC_TO_SATS = 100_000_000;

/** Compact hourly price series · built by compactHourlySeries() in
 *  StackContent. The full parallel timestamp array (9.5K absolute
 *  unix-seconds at almost-always-3600s spacing) was ~a third of the
 *  /stack flight payload (audit 2026-07-12); the spacing exceptions
 *  list lets the client rebuild every timestamp EXACTLY from two
 *  numbers + a handful of [index, delta] pairs. Closes arrive rounded
 *  to cents for the same reason. */
export type CompactHourlySeries = {
  /** unix-seconds of closes[0] */
  startTimestamp: number;
  /** nominal spacing between closes (3600) */
  stepSeconds: number;
  /** [index, actual delta from index-1] wherever delta ≠ stepSeconds */
  irregularSteps: [number, number][];
  /** hourly closes, oldest first, rounded to cents */
  closes: number[];
};

export function DcaCalculator({
  series,
  currentPrice,
}: {
  series: CompactHourlySeries | null;
  currentPrice: number | null;
}) {
  // Rebuild the exact timestamp array the walk below was written
  // against — one linear pass, trivial next to the recharts work the
  // page already does client-side.
  const { hourlyCloses, hourlyTimestamps } = useMemo(() => {
    if (!series || series.closes.length === 0) {
      return { hourlyCloses: null, hourlyTimestamps: null };
    }
    const irregular = new Map(series.irregularSteps);
    const ts = new Array<number>(series.closes.length);
    let t = series.startTimestamp;
    ts[0] = t;
    for (let i = 1; i < series.closes.length; i++) {
      t += irregular.get(i) ?? series.stepSeconds;
      ts[i] = t;
    }
    return { hourlyCloses: series.closes, hourlyTimestamps: ts };
  }, [series]);
  // Earliest start date we can support — the oldest timestamp in the
  // hourly series. The snapshot carries ~730 days (2 years) of hourly
  // closes; the old artificial 365-day cap threw away half the
  // backtestable range for no reason (operator report 2026-06-10).
  const { minStartMs, maxStartMs } = useMemo(() => {
    const now = Date.now();
    if (
      !hourlyTimestamps ||
      hourlyTimestamps.length === 0 ||
      !hourlyCloses ||
      hourlyCloses.length === 0
    ) {
      return { minStartMs: now - 90 * 86400 * 1000, maxStartMs: now - 7 * 86400 * 1000 };
    }
    return {
      minStartMs: hourlyTimestamps[0] * 1000,
      // Don't allow a start date inside the last week — DCA needs at
      // least a few weekly buys to mean anything.
      maxStartMs: now - 7 * 86400 * 1000,
    };
  }, [hourlyCloses, hourlyTimestamps]);

  // Default to a 1-year lookback (familiar framing) even though the
  // picker now allows the full ~2-year series.
  const defaultStartMs = Math.max(minStartMs, Date.now() - 365 * 86400 * 1000);
  // The amount field is STRING state so the user can clear it while
  // typing ("50" → "5" → "" → "120"). The old number state rejected
  // every transient invalid value, which made the last digit
  // undeletable (operator report 2026-06-10). Parsed + clamped here;
  // re-clamped into the field on blur.
  const [weeklyStr, setWeeklyStr] = useState<string>("50");
  const weeklyAmount = useMemo(() => {
    const v = Number(weeklyStr);
    return Number.isFinite(v) && v >= 1 && v <= 10000 ? v : 0;
  }, [weeklyStr]);
  const [startDateMs, setStartDateMs] = useState<number>(defaultStartMs);

  const result = useMemo(() => {
    if (
      !hourlyCloses ||
      !hourlyTimestamps ||
      currentPrice == null ||
      hourlyCloses.length === 0 ||
      weeklyAmount <= 0
    ) {
      return null;
    }
    // Walk the price series in weekly steps from startDateMs to now.
    // For each weekly tick, find the nearest hourly close at that
    // timestamp and "buy" $weeklyAmount worth at that price.
    const startSec = Math.floor(startDateMs / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    const weekSec = 7 * 86400;
    let totalSpent = 0;
    let totalBtc = 0;
    let weeks = 0;
    // Pre-build a sorted index of timestamps for fast nearest-lookup.
    // Hourly timestamps are already chronologically sorted.
    const ts = hourlyTimestamps;
    const px = hourlyCloses;
    let cursor = 0;
    for (let t = startSec; t <= nowSec; t += weekSec) {
      // Advance cursor to the first timestamp >= t. Linear scan because
      // ts is sorted and we walk monotonically forward — amortized O(N).
      while (cursor < ts.length && ts[cursor] < t) cursor++;
      if (cursor >= ts.length) break;
      const price = px[cursor];
      if (price > 0) {
        totalSpent += weeklyAmount;
        totalBtc += weeklyAmount / price;
        weeks++;
      }
    }
    if (weeks === 0) return null;
    const currentValue = totalBtc * currentPrice;
    const returnPct = (currentValue / totalSpent - 1) * 100;
    const sats = Math.round(totalBtc * BTC_TO_SATS);
    return {
      totalSpent,
      totalBtc,
      sats,
      currentValue,
      returnPct,
      weeks,
      avgPrice: totalSpent / totalBtc,
    };
  }, [
    hourlyCloses,
    hourlyTimestamps,
    currentPrice,
    weeklyAmount,
    startDateMs,
  ]);

  // Format date input as YYYY-MM-DD (the format <input type="date">
  // expects). Convert back via Date.parse on change.
  const startDateStr = new Date(startDateMs).toISOString().slice(0, 10);
  const minDateStr = new Date(minStartMs).toISOString().slice(0, 10);
  const maxDateStr = new Date(maxStartMs).toISOString().slice(0, 10);

  // Don't render the widget at all if we don't have the data needed.
  if (!hourlyCloses || !hourlyTimestamps || currentPrice == null) {
    return null;
  }

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6">
      <div className="micro-label text-[var(--text-tertiary)] mb-2">
        DCA Backtest
      </div>
      <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)] mb-1 leading-tight">
        If you&apos;d DCA&apos;d into Bitcoin
      </h3>
      <p className="text-xs text-[var(--text-secondary)] mb-5 leading-relaxed">
        Pick a weekly amount and a start date and see what your stack would
        look like today. Walks the actual hourly price series.
      </p>

      {/* Inputs · min-w-0 on both cells: iOS renders <input type=date>
          with a stubborn intrinsic width that otherwise pushes the
          grid wider than the card on 375px screens (operator report
          2026-06-10 · "the box overextends the outer box"). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div className="min-w-0">
          <label
            htmlFor="dca-amount"
            className="micro-label block text-[var(--text-tertiary)] mb-2"
          >
            Weekly amount (USD)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] font-mono text-sm">
              $
            </span>
            <input
              id="dca-amount"
              type="number"
              inputMode="numeric"
              min={1}
              max={10000}
              step={5}
              value={weeklyStr}
              onChange={(e) => setWeeklyStr(e.target.value)}
              onBlur={() => {
                // Clamp into range on blur · empty/garbage snaps back
                // to a sane default instead of silently breaking the
                // result panel.
                const v = Number(weeklyStr);
                if (!Number.isFinite(v) || v < 1) setWeeklyStr("50");
                else if (v > 10000) setWeeklyStr("10000");
                else setWeeklyStr(String(Math.round(v)));
              }}
              className="w-full min-w-0 bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] rounded-lg pl-7 pr-3 py-2.5 text-sm text-[var(--text-primary)] font-mono tabular-nums focus:outline-none focus:border-[var(--accent)] focus:lit-active transition-all"
            />
          </div>
        </div>
        <div className="min-w-0">
          <label
            htmlFor="dca-start"
            className="micro-label block text-[var(--text-tertiary)] mb-2"
          >
            Started on
          </label>
          <input
            id="dca-start"
            type="date"
            min={minDateStr}
            max={maxDateStr}
            value={startDateStr}
            onChange={(e) => {
              const ms = Date.parse(e.target.value + "T00:00:00Z");
              if (Number.isFinite(ms)) {
                setStartDateMs(ms);
                track("dca_calc_change_start");
              }
            }}
            className="w-full min-w-0 appearance-none bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--accent)] focus:lit-active transition-all"
          />
          {/* Preset range chips · one tap swings the whole window, so
              the recompute is unmissable and nobody has to fight the
              iOS date wheel (operator report 2026-06-12 · "the return
              never changes" reads partly as a visibility problem:
              small date moves produce small return deltas). */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              { label: "3M", days: 91 },
              { label: "6M", days: 182 },
              { label: "1Y", days: 365 },
              { label: "MAX", days: null as number | null },
            ].map((p) => {
              const target =
                p.days === null
                  ? minStartMs
                  : Math.max(minStartMs, Date.now() - p.days * 86400 * 1000);
              // Active when within half a day of the chip's target.
              const active = Math.abs(startDateMs - target) < 43_200_000;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setStartDateMs(target);
                    track("dca_calc_preset", { preset: p.label });
                  }}
                  className={`px-2.5 py-1 rounded-full border font-mono t-xs uppercase tracking-widest transition-all ${
                    active
                      ? "border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent)]/10"
                      : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:border-[var(--accent)]/50 hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Result */}
      {result ? (
        <motion.div
          key={`${weeklyAmount}-${startDateMs}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 sm:p-5"
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat
              label="Total spent"
              value={`$${result.totalSpent.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
              sub={`${result.weeks} buys since ${startDateStr}`}
            />
            <Stat
              label="Sats stacked"
              value={result.sats.toLocaleString("en-US")}
              sub={`${result.totalBtc.toFixed(4)} BTC`}
              accent
            />
            <Stat
              label="Worth today"
              value={`$${result.currentValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
              sub={`@ $${currentPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}/BTC`}
            />
            <Stat
              label="Return"
              value={`${result.returnPct >= 0 ? "+" : ""}${result.returnPct.toFixed(1)}%`}
              sub={`avg buy $${Math.round(result.avgPrice).toLocaleString("en-US")}`}
              accent={result.returnPct > 0}
              warn={result.returnPct < 0}
            />
          </div>
        </motion.div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-4 text-center font-mono text-xs text-[var(--text-tertiary)]">
          Pick a weekly amount and start date to see the result.
        </div>
      )}

      <p className="mt-4 t-xs text-[var(--text-tertiary)] leading-relaxed">
        Backtest uses Bitcoin&apos;s actual hourly closing prices · the
        date picker reaches back the full{" "}
        {Math.round((Date.now() - minStartMs) / 86_400_000 / 30.4)} months
        of history in the live series. One purchase per week at the
        closing price nearest to that week&apos;s start. Doesn&apos;t
        model exchange fees or spread. Past performance is not a
        forecast, but the math compounds.
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  warn?: boolean;
}) {
  const valueColor = warn
    ? "var(--warning)"
    : accent
      ? "var(--accent-ink)"
      : "var(--text-primary)";
  return (
    <div>
      <div className="micro-label text-[var(--text-tertiary)] mb-1">
        {label}
      </div>
      <div
        className="font-mono text-base sm:text-lg tabular-nums font-semibold leading-tight"
        style={{ color: valueColor }}
      >
        {value}
      </div>
      {sub && (
        <div className="micro-label mt-0.5 text-[var(--text-tertiary)]">
          {sub}
        </div>
      )}
    </div>
  );
}
