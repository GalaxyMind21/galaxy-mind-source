import { HALVING_SCHEDULE, daysUntilNextHalving } from "@/lib/bitcoin-supply";

type Props = {
  blockHeight: number;
  /** Daily demand absorption baseline (default 2700 BTC/day · today's pace) */
  dailyDemand?: number;
};

export function HalvingRunway({ blockHeight, dailyDemand = 2700 }: Props) {
  const daysToNext = daysUntilNextHalving(blockHeight);
  const currentEra = Math.floor(blockHeight / 210_000); // 0-indexed era number

  // Show today + next 3 halvings.
  //
  // HALVING_SCHEDULE entries are 0-indexed in the array but 1-indexed
  // by `ordinal` (because Bitcoin halvings are numbered '1st, 2nd, 3rd,
  // 4th, 5th...' in discourse). Entry at index N represents the halving
  // numbered ordinal N+1 · subsidy AFTER that halving.
  //
  // For block 952000:
  //   - currentEra = floor(952000 / 210_000) = 4
  //   - Today's subsidy = 3.125 BTC/block (50 / 2^4)
  //   - That subsidy lives at HALVING_SCHEDULE[3] (ordinal 4, height 840000)
  //   - So today's bar is at index `currentEra - 1`, NOT `currentEra`
  //
  // slice(currentEra - 1, currentEra + 3) gives 4 entries starting
  // at today's era and going through the next 3 halvings.
  const bars = HALVING_SCHEDULE.slice(currentEra - 1, currentEra + 3).map((h) => ({
    label: h.date ? `APR ${h.date.slice(0, 4)}` : `~${2024 + (h.ordinal - 4) * 4}`,
    subLabel: `${h.subsidy} BTC/block`,
    dailyMined: h.dailyIssuance,
    ratio: dailyDemand / h.dailyIssuance,
    isToday: false,
  }));

  // Mark the FIRST bar as "today" since we always start at the current era
  if (bars[0]) bars[0].isToday = true;

  // Scale bar heights to the largest ratio for visual comparison
  const maxRatio = Math.max(...bars.map((b) => b.ratio));

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6">
      <header className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
          The Halving Runway
        </h2>
        <p className="text-xs text-[var(--text-tertiary)]">
          Demand is already {bars[0]?.ratio.toFixed(1) ?? "?"}× the new supply. And it doubles on a known schedule.
        </p>
      </header>

      <div className="grid grid-cols-4 gap-3 sm:gap-4 items-end mb-4">
        {bars.map((b) => {
          const ratioHeight = (b.ratio / maxRatio) * 130;
          // Mining bar height shrinks per halving (visualizes the
          // halving cliff on the supply side specifically) · use a
          // log scale so the smallest bar is still visible.
          const miningHeight = Math.max(2, 25 - 4 * Math.log2(b.ratio));
          return (
            <div key={b.label} className="flex flex-col items-center">
              <div className="t-xs text-[var(--text-tertiary)] mb-1">
                demand {dailyDemand.toLocaleString()}
              </div>
              <div className="w-3/5 flex flex-col items-center">
                <div
                  style={{ height: `${ratioHeight}px` }}
                  className="w-full bg-[var(--accent)] rounded-t flex items-center justify-center text-[12px] sm:text-[13px] text-black font-bold"
                >
                  {b.ratio.toFixed(1)}×
                </div>
                <div
                  style={{ height: `${miningHeight}px` }}
                  className="w-full bg-[var(--warning)] rounded-b flex items-center justify-center t-xs text-black font-bold"
                >
                  {b.dailyMined.toFixed(0)}
                </div>
              </div>
              <div
                className={`t-xs mt-2 tracking-[0.15em] uppercase ${
                  b.isToday ? "text-[var(--accent-ink)] font-bold" : "text-[var(--text-tertiary)]"
                }`}
              >
                {b.isToday ? "TODAY" : b.label}
              </div>
              <div className="t-xs text-[var(--text-tertiary)]">{b.subLabel}</div>
            </div>
          );
        })}
      </div>

      <div className="bg-[var(--bg-elevated-2)]/40 border-l-4 border-[var(--accent)] p-3 rounded-r">
        <p className="text-sm text-[var(--text-secondary)]">
          <strong className="text-[var(--accent-ink)]">Next halving in {daysToNext} days.</strong>{" "}
          Daily new supply drops from {bars[0]?.dailyMined.toFixed(0)} BTC → {bars[1]?.dailyMined.toFixed(0) ?? "?"}
          {" "}BTC. If today&apos;s absorption pace holds, the ratio doubles overnight.
        </p>
        <p className="t-xs text-[var(--text-tertiary)] mt-2 italic">
          *Holding demand constant is a thought experiment, not a forecast · see Methodology.
        </p>
      </div>
    </section>
  );
}
