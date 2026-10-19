// SIX DEEP · gray-box core loop (cabinet #8 candidate · 2026-07-27)
//
// THE FUN GATE BUILD. Two verbs over a seeded corridor:
//   · lane-change  (◀ ▶ / tap halves)   — 3 lanes
//   · depth-dive   (▲ ▼ / swipe)        — 3 layers: 0-CONF / 3-CONF / 6-CONF
// Shallow is FAST and crowded, deep is SLOW and clear (the ambient
// education: that is literally what confirmations are). A SEAL GATE
// every block-length has one gap · thread it = +1 DEEP (the score).
//
// LIVE SEED: the world derives from the real chain tip via our own
// CDN-cached /api/heartbeat (114 bytes, CORS-open) · a new block on
// the network means the next drop-in is a genuinely new world. Block
// ARRIVAL mid-run is deliberately just a flash beat, never the loop
// (P(block lands in a 90s run) ≈ 14% · Poisson, measured 2026-07-26).
//
// Fixed-timestep sim (120 Hz) with render interpolation · inputs are
// DISCRETE (lane/layer indices), which keeps the door open to the
// input-tape replay posture if this graduates to a real cabinet.

import { createRenderer, makeEnv } from "./gl.js";
import { M4 } from "./math3d.js";

const canvas = document.getElementById("gl");
const R = createRenderer(canvas);
const $ = (id) => document.getElementById(id);

if (!R) {
  $("world").textContent = "WEBGL2 UNAVAILABLE";
  $("go").disabled = true;
  throw new Error("no webgl2");
}

// ── world preset (track.js SKIES shape · corridor night) ────────────
const WORLD = {
  sunDir: (() => { const v = [0.25, 0.8, -0.4], l = Math.hypot(...v); return v.map((x) => x / l); })(),
  sunCol: [0.9, 0.82, 0.7],
  hemiSky: [0.2, 0.24, 0.34],
  hemiGround: [0.1, 0.09, 0.12],
  skyTop: [0.03, 0.04, 0.09],
  skyHorizon: [0.22, 0.13, 0.05],
  skyGround: [0.05, 0.04, 0.05],
  sunTint: [1.0, 0.62, 0.15],
  fogCol: [0.05, 0.045, 0.07],
  fogNear: 60,
  fogFar: 200,
  rimCol: [1.0, 0.62, 0.15],
};

// ── tuning ──────────────────────────────────────────────────────────
const STEP = 1 / 120;
const LANES = [-3.6, 0, 3.6];
const LAYERS = [0, -4.2, -8.4]; // 0-conf · 3-conf · 6-conf
const LAYER_LABEL = [
  "0-CONF · FAST · EXPOSED",
  "3-CONF · STEADY",
  "6-CONF · SAFE · SLOW",
];
const LAYER_SPEED = [1.18, 1.0, 0.84];
const LAYER_DENSITY = [0.36, 0.22, 0.11];
const ROW_GAP = 7;          // corridor units between obstacle rows
const BLOCK_LEN = 210;      // one block of corridor = one confirmation
const BASE_SPEED = 26;
const SHIP_Z = 0;

