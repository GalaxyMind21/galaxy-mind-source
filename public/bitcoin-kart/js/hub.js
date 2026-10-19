// BITCOIN KART · hub.js
// Timechain Atoll: the adventure island scene. A high-craft 3D node map
// with camera charm: island terrain, water to the horizon, three glowing
// world gates, palms, floating Orange Balloons, the throne on the peak.
// Interaction happens in the DOM overlay (main.js); this owns the scene.

import { M4, V3, TAU, hash01 } from "./math3d.js";
import { makeEnv } from "./gl.js";
import {
  meshBuilder, PROP_BUILDERS, billboardFrame, billboardPanelUV,
  makeSignCanvas, hex, shade, buildKartMesh, WHEEL_POS,
} from "./geometry.js";

const ATOLL_ENV = {
  sunDir: V3.norm([0.5, 0.65, 0.35]),
  sunCol: [1.0, 0.94, 0.82],
  hemiSky: [0.5, 0.6, 0.72],
  hemiGround: [0.4, 0.36, 0.3],
  skyTop: [0.28, 0.55, 0.92],
  skyHorizon: [0.78, 0.87, 0.95],
  skyGround: [0.5, 0.68, 0.8],
  sunTint: [1, 0.92, 0.7],
  fogCol: [0.78, 0.87, 0.95],
  fogNear: 160,
  fogFar: 420,
  rimCol: [1.0, 0.62, 0.15],
};

// golden hour: the 100%-complete atoll under a low gold sun (setGolden ·
// reached once every Orange Balloon is collected and every level cleared)
const GOLDEN_ENV = {
  sunDir: V3.norm([0.5, 0.26, 0.35]), sunCol: [1.2, 0.82, 0.4],
  hemiSky: [0.62, 0.5, 0.42], hemiGround: [0.46, 0.34, 0.24],
  skyTop: [0.42, 0.36, 0.5], skyHorizon: [1.2, 0.72, 0.32], skyGround: [0.72, 0.5, 0.34],
  sunTint: [1.25, 0.82, 0.4], fogCol: [1.05, 0.74, 0.46], fogNear: 160, fogFar: 420,
  rimCol: [1.3, 0.78, 0.2],
};

const DOOR_COLORS = { genesis: "#F7931A", neon: "#22D3EE", corporate: "#FFD166" };
const DOOR_POS = {
  genesis: [-38, 28],
  neon: [42, 18],
  corporate: [0, -44],
};

