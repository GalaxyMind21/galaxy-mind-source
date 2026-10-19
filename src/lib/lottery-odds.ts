// Live odds table for /lottery-mining-bitcoin (SEO brief 2026-10-18).
// PURE: no I/O, no Date.now(). The page passes in the live network hashrate
// (mempool.space, via lib/hashrate getNetworkPhs) and every figure here comes
// from the same blockOdds() the calculator and /hashrate use, so the three
// surfaces can never disagree. Nothing is hard-coded except the three example
// sizes, which are inputs, not results.
import { blockOdds, BLOCKS_PER_HOUR } from "./block-odds";

/** The three example sizes: a small home miner, one rentable chunk, ten chunks. */
export const LOTTERY_SIZES: { id: string; label: string; ph: number }[] = [
  { id: "home", label: "A small home miner (1.2 TH/s)", ph: 0.0012 },
  { id: "one", label: "One rentable chunk (270 TH/s)", ph: 0.27 },
  { id: "ten", label: "Ten rentable chunks (2.7 PH/s)", ph: 2.7 },
];

export type LotteryRow = {
  id: string;
  label: string;
  ph: number;
  /** Share of the network's hashrate, which is also the chance per block. */
  perBlock: number;
  /** "1 in N" over one day and one week (exact 1-(1-s)^n form). */
  dayOneIn: number;
  weekOneIn: number;
  /** Average wait for one block, in years: network ÷ yours × 10 minutes. */
  expectedYears: number;
};

export function lotteryRows(networkPhs: number): LotteryRow[] | null {
  if (!Number.isFinite(networkPhs) || networkPhs <= 0) return null;
  const rows: LotteryRow[] = [];
  for (const s of LOTTERY_SIZES) {
    const day = blockOdds({ ph: s.ph, hours: 24, networkPhs });
    const week = blockOdds({ ph: s.ph, hours: 24 * 7, networkPhs });
    if (!day || !week) return null;
    const blocksToWait = networkPhs / s.ph;
    rows.push({
      id: s.id,
      label: s.label,
      ph: s.ph,
      perBlock: s.ph / networkPhs,
      dayOneIn: day.oneInN,
      weekOneIn: week.oneInN,
      expectedYears: blocksToWait / (BLOCKS_PER_HOUR * 24 * 365),
    });
  }
  return rows;
}

/** Two significant figures, so we never print false precision: 25,720 → "26,000". */
export function roundOneIn(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 10) return n.toFixed(1).replace(/\.0$/, "");
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return (Math.round(n / mag) * mag).toLocaleString("en-US");
}

/** "1,026 EH/s" from PH/s. */
export function ehLabel(networkPhs: number): string {
  return `${Math.round(networkPhs / 1000).toLocaleString("en-US")} EH/s`;
}

/** Equal hash × time means an equal chance: the "longer is not closer" check. */
export function sameTicket(a: { ph: number; hours: number }, b: { ph: number; hours: number }): boolean {
  return Math.abs(a.ph * a.hours - b.ph * b.hours) < 1e-12;
}
