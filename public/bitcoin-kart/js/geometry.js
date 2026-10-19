// BITCOIN KART · geometry.js
// Procedural low-poly mesh builders. Everything is vertex-colored and
// flat-shaded (verts duplicated per face) for the N64 toy look.
// Kart local space: +Z forward, +X right, Y up, ground at y=0.

import { TAU, hash01 } from "./math3d.js";
import { FACE_SPECS } from "./faces.js";

export function hex(h) {
  // "#F7931A" -> [r,g,b] in 0..1
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function shade(c, f) {
  return [Math.min(c[0] * f, 1), Math.min(c[1] * f, 1), Math.min(c[2] * f, 1)];
}

export function meshBuilder() {
  const pos = [], norm = [], col = [], idx = [];

  function pushTri(a, b, c, color, alpha) {
    // flat normal
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const base = pos.length / 3;
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      norm.push(nx, ny, nz);
      col.push(color[0], color[1], color[2], alpha === undefined ? 1 : alpha);
    }
    idx.push(base, base + 1, base + 2);
  }

  function quad(a, b, c, d, color, alpha) {
    pushTri(a, b, c, color, alpha);
    pushTri(a, c, d, color, alpha);
  }

  // Quad with a full RGBA per corner (SHINE water: the foam field rides
  // the color channel) · flat normal from the corners (was hardcoded +Y,
  // which lit sloped terrain cells as if they were horizontal), two tris,
  // shared-corner colors interpolate across the cell.
  function quad4(a, b, c, d, ca, cb, cc, cd) {
    const base = pos.length / 3;
    const pts = [a, b, c, d], cs = [ca, cb, cc, cd];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let i = 0; i < 4; i++) {
      pos.push(pts[i][0], pts[i][1], pts[i][2]);
      norm.push(nx, ny, nz);
      col.push(cs[i][0], cs[i][1], cs[i][2], cs[i][3]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Triangle with per-vertex normals: smooth-shaded organic surfaces
  // (heads, hair, ears) · flat facets are the Minecraft tell.
  function pushTriN(a, b, c, na, nb, nc, color, alpha) {
    const base = pos.length / 3;
    const pts = [a, b, c], ns = [na, nb, nc];
    for (let i = 0; i < 3; i++) {
      pos.push(pts[i][0], pts[i][1], pts[i][2]);
      norm.push(ns[i][0], ns[i][1], ns[i][2]);
      col.push(color[0], color[1], color[2], alpha === undefined ? 1 : alpha);
    }
    idx.push(base, base + 1, base + 2);
  }

  // Axis-aligned box centered at (cx,cy,cz). faces: optional per-face color
  // override {px,nx,py,ny,pz,nz}.
  function box(cx, cy, cz, w, h, d, color, opts) {
    const o = opts || {};
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const y0 = cy - h / 2, y1 = cy + h / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    const f = o.faces || {};
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], f.px || color, o.alpha);
    quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], f.nx || color, o.alpha);
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], f.py || color, o.alpha);
    quad([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], f.ny || color, o.alpha);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], f.pz || color, o.alpha);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], f.nz || color, o.alpha);
  }

  // Wedge: box whose top face slopes down toward +Z (nose cones, ramps).
  function wedge(cx, cy, cz, w, h, d, color, flip) {
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const y0 = cy - h / 2, y1 = cy + h / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    const zh = flip ? z0 : z1; // low edge
    const zt = flip ? z1 : z0; // tall edge
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color); // bottom (down)
    // slope
    quad([x0, y1, zt], [x1, y1, zt], [x1, y0, zh], [x0, y0, zh], flip ? shade(color, 1) : color);
    // tall back face
    if (flip) quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], shade(color, 0.85));
    else quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], shade(color, 0.85));
    // sides (triangles)
    if (flip) {
      pushTri([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], shade(color, 0.9));
      pushTri([x1, y0, z1], [x1, y0, z0], [x1, y1, z1], shade(color, 0.9));
    } else {
      pushTri([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], shade(color, 0.9));
      pushTri([x1, y0, z0], [x1, y0, z1], [x1, y1, z0], shade(color, 0.9));
    }
  }

  // Cylinder along Y. r0 bottom radius, r1 top radius (cone when r1=0).
  // opts.a0/a1 carve an arc (open helmets, wheel arches) · full TAU default.
  // WINDING: every triangle is emitted front-face OUTWARD (CCW seen from
  // outside) to match sphere/cylX/cylZ so cullFace(BACK) keeps the outer
  // surface. A `smooth` cyl supplies true outward cone normals, so the
  // winding MUST agree with them or the lit face gets culled and the
  // surface vanishes from outside (the wizard-hat / warren-bob / neck /
  // cloak bug, fixed 2026-07-19). Do NOT flip these back to a1->a0 order.
  function cyl(cx, cy, cz, r0, r1, h, seg, color, opts) {
    const o = opts || {};
    const y0 = cy, y1 = cy + h;
    const arc0 = o.a0 || 0, span = o.a1 === undefined ? TAU : o.a1 - arc0;
    for (let i = 0; i < seg; i++) {
      const a0 = arc0 + (i / seg) * span, a1 = arc0 + ((i + 1) / seg) * span;
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p00 = [cx + c0 * r0, y0, cz + s0 * r0];
      const p01 = [cx + c1 * r0, y0, cz + s1 * r0];
      const p10 = [cx + c0 * r1, y1, cz + s0 * r1];
      const p11 = [cx + c1 * r1, y1, cz + s1 * r1];
      if (o.smooth) {
        const sl = (r0 - r1) / Math.max(h, 0.0001); // cone slope tilts normals up
        const nl = Math.hypot(1, sl);
        const n0 = [c0 / nl, sl / nl, s0 / nl], n1 = [c1 / nl, sl / nl, s1 / nl];
        if (r1 > 0.0001) {
          pushTriN(p01, p10, p11, n1, n0, n1, color, o.alpha);
          pushTriN(p01, p00, p10, n1, n0, n0, color, o.alpha);
        } else pushTriN(p01, p00, [cx, y1, cz], n1, n0, [(c0 + c1) / 2, 0, (s0 + s1) / 2], color, o.alpha);
      } else if (r1 > 0.0001) quad(p00, p10, p11, p01, color, o.alpha);
      else pushTri(p01, p00, [cx, y1, cz], color, o.alpha);
      // caps inherit o.alpha so banded surfaces stay in their band (K19)
      if (o.capBot !== false && r0 > 0.0001) pushTri([cx, y0, cz], p00, p01, o.botColor || shade(color, 0.8), o.alpha);
      if (o.capTop !== false && r1 > 0.0001) pushTri([cx, y1, cz], p11, p10, o.topColor || shade(color, 1.1), o.alpha);
    }
  }

  // Cylinder along X axis (wheels, rollers).
  function cylX(cx, cy, cz, r, w, seg, color, opts) {
    const o = opts || {};
    const x0 = cx - w / 2, x1 = cx + w / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      const y0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r;
      const y1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
      quad(
        [x0, cy + y0, cz + z0], [x0, cy + y1, cz + z1],
        [x1, cy + y1, cz + z1], [x1, cy + y0, cz + z0],
        color, o.alpha,
      );
      // caps inherit o.alpha so a banded tire's face stays in its band (K19)
      pushTri([x0, cy, cz], [x0, cy + y1, cz + z1], [x0, cy + y0, cz + z0], o.capColor || shade(color, 0.75), o.alpha);
      pushTri([x1, cy, cz], [x1, cy + y0, cz + z0], [x1, cy + y1, cz + z1], o.capColor || shade(color, 0.75), o.alpha);
    }
  }

  // UV sphere (heads, balloons). Flat facets by default; opts.smooth
  // emits per-vertex ellipsoid normals for the organic look.
  function sphere(cx, cy, cz, r, segLat, segLon, color, opts) {
    const o = opts || {};
    const sy = o.squashY || 1, sz = o.squashZ || 1;
    const pt = (la, lo) => {
      const phi = (la / segLat) * Math.PI;
      const th = (lo / segLon) * TAU;
      return [
        cx + Math.sin(phi) * Math.cos(th) * r,
        cy + Math.cos(phi) * r * sy,
        cz + Math.sin(phi) * Math.sin(th) * r * sz,
      ];
    };
    const nrm = (p) => {
      const n = [p[0] - cx, (p[1] - cy) / (sy * sy), (p[2] - cz) / (sz * sz)];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      return [n[0] / l, n[1] / l, n[2] / l];
    };
    for (let la = 0; la < segLat; la++) {
      for (let lo = 0; lo < segLon; lo++) {
        const a = pt(la, lo), b = pt(la + 1, lo), c = pt(la + 1, lo + 1), d = pt(la, lo + 1);
        if (o.smooth) {
          const na = nrm(a), nb = nrm(b), nc = nrm(c), nd = nrm(d);
          if (la > 0) pushTriN(a, d, b, na, nd, nb, color, o.alpha);
          if (la < segLat - 1) pushTriN(b, d, c, nb, nd, nc, color, o.alpha);
        } else {
          if (la > 0) pushTri(a, d, b, color, o.alpha);
          if (la < segLat - 1) pushTri(b, d, c, color, o.alpha);
        }
      }
    }
  }

  // Octahedron (item blocks, gems).
  function octa(cx, cy, cz, r, color, alpha) {
    const t = [cx, cy + r, cz], b = [cx, cy - r, cz];
    const ring = [
      [cx + r, cy, cz], [cx, cy, cz + r], [cx - r, cy, cz], [cx, cy, cz - r],
    ];
    for (let i = 0; i < 4; i++) {
      const p = ring[i], q = ring[(i + 1) % 4];
      pushTri(t, q, p, color, alpha);
      pushTri(b, p, q, shade(color, 0.85), alpha);
    }
  }

  function build() {
    return {
      pos: new Float32Array(pos),
      norm: new Float32Array(norm),
      col: new Float32Array(col),
      idx: idx,
    };
  }

  return { pushTri, pushTriN, quad, quad4, box, wedge, cyl, cylX, sphere, octa, build, raw: { pos, norm, col, idx } };
}

// UV sphere with flat-shaded facets for the textured caricature heads.
// u wraps around Y with u=0.5 facing +Z (forward); v runs top to bottom.
export function sphereUV(r, segLat, segLon) {
  const pos = [], norm = [], uv = [], idx = [];
  const pt = (la, lo) => {
    const phi = (la / segLat) * Math.PI;
    const th = ((lo / segLon) - 0.5) * TAU;
    return [Math.sin(phi) * Math.sin(th) * r, Math.cos(phi) * r, Math.sin(phi) * Math.cos(th) * r];
  };
  const push = (p, n, u, v) => {
    pos.push(p[0], p[1], p[2]);
    norm.push(n[0], n[1], n[2]);
    uv.push(u, v);
  };
  for (let la = 0; la < segLat; la++) {
    for (let lo = 0; lo < segLon; lo++) {
      const a = pt(la, lo), b = pt(la + 1, lo), c = pt(la + 1, lo + 1), d = pt(la, lo + 1);
      // per-vertex normals: the head shades as a smooth ball, not facets
      const N = (p) => [p[0] / r, p[1] / r, p[2] / r];
      const base = pos.length / 3;
      push(a, N(a), lo / segLon, la / segLat);
      push(b, N(b), lo / segLon, (la + 1) / segLat);
      push(c, N(c), (lo + 1) / segLon, (la + 1) / segLat);
      push(d, N(d), (lo + 1) / segLon, la / segLat);
      if (la > 0) idx.push(base, base + 3, base + 1);
      if (la < segLat - 1) idx.push(base + 1, base + 3, base + 2);
    }
  }
  return { pos: new Float32Array(pos), norm: new Float32Array(norm), uv: new Float32Array(uv), idx };
}

// head anchor in kart space: MK proportions, head nearly torso-sized and
// fully visible above the low seatback
const HEAD = { y: 1.5, z: -0.32, r: 0.37 };

// ---------------------------------------------------------------------------
// KART BUILDER · one distinct machine per driver.
// Returns { body, wheel, head } · wheels spin, the head is a UV-textured
// caricature sphere drawn by the consumer with paintFace()'s canvas.
// ---------------------------------------------------------------------------

const C = {
  black: hex("#17171B"),
  darkMetal: hex("#2A2A31"),
  metal: hex("#8E8E98"),
  chrome: hex("#C8C9D2"),
  orange: hex("#F7931A"),
  orangeDeep: hex("#D97706"),
  gold: hex("#F5C542"),
  goldDeep: hex("#C99A1E"),
  white: hex("#F5F5F7"),
  red: hex("#E5484D"),
  navy: hex("#1E3A5F"),
  blue: hex("#3B82F6"),
  cyan: hex("#22D3EE"),
  indigo: hex("#4338CA"),
  green: hex("#4ADE80"),
  skin1: hex("#E8B08C"),
  skin2: hex("#C98850"),
  skin3: hex("#8C5A33"),
  brown: hex("#6B4226"),
  gray: hex("#6E6E76"),
  cream: hex("#EFE6D0"),
  maroon: hex("#7C2D3E"),
  wood: hex("#8A5A2B"),
  jersey: hex("#0A66C2"),
  ghost: hex("#B9BDD3"),
};

// K19 vColor.a material bands, decoded by MAIN_FS on OPAQUE draws only
// (draw-level uAlpha > 0.9995): 0.65 = matte (rubber, cloth, skin · spec
// and sheen killed), 0.86 = glass (boosted spec + sky fresnel edge).
// Anything outside the 0.6-0.7 / 0.84-0.92 bands keeps paint semantics ·
// authoring an alpha INSIDE a band opts that surface in. Translucent draw
// paths (ghost karts at 0.32) multiply vertex alpha into frag alpha, so
// banded surfaces just read slightly softer on ghosts · acceptable.
const A_MATTE = 0.65, A_GLASS = 0.86;

// ---------------------------------------------------------------------------
// SHAPE HELPERS · standalone (builder is the first arg) so meshBuilder stays
// a primitive kit. Tapered frustums, hull lofts and Z-drums are the
// vocabulary that separates designed bodywork from stacked debug boxes.
// ---------------------------------------------------------------------------

// Vertical loft between two rectangles: bottom w0 x d0 at y0, top w1 x d1
// at y0+h, the top optionally shifted (dx, dz) for leaning masses, cowls
// and fenders. Face color overrides mirror box()'s.
function frustum(m, cx, y0, cz, w0, d0, w1, d1, h, color, opts) {
  const o = opts || {};
  const y1 = y0 + h, dx = o.dx || 0, dz = o.dz || 0;
  const bx0 = cx - w0 / 2, bx1 = cx + w0 / 2, bz0 = cz - d0 / 2, bz1 = cz + d0 / 2;
  const tx0 = cx + dx - w1 / 2, tx1 = cx + dx + w1 / 2;
  const tz0 = cz + dz - d1 / 2, tz1 = cz + dz + d1 / 2;
  const f = o.faces || {};
  m.quad([bx1, y0, bz0], [tx1, y1, tz0], [tx1, y1, tz1], [bx1, y0, bz1], f.px || color, o.alpha);
  m.quad([bx0, y0, bz1], [tx0, y1, tz1], [tx0, y1, tz0], [bx0, y0, bz0], f.nx || color, o.alpha);
  if (o.capTop !== false) m.quad([tx0, y1, tz0], [tx0, y1, tz1], [tx1, y1, tz1], [tx1, y1, tz0], f.py || color, o.alpha);
  if (o.capBot !== false) m.quad([bx0, y0, bz1], [bx0, y0, bz0], [bx1, y0, bz0], [bx1, y0, bz1], f.ny || shade(color, 0.8), o.alpha);
  m.quad([bx0, y0, bz1], [bx1, y0, bz1], [tx1, y1, tz1], [tx0, y1, tz1], f.pz || color, o.alpha);
  m.quad([bx1, y0, bz0], [bx0, y0, bz0], [tx0, y1, tz0], [tx1, y1, tz0], f.nz || shade(color, 0.9), o.alpha);
}

// Hull loft along Z: ribs {z, y, w, h, c?} ordered tail to nose (ascending
// z). Walls and belly shade slightly darker than the deck so the volume
// reads under flat lighting; per-rib colors allow two-tone hulls.
function loft(m, ribs, color, opts) {
  const o = opts || {};
  const R = (s) => {
    const x = s.w / 2, lo = s.y - s.h / 2, hi = s.y + s.h / 2;
    return { lb: [-x, lo, s.z], rb: [x, lo, s.z], rt: [x, hi, s.z], lt: [-x, hi, s.z] };
  };
  for (let i = 0; i < ribs.length - 1; i++) {
    const a = R(ribs[i]), b = R(ribs[i + 1]);
    const c = ribs[i + 1].c || ribs[i].c || color;
    m.quad(a.rb, a.rt, b.rt, b.rb, shade(c, 0.94), o.alpha); // right wall
    m.quad(b.lb, b.lt, a.lt, a.lb, shade(c, 0.94), o.alpha); // left wall
    m.quad(a.lt, b.lt, b.rt, a.rt, c, o.alpha); // deck
    m.quad(b.lb, a.lb, a.rb, b.rb, shade(c, 0.78), o.alpha); // belly
  }
  const nose = R(ribs[ribs.length - 1]), tail = R(ribs[0]);
  if (o.capFront !== false) m.quad(nose.lb, nose.rb, nose.rt, nose.lt, shade(ribs[ribs.length - 1].c || color, 1.05), o.alpha);
  if (o.capBack !== false) m.quad(tail.rb, tail.lb, tail.lt, tail.rt, shade(ribs[0].c || color, 0.85), o.alpha);
}

// Drum along Z (boosters, vault doors, soda cans).
function cylZ(m, cx, cy, cz, r, d, seg, color, opts) {
  const o = opts || {};
  const z0 = cz - d / 2, z1 = cz + d / 2;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
    const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r;
    const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
    if (o.smooth) {
      const n0 = [Math.cos(a0), Math.sin(a0), 0], n1 = [Math.cos(a1), Math.sin(a1), 0];
      m.pushTriN([cx + x0, cy + y0, z0], [cx + x1, cy + y1, z0], [cx + x1, cy + y1, z1], n0, n1, n1, color, o.alpha);
      m.pushTriN([cx + x0, cy + y0, z0], [cx + x1, cy + y1, z1], [cx + x0, cy + y0, z1], n0, n1, n0, color, o.alpha);
    } else m.quad([cx + x0, cy + y0, z0], [cx + x1, cy + y1, z0], [cx + x1, cy + y1, z1], [cx + x0, cy + y0, z1], color, o.alpha);
    // caps inherit o.alpha so banded surfaces stay in their band (K19)
    m.pushTri([cx, cy, z1], [cx + x0, cy + y0, z1], [cx + x1, cy + y1, z1], o.capColor || shade(color, 1.08), o.alpha);
    m.pushTri([cx, cy, z0], [cx + x1, cy + y1, z0], [cx + x0, cy + y0, z0], o.capColor || shade(color, 0.8), o.alpha);
  }
}

// Double-sided triangle (fins, capes, blades, lapels).
function fin(m, a, b, c, color) {
  m.pushTri(a, b, c, color);
  m.pushTri(a, c, b, shade(color, 0.88));
}

// Partial sphere shell: lat band [lat0..lat1] (radians from the top pole),
// optional arc [a0..a1] around Y (th 90deg faces +Z, the face). THE fitted
// headwear tool: crowns, nape wraps, horseshoes, cap shells all hug the
// skull instead of floating as slabs.
function dome(m, cx, cy, cz, r, lat0, lat1, segLat, segLon, color, opts) {
  const o = opts || {};
  const sy = o.squashY || 1;
  const a0 = o.a0 === undefined ? 0 : o.a0;
  const span = o.a1 === undefined ? TAU : o.a1 - a0;
  const pt = (la, lo) => {
    const phi = lat0 + (la / segLat) * (lat1 - lat0);
    const th = a0 + (lo / segLon) * span;
    return [cx + Math.sin(phi) * Math.cos(th) * r, cy + Math.cos(phi) * r * sy, cz + Math.sin(phi) * Math.sin(th) * r];
  };
  const nrm = (p) => {
    const n = [p[0] - cx, (p[1] - cy) / (sy * sy), p[2] - cz];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  };
  for (let la = 0; la < segLat; la++) {
    for (let lo = 0; lo < segLon; lo++) {
      const a = pt(la, lo), b = pt(la + 1, lo), c = pt(la + 1, lo + 1), d = pt(la, lo + 1);
      const na = nrm(a), nb = nrm(b), nc = nrm(c), nd = nrm(d);
      if (la > 0 || lat0 > 0.01) m.pushTriN(a, d, b, na, nd, nb, color, o.alpha);
      m.pushTriN(b, d, c, nb, nd, nc, color, o.alpha);
    }
  }
}

// Annular brim sector (cap bills, visors): double-sided, the outer edge
// drops so the bill reads pressed and curved, never a flat plank.
function brimArc(m, cx, cy, cz, r0, r1, a0, a1, seg, drop, color) {
  for (let i = 0; i < seg; i++) {
    const t0 = a0 + (i / seg) * (a1 - a0), t1 = a0 + ((i + 1) / seg) * (a1 - a0);
    const p = (th, rr, dy) => [cx + Math.cos(th) * rr, cy + dy, cz + Math.sin(th) * rr];
    const q = [p(t0, r0, 0), p(t1, r0, 0), p(t1, r1, -drop), p(t0, r1, -drop)];
    m.quad(q[0], q[1], q[2], q[3], color);
    m.quad(q[3], q[2], q[1], q[0], shade(color, 0.72));
  }
}

