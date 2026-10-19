"use client";

/* =====================================================================
 * Globe · the /map atlas as a living planet (operator request
 * 2026-07-09: "slowly spinning 3d globe · live day / night shift ·
 * pinch and zoom or scroll zoom · visually stunning").
 *
 * Raw WebGL1, zero dependencies: one fullscreen quad and a fragment
 * shader that raytraces the sphere. The land mask is the SAME
 * offline-generated Natural Earth geometry the flat atlas draws
 * (lib/world-paths.json is equirectangular, so rasterizing it to an
 * offscreen canvas IS the globe texture · one source of truth).
 * Vendor dots come from COUNTRY_COORDS, the day/night terminator is
 * computed from the actual UTC clock every frame (subsolar point
 * from the solar declination formula · the shadow you see is
 * tonight's real night side), and clicks raycast back through the
 * same camera math to pick the nearest country dot.
 *
 * Interactions: drag to spin (inertia), wheel to zoom, two-finger
 * pinch to zoom, slow auto-rotation that pauses while the pointer is
 * down and stops entirely for prefers-reduced-motion. The rAF loop
 * only runs while the scene is on-screen and the tab is visible.
 *
 * WebGL unavailable (old device, blocked context) → onFail() and the
 * parent renders the flat SVG atlas exactly as before. Keyboard and
 * screen-reader users select countries via the chip row (all
 * countries) and the crawlable index below the fold.
 * ===================================================================== */

import { useCallback, useEffect, useRef } from "react";
import worldPaths from "@/lib/world-paths.json";

export type GlobeDot = {
  cc: string;
  lat: number;
  lon: number;
  weight: number; // 0..1 · relative merchant count
};

const MAX_DOTS = 20;
const CAM_Z = 2.6;
const FOV_TAN = 0.46; // sphere fills ~90% of the short axis at zoom 1
const ZOOM_MIN = 1;
const ZOOM_MAX = 3.6;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uYaw;
uniform float uPitch;
uniform float uZoom;
uniform vec3 uSunG;
uniform vec3 uSunW;
uniform sampler2D uLand;
uniform vec4 uDots[${MAX_DOTS}];
uniform int uDotCount;
uniform int uSel;
uniform float uPulse;

const float PI = 3.14159265;

