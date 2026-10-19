// BITCOIN KART · gl.js
// Custom WebGL2 renderer. Zero dependencies, N64-flavored: vertex-colored
// meshes, one sun + hemisphere ambient + orange rim light, distance fog,
// gradient sky with sun disc, instanced particles, blob shadows, cheap
// additive glow pass for emissives. MSAA comes free from antialias:true.

import { M4, V3 } from "./math3d.js";

const MAIN_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNorm;
layout(location=2) in vec4 aColor;
uniform mat4 uVP;
uniform mat4 uModel;
out vec3 vNorm;
out vec4 vColor;
out vec3 vWorld;
void main(){
  vec4 w = uModel * vec4(aPos,1.0);
  vWorld = w.xyz;
  vNorm = mat3(uModel) * aNorm;
  vColor = aColor;
  gl_Position = uVP * w;
}`;

const MAIN_FS = `#version 300 es
precision highp float;
in vec3 vNorm;
in vec4 vColor;
in vec3 vWorld;
uniform vec3 uSunDir;   // direction TO the sun, normalized
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGroundCol;
uniform vec3 uCamPos;
uniform vec3 uFogCol;
uniform vec2 uFogRange; // near, far
uniform float uEmissive;
uniform float uAlpha;
uniform vec3 uRimCol;
uniform float uRim;
uniform float uSpec; // Blinn half-vector glint strength · 0 = off (reduceFx)
uniform float uSpecPow; // material v2 roughness axis · Blinn exponent, 34 = legacy default
uniform float uMetal; // 0 dielectric → 1 metal: spec + sheen take the surface's own color
uniform float uSheen; // SHINE sky-reflection sheen · procedural matcap, 0 = off
uniform vec3 uSheenSky; // sky zenith tint for the sheen (env.skyTop)
uniform vec3 uSheenHor; // sky horizon tint for the sheen (env.skyHorizon)
uniform float uNoiseAmt; // procedural surface grain · 0 = off (reduceFx)
uniform float uShadowOn; // sun shadow map active this frame
uniform mat4 uLightVP;
uniform lowp sampler2DShadow uShadowMap; // LINEAR compare = free 2x2 PCF
out vec4 frag;
float shadowAt(vec3 world) {
  vec4 lp = uLightVP * vec4(world, 1.0);
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float lit = texture(uShadowMap, vec3(p.xy, p.z - 0.0024));
  return mix(0.5, 1.0, lit); // soft: shadowed sun keeps half strength
}
float vhash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = vhash(i), b = vhash(i + vec2(1.0, 0.0)), c = vhash(i + vec2(0.0, 1.0)), d = vhash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main(){
  vec3 N = normalize(vNorm);
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 hemi = mix(uGroundCol, uSkyCol, N.y * 0.5 + 0.5);
  vec3 V = normalize(uCamPos - vWorld);
  float ndv = max(dot(N, V), 0.0);
  float rim = pow(1.0 - ndv, 3.0);
  vec3 H = normalize(uSunDir + V);
  // reflected view ray, hoisted: the glass edge and the metal matcap both
  // index environment in REFLECTED space so their bands travel with the
  // camera and with the object's rotation instead of sitting on the mesh
  vec3 R = reflect(-V, N);
  // K19: on opaque draws (uAlpha 1) vColor.a is a free per-face material
  // mask · 0.6-0.7 matte, 0.84-0.92 glass · the 0.9995 gate keeps every
  // translucent pass (ghost/shield/blob/skids/aurora) on coverage semantics
  float opq = step(0.9995, uAlpha);
  float matte = opq * step(0.585, vColor.a) * step(vColor.a, 0.715);
  float glass = opq * step(0.825, vColor.a) * step(vColor.a, 0.925);
  // Bloom-halo regression fix (round 4): the K1 lobe boosts landed on top of
  // an already bright albedo, so near-white bodywork crossed the bright-pass
  // threshold and wore an orange fringe at close range. hiRoll takes the
  // EXTRA energy back out on high-luma paint ONLY · dark and mid albedo keep
  // the round-3 tuning exactly, white keeps one legible highlight
  float alb = dot(vColor.rgb, vec3(0.299, 0.587, 0.114));
  float hiAlb = smoothstep(0.42, 0.95, alb);
  float hiRoll = 1.0 - 0.5 * hiAlb;
  float spec = pow(max(dot(N, H), 0.0), uSpecPow) * uSpec;
  // K1 fix: the hue-matched tint swallowed the metal glint · extra lobe
  // energy separates trim from paint · matte (rubber/cloth) kills glints
  spec *= (1.0 + (uMetal * 1.5 + glass * 2.0) * hiRoll) * (1.0 - matte);
  float sh = uShadowOn > 0.5 ? shadowAt(vWorld) : 1.0;
  // Material v2 (K1): dielectrics glint in the light's color, metals in
  // their own · uMetal 0 collapses mTint to 1 so legacy draws are exact ·
  // conductor fresnel pulls metal highlights back to white at grazing
  vec3 mTint = mix(vec3(1.0), vColor.rgb * 1.6 + 0.08, uMetal);
  mTint = mix(mTint, vec3(1.0), uMetal * rim);
  // the GLINT tint is the sheen tint pulled back toward white on bright
  // albedo: a white highlight must never carry more energy than the light
  // that made it, or the bright pass reads it as an emissive and halos it
  vec3 sTint = mTint / (1.0 + hiAlb * 0.6);
  vec3 lit = vColor.rgb * (uSunCol * diff * sh + hemi) + uRimCol * rim * uRim + uSunCol * sTint * spec * sh;
  // clearcoat (K1 fix): tight white pow-140 lobe on metal + glass, fresnel
  // weighted · the pin-sharp read · rides uSpec so reduceFx kills it
  float coat = max(uMetal, glass) * (1.0 - matte) * hiRoll;
  if (coat > 0.001) {
    lit += uSunCol * pow(max(dot(N, H), 0.0), 140.0) * uSpec * coat * sh * (0.4 + 0.6 * rim);
  }
  // glass edge (K19 v2): the old pow-3-only lip was invisible at anything
  // but a dead-on grazing angle. A wide grazing ramp carries the sky tint
  // across the whole rake of a windscreen, a tight core keeps the hot lip,
  // and both index R, so the highlight TRAVELS across the canopy as the
  // camera moves. Pure ALU in an existing draw, stays on every tier
  if (glass > 0.5) {
    vec3 gsky = mix(uSheenHor, uSheenSky, clamp(R.y * 1.2 + 0.35, 0.0, 1.0));
    lit += gsky * (pow(1.0 - ndv, 1.7) * 0.5 + rim * 1.35) * (1.0 - 0.3 * hiAlb);
  }
  // SHINE sheen (2026-07-22): the world's own sky reflected off metal and
  // wet floors · reflect the view ray, shade it against the sky gradient,
  // fresnel-weight it so faces square to the camera stay paint
  if (uSheen > 0.001) {
    vec3 skyRef = mix(uSheenHor, uSheenSky, clamp(R.y * 1.3 + 0.12, 0.0, 1.0));
    // grounded lower hemisphere (K1): down-rays see the deck, not horizon
    // glow · under-panels darken toward the ground instead of rim-lighting.
    // No-op for R.y >= 0, so wet roads keep their sky mirror
    skyRef = mix(skyRef, uGroundCol * 0.9, clamp(-R.y * 1.5, 0.0, 1.0));
    // K1 fix: metals mirror the sky at every angle (higher facing floor +
    // doubled energy) · dielectrics stay grazing-only, matte kills it
    float sf = pow(1.0 - ndv, 2.0);
    lit += skyRef * mTint * uSheen * (1.0 + uMetal) * mix(0.22 + 0.78 * sf, 0.6 + 0.4 * sf, uMetal) * (1.0 - matte);
    // K1 v2 (round 4): a 2-tone dome is a gradient, and a gradient reads as
    // shading, not as a MIRROR. What sells reflection is the hard line where
    // the dome's two halves meet · this is that horizon band. It lives in
    // reflected space, so it sweeps across a rim hub or a trim strip as the
    // object turns (the select turntable is the read) instead of sitting
    // still like albedo. uSpecPow is the roughness axis: a glossier surface
    // gets a tighter, hotter line, rough metal a broad smear. Added AFTER
    // the mTint multiply on purpose · the metal tint's >1 gain must never
    // multiply the band, or bright chrome halos in the bright pass
    float band = exp(-abs(R.y) * (2.5 + uSpecPow * 0.12));
    lit += mix(uSheenHor, vec3(1.0), 0.45) * band * uSheen * (0.35 + 0.95 * uMetal) * hiRoll * (1.0 - matte);
    // conductors carry almost no diffuse · hand part of the ambient budget
    // to the reflection so metal stops reading as flat lit paint. Scoped to
    // the sheen branch so a reduceFx draw (sheen 0) keeps its full ambient
    lit -= vColor.rgb * hemi * uMetal * 0.28 * (1.0 - matte);
  }
  vec3 col = mix(lit, vColor.rgb * 1.2, uEmissive);
  // d feeds fog below unchanged · also drives the grain distance fade so
  // mid-range shimmer dies while close-up asphalt/wall grit still reads (K20)
  float d = distance(uCamPos, vWorld);
  // two-octave value-noise grain keyed on world position: asphalt/sand
  // texture without any texture assets. Fade kills mid-distance shimmer.
  if (uNoiseAmt > 0.001) {
    float g = vnoise(vWorld.xz * 2.7) * 0.6 + vnoise(vWorld.xz * 13.0) * 0.4;
    col *= 1.0 + (g - 0.5) * uNoiseAmt * (1.0 - smoothstep(45.0, 130.0, d));
  }
  float fog = smoothstep(uFogRange.x, uFogRange.y, d);
  // K19: opaque draws force alpha 1 · vertex alpha is a mask there, not coverage
  frag = vec4(mix(col, uFogCol, fog), mix(vColor.a * uAlpha, 1.0, opq));
}`;

const SKY_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){ vUV = aPos; gl_Position = vec4(aPos, 0.99999, 1.0); }`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanFov;
uniform float uAspect;
uniform vec3 uSunDir;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGroundHaze;
uniform vec3 uSunTint;
uniform float uTime;
out vec4 frag;
void main(){
  vec3 ray = normalize(uCamFwd + uCamRight * vUV.x * uTanFov * uAspect + uCamUp * vUV.y * uTanFov);
  float h = ray.y;
  vec3 col;
  if (h >= 0.0) {
    col = mix(uHorizon, uTop, pow(min(h * 1.6, 1.0), 0.7));
  } else {
    col = mix(uHorizon, uGroundHaze, min(-h * 4.0, 1.0));
  }
  float sd = max(dot(ray, uSunDir), 0.0);
  col += uSunTint * (pow(sd, 900.0) * 1.6 + pow(sd, 24.0) * 0.28);
  // Lazy drifting cloud bands, cheap sine noise. Reads as painted sky.
  float band = sin(ray.x * 5.0 + uTime * 0.02) * sin(ray.z * 4.0 - uTime * 0.013);
  float cloud = smoothstep(0.55, 0.95, band) * smoothstep(0.04, 0.24, h) * (1.0 - smoothstep(0.5, 0.9, h));
  col = mix(col, mix(col, vec3(1.0), 0.75), cloud * 0.5);
  // Second, finer layer drifting the other way: softer edges, higher up,
  // sun-tinted so it belongs to whatever sky preset is active.
  float band2 = sin(ray.x * 11.0 - uTime * 0.031) * sin(ray.z * 8.0 + uTime * 0.019);
  float cloud2 = smoothstep(0.45, 1.0, band2) * smoothstep(0.12, 0.4, h) * (1.0 - smoothstep(0.65, 1.0, h));
  col = mix(col, mix(col, uSunTint * 0.5 + vec3(0.5), 0.6), cloud2 * 0.32);
  frag = vec4(col, 1.0);
}`;

const PART_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 iPos;
layout(location=2) in vec2 iSizeRot;   // size, rotation
layout(location=3) in vec4 iColor;
uniform mat4 uVP;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
out vec4 vColor;
out vec2 vCorner;
void main(){
  float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
  vec2 rc = vec2(aCorner.x * c - aCorner.y * s, aCorner.x * s + aCorner.y * c);
  vec3 w = iPos + (uCamRight * rc.x + uCamUp * rc.y) * iSizeRot.x;
  vColor = iColor;
  vCorner = aCorner;
  gl_Position = uVP * vec4(w, 1.0);
}`;