// Raked, bowed windscreen: bottom wide+forward, top narrower+pulled back,
// each horizontal rib bows forward at centre via u*u. Smooth normals from
// finite-diff of P so glass fresnel/sheen sweep instead of stepping.
// Fixed 7x3 grid, double-sided (84 tris). The screen is double-sided
// because the chase camera and the select turntable both see it from
// behind, and a single-sided sheet would cull to nothing there.
// opts: halfW0, halfW1, h, rake, bow, color.
// Caller must keep the top edge under y 1.10: glass is opaque on this path
// (K19 band is a material mask, not coverage) and the driver skull bottom
// sits ~1.13, so a taller screen would erase the face.
function raceScreen(m, cx, y0, cz, opts) {
  const o = opts || {};
  const halfW0 = o.halfW0 === undefined ? 0.4 : o.halfW0;
  const halfW1 = o.halfW1 === undefined ? 0.3 : o.halfW1;
  const h = o.h === undefined ? 0.4 : o.h;
  const rake = o.rake === undefined ? 0.28 : o.rake;
  const bow = o.bow === undefined ? 0.06 : o.bow;
  const color = o.color || hex("#7DE3FF");
  const inner = shade(color, 0.7); // glass from inside a shaded cockpit
  const su = 7, sv = 3;
  const P = (u, v) => {
    const hw = halfW0 + (halfW1 - halfW0) * v;
    return [cx + u * hw, y0 + v * h, cz - rake * v - bow * u * u];
  };
  const N = (u, v) => {
    const e = 0.02;
    const pu = P(u + e, v), mu = P(u - e, v);
    const pv = P(u, v + e), mv = P(u, v - e);
    const dux = pu[0] - mu[0], duy = pu[1] - mu[1], duz = pu[2] - mu[2];
    const dvx = pv[0] - mv[0], dvy = pv[1] - mv[1], dvz = pv[2] - mv[2];
    let nx = duy * dvz - duz * dvy, ny = duz * dvx - dux * dvz, nz = dux * dvy - duy * dvx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  const neg = (n) => [-n[0], -n[1], -n[2]];
  for (let j = 0; j < sv; j++) {
    for (let i = 0; i < su; i++) {
      const u0 = -1 + (2 * i) / su, u1 = -1 + (2 * (i + 1)) / su;
      const v0 = j / sv, v1 = (j + 1) / sv;
      const a = P(u0, v0), b = P(u1, v0), c = P(u1, v1), d = P(u0, v1);
      const na = N(u0, v0), nb = N(u1, v0), nc = N(u1, v1), nd = N(u0, v1);
      // outer face
      m.pushTriN(a, b, c, na, nb, nc, color, A_GLASS);
      m.pushTriN(a, c, d, na, nc, nd, color, A_GLASS);
      // inner face · reverse winding + negated normals (fin()-style)
      m.pushTriN(a, c, b, neg(na), neg(nc), neg(nb), inner, A_GLASS);
      m.pushTriN(a, d, c, neg(na), neg(nd), neg(nc), inner, A_GLASS);
    }
  }
}

// Steering wheel at the shared column anchor (0, 0.86, 0.44) · the pivot
// z 0.44 is hardcoded in race.js drawKart, so every chassis mounts here.
function steerWheel(sm, rimC, bossC) {
  sm.cyl(0, 0.86, 0.44, 0.19, 0.19, 0.06, 10, rimC, { capTop: true });
  sm.cyl(0, 0.865, 0.44, 0.06, 0.06, 0.06, 6, bossC, { capTop: true });
}

// ---------------------------------------------------------------------------
// WHEEL KITS · per-family construction, not per-driver paint. Width, rim
// architecture, studs and tread all vary; the contact radius stays 0.34
// so the shared WHEEL_POS anchors keep every kart planted.
// ---------------------------------------------------------------------------

const WHEEL_KITS = {
  saylor: { w: 0.3, rim: "stud", rimC: "#F7931A", studC: "#D97706" },
  phong: { w: 0.24, rim: "spoke", rimC: "#C8C9D2", hubC: "#F7931A" },
  wizard: { w: 0.26, rim: "octa", rimC: "#312E81", studC: "#F5C542", hubC: "#C99A1E" },
  mallers: { w: 0.2, rim: "mag", rimC: "#22D3EE", nub: "chunk" },
  bukele: { w: 0.36, rim: "classic", rimC: "#F5F5F7", tire: "#2A2A31", nub: "chunk", hubC: "#22D3EE" },
  satoshi: { w: 0.26, rim: "ring", rimC: "#2FBF6B", tire: "#101014", nub: "slick" },
  schiff: { w: 0.34, rim: "stud", rimC: "#F5C542", studC: "#F5C542", tire: "#241F1A", nub: "chunk" },
  dimon: { w: 0.3, rim: "disc", rimC: "#8E8E98" },
  warren: { w: 0.26, rim: "classic", rimC: "#8A5A2B", hubC: "#EFE6D0" },
  buffett: { w: 0.28, rim: "classic", rimC: "#E5484D", white: true, hubC: "#C8C9D2" },
  cuban: { w: 0.26, rim: "spoke", rimC: "#F5F5F7", hubC: "#0A66C2" },
  bear2014: { w: 0.3, rim: "ring", rimC: "#A5F3FC", tire: "#CFE6F0", nub: "slick" }, // ice rollers under the skis
  headline: { w: 0.3, rim: "disc", rimC: "#C8C9D2", tire: "#1B1B1F" }, // van steelies
};

// Rim/hub is a separate submesh: metal/specPow are per-draw uniforms in
// gl.js, so the machined rim can be drawn hot-specular metal against the
// matte-band tire in the same wheel. Shape is unchanged; only the material
// split moves.
function buildWheel(kit, palette) {
  const tireM = meshBuilder();
  const hub = meshBuilder();
  const tire = hex(kit.tire || "#1B1B1F");
  const ww = kit.w || 0.28;
  // K19: rubber authored into the matte band · tire, tread nubs and
  // whitewalls stop taking car-paint glints; rims/hubs stay paint/metal
  tireM.cylX(0, 0, 0, 0.34, ww, 12, tire, { capColor: shade(tire, 1.35), alpha: A_MATTE });
  if (kit.nub !== "slick") {
    const n = kit.nub === "chunk" ? 8 : 6, s = kit.nub === "chunk" ? 0.1 : 0.07;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      tireM.box(0, Math.cos(a) * 0.33, Math.sin(a) * 0.33, ww * 0.86, s, s, shade(tire, 1.7), { alpha: A_MATTE });
    }
  }
  if (kit.white) tireM.cylX(0, 0, 0, 0.265, ww + 0.02, 12, hex("#E9E2D2"), { capColor: hex("#E9E2D2"), alpha: A_MATTE });
  const rimC = kit.rimC ? hex(kit.rimC) : hex(palette.accent);
  const hubC = kit.hubC ? hex(kit.hubC) : C.chrome;
  switch (kit.rim) {
    case "disc": // armored solid steel face (vault money)
      hub.cylX(0, 0, 0, 0.22, ww + 0.04, 10, rimC, { capColor: shade(rimC, 1.2) });
      hub.cylX(0, 0, 0, 0.08, ww + 0.1, 6, shade(rimC, 0.6), { capColor: shade(rimC, 0.75) });
      break;
    case "ring": // hubless ghost ring: black core, thin bright rim
      hub.cylX(0, 0, 0, 0.21, ww + 0.02, 10, rimC, { capColor: shade(rimC, 1.3) });
      hub.cylX(0, 0, 0, 0.13, ww + 0.05, 8, hex("#15161A"), { capColor: hex("#15161A") });
      break;
    case "stud": // gilded hub ringed with bullion studs
      hub.cylX(0, 0, 0, 0.2, ww + 0.02, 9, rimC, { capColor: shade(rimC, 1.25) });
      hub.cylX(0, 0, 0, 0.1, ww + 0.06, 6, shade(rimC, 0.8));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.4;
        hub.box(0, Math.cos(a) * 0.24, Math.sin(a) * 0.24, ww + 0.1, 0.09, 0.09, hex(kit.studC || "#F5C542"));
      }
      break;
    case "spoke": { // five flat spokes on both faces + deep-dish hub
      hub.cylX(0, 0, 0, 0.2, ww * 0.55, 9, shade(rimC, 0.45));
      for (const side of [-1, 1]) {
        const px = side * (ww / 2 + 0.012);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU + 0.3;
          const ca = Math.cos(a), sa = Math.sin(a);
          const P = (r, s) => [px, ca * r - sa * s, sa * r + ca * s];
          const q = [P(0.05, 0.04), P(0.2, 0.028), P(0.2, -0.028), P(0.05, -0.04)];
          if (side > 0) hub.quad(q[3], q[2], q[1], q[0], rimC);
          else hub.quad(q[0], q[1], q[2], q[3], rimC);
        }
      }
      hub.cylX(0, 0, 0, 0.07, ww + 0.06, 6, hubC);
      break;
    }
    case "octa": // enchanted: floating rune gem for a hubcap
      hub.cylX(0, 0, 0, 0.19, ww + 0.02, 8, rimC, { capColor: shade(rimC, 1.2) });
      for (const side of [-1, 1]) hub.octa(side * (ww / 2 + 0.05), 0, 0, 0.08, hex(kit.studC || "#F5C542"));
      hub.cylX(0, 0, 0, 0.08, ww + 0.05, 6, hubC);
      break;
    case "mag": // slim race mag: shallow dark dish, hot bright ring
      hub.cylX(0, 0, 0, 0.2, ww + 0.02, 10, rimC, { capColor: shade(rimC, 0.6) });
      hub.cylX(0, 0, 0, 0.12, ww + 0.05, 8, shade(rimC, 1.25), { capColor: C.white });
      break;
    default: // classic ring + chrome hubcap
      hub.cylX(0, 0, 0, 0.2, ww + 0.02, 9, rimC);
      hub.cylX(0, 0, 0, 0.11, ww + 0.04, 8, hubC, { capColor: shade(rimC, 1.25) });
  }
  return { tire: tireM, hub };
}

// ---------------------------------------------------------------------------
// DRIVER KITS · one body per racer. seatCore() owns the racing bones every
// kit keeps (forearms + gloves on the steering submesh, legs to pedals,
// harness) so the steering animation and low-seatback camera survive; mass,
// posture and outfit are the kit's job. Nobody is a recolor of anybody.
// ---------------------------------------------------------------------------

function seatCore(m, sm, am, p) {
  // smooth-shaded racing bones: capsule limbs with joint balls and mitt
  // hands · webbing (harness) stays crisp and embeds into the round chest.
  // Forearms/mitts/cuffs land on the ARMS submesh (steers with the wheel,
  // celebrates without it); the wheel itself stays on sm via steerWheel.
  const arms = am || sm || m;
  const skin = p.skin || C.skin1;
  // K19: every cloth/skin surface of the racing bones sits in the matte
  // band so suits stop flashing car-paint glints · only the buckle stays
  // on the metal path
  m.cyl(0, 1.26, -0.32, 0.13, 0.14, p.neckH || 0.12, 8, skin, { smooth: true, alpha: A_MATTE }); // neck
  m.sphere(0, 0.68, -0.35, (p.hipW || 0.5) * 0.62, 4, 9, p.hipC || p.legC, { squashY: 0.6, squashZ: 0.82, smooth: true, alpha: A_MATTE }); // hips
  if (p.harness !== false) {
    const strap = hex("#20222A");
    const sx = 0.17 * (p.chestW || 1);
    for (const d of [-1, 1]) {
      m.box(d * sx, 1.04, -0.1, 0.11, 0.46, 0.12, strap, { alpha: A_MATTE });
      m.box(d * sx, 1.26, -0.2, 0.11, 0.05, 0.28, strap, { alpha: A_MATTE });
    }
    m.box(0, 0.82, -0.09, 0.4, 0.1, 0.1, strap, { alpha: A_MATTE });
    m.box(0, 0.83, -0.07, 0.13, 0.13, 0.08, C.metal); // buckle
  }
  for (const d of [-1, 1]) {
    const ar = (p.armW || 0.17) * 0.52;
    m.sphere(d * (p.shoulderX || 0.38), 1.15, -0.3, ar * 1.45, 3, 7, p.armC, { smooth: true, alpha: A_MATTE }); // shoulder ball
    cylZ(m, d * (p.shoulderX || 0.38), 1.12, -0.1, ar, 0.52, 8, p.armC, { smooth: true, alpha: A_MATTE }); // upper arm
    cylZ(arms, d * 0.3, 1.02, 0.25, ar * 0.9, 0.28, 8, p.foreC || p.armC, { smooth: true, alpha: A_MATTE }); // forearm
    arms.sphere(d * 0.26, 1.0, 0.41, 0.088, 3, 7, p.gloveC || C.white, { squashZ: 1.15, smooth: true, alpha: A_MATTE }); // mitt
    cylZ(arms, d * 0.27, 1.0, 0.3, (p.cuffW || 0.15) * 0.58, 0.07, 8, p.cuffC || shade(p.armC, 0.6), { smooth: true, alpha: A_MATTE }); // cuff
    cylZ(m, d * 0.2, 0.64, 0.14, (p.legW || 0.2) * 0.5, 0.72, 8, p.legC, { smooth: true, alpha: A_MATTE }); // thigh
    m.sphere(d * 0.2, 0.67, 0.4, (p.legW || 0.2) * 0.56, 3, 7, shade(p.legC, 0.82), { smooth: true, alpha: A_MATTE }); // knee
  }
}

function drvSaylor(m, sm, am, tm) {
  // upright throne posture: slim squared chest, black suit, peaked lapels,
  // THE orange tie. He is not driving so much as presiding.
  const suit = C.black;
  // K19: suit masses author into the matte cloth band (ties/pins stay out)
  m.sphere(0, 0.84, -0.34, 0.32, 5, 10, suit, { squashZ: 0.72, smooth: true, alpha: A_MATTE }); // seated base
  m.sphere(0, 1.1, -0.32, 0.35, 5, 10, suit, { squashY: 0.78, squashZ: 0.68, smooth: true, alpha: A_MATTE }); // chest
  m.sphere(0, 1.26, -0.32, 0.4, 4, 10, shade(suit, 0.93), { squashY: 0.3, squashZ: 0.52, smooth: true, alpha: A_MATTE }); // squared shoulder mass
  m.box(0, 1.2, -0.1, 0.24, 0.14, 0.08, C.white, { alpha: A_MATTE }); // collar V
  for (const d of [-1, 1]) fin(m, [d * 0.11, 1.26, -0.05], [d * 0.3, 1.08, -0.07], [d * 0.09, 1.04, -0.05], shade(suit, 1.45));
  m.box(0, 0.99, -0.075, 0.13, 0.4, 0.09, C.gold); // THE golden tie
  m.box(0, 1.2, -0.07, 0.09, 0.07, 0.08, C.goldDeep); // knot
  tm.box(0, 1.08, -0.045, 0.07, 0.03, 0.03, C.chrome); // tie pin, bright on the gold
  seatCore(m, sm, am, { armC: suit, gloveC: C.black, cuffC: C.white, legC: shade(suit, 0.7) });
}

function drvPhong(m, sm, am, tm, gm) {
  // mission control, not a second Saylor: navy zip flight suit, stand
  // collar, shoulder piping and a chest telemetry patch that glows.
  const suit = C.navy;
  m.sphere(0, 0.84, -0.33, 0.3, 5, 10, suit, { squashZ: 0.72, smooth: true, alpha: A_MATTE });
  m.sphere(0, 1.08, -0.32, 0.325, 5, 10, suit, { squashY: 0.8, squashZ: 0.68, smooth: true, alpha: A_MATTE });
  m.sphere(0, 1.25, -0.32, 0.36, 4, 10, shade(suit, 0.9), { squashY: 0.3, squashZ: 0.52, smooth: true, alpha: A_MATTE }); // trim shoulders
  m.box(0, 1.23, -0.12, 0.24, 0.11, 0.08, shade(suit, 1.35), { alpha: A_MATTE }); // stand collar
  m.box(0, 0.99, -0.095, 0.11, 0.38, 0.08, C.gold); // THE golden tie
  m.box(0, 1.18, -0.085, 0.08, 0.06, 0.07, C.goldDeep); // knot under the collar
  for (const d of [-1, 1]) m.box(d * 0.28, 1.3, -0.12, 0.14, 0.05, 0.28, C.orange, { alpha: A_MATTE }); // shoulder piping
  gm.box(0.16, 1.12, -0.09, 0.12, 0.08, 0.06, C.green); // live status patch
  m.box(-0.16, 1.12, -0.095, 0.12, 0.08, 0.06, shade(C.white, 0.92)); // mission tag
  seatCore(m, sm, am, { skin: C.skin2, armC: shade(suit, 0.9), gloveC: C.orange, cuffC: shade(suit, 0.6), legC: shade(suit, 0.65) });
}

function drvWizard(m, sm, am) {
  // robe architecture: draped cone mass, bell sleeves, knotted sash.
  // Nothing here shares a line with the suit guys.
  const robe = C.indigo;
  m.cyl(0, 0.42, -0.35, 0.5, 0.28, 0.64, 10, robe, { smooth: true, alpha: A_MATTE }); // robe drape cone
  m.sphere(0, 1.1, -0.3, 0.31, 5, 10, robe, { squashY: 0.85, squashZ: 0.7, smooth: true, alpha: A_MATTE }); // hunched chest
  m.sphere(0, 1.25, -0.29, 0.34, 4, 10, shade(robe, 0.88), { squashY: 0.28, squashZ: 0.52, smooth: true, alpha: A_MATTE }); // soft shoulders
  m.box(0, 0.92, -0.06, 0.5, 0.15, 0.1, C.orange, { alpha: A_MATTE }); // sash band
  m.box(0.16, 0.68, -0.05, 0.14, 0.32, 0.09, shade(C.orange, 0.85), { alpha: A_MATTE }); // sash tail
  m.box(0, 1.2, -0.1, 0.2, 0.09, 0.08, shade(robe, 1.3), { alpha: A_MATTE }); // hood collar
  m.box(0, 1.02, -0.07, 0.11, 0.28, 0.09, C.gold); // THE golden tie (tucked into the sash)
  m.box(0, 1.16, -0.075, 0.08, 0.06, 0.08, C.goldDeep); // knot
  seatCore(m, sm, am, {
    skin: hex("#E8C39A"), armC: shade(robe, 0.8), foreC: shade(robe, 0.72), armW: 0.22,
    gloveC: C.cream, cuffC: C.orange, cuffW: 0.21, legC: shade(robe, 0.55), harness: false,
  });
}

function drvMallers(m, sm, am, gm) {
  // the heat kit: white short-sleeve tee, bare forearms, athletic lean,
  // a cyan bolt on the chest. Conference-stage energy, zero tailoring.
  const kit = C.white;
  m.sphere(0, 0.84, -0.32, 0.29, 5, 10, kit, { squashZ: 0.72, smooth: true, alpha: A_MATTE });
  m.sphere(0, 1.08, -0.29, 0.32, 5, 10, kit, { squashY: 0.8, squashZ: 0.68, smooth: true, alpha: A_MATTE }); // leaning in
  m.sphere(0, 1.25, -0.27, 0.36, 4, 10, shade(kit, 0.95), { squashY: 0.29, squashZ: 0.52, smooth: true, alpha: A_MATTE }); // sleeve caps
  m.box(0, 1.22, -0.09, 0.2, 0.07, 0.08, shade(kit, 0.8), { alpha: A_MATTE }); // crew collar
  gm.box(0, 1.04, -0.08, 0.09, 0.2, 0.06, C.cyan); // bolt mark
  gm.box(0.055, 1.13, -0.08, 0.08, 0.09, 0.06, C.cyan);
  seatCore(m, sm, am, {
    armC: shade(kit, 0.97), foreC: C.skin1, armW: 0.18, gloveC: C.black,
    cuffC: C.cyan, legC: hex("#3A3F4A"),
  });
}

function drvBukele(m, sm, am) {
  // presidential beach casual: navy ringer tee, bare arms, board shorts,
  // a little volcano on the chest. Relaxed shoulders, no armor anywhere.
  const tee = hex("#1B4F72");
  m.sphere(0, 0.84, -0.33, 0.3, 5, 10, tee, { squashZ: 0.72, smooth: true, alpha: A_MATTE });
  m.sphere(0, 1.08, -0.32, 0.325, 5, 10, tee, { squashY: 0.8, squashZ: 0.68, smooth: true, alpha: A_MATTE });
  m.sphere(0, 1.24, -0.32, 0.35, 4, 10, shade(tee, 0.92), { squashY: 0.27, squashZ: 0.5, smooth: true, alpha: A_MATTE }); // easy shoulders
  m.box(0, 1.21, -0.11, 0.22, 0.06, 0.08, C.white, { alpha: A_MATTE }); // ringer collar
  fin(m, [-0.11, 0.98, -0.075], [0.11, 0.98, -0.075], [0, 1.14, -0.075], shade(C.orange, 0.9)); // volcano mark
  seatCore(m, sm, am, {
    skin: C.skin2, armC: shade(tee, 0.95), foreC: C.skin2, gloveC: C.white,
    cuffC: shade(tee, 0.8), legC: hex("#E8DCC0"),
  });
}

function drvSchiff(m, sm, am, tm) {
  // the heavyweight: widest torso on the grid, treasure-king gilding,
  // spiked gold pauldrons. Cartoon villain armor in his own bullion.
  const coat = hex("#4A3B2A");
  m.sphere(0, 0.8, -0.32, 0.46, 5, 10, coat, { squashY: 0.85, squashZ: 0.66, smooth: true, alpha: A_MATTE }); // barrel belly
  m.sphere(0, 1.1, -0.32, 0.42, 5, 10, coat, { squashY: 0.72, squashZ: 0.6, smooth: true, alpha: A_MATTE }); // chest
  m.sphere(0, 1.28, -0.32, 0.56, 4, 10, shade(coat, 0.9), { squashY: 0.24, squashZ: 0.4, smooth: true, alpha: A_MATTE }); // massive shoulder mass
  m.box(0, 1.21, -0.1, 0.26, 0.12, 0.08, C.cream, { alpha: A_MATTE }); // collar
  m.box(0, 0.98, -0.08, 0.14, 0.4, 0.09, C.goldDeep, { alpha: A_MATTE }); // gold-cloth tie
  tm.box(0, 0.8, -0.09, 0.3, 0.08, 0.1, C.gold); // belt plate
  for (const d of [-1, 1]) {
    // pauldrons ride OUTBOARD at x0.6 on the widened shoulder line: the
    // 1.16-scale head sphere reaches x0.43 at pad height, and gold faces
    // slicing the textured jaw band was a confirmed review defect
    dome(tm, d * 0.6, 1.33, -0.32, 0.2, 0, 1.55, 3, 9, C.gold, { squashY: 0.8 }); // round pauldrons
    tm.cyl(d * 0.6, 1.45, -0.44, 0.055, 0, 0.16, 6, C.goldDeep, { smooth: true }); // spikes
    tm.cyl(d * 0.6, 1.45, -0.2, 0.055, 0, 0.16, 6, C.goldDeep, { smooth: true });
    tm.cyl(d * 0.72, 1.4, -0.32, 0.05, 0, 0.15, 6, C.goldDeep, { smooth: true });
    am.cyl(d * 0.27, 1.09, 0.3, 0.045, 0, 0.11, 5, C.goldDeep); // wrist spikes
  }
  seatCore(m, sm, am, {
    armC: shade(coat, 0.92), armW: 0.21, chestW: 1.3, hipW: 0.66, gloveC: C.goldDeep,
    cuffC: C.gold, cuffW: 0.17, legC: shade(coat, 0.65), legW: 0.24,
  });
}

function drvDimon(m, sm, am) {
  // the institution: broad banker frame, pinstriped navy, red power tie,
  // pocket square. Tailoring as armor · never a flight suit.
  const suit = C.navy;
  m.sphere(0, 0.84, -0.33, 0.37, 5, 10, suit, { squashZ: 0.66, smooth: true, alpha: A_MATTE });
  m.sphere(0, 1.1, -0.32, 0.39, 5, 10, suit, { squashY: 0.75, squashZ: 0.62, smooth: true, alpha: A_MATTE });
  m.sphere(0, 1.27, -0.32, 0.46, 4, 10, shade(suit, 0.9), { squashY: 0.27, squashZ: 0.46, smooth: true, alpha: A_MATTE }); // heavy shoulders
  for (const px of [-0.12, 0.12]) m.box(px, 0.99, -0.08, 0.016, 0.46, 0.06, shade(suit, 1.4), { alpha: A_MATTE }); // pinstripes
  m.box(0, 1.22, -0.11, 0.28, 0.12, 0.08, C.white, { alpha: A_MATTE }); // spread collar
  m.box(0, 0.99, -0.08, 0.13, 0.42, 0.09, C.red); // power tie
  m.box(0, 1.19, -0.075, 0.1, 0.08, 0.09, shade(C.red, 0.75)); // knot
  m.box(0.25, 1.16, -0.12, 0.1, 0.06, 0.07, C.white); // pocket square
  seatCore(m, sm, am, { armC: suit, armW: 0.19, chestW: 1.15, gloveC: hex("#2E3440"), cuffC: C.white, legC: shade(suit, 0.62) });
}

