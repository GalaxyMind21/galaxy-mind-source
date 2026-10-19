/* =====================================================================
 * hashprice.ts · the pure math behind /hashrate.
 *
 * PURE BY CONTRACT: no I/O, no Date.now(), no Math.random(). Every
 * function here is a deterministic function of its arguments, so
 * scripts/test-hashprice.ts can pin it exactly. Same discipline as
 * lib/stack.ts.
 *
 * The recovery ratio — mined BTC as a fraction of rental cost — is the
 * page's headline instrument. MRR publishes a price; nobody publishes
 * what fraction of that price comes back as work.
 * ===================================================================== */

/** Multipliers from an MRR hashrate unit to PH. */
const TO_PH: Record<string, number> = {
  hash: 1e-15,
  kh: 1e-12,
  mh: 1e-9,
  gh: 1e-6,
  th: 1e-3,
  ph: 1,
  eh: 1e3,
};

/**
 * Normalise an MRR hashrate reading to PH.
 *
 * MRR is inconsistent about the numeric type: `advertised.hash` comes
 * back as a JSON number, `last_5min.hash` as a JSON string. Verified
 * live 2026-08-02. Coerce both, reject anything else.
 *
 * Rejects negative magnitudes (an upstream data anomaly). Zero is legal —
 * an idle available rig reports `last_5min: 0` because nobody is currently
 * renting it, and this reading is spread evenly across price bands.
 */
export function toPhs(hash: number | string, unit: string): number | null {
  const mult = TO_PH[unit];
  if (mult == null) return null;
  const n = typeof hash === "number" ? hash : Number.parseFloat(hash);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n * mult;
}

/** Expected BTC mined per PH per day at the given network conditions. */
export function hashpriceBtcPerPhDay(a: {
  networkPhs: number;
  subsidyBtc: number;
  feesBtcPerBlock: number;
  blocksPerDay?: number;
}): number | null {
  const { networkPhs, subsidyBtc, feesBtcPerBlock } = a;
  const blocks = a.blocksPerDay ?? 144;
  if (!Number.isFinite(networkPhs) || networkPhs <= 0) return null;
  if (!Number.isFinite(subsidyBtc) || subsidyBtc < 0) return null;
  if (!Number.isFinite(feesBtcPerBlock) || feesBtcPerBlock < 0) return null;
  return (blocks * (subsidyBtc + feesBtcPerBlock)) / networkPhs;
}

/**
 * Fraction of the rental price that comes back as mined BTC.
 * 0.69 means the renter recovers 69 cents of every dollar.
 *
 * This is NOT profit or loss to the renter: it ignores what the
 * renter's actual purpose (a solo-block lottery ticket, pointing hash
 * at a chosen pool) is worth to them, which for most legitimate
 * renting is the entire point.
 */
export function recoveryRatio(
  askBtcPerPhDay: number,
  hashprice: number,
): number | null {
  if (!Number.isFinite(askBtcPerPhDay) || askBtcPerPhDay <= 0) return null;
  if (!Number.isFinite(hashprice) || hashprice < 0) return null;
  return hashprice / askBtcPerPhDay;
}

/**
 * The three price quantities MRR publishes, kept SEPARATE.
 *
 * Blending these is the defect this whole file exists to prevent:
 * during design research, asks ran ~0.00055 while rentals actually
 * cleared at 0.00068-0.00079. Averaging them produces a confident lie.
 *
 * (classifyAgainstBook, which positioned an ask inside this book, was
 * removed 2026-08-02: its only renderer died in the sales pivot, and a
 * tested-but-uncalled function reads to a future agent as a live
 * invariant. Recover it from git history if a book-position surface
 * ever returns.)
 */
export type PriceBook = {
  floor: number | null;
  medianAsk: number | null;
  clearedLast30: number | null;
  clearedLast10: number | null;
  suggested: number | null;
};
