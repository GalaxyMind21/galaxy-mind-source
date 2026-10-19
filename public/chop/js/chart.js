// CHOP · chart.js — the choreography rules, as pure functions.
//
// WHY THESE LIVE OUTSIDE main.js
//   Two separate player-reported "the game is broken" bugs have now come
//   from this handful of decisions, and neither was visible in a
//   screenshot or catchable by the binding guard:
//
//     · THE REACH RULE (2026-07-31, found by a nine-year-old): a right
//       cut placed in the leftmost lane needs entry room off the side of
//       the phone. Measured strips: 31px dust, 19px mid, 1.3px whale.
//     · THE OCCLUSION RULE (2026-07-31, operator): a follower in the same
//       lane as an armed note is 100% hidden at EVERY depth, so the
//       player's entire reaction window is the gap between the two notes.
//
//   Both are pure functions of (previous lane, gap, direction, rng). Pure
//   functions belong where they can be exhaustively tested, so they moved
//   here and scripts/test-chop-chart.ts sweeps them in `npm run verify`.
//   main.js imports them; there is no second copy.
//
// NO DOM, NO THREE, NO GLOBALS. `rng` is passed in so the caller keeps
// owning determinism (the chart is seeded from the block hash).

// dir: 0 = UP, 1 = DOWN, 2 = LEFT, 3 = RIGHT
export const DIR_VEC = [[0, 1], [0, -1], [-1, 0], [1, 0]];
export const DIR_OPPOSITE = [1, 0, 3, 2];
// "the cut IS the movement": a DOWN cut leaves the thumb low, so the
// next note belongs in the bottom row.
export const DIR_ENDS_ROW = [1, 0, -1, -1]; // UP ends high, DOWN ends low

// ── THE REACH RULE ───────────────────────────────────────────────────
// An inward horizontal cut needs entry room OUTSIDE the note, and in an
// edge lane that room is off the side of the phone. The visible half-width
// at the strike plane is 1.495 world units and the outer lanes sit at
// ±0.88, so the strip a finger must LAND in to swipe rightward through a
// far-left note is 0.240u ≈ 31px (dust), 0.147u ≈ 19px (mid), 0.010u ≈
// 1.3px (whale) on a 390px phone — against the bezel, where the OS keeps
// its own edge gestures, and the stroke must already be at
// SWIPE_MIN_SPEED when it arrives. So the cut chooses its lane.
export const LEGAL_RIGHT = [1, 2];  // a right cut needs room to its LEFT
export const LEGAL_LEFT = [0, 1];   // a left cut needs room to its RIGHT
export const LEGAL_ALL = [0, 1, 2];

/** Lanes a cut may legally START in. */
export function legalLanes(dir) {
  if (dir === 3) return LEGAL_RIGHT;
  if (dir === 2) return LEGAL_LEFT;
  return LEGAL_ALL;
}

