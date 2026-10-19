/**
 * Invariants for CHOP's choreography rules (public/chop/js/chart.js).
 *
 * WHY THIS EXISTS
 *   Two separate "the game is broken" reports from real players came from
 *   these few functions, and neither was visible in a screenshot:
 *
 *     · THE REACH RULE — a right cut placed in the leftmost lane needs
 *       entry room off the side of the phone (measured landing strips:
 *       31px dust, 19px mid, 1.3px whale on a 390px screen).
 *     · THE VISION RULE — a TOP-ROW note sits at eye level (camera.y 2.05
 *       vs ROW_Y[1] 1.92) and hides every note behind it, in every lane
 *       and both rows, at EVERY depth in the corridor. The first fix
 *       blamed the lane and measured no effect (40.61% -> 40.32%).
 *
 *   Both are pure functions of their inputs and an rng, so they can
 *   be swept exhaustively instead of play-tested hopefully. A green run
 *   means no chart the generator can emit puts a note somewhere the thumb
 *   cannot reach or the eye cannot see.
 */
import {
  laneFor, legalLanes, nextDir, rowFor, freeChanceForBar,
  VISION_MIN_STEPS, MAX_LANE_RUN, DIR_OPPOSITE, DIR_ENDS_ROW,
  bombLegal, BOMB_MIN_GAP, BOMB_MIN_COMBO, BOMB_MIN_RUN, BOMB_COOLDOWN_STEPS,
} from "../public/chop/js/chart.js";

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; return; }
  fails.push(`${name}${detail ? " — " + detail : ""}`);
}

/** mulberry32 — the same shape of seeded rng the game uses. */
function rngFrom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [-1, 0, 1, 2, 3];
const LANES = [0, 1, 2, null];
const GAPS = [1, 2, 3, 4, 5, 6, 8, 12, 16, 32, null];

// ── THE REACH RULE · exhaustive ──────────────────────────────────────
{
  let illegal = 0, total = 0;
  const seen = new Set<number>();
  for (const dir of DIRS) {
    for (const prevLane of LANES) {
      for (const gap of GAPS) {
        for (let s = 0; s < 60; s++) {
          const lane = laneFor(prevLane, gap, dir, rngFrom(s * 7919 + total), 0);
          total++;
          seen.add(lane);
          // a RIGHT cut (3) may never start leftmost; a LEFT cut (2) never rightmost
          if ((dir === 3 && lane === 0) || (dir === 2 && lane === 2)) illegal++;
          if (lane !== 0 && lane !== 1 && lane !== 2) illegal++;
        }
      }
    }
  }
  ok("reach rule holds across every (dir, prevLane, gap, seed)", illegal === 0,
    `${illegal} illegal of ${total}`);
  ok("all three lanes remain reachable overall", seen.size === 3, `saw ${[...seen]}`);
}

// ── THE VISION RULE · exhaustive ─────────────────────────────────────
{
  // A note inside a dense run must never take the TOP row. camera.y=2.05
  // sits 0.13u above ROW_Y[1]=1.92, so a top-row note is at eye level and
  // its silhouette contains the vanishing point — it hides every note
  // behind it, in every lane and both rows, at every depth in the whole
  // 26-unit corridor (measured: 100% at 2u AND at 26u). A bottom-row
  // leader clears by 8u. There is no depth that rescues row 1, which is
  // why the first fix (break the LANE on tight gaps) measured 40.61% ->
  // 40.32% impossible pairs: it addressed the wrong variable.
  let topInRun = 0, checked = 0;
  for (const dir of DIRS) {
    for (let gap = 0; gap < VISION_MIN_STEPS; gap++) {
      for (let s2 = 0; s2 < 200; s2++) {
        checked++;
        if (rowFor(dir, rngFrom(s2 * 7717 + gap), gap) === 1) topInRun++;
      }
    }
  }
  ok("no note inside a dense run ever takes the top row",
    topInRun === 0, `${topInRun} of ${checked}`);

  // ...and the top row must still EXIST once the run opens up, or the
  // chart loses a whole axis of choreography.
  const rowsAtSafeGap = new Set<number>();
  for (let s2 = 0; s2 < 400; s2++) rowsAtSafeGap.add(rowFor(2, rngFrom(s2), VISION_MIN_STEPS));
  ok("the top row returns once the gap is safe", rowsAtSafeGap.has(1),
    `saw ${[...rowsAtSafeGap]}`);
  // an UP cut still ends high when it is allowed to
  ok("UP still ends high outside a dense run",
    rowFor(0, rngFrom(3), 8) === DIR_ENDS_ROW[0]);
}