const PART_FS = `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vCorner;
uniform sampler2D uTex;
out vec4 frag;
void main(){
  // shape lives in the sprite's alpha (procedural puff / spark canvas);
  // instance color tints it
  float a = texture(uTex, vCorner * 0.5 + 0.5).a;
  frag = vec4(vColor.rgb, vColor.a * a);
}`;

// ---- post pipeline (Tier A "HD remaster" · 2026-07-15) ----
// One MSAA scene FBO resolved to a texture, bright-pass + separable blur
// at half res, then a composite with soft highlight rolloff, +6%
// saturation and a corner vignette. reduceFx / low quality never enters
// this path: begin() renders straight to the canvas exactly as before.
const POST_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
out vec2 vNDC;
void main(){ vUV = aPos * 0.5 + 0.5; vNDC = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// ---- sun shadow map (Tier B · 2026-07-15) ----
// Depth-only pass over the dynamic casters (karts + item boxes) from an
// ortho sun camera following the player. Receivers are every main-program
// draw: the fragment shader damps the SUN term where the compare fails.
const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uLightVP;
uniform mat4 uModel;
void main(){ gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }`;

const SHADOW_FS = `#version 300 es
precision mediump float;
void main(){}`;

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vNDC;
uniform sampler2D uTex;
uniform float uThr; // scene-adaptive: dark scenes bloom neon, day scenes only true highlights
out vec4 frag;
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  frag = vec4(c * smoothstep(uThr, uThr + 0.28, l), 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vNDC;
uniform sampler2D uTex;
uniform vec2 uDir; // texel step: (1/w,0) or (0,1/h)
out vec4 frag;
void main(){
  float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 s = texture(uTex, vUV).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    s += texture(uTex, vUV + uDir * float(i)).rgb * w[i];
    s += texture(uTex, vUV - uDir * float(i)).rgb * w[i];
  }
  frag = vec4(s, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vNDC;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uDepth; // resolved scene depth (SHINE DoF) · bound only when dofOk
uniform float uBloomAmt;
uniform float uWarp; // boost speed streak · radial blur, center stays sharp
uniform float uDof;   // cinema depth-of-field strength · 0 = off
uniform vec2 uDofEye; // (focusDist, farPlane) · near is fixed 0.3 (makeEnv)
uniform vec3 uGain;   // per-world color grade · gain
uniform vec3 uLift;   // per-world color grade · lift
out vec4 frag;
void main(){
  vec3 sc = texture(uScene, vUV).rgb;
  if (uWarp > 0.003) {
    vec2 dir = vUV - vec2(0.5);
    vec3 acc = sc;
    for (int i = 1; i <= 4; i++) {
      acc += texture(uScene, vUV - dir * uWarp * 0.055 * (float(i) / 4.0)).rgb;
    }
    sc = mix(sc, acc / 5.0, min(uWarp, 1.0) * 0.75);
  }
  if (uDof > 0.003) {
    // cinema lens: linearize depth, circle of confusion vs the shot's
    // focus distance, 8-tap spiral gather on the full-res scene
    float d = texture(uDepth, vUV).r;
    float zn = 0.3, zf = uDofEye.y;
    float z = zn * zf / (zf - d * (zf - zn));
    float coc = clamp(abs(z - uDofEye.x) / max(uDofEye.x, 1.0), 0.0, 1.0) * uDof;
    if (coc > 0.02) {
      vec2 px = coc * 5.5 / vec2(textureSize(uScene, 0));
      vec3 acc = sc;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398 + 0.39;
        acc += texture(uScene, vUV + vec2(cos(a), sin(a)) * px * (0.55 + 0.45 * float(i & 1))).rgb;
      }
      sc = mix(sc, acc / 9.0, min(coc * 1.6, 1.0));
    }
  }
  vec3 c = sc + texture(uBloom, vUV).rgb * uBloomAmt;
  c = c / (1.0 + max(c - vec3(1.0), vec3(0.0)));          // soft-clip highlights only
  // SHINE filmic contrast (2026-07-22): a gentle S toward smoothstep
  // deepens shadows and pops upper mids WITHOUT collapsing hue the way a
  // raw ACES fit did here (first attempt washed the sky to milk) · then
  // the per-world grade
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.32);
  c = clamp(c * uGain + uLift, 0.0, 1.0);
  float g = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(g), c, 1.09);                              // the S mutes chroma slightly · give it back
  c *= 1.0 - 0.16 * smoothstep(0.6, 1.35, length(vNDC));  // corner vignette
  frag = vec4(c, 1.0);
}`;

const TEX_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNorm;
layout(location=2) in vec2 aUV;
uniform mat4 uVP;
uniform mat4 uModel;
out vec2 vUV;
out vec3 vWorld;
out vec3 vNorm;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vUV = aUV;
  vNorm = mat3(uModel) * aNorm;
  gl_Position = uVP * w;
}`;

const TEX_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vWorld;
in vec3 vNorm;
uniform sampler2D uTex;
uniform vec3 uCamPos;
uniform vec3 uFogCol;
uniform vec2 uFogRange;
uniform float uGlow;
uniform float uLit;      // 0 = unlit signage · 1 = lit (character heads)
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGroundCol;
out vec4 frag;
void main(){
  vec4 t = texture(uTex, vUV);
  if (t.a < 0.05) discard;
  vec3 col = t.rgb * (1.0 + uGlow * 0.35);
  if (uLit > 0.5) {
    vec3 N = normalize(vNorm);
    float diff = max(dot(N, uSunDir), 0.0);
    vec3 hemi = mix(uGroundCol, uSkyCol, N.y * 0.5 + 0.5);
    col = t.rgb * (uSunCol * diff + hemi * 1.15);
  }
  float d = distance(uCamPos, vWorld);
  float fog = smoothstep(uFogRange.x, uFogRange.y, d);
  frag = vec4(mix(col, uFogCol, fog), t.a);
}`;

