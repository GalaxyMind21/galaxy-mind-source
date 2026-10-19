// Bitcoin Kart · world-leader ghost (Tier 1 · 2026-07-14).
//
// The daily #1 uploads their run's ghost frames (10 Hz [x,y,z,heading]
// samples, the same shape the game records locally); everyone who
// starts that day's circuit downloads it and races the actual leading
// line as a glowing rival ghost. Pure validators live here so the
// route stays thin and the bounds are unit-testable.
//
// Integrity posture: same as the kart board itself (salt token + bounds
// + leadership check against the live ZSET · NOT replay-verified). A
// forged ghost is cosmetic griefing at worst, and the leadership check
// means you can only seat a ghost if you genuinely hold the top score.

export const KART_GHOST_KEY = (n: number) => `gm:kart:ghost:day:v1:${n}`;
export const KART_GHOST_TTL = 60 * 60 * 24 * 8; // matches the daily board

// Mirrors the game client + score route (drift-guarded in
// scripts/test-bitcoin-kart.ts).
export const KART_GHOST_BASE_MS = 600_000;
// PHYSICAL floor, not the score-envelope floor (fixed 2026-07-25).
//
// This was 60_000, copied from the BOARD's score envelope
// (KART_MAX = KART_BASE - 60_000). But those are different things: the
// board CLAMPS a faster-than-60s finish into the envelope and accepts it
// (public/bitcoin-kart/js/board.js dailyScore, added in the 2026-07-15
// sweep for exactly this case), while the ghost routes REJECTED it. So a
// genuine sub-60s run — real on a short FULL SEND track — posted a #1
// board score and then:
//   · /api/arcade/kart-ghost 400'd, seating NO world ghost for that day
//     (every other player that day raced nothing) while the client still
//     announced "WORLD GHOST SEATED", and
//   · validateDareMeta rejected the mint, so the share tweet carried no
//     ~g<id> and the dare chain silently broke — for precisely the
//     players most likely to share.
// 40s is below the ~56s physical best measured with satoshi on FULL SEND
// and needs no other constant touched: GHOST_MIN_FRAMES (400) is still
// the binding lower bound at 10Hz and satisfies framesMatchTime.
export const KART_GHOST_MIN_MS = 40_000;

/**
 * The daily-board score for a finish time — the SINGLE definition, so
 * the client, the score route and both ghost routes cannot drift.
 *
 * Mirrors public/bitcoin-kart/js/board.js `dailyScore()` exactly,
 * including the clamp. The clamp is load-bearing: without it a fast run
 * yields a different score here than the board stores, so the ghost
 * route's token check AND its leadership compare would both miss.
 *
 * The ceiling rides KART_GHOST_MIN_MS: when it was pinned at 60s instead,
 * every sub-minute finish collapsed onto one score, which ZADD GT then
 * froze forever (fixed 2026-07-28).
 */
export function kartDailyScore(timeMs: number): number {
  return Math.max(
    1,
    Math.min(
      KART_GHOST_BASE_MS - KART_GHOST_MIN_MS,
      KART_GHOST_BASE_MS - Math.round(timeMs),
    ),
  );
}

// 10 Hz recording · a legal daily run is 60s..540s, so frames land in
// [600, 5400]. The floor is looser (400) because recording starts at GO
// and the earliest honest finishes trim a little.
export const GHOST_MIN_FRAMES = 400;
export const GHOST_MAX_FRAMES = 5400;
// world coordinates never leave a few-hundred-unit island; 2000 is a
// generous envelope that still rejects absurd payloads
const COORD_LIMIT = 2000;
const HEADING_LIMIT = 64; // radians accumulate over laps · generous

export type GhostFrame = [number, number, number, number];

/**
 * Validate + re-quantize an uploaded frame list. Returns null on ANY
 * shape problem; otherwise a defensively-copied, dm-quantized list
 * (never trust client rounding · quantization also bounds stored size).
 */
