// BITCOIN KART · track.js
// Turns a track definition (data.js) into meshes + gameplay geometry:
// road ribbon, rumble strips, walls, terrain heightfield flattened near the
// road, water, prop instances, billboards, item boxes, boost pads, sats,
// obstacles, start grid, minimap polyline and the AI racing line.

import { catmullRom, V3, M4, clamp, TAU, hash01 } from "./math3d.js";
import {
  meshBuilder, PROP_BUILDERS, billboardFrame, billboardPanelUV,
  makeSignCanvas, hex, shade,
} from "./geometry.js";

// world lighting/sky presets keyed by def.sky
const SKIES = {
  day: {
    sunDir: V3.norm([0.45, 0.75, 0.35]), sunCol: [1.02, 0.98, 0.88],
    hemiSky: [0.5, 0.6, 0.72], hemiGround: [0.42, 0.38, 0.3],
    skyTop: [0.3, 0.58, 0.95], skyHorizon: [0.74, 0.87, 0.98], skyGround: [0.5, 0.68, 0.8],
    sunTint: [1, 0.95, 0.75], fogCol: [0.74, 0.87, 0.98], fogNear: 110, fogFar: 330,
  },
  rain: {
    sunDir: V3.norm([0.2, 0.8, 0.3]), sunCol: [0.5, 0.53, 0.58],
    hemiSky: [0.42, 0.46, 0.52], hemiGround: [0.3, 0.3, 0.33],
    skyTop: [0.3, 0.35, 0.42], skyHorizon: [0.55, 0.59, 0.66], skyGround: [0.4, 0.44, 0.5],
    sunTint: [0.4, 0.42, 0.45], fogCol: [0.55, 0.59, 0.66], fogNear: 70, fogFar: 240,
  },
  snow: {
    sunDir: V3.norm([0.3, 0.7, 0.45]), sunCol: [0.85, 0.88, 0.95],
    hemiSky: [0.6, 0.68, 0.8], hemiGround: [0.55, 0.58, 0.66],
    skyTop: [0.45, 0.6, 0.8], skyHorizon: [0.82, 0.88, 0.95], skyGround: [0.7, 0.76, 0.85],
    sunTint: [0.9, 0.9, 0.85], fogCol: [0.82, 0.88, 0.95], fogNear: 80, fogFar: 260,
  },
  fog: {
    sunDir: V3.norm([0.2, 0.85, 0.2]), sunCol: [0.5, 0.5, 0.56],
    hemiSky: [0.45, 0.46, 0.54], hemiGround: [0.3, 0.3, 0.36],
    skyTop: [0.4, 0.42, 0.5], skyHorizon: [0.58, 0.59, 0.66], skyGround: [0.45, 0.46, 0.52],
    sunTint: [0.5, 0.5, 0.5], fogCol: [0.58, 0.59, 0.66], fogNear: 32, fogFar: 150,
  },
  night: {
    sunDir: V3.norm([-0.3, 0.75, 0.4]), sunCol: [0.25, 0.26, 0.38],
    hemiSky: [0.16, 0.15, 0.28], hemiGround: [0.1, 0.08, 0.16],
    skyTop: [0.015, 0.015, 0.05], skyHorizon: [0.12, 0.07, 0.2], skyGround: [0.06, 0.05, 0.12],
    sunTint: [0.7, 0.75, 0.95], fogCol: [0.07, 0.05, 0.13], fogNear: 85, fogFar: 300,
  },
  dusk: {
    sunDir: V3.norm([-0.6, 0.3, 0.35]), sunCol: [1.0, 0.6, 0.35],
    hemiSky: [0.4, 0.3, 0.42], hemiGround: [0.3, 0.22, 0.24],
    skyTop: [0.22, 0.12, 0.32], skyHorizon: [0.95, 0.5, 0.3], skyGround: [0.5, 0.28, 0.24],
    sunTint: [1.1, 0.55, 0.25], fogCol: [0.5, 0.3, 0.32], fogNear: 90, fogFar: 300,
  },
  dawn: {
    sunDir: V3.norm([0.7, 0.35, 0.2]), sunCol: [1.05, 0.85, 0.6],
    hemiSky: [0.5, 0.55, 0.72], hemiGround: [0.42, 0.36, 0.34],
    skyTop: [0.35, 0.5, 0.85], skyHorizon: [1.0, 0.72, 0.45], skyGround: [0.6, 0.5, 0.45],
    sunTint: [1.15, 0.8, 0.45], fogCol: [0.8, 0.68, 0.58], fogNear: 110, fogFar: 340,
  },
  aurora: {
    sunDir: V3.norm([0.2, 0.6, -0.5]), sunCol: [0.45, 0.6, 0.6],
    hemiSky: [0.2, 0.4, 0.38], hemiGround: [0.14, 0.16, 0.2],
    skyTop: [0.02, 0.1, 0.09], skyHorizon: [0.12, 0.4, 0.34], skyGround: [0.08, 0.16, 0.16],
    sunTint: [1.1, 0.6, 0.2], fogCol: [0.1, 0.24, 0.22], fogNear: 100, fogFar: 320,
  },
  mine: {
    sunDir: V3.norm([0.2, 0.9, 0.1]), sunCol: [0.85, 0.6, 0.3],
    hemiSky: [0.3, 0.2, 0.1], hemiGround: [0.2, 0.12, 0.06],
    skyTop: [0.07, 0.045, 0.03], skyHorizon: [0.28, 0.16, 0.06], skyGround: [0.16, 0.1, 0.05],
    sunTint: [1.0, 0.7, 0.3], fogCol: [0.2, 0.12, 0.06], fogNear: 60, fogFar: 220,
  },
};

// per-theme ground/road palette + surface label for physics
const GROUNDS = {
  beach: { road: "#3A3A40", off: "#E0C186", off2: "#CBA968", surface: "sand", wall: "#C7A56A", water: { deep: [0.05, 0.32, 0.45], shallow: [0.25, 0.7, 0.72], level: -0.9 }, island: 210 },
  circuit: { road: "#33343B", off: "#4C8A4C", off2: "#3F7440", surface: "grass", wall: "#8A8E98" },
  docks: { road: "#2F3138", off: "#4A4E58", off2: "#41454E", surface: "wet", wall: "#5A4A3A", water: { deep: [0.05, 0.14, 0.2], shallow: [0.2, 0.32, 0.38], level: -1.0 }, island: 190 },
  winter: { road: "#3E4250", off: "#EDF2FA", off2: "#D6E2F0", surface: "snow", wall: "#9CB6C8" },
  fog: { road: "#2C2D34", off: "#3A3C46", off2: "#33353E", surface: "city", wall: "#4A4E5A" },
  neoncity: { road: "#26262E", off: "#33313E", off2: "#2B2936", surface: "city", wall: "#3A3648" },
  printer: { road: "#2E2C33", off: "#413B34", off2: "#38332D", surface: "city", wall: "#55483A" },
  blimp: { road: "#28282F", off: "#34323C", off2: "#2C2A34", surface: "city", wall: "#3E3A48" },
  glass: { road: "#33363F", off: "#8B93A4", off2: "#7A8294", surface: "marble", wall: "#6E7A8E" },
  etf: { road: "#35333C", off: "#7D7386", off2: "#6E6478", surface: "marble", wall: "#8A8098" },
  peak: { road: "#3C3A42", off: "#7C7370", off2: "#6B625E", surface: "rock", wall: "#5E5652" },
  goldmine: { road: "#463A28", off: "#5C4A33", off2: "#4E3E2A", surface: "gold", wall: "#6E5836" },
};

const SAMPLES_N = 480;

// Session cache of a track's GPU-side visuals (meshes, prop instances,
// billboard textures), keyed by trackId+mirror. Rebuilding and
// re-uploading ~20MB of geometry and sign textures EVERY race start was
// the intro frame hitch on weak GPUs (perf audit 2026-07-15). LRU-capped:
// evicted entries drop their JS refs and the browser frees the GL objects
// on GC. Gameplay state (item boxes, sats, pads) is always rebuilt fresh.
const TRACK_GL = new Map();
const TRACK_GL_MAX = 3;
let trackGLRenderer = null;

function sampleSpline(pts, n, jumps) {
  const P = pts.length;
  const pos = [], tan = [], right = [], cum = [0];
  for (let i = 0; i < n; i++) {
    const u = (i / n) * P;
    const seg = Math.floor(u);
    const t = u - seg;
    const p = catmullRom(
      pts[(seg - 1 + P) % P], pts[seg % P], pts[(seg + 1) % P], pts[(seg + 2) % P], t,
    );
    pos.push(p);
  }
  // carve ramp jumps into the road profile BEFORE tangents: a smooth rise
  // to the lip, then an immediate drop-off. Physics launches off the lip
  // proportional to speed and approach slope. Optional j.boost (epic-air
  // pass 2026-07-18) multiplies launch velocity ONLY in this jump's window
  // via the per-sample jumpBoost array physics.js reads at lift-off ·
  // authored lips only, never a global trampoline.
  const jumpBoost = new Float32Array(n).fill(1);
  // pre-carve road heights: the terrain build reads these so ramps rise
  // OFF the landscape instead of dragging grass wedges up through the
  // racing surface (genesis rework 2026-07-18)
  const baseY = new Float32Array(n);
  for (let i = 0; i < n; i++) baseY[i] = pos[i][1];
  for (const j of jumps || []) {
    const c = Math.floor((j.t % 1) * n);
    const RISE = 16;
    for (let k = 0; k <= RISE; k++) {
      const u = k / RISE;
      // ease-IN profile: steepest right at the lip, so launch velocity
      // (approach slope x speed in physics.js) peaks where karts leave
      const s = u * u;
      pos[(c - RISE + k + n) % n][1] += j.h * s;
    }
    if (j.boost) {
      // cover the carve plus a few samples past the lip: the launch fires
      // on the sample where the ground falls away, just after c
      for (let k = -RISE; k <= 6; k++) jumpBoost[(c + k + n) % n] = j.boost;
    }
  }
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = pos[i], b = pos[(i + 1) % n];
    const prev = pos[(i - 1 + n) % n];
    const tv = V3.norm(V3.sub(b, prev));
    tan.push(tv);
    const rv = V3.norm(V3.cross([0, 1, 0], tv).map((v, k) => (k === 1 ? 0 : v)));
    right.push(rv);
    total += V3.dist(a, b);
    cum.push(total);
  }
  return { pos, tan, right, cum, total, n, jumpBoost, baseY };
}

