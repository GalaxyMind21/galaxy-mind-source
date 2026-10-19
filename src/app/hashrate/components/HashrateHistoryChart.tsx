import {
  HASHRATE_HISTORY_MIN_POINTS,
  hashpriceSeries,
  type HashrateHistoryRow,
} from "@/lib/hashrate-history";
import {
  HISTORY_EMPTY,
  HISTORY_SUB,
  HISTORY_TITLE,
} from "@/lib/hashrate-copy";

const W = 640;
const H = 120;
const PAD = { t: 8, r: 8, b: 8, l: 8 };

export function HashrateHistoryChart({
  rows,
  bare = false,
}: {
  rows: HashrateHistoryRow[];
  /** Nested in a disclosure on the sales page so the trail is available
   *  without adding another full section to the rent path. */
  bare?: boolean;
}) {
  const series = hashpriceSeries(rows);
  if (series.length < HASHRATE_HISTORY_MIN_POINTS) {
    if (bare) {
      return (
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{HISTORY_EMPTY}</p>
      );
    }
    return (
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <p className="micro-label text-[var(--text-tertiary)]">{HISTORY_TITLE}</p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{HISTORY_EMPTY}</p>
      </section>
    );
  }

  const xs = series.map((_, i) => i);
  const ys = series.map((p) => p.hashprice);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = maxY - minY || minY * 0.05 || 1e-8;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const xAt = (i: number) =>
    PAD.l + (xs.length === 1 ? innerW / 2 : (i / (xs.length - 1)) * innerW);
  const yAt = (v: number) =>
    PAD.t + innerH - ((v - minY) / spanY) * innerH;
  const d = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)} ${yAt(p.hashprice).toFixed(1)}`)
    .join(" ");
  const first = series[0];
  const last = series[series.length - 1];
  const fmt = (n: number) => n.toFixed(6);

  const body = (
    <>
      {!bare && (
        <p className="micro-label text-[var(--text-tertiary)]">{HISTORY_TITLE}</p>
      )}
      <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
        {HISTORY_SUB}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-4 w-full h-auto"
        role="img"
        aria-label={`Hashprice from ${first.date} to ${last.date}: ${fmt(first.hashprice)} to ${fmt(last.hashprice)} BTC per PH per day.`}
      >
        <path
          d={d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="mt-2 flex justify-between font-mono t-xs tabular-nums text-[var(--text-tertiary)]">
        <span>{first.date}</span>
        <span>{fmt(last.hashprice)} BTC/PH/day</span>
        <span>{last.date}</span>
      </div>
    </>
  );

  if (bare) return body;
  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
      {body}
    </section>
  );
}
