// BITCOIN KART · faces.js
// Cartoon caricature face textures, painted on a 512x256 canvas and wrapped
// cylindrically around each driver's head sphere (u=0.5 faces forward).
// Affectionate parody portraits: hairline, brows, eyes, glasses, mouth and
// facial hair carry the likeness; nobody's photo is used or traced.

const W = 512, H = 256;
const FACE_L = 168, FACE_R = 344; // face window; outside wraps as hair/back

// FACE COORDINATE SYSTEM (logical 512x256 · y runs top of head → under the
// chin on the UV sphere, so the canvas BOTTOM EDGE wraps beneath the jaw):
//   0..fringe      hair / cap band
//   ~72..88        forehead
//   browY  (92)    brows
//   eyeY   (116)   eye line
//   eyeY+16..+36   nose bridge → tip
//   eyeY+40        nostril line
//   philtrum       nostrils..mouth: MUSTACHE territory (mouthY-16..mouthY-1)
//   mouthY (186)   lips · painted AFTER facial hair so they read on top
//   mouthY+12      chin line: beard mass STARTS here, never above the mouth
//   jaw            sideburns meet the hair wrap at ~146 on the face edges,
//                  sweep down and in to the chin; below that wraps under
// Per-driver `layout` overrides break the rubber-stamp: same painter, but
// eye spread / brow height / mouth height shift per caricature.
const LAYOUT = { browY: 92, eyeY: 116, eyeSep: 38, mouthY: 186 };

// results-screen mood chip: the front face window on the 2x backing store
// (logical x FACE_L..FACE_R, y 48..240). main.js draws this rect into the
// square results chip, so painter layout and chip crop move in lockstep
// through this one constant · brows..chin must stay inside it.
export const FACE_CROP = { x: FACE_L * 2, y: 96, w: (FACE_R - FACE_L) * 2, h: 384 };

