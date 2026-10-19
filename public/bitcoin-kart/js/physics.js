// BITCOIN KART · physics.js
// Arcade kart model: heading + velocity-yaw with grip lag (drift = low grip
// + controlled slide), mini-turbo tiers, boost stack, off-road surfaces with
// per-driver immunities, wall clamping, kart-vs-kart bumping.

import { clamp, TAU } from "./math3d.js";
import { surfaceQuery } from "./track.js";

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/** Chase-camera pull-in for a short viewport. Unknown or desktop
 *  (short side >= 680) stays at 1 so the existing framing is unchanged.
 *  At a 390-wide phone the kart sits closer and lower. */
export function chaseNear(shortSide) {
  const short = Number(shortSide) || 0;
  if (short <= 0 || short >= 680) return { dist: 1, eye: 1 };
  const t = Math.max(0, Math.min(1, (short - 320) / 360));
  return { dist: 0.55 + 0.45 * t, eye: 0.48 + 0.52 * t };
}

export function makeKart(driver, pose, isPlayer, speedMult) {
  const s = driver.stats;
  const mult = speedMult || 1;
  return {
    driver,
    isPlayer: !!isPlayer,
    pos: [pose.x, pose.y, pose.z],
    heading: pose.heading,
    velYaw: pose.heading,
    speed: 0,
    vy: 0,
    airborne: false,
    steer: 0,
    drift: { active: false, dir: 0, charge: 0, tier: 0 },
    boostT: 0,
    boostKind: null,
    spinT: 0,
    trapImmuneT: 0, // post-rescue grace against traps (L1)
    spinVis: 0,
    slideVis: 0, // presentational drift slide angle (K4) · drawn yaw only
    pitchVis: 0, // presentational weight-transfer pitch (K12) · drawn only
    prevSpeed: 0, // last step's speed · feeds the K12 accel read
    slipT: 0,   // rocket-start wheelspin penalty
    squash: 0,  // landing squash / hop stretch (visual)
    rimFlash: 0,
    lapStart: 0,
    exhaustAcc: 0,
    draftT: 0,  // slipstream charge while tucked behind a rival
    skidAccL: 0, // distance accumulators for skid mark quads
    skidAccR: 0,
    prevWheelL: null,
    prevWheelR: null,
    falling: false, // went over an open hazard edge
    fallFloorY: 0, // set at fallStart: rescue only fires below this height
    hopAir: false, // airborne via drift hop (eligible for lip re-launch)
    fallT: 0,
    lastSafeIdx: 0,
    prevRoadY: null,
    upSlope: 0,
    boltT: 0,
    chairT: 0,
    shield: false,
    item: null,
    roulette: 0,
    rouletteItem: null,
    sats: 0,
    lap: 1,
    sIdx: 0,
    dist: 0,
    progress: 0,
    prevDist: 0,
    rank: 8,
    finished: false,
    finishTime: 0,
    wrongWayT: 0,
    hopY: 0,
    wheelSpin: 0,
    lean: 0,
    aiT: Math.random() * 2,
    aiSteerHold: 0,
    aiStuckT: 0, // pinned-against-wall timer (ai.js unstick reflex)
    itemCd: 2 + Math.random() * 3,
    // derived stats · engine class scales the whole speed envelope
    baseSpeed: (30 + s.speed * 1.15) * mult,
    accel: (9 + s.accel * 1.35) * mult,
    steerRate: 1.55 + s.handling * 0.16,
    mass: 0.8 + s.weight * 0.13,
  };
}

// EXTREME pass 2026-07-21: ground contact where the deck is GONE. The
// rescue is re-seated just past the far edge BEFORE the fall plays out ·
// a zero-speed respawn at the old lastSafeIdx (pre-ramp) would creep
// forward into the gap forever.
function gapFall(k, track, groundY, idx, fx) {
  k.falling = true;
  k.fallT = 0;
  k.fallFloorY = groundY - 8;
  k.lastSafeIdx = (track.gapEndFor(idx) + 6) % track.S.n;
  k.drift.active = false;
  k.airborne = true; // keep the landing squash/land fx out of the plunge
  if (fx) fx.fallStart(k);
}

