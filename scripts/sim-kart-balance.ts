// BITCOIN KART · roster balance gate (2026-07-16 buff-only rebalance).
//
// Headless, deterministic lap-time sim over the game's REAL physics + AI:
// every roster driver runs the same synthetic circuit solo, through the
// game's own aiInput with the personality terms zeroed (skill pinned to 1
// kills the wobble; player=null kills the rubber-band), no items, no
// collisions, neutral surface so no signature perk fires. What's left is
// pure stats — exactly the thing the rebalance tunes.
//
// Gate: every UNLOCKED driver's 3-lap race time within BAND_PCT of the
// unlocked-roster median. Satoshi (locked reward pick) is reported but not
// gated. Run: npx tsx scripts/sim-kart-balance.ts   (wired into verify)

import { ROSTER } from "../public/bitcoin-kart/js/data.js";
import { makeKart, stepKart } from "../public/bitcoin-kart/js/physics.js";
import { aiInput } from "../public/bitcoin-kart/js/ai.js";
import { catmullRom } from "../public/bitcoin-kart/js/math3d.js";

const BAND_PCT = 2.5;
const LAPS = 3;
const DT = 1 / 120;
const MAX_SIM_S = 300;
// INFORMATIONAL ceiling only — generous, catches a catastrophic steering
// regression (AI forgets walls exist), never used for tuning: the sim's
// centerline controller overstates wall contact vs the real game's
// racing line, so real wall-behavior verification happens in real Chrome.
const WALL_HIT_CEILING = 600;

let pass = 0;
let fail = 0;
function ok(cond: unknown, msg: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error("  ✗ " + msg);
  }
}

// ---------------------------------------------------------------------------
// Synthetic circuit · flat closed loop with the corner vocabulary of the real
// tracks: a long straight (top speed), sweepers (drift), a hairpin (accel out
// of a stop), and a chicane (handling). Satisfies the surfaceQuery contract
// (S.pos/right/tan/cum/total) that stepKart + aiInput consume.
// ---------------------------------------------------------------------------

// Layout rule: every pair of NON-CONSECUTIVE road sections must sit farther
// apart than 2×wallLimit, or the lateral wall clamp is porous there (a kart
// blowing a corner snaps to the far section's samples and shortcuts the
// track — that bug produced a fake -25% "balance win" for heavy karts in
// the first draft of this harness). Asserted below, not assumed.
//
// TWO profiles because the track set IS the meta: a corner-heavy circuit
// rewards handling, a speedway rewards top speed. Gating on the mean of
// both mirrors "competitive across the cup season" instead of quietly
// retuning the roster toward one profile.
const TWISTY: number[][] = [
  // left straight, climbing +z (loop closes INTO this from corner 4 · the
  // first point is mid-straight so the wrap seam is dead straight)
  [0, 0, 40], [0, 0, 130], [0, 0, 220], [0, 0, 260],
  // corner 1 · 90° sweeper right
  [14, 0, 300], [54, 0, 322],
  // top straight with a chicane wiggle mid-way
  [114, 0, 322], [154, 0, 296], [194, 0, 322], [254, 0, 322],
  // corner 2 into the right side
  [298, 0, 306], [318, 0, 264], [318, 0, 186],
  // wide hairpin poking OUTWARD (legs ~50m apart, clear of the straight)
  [344, 0, 132], [376, 0, 102], [340, 0, 72], [318, 0, 52],
  // corner 3 to the bottom straight
  [300, 0, 10], [258, 0, -10], [176, 0, -10], [96, 0, -10],
  // corner 4 · wide return up to the start
  [38, 0, -4], [8, 0, 16],
];

const SPEEDWAY: number[][] = [
  // long left straight
  [0, 0, 0], [0, 0, 120], [0, 0, 240], [0, 0, 340],
  // wide top sweeper
  [26, 0, 420], [110, 0, 452], [210, 0, 452], [294, 0, 424],
  // right straight down, one gentle kink
  [330, 0, 344], [318, 0, 240], [330, 0, 136],
  // wide bottom sweeper home
  [300, 0, 42], [214, 0, 6], [110, 0, 6], [28, 0, 36],
];

