/* =====================================================================
 * arcade-replay · server-side replay verification for the daily boards
 * (2026-07-11 · operator decision: WEN + Gauntlet scores are provably
 * honest; runner/saylor/horizon keep the documented forgeable posture).
 *
 * Both games are PURE engines keyed on the UTC day number, so the
 * server can re-run a submitted proof (WEN: the guess list · Gauntlet:
 * the player-action log) against the same price series and check the
 * claimed score falls out. A forged score that the game cannot
 * physically produce from ANY play now bounces at the API, not just at
 * the bounds check. Replay proves ACHIEVABILITY, not live play · a
 * determined cheater with hindsight can still construct a good run,
 * but the board can no longer show a number the game can't produce.
 *
 * Series-identity caveats this module absorbs (see the README /wen):
 * - WEN's answer is a DATE derived from the day number alone, located
 *   in whatever series is loaded · leading/trailing edge differences
 *   between the client's fetch and the replay fetch cannot move it.
 * - Gauntlet windows are time-anchored, BUT seeds whose calendar
 *   target predates the series origin clamp to index 0, so for those
 *   the window DOES depend on the series' leading edge · and the
 *   /api/history response cache (6h) plus long-lived tabs mean a
 *   client's leading edge can lag the replay's by a few days. The
 *   verifier therefore tries a small set of leading-offset candidates
 *   and accepts if ANY replays to the claimed score.
 *
 * Everything here is pure given (points, day, proof) · tested by
 * scripts/test-arcade-score.ts, no React, no KV.
 * ===================================================================== */

import {
  RUN_DAYS,
  advanceDay,
  buy,
  createState,
  finish,
  mulberry32,
  openMargin,
  sell,
  setupRun,
  type BtcPoint,
} from "@/app/gauntlet/engine";
import {
  DAY_MS,
  WEN_GUESSES,
  evaluateGuess,
  scoreRun,
  utcDayIndex,
  wenAnswerUtc,
  wenGuessBounds,
  type WenGuessResult,
} from "@/lib/wen";
import { TRAIL_LEGS, runTrail, type TrailAction } from "@/lib/hodl-trail";

export type { TrailAction };

/** The client's /api/history request window (days=1825). */
const HISTORY_WINDOW_DAYS = 1825;

/**
 * Hard cap on the gauntlet action log. A human run is typically well
 * under 100 actions; a pause-and-mash session could exceed this, in
 * which case the run still completes locally · it just forfeits the
 * board entry. Keeps the proof inside the request body cap.
 */
export const MAX_GAUNTLET_ACTIONS = 400;

/**
 * Leading-edge candidates tried per gauntlet replay · covers the 6h
 * /api/history response-cache skew, the post-midnight submit grace,
 * and a tab left open a day or two (each candidate is one cheap
 * 240-day sim).
 */
const MAX_LEAD_OFFSETS = 4;

// One player action: [runDay, kind, value] where kind 0 = buy(usd),
// 1 = sell(fraction), 2 = openMargin(usd). The value is the EXACT
// argument the client passed to the engine call, so the replay hits
// the same internal clamps and lands on bit-identical floats.
export type GauntletAction = readonly [number, number, number];

/** Strict shape/bounds parse of a submitted gauntlet proof. */
export function parseGauntletProof(raw: unknown): GauntletAction[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_GAUNTLET_ACTIONS) return null;
  const out: GauntletAction[] = [];
  let prevDay = 0;
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 3) return null;
    const [d, k, v] = entry as unknown[];
    if (
      typeof d !== "number" ||
      !Number.isInteger(d) ||
      d < 0 ||
      d > RUN_DAYS ||
      d < prevDay // the log is chronological by construction
    ) {
      return null;
    }
    if (k !== 0 && k !== 1 && k !== 2) return null;
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (k === 1) {
      if (v <= 0 || v > 1) return null; // sell fraction
    } else if (v < 1 || v > 1e9) {
      return null; // buy / margin USD
    }
    prevDay = d;
    out.push([d, k, v]);
  }
  return out;
}

/** Daily seed · must stay in lockstep with GauntletGame.startRun. */
export function gauntletDailySeed(day: number): number {
  return (0x5eed ^ Math.imul(day, 2654435761)) >>> 0;
}

/**
 * Replay one action log against one candidate series. Returns the
 * final alpha, or null when the log doesn't fit the sim (days that
 * never arrive) or the series can't host the window.
 */
function replayGauntlet(
  pts: BtcPoint[],
  day: number,
  actions: GauntletAction[],
): number | null {
  let setup;
  try {
    setup = setupRun(pts, gauntletDailySeed(day), "daily", day, 0);
  } catch {
    return null; // series too short · caller treats as no-match
  }
  const s = createState(setup);
  // Same rng stream as the client (card picks + cooldowns) · it never
  // touches economics, but matching it keeps the replay exact.
  const rng = mulberry32(setup.seed ^ 0x51ed);
  let ai = 0;
  const applyAt = (d: number) => {
    while (ai < actions.length && actions[ai][0] === d) {
      const [, k, v] = actions[ai++];
      if (k === 0) buy(s, setup, v);
      else if (k === 1) sell(s, setup, v);
      else openMargin(s, setup, v);
    }
  };
  // Client ordering: actions at run-day d happen after the day-d
  // boundary has processed (day 0 actions before any boundary).
  applyAt(0);
  while (s.day < RUN_DAYS) {
    advanceDay(s, setup, rng);
    applyAt(s.day);
  }
  if (ai !== actions.length) return null; // leftover = phantom days
  return finish(s, setup).alpha;
}

