/**
 * Gauntlet day math · extracted from the game engine so layout/header
 * clients do not depend on the full simulation module (perf 2026-07-10).
 *
 * Gauntlet #1 = 2026-07-08 UTC. Date.UTC with literals is a constant,
 * not a clock read · determinism holds.
 */

const EPOCH_DAY_ONE = Math.floor(Date.UTC(2026, 6, 8) / 86_400_000);

/** Which daily gauntlet a given UTC instant falls in (1-based). */
export function gauntletNumber(utcMs: number): number {
  return Math.floor(utcMs / 86_400_000) - EPOCH_DAY_ONE + 1;
}

/** UTC ms when the next daily gauntlet opens. */
export function nextGauntletAt(utcMs: number): number {
  return (Math.floor(utcMs / 86_400_000) + 1) * 86_400_000;
}

/**
 * UTC-midnight ms of day number `n` · the inverse of gauntletNumber.
 * WEN derives its daily answer date from the day number ALONE (never
 * from loaded-series length, which slides), so it needs this inverse.
 */
export function gauntletDayStartUtc(n: number): number {
  return (EPOCH_DAY_ONE + n - 1) * 86_400_000;
}

/**
 * Daily Summit level rotation · mirrors the game client's formula
 * EXACTLY (drift-guarded by scripts/test-super-saylor.ts). 18 non-boss
 * Super Saylor levels (7/14/21 are boss arenas); the stride 11 is
 * coprime to 18, so the cycle visits every level before repeating.
 * Single source for every Next-side surface (social drafts, push).
 */
const SUMMIT_LEVELS = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20];
export function summitLevelFor(day: number): number {
  return SUMMIT_LEVELS[(((day * 11 + 5) % 18) + 18) % 18];
}

/**
 * Bitcoin Kart Daily Circuit rotation · mirrors the game client's
 * dailyCombo() EXACTLY (public/bitcoin-kart/js/data.js · drift-guarded by
 * scripts/test-bitcoin-kart.ts). Kart day numbers share the Gauntlet
 * epoch, so gauntletNumber() doubles as the circuit number. Track stride
 * 5 is coprime to 12; class/mirror decorrelate via the Knuth hash so a
 * track is never welded to one class combo.
 */
const KART_TRACKS = [
  "Pizza Beach", "Genesis Circuit", "Gox Docks", "Winter of 2014",
  "Blocksize Fog", "Euphoria Neon", "Printer Runway", "Obituary Alley",
  "Glass Tower Loop", "ETF Dawn Speedway", "One Chair Peak", "Schiff's Gold Mine",
];
const KART_CLASSES = ["BITS", "SATS", "FULL SEND"];
export function kartComboFor(day: number): { track: string; klass: string; mirror: boolean } {
  const t = (((day * 5 + 2) % 12) + 12) % 12;
  const h = Math.imul(day, 2654435761) >>> 0;
  return { track: KART_TRACKS[t], klass: KART_CLASSES[h % 3], mirror: ((h >>> 3) & 1) === 1 };
}
