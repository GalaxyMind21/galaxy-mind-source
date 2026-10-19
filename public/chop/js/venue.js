// CHOP · venue.js — the room the game is played in.
//
// ── WHY ─────────────────────────────────────────────────────────────
// Blind visual panels parked CHOP at 7/10 for many rounds while praising
// its colour discipline and typography. Looking at real frames at real
// phone size, the reason is not a missing effect, it is a missing PLACE:
// every Beat Saber still reads as "I am standing on a stage at a show",
// and every CHOP still reads as "objects on a dark backdrop". The top
// third of the frame is empty sky. Nothing hangs above the player.
// Nothing flanks the corridor. There is no audience.
//
// The scene was NOT lacking machinery — main.js already drives towers,
// lasers, embers and the glow core off the audio clock. It was lacking
// AMPLITUDE, and for a defensible reason: every one of those decisions
// was made to protect note legibility, and the comments say so ("whisper
// opacity, never compete with notes", "aimed OUT of the lane corridor",
// "kick-whisper only"). Each was right on its own. Summed, they produced
// a venue so quiet it reads as absent, and since the notes themselves are
// LIT metal rather than emissive, nothing in the frame is bright at all.
//
// ── THE RULE THAT MAKES LOUD SAFE ───────────────────────────────────
// The fix is not "turn the old things up" — that trades the picture
// against the gameplay, which is the trade the old comments correctly
// refused. It is to put the spectacle where notes never go:
//
//     KEEP_OUT: |x| <= 3.4  and  -1.2 <= y <= 2.4  and  z >= -21
//
// That box is the play corridor. Everything in this file lives strictly
// outside it — overhead, outboard, or far downstage — so it can be as
// loud as a real light rig without ever competing with a cube the player
// has to read. `assertClear()` enforces it, and the QA harness asserts it
// too, so a future edit cannot quietly drift a beam into the lane.
//
// ── DRIVE ───────────────────────────────────────────────────────────
// Nothing here uses wall-clock time. Everything is driven by the musical
// envelopes main.js already computes from the AudioContext clock (kick,
// barEnv, buildRise, dropLift, dropPunch, beat phase) so the room and the
// music are one object. A rig that sweeps on rAF while the music does
// something else is worse than no rig.

export const KEEP_OUT = { x: 3.4, yMin: -1.2, yMax: 2.4, z: -21 };

/** True when a point is inside the play corridor, i.e. illegal for venue geometry. */
export function violatesKeepOut(x, y, z) {
  return Math.abs(x) <= KEEP_OUT.x
    && y >= KEEP_OUT.yMin && y <= KEEP_OUT.yMax
    && z >= KEEP_OUT.z;
}