function drvWarren(m, sm, am, tm) {
  // hearing-room blazer: rounded shoulder line, cream blouse, oversight
  // pin. No tie, no harness armor vibes · a senator, not a stormtrooper.
  const blazer = C.maroon;
  m.sphere(0, 0.84, -0.33, 0.28, 5, 10, blazer, { squashZ: 0.74, smooth: true, alpha: A_MATTE });
  m.sphere(0, 1.07, -0.32, 0.3, 5, 10, blazer, { squashY: 0.82, squashZ: 0.7, smooth: true, alpha: A_MATTE });
  m.sphere(0, 1.23, -0.32, 0.32, 4, 10, shade(blazer, 0.9), { squashY: 0.3, squashZ: 0.56, smooth: true, alpha: A_MATTE }); // rounded shoulders
  m.box(0, 1.2, -0.11, 0.24, 0.16, 0.08, C.cream, { alpha: A_MATTE }); // blouse V
  m.box(0, 1.04, -0.1, 0.05, 0.2, 0.08, shade(blazer, 1.3), { alpha: A_MATTE }); // blazer seam
  tm.sphere(0.17, 1.16, -0.085, 0.03, 3, 5, C.gold, { smooth: true }); // the pin
  seatCore(m, sm, am, { armC: blazer, armW: 0.16, gloveC: C.cream, cuffC: shade(blazer, 0.7), legC: shade(blazer, 0.62) });
}

function drvBuffett(m, sm, am) {
  // grandpa mass: belly-forward cream suit, sloped soft shoulders, short
  // neck, red tie riding the slope. Softest silhouette on the grid.
  const suit = C.cream;
  m.sphere(0, 0.82, -0.31, 0.4, 5, 10, suit, { squashY: 0.92, squashZ: 0.72, smooth: true, alpha: A_MATTE }); // the belly
  m.sphere(0, 1.1, -0.32, 0.32, 5, 10, suit, { squashY: 0.75, squashZ: 0.66, smooth: true, alpha: A_MATTE });
  m.sphere(0, 1.23, -0.32, 0.33, 4, 10, shade(suit, 0.93), { squashY: 0.26, squashZ: 0.5, smooth: true, alpha: A_MATTE }); // sloped shoulders
  m.box(0, 1.19, -0.12, 0.24, 0.12, 0.08, C.white, { alpha: A_MATTE }); // collar
  m.box(0, 0.97, -0.06, 0.13, 0.42, 0.09, C.red); // tie
  m.box(0, 1.16, -0.08, 0.09, 0.07, 0.08, shade(C.red, 0.75));
  seatCore(m, sm, am, {
    armC: suit, gloveC: C.white, cuffC: C.white, legC: shade(suit, 0.8),
    neckH: 0.08, hipW: 0.6, shoulderX: 0.36,
  });
}

function drvCuban(m, sm, am) {
  // courtside jersey: athletic V taper, white side stripes, bare arms,
  // wristbands. Shark Tank posture, zero boardroom anywhere.
  const jer = C.jersey;
  m.sphere(0, 0.84, -0.33, 0.29, 5, 10, jer, { squashZ: 0.74, smooth: true, alpha: A_MATTE }); // waist
  m.sphere(0, 1.1, -0.32, 0.36, 5, 10, jer, { squashY: 0.75, squashZ: 0.62, smooth: true, alpha: A_MATTE }); // V chest
  m.sphere(0, 1.26, -0.32, 0.42, 4, 10, shade(jer, 0.92), { squashY: 0.28, squashZ: 0.46, smooth: true, alpha: A_MATTE }); // broad shoulders
  for (const d of [-1, 1]) m.box(d * 0.28, 1.06, -0.31, 0.04, 0.44, 0.3, C.white, { alpha: A_MATTE }); // jersey stripes
  m.box(0, 1.22, -0.11, 0.22, 0.1, 0.08, shade(jer, 0.7), { alpha: A_MATTE }); // V collar
  seatCore(m, sm, am, {
    armC: C.skin1, foreC: C.skin1, armW: 0.19, gloveC: C.white,
    cuffC: hex("#17408B"), cuffW: 0.17, legC: hex("#2E2A26"),
  });
}

function hairMesh(m, id, headScale) {
  // HEAD KIT · built in HEAD-LOCAL space (origin at the head center) and
  // drawn with the head's transform, so hats, hair, ears and beards turn
  // WITH the face through corners. Everything organic here is smooth-
  // shaded; only cap bills stay planar.
  const spec = FACE_SPECS[id];
  if (!spec) return;
  const hc = hex(spec.hair);
  const skin = hex(spec.skin);
  const hs = headScale || 1;
  const r = HEAD.r * hs;
  const HPI = Math.PI / 2;
  // arc window excluding the painted face (the texture's face spans about
  // 62deg either side of forward · hair shells stop short of it)
  const BACK = { a0: HPI + 0.8, a1: HPI + TAU - 0.8 };
  // sculpted anatomy on every head: ears with an inner fold + a nose
  // bump · a painted ball with no ears is a decal, not a character
  for (const d of [-1, 1]) {
    m.sphere(d * r * 0.96, -r * 0.06, -r * 0.04, r * 0.21, 4, 6, skin, { squashY: 1.3, smooth: true });
    m.sphere(d * r * 1.06, -r * 0.06, -r * 0.03, r * 0.11, 3, 5, shade(skin, 0.8), { squashY: 1.25, smooth: true });
  }
  m.sphere(0, -r * 0.3, r * 0.92, r * 0.13, 4, 6, skin, { smooth: true }); // nose
  switch (spec.hairStyle) {
    case "sweptback": // saylor: the silver executive sweep as two BLENDED
      // smooth masses (front crown + swept back-volume) over a trimmed
      // nape · sculpted flow, nothing bolted on
      dome(m, 0, r * 0.08, -r * 0.05, r * 1.12, 0, 1.04, 4, 12, shade(hc, 0.94));
      dome(m, 0, r * 0.26, -r * 0.36, r * 0.94, 0, 1.52, 4, 12, shade(hc, 1.03));
      dome(m, 0, 0, -r * 0.03, r * 1.1, 1.0, 1.95, 3, 12, shade(hc, 0.86), BACK);
      break;
    case "short": // phong / dimon: tight combed cut, crisp hairline,
      // comb-part streaks so light silver never reads as a helmet
      dome(m, 0, r * 0.05, -r * 0.03, r * 1.1, 0, 1.0, 4, 12, shade(hc, 0.86));
      dome(m, 0, 0, -r * 0.02, r * 1.09, 0.95, 1.85, 3, 12, shade(hc, 0.78), BACK);
      for (const ca of [2.25, Math.PI - 0.08, 4.0]) {
        dome(m, 0, r * 0.05, -r * 0.03, r * 1.115, 0.12, 0.92, 2, 2, shade(hc, 0.66), { a0: HPI + ca, a1: HPI + ca + 0.16 });
      }
      break;
    case "shortback": // cuban: the same cut, fuller down the nape
      dome(m, 0, r * 0.05, -r * 0.03, r * 1.11, 0, 1.05, 4, 12, hc);
      dome(m, 0, 0, -r * 0.02, r * 1.1, 1.0, 2.1, 3, 12, shade(hc, 0.9), BACK);
      break;
    case "bob": { // warren: helmet bob · smooth crown, hanging wrap open
      // at the face, curved bang band grazing the brows
      dome(m, 0, r * 0.05, 0, r * 1.15, 0, 1.1, 4, 12, hc);
      const open = 0.66;
      m.cyl(0, -r * 0.62, -r * 0.05, r * 1.15, r * 1.09, r * 1.35, 12, shade(hc, 0.96), {
        a0: HPI + open, a1: HPI + TAU - open, capTop: false, capBot: false, smooth: true,
      });
      dome(m, 0, r * 0.08, r * 0.02, r * 1.14, 0.85, 1.22, 2, 8, shade(hc, 1.05), { a0: HPI - 0.72, a1: HPI + 0.72 });
      break;
    }
    case "balding": // buffett / schiff: horseshoe wrap + round ear tufts
      dome(m, 0, 0, -r * 0.02, r * 1.07, 1.05, 2.0, 3, 10, hc, { a0: HPI + 1.1, a1: HPI + TAU - 1.1 });
      for (const d of [-1, 1]) {
        m.sphere(d * r * 0.92, -r * 0.16, -r * 0.06, r * 0.28, 3, 6, hc, { squashY: 1.3, smooth: true });
      }
      break;
    case "sides": { // wizard: round mane puffs, a long smooth costume
      // beard shell, and proper millinery: felt brim, banded cone with a
      // drooped tip
      for (const d of [-1, 1]) {
        m.sphere(d * r * 0.88, -r * 0.15, -r * 0.1, r * 0.36, 4, 6, hc, { squashY: 1.5, smooth: true });
      }
      dome(m, 0, 0, r * 0.05, r * 1.06, 2.15, 3.02, 4, 10, hc, { a0: HPI - 1.2, a1: HPI + 1.2, squashY: 1.55 });
      m.sphere(0, -r * 1.62, r * 0.34, r * 0.14, 3, 5, shade(hc, 0.95), { smooth: true }); // beard tip curl
      const felt = shade(C.indigo, 0.78);
      m.cyl(0, r * 0.5, 0, r * 1.48, r * 1.38, r * 0.1, 10, felt, { topColor: shade(C.indigo, 0.78) });
      m.cyl(0, r * 0.58, 0, r * 1.0, r * 0.24, r * 2.1, 10, felt, { smooth: true }); // truncated cone
      m.cyl(0, r * 0.62, 0, r * 1.1, r * 1.0, r * 0.32, 10, C.gold, { capTop: false, capBot: false, smooth: true }); // proud band
      m.octa(0, r * 0.8, r * 1.06, r * 0.16, C.orange); // band gem
      frustum(m, 0, r * 2.68, 0, r * 0.48, r * 0.48, r * 0.07, r * 0.07, r * 0.7, shade(felt, 1.06), { dz: -r * 0.5, capBot: false }); // drooped tip
      break;
    }
    case "cap": // mallers: fitted cap · shell high over the face, panel
      // low down the back, curved bill, hair at the nape
      dome(m, 0, r * 0.04, -r * 0.04, r * 1.14, 0, 1.02, 4, 12, C.darkMetal);
      dome(m, 0, 0, -r * 0.03, r * 1.13, 0.95, 1.55, 2, 10, shade(C.darkMetal, 1.25), BACK);
      brimArc(m, 0, r * 0.42, r * 0.1, r * 0.9, r * 1.72, HPI - 0.8, HPI + 0.8, 6, r * 0.2, hex("#383840"));
      m.sphere(0, r * 1.1, -r * 0.04, r * 0.12, 3, 5, C.cyan, { smooth: true }); // crown button
      dome(m, 0, 0, -r * 0.02, r * 1.07, 1.5, 1.95, 2, 10, hc, BACK); // nape hair
      break;
    case "backcap": // bukele: the same fit, bill swung backward
      dome(m, 0, r * 0.04, -r * 0.04, r * 1.14, 0, 1.02, 4, 12, C.navy);
      dome(m, 0, 0, -r * 0.03, r * 1.13, 0.95, 1.55, 2, 10, shade(C.navy, 1.12), BACK);
      brimArc(m, 0, r * 0.42, -r * 0.1, r * 0.9, r * 1.72, HPI + Math.PI - 0.8, HPI + Math.PI + 0.8, 6, r * 0.2, shade(C.navy, 0.85));
      m.sphere(0, r * 1.1, -r * 0.04, r * 0.12, 3, 5, C.white, { smooth: true });
      dome(m, 0, 0, -r * 0.02, r * 1.07, 1.5, 1.95, 2, 10, hc, BACK); // nape hair
      break;
  }
  // full texture-beards get a smooth hanging shell hugging the jaw · top
  // edge BELOW the painted mouth line (the podium snarl stays visible)
  if (spec.facialHair && spec.facialHair.style === "fullbeard") {
    const bc = hex(spec.facialHair.color);
    dome(m, 0, 0, r * 0.05, r * 1.12, 2.15, 3.0, 4, 10, shade(bc, 1.06), { a0: HPI - 1.35, a1: HPI + 1.35, squashY: 1.38 });
    m.sphere(0, -r * 1.42, r * 0.4, r * 0.2, 3, 6, bc, { squashY: 1.2, smooth: true }); // beard point
  }
}

// ---------------------------------------------------------------------------
// CHASSIS FAMILIES · eleven machines, eleven architectures. Shared bones
// only (WHEEL_POS anchors, steering column z 0.44, seat band ~y 0.7,
// low-seatback rule); everything a silhouette reads is per-machine. No
// "default kart but blue with a prop on the engine" reskins ship.
// ---------------------------------------------------------------------------

function kSaylor(m, sm, tm, gm, body) {
  // A throne that refuses to sell: the machine IS furniture. Dais-step
  // nose, anodized skirt flanks, tufted cushion, high armrest wings.
  // The trim is BITCOIN ORANGE, not gold (operator 2026-07-19) · the one
  // gold note on Saylor now rides his tie, not the throne.
  const gilt = C.orange, giltDeep = C.orangeDeep;
  frustum(m, 0, 0.14, 0.02, 1.5, 2.45, 1.32, 2.25, 0.16, shade(body, 0.85)); // base slab
  frustum(m, 0, 0.3, 0.02, 1.32, 2.25, 1.18, 2.05, 0.18, body); // upper plinth
  tm.box(0, 0.4, 1.05, 1.16, 0.035, 0.05, gilt); // plinth trim lip
  // dais steps descending off the nose (no splitter, no wing: stairs)
  frustum(m, 0, 0.12, 1.44, 1.26, 0.4, 1.1, 0.32, 0.12, shade(body, 0.95));
  frustum(m, 0, 0.24, 1.34, 1.06, 0.36, 0.9, 0.28, 0.14, shade(body, 1.04));
  frustum(m, 0, 0.38, 1.22, 0.84, 0.32, 0.62, 0.22, 0.14, shade(body, 1.12));
  tm.box(0, 0.54, 1.18, 0.48, 0.05, 0.16, gilt); // crest bar
  tm.octa(0, 0.62, 1.18, 0.08, giltDeep); // nose finial
  for (const d of [-1, 1]) {
    // closed anodized skirt flanks between the wheels
    frustum(m, d * 0.56, 0.3, 0, 0.22, 1.26, 0.15, 1.06, 0.34, shade(body, 0.93));
    tm.box(d * 0.615, 0.56, 0, 0.045, 0.035, 1.0, gilt); // trim hairline
    // clawfoot fender caps hovering over each wheel
    frustum(m, d * 0.68, 0.68, 0.82, 0.36, 0.6, 0.24, 0.42, 0.12, shade(body, 1.06));
    frustum(m, d * 0.68, 0.68, -0.78, 0.36, 0.6, 0.24, 0.42, 0.12, shade(body, 1.06));
    // throne wings: high orange armrest panels flanking the shoulders ·
    // the chase-cam read, wide, never above the head, open in the middle
    tm.box(d * 0.56, 0.95, -0.6, 0.09, 0.62, 0.34, gilt);
    tm.box(d * 0.56, 1.28, -0.6, 0.13, 0.08, 0.4, giltDeep);
    tm.sphere(d * 0.56, 1.36, -0.6, 0.07, 2, 5, gilt); // finial orbs
    tm.box(d * 0.5, 0.72, -0.22, 0.08, 0.09, 0.92, gilt); // armrest run
    m.box(d * 0.5, 0.58, 0.16, 0.07, 0.2, 0.07, shade(body, 1.15)); // armrest post
  }
  // dash pedestal + column + wheel
  frustum(m, 0, 0.48, 0.54, 0.72, 0.3, 0.56, 0.2, 0.18, shade(body, 0.8));
  m.box(0, 0.72, 0.42, 0.09, 0.24, 0.09, C.darkMetal);
  steerWheel(sm, C.black, gilt);
  // tufted velvet cushion bucket + low backrest
  m.box(0, 0.47, -0.42, 0.68, 0.13, 0.64, shade(C.orangeDeep, 0.8));
  m.box(0, 0.66, -0.68, 0.68, 0.4, 0.15, shade(C.orangeDeep, 0.9));
  for (const bx of [-0.17, 0.17]) {
    m.sphere(bx, 0.545, -0.3, 0.03, 2, 4, giltDeep); // tuft buttons
    m.sphere(bx, 0.72, -0.6, 0.03, 2, 4, giltDeep);
  }
  // rear crest cabinet: orange frame around a molten sigil
  frustum(m, 0, 0.38, -1.16, 1.0, 0.52, 0.8, 0.38, 0.44, shade(body, 0.9));
  tm.box(0, 0.84, -1.16, 0.88, 0.06, 0.42, gilt);
  for (const sx of [-0.34, 0.34]) tm.sphere(sx, 0.9, -1.16, 0.05, 2, 4, giltDeep);
  gm.octa(0, 0.62, -1.4, 0.14, C.orange); // the sigil, glowing
}

function kPhong(m, sm, tm, gm, body, accent) {
  // Mission Control on wheels: an enclosed corporate GT with a nose light
  // bar, one architectural chrome booster and a telemetry mast.
  loft(m, [
    { z: -1.5, y: 0.5, w: 0.9, h: 0.34 },
    { z: -0.7, y: 0.46, w: 1.1, h: 0.42 },
    { z: 0.3, y: 0.44, w: 1.02, h: 0.4 },
    { z: 0.9, y: 0.46, w: 0.94, h: 0.34 },
    { z: 1.5, y: 0.4, w: 0.62, h: 0.2 },
    { z: 1.78, y: 0.36, w: 0.3, h: 0.1 },
  ], body);
  // cockpit tub + low seat · the tub rim pokes ABOVE the deck (0.64+0.05
  // clears the loft's 0.639-0.669 deck band) so the cutout actually reads
  m.box(0, 0.64, -0.15, 0.66, 0.1, 1.05, hex("#10131C"));
  m.box(0, 0.47, -0.42, 0.6, 0.12, 0.6, shade(body, 0.7));
  m.box(0, 0.64, -0.68, 0.6, 0.34, 0.12, shade(body, 0.75)); // low seatback
  // status light bar wrapped into the nose · live green with amber tips
  gm.box(0, 0.49, 1.66, 0.4, 0.05, 0.1, C.green);
  gm.box(-0.28, 0.51, 1.58, 0.12, 0.05, 0.1, C.orange);
  gm.box(0.28, 0.51, 1.58, 0.12, 0.05, 0.1, C.orange);
  m.box(0, 0.63, 1.02, 0.5, 0.05, 0.5, shade(body, 1.1)); // cowl step
  // orange mission spine stripe fore and aft
  m.box(0, 0.665, 0.62, 0.16, 0.03, 0.85, accent);
  m.box(0, 0.69, -1.05, 0.16, 0.03, 0.8, accent);
  // enclosed intake gills on the haunches
  for (const d of [-1, 1]) for (let v = 0; v < 3; v++) {
    m.box(d * 0.54, 0.5, -0.5 - v * 0.17, 0.06, 0.17, 0.07, hex("#0E1118"));
  }
  // dash with a live glass strip + wheel
  m.box(0, 0.6, 0.52, 0.62, 0.16, 0.22, shade(body, 0.8));
  gm.box(0, 0.69, 0.5, 0.4, 0.03, 0.14, hex("#7DE3FF"));
  m.box(0, 0.72, 0.42, 0.09, 0.24, 0.09, C.darkMetal);
  steerWheel(sm, C.black, accent);
  // raked bowed windscreen · top under y 1.10 so opaque K19 glass never
  // eats the driver face (skull bottom ~1.13 at the caricature sphere)
  raceScreen(m, 0, 0.66, 0.88, {
    halfW0: 0.4, halfW1: 0.3, h: 0.4, rake: 0.28, bow: 0.06,
    color: hex("#7DE3FF"),
  });
  // chrome frame lip on the top edge · glass vs metal on the same noun
  tm.box(0, 1.065, 0.57, 0.62, 0.028, 0.05, C.chrome);
  // THE booster: one big chrome drum, orange nozzle core
  cylZ(tm, 0, 0.62, -1.42, 0.26, 0.5, 9, C.chrome);
  cylZ(tm, 0, 0.62, -1.68, 0.2, 0.1, 9, C.metal);
  cylZ(gm, 0, 0.62, -1.73, 0.14, 0.04, 8, C.orange); // nozzle glow ring
  // telemetry mast off the right haunch: whip + beacon + crossbar
  tm.box(0.44, 0.98, -1.05, 0.03, 0.72, 0.03, C.chrome);
  tm.box(0.44, 1.16, -1.05, 0.22, 0.02, 0.02, C.chrome);
  gm.sphere(0.44, 1.38, -1.05, 0.06, 2, 5, C.red);
}

function kWizard(m, sm, tm, gm, body, accent) {
  // Finance is astrology; this is alchemy: a robe-skirted spell scooter
  // with a mono fender, a socketed staff and a hat-cone tail. No pods,
  // no wings, no exhausts · runes instead.
  loft(m, [
    { z: -1.45, y: 0.42, w: 1.34, h: 0.5 }, // swept hem
    { z: -0.8, y: 0.5, w: 1.06, h: 0.56 },
    { z: -0.1, y: 0.46, w: 0.82, h: 0.48 },
    { z: 0.6, y: 0.42, w: 0.64, h: 0.36 },
    { z: 1.05, y: 0.4, w: 0.5, h: 0.28 },
  ], body);
  // scooter mono-fender + crowned column (a Vespa for spellwork)
  frustum(m, 0, 0.26, 1.25, 0.68, 0.88, 0.5, 0.6, 0.28, shade(body, 1.06));
  frustum(m, 0, 0.54, 1.18, 0.44, 0.42, 0.28, 0.24, 0.26, shade(body, 0.95));
  m.box(0, 0.68, 0.48, 0.12, 0.44, 0.12, shade(accent, 1.5)); // upright column
  steerWheel(sm, C.wood, C.gold);
  // rune studs down the hem + tail rune strip (all glowing)
  for (const d of [-1, 1]) for (let s = 0; s < 3; s++) {
    gm.octa(d * (0.5 - s * 0.08), 0.56, -0.4 - s * 0.38, 0.05, C.orange);
  }
  gm.box(0, 0.62, -1.66, 0.46, 0.05, 0.06, C.orange);
  // saddle seat
  m.box(0, 0.5, -0.42, 0.6, 0.14, 0.6, shade(accent, 0.7));
  m.box(0, 0.64, -0.66, 0.6, 0.3, 0.13, shade(accent, 0.75));
  // THE STAFF: structural mast socketed through the right haunch ·
  // outboard at x0.56 so the drift-swung chase camera never crosses it
  // over the head
  tm.cyl(0.56, 0.52, -0.98, 0.1, 0.08, 0.22, 6, C.gold); // socket
  m.box(0.56, 1.0, -0.98, 0.07, 1.0, 0.07, C.wood);
  tm.cyl(0.56, 1.5, -0.98, 0.065, 0.085, 0.1, 5, C.gold); // collar
  gm.octa(0.56, 1.72, -0.98, 0.15, C.orange); // spell orb
  // hat-cone tail finial: the wizard signature echoed in bodywork
  m.cyl(0, 0.66, -1.32, 0.3, 0, 0.6, 7, shade(body, 1.12));
  tm.cyl(0, 0.88, -1.32, 0.21, 0.19, 0.06, 7, C.gold); // cone band
}