export function createAtoll(R) {
  // island heightfield: a soft dome with beach edges
  const terr = meshBuilder();
  const GRID = 44, RAD = 95;
  const H = (x, z) => {
    const d = Math.hypot(x, z);
    const dome = Math.max(0, 1 - d / RAD);
    const hills = (hash01(Math.round(x * 0.5) * 31 + Math.round(z * 0.5)) - 0.4) * 3.2;
    let h = dome * dome * 22 + hills * dome - 2.4;
    return h;
  };
  const sand = hex("#E0C186"), grass = hex("#4C9B58"), rock = hex("#7C7370");
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x0 = -RAD + (i / GRID) * RAD * 2, x1 = -RAD + ((i + 1) / GRID) * RAD * 2;
      const z0 = -RAD + (j / GRID) * RAD * 2, z1 = -RAD + ((j + 1) / GRID) * RAD * 2;
      const h00 = H(x0, z0), h10 = H(x1, z0), h01 = H(x0, z1), h11 = H(x1, z1);
      const hAvg = (h00 + h10 + h01 + h11) / 4;
      let c = hAvg > 12 ? rock : hAvg > 2.2 ? grass : sand;
      c = shade(c, 0.9 + hash01(i * 57 + j) * 0.2);
      terr.quad([x0, h00, z0], [x0, h01, z1], [x1, h11, z1], [x1, h10, z0], c);
    }
  }
  const island = R.createMesh(terr.build());

  // water
  const wb = meshBuilder();
  const W = 700, seg = 20;
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < seg; j++) {
      const x0 = -W / 2 + (i / seg) * W, x1 = -W / 2 + ((i + 1) / seg) * W;
      const z0 = -W / 2 + (j / seg) * W, z1 = -W / 2 + ((j + 1) / seg) * W;
      wb.quad([x0, -1.1, z0], [x0, -1.1, z1], [x1, -1.1, z1], [x1, -1.1, z0], [1, 1, 1]);
    }
  }
  const water = R.createMesh(wb.build());

  // props: gates, palms, balloons, the throne on the peak
  const instances = [];
  const add = (mesh, x, z, yaw, scale, emissive, yOverride) => {
    const y = yOverride === undefined ? Math.max(H(x, z), 0) : yOverride;
    const inst = { mesh, model: M4.trs(x, y, z, yaw || 0, 0, 0, scale || 1), emissive: emissive || 0 };
    instances.push(inst);
    return inst;
  };

  const doorMeshes = {};
  const gateInsts = {}; // per-world instance refs · the gate cine surges emissive
  for (const w of ["genesis", "neon", "corporate"]) {
    doorMeshes[w] = R.createMesh(PROP_BUILDERS.worldDoor(DOOR_COLORS[w]));
    const [x, z] = DOOR_POS[w];
    gateInsts[w] = add(doorMeshes[w], x, z, Math.atan2(x, z) + Math.PI, 1.6, 0.5);
  }
  const palm = R.createMesh(PROP_BUILDERS.palm(3));
  const palm2 = R.createMesh(PROP_BUILDERS.palm(17));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const r = 58 + hash01(i * 7) * 26;
    add(hash01(i) > 0.5 ? palm : palm2, Math.cos(a) * r, Math.sin(a) * r, hash01(i * 3) * TAU, 0.9 + hash01(i * 5) * 0.5);
  }
  const throne = R.createMesh(PROP_BUILDERS.throne());
  const throneInst = add(throne, 0, -2, Math.PI, 0.9, 0, H(0, -2));
  const balloon = R.createMesh(PROP_BUILDERS.balloon());
  const balloons = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.4;
    const r = 26 + hash01(i * 11) * 34;
    balloons.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, base: Math.max(H(Math.cos(a) * r, Math.sin(a) * r), 0) + 2 + hash01(i) * 5, phase: i });
  }
  const lighthouse = R.createMesh(PROP_BUILDERS.lighthouse());
  add(lighthouse, -62, -30, 0.6, 1.0, 0.15);

  // ---- atoll gags (Tier 2 · 2026-07-14) ----
  // FUD ice bears flank the Genesis gate (the world that ends at the
  // 2014 Bear · they are the doormen)
  const fudBear = R.createMesh(PROP_BUILDERS.fudStatue());
  {
    const [gx, gz] = DOOR_POS.genesis;
    const yaw = Math.atan2(gx, gz) + Math.PI;
    add(fudBear, gx - 7, gz + 5, yaw + 0.4, 1.1);
    add(fudBear, gx + 7, gz - 3, yaw - 0.4, 1.1);
  }
  // balloon vendor's sign · the atoll's economics are final
  const gagSignFrame = R.createMesh(billboardFrame(7, 3.5));
  const gagSignPanel = R.createUVMesh(billboardPanelUV(7, 3.5));
  const gagSignTex = R.createTexture(makeSignCanvas(["ORANGE BALLOONS", "NON-REFUNDABLE"], { fg: "#F7931A", fontSize: 46 }));
  const gagSignModel = M4.trs(24, Math.max(H(24, 30), 0), 30, Math.atan2(24, 30) + Math.PI, 0, 0, 0.9);
  // the RATIO BEAR · a weeping-angel gag: it creeps toward the throne
  // ONLY while the orbiting camera cannot see it, and freezes the moment
  // it is on screen. Reaching the throne just puts it back on the beach ·
  // there is no second best, even for bears.
  const ratioBear = {
    startA: 2.6, // beach angle (radians) · away from the gates
    prog: 0,     // 0 beach → 1 throne
    x: 0, z: 0, yaw: 0,
  };
  const bearPos = (p) => {
    const r = 70 * (1 - p);
    const x = Math.cos(ratioBear.startA) * r;
    const z = Math.sin(ratioBear.startA) * r - 2 * p; // ends at the throne
    return [x, z];
  };
  {
    const [bx, bz] = bearPos(0);
    ratioBear.x = bx; ratioBear.z = bz;
  }

  const parts = R.createParticles(90);
  let sparkleT = 0, fwT = 0;
  let golden = false;
  function setGolden(on) { golden = !!on; }

  // ---- hub cinematics (2026-07-21) ----
  // Camera scripts over the SAME live scene · main.js drives the DOM
  // cards/skip on top via cineInfo(). Kinds: "arrival" (ocean approach +
  // island reveal), "gate" (fly to a world gate, glow surge), "signal"
  // (dive to the peak · the Genesis Runner materializes), "golden"
  // (pull-back through the golden hour).
  const CINE_DUR = { arrival: 13, gate: 6.5, signal: 12, golden: 9 };
  let cine = null; // { kind, t, dur, world }
  function startCine(kind, world) {
    cine = { kind, t: 0, dur: CINE_DUR[kind] || 8, world: world || null };
    return cine.dur;
  }
  function stopCine() {
    if (cine && cine.kind === "gate" && cine.world && gateInsts[cine.world]) gateInsts[cine.world].emissive = 0.5;
    cine = null;
  }
  function cineInfo() { return cine ? { kind: cine.kind, u: cine.t / cine.dur } : null; }

  // the Genesis Runner parked by the throne once the signal is recovered
  // (and materializing during the "signal" cine) · kit is built lazily
  // from the live roster palette so Golden Satoshi gilds it on rebuild
  let satKit = null, satPalette = null, parked = false;
  const SAT_POS = [7, Math.max(H(7, 4), 0), 4];
  const SAT_YAW = Math.atan2(-7, -6);
  function parkSatoshi(palette) {
    parked = !!palette;
    if (palette && palette !== satPalette) { satKit = null; satPalette = palette; }
  }
  function drawSatoshiKart(alpha, glowE) {
    if (!satKit) {
      if (!satPalette) return;
      const built = buildKartMesh("satoshi", satPalette);
      satKit = {};
      for (const ch of ["body", "trim", "hair", "arms", "steer", "glow", "wheel", "wheelHub"]) {
        satKit[ch] = built[ch] ? R.createMesh(built[ch]) : null;
      }
    }
    const m = M4.trs(SAT_POS[0], SAT_POS[1], SAT_POS[2], SAT_YAW, 0, 0, 1);
    const a = alpha < 1 ? Math.max(alpha, 0.04) : undefined;
    R.draw(satKit.body, m, { rim: 0.5, spec: 0.6, specPow: 30, metal: 0.3, sheen: 0.3, alpha: a });
    if (satKit.trim) R.draw(satKit.trim, m, { rim: 0.5, spec: 1.9, specPow: 90, metal: 1, sheen: 0.55, alpha: a });
    if (satKit.hair) R.draw(satKit.hair, m, { rim: 0.12, spec: 0.15, alpha: a });
    if (satKit.steer) R.draw(satKit.steer, m, { rim: 0.5, spec: 0.6, alpha: a });
    if (satKit.arms) R.draw(satKit.arms, m, { rim: 0.5, spec: 0.6, alpha: a });
    if (satKit.glow) R.draw(satKit.glow, m, { emissive: glowE, rim: 0.2, alpha: a });
    for (let i = 0; i < 4; i++) {
      const wp = WHEEL_POS[i];
      const wm = M4.mul(m, M4.trs(wp[0], wp[1], wp[2], 0, 0, 0, 1));
      R.draw(satKit.wheel, wm, { rim: 0.2, alpha: a });
      if (satKit.wheelHub) R.draw(satKit.wheelHub, wm, { rim: 0.35, spec: 1.9, specPow: 90, metal: 1, sheen: 0.55, alpha: a });
    }
  }

  // balloon ceremony: coming home with a fresh balloon pops a short
  // orange burst train over that world's gate (main.js calls celebrate)
  let partyT = 0, partyWorld = null, partyAcc = 0;
  function celebrate(world) {
    if (!DOOR_POS[world]) return;
    partyT = 1.8;
    partyWorld = world;
  }

  function update(dt) {
    if (partyT > 0 && partyWorld) {
      partyT -= dt;
      partyAcc += dt * 26;
      const [gx, gz] = DOOR_POS[partyWorld];
      const gy = Math.max(H(gx, gz), 0);
      while (partyAcc > 1) {
        partyAcc -= 1;
        const a = Math.random() * TAU, sp = 2.5 + Math.random() * 3.5;
        parts.spawn(gx + (Math.random() - 0.5) * 4, gy + 6 + Math.random() * 6, gz + (Math.random() - 0.5) * 4,
          Math.cos(a) * sp, 2.6 + Math.random() * 2.4, Math.sin(a) * sp, 1.4, 0.36, 1.0, 0.62, 0.15, 0.9, 4);
      }
    }
    sparkleT += dt;
    if (sparkleT > (golden ? 0.12 : 0.3)) {
      sparkleT = 0;
      const a = Math.random() * TAU, r = 20 + Math.random() * 50;
      // gold flecks when the timeline is 100% restored, else orange embers
      if (golden) parts.spawn(Math.cos(a) * r, 6 + Math.random() * 22, Math.sin(a) * r, 0, 0.7, 0, 2.6, 0.32, 1.0, 0.84, 0.32, 0.5, 0);
      else parts.spawn(Math.cos(a) * r, 6 + Math.random() * 14, Math.sin(a) * r, 0, 0.5, 0, 2.4, 0.3, 1.0, 0.62, 0.15, 0.4, 0);
    }
    // gold fireworks burst over the throne peak
    if (golden) {
      fwT += dt;
      if (fwT > 2.2) {
        fwT = 0;
        const bx = (Math.random() - 0.5) * 34, bz = -12 + (Math.random() - 0.5) * 30;
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * TAU, sp = 9 + Math.random() * 4;
          parts.spawn(bx, 26 + Math.random() * 6, bz, Math.cos(a) * sp, 3 + Math.random() * 2, Math.sin(a) * sp, 1.5, 0.4, 1.0, 0.86, 0.36, 0.9, 5);
        }
      }
    }
    parts.update(dt);
  }

  let prevRenderT = 0;
  function render(time) {
    const rdt = Math.min(Math.max(time - (prevRenderT || time), 0), 0.1);
    prevRenderT = time;
    const aspect = R.canvas.clientWidth / Math.max(R.canvas.clientHeight, 1);
    const orbit = time * 0.055;
    let eye = [Math.sin(orbit) * 120, 46 + Math.sin(time * 0.2) * 4, Math.cos(orbit) * 120];
    let target = [0, 8, 0];
    let satAlpha = parked ? 1 : 0, satGlow = 0.9;

    // cinematic camera override · every path blends back into the
    // autonomous orbit over the last 12% so the cut never pops
    if (cine) {
      cine.t += rdt;
      const u = Math.min(cine.t / cine.dur, 1);
      const e = u * u * (3 - 2 * u);
      const autoEye = eye, autoTgt = target;
      const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      if (cine.kind === "arrival") {
        // low ocean skim toward the Genesis gate, rise past Neon, reveal
        // the whole atoll · targets run gate to gate to the island heart
        const a = -1.6 + 2.6 * e;
        const r = 320 - 200 * e;
        const h = 6 + 40 * e * e;
        eye = [Math.sin(a) * r, h, Math.cos(a) * r];
        const keys = [
          [DOOR_POS.genesis[0], 7, DOOR_POS.genesis[1], 0.12],
          [DOOR_POS.neon[0], 7, DOOR_POS.neon[1], 0.42],
          [DOOR_POS.corporate[0], 9, DOOR_POS.corporate[1], 0.68],
          [0, 8, 0, 0.9],
        ];
        let tgt = [keys[0][0], keys[0][1], keys[0][2]];
        for (let i = 0; i < keys.length - 1; i++) {
          const k0 = keys[i][3], k1 = keys[i + 1][3];
          if (u >= k0) {
            const s = Math.min(Math.max((u - k0) / (k1 - k0), 0), 1);
            const ss = s * s * (3 - 2 * s);
            tgt = lerp3([keys[i][0], keys[i][1], keys[i][2]], [keys[i + 1][0], keys[i + 1][1], keys[i + 1][2]], ss);
          }
        }
        target = tgt;
      } else if (cine.kind === "gate" && cine.world) {
        const [gx, gz] = DOOR_POS[cine.world];
        const ga = Math.atan2(gx, gz);
        const gy = Math.max(H(gx, gz), 0);
        const k = Math.min(e * 1.5, 1);
        const a = orbit + (ga + 0.5 - orbit) * k;
        const r = 120 - 74 * k;
        eye = [Math.sin(a) * r, 46 - 32 * k, Math.cos(a) * r];
        target = lerp3([0, 8, 0], [gx, gy + 6, gz], k);
        // the surge: the gate core flares and sheds sparks
        const surge = u > 0.45 && u < 0.9 ? Math.sin(((u - 0.45) / 0.45) * Math.PI) : 0;
        gateInsts[cine.world].emissive = 0.5 + surge * 1.3;
        if (surge > 0.25) {
          const c = hex(DOOR_COLORS[cine.world]);
          parts.spawn(gx + (Math.random() - 0.5) * 8, gy + 2 + Math.random() * 9, gz + (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 3, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 3, 1.2, 0.34, c[0], c[1], c[2], 0.9, 2);
        }
      } else if (cine.kind === "signal") {
        // dive to the peak · the Genesis Runner materializes by the throne.
        // The eye lands just above the PEAK's terrain height, never under it
        const a = orbit + 1.2 * e;
        const r = 120 - 92 * e;
        const eh = 46 + (SAT_POS[1] + 3.2 - 46) * e;
        eye = [SAT_POS[0] + Math.sin(a) * r * 0.32, eh, SAT_POS[2] + Math.cos(a) * r * 0.32];
        target = lerp3([0, 8, 0], [SAT_POS[0], SAT_POS[1] + 1.3, SAT_POS[2]], Math.min(e * 1.6, 1));
        satAlpha = Math.min(Math.max((u - 0.32) / 0.38, 0), 1);
        satGlow = 0.4 + satAlpha * 1.1 + (u > 0.7 ? Math.sin(time * 6) * 0.25 : 0);
        if (satAlpha > 0.05 && satAlpha < 1) {
          const sa = Math.random() * TAU, sr = 1.5 + Math.random() * 2;
          parts.spawn(SAT_POS[0] + Math.cos(sa) * sr, SAT_POS[1] + 0.4 + Math.random() * 1.6, SAT_POS[2] + Math.sin(sa) * sr,
            -Math.cos(sa) * 0.8, 0.6, -Math.sin(sa) * 0.8, 1.1, 0.26, 0.18, 0.75, 0.42, 0.9, 0);
        }
      } else if (cine.kind === "golden") {
        // pull back through the golden hour · throne first, then the atoll
        // (start height clears the peak's own shoulder)
        const a = orbit + 1.6 * e;
        const r = 40 + 100 * e;
        eye = [Math.sin(a) * r, 24 + 28 * e, Math.cos(a) * r];
        target = lerp3([0, Math.max(H(0, -2), 0) + 6, -2], [0, 10, 0], e);
      }
      if (u > 0.88) {
        const k = (u - 0.88) / 0.12;
        eye = lerp3(eye, autoEye, k * k);
        target = lerp3(target, autoTgt, k * k);
      }
      if (u >= 1) stopCine();
    }
    const env = makeEnv(eye, target, (50 * Math.PI) / 180, aspect, golden ? GOLDEN_ENV : ATOLL_ENV, time);

    // the Ratio Bear only moves while the camera cannot see it · a
    // generous visibility cone (the 50° fov plus margin) so it never
    // visibly slides. Reaching the throne resets it to the beach.
    {
      const fwd = V3.norm(V3.sub(target, eye));
      const toBear = V3.norm(V3.sub([ratioBear.x, 8, ratioBear.z], eye));
      const seen = fwd[0] * toBear[0] + fwd[1] * toBear[1] + fwd[2] * toBear[2] > 0.55;
      if (!seen) {
        ratioBear.prog += rdt * 0.012; // a full creep takes ~80s of blind time
        if (ratioBear.prog >= 0.92) ratioBear.prog = 0; // never quite the throne
        const [bx, bz] = bearPos(ratioBear.prog);
        ratioBear.yaw = Math.atan2(-bx, -2 - bz); // always facing the throne
        ratioBear.x = bx; ratioBear.z = bz;
      }
    }

    R.begin(env);
    R.draw(island, M4.ident(), { rim: 0 });
    R.drawWater(water, golden ? [0.16, 0.11, 0.05] : [0.05, 0.32, 0.45], golden ? [0.7, 0.5, 0.24] : [0.25, 0.7, 0.72]);
    // golden hour gilds the throne (Satoshi enthroned) with a strong glow
    for (const inst of instances) R.draw(inst.mesh, inst.model, { emissive: golden && inst === throneInst ? 0.85 : inst.emissive, rim: golden ? 0.4 : 0.25 });
    R.draw(fudBear, M4.trs(ratioBear.x, Math.max(H(ratioBear.x, ratioBear.z), 0), ratioBear.z, ratioBear.yaw, 0, 0, 1.25), { emissive: 0.08, rim: 0.5 });
    if (satAlpha > 0) drawSatoshiKart(satAlpha, satGlow); // the Genesis Runner by the throne
    R.draw(gagSignFrame, gagSignModel, { rim: 0.25 });
    R.drawTextured(gagSignPanel, gagSignModel, gagSignTex, { lit: true });
    for (const b of balloons) {
      // golden hour: the balloons lift high into the gold light and glow ·
      // a smooth drift (no sawtooth teleport · review 2026-07-18)
      const lift = golden ? 11 + Math.sin(time * 0.32 + b.phase) * 4 : 0;
      const y = b.base + lift + Math.sin(time * 0.8 + b.phase) * 1.2;
      R.draw(balloon, M4.trs(b.x, y, b.z, time * 0.3 + b.phase, 0, 0, 1.4), { emissive: golden ? 0.6 : 0.35, rim: golden ? 0.6 : 0.4 });
    }
    parts.draw(true);
    R.present();
  }

  return { update, render, setGolden, startCine, stopCine, cineInfo, parkSatoshi, celebrate };
}
