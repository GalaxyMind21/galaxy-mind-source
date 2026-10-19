/**
 * THE HODL TRAIL · pure engine for the daily expedition (cabinet #7).
 *
 * One caravan of four plebs treks through ten eras of bitcoin history
 * (2011 → today), one leg per era, one shared expedition per UTC day.
 * Every leg is an event from the deck (lib/trail-deck): discrete
 * choices, and on slider choices a CONTINUOUS 0–100% stake — the
 * continuous dial is deliberate anti-copy design (a posted "optimal
 * line" text can't reproduce a top score exactly; exact-max ties are
 * measure-zero · 2026-07-25 adversarial review).
 *
 * PURE MODULE · no React, no Date.now, no Math.random. Everything
 * derives from the day number ALONE (the WEN rule): the deck picks,
 * the hazard rolls, the party roster, the tombstone lines. Integer
 * sats end-to-end, so server replay (lib/arcade-replay) is exact with
 * no series-edge candidates — the deck ships in the bundle AND runs on
 * the server from this same module, which is the whole drift defense.
 *
 * Deck edits shift the seeded picks for days that haven't opened yet;
 * deploy content batches right after UTC rollover so an in-flight
 * day's puzzle identity never changes under a player (documented
 * failure mode: the straggler's board post 400s and drops · same
 * accepted posture as the Gauntlet's cache-skew edge).
 */

import {
  TRAIL_ERAS,
  TRAIL_EVENTS,
  TRAIL_PARTY_NAMES,
  TRAIL_TOMBSTONES,
  TRAIL_SURVIVOR_LINES,
  type TrailEvent,
} from "./trail-deck";

export const TRAIL_LEGS = 10;
export const TRAIL_PARTY_SIZE = 4;

/** Starting family stack · every caravan leaves 2011 with this. */
export const TRAIL_START_SATS = 210_000;

/** Hard score cap (the 21M homage) · board bound + clamp target. */
export const TRAIL_SATS_MAX = 2_100_000;

/** Sats banked per pleb who reaches the citadel alive. */
export const TRAIL_SURVIVOR_BONUS = 100_000;

/** A bust can kill a pleb only when this fraction+ of the stack was
 *  staked · light hits cost sats, heavy hits cost family. */
export const TRAIL_DEATH_STAKE = 0.5;

/** Panic cost when a pleb dies · applied to the post-bust stack. */
export const TRAIL_DEATH_TAX = 0.1;

/** A leg gain of ≥25% of the pre-leg stack earns the 🚀 cell. */
export const TRAIL_BIG_GAIN = 0.25;