function kMallers(m, sm, tm, gm, body) {
  // Zero conf, full send: the narrowest, pointiest machine on the grid ·
  // needle nose, exposed coil engine, push-rod suspension, cyan energy
  // hardware that actually glows.
  loft(m, [
    { z: -1.35, y: 0.42, w: 0.6, h: 0.3 },
    { z: -0.55, y: 0.42, w: 0.8, h: 0.36 },
    { z: 0.5, y: 0.4, w: 0.68, h: 0.32 },
    { z: 1.3, y: 0.38, w: 0.42, h: 0.22 },
    { z: 1.85, y: 0.35, w: 0.12, h: 0.08 }, // the needle
  ], body);
  for (const d of [-1, 1]) {
    fin(m, [d * 0.18, 0.46, 1.5], [d * 0.6, 0.42, 1.3], [d * 0.18, 0.36, 1.28], C.cyan); // canards
    m.box(d * 0.44, 0.36, 0.82, 0.5, 0.05, 0.07, C.darkMetal); // push rods to the wheels
    m.box(d * 0.44, 0.36, -0.78, 0.5, 0.05, 0.07, C.darkMetal);
    gm.box(d * 0.315, 0.36, 0.25, 0.025, 0.05, 1.5, C.cyan); // energy rails
  }
  m.box(0, 0.5, -0.42, 0.56, 0.12, 0.56, shade(body, 0.8)); // seat pan
  m.box(0, 0.6, -0.66, 0.56, 0.3, 0.12, shade(body, 0.75));
  m.box(0, 0.58, 0.52, 0.5, 0.14, 0.2, shade(body, 0.85)); // dash
  m.box(0, 0.72, 0.42, 0.08, 0.22, 0.08, C.darkMetal);
  steerWheel(sm, C.black, C.cyan);
  // exposed lightning coil engine: chrome ring stack, cyan core
  gm.cyl(0, 0.46, -1.02, 0.1, 0.1, 0.5, 6, C.cyan);
  for (let r = 0; r < 4; r++) tm.cyl(0, 0.5 + r * 0.11, -1.02, 0.17 - r * 0.012, 0.16 - r * 0.012, 0.045, 7, C.chrome);
  // BOLT MAST: the cyan zigzag standard, socketed structural, offset so
  // it never covers the driver · now emissive so it blooms at night
  tm.cyl(0.42, 0.42, -1.3, 0.12, 0.09, 0.14, 6, C.chrome); // base socket
  // zigzag segments overlap in BOTH axes at each joint (a mast with air
  // gaps reads as three floating bars) and the tip is double-sided
  gm.box(0.42, 0.8, -1.3, 0.12, 0.5, 0.13, C.cyan);
  gm.box(0.33, 1.12, -1.3, 0.12, 0.42, 0.13, C.cyan);
  gm.box(0.44, 1.44, -1.3, 0.12, 0.44, 0.13, C.cyan);
  fin(gm, [0.4, 1.66, -1.23], [0.58, 1.56, -1.3], [0.4, 1.46, -1.37], C.cyan);
  for (const d of [-1, 1]) cylZ(tm, d * 0.19, 0.56, -1.44, 0.08, 0.22, 7, C.chrome); // twin nozzles
}

function kBukele(m, sm, tm, gm, body) {
  // Legal tender on a volcano board: one long kicked deck, twin surf
  // fins, a geothermal cone engine and lava underglow. The cockpit is
  // IN the deck · nothing bolted on top.
  const deck = hex("#E8DCC0"), lava = hex("#FF6B2E");
  loft(m, [
    { z: -1.7, y: 0.26, w: 0.9, h: 0.12 }, // tail kick
    { z: -1.0, y: 0.23, w: 1.3, h: 0.14 },
    { z: 0.3, y: 0.23, w: 1.44, h: 0.16 }, // widest belly
    { z: 1.3, y: 0.27, w: 1.0, h: 0.12 },
    { z: 1.95, y: 0.44, w: 0.4, h: 0.08 }, // kicked nose tip
  ], deck);
  m.box(0, 0.325, 0.15, 0.16, 0.02, 2.7, C.cyan); // center stringer stripe
  for (const d of [-1, 1]) m.box(d * 0.42, 0.32, 0.1, 0.1, 0.018, 2.3, body); // rail stripes
  m.cyl(0, 0.325, 1.05, 0.2, 0.2, 0.015, 8, C.orange); // sun disc deck art
  // deck cockpit: navy surround, pad seat, low glass lip
  frustum(m, 0, 0.3, -0.15, 1.0, 1.5, 0.88, 1.34, 0.12, body);
  m.box(0, 0.46, -0.42, 0.62, 0.1, 0.6, shade(body, 0.8)); // seat pad
  m.box(0, 0.58, -0.68, 0.62, 0.26, 0.12, shade(body, 0.9)); // low back pad
  frustum(m, 0, 0.42, 0.6, 0.62, 0.16, 0.5, 0.1, 0.18, hex("#7DE3FF"), { alpha: A_GLASS }); // windscreen lip (K19 glass band)
  m.box(0, 0.6, 0.43, 0.08, 0.5, 0.08, C.darkMetal); // tall column off the deck
  steerWheel(sm, C.black, C.cyan);
  // twin big surf fins off the tail
  for (const d of [-1, 1]) {
    fin(m, [d * 0.42, 0.3, -1.2], [d * 0.42, 0.88, -1.6], [d * 0.42, 0.3, -1.72], C.navy);
  }
  // the geothermal cone: a little volcano with a glowing crater
  m.cyl(0, 0.3, -1.1, 0.32, 0.1, 0.48, 7, hex("#5C5A56"));
  gm.cyl(0, 0.77, -1.1, 0.09, 0.07, 0.05, 6, lava); // crater glow
  for (const d of [-1, 1]) gm.box(d * 0.52, 0.18, 0.1, 0.06, 0.02, 1.9, lava); // lava underglow rails
  tm.box(0, 0.34, 1.62, 0.5, 0.04, 0.3, C.chrome); // nose trim blade
}

function kSatoshi(m, sm, am, tm, gm, hm, body, accent) {
  // Peer-to-peer electronic cash on wheels: a sealed silver monocoque ·
  // no intakes, no exhausts, no rivets. Circuit seams for livery, a cape
  // for a wake, one green sensor slit for a face. Parity pass 2026-07-21:
  // the ghost has to hold the select screen against the throne and the
  // bullion hauler · layered hood with sewn thickness, a lattice void
  // face on an LED sensor bar, garment stitching, arch lips + underglow
  // + a broadcast antenna on the hull. Every fabric tone still derives
  // from `accent` so the 100% palette swap gilds the whole figure.
  const trace = hex("#2FBF6B");
  const traceDim = shade(trace, 0.55);
  loft(m, [
    { z: -1.55, y: 0.44, w: 0.5, h: 0.2 },
    { z: -0.9, y: 0.46, w: 1.0, h: 0.42 },
    { z: 0.0, y: 0.44, w: 1.06, h: 0.46 },
    { z: 0.9, y: 0.42, w: 0.86, h: 0.34 },
    { z: 1.55, y: 0.4, w: 0.44, h: 0.14 }, // clean teardrop nose
  ], body);
  // wheel arch lips: low fender blades over all four contact patches so
  // the monocoque reads designed AROUND its wheels, not laid on top
  for (const d of [-1, 1]) {
    frustum(m, d * 0.66, 0.66, 0.82, 0.36, 0.6, 0.26, 0.44, 0.1, shade(body, 1.07), { capBot: false });
    frustum(m, d * 0.66, 0.66, -0.78, 0.36, 0.6, 0.26, 0.44, 0.1, shade(body, 1.07), { capBot: false });
    gm.box(d * 0.5, 0.26, 0.05, 0.045, 0.02, 2.1, traceDim); // underbody glow channel
  }
  // circuit seams: stepped glowing traces following the hull spine, tied
  // by a crossbar and junction nodes · a circuit, not pinstripes
  gm.box(0, 0.685, 0.3, 0.025, 0.02, 1.0, trace);
  gm.box(0, 0.62, 1.15, 0.025, 0.02, 0.6, trace);
  gm.box(-0.3, 0.655, -0.45, 0.02, 0.02, 0.8, shade(trace, 0.8));
  gm.box(0.26, 0.665, 0.15, 0.02, 0.02, 0.6, shade(trace, 0.8));
  gm.box(0, 0.675, -0.05, 0.56, 0.018, 0.022, traceDim); // crossbar trace
  for (const p of [[0, 0.7, 0.82], [-0.3, 0.67, -0.03], [0.26, 0.68, 0.47]]) gm.box(p[0], p[1], p[2], 0.05, 0.024, 0.05, trace); // nodes
  // sensor slit recessed into a dark housing so the face of the car has
  // depth, not a sticker
  m.box(0, 0.5, 1.54, 0.38, 0.08, 0.1, hex("#0A0C10"));
  gm.box(0, 0.5, 1.6, 0.3, 0.04, 0.05, trace); // the sensor slit
  // cockpit void · rim proud of the monocoque deck (~0.67), a ghost-glass
  // windscreen lip ahead of the column
  m.box(0, 0.63, -0.2, 0.6, 0.12, 0.85, hex("#0A0C10"));
  frustum(m, 0, 0.67, 0.55, 0.56, 0.12, 0.46, 0.07, 0.14, hex("#9FE8C4"), { alpha: A_GLASS, capBot: false }); // ghost-glass lip (K19 glass band)
  m.box(0, 0.7, 0.42, 0.08, 0.2, 0.08, C.metal);
  steerWheel(sm, hex("#3A3F4A"), trace);
  // whip antenna off the aero wake · the kart is a broadcast node
  tm.cyl(0, 0.86, -1.45, 0.02, 0.014, 0.34, 5, C.chrome);
  gm.sphere(0, 1.24, -1.45, 0.04, 2, 6, trace); // beacon at the tip
  // THE PILOT · the ghost of the protocol in streetwear: a hoodie pulled
  // UP over an anonymous face, not a wizard's cowl. Sewn sweatshirt torso
  // (zip channel, stitched kangaroo pocket, ribbed hem, drawstrings), a
  // layered hood open at a deep void face lit by a sensor bar. Metal
  // mitts for hands · nobody has ever seen who is under here. The fabric
  // is `accent` lifted to slate so it reads as cotton (and the black void
  // face contrasts) instead of a rim-lit black shell · gilds gold at 100%.
  const HPI = Math.PI / 2;
  const hood = shade(accent, 1.6), hoodMid = shade(accent, 1.3), hoodDk = accent;
  hm.sphere(0, 0.84, -0.34, 0.33, 5, 10, hood, { squashZ: 0.76, smooth: true }); // seated base
  hm.sphere(0, 1.1, -0.32, 0.35, 5, 10, hood, { squashY: 0.82, squashZ: 0.72, smooth: true }); // chest
  hm.sphere(0, 1.25, -0.32, 0.37, 4, 10, hoodMid, { squashY: 0.34, squashZ: 0.56, smooth: true }); // soft shoulders
  hm.box(0, 0.6, -0.3, 0.62, 0.1, 0.52, hoodDk); // ribbed waist hem
  for (const d of [-1, 1]) hm.box(d * 0.16, 0.6, -0.03, 0.02, 0.09, 0.03, shade(accent, 0.55)); // hem ribs
  // kangaroo pocket across the belly · recessed opening + stitch lines
  hm.box(0, 0.82, -0.02, 0.36, 0.22, 0.12, hoodMid);
  hm.box(0, 0.8, 0.05, 0.3, 0.14, 0.05, shade(accent, 0.5));
  for (const d of [-1, 1]) hm.box(d * 0.17, 0.82, 0.045, 0.016, 0.2, 0.02, shade(accent, 0.55));
  // center zip channel up the chest with a metal pull
  hm.box(0, 1.06, -0.035, 0.024, 0.28, 0.026, shade(accent, 0.5));
  tm.box(0, 1.19, -0.02, 0.028, 0.04, 0.03, C.metal);
  // gathered hood collar + two hanging drawstrings with pale aglet tips
  hm.box(0, 1.2, -0.16, 0.34, 0.13, 0.18, hoodMid);
  for (const d of [-1, 1]) {
    hm.box(d * 0.07, 1.12, 0.05, 0.028, 0.24, 0.028, C.cream);
    hm.sphere(d * 0.07, 0.99, 0.06, 0.03, 2, 5, shade(C.cream, 0.9));
  }
  // arms: hoodie sleeves + ribbed cuffs + articulated anonymous mitts
  for (const d of [-1, 1]) {
    hm.sphere(d * 0.36, 1.15, -0.3, 0.13, 3, 7, hoodMid, { smooth: true }); // shoulder
    cylZ(hm, d * 0.38, 1.12, -0.1, 0.09, 0.52, 8, hoodMid, { smooth: true }); // upper sleeve
    cylZ(am, d * 0.3, 1.02, 0.25, 0.08, 0.28, 8, hood, { smooth: true }); // forearm sleeve
    cylZ(am, d * 0.28, 1.0, 0.33, 0.092, 0.06, 8, hoodDk, { smooth: true }); // ribbed cuff
    cylZ(am, d * 0.27, 1.0, 0.37, 0.088, 0.03, 8, C.darkMetal, { smooth: true }); // wrist ring
    am.sphere(d * 0.26, 1.0, 0.41, 0.082, 3, 7, C.metal, { squashZ: 1.15, smooth: true }); // metal mitts
    am.box(d * 0.26, 1.08, 0.42, 0.07, 0.022, 0.08, C.chrome); // knuckle plate
  }
  hm.box(0, 0.62, 0.1, 0.42, 0.16, 0.6, hoodMid); // lap
  // THE ANONYMOUS FACE: a deep void where a face should be. A faint
  // circuit lattice ghosts across the dark and a horizontal LED bar
  // carries two brighter sensor nodes · watching, not staring. All of it
  // rides PROUD of the void sphere so the hood never buries it.
  hm.sphere(0, HEAD.y, HEAD.z + 0.02, HEAD.r * 0.92, 5, 8, hex("#07080C"), { squashZ: 0.9, smooth: true });
  const fz = HEAD.z + HEAD.r * 1.16;
  gm.box(0, HEAD.y - 0.09, fz - 0.02, 0.3, 0.014, 0.014, traceDim);
  gm.box(0, HEAD.y + 0.13, fz - 0.02, 0.24, 0.014, 0.014, traceDim);
  for (const d of [-1, 1]) gm.box(d * 0.1, HEAD.y + 0.02, fz - 0.02, 0.014, 0.2, 0.014, traceDim);
  gm.box(0, HEAD.y + 0.02, fz, 0.26, 0.03, 0.05, shade(trace, 0.75)); // LED bar
  for (const d of [-1, 1]) gm.box(d * 0.095, HEAD.y + 0.02, fz + 0.015, 0.075, 0.06, 0.05, trace); // sensor nodes
  // THE HOOD (up): layered fabric with real thickness · an inner lining
  // shadows the face, the shell steps in three ribbed folds, and rolled
  // welts run both opening edges so the rim reads sewn, not sliced.
  const hy = HEAD.y - 0.02, hz = HEAD.z - 0.05;
  dome(hm, 0, hy, hz, HEAD.r * 1.26, 0.12, 1.9, 3, 10, shade(accent, 0.7), { a0: HPI + 0.45, a1: HPI + TAU - 0.45, squashY: 1.06 }); // inner lining
  dome(hm, 0, hy, hz, HEAD.r * 1.42, 0, 0.78, 2, 12, hood, { a0: HPI + 0.6, a1: HPI + TAU - 0.6, squashY: 1.12 }); // crown fold
  dome(hm, 0, hy, hz, HEAD.r * 1.38, 0.74, 1.44, 2, 12, hoodMid, { a0: HPI + 0.58, a1: HPI + TAU - 0.58, squashY: 1.1 }); // mid fold
  dome(hm, 0, hy, hz, HEAD.r * 1.35, 1.4, 2.08, 2, 12, hood, { a0: HPI + 0.56, a1: HPI + TAU - 0.56, squashY: 1.08 }); // skirt fold
  for (const s of [[HPI + 0.42, HPI + 0.62], [HPI + TAU - 0.62, HPI + TAU - 0.42]]) {
    dome(hm, 0, hy, hz, HEAD.r * 1.45, 0.34, 1.86, 3, 2, hoodMid, { a0: s[0], a1: s[1], squashY: 1.1 }); // rolled opening welt
  }
  hm.sphere(0, HEAD.y - 0.16, HEAD.z - 0.34, 0.21, 4, 8, hoodMid, { squashY: 0.78, smooth: true }); // slouched hood fold at the nape
  hm.sphere(0, HEAD.y - 0.3, HEAD.z - 0.27, 0.24, 4, 8, hood, { squashY: 0.6, smooth: true }); // second fold gathering into the collar
  // circuit traces glow down the hoodie back like the monocoque livery
  gm.box(0, 1.0, -0.6, 0.03, 0.5, 0.3, trace);
  gm.box(-0.14, 0.92, -0.6, 0.03, 0.34, 0.28, shade(trace, 0.8));
  gm.box(0.14, 1.06, -0.6, 0.03, 0.34, 0.28, shade(trace, 0.8));
  // THE CAPE: a lofted wake off the shoulders sweeping over the tail
  loft(m, [
    { z: -1.74, y: 0.72, w: 0.54, h: 0.09 },
    { z: -1.35, y: 0.82, w: 0.84, h: 0.11 },
    { z: -0.95, y: 0.94, w: 1.0, h: 0.12 },
    { z: -0.55, y: 1.06, w: 0.82, h: 0.12 },
  ], accent, { capFront: false });
  gm.box(0, 0.99, -0.9, 0.03, 0.09, 0.4, trace); // spine seam
  gm.box(0, 0.87, -1.3, 0.03, 0.08, 0.4, shade(trace, 0.85));
  gm.sphere(0, 0.76, -1.8, 0.06, 2, 5, trace); // signal bead at the hem
}

function kSchiff(m, sm, tm, gm, body) {
  // 5,000 years of momentum, allegedly: a gold-freight hauler · vertical
  // gold grille, high fenders, side stacks, bullion pyramid on the bed.
  const bed = shade(body, 0.8);
  loft(m, [
    { z: -1.5, y: 0.42, w: 1.14, h: 0.4 }, // under-bed frame
    { z: -0.85, y: 0.48, w: 1.16, h: 0.52 },
    { z: 0.35, y: 0.46, w: 1.1, h: 0.48 },
    { z: 1.1, y: 0.54, w: 1.08, h: 0.56 }, // high hood
    { z: 1.45, y: 0.54, w: 1.04, h: 0.56 }, // blunt face
  ], body);
  // vertical gold grille + bull bar + furnace headlamps
  tm.box(0, 0.54, 1.48, 0.78, 0.42, 0.06, C.goldDeep);
  for (const gx of [-0.26, -0.13, 0, 0.13, 0.26]) tm.box(gx, 0.54, 1.51, 0.05, 0.36, 0.05, C.gold);
  tm.box(0, 0.28, 1.6, 1.0, 0.09, 0.09, C.gold); // bull bar
  tm.box(0, 0.42, 1.6, 0.09, 0.22, 0.09, C.gold);
  for (const d of [-1, 1]) gm.box(d * 0.4, 0.72, 1.5, 0.14, 0.1, 0.05, C.gold); // lamps
  m.box(0, 0.84, 1.1, 0.9, 0.06, 0.6, shade(body, 1.08)); // hood step
  for (const d of [-1, 1]) {
    // high truck fenders over every wheel
    frustum(m, d * 0.68, 0.68, 0.82, 0.4, 0.64, 0.28, 0.46, 0.14, shade(body, 1.05));
    frustum(m, d * 0.68, 0.68, -0.78, 0.4, 0.64, 0.28, 0.46, 0.14, shade(body, 1.05));
    // side exhaust stacks behind the cab
    tm.cyl(d * 0.5, 0.6, -0.95, 0.07, 0.06, 0.64, 6, C.chrome);
    tm.cyl(d * 0.5, 1.24, -0.95, 0.085, 0.07, 0.08, 6, shade(C.chrome, 0.8));
  }
  // cab: bench + gold-trimmed dash
  m.box(0, 0.5, -0.42, 0.68, 0.14, 0.6, shade(body, 0.7));
  m.box(0, 0.68, -0.68, 0.68, 0.4, 0.14, shade(body, 0.72));
  m.box(0, 0.62, 0.52, 0.66, 0.18, 0.22, shade(body, 0.8));
  tm.box(0, 0.72, 0.52, 0.5, 0.04, 0.18, C.gold);
  m.box(0, 0.74, 0.42, 0.09, 0.24, 0.09, C.darkMetal);
  steerWheel(sm, hex("#241F1A"), C.gold);
  // THE BED: widened flat deck, rail walls, heaped bullion pyramid
  m.box(0, 0.64, -1.18, 1.24, 0.08, 0.62, bed);
  for (const d of [-1, 1]) m.box(d * 0.6, 0.74, -1.18, 0.06, 0.16, 0.62, shade(bed, 1.15));
  for (const gx of [-0.32, 0, 0.32]) tm.box(gx, 0.76, -1.1, 0.28, 0.14, 0.4, C.gold);
  for (const gx of [-0.16, 0.16]) tm.box(gx, 0.9, -1.14, 0.28, 0.14, 0.36, shade(C.gold, 0.94));
  tm.box(0, 1.04, -1.18, 0.28, 0.14, 0.32, C.goldDeep); // crown bar
  for (const sx of [-0.5, 0, 0.5]) tm.cyl(sx, 0.48, -1.54, 0.06, 0, 0.2, 5, C.gold); // rear spikes
}