// ── THE VISION RULE · the TOP ROW is an infinite occluder ────────────
// Operator, real play 2026-07-31: "the middle closest block obfuscates the
// view of the next middle blocks and a human can't respond quickly enough
// to see the next block."
//
// The reported symptom is real. The mechanism is NOT the lane, which is
// where the first fix went and why it did not work. It is the ROW.
//
// `camera.y = 2.05` sits 0.13 world units above `ROW_Y[1] = 1.92`, so a
// top-row note is at EYE LEVEL. Over the full 26-unit approach a
// bottom-row note travels 105px up the screen; a top-row note travels
// 14px. A near top-row silhouette therefore contains the vanishing point,
// and everything behind it — every lane, both rows — projects inside it.
//
//   % of a follower hidden, by the LEADER's row (same lane, mid follower)
//     depth behind leader:   2u    5u    8u   14u   26u
//     leader in row 0:      90%   44%    0%    0%    0%
//     leader in row 1:     100%  100%  100%  100%  100%
//
// A bottom-row leader clears by 8 units. A top-row leader never clears,
// anywhere in the corridor. No depth threshold can rescue it, which is why
// the first attempt (break the LANE when the gap is tight) measured
// 40.61% -> 40.32% impossible pairs: no effect, while driving lane changes
// from 5.6% to 82.6% and destroying the fluid-thumb feel players had
// specifically asked for. That rule is gone.
//
// Also measured and rejected: moving the camera off the centre axis (needs
// x~0.9 to de-occlude; outer lanes crop from x~0.3), and raising the
// camera rake (fixes row1->row1 but makes row1->row0 100% out to z=-12 —
// it relocates the bug rather than removing it).
//
// So: the top row is legal only for a note the player will have CUT before
// the next one needs reading. This is convergent with Beat Saber's own
// mapping guidance — top/face notes belong "at the very end of a pattern
// so there is a calm spot after it" — which is a good sign for a rule
// derived independently from projection maths.
//
// Trigger uses the gap BEHIND the note, not ahead. A forward gap would be
// more exact but needs a next-bar lookahead, and `onsetsForBar` consumes
// rng — calling it early desyncs the whole seeded chart. Density is
// locally uniform (a tier defines one onset grid per bar), so the
// backward gap is an excellent proxy, and it measured best of every
// candidate: 39.5% -> 5.3% impossible pairs at HODLER run 12.
export const VISION_MIN_STEPS = 4;

// Bounded fluid thumb. Holding the lane is the feel the operator reported
// wanting; holding it forever is one world point for a whole phrase (a
// reviewer measured single-point runs of 177 notes when the row rule and
// an unbounded hold were combined). Three in place, then move on.
export const MAX_LANE_RUN = 3;

/**
 * Choose the lane for the next note.
 *   1. fluid thumb, capped — a quick follow-up stays put for a short burst
 *   2. roam, spread across whatever the reach rule leaves legal
 *
 * `runLen` is how many notes have already landed on the current point.
 */
export function laneFor(prevLane, gapSteps, dir, rng, runLen) {
  const legal = legalLanes(dir);
  const pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
  // 1. FLUID THUMB (operator, live play 2026-07-28): players keep the
  //    finger ON the glass and swipe back and forth, so a quick follow-up
  //    STAYS in the previous lane and a left→right cut flows into a
  //    right→left cut in place.
  if (gapSteps != null && gapSteps <= 4 && prevLane != null
      && legal.includes(prevLane) && (runLen || 0) < MAX_LANE_RUN) {
    return prevLane;
  }
  // 2. Roam. Vision-block rule: avoid parking in the centre lane.
  const r = rng();
  const pref = r < 0.38 ? 0 : r < 0.76 ? 2 : 1;
  if (legal.includes(pref)) return pref;
  // Reach-banned: SPREAD across the remaining legal lanes rather than
  // always dumping into centre. The first reach rule remapped every banned
  // pick to lane 1, which took centre-lane share to 84% and is why the
  // occlusion above was perceived as a centre-lane problem.
  return pick(legal);
}

/**
 * Parity: prefer the 180° reversal (free thumb motion), never repeat a
 * direction twice in a row (a "jack").
 */
export function nextDir(free, lastDir, rng) {
  if (free) return -1;
  if (lastDir == null || lastDir < 0) return 1; // first note: DOWN
  const rev = DIR_OPPOSITE[lastDir];
  if (rng() < 0.8) return rev;                  // 80% reverse (flow)
  return lastDir < 2 ? (rng() < 0.5 ? 2 : 3) : (rng() < 0.5 ? 0 : 1);
}

/**
 * "the cut IS the movement" — an UP cut ends high, DOWN ends low — EXCEPT
 * where the vision rule overrides it.
 *
 * `gapPrev` is the gap in 16th-steps to the previous note. Inside the
 * vision window this note is part of a dense run, so another note is
 * behind it needing to be read, and the top row would black that note out
 * completely (see THE VISION RULE above). The movement idiom yields to
 * being able to see, because an UP cut that ends low is a style loss and
 * an unreadable note is an unplayable one.
 *
 * Measured cost: top-row share falls 50% -> 9.7% at max density. The
 * survivors are the phrase-ending notes, which is exactly where Beat
 * Saber puts its own top-row notes.
 */
