// BITCOIN KART · select.js
// The 3D showroom: a kart on a lit podium, orbiting camera, orange rim
// light. Doubles as the title-screen backdrop. The DOM grid around it is
// built in main.js; this module only owns the turntable scene.

import { M4, V3, TAU } from "./math3d.js";
import { makeEnv } from "./gl.js";
import { WHEEL_POS, meshBuilder, hex, shade, blobShadowMesh } from "./geometry.js";
import { kartGL } from "./race.js";

const SHOWROOM_ENV = {
  sunDir: V3.norm([0.35, 0.8, 0.45]),
  sunCol: [0.95, 0.9, 0.82],
  hemiSky: [0.22, 0.2, 0.26],
  hemiGround: [0.1, 0.08, 0.08],
  skyTop: [0.02, 0.02, 0.028],
  skyHorizon: [0.12, 0.07, 0.03],
  skyGround: [0.05, 0.04, 0.04],
  sunTint: [0.9, 0.6, 0.25],
  fogCol: [0.03, 0.03, 0.04],
  fogNear: 42,
  fogFar: 140,
  rimCol: [1.0, 0.62, 0.15],
};
// title + menu run a warmer, hotter-rim variant of the same stage so the
// attract sequence reads more cinematic than the clean pick-a-racer view
const HERO_ENV = {
  ...SHOWROOM_ENV,
  skyHorizon: [0.17, 0.09, 0.035],
  hemiSky: [0.24, 0.21, 0.28],
  sunTint: [1.0, 0.66, 0.28],
  rimCol: [1.0, 0.68, 0.22],
};