function kDimon(m, sm, tm, gm, body) {
  // FDIC-insured skepticism: an armored vault on wheels · slab skirts
  // over the tires, slit glass, chrome rivets and the great circular
  // vault door as the entire stern.
  loft(m, [
    { z: -1.35, y: 0.5, w: 1.18, h: 0.56 }, // armored stern
    { z: -0.4, y: 0.48, w: 1.24, h: 0.56 },
    { z: 0.55, y: 0.46, w: 1.14, h: 0.5 },
    { z: 1.2, y: 0.42, w: 0.96, h: 0.4 }, // sloped prow
    { z: 1.55, y: 0.36, w: 0.8, h: 0.24 }, // blunt nose
  ], body);
  // armored prow plate + slit grille + bumper bar
  m.box(0, 0.4, 1.58, 0.7, 0.2, 0.06, shade(body, 0.8));
  for (let v = 0; v < 3; v++) m.box(0, 0.31 + v * 0.09, 1.62, 0.5, 0.04, 0.03, hex("#0E1118"));
  tm.box(0, 0.24, 1.52, 1.0, 0.09, 0.14, C.chrome);
  m.sphere(0, 0.62, 1.5, 0.06, 3, 5, C.gray); // the pet rock, riding shotgun
  // rivet studs along the beltline
  for (const d of [-1, 1]) for (let rv = 0; rv < 5; rv++) {
    tm.sphere(d * 0.585, 0.68, 1.0 - rv * 0.48, 0.028, 2, 4, C.chrome);
  }
  // slit windshield cowl
  frustum(m, 0, 0.72, 0.58, 0.9, 0.4, 0.7, 0.22, 0.16, shade(body, 0.9));
  m.box(0, 0.83, 0.64, 0.56, 0.06, 0.06, hex("#7DE3FF")); // glass slit
  // hatch cockpit: dark tub rim proud of the armored deck (deck tops out
  // at ~0.78 here · a buried tub was a confirmed review defect)
  m.box(0, 0.73, -0.3, 0.66, 0.12, 0.85, hex("#10131C"));
  m.box(0, 0.5, -0.45, 0.6, 0.12, 0.55, shade(body, 0.7));
  m.box(0, 0.66, -0.68, 0.6, 0.32, 0.13, shade(body, 0.75));
  m.box(0, 0.74, 0.42, 0.08, 0.2, 0.08, C.darkMetal);
  steerWheel(sm, C.black, C.red);
  // THE VAULT DOOR: full circular bulkhead across the stern
  cylZ(tm, 0, 0.62, -1.44, 0.42, 0.14, 12, C.chrome);
  cylZ(tm, 0, 0.62, -1.52, 0.34, 0.05, 12, shade(C.chrome, 0.85));
  tm.box(0, 0.62, -1.56, 0.56, 0.055, 0.05, C.chrome); // handle spokes
  tm.box(0, 0.62, -1.56, 0.055, 0.56, 0.05, C.chrome);
  cylZ(tm, 0, 0.62, -1.58, 0.08, 0.06, 6, shade(C.chrome, 0.75)); // hub
  for (const hy of [0.46, 0.8]) m.box(0.54, hy, -1.36, 0.1, 0.12, 0.16, shade(body, 0.7)); // hinges
  gm.sphere(-0.5, 0.82, -1.32, 0.045, 2, 4, C.red); // vault alarm lamp (seated on the stern deck)
}

function kWarren(m, sm, tm, gm, body, accent) {
  // I have a plan for your lap time: the oversight sedan · two-tone
  // civic body, door lines, upright grille, a red stripe, and a wooden
  // gavel built in as the rear cross-member.
  loft(m, [
    { z: -1.4, y: 0.44, w: 0.98, h: 0.4 },
    { z: -0.6, y: 0.46, w: 1.1, h: 0.46 },
    { z: 0.45, y: 0.44, w: 1.04, h: 0.42 },
    { z: 1.15, y: 0.42, w: 0.94, h: 0.36 },
    { z: 1.55, y: 0.38, w: 0.7, h: 0.2 },
  ], body);
  // cream beltline + red oversight stripe + door line with chrome handle
  for (const d of [-1, 1]) {
    m.box(d * 0.53, 0.63, 0.0, 0.03, 0.09, 2.3, accent);
    m.box(d * 0.535, 0.54, 0.0, 0.02, 0.05, 2.3, C.red);
    m.box(d * 0.545, 0.44, -0.12, 0.015, 0.18, 0.66, shade(body, 1.15)); // door seam
    tm.box(d * 0.55, 0.56, 0.08, 0.02, 0.03, 0.12, C.chrome); // handle
  }
  // upright sedan grille + chrome bumper
  m.box(0, 0.42, 1.58, 0.56, 0.18, 0.06, shade(body, 0.75));
  for (const gx of [-0.18, 0, 0.18]) tm.box(gx, 0.42, 1.61, 0.04, 0.14, 0.03, C.chrome);
  tm.box(0, 0.27, 1.6, 0.9, 0.07, 0.12, C.chrome);
  // boxy glass cabin cowl: the hearing-room window
  frustum(m, 0, 0.65, 0.6, 0.92, 0.42, 0.74, 0.26, 0.2, accent);
  m.box(0, 0.79, 0.66, 0.6, 0.09, 0.07, hex("#9FB6CE")); // windshield band
  // bench seat in judicial maroon
  m.box(0, 0.5, -0.42, 0.72, 0.13, 0.6, shade(C.maroon, 0.75));
  m.box(0, 0.67, -0.68, 0.72, 0.36, 0.13, shade(C.maroon, 0.85));
  m.box(0, 0.72, 0.42, 0.08, 0.22, 0.08, C.darkMetal);
  steerWheel(sm, C.wood, C.gold);
  // THE GAVEL: head as the rear cross-member, handle raked skyward
  m.cylX(0, 0.72, -1.25, 0.15, 0.9, 8, C.wood);
  for (const d of [-0.38, 0.38]) m.cylX(d, 0.72, -1.25, 0.165, 0.08, 8, shade(C.wood, 0.7));
  m.box(0.3, 0.94, -1.12, 0.07, 0.36, 0.07, shade(C.wood, 0.85)); // raked handle
  m.box(0.3, 1.16, -1.04, 0.07, 0.26, 0.07, shade(C.wood, 0.8));
  m.sphere(0.3, 1.32, -0.99, 0.06, 2, 5, shade(C.wood, 0.7)); // pommel
  gm.box(0, 0.5, -1.415, 0.5, 0.07, 0.05, C.red); // strike-plate tail light (straddles the tail plane)
}

function kBuffett(m, sm, tm, gm, body, accent) {
  // Cherry Coke and skepticism: a soft-nosed value roadster with the
  // soda built into the tail. Cream paint, chrome grin, whitewalls.
  const cream = C.cream, red = hex("#C43040");
  loft(m, [
    { z: -1.3, y: 0.44, w: 0.9, h: 0.36 },
    { z: -0.5, y: 0.46, w: 1.12, h: 0.44 },
    { z: 0.5, y: 0.44, w: 1.06, h: 0.42 },
    { z: 1.1, y: 0.44, w: 0.92, h: 0.4 }, // round hood
    { z: 1.5, y: 0.42, w: 0.66, h: 0.3 },
    { z: 1.68, y: 0.4, w: 0.4, h: 0.18 }, // soft nose
  ], cream);
  // twin red speed stripes over the hood and tail
  m.box(0, 0.675, 1.0, 0.3, 0.025, 1.05, red);
  m.box(0, 0.675, -0.85, 0.3, 0.025, 0.7, red);
  // chrome grin grille + headlight eyes
  for (let g = 0; g < 4; g++) tm.box(0, 0.33 + g * 0.07, 1.68, 0.46 - g * 0.07, 0.03, 0.04, C.chrome);
  for (const d of [-1, 1]) tm.sphere(d * 0.32, 0.56, 1.6, 0.07, 3, 5, C.chrome);
  for (const d of [-1, 1]) m.box(d * 0.58, 0.3, 0.0, 0.16, 0.06, 1.3, shade(cream, 0.85)); // running boards
  // red leather bench + dash
  m.box(0, 0.5, -0.42, 0.72, 0.14, 0.6, shade(red, 0.75));
  m.box(0, 0.67, -0.68, 0.72, 0.36, 0.14, shade(red, 0.8));
  m.box(0, 0.6, 0.52, 0.6, 0.16, 0.2, shade(red, 0.65));
  m.box(0, 0.72, 0.42, 0.08, 0.22, 0.08, C.darkMetal);
  steerWheel(sm, C.wood, red);
  // THE CHERRY SODA TAIL: a giant striped cup faired into the deck
  frustum(m, 0, 0.4, -1.15, 0.8, 0.6, 0.62, 0.46, 0.2, cream); // fairing
  m.cyl(0, 0.56, -1.15, 0.3, 0.27, 0.5, 9, red);
  m.cyl(0, 0.8, -1.15, 0.285, 0.285, 0.1, 9, C.white); // stripe band
  m.cyl(0, 1.04, -1.15, 0.275, 0.29, 0.06, 9, shade(red, 1.15)); // lid
  m.box(0.1, 1.2, -1.2, 0.045, 0.3, 0.045, C.white); // raked straw
  m.box(0.16, 1.4, -1.24, 0.045, 0.16, 0.045, C.white);
  gm.sphere(-0.09, 1.14, -1.08, 0.055, 2, 5, C.red); // glowing cherry
}

function kCuban(m, sm, tm, gm, body) {
  // Shark Tank aero: a low courtside coupe · gill vents, a toothed mouth
  // intake and one big dorsal fin faired into the tail deck.
  const white = C.white;
  loft(m, [
    { z: -1.45, y: 0.42, w: 0.8, h: 0.3 },
    { z: -0.6, y: 0.44, w: 1.08, h: 0.4 },
    { z: 0.4, y: 0.42, w: 1.0, h: 0.38 },
    { z: 1.2, y: 0.38, w: 0.86, h: 0.28 },
    { z: 1.7, y: 0.33, w: 0.5, h: 0.14 }, // low wedge snout
  ], body);
  // center court stripe, fore and aft
  m.box(0, 0.635, 0.55, 0.2, 0.025, 1.5, white);
  m.box(0, 0.605, -1.0, 0.2, 0.025, 0.75, white);
  // shark mouth: dark intake + four teeth
  m.box(0, 0.3, 1.64, 0.56, 0.12, 0.08, hex("#101014"));
  for (let t = 0; t < 4; t++) {
    const tx = -0.195 + t * 0.13;
    fin(m, [tx - 0.045, 0.36, 1.69], [tx + 0.045, 0.36, 1.69], [tx, 0.27, 1.7], white);
  }
  // gill vents raked into the flanks
  for (const d of [-1, 1]) for (let g = 0; g < 3; g++) {
    m.box(d * 0.5, 0.46, 0.75 - g * 0.18, 0.04, 0.16, 0.06, hex("#101014"));
  }
  // cockpit + seat
  m.box(0, 0.5, -0.42, 0.62, 0.13, 0.6, shade(body, 0.7));
  m.box(0, 0.64, -0.68, 0.62, 0.32, 0.13, shade(body, 0.75));
  m.box(0, 0.58, 0.52, 0.56, 0.15, 0.2, shade(body, 0.8));
  m.box(0, 0.72, 0.42, 0.08, 0.22, 0.08, C.darkMetal);
  steerWheel(sm, C.black, white);
  // THE FIN: dorsal blade faired into the tail
  frustum(m, 0, 0.56, -1.05, 0.3, 0.7, 0.12, 0.5, 0.2, shade(body, 0.9)); // fairing
  fin(m, [0, 0.74, -0.8], [0, 1.34, -1.2], [0, 0.74, -1.45], hex("#3E6B8F"));
  tm.box(0, 0.42, -1.52, 0.7, 0.06, 0.08, C.chrome); // rear bumper blade
  gm.box(0, 0.5, -1.5, 0.3, 0.04, 0.04, C.cyan); // tail scanner light
}

function kBear2014(m, tm, gm, body) {
  // THE BEAR OF 2014 · frost sled rebuilt to the cast bar (2026-07-21 ·
  // the pre-overhaul stacked boxes were the last prims on the grid): a
  // lofted toboggan hull on wide blade runners, crystal ice growths, and
  // a polar bear with real mass · shoulder hump, muzzle, angry frost
  // eyes, a tattered scarf, claws over a chrome handlebar. Winter with a
  // silhouette you can read from the chase cam.
  const ice = body, iceLt = shade(body, 1.18), iceDk = shade(body, 0.74);
  const frost = hex("#A5F3FC");
  const fur = hex("#EDF2FA"), furDk = shade(hex("#EDF2FA"), 0.84), furLt = shade(hex("#EDF2FA"), 1.06);
  // toboggan hull: waisted mid, wide tail bed, kicked curl prow
  loft(m, [
    { z: -1.6, y: 0.42, w: 1.06, h: 0.3, c: iceDk },
    { z: -0.9, y: 0.44, w: 1.24, h: 0.36 },
    { z: 0.1, y: 0.42, w: 1.18, h: 0.34 },
    { z: 0.9, y: 0.48, w: 0.98, h: 0.3 },
    { z: 1.45, y: 0.62, w: 0.66, h: 0.18, c: iceLt },
    { z: 1.72, y: 0.78, w: 0.4, h: 0.1, c: iceLt }, // curl tip
  ], ice);
  m.box(0, 0.6, -0.15, 0.98, 0.05, 1.8, iceLt); // snow-packed deck bed
  // crevasse glow seams · winter has its own livery
  gm.box(0, 0.62, 0.7, 0.03, 0.02, 0.9, shade(frost, 0.7));
  for (const d of [-1, 1]) gm.box(d * 0.4, 0.5, -0.4, 0.025, 0.02, 1.1, shade(frost, 0.5));
  // blade runners OUTSIDE the wheel line: chrome ground edges, curled ski
  // tips, struts reaching out from the hull
  for (const d of [-1, 1]) {
    m.box(d * 0.86, 0.18, -0.1, 0.13, 0.2, 2.6, C.white);
    tm.box(d * 0.86, 0.08, -0.1, 0.09, 0.05, 2.7, C.chrome); // ground edge
    fin(m, [d * 0.86, 0.1, 1.2], [d * 0.86, 0.66, 1.68], [d * 0.86, 0.1, 1.56], C.white); // curled tip
    m.box(d * 0.72, 0.36, 0.7, 0.34, 0.09, 0.12, iceDk); // struts
    m.box(d * 0.72, 0.36, -0.85, 0.34, 0.09, 0.12, iceDk);
  }
  // crystal growths: cone clusters off the tail, shards on the flanks,
  // one lit crystal heart feeding the bloom
  for (const s of [[-0.3, 0.55, -1.32, 0.5], [0.3, 0.55, -1.38, 0.42], [0, 0.55, -1.52, 0.62], [-0.52, 0.52, -1.05, 0.3], [0.5, 0.52, -1.15, 0.34]]) {
    m.cyl(s[0], s[1], s[2], 0.1 + s[3] * 0.14, 0, s[3], 5, iceLt);
  }
  gm.octa(0, 1.02, -1.46, 0.09, frost);
  for (const d of [-1, 1]) m.cyl(d * 0.56, 0.56, 0.5, 0.09, 0, 0.3, 4, iceLt);
  // chrome handlebar on posts · bears do not use steering wheels
  tm.cylX(0, 0.78, 0.5, 0.045, 0.9, 6, C.chrome);
  for (const d of [-1, 1]) tm.box(d * 0.42, 0.68, 0.5, 0.08, 0.16, 0.08, C.darkMetal);
  // THE BEAR · mass first: haunches into belly into chest, the shoulder
  // hump that says apex predator, a lighter chest patch for depth
  m.sphere(0, 0.78, -0.55, 0.4, 5, 10, fur, { squashY: 0.8, smooth: true });
  m.sphere(0, 1.0, -0.35, 0.42, 5, 10, fur, { squashZ: 0.9, smooth: true });
  m.sphere(0, 1.3, -0.28, 0.36, 5, 10, furLt, { squashZ: 0.85, smooth: true });
  m.sphere(0, 1.52, -0.38, 0.3, 4, 9, fur, { squashY: 0.7, smooth: true }); // hump
  m.sphere(0, 1.18, -0.02, 0.2, 4, 8, furLt, { squashZ: 0.5, smooth: true }); // chest patch
  // head: sphere skull, protruding muzzle, black nose, heavy jaw, fangs.
  // Detail accents run STEEL BLUE · white-on-white vanishes against the
  // snow sky (confirmed on the boss-reveal shot), a cold shadow tone reads
  const shadowB = hex("#8FA6B8");
  m.sphere(0, 1.58, 0.05, 0.32, 5, 9, fur, { smooth: true });
  m.sphere(0, 1.5, 0.33, 0.17, 4, 8, fur, { squashY: 0.75, squashZ: 1.25, smooth: true });
  m.sphere(0, 1.55, 0.52, 0.06, 2, 5, C.black);
  m.box(0, 1.4, 0.3, 0.24, 0.09, 0.26, shadowB); // jaw
  for (const d of [-1, 1]) fin(m, [d * 0.08, 1.41, 0.43], [d * 0.04, 1.33, 0.43], [d * 0.005, 1.41, 0.43], C.white); // fangs
  // angry frost eyes in dark sockets under steel brows · the glow tells
  for (const d of [-1, 1]) {
    m.box(d * 0.12, 1.66, 0.29, 0.1, 0.075, 0.04, hex("#26303A")); // socket
    gm.box(d * 0.12, 1.66, 0.32, 0.08, 0.05, 0.04, frost);
    fin(m, [d * 0.04, 1.74, 0.33], [d * 0.24, 1.65, 0.33], [d * 0.21, 1.77, 0.28], shadowB); // brow wedge
  }
  // round ears with shaded inner shells
  for (const d of [-1, 1]) {
    m.sphere(d * 0.21, 1.87, -0.04, 0.11, 3, 6, fur, { smooth: true });
    m.sphere(d * 0.21, 1.88, 0.02, 0.06, 2, 5, shadowB, { smooth: true });
  }
  // tattered navy scarf: a wrap PROUD of the neck so it reads between
  // chest and chin head-on, plus two streamers whipping off to the side
  m.cyl(0, 1.4, 0.04, 0.31, 0.27, 0.17, 9, C.navy);
  fin(m, [0.22, 1.46, -0.18], [0.52, 1.3, -0.78], [0.3, 1.56, -0.5], C.navy);
  fin(m, [0.12, 1.44, -0.2], [0.34, 1.22, -0.66], [0.12, 1.5, -0.46], shade(C.navy, 0.8));
  // forelegs to the bar: chunky arms, dark paws, chrome-dark claws
  for (const d of [-1, 1]) {
    m.sphere(d * 0.32, 1.42, -0.18, 0.16, 3, 7, fur, { smooth: true });
    m.box(d * 0.38, 1.12, 0.14, 0.2, 0.46, 0.22, fur);
    m.sphere(d * 0.42, 0.84, 0.46, 0.13, 3, 6, furDk, { smooth: true });
    for (let k = -1; k <= 1; k++) cylZ(tm, d * 0.42 + k * 0.055, 0.8, 0.6, 0.018, 0.1, 4, hex("#4A4F5A"));
  }
}

function kHeadline(m, tm, gm, body, accent) {
  // THE HEADLINE · breaking-news van rebuilt to the cast bar (2026-07-21):
  // real cab/box architecture, a trussed roof dish, an emissive ticker
  // band, front-page panels on the flanks and a studio camera riding the
  // roof · the media never shows a face, only a lens.
  const white = body, red = accent;
  const grayLt = shade(body, 0.92), gray = shade(body, 0.78);
  const glass = hex("#7DE3FF");
  // chassis frame under everything, bumper nose
  loft(m, [
    { z: -1.55, y: 0.38, w: 1.2, h: 0.22 },
    { z: 1.15, y: 0.38, w: 1.24, h: 0.24 },
    { z: 1.62, y: 0.42, w: 0.9, h: 0.16, c: grayLt },
  ], gray);
  // the box: tall broadcast body, roof cap, panel skirt
  frustum(m, 0, 0.5, -0.55, 1.26, 1.9, 1.18, 1.82, 0.86, white);
  m.box(0, 1.4, -0.55, 1.2, 0.08, 1.84, grayLt);
  // cab: leaned mass with a raked glass windshield + side glass + mirrors
  frustum(m, 0, 0.5, 0.85, 1.22, 0.95, 1.0, 0.55, 0.52, white, { dz: -0.12 });
  frustum(m, 0, 0.68, 1.2, 1.02, 0.08, 0.86, 0.05, 0.32, glass, { dz: -0.13, alpha: A_GLASS }); // raked windshield (K19 glass band)
  for (const d of [-1, 1]) {
    m.box(d * 0.57, 0.84, 0.68, 0.05, 0.22, 0.44, glass);
    tm.box(d * 0.65, 0.94, 1.04, 0.05, 0.1, 0.06, C.chrome); // mirrors
  }
  for (const d of [-1, 1]) gm.box(d * 0.32, 0.54, 1.72, 0.22, 0.1, 0.05, hex("#FFE9A8")); // headlamps
  tm.box(0, 0.4, 1.74, 1.0, 0.12, 0.08, C.chrome); // bumper blade
  // the red wrap with real depth · band on the box, slash on the cab
  m.box(0, 0.76, -0.55, 1.3, 0.18, 1.86, red);
  m.box(0, 0.72, 0.88, 1.26, 0.14, 0.6, shade(red, 0.94));
  for (const d of [-1, 1]) fin(m, [d * 0.635, 0.9, 0.62], [d * 0.635, 1.08, 0.18], [d * 0.635, 0.9, 0.08], red);
  // LED ticker: emissive band proud of the box top, segment breaks
  gm.box(0, 1.28, -0.55, 1.28, 0.07, 1.9, shade(red, 1.05));
  for (const d of [-1, 1]) for (let i = 0; i < 5; i++) m.box(d * 0.645, 1.28, -1.15 + i * 0.3, 0.02, 0.09, 0.05, gray);
  // FRONT PAGE flanks: white page, black masthead, columns of gray type,
  // a red ON AIR pill at the tail corner
  for (const d of [-1, 1]) {
    m.box(d * 0.63, 1.0, -0.5, 0.04, 0.42, 1.5, C.white);
    m.box(d * 0.655, 1.15, -0.5, 0.012, 0.08, 1.44, C.black);
    for (let i = 0; i < 3; i++) m.box(d * 0.655, 1.04 - i * 0.06, -0.5 - i * 0.08, 0.012, 0.03, 1.3 - i * 0.18, gray);
    gm.box(d * 0.655, 0.93, -1.15, 0.015, 0.06, 0.18, red);
  }
  // trussed roof dish: legs, gimbal plate, chrome bowl, feed horn + tip
  for (const d of [-1, 1]) m.box(d * 0.15, 1.56, -0.75, 0.05, 0.32, 0.05, C.metal);
  m.box(0, 1.72, -0.75, 0.42, 0.05, 0.42, C.darkMetal);
  tm.cyl(0, 1.74, -0.75, 0.07, 0.05, 0.1, 6, C.metal);
  tm.cyl(0, 1.82, -0.75, 0.06, 0.38, 0.15, 10, C.chrome, { capTop: false });
  m.box(0, 2.0, -0.75, 0.04, 0.18, 0.04, C.metal);
  gm.sphere(0, 2.1, -0.75, 0.045, 2, 5, red); // feed tip
  // roof beacon + the studio camera riding shotgun: lens, glass, REC lamp
  m.box(0, 1.47, 0.28, 0.44, 0.1, 0.22, C.darkMetal);
  gm.sphere(0, 1.57, 0.28, 0.09, 3, 6, red); // live beacon
  m.box(0.32, 1.52, 0.28, 0.2, 0.18, 0.32, C.darkMetal); // camera body
  cylZ(tm, 0.32, 1.52, 0.5, 0.07, 0.12, 8, C.chrome); // lens barrel
  cylZ(gm, 0.32, 1.52, 0.58, 0.05, 0.02, 8, glass); // lens glass
  gm.box(0.32, 1.64, 0.2, 0.03, 0.03, 0.03, red); // REC lamp
  m.box(0.32, 1.64, 0.32, 0.06, 0.04, 0.18, C.black); // carry handle
  // rear doors: seam, hinges, latch, ON AIR sign, corner whip antenna
  m.box(0, 0.9, -1.48, 0.02, 0.72, 0.02, gray);
  for (const yy of [0.68, 1.1]) for (const d of [-1, 1]) tm.box(d * 0.5, yy, -1.48, 0.06, 0.1, 0.03, C.chrome);
  tm.box(0.14, 0.84, -1.49, 0.1, 0.03, 0.03, C.chrome);
  gm.box(0, 1.16, -1.49, 0.5, 0.09, 0.03, red);
  tm.cyl(-0.5, 1.44, -1.3, 0.015, 0.01, 0.5, 4, C.metal);
  gm.sphere(-0.5, 1.96, -1.3, 0.03, 2, 5, red);
}