// racing line: look-ahead yaw delta pushes the target toward the inside
function racingLine(S, hw) {
  const n = S.n;
  const yaw = [];
  for (let i = 0; i < n; i++) yaw.push(Math.atan2(S.tan[i][0], S.tan[i][2]));
  const target = new Float32Array(n);
  const LOOK = 26;
  for (let i = 0; i < n; i++) {
    let d = yaw[(i + LOOK) % n] - yaw[i];
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    target[i] = clamp(-d * 1.5, -1, 1) * hw * 0.42;
  }
  // smooth
  for (let pass = 0; pass < 3; pass++) {
    const prev = Float32Array.from(target);
    for (let i = 0; i < n; i++) {
      target[i] = (prev[(i - 2 + n) % n] + prev[(i - 1 + n) % n] + prev[i] + prev[(i + 1) % n] + prev[(i + 2) % n]) / 5;
    }
  }
  return target;
}

function propModel(S, hw, e, extraY) {
  const i = Math.floor((e.t % 1) * S.n);
  const p = S.pos[i], r = S.right[i];
  const lateral = (e.side || 0) * hw;
  const x = p[0] + r[0] * lateral;
  const z = p[2] + r[2] * lateral;
  const y = p[1] + (e.y || 0) + (extraY || 0);
  const yaw = e.rot !== undefined ? e.rot : Math.atan2(-r[0] * Math.sign(e.side || 1), -r[2] * Math.sign(e.side || 1)) + (hash01(i) - 0.5);
  return { x, y, z, yaw, model: M4.trs(x, y, z, yaw, 0, 0, e.scale || 1) };
}

