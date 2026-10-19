// Pure functions for Bitcoin supply / halving math. No I/O.
// Used by:
//   - /api/cron/snapshot-float (composing the daily snapshot)
//   - <BitcoinReservoir> (computing the live "yet to mine" slice)
//   - <HalvingRunway> (the 832-day countdown)
//   - <FloatTrendChart> (placing halving event vertical markers)
//
// All math is deterministic and depends only on the current block
// height. No upstream calls live here · the caller pulls block
// height from mempool.space and passes it in.

/** Bitcoin's halving interval in blocks. Set in 2009, fixed forever. */
export const HALVING_INTERVAL = 210_000;

/** Maximum bitcoin supply (asymptote). */
export const TOTAL_BTC_SUPPLY = 21_000_000;

/** Initial block subsidy (era 0 · before halving #1). */
const INITIAL_SUBSIDY = 50;

/** Average target block time in minutes. Used for time-until-halving estimates. */
const AVG_BLOCK_TIME_MIN = 10;

/** Approximate mainnet timestamps for past halvings. Used by HALVING_SCHEDULE.
 *  All dates are the actual on-chain confirmation date in UTC. */
const PAST_HALVING_TIMESTAMPS: Record<number, string> = {
  0: "2009-01-03",   // genesis
  210_000: "2012-11-28",
  420_000: "2016-07-09",
  630_000: "2020-05-11",
  840_000: "2024-04-19",
};

/**
 * Block subsidy at the given height. Halves every HALVING_INTERVAL blocks.
 * Asymptotes to zero (eventually rounds to 0 satoshis around era 33).
 */
export function blockSubsidyAt(height: number): number {
  if (height < 0) return 0;
  const era = Math.floor(height / HALVING_INTERVAL);
  return INITIAL_SUBSIDY / Math.pow(2, era);
}

/**
 * Total mined supply at the given block height. Sums each completed
 * era's full output plus the partial output of the current era.
 *
 * For block 840000 (4th halving): exactly 19,687,500 BTC mined in
 * the first 4 eras (210000 * (50 + 25 + 12.5 + 6.25) = 19,687,500).
 */
export function minedSupplyAt(height: number): number {
  // height 0 = genesis block; supply accumulates starting from block 1.
  // Negative heights are nonsensical · return 0 by convention.
  if (height <= 0) return 0;
  let supply = 0;
  let remaining = height;
  let era = 0;
  while (remaining > 0) {
    const subsidy = INITIAL_SUBSIDY / Math.pow(2, era);
    // Terminate well before IEEE-754 underflow makes subsidy a true
    // 0 (~era 1074). Below 1e-8 BTC the contribution is sub-satoshi
    // noise, and Bitcoin only has ~33 halvings of real issuance —
    // `era > 34` is an absolute guard so a pathological `height`
    // (e.g. from corrupted upstream data) can't spin the loop a
    // thousand times. Audit 2026-05 M-2 · result is identical to the
    // old `subsidy === 0` exit for every realistic height.
    if (subsidy < 1e-8 || era > 34) break;
    const blocksThisEra = Math.min(remaining, HALVING_INTERVAL);
    supply += blocksThisEra * subsidy;
    remaining -= blocksThisEra;
    era++;
  }
  return supply;
}

/** BTC remaining to be mined (asymptotic). */
export function yetToMineAt(height: number): number {
  return TOTAL_BTC_SUPPLY - minedSupplyAt(height);
}

/** Next halving block height after the given height. */
export function nextHalvingHeight(height: number): number {
  // Negative heights · treat as "before genesis" · next halving is the
  // first one (block 210000). Without this guard, Math.floor of a
  // negative gives the wrong era boundary.
  if (height < 0) return HALVING_INTERVAL;
  const era = Math.floor(height / HALVING_INTERVAL);
  return (era + 1) * HALVING_INTERVAL;
}

/** Approximate days until the next halving, assuming average 10-min blocks. */
export function daysUntilNextHalving(height: number): number {
  const blocksRemaining = nextHalvingHeight(height) - height;
  return Math.round((blocksRemaining * AVG_BLOCK_TIME_MIN) / (60 * 24));
}

/** Halving event for the schedule table. */
export type HalvingEvent = {
  ordinal: number;       // 1-indexed (1st, 2nd, 3rd, 4th, 5th, ...)
  height: number;        // block at which subsidy halved
  date: string | null;   // ISO date if past, null if projected
  subsidy: number;       // subsidy ENTERING this era (after the halving)
  dailyIssuance: number; // approximate BTC/day in this era at 10-min blocks
};

/** Pre-computed halving schedule with past dates + projected future. */
export const HALVING_SCHEDULE: HalvingEvent[] = (() => {
  const events: HalvingEvent[] = [];
  // 8 events covers through 2050+ which is plenty for the page's purpose
  for (let i = 1; i <= 8; i++) {
    const height = i * HALVING_INTERVAL;
    const subsidy = INITIAL_SUBSIDY / Math.pow(2, i);
    events.push({
      ordinal: i,
      height,
      date: PAST_HALVING_TIMESTAMPS[height] ?? null,
      subsidy,
      dailyIssuance: subsidy * (60 * 24) / AVG_BLOCK_TIME_MIN,
    });
  }
  return events;
})();