// memoized per driver: palettes are fixed roster data, so the baked
// geometry never varies (the title-screen prewarm walks the roster)
const KART_MESH_CACHE = {};
export function buildKartMesh(driverId, palette) {
  if (!KART_MESH_CACHE[driverId]) KART_MESH_CACHE[driverId] = buildKartMeshUncached(driverId, palette);
  return KART_MESH_CACHE[driverId];
}
// drop a baked mesh so a live palette change (Golden Satoshi) rebuilds it
export function clearKartMesh(driverId) { delete KART_MESH_CACHE[driverId]; }

function buildKartMeshUncached(driverId, palette) {
  const m = meshBuilder(); // paint + cloth + rubber (soft specular)
  const sm = meshBuilder(); // steering submesh: wheel + forearms + gloves
  const tm = meshBuilder(); // bright-metal trim: drawn with a hot specular
  const gm = meshBuilder(); // emissive kit: drawn glowing, feeds the bloom
  const hm = meshBuilder(); // hair + headwear: drawn MATTE (near-zero
  // spec) · hair with car-paint glint reads as a chrome helmet
  const am = meshBuilder(); // arms: forearms + mitts + cuffs · steer with
  // the wheel in-race, but animate FREE of it for podium celebrations
  const body = hex(palette.body);
  const accent = hex(palette.accent);

  let hasHead = true;
  let flames = null; // per-machine boost flame anchors [[x,y,z], ...]
  switch (driverId) {
    case "saylor":
      kSaylor(m, sm, tm, gm, body);
      drvSaylor(m, sm, am, tm);
      flames = [[-0.3, 0.56, -1.44], [0.3, 0.56, -1.44]];
      break;
    case "phong":
      kPhong(m, sm, tm, gm, body, accent);
      drvPhong(m, sm, am, tm, gm);
      flames = [[0, 0.62, -1.78]]; // one big booster
      break;
    case "wizard":
      kWizard(m, sm, tm, gm, body, accent);
      drvWizard(m, sm, am);
      flames = [[0, 0.66, -1.68]]; // spell wake off the hat cone
      break;
    case "mallers":
      kMallers(m, sm, tm, gm, body);
      drvMallers(m, sm, am, gm);
      flames = [[-0.19, 0.56, -1.58], [0.19, 0.56, -1.58]];
      break;
    case "bukele":
      kBukele(m, sm, tm, gm, body);
      drvBukele(m, sm, am);
      flames = [[-0.3, 0.32, -1.76], [0.3, 0.32, -1.76]]; // board-tail jets
      break;
    case "satoshi":
      kSatoshi(m, sm, am, tm, gm, hm, body, accent);
      flames = [[0, 0.46, -1.6]];
      hasHead = false;
      break;
    case "schiff":
      kSchiff(m, sm, tm, gm, body);
      drvSchiff(m, sm, am, tm);
      flames = [[-0.5, 1.3, -0.95], [0.5, 1.3, -0.95]]; // the stacks blow
      break;
    case "dimon":
      kDimon(m, sm, tm, gm, body);
      drvDimon(m, sm, am);
      flames = [[-0.36, 0.4, -1.42], [0.36, 0.4, -1.42]];
      break;
    case "warren":
      kWarren(m, sm, tm, gm, body, accent);
      drvWarren(m, sm, am, tm);
      flames = [[-0.3, 0.48, -1.5], [0.3, 0.48, -1.5]];
      break;
    case "buffett":
      kBuffett(m, sm, tm, gm, body, accent);
      drvBuffett(m, sm, am);
      flames = [[-0.32, 0.46, -1.42], [0.32, 0.46, -1.42]];
      break;
    case "cuban":
      kCuban(m, sm, tm, gm, body);
      drvCuban(m, sm, am);
      flames = [[-0.26, 0.5, -1.52], [0.26, 0.5, -1.52]];
      break;
    case "bear2014":
      kBear2014(m, tm, gm, body);
      hasHead = false;
      flames = [[-0.3, 0.55, -1.68], [0.3, 0.55, -1.68]]; // frost vents
      break;
    case "headline":
      kHeadline(m, tm, gm, body, accent);
      hasHead = false;
      flames = [[-0.35, 0.36, -1.62]]; // single tailpipe
      break;
    default: {
      // unknown id: bare hull, no pilot (unreachable for the shipped roster)
      loft(m, [
        { z: -1.4, y: 0.44, w: 0.9, h: 0.36 },
        { z: 0.2, y: 0.44, w: 1.05, h: 0.4 },
        { z: 1.5, y: 0.4, w: 0.5, h: 0.16 },
      ], body);
      steerWheel(sm, C.black, accent);
      hasHead = false;
    }
  }

  // final-boss proportions: Schiff runs a bigger head + heavier frame
  const headScale = driverId === "schiff" ? 1.16 : 1;

  // hair / hat / beard silhouette around the textured head
  if (hasHead && FACE_SPECS[driverId]) hairMesh(hm, driverId, headScale);

  const w = buildWheel(WHEEL_KITS[driverId] || {}, palette);
  return {
    body: m.build(),
    trim: tm.raw.pos.length ? tm.build() : null,
    hair: hm.raw.pos.length ? hm.build() : null,
    arms: am.raw.pos.length ? am.build() : null,
    glow: gm.raw.pos.length ? gm.build() : null,
    wheel: w.tire.build(),
    // hub/rim submesh · metal/specPow are per-draw uniforms, so the rim
    // only reads as machined metal against the matte tire when it is its
    // own draw. EVERY consumer of `wheel` MUST also draw `wheelHub` at the
    // same wheel matrix or the kart loses its rims entirely: `wheel` is now
    // rubber only. kartGL + drawKart + the podium/ghost/shadow paths in
    // race.js carry this channel alongside the trim submesh.
    wheelHub: w.hub.raw.pos.length ? w.hub.build() : null,
    // steering assembly: rotate around the column at (0, y, 0.44) by the
    // live steer input · empty for the special karts (sled, van)
    steer: sm.raw.pos.length ? sm.build() : null,
    flames,
    head: hasHead
      ? {
        offset: [0, HEAD.y + (headScale - 1) * HEAD.r, HEAD.z],
        r: HEAD.r * headScale,
        // 9x14 facets: rounder skull that still reads low-poly · pairs
        // with the 2x face texture so caricatures hold up close-up
        sphere: sphereUV(HEAD.r * headScale, 12, 18),
      }
      : null,
  };
}

// Wheel anchor points in kart local space (x, y, z).
export const WHEEL_POS = [
  [-0.68, 0.34, 0.82], [0.68, 0.34, 0.82],
  [-0.68, 0.34, -0.78], [0.68, 0.34, -0.78],
];

// ---------------------------------------------------------------------------
// PROP BUILDERS · each returns mesh data in local space, y=0 at ground.
// Shared per track; instanced with model matrices.
// ---------------------------------------------------------------------------

// Grandstand seating plan · shared by grandstand() and the crowd builders
// so a crowd instanced with the SAME model matrix as its stand lands seated
// on the benches. y = bench top, z steps AWAY from the road (+Z faces the
// road, the propModel convention).
const STAND_ROWS = [
  { y: 0.95, z: 1.35 },
  { y: 1.95, z: -0.35 },
  { y: 2.95, z: -2.05 },
];
const STAND_W = 13; // bench span along X

// ~69 spectators on the STAND_ROWS benches as ONE mesh (a single draw).
// frame flips which half throws arms up: crowdA(frame 0) / crowdB(frame 1)
// alternated by the draw loop are the classic two-frame popcorn crowd.
// Everything keys off hash01(seed·k + n) so A and B build IDENTICAL people
// (position, shirt, skin, hair, laser eyes) differing only in pose parity.
// K14-FIX: TWO staggered ranks per tier (visual fill past 70% so the stand
// reads as one vibrating mass, not shelved figures) and arms visible in
// BOTH poses · down-arms hang with an air gap off the torso and skin
// hands, raised arms throw fists past the head line · plus hair caps on
// most heads, so the glyph never collapses back to a capped bottle.
function crowdMesh(seed, frame) {
  const m = meshBuilder();
  const oranges = ["#F7931A", "#D97706", "#FFB84D"];
  const civvies = ["#F5F5F7", "#2A2A31", "#1E3A5F", "#6E6E76", "#7C2D3E"];
  const skins = ["#E8B08C", "#C98850", "#8C5A33"];
  const hairs = ["#1E1B18", "#3B2E22", "#6B4A2B", "#8A8D94", "#D9C08C"];
  const perRank = 12;
  for (let r = 0; r < 3; r++) {
    const row = STAND_ROWS[r];
    for (let rank = 0; rank < 2; rank++) {
      // back rank runs one short and its centering shifts a half slot, so
      // it plugs the gaps between the front-rank torsos
      const nIn = perRank - rank;
      for (let i = 0; i < nIn; i++) {
        const n = r * 40 + rank * 20 + i;
        const x = (i - (nIn - 1) / 2) * (STAND_W / perRank) + (hash01(seed * 5 + n) - 0.5) * 0.2;
        const up = (i + rank + r + frame) % 2 === 0;
        const y = row.y + rank * 0.24 + (up ? 0.16 : 0); // poppers hop off the bench
        const z = row.z - 0.28 - rank * 0.54;
        const pick = hash01(seed * 3 + n);
        const sh = hex(pick < 0.55 // orange-weighted home crowd
          ? oranges[Math.floor(pick * 9) % 3]
          : civvies[Math.floor(pick * 17) % civvies.length]);
        m.box(x, y + 0.3, z, 0.44, 0.6, 0.26, sh); // torso
        const skin = hex(skins[Math.floor(hash01(seed * 7 + n) * 3) % 3]);
        m.sphere(x, y + 0.78, z, 0.17, 3, 5, skin);
        if (hash01(seed * 17 + n) > 0.24) { // hair cap on most heads
          m.box(x, y + 0.9, z - 0.03, 0.3, 0.11, 0.3, hex(hairs[Math.floor(hash01(seed * 19 + n) * 5) % 5]));
        }
        if (hash01(seed * 13 + n) > 0.93) { // a couple of laser-eye heads
          for (const s of [-1, 1]) m.box(x + s * 0.06, y + 0.8, z + 0.16, 0.05, 0.05, 0.14, hex("#FF2D2D"));
        }
        if (up) {
          for (const s of [-1, 1]) { // thrown V: out, up, skin fist on top
            m.box(x + s * 0.32, y + 0.6, z, 0.18, 0.09, 0.09, sh);
            m.box(x + s * 0.39, y + 0.84, z, 0.09, 0.4, 0.09, sh);
            m.box(x + s * 0.39, y + 1.08, z, 0.09, 0.09, 0.09, skin);
          }
        } else {
          for (const s of [-1, 1]) { // hanging clear of the torso + hand
            m.box(x + s * 0.33, y + 0.34, z, 0.09, 0.4, 0.1, shade(sh, 0.82));
            m.box(x + s * 0.33, y + 0.11, z, 0.08, 0.09, 0.08, skin);
          }
        }
      }
    }
  }
  return m.build();
}

