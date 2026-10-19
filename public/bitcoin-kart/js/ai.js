// BITCOIN KART · ai.js
// CPU drivers: follow the precomputed racing line with personality wobble,
// avoid traps, drift long corners, use items with per-driver temperament,
// and rubber-band mildly around the player.

import { clamp } from "./math3d.js";
import { wrapAngle } from "./physics.js";
import { surfaceQuery } from "./track.js";

export function aiInput(k, track, karts, items, player, dt, hard, gentle) {
  const S = track.S;
  const q = surfaceQuery(track, k.pos[0], k.pos[2], k.sIdx);
  k.sIdx = q.idx;
  const look = 14 + Math.floor(k.speed * 0.5);
  const li = (q.idx + look) % S.n;
  let targetLat = track.aiLine[li];

  // personality wobble so the pack doesn't ride a rail
  k.aiT += dt;
  targetLat += Math.sin(k.aiT * 0.7 + k.driver.id.length) * track.hw * 0.14 * (1 - (k.driver.ai.skill || 0.7));

  // schiff camps the gold lines: hugs the off-road edge on his mine
  if (k.driver.ai.campsGold && track.surface === "gold") {
    targetLat = clamp(targetLat + Math.sin(k.aiT * 0.4) * track.hw * 0.5, -track.hw * 1.2, track.hw * 1.2);
  }

  // avoid traps + gold bars ahead
  for (const e of items.ents) {
    if (e.type !== "peel" && e.type !== "headline" && !(e.type === "goldbar" && e.landed)) continue;
    const dx = e.x - k.pos[0], dz = e.z - k.pos[2];
    const d2 = dx * dx + dz * dz;
    if (d2 > 26 * 26) continue;
    const fwd = dx * Math.sin(k.heading) + dz * Math.cos(k.heading);
    if (fwd < 2) continue;
    const eq = surfaceQuery(track, e.x, e.z, e.sIdx || q.idx);
    if (Math.abs(eq.lateral - targetLat) < 2.4) {
      targetLat = eq.lateral + (eq.lateral > 0 ? -3.2 : 3.2);
    }
  }

  // avoid static obstacles
  for (const ob of track.obstacles) {
    const dx = ob.x - k.pos[0], dz = ob.z - k.pos[2];
    if (dx * dx + dz * dz > 30 * 30) continue;
    const fwd = dx * Math.sin(k.heading) + dz * Math.cos(k.heading);
    if (fwd < 2 || fwd > 26) continue;
    const oq = surfaceQuery(track, ob.x, ob.z, q.idx);
    if (Math.abs(oq.lateral - targetLat) < ob.r + 1.6) {
      targetLat = oq.lateral + (oq.lateral > 0 ? -(ob.r + 2.6) : ob.r + 2.6);
    }
  }

  // hug the safe side through open hazard edges (no wall to save them).
  // Fix 2026-07-18: the old cap at +hw*0.25 when the RIGHT edge was open
  // still let the AI aim onto the open side (it only blocked aiming
  // FURTHER right) · pull the line to the safe INNER quarter instead, and
  // look a bit further ahead so the hug starts before the gap opens (the
  // boss/mountain tracks were losing ~a dozen karts a race to their own
  // scenic cliffs · a clean human line never fell there).
  const hazLook = (q.idx + look + 16) % S.n;
  if (track.hazardOpen(li, 1) || track.hazardOpen(q.idx, 1) || track.hazardOpen(hazLook, 1)) {
    targetLat = Math.min(targetLat, -track.hw * 0.18);
  }
  if (track.hazardOpen(li, -1) || track.hazardOpen(q.idx, -1) || track.hazardOpen(hazLook, -1)) {
    targetLat = Math.max(targetLat, track.hw * 0.18);
  }

  targetLat = clamp(targetLat, -track.hw + 1.2, track.hw - 1.2);

  // ---- wall feeler (AI driving fix 2026-07-16) ----
  // Project ~0.55s down the VELOCITY vector (drift slides included): if
  // that point runs out of road, blend the target line toward the
  // opposite third of the track, proportionally to the overshoot. The
  // old rule only reacted to the CURRENT lateral error, so fast karts
  // discovered walls by hitting them (fleet baseline: 350 wall hits
  // across the balance sim's 22 races · gated there post-fix).
  // STEERING-ONLY by design: an earlier draft added a throttle lift on
  // hot approaches and it broke the roster balance band · throttle
  // modulation creates recovery events whose cost scales with accel, so
  // high-accel karts profit. Prevention via the racing line is free.
  if (k.speed > 8) {
    const wx = k.pos[0] + Math.sin(k.velYaw) * k.speed * 0.55;
    const wz = k.pos[2] + Math.cos(k.velYaw) * k.speed * 0.55;
    const wq = surfaceQuery(track, wx, wz, q.idx);
    const over = Math.abs(wq.lateral) - (track.hw - 1.4);
    if (over > 0) {
      const w = clamp(over / 4, 0, 1);
      targetLat = targetLat * (1 - w) - Math.sign(wq.lateral) * track.hw * 0.35 * w;
    }
  }

  // steering: aim heading at the target lateral offset
  const headingTarget = q.tanYaw + clamp((targetLat - q.lateral) * 0.085, -0.75, 0.75);
  const err = wrapAngle(headingTarget - k.heading);
  const steer = clamp(err * 3.2, -1, 1);

  // drift on sustained curvature
  const yawAhead = Math.atan2(S.tan[li][0], S.tan[li][2]);
  const curve = wrapAngle(yawAhead - q.tanYaw);
  let drift = k.drift.active;
  if (!drift && Math.abs(curve) > 0.35 && k.speed > 20 && Math.sign(curve) === Math.sign(steer)) {
    k.aiSteerHold += dt;
    if (k.aiSteerHold > 0.3) drift = true;
  } else if (!drift) {
    k.aiSteerHold = 0;
  }
  if (drift && Math.abs(curve) < 0.1 && k.drift.charge > 0.9) drift = false; // release for turbo
  // ---- drift abort on wall contact (EXTREME pass 2026-07-21) ----
  // A drift held against a wall is a lock: the drift keeps rotating the
  // heading INTO the wall while the wall response clamps velocity along
  // it · full countersteer never wins, and the kart grinds at ~spd 10
  // (above the unstick reflex) until an open hazard window ends the wall
  // and dumps it into the void (traced: hdg-tan wound 0.2 -> 1.8 rad over
  // 5s pinned at the wall line). A player releases the drift button on
  // impact · so does the AI.
  if (drift && Math.abs(q.lateral) > track.hw * 0.9) {
    drift = false;
    k.aiSteerHold = 0;
  }

  // throttle: ease off in tight stuff, rubber-band around the player
  let throttle = 1;
  if (Math.abs(err) > 0.8 && k.speed > k.baseSpeed * 0.55) throttle = 0.45;
  const skill = k.driver.ai.skill || 0.72;
  // ---- difficulty retune (2026-07-21) ----
  // The drift-abort fix made the fleet 20-53% faster (it had been quietly
  // parking itself on walls · measured mean 3-lap on pizza 142.8s -> 66.9s),
  // which pushed the pack to expert pace and races stopped being winnable.
  // The band below is the deliberate re-price of that honesty: a steeper
  // skill slope (weaker drivers ease more, so the pack spreads into a
  // beatable back half), a mercy band that leans in earlier and harder
  // when the AI leads, and a gentler SATS tier so the learning class
  // actually teaches. Hard mode (bosses + FULL SEND) keeps the old
  // ferocity via the 0.97 floor. Base + slope MUST sum to 1.0: the
  // roster balance gate (sim-kart-balance) pins skill to 1 to measure
  // pure stats, and any other sum re-weights its speed envelope.
  let band = 0.72 + skill * 0.28;
  if (gentle) band -= 0.06;
  if (player && !player.finished) {
    const gap = player.progress - k.progress; // positive: AI is behind
    if (gap > 60) band = Math.min(band + 0.1 + (hard ? 0.06 : 0), 1.05);
    else if (gap < (gentle ? -35 : -50)) band = band - (hard ? 0.04 : gentle ? 0.16 : 0.12);
  }
  if (hard) band = Math.max(band, 0.97);
  throttle *= clamp(band, 0.6, 1.08);

  // ---- gap commit (EXTREME pass 2026-07-21) ----
  // A severed deck ahead means one thing: FULL SEND. The corner lift and
  // the rubber band both throttle karts under launch speed on gap
  // approaches (34 grid falls in one measured race) · inside the commit
  // window the AI floors it exactly like a player who knows the track.
  if (track.gapAt) {
    for (let g = 0; g < 22; g++) {
      if (track.gapAt((k.sIdx + g) % track.S.n)) { throttle = 1; break; }
    }
  }

  // ---- pinned-unstick reflex (AI driving fix 2026-07-16) ----
  // Grinding a wall at walking pace never self-resolved: the steering
  // rule kept aiming at a line the wall blocks. Hold hard countersteer
  // toward open road under full throttle until free.
  if (k.speed < 6 && Math.abs(q.lateral) > track.hw * 0.72) k.aiStuckT += dt;
  else k.aiStuckT = 0;
  if (k.aiStuckT > 0.7) {
    return { throttle: 1, steer: -Math.sign(q.lateral) || 1, drift: false, useItem: false, brake: false };
  }

  // items
  let useItem = false;
  if (k.item && k.roulette <= 0) {
    k.itemCd -= dt;
    if (k.itemCd <= 0) {
      const aggr = k.driver.ai.aggr || 0.5;
      const boostHappy = k.driver.ai.boostHappy || 0.5;
      const it = k.item;
      if (it === "laser" || it === "chair") {
        useItem = Math.random() < boostHappy;
      } else if (it === "shield" || it === "pill" || it === "bolt") {
        useItem = true;
      } else if (it === "peel" || it === "headline" || it === "goldbar") {
        // drop when someone is close behind
        let closeBehind = false;
        for (const o of karts) {
          if (o === k) continue;
          const dx = o.pos[0] - k.pos[0], dz = o.pos[2] - k.pos[2];
          if (dx * dx + dz * dz < 20 * 20 && o.rank > k.rank) closeBehind = true;
        }
        useItem = closeBehind || Math.random() < 0.15;
      } else {
        // projectiles: fire when a target is plausible ahead
        useItem = k.rank > 1 && Math.random() < 0.35 + aggr * 0.5;
      }
      k.itemCd = useItem ? 2.2 + Math.random() * 2.5 : 0.6;
    }
  }

  return { throttle, steer, drift, useItem, brake: false };
}
