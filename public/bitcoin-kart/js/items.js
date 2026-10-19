// BITCOIN KART · items.js
// Item roulette (rank-weighted, driver-biased) and live item entities:
// peels, FUD scrolls, ratio missiles, the regulatory hammer, halving bolt,
// gold bars, media headline traps, plus pickup logic for boxes and sats.

import { ITEMS, ITEM_WEIGHTS } from "./data.js";
import { surfaceQuery } from "./track.js";
import { spinOut, wrapAngle } from "./physics.js";
import { clamp } from "./math3d.js";

export function rollItem(k, karts) {
  const bucket = k.rank <= 2 ? "lead" : k.rank <= 5 ? "mid" : "tail";
  const base = ITEM_WEIGHTS[bucket];
  const sig = k.driver.sig || {};
  const luck = (k.driver.stats.itemLuck || 5) / 5;
  const weights = {};
  for (const id in base) {
    let w = base[id];
    if (id === "shield" && sig.shieldBias) w *= sig.shieldBias;
    if (id === "hammer" && sig.hammerBias) w *= sig.hammerBias;
    if (id === "headline" && sig.headlineBias) w *= sig.headlineBias;
    if (id === "fud" && sig.fudBias) w *= sig.fudBias;
    if (id === "goldbar") w *= k.driver.id === "schiff" ? 6 : 1;
    // rare items scale with luck
    if (id === "chair" || id === "pill" || id === "bolt") w *= luck * (sig.rareLuck || 1);
    weights[id] = w;
  }
  let sum = 0;
  for (const id in weights) sum += weights[id];
  let r = Math.random() * sum;
  for (const id in weights) {
    r -= weights[id];
    if (r <= 0) return id;
  }
  return "peel";
}