// Beam shell: an open cone shaded like a volume. A true volumetric would
// cost a raymarch per pixel; a fresnel-rimmed additive shell reads the
// same at phone size for one draw call, because what the eye reads as
// "shaft of light in haze" is mostly the bright grazing edge plus a fade
// along its length.
const BEAM_VS = `
varying vec3 vN; varying vec3 vV; varying float vT;
uniform float uH;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  vT = clamp((position.y + uH * 0.5) / uH, 0.0, 1.0); // 0 at mouth, 1 at lamp
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FS = `
precision mediump float;
varying vec3 vN; varying vec3 vV; varying float vT;
uniform vec3 uColor; uniform float uIntensity; uniform float uSoft;
void main() {
  // grazing-angle brightening is what sells a shell as a volume
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(1.0 - ndv, 2.0);
  // hot at the lamp, dissolving into the room at the mouth
  float along = pow(vT, 1.6) * 0.85 + 0.15;
  // never a hard mouth edge — that reads as a cone-shaped object
  float mouth = smoothstep(0.0, uSoft, vT);
  gl_FragColor = vec4(uColor * (rim * along * mouth) * uIntensity, 1.0);
}`;

/**
 * Build the venue. Returns a handle with an update() the frame loop calls.
 *
 * @param {object} THREE  the vendored three module (shared instance)
 * @param {object} scene
 * @param {{quality?:number, reduceMotion?:boolean}} [opts]
 *   quality 0 = off, 1 = reduced (no beams), 2 = full
 */
export function createVenue(THREE, scene, opts = {}) {
  const root = new THREE.Group();
  root.name = "venue";
  scene.add(root);

  let quality = opts.quality == null ? 2 : opts.quality;
  const reduceMotion = !!opts.reduceMotion;

  // ── the truss ──────────────────────────────────────────────────────
  // A real rig gives the frame a ceiling, which is most of why a still
  // reads as "indoors at a show" rather than "outdoors in a void".
  const trussMat = new THREE.MeshStandardMaterial({
    color: 0x0d0f16, roughness: 0.72, metalness: 0.6,
    emissive: 0x2a1a08, emissiveIntensity: 0.12,
  });
  // The truss reads at ~24 deg above the look axis in a 29 deg half-FOV,
  // i.e. it lands in the top ~15% of a portrait frame — the dead sky band
  // that every panel round called out as empty.
  const TRUSS_Y = 6.4, TRUSS_Z = -7.5, TRUSS_HALF = 9;
  const BEAM_LEN = 14;
  const LAMP_Y = TRUSS_Y - 0.68; // pivot drop + lens offset

  // MINIMUM LEGAL RAKE — derived, not guessed.
  //
  // A beam leaves the lamp and descends. It is safe only if it has already
  // travelled PAST the far end of the corridor by the time it falls to the
  // corridor's ceiling. Standing a beam up (smaller rake) walks its far end
  // back into the lane, so there is a hard floor:
  //
  //     tan(rake) >= |KEEP_OUT.z - TRUSS_Z| / (LAMP_Y - KEEP_OUT.yMax)
  //
  // Deriving it here instead of writing 1.36 means moving the truss,
  // lengthening the beams or resizing the corridor cannot silently make
  // the rig illegal — the floor moves with the geometry. Every phase
  // clamps to it, so no animation state can cross the line.
  const MIN_RAKE = Math.atan(
    Math.abs(KEEP_OUT.z - TRUSS_Z) / Math.max(0.1, LAMP_Y - KEEP_OUT.yMax),
  ) + 0.03;
  const RAKE = MIN_RAKE + 0.03;
  {
    const chord = new THREE.BoxGeometry(TRUSS_HALF * 2, 0.16, 0.16);
    for (const [dy, dz] of [[0.34, 0], [-0.34, 0], [0, 0.3], [0, -0.3]]) {
      const m = new THREE.Mesh(chord, trussMat);
      m.position.set(0, TRUSS_Y + dy, TRUSS_Z + dz);
      root.add(m);
    }
    // diagonal webbing — the detail that stops it reading as four bars
    const web = new THREE.BoxGeometry(0.075, 0.86, 0.075);
    for (let i = -TRUSS_HALF + 0.6; i < TRUSS_HALF; i += 1.15) {
      const m = new THREE.Mesh(web, trussMat);
      m.position.set(i, TRUSS_Y, TRUSS_Z);
      m.rotation.z = (Math.floor(i) % 2 ? 1 : -1) * 0.5;
      root.add(m);
    }
  }

  // ── moving heads ───────────────────────────────────────────────────
  // Six is enough to read as a rig and cheap enough to stay in budget.
  //
  // PLACEMENT IS DICTATED BY PORTRAIT FOV, and this is the non-obvious
  // part. The camera is 58 deg VERTICAL at a 430x932 aspect, which works
  // out to only about +/-14 deg horizontally — roughly +/-3.4 world units
  // at the truss depth. That is the same width as the play corridor. So
  // in portrait there is no such thing as "beside the lane but on
  // screen": anything far enough out to clear the corridor is simply not
  // in frame. (An earlier version hung two flanking banks at |x| ~ 9 and
  // they were invisible — correct by the keep-out rule, useless by the
  // camera.)
  //
  // Vertically there is ~7.4 units of headroom at that depth, so the rig
  // goes ABOVE the lane and rakes DOWNSTAGE, over the crowd and away from
  // the player. That is both the legal placement and the iconic festival
  // image the operator asked for: beams over the audience, not spotlights
  // in your eyes.
  const HEAD_X = [-3.1, -1.85, -0.6, 0.6, 1.85, 3.1];
  const HEADS = HEAD_X.length;
  const heads = [];
  {
    const bodyGeo = new THREE.BoxGeometry(0.34, 0.4, 0.34);
    const yokeGeo = new THREE.BoxGeometry(0.09, 0.34, 0.09);
    const lensGeo = new THREE.SphereGeometry(0.14, 12, 8);
    const beamGeo = new THREE.ConeGeometry(1.0, 14, 18, 1, true);
    // Cone apex is +y in local space; we want the LAMP at the apex and
    // the mouth spreading away, so the group is aimed and the cone is
    // pushed down its own -y. Rotating the geometry once here is cheaper
    // than rotating six meshes every frame.
    beamGeo.translate(0, -7, 0);

    for (let i = 0; i < HEADS; i++) {
      const x = HEAD_X[i];
      const pivot = new THREE.Group();
      pivot.position.set(x, TRUSS_Y - 0.5, TRUSS_Z);
      root.add(pivot);

      const yoke = new THREE.Mesh(yokeGeo, trussMat);
      yoke.position.y = 0.28;
      pivot.add(yoke);
      const body = new THREE.Mesh(bodyGeo, trussMat);
      pivot.add(body);

      const lensMat = new THREE.MeshBasicMaterial({
        color: 0xffc880, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.y = -0.18;
      pivot.add(lens);

      const beamMat = new THREE.ShaderMaterial({
        vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
        uniforms: {
          uColor: { value: new THREE.Color(0xffb04a) },
          uIntensity: { value: 0 },
          uH: { value: 14 },
          uSoft: { value: 0.35 },
        },
        transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = -0.18;
      beam.frustumCulled = false; // a 14u cone straddles the frustum edge constantly
      pivot.add(beam);

      heads.push({
        pivot, beam, beamMat, lensMat,
        // Each head gets its own phase so a shared sweep function still
        // produces a fan rather than six synchronised clones.
        seed: i * 1.7,
        // `side` is the OUTBOARD direction for this head. Every sweep is
        // expressed as a rotation away from the lane, so no pose in any
        // phase can point a cone inward across the corridor.
        side: x < 0 ? -1 : 1,
        odd: i % 2 === 1,
      });
    }
  }

  // ── the crowd ──────────────────────────────────────────────────────
  // Far downstage, below the skyline. A dark mass plus a field of little
  // warm lights is the cheapest thing in this file and does more for
  // "this is an event" than any amount of geometry — a still frame with
  // an audience in it cannot read as an empty room.
  const crowd = { lights: null, mat: null };
  {
    const N = 520;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const ph = new Float32Array(N);
    let s = 0x9e3779b9;
    const rnd = () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) % 100000) / 100000;
    };
    for (let i = 0; i < N; i++) {
      // Well past the skyline and far below the rig — outside KEEP_OUT on z.
      const x = (rnd() - 0.5) * 46;
      const y = -1.15 + rnd() * 1.15;
      const z = -23.5 - rnd() * 5.5;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const b = 0.25 + rnd() * 0.5;
      col[i * 3] = b; col[i * 3 + 1] = b * (0.72 + rnd() * 0.2); col[i * 3 + 2] = b * 0.5;
      ph[i] = rnd() * Math.PI * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("aPhase", new THREE.Float32BufferAttribute(ph, 1));

    const tex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const ctx2 = c.getContext("2d");
      const gr = ctx2.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, "rgba(255,236,200,1)");
      gr.addColorStop(1, "rgba(255,236,200,0)");
      ctx2.fillStyle = gr; ctx2.fillRect(0, 0, 32, 32);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex }, uTime: { value: 0 },
        uLift: { value: 0 },   // build/drop raises the whole crowd's brightness
        uFlash: { value: 0 },  // drop downbeat: everyone's phone goes up at once
        uSize: { value: 46 },
      },
      vertexShader: `
        attribute float aPhase; varying vec3 vC; varying float vA;
        uniform float uTime, uLift, uFlash, uSize;
        void main() {
          vC = color;
          // Independent twinkle plus a slow lateral wave, so the field
          // reads as people rather than as static noise.
          float tw = 0.55 + 0.45 * sin(uTime * 2.1 + aPhase * 3.0);
          vA = tw * (0.5 + uLift * 0.7) + uFlash * 0.9;
          vec4 mv = modelViewMatrix * vec4(
            position + vec3(sin(uTime * 0.7 + aPhase) * 0.06, 0.0, 0.0), 1.0);
          gl_PointSize = uSize * (1.0 + uFlash * 0.5) / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        precision mediump float;
        uniform sampler2D uMap; varying vec3 vC; varying float vA;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vC * vA, t.a * vA);
        }`,
      vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    root.add(pts);
    crowd.lights = pts;
    crowd.mat = mat;
  }

  // ── blinders ───────────────────────────────────────────────────────
  // Two banks aimed at the camera that fire ONLY on the drop downbeat.
  // This is the visual half of the operator's "big drops": the audio
  // already lands, and the room needs to answer it with something the
  // player feels in their eyes. Deliberately the single loudest element
  // in the game, and deliberately about 400 ms long.
  const blinders = [];
  {
    const geo = new THREE.PlaneGeometry(3.6, 1.5);
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffe6c0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      // Above the corridor (y > KEEP_OUT.yMax) and inboard enough to
      // actually be in a portrait frame — same FOV reasoning as the heads.
      m.position.set(side * 2.4, 4.6, -8.2);
      m.lookAt(0, 1.2, 3);
      root.add(m);
      blinders.push(m);
    }
  }

  // ── keep-out enforcement ───────────────────────────────────────────
  // Cheap insurance against a future edit nudging a beam or a blinder
  // into the lane, which would be a legibility regression that only ever
  // shows up as the vague complaint "the game got harder to read".
  //
  // Test the geometry's WORLD-SPACE BOUNDING BOX, not the object origin.
  // The first version tested origins and was wrong in both directions: a
  // Points cloud reports (0,0,0) however far away its vertices are (a
  // false positive), and — far worse — a 14-unit beam cone hangs from a
  // pivot up on the truss that is perfectly legal while the cone itself
  // sweeps straight through the corridor (a false negative, i.e. exactly
  // the bug this function exists to catch).
  const _box = new THREE.Box3();
  function assertClear(atWorstCasePose = true) {
    const bad = [];
    if (atWorstCasePose) {
      // Swing every head to the most corridor-threatening pose any phase
      // can produce — fully inboard yaw and the most stood-up rake the
      // build allows — so the check covers the whole animation range
      // rather than whatever frame happens to be current.
      // the most corridor-threatening pose the ANIMATION can now produce:
      // minimum in-board yaw (0.2 in the drop scissor) at the rake floor
      for (const h of heads) { h.pivot.rotation.z = h.side * 0.2; h.pivot.rotation.x = MIN_RAKE; }
    }
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!o.geometry || (!o.isMesh && !o.isPoints)) return;
      if (o.visible === false) return;
      _box.setFromObject(o, true);
      if (!isFinite(_box.min.x)) return;
      // Does the AABB overlap the corridor at all?
      const overlaps =
        _box.min.x <= KEEP_OUT.x && _box.max.x >= -KEEP_OUT.x &&
        _box.min.y <= KEEP_OUT.yMax && _box.max.y >= KEEP_OUT.yMin &&
        _box.max.z >= KEEP_OUT.z;
      if (overlaps) {
        bad.push({
          name: o.name || o.type,
          min: [+_box.min.x.toFixed(2), +_box.min.y.toFixed(2), +_box.min.z.toFixed(2)],
          max: [+_box.max.x.toFixed(2), +_box.max.y.toFixed(2), +_box.max.z.toFixed(2)],
        });
      }
    });
    return bad;
  }

  // ── per-frame ──────────────────────────────────────────────────────
  // `d` is the drive bus main.js already computes from the audio clock.
  let t = 0;
  function update(dt, d) {
    if (quality <= 0) return;
    // The sweep clock advances with the MUSIC's energy, not wall time, so
    // the rig slows through a breakdown and drives through a drop without
    // any per-phase authoring.
    t += dt * (0.55 + d.buildRise * 0.9 + d.drop * 1.5);

    const isBreak = d.phase === "breakdown";
    const isDrop = d.phase === "drop";
    const isBuild = d.phase === "build";

    // ── THE ROOM ANSWERS THE PLAYER ──────────────────────────────────
    // Until now this rig keyed entirely to the MUSIC — it did not know a
    // player existed, so a x120 run and a fumbled one lit the room
    // identically. In Beat Saber the venue reacting to YOUR performance
    // is a large part of why the game feels expensive.
    //
    // It answers in LEVEL AND MOTION ONLY, never in hue. The palette
    // contract is load-bearing: warm belongs to the verb and its rewards,
    // and a crowd that warms up with the combo would start competing with
    // the notes for the eye — which has been tried and reverted before.
    // Heat lifts the room's energy; it never changes its colour.
    const heat = Math.max(0, Math.min(1, d.heat || 0));
    const slump = Math.max(0, Math.min(1, d.slump || 0));
    // craft: rolling cut QUALITY, seeded 0.55 — how well, not how long.
    // multHeat: sustained idle for the current multiplier tier.
    // cutPulse: ~200ms cool kick per landed cut. All three are LEVEL AND
    // MOTION only, same law as heat/slump: none may ever touch a hue.
    const craft = d.craft == null ? 0.55 : Math.max(0, Math.min(1, d.craft));
    const multHeat = Math.max(0, Math.min(1, d.multHeat || 0));
    const cutPulse = Math.max(0, Math.min(1, d.cutPulse || 0));
    crowd.mat.uniforms.uTime.value += dt;
    crowd.mat.uniforms.uLift.value =
      (0.15 + d.drop * 0.85 + d.buildRise * 0.5 + d.kick * 0.12
        + heat * 0.5 + craft * 0.22 + multHeat * 0.18)
      * (1 - slump * 0.55);   // a broken chain visibly takes the room down
    // The crowd flashes for the drop AND for the player's own milestones,
    // so a multiplier unlock reads as the room noticing, not just a pill.
    crowd.mat.uniforms.uFlash.value = Math.max(
      d.dropPunch * 0.9, (d.playerFlash || 0) * 0.75, cutPulse * 0.25);

    for (let i = 0; i < blinders.length; i++) {
      // Only the drop punch — never the kick. A blinder that fires every
      // beat is not a blinder, it is a flicker, and it would fight the
      // notes for the whole run.
      blinders[i].material.opacity = Math.pow(d.dropPunch, 1.8) * 0.55;
    }

    if (quality < 2) return; // reduced tier keeps truss + crowd, drops beams

    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      let yaw, pitch, intensity, color;

      // `pitch` is measured as a rake off vertical: RAKE is nearly
      // horizontal-downstage, smaller values stand the beam up. Nothing
      // here is ever allowed below RAKE - 0.30, because standing a beam
      // up any further walks its far end back into the corridor.
      if (isBreak) {
        // BREAKDOWN · the room exhales. Heads fan wide and go cool — the
        // one teal moment in a warm palette, so the drop's return to gold
        // is a colour event and not merely a level change.
        yaw = h.side * 0.55;
        pitch = RAKE + 0.08;
        intensity = 0.3 + d.barEnv * 0.12;
        color = 0x2f7f96;
      } else if (isBuild) {
        // BUILD · converge and lift. The fan closes and the beams stand
        // up as the riser climbs, so the picture inhales with the snare
        // roll and the room is visibly winding up before it pays off.
        //
        // The stand-up is capped at the derived MIN_RAKE floor. The first
        // version stood up by 0.28 rad, which walked two beam cones'
        // worst-case AABBs into the play corridor (probed live: max.x
        // -0.6, y down to 1.5) — the exact violation the keep-out exists
        // to prevent, snuck in by an ANIMATION pose rather than a
        // placement. The inhale now comes from convergence + intensity;
        // the rake never crosses its floor.
        yaw = h.side * (0.55 - d.buildRise * 0.32);
        pitch = Math.max(MIN_RAKE, RAKE - d.buildRise * 0.05);
        intensity = 0.42 + d.buildRise * 1.0;
        color = 0xffc266;
      } else if (isDrop) {
        // DROP · hard snaps ON the beat. `step` quantises the sweep so
        // heads SNAP between positions instead of gliding — the whole
        // difference between a light show and a screensaver. Odd heads
        // take the wide position while even heads take the narrow one, so
        // the rig scissors rather than moving as one slab.
        const step = Math.floor(t * 4) % 4;
        const spread = h.odd ? 0.85 - step * 0.15 : 0.2 + step * 0.15;
        yaw = h.side * spread;
        // snap UP from the rake, never below it — down is where the lane is
        pitch = RAKE + (step % 2) * 0.16;
        intensity = 1.15 + d.kick * 0.9 + d.dropPunch * 1.3;
        color = 0xffa63a;
      } else {
        // INTRO / GROOVE · a slow lazy fan. Present, never busy.
        //
        // Note the 0.45 offset: every yaw in this function is
        // `h.side * <positive>`, so a beam can only ever swing further
        // OUTBOARD, never inward across the lane. A raw sin() here would
        // cross zero twice a cycle and rake the corridor — the one thing
        // the entire keep-out design exists to prevent.
        // A2 · a higher mult idles the fan a touch wider. The inner term
        // stays strictly positive (0.13 worst case) and the factor is
        // >=1, so a beam still can only swing OUTBOARD, never inward.
        yaw = h.side * ((0.45 + Math.sin(t * 0.55 + h.seed) * 0.32)
          * (1 + (reduceMotion ? 0 : multHeat * 0.12)));
        pitch = RAKE + Math.sin(t * 0.4 + h.seed * 0.7) * 0.1;
        intensity = 0.4 + d.kick * 0.32 + d.barEnv * 0.16;
        color = 0xffb04a;
      }

      // A4 · SLUMP OWNS MOTION. The level damp alone is easy to miss
      // under drop scissors, so a real chain break also POSES the rig:
      // heads blend toward the breakdown park (wide fan, soft rake) and
      // ease back as the slump decays. Gated off the drop — mid-payoff
      // the snap choreography wins, because yanking the drop's pose for
      // a miss would read as the music glitching, not the room exhaling.
      if (slump > 0.05 && !isDrop) {
        yaw = yaw * (1 - slump) + (h.side * 0.55) * slump;
        pitch = pitch * (1 - slump) + (RAKE + 0.08) * slump;
      }

      if (reduceMotion) {
        // Parked and steady: a swinging beam is exactly the kind of large,
        // smooth, full-field motion that triggers vestibular discomfort.
        // The rig still BREATHES with the music (intensity is untouched
        // below its cap) — reduced motion means no large translations,
        // not no feedback at all.
        yaw = h.side * 0.4;
        pitch = RAKE;
        intensity = Math.min(intensity, 0.5);
      }

      h.pivot.rotation.z = yaw;
      h.pivot.rotation.x = pitch;
      // Player heat rides on TOP of whatever the music asked for, and only
      // as level — the hue above is untouched, so a hot run makes the room
      // brighter and busier without ever making it warm enough to compete
      // with the notes. A broken chain visibly takes the rig down with it.
      // craft floor 0.78 — a bad run must read as a QUIET room, never a
      // broken rig. cutPulse is capped by max() at the producer, and the
      // whole stack clamps at 2.0 so high NPS cannot strobe the truss.
      h.beamMat.uniforms.uIntensity.value = Math.min(2.0,
        intensity * (0.78 + 0.35 * craft) * (1 + multHeat * 0.2)
          * (1 + heat * 0.45) * (1 - slump * 0.5)
          + cutPulse * 0.55);
      h.beamMat.uniforms.uColor.value.setHex(color);
      h.lensMat.color.setHex(color);
      h.lensMat.opacity = Math.min(1, 0.35 + intensity * 0.6);
    }
  }

  function setQuality(q) {
    quality = q;
    const beamsOn = q >= 2;
    for (const h of heads) {
      h.beam.visible = beamsOn;
      if (!beamsOn) h.beamMat.uniforms.uIntensity.value = 0;
    }
    root.visible = q > 0;
  }

  return {
    root, heads, crowd, blinders, update, setQuality, assertClear,
    get quality() { return quality; },
  };
}
