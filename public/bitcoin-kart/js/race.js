// BITCOIN KART · race.js
// One full race: scene assembly, fixed-ish step update (physics, AI, items,
// ranks, laps), chase camera with boost FOV punch, all drawing, FX bridge
// (particles + audio + HUD), countdown, results. Boss races are 1v1.

import { M4, V3, clamp, lerp, damp, TAU } from "./math3d.js";
import { makeEnv } from "./gl.js";
import { buildKartMesh, WHEEL_POS, blobShadowMesh, meshBuilder, hex, shade, PROP_BUILDERS } from "./geometry.js";
import { paintFace } from "./faces.js";
import { buildTrack, surfaceQuery } from "./track.js";
import { makeKart, stepKart, kartCollisions, spinOut, wrapAngle, chaseNear } from "./physics.js";
import { createItemSystem } from "./items.js";
import { aiInput } from "./ai.js";
import { COPY, ROSTER, BOSSES, WORLDS, CLASSES } from "./data.js";
import { Snd } from "./audio.js";
import { createHud } from "./hud.js";

function buildEntityMeshes(R) {
  // banana peel: petals rise from the hub then fold outward at a crease
  // so the skin reads curved, not a paper pinwheel
  const peel = meshBuilder();
  const peelC = hex("#F6C453");
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(a + 0.5), sb = Math.sin(a + 0.5);
    peel.quad([0, 0.06, 0], [ca * 0.55, 0.34, sa * 0.55], [cb * 0.55, 0.34, sb * 0.55], [Math.cos(a + 0.25) * 0.24, 0.1, Math.sin(a + 0.25) * 0.24], peelC);
    peel.quad([ca * 0.55, 0.34, sa * 0.55], [ca * 1.05, 0.14, sa * 1.05], [cb * 1.05, 0.14, sb * 1.05], [cb * 0.55, 0.34, sb * 0.55], shade(peelC, 0.9));
  }
  peel.sphere(0, 0.2, 0, 0.3, 4, 7, hex("#E8B23C"), { smooth: true });

  const fud = meshBuilder();
  fud.box(0, 0, 0, 1.2, 0.8, 0.1, hex("#D8DBE2"));
  fud.box(0, 0.3, 0.01, 1.0, 0.14, 0.12, hex("#E5484D"));
  fud.box(0, 0, 0.01, 1.0, 0.1, 0.12, hex("#9999A1"));
  fud.box(0, -0.24, 0.01, 0.7, 0.1, 0.12, hex("#9999A1"));

  const ratio = meshBuilder();
  ratio.cylX(0, 0, 0, 0.001, 0.001, 3, [0, 0, 0]); // keep builder non-empty guard
  const rb = meshBuilder();
  rb.cyl(0, -0.7, 0, 0.3, 0.3, 1.2, 7, hex("#22D3EE"));
  rb.cyl(0, 0.5, 0, 0.3, 0.02, 0.6, 7, hex("#F5F5F7"));
  rb.pushTri([-0.55, -0.75, 0], [-0.15, -0.35, 0], [-0.15, -0.75, 0], hex("#F5F5F7"));
  rb.pushTri([0.15, -0.75, 0], [0.15, -0.35, 0], [0.55, -0.75, 0], hex("#F5F5F7"));
  rb.pushTri([-0.15, -0.75, 0], [-0.15, -0.35, 0], [-0.55, -0.75, 0], hex("#E8ECF2"));
  rb.pushTri([0.55, -0.75, 0], [0.15, -0.35, 0], [0.15, -0.75, 0], hex("#E8ECF2"));

  const gavel = meshBuilder();
  gavel.cylX(0, 0.5, 0, 0.5, 1.6, 8, hex("#8A5A2B"));
  gavel.box(0, -0.4, 0, 0.22, 1.6, 0.22, hex("#6B4226"));

  const placard = meshBuilder();
  placard.box(0, 1.0, 0, 1.5, 1.0, 0.1, hex("#F5F5F7"));
  placard.box(0, 1.42, 0.01, 1.5, 0.24, 0.12, hex("#E5484D"));
  placard.box(0, 0.3, 0, 0.12, 0.7, 0.12, hex("#8A5A2B"));

  // laser-eye orbs (unit spheres, scaled per frame at the eye sockets)
  const eyeR = meshBuilder();
  eyeR.sphere(0, 0, 0, 1, 3, 6, hex("#FF3B30"));
  const eyeC = meshBuilder();
  eyeC.sphere(0, 0, 0, 1, 3, 6, hex("#5EEBFF"));

  // boost exhaust flame: smooth nested teardrops, emissive + pulsing
  const flameB = meshBuilder();
  flameB.sphere(0, 0, -0.15, 0.9, 6, 9, hex("#FF9E2E"), { alpha: 0.9, squashZ: 1.7, smooth: true });
  flameB.sphere(0, 0, -0.32, 0.5, 5, 8, hex("#FFE08A"), { alpha: 0.95, squashZ: 1.55, smooth: true });

  // shield: a smooth energy bubble with latitude bands · replaces the old
  // scaled item-octa (rudimentary + blocky, operator note 2026-07-18)
  const shieldB = meshBuilder();
  shieldB.sphere(0, 0, 0, 1, 8, 14, hex("#7DE3FF"), { alpha: 0.13, smooth: true });
  shieldB.cyl(0, -0.03, 0, 1.005, 1.005, 0.06, 16, hex("#BDEEFF"), { alpha: 0.42, smooth: true, capTop: false, capBot: false });
  shieldB.cyl(0, 0.46, 0, 0.885, 0.86, 0.05, 16, hex("#9FE8FF"), { alpha: 0.3, smooth: true, capTop: false, capBot: false });
  shieldB.cyl(0, -0.51, 0, 0.86, 0.885, 0.05, 16, hex("#9FE8FF"), { alpha: 0.3, smooth: true, capTop: false, capBot: false });

  return {
    shieldOrb: R.createMesh(shieldB.build()),
    peel: R.createMesh(peel.build()),
    fud: R.createMesh(fud.build()),
    ratio: R.createMesh(rb.build()),
    goldbar: R.createMesh(PROP_BUILDERS.goldBar()),
    hammer: R.createMesh(gavel.build()),
    headline: R.createMesh(placard.build()),
    itemBlock: R.createMesh(PROP_BUILDERS.itemBlock()),
    sat: R.createMesh(PROP_BUILDERS.sat()),
    shadow: R.createMesh(blobShadowMesh()),
    eyeRed: R.createMesh(eyeR.build()),
    eyeCyan: R.createMesh(eyeC.build()),
    flame: R.createMesh(flameB.build()),
  };
}

// map driver weight to an engine tone flavor (heavy = deep)
const engineTone = (d) => 1 - (d.stats.weight || 5) / 12;

// BITCOIN B GOLDEN FIREWORKS · the glyph as burst velocities: every spark
// flies from the burst core to its spot on the B, so the sign draws itself
// in the sky and then rains down as gold. Points in glyph space [-1..1].
const B_PTS = (() => {
  const p = [];
  for (let i = 0; i <= 7; i++) p.push([-0.42, -0.85 + i * (1.7 / 7)]); // spine
  for (const cy of [0.44, -0.44]) { // the two bowls
    for (let i = 0; i <= 7; i++) {
      const a = -Math.PI / 2 + (i / 7) * Math.PI;
      p.push([-0.06 + Math.cos(a) * 0.5, cy + Math.sin(a) * 0.46]);
    }
  }
  for (const sx of [-0.16, 0.14]) { // the protruding strokes, densified
    p.push([sx, 1.0], [sx, 1.18], [sx, -1.0], [sx, -1.18]);
  }
  return p;
})();

function spawnBFirework(parts, cx, cy, cz, right, up, speed) {
  // two waves of the same glyph (outer fast, inner slow) draw a denser B;
  // sparks PRE-SPREAD along their directions so the sign is legible from
  // the first frame instead of opening as one additive white blob
  for (const wave of [1, 0.62]) {
    for (const [px, py] of B_PTS) {
      const dx = right[0] * px + up[0] * py;
      const dy = right[1] * px + up[1] * py;
      const dz = right[2] * px + up[2] * py;
      const warm = 0.88 + Math.random() * 0.12;
      parts.spawn(
        cx + dx * 0.4, cy + dy * 0.4, cz + dz * 0.4,
        dx * speed * wave, dy * speed * wave, dz * speed * wave,
        1.45 + Math.random() * 0.3, 0.36,
        1.0 * warm, 0.72 * warm, 0.14, 0.85, 0.22, 0,
      );
    }
  }
  parts.spawn(cx, cy, cz, 0, 0, 0, 0.3, 1.3, 1.0, 0.85, 0.4, 0.85, 0, 0); // core flash
}

// ---------------------------------------------------------------------------
// KART GL CACHE · session-lifetime GPU per driver. Rebuilding VAOs +
// re-uploading eight 1024x512 face textures EVERY race was the race-start
// hitch on weak GPUs (perf audit 2026-07-15). Built once, prewarmed at title.
// ---------------------------------------------------------------------------
const KART_GL = new Map();
let kartGLRenderer = null;
// drop a driver's baked GL (VAOs + face texture) so a live palette change
// (Golden Satoshi) rebuilds it · pairs with geometry.clearKartMesh
export function clearKartGL(id) { KART_GL.delete(id); }

export function kartGL(R, driver) {
  if (kartGLRenderer !== R) { KART_GL.clear(); kartGLRenderer = R; }
  let e = KART_GL.get(driver.id);
  if (!e) {
    const built = buildKartMesh(driver.id, driver.palette);
    e = {
      body: R.createMesh(built.body),
      // trim (hot specular metal) + glow (emissive, feeds bloom) submeshes ·
      // the per-machine material split from the 2026-07-17 cast overhaul
      trim: built.trim ? R.createMesh(built.trim) : null,
      glow: built.glow ? R.createMesh(built.glow) : null,
      hair: built.hair ? R.createMesh(built.hair) : null,
      wheel: R.createMesh(built.wheel),
      // rim/hub submesh · `wheel` is rubber only since the K19 material
      // split, so every wheel draw must pair with this or the karts lose
      // their rims (metal/specPow are per-draw, not per-vertex)
      wheelHub: built.wheelHub ? R.createMesh(built.wheelHub) : null,
      steer: built.steer ? R.createMesh(built.steer) : null,
      arms: built.arms ? R.createMesh(built.arms) : null,
      flames: built.flames || null,
      head: built.head
        ? { mesh: R.createUVMesh(built.head.sphere), tex: R.createTexture(paintFace(driver.id)), offset: built.head.offset }
        : null,
    };
    KART_GL.set(driver.id, e);
  }
  return e;
}

// mood face textures (podium emotions) · session-cached beside KART_GL,
// painted + uploaded lazily on the first podium that needs each variant
const MOOD_GL = new Map();
let moodGLR = null;
let moodGLRef = null; // set per race so buildPodium can reach R
export function bindMoodGL(R) {
  if (moodGLR !== R) { MOOD_GL.clear(); moodGLR = R; }
  moodGLRef = R;
}
function moodGL(driverId, mood) {
  const key = driverId + "·" + mood;
  if (!MOOD_GL.has(key) && moodGLRef) {
    MOOD_GL.set(key, moodGLRef.createTexture(paintFace(driverId, mood)));
  }
  return MOOD_GL.get(key) || null;
}