mat3 rotX(float a) {
  float c = cos(a); float s = sin(a);
  return mat3(1., 0., 0.,  0., c, s,  0., -s, c);
}
mat3 rotY(float a) {
  float c = cos(a); float s = sin(a);
  return mat3(c, 0., -s,  0., 1., 0.,  s, 0., c);
}
float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  float tanF = ${FOV_TAN} / uZoom;
  vec3 ro = vec3(0.0, 0.0, ${CAM_Z});
  vec3 rd = normalize(vec3(ndc.x * aspect * tanF, ndc.y * tanF, -1.0));

  // Deep space + a quiet star field.
  vec3 col = vec3(0.012, 0.012, 0.018);
  vec2 sp = ndc * vec2(aspect, 1.0) * 90.0;
  vec2 cell = floor(sp);
  float h = hash21(cell);
  if (h > 0.985) {
    vec2 f = fract(sp) - 0.5;
    float star = smoothstep(0.32, 0.0, length(f)) * (0.35 + 0.65 * fract(h * 97.0));
    float tw = 0.8 + 0.2 * sin(uTime * (1.0 + fract(h * 13.0) * 2.0) + h * 40.0);
    col += vec3(0.85, 0.9, 1.0) * star * 0.5 * tw;
  }

  float bq = dot(rd, ro);
  float cq = dot(ro, ro) - 1.0;
  float disc = bq * bq - cq;

  if (disc >= 0.0 && bq < 0.0) {
    float t = -bq - sqrt(disc);
    vec3 n = normalize(ro + rd * t);
    vec3 g = rotY(-uYaw) * rotX(-uPitch) * n;
    float lat = asin(clamp(g.y, -1.0, 1.0));
    float lon = atan(g.x, g.z);
    vec2 uv = vec2(0.5 + lon / (2.0 * PI), 0.5 + lat / PI);
    float land = texture2D(uLand, uv).r;

    // Live terminator · geographic sun direction from the UTC clock.
    float day = dot(g, uSunG);
    float dayF = smoothstep(-0.12, 0.18, day);

    vec3 ocean = mix(vec3(0.030, 0.048, 0.080), vec3(0.075, 0.11, 0.16), dayF);
    vec3 landC = mix(vec3(0.135, 0.128, 0.135), vec3(0.27, 0.26, 0.25), dayF);
    vec3 surf = mix(ocean, landC, land);

    // Warm band where the sun is setting or rising.
    float band = smoothstep(0.22, 0.0, abs(day)) * land;
    surf += vec3(0.97, 0.58, 0.10) * band * 0.10;

    // Sun glint on open water.
    vec3 ref = reflect(rd, n);
    float spec = pow(max(dot(ref, uSunW), 0.0), 220.0) * (1.0 - land) * dayF;
    surf += vec3(1.0, 0.88, 0.62) * spec * 0.38;

    // Form light so the night side still reads as a sphere.
    float form = 0.35 + 0.65 * max(n.z, 0.0);
    surf *= mix(0.84, 1.0, form);

    // Fresnel rim · thin cool atmosphere on the limb.
    float fres = pow(1.0 - max(n.z, 0.0), 3.0);
    surf += vec3(0.25, 0.42, 0.75) * fres * 0.16;

    // Vendor dots · brighter on the night side, like city lights.
    float night = 1.0 - dayF;
    for (int i = 0; i < ${MAX_DOTS}; i++) {
      if (i >= uDotCount) break;
      vec3 dg = uDots[i].xyz;
      float ar = uDots[i].w;
      float ang = acos(clamp(dot(g, dg), -1.0, 1.0));
      float pulse = 1.0 + uPulse * 0.16 * sin(uTime * 2.1 + float(i) * 1.7);
      float core = smoothstep(ar * pulse, ar * 0.25 * pulse, ang);
      float glow = smoothstep(ar * 2.4, ar * 0.55, ang);
      vec3 dotc = vec3(0.97, 0.58, 0.10);
      surf = mix(surf, dotc, core * 0.92);
      surf += dotc * glow * 0.20 * (0.8 + 0.7 * night);
      if (i == uSel) {
        float ring = smoothstep(0.014, 0.0, abs(ang - ar * 1.9));
        surf = mix(surf, vec3(1.0), ring * 0.9);
      }
    }

    col = surf;
  }

  // Atmosphere halo just outside the silhouette.
  float dPerp = sqrt(max(dot(ro, ro) - bq * bq, 0.0));
  if (bq < 0.0 && dPerp > 1.0) {
    col += vec3(0.30, 0.45, 0.80) * exp(-(dPerp - 1.0) * 14.0) * 0.35;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

function geoToVec(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return [
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lon),
  ];
}

// Subsolar point from the UTC clock · declination via the standard
// approximation, longitude straight from the hour angle (equation of
// time ignored · the terminator lands within ~4 minutes of truth,
// invisible at this scale).
function sunGeoDir(now: Date): [number, number, number] {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const doy = (now.getTime() - start) / 86_400_000;
  const declDeg = -23.44 * Math.cos(((2 * Math.PI) / 365.24) * (doy + 10));
  const utcH =
    now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  const lonDeg = (12 - utcH) * 15;
  return geoToVec(declDeg, lonDeg);
}

function rotY(v: [number, number, number], a: number): [number, number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}
function rotX(v: [number, number, number], a: number): [number, number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
}