export const PROP_BUILDERS = {
  // waterfall (map pass 2026-07-16): cliff frame + stepped water sheets
  // in streaked blues + a foam pool · N64-stylized static falls; the
  // proximity mist particles ride race.js (track.waterfalls positions)
  waterfall(seed) {
    const m = meshBuilder();
    const rock = hex("#5C5A56");
    const h = 8 + hash01(seed) * 2.5;
    // cliff shoulders framing the falls
    m.box(-2.5, h * 0.45, -0.4, 1.9, h * 0.9, 2.6, shade(rock, 0.95));
    m.box(2.5, h * 0.45, -0.4, 1.9, h * 0.9, 2.6, rock);
    m.box(0, h * 0.94, -1.0, 5.6, h * 0.16, 2.0, shade(rock, 1.05)); // crown ledge
    // stepped water sheets: streak columns in alternating blues
    const cols = ["#BFE4F5", "#8CC7E8", "#E8F6FD", "#9ED4EE", "#CFEAF8"];
    for (let i = 0; i < 5; i++) {
      const x = -1.4 + i * 0.7;
      const wob = hash01(seed * 3 + i) * 0.3;
      m.box(x, h * 0.52, 0.35 + wob * 0.2, 0.62, h * 0.86, 0.24 + wob, hex(cols[i % cols.length]));
    }
    m.box(0, h * 0.9, 0.5, 3.4, 0.5, 0.5, hex("#F2FAFE")); // lip whitewater
    // foam pool
    m.cyl(0, 0.18, 1.2, 2.9, 3.3, 0.32, 10, hex("#EAF7FD"), { capTop: true });
    m.cyl(0, 0.1, 1.4, 3.6, 3.9, 0.18, 10, hex("#A9D8EF"), { capTop: true });
    for (let i = 0; i < 4; i++) {
      const a = hash01(seed * 11 + i) * TAU;
      m.sphere(Math.cos(a) * 2.2, 0.35, 1.2 + Math.sin(a) * 1.4, 0.32, 2, 5, hex("#F4FBFF"));
    }
    return m.build();
  },
  palm(seed) {
    const m = meshBuilder();
    const lean = (hash01(seed) - 0.5) * 0.5;
    const h = 5 + hash01(seed * 7) * 2.5;
    const seg = 4;
    for (let i = 0; i < seg; i++) {
      const y0 = (i / seg) * h, y1 = ((i + 1) / seg) * h;
      const x = lean * y0 * 0.4, x1 = lean * y1 * 0.4;
      m.box((x + x1) / 2, (y0 + y1) / 2, 0, 0.42 - i * 0.06, y1 - y0, 0.42 - i * 0.06, shade(hex("#8A5A2B"), 0.9 + 0.05 * (i % 2)));
    }
    const tx = lean * h * 0.4;
    const leaf = hex("#3E9B4F");
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + hash01(seed * 13) * 0.7;
      const dx = Math.cos(a), dz = Math.sin(a);
      m.pushTri(
        [tx, h, 0],
        [tx + dx * 2.6, h + 0.4, dz * 2.6],
        [tx + dx * 1.4 - dz * 0.5, h + 0.85, dz * 1.4 + dx * 0.5],
        shade(leaf, 0.85 + hash01(seed + i) * 0.3),
      );
      m.pushTri(
        [tx, h, 0],
        [tx + dx * 1.4 - dz * 0.5, h + 0.85, dz * 1.4 + dx * 0.5],
        [tx + dx * 2.6, h + 0.4, dz * 2.6],
        shade(leaf, 0.8 + hash01(seed + i) * 0.3),
      );
    }
    // coconuts: tiny orange coins (sats up in the tree)
    m.sphere(tx + 0.3, h - 0.1, 0.2, 0.16, 3, 5, hex("#F7931A"));
    m.sphere(tx - 0.25, h - 0.15, -0.15, 0.14, 3, 5, hex("#D97706"));
    return m.build();
  },

  pizzaSlice() {
    // giant pizza slice leaning on its crust: THE genesis meme prop
    const m = meshBuilder();
    const cheese = hex("#F6C453"), crust = hex("#B8763B"), pep = hex("#C43E2F");
    // wedge slice lying at a jaunty angle
    m.pushTri([0, 2.6, 0], [-2.2, 0.15, 1.6], [2.2, 0.15, 1.6], cheese);
    m.pushTri([0, 2.6, 0.28], [2.2, 0.15, 1.88], [-2.2, 0.15, 1.88], shade(cheese, 0.9));
    // edges
    m.quad([-2.2, 0.15, 1.6], [0, 2.6, 0], [0, 2.6, 0.28], [-2.2, 0.15, 1.88], shade(cheese, 0.8));
    m.quad([0, 2.6, 0], [2.2, 0.15, 1.6], [2.2, 0.15, 1.88], [0, 2.6, 0.28], shade(cheese, 0.8));
    // crust bar along the wide end
    m.cylX(0, 0.35, 1.74, 0.35, 4.4, 7, crust);
    // pepperoni
    m.sphere(-0.7, 1.5, 0.75, 0.3, 3, 6, pep, { squashY: 0.4 });
    m.sphere(0.65, 1.05, 1.05, 0.32, 3, 6, pep, { squashY: 0.4 });
    m.sphere(0, 1.95, 0.42, 0.26, 3, 6, pep, { squashY: 0.4 });
    return m.build();
  },

  lighthouse() {
    const m = meshBuilder();
    m.cyl(0, 0, 0, 1.5, 1.0, 7, 9, C.white);
    m.cyl(0, 2.2, 0, 1.15, 0.85, 2.2, 9, hex("#E5484D"));
    m.cyl(0, 4.4, 0, 0.95, 0.8, 2.2, 9, C.white);
    m.cyl(0, 6.6, 0, 0.9, 0.7, 0.5, 9, C.darkMetal);
    m.box(0, 7.5, 0, 1.3, 1.0, 1.3, hex("#F7931A"), { alpha: 1 }); // lamp (emissive at draw)
    m.cyl(0, 8.0, 0, 1.0, 0.0, 0.9, 7, C.darkMetal);
    return m.build();
  },

  genesisArch() {
    // Block 0 arch: two mono-liths + lintel, terminal green engraving strip
    const m = meshBuilder();
    const stone = hex("#4A4E58");
    m.box(-4.6, 3.0, 0, 1.6, 6.0, 1.6, stone);
    m.box(4.6, 3.0, 0, 1.6, 6.0, 1.6, stone);
    m.box(0, 6.5, 0, 11.4, 1.6, 1.9, shade(stone, 1.1));
    m.box(0, 6.5, 1.0, 10.6, 0.8, 0.1, hex("#33FF66")); // glowing strip
    m.box(-4.6, 3.0, 0.85, 0.9, 4.8, 0.1, hex("#1E9E4A"));
    m.box(4.6, 3.0, 0.85, 0.9, 4.8, 0.1, hex("#1E9E4A"));
    return m.build();
  },

  terminal(seed) {
    // green-on-black terminal monolith
    const m = meshBuilder();
    const h = 2.6 + hash01(seed) * 1.6;
    m.box(0, h / 2, 0, 2.2, h, 0.7, C.darkMetal);
    m.box(0, h * 0.62, 0.38, 1.8, h * 0.55, 0.06, hex("#0B2E17"));
    for (let i = 0; i < 4; i++) {
      m.box(-0.3 + hash01(seed + i) * 0.5, h * 0.45 + i * h * 0.1, 0.42, 1.0 - hash01(seed * 3 + i) * 0.5, 0.07, 0.02, hex("#33FF66"));
    }
    return m.build();
  },

  container(seed) {
    // harbor shipping container
    const m = meshBuilder();
    const cols = [hex("#B5462F"), hex("#2F6FB5"), hex("#3E8E5A"), hex("#B58A2F")];
    const c = cols[Math.floor(hash01(seed) * cols.length) % cols.length];
    m.box(0, 1.3, 0, 6.0, 2.6, 2.5, c);
    for (let i = -2; i <= 2; i++) m.box(i * 1.15, 1.3, 1.28, 0.16, 2.4, 0.06, shade(c, 0.8));
    return m.build();
  },

  buoy() {
    const m = meshBuilder();
    m.cyl(0, 0, 0, 0.9, 0.5, 1.4, 7, hex("#E5484D"));
    m.cyl(0, 1.4, 0, 0.2, 0.16, 1.0, 5, C.metal);
    // K14-FIX de-alias: a plated marine lantern replaces the old orange
    // ball · a warm sphere capping a red body read as a giant bottle in
    // the same countdown frames as the crowds
    m.box(0, 2.32, 0, 0.3, 0.08, 0.3, C.darkMetal); // lantern base plate
    m.box(0, 2.5, 0, 0.24, 0.28, 0.24, hex("#FFF4D6")); // beacon lamp
    m.box(0, 2.7, 0, 0.34, 0.08, 0.34, C.darkMetal); // rain cap
    return m.build();
  },

  volcano(seed) {
    // island stratovolcano · dark cone, lava streaks, a glowing crater
    // that feeds the ember emitter riding the same prop entry
    const m = meshBuilder();
    const rock = hex("#3B3230");
    const lava = hex("#FF7A2F");
    m.cyl(0, 0, 0, 11, 3.4, 14, 9, rock, { capTop: false });
    m.cyl(0, 13.6, 0, 3.6, 2.6, 1.6, 9, shade(rock, 0.8), { capTop: false });
    m.cyl(0, 14.9, 0, 2.5, 2.2, 0.5, 8, hex("#181114"), { capTop: false });
    m.cyl(0, 15.1, 0, 2.1, 1.9, 0.3, 8, lava, { capTop: true, topColor: shade(lava, 1.25) });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + hash01(seed + i) * 0.5;
      const w = 0.5 + hash01(seed + i * 3) * 0.5;
      m.quad(
        [Math.cos(a) * 3.4, 13.4, Math.sin(a) * 3.4],
        [Math.cos(a + 0.05) * 3.4, 13.4, Math.sin(a + 0.05) * 3.4],
        [Math.cos(a + 0.05) * (10 - w), 0.6, Math.sin(a + 0.05) * (10 - w)],
        [Math.cos(a) * (10 + w), 0.4, Math.sin(a) * (10 + w)],
        shade(lava, 0.55 + hash01(seed + i * 7) * 0.3),
      );
    }
    return m.build();
  },

  wreckShip(seed) {
    // the wreck of gox · a container ship going down stern-first, baked
    // pitch (instances only yaw) · hull loft dives, castle stays proud
    const m = meshBuilder();
    const hull = hex("#5A3A32");
    const deck = shade(hull, 1.3);
    loft(m, [
      { z: -13, y: -4.5, w: 6.5, h: 3.4, c: shade(hull, 0.7) },
      { z: -5, y: -1.6, w: 8.2, h: 4.2 },
      { z: 4, y: 1.2, w: 8.0, h: 4.4 },
      { z: 11, y: 3.2, w: 6.2, h: 4.0 },
      { z: 14.5, y: 4.4, w: 2.4, h: 2.4, c: deck },
    ], hull);
    m.box(0, 5.6, 8.5, 5.4, 3.4, 3.2, hex("#D8DBE2")); // bridge castle
    m.box(0, 7.7, 8.5, 5.8, 0.5, 3.6, hex("#9AA1AC"));
    for (const d of [-1, 1]) m.box(d * 1.7, 8.4, 8.2, 0.3, 1.2, 0.3, hex("#C7CBD2")); // masts
    const cols = ["#E5484D", "#22D3EE", "#F7931A", "#4ADE80", "#8E8E98"];
    for (let i = 0; i < 7; i++) {
      const cz = 5.5 - i * 2.1;
      const cy = 3.2 - i * 0.75 + hash01(seed + i) * 0.5;
      m.box((hash01(seed + i * 5) - 0.5) * 3.6, cy, cz, 2.6, 1.5, 1.9, hex(cols[i % cols.length]));
    }
    m.box(0, 1.2, -10.5, 0.5, 6.5, 0.5, shade(hull, 0.8)); // drowned crane mast
    return m.build();
  },

  timechainArc() {
    // THE TIMECHAIN · a floating band of lit blocks arcing across the
    // whole sky, one chained ledger overhead. Upper quarter only (no legs
    // to clip terrain) · race.js spins it imperceptibly slowly.
    const m = meshBuilder();
    const R = 120;
    const N = 15;
    for (let i = 0; i < N; i++) {
      const a = Math.PI * 0.28 + (i / (N - 1)) * Math.PI * 0.44;
      const x = Math.cos(a) * R, y = Math.sin(a) * R * 0.55;
      const blockC = i % 3 === 0 ? hex("#FFB84D") : hex("#F7931A");
      m.box(x, y, 0, 6.5, 4.6, 3.2, blockC);
      m.box(x, y, 0, 7.3, 1.3, 1.3, shade(blockC, 1.3));
      if (i < N - 1) {
        const a2 = Math.PI * 0.28 + ((i + 1) / (N - 1)) * Math.PI * 0.44;
        const x2 = Math.cos(a2) * R, y2 = Math.sin(a2) * R * 0.55;
        m.quad([x, y + 0.6, -0.5], [x2, y2 + 0.6, -0.5], [x2, y2 - 0.6, -0.5], [x, y - 0.6, -0.5], hex("#D97706"));
        m.quad([x, y - 0.6, 0.5], [x2, y2 - 0.6, 0.5], [x2, y2 + 0.6, 0.5], [x, y + 0.6, 0.5], hex("#D97706"));
      }
    }
    return m.build();
  },

  auroraCurtain(seed) {
    // hanging light curtain · wavy translucent ribbons for the summit sky
    const m = meshBuilder();
    const g = hex("#4ADE80");
    for (let r = 0; r < 3; r++) {
      const zoff = (r - 1) * 6 + hash01(seed + r) * 3;
      const H = 26 + hash01(seed + r * 7) * 10;
      for (let i = 0; i < 8; i++) {
        const x0 = (i - 4) * 5 + Math.sin(i * 1.3 + seed + r) * 2.2;
        const x1 = (i - 3) * 5 + Math.sin((i + 1) * 1.3 + seed + r) * 2.2;
        const c = shade(g, 0.75 + 0.4 * hash01(seed + i + r * 11));
        m.quad([x0, H, zoff], [x1, H, zoff], [x1, 0, zoff + 1.2], [x0, 0, zoff + 1.2], c, 0.34);
        m.quad([x0, 0, zoff + 1.2], [x1, 0, zoff + 1.2], [x1, H, zoff], [x0, H, zoff], shade(c, 0.8), 0.22);
      }
    }
    return m.build();
  },

  openingBell() {
    // the opening bell · a colossal exchange bell on an A-frame, gold rim
    // hot enough to read from across the bowl
    const m = meshBuilder();
    const frame = hex("#3A3E48");
    for (const d of [-1, 1]) {
      m.box(d * 6.5, 5.5, 0, 1.4, 11, 1.4, frame);
      m.box(d * 4.2, 11.6, 0, 6.4, 1.1, 1.1, frame);
    }
    m.box(0, 12.4, 0, 4.2, 0.9, 1.6, shade(frame, 1.2));
    m.cyl(0, 10.6, 0, 0.5, 0.5, 1.2, 6, hex("#6E5836"));
    dome(m, 0, 9.2, 0, 3.8, 0, 1.9, 5, 12, hex("#F5C542"), { squashY: 1.25 });
    m.cyl(0, 4.6, 0, 4.15, 4.3, 0.9, 12, hex("#C99A1E"));
    m.sphere(0, 4.1, 0, 0.75, 3, 6, hex("#7A5A12"), { smooth: true }); // clapper
    return m.build();
  },

  holoB(seed) {
    // giant holographic bitcoin sign floating over the city · pure glow
    // geometry (drawn emissive), spun slowly by race.js
    const m = meshBuilder();
    const c = hex("#F7931A");
    const lit = shade(c, 1.0 + hash01(seed) * 0.15);
    m.box(-2.6, 0, 0, 1.3, 12.5, 1.1, lit); // spine
    for (const yy of [4.6, -0.4, -5.2]) m.box(0.4, yy, 0, 5.6, 1.25, 1.1, lit); // rungs
    for (const yy of [2.2, -2.9]) m.box(3.2, yy, 0, 1.3, 3.6, 1.1, lit); // bowls
    for (const d of [-1, 1]) {
      m.box(-0.6 + d * 1.4, 7.2, 0, 0.9, 2.2, 0.9, shade(lit, 1.2)); // overshoot strokes
      m.box(-0.6 + d * 1.4, -7.8, 0, 0.9, 2.2, 0.9, shade(lit, 1.2));
    }
    return m.build();
  },

  bearFin(seed) {
    // something circles the water · a bear-market dorsal fin cutting a
    // white wake (epic-scale pass 2026-07-21). Built OFFSET from origin so
    // race.js's slow instance yaw sweeps it in a real hunting circle
    // (colossal pass) · dark swept blade, pale trailing edge, foam V.
    const m = meshBuilder();
    const s = 1.1 + hash01(seed) * 0.6;
    const ox = 2.6; // orbit radius
    const dk = hex("#2E3440");
    fin(m, [ox, 0.05, -1.0 * s], [ox, 1.6 * s, 0.2 * s], [ox, 0.05, 0.85 * s], dk);
    fin(m, [ox, 0.05, 0.55 * s], [ox, 0.95 * s, 0.35 * s], [ox, 0.05, 0.85 * s], shade(dk, 1.4)); // trailing edge
    fin(m, [ox, 0.05, -2.1 * s], [ox, 0.4 * s, -1.2 * s], [ox, 0.05, -0.8 * s], shade(dk, 0.8)); // tail ripple
    const foam = hex("#EAF4F8");
    m.quad([ox - 0.16, 0.03, -0.9 * s], [ox - 1.1, 0.03, -2.6 * s], [ox - 0.5, 0.03, -2.7 * s], [ox - 0.05, 0.03, -1.0 * s], foam);
    m.quad([ox + 0.05, 0.03, -1.0 * s], [ox + 0.5, 0.03, -2.7 * s], [ox + 1.1, 0.03, -2.6 * s], [ox + 0.16, 0.03, -0.9 * s], foam);
    m.cyl(ox, 0.0, 0, 0.55 * s, 0.6 * s, 0.05, 7, shade(foam, 0.92), { capBot: false });
    return m.build();
  },

  crane() {
    const m = meshBuilder();
    const steel = hex("#B58A2F");
    m.box(0, 4.5, 0, 1.2, 9, 1.2, steel);
    m.box(0, 9.2, 3.2, 0.9, 0.9, 9.5, steel);
    m.box(0, 8.6, 7.4, 0.15, 1.2, 0.15, C.darkMetal); // cable
    m.box(0, 7.7, 7.4, 1.4, 0.7, 1.2, hex("#2F6FB5")); // hanging box
    return m.build();
  },

  snowPine(seed) {
    const m = meshBuilder();
    const h = 4 + hash01(seed) * 3;
    m.box(0, h * 0.15, 0, 0.5, h * 0.3, 0.5, hex("#5A3A22"));
    const green = hex("#1F6B44");
    for (let i = 0; i < 3; i++) {
      const y = h * (0.22 + i * 0.24);
      const r = (1.9 - i * 0.5) * (0.8 + hash01(seed + i) * 0.3);
      m.cyl(0, y, 0, r, 0.02, h * 0.3, 7, shade(green, 0.9 + i * 0.08));
      m.cyl(0, y + h * 0.16, 0, r * 0.72, 0.01, h * 0.12, 7, C.white); // snow cap
    }
    return m.build();
  },

  iceSpike(seed) {
    const m = meshBuilder();
    const h = 2.5 + hash01(seed) * 4;
    m.cyl(0, 0, 0, 1.1, 0, h, 5, hex("#9CD6E8"));
    m.cyl(0.9, 0, 0.4, 0.55, 0, h * 0.5, 5, hex("#BEE7F2"));
    return m.build();
  },

  fudStatue() {
    // frozen bear statue: blocky bear + sign (text via billboard elsewhere)
    const m = meshBuilder();
    const ice = hex("#A8CFDE");
    m.box(0, 1.1, 0, 1.6, 2.2, 1.2, ice); // body
    m.sphere(0, 2.6, 0.1, 0.55, 4, 6, shade(ice, 1.06)); // head
    m.box(-0.35, 3.05, 0.1, 0.3, 0.3, 0.2, shade(ice, 1.1)); // ears
    m.box(0.35, 3.05, 0.1, 0.3, 0.3, 0.2, shade(ice, 1.1));
    m.box(-0.95, 1.4, 0.3, 0.4, 1.4, 0.4, ice); // arms raised
    m.box(0.95, 1.4, 0.3, 0.4, 1.4, 0.4, ice);
    m.box(0, 0.15, 0, 2.4, 0.3, 1.8, shade(ice, 0.8)); // plinth
    return m.build();
  },

  candleTower(seed) {
    // neon candlestick building: body + wick, green or red
    const m = meshBuilder();
    const up = hash01(seed) > 0.42;
    const c = up ? hex("#22C55E") : hex("#E5484D");
    const h = 6 + hash01(seed * 3) * 10;
    const w = 2.2 + hash01(seed * 7) * 1.6;
    m.box(0, h / 2, 0, w, h, w, shade(c, 0.5));
    // lit window grid baked as brighter strips
    for (let i = 1; i < Math.floor(h / 1.4); i++) {
      m.box(0, i * 1.4, w / 2 + 0.02, w * 0.8, 0.5, 0.03, shade(c, 1.15));
      m.box(0, i * 1.4, -w / 2 - 0.02, w * 0.8, 0.5, 0.03, shade(c, 1.15));
    }
    m.box(0, h + 1.3, 0, 0.3, 2.6, 0.3, c); // wick
    return m.build();
  },

  cityTower(seed) {
    const m = meshBuilder();
    const h = 8 + hash01(seed) * 16;
    const w = 3 + hash01(seed * 3) * 3;
    const base = hex("#23263A");
    m.box(0, h / 2, 0, w, h, w, base);
    const win = hash01(seed * 11) > 0.5 ? hex("#7DE3FF") : hex("#F7931A");
    for (let f = 0; f < 4; f++) {
      const a = (f / 4) * TAU;
      for (let i = 1; i < Math.floor(h / 1.6); i++) {
        if (hash01(seed * 17 + f * 31 + i) < 0.4) continue;
        const dx = Math.cos(a) * (w / 2 + 0.02), dz = Math.sin(a) * (w / 2 + 0.02);
        // thin lit strip per floor per face
        if (f % 2 === 0) m.box(dx, i * 1.6, 0, 0.04, 0.6, w * 0.7, shade(win, 0.7 + hash01(seed + i) * 0.5));
        else m.box(0, i * 1.6, dz, w * 0.7, 0.6, 0.04, shade(win, 0.7 + hash01(seed + i) * 0.5));
      }
    }
    return m.build();
  },

  glassTower(seed) {
    const m = meshBuilder();
    const h = 12 + hash01(seed) * 20;
    const w = 4 + hash01(seed * 3) * 4;
    const glass = hex("#39506B");
    m.box(0, h / 2, 0, w, h, w, glass);
    for (let i = 1; i < Math.floor(h / 2.2); i++) {
      m.box(0, i * 2.2, 0, w + 0.06, 0.14, w + 0.06, hex("#9FB6CE"));
    }
    m.box(0, h + 0.2, 0, w * 0.5, 0.4, w * 0.5, hex("#9FB6CE"));
    return m.build();
  },

  printer() {
    // THE money printer: body, roller, flying-sheet tray
    const m = meshBuilder();
    const bodyC = hex("#3E4250");
    m.box(0, 1.5, 0, 5.0, 3.0, 3.4, bodyC);
    m.box(0, 3.15, 0, 4.4, 0.4, 2.8, shade(bodyC, 0.85));
    m.cylX(0, 3.3, 0, 0.5, 4.0, 8, hex("#2A2D38"));
    m.box(0, 0.4, 0, 5.6, 0.8, 4.0, shade(bodyC, 0.7));
    // green LED strip + big red button
    m.box(0, 2.4, 1.74, 3.4, 0.3, 0.06, hex("#33FF66"));
    m.sphere(1.6, 3.5, 0.9, 0.3, 3, 6, hex("#E5484D"));
    // sheets mid-air
    const bill = hex("#7FBF8E");
    m.box(0, 3.9, 1.2, 1.6, 0.05, 0.8, bill);
    m.box(0.5, 4.5, 1.7, 1.6, 0.05, 0.8, shade(bill, 1.1));
    m.box(-0.4, 5.2, 2.2, 1.6, 0.05, 0.8, shade(bill, 0.95));
    return m.build();
  },

  goldBar() {
    const m = meshBuilder();
    m.box(0, 0.25, 0, 1.4, 0.5, 0.8, C.gold);
    m.box(0, 0.52, 0, 1.1, 0.06, 0.6, C.goldDeep);
    return m.build();
  },

  goldStack(seed) {
    const m = meshBuilder();
    const n = 3 + Math.floor(hash01(seed) * 4);
    for (let i = 0; i < n; i++) {
      const y = 0.3 + i * 0.55;
      const dx = (hash01(seed + i) - 0.5) * 0.6;
      const dz = (hash01(seed * 3 + i) - 0.5) * 0.4;
      m.box(dx, y, dz, 1.5 - i * 0.12, 0.5, 0.85 - i * 0.06, i % 2 ? C.gold : shade(C.gold, 0.92));
    }
    return m.build();
  },

  vaultDoor() {
    const m = meshBuilder();
    m.cylX(0, 3.2, 0, 3.2, 1.0, 12, C.metal, { capColor: shade(C.metal, 0.9) });
    m.cylX(0, 3.2, 0.6, 1.1, 0.5, 8, C.chrome);
    m.box(0, 3.2, 0.95, 3.4, 0.3, 0.3, C.chrome);
    m.box(0, 3.2, 0.95, 0.3, 3.4, 0.3, C.chrome);
    m.box(0, 1.0, 0, 7.2, 2.0, 0.8, shade(C.metal, 0.7)); // frame base
    return m.build();
  },

  throne() {
    // the giant ONE CHAIR vista prop
    const m = meshBuilder();
    const black = hex("#141419");
    m.box(0, 2.4, 0, 5.4, 1.2, 5.0, black); // seat
    m.box(0, 6.2, -2.2, 5.4, 6.6, 1.0, black); // back
    m.box(-2.6, 3.6, 0.4, 1.0, 1.6, 4.0, black); // arms
    m.box(2.6, 3.6, 0.4, 1.0, 1.6, 4.0, black);
    m.box(0, 9.7, -2.2, 5.8, 0.5, 1.2, C.gold);
    m.box(-2.5, 10.3, -2.2, 0.55, 0.8, 0.7, C.gold);
    m.box(2.5, 10.3, -2.2, 0.55, 0.8, 0.7, C.gold);
    m.box(0, 3.15, 0.2, 4.2, 0.35, 4.0, hex("#B45309")); // cushion
    m.box(-2.2, 0.9, 2.0, 0.9, 1.8, 0.9, black); // legs
    m.box(2.2, 0.9, 2.0, 0.9, 1.8, 0.9, black);
    m.box(-2.2, 0.9, -1.8, 0.9, 1.8, 0.9, black);
    m.box(2.2, 0.9, -1.8, 0.9, 1.8, 0.9, black);
    return m.build();
  },

  balloon() {
    const m = meshBuilder();
    m.sphere(0, 3.0, 0, 0.85, 5, 7, hex("#F7931A"), { squashY: 1.15 });
    m.cyl(0, 1.95, 0, 0.12, 0.18, 0.16, 5, hex("#D97706"));
    m.box(0, 1.0, 0, 0.04, 2.0, 0.04, hex("#8E8E98"));
    return m.build();
  },

  rock(seed) {
    const m = meshBuilder();
    const r = 0.8 + hash01(seed) * 1.8;
    const c = shade(hex("#7A7E88"), 0.8 + hash01(seed * 3) * 0.4);
    m.sphere(0, r * 0.5, 0, r, 3, 5, c, { squashY: 0.7 });
    return m.build();
  },

  rockArch(seed) {
    // natural stone arch: two leaning pillars meeting in a lintel boulder
    const m = meshBuilder();
    const c = shade(hex("#6E6258"), 0.85 + hash01(seed) * 0.3);
    m.sphere(-3.2, 1.6, 0, 1.9, 3, 5, c, { squashY: 1.4 });
    m.sphere(3.2, 1.5, 0, 1.8, 3, 5, shade(c, 0.92), { squashY: 1.5 });
    m.sphere(-1.6, 4.4, 0, 1.5, 3, 5, shade(c, 1.05), { squashY: 0.9 });
    m.sphere(1.7, 4.3, 0, 1.5, 3, 5, shade(c, 0.98), { squashY: 0.9 });
    m.sphere(0, 5.0, 0, 1.7, 3, 5, shade(c, 1.1), { squashY: 0.75 });
    m.sphere(-2.6, 0.4, 1.2, 0.8, 3, 5, shade(c, 0.8), { squashY: 0.6 }); // rubble
    m.sphere(3.5, 0.3, -1.0, 0.6, 3, 5, shade(c, 0.75), { squashY: 0.6 });
    return m.build();
  },

  pizzaOven() {
    // beach brick oven: dome, glowing mouth, chimney and a peel board
    const m = meshBuilder();
    const brick = hex("#A45A38");
    m.box(0, 0.55, 0, 3.0, 1.1, 2.6, shade(brick, 0.8)); // base slab
    m.sphere(0, 1.5, 0, 1.35, 4, 7, brick, { squashY: 0.85 }); // dome
    m.box(0, 1.35, 1.2, 1.0, 0.75, 0.35, shade(brick, 0.6)); // mouth arch
    m.box(0, 1.28, 1.34, 0.72, 0.5, 0.12, hex("#FF9E3D")); // fire glow (emissive at draw)
    m.cyl(0, 2.5, -0.4, 0.28, 0.24, 1.1, 6, shade(brick, 0.7)); // chimney
    m.box(1.6, 1.15, 0.7, 0.24, 0.06, 1.6, hex("#C99A5E")); // peel handle
    m.box(1.6, 1.15, 1.6, 0.6, 0.05, 0.6, hex("#D9B075")); // peel board
    return m.build();
  },

  neonArch(seed) {
    // roadside neon arch tower: dark frame wrapped in a lit tube accent
    const m = meshBuilder();
    const on = hash01(seed) > 0.35;
    const tube = on ? hex("#22D3EE") : hex("#F7931A");
    const frame = hex("#1E2030");
    m.box(-2.6, 3.4, 0, 0.8, 6.8, 0.8, frame);
    m.box(2.6, 3.4, 0, 0.8, 6.8, 0.8, frame);
    m.box(0, 7.0, 0, 6.2, 0.8, 0.8, shade(frame, 1.15));
    // lit tube tracing the inside edge
    m.box(-2.14, 3.4, 0, 0.14, 6.4, 0.14, tube);
    m.box(2.14, 3.4, 0, 0.14, 6.4, 0.14, tube);
    m.box(0, 6.54, 0, 4.5, 0.14, 0.14, tube);
    m.sphere(0, 7.6, 0, 0.35, 3, 6, tube); // topper bulb
    return m.build();
  },

  derrick(seed) {
    // mine headframe: timber A-tower, crossbraces, wheel and cable
    const m = meshBuilder();
    const timber = hex("#6B4A2B");
    const h = 7 + hash01(seed) * 2;
    m.box(-1.6, h / 2, -1.2, 0.5, h, 0.5, timber);
    m.box(1.6, h / 2, -1.2, 0.5, h, 0.5, timber);
    m.box(-1.2, h / 2, 1.4, 0.5, h * 0.82, 0.5, shade(timber, 0.9));
    m.box(1.2, h / 2, 1.4, 0.5, h * 0.82, 0.5, shade(timber, 0.9));
    m.box(0, h * 0.45, 0, 3.6, 0.4, 0.4, shade(timber, 0.8)); // crossbrace
    m.box(0, h * 0.75, -1.2, 3.8, 0.4, 0.4, shade(timber, 0.85));
    m.box(0, h + 0.3, 0.1, 4.0, 0.5, 3.4, shade(timber, 1.05)); // head platform
    m.cylX(0, h + 1.1, 0.1, 0.75, 0.3, 8, C.darkMetal); // hoist wheel
    m.box(0, h * 0.55, 0.1, 0.08, h * 1.1, 0.08, C.darkMetal); // cable
    m.box(0, 0.7, 0.1, 1.4, 1.4, 1.2, C.gold); // raised gold skip
    return m.build();
  },

  kiosk(seed) {
    // news kiosk: striped awning, headline racks, stacked papers
    const m = meshBuilder();
    const bodyC = hex("#3A3E4A");
    m.box(0, 1.25, 0, 2.6, 2.5, 2.0, bodyC);
    m.box(0, 1.15, 1.02, 2.2, 1.1, 0.08, hex("#12141A")); // counter window
    for (let i = 0; i < 5; i++) { // striped awning
      const c = i % 2 ? C.white : (hash01(seed) > 0.5 ? hex("#E5484D") : hex("#F7931A"));
      m.wedge(-1.04 + i * 0.52, 2.75, 1.15, 0.52, 0.3, 0.9, c);
    }
    m.box(-0.85, 1.5, 1.08, 0.6, 0.8, 0.06, hex("#D8DBE2")); // headline card
    m.box(0.85, 1.6, 1.08, 0.6, 0.8, 0.06, hex("#C4C8D2"));
    m.box(1.6, 0.3, 0.7, 0.9, 0.6, 0.7, hex("#B9BDC8")); // paper bundle
    m.box(1.6, 0.72, 0.7, 0.8, 0.24, 0.6, shade(hex("#B9BDC8"), 0.85));
    // K14-FIX grounding: dark contact pad under the stall footprint (the
    // grandstand apron treatment · seats the vendor in the scene)
    m.quad([-1.9, 0.04, -1.5], [2.4, 0.04, -1.5], [2.4, 0.04, 1.7], [-1.9, 0.04, 1.7], hex("#131419"));
    return m.build();
  },

  goldRock(seed) {
    const m = meshBuilder();
    const r = 1.0 + hash01(seed) * 2.2;
    m.sphere(0, r * 0.5, 0, r, 3, 5, hex("#5C4A33"), { squashY: 0.75 });
    m.box(0.3 * r, r * 0.7, 0.3 * r, r * 0.4, r * 0.3, r * 0.35, C.gold); // vein
    m.box(-0.35 * r, r * 0.4, -0.2 * r, r * 0.3, r * 0.25, r * 0.3, C.goldDeep);
    return m.build();
  },

  minecartProp(seed) {
    const m = meshBuilder();
    m.box(0, 0.7, 0, 1.6, 0.9, 1.1, hex("#4A3B2A"));
    m.box(0, 1.2, 0, 1.4, 0.3, 0.9, C.gold); // heaped gold
    m.cylX(-0.5, 0.25, 0.4, 0.22, 0.15, 6, C.darkMetal);
    m.cylX(0.5, 0.25, 0.4, 0.22, 0.15, 6, C.darkMetal);
    m.cylX(-0.5, 0.25, -0.4, 0.22, 0.15, 6, C.darkMetal);
    m.cylX(0.5, 0.25, -0.4, 0.22, 0.15, 6, C.darkMetal);
    return m.build();
  },

  blimp() {
    // media blimp: gray ellipsoid + fins (banner text added as billboard)
    const m = meshBuilder();
    const gray = hex("#5B5F6B");
    m.sphere(0, 0, 0, 4.2, 5, 9, gray, { squashY: 0.45 });
    m.box(0, -2.0, 0, 2.2, 1.0, 1.4, shade(gray, 0.75)); // gondola
    m.pushTri([0, 0.8, -3.6], [0, 2.4, -5.2], [0, 0.2, -5.0], hex("#E5484D"));
    m.pushTri([0, 0.2, -5.0], [0, 2.4, -5.2], [0, 0.8, -3.6], hex("#C43E2F"));
    return m.build();
  },

  newsVan(seed) {
    const m = meshBuilder();
    const c = hash01(seed) > 0.5 ? C.white : hex("#D8DBE2");
    m.box(0, 1.1, 0, 2.0, 1.7, 4.4, c);
    m.box(0, 1.0, 2.5, 1.9, 1.2, 0.8, shade(c, 0.94)); // cab
    m.box(0, 2.6, -0.5, 0.12, 1.4, 0.12, C.metal); // dish mast
    m.sphere(0, 3.4, -0.5, 0.55, 3, 6, C.chrome, { squashY: 0.4 });
    m.box(0, 1.25, 2.96, 1.6, 0.5, 0.06, hex("#7DE3FF")); // windshield
    m.cylX(-1.02, 0.45, 1.5, 0.4, 0.2, 7, C.black);
    m.cylX(1.02, 0.45, 1.5, 0.4, 0.2, 7, C.black);
    m.cylX(-1.02, 0.45, -1.3, 0.4, 0.2, 7, C.black);
    m.cylX(1.02, 0.45, -1.3, 0.4, 0.2, 7, C.black);
    return m.build();
  },

  etfFloat() {
    // parade float: platform + giant spinning-look coin disc
    const m = meshBuilder();
    m.box(0, 0.8, 0, 6.0, 1.6, 3.4, hex("#2A3350"));
    m.box(0, 1.7, 0, 6.4, 0.3, 3.8, C.gold);
    m.cylX(0, 4.2, 0, 2.3, 0.5, 12, C.orange, { capColor: hex("#FFB84D") });
    m.box(0, 4.2, 0.28, 0.5, 2.6, 0.06, C.white); // big B-ish glyph strokes
    m.box(0.5, 5.0, 0.28, 0.9, 0.35, 0.06, C.white);
    m.box(0.5, 3.4, 0.28, 0.9, 0.35, 0.06, C.white);
    m.box(0.5, 4.2, 0.28, 0.8, 0.3, 0.06, C.white);
    return m.build();
  },

  confettiCannon() {
    const m = meshBuilder();
    m.box(0, 0.5, 0, 1.0, 1.0, 1.0, hex("#2A3350"));
    m.cyl(0, 1.0, 0, 0.35, 0.5, 1.6, 7, C.orange);
    return m.build();
  },

  streetLamp() {
    const m = meshBuilder();
    m.cyl(0, 0, 0, 0.18, 0.12, 5.4, 6, C.darkMetal);
    m.box(0, 5.5, 0.7, 0.16, 0.16, 1.6, C.darkMetal);
    m.box(0, 5.4, 1.4, 0.6, 0.25, 0.9, hex("#FFD9A0"));
    return m.build();
  },

  chevron() {
    // boost pad: dark base plate + edge rails + three fat chevrons riding
    // just above it (emissive draw), so it reads as a machined pad
    const m = meshBuilder();
    const c = hex("#FFA733");
    const plate = hex("#15161C");
    m.quad([-1.9, 0.02, -1.5], [-1.9, 0.02, 2.8], [1.9, 0.02, 2.8], [1.9, 0.02, -1.5], plate);
    for (const s of [-1, 1]) { // side rails
      m.box(s * 1.85, 0.06, 0.65, 0.14, 0.08, 4.3, shade(c, 0.55));
    }
    for (let i = 0; i < 3; i++) {
      const z = i * 1.1;
      m.quad([-1.6, 0.05, z - 0.75], [0, 0.05, z + 0.4], [0, 0.05, z - 0.2], [-1.6, 0.05, z - 1.35], c);
      m.quad([0, 0.05, z - 0.2], [0, 0.05, z + 0.4], [1.6, 0.05, z - 0.75], [1.6, 0.05, z - 1.35], c);
    }
    return m.build();
  },

  itemBlock() {
    // THE ORANGE PICKUP · a solid-gold 3D bitcoin glyph spinning inside a
    // translucent energy orb. Unmistakably different from the small solid
    // sat coins: bigger, orb-wrapped, molten. Glyph first, shell LAST so
    // the transparency blends over it.
    const m = meshBuilder();
    const gold = hex("#FFC240"), deep = hex("#D98A12");
    const D = 0.24;
    m.box(-0.26, 0, 0, 0.17, 1.16, D, gold); // spine
    for (const ay of [0.5, 0, -0.5]) m.box(0, ay, 0, 0.62, 0.17, D, gold); // arms
    for (const by of [0.25, -0.25]) m.box(0.36, by, 0, 0.17, 0.42, D, gold); // bowl edges
    for (const cy of [0.44, -0.44]) m.box(0.28, cy, 0, 0.2, 0.16, D, shade(gold, 0.95)); // corners
    for (const sx of [-0.08, 0.12]) { // currency overshoot strokes
      m.box(sx, 0.66, 0, 0.13, 0.2, D * 0.8, deep);
      m.box(sx, -0.66, 0, 0.13, 0.2, D * 0.8, deep);
    }
    m.sphere(0, 0, 0, 1.05, 8, 12, hex("#FF9E2E"), { alpha: 0.16, smooth: true }); // orb shell
    m.cyl(0, -0.03, 0, 1.05, 1.05, 0.06, 14, hex("#FFC46B"), { alpha: 0.4, smooth: true, capTop: false, capBot: false }); // equator ring
    return m.build();
  },

  sat() {
    // sat coin: squat gold cylinder, drawn emissive, with a raised
    // B-and-strokes relief on both faces so the pickup reads BITCOIN
    const m = meshBuilder();
    m.cylX(0, 0, 0, 0.42, 0.1, 9, hex("#FFC240"), { capColor: hex("#F7931A") });
    const deep = hex("#B45309");
    for (const s of [-1, 1]) {
      const x = s * 0.075;
      m.box(x, 0, -0.06, 0.04, 0.56, 0.09, deep); // spine, overshooting like the glyph
      m.box(x, 0.2, 0.05, 0.04, 0.08, 0.2, deep); // top arm
      m.box(x, 0, 0.07, 0.04, 0.08, 0.24, deep); // middle arm
      m.box(x, -0.2, 0.05, 0.04, 0.08, 0.2, deep); // bottom arm
      m.box(x, 0.11, 0.16, 0.04, 0.12, 0.08, deep); // upper bowl edge
      m.box(x, -0.11, 0.18, 0.04, 0.12, 0.08, deep); // lower bowl edge
    }
    return m.build();
  },

  startGantry(width, accentHex) {
    // Seen from BOTH sides (grid on one, racing line on the other), so
    // the header is dressed on both faces and the lamp string hangs
    // centred. Banner field + frame rails + pennant row mirror across
    // +-Z; accentHex tints the field to the track palette (orange
    // default). The instance draws emissive (track.js gantry entry) so
    // the pale bulb tints read lit without a dedicated glow pass.
    const m = meshBuilder();
    const w = width || 18;
    const acc = hex(accentHex || "#F7931A");
    m.box(-w / 2, 3.2, 0, 0.7, 6.4, 0.7, C.darkMetal);
    m.box(w / 2, 3.2, 0, 0.7, 6.4, 0.7, C.darkMetal);
    m.box(0, 6.6, 0, w + 1.2, 1.3, 0.8, hex("#1C1C21"));
    const nP = Math.max(6, Math.round(w / 2.6));
    for (const f of [1, -1]) {
      m.box(0, 6.6, f * 0.44, w * 0.96, 1.04, 0.06, shade(acc, 0.5)); // banner field
      m.box(0, 7.18, f * 0.46, w * 0.96, 0.12, 0.06, C.orange); // frame rails
      m.box(0, 6.02, f * 0.46, w * 0.96, 0.12, 0.06, C.orange);
      for (let i = 0; i < nP; i++) { // pennant row across the banner
        const x0 = -w * 0.44 + (i / nP) * w * 0.88, x1 = -w * 0.44 + ((i + 1) / nP) * w * 0.88;
        fin(m, [x0, 7.02, f * 0.48], [x1, 7.02, f * 0.48], [(x0 + x1) / 2, 6.28, f * 0.48], i % 2 ? C.white : C.orange);
      }
    }
    for (let i = -4; i <= 4; i++) { // lamp string under the header · centred z=0
      const t = i / 4;
      const ly = 5.9 - (1 - t * t) * 0.5;
      m.box(i * (w / 9), ly + 0.24, 0, w / 9, 0.06, 0.06, hex("#22242C")); // cable run
      m.sphere(i * (w / 9), ly, 0, 0.27, 3, 6, i % 2 ? hex("#FFE9B8") : C.orange);
    }
    return m.build();
  },

  finishBanner(width) {
    const m = meshBuilder();
    const w = width || 18;
    // checkered strip lying on the road · bitcoin-orange checkers, not
    // motorsport white (operator: "make it more bitcoin" 2026-07-15)
    const n = 8;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        const c = (i + j) % 2 === 0 ? hex("#F7931A") : hex("#141419");
        m.quad(
          [-w / 2 + (i / n) * w, 0.02, j * 1.3 - 1.3],
          [-w / 2 + ((i + 1) / n) * w, 0.02, j * 1.3 - 1.3],
          [-w / 2 + ((i + 1) / n) * w, 0.02, (j + 1) * 1.3 - 1.3],
          [-w / 2 + (i / n) * w, 0.02, (j + 1) * 1.3 - 1.3],
          c,
        );
      }
    }
    return m.build();
  },

  rampWedge() {
    const m = meshBuilder();
    m.wedge(0, 0.9, 0, 6.0, 1.8, 7.0, hex("#B8763B"), true);
    m.box(0, 1.82, 2.6, 6.0, 0.08, 1.6, hex("#FFA733"));
    return m.build();
  },

  worldDoor(colorHex) {
    // hub world gate: arch + glowing core
    const m = meshBuilder();
    const c = hex(colorHex || "#F7931A");
    m.box(-2.6, 2.6, 0, 1.2, 5.2, 1.2, C.darkMetal);
    m.box(2.6, 2.6, 0, 1.2, 5.2, 1.2, C.darkMetal);
    m.box(0, 5.6, 0, 6.8, 1.2, 1.4, shade(C.darkMetal, 1.2));
    // 0.8 sits OUTSIDE the K19 glass band (0.84-0.92) on purpose: the gate
    // core is an energy panel, not glazing · a sky-fresnel read here would
    // fight the emissive surge the hub drives on this instance
    m.box(0, 2.6, 0, 4.0, 4.4, 0.3, shade(c, 0.55), { alpha: 0.8 });
    m.box(0, 6.4, 0, 1.4, 0.7, 1.4, c);
    return m.build();
  },

  grandstand(seed) {
    // roadside bleachers: three stepped terraces + bench strips under a
    // lean-forward canopy on rear posts. Faces +Z (the road). STAND_ROWS
    // is the shared seating plan: a crowd prop placed with an IDENTICAL
    // {t, side, y, rot, scale} tuple lands seated on these benches.
    const m = meshBuilder();
    const steel = hex("#2E3038");
    const acc = hash01(seed) > 0.5 ? hex("#F7931A") : hex("#F5F5F7");
    const W = STAND_W;
    STAND_ROWS.forEach((r, i) => {
      m.box(0, r.y * 0.5 - 0.06, r.z - 0.15, W + 1.2, r.y - 0.12, 1.8, shade(steel, 0.88 + i * 0.07)); // terrace
      m.box(0, r.y + 0.07, r.z - 0.45, W + 0.6, 0.14, 0.85, shade(acc, 0.5 + i * 0.08)); // bench strip
    });
    for (const s of [-1, 1]) m.box(s * (W / 2 + 0.85), 1.8, -1.0, 0.5, 3.6, 5.6, shade(steel, 0.78)); // fascia walls
    m.box(0, 0.55, 2.35, W + 1.2, 1.1, 0.35, shade(steel, 0.7)); // front skirt
    m.box(0, 1.16, 2.38, W + 1.2, 0.3, 0.3, acc); // sponsor stripe
    // K14-FIX: solid back wall to the canopy line · the stand must read as
    // one block of architecture from the countdown camera, never open
    // shelving with sky bleeding between the tiers
    m.box(0, 2.85, -3.3, W + 1.2, 5.7, 0.4, shade(steel, 0.62));
    m.box(0, 5.3, -3.06, W + 1.2, 0.3, 0.1, shade(acc, 0.85)); // wall accent band
    // rear elevation: the -Z wall faces the racing line and the chase cam,
    // so MAIN_FS collapses diff to ~0 (N.y = 0, sun never hits) and hemi is
    // the only light · vertex colour is the bounce-light stand-in, authored
    // brighter at the base (ground bounce) so the slab reads as architecture
    // instead of a dead black box from the line
    const rearW = W + 1.2;
    for (let i = 0; i < 5; i++) {
      const y = 0.71 + i * 1.07;
      const f = 1.62 - 0.67 * (i / 4) + (hash01(seed * 23 + i) - 0.5) * 0.14;
      m.box(0, y, -3.56, rearW, 1.02, 0.08, shade(steel, f));
    }
    for (let i = 0; i < 7; i++) { // structural panel joints · dark ribs sell the bands
      const x = -rearW / 2 + (i / 6) * rearW;
      m.box(x, 2.85, -3.63, 0.12, 5.3, 0.09, shade(steel, 0.72));
    }
    m.box(0, 4.4, -3.66, rearW, 0.34, 0.08, acc); // sponsor stripe (rear face)
    // sponsor billboard · dark field + accent frame + sat()-style B relief
    // (spine + four arms + two bowl edges · boxes only, no lettering)
    const bw = W * 0.62, bh = 1.7, by = 2.55, bz = -3.7;
    m.box(0, by, bz, bw, bh, 0.1, hex("#15171D"));
    m.box(0, by + bh / 2, bz - 0.02, bw + 0.1, 0.08, 0.1, acc);
    m.box(0, by - bh / 2, bz - 0.02, bw + 0.1, 0.08, 0.1, acc);
    m.box(-bw / 2, by, bz - 0.02, 0.08, bh, 0.1, acc);
    m.box(bw / 2, by, bz - 0.02, 0.08, bh, 0.1, acc);
    const gz = bz - 0.08;
    m.box(0, by, gz, 0.08, 1.05, 0.06, acc); // spine
    m.box(0.02, by + 0.48, gz, 0.22, 0.09, 0.05, acc); // top serif arm
    m.box(0.14, by + 0.28, gz, 0.3, 0.1, 0.05, acc); // top bowl arm
    m.box(0.16, by, gz, 0.34, 0.1, 0.05, acc); // middle arm
    m.box(0.14, by - 0.28, gz, 0.3, 0.1, 0.05, acc); // bottom bowl arm
    m.box(0.26, by + 0.14, gz, 0.1, 0.2, 0.05, acc); // upper bowl edge
    m.box(0.26, by - 0.14, gz, 0.1, 0.2, 0.05, acc); // lower bowl edge
    for (const s of [-1, 1]) { // rear buttresses · break the flat-billboard read
      m.box(s * W * 0.32, 2.0, -3.78, 0.28, 4.0, 0.38, C.darkMetal);
    }
    for (let i = 0; i < 2; i++) { // vent boxes, seed-stable so the mesh stays pure
      // outer thirds only · billboard half-width is W*0.31 at y 1.7..3.4,
      // so |x| in W*0.36..0.44 stays clear of that footprint
      const vx = (i === 0 ? -1 : 1) * W * (0.36 + hash01(seed * 29 + i) * 0.08);
      const vy = 1.2 + hash01(seed * 31 + i) * 3.4;
      m.box(vx, vy, -3.58, 0.55, 0.28, 0.08, shade(steel, 0.48));
    }
    // parapet coping on the wall top · the canopy has no rear overhang
    // (zb -3.2 sits inside the wall), so the roofline reads as a capped
    // parapet on the wall, not a fascia buried behind the rear skin
    m.box(0, 5.62, -3.68, rearW, 0.16, 0.14, acc); // accent lip · proud of skin at -3.60
    m.box(0, 5.48, -3.64, rearW - 0.2, 0.08, 0.1, shade(steel, 0.42)); // shadow-gap under
    // K14-FIX grounding: baked dark contact apron under the footprint ·
    // props draw opaque (vertex alpha is ignored on this path), so this is
    // a solid dark pad that gives the blob-shadow read and seats the set
    // piece IN the scene instead of on it
    const px = W / 2 + 1.9;
    m.quad([-px, 0.05, -3.9], [px, 0.05, -3.9], [px, 0.05, 2.9], [-px, 0.05, 2.9], hex("#15171D"));
    m.quad([-px + 0.8, 0.08, -3.4], [px - 0.8, 0.08, -3.4], [px - 0.8, 0.08, 2.4], [-px + 0.8, 0.08, 2.4], hex("#0D0E12"));
    for (const s of [-1, 1]) { // rear posts carrying the canopy
      m.box(s * (W / 2 + 0.6), 4.3, -2.7, 0.35, 3.2, 0.35, C.darkMetal);
      m.box(s * (W / 6), 4.3, -2.7, 0.3, 3.2, 0.3, C.darkMetal);
    }
    // canopy plate: high edge toward the road so the top face stays lit,
    // darker underside quad wound to face down
    const xr = W / 2 + 1.1, yb = 5.7, yf = 6.35, zb = -3.2, zf = 1.3;
    m.quad([-xr, yb, zb], [-xr, yf, zf], [xr, yf, zf], [xr, yb, zb], shade(steel, 1.18));
    m.quad([xr, yb - 0.14, zb], [xr, yf - 0.14, zf], [-xr, yf - 0.14, zf], [-xr, yb - 0.14, zb], shade(steel, 0.55));
    m.box(0, yf - 0.06, zf, W + 2.2, 0.24, 0.24, acc); // drip edge
    return m.build();
  },

  crowdA(seed) { return crowdMesh(seed, 0); },
  crowdB(seed) { return crowdMesh(seed, 1); },

  flagline(seed) {
    // bunting: a sagging rope of alternating orange/white pennants strung
    // between two poles. Parabolic catenary; fin() keeps every scallop
    // double-sided so the line reads from both directions.
    const m = meshBuilder();
    const half = 5.5, top = 4.1;
    const sag = 0.9 + hash01(seed) * 0.6;
    const ropeY = (x) => top - sag * (1 - (x / half) * (x / half));
    for (const s of [-1, 1]) {
      m.cyl(s * half, 0, 0, 0.14, 0.1, top, 6, C.darkMetal);
      m.sphere(s * half, top + 0.18, 0, 0.16, 3, 5, C.orange);
    }
    const N = 10;
    const flip = Math.floor(hash01(seed * 9) * 2);
    for (let i = 0; i < N; i++) {
      const x0 = -half + (i / N) * half * 2, x1 = -half + ((i + 1) / N) * half * 2;
      const y0 = ropeY(x0), y1 = ropeY(x1);
      // rope ribbon segment (thin, both faces)
      m.quad([x0, y0 + 0.05, 0], [x1, y1 + 0.05, 0], [x1, y1, 0], [x0, y0, 0], hex("#3A3E48"));
      m.quad([x0, y0, 0], [x1, y1, 0], [x1, y1 + 0.05, 0], [x0, y0 + 0.05, 0], hex("#2A2D38"));
      const c = (i + flip) % 2 === 0 ? hex("#F7931A") : hex("#F5F5F7");
      const wob = (hash01(seed * 11 + i) - 0.5) * 0.12;
      fin(m, [x0, y0, 0], [x1, y1, 0], [(x0 + x1) / 2 + wob, Math.min(y0, y1) - 0.62, 0], shade(c, 0.9 + hash01(seed + i) * 0.2));
    }
    return m.build();
  },
};