// per-driver caricature spec · likeness pass 2026-07-14, facial-hair layout
// rebuild 2026-07-17 (the old jaw-arc stroke cut across the mid-face and
// read as a beard floating ABOVE the mouth on close-ups): the bar is
// DISCERNIBILITY (hair/hat silhouette, glasses on/off, beard shape,
// expression) · classic kart-racer caricature energy, never photorealism.
export const FACE_SPECS = {
  saylor: {
    // silver swept hair (NOT brown) · light gray stubble-goatee on the chin
    // BELOW the mouth · no glasses · sharp smirk, gaunt cheekbones
    skin: "#E4B48C", hair: "#C2C6CE", hairStyle: "sweptback",
    layout: { mouthY: 184 },
    brows: { color: "#6A6E76", angle: -0.16, thick: 9 },
    eyes: { iris: "#3A4E62", lids: true },
    mouth: { style: "smirk" },
    facialHair: { style: "stubble", color: "#A8ADB6", goatee: true },
    detail: "sharp",
  },
  phong: {
    // NO GLASSES (operator confirmed) · short dark hair · clean-shaven · calm executive
    skin: "#D4A06C", hair: "#1A1612", hairStyle: "short",
    layout: { eyeSep: 36 },
    brows: { color: "#1A1612", angle: -0.04, thick: 7 },
    eyes: { iris: "#2C241C" },
    mouth: { style: "smile" },
    facialHair: null,
  },
  wizard: {
    // persona costume: white sides + hat/beard MESH · face smug, not elderly
    skin: "#E8C39A", hair: "#F2EFE8", hairStyle: "sides",
    layout: { browY: 90 },
    brows: { color: "#D8D4CC", angle: -0.14, thick: 10, bushy: true },
    eyes: { iris: "#4A6A7C" },
    mouth: { style: "smirk" },
    facialHair: null, // the long wizard beard is a mesh
    cheeks: true,
  },
  mallers: {
    // black forward cap · brown short beard on the jaw, mustache over the
    // lip · young wide grin · no glasses
    skin: "#E8B58E", hair: "#5A4630", hairStyle: "cap",
    layout: { eyeSep: 40, mouthY: 188 },
    brows: { color: "#4A3826", angle: -0.06, thick: 8 },
    eyes: { iris: "#4E6E4A" },
    mouth: { style: "grin" },
    facialHair: { style: "shortbeard", color: "#5C4A38" },
    cheeks: true,
  },
  bukele: {
    // backward navy cap · dark trim beard ringing the mouth (mustache under
    // the nose, chin strap below the lip) · olive skin · no glasses
    skin: "#C48E5E", hair: "#14110E", hairStyle: "backcap",
    brows: { color: "#14110E", angle: -0.08, thick: 8 },
    eyes: { iris: "#2A1E16" },
    mouth: { style: "grin" },
    facialHair: { style: "trimbeard", color: "#1A1612" },
  },
  schiff: {
    // final-boss menace, human edition: heavy scowl brows crowding the
    // eyes, amber squint, toothy snarl framed by a warm rust-gray full
    // beard. Big villain-king energy without borrowing trade dress.
    skin: "#E9BC96", hair: "#B4A88E", hairStyle: "balding",
    layout: { browY: 96, eyeY: 118, mouthY: 188 },
    brows: { color: "#7A6A52", angle: -0.32, thick: 13, bushy: true },
    eyes: { iris: "#C9812A", squint: true },
    mouth: { style: "snarl" },
    facialHair: { style: "fullbeard", color: "#8F7C64" },
    detail: "lines",
  },
  dimon: {
    // short SILVER hair (full coverage, not balding) · clean-shaven · wry vault king
    skin: "#E6B490", hair: "#D0D2D6", hairStyle: "short",
    layout: { mouthY: 188 },
    brows: { color: "#9A9EA4", angle: -0.08, thick: 8 },
    eyes: { iris: "#5B7C9E" },
    mouth: { style: "wry" },
    facialHair: null,
    detail: "lines",
  },
  warren: {
    // blonde bob to the jaw · round glasses (signature) · stern hearing-room
    skin: "#EFC5A0", hair: "#F0E6C8", hairStyle: "bob",
    layout: { eyeSep: 36, mouthY: 190 },
    brows: { color: "#C4B48A", angle: -0.2, thick: 7 },
    eyes: { iris: "#5E7C9C", glasses: "round" },
    mouth: { style: "stern" },
    facialHair: null,
    detail: "lines",
  },
  buffett: {
    // bald crown + white sides · big square glasses · jovial grandpa smile
    skin: "#EFC0A2", hair: "#F0EDE6", hairStyle: "balding",
    layout: { eyeY: 114, mouthY: 184 },
    brows: { color: "#E0DBD0", angle: -0.14, thick: 11, bushy: true },
    eyes: { iris: "#6E8CA8", glasses: "square" },
    mouth: { style: "bigsmile" },
    facialHair: null,
    detail: "lines",
    cheeks: true,
  },
  cuban: {
    // dark shortback · LIGHT cheek stubble (a wash, not a beard) · strong
    // straight brows set wide · smirk shark
    skin: "#E2AE87", hair: "#2A2622", hairStyle: "shortback",
    layout: { eyeSep: 42 },
    brows: { color: "#2A2622", angle: 0.04, thick: 9 },
    eyes: { iris: "#3A4E62" },
    mouth: { style: "smirk" },
    facialHair: { style: "stubble", color: "#3A342E" },
  },
};

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// memoized: a face is painted once per session (the title-screen prewarm
// walks the roster so the first race never hitches on 8 canvas paints)
const FACE_CACHE = {};
export function paintFace(id, mood) {
  const key = mood ? id + "·" + mood : id;
  if (!FACE_CACHE[key]) FACE_CACHE[key] = paintFaceUncached(id, mood);
  return FACE_CACHE[key];
}

// mood variants (podium emotions · 2026-07-16): brow angle + mouth style
// are the whole emotional register at caricature scale. Painted lazily,
// cached like the neutral face; never swapped mid-race (mobile texture
// uploads · operator call).
function moodSpec(s, mood) {
  if (!s || !mood) return s;
  if (mood === "grin") {
    return { ...s, brows: { ...s.brows, angle: 0.14 }, eyes: { ...s.eyes, squint: false }, mouth: { style: "bigsmile" } };
  }
  if (mood === "rage") {
    return { ...s, brows: { ...s.brows, angle: -0.5, thick: s.brows.thick + 3 }, eyes: { ...s.eyes, squint: true }, mouth: { style: "snarl" } };
  }
  if (mood === "sad") {
    return { ...s, brows: { ...s.brows, angle: 0.32 }, mouth: { style: "frown" } };
  }
  return s;
}