/**
 * Verify a gauntlet daily score. `rawPoints` is the UNTRIMMED Yahoo 5y
 * series in unix seconds (lib/btc-history-server); the client-side
 * 1825d cutoff + trailing-2 trim are applied per candidate here.
 */
export function verifyGauntletProof(
  rawPoints: BtcPoint[],
  nowMs: number,
  day: number,
  actions: GauntletAction[],
  claimedAlpha: number,
): boolean {
  if (rawPoints.length < 400) return false;
  const cutoffSec = Math.floor(nowMs / 1000) - HISTORY_WINDOW_DAYS * 86_400;
  let i0 = rawPoints.findIndex((p) => p.t >= cutoffSec);
  if (i0 < 0) i0 = 0;
  const tried = new Set<number>();
  for (let j = 0; j < MAX_LEAD_OFFSETS; j++) {
    const startIdx = Math.max(0, i0 - j);
    if (tried.has(startIdx)) continue;
    tried.add(startIdx);
    // Trailing-2 trim mirrors the client (btc-history-client consumers);
    // the run window ends years before the tail, so this is parity, not
    // a correctness requirement.
    const pts = rawPoints.slice(startIdx, rawPoints.length - 2);
    const alpha = replayGauntlet(pts, day, actions);
    // Board resolution is 0.1 alpha points · a matching replay is
    // bit-identical in practice, the tolerance just absorbs the
    // client's own display rounding if a stale bundle sends it.
    if (alpha != null && Math.abs(alpha - claimedAlpha) <= 0.05) return true;
  }
  return false;
}

// ── THE HODL TRAIL ──────────────────────────────────────────────────
// The trail is the easiest replay of the three: the deck is code (no
// price series, no leading-edge candidates), so the proof is just the
// action log and the verify is one pure runTrail call. [leg, choice,
// alloc] mirrors the engine's TrailAction — the exact argument stream
// the client's sim consumed.

/** Strict shape/bounds parse of a submitted trail proof. */
export function parseTrailProof(raw: unknown): TrailAction[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > TRAIL_LEGS) {
    return null;
  }
  const out: TrailAction[] = [];
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (!Array.isArray(e) || e.length !== 3) return null;
    const [l, c, a] = e as unknown[];
    if (l !== i) return null; // legs are sequential from 0 by construction
    if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c > 3) {
      return null;
    }
    if (typeof a !== "number" || !Number.isInteger(a) || a < 0 || a > 100) {
      return null;
    }
    out.push([i, c, a]);
  }
  return out;
}

/**
 * Verify a trail score by re-running the expedition. runTrail returns
 * null for any log that is not a legal play of that day (bad choice
 * index, actions after a wipe, short log without a wipe), so legality
 * and score agreement are one check.
 */
export function verifyTrailProof(
  day: number,
  actions: readonly TrailAction[],
  claimedScore: number,
): boolean {
  const res = runTrail(day, actions);
  return res != null && res.score === Math.round(claimedScore);
}

/** Strict shape parse of a WEN proof: 1..5 guess timestamps (UTC ms). */
export function parseWenProof(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > WEN_GUESSES) {
    return null;
  }
  const out: number[] = [];
  for (const g of raw) {
    if (typeof g !== "number" || !Number.isFinite(g) || g <= 0) return null;
    out.push(g);
  }
  return out;
}

/**
 * Verify a WEN score by re-deriving the day's answer and re-scoring
 * the guess list. The answer date derives from the day number ALONE
 * and is then located in the series with the client's exact
 * gap-tolerant scan, so both sides land on the same effective answer
 * regardless of series-edge skew.
 */
export function verifyWenProof(
  rawPoints: BtcPoint[],
  day: number,
  guesses: number[],
  claimedSats: number,
): boolean {
  if (rawPoints.length < 100) return false;
  // Mirror the client: trailing-2 trim, then normalize t to ms.
  const pts = rawPoints
    .slice(0, rawPoints.length - 2)
    .map((q) => (q.t < 1e12 ? { t: q.t * 1000, p: q.p } : q));
  const targetDay = utcDayIndex(wenAnswerUtc(day));
  let idx = -1;
  for (let i = pts.length - 1; i >= 0; i--) {
    const d = utcDayIndex(pts[i].t);
    if (d <= targetDay) {
      if (targetDay - d <= 3) idx = i;
      break;
    }
  }
  if (idx < 89) return false; // series can't host the puzzle
  const effAnswer = utcDayIndex(pts[idx].t) * DAY_MS;

  const gb = wenGuessBounds(day);
  const results: WenGuessResult[] = [];
  for (const g of guesses) {
    if (g < gb.minUtc || g > gb.maxUtc) return false;
    results.push(evaluateGuess(g, effAnswer));
  }
  // Run shape: a bullseye ends the round, so it may only be the LAST
  // cell, and a shorter-than-5 run must have ended on one.
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i].band === "bull") return false;
  }
  if (
    results.length < WEN_GUESSES &&
    results[results.length - 1].band !== "bull"
  ) {
    return false;
  }
  return scoreRun(results) === Math.round(claimedSats);
}