function surfaceImmune(driver, surface) {
  const im = driver.sig && driver.sig.surfaceImmune;
  return !!(im && im.indexOf(surface) >= 0);
}

// input: { throttle 0..1, brake bool, steer -1..1, drift bool, touchAssist? }
export function stepKart(k, input, track, dt, fx) {
  // scripted fall + rescue: sink off the open edge, then reappear at the
  // last safe stretch of road with a few sats lighter
  if (k.falling) {
    k.fallT += dt;
    k.pos[0] += Math.sin(k.velYaw) * k.speed * dt;
    k.pos[2] += Math.cos(k.velYaw) * k.speed * dt;
    k.pos[1] -= 7.5 * dt;
    k.speed = Math.max(0, k.speed - k.speed * 2.5 * dt);
    // epic-air fix 2026-07-18: a fall triggered MID-FLIGHT starts high, so
    // the rescue also waits until the kart has sunk below the fall point's
    // road (fallFloorY) · grounded falls keep the exact old 1.05s timing.
    // The 3s ceiling is a safety net, not a tunable.
    if (k.fallT > 1.05 && (k.pos[1] <= k.fallFloorY || k.fallT > 3)) {
      const S = track.S;
      const i = k.lastSafeIdx;
      k.pos = [S.pos[i][0], S.pos[i][1], S.pos[i][2]];
      k.heading = k.velYaw = Math.atan2(S.tan[i][0], S.tan[i][2]);
      k.speed = 0;
      k.vy = 0;
      k.airborne = false;
      k.falling = false;
      k.fallT = 0;
      k.spinT = 0;
      k.drift.active = false;
      k.slideVis = 0; // the re-seat must not carry the old slide angle
      k.pitchVis = 0; // nor the old pose pitch
      k.prevSpeed = 0; // speed is 0 now · a stale value would read as a
      // huge brake decel and dive the nose for the first frames back
      k.sats = Math.max(0, k.sats - 3);
      k.sIdx = i;
      // brief grace so a trap sitting under the respawn point cannot
      // instantly re-punish the rescue (L1 2026-07-14)
      k.trapImmuneT = 1.2;
      if (fx) fx.rescued(k);
    }
    return null;
  }

  if (k.finished) input = { throttle: 0.35, steer: input.steer, drift: false };

  const spinning = k.spinT > 0;
  if (spinning) {
    k.spinT -= dt;
    k.spinVis += dt * 9;
    input = { throttle: 0, steer: 0, drift: false };
  } else {
    k.spinVis = 0;
  }

  // ------- top speed -------
  let maxSpeed = k.baseSpeed + k.sats * 0.35;
  if (k.chairT > 0) maxSpeed *= 1.18;
  if (k.boltT > 0) maxSpeed *= 0.62;
  const q = surfaceQuery(track, k.pos[0], k.pos[2], k.sIdx);
  k.sIdx = q.idx;
  const offRoad = q.offRoad;
  // exposed for HUD vignette + surface audio (Tier 2)
  k.offRoad = offRoad && !k.airborne;
  if (offRoad && !surfaceImmune(k.driver, track.surface) && k.boostT <= 0) {
    let cap = 0.52;
    if (track.surface === "gold" && k.driver.sig && k.driver.sig.goldWeak) cap = 0.38;
    maxSpeed *= cap;
  }
  let target = maxSpeed * (input.throttle || 0);
  let accel = k.accel;
  if (k.boostT > 0) {
    k.boostT -= dt;
    target = maxSpeed * 1.38;
    accel *= 2.4;
  }
  if (k.slipT > 0) {
    // jumped the start: wheels spin, kart barely creeps
    k.slipT -= dt;
    target = Math.min(target, maxSpeed * 0.12);
  }

  // ------- longitudinal -------
  if (input.brake) {
    k.speed = Math.max(k.speed - 30 * dt, -8);
  } else if (k.speed < target) {
    k.speed = Math.min(k.speed + accel * dt, target);
  } else {
    // NOTE (2026-07-16 rebalance): a weight-scaled drag "momentum buff" was
    // prototyped here and REVERTED · the balance sim showed it makes heavy
    // karts SLOWER (post-boost overspeed degrades steerEff into corners).
    // Weight's payoff is collision mass; don't re-add drag scaling.
    const drag = offRoad ? 18 : 6.5;
    k.speed = Math.max(k.speed - drag * dt, target);
  }

  // ------- drift state -------
  const grip0 = (track.gripMult || 1) *
    (k.driver.sig && k.driver.sig.corporateGrip && track.def.world === "corporate" ? k.driver.sig.corporateGrip : 1);
  let grip = 8.5 * grip0;
  const steerIn = clamp(input.steer || 0, -1, 1);
  // every kart records steer so wheels + heads animate (AI included)
  k.steer = steerIn;
  // Touch drift is a different model. Keyboard, gamepad, and AI keep the
  // sharp hop: a phone thumb cannot hold the old slip angle.
  const touchDrift = !!input.touchAssist;
  const driftSteer = touchDrift ? 0.12 : 0.25;
  if (input.drift && !k.drift.active && !k.airborne && k.speed > 13 && Math.abs(steerIn) > driftSteer && !spinning) {
    k.drift.active = true;
    k.drift.dir = Math.sign(steerIn);
    k.drift.charge = 0;
    k.drift.tier = 0;
    k.vy = touchDrift ? 1.15 : 2.6; // hop
    k.airborne = true;
    k.hopAir = true; // eligible for the lip re-launch upgrade
    k.squash = touchDrift ? -0.16 : -0.28; // stretch at the top of the hop
    if (fx) fx.hop(k);
  }
  if (k.drift.active) {
    if (!input.drift || k.speed < 9) {
      // release: mini-turbo by tier
      if (k.drift.tier > 0 && fx) fx.miniTurbo(k, k.drift.tier);
      // K12: the turbo pop stretches the kart (negative squash) · visual
      // only, decays through the same squash relax below
      if (k.drift.tier > 0) k.squash = -0.18;
      if (k.drift.tier === 1) { k.boostT = Math.max(k.boostT, 0.75); k.boostKind = "mini"; }
      if (k.drift.tier === 2) { k.boostT = Math.max(k.boostT, 1.35); k.boostKind = "mini"; }
      k.drift.active = false;
      k.drift.tier = 0;
      k.drift.charge = 0;
    } else {
      grip = (touchDrift ? 4.6 : 2.3) * grip0;
      const toward = steerIn * k.drift.dir > 0 ? Math.abs(steerIn) : 0.25;
      k.drift.charge += dt * (0.7 + toward * 0.9);
      const t = k.drift.charge > 2.1 ? 2 : k.drift.charge > 0.95 ? 1 : 0;
      if (t !== k.drift.tier) {
        k.drift.tier = t;
        if (fx && t > 0) fx.chargeTier(k, t);
      }
    }
  }

  // ------- steering -------
  const speedF = clamp(k.speed / (k.baseSpeed || 1), 0, 1.2);
  let steerEff = k.steerRate * (1.05 - speedF * 0.52);
  let yawRate;
  if (k.drift.active && touchDrift) {
    // Steer still turns the kart. A small assist holds the nose near the
    // road, biased into the drift, so a neutral stick does not spin out.
    const aim = wrapAngle(q.tanYaw + k.drift.dir * 0.42 - k.heading);
    const assist = clamp(aim, -0.35, 0.35);
    yawRate = steerIn * steerEff * 0.72 + assist * 1.15;
  } else if (k.drift.active) {
    yawRate = k.drift.dir * steerEff * 0.85 + steerIn * steerEff * 0.6;
  } else {
    yawRate = steerIn * steerEff;
  }
  if (k.speed > 1 || k.speed < -1) {
    k.heading = wrapAngle(k.heading + yawRate * dt * (k.speed < 0 ? -0.7 : 1));
  }

  // velocity yaw chases heading at grip rate (slide when drifting/on ice)
  const dYaw = wrapAngle(k.heading - k.velYaw);
  k.velYaw = wrapAngle(k.velYaw + clamp(dYaw, -grip * dt, grip * dt));

  // ------- integrate -------
  k.pos[0] += Math.sin(k.velYaw) * k.speed * dt;
  k.pos[2] += Math.cos(k.velYaw) * k.speed * dt;

  // vertical
  const groundY = q.roadY;
  // Lip launch: ramp slope read GEOMETRICALLY just behind the cliff (the
  // frame estimator lags at 1.7m spacing); smoothed estimate as fallback.
  // Authored lips multiply vy via track.js jumpBoost (1 elsewhere). The
  // 34 ceiling is the ABSOLUTE cap, after the airBonus perk: pre-epic-air
  // ramps maxed near vy 26, so nothing legacy is trimmed · it gives every
  // landing corridor a hard far edge.
  const lipLaunch = () => {
    k.airborne = true;
    k.hopAir = false;
    const St = track.S;
    let geo = 0;
    for (let j = 0; j <= 2; j++) {
      const a = (q.idx - j + St.n) % St.n;
      const b = (a - 3 + St.n) % St.n;
      const run = St.cum[a] - St.cum[b];
      if (run > 0.5) geo = Math.max(geo, (St.pos[a][1] - St.pos[b][1]) / run);
    }
    const slopeUse = Math.max(clamp(k.upSlope, 0, 0.55), clamp(geo, 0, 0.55));
    const launch = Math.max(1.2, slopeUse * k.speed * 0.85);
    const jb = (St.jumpBoost && St.jumpBoost[q.idx]) || 1;
    k.vy = Math.min(launch * jb * ((k.driver.sig && k.driver.sig.airBonus) || 1), 34);
    if (fx && k.vy > 4) fx.bigAir(k);
  };
  if (k.airborne) {
    // a drift hop carried across a lip must not refund the signature
    // launch (review 2026-07-18): the hop is barely off the ground, so
    // when the ground drops away beneath it, upgrade to the real launch.
    // hopAir gates this to hop flights only · a mega flight passing its
    // apex can never re-trigger.
    if (k.hopAir && k.speed > 24 && groundY - k.pos[1] < -1.6) lipLaunch();
    k.vy -= 24 * dt;
    k.pos[1] += k.vy * dt;
    if (k.pos[1] <= groundY) {
      if (track.gapAt && track.gapAt(q.idx)) {
        // came up SHORT · there is no road here, only what circles below
        gapFall(k, track, groundY, q.idx, fx);
      } else {
        k.pos[1] = groundY;
        k.airborne = false;
        k.hopAir = false;
        // K12: impact energy scales the flatten · curb hops barely dip,
        // mega landings visibly pancake. Read vy BEFORE it zeroes.
        k.squash = clamp(0.18 + Math.abs(k.vy) * 0.011, 0.2, 0.55);
        k.vy = 0;
        if (fx) fx.land(k);
      }
    }
  } else {
    const dy = groundY - k.pos[1];
    if (track.gapAt && track.gapAt(q.idx)) {
      // rolled past the lip without launch speed · straight down
      gapFall(k, track, groundY, q.idx, fx);
    } else if (dy < -1.6 && k.speed > 24) {
      lipLaunch();
    } else {
      // approach slope feeds ramp launches: rising road banks into the
      // upSlope smoothing so a lip drop converts speed into hang time
      const slope = (groundY - (k.prevRoadY === null ? groundY : k.prevRoadY)) / Math.max(k.speed * dt, 0.02);
      k.upSlope += (clamp(slope, -0.6, 0.6) - k.upSlope) * Math.min(10 * dt, 1);
      // follow ground with a little smoothing on downhills
      if (dy > 0) k.pos[1] = groundY;
      else k.pos[1] += dy * Math.min(12 * dt, 1);
    }
  }
  k.prevRoadY = groundY;

  // ------- walls + open hazard edges -------
  const q2 = surfaceQuery(track, k.pos[0], k.pos[2], k.sIdx);
  k.sIdx = q2.idx;
  if (!k.airborne && Math.abs(q2.lateral) < track.hw * 0.7) k.lastSafeIdx = q2.idx;
  if (Math.abs(q2.lateral) > track.hw + 1.3 && track.hazardOpen(q2.idx, Math.sign(q2.lateral))) {
    // Only a REAL lip launch follows the corridor · a drift hop (hopAir,
    // ~0.15u off the ground) over an open edge must still fall, or a
    // player could hop AT the edge to cheese a penalty-free save (epic-air
    // review 2026-07-18). lipLaunch clears hopAir, so !hopAir is exactly
    // "this is a jump flight, not a hop." Altitude floor is belt-and-
    // suspenders against any future hop-state change.
    if (k.airborne && !k.hopAir && k.pos[1] - q2.roadY > 1.0) {
      // A kart flying a jump is ABOVE the open edge, not on it (genesis
      // rework 2026-07-18): the old check yanked mega flights into the
      // water mid-air whenever the road curved out from under a straight
      // arc (gox pier fell EVERY lap at 11u altitude). Instead follow the
      // track corridor laterally so the jump lands back on the road
      // through curves · falling stays a GROUND event: drive off the edge,
      // or land a jump genuinely off-road, and you go over.
      const S = track.S, r = S.right[q2.idx], sgn = Math.sign(q2.lateral);
      const over = Math.abs(q2.lateral) - (track.hw + 0.6);
      if (over > 0) { k.pos[0] -= r[0] * over * sgn; k.pos[2] -= r[2] * over * sgn; }
    } else {
      // no wall here: over you go
      k.falling = true;
      k.fallT = 0;
      k.fallFloorY = q2.roadY - 6;
      k.drift.active = false;
      if (fx) fx.fallStart(k);
    }
  } else if (Math.abs(q2.lateral) > track.wallLimit) {
    const S = track.S;
    const r = S.right[q2.idx];
    const over = Math.abs(q2.lateral) - track.wallLimit;
    const sgn = Math.sign(q2.lateral);
    k.pos[0] -= r[0] * over * sgn;
    k.pos[2] -= r[2] * over * sgn;
    // impact severity = lateral velocity component INTO the wall (the
    // sign of sin(velYaw-tanYaw) is which side the velocity leans, so it
    // must match the wall side sgn) · zero while scraping along or away
    const sinD = Math.sin(wrapAngle(k.velYaw - q2.tanYaw));
    const into = sgn * sinD > 0 ? Math.abs(sinD) : 0;
    // airborne contact stays a silent lateral rail (epic-air review
    // 2026-07-18): mega flights kept the containment clamp but no longer
    // eat the 32% invisible sky-wall hit 40m over a 1.1m wall
    if (into > 0.25 && k.speed > 10 && !k.airborne) {
      k.speed *= 0.68;
      if (fx) fx.wallHit(k);
    } else {
      k.speed *= 0.985;
    }
    // reflect velocity yaw toward the track
    k.velYaw = wrapAngle(q2.tanYaw + clamp(wrapAngle(k.velYaw - q2.tanYaw), -0.35, 0.35) * 0.5);
  }

  // ------- static obstacles -------
  // obstacles are ~2-3 units tall: a kart flying 3+ over its road clears
  // them instead of hitting an invisible full-height column (epic-air
  // review 2026-07-18 · the goldmine flight snagged mid-air without this)
  for (const ob of track.obstacles) {
    if (k.pos[1] - groundY > 3) break;
    const dx = k.pos[0] - ob.x, dz = k.pos[2] - ob.z;
    const d2 = dx * dx + dz * dz;
    const rr = ob.r + 0.8;
    if (d2 < rr * rr && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      k.pos[0] = ob.x + (dx / d) * rr;
      k.pos[2] = ob.z + (dz / d) * rr;
      if (k.speed > 12 && fx) fx.bump(k);
      k.speed *= 0.7;
    }
  }

  // ------- progress / laps -------
  k.prevDist = k.dist;
  k.dist = q2.dist;
  const total = track.S.total;
  // LAP CONTRACT: karts spawn just BEFORE the finish line (track.js grid
  // at S.total - 9ish), so the first forward wrap seconds after GO takes
  // lap 0 → 1, and the race ends at lap > def.laps · exactly def.laps
  // full circuits. Changing grid placement breaks daily times silently ·
  // drift-guarded in scripts/test-bitcoin-kart.ts.
  if (k.prevDist > total * 0.85 && k.dist < total * 0.15) k.lap++;
  else if (k.prevDist < total * 0.15 && k.dist > total * 0.85) k.lap = Math.max(0, k.lap - 1); // backed over the line
  k.progress = k.lap * total + k.dist;

  // wrong way
  const hd = Math.cos(wrapAngle(k.velYaw - q2.tanYaw));
  if (hd < -0.3 && k.speed > 6) k.wrongWayT += dt;
  else k.wrongWayT = 0;

  // ------- timers + cosmetics -------
  if (k.chairT > 0) k.chairT -= dt;
  if (k.boltT > 0) k.boltT -= dt;
  if (k.trapImmuneT > 0) k.trapImmuneT -= dt;
  k.squash -= k.squash * Math.min(9 * dt, 1);
  if (k.rimFlash > 0) k.rimFlash -= dt * 1.6;
  k.wheelSpin += (k.slipT > 0 ? 30 : k.speed) * dt * 2.6;
  const targetLean = k.drift.active ? k.drift.dir * 0.22 : steerIn * 0.1 * speedF;
  k.lean += (targetLean - k.lean) * Math.min(8 * dt, 1);
  // Presentational slide (K4): velYaw's grip chase keeps true slip ~1°, so
  // the sideways-drift read must be authored · chassis yaws 16-23° into the
  // corner by tier; grounded off-drift it shows REAL slip (ice, collision
  // shoves), clamped so a hard shove never draws the kart facing backwards.
  // Airborne off-drift relaxes to 0: steering yaws heading against a FROZEN
  // velYaw up there, and the raw difference drew flights ~31° sideways ·
  // the drift-hop pose (drift stays active through the hop) is the one
  // deliberate airborne slide. Drawn yaw only · never fed to heading/
  // velYaw/integration, camera fwd, or the ghost frames; headless sims
  // read pos/speed/airborne/falling untouched.
  const slideTarget = k.drift.active
    ? k.drift.dir * (0.28 + k.drift.tier * 0.06)
    : k.airborne ? 0 : clamp(wrapAngle(k.heading - k.velYaw), -0.55, 0.55);
  // release rate 25: the counter-steer snap-back settles in ~5 frames at
  // 60fps; airborne relaxes at the gentle drift rate, never a mid-air snap
  k.slideVis += (slideTarget - k.slideVis) * Math.min((k.drift.active || k.airborne ? 6 : 25) * dt, 1);
  // K12 weight transfer: the nose lifts under accel and dives under braking
  // (a read from prevSpeed); airborne the pose is BALLISTIC (vy) so flights
  // arc like projectiles instead of tracking the terrain under a gap.
  // Drawn pitch only · integration, vy, and the y-blind gates untouched.
  // Round-4 amplitudes: the v1 gains topped out near 7deg, which the chase
  // camera (7u back, looking down the deck) foreshortens to nothing. These
  // pitch LARGE on purpose - 15deg of accel lift, 11deg of brake dive, a
  // 31deg nose-over on a plunge - because legibility at gameplay distance
  // is the whole point of the pose. The ease is the low-pass on a noisy
  // per-step accel read, so the gains rise but the rates barely do.
  const aLon = dt > 0 ? (k.speed - k.prevSpeed) / dt : 0;
  const pitchTarget = k.airborne
    ? clamp(-k.vy * 0.038, -0.4, 0.55)
    : clamp(-aLon * 0.013, -0.2, 0.26);
  k.pitchVis += (pitchTarget - k.pitchVis) * Math.min((k.airborne ? 8 : 7.5) * dt, 1);
  k.prevSpeed = k.speed;

  return q2;
}

