/**
 * WEN · pure engine for the daily chart-dating game (cabinet #4).
 *
 * Every UTC day, one 90-close slice of the real BTC tape is the puzzle:
 * price axis shown, dates redacted. Five guesses at WHEN it was, each
 * answered with a direction (the answer is earlier/later) and a heat
 * band by days-off. Scoring is closeness points denominated in sats ·
 * NOT win/loss. Wordle's share ritual works because ~98% of players
 * win and people share wins; a binary win at ±7 days here would have a
 * 20-40% win rate and kill sharing on day one, so WEN uses the
 * GeoGuessr model: everyone finishes with a number worth posting.
 *
 * PURE MODULE · no React, no Date.now, no Math.random. Everything
 * derives from the day number so scripts/test-wen.ts can exercise it
 * headless, exactly like the gauntlet engine.
 *
 * DETERMINISM · the answer date derives from the day number ALONE.
 * /api/history?days=1825 is a SLIDING window (the oldest close drops
 * off as days pass), so index-into-series is not a stable identity
 * across days. Deriving the answer as a DATE from the day number and
 * then locating that date in whatever series the client loaded keeps
 * every player on the same puzzle and survives the window slide (the
 * Runner's buildTerrain startIdx debt is the cautionary tale).
 */

import { gauntletDayStartUtc } from "./gauntlet-day";

export const DAY_MS = 86_400_000;

/** Closes shown in the mystery window. 90 gives each slice a real
 *  signature (a halving, an FTX week) vs 60's anonymous wiggles. */
export const WEN_WINDOW_DAYS = 90;

export const WEN_GUESSES = 5;

/** Within this many days of the answer = 🎯 bullseye · ends the round
 *  early with an unused-guess bonus. Deliberately hard: pure interval
 *  bisection lands ~±50d after five guesses, so reaching ±7 takes
 *  actual tape knowledge. */
export const WEN_BULLSEYE_DAYS = 7;

/** The newest WEN_RECENT_EXCLUDE_DAYS are never the answer · "it's
 *  just last month" must never be the solve. */
export const WEN_RECENT_EXCLUDE_DAYS = 91;

/**
 * How far back of the exclusion edge an answer may fall. Chosen so the
 * OLDEST possible answer window still sits ~30 days inside the API's
 * 1825-day sliding window: 1825 - 91 (recent exclude) - 1615 (span) -
 * 89 (window body before the answer date) = 30 days of margin. Both
 * bounds derive from the day number, so eligibility never depends on
 * how much history a given client loaded.
 */
export const WEN_SPAN_DAYS = 1615;

export const WEN_SATS_MAX = 10_000;

/** Heat band by |days off| · the share-grid vocabulary. */
export type WenBand = "bull" | "close" | "warm" | "cold" | "ice";

export type WenDirection = "earlier" | "later" | "hit";

export type WenGuessResult = {
  /** Where the ANSWER sits relative to the guess. */
  direction: WenDirection;
  band: WenBand;
  daysOff: number; // absolute
};

