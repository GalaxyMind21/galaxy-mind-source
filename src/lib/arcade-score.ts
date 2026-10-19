/**
 * Arcade score packing · pure helpers shared by the game clients and
 * /api/arcade/* so encode/decode can never drift.
 *
 * Runner history (2026-07-10): the first scheme packed sats into four
 * decimal places (`days + min(sats,9999)/10000`). Real runs collect
 * tens/hundreds of thousands of sats (100–500 per orb with combos), so
 * nearly every long run hit the 9,999 cap and the public board looked
 * like "everyone has 9,999 sats". Integer packing below holds up to
 * 999,999 sats as a true secondary sort key without float noise.
 */

/** Days survived · primary rank key. Tape history is ~1.7k closes. */
export const RUNNER_DAYS_MAX = 1900;
export const RUNNER_DAYS_MIN = 1;

/**
 * Sats ride in the low digits of the encoded score.
 * score = days * RUNNER_SATS_BASE + min(sats, RUNNER_SATS_BASE - 1)
 */
export const RUNNER_SATS_BASE = 1_000_000;
export const RUNNER_SATS_MAX = RUNNER_SATS_BASE - 1; // 999_999

export function encodeRunnerScore(days: number, sats: number): number {
  // Clamp days to RUNNER_DAYS_MAX so a present-reacher is never SILENTLY
  // rejected by isValidRunnerScore if the history window ever grows past
  // 1900 days (the tape is ~1.7k today · thin margin). A >max run
  // under-reports its days but still posts, which beats posting nothing
  // with no feedback (2026-07-10 review).
  const d = Math.max(
    0,
    Math.min(RUNNER_DAYS_MAX, Math.floor(Number(days)) || 0),
  );
  const s = Math.max(
    0,
    Math.min(RUNNER_SATS_MAX, Math.floor(Number(sats)) || 0),
  );
  return d * RUNNER_SATS_BASE + s;
}

export function decodeRunnerScore(score: number): {
  days: number;
  sats: number;
} {
  // Redis ZSET scores come back as floats · snap to nearest int.
  const n = Math.round(Number(score));
  if (!Number.isFinite(n) || n < 0) return { days: 0, sats: 0 };
  return {
    days: Math.floor(n / RUNNER_SATS_BASE),
    sats: n % RUNNER_SATS_BASE,
  };
}

/** True when an encoded runner score is inside the achievable envelope. */
export function isValidRunnerScore(score: number): boolean {
  if (typeof score !== "number" || !Number.isFinite(score)) return false;
  // Allow tiny float noise from Redis, then decode.
  const { days, sats } = decodeRunnerScore(score);
  if (days < RUNNER_DAYS_MIN || days > RUNNER_DAYS_MAX) return false;
  if (sats < 0 || sats > RUNNER_SATS_MAX) return false;
  // Reject legacy float packing (e.g. 1415.9999) so old clients can't
  // keep writing the broken shape onto a fresh board key.
  const reencoded = encodeRunnerScore(days, sats);
  return Math.abs(reencoded - Math.round(score)) < 0.5;
}

/** Format for the public board · "1,415 days · 48,320 sats". */
export function formatRunnerScore(score: number): string {
  const { days, sats } = decodeRunnerScore(score);
  if (days <= 0) return "—";
  return sats > 0
    ? `${days.toLocaleString("en-US")} days · ${sats.toLocaleString("en-US")} sats`
    : `${days.toLocaleString("en-US")} days`;
}

// ── Timechain (horizon) packing ─────────────────────────────────────
// sats primary, chain height in the fraction (0–999 → 3 decimals).
// Unchanged from the 2026-07-09 rebuild; helpers live here so the
// scoreboard has one import surface.

export const HORIZON_SATS_MAX = 1_500_000;
export const HORIZON_HEIGHT_MAX = 999;

export function encodeHorizonScore(sats: number, height: number): number {
  const s = Math.max(0, Math.floor(Number(sats)) || 0);
  const h = Math.max(
    0,
    Math.min(HORIZON_HEIGHT_MAX, Math.floor(Number(height)) || 0),
  );
  return s + h / 1000;
}

export function decodeHorizonScore(score: number): {
  sats: number;
  height: number;
} {
  if (!Number.isFinite(score) || score < 0) return { sats: 0, height: 0 };
  const sats = Math.floor(score);
  const height = Math.round((score - sats) * 1000);
  return { sats, height: Math.max(0, Math.min(HORIZON_HEIGHT_MAX, height)) };
}

export function formatHorizonScore(score: number): string {
  const { sats, height } = decodeHorizonScore(score);
  return height > 0
    ? `${sats.toLocaleString("en-US")} sats · height ${height}`
    : `${sats.toLocaleString("en-US")} sats`;
}

// ── WEN packing ─────────────────────────────────────────────────────
// Plain integer sats 0..10000 (closeness points · lib/wen scoreRun).
// No composite packing needed; helper lives here so the scoreboard
// keeps its one import surface.

export function formatWenScore(score: number): string {
  const sats = Math.max(0, Math.round(Number(score) || 0));
  return `${sats.toLocaleString("en-US")} sats`;
}