export function Globe({
  dots,
  selected,
  onPick,
  onClear,
  onFail,
  inView,
  reduceMotion,
}: {
  dots: GlobeDot[];
  selected: string | null;
  onPick: (cc: string) => void;
  onClear: () => void;
  onFail: () => void;
  inView: boolean;
  reduceMotion: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    yaw: 1.7, // Americas face the camera on load · most of the roster
    pitch: 0.42,
    zoom: 1.25,
    velYaw: 0,
    velPitch: 0,
    dragging: false,
    lastInteract: 0,
  });
  const cbRef = useRef({ onPick, onClear, onFail });
  cbRef.current = { onPick, onClear, onFail };
  const dotsRef = useRef(dots);
  dotsRef.current = dots;
  const selRef = useRef(selected);
  selRef.current = selected;
  const runRef = useRef({ inView, reduceMotion });
  runRef.current = { inView, reduceMotion };

  // Screen-space projection of a dot · shared by the click raycast
  // test path. Returns null when the dot is on the far side.
  const projectDot = useCallback((cc: string): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    const d = dotsRef.current.find((q) => q.cc === cc);
    if (!canvas || !d) return null;
    const st = stateRef.current;
    const g = geoToVec(d.lat, d.lon);
    const w = rotX(rotY(g, st.yaw), st.pitch);
    if (w[2] < 0.15) return null;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const tanF = FOV_TAN / st.zoom;
    const dz = CAM_Z - w[2];
    const xs = w[0] / dz / (aspect * tanF);
    const ys = w[1] / dz / tanF;
    return { x: ((xs + 1) / 2) * rect.width, y: ((1 - ys) / 2) * rect.height };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const glRaw =
      canvas.getContext("webgl", { antialias: true, alpha: false }) ??
      canvas.getContext("experimental-webgl", { antialias: true, alpha: false });
    if (!(glRaw instanceof WebGLRenderingContext)) {
      cbRef.current.onFail();
      return;
    }
    const gl: WebGLRenderingContext = glRaw;

    // ── Program ────────────────────────────────────────────────────
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("[globe] shader:", gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      cbRef.current.onFail();
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("[globe] link:", gl.getProgramInfoLog(prog));
      cbRef.current.onFail();
      return;
    }
    gl.useProgram(prog);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // ── Land texture · rasterize the SAME equirectangular Natural
    //    Earth path the flat atlas renders. ─────────────────────────
    const texCanvas = document.createElement("canvas");
    texCanvas.width = 2048;
    texCanvas.height = 1024;
    const c2d = texCanvas.getContext("2d");
    if (!c2d) {
      cbRef.current.onFail();
      return;
    }
    c2d.fillStyle = "#000";
    c2d.fillRect(0, 0, 2048, 1024);
    c2d.setTransform(2048 / worldPaths.width, 0, 0, 1024 / worldPaths.height, 0, 0);
    c2d.fillStyle = "#fff";
    c2d.fill(new Path2D(worldPaths.path), "evenodd");

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const U = (name: string) => gl.getUniformLocation(prog, name);
    const uRes = U("uRes");
    const uTime = U("uTime");
    const uYaw = U("uYaw");
    const uPitch = U("uPitch");
    const uZoom = U("uZoom");
    const uSunG = U("uSunG");
    const uSunW = U("uSunW");
    const uDots = U("uDots");
    const uDotCount = U("uDotCount");
    const uSel = U("uSel");
    const uPulse = U("uPulse");
    gl.uniform1i(U("uLand"), 0);

    // ── Sizing ─────────────────────────────────────────────────────
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ── Render loop · runs only on-screen + tab visible ────────────
    let raf = 0;
    let last = performance.now();
    const dotArr = new Float32Array(MAX_DOTS * 4);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const { inView: vis, reduceMotion: rm } = runRef.current;
      if (!vis || document.hidden) {
        last = now;
        return;
      }
      const st = stateRef.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      // Slow idle spin · pauses 4s after any interaction, off for
      // reduced motion.
      if (!rm && !st.dragging && now - st.lastInteract > 4000) {
        st.yaw += dt * 0.05;
      }
      // Inertia after a fling.
      if (!st.dragging) {
        st.yaw += st.velYaw * dt;
        st.pitch += st.velPitch * dt;
        st.velYaw *= Math.pow(0.02, dt);
        st.velPitch *= Math.pow(0.02, dt);
        st.pitch = Math.max(-1.25, Math.min(1.25, st.pitch));
      }

      const t = now / 1000;
      const sunG = sunGeoDir(new Date());
      const sunW = rotX(rotY(sunG, st.yaw), st.pitch);

      const ds = dotsRef.current;
      let selIdx = -1;
      for (let i = 0; i < MAX_DOTS; i++) {
        if (i < ds.length) {
          const v = geoToVec(ds[i].lat, ds[i].lon);
          dotArr[i * 4] = v[0];
          dotArr[i * 4 + 1] = v[1];
          dotArr[i * 4 + 2] = v[2];
          dotArr[i * 4 + 3] = 0.028 + Math.sqrt(ds[i].weight) * 0.038;
          if (ds[i].cc === selRef.current) selIdx = i;
        } else {
          dotArr[i * 4 + 3] = 0;
        }
      }

      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uYaw, st.yaw);
      gl.uniform1f(uPitch, st.pitch);
      gl.uniform1f(uZoom, st.zoom);
      gl.uniform3f(uSunG, sunG[0], sunG[1], sunG[2]);
      gl.uniform3f(uSunW, sunW[0], sunW[1], sunW[2]);
      gl.uniform4fv(uDots, dotArr);
      gl.uniform1i(uDotCount, Math.min(ds.length, MAX_DOTS));
      gl.uniform1i(uSel, selIdx);
      gl.uniform1f(uPulse, rm ? 0 : 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(frame);

    // ── Interaction ────────────────────────────────────────────────
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let downAt = 0;
    let downPos = { x: 0, y: 0 };
    let moved = 0;

    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone (or synthetic) · drag still works */
      }
      const st = stateRef.current;
      st.dragging = true;
      st.velYaw = 0;
      st.velPitch = 0;
      st.lastInteract = performance.now();
      if (pointers.size === 1) {
        downAt = performance.now();
        downPos = { x: e.clientX, y: e.clientY };
        moved = 0;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const st = stateRef.current;
      st.lastInteract = performance.now();
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) {
          st.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, st.zoom * (d / pinchDist)));
        }
        pinchDist = d;
        return;
      }
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      moved += Math.abs(dx) + Math.abs(dy);
      const k = 0.005 / Math.sqrt(st.zoom);
      st.yaw += dx * k;
      st.pitch = Math.max(-1.25, Math.min(1.25, st.pitch + dy * k));
      if (!runRef.current.reduceMotion) {
        st.velYaw = (dx * k) / 0.016;
        st.velPitch = (dy * k) / 0.016;
      }
    };

    const raycastPick = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const st = stateRef.current;
      const aspect = rect.width / rect.height;
      const tanF = FOV_TAN / st.zoom;
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
      const rd0: [number, number, number] = [nx * aspect * tanF, ny * tanF, -1];
      const len = Math.hypot(...rd0);
      const rd: [number, number, number] = [rd0[0] / len, rd0[1] / len, rd0[2] / len];
      const roZ = CAM_Z;
      const bq = rd[2] * roZ;
      const cq = roZ * roZ - 1;
      const disc = bq * bq - cq;
      if (disc < 0) {
        cbRef.current.onClear();
        return;
      }
      const tHit = -bq - Math.sqrt(disc);
      const n: [number, number, number] = [rd[0] * tHit, rd[1] * tHit, roZ + rd[2] * tHit];
      const g = rotY(rotX(n, -st.pitch), -st.yaw);
      // Nearest dot within a zoom-aware angular slop.
      let bestCc: string | null = null;
      let bestAng = Infinity;
      for (const d of dotsRef.current) {
        const dg = geoToVec(d.lat, d.lon);
        const dp = Math.max(-1, Math.min(1, g[0] * dg[0] + g[1] * dg[1] + g[2] * dg[2]));
        const ang = Math.acos(dp);
        const r = 0.028 + Math.sqrt(d.weight) * 0.038;
        const slop = Math.max(r * 1.8, 0.05 + 0.06 / st.zoom);
        if (ang < slop && ang < bestAng) {
          bestAng = ang;
          bestCc = d.cc;
        }
      }
      if (bestCc) cbRef.current.onPick(bestCc);
      else cbRef.current.onClear();
    };

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinchDist = 0;
      const st = stateRef.current;
      if (pointers.size === 0) {
        st.dragging = false;
        st.lastInteract = performance.now();
        if (performance.now() - downAt < 400 && moved < 7) {
          st.velYaw = 0;
          st.velPitch = 0;
          raycastPick(downPos.x, downPos.y);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = stateRef.current;
      st.lastInteract = performance.now();
      st.zoom = Math.max(
        ZOOM_MIN,
        Math.min(ZOOM_MAX, st.zoom * Math.exp(-e.deltaY * 0.0012)),
      );
    };

    const onContextLost = (e: Event) => {
      e.preventDefault();
      cbRef.current.onFail();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("webglcontextlost", onContextLost);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    // The scene is built once · live values flow through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Test/debug hook · lets automation project a dot and click it for
  // real. Harmless in production (reads only).
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__gmGlobeProject = projectDot;
    return () => {
      delete (window as unknown as Record<string, unknown>).__gmGlobeProject;
    };
  }, [projectDot]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full aspect-square sm:aspect-[1.55/1] block rounded-[9px] touch-none cursor-grab active:cursor-grabbing select-none"
      role="img"
      aria-label="Spinning globe of every verified Bitcoin merchant country, with the live day and night line. Use the country buttons below to browse without a pointer."
    />
  );
}