// SHINE living water (2026-07-22): three directional swells with an
// ANALYTIC normal (the derivative of the height sum), a real sun glint
// path off that normal, schlick fresnel toward the horizon, and
// shoreline surf from the foam field track.js bakes into the vertex
// color channel (r = foam 0..1, g = shallowness 0..1).
const WATER_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in vec4 aColor;
uniform mat4 uVP;
uniform float uTime;
out vec3 vWorld;
out float vWave;
out vec3 vN;
out vec2 vShore; // x = foam, y = shallowness
void main(){
  vec3 p = aPos;
  float a1 = p.x * 0.045 + uTime * 1.1;
  float a2 = p.z * 0.06 + uTime * 0.8;
  float a3 = (p.x + p.z) * 0.031 - uTime * 0.6;
  float w = sin(a1) * 0.5 + cos(a2) * 0.4 + sin(a3) * 0.3;
  p.y += w;
  // analytic slope of the height sum -> water normal
  float dx = cos(a1) * 0.5 * 0.045 + cos(a3) * 0.3 * 0.031;
  float dz = -sin(a2) * 0.4 * 0.06 + cos(a3) * 0.3 * 0.031;
  vN = normalize(vec3(-dx, 1.0, -dz));
  vWave = w;
  vShore = aColor.rg;
  vWorld = p;
  gl_Position = uVP * vec4(p, 1.0);
}`;

const WATER_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in float vWave;
in vec3 vN;
in vec2 vShore;
uniform vec3 uCamPos;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uFogCol;
uniform vec2 uFogRange;
uniform float uTime;
out vec4 frag;
void main(){
  vec3 V = normalize(uCamPos - vWorld);
  vec3 N = normalize(vN);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  // depth mix: baked shallowness near shores + wave crest lightening
  vec3 col = mix(uDeep, uShallow, clamp(vShore.y * 0.75 + vWave * 0.14 + 0.1, 0.0, 1.0));
  // the sky owns grazing angles
  col = mix(col, uSkyCol, fres * 0.55);
  // sun glint path: real reflection off the wave normal
  float gl0 = max(dot(reflect(-V, N), uSunDir), 0.0);
  col += uSunCol * (pow(gl0, 240.0) * 1.4 + pow(gl0, 28.0) * 0.18);
  // sparkle glints ride the swell
  float g = sin(vWorld.x * 1.7 + uTime * 2.0) * sin(vWorld.z * 2.3 - uTime * 1.7);
  col += uSunCol * smoothstep(0.93, 1.0, g) * 0.35;
  // shoreline surf: baked foam field, breathing with the tide, broken up
  // by a moving interference pattern so it reads as wash, not a ring
  float fm = vShore.x * (0.55 + 0.45 * sin(uTime * 1.3 + vWorld.x * 0.11 + vWorld.z * 0.09));
  float lace = sin(vWorld.x * 0.9 + uTime * 1.9) * sin(vWorld.z * 1.1 - uTime * 1.4);
  fm *= 0.65 + 0.35 * lace;
  col = mix(col, vec3(0.93, 0.97, 0.98), clamp(fm, 0.0, 0.85));
  float d = distance(uCamPos, vWorld);
  float fog = smoothstep(uFogRange.x, uFogRange.y, d);
  frag = vec4(mix(col, uFogCol, fog), 0.92);
}`;