function buildSyntheticTrack(CONTROL: number[][]) {
  const pos: number[][] = [];
  const STEP_T = 0.05; // samples per control segment → ~1.5-2m spacing
  const m = CONTROL.length;
  for (let i = 0; i < m; i++) {
    const p0 = CONTROL[(i - 1 + m) % m];
    const p1 = CONTROL[i];
    const p2 = CONTROL[(i + 1) % m];
    const p3 = CONTROL[(i + 2) % m];
    for (let t = 0; t < 1 - 1e-9; t += STEP_T) {
      pos.push(catmullRom(p0, p1, p2, p3, t));
    }
  }
  const n = pos.length;
  const tan: number[][] = [];
  const right: number[][] = [];
  const cum: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = pos[(i - 1 + n) % n];
    const b = pos[(i + 1) % n];
    const tx = b[0] - a[0], tz = b[2] - a[2];
    const tl = Math.hypot(tx, tz) || 1;
    tan.push([tx / tl, 0, tz / tl]);
    right.push([tz / tl, 0, -tx / tl]);
  }
  for (let i = 0; i < n; i++) {
    cum.push(total);
    const b = pos[(i + 1) % n];
    total += Math.hypot(b[0] - pos[i][0], b[2] - pos[i][2]);
  }
  const hw = 7.5;
  const wallLimit = hw + 1.4;
  // Largest LEGIT single-step dist flip: two samples that are locally near
  // in space (a kart at the inner apex can be inside wall reach of both)
  // but separated in arc. Anything beyond this bound is a teleport.
  let legitFlip = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 3; j < n; j++) {
      const idxGap = Math.min(j - i, n - (j - i));
      if (idxGap < 3 || idxGap >= 30) continue;
      const dx = pos[i][0] - pos[j][0], dz = pos[i][2] - pos[j][2];
      if (Math.hypot(dx, dz) < 2 * wallLimit) {
        const arc = Math.min(Math.abs(cum[j] - cum[i]), total - Math.abs(cum[j] - cum[i]));
        legitFlip = Math.max(legitFlip, arc);
      }
    }
  }
  return {
    S: { n, pos, tan, right, cum, total },
    hw,
    wallLimit,
    jumpLimit: legitFlip + 2,
    surface: "asphalt", // in no driver's surfaceImmune list
    gripMult: 1,
    def: { world: "neutral" }, // corporateGrip never fires
    hazardOpen: () => false,
    obstacles: [] as { x: number; z: number; r: number }[],
    // centerline · identical for everyone. Deliberately NOT a synthetic
    // racing line: the ±2.5% balance band was certified on this
    // controller, and a 2026-07-16 experiment showed a naive apex-offset
    // line distorts BOTH the band and the wall telemetry. Real-game wall
    // behavior is measured in real Chrome (real tracks, real aiLine),
    // not here.
    aiLine: new Array(n).fill(0),
  };
}

// ---------------------------------------------------------------------------
// One deterministic solo run → 3-lap race time (standing start, like a race)
// ---------------------------------------------------------------------------

type RunResult = { time: number; maxJump: number; lap: number; timedOut: boolean; wallHits: number };