export function createShowroom(R) {
  // stepped, machined podium: three dark metal tiers with the top surface
  // parked at y~0.61 so the driver still sits on the deck (kart draws at
  // y=0.58, exactly as before)
  const pod = meshBuilder();
  pod.cyl(0, 0, 0, 3.9, 3.7, 0.22, 30, hex("#151519"), { topColor: hex("#202027") });
  pod.cyl(0, 0.22, 0, 3.5, 3.3, 0.22, 30, hex("#1A1A20"), { topColor: hex("#26262E") });
  pod.cyl(0, 0.44, 0, 3.15, 3.02, 0.17, 30, hex("#202028"), { topColor: hex("#2E2E37") });
  const podium = R.createMesh(pod.build());

  // emissive orange rim lines on each step edge (bloom feed · top brightest)
  const pr = meshBuilder();
  pr.cyl(0, 0.575, 0, 3.07, 3.07, 0.05, 30, hex("#F7931A"), { capBot: false, capTop: false });
  pr.cyl(0, 0.40, 0, 3.4, 3.4, 0.04, 30, hex("#F7931A"), { capBot: false, capTop: false });
  pr.cyl(0, 0.185, 0, 3.82, 3.82, 0.04, 30, hex("#F7931A"), { capBot: false, capTop: false });
  const podRings = R.createMesh(pr.build());

  // richer floor: a dark radial pinwheel disk (subtle spokes, not a checker)
  const floorB = meshBuilder();
  const segs = 36, R0 = 72;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
    floorB.pushTri(
      [0, -0.01, 0],
      [Math.cos(a1) * R0, -0.01, Math.sin(a1) * R0],
      [Math.cos(a0) * R0, -0.01, Math.sin(a0) * R0],
      i % 2 ? hex("#0C0C0F") : hex("#101014"),
    );
  }
  const floor = R.createMesh(floorB.build());

  // concentric arena rings: orange for Team Bitcoin, cool steel for Team
  // Fiat · thin standing bands so the down-tilted camera reads them as
  // glowing lines on the floor (the proven ground-ring pattern)
  const gob = meshBuilder();
  gob.cyl(0, 0.02, 0, 8.2, 8.2, 0.06, 44, hex("#F7931A"), { capBot: false });
  gob.cyl(0, 0.02, 0, 15.5, 15.5, 0.05, 56, hex("#F7931A"), { capBot: false });
  const groundOrange = R.createMesh(gob.build());
  const gsb = meshBuilder();
  gsb.cyl(0, 0.02, 0, 11.4, 11.4, 0.05, 48, hex("#3A3A46"), { capBot: false });
  gsb.cyl(0, 0.02, 0, 20.0, 20.0, 0.05, 64, hex("#2C2C36"), { capBot: false });
  const groundSteel = R.createMesh(gsb.build());

  const shadow = R.createMesh(blobShadowMesh());

  let current = null;
  let spin = 0;
  let mode = "title"; // "title" | "menu" | "select"
  let partTimer = 0;
  const parts = R.createParticles(96);

  // the front door drives the stage through modes: TITLE is the cinematic
  // hero shot, MENU is a wider/higher frame so the glass panel never buries
  // the kart, SELECT is the clean turntable the racer picker has always used
  function setMode(m) { mode = m; }

  function setDriver(id, palette) {
    // shared session cache with the race (kartGL) · the showroom used to
    // duplicate every kart texture on its own
    current = kartGL(R, { id, palette });
  }

  function update(dt, reduceFx) {
    // a gentle turntable always spins (kept slow under reduceFx so the racer
    // picker stays readable), but rising embers only spawn when motion is on
    spin += dt * (reduceFx ? 0.2 : 0.55);
    if (reduceFx) { parts.update(dt); return; }
    partTimer += dt;
    const rate = mode === "title" ? 0.05 : mode === "menu" ? 0.09 : 0.18;
    while (partTimer > rate) {
      partTimer -= rate;
      const a = Math.random() * TAU;
      const r = 1.2 + Math.random() * 4.2;
      const warm = Math.random();
      parts.spawn(
        Math.cos(a) * r, 0.2 + Math.random() * 0.8, Math.sin(a) * r,
        (Math.random() - 0.5) * 0.14, 0.5 + Math.random() * 0.7, (Math.random() - 0.5) * 0.14,
        1.8 + Math.random() * 1.3, 0.12 + Math.random() * 0.16,
        1.0, 0.55 + warm * 0.25, 0.12 + warm * 0.16, 0.55, 0.15, 0,
      );
    }
    parts.update(dt);
  }

  function render(time, reduceFx) {
    const aspect = R.canvas.clientWidth / Math.max(R.canvas.clientHeight, 1);
    let orbit, dist, eyeY, targetY = 1.05, bob = 0;
    if (mode === "title") {
      orbit = reduceFx ? 0.62 : time * 0.11;
      dist = 8.0; eyeY = 2.85; targetY = 0.85;
      bob = reduceFx ? 0 : Math.sin(time * 0.5) * 0.16;
    } else if (mode === "menu") {
      orbit = reduceFx ? 0.72 : time * 0.09 + 0.5;
      dist = 8.9; eyeY = 3.15; targetY = 1.1;
      bob = reduceFx ? 0 : Math.sin(time * 0.42) * 0.12;
    } else {
      orbit = 0.55; dist = 7.6; eyeY = 2.6;
      bob = reduceFx ? 0 : Math.sin(time * 0.4) * 0.25;
    }
    const eye = [Math.sin(orbit) * dist, eyeY + bob, Math.cos(orbit) * dist];
    const cine = mode !== "select";
    const env = makeEnv(eye, [0, targetY, 0], (50 * Math.PI) / 180, aspect, cine ? HERO_ENV : SHOWROOM_ENV, time);
    R.begin(env);
    R.draw(floor, M4.ident(), { rim: 0 });
    R.draw(groundSteel, M4.ident(), { rim: 0.5, spec: 0.35, alpha: 0.72 });
    R.draw(groundOrange, M4.ident(), { emissive: cine ? 0.42 : 0.45, alpha: 0.4 });
    R.draw(podium, M4.ident(), { rim: 0.4, spec: 0.3 });
    R.draw(podRings, M4.ident(), { emissive: cine ? 0.7 : 0.6 });
    if (current) {
      const kr = cine ? 1.05 : 0.9;
      const m = M4.trs(0, 0.58, 0, spin, 0, 0, 1);
      R.draw(current.body, m, { rim: kr, spec: 0.9, specPow: 30, metal: 0.3, sheen: 0.35 });
      if (current.trim) R.draw(current.trim, m, { rim: 0.8, spec: 1.9, specPow: 90, metal: 1, sheen: 0.65 });
      if (current.glow) R.draw(current.glow, m, { emissive: 0.85, rim: 0.2 });
      if (current.steer) R.draw(current.steer, m, { rim: kr, spec: 0.9, sheen: 0.25 });
      if (current.arms) R.draw(current.arms, m, { rim: kr, spec: 0.9, sheen: 0.25 });
      if (current.head) {
        const hm = M4.mul(m, M4.trs(current.head.offset[0], current.head.offset[1], current.head.offset[2], 0, 0, 0, 1));
        R.drawTextured(current.head.mesh, hm, current.head.tex, { lit: true });
        if (current.hair) R.draw(current.hair, hm, { rim: 0.12, spec: 0.15 });
      } else if (current.hair) {
        R.draw(current.hair, m, { rim: 0.12, spec: 0.15 }); // matte fabric, headless karts
      }
      for (let i = 0; i < 4; i++) {
        const wp = WHEEL_POS[i];
        const wm = M4.mul(m, M4.trs(wp[0], wp[1], wp[2], 0, 0, 0, 1));
        R.draw(current.wheel, wm, { rim: 0.3 });
        // hub is a separate submesh because metal/specPow are per-draw ·
        // the turntable is where the machined rim has to sell itself
        if (current.wheelHub) R.draw(current.wheelHub, wm, { rim: 0.35, spec: 1.9, specPow: 90, metal: 1, sheen: 0.6 });
      }
      R.draw(shadow, M4.trs(0, 0.6, 0, 0, 0, 0, 1.5), { alpha: 0.99, rim: 0 });
    }
    parts.draw(true);
    R.present();
  }

  return { setDriver, setMode, update, render };
}

export function statBars(stats) {
  // returns [label, value][] in display order
  return [
    ["SPEED", stats.speed],
    ["ACCEL", stats.accel],
    ["HANDLING", stats.handling],
    ["WEIGHT", stats.weight],
    ["ITEM LUCK", stats.itemLuck],
  ];
}

export { shade };
