/* =====================================================================
 * block-odds.ts · the only math the /hashrate customer actually cares
 * about.
 *
 * WHY THIS EXISTS, and why the recovery ratio is NOT the headline:
 * people renting SHA256 hashrate at this scale are not trying to
 * out-earn a pool. They are buying a lottery ticket on a block. So the
 * question the page has to answer is "what are my odds, and what does
 * it pay" — not "what fraction of my rental fee comes back as work".
 * Same underlying numbers, different instrument. Measuring the wrong
 * one made the page read as a warning instead of an offer.
 *
 * PURE BY CONTRACT: no I/O, no Date.now(), no Math.random().
 * ===================================================================== */

/** Bitcoin targets one block every 10 minutes → 6 per hour. */
import { RENTAL_WINDOW_DAYS } from "./rental-limits";
export const BLOCKS_PER_HOUR = 6;

export type BlockOdds = {
  /** Expected number of blocks found in the window (can be < 1). */
  expectedBlocks: number;
  /** P(at least one block) over the whole window, 0..1. */
  pAtLeastOne: number;
  /** The "1 in N" the page prints. Infinity when p is 0. */
  oneInN: number;
};

/**
 * Odds of finding at least one block with `ph` PH/s of hashrate running
 * for `hours` against a network of `networkPhs` PH/s.
 *
 * Uses the exact 1-(1-s)^n rather than the n·s approximation. At our
 * scale the two agree to several decimals, but the approximation can
 * exceed 1.0 for large rentals, and printing "1 in 0.8" would be
 * nonsense. Exact costs nothing here.
 */
export function blockOdds(a: {
  ph: number;
  hours: number;
  networkPhs: number;
}): BlockOdds | null {
  const { ph, hours, networkPhs } = a;
  if (!Number.isFinite(ph) || ph <= 0) return null;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  if (!Number.isFinite(networkPhs) || networkPhs <= 0) return null;

  const sharePerBlock = ph / networkPhs;
  if (sharePerBlock >= 1) {
    return { expectedBlocks: hours * BLOCKS_PER_HOUR, pAtLeastOne: 1, oneInN: 1 };
  }
  const blocks = hours * BLOCKS_PER_HOUR;
  const expectedBlocks = blocks * sharePerBlock;
  const pAtLeastOne = 1 - Math.pow(1 - sharePerBlock, blocks);
  return {
    expectedBlocks,
    pAtLeastOne,
    oneInN: pAtLeastOne > 0 ? 1 / pAtLeastOne : Number.POSITIVE_INFINITY,
  };
}

/** What the winner takes: subsidy + the fees in that block. */
export function blockRewardBtc(a: {
  subsidyBtc: number;
  feesBtcPerBlock: number;
}): number | null {
  const { subsidyBtc, feesBtcPerBlock } = a;
  if (!Number.isFinite(subsidyBtc) || subsidyBtc < 0) return null;
  if (!Number.isFinite(feesBtcPerBlock) || feesBtcPerBlock < 0) return null;
  return subsidyBtc + feesBtcPerBlock;
}

/** Cost in BTC of renting `ph` for `hours` at an ask quoted per PH·day. */
export function rentalCostBtc(a: {
  ph: number;
  hours: number;
  askBtcPerPhDay: number;
}): number | null {
  const { ph, hours, askBtcPerPhDay } = a;
  if (!Number.isFinite(ph) || ph <= 0) return null;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  if (!Number.isFinite(askBtcPerPhDay) || askBtcPerPhDay <= 0) return null;
  return ph * askBtcPerPhDay * (hours / 24);
}

/**
 * Fraction of stake returned on average — prize × probability ÷ cost.
 *
 * This is the SAME quantity as the recovery ratio, and it is quoted here
 * because in lottery terms it flatters us rather than damning us: state
 * lotteries return roughly 50% of stake. It is an average over many
 * plays, not a prediction for one rental, and the copy must say so.
 */
export function stakeReturn(a: {
  pAtLeastOne: number;
  prize: number;
  cost: number;
}): number | null {
  const { pAtLeastOne, prize, cost } = a;
  if (!Number.isFinite(pAtLeastOne) || pAtLeastOne < 0) return null;
  if (!Number.isFinite(prize) || prize < 0) return null;
  if (!Number.isFinite(cost) || cost <= 0) return null;
  return (pAtLeastOne * prize) / cost;
}

/**
 * Human-scale cadence from a years figure: "34 years" / "5 months" /
 * "9 days". Shared by the /hashrate chooser and the solo-mining
 * calculator so the two surfaces can never disagree about a wording.
 */