// ── deterministic prng ──────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── meshes (flat-shaded boxes · this IS the gray-box) ───────────────
function boxMesh(w, h, d, rgba, faceTint) {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const P = [], N = [], C = [], I = [];
  const F = [
    [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd], [0, 0, 1]],
    [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd], [0, 0, -1]],
    [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd], [1, 0, 0]],
    [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd], [-1, 0, 0]],
    [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd], [0, 1, 0]],
    [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd], [0, -1, 0]],
  ];
  F.forEach((f, fi) => {
    const base = P.length / 3;
    const tint = faceTint ? faceTint(fi) : 1;
    for (let v = 0; v < 4; v++) {
      P.push(...f[v]); N.push(...f[4]);
      C.push(rgba[0] * tint, rgba[1] * tint, rgba[2] * tint, rgba[3]);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return R.createMesh({
    pos: new Float32Array(P), norm: new Float32Array(N),
    col: new Float32Array(C), idx: new Uint16Array(I),
  });
}

const slabMesh = boxMesh(3.1, 3.4, 3.1, [0.32, 0.33, 0.38, 1]);
const wallMesh = boxMesh(3.3, 3.8, 1.6, [0.14, 0.12, 0.2, 1]);
const gapMesh = boxMesh(3.3, 3.8, 1.6, [1.0, 0.62, 0.15, 1]);
const shipMesh = boxMesh(1.5, 0.7, 2.4, [0.92, 0.55, 0.14, 1], (fi) => (fi === 1 ? 1.6 : 1));
const floorMesh = boxMesh(16, 0.4, 260, [0.07, 0.07, 0.1, 1]);
const sparks = R.createParticles(320);

// ── live seed ───────────────────────────────────────────────────────
let tipHeight = null;
let seed = (Date.now() / 86400000) | 0; // offline fallback · date
let runBump = 0;
async function syncTip() {
  try {
    const r = await fetch("/api/heartbeat", { cache: "no-store" });
    const j = await r.json();
    if (j && typeof j.blockHeight === "number" && j.blockHeight > 0) {
      tipHeight = j.blockHeight;
      seed = j.blockHeight;
      const label = "BLOCK " + j.blockHeight.toLocaleString("en-US");
      $("world").textContent = label;
      $("worldline").textContent = "world · " + label + " · a new block mints a new world";
    }
  } catch {
    $("world").textContent = "OFFLINE WORLD";
    $("worldline").textContent = "world · offline seed (the chain is unreachable)";
  }
}
syncTip();
setInterval(syncTip, 30000); // heartbeat is CDN-cached · this is free

// ── world generation (pure function of seed) ────────────────────────
function buildWorld(s) {
  const rnd = mulberry32((s ^ 0x5eed) >>> 0);
  const rows = [];   // {z, cells: bool[layer][lane]}
  const gates = [];  // {z, gapLane, gapLayer}
  const BLOCKS = 40; // effectively endless for a run
  for (let b = 0; b < BLOCKS; b++) {
    const start = 40 + b * BLOCK_LEN;
    const gateZ = start + BLOCK_LEN - 12;
    gates.push({ z: gateZ, gapLane: (rnd() * 3) | 0, gapLayer: (rnd() * 3) | 0 });
    // obstacle rows live INSIDE the block with guaranteed clear air:
    // 16u after the previous gate, 52u of clean approach before this
    // one · the approach must fit a full LAYER DIVE to the gap (the
    // gray-box pilot died seating into the last row at 30u · a human
    // reading the gate late needs the same room)
    for (let z = start + 16; z < gateZ - 52; z += ROW_GAP) {
      const cells = [];
      for (let ly = 0; ly < 3; ly++) {
        const row = [];
        for (let ln = 0; ln < 3; ln++) row.push(rnd() < LAYER_DENSITY[ly]);
        // never wall off a whole layer row · always leave an out
        if (row[0] && row[1] && row[2]) row[(rnd() * 3) | 0] = false;
        cells.push(row);
      }
      rows.push({ z, cells });
    }
  }
  return { rows, gates };
}

// ── game state ──────────────────────────────────────────────────────
const S = {
  phase: "menu", // menu | run | dead
  world: null,
  dist: 0, deep: 0, speed: BASE_SPEED,
  lane: 1, layer: 0,
  x: 0, y: 0,           // smoothed ship position
  px: 0, py: 0,         // previous (render interpolation)
  shake: 0, flash: 0,
  t: 0,
};

function startRun(sameSeed) {
  if (!sameSeed) runBump++;
  const s = (seed + (sameSeed ? runBump : runBump)) >>> 0;
  S.world = buildWorld(s);
  S.phase = "run";
  S.dist = 0; S.deep = 0; S.speed = BASE_SPEED;
  S.lane = 1; S.layer = 0;
  S.x = LANES[1]; S.y = LAYERS[0];
  S.shake = 0; S.flash = 0;
  sparks.clear();
  $("overlay").style.display = "none";
  $("results").hidden = true;
  $("depth").textContent = "0 DEEP";
  $("layer").textContent = LAYER_LABEL[0];
}

function die() {
  S.phase = "dead";
  S.shake = 1;
  for (let i = 0; i < 90; i++) {
    sparks.spawn(S.x, S.y + 0.6, SHIP_Z, (Math.random() - 0.5) * 16, Math.random() * 12,
      (Math.random() - 0.5) * 16, 0.9 + Math.random() * 0.6, 0.28, 1.0, 0.62, 0.15, 1, -14, 4);
  }
  $("score").textContent = S.deep + " DEEP";
  $("detail").textContent =
    (tipHeight ? "world · block " + tipHeight.toLocaleString("en-US") + " · " : "") +
    Math.round(S.dist) + "m survived · reorg at " + LAYER_LABEL[S.layer].split(" ·")[0];
  setTimeout(() => { $("results").hidden = false; }, 550);
}

// ── input (discrete verbs only) ─────────────────────────────────────
function move(dl) { if (S.phase === "run") S.lane = Math.max(0, Math.min(2, S.lane + dl)); }
function dive(dy) {
  if (S.phase !== "run") return;
  S.layer = Math.max(0, Math.min(2, S.layer + dy));
  $("layer").textContent = LAYER_LABEL[S.layer];
}
addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "a") move(-1);
  else if (e.key === "ArrowRight" || e.key === "d") move(1);
  else if (e.key === "ArrowDown" || e.key === "s") dive(1);
  else if (e.key === "ArrowUp" || e.key === "w") dive(-1);
  else if (e.key === " " && S.phase === "menu") startRun(false);
});
let touchY0 = null, touchX0 = null, touchMoved = false;
addEventListener("pointerdown", (e) => { touchX0 = e.clientX; touchY0 = e.clientY; touchMoved = false; });
addEventListener("pointermove", (e) => {
  if (touchY0 === null) return;
  const dy = e.clientY - touchY0;
  if (Math.abs(dy) > 42 && !touchMoved) { dive(dy > 0 ? 1 : -1); touchMoved = true; }
});
addEventListener("pointerup", (e) => {
  if (touchY0 !== null && !touchMoved && S.phase === "run") {
    move(e.clientX < innerWidth / 2 ? -1 : 1);
  }
  touchY0 = null;
});
$("go").addEventListener("click", () => startRun(false));
$("retry").addEventListener("click", () => startRun(true));
$("fresh").addEventListener("click", () => startRun(false));

