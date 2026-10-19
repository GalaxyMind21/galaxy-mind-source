// Pure, dependency-free urgency logic for the /float Reservoir.
// No React, no DOM — unit-tested by scripts/test-float-urgency.ts.

export type LastView = { ts: number; inPlayBTC: number };

const LAST_VIEW_KEY = "gm:float:lastview";
const MIN_GAP_MS = 6 * 3_600_000; // 6h · refresh-spam guard
const MIN_DELTA_BTC = 1; // sub-1 BTC drift is noise, not a story

/**
 * Mechanic A. Returns the real BTC that left the float since the
 * visitor's last view, or null when it should not be shown:
 * first-ever visit, < 6h since last view, or delta < 1 BTC
 * (including zero / negative from clock skew or data noise).
 */
export function computeSinceLastVisit(
  prev: LastView | null,
  currentInPlayBTC: number,
  nowMs: number,
): { deltaBTC: number } | null {
  if (!prev) return null;
  if (nowMs - prev.ts < MIN_GAP_MS) return null;
  const delta = prev.inPlayBTC - currentInPlayBTC;
  if (!(delta >= MIN_DELTA_BTC)) return null; // also rejects NaN/negative
  return { deltaBTC: Math.round(delta) };
}

// Mechanic B tension band. Tension is 0 across the normal operating
// range and only ramps when the float is genuinely low — the
// "confident drama" guardrail (no crying wolf at healthy levels).
const TENSION_CALM_AT = 0.5; // fill fraction at/above which tension = 0
const TENSION_MAX_AT = 0.15; // fill fraction at/below which tension = 1

/** Maps fill fraction [0,1] → tension [0,1]; clamps junk input. */
export function computeTension(fillFraction: number): number {
  const f = Math.min(1, Math.max(0, fillFraction));
  if (f >= TENSION_CALM_AT) return 0;
  if (f <= TENSION_MAX_AT) return 1;
  return (TENSION_CALM_AT - f) / (TENSION_CALM_AT - TENSION_MAX_AT);
}

/**
 * Mechanic C high-water-mark ghost: the float fill % as of the most
 * recent past halving. Returns null when the historical figure is not
 * derivable (caller then omits the ghost rather than faking it).
 */
export function ghostFillPct(args: {
  inPlayAtLastHalving?: number;
  totalSupply: number;
}): number | null {
  if (
    args.inPlayAtLastHalving == null ||
    !Number.isFinite(args.inPlayAtLastHalving) ||
    !(args.totalSupply > 0)
  ) {
    return null;
  }
  return Math.min(100, Math.max(0, (args.inPlayAtLastHalving / args.totalSupply) * 100));
}

// ── Mechanic D · depletion projection (Supply Clock, 2026-06-29) ────
//
// "At yesterday's net drain, the in-play float is gone in ~N years."
// A thought experiment, not a forecast (same framing discipline as
// HalvingRunway's constant-demand caveat) · the UI must label it that
// way. Honesty rules baked in here rather than at the call site:
//   · dailyDelta null (fewer than 2 snapshots)  → null, show nothing
//   · dailyDelta >= 0 (float grew / flat)       → null, no fake urgency
//   · drain under MIN_MEANINGFUL_DRAIN_BTC/day  → null, noise not signal
//   · projection beyond MAX_MEANINGFUL_YEARS    → null · "gone in 400
//     years" reads as a reason NOT to hurry, which is worse than silence
const MIN_MEANINGFUL_DRAIN_BTC = 50; // per day · below this the trend is noise
const MAX_MEANINGFUL_YEARS = 100;

/**
 * Years until the in-play float hits zero at yesterday's net drain
 * rate, or null when the projection would be missing, meaningless, or
 * counterproductive (see rules above). Sign convention matches
 * computeDailyDelta: negative dailyDelta = float shrank.
 */
export function projectDepletionYears(
  inPlayBTC: number,
  dailyDelta: number | null,
): number | null {
  if (dailyDelta == null || !Number.isFinite(dailyDelta)) return null;
  if (!(inPlayBTC > 0)) return null;
  const drainPerDay = -dailyDelta;
  if (drainPerDay < MIN_MEANINGFUL_DRAIN_BTC) return null;
  const years = inPlayBTC / drainPerDay / 365.25;
  if (!Number.isFinite(years) || years > MAX_MEANINGFUL_YEARS) return null;
  return years;
}

/**
 * BTC leaving the float per second, for the live ticking clock.
 * 0 when the drain is unknown, zero, or the float actually grew ·
 * the clock then simply holds still instead of inventing motion.
 */
export function drainPerSecond(dailyDelta: number | null): number {
  if (dailyDelta == null || !Number.isFinite(dailyDelta) || dailyDelta >= 0) {
    return 0;
  }
  return -dailyDelta / 86_400;
}

// Minimal Storage shape so these are testable with a fake object.
type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Parse the persisted last-view record. Never throws. */
export function readLastView(storage: StorageLike): LastView | null {
  try {
    const raw = storage.getItem(LAST_VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastView>;
    if (typeof v?.ts !== "number" || typeof v?.inPlayBTC !== "number") return null;
    return { ts: v.ts, inPlayBTC: v.inPlayBTC };
  } catch {
    return null;
  }
}

/** Persist the current view as the new baseline. Never throws. */
export function writeLastView(storage: StorageLike, v: LastView): void {
  try {
    storage.setItem(LAST_VIEW_KEY, JSON.stringify(v));
  } catch {
    /* private mode / quota · non-fatal, mechanic A just won't fire next time */
  }
}