/** Deterministic integer mix (murmur-style finalizer) · no RNG. */
function mix(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** UTC-midnight ms of the answer date (the mystery window's END day)
 *  for daily puzzle `n`. Pure function of n. */
export function wenAnswerUtc(n: number): number {
  const dayStart = gauntletDayStartUtc(n);
  const back = WEN_RECENT_EXCLUDE_DAYS + (mix(n) % WEN_SPAN_DAYS);
  return dayStart - back * DAY_MS;
}

/** Earliest/latest guessable UTC-midnight ms for puzzle `n` · the
 *  timeline's initial range. Mirrors the answer-eligibility bounds so
 *  the answer is always inside the guessable range. */
export function wenGuessBounds(n: number): { minUtc: number; maxUtc: number } {
  const dayStart = gauntletDayStartUtc(n);
  return {
    minUtc: dayStart - (WEN_RECENT_EXCLUDE_DAYS + WEN_SPAN_DAYS) * DAY_MS,
    maxUtc: dayStart - WEN_RECENT_EXCLUDE_DAYS * DAY_MS,
  };
}

export function utcDayIndex(utcMs: number): number {
  return Math.floor(utcMs / DAY_MS);
}

export function bandFor(daysOff: number): WenBand {
  const d = Math.abs(daysOff);
  if (d <= WEN_BULLSEYE_DAYS) return "bull";
  if (d <= 30) return "close";
  if (d <= 90) return "warm";
  if (d <= 365) return "cold";
  return "ice";
}

/** Evaluate one guess. Both args are UTC-midnight ms. */
export function evaluateGuess(
  guessUtc: number,
  answerUtc: number,
): WenGuessResult {
  const diff = utcDayIndex(guessUtc) - utcDayIndex(answerUtc);
  const daysOff = Math.abs(diff);
  const band = bandFor(daysOff);
  if (band === "bull") return { direction: "hit", band, daysOff };
  return { direction: diff > 0 ? "earlier" : "later", band, daysOff };
}

/**
 * Sats from a finished run. Base decays with the BEST guess's days-off
 * (closer = more), plus 250 per unused guess when the run ended on a
 * bullseye. Perfect day-exact first guess = 9000 + 4x250 = 10,000.
 *
 * The curve is tuned so a knowledgeable 2-3 guess solve clearly beats
 * a five-guess bisection: e.g. bullseye on 3 (~8,900) vs a bisection
 * stall at ±50d on 5 (~5,900).
 */
export function scoreRun(results: WenGuessResult[]): number {
  if (results.length === 0) return 0;
  let bestOff = Infinity;
  let bullAt = -1;
  for (let i = 0; i < results.length; i++) {
    if (results[i].daysOff < bestOff) bestOff = results[i].daysOff;
    if (bullAt < 0 && results[i].band === "bull") bullAt = i;
  }
  const base = Math.round(9000 * Math.exp(-bestOff / 120));
  const bonus = bullAt >= 0 ? 250 * (WEN_GUESSES - 1 - bullAt) : 0;
  return Math.max(0, Math.min(WEN_SATS_MAX, base + bonus));
}

const BAND_EMOJI: Record<WenBand, string> = {
  bull: "🎯",
  close: "🟨",
  warm: "🟧",
  cold: "🟥",
  ice: "⬛",
};

/** One share-grid cell per guess · 🎯 alone on a bullseye, else a
 *  direction arrow (⏪/⏩ render consistently cross-platform where
 *  ⬅/➡ do not) plus the heat square. */
export function gridCell(r: WenGuessResult): string {
  if (r.band === "bull") return BAND_EMOJI.bull;
  return (r.direction === "earlier" ? "⏪" : "⏩") + BAND_EMOJI[r.band];
}

/** The spoiler-free share text · reveals nothing about which window.
 *  `link` defaults to the plain game URL; the client passes the
 *  per-result card path so the post unfurls into the OG billboard. */
export function buildShareText(
  n: number,
  sats: number,
  results: WenGuessResult[],
  link = "galaxymind.space/wen",
): string {
  const rows = results.map(gridCell).join(" ");
  return [
    `WEN #${n} · ${sats.toLocaleString("en-US")} sats`,
    rows,
    link,
  ].join("\n");
}

/** True when a board score is inside the achievable envelope. */
export function isValidWenScore(score: number): boolean {
  if (typeof score !== "number" || !Number.isFinite(score)) return false;
  const s = Math.round(score);
  if (Math.abs(s - score) >= 0.5) return false;
  return s >= 0 && s <= WEN_SATS_MAX;
}

// ── Per-result share card transport (phase 2 · 2026-07-11) ─────────
// A finished WEN encodes into ONE url-safe path segment for the share
// link (/wen/c/<seg>), following the Runner card pattern: the segment
// is attacker-reachable, so everything is clamped on the way in AND
// the way out, and the page/OG never trust a raw value. Cells encode
// as 2-char chunks: direction e/l + band y(close) o(warm) r(cold)
// k(ice); a bullseye cell is "tt" and may only be the LAST cell (the
// round ends on it · a mid-run bullseye is a fabricated shape and the
// whole cells field is dropped).

export type WenCardCell = {
  direction: "earlier" | "later" | "hit";
  band: WenBand;
};

export type WenCard = {
  n: number;
  sats: number;
  cells: WenCardCell[];
};

const CARD_DELIM = "~";
const BAND_TO_CH: Record<Exclude<WenBand, "bull">, string> = {
  close: "y",
  warm: "o",
  cold: "r",
  ice: "k",
};
const CH_TO_BAND: Record<string, Exclude<WenBand, "bull">> = {
  y: "close",
  o: "warm",
  r: "cold",
  k: "ice",
};

function cardClampInt(v: unknown, lo: number, hi: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function encodeWenCard(c: WenCard): string {
  const cells = c.cells
    .slice(0, WEN_GUESSES)
    .map((cell) =>
      cell.band === "bull"
        ? "tt"
        : (cell.direction === "earlier" ? "e" : "l") +
          BAND_TO_CH[cell.band as Exclude<WenBand, "bull">],
    )
    .join("");
  return encodeURIComponent(
    [
      "n" + cardClampInt(c.n, 1, 50_000),
      "s" + cardClampInt(c.sats, 0, WEN_SATS_MAX),
      "g" + cells,
    ].join(CARD_DELIM),
  );
}

/** Parse a route param back into a WenCard. Returns null only when the
 *  core fields are unusable · callers render a generic fallback. */
export function decodeWenCard(raw: string): WenCard | null {
  let s = raw;
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s);
    } catch {
      /* clamps below still bound every field */
    }
  }
  let n = 0;
  let sats = -1;
  let cells: WenCardCell[] = [];
  for (const f of s.split(CARD_DELIM)) {
    if (!f) continue;
    const tag = f[0];
    const rest = f.slice(1);
    if (tag === "n") n = cardClampInt(rest, 0, 50_000);
    else if (tag === "s") sats = cardClampInt(rest, -1, WEN_SATS_MAX);
    else if (tag === "g") {
      const out: WenCardCell[] = [];
      let ok = rest.length % 2 === 0 && rest.length <= WEN_GUESSES * 2;
      for (let i = 0; ok && i < rest.length; i += 2) {
        const pair = rest.slice(i, i + 2);
        if (pair === "tt") {
          // Bullseye ends the round · anything after it is fabricated.
          if (i + 2 !== rest.length) {
            ok = false;
            break;
          }
          out.push({ direction: "hit", band: "bull" });
        } else if (
          (pair[0] === "e" || pair[0] === "l") &&
          CH_TO_BAND[pair[1]]
        ) {
          out.push({
            direction: pair[0] === "e" ? "earlier" : "later",
            band: CH_TO_BAND[pair[1]],
          });
        } else {
          ok = false;
        }
      }
      cells = ok ? out : [];
    }
  }
  if (n < 1 || sats < 0) return null;
  return { n, sats, cells };
}

/** Emoji grid line for a decoded card (page rendering · the OG image
 *  draws squares instead, dynamic OG routes are ASCII-only). */
export function cardGridLine(cells: WenCardCell[]): string {
  return cells
    .map((c) =>
      gridCell({ direction: c.direction, band: c.band, daysOff: 0 }),
    )
    .join(" ");
}

// ── localStorage keys (gm:wen:*) · day-scoped keys append the day
//    number. gm:wen:res:${n} is ALSO read by TodayHabitExtras · the
//    string is hand-synced there (deliberate bundle-splitting choice,
//    same as the Runner's best key).
export const K_WEN_RES = (n: number) => `gm:wen:res:${n}`;
export const K_WEN_PROG = (n: number) => `gm:wen:prog:${n}`;
export const K_WEN_BEST = "gm:wen:best";
export const K_WEN_STATS = "gm:wen:stats";
export const K_WEN_COACHED = "gm:wen:coached";
/** Board post awaiting verified success · cleared on ok, retried on
 *  the next visit (the Runner H3 lesson · ZADD GT makes repeats
 *  idempotent, and the daily sent-flag is only set on verified ok). */
export const K_WEN_UNSENT = "gm:wen:unsent";