export function validateGhostFrames(v: unknown): GhostFrame[] | null {
  if (!Array.isArray(v) || v.length < GHOST_MIN_FRAMES || v.length > GHOST_MAX_FRAMES) return null;
  const out: GhostFrame[] = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const f = v[i] as unknown[];
    if (!Array.isArray(f) || f.length !== 4) return null;
    const [x, y, z, h] = f as number[];
    if (
      typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > COORD_LIMIT ||
      typeof y !== "number" || !Number.isFinite(y) || Math.abs(y) > COORD_LIMIT ||
      typeof z !== "number" || !Number.isFinite(z) || Math.abs(z) > COORD_LIMIT ||
      typeof h !== "number" || !Number.isFinite(h) || Math.abs(h) > HEADING_LIMIT
    ) {
      return null;
    }
    out[i] = [
      Math.round(x * 10) / 10,
      Math.round(y * 10) / 10,
      Math.round(z * 10) / 10,
      Math.round(h * 100) / 100,
    ];
  }
  return out;
}

/**
 * The frame count must roughly match the claimed finish time (10 Hz):
 * a 2:00 run with 9 minutes of frames is not that run's ghost.
 */
export function framesMatchTime(frameCount: number, timeMs: number): boolean {
  const expected = timeMs / 100;
  return frameCount >= expected * 0.7 - 50 && frameCount <= expected * 1.2 + 50;
}

// ── Dare ghosts · "race my ghost" deep links (2026-07-16) ──
//
// A finished run's ghost is minted ON SHARE INTENT (never on plain
// finishes · KV volume stays proportional to sharing, not to play) and
// keyed by a random id that rides the share card as `~g<id>`; the card
// page's CTA then boots /bitcoin-kart?ghost=<id> straight into a race
// against that line. Same integrity ceiling as everything kart: salt
// token + bounds, NOT replay-verified — a dare proves a run happened
// within bounds, never a "verified time".

import { KART_TRACK_IDS, KART_CLASS_LABELS, type KartClass } from "./kart-card";

export const KART_DARE_KEY = (id: string) => `gm:kart:dare:v1:${id}`;
export const KART_DARE_TTL = 60 * 60 * 24 * 7; // a dare link lives a week
export const KART_DARE_ID_RE = /^[a-f0-9]{12}$/;
// measurement counters (research decision 2026-07-16: server-observable
// proxies instead of client analytics) · fetches-per-mint is the funnel
export const KART_DARE_COUNTER = (kind: "mint" | "fetch", day: number) =>
  `gm:kart:dare:${kind}:${day}`;
export const KART_DARE_COUNTER_TTL = 60 * 60 * 24 * 35;

export type KartDareMeta = {
  trackId: string;
  klass: KartClass;
  mirror: boolean;
  timeMs: number;
};

/**
 * Validate the run metadata a dare carries. Allow-list or nothing, same
 * posture as the share card: unknown ids never reach storage.
 */
export function validateDareMeta(v: unknown): KartDareMeta | null {
  const b = v as { trackId?: unknown; klass?: unknown; mirror?: unknown; timeMs?: unknown };
  if (!b || typeof b !== "object") return null;
  const trackId = typeof b.trackId === "string" ? b.trackId : "";
  if (!(KART_TRACK_IDS as readonly string[]).includes(trackId)) return null;
  const klass = typeof b.klass === "string" ? b.klass : "";
  if (!Object.prototype.hasOwnProperty.call(KART_CLASS_LABELS, klass)) return null;
  const timeMs = typeof b.timeMs === "number" ? Math.round(b.timeMs) : NaN;
  if (!Number.isInteger(timeMs) || timeMs < KART_GHOST_MIN_MS || timeMs > KART_GHOST_BASE_MS - 60_000) return null;
  return { trackId, klass: klass as KartClass, mirror: b.mirror === true, timeMs };
}