export function buildTrack(R, def, cacheKey) {
  const S = sampleSpline(def.pts, SAMPLES_N, def.jumps);
  const hw = def.width / 2;

  // hazard windows: open road edges (no wall) where a kart can fall off.
  // side "out" resolves to whichever lateral sign points away from the
  // track centroid at the window's midpoint, so authors never need to
  // know the loop's winding.
  let hcx = 0, hcz = 0;
  for (const p of S.pos) { hcx += p[0]; hcz += p[2]; }
  hcx /= S.n; hcz /= S.n;
  const hazardRanges = (def.hazards || []).map((hz) => {
    const i0 = Math.floor(hz.t0 * S.n), i1 = Math.floor(hz.t1 * S.n);
    const m = Math.floor((i0 + i1) / 2) % S.n;
    const outward = Math.sign(
      S.right[m][0] * (S.pos[m][0] - hcx) + S.right[m][2] * (S.pos[m][2] - hcz),
    ) || 1;
    return { i0, i1, s: hz.side === "in" ? -outward : outward };
  });
  // physics-open window is (i0, i1]: the wall mesh below skips segments
  // [i0, i1] whose geometry spans samples [i0, i1+1], and surfaceQuery is
  // nearest-sample (a half-sample fringe each side). This containment
  // keeps every fall inside the VISIBLE gap: no phantom walls in the
  // opening, no clipping through a drawn rail at the edges.
  const hazardOpen = (idx, latSign) => {
    for (const r of hazardRanges) {
      if (idx > r.i0 && idx <= r.i1 && latSign === r.s) return true;
    }
    return false;
  };
  const wallGapAt = (i, latSign) => {
    for (const r of hazardRanges) {
      if (i >= r.i0 && i <= r.i1 && latSign === r.s) return true;
    }
    return false;
  };
  // chasms (epic-scale pass 2026-07-21): def.chasms carves the land beyond
  // the road apron into a steep glowing gorge over a t-window, turning the
  // road into a causeway across the void. {t0, t1, w, depth, glow}. Pair
  // every chasm with hazard windows so the danger is REAL at the edges ·
  // the terrain carve itself never touches the racing surface (the apron
  // blend keeps the road corridor flat, exactly like hills).
  const chasmRanges = (def.chasms || []).map((ch) => ({
    i0: Math.floor(ch.t0 * SAMPLES_N),
    i1: Math.floor(ch.t1 * SAMPLES_N),
    // the void starts just past the wall line: no road-level rim to hide
    // the drop from the chase cam · the road IS the only ground left
    inner: def.width / 2 + 3,
    outer: def.width / 2 + 3 + ch.w,
    depth: ch.depth,
    glow: ch.glow,
  }));
  const chasmAt = (i) => {
    for (const ch of chasmRanges) if (i > ch.i0 + 4 && i <= ch.i1 - 4) return true;
    return false;
  };
  // road gaps (EXTREME pass 2026-07-21): def.gaps removes the deck itself
  // over a t-window right after a ramp lip · the flight path crosses OPEN
  // water/glow and any ground contact inside the window is a fall. Each
  // gap rides inside a chasm window (test-enforced) and inherits its
  // depth for the under-road carve.
  const gapRanges = (def.gaps || []).map((g) => ({
    i0: Math.floor(g.t0 * SAMPLES_N),
    i1: Math.floor(g.t1 * SAMPLES_N),
    depth: ((def.chasms || []).find((c) => c.t0 <= g.t0 && c.t1 >= g.t1) || { depth: 14 }).depth,
  }));
  const gapAt = (idx) => {
    for (const g of gapRanges) if (idx > g.i0 && idx <= g.i1) return true;
    return false;
  };
  const gapEndFor = (idx) => {
    for (const g of gapRanges) if (idx > g.i0 && idx <= g.i1) return g.i1;
    return idx;
  };

  const G = GROUNDS[def.theme] || GROUNDS.circuit;
  const sky = SKIES[def.sky] || SKIES.day;
  const env = { ...sky };
  if (def.fogNear) env.fogNear = def.fogNear;
  if (def.fogFar) env.fogFar = def.fogFar;
  // road glint strength for the cheap specular term: wet skies shine,
  // dry days keep a faint sheen (race.js zeroes it under reduceFx)
  env.roadSpec = { rain: 0.85, snow: 0.4, night: 0.45, mine: 0.3, fog: 0.35 }[def.sky] ?? 0.22;
  // SHINE per-world color grade (2026-07-22) · post-composite gain/lift,
  // applied after the filmic curve. Subtle by design: gain within +-8%,
  // lift under 0.03 · this is a grade, not a filter.
  env.grade = {
    day: { gain: [1.05, 1.01, 0.96], lift: [0.012, 0.007, 0.0] },
    rain: { gain: [0.93, 1.0, 1.07], lift: [0.0, 0.008, 0.022] },
    snow: { gain: [0.96, 1.0, 1.08], lift: [0.012, 0.016, 0.03] },
    fog: { gain: [0.99, 1.0, 1.02], lift: [0.015, 0.015, 0.018] },
    night: { gain: [0.95, 0.99, 1.1], lift: [0.01, 0.01, 0.032] },
    dusk: { gain: [1.08, 0.98, 1.0], lift: [0.02, 0.006, 0.014] },
    dawn: { gain: [1.09, 1.02, 0.93], lift: [0.026, 0.014, 0.005] },
    aurora: { gain: [0.95, 1.05, 1.03], lift: [0.005, 0.02, 0.022] },
    mine: { gain: [1.08, 1.03, 0.92], lift: [0.02, 0.012, 0.004] },
  }[def.sky] || { gain: [1, 1, 1], lift: [0, 0, 0] };
  // wet + marble floors pick up the sky at grazing angles (sheen term in
  // the main shader) · everything else stays matte asphalt
  env.roadSheen = { wet: 0.55, marble: 0.2 }[G.surface] || 0;

  const WALL_OFF = hw + 2.4; // wall lateral offset · also feeds wallLimit below

  // hoisted above the GPU cache block: the AI line doubles as the deck's
  // wear-band center and the start poses anchor the painted grid, so the
  // road build needs both even on a cache MISS
  const aiLine = racingLine(S, hw);
  const startPoses = [];
  for (let k = 0; k < 8; k++) {
    const row = Math.floor(k / 2), col = k % 2;
    const dist = S.total - (9 + row * 4.4);
    const i = Math.floor((dist / S.total) * S.n) % S.n;
    const p = S.pos[i], r = S.right[i], tn = S.tan[i];
    const lateral = (col === 0 ? -0.34 : 0.34) * hw;
    startPoses.push({
      x: p[0] + r[0] * lateral, y: p[1], z: p[2] + r[2] * lateral,
      heading: Math.atan2(tn[0], tn[2]),
    });
  }

  // ---------------- cached GPU visuals ----------------
  if (cacheKey && trackGLRenderer !== R) { TRACK_GL.clear(); trackGLRenderer = R; }
  let vis = (cacheKey && TRACK_GL.get(cacheKey)) || null;
  if (!vis) {

  // ---------------- road ribbon ----------------
  const road = meshBuilder();
  const roadCol = hex(G.road);
  // repair-patch runs (K20): variable-length shade runs replace the old
  // i % 8 metronome banding · roughly 1 in 8 runs is a visibly darker
  // repair slab, bracketed by seam joints laid over the deck below.
  // patchRepair flags the dark slabs so deckCol can cool-shift them ·
  // fresh asphalt reads blue-gray against a warm weathered deck (K20 v2).
  const patchShade = new Float32Array(S.n);
  const patchRepair = new Uint8Array(S.n);
  const seamAt = new Uint8Array(S.n);
  for (let i = 0, run = 0; i < S.n; run++) {
    const len = 4 + Math.floor(hash01(run * 91 + 7) * 6);
    const dark = hash01(run * 53 + 3) < 0.13;
    const f = dark ? 0.85 + hash01(run * 17 + 5) * 0.05 : 0.95 + hash01(run * 29 + 11) * 0.11;
    if (dark) { seamAt[i] = 1; seamAt[(i + len) % S.n] = 1; }
    for (let k = 0; k < len && i < S.n; k++, i++) {
      patchShade[i] = f;
      if (dark) patchRepair[i] = 1;
    }
  }
  // lateral deck stations: strip seams give quad4 real corners for the
  // wear band · the outer 1.2u strips carry curb grime
  const stations = [-hw, -(hw - 1.2), -hw * 0.5, -hw * 0.15, hw * 0.15, hw * 0.5, hw - 1.2, hw];
  // K20 v2 · rubbered groove astride the racing line, deepest through
  // corners (bend is 0..1 · racingLine clamps aiLine to +-hw*0.42).
  // Wear (0.13 + 0.28*bend) · typical mott ~0.78 lands corner delta ~0.32,
  // straight ~0.10 · glance-readable, not a 10-15% value whisper. Desat
  // toward luminance (0.32/0.5/0.18) separates laid rubber from shadow.
  // Polish rim sits at +-3.2u (outside the wear gaussian shoulder at
  // sigma^2=5.5 · at 3.2u wear is ~12% of peak so a +0.12 lift clears it
  // and the deck goes brighter than base · a rim at 1.5u is swallowed and
  // reads as a wider dark smear). Narrower gaussian /1.6 · mottled so it
  // never paints a stripe. ~30% two-bit-quantized hash stays.
  const deckCol = (i2, st) => {
    const L = stations[st];
    const dl = L - aiLine[i2];
    const mott = 0.55 + 0.45 * (hash01(i2 * 8 + st * 481) * 0.7 + (((hash01(i2 * 5 + st * 137) * 4) | 0) / 3) * 0.3);
    const bend = Math.abs(aiLine[i2]) / (hw * 0.42);
    // corner peak 0.13+0.28=0.41 pre-mottle · ~0.32 at mott 0.78 · straights ~0.10
    const wear = (0.13 + 0.28 * bend) * Math.exp(-dl * dl / 5.5) * mott;
    // polish rings outside the wear shoulder · |dl|-3.2, /1.6, amp 0.12
    const ad = Math.abs(dl) - 3.2;
    const polish = 0.12 * Math.exp(-(ad * ad) / 1.6) * mott;
    let f = patchShade[i2] * (1 - wear + polish);
    const edge = hw - Math.abs(L);
    if (edge < 1.25) f *= 0.87 + 0.13 * (edge / 1.25) + hash01(i2 * 11 + st * 61) * 0.04;
    let r = roadCol[0] * f, g = roadCol[1] * f, b = roadCol[2] * f;
    // desaturate inside the groove · same lum weights as rockLum (0.32/0.5/0.18)
    if (wear > 0.002) {
      const desat = Math.min(1, wear * 2.4);
      const lum = r * 0.32 + g * 0.5 + b * 0.18;
      r += (lum - r) * desat;
      g += (lum - g) * desat;
      b += (lum - b) * desat;
    }
    // repair batch · near-lum-preserving cool shift under ~0.025/channel
    // so it reads as a different asphalt batch, never as blue paint
    if (patchRepair[i2]) {
      r -= 0.020;
      b += 0.022;
    }
    return [r, g, b, 1];
  };
  for (let i = 0; i < S.n; i++) {
    const j = (i + 1) % S.n;
    if (gapAt(i) || gapAt(j)) continue; // the deck is GONE over a gap
    for (let st = 0; st < stations.length - 1; st++) {
      const a0 = V3.add(S.pos[i], V3.scale(S.right[i], stations[st]));
      const a1 = V3.add(S.pos[j], V3.scale(S.right[j], stations[st]));
      const b1 = V3.add(S.pos[j], V3.scale(S.right[j], stations[st + 1]));
      const b0 = V3.add(S.pos[i], V3.scale(S.right[i], stations[st + 1]));
      road.quad4(a0, a1, b1, b0, deckCol(i, st), deckCol(j, st), deckCol(j, st + 1), deckCol(i, st + 1));
    }
    // repair seam: a thin dark expansion joint where a patch slab meets
    // the older deck
    if (seamAt[i]) {
      const lift = [0, 0.025, 0];
      const s0 = V3.add(V3.add(S.pos[i], V3.scale(S.right[i], -(hw - 0.5))), lift);
      const s1 = V3.add(V3.add(S.pos[i], V3.scale(S.right[i], hw - 0.5)), lift);
      const f0 = V3.add(s0, V3.scale(S.tan[i], 0.18));
      const f1 = V3.add(s1, V3.scale(S.tan[i], 0.18));
      road.quad(s0, f0, f1, s1, shade(roadCol, 0.55));
    }
    // orange center dashes: 3-sample runs read as real lane paint
    if (i % 8 < 3) {
      const a0 = V3.add(S.pos[i], V3.scale(S.right[i], -0.25));
      const b0 = V3.add(S.pos[i], V3.scale(S.right[i], 0.25));
      const a1 = V3.add(S.pos[j], V3.scale(S.right[j], -0.25));
      const b1 = V3.add(S.pos[j], V3.scale(S.right[j], 0.25));
      const lift = [0, 0.04, 0];
      road.quad(V3.add(a0, lift), V3.add(a1, lift), V3.add(b1, lift), V3.add(b0, lift), hex("#F7931A"));
    }
    // solid edge lines just inside the curbs: the ribbon reads at speed
    const lineCol = hex("#D9DAE0");
    for (const s of [-1, 1]) {
      const l0 = V3.add(S.pos[i], V3.scale(S.right[i], s * (hw - 0.62)));
      const l1 = V3.add(S.pos[j], V3.scale(S.right[j], s * (hw - 0.62)));
      const m0 = V3.add(S.pos[i], V3.scale(S.right[i], s * (hw - 0.44)));
      const m1 = V3.add(S.pos[j], V3.scale(S.right[j], s * (hw - 0.44)));
      const lift = [0, 0.035, 0];
      if (s < 0) road.quad(V3.add(m0, lift), V3.add(m1, lift), V3.add(l1, lift), V3.add(l0, lift), lineCol);
      else road.quad(V3.add(l0, lift), V3.add(l1, lift), V3.add(m1, lift), V3.add(m0, lift), lineCol);
    }
    // curbs at both edges: alternating paint on a raised lip with an outer
    // drop face. Visual only · physics keeps reading the spline height.
    const rc = i % 6 < 3 ? hex("#F7931A") : hex("#F5F5F7");
    for (const s of [-1, 1]) {
      const o0 = V3.add(S.pos[i], V3.scale(S.right[i], s * hw));
      const o1 = V3.add(S.pos[j], V3.scale(S.right[j], s * hw));
      const w0 = V3.add(S.pos[i], V3.scale(S.right[i], s * (hw + 1.0)));
      const w1 = V3.add(S.pos[j], V3.scale(S.right[j], s * (hw + 1.0)));
      const liftIn = [0, 0.03, 0];
      const liftTop = [0, 0.14, 0];
      const drop = [0, -0.12, 0];
      const wt0 = V3.add(w0, liftTop), wt1 = V3.add(w1, liftTop);
      const wb0 = V3.add(w0, drop), wb1 = V3.add(w1, drop);
      if (s < 0) {
        road.quad(wt0, wt1, V3.add(o1, liftIn), V3.add(o0, liftIn), rc);
        road.quad(wt1, wt0, wb0, wb1, shade(rc, 0.62)); // outer face, left
      } else {
        road.quad(V3.add(o0, liftIn), V3.add(o1, liftIn), wt1, wt0, rc);
        road.quad(wt0, wt1, wb1, wb0, shade(rc, 0.62)); // outer face, right
      }
    }
  }
  // gap mouths: dark end faces so the severed deck reads sliced open
  for (const g of gapRanges) {
    const capC = shade(roadCol, 0.55);
    for (const [im, flip] of [[g.i0, false], [(g.i1 + 1) % S.n, true]]) {
      const r = S.right[im % S.n], pC = S.pos[im % S.n];
      const L = [pC[0] - r[0] * hw, pC[1], pC[2] - r[2] * hw];
      const Rt = [pC[0] + r[0] * hw, pC[1], pC[2] + r[2] * hw];
      const drop = 3.2;
      if (flip) road.quad(L, Rt, [Rt[0], Rt[1] - drop, Rt[2]], [L[0], L[1] - drop, L[2]], capC);
      else road.quad(Rt, L, [L[0], L[1] - drop, L[2]], [Rt[0], Rt[1] - drop, Rt[2]], capC);
    }
  }

  // painted start grid (K20): two white L-bracket arms boxing each slot ·
  // the grid reads as a produced race start, not bare tarmac. Lift 0.035
  // shares the edge-line layer (no lateral overlap with it).
  {
    const gridC = hex("#E8E9EE");
    for (let k = 0; k < startPoses.length; k++) {
      const sp = startPoses[k];
      const fx = Math.sin(sp.heading), fz = Math.cos(sp.heading);
      const rx = Math.cos(sp.heading), rz = -Math.sin(sp.heading);
      const P = (df, dr) => [sp.x + fx * df + rx * dr, sp.y + 0.035, sp.z + fz * df + rz * dr];
      // front bar ahead of the nose, side arm down the slot's outer flank
      road.quad(P(1.9, -1.35), P(2.14, -1.35), P(2.14, 1.35), P(1.9, 1.35), gridC);
      const out = k % 2 === 0 ? -1 : 1;
      const lo = Math.min(out * 1.35, out * 1.13), hi = Math.max(out * 1.35, out * 1.13);
      road.quad(P(0.55, lo), P(1.9, lo), P(1.9, hi), P(0.55, hi), gridC);
    }
  }

  // ramp skirts: carved lips now rise off the pre-carve terrain, so face
  // the gap at the wall plane with solid wedge sides · the perimeter walls
  // in a carve window stand on these instead of floating
  {
    const skirtC = shade(roadCol, 0.8);
    for (let i = 0; i < S.n; i++) {
      const j = (i + 1) % S.n;
      if (gapAt(i) || gapAt(j)) continue; // no deck, no skirt
      if (S.pos[i][1] - S.baseY[i] < 0.12 && S.pos[j][1] - S.baseY[j] < 0.12 && !chasmAt(i)) continue;
      for (const s of [-1, 1]) {
        const a = V3.add(S.pos[i], V3.scale(S.right[i], s * WALL_OFF));
        const b = V3.add(S.pos[j], V3.scale(S.right[j], s * WALL_OFF));
        const drop = chasmAt(i) ? 3.2 : 0.4; // causeway flanks run deep over a chasm
        const a0 = [a[0], S.baseY[i] - drop, a[2]], b0 = [b[0], S.baseY[j] - drop, b[2]];
        if (s > 0) road.quad(a, b, b0, a0, skirtC);
        else road.quad(b, a, a0, b0, skirtC);
      }
    }
  }
  const roadMesh = R.createMesh(road.build());

  // ---------------- walls ----------------
  const wallB = meshBuilder();
  const wallCol = hex(G.wall);
  for (let i = 0; i < S.n; i++) {
    const j = (i + 1) % S.n;
    for (const s of [-1, 1]) {
      if (wallGapAt(i, s) || gapAt(i) || gapAt((i + 1) % S.n)) continue; // open edge or severed deck
      const p0 = V3.add(S.pos[i], V3.scale(S.right[i], s * WALL_OFF));
      const p1 = V3.add(S.pos[j], V3.scale(S.right[j], s * WALL_OFF));
      const c = i % 10 < 5 ? wallCol : shade(wallCol, 0.85);
      const h = 1.1;
      // inward-facing quad + thin top
      if (s > 0) wallB.quad([p0[0], p0[1], p0[2]], [p1[0], p1[1], p1[2]], [p1[0], p1[1] + h, p1[2]], [p0[0], p0[1] + h, p0[2]], c);
      else wallB.quad([p1[0], p1[1], p1[2]], [p0[0], p0[1], p0[2]], [p0[0], p0[1] + h, p0[2]], [p1[0], p1[1] + h, p1[2]], c);
      // safety striping band along the top of the inner face: long
      // alternating runs, brand orange against a pale block
      const bandC = i % 24 < 12 ? hex("#F7931A") : shade(wallCol, 1.3);
      const b0 = 0.78, b1 = 0.98, inset = 0.02;
      const q0 = [p0[0] - S.right[i][0] * s * inset, 0, p0[2] - S.right[i][2] * s * inset];
      const q1 = [p1[0] - S.right[j][0] * s * inset, 0, p1[2] - S.right[j][2] * s * inset];
      if (s > 0) wallB.quad([q0[0], p0[1] + b0, q0[2]], [q1[0], p1[1] + b0, q1[2]], [q1[0], p1[1] + b1, q1[2]], [q0[0], p0[1] + b1, q0[2]], bandC);
      else wallB.quad([q1[0], p1[1] + b0, q1[2]], [q0[0], p0[1] + b0, q0[2]], [q0[0], p0[1] + b1, q0[2]], [q1[0], p1[1] + b1, q1[2]], bandC);
      wallB.quad(
        [p0[0], p0[1] + h, p0[2]], [p1[0], p1[1] + h, p1[2]],
        [p1[0] + S.right[j][0] * s * 0.3, p1[1] + h, p1[2] + S.right[j][2] * s * 0.3],
        [p0[0] + S.right[i][0] * s * 0.3, p0[1] + h, p0[2] + S.right[i][2] * s * 0.3],
        shade(wallCol, 1.15),
      );
      // guard posts every eighth sample: the slab reads as built, not extruded
      if (i % 8 === 0) {
        const px = p0[0] + S.right[i][0] * s * 0.18, pz = p0[2] + S.right[i][2] * s * 0.18;
        wallB.box(px, p0[1] + 0.7, pz, 0.5, 1.55, 0.5, shade(wallCol, 0.65));
        wallB.box(px, p0[1] + 1.52, pz, 0.58, 0.12, 0.58, shade(wallCol, 1.25)); // cap
      }
    }
  }
  const wallMesh = R.createMesh(wallB.build());

  // ---------------- terrain heightfield ----------------
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of S.pos) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
  }
  const MARGIN = 150;
  minX -= MARGIN; maxX += MARGIN; minZ -= MARGIN; maxZ += MARGIN;
  const GRID = 70;
  const terr = meshBuilder();
  const offCol = hex(G.off), offCol2 = hex(G.off2);
  const cellW = (maxX - minX) / GRID, cellD = (maxZ - minZ) / GRID;
  const hmap = [];
  const cmap = []; // per-vertex chasm carve amount · colors the gorge walls
  const wmap = []; // road-apron blend weight · masks snow off the corridor
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  for (let gz = 0; gz <= GRID; gz++) {
    hmap.push([]);
    cmap.push([]);
    wmap.push([]);
    for (let gx = 0; gx <= GRID; gx++) {
      const x = minX + gx * cellW, z = minZ + gz * cellD;
      // nearest sample (coarse)
      let best = 1e9, bestY = 0, bi = 0;
      for (let i = 0; i < S.n; i += 3) {
        const dx = S.pos[i][0] - x, dz = S.pos[i][2] - z;
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; bestY = S.pos[i][1]; bi = i; }
      }
      // near a jump carve, ~8.5u terrain cells straddle the sheer lip drop
      // and slice green wedges up through the road · hug the LOW pre-carve
      // baseline there instead (skirts below wall off the resulting gap)
      for (let w2 = -6; w2 <= 6; w2 += 3) {
        const iw = (bi + w2 + S.n) % S.n;
        if (S.pos[iw][1] - S.baseY[iw] > 0.12) {
          bestY = Math.min(bestY, S.baseY[iw]);
        }
      }
      const d = Math.sqrt(best);
      // def.hillAmp (map pass 2026-07-16): per-track terrain drama · the
      // road apron blend below keeps the racing surface untouched
      const hillAmp = def.hillAmp || 1;
      const noise = ((hash01(gx * 131 + gz) - 0.35) * 4 + Math.sin(gx * 0.7) * Math.cos(gz * 0.6) * 2.2) * hillAmp;
      let h = bestY - 0.22;
      // flat apron reaches past the walls (hw + 2.4) so barriers never end
      // up buried inside a dune ridge hugging the road
      const w = clamp((d - (hw * 2.0 + 3.5)) / (hw * 5), 0, 1);
      h = h * (1 - w) + (bestY * 0.7 + noise) * w;
      // def.island (set-piece pass 2026-07-18): per-track shoreline pull-in.
      // Only meaningful on water themes (beach/docks) · shrinking it walks
      // the ocean up to the outer walls so coastal hazard edges drop toward
      // water instead of distant sand. Deliberately applied AFTER the road
      // apron: a road stretch outside the radius becomes a causeway.
      const islandR = def.island || G.island;
      let islandFall = 0;
      if (islandR) {
        const dc = Math.hypot(x - cx, z - cz);
        islandFall = clamp((dc - islandR) / 60, 0, 1);
        h = h * (1 - islandFall) + (-7) * islandFall;
      }
      // mountain ranges (colossal pass 2026-07-21): def.ridge raises a
      // long-wavelength interference ridge line far beyond the road apron,
      // ringing the world in real ranges instead of a flat horizon. Never
      // touches the racing corridor (rises from 90u out) and yields to the
      // island shoreline falloff on water maps.
      if (def.ridge) {
        const rw = clamp((d - 90) / 80, 0, 1);
        const rn = Math.sin(x * 0.011 + z * 0.017) * Math.cos(x * 0.007 - z * 0.013);
        h += rw * def.ridge * Math.max(rn, 0) * (1 - islandFall);
      }
      // chasm carve: inside a window's lateral band the land plunges to a
      // gorge floor tied to the road height. Steep inner wall (6u), long
      // outer rise (18u), and a 12-sample taper at the window ends so the
      // gorge opens and closes instead of guillotining the landscape.
      let carve = 0;
      for (const ch of chasmRanges) {
        if (bi <= ch.i0 || bi > ch.i1) continue;
        const edge = clamp(Math.min(bi - ch.i0, ch.i1 - bi) / 12, 0, 1);
        const inn = clamp((d - ch.inner) / 4, 0, 1);
        const out = clamp((ch.outer - d) / 10, 0, 1);
        const k = Math.min(inn, out) * edge;
        if (k > 0) {
          const carved = h * (1 - k) + (bestY - ch.depth) * k;
          if (carved < h) { carve = Math.max(carve, h - carved); h = carved; }
        }
      }
      for (const g of gapRanges) {
        if (bi > g.i0 - 3 && bi <= g.i1 + 3) {
          const gh = bestY - g.depth;
          if (gh < h) { carve = Math.max(carve, h - gh); h = gh; }
        }
      }
      hmap[gz].push(h);
      cmap[gz].push(carve);
      wmap[gz].push(w);
    }
  }
  // terrain material bands (AAA r2 · K8): per-CORNER colors via quad4
  // replace the old per-cell hash confetti. Coherent 2-octave value-noise
  // patches span several cells, steep faces desaturate to rock (gorge
  // walls, ridge flanks), winter/peak carry a snowline above the road's
  // reach, shorelines a wet-dark band at the waterline. Pure hash01 math
  // inside the cached !vis block · the headless stub-renderer buildTrack
  // runs this path, so no DOM and no Math.random.
  const vnoise = (x, z) => {
    // bilinear-smoothstep value noise on an integer lattice · shared
    // corners hash identically so patches stay continuous across cells
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const k = ix * 131 + iz * 337;
    const n0 = hash01(k) * (1 - sx) + hash01(k + 131) * sx;
    const n1 = hash01(k + 337) * (1 - sx) + hash01(k + 468) * sx;
    return n0 * (1 - sz) + n1 * sz;
  };
  const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // rock keys off the theme ground's luminance, pulled halfway to a fixed
  // warm-stone anchor: a pure luminance derivation inherits the world's
  // hue and the grade re-tints it further (teal cliffs on aurora worlds) ·
  // the anchor keeps steep faces STONE under every grade while the
  // luminance half keeps them in-palette
  const rockLum = offCol[0] * 0.32 + offCol[1] * 0.5 + offCol[2] * 0.18;
  const rockCol = mixC([rockLum * 0.82, rockLum * 0.76, rockLum * 0.7], [0.42, 0.38, 0.33], 0.5);
  // bare-earth stop under the two cover tones: the low end of the noise
  // reads as ground showing through cover, not a third tint of the cover
  const bareCol = mixC(shade(offCol2, 0.66), [0.4, 0.34, 0.26], 0.35);
  const snowCol = hex("#EDF2F8");
  let maxRoadY = -1e9;
  for (const p of S.pos) maxRoadY = Math.max(maxRoadY, p[1]);
  // snowline keyed to the terrain this track ACTUALLY built: the old
  // maxRoadY + 8 sat above every visible ridge on the summit track and
  // rendered zero caps. The 68th percentile of off-corridor heights puts
  // white on the top third of the surround; the wmap mask in the color
  // loop keeps the racing corridor itself in theme ground regardless
  let snowline = null;
  if (G.surface === "snow" || G.surface === "rock") {
    const hs = [];
    for (let gz = 0; gz <= GRID; gz++) {
      for (let gx = 0; gx <= GRID; gx++) if (wmap[gz][gx] > 0.5) hs.push(hmap[gz][gx]);
    }
    hs.sort((a, b) => a - b);
    snowline = hs.length ? hs[Math.floor(hs.length * 0.68)] : maxRoadY + 8;
  }
  const wetLvl = G.water ? G.water.level : null;
  const glowCh = chasmRanges.find((cr) => cr.glow);
  const glowCol = glowCh ? hex(glowCh.glow) : null;
  const vcol = [];
  for (let gz = 0; gz <= GRID; gz++) {
    vcol.push([]);
    for (let gx = 0; gx <= GRID; gx++) {
      const x = minX + gx * cellW, z = minZ + gz * cellD;
      const h = hmap[gz][gx];
      const o1 = vnoise(x * 0.03, z * 0.03); // ~33u patches
      const o2 = vnoise(x * 0.081 + 53.1, z * 0.081 + 17.7);
      // ~80u regional octave · layered under the shade product below
      const o3 = vnoise(x * 0.0125 + 101.3, z * 0.0125 + 67.9);
      const p = o1 * 0.65 + o2 * 0.35;
      // three-stop cover ramp (bare -> sparse -> full)
      let c = p < 0.42
        ? mixC(bareCol, offCol2, clamp(p / 0.42, 0, 1))
        : mixC(offCol2, offCol, clamp((p - 0.42) / 0.34, 0, 1));
      // multiplicative shade · short o2 +-20% separates cover from bare up
      // close (at +-7% patches read as one flat tone from the chase cam);
      // long o3 +-11% is what survives past ~50u where the short octaves
      // average to one flat tone. Product sits before rock/snow/wet/foam/
      // carve so it modulates cover tone only and can never re-paint a
      // foam or snow corner
      c = shade(c, (0.94 + (o2 - 0.5) * 0.4) * (0.89 + o3 * 0.22));
      // central-difference slope (rise over run) · past ~0.45 the ground
      // can't hold its cover and reads as bare rock
      const gxm = Math.max(gx - 1, 0), gxp = Math.min(gx + 1, GRID);
      const gzm = Math.max(gz - 1, 0), gzp = Math.min(gz + 1, GRID);
      const dhx = (hmap[gz][gxp] - hmap[gz][gxm]) / ((gxp - gxm) * cellW);
      const dhz = (hmap[gzp][gx] - hmap[gzm][gx]) / ((gzp - gzm) * cellD);
      const rock = clamp((Math.hypot(dhx, dhz) - 0.45) / 0.35, 0, 1);
      if (rock > 0) c = mixC(c, shade(rockCol, 0.85 + o1 * 0.3), rock);
      if (snowline !== null) {
        // cliffs shed their cover · the rock term wins on sheer faces ·
        // the apron weight clamps the caps off the road corridor
        const sn = clamp((h - snowline) / 6, 0, 1) * (1 - rock * 0.55) * wmap[gz][gx];
        if (sn > 0) c = mixC(c, snowCol, sn);
      }
      if (wetLvl !== null) {
        // wet shoreline keyed by GROUND distance, not height: height/slope
        // keeps a real band on steep facets (height-only 2.5u compresses
        // under a metre of ground) and the 0.14 slope floor stops flat
        // sand from smearing the apron. Band is 15u of ground (~2 grid
        // cells · min that survives vertex interp at GRID=70). Linear
        // ramp with plateau · quadratic spent most of the band under
        // 10% darkening and read as nothing from the chase cam.
        const gslope = Math.max(Math.hypot(dhx, dhz), 0.14);
        const hdist = (h - wetLvl) / gslope; // m of ground to waterline · neg below
        const wet = clamp(1 - hdist / 15, 0, 1);
        if (wet > 0) c = shade(c, 1 - 0.45 * Math.min(1, wet * 1.6));
        // surf foam +-5.5u of ground off the same hdist · warm bright
        // off-white; blue channel clamped <=0.82 so the near-white terrain
        // invariant (b>0.85 trips snow%) never fires on water tracks,
        // and warm sea-foam is the truer colour
        const foam = 1 - clamp(Math.abs(hdist) / 5.5, 0, 1);
        if (foam > 0) c = mixC(c, [0.97, 0.95, 0.82], foam * 0.9);
      }
      // carved gorge walls override everything, per corner off cmap: dark
      // rock warmed toward the floor glow, so the pit reads lit from
      // below instead of vanishing into the palette
      const carve = cmap[gz][gx];
      if (glowCol && carve > 1.5) {
        const f = clamp(carve / glowCh.depth, 0, 1);
        c = shade(glowCol, 0.1 + 0.3 * f * f + (hash01(gx * 57 + gz * 101) - 0.5) * 0.05);
      }
      vcol[gz].push([c[0], c[1], c[2], 1]);
    }
  }
  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = minX + gx * cellW, x1 = x0 + cellW;
      const z0 = minZ + gz * cellD, z1 = z0 + cellD;
      terr.quad4(
        [x0, hmap[gz][gx], z0], [x0, hmap[gz + 1][gx], z1],
        [x1, hmap[gz + 1][gx + 1], z1], [x1, hmap[gz][gx + 1], z0],
        vcol[gz][gx], vcol[gz + 1][gx], vcol[gz + 1][gx + 1], vcol[gz][gx + 1],
      );
    }
  }
  const terrainMesh = R.createMesh(terr.build());

  // bilinear terrain height from hmap · outside the heightfield the world
  // has fallen to the abyssal floor (island falloff sank everything to -7
  // long before then). General helper: the water build reads it as the
  // seabed for the foam bake, rock seating below reads it as ground.
  const seaBed = (x, z) => {
    const fx = (x - minX) / cellW, fz = (z - minZ) / cellD;
    if (fx < 0 || fz < 0 || fx > GRID || fz > GRID) return -7;
    const ix = Math.min(GRID - 1, Math.floor(fx)), iz = Math.min(GRID - 1, Math.floor(fz));
    const tx = fx - ix, tz = fz - iz;
    const h00 = hmap[iz][ix], h10 = hmap[iz][ix + 1], h01 = hmap[iz + 1][ix], h11 = hmap[iz + 1][ix + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };

  // ---------------- water ----------------
  // SHINE living water (2026-07-22): a finer grid (waves get real vertex
  // resolution) with a FOAM FIELD baked into the vertex colors from the
  // terrain heightfield that is still in scope here: r = surf foam where
  // the seabed grazes the surface, g = shallowness for the depth tint.
  // hmap crossing detection means chasm inlets (the Shark Strait) and gap
  // carves grow surf lines too, not just the outer island ring.
  let waterMesh = null, waterCols = null;
  if (G.water) {
    const wb = meshBuilder();
    const W = Math.max(maxX - minX, maxZ - minZ) * 1.6;
    const seg = 84;
    const lvl = G.water.level;
    const shore = (x, z) => {
      const depth = lvl - seaBed(x, z); // how much water stands here
      if (depth <= 0.05) return [0, 1]; // seabed above the surface: hidden under terrain anyway
      const foam = 1 - clamp((depth - 0.15) / 1.5, 0, 1); // surf where the bed grazes the surface
      const shal = 1 - clamp(depth / 5.5, 0, 1); // shallow tint band
      return [foam, shal];
    };
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < seg; j++) {
        const x0 = cx - W / 2 + (i / seg) * W, x1 = cx - W / 2 + ((i + 1) / seg) * W;
        const z0 = cz - W / 2 + (j / seg) * W, z1 = cz - W / 2 + ((j + 1) / seg) * W;
        const s00 = shore(x0, z0), s01 = shore(x0, z1), s11 = shore(x1, z1), s10 = shore(x1, z0);
        // skip fully-abyssal cells far outside the field only when every
        // corner is deep AND far from the island (keeps the horizon sea)
        wb.quad4(
          [x0, lvl, z0], [x0, lvl, z1], [x1, lvl, z1], [x1, lvl, z0],
          [s00[0], s00[1], 0, 1], [s01[0], s01[1], 0, 1], [s11[0], s11[1], 0, 1], [s10[0], s10[1], 0, 1],
        );
      }
    }
    waterMesh = R.createMesh(wb.build());
    waterCols = G.water;
  }

  // ---------------- props ----------------
  const propMeshCache = {};
  const instances = [];
  const obstacles = [];
  const waterfalls = []; // world positions · race.js spawns proximity mist
  const emitters = []; // living-world particle sources (paper, embers)
  let seedCounter = 1;
  const addProp = (e, isObstacle) => {
    const key = e.type + ":" + (seedCounter % 5);
    const kb = e.type === "crowdA" ? "crowdB:" + (seedCounter % 5) : null;
    if (!propMeshCache[key]) {
      const builder = PROP_BUILDERS[e.type];
      if (!builder) return;
      propMeshCache[key] = R.createMesh(builder(seedCounter * 7.13));
      // K14: the popcorn crowd's second frame · SAME seed so A/B differ only in pose parity
      if (kb) propMeshCache[kb] = R.createMesh(PROP_BUILDERS.crowdB(seedCounter * 7.13));
    }
    seedCounter++;
    const pm = propModel(S, hw, e);
    // rocks are terrain furniture, not road furniture: seat them on the
    // heightfield so chasm carves and ridge flanks cannot leave boulders
    // hovering on air or buried to the crown (AAA r3 · the peak gorge
    // shipped floating octahedra with bare pointed undersides). The
    // waterline floor keeps shore rocks breaking the surface instead of
    // sinking to the seabed.
    if (e.type === "rock" || e.type === "rockArch") {
      // min over the footprint, not the center: on a steep gorge wall a
      // center sample can still leave the downhill edge hanging in air ·
      // biasing to the lowest corner buries into the slope instead
      const fr = 1.5 * (e.scale || 1);
      let gy = seaBed(pm.x, pm.z);
      for (const [ox, oz] of [[fr, 0], [-fr, 0], [0, fr], [0, -fr]]) {
        gy = Math.min(gy, seaBed(pm.x + ox, pm.z + oz));
      }
      gy += e.y || 0;
      if (G.water) gy = Math.max(gy, G.water.level - 0.4);
      pm.y = gy;
      pm.model = M4.trs(pm.x, gy, pm.z, pm.yaw, 0, 0, e.scale || 1);
    }
    if (e.type === "waterfall") waterfalls.push({ x: pm.x, z: pm.z, scale: e.scale || 1 });
    const emissiveTypes = { candleTower: 0.55, itemBlock: 0.8, chevron: 0.85, balloon: 0.35, streetLamp: 0.3, lighthouse: 0.2, neonArch: 0.6, pizzaOven: 0.22, waterfall: 0.12, holoB: 1.0, timechainArc: 0.75, auroraCurtain: 0.55, volcano: 0.3, openingBell: 0.25 };
    const inst = {
      mesh: propMeshCache[key],
      model: pm.model,
      emissive: emissiveTypes[e.type] || 0,
      type: e.type,
    };
    // living colossi (mythic pass 2026-07-21): a watch flag makes race.js
    // turn this instance to face the player · store the decomposed pose
    if (e.watch) {
      inst.watch = true;
      inst.wx = pm.x; inst.wy0 = pm.y; inst.wz = pm.z;
      inst.wscale = e.scale || 1;
      inst.wyaw = pm.yaw;
    }
    if (kb) inst.meshB = propMeshCache[kb];
    instances.push(inst);
    if (e.emit) emitters.push({ x: pm.x, y: pm.y, z: pm.z, kind: e.emit, scale: e.scale || 1 });
    if (isObstacle) obstacles.push({ x: pm.x, z: pm.z, r: 1.6 * (e.scale || 1) });
  };
  for (const e of def.props || []) addProp(e, false);
  for (const e of def.obstacles || []) addProp(e, true);

  // tunnels: solid flanks + posts + sealed ceiling over a t-window, with
  // emissive lamps and portal frames at both mouths (set-piece pass
  // 2026-07-18 · the old bare posts read as scaffolding, not a place).
  // Authoring rule: keep tunnel windows clear of jump windows · the ceiling
  // follows the carved road but an airborne kart clips straight through it.
  for (const tn of def.tunnels || []) {
    const tb = meshBuilder();
    const lb = meshBuilder();
    const i0 = Math.floor(tn.t0 * S.n), i1 = Math.floor(tn.t1 * S.n);
    const tc = shade(wallCol, 0.75);
    const flank = shade(wallCol, 0.48);
    const ceilBot = shade(wallCol, 0.6), ceilTop = shade(wallCol, 0.78), ceilEdge = shade(wallCol, 0.55);
    const FL = hw + 2.25; // flush with the rib outer faces, inside the wall slab
    const CB = 3.7, CT = 4.3; // ceiling slab: bottom seals onto the flank tops
    // Oriented box on the sample's (right, up, forward) frame · adversarial
    // review 2026-07-18: meshBuilder.box is WORLD-axis-aligned, and both new
    // tunnel windows sit on X-running road, so axis-aligned crossbars lay
    // ALONG the travel direction and post/pillar faces swung a metre into
    // the drivable band. Same face order + winding as box() with x→right,
    // z→forward ((right, up, forward) is right-handed by construction).
    const obox = (mb, i, lat, cy, hx, hh, hd, color) => {
      const p = S.pos[i % S.n], r = S.right[i % S.n], tv = S.tan[i % S.n];
      const fl = Math.hypot(tv[0], tv[2]) || 1;
      const fx = tv[0] / fl, fz = tv[2] / fl;
      const C = (sx, sy, sz) => [
        p[0] + r[0] * (lat + sx) + fx * sz,
        p[1] + cy + sy,
        p[2] + r[2] * (lat + sx) + fz * sz,
      ];
      const q = (a, b, c, d) => mb.quad(a, b, c, d, color);
      q(C(hx, -hh, -hd), C(hx, hh, -hd), C(hx, hh, hd), C(hx, -hh, hd));
      q(C(-hx, -hh, hd), C(-hx, hh, hd), C(-hx, hh, -hd), C(-hx, -hh, -hd));
      q(C(-hx, hh, -hd), C(-hx, hh, hd), C(hx, hh, hd), C(hx, hh, -hd));
      q(C(-hx, -hh, hd), C(-hx, -hh, -hd), C(hx, -hh, -hd), C(hx, -hh, hd));
      q(C(-hx, -hh, hd), C(hx, -hh, hd), C(hx, hh, hd), C(-hx, hh, hd));
      q(C(hx, -hh, -hd), C(-hx, -hh, -hd), C(-hx, hh, -hd), C(hx, hh, -hd));
    };
    const rim = (i, s, y) => {
      const p = S.pos[i % S.n], r = S.right[i % S.n];
      return [p[0] + r[0] * s * FL, p[1] + y, p[2] + r[2] * s * FL];
    };
    for (let i = i0; i <= i1; i += 2) {
      for (const s of [-1, 1]) obox(tb, i, s * (hw + 1.7), 1.9, 0.5, 1.9, 1.1, tc);
      // flanks + ceiling ribbon between this rib and the next (j clamps to
      // i1 so odd-width windows still close their last segment): solid side
      // walls, a road-following roof slab sealed onto them (bottom face is
      // the interior read · the lamps become the light source), outer edge
      // strips, and the roof's own mouth caps.
      if (i < i1) {
        const j = Math.min(i + 2, i1);
        const p = S.pos[i % S.n], r = S.right[i % S.n];
        const pq = S.pos[j % S.n], r2 = S.right[j % S.n];
        for (const s of [-1, 1]) {
          const a = [p[0] + r[0] * s * FL, p[1], p[2] + r[2] * s * FL];
          const b = [pq[0] + r2[0] * s * FL, pq[1], pq[2] + r2[2] * s * FL];
          if (s > 0) tb.quad(a, b, [b[0], b[1] + CB, b[2]], [a[0], a[1] + CB, a[2]], flank);
          else tb.quad(b, a, [a[0], a[1] + CB, a[2]], [b[0], b[1] + CB, b[2]], flank);
        }
        const aL = rim(i, -1, 0), aR = rim(i, 1, 0), bL = rim(j, -1, 0), bR = rim(j, 1, 0);
        const at = (v, y) => [v[0], v[1] + y, v[2]];
        tb.quad(at(aL, CB), at(aR, CB), at(bR, CB), at(bL, CB), ceilBot);
        tb.quad(at(aR, CT), at(aL, CT), at(bL, CT), at(bR, CT), ceilTop);
        tb.quad(at(bR, CB), at(aR, CB), at(aR, CT), at(bR, CT), ceilEdge);
        tb.quad(at(aL, CB), at(bL, CB), at(bL, CT), at(aL, CT), ceilEdge);
      }
      if ((i - i0) % 8 === 0) {
        lb.box(S.pos[i % S.n][0], S.pos[i % S.n][1] + 3.55, S.pos[i % S.n][2], 0.7, 0.22, 0.7, hex("#FFD9A0"));
      }
    }
    // roof end caps so the mouths show a clean fascia, not an open slab edge
    for (const [im, dir] of [[i0, -1], [i1, 1]]) {
      const L = rim(im, -1, 0), Rr = rim(im, 1, 0);
      const at = (v, y) => [v[0], v[1] + y, v[2]];
      if (dir < 0) tb.quad(at(Rr, CB), at(L, CB), at(L, CT), at(Rr, CT), ceilEdge);
      else tb.quad(at(L, CB), at(Rr, CB), at(Rr, CT), at(L, CT), ceilEdge);
    }
    // portal frames: chunky pillars + header at each mouth with a brand
    // orange glow strip so the tunnel reads from three corners away. All
    // oriented via obox · pillar inner faces sit exactly at the wall clamp
    // limit (hw + 2.2 - 0.8 = hw + 1.4) on ANY road heading, so a
    // wall-scraping kart cannot clip through them.
    for (const im of [i0, i1]) {
      for (const s of [-1, 1]) obox(tb, im, s * (hw + 2.2), 2.5, 0.8, 2.5, 0.85, shade(wallCol, 0.9));
      obox(tb, im, 0, 5.1, hw + 2.8, 0.55, 0.95, shade(wallCol, 0.82));
      obox(lb, im, 0, 4.42, hw + 1.7, 0.12, 0.25, hex("#F7931A"));
    }
    instances.push({ mesh: R.createMesh(tb.build()), model: M4.ident(), emissive: 0, type: "tunnel" });
    instances.push({ mesh: R.createMesh(lb.build()), model: M4.ident(), emissive: 0.9, type: "tunnelLamp" });
  }

  // chasm glow floors: an emissive river of light along the gorge bottom
  // on both flanks (frost, liquidation red, molten gold). Follows the road
  // height so climbing causeways keep a constant drop below.
  for (const ch of chasmRanges) {
    if (!ch.glow) continue; // sea inlets glow with water, not lava
    const gb = meshBuilder();
    const gc = hex(ch.glow);
    for (let i = ch.i0; i < ch.i1; i += 3) {
      const j = Math.min(i + 3, ch.i1);
      const edge = Math.min(Math.min(i - ch.i0, ch.i1 - i) / 12, 1);
      if (edge <= 0.05) continue;
      const y0 = S.pos[i % S.n][1] - ch.depth * 0.8;
      const y1 = S.pos[j % S.n][1] - ch.depth * 0.8;
      const span = 13 * edge;
      const mid = ch.inner + 4 + span / 2;
      for (const s of [-1, 1]) {
        const c0 = i % 6 < 3 ? gc : shade(gc, 0.72);
        const a0 = V3.add(S.pos[i % S.n], V3.scale(S.right[i % S.n], s * (mid - span / 2)));
        const a1 = V3.add(S.pos[i % S.n], V3.scale(S.right[i % S.n], s * (mid + span / 2)));
        const b0 = V3.add(S.pos[j % S.n], V3.scale(S.right[j % S.n], s * (mid - span / 2)));
        const b1 = V3.add(S.pos[j % S.n], V3.scale(S.right[j % S.n], s * (mid + span / 2)));
        if (s > 0) gb.quad([a0[0], y0, a0[2]], [b0[0], y1, b0[2]], [b1[0], y1, b1[2]], [a1[0], y0, a1[2]], c0);
        else gb.quad([a1[0], y0, a1[2]], [b1[0], y1, b1[2]], [b0[0], y1, b0[2]], [a0[0], y0, a0[2]], c0);
      }
    }
    // a gap inside this chasm gets a CENTER river directly under the
    // flight path · you are jumping OVER the glow, not beside it
    for (const g of gapRanges) {
      if (g.i0 < ch.i0 || g.i1 > ch.i1) continue;
      for (let i = g.i0 - 2; i < g.i1 + 3; i += 2) {
        const j = Math.min(i + 2, g.i1 + 3);
        const y0 = S.pos[((i % S.n) + S.n) % S.n][1] - ch.depth * 0.8;
        const y1 = S.pos[((j % S.n) + S.n) % S.n][1] - ch.depth * 0.8;
        const a0 = V3.add(S.pos[((i % S.n) + S.n) % S.n], V3.scale(S.right[((i % S.n) + S.n) % S.n], -(hw + 3)));
        const a1 = V3.add(S.pos[((i % S.n) + S.n) % S.n], V3.scale(S.right[((i % S.n) + S.n) % S.n], hw + 3));
        const b0 = V3.add(S.pos[((j % S.n) + S.n) % S.n], V3.scale(S.right[((j % S.n) + S.n) % S.n], -(hw + 3)));
        const b1 = V3.add(S.pos[((j % S.n) + S.n) % S.n], V3.scale(S.right[((j % S.n) + S.n) % S.n], hw + 3));
        gb.quad([a0[0], y0, a0[2]], [b0[0], y1, b0[2]], [b1[0], y1, b1[2]], [a1[0], y0, a1[2]], i % 4 < 2 ? gc : shade(gc, 0.72));
      }
    }
    instances.push({ mesh: R.createMesh(gb.build()), model: M4.ident(), emissive: 0.85, type: "chasmGlow" });
  }

  // divider wall (Blocksize Fog): center island splitting the road
  if (def.divider) {
    const dv = meshBuilder();
    const i0 = Math.floor(def.divider.t0 * S.n), i1 = Math.floor(def.divider.t1 * S.n);
    for (let i = i0; i < i1; i += 2) {
      const p = S.pos[i % S.n];
      const c = (i / 2) % 2 === 0 ? hex("#22D3EE") : hex("#F7931A");
      dv.box(p[0], p[1] + 0.7, p[2], 0.7, 1.4, 3.4, c);
      if (i % 6 === 0) obstacles.push({ x: p[0], z: p[2], r: 1.2 });
    }
    instances.push({ mesh: R.createMesh(dv.build()), model: M4.ident(), emissive: 0.4, type: "divider" });
  }

  // foam-strip ribbon at the waterline contour · OWN mesh instance (not
  // the terrain lattice: free-axis contour verts would corrupt the unique
  // rounded x/z rebuild the headless rock-seat probe runs). Marching-
  // squares per cell the waterline crosses: interpolate edge crossings,
  // expand the segment perpendicular in XZ to ~2.2u. The ribbon must
  // drape on max(terrain, water level) because a flat seat buries the
  // land half of the strip on steep shore facets. Warm foam blue <=0.82
  // · near-white terrain invariant + true sea-foam. Bake-time only.
  if (wetLvl !== null) {
    const fb = meshBuilder();
    const halfW = 1.1; // 2.2u ribbon total
    // per-corner seat · hugs ground on land, rides just above the wash at sea
    const foamY = (x, z) => Math.max(seaBed(x, z), wetLvl) + 0.07;
    for (let gz = 0; gz < GRID; gz++) {
      for (let gx = 0; gx < GRID; gx++) {
        const h00 = hmap[gz][gx], h10 = hmap[gz][gx + 1];
        const h01 = hmap[gz + 1][gx], h11 = hmap[gz + 1][gx + 1];
        const hMin = Math.min(h00, h10, h01, h11);
        const hMax = Math.max(h00, h10, h01, h11);
        if (!(hMin < wetLvl && wetLvl < hMax)) continue;
        const x0 = minX + gx * cellW, x1 = x0 + cellW;
        const z0 = minZ + gz * cellD, z1 = z0 + cellD;
        const pts = [];
        // linearly interpolate each edge whose endpoints straddle wetLvl
        const edge = (ha, hb, xa, za, xb, zb) => {
          const den = hb - ha;
          if (Math.abs(den) < 1e-8) return; // flat edge · guard
          if ((ha < wetLvl) === (hb < wetLvl) && ha !== wetLvl && hb !== wetLvl) return;
          const t = (wetLvl - ha) / den;
          if (t < 0 || t > 1) return;
          pts.push([xa + (xb - xa) * t, za + (zb - za) * t]);
        };
        edge(h00, h10, x0, z0, x1, z0);
        edge(h10, h11, x1, z0, x1, z1);
        edge(h01, h11, x0, z1, x1, z1);
        edge(h00, h01, x0, z0, x0, z1);
        if (pts.length < 2) continue;
        // small hash01 brightness jitter · never a drawn line; blue stays
        // <=0.82 so a bright cell cannot trip the snow% count
        const jit = 0.9 + hash01(gx * 73 + gz * 191) * 0.12;
        const fc = [0.97 * jit, 0.95 * jit, Math.min(0.82, 0.82 * jit), 1];
        // pair crossings in edge order (bottom, right, top, left). A
        // saddle cell crosses all four edges and carries TWO contour
        // segments: pairing (0,1) and (2,3) is one of the two valid
        // marching-squares resolutions, and taking only the first pair
        // would drop half the strip through every saddle.
        for (let p = 0; p + 1 < pts.length; p += 2) {
          const ax = pts[p][0], az = pts[p][1];
          const bx = pts[p + 1][0], bz = pts[p + 1][1];
          let dx = bx - ax, dz = bz - az;
          const len = Math.hypot(dx, dz);
          if (len < 1e-6) continue;
          dx /= len; dz /= len;
          const px = -dz * halfW, pz = dx * halfW;
          // ribbon winding must produce a +Y flat normal · meshBuilder
          // derives normals from winding and the surface is culled
          const xap = ax + px, zap = az + pz, xbp = bx + px, zbp = bz + pz;
          const xam = ax - px, zam = az - pz, xbm = bx - px, zbm = bz - pz;
          fb.quad(
            [xap, foamY(xap, zap), zap], [xbp, foamY(xbp, zbp), zbp],
            [xbm, foamY(xbm, zbm), zbm], [xam, foamY(xam, zam), zam],
            fc,
          );
        }
      }
    }
    if (fb.raw.pos.length) {
      instances.push({ mesh: R.createMesh(fb.build()), model: M4.ident(), emissive: 0, type: "foam" });
    }
  }

  // ---------------- billboards ----------------
  const frameCache = {};
  const billboards = [];
  for (const bb of def.billboards || []) {
    const w = 9, h = 4.5;
    if (!frameCache.f) frameCache.f = R.createMesh(billboardFrame(w, h));
    const pm = propModel(S, hw, { ...bb, side: bb.side });
    const tex = R.createTexture(makeSignCanvas(bb.lines, { fg: bb.fg, fontSize: bb.fontSize }));
    let flickerTex = null;
    if (bb.flicker) flickerTex = R.createTexture(makeSignCanvas(bb.flicker, { fg: "#8E4A2A", fontSize: bb.fontSize }));
    const panel = R.createUVMesh(billboardPanelUV(w, h));
    billboards.push({ frame: frameCache.f, panel, tex, flickerTex, model: pm.model });
  }

  // boost pad visuals (the gameplay circles are rebuilt fresh below) ·
  // pitched to the local road grade so pads on carve rises lie flat on
  // the ramp instead of floating/burying their corners (epic-air 2026-07-18)
  const padMeshKey = "chevron:pad";
  propMeshCache[padMeshKey] = R.createMesh(PROP_BUILDERS.chevron());
  for (const bp of def.boost || []) {
    const i = Math.floor(bp.t * S.n);
    const p = S.pos[i], r = S.right[i], tn = S.tan[i];
    const lateral = (bp.side || 0) * hw;
    const rise = S.pos[(i + 2) % S.n][1] - S.pos[(i - 2 + S.n) % S.n][1];
    const pitch = Math.atan2(rise, 4 * S.total / S.n);
    instances.push({
      mesh: propMeshCache[padMeshKey],
      model: M4.trs(p[0] + r[0] * lateral, p[1] + 0.02, p[2] + r[2] * lateral, Math.atan2(tn[0], tn[2]), -pitch, 0, 1.15),
      emissive: 0.85,
      type: "chevron",
    });
  }

  // start gantry + finish strip
  {
    const tn = S.tan[0], p = S.pos[0];
    const yaw = Math.atan2(tn[0], tn[2]);
    instances.push({
      mesh: R.createMesh(PROP_BUILDERS.startGantry(def.width + 6)),
      model: M4.trs(p[0], p[1], p[2], yaw, 0, 0, 1),
      emissive: 0.25, type: "gantry",
    });
    instances.push({
      mesh: R.createMesh(PROP_BUILDERS.finishBanner(def.width)),
      model: M4.trs(p[0], p[1] + 0.02, p[2], yaw, 0, 0, 1),
      emissive: 0, type: "finish",
    });
  }

  // bounds for the minimap (recorded so cache hits skip the terrain scan)
  vis = {
    road: roadMesh, walls: wallMesh, terrain: terrainMesh, water: waterMesh,
    waterCols, instances, billboards, obstacles, waterfalls, emitters,
    bounds: { minX, maxX, minZ, maxZ },
  };
  if (cacheKey) {
    TRACK_GL.set(cacheKey, vis);
    while (TRACK_GL.size > TRACK_GL_MAX) TRACK_GL.delete(TRACK_GL.keys().next().value);
  }
  } // end cached GPU visuals

  // ---------------- pickups (fresh per race · carry taken/timer state) ----
  const itemBoxes = [];
  for (const t of def.boxes || []) {
    const i = Math.floor(t * S.n);
    const p = S.pos[i], r = S.right[i];
    for (const off of [-0.55, -0.18, 0.18, 0.55]) {
      itemBoxes.push({
        x: p[0] + r[0] * off * hw, y: p[1] + 1.1, z: p[2] + r[2] * off * hw,
        taken: false, timer: 0,
      });
    }
  }

  const boostPads = [];
  for (const bp of def.boost || []) {
    const i = Math.floor(bp.t * S.n);
    const p = S.pos[i], r = S.right[i];
    const lateral = (bp.side || 0) * hw;
    boostPads.push({ x: p[0] + r[0] * lateral, z: p[2] + r[2] * lateral, r: 3.4 });
  }

  const sats = [];
  for (const trail of def.sats || []) {
    const d0 = trail.t0 * S.total, d1 = trail.t1 * S.total;
    for (let d = d0; d < d1; d += 7) {
      // find sample by distance (cum is monotonic)
      let i = Math.floor((d / S.total) * S.n) % S.n;
      const p = S.pos[i], r = S.right[i];
      const lateral = (trail.side || 0) * hw;
      sats.push({
        x: p[0] + r[0] * lateral, y: p[1] + 0.7, z: p[2] + r[2] * lateral,
        taken: false, timer: 0,
      });
    }
  }

  // ---------------- minimap ----------------
  const mm = [];
  {
    const w = vis.bounds.maxX - vis.bounds.minX, d = vis.bounds.maxZ - vis.bounds.minZ;
    const s = 1 / Math.max(w, d);
    for (let i = 0; i < S.n; i += 4) {
      mm.push([(S.pos[i][0] - vis.bounds.minX) * s + (1 - w * s) / 2, (S.pos[i][2] - vis.bounds.minZ) * s + (1 - d * s) / 2]);
    }
  }

  return {
    def, S, hw,
    env,
    hazardOpen,
    hazardRanges,
    gripMult: def.gripMult || 1,
    surface: G.surface,
    meshes: { road: vis.road, walls: vis.walls, terrain: vis.terrain, water: vis.water },
    waterCols: vis.waterCols,
    instances: vis.instances,
    billboards: vis.billboards,
    itemBoxes,
    boostPads,
    sats,
    obstacles: vis.obstacles,
    startPoses,
    minimap: mm,
    aiLine,
    wallLimit: WALL_OFF - 1.0,
    emitters: vis.emitters || [],
    gapAt,
    gapEndFor,
    waterfalls: vis.waterfalls || [],
  };
}