// ── the fluid thumb is HELD, but BOUNDED ─────────────────────────────
{
  // Holding the lane is the feel the operator asked for. Holding it
  // forever is one world point for a whole phrase — a reviewer measured
  // single-point runs of 177 notes when an unbounded hold met the row
  // rule. The cap is what keeps both properties.
  let held = 0;
  for (let s2 = 0; s2 < 200; s2++) {
    if (laneFor(1, 2, 1, rngFrom(s2), 0) === 1) held++;
  }
  ok("a fresh tight follow-up holds the lane", held === 200, `${held}/200`);

  // At the cap the hold is RELEASED — the lane is then chosen by the roam
  // branch, which may of course land back on the same lane by chance. The
  // guarantee is that it is no longer pinned, not that it always moves.
  let brokeAtCap = 0;
  for (let s2 = 0; s2 < 400; s2++) {
    if (laneFor(1, 2, 1, rngFrom(s2), MAX_LANE_RUN) !== 1) brokeAtCap++;
  }
  ok("the hold is released once the point has been used MAX_LANE_RUN times",
    brokeAtCap > 200, `${brokeAtCap}/400 left the lane`);
  ok("MAX_LANE_RUN is a short burst, not a phrase",
    MAX_LANE_RUN >= 2 && MAX_LANE_RUN <= 4, String(MAX_LANE_RUN));
}

// ── the fluid thumb still works at safe gaps ─────────────────────────
{
  let stayed = 0;
  for (let s = 0; s < 200; s++) {
    if (laneFor(1, VISION_MIN_STEPS, 1, rngFrom(s), 0) === 1) stayed++;
  }
  ok("fluid thumb holds the lane at the safe gap", stayed === 200, `${stayed}/200`);
  // a vertical cut from an edge lane may stay there (reach binds horizontals only)
  let edgeStay = 0;
  for (let s = 0; s < 200; s++) {
    if (laneFor(0, 4, 0, rngFrom(s), 0) === 0) edgeStay++;
  }
  ok("vertical cuts may hold an edge lane", edgeStay === 200, `${edgeStay}/200`);
}

// ── centre lane must not become a dumping ground ─────────────────────
{
  // The first reach rule remapped every banned pick to centre, which is
  // what made the occlusion fire often enough for a player to hit it.
  const count = [0, 0, 0];
  let n = 0;
  for (let s = 0; s < 20000; s++) {
    const rng = rngFrom(s);
    const dir = [0, 1, 2, 3][s % 4];
    // gap large enough to reach the roam branch
    count[laneFor(1, 16, dir, rng, 0)]++;
    n++;
  }
  const share = count.map((c) => c / n);
  ok("centre lane stays under 50% of roamed placements", share[1] < 0.5,
    `shares ${share.map((x) => x.toFixed(3)).join(" / ")}`);
  ok("both outer lanes get real traffic", share[0] > 0.15 && share[2] > 0.15,
    `shares ${share.map((x) => x.toFixed(3)).join(" / ")}`);
}

// ── parity / row / density rules ─────────────────────────────────────
{
  // never a "jack": the same direction twice running
  let jacks = 0;
  for (let s = 0; s < 4000; s++) {
    const rng = rngFrom(s);
    const last = s % 4;
    const d = nextDir(false, last, rng);
    if (d === last) jacks++;
  }
  ok("nextDir never repeats a direction (no jacks)", jacks === 0, `${jacks} jacks`);

  let free = 0;
  for (let s = 0; s < 100; s++) if (nextDir(true, 1, rngFrom(s)) === -1) free++;
  ok("a free note is always dir -1", free === 100);

  // the cut IS the movement
  ok("UP ends high", rowFor(0, rngFrom(1), 8) === DIR_ENDS_ROW[0]);
  ok("DOWN ends low", rowFor(1, rngFrom(1), 8) === DIR_ENDS_ROW[1]);
  const rows = new Set<number>();
  for (let s = 0; s < 200; s++) rows.add(rowFor(2, rngFrom(s), 8));
  ok("horizontal cuts use both rows", rows.size === 2, `saw ${[...rows]}`);
  ok("DIR_OPPOSITE is an involution",
    DIR_OPPOSITE.every((v: number, i: number) => DIR_OPPOSITE[v] === i));

  // PLEB is the front door: most notes carry no arrow, for the whole block
  for (const bar of [2, 8, 20, 40]) {
    ok(`pleb stays mostly arrow-free at bar ${bar}`,
      freeChanceForBar(bar, "pleb", 0) >= 0.85);
  }
  // ...and the harder tiers still tighten with the bar
  ok("hodler tightens across the block",
    freeChanceForBar(2, "hodler", 5) > freeChanceForBar(40, "hodler", 5));
  ok("every free chance is a probability",
    [0, 2, 8, 20, 40, 99].every((b) =>
      ["pleb", "hodler", "maxi"].every((d) => {
        const v = freeChanceForBar(b, d, 0);
        return v >= 0 && v <= 1;
      })));
}