// pairwise kart bumping. chair karts knock others out.
export function kartCollisions(karts, fx) {
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i], b = karts[j];
      // a kart sinking off a hazard edge is out of play: no x/z bumps
      // from beneath the cliff (and no chair spin-outs from below)
      if (a.falling || b.falling) continue;
      const dx = b.pos[0] - a.pos[0], dz = b.pos[2] - a.pos[2];
      const d2 = dx * dx + dz * dz;
      const R = 1.7;
      if (d2 > R * R || d2 < 0.0001) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      const overlap = R - d;
      const ma = a.mass * (a.driver.sig && a.driver.sig.ramBonus ? a.driver.sig.ramBonus : 1) * (a.chairT > 0 ? (a.driver.sig && a.driver.sig.chairBump ? a.driver.sig.chairBump : 1.2) : 1);
      const mb = b.mass * (b.driver.sig && b.driver.sig.ramBonus ? b.driver.sig.ramBonus : 1) * (b.chairT > 0 ? (b.driver.sig && b.driver.sig.chairBump ? b.driver.sig.chairBump : 1.2) : 1);
      const tot = ma + mb;
      a.pos[0] -= nx * overlap * (mb / tot);
      a.pos[2] -= nz * overlap * (mb / tot);
      b.pos[0] += nx * overlap * (ma / tot);
      b.pos[2] += nz * overlap * (ma / tot);
      // velocity exchange along the contact normal: weight physically
      // shoves instead of the old mushy positional-only separation
      const avx = Math.sin(a.velYaw) * a.speed, avz = Math.cos(a.velYaw) * a.speed;
      const bvx = Math.sin(b.velYaw) * b.speed, bvz = Math.cos(b.velYaw) * b.speed;
      const rel = (bvx - avx) * nx + (bvz - avz) * nz;
      if (rel < -1) {
        const j = -rel * 0.65;
        const nax = avx - nx * j * (mb / tot), naz = avz - nz * j * (mb / tot);
        const nbx = bvx + nx * j * (ma / tot), nbz = bvz + nz * j * (ma / tot);
        const sa = Math.hypot(nax, naz), sb = Math.hypot(nbx, nbz);
        if (sa > 1.5) { a.speed = Math.min(sa, a.baseSpeed * 1.4); a.velYaw = Math.atan2(nax, naz); }
        else a.speed *= 0.6;
        if (sb > 1.5) { b.speed = Math.min(sb, b.baseSpeed * 1.4); b.velYaw = Math.atan2(nbx, nbz); }
        else b.speed *= 0.6;
      }
      // chair contact = spin out the other
      if (a.chairT > 0 && b.chairT <= 0) spinOut(b, 1.0, fx);
      if (b.chairT > 0 && a.chairT <= 0) spinOut(a, 1.0, fx);
      if (fx && overlap > 0.35) fx.bumpPair(a, b);
    }
  }
}

// Returns what actually happened so callers can tell a landed hit from
// an absorbed one: "chair" | "shield" | "immune" | "already" | "spun"
// (M5 2026-07-14 · shield blocks used to read as hits and fire PAPER
// HANDS / REKT callouts anyway).
export function spinOut(k, severity, fx, cause) {
  if (k.chairT > 0) return "chair";
  if (k.trapImmuneT > 0) return "immune"; // post-rescue grace (L1)
  if (k.shield) {
    k.shield = false;
    if (fx) fx.shieldPop(k);
    return "shield";
  }
  if (k.spinT > 0) return "already";
  k.spinT = 0.9 * severity;
  k.speed *= 0.35;
  k.drift.active = false;
  k.sats = Math.max(0, k.sats - 2);
  if (fx) fx.spin(k, cause);
  return "spun";
}