export function humanizeYears(years: number): string {
  if (!Number.isFinite(years) || years <= 0) return "—";
  if (years >= 1) {
    const y = Math.round(years);
    return `${y.toLocaleString("en-US")} ${y === 1 ? "year" : "years"}`;
  }
  const months = years * 12;
  if (months >= 1) {
    const m = Math.round(months);
    return `${m} ${m === 1 ? "month" : "months"}`;
  }
  const days = Math.max(1, Math.round(years * 365));
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * First `count` bookable machines, in the order given. Never re-sorts —
 * /hashrate's chooser must not pin a listing by ownership; desk.ourRigs
 * is already cheapest-first via rankByAsk.
 */
export function takeBookablePack<T extends { rentable: boolean }>(
  offers: readonly T[],
  count: number,
): T[] {
  const bookable = offers.filter((o) => o.rentable);
  if (bookable.length === 0) return [];
  const n = Math.min(
    bookable.length,
    Math.max(1, Math.floor(Number.isFinite(count) ? count : 1)),
  );
  return bookable.slice(0, n);
}

/**
 * Amount-picker chips for an open fleet of `openCount` machines:
 * one, a small handful, about half, and all. Empty when nothing is open.
 */
export function packCountPresets(openCount: number): number[] {
  if (!Number.isFinite(openCount) || openCount < 1) return [];
  const n = Math.floor(openCount);
  const out: number[] = [1];
  if (n >= 4) out.push(3);
  if (n >= 8) out.push(Math.floor(n / 2));
  if (!out.includes(n)) out.push(n);
  return out.filter((c) => c >= 1 && c <= n);
}

/** The rental windows the calculator can book: whole days, 1 to 30 (rental-limits). */
export const RENTAL_WINDOWS = RENTAL_WINDOW_DAYS.map((d) => d * 24);

/**
 * Next preset above `count` on an open fleet of `openCount`.
 * Null when there is nothing larger to book — the upsell is done.
 */
export function nextPackStep(count: number, openCount: number): number | null {
  if (!Number.isFinite(count) || !Number.isFinite(openCount)) return null;
  if (openCount < 2) return null;
  const presets = packCountPresets(openCount);
  for (const p of presets) {
    if (p > count) return p;
  }
  return count < openCount ? openCount : null;
}

/**
 * Walk the bookable windows. dir +1 is longer (better odds), −1 is
 * shorter. Clamps at the 1 day / 30 day ends · never invents a window
 * we do not sell.
 */
export function stepRentalWindow(hours: number, dir: 1 | -1): number {
  const windows = RENTAL_WINDOWS;
  if (dir === 1) {
    for (const h of windows) if (h > hours) return h;
    return windows[windows.length - 1]!;
  }
  for (let i = windows.length - 1; i >= 0; i--) {
    const h = windows[i]!;
    if (h < hours) return h;
  }
  return windows[0]!;
}

/**
 * How many times likelier the better ticket is, from two 1-in-N
 * figures. Null when the "to" ticket is not actually better.
 */
export function oddsImprovement(
  fromOneIn: number,
  toOneIn: number,
): number | null {
  if (!Number.isFinite(fromOneIn) || !Number.isFinite(toOneIn)) return null;
  if (fromOneIn <= 0 || toOneIn <= 0) return null;
  if (toOneIn >= fromOneIn) return null;
  return fromOneIn / toOneIn;
}

/**
 * Compact multiplier for the calculator: "19" or "2.4". Silent
 * under ~15% so we never dress a rounding wiggle as an upsell.
 */
export function formatImprovement(x: number): string | null {
  if (!Number.isFinite(x) || x < 1.15) return null;
  if (x >= 10) return String(Math.round(x));
  const tenths = Math.round(x * 10) / 10;
  return tenths % 1 === 0 ? String(tenths) : tenths.toFixed(1);
}

/** How a visitor can order the house fleet in the calculator. */
export type ShotSortKey = "bay" | "price-th" | "power" | "cost";
export type ShotSortDir = "asc" | "desc";

export type ShotSort = { key: ShotSortKey; dir: ShotSortDir };

/**
 * Order our own machines by an honest column. Does not mutate `offers`.
 * Ties break on `key` so the order is stable across renders.
 *
 * This is a visitor control, not the ownership-rank that must never
 * appear in BlockShot: every row here is already a Galaxy Mind listing.
 * "bay" is listing identity (bay #01 before #02); unnumbered house
 * machines sort after the numbered rack, never into a fake bay.
 */
export function sortShotOffers<
  T extends { key: string; ph: number; ask: number; bay?: number | null },
>(offers: readonly T[], key: ShotSortKey, dir: ShotSortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const value = (o: T): number => {
    if (key === "bay") {
      return o.bay != null && Number.isFinite(o.bay)
        ? o.bay
        : Number.POSITIVE_INFINITY;
    }
    if (key === "power") return o.ph;
    if (key === "price-th") return o.ask;
    return o.ph * o.ask;
  };
  return [...offers].toSorted((a, b) => {
    const d = value(a) - value(b);
    if (d !== 0) return d * sign;
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });
}

/** Click a sort chip: same key flips direction, new key takes its natural default. */
export function nextSort(current: ShotSort, clicked: ShotSortKey): ShotSort {
  if (current.key === clicked) {
    return { key: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key: clicked, dir: clicked === "power" ? "desc" : "asc" };
}
