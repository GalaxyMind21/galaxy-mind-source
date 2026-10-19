/** Geometry, tunables, and pure helpers for PressureGauge.
 * Extracted 2026-07-08 so the main component can stay the orchestrator.
 * Behavior must stay bit-identical — no value changes.
 */


/* =====================================================================
 * GEOMETRY & TUNABLES
 * ===================================================================== */

// --- SVG viewBox (taller than v1 so we can fit a full circular bezel) ---
export const VW = 700;
export const VH = 600;
export const CX = 350;
export const CY = 320;

// --- Bezel ring (the metallic frame) ---
export const R_BEZEL_OUTER = 280;     // outer edge
export const R_BEZEL_BEVEL = 260;     // bevel transition (light → dark)
export const R_BEZEL_INNER = 234;     // inner edge (where dial face begins)
export const R_RIVET = 268;           // rivet positions
export const RIVET_COUNT = 12;        // TUNE: how many rivets around the bezel

// --- Dial contents ---
export const R_DIAL = 215;            // active dial track radius
export const R_TICK_OUTER = 226;
export const R_TICK_INNER = 210;
// (R_CARDINAL removed · cardinal scale labels no longer render in the
// SVG · the HODL→FULL SEND scale is now an HTML legend below the dial.)
export const R_NEEDLE_TIP = 188;
export const R_DEPTH_2 = 155;
export const R_DEPTH_3 = 118;
export const R_HUB = 19;

// --- Behavior tunables ---
export const FROST_SOFT = 35;          // TUNE: frost overlay starts ramping in
export const FROST_HARD = 0;           //       (peaks here)
export const HEAT_SOFT = 75;           // TUNE: overheat overlay starts ramping in
export const HEAT_HARD = 100;          //       (peaks here)
export const SHATTER_AT_SCORE = 92;    // TUNE: glass shards start flying
export const FROST_BREAK_SCORE = 12;   // TUNE: ice cracking sound triggers
export const BUY_SIGNAL_LO = 65;       // TUNE: BUY indicator lights up

// --- Spring physics ---
export const SPRING_STIFFNESS = 80;          // TUNE: idle needle feel
export const SPRING_DAMPING = 12;            //       higher damping = less overshoot
export const SPRING_RELEASE_STIFFNESS = 70;  // TUNE: release-snap feel
export const SPRING_RELEASE_DAMPING = 9;     //       lower damping = more bounce

// --- Particle budgets ---
export const SHARD_MAX = 80;           // TUNE: max simultaneous shards
export const SHARD_LIFE_MS = 1800;     // shard lifetime

// --- Sound ---
export const SOUND_VOLUME = 0.06;      // TUNE: master volume when enabled (0..1)

// --- Cosmic palette (extends globals.css) ---
export const COOL_BLUE = "#5478b8";
export const ICE_GLOW = "var(--cool-ink)";
export const NEON_CYAN = "#7df9ff";
export const NEON_PURPLE = "#b96bff";
// Zone palette refined 2026-06-20 (instrument polish): deeper, more
// curated tones than the v1 candy colors · red pulled toward a richer
// crimson (less neon-pink), amber nudged toward the brand orange so the
// neutral band feels native, green to a refined emerald-teal. Still
// unambiguous red / amber / green semantics on the dark dial.
export const RED_ZONE = "#f4435a";       // EXPENSIVE / FROZEN
export const AMBER_ZONE = "#f7a838";     // NEUTRAL (brand-cohesive)
export const GREEN_ZONE = "#2fd89b";     // OPTIMAL BUY

/* =====================================================================
 * GEOMETRY HELPERS
 * ===================================================================== */

// Polar → Cartesian. Angle convention: -180° = 9 o'clock (left/HOLD),
// -90° = 12 o'clock (top/STACK), 0° = 3 o'clock (right/STACK HUGE).
//
// IMPORTANT: rounds to 4 decimals (sub-pixel precision). Without this,
// Node.js's `Number.prototype.toString()` on the server can pick a
// shorter decimal representation than React's client-side renderer
// for the same IEEE-754 float — producing "x1=447.153966944263" on
// the server vs "x1=447.15396694426306" on the client and triggering
// React #418 hydration mismatches across dozens of SVG attributes.
// Rounding equalizes both sides.
// Days elapsed between an ISO date string (YYYY-MM-DD) and today UTC.
// Used for the compare-baseline ghost needle label so the visible age
// matches the actual age of the data, even when KV history is shorter
// than 30 days. Returns at least 1 (no "0d ago" cosmetic glitch).
export function daysAgo(isoDate: string): number {
  const then = new Date(isoDate + "T00:00:00Z").getTime();
  if (!Number.isFinite(then)) return 30;
  const ms = Date.now() - then;
  return Math.max(1, Math.round(ms / 86_400_000));
}

export function polar(r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return {
    x: Math.round((CX + Math.cos(rad) * r) * 10000) / 10000,
    y: Math.round((CY + Math.sin(rad) * r) * 10000) / 10000,
  };
}

export function arcPath(r: number, startDeg: number, endDeg: number) {
  const a = polar(r, startDeg);
  const b = polar(r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const sweepFlag = sweep > 0 ? 1 : 0;
  // Use toFixed(4) on the radius too so the entire path string is
  // deterministic. The radius is itself an integer in our usage but
  // belt-and-suspenders.
  return `M ${a.x} ${a.y} A ${r.toFixed(4)} ${r.toFixed(4)} 0 ${largeArc} ${sweepFlag} ${b.x} ${b.y}`;
}

export function scoreToNeedleDeg(score: number): number {
  // Needle's reference orientation: pointing UP (-90°) at score 50.
  // Score 0 → -180° (left), score 100 → 0° (right).
  return (score / 100) * 180 - 90;
}

export function scoreToGaugeDeg(score: number): number {
  // For arc-fill paths along the dial track.
  return -180 + (score / 100) * 180;
}

// Stable seeded RNG so positions don't reshuffle on every render.
export function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