export function rowFor(dir, rng, gapPrev) {
  if (gapPrev != null && gapPrev < VISION_MIN_STEPS) return 0;
  if (dir >= 0 && DIR_ENDS_ROW[dir] >= 0) return DIR_ENDS_ROW[dir];
  return rng() < 0.5 ? 0 : 1;
}

// ── BOMBS · the can't-touch object ───────────────────────────────────
// Fruit Ninja's one law of flailing: a single object you must NOT cut
// converts wild swiping into aiming, and every safe cut feels skilled by
// contrast. CHOP's fiction: the teal cube is a DOUBLE SPEND drifting
// through the mempool — cut it into your block and your chain breaks.
//
// The house rule (main.js file header, written before bombs existed) is
// the spec: bombs only after the player has a combo, cost = combo break,
// NEVER run death — a bomb does not touch BLOCK INTEGRITY. Don't "fix"
// that into damage; inhibition is the skill being tested, not health.
//
// Placement is the dangerous part, so it lives here with the other
// choreography rules and gets swept:
//   · SPARSE AIR ONLY (>= BOMB_MIN_GAP sixteenths to BOTH neighbours —
//     the caller places the bomb mid-gap, so one bound covers both).
//     A bomb inside a dense run is unreadable under the vision rule and
//     uncuttable-around under the fluid thumb.
//   · Row 0 only (caller contract): a top-row bomb at eye level would
//     occlude the queue behind it exactly like any top-row note.
//   · Only at combo >= BOMB_MIN_COMBO — bombs meet players in flow,
//     never players who are struggling.
//   · Never in the unfailable learning era (runIdx < BOMB_MIN_RUN, the
//     same gate the integrity system uses).
//   · Cooldown between bombs, never on the coinbase bar, never during
//     the tutorial, and never in a build/breakdown bar (the pre-drop
//     silence is a designed wait — baiting a cut there is a betrayal,
//     not a challenge; the caller passes phaseOk for this).
export const BOMB_MIN_GAP = 8;
export const BOMB_MIN_COMBO = 8;
export const BOMB_MIN_RUN = 3;
export const BOMB_COOLDOWN_STEPS = 32;

/** May a bomb legally spawn in this gap? Pure — the CHANCE stays with
 *  the caller's rng so this can be swept exhaustively. */
export function bombLegal({ gapPrev, combo, runIdx, sinceBomb, lastBar, tut, phaseOk }) {
  if (tut) return false;
  if (phaseOk === false) return false;
  if (lastBar) return false;
  if ((runIdx || 0) < BOMB_MIN_RUN) return false;
  if ((combo || 0) < BOMB_MIN_COMBO) return false;
  if (gapPrev == null || gapPrev < BOMB_MIN_GAP) return false;
  if (sinceBomb != null && sinceBomb < BOMB_COOLDOWN_STEPS) return false;
  return true;
}

/**
 * How often a note carries NO arrow. Density is one difficulty axis;
 * direction recall is the other.
 *
 * PLEB IS THE FRONT DOOR and its only job is that people come back
 * (operator playtest, on a nine-year-old: "let's make most of the boxes
 * non-arrow boxes. If it's too hard they won't come back"). At 0.85 the
 * arrow is an occasional spice rather than a gate on the whole ride.
 */
export function freeChanceForBar(bar, diffKey, runIdx) {
  if (diffKey === "pleb") return bar < 2 ? 1 : 0.85;
  const newbie = runIdx < 2;
  if (bar < 2) return 1;                    // nothing can be wrong yet
  if (bar < 6) return newbie ? 0.75 : 0.5;
  if (bar < 12) return newbie ? 0.45 : 0.2;
  if (bar < 24) return newbie ? 0.25 : 0.08;
  return newbie ? 0.15 : 0.05;
}
