/**
 * Cross-cabinet arcade streak · "played any cabinet N consecutive UTC
 * days" (growth sprint 2026-07-10).
 *
 * One streak spans all four cabinets (WEN, Runner, Gauntlet, Horizon) · the
 * habit we want is "come back and play something," not per-game loyalty.
 * Pure localStorage, no accounts, no server. A finished run anywhere on
 * the site advances it (see ArcadeStreakTracker, which listens for the
 * shared gm:arcade-finished event).
 */

const KEY = "gm:arcade:streak";

/** UTC day index · midnight-aligned, timezone-independent. */
function utcDay(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

type StreakState = { last: number; len: number };

function read(nowMs: number): StreakState | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StreakState>;
    if (typeof s?.last !== "number" || typeof s?.len !== "number") return null;
    return { last: s.last, len: s.len };
  } catch {
    return null;
  }
}

/**
 * Record a finished run for today. Idempotent within a UTC day: the
 * first play today extends (or resets) the streak, later plays no-op.
 * Returns the current active length.
 */
export function recordArcadePlay(nowMs: number = Date.now()): number {
  const today = utcDay(nowMs);
  const prev = read(nowMs);
  let len: number;
  if (prev && prev.last === today) {
    len = prev.len; // already counted today
  } else if (prev && prev.last === today - 1) {
    len = prev.len + 1; // consecutive day
  } else {
    len = 1; // first play, or the chain broke
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ last: today, len }));
  } catch {
    /* private mode · streak just won't persist */
  }
  return len;
}

/**
 * The streak length if it is still alive (played today or yesterday),
 * else 0. Yesterday still counts as active · today's play can extend it,
 * so we surface it as a live "keep it going" number.
 */
export function readActiveArcadeStreak(nowMs: number = Date.now()): number {
  const today = utcDay(nowMs);
  const s = read(nowMs);
  if (!s) return 0;
  if (s.last === today || s.last === today - 1) return s.len;
  return 0;
}

// ---- cross-device cloud sync (X-linked players · 2026-07-18) ----
// The streak follows the X login like the rest of arcade progress. These
// let ArcadeStreakTracker push/pull the RAW {last, len} to /api/arcade/cloud
// (game key "streak", day-continuity merge on the server).

/** The raw stored streak, or null if none · what cloud sync uploads. */
export function readRawStreak(): StreakState | null {
  return read(0);
}

/**
 * Adopt a server-merged streak, but only if it is day-continuity-BETTER than
 * what's local right now — a more recent last-day, or the same day with a
 * longer len. This never regresses a chain the player just extended on this
 * device while the sync was in flight (the same in-flight-clobber guard the
 * other cabinets' adopt paths use). Returns true if it wrote.
 */
export function adoptStreak(merged: unknown): boolean {
  if (!merged || typeof merged !== "object") return false;
  const m = merged as Partial<StreakState>;
  if (typeof m.last !== "number" || typeof m.len !== "number") return false;
  const cur = read(0);
  if (cur && !(m.last > cur.last || (m.last === cur.last && m.len > cur.len))) return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ last: m.last, len: m.len }));
    return true;
  } catch {
    return false;
  }
}