// Billboard sign frame (posts + panel); the panel face is a separate
// UV-mapped quad textured with canvas text at track build time.
export function billboardFrame(w, h) {
  const m = meshBuilder();
  m.box(-w / 2 + 0.3, (h + 1.4) / 2 - 0.5, -0.15, 0.35, h + 2.4, 0.35, C.darkMetal);
  m.box(w / 2 - 0.3, (h + 1.4) / 2 - 0.5, -0.15, 0.35, h + 2.4, 0.35, C.darkMetal);
  m.box(0, h / 2 + 1.4, -0.08, w + 0.3, h + 0.3, 0.16, hex("#101014"));
  return m.build();
}

export function billboardPanelUV(w, h) {
  // faces +Z
  const y0 = 1.4 - 0.0, y1 = 1.4 + h;
  return {
    pos: new Float32Array([-w / 2, 1.4, 0.02, w / 2, 1.4, 0.02, w / 2, y1, 0.02, -w / 2, y1, 0.02]),
    norm: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uv: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    idx: [0, 1, 2, 0, 2, 3],
  };
}

// Canvas texture for signage. Deliberately chunky mono type. 1024x512 so
// near passes stay crisp; the frame tints to the text color (theme frames)
// with a darker inner keyline for a finished sign look.
export function makeSignCanvas(lines, opts) {
  const o = opts || {};
  const cv = document.createElement("canvas");
  cv.width = 1024; cv.height = 512;
  const ctx = cv.getContext("2d");
  const fg = o.fg || "#F7931A";
  ctx.fillStyle = o.bg || "#101014";
  ctx.fillRect(0, 0, 1024, 512);
  ctx.strokeStyle = o.border || fg;
  ctx.lineWidth = 20;
  ctx.strokeRect(16, 16, 992, 480);
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 6;
  ctx.strokeRect(44, 44, 936, 424); // inner keyline
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const list = Array.isArray(lines) ? lines : [lines];
  const fs = 2 * (o.fontSize || (list.length > 1 ? 56 : 72));
  ctx.font = "bold " + fs + "px ui-monospace, Menlo, monospace";
  ctx.fillStyle = fg;
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowOffsetY = 6;
  ctx.shadowBlur = 10;
  const lh = fs * 1.15;
  const y0 = 256 - ((list.length - 1) * lh) / 2;
  list.forEach((ln, i) => ctx.fillText(ln, 512, y0 + i * lh, 900));
  return cv;
}

// Blob shadow: dark disc with a soft fade ring, drawn with alpha under
// karts. Vertex alpha interpolates the falloff so the edge reads soft.
export function blobShadowMesh() {
  const m = meshBuilder();
  const seg = 12, r = 0.72, rOut = 1.1;
  const dark = [0.02, 0.02, 0.03];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    // solid core
    m.pushTri([0, 0, 0], [c1 * r, 0, s1 * r], [c0 * r, 0, s0 * r], dark, 0.46);
    // fade ring: alpha ramps to zero at the outer rim
    const q = m.raw;
    const base = q.pos.length / 3;
    for (const p of [[c0 * r, 0, s0 * r], [c1 * r, 0, s1 * r], [c1 * rOut, 0, s1 * rOut], [c0 * rOut, 0, s0 * rOut]]) {
      q.pos.push(p[0], p[1], p[2]);
      q.norm.push(0, 1, 0);
    }
    q.col.push(dark[0], dark[1], dark[2], 0.46, dark[0], dark[1], dark[2], 0.46);
    q.col.push(dark[0], dark[1], dark[2], 0, dark[0], dark[1], dark[2], 0);
    q.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return m.build();
}