function compile(gl, vsSrc, fsSrc) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error("Shader compile failed: " + gl.getShaderInfoLog(s) + "\n" + src.slice(0, 400));
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("Program link failed: " + gl.getProgramInfoLog(p));
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { prog: p, u: uniforms };
}

export function createRenderer(canvas) {
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  // Context loss (mobile GPU reset / memory pressure / tab backgrounding)
  // orphans every buffer/VAO/texture/FBO the session cached. preventDefault
  // lets the browser fire a restore; a clean full reload rebuilds all GL
  // state deterministically (the alternative was a permanent black canvas
  // for the rest of the session · bug sweep 2026-07-15).
  let contextLost = false;
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); contextLost = true; }, false);
  canvas.addEventListener("webglcontextrestored", () => {
    if (contextLost) { try { window.location.reload(); } catch { /* no-op */ } }
  }, false);

  const main = compile(gl, MAIN_VS, MAIN_FS);
  const sky = compile(gl, SKY_VS, SKY_FS);
  const part = compile(gl, PART_VS, PART_FS);
  const tex = compile(gl, TEX_VS, TEX_FS);
  const water = compile(gl, WATER_VS, WATER_FS);
  const pBright = compile(gl, POST_VS, BRIGHT_FS);
  const pBlur = compile(gl, POST_VS, BLUR_FS);
  const pComp = compile(gl, POST_VS, COMPOSITE_FS);
  const shadowProg = compile(gl, SHADOW_VS, SHADOW_FS);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  // Fullscreen triangle-pair for the sky.
  const skyVao = gl.createVertexArray();
  gl.bindVertexArray(skyVao);
  const skyBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  let env = null;
  let resScale = 1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * resScale;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }

  // ---- post FBOs (lazy, resized with the canvas) ----
  // depthTex/dofOk (SHINE 2026-07-22): scene depth resolved to a sampleable
  // texture for the cinema DoF · dofOk false = a driver refused the depth
  // blit target and DoF silently stays off (post itself keeps working)
  const post = { on: false, w: 0, h: 0, msaaFB: null, colorRB: null, depthRB: null, resolveFB: null, resolveTex: null, depthTex: null, dofOk: false, half: null };
  // pipeline prewarm mode (2026-07-16): the hidden warmup frame a race
  // renders at creation must exercise the FULL pipeline (uploads, FBO
  // allocs, driver shader compiles · WebKit defers these to first draw)
  // WITHOUT touching the visible canvas: post path skips the final
  // composite, direct path clips to one pixel.
  let warming = false;

  function mkTargetTex(w, h) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: t, fb, w, h };
  }

  function destroyPostTargets() {
    if (post.msaaFB) gl.deleteFramebuffer(post.msaaFB);
    if (post.colorRB) gl.deleteRenderbuffer(post.colorRB);
    if (post.depthRB) gl.deleteRenderbuffer(post.depthRB);
    if (post.resolveFB) gl.deleteFramebuffer(post.resolveFB);
    if (post.resolveTex) gl.deleteTexture(post.resolveTex);
    if (post.depthTex) gl.deleteTexture(post.depthTex);
    if (post.half) for (const t of post.half) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
    post.msaaFB = post.colorRB = post.depthRB = post.resolveFB = post.resolveTex = post.depthTex = post.half = null;
    post.dofOk = false;
  }

  function ensurePostTargets() {
    const w = canvas.width, h = canvas.height;
    if (post.msaaFB && post.w === w && post.h === h) return true;
    destroyPostTargets();
    post.w = w; post.h = h;
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    post.colorRB = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, post.colorRB);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
    post.depthRB = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, post.depthRB);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT16, w, h);
    post.msaaFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, post.msaaFB);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, post.colorRB);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, post.depthRB);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { destroyPostTargets(); post.on = false; return false; }
    const r = mkTargetTex(w, h);
    post.resolveFB = r.fb; post.resolveTex = r.tex;
    // depth resolve target (SHINE DoF): same format as the MSAA depth RB so
    // blitFramebuffer may resolve it · NEAREST, compare mode OFF (we read
    // raw depth in the composite). If the combined FBO goes incomplete the
    // depth attachment is dropped and DoF stays off · post survives.
    post.depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, post.depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, post.resolveFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, post.depthTex, 0);
    post.dofOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (!post.dofOk) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
      gl.deleteTexture(post.depthTex);
      post.depthTex = null;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    post.half = [mkTargetTex(hw, hh), mkTargetTex(hw, hh)];
    return true;
  }

  function fullscreenPass(prog, fb, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.prog);
    gl.bindVertexArray(skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  // ---- sun shadow map state ----
  const SHADOW_SIZE = 1024;
  const shadow = { fb: null, tex: null, lightVP: null, ready: false, broken: false };

  // The depth texture exists from init: the main program's
  // sampler2DShadow is statically referenced, so it must ALWAYS point at
  // a compare-mode depth texture (unit 3) or strict drivers raise
  // INVALID_OPERATION on every draw, shadows enabled or not.
  {
    shadow.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadow.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function ensureShadowTargets() {
    if (shadow.fb || shadow.broken) return !shadow.broken;
    shadow.fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadow.tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(shadow.fb);
      shadow.fb = null; shadow.broken = true;
    }
    return !shadow.broken;
  }

  function ortho(r, t, near, far) {
    // symmetric ortho projection, column-major like M4
    return new Float32Array([
      1 / r, 0, 0, 0,
      0, 1 / t, 0, 0,
      0, 0, -2 / (far - near), 0,
      0, 0, -(far + near) / (far - near), 1,
    ]);
  }

  // Depth pass over dynamic casters. Call BEFORE begin(); begin() picks
  // up shadow.ready and wires the uniforms for every receiver draw.
  function beginShadow(focus, sunDir, radius) {
    if (!ensureShadowTargets()) return false;
    const eye = [focus[0] + sunDir[0] * 70, focus[1] + sunDir[1] * 70, focus[2] + sunDir[2] * 70];
    // stable up vector even for near-vertical suns
    const up = Math.abs(sunDir[1]) > 0.93 ? [0, 0, 1] : [0, 1, 0];
    const view = M4.lookAt(eye, focus, up);
    shadow.lightVP = M4.mul(ortho(radius, radius, 8, 160), view);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.fb);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(shadowProg.prog);
    gl.uniformMatrix4fv(shadowProg.u.uLightVP, false, shadow.lightVP);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2, 6);
    return true;
  }

  function shadowDraw(mesh, model) {
    gl.uniformMatrix4fv(shadowProg.u.uModel, false, model);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
    gl.bindVertexArray(null);
  }

  function endShadow() {
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    shadow.ready = true;
  }

  function present(opts) {
    if (!post.on || !post.msaaFB) return;
    const w = post.w, h = post.h;
    // resolve MSAA scene into a sampleable texture · depth rides the same
    // blit when a DoF shot wants it (NEAREST is mandatory for depth blits,
    // and the color blit is already NEAREST at identical rects)
    const wantDof = !!(opts && opts.dof && post.dofOk);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, post.msaaFB);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, post.resolveFB);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT | (wantDof ? gl.DEPTH_BUFFER_BIT : 0), gl.NEAREST);
    gl.disable(gl.DEPTH_TEST);
    const [A, B] = post.half;
    // scene-adaptive bloom: the fog color's luminance is a free proxy for
    // how bright the whole scene is. Night/mine scenes bloom their neon
    // hard; bright day/snow scenes only bloom true highlights, so sunlit
    // sand and sky never white out (day-track washout fix, 2026-07-15).
    const f = env ? env.fogCol : [0.5, 0.5, 0.5];
    const sl = Math.min((0.299 * f[0] + 0.587 * f[1] + 0.114 * f[2]) / 0.85, 1);
    // bright pass at half res
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, post.resolveTex);
    gl.useProgram(pBright.prog);
    gl.uniform1i(pBright.u.uTex, 0);
    gl.uniform1f(pBright.u.uThr, 0.45 + 0.4 * sl);
    fullscreenPass(pBright, A.fb, A.w, A.h);
    // separable blur A -> B -> A
    gl.useProgram(pBlur.prog);
    gl.uniform1i(pBlur.u.uTex, 0);
    gl.bindTexture(gl.TEXTURE_2D, A.tex);
    gl.uniform2f(pBlur.u.uDir, 1 / A.w, 0);
    fullscreenPass(pBlur, B.fb, B.w, B.h);
    gl.bindTexture(gl.TEXTURE_2D, B.tex);
    gl.uniform2f(pBlur.u.uDir, 0, 1 / B.h);
    fullscreenPass(pBlur, A.fb, A.w, A.h);
    // composite to the canvas · skipped while warming (the prewarm frame
    // must never replace what the player is looking at)
    if (!warming) {
      gl.useProgram(pComp.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, post.resolveTex);
      gl.uniform1i(pComp.u.uScene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, A.tex);
      gl.uniform1i(pComp.u.uBloom, 1);
      gl.uniform1f(pComp.u.uBloomAmt, 0.95 - 0.55 * sl);
      gl.uniform1f(pComp.u.uWarp, (opts && opts.warp) || 0);
      // SHINE grade + cinema DoF (2026-07-22)
      const gr = (opts && opts.grade) || null;
      gl.uniform3fv(pComp.u.uGain, (gr && gr.gain) || [1, 1, 1]);
      gl.uniform3fv(pComp.u.uLift, (gr && gr.lift) || [0, 0, 0]);
      gl.uniform1f(pComp.u.uDof, wantDof ? opts.dof : 0);
      if (wantDof) {
        gl.uniform2f(pComp.u.uDofEye, opts.focus || 12, (env ? env.fogFar : 300) * 1.6);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, post.depthTex);
        gl.uniform1i(pComp.u.uDepth, 2);
      }
      fullscreenPass(pComp, null, w, h);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
  }

  function createMesh(data) {
    // data: {pos: Float32Array, norm: Float32Array, col: Float32Array(rgba), idx: Uint16/32Array}
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bufs = [];
    const attach = (loc, arr, size) => {
      const b = gl.createBuffer();
      bufs.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attach(0, data.pos, 3);
    attach(1, data.norm, 3);
    attach(2, data.col, 4);
    const ib = gl.createBuffer();
    bufs.push(ib);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    const long = data.idx.length > 65000 || data.pos.length / 3 > 65000;
    const idx = long ? new Uint32Array(data.idx) : new Uint16Array(data.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: idx.length, type: long ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, _bufs: bufs };
  }

  function createUVMesh(data) {
    // {pos, norm, uv, idx} for textured quads (billboards, signs)
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bufs = [];
    const attach = (loc, arr, size) => {
      const b = gl.createBuffer();
      bufs.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attach(0, data.pos, 3);
    attach(1, data.norm, 3);
    attach(2, data.uv, 2);
    const ib = gl.createBuffer();
    bufs.push(ib);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: data.idx.length, type: gl.UNSIGNED_SHORT, _bufs: bufs };
  }

  function createTexture(source) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function begin(e) {
    env = e;
    resize();
    // post on: the whole scene renders into the MSAA FBO; present()
    // resolves + blooms + composites to the canvas. Post off: exactly
    // the pre-Tier-A direct path.
    const offscreen = post.on && ensurePostTargets();
    gl.bindFramebuffer(gl.FRAMEBUFFER, offscreen ? post.msaaFB : null);
    if (warming && !offscreen) {
      // direct-to-canvas path while warming: draw the whole frame into
      // one clipped pixel so the visible canvas never changes
      gl.viewport(0, 0, 1, 1);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, 1, 1);
    }
    gl.clearColor(e.fogCol[0], e.fogCol[1], e.fogCol[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Sky first, depth writes off (it sits at far plane).
    gl.depthMask(false);
    gl.useProgram(sky.prog);
    gl.bindVertexArray(skyVao);
    gl.uniform3fv(sky.u.uCamRight, e.camRight);
    gl.uniform3fv(sky.u.uCamUp, e.camUp);
    gl.uniform3fv(sky.u.uCamFwd, e.camFwd);
    gl.uniform1f(sky.u.uTanFov, Math.tan(e.fov / 2));
    gl.uniform1f(sky.u.uAspect, canvas.width / canvas.height);
    gl.uniform3fv(sky.u.uSunDir, e.sunDir);
    gl.uniform3fv(sky.u.uTop, e.skyTop);
    gl.uniform3fv(sky.u.uHorizon, e.skyHorizon);
    gl.uniform3fv(sky.u.uGroundHaze, e.skyGround);
    gl.uniform3fv(sky.u.uSunTint, e.sunTint);
    gl.uniform1f(sky.u.uTime, e.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.depthMask(true);

    gl.useProgram(main.prog);
    gl.uniformMatrix4fv(main.u.uVP, false, e.vp);
    gl.uniform3fv(main.u.uSunDir, e.sunDir);
    gl.uniform3fv(main.u.uSunCol, e.sunCol);
    gl.uniform3fv(main.u.uSkyCol, e.hemiSky);
    gl.uniform3fv(main.u.uGroundCol, e.hemiGround);
    gl.uniform3fv(main.u.uCamPos, e.camPos);
    gl.uniform3fv(main.u.uFogCol, e.fogCol);
    gl.uniform2f(main.u.uFogRange, e.fogNear, e.fogFar);
    gl.uniform3fv(main.u.uRimCol, e.rimCol);
    // SHINE sheen tints: the world's own sky gradient (already on env)
    gl.uniform3fv(main.u.uSheenSky, e.skyTop);
    gl.uniform3fv(main.u.uSheenHor, e.skyHorizon);
    // sun shadows: consumed per frame · a frame without a beginShadow/
    // endShadow pass renders unshadowed (select, hub, reduceFx)
    gl.uniform1f(main.u.uShadowOn, shadow.ready ? 1 : 0);
    if (shadow.ready) {
      gl.uniformMatrix4fv(main.u.uLightVP, false, shadow.lightVP);
    }
    if (shadow.tex) {
      // the compare-mode texture parks on unit 3 so the sampler2DShadow
      // uniform never aliases a plain RGBA texture on unit 0
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, shadow.tex);
      gl.uniform1i(main.u.uShadowMap, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
    shadow.ready = false;
  }

  const IDENT = M4.ident();

  function draw(mesh, model, opts) {
    const o = opts || {};
    gl.uniformMatrix4fv(main.u.uModel, false, model || IDENT);
    gl.uniform1f(main.u.uEmissive, o.emissive || 0);
    gl.uniform1f(main.u.uAlpha, o.alpha === undefined ? 1 : o.alpha);
    gl.uniform1f(main.u.uRim, o.rim === undefined ? 0.35 : o.rim);
    gl.uniform1f(main.u.uSpec, o.spec || 0);
    // Material v2 defaults reproduce the old hard-coded pow-34 white-light
    // glint exactly · a draw passing neither option renders byte-identical
    gl.uniform1f(main.u.uSpecPow, o.specPow || 34);
    gl.uniform1f(main.u.uMetal, o.metal || 0);
    gl.uniform1f(main.u.uSheen, o.sheen || 0);
    gl.uniform1f(main.u.uNoiseAmt, o.noise || 0);
    if (o.alpha !== undefined && o.alpha < 1) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    }
    if (o.noCull) gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
    gl.bindVertexArray(null);
    if (o.noCull) gl.enable(gl.CULL_FACE);
    if (o.alpha !== undefined && o.alpha < 1) {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }
  }

  // Additive re-draw of an emissive mesh slightly inflated: cheap glow halo.
  // Intensity clamps under the K19 opaque gate (0.9995) · the halo pass is
  // additive, so vertex alpha must stay coverage even at intensity 1.
  function glow(mesh, model, intensity) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.uniformMatrix4fv(main.u.uModel, false, model);
    gl.uniform1f(main.u.uEmissive, 1);
    gl.uniform1f(main.u.uAlpha, Math.min(intensity, 0.999));
    gl.uniform1f(main.u.uRim, 0);
    gl.uniform1f(main.u.uSpec, 0);
    gl.uniform1f(main.u.uSheen, 0); // uniform state persists · never let sheen leak into the halo pass
    // new uniform resets stay BELOW the uSheen line · a test regex pins
    // `uSheen, 0` within 400 chars of glow()'s head
    gl.uniform1f(main.u.uMetal, 0);
    gl.uniform1f(main.u.uNoiseAmt, 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  function drawTextured(mesh, model, texture, opts) {
    const o = opts || {};
    gl.useProgram(tex.prog);
    gl.uniformMatrix4fv(tex.u.uVP, false, env.vp);
    gl.uniformMatrix4fv(tex.u.uModel, false, model);
    gl.uniform3fv(tex.u.uCamPos, env.camPos);
    gl.uniform3fv(tex.u.uFogCol, env.fogCol);
    gl.uniform2f(tex.u.uFogRange, env.fogNear, env.fogFar);
    gl.uniform1f(tex.u.uGlow, o.glow || 0);
    gl.uniform1f(tex.u.uLit, o.lit ? 1 : 0);
    if (o.lit) {
      gl.uniform3fv(tex.u.uSunDir, env.sunDir);
      gl.uniform3fv(tex.u.uSunCol, env.sunCol);
      gl.uniform3fv(tex.u.uSkyCol, env.hemiSky);
      gl.uniform3fv(tex.u.uGroundCol, env.hemiGround);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(tex.u.uTex, 0);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.useProgram(main.prog);
  }

  function drawWater(mesh, deep, shallow) {
    gl.useProgram(water.prog);
    gl.uniformMatrix4fv(water.u.uVP, false, env.vp);
    gl.uniform1f(water.u.uTime, env.time);
    gl.uniform3fv(water.u.uCamPos, env.camPos);
    gl.uniform3fv(water.u.uDeep, deep);
    gl.uniform3fv(water.u.uShallow, shallow);
    gl.uniform3fv(water.u.uSunDir, env.sunDir);
    gl.uniform3fv(water.u.uSunCol, env.sunTint);
    gl.uniform3fv(water.u.uSkyCol, env.skyHorizon);
    gl.uniform3fv(water.u.uFogCol, env.fogCol);
    gl.uniform2f(water.u.uFogRange, env.fogNear, env.fogFar);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.useProgram(main.prog);
  }

  // ------- particles -------
  // Procedural sprite pair: soft multi-blob puff for the alpha pass,
  // starburst spark for the additive pass. White RGB, shape in alpha,
  // so per-instance color tints them. No asset loads.
  function spriteCanvas(kind) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const c = cv.getContext("2d");
    if (kind === "puff") {
      const blobs = [[64, 64, 46], [46, 52, 27], [84, 56, 25], [56, 84, 24], [82, 82, 21]];
      for (const [x, y, r] of blobs) {
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(255,255,255,0.8)");
        g.addColorStop(0.6, "rgba(255,255,255,0.35)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = g;
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      }
    } else {
      const core = c.createRadialGradient(64, 64, 0, 64, 64, 24);
      core.addColorStop(0, "rgba(255,255,255,1)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = core;
      c.fillRect(0, 0, 128, 128);
      c.globalCompositeOperation = "lighter";
      c.translate(64, 64);
      for (let i = 0; i < 4; i++) {
        const len = i % 2 === 0 ? 58 : 34; // long cross + short diagonals
        const ray = c.createLinearGradient(0, 0, len, 0);
        ray.addColorStop(0, "rgba(255,255,255,0.9)");
        ray.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = ray;
        for (const flip of [1, -1]) {
          c.save(); c.scale(flip, flip);
          c.beginPath();
          c.moveTo(0, -3.5); c.lineTo(len, -0.8); c.lineTo(len, 0.8); c.lineTo(0, 3.5);
          c.closePath(); c.fill();
          c.restore();
        }
        c.rotate(Math.PI / 4);
      }
    }
    return cv;
  }
  const puffTex = createTexture(spriteCanvas("puff"));
  const sparkTex = createTexture(spriteCanvas("spark"));

  function createParticles(max) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const corner = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const inst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    gl.bufferData(gl.ARRAY_BUFFER, max * 9 * 4, gl.DYNAMIC_DRAW);
    const stride = 9 * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 20);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);

    const data = new Float32Array(max * 9);
    // ring-buffer particle store: [x,y,z, vx,vy,vz, life, maxLife, size, r,g,b,a, grav, rot, drag]
    const P = [];
    return {
      max,
      spawn(x, y, z, vx, vy, vz, life, size, r, g, b, a, grav, rot) {
        if (P.length >= max) P.shift();
        P.push({ x, y, z, vx, vy, vz, life, maxLife: life, size, r, g, b, a, grav: grav || 0, rot: rot || 0 });
      },
      update(dt) {
        for (let i = P.length - 1; i >= 0; i--) {
          const p = P[i];
          p.life -= dt;
          if (p.life <= 0) { P.splice(i, 1); continue; }
          p.vy -= p.grav * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        }
      },
      clear() { P.length = 0; },
      count() { return P.length; },
      destroy() { gl.deleteBuffer(corner); gl.deleteBuffer(inst); gl.deleteVertexArray(vao); },
      draw(additive) {
        if (!P.length) return;
        for (let i = 0; i < P.length; i++) {
          const p = P[i], o = i * 9, t = p.life / p.maxLife;
          data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.z;
          data[o + 3] = p.size * (0.6 + 0.4 * t);
          data[o + 4] = p.rot;
          data[o + 5] = p.r; data[o + 6] = p.g; data[o + 7] = p.b;
          data[o + 8] = p.a * t;
        }
        gl.useProgram(part.prog);
        gl.uniformMatrix4fv(part.u.uVP, false, env.vp);
        gl.uniform3fv(part.u.uCamRight, env.camRight);
        gl.uniform3fv(part.u.uCamUp, env.camUp);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, additive ? sparkTex : puffTex);
        gl.uniform1i(part.u.uTex, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, inst);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, P.length * 9);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.bindVertexArray(vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, P.length);
        gl.bindVertexArray(null);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.useProgram(main.prog);
      },
    };
  }

  // ------- fading quad ribbon (skid marks) -------
  // A ring buffer of world-space quads that fade out over their lifetime.
  // Rendered through the main lit program (normals all point up), so marks
  // pick up the track's lighting and fog for free.
  function createRibbon(maxQuads, lifeSec) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, maxQuads * 4 * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    const norms = new Float32Array(maxQuads * 4 * 3);
    for (let i = 0; i < maxQuads * 4; i++) norms[i * 3 + 1] = 1;
    gl.bufferData(gl.ARRAY_BUFFER, norms, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, maxQuads * 4 * 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    const idx = new Uint16Array(maxQuads * 6);
    for (let q = 0; q < maxQuads; q++) {
      const b = q * 4, o = q * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
      idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    const pos = new Float32Array(maxQuads * 4 * 3);
    const col = new Float32Array(maxQuads * 4 * 4);
    const life = new Float32Array(maxQuads);
    // per-quad authored alpha, kept out of col[] because update() rewrites the
    // whole colour buffer every frame and would otherwise erase it (skids were
    // authored at 0.42 and rendered at 1.0 as hard black slabs for that reason)
    const qAlpha = new Float32Array(maxQuads);
    let head = 0;
    const mesh = { vao, count: maxQuads * 6, type: gl.UNSIGNED_SHORT };

    return {
      mesh,
      add(a, b, c, d, r, g, bl, alpha) {
        const q = head;
        head = (head + 1) % maxQuads;
        life[q] = lifeSec;
        qAlpha[q] = alpha === undefined ? 1 : alpha;
        const po = q * 12;
        [a, b, c, d].forEach((p, i) => {
          pos[po + i * 3] = p[0]; pos[po + i * 3 + 1] = p[1]; pos[po + i * 3 + 2] = p[2];
        });
        const co = q * 16;
        for (let i = 0; i < 4; i++) {
          col[co + i * 4] = r; col[co + i * 4 + 1] = g; col[co + i * 4 + 2] = bl;
          col[co + i * 4 + 3] = alpha;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, po * 4, pos, po, 12);
      },
      update(dt, baseAlpha) {
        let dirty = false;
        for (let q = 0; q < maxQuads; q++) {
          if (life[q] <= 0) continue;
          life[q] -= dt;
          const a = baseAlpha * qAlpha[q] * Math.max(0, Math.min(life[q] / lifeSec, 1));
          const co = q * 16;
          col[co + 3] = a; col[co + 7] = a; col[co + 11] = a; col[co + 15] = a;
          dirty = true;
        }
        if (dirty) {
          gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, col);
        }
      },
      clear() {
        life.fill(0);
        col.fill(0);
        gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, col);
      },
      destroy() { gl.deleteBuffer(posBuf); gl.deleteBuffer(normBuf); gl.deleteBuffer(colBuf); gl.deleteBuffer(ib); gl.deleteVertexArray(vao); },
    };
  }

  // free a mesh's GPU objects (per-race entity meshes · caches keep theirs)
  function disposeMesh(m) {
    if (!m) return;
    if (m._bufs) for (const b of m._bufs) gl.deleteBuffer(b);
    if (m.vao) gl.deleteVertexArray(m.vao);
  }
  function deleteTexture(t) { if (t) gl.deleteTexture(t); }

  return {
    gl,
    canvas,
    resize,
    setResScale(s) { resScale = s; },
    getResScale() { return resScale; },
    setPost(on) { post.on = !!on; },
    getPost() { return post.on; },
    setWarming(on) {
      warming = !!on;
      if (!warming) {
        gl.disable(gl.SCISSOR_TEST);
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
    },
    beginShadow,
    shadowDraw,
    endShadow,
    createMesh,
    createUVMesh,
    createTexture,
    createParticles,
    createRibbon,
    disposeMesh,
    deleteTexture,
    begin,
    draw,
    glow,
    drawTextured,
    drawWater,
    present,
  };
}