/** Deterministic integer mix (murmur-style finalizer) · no RNG. */
function mix(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Two-lane mix · decorrelates (day, lane) streams. */
function mix2(a: number, b: number): number {
  return mix((Math.imul(a, 2654435761) ^ Math.imul(b, 0x27d4eb2f)) >>> 0);
}

/** Hazard roll for leg `leg` of day `n` · uniform [0,1), shared by
 *  every player that day (one world, one weather). */
export function trailRoll(n: number, leg: number): number {
  return mix2(n, 1 + leg) / 4_294_967_296;
}

/**
 * The day's ten events · one per era, chronological. Each era's pick
 * derives from the day number alone; pool ORDER therefore matters
 * (append-only edits keep past days stable in spirit, but any deck
 * change reshuffles the current day — see module header).
 *
 * Anti-copy floor: a day must carry ≥3 slider choices (the continuous
 * stake dial is what keeps a posted "optimal line" from reproducing a
 * top score). When the raw seeded picks fall short, deterministically
 * chosen legs walk forward to their era's next slider-carrying event ·
 * pure function of n, invariant-tested across 400 days.
 */
export function trailEventsFor(n: number): TrailEvent[] {
  const picks = TRAIL_ERAS.map((e, i) => {
    const pool = TRAIL_EVENTS.filter((ev) => ev.era === e.era);
    return { pool, idx: mix2(n, 101 + i) % pool.length };
  });
  const hasSlider = (ev: TrailEvent) => ev.choices.some((c) => c.slider);
  let sliders = picks.reduce(
    (s, p) => s + (hasSlider(p.pool[p.idx]) ? 1 : 0),
    0,
  );
  for (let k = 0; sliders < 3 && k < 24; k++) {
    const p = picks[mix2(n, 301 + k) % picks.length];
    if (hasSlider(p.pool[p.idx])) continue;
    for (let step = 1; step < p.pool.length; step++) {
      const j = (p.idx + step) % p.pool.length;
      if (hasSlider(p.pool[j])) {
        p.idx = j;
        sliders++;
        break;
      }
    }
  }
  return picks.map((p) => p.pool[p.idx]);
}

/** The day's caravan · four distinct names, same for everyone. */
export function trailPartyFor(n: number): string[] {
  const out: string[] = [];
  let cursor = mix2(n, 777);
  while (out.length < TRAIL_PARTY_SIZE) {
    const name = TRAIL_PARTY_NAMES[cursor % TRAIL_PARTY_NAMES.length];
    if (!out.includes(name)) out.push(name);
    cursor = mix(cursor + 1);
  }
  return out;
}

/** Tombstone line for the `deathIdx`-th death of day `n`. */
export function tombstoneFor(n: number, deathIdx: number): string {
  return TRAIL_TOMBSTONES[mix2(n, 500 + deathIdx) % TRAIL_TOMBSTONES.length];
}

/** Survivor epitaph for the citadel card. */
export function survivorLineFor(n: number): string {
  return TRAIL_SURVIVOR_LINES[mix2(n, 900) % TRAIL_SURVIVOR_LINES.length];
}

// ── Simulation ──────────────────────────────────────────────────────

/** One player action: [leg, choiceIndex, allocPct]. `allocPct` is an
 *  integer 0..100, read only when the chosen option carries a slider
 *  (non-slider options use their fixed stake). This tuple IS the
 *  replay proof unit — the exact argument stream the engine consumed. */
export type TrailAction = readonly [number, number, number];

export type TrailDeath = {
  pleb: string;
  line: string;
};

export type TrailLegOutcome = {
  leg: number;
  eventId: string;
  choice: number;
  /** Sats put at risk this leg. */
  staked: number;
  /** Signed sats delta (post-death-tax when a death occurred). */
  delta: number;
  hit: boolean;
  big: boolean;
  death: TrailDeath | null;
  satsAfter: number;
};

export type TrailRunResult = {
  day: number;
  outcomes: TrailLegOutcome[];
  sats: number;
  survivors: number;
  wiped: boolean;
  score: number;
  grid: string;
};

export type TrailPartial = {
  outcomes: TrailLegOutcome[];
  sats: number;
  survivors: number;
  wiped: boolean;
};

/**
 * Replay `actions` as far as they go · the ONE outcome-math path,
 * shared by the client (mid-run resume from the localStorage action
 * log) and by runTrail/replay verification, so the two can never
 * drift. Returns null on any illegal prefix (wrong leg order, bad
 * choice index, non-integer alloc, actions after a wipe).
 */
export function runTrailPartial(
  n: number,
  actions: readonly TrailAction[],
): TrailPartial | null {
  if (!Number.isInteger(n) || n < 1) return null;
  if (actions.length > TRAIL_LEGS) return null;
  const events = trailEventsFor(n);
  const party = trailPartyFor(n);
  const outcomes: TrailLegOutcome[] = [];
  let sats = TRAIL_START_SATS;
  let survivors = TRAIL_PARTY_SIZE;
  let deaths = 0;

  for (let leg = 0; leg < actions.length; leg++) {
    if (survivors === 0) return null; // actions after a wipe
    const [aLeg, choiceIdx, alloc] = actions[leg];
    if (aLeg !== leg) return null;
    const ev = events[leg];
    if (
      !Number.isInteger(choiceIdx) ||
      choiceIdx < 0 ||
      choiceIdx >= ev.choices.length
    ) {
      return null;
    }
    if (!Number.isInteger(alloc) || alloc < 0 || alloc > 100) return null;
    const choice = ev.choices[choiceIdx];
    const frac = choice.slider ? alloc / 100 : choice.stake;
    const staked = Math.round(sats * frac);
    const hit = trailRoll(n, leg) < choice.risk;
    let delta: number;
    let death: TrailDeath | null = null;
    if (hit) {
      delta = -Math.round(staked * choice.bustX);
      const heavy = sats > 0 && staked / sats >= TRAIL_DEATH_STAKE;
      if (choice.deathRisk && heavy && survivors > 0) {
        const pleb = party[TRAIL_PARTY_SIZE - survivors];
        death = { pleb, line: tombstoneFor(n, deaths) };
        deaths++;
        survivors--;
        // Panic tax on what's left after the bust itself.
        delta -= Math.round((sats + delta) * TRAIL_DEATH_TAX);
      }
    } else {
      delta = Math.round(staked * choice.boomX);
    }
    const satsBefore = sats;
    sats = Math.max(0, sats + delta);
    outcomes.push({
      leg,
      eventId: ev.id,
      choice: choiceIdx,
      staked,
      delta,
      hit,
      big: !hit && satsBefore > 0 && delta / satsBefore >= TRAIL_BIG_GAIN,
      death,
      satsAfter: sats,
    });
    if (survivors === 0) break;
  }

  return { outcomes, sats, survivors, wiped: survivors === 0 };
}

/**
 * Run a full (or wiped-early) expedition for day `n` from an action
 * log. On top of runTrailPartial's legality, a short log without a
 * wipe is rejected · this completeness rule is exactly what the
 * server accepts as proof.
 */
export function runTrail(
  n: number,
  actions: readonly TrailAction[],
): TrailRunResult | null {
  const p = runTrailPartial(n, actions);
  if (!p) return null;
  if (!p.wiped && actions.length < TRAIL_LEGS) return null;
  const score = Math.max(
    0,
    Math.min(TRAIL_SATS_MAX, p.sats + p.survivors * TRAIL_SURVIVOR_BONUS),
  );
  return {
    day: n,
    outcomes: p.outcomes,
    sats: p.sats,
    survivors: p.survivors,
    wiped: p.wiped,
    score,
    grid: gridFor(p.outcomes, p.wiped),
  };
}

/** Spoiler-free share cells · one per leg plus the finale glyph.
 *  Reveals outcome shapes, never choices or rolls. */
export function gridFor(
  outcomes: readonly TrailLegOutcome[],
  wiped: boolean,
): string {
  const cells: string[] = outcomes.map((o) => {
    if (o.death) return "💀";
    if (o.hit) return "📉";
    if (o.big) return "🚀";
    return o.delta > 0 ? "🟧" : "⬜";
  });
  cells.push(wiped ? "🪦" : "🏰");
  return cells.join("");
}

/** True when a board score is inside the achievable envelope. */
export function isValidTrailScore(score: number): boolean {
  if (typeof score !== "number" || !Number.isFinite(score)) return false;
  const s = Math.round(score);
  if (Math.abs(s - score) >= 0.5) return false;
  return s >= 0 && s <= TRAIL_SATS_MAX;
}

/** The spoiler-free share text. `link` defaults to the plain game URL. */
export function buildTrailShareText(
  n: number,
  score: number,
  grid: string,
  survivors: number,
  link = "galaxymind.space/trail",
): string {
  const fate = survivors > 0
    ? `${survivors} of ${TRAIL_PARTY_SIZE} reached the citadel`
    : "The caravan was lost on the trail";
  return [
    `THE HODL TRAIL #${n} · ${score.toLocaleString("en-US")} sats`,
    grid,
    fate,
    link,
  ].join("\n");
}

// ── localStorage keys (gm:trail:*) · day-scoped keys append the day
//    number, mirroring the WEN key discipline.
export const K_TRAIL_PROG = (n: number) => `gm:trail:prog:${n}`;
export const K_TRAIL_RES = (n: number) => `gm:trail:res:${n}`;
export const K_TRAIL_STATS = "gm:trail:stats";
export const K_TRAIL_COACHED = "gm:trail:coached";
/** Board post awaiting verified success · cleared on ok, retried on
 *  the next visit (ZADD GT makes repeats idempotent). */
export const K_TRAIL_UNSENT = "gm:trail:unsent";