export function createItemSystem(track, karts, fx, noItems) {
  const ents = [];

  function dropBehind(k, type) {
    const bx = k.pos[0] - Math.sin(k.heading) * 2.6;
    const bz = k.pos[2] - Math.cos(k.heading) * 2.6;
    ents.push({ type, x: bx, y: k.pos[1], z: bz, owner: k, life: 30, armT: 0.4 });
  }

  function use(k) {
    if (!k.item || k.roulette > 0 || k.spinT > 0) return;
    const id = k.item;
    k.item = null;
    // challenge bookkeeping (DIAMOND HANDS / BARE HANDS AT THE SUMMIT)
    k.itemsUsed = (k.itemsUsed || 0) + 1;
    if (id === "chair") k.usedChair = true;
    switch (id) {
      case "peel": dropBehind(k, "peel"); fx.sfx("peel", 0, k); break;
      case "headline": dropBehind(k, "headline"); fx.sfx("headline", 0, k); break;
      case "fud": {
        // armT = uniform owner-immunity window across every entity (M9)
        ents.push({
          type: "fud", x: k.pos[0] + Math.sin(k.heading) * 2.2, y: k.pos[1] + 0.7,
          z: k.pos[2] + Math.cos(k.heading) * 2.2,
          yaw: k.heading, speed: k.speed + 26, owner: k, life: 4, bounced: 0, sIdx: k.sIdx, armT: 0.4,
        });
        fx.sfx("fud", 0, k);
        break;
      }
      case "ratio": {
        // target: nearest kart ahead in rank
        let target = null;
        for (const o of karts) if (o !== k && o.rank === k.rank - 1) target = o;
        if (!target) for (const o of karts) if (o !== k && o.rank < k.rank && (!target || o.rank > target.rank)) target = o;
        ents.push({
          type: "ratio", x: k.pos[0] + Math.sin(k.heading) * 2.2, y: k.pos[1] + 0.8,
          z: k.pos[2] + Math.cos(k.heading) * 2.2,
          yaw: k.heading, speed: Math.max(k.speed + 20, 46), owner: k, target, life: 9, sIdx: k.sIdx, armT: 0.6,
        });
        fx.sfx("ratio", 0, k);
        break;
      }
      case "hammer": {
        // the hammer drops on the leader, but never on its own user: fired
        // from P1 it retargets the nearest chaser instead of self-striking
        let leader = null;
        for (const o of karts) if (o !== k && o.rank === 1) leader = o;
        if (!leader) for (const o of karts) if (o !== k && (!leader || o.rank < leader.rank)) leader = o;
        if (leader) {
          ents.push({ type: "hammer", target: leader, phase: 0, t: 0, owner: k, life: 6 });
          fx.hammerTelegraph(leader);
        }
        fx.sfx("hammer");
        break;
      }
      case "laser": {
        const mult = (k.driver.sig && k.driver.sig.laserMult) || 1;
        k.boostT = Math.max(k.boostT, 1.5 * mult);
        k.boostKind = "laser";
        fx.sfx("laser", 0, k);
        fx.laser(k);
        break;
      }
      case "chair": {
        const mult = (k.driver.sig && k.driver.sig.chairMult) || 1;
        k.chairT = 6 * mult;
        fx.sfx("chair", 0, k);
        fx.chairOn(k);
        break;
      }
      case "bolt": {
        for (const o of karts) {
          if (o === k || o.chairT > 0) continue;
          const weak = o.driver.sig && o.driver.sig.boltWeak;
          o.boltT = Math.max(o.boltT, weak ? 3.4 : 2.2);
          o.sats = Math.max(0, o.sats - 2);
        }
        fx.sfx("bolt", 0, k);
        fx.boltFlash();
        break;
      }
      case "shield": k.shield = true; fx.sfx("shield", 0, k); break;
      case "pill": {
        let victim = null;
        for (const o of karts) if (o !== k && o.rank === k.rank - 1) victim = o;
        let stole = null;
        if (victim && victim.item) { stole = victim.item; k.item = stole; victim.item = null; }
        else k.item = "laser"; // consolation: the pill always pays out
        k.sats = Math.min(10, k.sats + 5);
        fx.sfx("pill", 0, k);
        if (fx.pill) fx.pill(k, stole, victim);
        break;
      }
      case "goldbar": {
        ents.push({
          type: "goldbar", x: k.pos[0] + Math.sin(k.heading) * 2.4, y: k.pos[1] + 1.2,
          z: k.pos[2] + Math.cos(k.heading) * 2.4,
          yaw: k.heading, speed: k.speed + 18, vy: 7, owner: k, life: 10, landed: false, sIdx: k.sIdx,
        });
        fx.sfx("goldbar", 0, k);
        break;
      }
    }
  }

  // Contact resolution · spinOut reports what actually happened, so a
  // shield block never reads as a landed hit (M5): "spun" fires the hit
  // callouts, "shield"/"chair" spend the entity harmlessly, "immune"/
  // "already" pass through. The cause (ent.type) picks the flavored
  // callout (PAPER HANDS for a peel, REGULATED for the hammer).
  function hitKart(ent, k, severity) {
    return spinOut(k, severity, fx, ent.type);
  }

  function update(dt) {
    // every pickup/trap test below is a 2D x/z circle · a kart flying a
    // signature mega jump 10..40 units up must neither sky-grab pads and
    // boxes nor get spun by ground traps (epic-air review 2026-07-18).
    // prevRoadY is the road height under the kart, refreshed every
    // physics step, so this is true altitude, not world Y.
    const aloft = (k) =>
      k.airborne && k.pos[1] - (k.prevRoadY === null ? k.pos[1] : k.prevRoadY) > 3;
    // roulette timers
    for (const k of karts) {
      if (k.roulette > 0) {
        k.roulette -= dt;
        if (k.roulette <= 0) {
          k.item = k.rouletteItem;
          k.rouletteItem = null;
          if (k.isPlayer) fx.sfx("award");
        }
      }
    }

    // boxes (disabled in time trial: no items, pure lines)
    for (const box of noItems ? [] : track.itemBoxes) {
      if (box.taken) {
        box.timer -= dt;
        if (box.timer <= 0) {
          box.taken = false;
          fx.boxRespawn(box);
        }
        continue;
      }
      for (const k of karts) {
        if (k.item || k.roulette > 0 || aloft(k)) continue;
        const dx = k.pos[0] - box.x, dz = k.pos[2] - box.z;
        if (dx * dx + dz * dz < 2.4 * 2.4) {
          box.taken = true;
          box.timer = 3.2;
          k.roulette = 2.4; // slow, decelerating roulette: anticipation IS the ritual
          k.rouletteItem = rollItem(k, karts);
          fx.boxBreak(box, k);
          break;
        }
      }
    }

    // sats
    for (const s of track.sats) {
      if (s.taken) {
        s.timer -= dt;
        if (s.timer <= 0) s.taken = false;
        continue;
      }
      for (const k of karts) {
        if (aloft(k)) continue;
        const dx = k.pos[0] - s.x, dz = k.pos[2] - s.z;
        if (dx * dx + dz * dz < 1.8 * 1.8) {
          s.taken = true;
          s.timer = 14;
          if (k.sats < 10) k.sats++;
          if (k.driver.sig && k.driver.sig.satBoost) k.boostT = Math.max(k.boostT, 0.16);
          fx.satPickup(s, k);
          break;
        }
      }
    }

    // boost pads
    for (const p of track.boostPads) {
      for (const k of karts) {
        if (aloft(k)) continue;
        const dx = k.pos[0] - p.x, dz = k.pos[2] - p.z;
        if (dx * dx + dz * dz < p.r * p.r) {
          if (k.boostT < 0.85) {
            k.boostT = 0.95;
            k.boostKind = "pad";
            fx.pad(k);
          }
        }
      }
    }

    // entities
    for (let i = ents.length - 1; i >= 0; i--) {
      const e = ents[i];
      e.life -= dt;
      if (e.armT > 0) e.armT -= dt;
      if (e.life <= 0) { ents.splice(i, 1); continue; }

      if (e.type === "peel" || e.type === "headline" || (e.type === "goldbar" && e.landed)) {
        for (const k of karts) {
          if ((k === e.owner && e.armT > 0) || aloft(k)) continue;
          const dx = k.pos[0] - e.x, dz = k.pos[2] - e.z;
          if (dx * dx + dz * dz < 1.6 * 1.6) {
            // One Chair SMASHES traps flat instead of ignoring them ·
            // no more peels camping under an invincible kart (M6)
            if (k.chairT > 0) {
              if (fx.trapSmash) fx.trapSmash(e, k);
              ents.splice(i, 1);
              break;
            }
            const r = hitKart(e, k, e.type === "goldbar" ? 1.3 : 0.8);
            if (r === "spun") {
              fx.trapHit(e, k);
              ents.splice(i, 1);
            } else if (r === "shield") {
              ents.splice(i, 1); // spent on the shield · no hit callout
            }
            break;
          }
        }
      } else if (e.type === "fud") {
        e.x += Math.sin(e.yaw) * e.speed * dt;
        e.z += Math.cos(e.yaw) * e.speed * dt;
        const q = surfaceQuery(track, e.x, e.z, e.sIdx);
        e.sIdx = q.idx;
        e.y = q.roadY + 0.7;
        if (Math.abs(q.lateral) > track.wallLimit) {
          if (e.bounced++ > 0) { ents.splice(i, 1); continue; }
          e.yaw = wrapAngle(2 * q.tanYaw - e.yaw); // reflect
        }
        for (const k of karts) {
          if (k === e.owner && e.armT > 0) continue;
          const dx = k.pos[0] - e.x, dz = k.pos[2] - e.z;
          if (dx * dx + dz * dz < 1.5 * 1.5) {
            const r = hitKart(e, k, 0.9);
            if (r === "spun") { fx.projHit(e, k); ents.splice(i, 1); }
            else if (r === "shield" || r === "chair") ents.splice(i, 1); // deflected
            break;
          }
        }
      } else if (e.type === "ratio") {
        // steer toward target, hugging the track
        let desired = e.yaw;
        if (e.target && !e.target.finished) {
          desired = Math.atan2(e.target.pos[0] - e.x, e.target.pos[2] - e.z);
        }
        const q = surfaceQuery(track, e.x, e.z, e.sIdx);
        e.sIdx = q.idx;
        // stay on the road: blend toward tangent when near walls
        if (Math.abs(q.lateral) > track.hw * 0.8) {
          const pull = wrapAngle(q.tanYaw - desired);
          desired = wrapAngle(desired + clamp(pull, -0.6, 0.6) * 0.5);
        }
        e.yaw = wrapAngle(e.yaw + clamp(wrapAngle(desired - e.yaw), -3.2 * dt, 3.2 * dt));
        e.x += Math.sin(e.yaw) * e.speed * dt;
        e.z += Math.cos(e.yaw) * e.speed * dt;
        e.y = q.roadY + 0.8;
        if (e.target) {
          const dx = e.target.pos[0] - e.x, dz = e.target.pos[2] - e.z;
          if (dx * dx + dz * dz < 1.7 * 1.7) {
            if (hitKart(e, e.target, 1.0) === "spun") fx.projHit(e, e.target);
            ents.splice(i, 1); // a locked missile is always spent on contact
          }
        } else {
          // fired from P1 there is no one ahead to lock: the missile still
          // flies live and clips whoever it meets (never a silent dud)
          for (const o of karts) {
            if (o === e.owner && e.armT > 0) continue;
            const dx = o.pos[0] - e.x, dz = o.pos[2] - e.z;
            if (dx * dx + dz * dz < 1.7 * 1.7) {
              const r = hitKart(e, o, 1.0);
              if (r === "spun") { fx.projHit(e, o); ents.splice(i, 1); }
              else if (r === "shield" || r === "chair") ents.splice(i, 1);
              break;
            }
          }
        }
      } else if (e.type === "goldbar") {
        e.x += Math.sin(e.yaw) * e.speed * dt;
        e.z += Math.cos(e.yaw) * e.speed * dt;
        e.vy -= 22 * dt;
        e.y += e.vy * dt;
        const q = surfaceQuery(track, e.x, e.z, e.sIdx || 0);
        e.sIdx = q.idx;
        if (e.y <= q.roadY + 0.25) {
          e.y = q.roadY + 0.25;
          e.landed = true;
          e.speed = 0;
          e.life = Math.min(e.life, 7);
        }
        if (!e.landed) {
          for (const k of karts) {
            if (k === e.owner) continue;
            const dx = k.pos[0] - e.x, dz = k.pos[2] - e.z;
            if (dx * dx + dz * dz < 1.5 * 1.5) {
              const r = hitKart(e, k, 1.3);
              if (r === "spun") { fx.projHit(e, k); ents.splice(i, 1); }
              else if (r === "shield" || r === "chair") ents.splice(i, 1);
              break;
            }
          }
        }
      } else if (e.type === "hammer") {
        e.t += dt;
        if (e.phase === 0 && e.t > 1.5) {
          e.phase = 1;
          e.t = 0;
        } else if (e.phase === 1 && e.t > 0.28) {
          // the extra slow + strike flash land ONLY on a real spin · a
          // shield absorbs the hammer (pop, no slow) and the One Chair
          // shrugs it off entirely. String statuses are truthy, so this
          // MUST compare against "spun" (M5 regression fix 2026-07-14).
          if (e.target && hitKart(e, e.target, 1.35) === "spun") {
            e.target.speed *= 0.3;
            fx.hammerStrike(e.target);
          }
          ents.splice(i, 1);
        }
        if (e.target) { e.x = e.target.pos[0]; e.y = e.target.pos[1] + 5 - (e.phase === 1 ? e.t * 14 : 0); e.z = e.target.pos[2]; }
      }
    }
  }

  return { ents, use, update };
}

export const ITEM_META = ITEMS;