export function createRace(opts) {
  // opts: { R, def, playerId, rivals: [driverIds], hard, mode, hudRoot,
  //         quality, reduceFx, ghost, klass, mirror, buzz, holdIntro,
  //         onFinish }
  const { R } = opts;
  // mirror mode: negate x on the control points; every derived surface
  // (props, racing line, minimap, hazards) follows automatically
  let def = opts.def;
  if (opts.mirror) def = { ...def, pts: def.pts.map((p) => [-p[0], p[1], p[2]]) };
  const speedMult = (CLASSES[opts.klass] || CLASSES.bits).mult;
  const hardAI = !!opts.hard || opts.klass === "fullsend";
  // SATS is billed as "relaxed pace · learn the lines" · the gentle band
  // makes that true (difficulty retune 2026-07-21). opts.gentle is the
  // difficulty system's lever (2026-07-22): RELAXED setting or the AUTO
  // assist easing the field for a struggling player · never on hard AI.
  const gentleAI = !hardAI && (opts.klass === "sats" || !!opts.gentle);
  // cache key: same track + same mirror = same GPU visuals (mirror flips
  // the control points, so it is its own cache entry)
  const track = buildTrack(R, def, def.id + "|" + (opts.mirror ? "m" : "n"));
  const hud = createHud(opts.hudRoot);
  const laps = def.laps;

  // ---- grid ----
  const drivers = [];
  const playerDriver = ROSTER.find((d) => d.id === opts.playerId) || ROSTER[0];
  for (const id of opts.rivals) {
    const d = ROSTER.find((x) => x.id === id) || BOSSES[id];
    if (d) drivers.push(d);
  }
  const karts = [];
  const gridCount = drivers.length + 1;
  drivers.forEach((d, i) => {
    const k = makeKart(d, track.startPoses[i], false, speedMult);
    k.lap = 0;
    karts.push(k);
  });
  const player = makeKart(playerDriver, track.startPoses[gridCount - 1], true, speedMult);
  player.lap = 0;
  karts.push(player);

  // kart meshes · session-cached GPU resources (see KART_GL above)
  bindMoodGL(R); // podium mood faces share the same session-cache pattern
  const kartMeshes = {};
  for (const k of karts) {
    if (!kartMeshes[k.driver.id]) kartMeshes[k.driver.id] = kartGL(R, k.driver);
  }
  const ent = buildEntityMeshes(R);
  const partsAdd = R.createParticles(400);
  const partsSoft = R.createParticles(240);
  // which surface flavor the skid loop sings in (Tier 2 · audio.js skid)
  const SURFACE_SOUND = { winter: "ice", peak: "ice", beach: "sand" };
  let wrongBeepT = 1.0;
  let mistAcc = 0; // waterfall spray throttle
  // high path runs a little hot (more juice per burst); the auto quality
  // drop below still clamps straight to 0.5 on sustained slow frames
  let fxScale = opts.reduceFx ? 0.4 : 1.15;
  // cheap specular master switch: weak devices skip the glint entirely
  const specOn = opts.reduceFx ? 0 : 1;
  // SHINE dust tint (2026-07-22): the wheels throw the world they ride on
  const DUST_COL = {
    sand: [0.87, 0.76, 0.55], snow: [0.94, 0.96, 1.0], gold: [1.0, 0.82, 0.35],
    grass: [0.55, 0.65, 0.4], wet: [0.5, 0.62, 0.68], rock: [0.62, 0.6, 0.58],
    city: [0.58, 0.58, 0.62], marble: [0.68, 0.68, 0.7],
  }[track.surface] || [0.6, 0.58, 0.55];
  let streakAcc = 0; // SHINE wind streaks · top-speed air rushing past
  let slowT = 0; // rolling slow-frame budget for the auto quality drop
  let resDropped = false; // stage-two: one-way render-resolution drop
  // the quality tier owns the baseline (high 1 / medium 0.85 / low 0.62);
  // the auto drop scales RELATIVE to it and dispose restores it exactly,
  // so a low-tier phone is never accidentally RAISED to 0.85 and the
  // player's chosen tier survives the race (review 2026-07-14)
  const resBase = R.getResScale ? R.getResScale() : 1;
  const postBase = R.getPost ? R.getPost() : false; // restored by dispose, like resBase
  // skid marks: fading dark quads laid at the rear wheels while drifting
  const skids = R.createRibbon(420, 6);
  // K10 hot skids: the charge tier laid as LIGHT on top of the rubber ·
  // narrower, lifted 0.06 clear of the dark ribbon, drawn additively so
  // the drift colour language reads on the ground and not only in sparks.
  // Short life on purpose (0.7s): the rubber is the record, this is the
  // burn. Ring buffer, so a pack drifting past just recycles the oldest.
  const hotSkids = R.createRibbon(260, 0.7);
  // per-world ambience bed starts with the flyby, before any music
  const AMBIENCE_BY_THEME = {
    beach: "surf", docks: "surf", winter: "wind", peak: "wind",
    fog: "city", neoncity: "city", printer: "city", blimp: "city",
    glass: "city", etf: "city", circuit: "surf", goldmine: "drips",
  };
  Snd.ambience(AMBIENCE_BY_THEME[def.theme] || null);

  // ghost PLAYBACK rides Time Trial, the Daily Circuit (your own best for
  // today's combo · class/mirror fixed per UTC day) and dare challenges
  // (?ghost= deep links). RECORDING is every player run · any finish can
  // mint a dare from the share button (2026-07-16).
  const ghostable = opts.mode === "tt" || opts.mode === "daily" || opts.mode === "challenge";
  let ghostFrames = opts.ghost || null;
  const ghostRec = [];
  let ghostRecT = 0;
  let ghostMesh = null;
  if (ghostFrames && ghostable) {
    ghostMesh = kartMeshes[playerDriver.id];
  }
  // world-leader rival ghost (daily) · injected async by main.js once
  // the fetch lands; renders as an orange-glow twin of the player mesh
  let rivalGhost = null;
  let rivalToastPending = false;
  const fmtGhostMs = (ms) =>
    Math.floor(ms / 60000) + ":" + String(Math.floor((ms % 60000) / 1000)).padStart(2, "0") + "." + Math.floor((ms % 1000) / 100);
  function setRivalGhost(g) {
    if (!ghostable || !g || !Array.isArray(g.frames) || !g.frames.length) return;
    rivalGhost = g;
    if (phase === "run") {
      hud.toast("WORLD BEST ON TRACK · " + g.name + " · " + fmtGhostMs(g.t), "#F7931A");
    } else {
      rivalToastPending = true; // announced at GO
    }
  }

  // minimap transform (mirrors track.js normalization)
  {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of track.S.pos) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
    }
    const w = maxX - minX, d = maxZ - minZ;
    const s = 1 / Math.max(w, d);
    const p0 = track.S.pos[0];
    hud.initMap({
      norm: track.minimap,
      minX, minZ, scale: s,
      offX: (1 - w * s) / 2,
      offZ: (1 - d * s) / 2,
      start: [(p0[0] - minX) * s + (1 - w * s) / 2, (p0[2] - minZ) * s + (1 - d * s) / 2],
    });
  }

  // ---- FX bridge ----
  const burst = (x, y, z, n, col, speed, life, size, grav) => {
    const N = Math.max(1, Math.round(n * fxScale));
    for (let i = 0; i < N; i++) {
      const a = Math.random() * TAU;
      const v = (0.4 + Math.random() * 0.6) * speed;
      partsAdd.spawn(
        x, y, z,
        Math.cos(a) * v, speed * 0.6 * Math.random(), Math.sin(a) * v,
        life * (0.6 + Math.random() * 0.6), size, col[0], col[1], col[2], 0.9, grav === undefined ? 6 : grav,
      );
    }
  };
  const nearPlayer = (k) => {
    if (k === player) return true;
    return V3.dist(k.pos, player.pos) < 70;
  };
  const buzz = opts.buzz || (() => {});
  const fx = {
    // optional kart context: SFX from karts far away from the player are
    // culled so an AI item launch across the map is not in your ear
    sfx: (n, o, k) => { if (k && !nearPlayer(k)) return; Snd.sfx(n, o); },
    hop(k) { if (nearPlayer(k)) burst(k.pos[0], k.pos[1] + 0.1, k.pos[2], 4, [0.7, 0.65, 0.55], 2, 0.4, 0.3); },
    land(k) {
      if (!nearPlayer(k)) return;
      // land sfx (K11) · opt is IMPACT ENERGY, not a flat weight. physics
      // wrote k.squash from the landing |vy| one line before this call
      // (0.2 floor .. 0.55 cap) and then zeroed vy, so squash is the only
      // surviving record of how hard the kart hit. The 0.35 floor keeps a
      // scrape audible; rivals stay at half so a nearby AI landing never
      // outguns yours. sfxOn gated in Snd.sfx.
      const impact = 0.35 + clamp((k.squash - 0.2) / 0.35, 0, 1) * 0.65;
      Snd.sfx("land", impact * (k === player ? 1 : 0.5));
      if (k === player) buzz(8);
      for (let i = 0; i < 6 * fxScale; i++) {
        const a = Math.random() * TAU;
        partsSoft.spawn(
          k.pos[0] + Math.cos(a) * 0.8, k.pos[1] + 0.12, k.pos[2] + Math.sin(a) * 0.8,
          Math.cos(a) * 2.5, 0.8, Math.sin(a) * 2.5,
          0.45, 0.35, 0.72, 0.66, 0.55, 0.55, 3,
        );
      }
    },
    boxRespawn(box) {
      burst(box.x, box.y, box.z, 8, [1.0, 1.0, 0.95], 3, 0.5, 0.4);
    },
    fallStart(k) {
      if (k === player) { buzz(50); camShake = Math.max(camShake, 0.4); }
      if (!nearPlayer(k)) return;
      const wet = !!track.waterCols;
      Snd.sfx(wet ? "splash" : "hit", 0, k);
      const c = wet ? [0.4, 0.75, 0.85] : [0.6, 0.55, 0.45];
      burst(k.pos[0], k.pos[1] + 0.3, k.pos[2], 20, c, 6, 0.8, 0.55);
    },
    rescued(k) {
      if (k === player) {
        hud.toast(pick(COPY.raceEvents.fall), "#22D3EE");
        Snd.sfx("rescue");
      }
      burst(k.pos[0], k.pos[1] + 0.8, k.pos[2], 12, [1.0, 0.82, 0.4], 4, 0.6, 0.45);
    },
    bigAir(k) {
      k.bigAirs = (k.bigAirs || 0) + 1; // MOON LANDING challenge counter
      if (k === player) {
        hud.toast(pick(COPY.raceEvents.bigAir), "#FB923C");
        Snd.sfx("boing");
        buzz(12);
      }
    },
    chargeTier(k, t) {
      k.rimFlash = 0.4;
      if (k === player) Snd.sfx(t === 1 ? "charge1" : "charge2");
    },
    miniTurbo(k, t) {
      if (k === player) { Snd.sfx("turbo"); buzz(t === 2 ? 18 : 10); }
      const c = t === 2 ? [0.4, 0.9, 1.0] : [1.0, 0.62, 0.15];
      // K10: the release is the payoff for the whole charge · double the
      // burst so it punctuates the hot trail rather than under-reading it
      burst(k.pos[0], k.pos[1] + 0.4, k.pos[2], 28, c, 5, 0.5, 0.5);
    },
    wallHit(k) {
      if (k === player) { buzz(12); camShake = Math.max(camShake, 0.22); }
      if (nearPlayer(k)) { Snd.sfx("bump"); burst(k.pos[0], k.pos[1] + 0.5, k.pos[2], 8, [0.8, 0.8, 0.85], 4, 0.4, 0.35); }
    },
    draft(k) {
      if (k === player) {
        Snd.sfx("draft");
        hud.toast("SLIPSTREAM", "#22D3EE");
        buzz(10);
      }
      burst(k.pos[0], k.pos[1] + 0.6, k.pos[2], 8, [0.5, 0.85, 1.0], 4, 0.4, 0.4);
    },
    bump(k) { if (nearPlayer(k)) Snd.sfx("bump"); },
    bumpPair(a, b) {
      if (nearPlayer(a)) Snd.sfx("bump");
      burst((a.pos[0] + b.pos[0]) / 2, a.pos[1] + 0.6, (a.pos[2] + b.pos[2]) / 2, 5, [1, 0.8, 0.4], 3, 0.35, 0.3);
    },
    spin(k, cause) {
      if (nearPlayer(k)) Snd.sfx("hit");
      burst(k.pos[0], k.pos[1] + 0.9, k.pos[2], 16, [1.0, 0.6, 0.2], 5, 0.7, 0.5);
      if (k === player) {
        // the item that got you names the insult (PAPER HANDS, REGULATED)
        const pool = (cause && COPY.raceEvents.causes[cause]) || COPY.raceEvents.hit;
        hud.toast(pick(pool), "#E5484D");
        buzz(45);
        camShake = Math.max(camShake, 0.45);
      }
    },
    pill(k, stole, victim) {
      if (k === player) hud.toast(stole ? COPY.raceEvents.pill.stole : COPY.raceEvents.pill.consolation, "#F7931A");
      burst(k.pos[0], k.pos[1] + 1.1, k.pos[2], 14, [1.0, 0.58, 0.1], 4, 0.6, 0.5);
      // the victim glows orange for a beat · being pilled is VISIBLE
      if (victim && stole) {
        victim.rimFlash = Math.max(victim.rimFlash || 0, 0.6);
        burst(victim.pos[0], victim.pos[1] + 1.0, victim.pos[2], 10, [1.0, 0.62, 0.15], 4, 0.5, 0.45);
        if (victim === player) {
          hud.flashScreen("rgba(247,147,26,0.4)");
          hud.toast(COPY.raceEvents.pill.robbed, "#F7931A");
        }
      }
    },
    shieldPop(k) {
      if (nearPlayer(k)) Snd.sfx("shield");
      burst(k.pos[0], k.pos[1] + 0.9, k.pos[2], 12, [0.3, 0.87, 0.5], 4, 0.5, 0.45);
    },
    boxBreak(box, k) {
      if (k === player) Snd.sfx("doink");
      burst(box.x, box.y, box.z, 12, [1.0, 0.62, 0.15], 4, 0.5, 0.5);
    },
    satPickup(s, k) {
      if (k === player) { Snd.sfx("sat", k.sats); hud.setSats(k.sats); }
      burst(s.x, s.y, s.z, 5, [1.0, 0.8, 0.3], 2.5, 0.35, 0.3, 2);
    },
    pad(k) {
      if (k === player) Snd.sfx("zipper");
      burst(k.pos[0], k.pos[1] + 0.2, k.pos[2], 8, [1.0, 0.7, 0.2], 4, 0.4, 0.4);
    },
    laser(k) {
      const f = [Math.sin(k.heading), 0, Math.cos(k.heading)];
      for (let i = 0; i < 10 * fxScale; i++) {
        partsAdd.spawn(
          k.pos[0] + f[0] * (1 + i * 0.5), k.pos[1] + 1.1, k.pos[2] + f[2] * (1 + i * 0.5),
          f[0] * 14, 0, f[2] * 14, 0.3, 0.4, 1.0, 0.3, 0.2, 0.9, 0,
        );
      }
      if (k === player) hud.toast(pick(COPY.raceEvents.boost), "#FB923C");
    },
    chairOn(k) {
      burst(k.pos[0], k.pos[1] + 1, k.pos[2], 22, [1.0, 0.62, 0.15], 6, 0.8, 0.6);
      if (k === player) hud.toast(COPY.raceEvents.chair[0] + " · " + COPY.raceEvents.chair[1], "#F7931A");
    },
    boltFlash() {
      hud.flashScreen("rgba(255,209,102,0.55)");
      for (const k of karts) if (k.boltT > 0) burst(k.pos[0], k.pos[1] + 1.4, k.pos[2], 8, [1, 0.85, 0.4], 3, 0.5, 0.4);
    },
    hammerTelegraph(target) {
      if (target === player) hud.toast("REGULATORY HAMMER INCOMING", "#E5484D");
    },
    hammerStrike(k) {
      Snd.sfx("hammer");
      burst(k.pos[0], k.pos[1] + 0.5, k.pos[2], 24, [1.0, 0.4, 0.3], 7, 0.7, 0.7);
      hud.flashScreen("rgba(229,72,77,0.35)");
      if (k === player) { buzz([40, 40, 80]); camShake = Math.max(camShake, 0.7); }
    },
    projHit(e, k) {
      if (nearPlayer(k)) Snd.sfx("hit");
      if (e.type === "ratio") {
        // the ratio fantasy: a blue-check detonation, cyan over white
        burst(e.x, e.y + 0.4, e.z, 12, [0.13, 0.83, 0.93], 5, 0.6, 0.55);
        burst(e.x, e.y + 0.4, e.z, 8, [0.96, 0.96, 0.98], 4, 0.5, 0.45);
      } else {
        burst(e.x, e.y, e.z, 12, [1.0, 0.5, 0.3], 5, 0.5, 0.5);
      }
      if (e.owner === player && k !== player) hud.toast(pick(COPY.raceEvents.overtake), "#4ADE80");
      if (k === player && e.owner && e.owner.driver.taunts) {
        speak(e.owner, tauntLine(e.owner));
      }
    },
    trapHit(e, k) {
      if (nearPlayer(k)) Snd.sfx("hit");
      burst(e.x, e.y + 0.5, e.z, 10, [1.0, 0.7, 0.3], 4, 0.5, 0.4);
      if (k === player && e.owner && e.owner !== player && e.owner.driver.taunts) {
        speak(e.owner, tauntLine(e.owner));
      }
    },
    trapSmash(e, k) {
      // One Chair rolls over a trap and flattens it · no spin, no callout
      if (nearPlayer(k)) Snd.sfx("bump");
      burst(e.x, e.y + 0.4, e.z, 8, [1.0, 0.62, 0.15], 4, 0.45, 0.4);
    },
  };

  const items = createItemSystem(track, karts, fx, opts.mode === "tt");

  // boss signature litter (see the boss-phases block in update)
  const BOSS_PHASES = {
    bear2014: { type: "peel", every: 7 },
    headline: { type: "headline", every: 9 },
    schiff: { type: "goldbar", every: 5, finalLapOnly: true },
  };
  const bossKart = karts.find((k) => !k.isPlayer && BOSS_PHASES[k.driver.id]) || null;
  let bossDropT = 0;
  let goldRainAnnounced = false;

  // ---- cinema (pre-race story shots · 2026-07-21) ----
  // opts.cinema = { seq: [shot, ...] } · each shot: { dur, focus, a0, a1,
  // r0, r1, h0, h1, ty, fov, card:{label,title,line}, taunt, fly:[t0,t1,h,lat] }.
  // Parametric orbit/push moves over the LIVE grid (focus "player" |
  // "boss" | driverId · angle 0 faces the kart head-on), or a spline
  // flight via `fly`. Karts stay frozen (`running` gates on run/done),
  // music stays silent through it, and one tap or Enter skips the whole
  // reel into the flyby · never a soft-lock.
  const cine = opts.cinema && opts.cinema.seq && opts.cinema.seq.length
    ? { seq: opts.cinema.seq, i: -1, t: 0 }
    : null;

  // ---- state ----
  let phase = cine ? "cinema" : "intro"; // (cinema ->) intro -> count -> run -> done
  let phaseT = 0;
  let raceT = 0;
  let countStep = -1;
  let startPress = -1; // when the player first held throttle during the count
  let sawBrakeHold = false; // auto-gas ritual armed: a throttle-zero count frame
  let hadRocketStart = false; // perfect launch · feeds the IGNITION challenge
  let weatherAcc = 0;
  let lightningT = 4 + Math.random() * 6; // rain skies: storm strikes
  let emitAcc = 0; // living-emitter spawn cadence
  let meteorT = 2 + Math.random() * 4; // aurora/night skies: shooting stars
  let lastRoulTick = -1;
  let camShake = 0;
  let camRightRef = [1, 0, 0]; // last frame's camera right, for audio panning
  let passByCd = 0;
  let podium = null; // built once the race is over (non-TT)
  let orbT = 0;
  let fwT = 0, podFwT = 0.4; // B-firework timers (victory lap / podium)
  const cam = {
    pos: V3.add(track.startPoses[gridCount - 1] ? [track.startPoses[gridCount - 1].x, 8, track.startPoses[gridCount - 1].z] : [0, 8, 0], [0, 0, 0]),
    target: [0, 0, 0],
    fov: (62 * Math.PI) / 180,
    fovSpd: 0, // slewed speed for the SHINE lens · raw speed pulses on crests
    dofAmt: 0,
    dofFocus: 12,
  };
  let finishOrder = [];
  let doneT = 0;
  let musicKey = null;
  let prevPlayerRank = gridCount;

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ---- world-space taunt bubbles ----
  // One bubble at a time, anchored over the speaking kart (projected each
  // frame). reduceFx keeps the old HUD toast instead of a moving element.
  let bubble = null; // { k, t }
  // anti-repeat pick: with 10+ line banks, hearing the same line twice in
  // a row reads as a bug · remember each kart's last index and nudge off it
  function tauntLine(k) {
    const list = k.driver.taunts;
    if (!list || !list.length) return null;
    let idx = Math.floor(Math.random() * list.length);
    if (list.length > 1 && idx === k.lastTauntIdx) idx = (idx + 1) % list.length;
    k.lastTauntIdx = idx;
    return list[idx];
  }
  function speak(k, text) {
    if (!k.driver.taunts || !text) return;
    if (opts.reduceFx) {
      hud.toast(k.driver.displayName + ": " + text, "#9999A1", true);
      return;
    }
    if (bubble && bubble.t > 1.2) return; // let the current line land
    bubble = { k, t: 2.6 };
    hud.setBubble(text);
  }
  // project a world point through the current camera; null when behind
  function projectToScreen(p) {
    const v = cam.env && cam.env.vp;
    if (!v) return null;
    const w = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
    if (w < 0.1) return null;
    const x = (v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12]) / w;
    const y = (v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13]) / w;
    if (x < -1.15 || x > 1.15 || y < -1.15 || y > 1.15) return null;
    return [
      (x * 0.5 + 0.5) * R.canvas.clientWidth,
      (1 - (y * 0.5 + 0.5)) * R.canvas.clientHeight,
    ];
  }
  function updateBubble(dt) {
    if (!bubble) return;
    bubble.t -= dt;
    if (bubble.t <= 0 || bubble.k.finished) {
      hud.clearBubble();
      bubble = null;
      return;
    }
    const k = bubble.k;
    const s = projectToScreen([k.pos[0], k.pos[1] + 2.3, k.pos[2]]);
    hud.moveBubble(s ? s[0] : 0, s ? s[1] : 0, !!s);
  }

  // course card over the flyby: track name, world, one-line fantasy.
  // Full-grid modes carry the team billing (TT is a solo run). When a
  // cinema reel precedes the flyby, the card waits for the handoff.
  function showCourseCard() {
    const world = WORLDS.find((w) => w.id === def.world);
    const billing = opts.mode === "tt" ? "" : COPY.teams.btc + " vs " + COPY.teams.fiat + " · ";
    hud.introCard(def.name, billing + (world ? world.name : def.world) + " · " + def.laps + " laps", def.intro || "", def.tip || "");
  }
  if (!cine) showCourseCard();

  function cineFocusKart(sh) {
    if (sh.focus === "boss") return bossKart || karts.find((k) => !k.isPlayer) || player;
    if (sh.focus && sh.focus !== "player") return karts.find((k) => k.driver.id === sh.focus) || player;
    return player;
  }
  function cineShotStart() {
    const sh = cine.seq[cine.i];
    hud.cineCard(sh.card && sh.card.label, sh.card && sh.card.title, sh.card && sh.card.line);
    if (sh.taunt) {
      const k = cineFocusKart(sh);
      if (!k.isPlayer) speak(k, sh.taunt);
    }
  }
  function endCinema() {
    if (phase !== "cinema") return;
    hud.cineOn(false);
    phase = "intro";
    phaseT = 0;
    showCourseCard();
  }

  function setMusic() {
    // silence through the cinema + flyby + countdown so bar 0 lands on
    // GO, and stop when the player crosses the line for a clear fanfare
    if (phase === "cinema" || phase === "intro" || phase === "count" || player.finished) {
      if (musicKey) { Snd.stopTheme(); musicKey = null; }
      return;
    }
    const want = player.chairT > 0 ? "chair" : def.music;
    if (want !== musicKey) {
      musicKey = want;
      Snd.playTheme(want);
      if (player.lap >= laps) Snd.setLift(1.12, 1);
    }
    // P1 layer: leading is audible (octave brass doubling · Tier 2)
    Snd.setLayer(phase === "run" && !player.finished && player.rank === 1 && karts.length > 1);
  }

  function ranks() {
    const sorted = karts.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    sorted.forEach((k, i) => { k.rank = i + 1; });
    if (player.rank < prevPlayerRank && phase === "run" && !player.finished) {
      hud.toast(pick(COPY.raceEvents.overtake), "#4ADE80");
      // taking the LEAD earns the crowd, not just the chime
      Snd.sfx(player.rank === 1 ? "crowd" : "move");
    } else if (player.rank > prevPlayerRank && phase === "run") {
      // taunt from whoever just passed us · spoken over their kart
      const passer = karts.find((k) => k.rank === player.rank - 1 && k !== player);
      if (passer) speak(passer, tauntLine(passer));
    }
    prevPlayerRank = player.rank;
  }

  function update(dt, input) {
    // one-way auto quality drop, two stages: two sustained seconds under
    // ~30fps halves the particle/FX budget; two MORE slow seconds after
    // that drop the render resolution (fill-rate is the usual mobile
    // bottleneck). Measured on the raw frame gap, before the physics
    // clamp. Resolution restores on dispose · menus stay crisp.
    if (phase === "run") {
      slowT = dt > 0.034 ? slowT + dt : Math.max(0, slowT - dt * 2);
      if (slowT > 2) {
        if (fxScale > 0.5) fxScale = 0.5;
        else if (!resDropped) { resDropped = true; R.setResScale(resBase * 0.85); R.setPost(false); }
        slowT = 0;
      }
    }
    dt = Math.min(dt, 1 / 30);
    phaseT += dt;
    hud.tick(dt);

    if (phase === "cinema") {
      if (cine.i < 0) { cine.i = 0; cine.t = 0; hud.cineOn(true); cineShotStart(); }
      cine.t += dt;
      if (input.skip) endCinema();
      else if (cine.t >= cine.seq[cine.i].dur) {
        cine.i += 1;
        cine.t = 0;
        if (cine.i >= cine.seq.length) endCinema();
        else cineShotStart();
      }
    } else if (phase === "intro") {
      // first-race onboarding: hold the flyby until the hint is dismissed
      const held = opts.holdIntro && opts.holdIntro();
      if (held) phaseT = Math.min(phaseT, 2.0);
      if ((phaseT > 4.2 || input.skip) && !held) {
        phase = "count";
        phaseT = 0;
        countStep = -1;
        hud.clearIntro();
      }
    } else if (phase === "count") {
      const step = Math.floor(phaseT);
      if (step !== countStep && step < 3) {
        countStep = step;
        hud.countdown(COPY.countdown[step]);
        Snd.sfx("count");
        // one bark on "1": the boss stares you down, or a random rival
        // mouths off across the grid · silence on GO
        if (step === 2 && karts.length > 1) {
          const rival = bossKart || karts[Math.floor(Math.random() * karts.length)];
          if (rival && !rival.isPlayer) speak(rival, tauntLine(rival));
        }
      }
      // rocket-start ritual: reward a throttle press timed to GO,
      // punish a held-since-forever jump start with wheelspin.
      // AUTO GAS exception (2026-07-21): with auto-accelerate the throttle
      // is forced to 1 from the first count frame, which used to hand every
      // default-settings mobile player the jump-start penalty on every
      // race. Under auto gas the ritual only arms after a throttle-zero
      // frame (the player holding BRAKE through the count) · do nothing =
      // neutral launch, hold BRAKE and release on the 1 = the mobile
      // rocket start the coach teaches.
      if (input.throttle) {
        if (startPress < 0 && (!input.autoGas || sawBrakeHold)) startPress = phaseT;
      } else {
        startPress = -1;
        sawBrakeHold = true;
      }
      if (phaseT >= 3) {
        phase = "run";
        hud.countdown("GO");
        Snd.sfx("go");
        buzz(20);
        // announce the world-best rival line the moment the race is live
        if (rivalGhost && rivalToastPending) {
          rivalToastPending = false;
          hud.toast("WORLD BEST ON TRACK · " + rivalGhost.name + " · " + fmtGhostMs(rivalGhost.t), "#F7931A");
        }
        if (startPress >= 0) {
          const held = phaseT - startPress;
          if (held <= 0.45) {
            player.boostT = Math.max(player.boostT, 1.0);
            player.boostKind = "start";
            hadRocketStart = true;
            fx.miniTurbo(player, 1);
            hud.toast("ROCKET START", "#FB923C");
          } else if (held > 1.0) {
            player.slipT = 0.8;
            hud.toast("JUMPED THE START · wheelspin", "#E5484D");
          }
        }
        // the AI grid launches unevenly, skill-weighted like a real pack
        for (const k of karts) {
          if (k === player) continue;
          const r = Math.random();
          if (r < (k.driver.ai.skill || 0.7) * 0.45) k.boostT = 0.7;
          else if (r > 0.93) k.slipT = 0.5;
        }
        player.lapStart = raceT;
        setTimeout(() => hud.countdown(""), 700);
      }
    } else if (phase === "run" || phase === "done") {
      raceT += dt;
    }

    const running = phase === "run" || phase === "done";

    // drive all karts
    for (const k of karts) {
      let inp;
      if (!running) {
        inp = { throttle: 0, steer: 0, drift: false };
      } else if (k === player && !player.finished) {
        inp = input;
      } else {
        inp = aiInput(k, track, karts, items, player, dt, hardAI, gentleAI);
        if (inp.useItem) items.use(k);
      }
      const prevLap = k.lap;
      stepKart(k, inp, track, dt, fx);

      // drift sparks: anchored at the rear wheels, ramping with charge tier
      if (k.drift.active && k.drift.tier > 0 && nearPlayer(k)) {
        const c = k.drift.tier === 2 ? [0.4, 0.9, 1.0] : [1.0, 0.62, 0.15];
        // K4 slide rotates the drawn chassis · anchors must track the
        // DRAWN rear wheels or mid-drift sparks float a wheel-width off
        const visYaw = k.heading + k.slideVis;
        const fwdX = Math.sin(visYaw), fwdZ = Math.cos(visYaw);
        const size = 0.32 + k.drift.tier * 0.1;
        // K10 wheel cores: a welded-bright point held at each rear contact
        // patch so the tyre itself burns instead of only shedding sparks ·
        // near-white with the tier hue, one short particle per wheel per
        // frame, fxScale-gated like every other per-frame spawn here
        const core = k.drift.tier === 2 ? [0.78, 0.98, 1.0] : [1.0, 0.92, 0.72];
        for (const s of [-0.68, 0.68]) {
          const rx = Math.cos(visYaw) * s, rz = -Math.sin(visYaw) * s;
          if (Math.random() < fxScale) {
            partsAdd.spawn(
              k.pos[0] + rx - fwdX * 0.78, k.pos[1] + 0.2, k.pos[2] + rz - fwdZ * 0.78,
              0, 0.4, 0, 0.07, 0.4 + k.drift.tier * 0.08,
              core[0], core[1], core[2], 1, 0,
            );
          }
          const n = k.drift.tier === 2 ? 2 : 1;
          for (let j = 0; j < n; j++) {
            if (Math.random() < 0.85 * fxScale) {
              partsAdd.spawn(
                k.pos[0] + rx - fwdX * 0.78, k.pos[1] + 0.14, k.pos[2] + rz - fwdZ * 0.78,
                (Math.random() - 0.5) * 3 - fwdX * 5, 1.6, (Math.random() - 0.5) * 3 - fwdZ * 5,
                0.32, size, c[0], c[1], c[2], 0.95, 8,
              );
            }
          }
        }
      }
      // skid marks: lay fading rubber at the rear wheels while drifting
      if (k.drift.active && !k.airborne && k.speed > 10) {
        // rubber lays under the DRAWN rear wheels (K4 slide) · smooth by
        // construction: slideVis settles during the drift hop before any
        // quad is laid, so the ribbon never kinks at drift entry
        const visYaw = k.heading + k.slideVis;
        const fwdX = Math.sin(visYaw), fwdZ = Math.cos(visYaw);
        for (const side of [-1, 1]) {
          const rx = Math.cos(visYaw) * side * 0.68, rz = -Math.sin(visYaw) * side * 0.68;
          const wx = k.pos[0] + rx - fwdX * 0.78, wz = k.pos[2] + rz - fwdZ * 0.78;
          const cur = [wx, k.pos[1] + 0.045, wz];
          const key = side < 0 ? "prevWheelL" : "prevWheelR";
          const prev = k[key];
          if (prev) {
            const dx = cur[0] - prev[0], dz = cur[2] - prev[2];
            const len = Math.hypot(dx, dz);
            if (len > 0.5 && len < 4) {
              const px = -dz / len * 0.12, pz = dx / len * 0.12;
              skids.add(
                [prev[0] - px, prev[1], prev[2] - pz], [prev[0] + px, prev[1], prev[2] + pz],
                [cur[0] + px, cur[1], cur[2] + pz], [cur[0] - px, cur[1], cur[2] - pz],
                0.05, 0.05, 0.06, 0.42,
              );
              // K10: once the drift is charging, the same segment gets a
              // tier-coloured light quad over it · same colours as the
              // sparks so ground and air tell one story. Near-player only
              // so a distant pack cannot evict the player's own trail.
              if (k.drift.tier > 0 && nearPlayer(k) && !opts.reduceFx) {
                const hx = -dz / len * 0.18, hz = dx / len * 0.18;
                const hc = k.drift.tier === 2 ? [0.4, 0.9, 1.0] : [1.0, 0.62, 0.15];
                hotSkids.add(
                  [prev[0] - hx, prev[1] + 0.06, prev[2] - hz], [prev[0] + hx, prev[1] + 0.06, prev[2] + hz],
                  [cur[0] + hx, cur[1] + 0.06, cur[2] + hz], [cur[0] - hx, cur[1] + 0.06, cur[2] - hz],
                  hc[0], hc[1], hc[2], 0.75,
                );
              }
              k[key] = cur;
            } else if (len >= 4) {
              k[key] = cur;
            }
          } else {
            k[key] = cur;
          }
        }
      } else {
        k.prevWheelL = null;
        k.prevWheelR = null;
      }

      // slipstream: tuck behind a rival for ~1.2s and pop out with a burst
      if (running && !k.finished && k.speed > 18 && !k.airborne && k.boostT <= 0) {
        const fwdX = Math.sin(k.heading), fwdZ = Math.cos(k.heading);
        let drafting = false;
        for (const o of karts) {
          if (o === k) continue;
          const dx = o.pos[0] - k.pos[0], dz = o.pos[2] - k.pos[2];
          const ahead = dx * fwdX + dz * fwdZ;
          if (ahead < 2.5 || ahead > 9.5) continue;
          const lat = Math.abs(dx * fwdZ - dz * fwdX);
          if (lat > 1.7) continue;
          if (Math.cos(wrapAngle(o.heading - k.heading)) < 0.8) continue;
          drafting = true;
          break;
        }
        if (drafting) {
          k.draftT += dt;
          if (k.draftT > 1.2) {
            k.draftT = 0;
            k.boostT = Math.max(k.boostT, 0.55);
            k.boostKind = "draft";
            fx.draft(k);
          }
        } else {
          k.draftT = Math.max(0, k.draftT - dt * 2);
        }
      }

      // exhaust puffs: idle revving on the grid, light chuff while driving
      if (nearPlayer(k) && !k.airborne) {
        k.exhaustAcc += dt * (phase === "count" ? 9 : 2.2 + k.speed * 0.05);
        while (k.exhaustAcc > 1) {
          k.exhaustAcc -= 1;
          const fwdX = Math.sin(k.heading), fwdZ = Math.cos(k.heading);
          if (Math.random() < fxScale) {
            partsSoft.spawn(
              k.pos[0] - fwdX * 1.3 + (Math.random() - 0.5) * 0.3, k.pos[1] + 0.55, k.pos[2] - fwdZ * 1.3,
              -fwdX * 1.5, 1.2, -fwdZ * 1.5,
              0.55, 0.22, 0.55, 0.55, 0.58, 0.4, -1,
            );
          }
        }
      }
      // SHINE dust kickup (2026-07-22): rear wheels throw the ground they
      // are actually on · sand plumes, snow spray, gold dust, wet splash.
      // Off-road always, on-road only while drifting (tyre scrub).
      // Round-4 regression fix: the on-road scrub plume sat right where the
      // sun shadow pass now draws the kart's own shadow and half-masked it,
      // two features fighting for the same pixels. On-road the scrub is now
      // THIN (a third the rate, smaller, half the alpha) and REAR-BIASED
      // (1.9u back, low rise) so it trails behind the shadow footprint
      // instead of hanging over it. Off-road plumes are untouched: there is
      // no shadow read to protect out there, and the plume IS the surface.
      const onRoad = !k.offRoad; // tarmac scrub, laid next to the sun shadow
      if (nearPlayer(k) && !k.airborne && k.speed > 12 && (k.offRoad || k.drift.active) && Math.random() < (onRoad ? 0.28 : 0.8) * fxScale) {
        const visYaw = k.heading + k.slideVis; // kickup tracks the drawn wheels (K4)
        const fwdX = Math.sin(visYaw), fwdZ = Math.cos(visYaw);
        const side = (Math.random() < 0.5 ? -1 : 1) * 0.68;
        const back = onRoad ? 1.9 : 0.9;
        const dc = DUST_COL;
        partsSoft.spawn(
          k.pos[0] - fwdX * back + fwdZ * side, k.pos[1] + (onRoad ? 0.14 : 0.25), k.pos[2] - fwdZ * back - fwdX * side,
          -fwdX * k.speed * 0.14 + (Math.random() - 0.5) * 2, (onRoad ? 0.7 : 1.6) + Math.random() * (onRoad ? 0.6 : 1.4), -fwdZ * k.speed * 0.14 + (Math.random() - 0.5) * 2,
          0.5 + Math.random() * 0.25, (onRoad ? 0.3 : 0.5) + Math.random() * (onRoad ? 0.22 : 0.4),
          dc[0], dc[1], dc[2], onRoad ? 0.16 : 0.5, 2.2,
        );
      }
      // boost flames
      if (k.boostT > 0 && nearPlayer(k) && Math.random() < 0.9 * fxScale) {
        // mini-turbo fires at max slide angle · flame particles must leave
        // the DRAWN exhaust, not the physics heading's (K4)
        const visYaw = k.heading + k.slideVis;
        const bx = k.pos[0] - Math.sin(visYaw) * 1.2;
        const bz = k.pos[2] - Math.cos(visYaw) * 1.2;
        partsAdd.spawn(bx, k.pos[1] + 0.5, bz, -Math.sin(visYaw) * 6, 0.5, -Math.cos(visYaw) * 6, 0.28, 0.5, 1.0, 0.55, 0.12, 0.9, 0);
      }
      // chair aura
      if (k.chairT > 0 && Math.random() < 0.7 * fxScale) {
        const a = Math.random() * TAU;
        partsAdd.spawn(k.pos[0] + Math.cos(a) * 1.2, k.pos[1] + 0.4 + Math.random() * 1.4, k.pos[2] + Math.sin(a) * 1.2, 0, 1.2, 0, 0.5, 0.4, 1.0, 0.62, 0.15, 0.8, 0);
      }

      // lap crossing
      if (running && k.lap > prevLap) {
        if (k === player) {
          const lapMs = Math.round((raceT - player.lapStart) * 1000);
          player.lapStart = raceT;
          if (k.lap === laps) {
            hud.banner(COPY.lapFinal);
            // classic kart escalation: the music lifts for the last lap
            // and the crowd roars once · this is the event beat
            Snd.setLift(1.12, 1);
            Snd.sfx("crowd");
            // boss fights read their final phase: a one-word surge + a bark
            if (bossKart && !bossKart.finished) {
              const bs = (COPY.story.bosses[bossKart.driver.id] || {}).surge;
              if (bs) hud.toast(bs, "#E5484D");
              speak(bossKart, tauntLine(bossKart));
            }
          } else if (k.lap > 1 && k.lap <= laps) {
            hud.toast("LAP " + k.lap + " · " + (lapMs / 1000).toFixed(1) + "s", "#9999A1");
          }
        }
        if (k.lap > laps && !k.finished) {
          k.finished = true;
          k.finishTime = raceT;
          // snapshot at the LINE: post-race cooldown items/rescues must
          // not change what the full-sat challenge balloon judges
          k.satsAtLine = k.sats;
          finishOrder.push(k);
          if (k === player) {
            Snd.sfx("finish");
            buzz([20, 40, 20]);
            phase = "done";
            doneT = 0;
          }
        }
      }
    }

    if (running) {
      kartCollisions(karts, fx);
      items.update(dt);
      ranks();
    }

    // ghost record/playback (recording is unconditional · dare mints)
    if (phase === "run" && !player.finished) {
      ghostRecT += dt;
      if (ghostRecT >= 0.1) {
        ghostRecT -= 0.1;
        ghostRec.push([player.pos[0], player.pos[1], player.pos[2], player.heading]);
      }
    }

    // weather: precipitation and world motes spawned around the player
    const sky = def.sky;
    // living emitters (mythic pass): the mega printer PRINTS, the volcano
    // breathes embers · proximity-gated like waterfall mist and scaled by
    // the auto-quality budget so weak devices never pay for them
    if (track.emitters && track.emitters.length && fxScale > 0.5) {
      emitAcc += dt;
      if (emitAcc > 0.14) {
        emitAcc = 0;
        for (const em of track.emitters) {
          const dx = em.x - player.pos[0], dz = em.z - player.pos[2];
          if (dx * dx + dz * dz > 150 * 150) continue;
          if (em.kind === "paper") {
            partsSoft.spawn(
              em.x + (Math.random() - 0.5) * 6 * em.scale, em.y + 10.5 * em.scale, em.z + (Math.random() - 0.5) * 4 * em.scale,
              (Math.random() - 0.5) * 5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 5,
              2.6, 0.5, 0.95, 0.96, 0.98, 0.9, 0.6, Math.random() * TAU,
            );
          } else if (em.kind === "embers") {
            partsAdd.spawn(
              em.x + (Math.random() - 0.5) * 3 * em.scale, em.y + 14.6 * em.scale, em.z + (Math.random() - 0.5) * 3 * em.scale,
              (Math.random() - 0.5) * 7, 9 + Math.random() * 7, (Math.random() - 0.5) * 7,
              1.8, 0.5, 1.0, 0.55, 0.16, 0.95, 3,
            );
          }
        }
      }
    }
    // storm strikes on rain skies: a full-sky flash + rolling thunder ·
    // skipped under reduceFx (flash) but the rain itself still falls
    if (sky === "rain") {
      lightningT -= dt;
      if (lightningT <= 0) {
        lightningT = 6 + Math.random() * 9;
        if (!opts.reduceFx) hud.flashScreen("rgba(205,222,255,0.5)");
        Snd.sfx("thunder");
      }
    }
    // meteors streak the aurora and night skies · long additive darts
    if ((sky === "aurora" || sky === "night") && fxScale > 0.5) {
      meteorT -= dt;
      if (meteorT <= 0) {
        meteorT = 2.5 + Math.random() * 4;
        const ma = Math.random() * TAU;
        partsAdd.spawn(
          player.pos[0] + Math.cos(ma) * 60, 46 + Math.random() * 22, player.pos[2] + Math.sin(ma) * 60,
          -Math.cos(ma) * 55, -9 - Math.random() * 6, -Math.sin(ma) * 55,
          0.8, 0.55, 1.0, 0.95, 0.75, 0.9, 0,
        );
      }
    }
    if (sky === "rain" || sky === "snow" || sky === "mine" || sky === "aurora") {
      // the weather RAGES on the final lap (mythic pass) · same budget knob
      const surge = player.lap >= laps && !player.finished ? 1.6 : 1;
      const rate = { rain: 110, snow: 55, mine: 10, aurora: 7 }[sky] * fxScale * surge;
      weatherAcc += dt * rate;
      const fwdX = Math.sin(player.heading), fwdZ = Math.cos(player.heading);
      while (weatherAcc > 1) {
        weatherAcc -= 1;
        const px = player.pos[0] + fwdX * 16 + (Math.random() - 0.5) * 56;
        const pz = player.pos[2] + fwdZ * 16 + (Math.random() - 0.5) * 56;
        if (sky === "rain") {
          partsSoft.spawn(px, player.pos[1] + 9 + Math.random() * 5, pz, -2, 0, 0, 0.42, 0.13, 0.62, 0.7, 0.8, 0.5, 26);
        } else if (sky === "snow") {
          partsSoft.spawn(px, player.pos[1] + 8 + Math.random() * 6, pz, (Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5, 2.4, 0.24, 0.95, 0.97, 1.0, 0.8, 1.4);
        } else if (sky === "mine") {
          partsAdd.spawn(px, player.pos[1] + 1 + Math.random() * 3, pz, 0, 0.4, 0, 2.2, 0.24, 1.0, 0.6, 0.2, 0.5, -0.5);
        } else {
          partsAdd.spawn(px, player.pos[1] + 8 + Math.random() * 8, pz, (Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2, 3, 0.5, 0.3, 0.95, 0.7, 0.3, 0);
        }
      }
    }

    // SHINE wind streaks (2026-07-22): past ~80% of top speed the air
    // itself rushes by · thin additive darts flying at the camera, layered
    // under the boost radial warp. reduceFx players keep a still frame.
    if (!opts.reduceFx && phase === "run" && !player.finished) {
      const rush = clamp((player.speed - 38) / 22, 0, 1);
      if (rush > 0) {
        streakAcc += dt * rush * 26 * fxScale;
        const fwdX = Math.sin(player.heading), fwdZ = Math.cos(player.heading);
        while (streakAcc > 1) {
          streakAcc -= 1;
          const side = (Math.random() - 0.5) * 22;
          partsAdd.spawn(
            player.pos[0] + fwdX * 20 + fwdZ * side, player.pos[1] + 1.5 + Math.random() * 4.5, player.pos[2] + fwdZ * 20 - fwdX * side,
            -fwdX * (player.speed * 1.7 + 30), 0, -fwdZ * (player.speed * 1.7 + 30),
            0.22, 0.34, 1.0, 0.93, 0.78, 0.16 + rush * 0.14, 0,
          );
        }
      } else {
        streakAcc = 0;
      }
    }

    // boss phases: each rival boss fights with its own signature litter,
    // dropped on a fixed cadence so the 1v1 stays a duel, not a wall.
    // Bear leaves ice peels on its line, the Headline drops media traps,
    // and Schiff rains gold bars on the FINAL lap only (the crescendo).
    if (phase === "run" && bossKart && !bossKart.finished) {
      const bp = BOSS_PHASES[bossKart.driver.id];
      bossDropT += dt;
      const finalLapGate = !bp.finalLapOnly || bossKart.lap >= laps;
      if (bossDropT >= bp.every && finalLapGate) {
        bossDropT = 0;
        const bx = bossKart.pos[0] - Math.sin(bossKart.heading) * 2.6;
        const bz = bossKart.pos[2] - Math.cos(bossKart.heading) * 2.6;
        if (bp.type === "goldbar") {
          items.ents.push({
            type: "goldbar",
            x: bossKart.pos[0] + Math.sin(bossKart.heading) * 2.4,
            y: bossKart.pos[1] + 1.2,
            z: bossKart.pos[2] + Math.cos(bossKart.heading) * 2.4,
            yaw: bossKart.heading, speed: bossKart.speed + 18, vy: 7,
            owner: bossKart, life: 10, landed: false, sIdx: bossKart.sIdx,
          });
          Snd.sfx("goldbar", 0, bossKart);
          if (bossKart.lap >= laps && !goldRainAnnounced) {
            goldRainAnnounced = true;
            hud.toast("GOLDBAR RAIN · Schiff empties the vault", "#F5C542");
          }
        } else {
          items.ents.push({ type: bp.type, x: bx, y: bossKart.pos[1], z: bz, owner: bossKart, life: 24, armT: 0.4 });
        }
      }
    }

    // player HUD
    hud.setPos(player.rank);
    // live gap: seconds of road to the kart one place ahead (chasing) or
    // back to the chaser (leading). Progress delta over current speed ·
    // hidden while solo, finished, or outside the running phase.
    let gapStr = null;
    if (phase === "run" && !player.finished && karts.length > 1) {
      const spd = Math.max(player.speed, 8);
      if (player.rank > 1) {
        const ahead = karts.find((k) => k.rank === player.rank - 1);
        if (ahead) {
          const s = Math.max(ahead.progress - player.progress, 0) / spd;
          gapStr = "▲ " + (s > 9.9 ? "9.9s+" : s.toFixed(1) + "s");
        }
      } else {
        const chaser = karts.find((k) => k.rank === 2);
        if (chaser && !chaser.finished) {
          const s = Math.max(player.progress - chaser.progress, 0) / spd;
          gapStr = "▼ " + (s > 9.9 ? "9.9s+" : s.toFixed(1) + "s");
        }
      }
    }
    hud.setGap(gapStr);
    hud.setLap(player.lap, laps, player.lap === laps);
    // freeze the clock at the crossing time · raceT keeps climbing through
    // the finish-orbit 'done' phase and would visibly overrun the result
    hud.setTime((player.finished ? player.finishTime : raceT) * 1000);
    if (player.roulette > 0) {
      // decelerating roulette: fast flicker settling into the result
      const p = clamp(1 - player.roulette / 2.4, 0, 1);
      const idx = Math.floor(26 * (1 - Math.pow(1 - p, 2.2)));
      if (idx !== lastRoulTick) {
        lastRoulTick = idx;
        Snd.sfx("roulette", idx);
      }
      hud.setItem(null, idx);
    } else {
      lastRoulTick = -1;
      hud.setItem(player.item);
    }
    hud.setSats(player.sats, Math.round((player.sats * 0.35 * 100) / player.baseSpeed));
    hud.setDrift(player.drift.active && !player.airborne && player.spinT <= 0, player.drift.charge, player.drift.tier);
    hud.wrongWay(player.wrongWayT > 0.7);
    hud.drawMap(karts, player);

    // engine audio (player only) + looping drift skid
    if (running && !player.finished) {
      Snd.engine(clamp(player.speed / (player.baseSpeed * 1.3), 0, 1), player.boostT > 0, engineTone(player.driver), clamp(input.throttle || 0, 0, 1), !!player.airborne);
    } else {
      // count phase: throttle rides as load so the brake-hold rocket ritual
      // audibly revs (auto-gas launches neutral, so throttle stays 0 until armed)
      Snd.engine(clamp(player.speed / (player.baseSpeed * 1.3), 0, 0.4), false, engineTone(player.driver), clamp(input.throttle || 0, 0, 1), false);
    }
    // airborne wind (K11) · air01 is raw 0/1; Snd.wind setTargetAtTime eases.
    // Gated on AIRBORNE, not on the running flag: a finish-orbit coast over
    // a ramp is still flight, and the old count/over branch forced the rush
    // to silence mid-air. The count phase is grounded so the brake-hold
    // ritual stays dry; past the flag engineOff() owns the audio teardown,
    // so this must not re-raise wind behind it.
    Snd.wind(player.airborne && phase !== "over" ? 1 : 0, clamp(player.speed / (player.baseSpeed * 1.3), 0, 1));
    // skid + surface audio: drifting sings per surface (ice/sand), and
    // straying off-road rumbles even without a drift (Tier 2)
    {
      const drifting = player.drift.active && !player.airborne && player.spinT <= 0;
      const offRumble = !drifting && !!player.offRoad && player.speed > 8;
      Snd.skid(
        drifting || offRumble,
        drifting ? player.drift.tier : 0,
        clamp(player.speed / player.baseSpeed, 0, 1),
        offRumble ? "offroad" : SURFACE_SOUND[def.theme] || null,
      );
      hud.offRoad(!!player.offRoad && phase === "run");
    }
    // wrong-way pressure: the banner alone was easy to miss · a soft
    // beep every 1.2s while driving against the flow (Tier 2)
    if (player.wrongWayT > 0.7 && running) {
      wrongBeepT += dt;
      if (wrongBeepT >= 1.2) { wrongBeepT = 0; Snd.sfx("wrong"); }
    } else {
      wrongBeepT = 1.0; // first beep lands fast when it starts
    }
    // rival engines: the two nearest AI karts hum in your ears, panned to
    // where they actually are; a close fast cross fires a pass-by whoosh
    if (running) {
      if (passByCd > 0) passByCd -= dt;
      const near = [];
      for (const o of karts) {
        if (o === player) continue;
        const dx = o.pos[0] - player.pos[0], dz = o.pos[2] - player.pos[2];
        const dist = Math.hypot(dx, dz);
        if (dist < 45) {
          near.push({
            dist,
            speed01: clamp(o.speed / o.baseSpeed, 0, 1.2),
            pan: dist > 0.1 ? (dx * camRightRef[0] + dz * camRightRef[2]) / dist : 0,
            tone: engineTone(o.driver),
          });
        }
        const prevD = o.__pbDist === undefined ? dist : o.__pbDist;
        o.__pbDist = dist;
        if (passByCd <= 0 && prevD > 6.5 && dist <= 6.5 && Math.abs(o.speed - player.speed) > 7) {
          Snd.passBy();
          passByCd = 0.7;
        }
      }
      near.sort((a, b) => a.dist - b.dist);
      Snd.rivals(near.slice(0, 2));
    } else {
      Snd.rivals([]);
    }
    setMusic();

    skids.update(dt, 1);
    hotSkids.update(dt, 1);
    // waterfall mist (map pass 2026-07-16): soft spray puffs at the foam
    // pool while the player is near · positions collected by buildTrack
    if (track.waterfalls.length && !opts.reduceFx) {
      mistAcc += dt;
      if (mistAcc > 0.09) {
        mistAcc = 0;
        for (const wf of track.waterfalls) {
          const dx = wf.x - player.pos[0], dz = wf.z - player.pos[2];
          if (dx * dx + dz * dz > 70 * 70) continue;
          const wq = surfaceQuery(track, wf.x, wf.z, player.sIdx);
          const a = Math.random() * TAU;
          const r = (1.5 + Math.random() * 1.6) * wf.scale;
          partsSoft.spawn(
            wf.x + Math.cos(a) * r, wq.roadY + 0.6 + Math.random() * 1.4, wf.z + Math.sin(a) * r,
            (Math.random() - 0.5) * 0.8, 1.1 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8,
            2.0 + Math.random() * 1.4, 0.22, 0.88, 0.94, 1.0, 0.4, 0.9, Math.random() * TAU,
          );
        }
      }
    }
    partsAdd.update(dt);
    partsSoft.update(dt);

    // end conditions
    if (phase === "done") {
      doneT += dt;
      const allDone = karts.every((k) => k.finished);
      if (allDone || doneT > 4.5) {
        // project unfinished karts into final ORDER only · their times
        // are estimates, so the results table shows "···" for them (M3)
        const rest = karts.filter((k) => !k.finished).sort((a, b) => b.progress - a.progress);
        for (const k of rest) { k.finished = true; k.projected = true; k.finishTime = raceT + (player.progress - k.progress) * 0.01; finishOrder.push(k); }
        phase = "over";
        Snd.engineOff();
        const results = finishOrder.map((k, i) => ({ driver: k.driver, rank: i + 1, time: k.finishTime, isPlayer: k === player, projected: !!k.projected }));
        const ghostOut = ghostRec;
        if (opts.mode !== "tt" && opts.mode !== "challenge") { podium = buildPodium(results); orbT = 0; }
        opts.onFinish({
          results,
          timeMs: Math.round(player.finishTime * 1000),
          ghost: ghostOut,
          satsAtFinish: player.satsAtLine === undefined ? player.sats : player.satsAtLine,
          // challenge bookkeeping (see data.js CHALLENGES)
          itemsUsed: player.itemsUsed || 0,
          usedChair: !!player.usedChair,
          bigAirs: player.bigAirs || 0,
          rocketStart: hadRocketStart,
          // GHOSTBUSTER honesty (M4): the badge needs a ghost that was
          // actually ON TRACK this run, not just a prior best number
          hadGhost: !!(ghostFrames && ghostFrames.length),
        });
      }
    }

    // camera
    updateCamera(dt, input);
    // taunt bubble tracks its speaker with the fresh camera
    updateBubble(dt);
  }

  function updateCamera(dt, input) {
    const aspect = R.canvas.clientWidth / Math.max(R.canvas.clientHeight, 1);
    let eye, target, fovT = (62 * Math.PI) / 180;
    let roll = 0;
    if (podium) {
      // slow orbit around the winners' circle
      orbT += dt * 0.24;
      eye = [Math.sin(orbT) * 9.5, 3.3 + Math.sin(orbT * 0.7) * 0.4, Math.cos(orbT) * 9.5];
      target = [0, 1.3, 0];
      fovT = (50 * Math.PI) / 180;
    } else if (phase === "cinema" && cine && cine.i >= 0 && cine.i < cine.seq.length) {
      // story shot: parametric orbit/push around a live kart, or a
      // spline flight · all params lerp shot-start -> shot-end
      const sh = cine.seq[cine.i];
      const u = clamp(cine.t / sh.dur, 0, 1);
      const e = u * u * (3 - 2 * u);
      const L = (v0, v1, d) => {
        const A = v0 === undefined ? d : v0;
        const B = v1 === undefined ? A : v1;
        return A + (B - A) * e;
      };
      if (sh.fly) {
        const S = track.S;
        const tt = sh.fly[0] + (sh.fly[1] - sh.fly[0]) * e;
        const i = ((Math.floor((tt % 1) * S.n) % S.n) + S.n) % S.n;
        const j = (i + 12) % S.n;
        eye = [S.pos[i][0] + S.right[i][0] * (sh.fly[3] || 0), S.pos[i][1] + (sh.fly[2] || 8), S.pos[i][2] + S.right[i][2] * (sh.fly[3] || 0)];
        target = [S.pos[j][0], S.pos[j][1] + 1.2, S.pos[j][2]];
      } else {
        const k = cineFocusKart(sh);
        const a = k.heading + L(sh.a0, sh.a1, 0);
        const r = L(sh.r0, sh.r1, 5);
        const h = L(sh.h0, sh.h1, 1.6);
        eye = [k.pos[0] + Math.sin(a) * r, k.pos[1] + h, k.pos[2] + Math.cos(a) * r];
        target = [k.pos[0], k.pos[1] + (sh.ty === undefined ? 1.3 : sh.ty), k.pos[2]];
      }
      fovT = ((sh.fov || 50) * Math.PI) / 180;
      // SHINE cinema lens (2026-07-22): every shot carries a depth-of-field
      // strength (sh.dof overrides · fly-bys keep it light) + the focus
      // distance of THIS frame's framing · consumed by R.present
      cam.dofAmt = sh.dof !== undefined ? sh.dof : (sh.fly ? 0.25 : 0.55);
      cam.dofFocus = Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]);
      cam.pos = eye;
    } else if (phase === "intro") {
      // course flyby: glide down the final stretch into the grid
      const u = clamp(phaseT / 4.2, 0, 1);
      const e = u * u * (3 - 2 * u);
      const S = track.S;
      const back = 0.10 * (1 - e) + 0.004;
      const i = Math.floor((1 - back) * S.n) % S.n;
      const j = (i + 14) % S.n;
      const p = S.pos[i], q = S.pos[j];
      eye = [
        p[0] + S.right[i][0] * 6 * (1 - e),
        p[1] + 9 - 5.4 * e,
        p[2] + S.right[i][2] * 6 * (1 - e),
      ];
      target = [q[0], q[1] + 1.5, q[2]];
      const k = player;
      const fwd = [Math.sin(k.heading), 0, Math.cos(k.heading)];
      if (e > 0.72) {
        // hand off smoothly into the chase pose behind the grid
        const h = (e - 0.72) / 0.28;
        eye = V3.lerp(eye, [k.pos[0] - fwd[0] * 7, k.pos[1] + 3.0, k.pos[2] - fwd[2] * 7], h);
        target = V3.lerp(target, [k.pos[0] + fwd[0] * 7, k.pos[1] + 1.4, k.pos[2] + fwd[2] * 7], h);
      }
      cam.pos = eye;
    } else if ((phase === "done" || phase === "over") && player.finished) {
      // finish-line orbit while the rest of the field comes home
      orbT += dt * 0.5;
      eye = [player.pos[0] + Math.sin(orbT) * 8, player.pos[1] + 3.2, player.pos[2] + Math.cos(orbT) * 8];
      target = [player.pos[0], player.pos[1] + 1, player.pos[2]];
    } else if (phase === "count") {
      // grid theater: cut to a low front-quarter hero pose on "3" (the
      // boss gets the first beat in a 1v1), then sweep back into the
      // chase pose so GO lands exactly where the racing camera lives
      const k = bossKart && phaseT < 0.95 ? bossKart : player;
      const u = clamp((phaseT - (bossKart ? 0.95 : 0)) / (bossKart ? 2.05 : 3), 0, 1);
      const e = u * u * (3 - 2 * u);
      const fwd = [Math.sin(k.heading), 0, Math.cos(k.heading)];
      const camR = [-fwd[2], 0, fwd[0]];
      const hero = [k.pos[0] + fwd[0] * 4.6 + camR[0] * 2.4, k.pos[1] + 1.15, k.pos[2] + fwd[2] * 4.6 + camR[2] * 2.4];
      const pf = [Math.sin(player.heading), 0, Math.cos(player.heading)];
      const nearCount = chaseNear(typeof window === "undefined" ? 0 : Math.min(window.innerWidth || 0, window.innerHeight || 0));
      const chase = [player.pos[0] - pf[0] * 6.6 * nearCount.dist, player.pos[1] + 3.0 * nearCount.eye, player.pos[2] - pf[2] * 6.6 * nearCount.dist];
      eye = V3.lerp(hero, chase, e);
      target = V3.lerp(
        [k.pos[0], k.pos[1] + 1.15, k.pos[2]],
        [player.pos[0] + pf[0] * 7, player.pos[1] + 1.4, player.pos[2] + pf[2] * 7],
        e,
      );
      cam.pos = eye;
    } else {
      const k = player;
      const lookBack = !!(input && input.lookBack);
      const fwd = [Math.sin(k.heading), 0, Math.cos(k.heading)];
      const camR = [-fwd[2], 0, fwd[0]]; // screen-right in world space
      const lean = opts.reduceFx ? 0 : k.lean;
      const near = chaseNear(typeof window === "undefined" ? 0 : Math.min(window.innerWidth || 0, window.innerHeight || 0));
      const dist = (6.6 + clamp(k.speed, 0, 46) * 0.055) * near.dist;
      const eyeH = 3.0 * near.eye;
      const desired = lookBack
        ? [k.pos[0] + fwd[0] * dist, k.pos[1] + eyeH, k.pos[2] + fwd[2] * dist]
        : [
          k.pos[0] - fwd[0] * dist + camR[0] * lean * 2.6,
          k.pos[1] + eyeH,
          k.pos[2] - fwd[2] * dist + camR[2] * lean * 2.6,
        ];
      const f = damp(k.spinT > 0 ? 2.5 : lookBack ? 20 : 5.5, dt);
      cam.pos = V3.lerp(cam.pos, desired, f);
      // keep the camera from sinking under terrain on crests.
      // A phone camera sits lower, so the floor drops with it.
      const cq = surfaceQuery(track, cam.pos[0], cam.pos[2], k.sIdx);
      const floorRoad = near.eye < 0.999 ? 0.85 : 1.6;
      const floorKart = near.eye < 0.999 ? 1.15 : 2.0;
      cam.pos[1] = Math.max(cam.pos[1], cq.roadY + floorRoad, k.pos[1] + floorKart);
      eye = cam.pos;
      const look = 7 * near.dist;
      const lookY = 1.4 * (0.75 + 0.25 * near.eye);
      target = lookBack
        ? [k.pos[0] - fwd[0] * look, k.pos[1] + lookY, k.pos[2] - fwd[2] * look]
        : [k.pos[0] + fwd[0] * look, k.pos[1] + lookY, k.pos[2] + fwd[2] * look];
      // SHINE speed lens (2026-07-22): the FOV widens continuously with
      // velocity so top speed FEELS like top speed · the boost punch then
      // pops on top of the widened base. reduceFx keeps the static frame.
      // The speed input is SLEWED (shake fix, same day): raw speed swings
      // over crests and landings pulsed the lens on bumpy tracks.
      if (!opts.reduceFx) {
        cam.fovSpd += (k.speed - cam.fovSpd) * Math.min(2 * dt, 1);
        fovT = ((62 + 7 * clamp((cam.fovSpd - 24) / 28, 0, 1)) * Math.PI) / 180;
        if (k.boostT > 0 || k.chairT > 0) fovT = (73 * Math.PI) / 180;
      }
      roll = opts.reduceFx ? 0 : -k.lean * 0.4; // bank the frame into drifts
    }
    // decaying impact shake
    if (camShake > 0.001) {
      camShake *= Math.exp(-6 * dt);
      if (!opts.reduceFx) {
        const s = camShake * 0.45;
        eye = [eye[0] + (Math.random() - 0.5) * s, eye[1] + (Math.random() - 0.5) * s, eye[2] + (Math.random() - 0.5) * s];
      }
    }
    cam.fov = lerp(cam.fov, fovT, damp(4, dt));
    cam.env = makeEnv(eye, target, cam.fov, aspect, track.env, performance.now() / 1000, roll);
    camRightRef = cam.env.camRight;
    if (window.__BK_AUTO) window.__BK_CAM_Y = cam.pos[1]; // headless QA probe only
  }

  // ---- podium ceremony (3D winners' circle, reuses race kart meshes) ----
  let confettiAcc = 0;
  const CONFETTI = [[1, 0.62, 0.15], [0.95, 0.95, 0.97], [0.4, 0.9, 1.0], [0.5, 0.85, 0.55], [1, 0.82, 0.3]];

  function buildPodium(results) {
    const b = meshBuilder();
    // floor disc
    for (let i = 0; i < 18; i++) {
      const a0 = (i / 18) * TAU, a1 = ((i + 1) / 18) * TAU;
      b.pushTri([0, 0, 0], [Math.cos(a1) * 26, 0, Math.sin(a1) * 26], [Math.cos(a0) * 26, 0, Math.sin(a0) * 26],
        i % 2 ? hex("#131316") : hex("#17171B"));
    }
    // winners' ring
    b.cyl(0, 0.02, 0, 9.5, 9.5, 0.05, 24, hex("#F7931A"), { capBot: false });
    const slots = [
      { x: 0, z: 0, h: 1.35, trim: hex("#F5C542") },
      { x: -3.1, z: 0.8, h: 0.85, trim: hex("#C8C9D2") },
      { x: 3.1, z: 1.1, h: 0.6, trim: hex("#B8763B") },
    ];
    slots.forEach((s) => {
      b.cyl(s.x, 0, s.z, 1.9, 1.8, s.h, 12, hex("#26262C"), { topColor: hex("#2E2E35") });
      b.cyl(s.x, s.h, s.z, 1.82, 1.82, 0.06, 12, s.trim);
    });
    return {
      mesh: R.createMesh(b.build()),
      // podium emotions (2026-07-16): P1 celebrates with the grin face +
      // a victory bounce, P2 wears despair, P3 rage · classic kart-racer
      // ceremony theater. Mood textures ride the session cache (moodGL).
      karts: results.slice(0, 3).map((r, i) => ({
        km: kartMeshes[r.driver.id],
        moodTex: r.driver.id && kartMeshes[r.driver.id].head
          ? moodGL(r.driver.id, ["grin", "sad", "rage"][i])
          : null,
        mood: ["grin", "sad", "rage"][i],
        x: slots[i].x, y: slots[i].h + 0.06, z: slots[i].z,
        yaw: [0.15, 0.4, -0.35][i],
      })),
    };
  }

  // ---- render ----
  const IDENT = M4.ident();
  function kartPitch(k) {
    const S = track.S;
    const a = S.pos[(k.sIdx - 3 + S.n) % S.n][1];
    const b = S.pos[(k.sIdx + 3) % S.n][1];
    return -Math.atan2(b - a, 9);
  }

  function drawKart(k, time) {
    const km = kartMeshes[k.driver.id];
    const spinYaw = k.spinT > 0 ? k.spinVis : 0;
    // K12: airborne karts mostly ignore the terrain slope (0.25 residual
    // keeps lip transitions smooth) and pose from pitchVis instead · the
    // ballistic arc, accel lift, and brake dive all live in that term
    const pitch = kartPitch(k) * (k.airborne ? 0.25 : 1) + k.pitchVis;
    // hop stretch / landing squash: whole kart compresses like a toy
    const sy = 1 - k.squash * 0.8;
    const sxz = 1 + k.squash * 0.45;
    // K4: the drawn chassis carries the presentational slide angle · the
    // physics heading, camera fwd, and ghost recording never include it
    const visYaw = k.heading + spinYaw + k.slideVis;
    const model = M4.trs(k.pos[0], k.pos[1], k.pos[2], visYaw, pitch, k.lean, sxz, sy);
    const rim = (k.chairT > 0 ? 1.2 : 0.5) + Math.max(0, k.rimFlash) * 2;
    R.draw(km.body, model, { rim, spec: specOn * 0.85, specPow: 30, metal: 0.3, sheen: specOn * 0.3 });
    if (km.trim) R.draw(km.trim, model, { rim: rim * 0.9, spec: specOn * 1.9, specPow: 90, metal: 1, sheen: specOn * 0.6 });
    if (km.glow) R.draw(km.glow, model, { emissive: 0.85, rim: 0.2 });
    // steering assembly turns with the live input: wheel, forearms,
    // gloves rotate around the column axis (Tier B driver animation)
    if (km.steer) {
      const sYaw = (k.steer || 0) * 0.55;
      // K4 counter-pose: the upper body braces AGAINST the chassis roll
      // (drift drivers stay upright while the kart leans) and twists at the
      // waist toward the apex. Round-4 amplitudes: v1's ~7deg roll was
      // invisible past the chase camera, so a tier-2 drift now throws the
      // torso ~19deg out and ~8deg round. The driver torso lives in the
      // BODY mesh (one draw with the chassis), so the wheel/forearm/glove
      // assembly is the only upper body this lane can pose - and it must
      // move as ONE piece or the gloves leave the rim. The pivot sits at
      // the hips (0, 0.55, 0.15), so the roll alone swings the shoulders
      // ~0.14u to the corner's outside: the lean-out comes for free.
      const cRoll = -k.lean * 0.4 - k.slideVis * 0.55;
      const cYaw = k.slideVis * 0.32;
      const base = Math.abs(cRoll) > 0.003 || Math.abs(cYaw) > 0.003
        ? M4.mul(model, M4.mul(M4.trs(0, 0.55, 0.15, cYaw, 0, cRoll), M4.trs(0, -0.55, -0.15)))
        : model;
      const smodel = M4.mul(base, M4.mul(M4.trs(0, 0, 0.44, sYaw), M4.trs(0, 0, -0.44)));
      R.draw(km.steer, smodel, { rim, spec: specOn * 0.5, sheen: specOn * 0.22 });
      if (km.arms) {
        // the race winner coasts the victory lap pumping fists skyward
        const armsM = k.finished && k.rank === 1
          ? M4.mul(model, M4.mul(M4.trs(0, 1.12, -0.05, 0, -1.35 - Math.sin(time * 7) * 0.3), M4.trs(0, -1.12, 0.05)))
          : smodel;
        R.draw(km.arms, armsM, { rim, spec: specOn * 0.5, sheen: specOn * 0.22 });
      }
    }
    if (k.chairT > 0) R.glow(km.body, M4.trs(k.pos[0], k.pos[1], k.pos[2], visYaw, pitch, k.lean, 1.06), 0.16);
    // exhaust flames while boosting: pulsing emissive blobs at each
    // machine's own thruster anchors (booster, stacks, board jets, ...)
    if (k.boostT > 0) {
      const pulse = 0.15 + 0.06 * Math.sin(time * 42 + k.pos[0]);
      for (const ex of km.flames || [[-0.28, 0.62, -1.58], [0.28, 0.62, -1.58]]) {
        const fm = M4.mul(model, M4.trs(ex[0], ex[1], ex[2], 0, 0, 0, pulse));
        R.draw(ent.flame, fm, { emissive: 1.5, rim: 0, alpha: 0.9 });
      }
    }
    // caricature head (textured, lit): drivers look through the corner
    if (km.head) {
      // K4 counter-pose: the head leads into the corner scaled by the LIVE
      // slide angle (a fixed drift add over-rotated once the chassis
      // started yawing itself) and counter-rolls with the upper body so
      // the driver visibly rides the slide instead of being welded to it.
      // Round-4: a helmet is a dome, so only a LARGE roll reads at chase
      // distance · a tier-2 drift now turns the head ~23deg and cocks it
      // ~19deg, leading the ~8deg shoulder twist the way a real driver's
      // eyes lead their shoulders.
      // clamped at 40deg: full lock plus a hard shove would otherwise stack
      // past a neck's travel and read as a broken rig, not a driver
      const headYaw = clamp((k.steer || 0) * 0.45 + k.slideVis * 1.0, -0.7, 0.7);
      const hm = M4.mul(model, M4.trs(km.head.offset[0], km.head.offset[1], km.head.offset[2], headYaw, 0, -k.lean * 0.6 - k.slideVis * 0.5, 1));
      R.drawTextured(km.head.mesh, hm, km.head.tex, { lit: true });
      // head kit (hair, hat, ears, beard) rides the head transform so
      // bills and hair turn WITH the face through corners
      if (km.hair) R.draw(km.hair, hm, { rim: rim * 0.15, spec: specOn * 0.15 });
      // laser eyes: the meme burns low at all times, hotter on any boost
      const eyes = k.driver.sig && k.driver.sig.laserEyes;
      if (eyes) {
        const hot = k.boostT > 0 || k.chairT > 0;
        const s = hot ? 0.075 : 0.045;
        const orb = eyes === "cyan" ? ent.eyeCyan : ent.eyeRed;
        for (const ex of [-0.13, 0.13]) {
          const em = M4.mul(hm, M4.trs(ex, 0.03, 0.35, 0, 0, 0, s));
          R.draw(orb, em, { emissive: hot ? 1.6 : 1.0, rim: 0 });
        }
      }
    } else if (km.hair) {
      // headless karts (satoshi) park their FABRIC on the matte hair
      // channel · drawn on the base transform so the hood reads as cloth,
      // never a specular-hot chrome helmet
      R.draw(km.hair, model, { rim: rim * 0.15, spec: specOn * 0.15 });
    }
    // wheels: every kart's fronts steer (AI included)
    const steerYaw = (k.steer || 0) * 0.4;
    for (let i = 0; i < 4; i++) {
      const wp = WHEEL_POS[i];
      const wm = M4.mul(model, M4.trs(wp[0], wp[1], wp[2], i < 2 ? steerYaw : 0, k.wheelSpin, 0, 1));
      // tires must not share the body-panel gloss: sheen near zero, wide
      // low specPow · K19's matte alpha band finishes the rubber read
      R.draw(km.wheel, wm, { rim: 0.2, spec: specOn * 0.3, specPow: 14, sheen: specOn * 0.1 });
      // machined rim/hub · same material pack as the trim submesh, so the
      // alloy glints against rubber that cannot
      if (km.wheelHub) R.draw(km.wheelHub, wm, { rim: 0.3, spec: specOn * 1.9, specPow: 90, metal: 1, sheen: specOn * 0.6 });
    }
    // shield bubble
    if (k.shield) {
      R.draw(ent.shieldOrb, M4.trs(k.pos[0], k.pos[1] + 1, k.pos[2], time * 2, 0, 0, 2.2), { emissive: 0.55, alpha: 0.9 });
    }
    // blob shadow · only when the real sun shadow pass is off this frame
    if (!shadowsActive) {
      const q = surfaceQuery(track, k.pos[0], k.pos[2], k.sIdx);
      R.draw(ent.shadow, M4.trs(k.pos[0], q.roadY + 0.04, k.pos[2], 0, 0, 0, 1.4), { alpha: 0.99, rim: 0 });
    }
  }

  let lastRenderT = 0;
  let shadowsActive = false; // this frame ran the sun shadow pass
  let warpAmt = 0; // boost speed-streak envelope, smoothed
  function render(time) {
    const rdt = Math.min(Math.max(time - (lastRenderT || time), 0), 0.1);
    lastRenderT = time;
    if (!cam.env) updateCamera(1 / 60);

    // podium ceremony: its own little scene under the same world light
    if (podium) {
      updateCamera(rdt);
      confettiAcc += rdt * 22 * fxScale;
      while (confettiAcc > 1) {
        confettiAcc -= 1;
        const c = CONFETTI[Math.floor(Math.random() * CONFETTI.length)];
        partsSoft.spawn(
          (Math.random() - 0.5) * 12, 7.5 + Math.random() * 2.5, (Math.random() - 0.5) * 9,
          (Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6,
          3.4, 0.2, c[0], c[1], c[2], 0.95, 1.15, Math.random() * TAU,
        );
      }
      partsSoft.update(rdt);
      partsAdd.update(rdt);
      R.begin(cam.env);
      R.draw(podium.mesh, IDENT, { rim: 0.3 });
      for (const s of podium.karts) {
        // ceremony body language: the winner hops on the spot with a
        // little victory wiggle; the beaten pair sag nose-down
        let y = s.y, yaw = s.yaw, pitch = 0;
        let armPitch = null, headYaw = 0, headPitch = 0;
        if (s.mood === "grin") {
          // victory: hop, chin up, fists pumping the sky
          y += Math.abs(Math.sin(orbT * 5.2)) * 0.45;
          yaw += Math.sin(orbT * 2.6) * 0.12;
          armPitch = -1.35 - Math.sin(orbT * 6.5) * 0.3;
          headPitch = -0.16 + Math.sin(orbT * 6.5) * 0.05;
        } else if (s.mood === "sad") {
          // despair: slump, arms heavy on the wheel, head hangs + shakes no
          pitch = 0.09;
          armPitch = 0.14;
          headPitch = 0.34;
          headYaw = Math.sin(orbT * 1.7) * 0.12;
        } else {
          // rage: wind up and POUND the wheel · the hit jolts the kart
          pitch = 0.05;
          const t = (orbT * 1.3) % 1;
          armPitch = t < 0.55 ? -0.85 * (t / 0.55) : t < 0.7 ? -0.85 + 1.1 * ((t - 0.55) / 0.15) : 0.25;
          if (t >= 0.7 && t < 0.82) y -= 0.045; // impact
          yaw += Math.sin(orbT * 7) * 0.03; // seething tremble
          headYaw = Math.sin(orbT * 15) * 0.09;
          headPitch = 0.1;
        }
        const m = M4.trs(s.x, y, s.z, yaw, pitch, 0, 1);
        R.draw(s.km.body, m, { rim: 0.8, spec: specOn * 0.9, specPow: 30, metal: 0.3, sheen: specOn * 0.3 });
        if (s.km.trim) R.draw(s.km.trim, m, { rim: 0.7, spec: specOn * 1.9, specPow: 90, metal: 1, sheen: specOn * 0.6 });
        if (s.km.glow) {
          // headless karts (satoshi, the bosses) have no mood face · their
          // ceremony read is a signal pulse through the emissive kit:
          // quick and bright in victory, a slow dim throb when beaten
          const pulse = s.km.head ? 0 : Math.sin(orbT * (s.mood === "grin" ? 6.5 : 2.2)) * 0.3;
          R.draw(s.km.glow, m, { emissive: 0.85 + pulse, rim: 0.2 });
        }
        if (s.km.steer) R.draw(s.km.steer, m, { rim: 0.8, spec: specOn * 0.9, sheen: specOn * 0.22 });
        if (s.km.arms) {
          const armsM = armPitch === null ? m
            : M4.mul(m, M4.mul(M4.trs(0, 1.12, -0.05, 0, armPitch), M4.trs(0, -1.12, 0.05)));
          R.draw(s.km.arms, armsM, { rim: 0.8, spec: specOn * 0.9 });
        }
        if (s.km.head) {
          const hm = M4.mul(m, M4.trs(s.km.head.offset[0], s.km.head.offset[1], s.km.head.offset[2], headYaw, headPitch, 0, 1));
          R.drawTextured(s.km.head.mesh, hm, s.moodTex || s.km.head.tex, { lit: true });
          if (s.km.hair) R.draw(s.km.hair, hm, { rim: 0.12, spec: specOn * 0.15 });
        } else if (s.km.hair) {
          R.draw(s.km.hair, m, { rim: 0.12, spec: specOn * 0.15 }); // matte fabric, headless karts
        }
        for (let i = 0; i < 4; i++) {
          const wp = WHEEL_POS[i];
          const pwm = M4.mul(m, M4.trs(wp[0], wp[1], wp[2], 0, 0, 0, 1));
          R.draw(s.km.wheel, pwm, { rim: 0.2 });
          if (s.km.wheelHub) R.draw(s.km.wheelHub, pwm, { rim: 0.3, spec: specOn * 1.9, specPow: 90, metal: 1, sheen: specOn * 0.6 });
        }
      }
      // BITCOIN B GOLDEN FIREWORKS over the winner's sky · camera-facing
      // burst plane so the glyph reads from the orbiting ceremony camera
      podFwT -= rdt;
      if (podFwT <= 0) {
        podFwT = (0.8 + Math.random() * 0.5) / Math.max(fxScale, 0.4);
        // low, close bursts: the ceremony camera frames the karts tight,
        // so the glyphs pop just over the winner's head, not in orbit
        const bx = (Math.random() - 0.5) * 9, by = 4.5 + Math.random() * 2.5, bz = -2 - Math.random() * 2.5;
        const eye = cam.env.camPos;
        const fwd = V3.norm([bx - eye[0], by - eye[1], bz - eye[2]]);
        const right = V3.norm(V3.cross(fwd, [0, 1, 0]));
        const up = V3.cross(right, fwd);
        spawnBFirework(partsAdd, bx, by, bz, right, up, 2.0 + Math.random() * 0.5);
      }
      partsSoft.draw(false);
      partsAdd.draw(true);
      R.present({ grade: track.env.grade });
      return;
    }

    // victory lap: golden B fireworks chase the race winner home
    if (player.finished && player.rank === 1 && phase !== "intro") {
      fwT -= rdt;
      if (fwT <= 0) {
        fwT = (1.0 + Math.random() * 0.4) / Math.max(fxScale, 0.4);
        const bx = player.pos[0] + (Math.random() - 0.5) * 9;
        const by = player.pos[1] + 6.5 + Math.random() * 3;
        const bz = player.pos[2] + (Math.random() - 0.5) * 9;
        const fwd = V3.norm([bx - cam.pos[0], by - cam.pos[1], bz - cam.pos[2]]);
        const right = V3.norm(V3.cross(fwd, [0, 1, 0]));
        const up = V3.cross(right, fwd);
        spawnBFirework(partsAdd, bx, by, bz, right, up, 1.9);
      }
    }

    // sun shadow pass: karts + live item boxes cast onto the world.
    // Rides the post gate (high/medium, off under reduceFx + auto-drop).
    // Skipped during the intro flyby: the camera is too far to resolve
    // kart shadows and weak GPUs need the headroom right there.
    shadowsActive = false;
    if (R.getPost() && phase !== "intro") {
      const fwd = [Math.sin(player.heading), 0, Math.cos(player.heading)];
      const focus = [player.pos[0] + fwd[0] * 14, player.pos[1], player.pos[2] + fwd[2] * 14];
      if (R.beginShadow(focus, track.env.sunDir, 46)) {
        for (const k of karts) {
          const km = kartMeshes[k.driver.id];
          const spinYaw = k.spinT > 0 ? k.spinVis : 0;
          // mirrors drawKart's visYaw + pose pitch so the sun shadow
          // matches the slide (K4) and the weight-transfer pose (K12)
          const model = M4.trs(k.pos[0], k.pos[1], k.pos[2], k.heading + spinYaw + k.slideVis, kartPitch(k) * (k.airborne ? 0.25 : 1) + k.pitchVis, k.lean, 1 + k.squash * 0.45, 1 - k.squash * 0.8);
          R.shadowDraw(km.body, model);
          if (km.trim) R.shadowDraw(km.trim, model);
          // glow carries silhouette landmarks (the bolt mast is ALL glow) ·
          // excluding it from the sun pass left shadowless geometry
          if (km.glow) R.shadowDraw(km.glow, model);
          if (km.steer) R.shadowDraw(km.steer, model);
          if (km.arms) R.shadowDraw(km.arms, model);
          if (km.head) {
            const hmS = M4.mul(model, M4.trs(km.head.offset[0], km.head.offset[1], km.head.offset[2]));
            R.shadowDraw(km.head.mesh, hmS);
            if (km.hair) R.shadowDraw(km.hair, hmS);
          } else if (km.hair) {
            R.shadowDraw(km.hair, model); // headless fabric casts too
          }
          for (let i = 0; i < 4; i++) {
            const wp = WHEEL_POS[i];
            R.shadowDraw(km.wheel, M4.mul(model, M4.trs(wp[0], wp[1], wp[2])));
          }
        }
        for (const box of track.itemBoxes) {
          if (box.taken) continue;
          R.shadowDraw(ent.itemBlock, M4.trs(box.x, box.y, box.z, time * 1.4, 0.18, 0, 1));
        }
        R.endShadow();
        shadowsActive = true;
      }
    }

    R.begin(cam.env);
    R.draw(track.meshes.terrain, IDENT, { rim: 0, noise: specOn * 0.42 });
    R.draw(track.meshes.road, IDENT, { rim: 0, spec: specOn * (track.env.roadSpec || 0), specPow: track.env.roadSheen ? 68 : 34, sheen: specOn * (track.env.roadSheen || 0), noise: specOn * 0.3 });
    R.draw(skids.mesh, IDENT, { alpha: 0.999, rim: 0 });
    // K10: the hot trail rides ON the rubber · additive pass right after
    // it, before the walls, so it reads as light on the deck. Dead quads
    // carry alpha 0 and contribute nothing to the additive blend.
    if (!opts.reduceFx) R.glow(hotSkids.mesh, IDENT, 0.9);
    R.draw(track.meshes.walls, IDENT, { rim: 0.15, noCull: true, noise: specOn * 0.22 });
    if (track.meshes.water) R.drawWater(track.meshes.water, track.waterCols.deep, track.waterCols.shallow);
    let padIdx = 0;
    for (const inst of track.instances) {
      // boost pads strobe like zippers instead of sitting painted; the
      // chasm floor rivers BREATHE (colossal pass 2026-07-21)
      const emissive = inst.type === "chevron"
        ? 0.6 + 0.35 * Math.sin(time * 7 + (padIdx++) * 1.7)
        : inst.type === "chasmGlow"
          ? 0.7 + 0.3 * Math.sin(time * 2.2)
          : inst.emissive;
      // living world (mythic pass 2026-07-21): fins HUNT in circles (mesh
      // built off-origin, yaw sweeps it), the holo-B and timechain spin,
      // and WATCH-flagged colossi slowly turn to face the player
      const spin = inst.type === "bearFin" ? 0.55 : inst.type === "holoB" ? 0.4 : inst.type === "timechainArc" ? 0.02 : 0;
      let model = inst.model;
      if (spin) model = M4.mul(inst.model, M4.trs(0, 0, 0, time * spin + inst.model[12] * 0.13));
      else if (inst.watch) {
        const want = Math.atan2(player.pos[0] - inst.wx, player.pos[2] - inst.wz);
        let dyaw = want - (inst.wyawLive === undefined ? inst.wyaw : inst.wyawLive);
        while (dyaw > Math.PI) dyaw -= TAU;
        while (dyaw < -Math.PI) dyaw += TAU;
        inst.wyawLive = (inst.wyawLive === undefined ? inst.wyaw : inst.wyawLive) + dyaw * 0.008;
        model = M4.trs(inst.wx, inst.wy0, inst.wz, inst.wyawLive, 0, 0, inst.wscale);
      }
      // aurora curtains carry vertex alpha · alpha 0.99 forces the blend
      // path (the blob-shadow trick) so the ribbons stay translucent
      if (inst.type === "auroraCurtain") R.draw(inst.mesh, model, { emissive, rim: 0, alpha: 0.99 });
      // K14: two-frame popcorn crowds · the swap REPLACES the mesh, never
      // adds a draw; reduceFx always shows frame A (present but still).
      // model[12] is world-x: its fraction hashes a per-stand flip RATE
      // (4.7-5.6 rad/s ≈ 1.5-1.8Hz cheering) and its whole part offsets
      // phase, so stands never alternate in global lockstep
      else R.draw(inst.meshB && !opts.reduceFx && Math.sin(time * (4.7 + Math.abs(inst.model[12] % 1) * 0.9) + inst.model[12]) > 0 ? inst.meshB : inst.mesh, model, { emissive, rim: 0.25 });
    }
    for (const bb of track.billboards) {
      R.draw(bb.frame, bb.model, { rim: 0.2 });
      const flick = bb.flickerTex && Math.sin(time * 3.1) > 0.55;
      R.drawTextured(bb.panel, bb.model, flick ? bb.flickerTex : bb.tex, { glow: 0.4 });
    }
    // item boxes: spinning orange blocks that grow back in with a sparkle
    for (const box of track.itemBoxes) {
      let scale = 1;
      if (box.taken) {
        if (box.timer > 0.55) continue; // gone until the respawn window
        scale = clamp(1 - box.timer / 0.55, 0.05, 1);
      }
      const bobY = box.y + Math.sin(time * 2 + box.x) * 0.15;
      const m = M4.trs(box.x, bobY, box.z, time * 1.4, 0.18, 0, scale);
      R.draw(ent.itemBlock, m, { emissive: 0.65 + 0.2 * Math.sin(time * 3.2 + box.z), alpha: 0.94 });
      if (!box.taken) R.glow(ent.itemBlock, M4.trs(box.x, bobY, box.z, time * 1.4, 0.18, 0, 1.25), 0.12);
    }
    // sats
    for (const s of track.sats) {
      if (s.taken) continue;
      R.draw(ent.sat, M4.trs(s.x, s.y + Math.sin(time * 3 + s.x * 2) * 0.08, s.z, time * 3, 0, 0, 1), { emissive: 0.8 });
    }
    // item entities
    for (const e of items.ents) {
      let mesh = ent[e.type];
      if (!mesh) continue;
      let m;
      if (e.type === "hammer") {
        m = M4.trs(e.x, e.y, e.z, time * 1.5, 0, 0, 2.2);
        // the blue-shell telegraph: a shadow grows under the target while
        // the gavel hovers, so the leader gets a fair beat to brace
        if (e.phase === 0 && e.target) {
          const tq = surfaceQuery(track, e.target.pos[0], e.target.pos[2], e.target.sIdx);
          const grow = 1 + (e.t / 1.5) * 2.4;
          R.draw(ent.shadow, M4.trs(e.target.pos[0], tq.roadY + 0.05, e.target.pos[2], 0, 0, 0, grow), { alpha: 0.99, rim: 0 });
        }
      } else if (e.type === "ratio") {
        m = M4.trs(e.x, e.y, e.z, e.yaw, Math.PI / 2.4, 0, 1);
      } else if (e.type === "fud") {
        m = M4.trs(e.x, e.y, e.z, e.yaw + time * 6, 0, 0, 1);
      } else {
        m = M4.trs(e.x, e.y, e.z, e.yaw || 0, 0, 0, 1);
      }
      R.draw(mesh, m, { emissive: e.type === "ratio" ? 0.4 : 0.1 });
    }
    // ghost kart (body + wheels, translucent)
    if (ghostFrames && ghostFrames.length && phase !== "intro" && ghostMesh) {
      const idx = Math.min(Math.floor(raceT * 10), ghostFrames.length - 1);
      const g = ghostFrames[idx];
      const gm = M4.trs(g[0], g[1], g[2], g[3], 0, 0, 1);
      R.draw(ghostMesh.body, gm, { alpha: 0.32, rim: 0.1 });
      // trim + glow carry each machine's signature landmark (wings, bolt
      // mast, vault door) · a ghost without them loses its identity
      if (ghostMesh.trim) R.draw(ghostMesh.trim, gm, { alpha: 0.32, rim: 0.1 });
      if (ghostMesh.glow) R.draw(ghostMesh.glow, gm, { alpha: 0.32, emissive: 0.5, rim: 0 });
      if (ghostMesh.hair) {
        const o = ghostMesh.head ? ghostMesh.head.offset : null;
        R.draw(ghostMesh.hair, o ? M4.mul(gm, M4.trs(o[0], o[1], o[2], 0, 0, 0, 1)) : gm, { alpha: 0.32, rim: 0.1 });
      }
      if (ghostMesh.steer) R.draw(ghostMesh.steer, gm, { alpha: 0.32, rim: 0.1 });
      if (ghostMesh.arms) R.draw(ghostMesh.arms, gm, { alpha: 0.32, rim: 0.1 });
      for (let i = 0; i < 4; i++) {
        const wp = WHEEL_POS[i];
        const gwm = M4.mul(gm, M4.trs(wp[0], wp[1], wp[2], 0, 0, 0, 1));
        R.draw(ghostMesh.wheel, gwm, { alpha: 0.32, rim: 0 });
        // no metal on a translucent draw · the ghost stays a soft read
        if (ghostMesh.wheelHub) R.draw(ghostMesh.wheelHub, gwm, { alpha: 0.32, rim: 0 });
      }
    }
    // world-leader rival ghost · orange glow so it never reads as yours
    if (rivalGhost && phase !== "intro") {
      const rf = rivalGhost.frames;
      const idx = Math.min(Math.floor(raceT * 10), rf.length - 1);
      const g = rf[idx];
      const gm = M4.trs(g[0], g[1], g[2], g[3], 0, 0, 1);
      const mesh = ghostMesh || kartMeshes[playerDriver.id];
      R.draw(mesh.body, gm, { alpha: 0.3, emissive: 0.55, rim: 1.4 });
      if (mesh.trim) R.draw(mesh.trim, gm, { alpha: 0.3, emissive: 0.55, rim: 1.4 });
      if (mesh.glow) R.draw(mesh.glow, gm, { alpha: 0.3, emissive: 0.8, rim: 0 });
      if (mesh.hair) {
        const o = mesh.head ? mesh.head.offset : null;
        R.draw(mesh.hair, o ? M4.mul(gm, M4.trs(o[0], o[1], o[2], 0, 0, 0, 1)) : gm, { alpha: 0.3, emissive: 0.55, rim: 1.4 });
      }
      if (mesh.steer) R.draw(mesh.steer, gm, { alpha: 0.3, emissive: 0.55, rim: 1.4 });
      if (mesh.arms) R.draw(mesh.arms, gm, { alpha: 0.3, emissive: 0.55, rim: 1.4 });
      for (let i = 0; i < 4; i++) {
        const wp = WHEEL_POS[i];
        const twm = M4.mul(gm, M4.trs(wp[0], wp[1], wp[2], 0, 0, 0, 1));
        R.draw(mesh.wheel, twm, { alpha: 0.3, emissive: 0.3, rim: 0 });
        if (mesh.wheelHub) R.draw(mesh.wheelHub, twm, { alpha: 0.3, emissive: 0.3, rim: 0 });
      }
    }
    // karts (player last for particle overlap niceness)
    for (const k of karts) if (k !== player) drawKart(k, time);
    drawKart(player, time);
    partsSoft.draw(false);
    partsAdd.draw(true);
    // boost speed streak: radial blur eases in and out with the boost
    const wTarget = !player.finished && (player.boostT > 0 || player.chairT > 0) ? 1 : 0;
    warpAmt += (wTarget - warpAmt) * Math.min(rdt * 6, 1);
    // SHINE (2026-07-22): the per-world grade rides every frame · the
    // cinema lens only while a shot is playing
    const cineLens = phase === "cinema" && cam.dofAmt > 0 && !opts.reduceFx;
    R.present({
      warp: warpAmt > 0.02 ? warpAmt * 0.8 : 0,
      grade: track.env.grade,
      dof: cineLens ? cam.dofAmt : 0,
      focus: cineLens ? cam.dofFocus : 0,
    });
  }

  function dispose() {
    hud.dispose();
    Snd.engineOff();
    Snd.ambience(null);
    if (resDropped) { R.setResScale(resBase); R.setPost(postBase); } // undo the auto drop · back to the TIER baseline
    // free the per-race GPU objects · the kart + track caches (kartGL /
    // TRACK_GL) are session-lived and keep theirs (bug sweep 2026-07-15)
    if (R.disposeMesh) {
      for (const k in ent) {
        const v = ent[k];
        if (v && v.vao) R.disposeMesh(v);
        else if (v && v.mesh) { R.disposeMesh(v.mesh); if (v.tex) R.deleteTexture(v.tex); }
      }
      if (partsAdd.destroy) partsAdd.destroy();
      if (partsSoft.destroy) partsSoft.destroy();
      if (skids.destroy) skids.destroy();
      if (hotSkids.destroy) hotSkids.destroy();
      if (podium && podium.mesh) R.disposeMesh(podium.mesh); // lazy per-race podium floor
    }
  }

  // ---- pipeline prewarm (perf fix 2026-07-16) ----
  // One hidden CHASE-pose frame at load so the deferred first-draw costs
  // (texture residency, shadow FBO alloc, driver shader compiles · WebKit
  // defers these hardest) land during load, not on the pre-GO frame the
  // camera swings behind the grid. R.setWarming keeps it off the visible
  // canvas (post: composite skipped · direct: one clipped pixel).
  {
    phase = "count"; // chase camera branch + the shadow-pass gate both active
    const fwd = [Math.sin(player.heading), 0, Math.cos(player.heading)];
    cam.pos = [player.pos[0] - fwd[0] * 7, player.pos[1] + 3.0, player.pos[2] - fwd[2] * 7];
    // one throwaway particle per pool, far under the road: warms the
    // particle programs + buffers without a visible puff
    partsAdd.spawn(player.pos[0], -120, player.pos[2], 0, 0, 0, 0.2, 0.05, 1, 1, 1, 0.3, 0);
    partsSoft.spawn(player.pos[0], -120, player.pos[2], 0, 0, 0, 0.2, 0.05, 1, 1, 1, 0.3, 0);
    R.setWarming(true);
    try {
      updateCamera(1 / 60, {});
      render(0);
    } catch { /* a failed warmup must never block the race itself */ }
    R.setWarming(false);
    phase = cine ? "cinema" : "intro";
    phaseT = 0;
  }

  return {
    track,
    karts,
    player,
    update,
    render,
    dispose,
    useItem: () => items.use(player),
    // debug/test hook: drive the player with the CPU brain (window.__BK_AUTO)
    autopilot(dt) {
      const inp = aiInput(player, track, karts, items, null, dt, false);
      if (inp.useItem) items.use(player);
      return inp;
    },
    getPhase: () => phase,
    skipIntro: () => {
      if (phase === "cinema") { endCinema(); return; }
      if (phase === "intro") { phase = "count"; phaseT = 0; hud.clearIntro(); }
    },
    // world-leader rival ghost · injected async once the fetch lands
    setRivalGhost,
    // debug/test hook: entity inspection for automated verification
    items,
  };
}