function paintFaceUncached(id, mood) {
  const s = moodSpec(FACE_SPECS[id], mood);
  const cv = document.createElement("canvas");
  // 2x backing store: every draw below stays in 512x256 logical space,
  // the texture just samples twice as sharp (select screen + podium
  // hold the head at near-texel scale)
  cv.width = W * 2; cv.height = H * 2;
  const ctx = cv.getContext("2d");
  ctx.scale(2, 2);
  if (!s) { ctx.fillStyle = "#C9A227"; ctx.fillRect(0, 0, W, H); return cv; }

  // skin base + soft under-chin shading. Kept BELOW the mouth line and
  // gentle: the 3D scene light already darkens the head's lower facets,
  // so a heavy canvas gradient here turns the whole mouth zone to mud
  // on the select-screen close-up.
  ctx.fillStyle = s.skin;
  ctx.fillRect(0, 0, W, H);
  const jaw = ctx.createLinearGradient(0, 204, 0, 256);
  jaw.addColorStop(0, "rgba(0,0,0,0)");
  jaw.addColorStop(1, "rgba(70,40,20,0.18)");
  ctx.fillStyle = jaw;
  ctx.fillRect(0, 200, W, 56);
  // baked fill-light across the mouth band: the head's lower facets face
  // the dark hemi ground in-scene, so the renderer dims everything below
  // the nose · pre-lightening the band keeps mouths + facial hair legible
  // on the select close-up (painted before features, so contrast holds)
  const lift = ctx.createLinearGradient(0, 150, 0, 232);
  lift.addColorStop(0, "rgba(255,236,214,0)");
  lift.addColorStop(0.55, "rgba(255,236,214,0.22)");
  lift.addColorStop(1, "rgba(255,236,214,0)");
  ctx.fillStyle = lift;
  ctx.fillRect(0, 150, W, 82);

  // ------- hair wrap (back + sides + top) -------
  const hc = s.hair;
  ctx.fillStyle = hc;
  const style = s.hairStyle;
  const sideHairTo = { sweptback: 150, short: 138, shortback: 142, sides: 160, balding: 150, bob: 196, cap: 120, backcap: 132 }[style] || 140;
  // back of the head (texture edges wrap behind)
  ctx.fillRect(0, 0, FACE_L - 26, sideHairTo);
  ctx.fillRect(FACE_R + 26, 0, W - FACE_R - 26, sideHairTo);
  if (style !== "balding" && style !== "sides") {
    // top band + fringe over the forehead
    const fringe = { sweptback: 66, short: 74, shortback: 70, bob: 84, cap: 60, backcap: 64 }[style] || 72;
    ctx.fillRect(0, 0, W, fringe);
    if (style === "sweptback") {
      // widow's-peak sweep
      ctx.beginPath();
      ctx.moveTo(176, 66); ctx.quadraticCurveTo(256, 92, 336, 66);
      ctx.lineTo(336, 40); ctx.lineTo(176, 40);
      ctx.closePath(); ctx.fill();
    } else if (style === "bob") {
      ctx.beginPath();
      ctx.moveTo(168, 84); ctx.quadraticCurveTo(256, 104, 344, 84);
      ctx.lineTo(344, 50); ctx.lineTo(168, 50);
      ctx.closePath(); ctx.fill();
    }
  } else {
    // balding crown: skin on top, hair only above the ears
    ctx.fillRect(0, 96, FACE_L - 10, sideHairTo - 96);
    ctx.fillRect(FACE_R + 10, 96, W - FACE_R - 10, sideHairTo - 96);
    ctx.fillRect(0, 0, 60, 110);
    ctx.fillRect(W - 60, 0, 60, 110);
  }

  // per-driver feature layout (see the FACE COORDINATE SYSTEM map up top)
  const L = { ...LAYOUT, ...(s.layout || {}) };
  const by = L.browY, ey = L.eyeY, sep = L.eyeSep, my = L.mouthY;

  // ------- brows -------
  ctx.strokeStyle = s.brows.color;
  ctx.lineWidth = s.brows.thick;
  ctx.lineCap = "round";
  for (const dir of [-1, 1]) {
    const cx = 256 + dir * sep;
    ctx.beginPath();
    ctx.moveTo(cx - dir * 22, by + s.brows.angle * -32 * 1);
    ctx.lineTo(cx + dir * 20, by + s.brows.angle * 32);
    ctx.stroke();
    if (s.brows.bushy) {
      ctx.lineWidth = s.brows.thick * 0.6;
      ctx.beginPath();
      ctx.moveTo(cx - dir * 20, by - 7 + s.brows.angle * -30);
      ctx.lineTo(cx + dir * 22, by - 5 + s.brows.angle * 30);
      ctx.stroke();
      ctx.lineWidth = s.brows.thick;
    }
  }

  // ------- eyes -------
  for (const dir of [-1, 1]) {
    const cx = 256 + dir * sep;
    ctx.fillStyle = "#F7F4EE";
    ctx.beginPath();
    ctx.ellipse(cx, ey, 17, s.eyes.squint ? 7.5 : 10.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s.eyes.iris;
    ctx.beginPath();
    ctx.arc(cx + dir * 1.5, ey + 1, 6.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#14110E";
    ctx.beginPath();
    ctx.arc(cx + dir * 1.5, ey + 1, 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(cx - 2 + dir * 1.5, ey - 1.6, 1.4, 0, Math.PI * 2);
    ctx.fill();
    // upper lid
    ctx.strokeStyle = "rgba(60,35,20,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, ey - 1, 17, s.eyes.squint ? 8 : 11, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }

  // ------- mood accents -------
  if (mood === "sad") {
    // one tear track: reads as despair even at chase-cam distance
    ctx.fillStyle = "rgba(120,180,235,0.85)";
    ctx.beginPath();
    ctx.ellipse(256 - sep, ey + 22, 3.2, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(256 - sep, ey + 34, 2.2, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (mood === "rage") {
    // hot flush across the cheekbones
    ctx.fillStyle = "rgba(200,60,40,0.22)";
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(256 + dir * (sep + 8), ey + 34, 22, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ------- nose hint -------
  const noseY = ey + 40; // nostril line · the mustache band starts below it
  ctx.strokeStyle = "rgba(90,50,25,0.4)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(252, ey + 16);
  ctx.quadraticCurveTo(248, noseY - 8, 244, noseY - 4);
  ctx.stroke();
  ctx.fillStyle = "rgba(90,50,25,0.35)";
  for (const dx of [-7, 7]) {
    ctx.beginPath();
    ctx.ellipse(256 + dx, noseY, 3.4, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ------- cheek + bone accents -------
  if (s.cheeks) {
    // warm cheek apples: jovial / youthful read (buffett, mallers, wizard)
    ctx.fillStyle = "rgba(200,110,70,0.16)";
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(256 + dir * (sep + 14), ey + 34, 20, 13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (s.detail === "sharp") {
    // gaunt cheekbone sweep: two short diagonal shades under the eyes
    ctx.strokeStyle = "rgba(90,50,25,0.22)";
    ctx.lineWidth = 7;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(256 + dir * (sep + 20), ey + 22);
      ctx.quadraticCurveTo(256 + dir * (sep + 8), ey + 34, 256 + dir * (sep - 4), ey + 38);
      ctx.stroke();
    }
  }

  // ------- age lines -------
  if (s.detail === "lines") {
    ctx.strokeStyle = "rgba(90,50,25,0.3)";
    ctx.lineWidth = 2.5;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(256 + dir * 16, noseY + 12);
      ctx.quadraticCurveTo(256 + dir * 30, noseY + 20, 256 + dir * 30, my - 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(226, 74); ctx.quadraticCurveTo(256, 68, 286, 74);
    ctx.stroke();
  }

  // ------- facial hair (painted BEFORE the mouth so lips read on top) -------
  // Anatomy contract: a mustache lives in the philtrum band resting on the
  // top lip; beard mass starts at the chin line BELOW the lower lip and only
  // climbs back up along the CHEEK EDGES toward the sideburns. Everything
  // under the jaw fills to the canvas bottom (which wraps beneath the chin
  // on the head sphere) · never a stroke across the mid-face.
  const fh = s.facialHair;
  if (fh) {
    const chinTopY = my + 12; // beard's chin edge: clear of the lower lip
    // closed beard region: sideburn → cheek edge → under-lip chin → mirror,
    // then square down to the canvas bottom (wraps under the chin)
    const beardRegion = (cheekY, chinY, spread) => {
      ctx.beginPath();
      ctx.moveTo(FACE_L - spread, cheekY);
      ctx.quadraticCurveTo(FACE_L + 34, cheekY + 12, 234, chinY);
      ctx.quadraticCurveTo(256, chinY + 8, 278, chinY);
      ctx.quadraticCurveTo(FACE_R - 34, cheekY + 12, FACE_R + spread, cheekY);
      ctx.lineTo(FACE_R + spread, H);
      ctx.lineTo(FACE_L - spread, H);
      ctx.closePath();
    };
    // two drooping lobes meeting at the philtrum, resting on the top lip
    const mustache = (wHalf, thick) => {
      ctx.strokeStyle = fh.color;
      ctx.lineWidth = thick;
      ctx.lineCap = "round";
      const mo = my - 8 - thick / 2;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(256 + dir * 2, mo);
        ctx.quadraticCurveTo(256 + dir * 20, mo - 3, 256 + dir * wHalf, mo + 7);
        ctx.stroke();
      }
    };
    if (fh.style === "stubble") {
      // low-alpha wash + deterministic speckle grain, clipped to the jaw
      ctx.save();
      beardRegion(164, chinTopY + 2, 8);
      ctx.clip();
      ctx.fillStyle = fh.color;
      ctx.globalAlpha = fh.goatee ? 0.18 : 0.24;
      ctx.fillRect(FACE_L - 10, 150, FACE_R - FACE_L + 20, H - 150);
      let seed = 41; // fixed seed: no Math.random, faces stay cache-stable
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483647) / 2147483647;
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 110; i++) {
        const x = FACE_L - 6 + rnd() * (FACE_R - FACE_L + 12);
        const y = 160 + rnd() * (H - 160);
        ctx.fillRect(x, y, 2.4, 2.4);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      if (fh.goatee) {
        // silver goatee emphasis (saylor): tight chin patch clearly under
        // the mouth + a light mustache over the lip. Kept small so the
        // smirk still reads between them on the 3D close-up.
        ctx.fillStyle = fh.color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.ellipse(256, chinTopY + 20, 28, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.45;
        mustache(28, 10);
        ctx.globalAlpha = 1;
      }
    } else if (fh.style === "trimbeard") {
      // crisp goatee ring: tight jaw fill + mustache + strap connectors
      // running around the mouth corners (bukele)
      ctx.fillStyle = fh.color;
      beardRegion(162, chinTopY, 4);
      ctx.fill();
      mustache(32, 12);
      ctx.lineWidth = 9;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(256 + dir * 32, my - 3);
        ctx.quadraticCurveTo(256 + dir * 36, my + 6, 256 + dir * 27, chinTopY + 4);
        ctx.stroke();
      }
    } else if (fh.style === "shortbeard") {
      // young full-coverage short beard on the jaw + mustache (mallers)
      ctx.fillStyle = fh.color;
      beardRegion(158, chinTopY, 8);
      ctx.fill();
      mustache(34, 13);
    } else { // fullbeard: big coverage high on the cheeks + heavy mustache
      ctx.fillStyle = fh.color;
      beardRegion(146, chinTopY - 2, 14);
      ctx.fill();
      // crisp top-edge shadow so the beard separates from the skin even
      // under the scene light (beard vs skin luminance runs close) ·
      // stroke ONLY the cheek-to-chin curve, never the wrap seams
      ctx.strokeStyle = "rgba(50,38,26,0.5)";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(FACE_L - 14, 146);
      ctx.quadraticCurveTo(FACE_L + 34, 158, 234, chinTopY - 2);
      ctx.quadraticCurveTo(256, chinTopY + 6, 278, chinTopY - 2);
      ctx.quadraticCurveTo(FACE_R - 34, 158, FACE_R + 14, 146);
      ctx.stroke();
      // darker strand sweeps give the mass depth at close-up
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      for (const dx of [-52, -26, 0, 26, 52]) {
        ctx.beginPath();
        ctx.moveTo(256 + dx * 1.15, chinTopY + 10);
        ctx.quadraticCurveTo(256 + dx * 1.25, chinTopY + 26, 256 + dx, H - 6);
        ctx.stroke();
      }
      mustache(40, 15);
    }
  }

  // ------- mouth -------
  ctx.strokeStyle = "#7A3B2E";
  ctx.fillStyle = "#7A3B2E";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  const m = s.mouth.style;
  ctx.beginPath();
  if (m === "smile") {
    ctx.moveTo(226, my); ctx.quadraticCurveTo(256, my + 16, 286, my); ctx.stroke();
  } else if (m === "bigsmile" || m === "grin") {
    ctx.moveTo(222, my - 2); ctx.quadraticCurveTo(256, my + 22, 290, my - 2);
    ctx.quadraticCurveTo(256, my + 34, 222, my - 2);
    ctx.fill();
    ctx.fillStyle = "#F7F4EE";
    ctx.beginPath();
    ctx.moveTo(228, my + 1); ctx.quadraticCurveTo(256, my + 12, 284, my + 1);
    ctx.quadraticCurveTo(256, my + 15, 228, my + 1);
    ctx.fill();
  } else if (m === "smirk") {
    ctx.moveTo(228, my + 4); ctx.quadraticCurveTo(262, my + 10, 288, my - 6); ctx.stroke();
  } else if (m === "wry") {
    ctx.moveTo(230, my + 2); ctx.quadraticCurveTo(260, my + 8, 284, my - 2); ctx.stroke();
  } else if (m === "frown") {
    ctx.moveTo(228, my + 8); ctx.quadraticCurveTo(256, my - 8, 284, my + 8); ctx.stroke();
  } else if (m === "snarl") {
    // open downturned snarl: dark mouth, jagged teeth, longer corner fangs
    ctx.fillStyle = "#4E241C";
    ctx.beginPath();
    ctx.moveTo(222, my + 9);
    ctx.quadraticCurveTo(256, my - 12, 290, my + 9);
    ctx.quadraticCurveTo(256, my + 20, 222, my + 9);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#F2EEE2";
    for (let i = 0; i < 6; i++) {
      const x0 = 228 + i * 10.5;
      const topY = my + 4 - (2.5 - Math.abs(i - 2.5)) * 3.4;
      const len = (i === 0 || i === 5) ? 13 : 8; // corner fangs run longer
      ctx.beginPath();
      ctx.moveTo(x0, topY);
      ctx.lineTo(x0 + 9, topY);
      ctx.lineTo(x0 + 4.5, topY + len);
      ctx.closePath(); ctx.fill();
    }
  } else if (m === "stern") {
    ctx.moveTo(230, my + 2); ctx.lineTo(282, my + 2); ctx.stroke();
  } else {
    ctx.moveTo(232, my); ctx.quadraticCurveTo(256, my + 8, 280, my); ctx.stroke();
  }

  // ------- glasses (over everything) -------
  const g = s.eyes.glasses;
  if (g) {
    ctx.strokeStyle = g === "square" ? "#2E2A26" : "#6E6A62";
    ctx.lineWidth = g === "thin" ? 4 : 6;
    for (const dir of [-1, 1]) {
      const cx = 256 + dir * sep;
      if (g === "round") {
        ctx.beginPath(); ctx.arc(cx, ey + 1, 24, 0, Math.PI * 2); ctx.stroke();
      } else {
        rr(ctx, cx - 26, ey - (g === "thin" ? 14 : 20), 52, g === "thin" ? 28 : 42, 8);
        ctx.stroke();
      }
    }
    // bridge + temples to the hairline
    ctx.beginPath(); ctx.moveTo(256 - 13, ey); ctx.lineTo(256 + 13, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(256 - 64, ey); ctx.lineTo(FACE_L - 10, ey - 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(256 + 64, ey); ctx.lineTo(FACE_R + 10, ey - 6); ctx.stroke();
  }

  return cv;
}
