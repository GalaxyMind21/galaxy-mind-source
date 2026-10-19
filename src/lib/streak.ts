/* =====================================================================
 * Streak · shared LS-read helpers for the gauge-check daily streak.
 *
 * The streak engine WRITES happen in one place only:
 * `src/app/stack/components/GaugeCheckStreak.tsx` (mounts on /stack,
 * increments / resets per UTC day, persists to `gm_gauge_streak`).
 *
 * Everywhere else that wants to SHOW the streak (header chip,
 * mobile bottom-nav badge, future surfaces) uses `readActiveStreak()`
 * to read the LS record and honestly answer "is the streak still
 * alive?". When the streak is broken or the count is below the
 * display threshold, the helper returns null so callers don't
 * advertise a value the engine is about to reset.
 *
 * GRACE DAYS (2026-06-10): every GRACE_EARN_EVERY consecutive days
 * banks one grace token (cap GRACE_TOKEN_CAP). A single missed UTC
 * day consumes a token instead of resetting · the one-bad-day reset
 * was the single biggest churn moment of the streak mechanic. Tokens
 * are earned/consumed ONLY by the canonical writer; this module just
 * predicts survival on the read side so chips don't hide a streak
 * the engine will preserve.
 *
 * No writes here. Anyone needing increments goes through the canonical
 * writer; that keeps the single-source-of-truth contract intact.
 * ===================================================================== */

export const STREAK_LS_KEY = "gm_gauge_streak";
export const STREAK_MIN_DISPLAY_COUNT = 2;
export const STREAK_TIER_1 = 7; // one week
export const STREAK_TIER_2 = 30; // one month
// One grace token banked per this many consecutive days · capped so a
// long streak can't stockpile immunity (two misses in a week still
// resets, which keeps the habit honest).
export const GRACE_EARN_EVERY = 7;
export const GRACE_TOKEN_CAP = 2;

export type StreakRecord = {
  lastDateUTC: string;
  count: number;
  /** Banked grace tokens (0..GRACE_TOKEN_CAP). Optional · legacy
   *  records predate the field and parse as 0. */
  graceTokens?: number;
};

export function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dayDelta(aISO: string, bISO: string): number {
  const a = new Date(aISO + "T00:00:00Z").getTime();
  const b = new Date(bISO + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Clamp a stored graceTokens value to a sane integer in range. */
export function normalizeGraceTokens(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(GRACE_TOKEN_CAP, Math.max(0, Math.floor(v)));
}

export type ActiveStreak = {
  count: number;
  /** Banked grace freezes (0..GRACE_TOKEN_CAP). */
  graceTokens: number;
};

/**
 * Read the gauge-check streak from localStorage and return detail, or
 * null if there isn't a displayable, still-alive streak.
 *
 * Returns null when:
 *   - SSR / no `window`
 *   - LS key missing or corrupted (including an unparseable date ·
 *     a NaN delta must not zombie-display a dead streak forever)
 *   - count below the display threshold (single-visit "1-day" is silly)
 *   - the streak is genuinely dead: more than 1 missed UTC day, or
 *     exactly 1 missed day with no grace token banked (the engine
 *     will reset to 1 on next /stack visit, so we don't claim it)
 *
 * delta 0 = checked today · delta 1 = alive, not yet re-stamped for
 * today · delta 2 with a banked token = alive, the writer will consume
 * the token · delta < 0 = clock skew, treat as fresh.
 */
export function readActiveStreakDetail(): ActiveStreak | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STREAK_LS_KEY);
    if (!raw) return null;
    const prev = JSON.parse(raw) as StreakRecord;
    if (
      typeof prev.lastDateUTC !== "string" ||
      typeof prev.count !== "number" ||
      prev.count < STREAK_MIN_DISPLAY_COUNT
    ) {
      return null;
    }
    const delta = dayDelta(prev.lastDateUTC, utcDateString(new Date()));
    // Corrupt date string → NaN delta. Every comparison below would be
    // false, which previously displayed a zombie streak forever.
    if (!Number.isFinite(delta)) return null;
    const graceTokens = normalizeGraceTokens(prev.graceTokens);
    if (delta <= 1) return { count: prev.count, graceTokens };
    if (delta === 2 && graceTokens > 0) {
      return { count: prev.count, graceTokens };
    }
    return null;
  } catch {
    return null;
  }
}

/** Count-only helper · same null rules as `readActiveStreakDetail`. */
export function readActiveStreak(): number | null {
  return readActiveStreakDetail()?.count ?? null;
}

/** Map a streak count to a tier 0/1/2 for visual escalation. */
export function streakTier(count: number): 0 | 1 | 2 {
  if (count >= STREAK_TIER_2) return 2;
  if (count >= STREAK_TIER_1) return 1;
  return 0;
}
