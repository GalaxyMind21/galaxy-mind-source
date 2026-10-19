"use client";
import { useState } from "react";
import { track } from "@vercel/analytics";

export type PriceAnchor = {
  label: string;   // "7 days ago", "30 days ago", "1 year ago"
  days: number;    // lookback in days (used as React key)
  price: number;   // BTC closing price at that lookback
};

const SATS_PER_BTC = 100_000_000;
const PRESETS = [100, 500, 1000, 5000];

/**
 * Replaces the old "DCA simulator" that compared today vs a fake 7-day
 * spread (which used forecast scores as a synthetic price proxy — dishonest).
 *
 * This widget answers the question every accumulator actually has:
 * "How many sats does $X buy me right now, and how does that compare to
 * recent prices?" All comparisons use Bitcoin's actual hourly closes from
 * the snapshot — no projections, no fake math.
 */
export function SatCalculator({
  nowPrice,
  anchors,
}: {
  nowPrice: number | null;
  anchors: PriceAnchor[];
}) {
  const [usd, setUsd] = useState(1000);

  if (nowPrice == null) {
    return (
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6">
        <h2 className="micro-label text-[var(--text-tertiary)] mb-3">
          Sat Calculator
        </h2>
        <p className="text-xs text-[var(--text-tertiary)]">
          Live BTC price unavailable. Try again in a moment.
        </p>
      </div>
    );
  }

  const todaySats = Math.round((usd / nowPrice) * SATS_PER_BTC);

  const rows = anchors.map((a) => {
    const pastSats = Math.round((usd / a.price) * SATS_PER_BTC);
    // Positive % = today gives MORE sats per dollar than that past moment did
    // (i.e. today is the better entry). Negative % = past was better.
    const todayAdvantagePct = ((todaySats - pastSats) / pastSats) * 100;
    return {
      ...a,
      pastSats,
      todayAdvantagePct,
      todayBetter: todayAdvantagePct > 0,
    };
  });

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6">
      <h2 className="micro-label text-[var(--text-tertiary)] mb-2">
        Sat Calculator
      </h2>
      <p className="text-xs text-[var(--text-secondary)] mb-6 leading-relaxed">
        How many sats does your dollar buy right now, and how does that compare to
        Bitcoin&apos;s recent prices?
      </p>

      {/* Amount input: presets + slider */}
      <div className="flex flex-wrap gap-2 mb-3">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setUsd(p);
              track("stack_sat_calc_preset", { amount: p });
            }}
            className={`px-3 py-1.5 rounded-full font-mono t-xs uppercase tracking-widest border transition-colors ${
              usd === p
                ? "border-[var(--accent)] text-[var(--accent-ink)] bg-[rgba(247,147,26,0.08)]"
                : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:border-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            }`}
          >
            ${p.toLocaleString()}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-4 mb-6">
        <span className="text-sm text-[var(--text-tertiary)]">$</span>
        <input
          type="range"
          min={25}
          max={10000}
          step={25}
          value={usd}
          onChange={(e) => setUsd(Number(e.target.value))}
          className="flex-1 accent-[var(--accent)]"
          aria-label="USD amount"
        />
        <span className="font-mono tabular-nums text-lg w-28 text-right">
          ${usd.toLocaleString()}
        </span>
      </div>

      {/* Today's sats */}
      <div className="rounded-lg border border-[var(--accent)] bg-[rgba(247,147,26,0.04)] p-5 mb-6">
        {/* Stacks below sm. A 7-figure sat count at text-3xl needs ~171px
            and the wide-tracked "BTC PRICE" label another ~89px, against a
            242px panel at 390px — the two readouts overlapped by 41px. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div className="min-w-0">
            <div className="t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)] mb-1">
              Today
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono tabular-nums text-3xl text-[var(--accent-ink)]">
                {todaySats.toLocaleString()}
              </span>
              <span className="text-xs text-[var(--text-tertiary)]">sats</span>
            </div>
          </div>
          <div className="min-w-0 sm:text-right">
            <div className="t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)] mb-1">
              BTC price
            </div>
            <div className="font-mono tabular-nums text-base text-[var(--text-primary)]">
              ${Math.round(nowPrice).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Historical comparisons */}
      {rows.length > 0 ? (
        <>
          <div className="t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)] mb-3">
            Same ${usd.toLocaleString()} at past prices
          </div>
          {/* Table grid: tighter columns on mobile (75px label + flexible
              center + 80px % delta), looser on sm+ (90px + flex + 110px).
              The center column stays 1fr so it absorbs the "@ $price"
              tail when there's room. Header text bumped from 9px to 10px
              for mobile readability. */}
          <div className="rounded-lg border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)] overflow-hidden">
            <div className="micro-label grid grid-cols-[75px_1fr_80px] sm:grid-cols-[90px_1fr_110px] gap-2 px-3 sm:px-4 py-2 text-[var(--text-tertiary)] bg-[rgba(255,255,255,0.015)]">
              <div>When</div>
              <div>Sats per ${usd.toLocaleString()}</div>
              <div className="text-right">vs today</div>
            </div>
            {rows.map((r) => {
              const sign = r.todayAdvantagePct > 0 ? "+" : "";
              return (
                <div
                  key={r.days}
                  className="grid grid-cols-[75px_1fr_80px] sm:grid-cols-[90px_1fr_110px] gap-2 items-baseline px-3 sm:px-4 py-3"
                >
                  <div className="text-[var(--text-secondary)] font-mono text-xs">
                    {r.label}
                  </div>
                  <div className="font-mono tabular-nums text-sm text-[var(--text-primary)] min-w-0">
                    {r.pastSats.toLocaleString()}
                    {/* "@ $price" tail hides on mobile to free up width for
                        the sat count. Visible on sm+. */}
                    <span className="hidden sm:inline text-[var(--text-tertiary)] t-xs ml-2">
                      @ ${Math.round(r.price).toLocaleString()}
                    </span>
                  </div>
                  <div
                    className={`font-mono tabular-nums text-sm text-right ${
                      r.todayBetter
                        ? "text-[var(--accent-ink)]"
                        : "text-[var(--text-tertiary)]"
                    }`}
                  >
                    {sign}
                    {r.todayAdvantagePct.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 t-xs text-[var(--text-tertiary)] leading-relaxed">
            <span className="text-[var(--accent-ink)]">+%</span> means today gives you more
            sats per dollar than that past moment did · today is the relatively better
            entry. <span className="text-[var(--text-secondary)]">−%</span> means the
            past was a better deal (you missed a dip). All comparisons use Bitcoin&apos;s
            actual closing price at each lookback window.
          </p>
        </>
      ) : (
        <p className="text-xs text-[var(--text-tertiary)]">
          Historical comparisons unavailable · need at least 7 days of hourly price data.
        </p>
      )}
    </div>
  );
}
