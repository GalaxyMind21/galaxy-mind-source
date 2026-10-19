/* =====================================================================
 * OutperformanceStrip · treasury vs BTC, same-instant windows (B9)
 *
 * Task #147, data-gated since 2026-06-15: the daily treasury cron
 * stamps spot BTC alongside each ticker snapshot, so stock return and
 * BTC return come from the SAME instant each day · no market-hours /
 * timezone mismatch, which is why this doesn't reuse the Yahoo-based
 * sparkline series. First ship 2026-07-07 with a 23-day window.
 *
 * Honesty rules:
 *   · The window label shows the ACTUAL day span (grows daily toward
 *     the 90-day cap as snapshots accrue) · never implies more
 *     history than exists.
 *   · A ticker needs ≥ MIN_DAYS paired snapshots to render; below
 *     that it's omitted. If NO ticker qualifies (fresh KV, outage),
 *     the whole strip renders nothing · honest absence, no skeleton.
 *   · Deltas are percentage-POINT spreads (stock return minus BTC
 *     return over the identical window), labeled "pp" to avoid the
 *     percent-of-percent trap.
 *
 * Server component · 4 KV list reads per render, same profile as the
 * history API the sparklines already use.
 * ===================================================================== */

import { kvList } from "@/lib/kv";
import type { TreasurySnapshot } from "@/app/api/cron/snapshot-treasuries/route";
import { GlossaryTerm } from "@/components/GlossaryTerm";

const MIN_DAYS = 14;
const WINDOW_CAP = 90;

type Row = {
  ticker: string;
  stockRet: number; // fraction · 0.12 = +12%
  btcRet: number;
  deltaPp: number; // percentage points
  windowDays: number;
};

async function computeRows(tickers: string[]): Promise<Row[]> {
  const all = await Promise.all(
    tickers.map(async (ticker) => {
      const entries = await kvList<TreasurySnapshot>(
        `treasury:history:${ticker}`,
        WINDOW_CAP,
      );
      const paired = entries
        .filter(
          (e) =>
            e &&
            typeof e.price === "number" &&
            e.price > 0 &&
            typeof e.btcPrice === "number" &&
            e.btcPrice > 0 &&
            typeof e.date === "string",
        )
        .sort((a, b) => a.date.localeCompare(b.date));
      if (paired.length < MIN_DAYS) return null;
      const first = paired[0];
      const last = paired[paired.length - 1];
      const stockRet = (last.price as number) / (first.price as number) - 1;
      const btcRet = (last.btcPrice as number) / (first.btcPrice as number) - 1;
      const windowDays = Math.max(
        1,
        Math.round(
          (Date.parse(last.date) - Date.parse(first.date)) / 86_400_000,
        ),
      );
      return {
        ticker,
        stockRet,
        btcRet,
        deltaPp: (stockRet - btcRet) * 100,
        windowDays,
      } satisfies Row;
    }),
  );
  return all
    .filter((r): r is Row => r !== null)
    .sort((a, b) => b.deltaPp - a.deltaPp);
}

function fmtPct(v: number): string {
  const pct = v * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export async function OutperformanceStrip({
  tickers,
}: {
  tickers: string[];
}) {
  const rows = await computeRows(tickers);
  if (rows.length === 0) return null;

  const windowDays = Math.max(...rows.map((r) => r.windowDays));
  // Shared bar scale · largest absolute return across both series.
  const maxAbs = Math.max(
    0.02,
    ...rows.flatMap((r) => [Math.abs(r.stockRet), Math.abs(r.btcRet)]),
  );

  return (
    <section className="mt-8 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6 elevate">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="micro-label text-[var(--text-tertiary)]">
          The race · treasury vs bitcoin
        </h2>
        <span className="micro-label text-[var(--text-tertiary)] tabular-nums">
          {windowDays}d window · same-instant snapshots
        </span>
      </div>
      <p className="t-xs text-[var(--text-secondary)] font-sans leading-relaxed max-w-2xl mb-5">
        Did the wrapper beat the coin? Each pair compares a treasury
        stock&apos;s return against BTC&apos;s over the identical
        window, both prices captured at the same instant each day.
        Positive spread = the{" "}
        <GlossaryTerm slug="amplification">amplification</GlossaryTerm>{" "}
        thesis working; negative = you&apos;d have done better holding
        spot.
      </p>

      <div className="space-y-4">
        {rows.map((r) => {
          const beating = r.deltaPp >= 0;
          return (
            <div key={r.ticker}>
              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
                  {r.ticker}
                </span>
                <span
                  className={`font-mono t-xs uppercase tracking-widest tabular-nums px-2 py-0.5 rounded border ${
                    beating
                      ? "text-[var(--success)] border-[var(--success)]/40 bg-[var(--success)]/5"
                      : "text-[var(--cool-ink)] border-[#7ec0ff]/40 bg-[#7ec0ff]/5"
                  }`}
                >
                  {r.deltaPp >= 0 ? "+" : ""}
                  {r.deltaPp.toFixed(1)}pp vs BTC
                </span>
              </div>
              {/* Paired bars on one shared scale · stock above, BTC
                  below, so the eye reads the race directly. */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0 font-mono t-xs text-[var(--text-tertiary)] text-right">
                    {r.ticker.slice(0, 4)}
                  </span>
                  <div className="flex-1 h-2.5 rounded-full bg-[var(--bg-elevated-2)] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (Math.abs(r.stockRet) / maxAbs) * 100)}%`,
                        background:
                          r.stockRet >= 0 ? "var(--accent)" : "var(--cool-ink)",
                        opacity: 0.9,
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 font-mono t-xs tabular-nums text-[var(--text-secondary)]">
                    {fmtPct(r.stockRet)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0 font-mono t-xs text-[var(--text-tertiary)] text-right">
                    BTC
                  </span>
                  <div className="flex-1 h-2.5 rounded-full bg-[var(--bg-elevated-2)] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (Math.abs(r.btcRet) / maxAbs) * 100)}%`,
                        background: "#8a8a94",
                        opacity: 0.85,
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 font-mono t-xs tabular-nums text-[var(--text-secondary)]">
                    {fmtPct(r.btcRet)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="micro-label mt-4 text-[var(--text-tertiary)]">
        Window grows to {WINDOW_CAP}d as daily snapshots accrue · series
        started Jun 15, 2026 · not financial advice
      </p>
    </section>
  );
}