// ── sim (fixed timestep) ────────────────────────────────────────────
function sim() {
  const v = S.speed * LAYER_SPEED[S.layer];
  S.dist += v * STEP;
  // smooth ship toward its lane/layer cell (critically-damped-ish)
  const k = 1 - Math.exp(-14 * STEP);
  S.x += (LANES[S.lane] - S.x) * k;
  S.y += (LAYERS[S.layer] - S.y) * k;
  S.shake = Math.max(0, S.shake - STEP * 2.4);
  S.flash = Math.max(0, S.flash - STEP * 2);

  const W = S.world;
  // Mid-dive frames are SAFE: while the ship is far from any layer's
  // seat it phases through slab rows · diving THROUGH a wall row is a
  // deliberate skill verb, and it kills the unfair transit clip.
  const seated = Math.abs(S.y - LAYERS[S.layer]) < 1.6;
  // obstacle collision + near miss (rows near the ship)
  for (const row of W.rows) {
    const rz = row.z - S.dist;
    if (rz < -3 || rz > 3.2) continue;
    for (let ly = 0; ly < 3; ly++) {
      for (let ln = 0; ln < 3; ln++) {
        if (!row.cells[ly][ln]) continue;
        const dx = Math.abs(S.x - LANES[ln]);
        const dyy = Math.abs(S.y - LAYERS[ly]);
        if (rz > -1.6 && rz < 1.6) {
          if (seated && dx < 2.2 && dyy < 2.0) { die(); return; }
          if (dx < 3.4 && dyy < 3.0) {
            // near miss · a puff of orange off the slab edge
            sparks.spawn(LANES[ln] + (S.x < LANES[ln] ? -1.7 : 1.7), LAYERS[ly] + 1,
              SHIP_Z + rz, (Math.random() - 0.5) * 4, 3, -v * 0.4, 0.4, 0.16, 1, 0.62, 0.15, 0.9, 0, 6);
          }
        }
      }
    }
  }
  // seal gates
  for (const g of W.gates) {
    const gz = g.z - S.dist;
    if (gz > -1.4 && gz < 1.4) {
      const inGap = S.lane === g.gapLane && S.layer === g.gapLayer;
      if (!inGap) { die(); return; }
      if (!g.passed) {
        g.passed = true;
        S.deep++;
        S.speed = Math.min(62, S.speed * 1.045);
        S.flash = 1;
        $("depth").textContent = S.deep + " DEEP";
        for (let i = 0; i < 40; i++) {
          sparks.spawn(S.x, S.y + 0.5, SHIP_Z + 1.5, (Math.random() - 0.5) * 10,
            (Math.random() - 0.2) * 8, 6 + Math.random() * 6, 0.7, 0.22, 1, 0.62, 0.15, 1, -6, 5);
        }
      }
    }
  }
}