// Locate the nearest spline sample to (x,z), searching a window around the
// last known index. Returns index, signed lateral offset, road height and
// progress distance.
export function surfaceQuery(track, x, z, lastIdx) {
  const S = track.S;
  const n = S.n;
  let best = 1e18, bi = lastIdx | 0;
  const WINDOW = 40;
  for (let k = -WINDOW; k <= WINDOW; k++) {
    const i = (lastIdx + k + n * 4) % n;
    const dx = S.pos[i][0] - x, dz = S.pos[i][2] - z;
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; bi = i; }
  }
  const p = S.pos[bi], r = S.right[bi], tn = S.tan[bi];
  const px = x - p[0], pz = z - p[2];
  const lateral = px * r[0] + pz * r[2];
  const along = px * tn[0] + pz * tn[2];
  // interpolate height along the tangent toward the neighbor the query
  // point actually leans to (shake fix 2026-07-22): raw nearest-sample
  // heights STEP ~0.4u per sample on steep descents, and the camera's
  // hard ground clamp turned that staircase into visible judder on One
  // Chair Peak's summit run. C0-continuous ground also smooths physics
  // ground-following · the jump lip drop stays sharp (it lives between
  // one sample pair either way, and launches key off slope, not steps).
  const ni = along >= 0 ? (bi + 1) % n : (bi - 1 + n) % n;
  const ds = Math.abs(S.cum[ni] - S.cum[bi]) || 1;
  const w = Math.min(Math.abs(along) / ds, 1);
  const roadY = p[1] + (S.pos[ni][1] - p[1]) * w;
  return {
    idx: bi,
    lateral,
    roadY,
    tanYaw: Math.atan2(tn[0], tn[2]),
    dist: S.cum[bi] + along,
    offRoad: Math.abs(lateral) > track.hw + 0.6,
  };
}