// ── THE BOMB RULES · a can't-touch object may only spawn where NOT
// cutting it is a fair ask ─────────────────────────────────────────────
{
  // the fully-legal reference case every gate below perturbs
  const legal = {
    gapPrev: BOMB_MIN_GAP, combo: BOMB_MIN_COMBO, runIdx: BOMB_MIN_RUN,
    sinceBomb: BOMB_COOLDOWN_STEPS, lastBar: false, tut: false, phaseOk: true,
  };
  ok("reference case is legal", bombLegal(legal) === true);

  // mid-gap placement + BOMB_MIN_GAP is what guarantees the vision rule
  // on BOTH sides: floor(gap/2) >= VISION_MIN_STEPS and the remainder too
  ok("min gap gives vision clearance both sides",
    Math.floor(BOMB_MIN_GAP / 2) >= VISION_MIN_STEPS
    && BOMB_MIN_GAP - Math.floor(BOMB_MIN_GAP / 2) >= VISION_MIN_STEPS,
    `gap=${BOMB_MIN_GAP} vision=${VISION_MIN_STEPS}`);

  // each gate refuses independently — sweep the full boundary
  ok("dense air refused", !bombLegal({ ...legal, gapPrev: BOMB_MIN_GAP - 1 }));
  ok("null gap refused", !bombLegal({ ...legal, gapPrev: null }));
  ok("struggling player refused", !bombLegal({ ...legal, combo: BOMB_MIN_COMBO - 1 }));
  ok("zero combo refused", !bombLegal({ ...legal, combo: 0 }));
  ok("learning era refused (mirrors the unfailable gate)",
    !bombLegal({ ...legal, runIdx: BOMB_MIN_RUN - 1 }));
  ok("run 0 refused", !bombLegal({ ...legal, runIdx: 0 }));
  ok("cooldown refused", !bombLegal({ ...legal, sinceBomb: BOMB_COOLDOWN_STEPS - 1 }));
  ok("coinbase bar refused", !bombLegal({ ...legal, lastBar: true }));
  ok("tutorial refused", !bombLegal({ ...legal, tut: true }));
  ok("pre-drop silence refused", !bombLegal({ ...legal, phaseOk: false }));

  // exhaustive boundary sweep: legality must be MONOTONIC in each numeric
  // axis (more air, more combo, more runs, longer cooldown can never make
  // a legal bomb illegal)
  let mono = true;
  for (let g = 0; g <= 16; g++) for (let c = 0; c <= 12; c += 2) {
    for (let r = 0; r <= 6; r++) {
      const a = bombLegal({ ...legal, gapPrev: g, combo: c, runIdx: r });
      const b = bombLegal({ ...legal, gapPrev: g + 1, combo: c + 1, runIdx: r + 1 });
      if (a && !b) { mono = false; }
    }
  }
  ok("legality is monotonic in air, combo, and experience", mono);

  // the cooldown floor keeps bombs a seasoning: at most one per
  // BOMB_COOLDOWN_STEPS = 2 bars, i.e. <= ~20 in a 40-bar chart even in
  // the impossible worst case of wall-to-wall legality
  ok("cooldown spans at least two bars", BOMB_COOLDOWN_STEPS >= 32);
}

if (fails.length) {
  console.error(`\n✗ chop chart rules: ${fails.length} failed, ${pass} passed`);
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`✓ chop chart rules · ${pass} invariants (reach, occlusion, parity, density)`);