// Build a full camera env object from position/target/fov + world lighting.
// roll (radians) banks the camera around its forward axis for drift lean.
export function makeEnv(camPos, camTarget, fov, aspect, world, time, roll) {
  const fwd = V3.norm(V3.sub(camTarget, camPos));
  let upWorld = [0, 1, 0];
  if (roll) {
    const r0 = V3.norm(V3.cross(fwd, [0, 1, 0]));
    const u0 = V3.cross(r0, fwd);
    const c = Math.cos(roll), s = Math.sin(roll);
    upWorld = V3.norm(V3.add(V3.scale(u0, c), V3.scale(r0, s)));
  }
  const right = V3.norm(V3.cross(fwd, upWorld));
  const up = V3.cross(right, fwd);
  const view = M4.lookAt(camPos, camTarget, upWorld);
  const proj = M4.perspective(fov, aspect, 0.3, world.fogFar * 1.6);
  const vp = M4.mul(proj, view);
  return {
    vp,
    camPos,
    camRight: right,
    camUp: up,
    camFwd: fwd,
    fov,
    time,
    sunDir: world.sunDir,
    sunCol: world.sunCol,
    hemiSky: world.hemiSky,
    hemiGround: world.hemiGround,
    fogCol: world.fogCol,
    fogNear: world.fogNear,
    fogFar: world.fogFar,
    skyTop: world.skyTop,
    skyHorizon: world.skyHorizon,
    skyGround: world.skyGround,
    sunTint: world.sunTint,
    rimCol: world.rimCol || [1.0, 0.62, 0.15],
  };
}
