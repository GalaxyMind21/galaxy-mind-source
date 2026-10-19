/* =====================================================================
 * moon.ts · procedural lunar terrain for the Runner's overtime level
 * (2026-07-10).
 *
 * When you reach the present you go "to the moon" · the tape runs out
 * of history and the run continues on a generated lunar plain. This is
 * the pure, deterministic generator for one chunk of that plain, kept
 * out of the canvas component so it can be unit-tested.
 *
 * Determinism is the whole point: the moon is seeded from the SAME
 * daily seed as the tape (offset by a constant), so today's moon is the
 * same course for everyone · the daily board stays a fair race even
 * into overtime. Difficulty escalates with the chunk index (moon rocks
 * get denser and taller); the plain itself stays runnable because the
 * real pressure is the ever-climbing speed.
 * ===================================================================== */

import { mulberry32 } from "./engine";

/** Days of lunar surface per generated chunk. */
export const MOON_CHUNK_LEN = 140;

export type MoonChunk = {
  /** Ground height as a 0..1 profile · component maps to canvas y. */
  norm: number[];
  /** Moon-rock hazard height in px (0 = none). */
  spike: number[];
  /** Sat-orb present on this day. */
  orb: boolean[];
};

/**
 * Build lunar chunk `chunk` for daily seed `seed`. Deterministic:
 * (seed, chunk) fully determine the output.
 */
export function buildMoonChunk(seed: number, chunk: number): MoonChunk {
  const rng = mulberry32((seed ^ Math.imul(chunk + 1, 0x9e3779b1)) >>> 0);
  const len = MOON_CHUNK_LEN;
  const norm = new Array<number>(len);
  const spike = new Array<number>(len).fill(0);
  const orb = new Array<boolean>(len).fill(false);

  // Rocks get denser and taller the deeper into the moon you go.
  const spikeProb = Math.min(0.34, 0.12 + chunk * 0.035);
  const spikeH = Math.min(70, 30 + chunk * 4);
  // Min spacing so a rock is always jumpable at speed · never a wall.
  let sinceSpike = 4;
  let sinceOrb = 0;

  for (let d = 0; d < len; d++) {
    const abs = chunk * len + d;
    // Gentle rolling plain · two slow sines + a little grain, tight band
    // so appended chunks join without a cliff.
    const roll = Math.sin(abs * 0.08) * 0.05 + Math.sin(abs * 0.021) * 0.03;
    let n = 0.5 + roll + (rng() - 0.5) * 0.03;
    if (n < 0.42) n = 0.42;
    if (n > 0.6) n = 0.6;
    norm[d] = n;

    sinceSpike++;
    sinceOrb++;
    if (sinceSpike >= 4 && rng() < spikeProb) {
      spike[d] = spikeH * (0.8 + rng() * 0.4);
      sinceSpike = 0;
    } else if (sinceOrb >= 3 && rng() < 0.16) {
      orb[d] = true;
      sinceOrb = 0;
    }
  }
  return { norm, spike, orb };
}