function raceTime(track: ReturnType<typeof buildSyntheticTrack>, driver: any): RunResult {
  // one identical controller for all drivers: pin the personality knobs
  const neutral = { ...driver, ai: { skill: 1, aggr: 0, boostHappy: 0 } };
  // LAP CONTRACT (physics.js): spawn just before the line so the first
  // forward wrap takes lap 0 → 1 and lap > LAPS means LAPS full circuits.
  const S = track.S;
  let si = 0;
  for (let i = 0; i < S.n; i++) if (S.cum[i] > S.total - 9) { si = i; break; }
  const p = S.pos[si];
  const heading = Math.atan2(S.tan[si][0], S.tan[si][2]);
  const k = makeKart(neutral, { x: p[0], y: p[1], z: p[2], heading }, false, 1);
  k.sIdx = si;
  k.aiT = 0;      // Math.random cosmetic phase → pinned for determinism
  k.itemCd = 1e9; // items never considered
  const noItems = { ents: [] };
  // fx callback bus doubles as telemetry: wall hits are the AI-driving
  // quality metric (operator complaint 2026-07-16: "AI crashes into
  // walls too much") · gated below against a fleet ceiling
  let wallHits = 0;
  const fx = {
    hop: () => {}, land: () => {}, miniTurbo: () => {}, chargeTier: () => {},
    wallHit: () => { wallHits++; }, bump: () => {}, bigAir: () => {},
    fallStart: () => {}, rescued: () => {},
  };
  let t = 0;
  let maxJump = 0;
  while (t < MAX_SIM_S) {
    const input = aiInput(k, track, [k], noItems, null, DT, false);
    // Player-proxy drift discipline: bank the tier-2 turbo and re-enter,
    // like a competent player. The raw AI holds a drift for as long as the
    // curvature lasts, which on long sweepers is a bistable limit cycle
    // where lap time flips ~30% on a ONE-point accel change — a knife-edge
    // no balance gate can sit on. Uniform for every driver.
    if (k.drift.active && k.drift.tier === 2 && k.drift.charge > 2.2) input.drift = false;
    const prev = k.dist;
    stepKart(k, input, track, DT, fx);
    // forward teleports mean the kart crossed between overlapping road
    // sections (porous walls) · that's a broken TRACK, not a fast driver
    const step = k.dist - prev;
    if (t > DT && step > 0 && step < track.S.total * 0.5) maxJump = Math.max(maxJump, step);
    t += DT;
    if (k.lap > LAPS) return { time: t, maxJump, lap: k.lap, timedOut: false, wallHits };
  }
  return { time: NaN, maxJump, lap: k.lap, timedOut: true, wallHits };
}

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · balance sim (" + LAPS + " laps · band ±" + BAND_PCT + "% of unlocked median)");

// Weight must stay a collision-only stat: a weight-scaled drag "momentum
// buff" was prototyped and REVERTED (it made heavies SLOWER — post-boost
// overspeed degrades steering into corners). Guard against re-adding it.
{
  const mk = (weight: number) =>
    makeKart({ stats: { speed: 7, accel: 6, handling: 6, weight, itemLuck: 5 }, ai: {}, sig: {} },
      { x: 0, y: 0, z: 0, heading: 0 }, false, 1);
  ok((mk(10) as any).momentum === undefined, "no weight-scaled drag sneaks back into makeKart");
  ok(Math.abs(mk(10).mass - 2.1) < 1e-9, "weight 10 still buys collision mass 2.1");
}

function auditTrack(name: string, track: ReturnType<typeof buildSyntheticTrack>) {
  ok(track.S.total > 400, name + " is race-length (" + track.S.total.toFixed(0) + "m)");
  // wall-porosity: non-local sample pairs must clear 2×wallLimit, else the
  // lateral clamp has holes and lap times measure corner-cutting luck
  const S = track.S;
  const minSep = 2 * track.wallLimit + 2;
  let worst = Infinity;
  for (let i = 0; i < S.n; i++) {
    for (let j = i + 1; j < S.n; j++) {
      const idxGap = Math.min(j - i, S.n - (j - i)); // ring distance
      if (idxGap < 30) continue; // locally consecutive road, not a crossing
      const dx = S.pos[i][0] - S.pos[j][0], dz = S.pos[i][2] - S.pos[j][2];
      worst = Math.min(worst, Math.hypot(dx, dz));
    }
  }
  ok(worst >= minSep, name + " has no porous walls: non-local gap " + worst.toFixed(1) + "m ≥ " + minSep.toFixed(1) + "m");
}

const tracks = [
  { name: "twisty", track: buildSyntheticTrack(TWISTY) },
  { name: "speedway", track: buildSyntheticTrack(SPEEDWAY) },
];
for (const t of tracks) auditTrack(t.name, t.track);