// ── render ──────────────────────────────────────────────────────────
let acc = 0, lastT = 0;
function frame(tms) {
  requestAnimationFrame(frame);
  const t = tms / 1000;
  let dt = t - lastT; lastT = t;
  if (dt > 0.25 || dt <= 0) dt = STEP;
  if (S.phase === "run") {
    acc += dt;
    while (acc >= STEP) { sim(); acc -= STEP; if (S.phase !== "run") { acc = 0; break; } }
  }
  sparks.update(dt);
  S.t = t;

  const shake = S.shake * S.shake;
  const cx = S.x * 0.6 + Math.sin(t * 31) * shake * 0.5;
  // high-and-back chase · the dodge game IS read-ahead, so the camera
  // must show 3-4 rows and the next gate, not the ship's bumper
  const cy = S.y + 4.6 + Math.sin(t * 27) * shake * 0.4;
  const camPos = [cx, cy, SHIP_Z - 11.5];
  const camTarget = [S.x * 0.85, S.y + 0.2, SHIP_Z + 16];
  const fov = 62 + Math.min(10, (S.speed - BASE_SPEED) * 0.28) + S.flash * 3;
  const env = makeEnv(camPos, camTarget, (fov * Math.PI) / 180, canvas.width / canvas.height, WORLD, t, 0);
  R.begin(env);

  // corridor floors · one strip under every layer (depth readability)
  for (let ly = 0; ly < 3; ly++) {
    R.draw(floorMesh, M4.trs(0, LAYERS[ly] - 2.1, SHIP_Z + 104, 0, 0, 0, 1), { rim: 0.1 });
  }
  // obstacle rows ahead
  const W = S.world;
  if (W) {
    for (const row of W.rows) {
      const rz = row.z - S.dist;
      if (rz < -6 || rz > 190) continue;
      for (let ly = 0; ly < 3; ly++) {
        for (let ln = 0; ln < 3; ln++) {
          if (!row.cells[ly][ln]) continue;
          R.draw(slabMesh, M4.trs(LANES[ln], LAYERS[ly] + 1.4, SHIP_Z + rz, 0, 0, 0, 1), { rim: 0.25 });
        }
      }
    }
    for (const g of W.gates) {
      const gz = g.z - S.dist;
      if (gz < -6 || gz > 190) continue;
      for (let ly = 0; ly < 3; ly++) {
        for (let ln = 0; ln < 3; ln++) {
          const gap = ln === g.gapLane && ly === g.gapLayer;
          const m = M4.trs(LANES[ln], LAYERS[ly] + 1.6, SHIP_Z + gz, 0, 0, 0, 1);
          if (gap) {
            // the way through reads as an orange portal · pass-through
            // pane (alpha blend, no depth write) + a beacon cube above
            R.draw(gapMesh, m, { alpha: 0.26, emissive: 1.0, rim: 0 });
            R.draw(gapMesh, M4.trs(LANES[ln], LAYERS[ly] + 4.2, SHIP_Z + gz, S.t * 1.4, 0, 0, 0.16), { emissive: 1.2 });
          } else {
            R.draw(wallMesh, m, { rim: 0.4 });
          }
        }
      }
    }
  }
  // ship
  if (S.phase !== "dead") {
    const bank = (LANES[S.lane] - S.x) * -0.14;
    const shipM = M4.trs(S.x, S.y + 0.55, SHIP_Z, 0, 0, bank, 1);
    R.draw(shipMesh, shipM, { emissive: 0.5, rim: 1.2, spec: 0.5 });
    R.glow(shipMesh, shipM, 0.55);
  }
  sparks.draw(true);
  R.present({ warp: S.flash * 0.35, grade: { gain: [1, 1, 1], lift: [S.flash * 0.05, S.flash * 0.02, 0] } });
}

addEventListener("resize", () => R.resize());
R.resize();
requestAnimationFrame(frame);

// debug/verification handle (never surfaced in UI · kart __BK_RACE pattern)
window.__SIX = { S, startRun, move, dive, LANES, LAYERS, BLOCK_LEN };