// AI driving-quality telemetry (2026-07-16 wall-crash fix): total wall
// hits across the fleet over both circuits, gated so a steering
// regression fails loudly instead of shipping as "the AI feels drunk"
let fleetWallHits = 0;
const wallByDriver = new Map<string, number>();

// per-driver mean deviation across both profiles = the gated number
const perDriver = new Map<string, { unlocked: boolean; devs: number[]; times: string[] }>();
for (const { name, track } of tracks) {
  const results: { id: string; unlocked: boolean; time: number }[] = [];
  for (const d of ROSTER as any[]) {
    const r = raceTime(track, d);
    const clean = Number.isFinite(r.time) && r.maxJump <= track.jumpLimit;
    ok(clean, d.id + " finishes " + name + " clean (" +
      (r.timedOut ? "TIMEOUT at lap " + r.lap : r.time.toFixed(2) + "s") +
      " · maxJump " + r.maxJump.toFixed(2) + "m ≤ " + track.jumpLimit.toFixed(1) + "m)");
    results.push({ id: d.id, unlocked: !!d.unlocked, time: clean ? r.time : NaN });
    fleetWallHits += r.wallHits;
    wallByDriver.set(d.id, (wallByDriver.get(d.id) || 0) + r.wallHits);
  }
  const unlocked = results.filter((r) => r.unlocked && Number.isFinite(r.time)).map((r) => r.time).sort((a, b) => a - b);
  const median = unlocked.length % 2
    ? unlocked[(unlocked.length - 1) / 2]
    : (unlocked[unlocked.length / 2 - 1] + unlocked[unlocked.length / 2]) / 2;
  console.log("  · " + name + " (" + track.S.total.toFixed(0) + "m · unlocked median " + median.toFixed(2) + "s)");
  for (const r of results.slice().sort((a, b) => a.time - b.time)) {
    const dev = ((r.time - median) / median) * 100;
    console.log("    " + r.id.padEnd(9) + r.time.toFixed(2) + "s  " + (dev >= 0 ? "+" : "") + dev.toFixed(2) + "%" + (r.unlocked ? "" : "  (locked)"));
    const e = perDriver.get(r.id) || { unlocked: r.unlocked, devs: [], times: [] };
    e.devs.push(dev);
    e.times.push(name + " " + r.time.toFixed(2) + "s");
    perDriver.set(r.id, e);
  }
}

console.log("  · season mean (gated)");
for (const [id, e] of [...perDriver.entries()].sort((a, b) => (a[1].devs.reduce((x, y) => x + y, 0)) - (b[1].devs.reduce((x, y) => x + y, 0)))) {
  const mean = e.devs.reduce((x, y) => x + y, 0) / e.devs.length;
  console.log("    " + id.padEnd(9) + (mean >= 0 ? "+" : "") + mean.toFixed(2) + "%" + (e.unlocked ? "" : "  (locked · not gated)"));
  if (e.unlocked) {
    ok(Math.abs(mean) <= BAND_PCT, id + " season mean within ±" + BAND_PCT + "% (got " + mean.toFixed(2) + "%)");
  }
}

{
  const rows = [...wallByDriver.entries()].sort((a, b) => b[1] - a[1]);
  console.log("  · wall hits (both circuits · fleet " + fleetWallHits + "): " +
    rows.map(([id, n]) => id + " " + n).join(" · "));
  ok(fleetWallHits <= WALL_HIT_CEILING,
    "fleet wall hits within ceiling (" + fleetWallHits + " ≤ " + WALL_HIT_CEILING + ")");
}

// determinism: same driver, same track → byte-identical result
{
  const a = raceTime(tracks[0].track, (ROSTER as any[])[0]);
  const b = raceTime(tracks[0].track, (ROSTER as any[])[0]);
  ok(a.time === b.time, "sim is deterministic (rerun matches: " + a.time.toFixed(4) + "s)");
}

console.log(fail === 0
  ? "sim-kart-balance: " + pass + "/" + (pass + fail) + " checks hold ✓"
  : "sim-kart-balance: " + fail + " FAILED of " + (pass + fail));
if (fail > 0) process.exit(1);
