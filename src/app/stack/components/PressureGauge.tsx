"use client";

/* =====================================================================
 * PressureGauge — Galaxy Mind Bitcoin Buying Gauge
 * =====================================================================
 *
 * KEY TECHNICAL CHOICES (the "wow factor" comes from these):
 *
 * 1. SVG GEOMETRY + CANVAS PARTICLES (hybrid, not Three.js).
 *    Three.js would balloon the bundle by ~600KB and gate hydration on
 *    a heavy script. Pure SVG keeps everything crisp at any DPI, lets
 *    React bind state directly to attributes, and lets the gauge stream
 *    in via Suspense without a JS roundtrip. A SINGLE <canvas> handles
 *    all transient particle effects (shards, ash, ember sprites) where
 *    SVG would create hundreds of DOM nodes.
 *
 * 2. BEZEL + DOME AS LAYERED SVG FILTERS.
 *    The "metallic bezel" is a radialGradient + an feTurbulence-driven
 *    brushed-steel grain filter, with twelve cross-slot rivets at
 *    R_RIVET. The dome glass uses TWO refraction layers: a static
 *    top-arc specular (the curve highlight) + a cursor-follow radial
 *    that moves with the user's pointer in real time. A slow
 *    "room-light sweep" animates a soft horizontal band across the
 *    glass every 9s — that's what sells "this is a real instrument
 *    sitting under fluorescents."
 *
 * 3. PHYSICS-BASED NEEDLE via framer-motion useSpring.
 *    Stiffness 80 / damping 12 produces realistic overshoot then
 *    settle. On drag release, a SECOND spring (stiffness 70, damping 9)
 *    snaps back to the live value with a satisfying mechanical thunk.
 *    The needle's transform is written via a direct ref (not React
 *    reconciler) so it's truly 60fps even when other state changes.
 *
 * 4. PROGRESSIVE EXTREMES, NOT BINARY THRESHOLDS.
 *    Frost ramps in linearly from score 35 → 0; heat ramps in from
 *    75 → 100. Cracks animate via stroke-dashoffset so they GROW from
 *    the impact point outward. At score ≥ 92, the canvas fires shards
 *    that fall under gravity with random angular velocity. That gradient
 *    of intensity is what makes the gauge feel alive instead of stateful.
 *
 * 5. METRIC INFLUENCE — the secret engagement weapon.
 *    Each SignalReading already carries `.normalized` (0–100) and
 *    `.weight`. The metric panel exposes those as sliders, recomputes
 *    the score as `Σ slider × weight`, and pipes the synthetic score
 *    into the gauge as a override. Mathematically equivalent to the
 *    server-side engine for those signals, with zero engine re-import.
 *
 * 6. EASTER EGGS WITH PROPER STATE.
 *    Rivet click → 220ms wobble keyframe applied to the bezel <g>.
 *    Double-click on the hub → reset to live with a 1.4s odometer
 *    animation through the score range. Both are tracked via Vercel
 *    Analytics so we can see if users find them.
 *
 * 7. WEB AUDIO API, OPT-IN BY DEFAULT.
 *    Auto-play audio is universally hated. The sound toggle defaults
 *    OFF; when enabled, OscillatorNode + GainNode produce procedural
 *    ticks (needle), low rumble (frost), and white-noise burst
 *    (shatter). No external sound files — keeps the page snappy.
 *
 * 8. ACCESSIBILITY.
 *    The whole gauge is a `role="slider"` with `aria-valuemin`,
 *    `aria-valuemax`, `aria-valuenow`. Keyboard arrow keys move the
 *    score in 1-pt increments; PageUp/PageDown in 10-pt; Home/End
 *    snap to 0/100. Focus state has a visible ring.
 *
 * TUNABLES (search for "TUNE:" comments to tweak):
 *   - FROST_THRESHOLD / HEAT_THRESHOLD: when extreme overlays start.
 *   - SHATTER_AT_SCORE: when shards start flying.
 *   - SPRING_STIFFNESS / SPRING_DAMPING: needle feel.
 *   - SHARD_MAX: max simultaneous shards (perf budget).
 *   - SOUND_VOLUME: master sound volume when enabled.
 * =====================================================================
 */

import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";

import {
  VW,
  VH,
  CX,
  CY,
  R_BEZEL_OUTER,
  R_BEZEL_BEVEL,
  R_BEZEL_INNER,
  R_RIVET,
  RIVET_COUNT,
  R_DIAL,
  R_TICK_OUTER,
  R_TICK_INNER,
  R_NEEDLE_TIP,
  R_DEPTH_2,
  R_DEPTH_3,
  R_HUB,
  FROST_SOFT,
  FROST_HARD,
  HEAT_SOFT,
  HEAT_HARD,
  SHATTER_AT_SCORE,
  FROST_BREAK_SCORE,
  BUY_SIGNAL_LO,
  SPRING_STIFFNESS,
  SPRING_DAMPING,
  SPRING_RELEASE_STIFFNESS,
  SPRING_RELEASE_DAMPING,
  SHARD_MAX,
  SHARD_LIFE_MS,
  SOUND_VOLUME,
  COOL_BLUE,
  ICE_GLOW,
  NEON_CYAN,
  NEON_PURPLE,
  RED_ZONE,
  AMBER_ZONE,
  GREEN_ZONE,
  daysAgo,
  polar,
  arcPath,
  scoreToNeedleDeg,
  scoreToGaugeDeg,
  seededRng,
} from "./pressure-gauge-math";

import { track } from "@vercel/analytics";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SignalReading, StackTier } from "@/lib/stack";
import { TIER_LABEL, scoreToTier } from "@/lib/stack";
import {
  brassBell,
  glassShatter,
  iceCrack,
  metalTap,
} from "@/lib/audio-synth";
import { haptic } from "@/lib/haptics";
import { MetricInfluencePanel } from "./MetricInfluencePanel";

/* =====================================================================
 * SUB-COMPONENT: BEZEL
 *
 * Metallic ring with brushed-steel finish, twelve cross-slot rivets,
 * inner bevel transition, and an engraved nameplate at the bottom rim.
 * Rivets are clickable for the "wobble" Easter egg.
 * ===================================================================== */

function Bezel({ onRivetClick }: { onRivetClick: () => void }) {
  // Twelve rivets evenly spaced around the bezel. Distribute by angle
  // and use polar() for positions.
  const rivets = useMemo(() => {
    return Array.from({ length: RIVET_COUNT }).map((_, i) => {
      const deg = (i / RIVET_COUNT) * 360 - 90; // start at top
      const p = polar(R_RIVET, deg);
      return { x: p.x, y: p.y, deg };
    });
  }, []);

  return (
    <g style={{ pointerEvents: "none" }}>
      <defs>
        {/* Outer bezel · radial gradient gives a "lit from above" 3D
            feel. Bright at top, mid-tone in middle, dark at bottom.
            This is the single biggest contributor to the "real metal"
            appearance · the eye reads the top-light gradient as a
            curved surface. */}
        <radialGradient
          id="bezelMetal"
          cx="50%"
          cy="0%"
          r="100%"
          fx="50%"
          fy="0%"
        >
          {/* Warm machined-alloy finish (instrument overhaul 2026-06-20)
              · retuned from cool blue-gunmetal to a champagne/bronze-steel
              so the bezel harmonizes with the brass hourglass on /float and
              the orange brand instead of reading as a generic cold rim.
              Wider dynamic range (brighter champagne key-light, deeper warm
              base) gives a richer machined read. Radial gradient anchored
              at the top quarter mimics overhead key lighting. */}
          <stop offset="0%" stopColor="#e6e0d4" />
          <stop offset="18%" stopColor="#9c9488" />
          <stop offset="46%" stopColor="#57514a" />
          <stop offset="74%" stopColor="#2a2622" />
          <stop offset="100%" stopColor="#131110" />
        </radialGradient>

        {/* Brushed-steel grain texture. fractalNoise + colorMatrix
            bumps the alpha into a fine-grained luminance overlay that
            multiplies on the bezel base. The result is the radial
            "scratched along the circumference" finish you see on real
            instrument bezels. */}
        <filter
          id="brushedSteel"
          x="-5%"
          y="-5%"
          width="110%"
          height="110%"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9 0.05"
            numOctaves="2"
            seed="7"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1
                    0 0 0 0 1
                    0 0 0 0 1
                    0 0 0 0.10 0"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>

        {/* Inner bevel · the lighting edge between the bezel rim and
            the recessed dial face. Top is dark (in shadow), bottom is
            bright (catches reflected light from below). */}
        <radialGradient id="bezelInnerBevel" cx="50%" cy="100%" r="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.6)" />
        </radialGradient>

        {/* Rivet head · a tiny radial gradient for each rivet's
            domed metallic appearance. Highlight in upper-left,
            shadow in lower-right (consistent with bezel's top light). */}
        <radialGradient
          id="rivetHead"
          cx="35%"
          cy="35%"
          r="70%"
        >
          <stop offset="0%" stopColor="#ece6da" />
          <stop offset="40%" stopColor="#867d6f" />
          <stop offset="100%" stopColor="#1d2027" />
        </radialGradient>
      </defs>

      {/* The bezel itself · outer ring of metallic gradient with
          brushed-steel grain on top. Two circles + an even-odd fill
          rule would be cleaner, but a path with two arcs is more
          compatible with SVG filters. */}
      <circle
        cx={CX}
        cy={CY}
        r={R_BEZEL_OUTER}
        fill="url(#bezelMetal)"
      />
      <circle
        cx={CX}
        cy={CY}
        r={R_BEZEL_OUTER}
        fill="white"
        filter="url(#brushedSteel)"
      />
      {/* Cut out the inner area · paint it with the page bg. */}
      <circle
        cx={CX}
        cy={CY}
        r={R_BEZEL_INNER}
        fill="var(--bg-base)"
      />
      {/* Inner bevel ring sits ON TOP of the dial face's outer edge,
          painting the lighting transition. */}
      <circle
        cx={CX}
        cy={CY}
        r={R_BEZEL_INNER + 4}
        fill="none"
        stroke="url(#bezelInnerBevel)"
        strokeWidth="8"
      />
      {/* Outer rim highlight · thin specular line at the very edge.
          This is what reads as "polished outer chamfer." */}
      <circle
        cx={CX}
        cy={CY}
        r={R_BEZEL_OUTER - 1}
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="1.5"
      />
      {/* Outer rim shadow · sits just inside the highlight. The
          highlight + shadow pair is what reads as a chamfered edge. */}
      <circle
        cx={CX}
        cy={CY}
        r={R_BEZEL_BEVEL}
        fill="none"
        stroke="rgba(0,0,0,0.45)"
        strokeWidth="1"
      />

      {/* Rivets · twelve cross-slot screws around the perimeter. Each
          is a tiny domed circle with a cross-slot incision. Clickable
          for the wobble easter egg. */}
      {rivets.map((r, i) => (
        <g
          key={i}
          style={{ cursor: "pointer", pointerEvents: "auto" }}
          onClick={(e) => {
            e.stopPropagation();
            onRivetClick();
          }}
        >
          {/* Recessed shadow ring (the rivet sits in a small well) */}
          <circle
            cx={r.x}
            cy={r.y}
            r={6}
            fill="rgba(0,0,0,0.6)"
            opacity="0.85"
          />
          {/* The rivet head proper */}
          <circle
            cx={r.x}
            cy={r.y}
            r={5}
            fill="url(#rivetHead)"
          />
          {/* Cross-slot incisions · two perpendicular dark lines */}
          <line
            x1={r.x - 3}
            y1={r.y}
            x2={r.x + 3}
            y2={r.y}
            stroke="rgba(0,0,0,0.7)"
            strokeWidth="0.8"
            strokeLinecap="round"
          />
          <line
            x1={r.x}
            y1={r.y - 3}
            x2={r.x}
            y2={r.y + 3}
            stroke="rgba(0,0,0,0.7)"
            strokeWidth="0.8"
            strokeLinecap="round"
          />
          {/* Tiny specular highlight to read as polished steel */}
          <circle
            cx={r.x - 1.4}
            cy={r.y - 1.4}
            r={1}
            fill="rgba(255,255,255,0.55)"
          />
        </g>
      ))}

      {/* Engraved manufacturer plate along the bottom of the bezel ·
          flavor text, gives it product authenticity. Uses textPath so
          the engraving curves with the bezel arc. */}
      <defs>
        <path
          id="engraveArc"
          d={arcPath(R_BEZEL_BEVEL - 5, 30, 150)}
        />
      </defs>
      <text
        // 0.6 measured 3.95:1 against the bezel it is engraved into, just
        // under AA for 15px. 0.78 clears it in both themes and still reads as
        // engraving rather than printing.
        fill="rgba(185,190,200,0.78)"
        style={{
          fontFamily: "var(--font-jetbrains-mono)",
          fontSize: 15,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
        }}
      >
        <textPath href="#engraveArc" startOffset="50%" textAnchor="middle">
          GALAXY MIND · MOD-21M
        </textPath>
      </text>
    </g>
  );
}

/* =====================================================================
 * SUB-COMPONENT: GLASS DOME
 *
 * Two-layer refraction: a static specular "curve highlight" at the top
 * of the dome + a cursor-follow radial that tracks the user's pointer.
 * A slow horizontal "room-light sweep" animates every 9 seconds. This
 * is what sells "this gauge is sitting in a real, lit room."
 * ===================================================================== */

function GlassDome({
  pointerSvg,
}: {
  pointerSvg: { x: number; y: number } | null;
}) {
  // Cursor-follow highlight position: when the cursor is over the
  // gauge, the highlight clings to it; when not, it parks at the top.
  const hx = pointerSvg?.x ?? CX;
  const hy = pointerSvg?.y ?? CY - R_BEZEL_INNER * 0.6;

  return (
    <g style={{ pointerEvents: "none" }}>
      <defs>
        {/* Static curve highlight · top quarter of the dome catches
            simulated light. This is the "this is curved glass" cue. */}
        <radialGradient id="domeStaticHi" cx="50%" cy="0%" r="65%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="40%" stopColor="rgba(255,255,255,0.06)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>

        {/* Inner subtle tint · a barely-there blue-cyan to suggest
            the glass has thickness. Pure transparent looks fake;
            real glass has a subtle color cast. */}
        <radialGradient id="domeTint" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="rgba(120, 180, 220, 0)" />
          <stop offset="80%" stopColor="rgba(120, 180, 220, 0.04)" />
          <stop offset="100%" stopColor="rgba(80, 120, 180, 0.10)" />
        </radialGradient>

        {/* Cursor-follow specular · small, soft, bright dot that tracks
            the pointer position. Positioned via attrs from JSX. */}
        <radialGradient id="domeCursorHi">
          <stop offset="0%" stopColor="rgba(255,255,255,0.40)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.12)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>

      {/* Inner subtle tint over the entire dial */}
      <circle
        cx={CX}
        cy={CY}
        r={R_BEZEL_INNER - 2}
        fill="url(#domeTint)"
      />

      {/* Static top-curve highlight */}
      <circle
        cx={CX}
        cy={CY}
        r={R_BEZEL_INNER - 2}
        fill="url(#domeStaticHi)"
      />

      {/* Cursor-follow highlight */}
      <radialGradient
        id="domeCursorPos"
        cx={hx}
        cy={hy}
        r={70}
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0%" stopColor="rgba(255,255,255,0.32)" />
        <stop offset="55%" stopColor="rgba(255,255,255,0.08)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0)" />
      </radialGradient>
      <circle
        cx={CX}
        cy={CY}
        r={R_BEZEL_INNER - 2}
        fill="url(#domeCursorPos)"
        style={{ transition: "opacity 0.4s" }}
      />

      {/* Slow room-light sweep · a soft horizontal band that drifts
          left-to-right every 9 seconds. Animates via a moving
          linearGradient. Subtle but unmistakable when you notice it. */}
      <defs>
        <linearGradient id="roomSweep" x1="-30%" y1="0%" x2="30%" y2="0%">
          <stop offset="0%" stopColor="rgba(255,255,255,0)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.10)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          <animate
            attributeName="x1"
            from="-50%"
            to="100%"
            dur="9s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="x2"
            from="0%"
            to="150%"
            dur="9s"
            repeatCount="indefinite"
          />
        </linearGradient>
      </defs>
      <circle
        cx={CX}
        cy={CY}
        r={R_BEZEL_INNER - 2}
        fill="url(#roomSweep)"
      />
    </g>
  );
}

/* =====================================================================
 * SUB-COMPONENT: DIAL FACE ZONES + NAMEPLATE + BUY SIGNAL
 * ===================================================================== */

function DialZones() {
  // Three discrete color zones underneath the lava-fill arc. These give
  // visitors instant "color = action" cue: red = expensive, amber =
  // neutral, green = optimal buy. Each zone is rendered as TWO arcs:
  // a wider blurred halo + a sharp inner band — giving the colored
  // zones the same depth/glow as the rest of the dial without being
  // visually noisy. The smooth lava-fill rides on top.
  const r = R_DIAL - 18;
  const zones = [
    { from: 0, to: 35, color: RED_ZONE },
    { from: 35, to: 65, color: AMBER_ZONE },
    { from: 65, to: 100, color: GREEN_ZONE },
  ];
  return (
    <g style={{ pointerEvents: "none" }}>
      {zones.map((z) => (
        <g key={z.from}>
          {/* Wider blurred halo behind */}
          <path
            d={arcPath(r, scoreToGaugeDeg(z.from), scoreToGaugeDeg(z.to))}
            stroke={z.color}
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            opacity="0.18"
            style={{ filter: "blur(3px)" }}
          />
          {/* Sharp inner band */}
          <path
            d={arcPath(r, scoreToGaugeDeg(z.from), scoreToGaugeDeg(z.to))}
            stroke={z.color}
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            opacity="0.55"
          />
        </g>
      ))}
    </g>
  );
}

function Nameplate() {
  // Small engraved maker's-mark plate · instrument flavor only. The
  // live verdict + scale words used to render in/around the dial but
  // were unreadably cramped on a circular face (verified twice). They
  // now render LARGE and theme-safe in HTML below the dial: the giant
  // score, the verdict badge, and <TierScaleLegend>. This plate is a
  // static brand engraving, sized small so it never collides with the
  // needle and stays a fixed light grey (readable on the dark dial in
  // both themes · no theme var, which would flip dark in light mode).
  return (
    <g style={{ pointerEvents: "none" }}>
      <rect
        x={CX - 96}
        y={CY + 50}
        width={192}
        height={26}
        rx={4}
        fill="rgba(0,0,0,0.45)"
        stroke="rgba(255,255,255,0.04)"
        strokeWidth="1"
      />
      <rect
        x={CX - 94}
        y={CY + 52}
        width={188}
        height={22}
        rx={3}
        fill="rgba(20,22,28,0.85)"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="0.5"
      />
      <text
        x={CX}
        y={CY + 63}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="rgba(205,210,220,0.85)"
        style={{
          fontFamily: "var(--font-jetbrains-mono)",
          /* Enlarged 11→13 + tracking 0.3em→0.18em + brighter (legibility
             audit 2026-06-20): at the ~0.47 mobile gauge scale the old
             11px/0.3em nameplate garbled into a smudge. */
          fontSize: 13,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        BTC BUY PRESSURE
      </text>
    </g>
  );
}

function BuySignalLight({ active }: { active: boolean }) {
  // A small "BUY SIGNAL" indicator panel inside the bezel, top-right
  // of the dial. Lit GREEN when the score is in the optimal zone (65+),
  // dark/dim otherwise. Gentle pulse when active.
  const baseY = CY - R_DIAL + 28;
  const baseX = CX + 95;
  return (
    <g style={{ pointerEvents: "none" }}>
      {/* Outer label */}
      <text
        x={baseX}
        y={baseY - 18}
        textAnchor="middle"
        // ENGRAVED, not plated. This legend sits at y 97-120 in a 700x600
        // viewBox, which straddles two different grounds: the dial face ends
        // at x~450 here (R_BEZEL_INNER 234) and the metal bezel carries the
        // rest. That is why the same label measured 1.25:1 and 3.21:1 on
        // different runs — a median-under-box sample lands on whichever side
        // it happens to cover.
        //
        // A backing plate like the BTC BUY PRESSURE nameplate below was the
        // obvious fix and does not fit: the text is 136.8 units wide, and a
        // plate around it puts its top-right corner at radius ~275 from
        // centre, through the rivet ring at 268 and past the bezel edge at
        // 280. Rectangles fight circular geometry at this radius.
        //
        // A dark stroke under a light fill (paint-order: stroke) gives the
        // glyphs their own ground wherever they fall, costs no layout, and
        // cannot collide with anything. It is also what engraved instrument
        // lettering actually looks like.
        fill={active ? GREEN_ZONE : "rgba(236,240,248,0.96)"}
        stroke="rgba(6,8,12,0.72)"
        strokeWidth={3}
        strokeLinejoin="round"
        paintOrder="stroke"
        style={{
          fontFamily: "var(--font-jetbrains-mono)",
          fontSize: 18,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          filter: active
            ? `drop-shadow(0 0 6px ${GREEN_ZONE})`
            : "none",
          transition: "fill 0.4s, filter 0.4s",
        }}
      >
        BUY SIGNAL
      </text>
      {/* The lamp itself */}
      <circle
        cx={baseX}
        cy={baseY}
        r={6}
        fill={active ? GREEN_ZONE : "rgba(40,45,55,0.95)"}
        stroke={active ? GREEN_ZONE : "rgba(80,85,95,0.6)"}
        strokeWidth="1"
        style={{
          filter: active
            ? `drop-shadow(0 0 8px ${GREEN_ZONE}) drop-shadow(0 0 16px ${GREEN_ZONE})`
            : "none",
          transition: "fill 0.4s, stroke 0.4s, filter 0.4s",
        }}
      >
        {active && (
          <animate
            attributeName="r"
            values="6;6.6;6"
            dur="1.2s"
            repeatCount="indefinite"
          />
        )}
      </circle>
      {/* Inner highlight when lit */}
      {active && (
        <circle
          cx={baseX - 1.5}
          cy={baseY - 1.5}
          r={1.5}
          fill="rgba(255,255,255,0.7)"
        />
      )}
    </g>
  );
}

/* =====================================================================
 * EXISTING SUB-COMPONENTS — preserved from v1, lightly tweaked
 * (Embers, Snowflakes, FrostOverlay, HeatOverlay, GlassCracks,
 *  SteamWisps).
 * ===================================================================== */

type EmberKind = "dot" | "btc" | "dollar";
type EmberSeed = {
  left: number;
  drift: number;
  duration: number;
  delay: number;
  kind: EmberKind;
};
function Embers({ intensity }: { intensity: number }) {
  // Defer Math.random()-based seed generation to client mount. If we
  // generated these in useMemo, the server would compute one set of
  // random values and the client would compute different values on
  // hydration → React #418 hydration mismatch. Empty initial state
  // means SSR renders the outer container only; particles materialize
  // after hydration.
  const [seeds, setSeeds] = useState<EmberSeed[]>([]);
  useEffect(() => {
    setSeeds(
      Array.from({ length: 12 }).map((_, i) => {
        const r = Math.random();
        const kind: EmberKind = r < 0.05 ? "dollar" : r < 0.25 ? "btc" : "dot";
        return {
          left: 22 + Math.random() * 56,
          drift: (Math.random() - 0.5) * 80,
          duration: 3 + Math.random() * 2.8,
          delay: i * 0.45 + Math.random() * 0.6,
          kind,
        };
      }),
    );
  }, []);
  if (intensity < 0.1) return null;
  const baseOpacity = 0.4 + intensity * 0.55;
  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden
    >
      {seeds.map((s, i) => {
        const common = {
          opacity: [0, baseOpacity, baseOpacity * 0.8, 0],
          y: [0, -60, -180, -260],
          x: [0, s.drift / 4, s.drift / 2, s.drift],
          scale: [0.3, 1, 0.8, 0.2],
        };
        const transition = {
          duration: s.duration,
          delay: s.delay,
          repeat: Infinity,
          ease: "linear" as const,
        };
        if (s.kind === "dot") {
          return (
            <motion.span
              key={i}
              className="absolute rounded-full"
              style={{
                left: `${s.left}%`,
                bottom: "20%",
                width: 3,
                height: 3,
                background: "var(--accent)",
                boxShadow:
                  "0 0 6px var(--accent), 0 0 14px rgba(247,147,26,0.5)",
              }}
              animate={common}
              transition={transition}
            />
          );
        }
        const char = s.kind === "btc" ? "₿" : "$";
        return (
          <motion.span
            key={i}
            className="absolute font-mono leading-none"
            style={{
              left: `${s.left}%`,
              bottom: "20%",
              fontSize: s.kind === "btc" ? 14 : 12,
              color: "var(--accent)",
              textShadow:
                "0 0 8px var(--accent), 0 0 16px rgba(247,147,26,0.6)",
              fontWeight: 700,
            }}
            animate={common}
            transition={transition}
          >
            {char}
          </motion.span>
        );
      })}
    </div>
  );
}

type SnowKind = "dot" | "flake";
type SnowSeed = {
  left: number;
  drift: number;
  duration: number;
  delay: number;
  rotateEnd: number;
  kind: SnowKind;
};
function Snowflakes({ intensity }: { intensity: number }) {
  const [seeds, setSeeds] = useState<SnowSeed[]>([]);
  useEffect(() => {
    setSeeds(
      Array.from({ length: 14 }).map((_, i) => {
        const r = Math.random();
        const kind: SnowKind = r < 0.3 ? "flake" : "dot";
        return {
          left: 18 + Math.random() * 64,
          drift: (Math.random() - 0.5) * 70,
          duration: 4.5 + Math.random() * 3,
          delay: i * 0.4 + Math.random() * 0.7,
          rotateEnd: (Math.random() - 0.5) * 360,
          kind,
        };
      }),
    );
  }, []);
  if (intensity < 0.1) return null;
  const baseOpacity = 0.45 + intensity * 0.5;
  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden
    >
      {seeds.map((s, i) => {
        const common = {
          opacity: [0, baseOpacity, baseOpacity * 0.7, 0],
          y: [0, 50, 160, 240],
          x: [0, s.drift / 4, s.drift / 2, s.drift],
          scale: [0.4, 1, 0.85, 0.3],
          rotate: s.kind === "flake" ? [0, s.rotateEnd] : 0,
        };
        const transition = {
          duration: s.duration,
          delay: s.delay,
          repeat: Infinity,
          ease: "linear" as const,
        };
        if (s.kind === "dot") {
          return (
            <motion.span
              key={i}
              className="absolute rounded-full"
              style={{
                left: `${s.left}%`,
                top: "8%",
                width: 2.5,
                height: 2.5,
                background: "rgba(180, 220, 255, 0.95)",
                boxShadow:
                  "0 0 4px rgba(180,220,255,0.8), 0 0 10px rgba(120,180,255,0.5)",
              }}
              animate={common}
              transition={transition}
            />
          );
        }
        return (
          <motion.span
            key={i}
            className="absolute leading-none"
            style={{
              left: `${s.left}%`,
              top: "6%",
              fontSize: 12,
              color: "#cfe7ff",
              textShadow:
                "0 0 6px rgba(207,231,255,0.85), 0 0 12px rgba(120,180,255,0.55)",
              fontWeight: 500,
            }}
            animate={common}
            transition={transition}
          >
            ❄
          </motion.span>
        );
      })}
    </div>
  );
}

type CrystalSpec = {
  x: number;
  y: number;
  glyph: string;
  size: number;
  rotate: number;
  opacity: number;
};

function generateCrystals(seed: number): CrystalSpec[] {
  const rng = seededRng(seed);
  const glyphs = ["❄", "❅", "❆", "✻"];
  const items: CrystalSpec[] = [];
  for (let i = 0; i < 18; i++) {
    const angle = -180 + rng() * 180;
    const r = 50 + rng() * 145;
    const angleRad = (angle * Math.PI) / 180;
    items.push({
      x: CX + Math.cos(angleRad) * r,
      y: CY + Math.sin(angleRad) * r,
      glyph: glyphs[Math.floor(rng() * glyphs.length)],
      size: 12 + rng() * 22,
      rotate: rng() * 90,
      opacity: 0.35 + rng() * 0.4,
    });
  }
  return items;
}

function FrostOverlay({ intensity }: { intensity: number }) {
  const crystals = useMemo(() => generateCrystals(13), []);
  if (intensity < 0.05) return null;
  return (
    <g
      style={{
        opacity: intensity,
        transition: "opacity 0.8s ease-in-out",
        pointerEvents: "none",
      }}
    >
      <defs>
        <filter id="frostTexture" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves="3"
            seed="5"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.86
                    0 0 0 0 0.93
                    0 0 0 0 1
                    0 0 0 0.6 0"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <radialGradient id="frostRim" cx="50%" cy="100%" r="80%">
          <stop offset="0%" stopColor="rgba(207,231,255,0)" />
          <stop offset="50%" stopColor="rgba(207,231,255,0.04)" />
          <stop offset="80%" stopColor="rgba(207,231,255,0.22)" />
          <stop offset="100%" stopColor="rgba(207,231,255,0.5)" />
        </radialGradient>
      </defs>

      <ellipse
        cx={CX}
        cy={CY}
        rx={R_DIAL - 6}
        ry={R_DIAL - 6}
        fill="white"
        filter="url(#frostTexture)"
        opacity="0.55"
      />
      <ellipse
        cx={CX}
        cy={CY}
        rx={R_DIAL - 4}
        ry={R_DIAL - 4}
        fill="url(#frostRim)"
      />
      {crystals.map((c, i) => (
        <text
          key={i}
          x={c.x}
          y={c.y}
          fontSize={c.size}
          fill="#cfe7ff"
          opacity={c.opacity}
          textAnchor="middle"
          dominantBaseline="central"
          transform={`rotate(${c.rotate} ${c.x} ${c.y})`}
          style={{
            filter: "drop-shadow(0 0 5px rgba(126,192,255,0.55))",
          }}
        >
          {c.glyph}
        </text>
      ))}
    </g>
  );
}

type CrackPath = { d: string; len: number };

type SpiderWeb = {
  radials: CrackPath[];
  branches: CrackPath[];
  arcs: CrackPath[];
  junctions: { x: number; y: number; size: number }[];
};

function generateSpiderWeb(
  seed: number,
  impactX: number,
  impactY: number,
  maxRadius: number,
): SpiderWeb {
  const rng = seededRng(seed);
  const numRadials = 7;
  const radials: CrackPath[] = [];
  const radialAngles: number[] = [];
  for (let i = 0; i < numRadials; i++) {
    const baseAngle = (i / numRadials) * Math.PI * 2;
    const angle = baseAngle + (rng() - 0.5) * 0.5;
    radialAngles.push(angle);
    const length = maxRadius * (0.55 + rng() * 0.4);
    let d = `M ${impactX.toFixed(2)} ${impactY.toFixed(2)}`;
    const segments = 6;
    let len = 0;
    let prevX = impactX;
    let prevY = impactY;
    for (let j = 1; j <= segments; j++) {
      const r = length * (j / segments);
      const a = angle + (rng() - 0.5) * 0.1;
      const x = impactX + Math.cos(a) * r;
      const y = impactY + Math.sin(a) * r;
      d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
      len += Math.hypot(x - prevX, y - prevY);
      prevX = x;
      prevY = y;
    }
    radials.push({ d, len });
  }
  const branches: CrackPath[] = [];
  for (let i = 0; i < 6; i++) {
    const radialIdx = Math.floor(rng() * numRadials);
    const radialAngle = radialAngles[radialIdx];
    const branchStartR = maxRadius * (0.2 + rng() * 0.45);
    const startX = impactX + Math.cos(radialAngle) * branchStartR;
    const startY = impactY + Math.sin(radialAngle) * branchStartR;
    const branchAngle =
      radialAngle + (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 0.4);
    const branchLength = (maxRadius - branchStartR) * (0.3 + rng() * 0.5);
    let d = `M ${startX.toFixed(2)} ${startY.toFixed(2)}`;
    const segments = 3;
    let len = 0;
    let prevX = startX;
    let prevY = startY;
    for (let j = 1; j <= segments; j++) {
      const r = branchLength * (j / segments);
      const a = branchAngle + (rng() - 0.5) * 0.12;
      const x = startX + Math.cos(a) * r;
      const y = startY + Math.sin(a) * r;
      d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
      len += Math.hypot(x - prevX, y - prevY);
      prevX = x;
      prevY = y;
    }
    branches.push({ d, len });
  }
  const arcs: CrackPath[] = [];
  for (let i = 0; i < 4; i++) {
    const radius = maxRadius * (0.28 + (i / 4) * 0.55) + rng() * 12;
    const startAngle = rng() * Math.PI * 2;
    const sweep = Math.PI / 3 + rng() * (Math.PI / 2);
    const endAngle = startAngle + sweep;
    const startX = impactX + Math.cos(startAngle) * radius;
    const startY = impactY + Math.sin(startAngle) * radius;
    const endX = impactX + Math.cos(endAngle) * radius;
    const endY = impactY + Math.sin(endAngle) * radius;
    const largeArc = sweep > Math.PI ? 1 : 0;
    const d = `M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} 1 ${endX.toFixed(2)} ${endY.toFixed(2)}`;
    arcs.push({ d, len: radius * sweep });
  }
  const junctions: { x: number; y: number; size: number }[] = [
    { x: impactX, y: impactY, size: 4 },
  ];
  for (let i = 0; i < 4; i++) {
    const radialAngle = radialAngles[Math.floor(rng() * numRadials)];
    const r = maxRadius * (0.3 + rng() * 0.4);
    junctions.push({
      x: impactX + Math.cos(radialAngle) * r,
      y: impactY + Math.sin(radialAngle) * r,
      size: 1.5 + rng() * 1.5,
    });
  }
  return { radials, branches, arcs, junctions };
}

function GlassCracks({
  kind,
  intensity,
}: {
  kind: "frost" | "heat";
  intensity: number;
}) {
  const impactX = CX - 18;
  const impactY = CY - 28;
  const maxRadius = R_DIAL - 12;
  const seed = kind === "frost" ? 23 : 41;
  const web = useMemo(
    () => generateSpiderWeb(seed, impactX, impactY, maxRadius),
    [seed, impactX, impactY, maxRadius],
  );

  if (intensity < 0.05) return null;

  const palette =
    kind === "frost"
      ? {
          sharp: "#e8f1ff",
          halo: "rgba(207,231,255,0.55)",
          glow: "rgba(126,192,255,0.65)",
          star: "#dde8fb",
          starGlow: "rgba(126,192,255,0.85)",
        }
      : {
          sharp: "#FFE8B5",
          halo: "rgba(255,180,80,0.55)",
          glow: "rgba(247,147,26,0.85)",
          star: "#FFF1C9",
          starGlow: "rgba(247,147,26,1)",
        };

  const renderCrack = (
    path: CrackPath,
    key: string,
    opts: { haloW: number; sharpW: number; delay: number },
  ) => {
    const dash = Math.max(path.len, 120) + 20;
    const offset = dash * (1 - intensity);
    return (
      <g key={key}>
        <path
          d={path.d}
          stroke={palette.halo}
          strokeWidth={opts.haloW}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={dash}
          strokeDashoffset={offset}
          opacity={0.85}
          style={{
            filter: "blur(1.6px)",
            transition: `stroke-dashoffset 0.8s ease-out ${opts.delay}s`,
          }}
        />
        <path
          d={path.d}
          stroke={palette.sharp}
          strokeWidth={opts.sharpW}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={dash}
          strokeDashoffset={offset}
          style={{
            filter: `drop-shadow(0 0 3px ${palette.glow})`,
            transition: `stroke-dashoffset 0.8s ease-out ${opts.delay}s`,
          }}
        />
      </g>
    );
  };

  return (
    <g style={{ pointerEvents: "none" }}>
      {web.arcs.map((a, i) =>
        renderCrack(a, `arc-${i}`, {
          haloW: 3.2,
          sharpW: 0.85,
          delay: 0.25 + i * 0.08,
        }),
      )}
      {web.branches.map((b, i) =>
        renderCrack(b, `branch-${i}`, {
          haloW: 2.6,
          sharpW: 1,
          delay: 0.1 + i * 0.06,
        }),
      )}
      {web.radials.map((r, i) =>
        renderCrack(r, `radial-${i}`, {
          haloW: 4,
          sharpW: 1.5,
          delay: i * 0.04,
        }),
      )}
      {web.junctions.map((j, i) => (
        <circle
          key={`star-${i}`}
          cx={j.x}
          cy={j.y}
          r={j.size * intensity}
          fill={palette.star}
          opacity={intensity * 0.95}
          style={{
            filter: `drop-shadow(0 0 6px ${palette.starGlow})`,
            transition: "r 0.6s ease-out, opacity 0.6s ease-out",
          }}
        />
      ))}
    </g>
  );
}

function HeatOverlay({ intensity }: { intensity: number }) {
  if (intensity < 0.05) return null;
  return (
    <g
      style={{
        opacity: intensity,
        transition: "opacity 0.6s ease-in-out",
        pointerEvents: "none",
      }}
    >
      <defs>
        <radialGradient id="hotMetalGlow" cx="50%" cy="100%" r="70%">
          <stop offset="0%" stopColor="rgba(255,225,170,0.55)">
            <animate
              attributeName="stop-opacity"
              values="0.55;0.8;0.55"
              dur="1.4s"
              repeatCount="indefinite"
            />
          </stop>
          <stop offset="40%" stopColor="rgba(255,160,60,0.28)" />
          <stop offset="80%" stopColor="rgba(247,90,8,0.10)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <filter id="heatShimmer" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012"
            numOctaves="2"
            seed="2"
          >
            <animate
              attributeName="baseFrequency"
              values="0.012;0.018;0.012"
              dur="2.2s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="seed"
              values="2;5;2"
              dur="3s"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1
                    0 0 0 0 0.65
                    0 0 0 0 0.2
                    0 0 0 0.18 0"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
      <ellipse
        cx={CX}
        cy={CY}
        rx={R_DIAL - 6}
        ry={R_DIAL - 6}
        fill="url(#hotMetalGlow)"
      />
      <ellipse
        cx={CX}
        cy={CY}
        rx={R_DIAL - 6}
        ry={R_DIAL - 6}
        fill="white"
        filter="url(#heatShimmer)"
        opacity="0.6"
      />
    </g>
  );
}

type WispKind = "puff" | "plume" | "haze";
type Wisp = {
  left: number;
  drift: number;
  duration: number;
  delay: number;
  size: number;
  blur: number;
  kind: WispKind;
};

function SteamWisps({ intensity }: { intensity: number }) {
  const wisps = useMemo<Wisp[]>(() => {
    const rng = seededRng(17);
    const items: Wisp[] = [];
    for (let i = 0; i < 12; i++) {
      const r = rng();
      const kind: WispKind = r < 0.4 ? "puff" : r < 0.85 ? "plume" : "haze";
      items.push({
        left: 18 + rng() * 64,
        drift: (rng() - 0.5) * 70,
        duration:
          kind === "puff"
            ? 1.8 + rng() * 0.8
            : kind === "plume"
              ? 2.6 + rng() * 1.2
              : 4.5 + rng() * 2,
        delay: i * 0.32 + rng() * 0.4,
        size:
          kind === "puff"
            ? 12 + rng() * 8
            : kind === "plume"
              ? 22 + rng() * 18
              : 50 + rng() * 30,
        blur:
          kind === "puff" ? 1.5 : kind === "plume" ? 3 : 8,
        kind,
      });
    }
    return items;
  }, []);

  if (intensity < 0.08) return null;
  return (
    <div
      className="absolute inset-x-0 top-0 h-full pointer-events-none overflow-hidden"
      aria-hidden
    >
      {wisps.map((w, i) => {
        const peakOpacity =
          w.kind === "puff"
            ? 0.35 + intensity * 0.45
            : w.kind === "plume"
              ? 0.22 + intensity * 0.32
              : 0.1 + intensity * 0.18;
        const baseColor =
          w.kind === "puff"
            ? "rgba(255,225,180,0.6)"
            : "rgba(255,255,255,0.5)";
        return (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${w.left}%`,
              top: w.kind === "haze" ? "10%" : "32%",
              width: w.size,
              height: w.size,
              background: `radial-gradient(circle, ${baseColor} 0%, rgba(255,255,255,0) 70%)`,
              filter: `blur(${w.blur}px)`,
            }}
            animate={{
              opacity: [0, peakOpacity, peakOpacity * 0.6, 0],
              y:
                w.kind === "puff"
                  ? [0, -40, -110, -190]
                  : w.kind === "plume"
                    ? [0, -50, -140, -240]
                    : [0, -60, -160, -300],
              x: [
                0,
                w.drift / 4,
                w.drift / 2,
                w.drift + (w.kind === "haze" ? 30 : 0),
              ],
              scale:
                w.kind === "puff"
                  ? [0.7, 1, 1.3, 1.6]
                  : w.kind === "plume"
                    ? [0.5, 1, 1.6, 2.2]
                    : [0.6, 1.1, 1.8, 2.6],
              rotate: [0, w.drift > 0 ? 4 : -4, w.drift > 0 ? 8 : -8, 0],
            }}
            transition={{
              duration: w.duration,
              delay: w.delay,
              repeat: Infinity,
              ease: "easeOut",
            }}
          />
        );
      })}
    </div>
  );
}

/* =====================================================================
 * SHARD CANVAS — flying glass shards on shatter
 *
 * Single <canvas> overlay running its own rAF loop. When the score
 * crosses SHATTER_AT_SCORE upward, we emit a burst of N shards each
 * with random angle, velocity, rotation, and gravity. They live for
 * ~SHARD_LIFE_MS ms then despawn. All concentrated in the upper half
 * of the gauge so it reads as glass falling INTO the dial area, not
 * the page.
 * ===================================================================== */

type Shard = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  bornAt: number;
  hue: number;
};

function ShardCanvas({ trigger }: { trigger: number }) {
  // `trigger` is a counter the parent increments to fire a new shower.
  // We use a counter instead of a boolean so the same value re-firing
  // is intentional (parent decides cadence).
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shardsRef = useRef<Shard[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTriggerRef = useRef(trigger);

  useEffect(() => {
    if (trigger === lastTriggerRef.current) return;
    lastTriggerRef.current = trigger;
    // Spawn a burst of shards from the impact point.
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Coordinates in canvas-local space. Place burst at the visual
    // center of the dial face.
    const w = canvas.width;
    const h = canvas.height;
    const cx = w * (CX / VW);
    const cy = h * ((CY - 30) / VH);
    const burstSize = Math.min(
      SHARD_MAX - shardsRef.current.length,
      24 + Math.floor(Math.random() * 12),
    );
    const now = performance.now();
    for (let i = 0; i < burstSize; i++) {
      const angle = -Math.PI + Math.random() * Math.PI; // upper half
      const speed = 2 + Math.random() * 4.5;
      shardsRef.current.push({
        x: cx + (Math.random() - 0.5) * 30,
        y: cy + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - Math.random() * 2,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.4,
        size: 4 + Math.random() * 8,
        bornAt: now,
        hue: 30 + Math.random() * 25, // amber-orange
      });
    }
  }, [trigger]);

  // rAF render loop — runs continuously while there are shards alive,
  // sleeps when the array is empty.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(50, now - last) / 16.67; // 60fps reference
      last = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const alive: Shard[] = [];
      for (const s of shardsRef.current) {
        const age = now - s.bornAt;
        if (age > SHARD_LIFE_MS) continue;
        // Update physics
        s.vy += 0.18 * dt; // gravity
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.rot += s.vrot * dt;
        // Render
        const lifeFrac = age / SHARD_LIFE_MS;
        const alpha = 1 - lifeFrac * lifeFrac;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        // Glass shard: thin diamond
        ctx.beginPath();
        ctx.moveTo(0, -s.size);
        ctx.lineTo(s.size * 0.4, 0);
        ctx.lineTo(0, s.size);
        ctx.lineTo(-s.size * 0.4, 0);
        ctx.closePath();
        ctx.fillStyle = `hsla(${s.hue}, 95%, 70%, ${alpha * 0.7})`;
        ctx.fill();
        ctx.strokeStyle = `hsla(${s.hue}, 100%, 85%, ${alpha})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        // Inner highlight — the "this is glass" cue
        ctx.beginPath();
        ctx.moveTo(0, -s.size * 0.7);
        ctx.lineTo(s.size * 0.2, -s.size * 0.2);
        ctx.strokeStyle = `hsla(45, 100%, 95%, ${alpha * 0.85})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        ctx.restore();
        alive.push(s);
      }
      shardsRef.current = alive;
      if (alive.length > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [trigger]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
    />
  );
}

/* =====================================================================
 * SOUND HOOK — opt-in Web Audio.
 *
 * Procedural synthesis only — no external sound files. Default OFF
 * (auto-play audio is widely hated; user must opt in). When enabled,
 * we lazy-init the AudioContext on first sound to comply with browser
 * autoplay policies (must follow a user gesture).
 *
 * SOUND DESIGN (May 2026 rebuild)
 * ───────────────────────────────
 * The gauge is a brass-and-glass instrument, so the sounds should
 * evoke the same vocabulary · metallic strikes, bell harmonics,
 * crystalline cracking, layered glass shatter. The previous
 * single-oscillator sweeps sounded like a digital alarm clock.
 *
 * Each sound now delegates to a primitive in src/lib/audio-synth.ts:
 *   tick     · metalTap   · short brass strike with mid-resonance
 *   ding     · brassBell  · additive synthesis with 5 partials and
 *                           reverb tail · proper "bell" timbre
 *   iceCrack · iceCrack   · discrete crack pings over a low rumble
 *   shatter  · glassShatter · 3-stage: impact + body + scattered
 *                             debris pings
 * ===================================================================== */

type SoundKind = "tick" | "iceCrack" | "shatter" | "ding";

function useGaugeAudio(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);

  // Lazy-init context on first play() call (gesture-bound). The
  // immediate ctx.resume() is critical · Safari and iOS Safari
  // create AudioContexts in `suspended` state and don't auto-start
  // them, even when the create call follows a user gesture. Without
  // this, the first N play() calls schedule sounds against a
  // suspended context that never plays them · symptom is "sound
  // is intermittent" or "takes a long time to start working".
  // resume() is a no-op if the context is already running.
  const ensureCtx = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = SOUND_VOLUME;
    master.connect(ctx.destination);
    ctxRef.current = ctx;
    masterRef.current = master;
    // Fire-and-forget resume · the .catch handles cases where the
    // browser rejects (e.g. context created outside a gesture window).
    // The next play() call's resume will succeed when a gesture lands.
    ctx.resume().catch(() => {});
    return ctx;
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      masterRef.current = null;
    };
  }, []);

  const play = useCallback(
    (kind: SoundKind) => {
      if (!enabled) return;
      const ctx = ensureCtx();
      if (!ctx || !masterRef.current) return;
      // Defense in depth · resume on every play. If the context
      // dropped to suspended (tab backgrounded, system sleep), this
      // wakes it up before the sound is scheduled. Cheap no-op when
      // already running.
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const t0 = ctx.currentTime;
      const synth = { ctx, master: masterRef.current };

      if (kind === "tick") {
        // Brass tap · sharper than the old triangle sweep, with a
        // resonant mid-pitch body that decays naturally. Quiet
        // volume because this fires on every needle movement and
        // must stay subtle.
        metalTap(synth, t0, 1800, 0.35);
        // Light haptic tap · throttled at 35ms so dense drag motion
        // (the gauge can fire dozens of ticks/sec) doesn't blur into
        // a continuous buzz.
        haptic("needleTick", true);
      } else if (kind === "iceCrack") {
        // Crystalline cracking · discrete pings over a low rumble.
        // The old sawtooth sweep sounded like a sci-fi riser; this
        // sounds like ice actually fracturing.
        iceCrack(synth, t0, 0.45);
        // Multi-pulse vibration mirrors the audio crack events.
        haptic("iceCrack", true);
      } else if (kind === "shatter") {
        // Multi-stage glass shatter · sharp impact, broadband break,
        // scattered debris pings. Spatial via shared reverb bus.
        glassShatter(synth, t0, 0.65);
        // Heavy 4-pulse haptic cascade matches the debris pings ·
        // the most dramatic event on the page · pair to the audio.
        haptic("glassShatter", true);
      } else if (kind === "ding") {
        // Brass bell · additive synthesis with inharmonic partial.
        // C5 fundamental (523Hz) gives a warm "deal closing" feel
        // appropriate to the HOT tier entry.
        brassBell(synth, t0, 523, 1.6, 0.4);
        // Two-pulse "ding-dong" haptic.
        haptic("bellDing", true);
      }
    },
    [enabled, ensureCtx],
  );

  return play;
}

/* =====================================================================
 * MAIN COMPONENT
 * ===================================================================== */

type OverrideSource = "drag" | "synthetic" | "sim" | null;

export function PressureGauge({
  score: actualScore,
  blockHeight,
  signals,
  compareBaseline,
}: {
  score: number;
  // Tier kept for backward compat but recomputed live from displayedScore.
  tier: StackTier;
  blockHeight: number | null;
  signals?: SignalReading[];
  // Optional historical comparison baseline (score + actual date) for
  // the "vs 30d ago" ghost-needle toggle. When provided + the user
  // toggles ON, a translucent ghost needle is rendered at the baseline
  // score with a label showing the *actual* age of the data ("18d ago"
  // when KV only has 18 days, not a misleading "30d ago"). Null = no
  // comparison data available (day-1 deploy, < 25d of history, KV
  // unset, etc.) — toggle button silently doesn't render.
  compareBaseline?: { score: number; date: string } | null;
}) {
  /* ---------------- State ---------------- */
  const [dragScore, setDragScore] = useState<number | null>(null);
  const [hasDragged, setHasDragged] = useState(false);
  const [syntheticScore, setSyntheticScore] = useState<number | null>(null);
  // Mobile: the 10-slider influence panel is collapsed behind a
  // disclosure so a casual "should I buy?" visitor isn't forced to scroll
  // past a full-viewport experiment to reach the verdict below (UX audit
  // 2026-07-13 · B5a). Desktop (lg) keeps it open beside the gauge.
  const [showSignals, setShowSignals] = useState(false);
  const [simScore, setSimScore] = useState<number | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [simElapsedMs, setSimElapsedMs] = useState(0);
  const [simTimeInZone, setSimTimeInZone] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  // Personal best for Sim Mode (ms in green zone). Hydrated from
  // localStorage post-mount so SSR stays deterministic. The previous
  // round's score is shown next to the Sim button so users have a
  // target to beat — classic loop-closing UX.
  const [simBestMs, setSimBestMs] = useState<number | null>(null);
  // Compare-to-30d-ago toggle. Persisted via localStorage so engaged
  // users get their preference back on next visit. Default OFF — the
  // ghost needle is a power-user feature; we don't want to clutter the
  // gauge for first-timers.
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [bezelWobble, setBezelWobble] = useState(0); // counter; bumps trigger wobble
  const [shatterTrigger, setShatterTrigger] = useState(0);
  const [pointerSvg, setPointerSvg] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [glitchTick, setGlitchTick] = useState(0); // bumps to fire scanline glitch

  // === Persistence ===
  // Storage keys — namespaced so we can add more without collisions.
  // Schema is intentionally tiny: localStorage limits, mobile Safari
  // private mode quirks. JSON.parse only when we have to.
  const LS_SOUND = "gm:gauge:soundEnabled";
  const LS_SIM_BEST = "gm:gauge:simBestMs";
  const LS_COMPARE = "gm:gauge:compareEnabled";

  // Hydrate from localStorage on first client paint. Wrapped in
  // try/catch because localStorage throws under iframe sandboxing,
  // private-browsing modes, etc. — we just gracefully default OFF.
  useEffect(() => {
    try {
      const s = localStorage.getItem(LS_SOUND);
      if (s === "1") setSoundEnabled(true);
      const b = localStorage.getItem(LS_SIM_BEST);
      if (b) {
        const n = Number(b);
        if (Number.isFinite(n) && n > 0) setSimBestMs(n);
      }
      const c = localStorage.getItem(LS_COMPARE);
      if (c === "1") setCompareEnabled(true);
    } catch {
      /* sandboxed / disabled — ignore */
    }
  }, []);

  // Sync sound + compare toggles → localStorage. We persist even when
  // toggled OFF so the default-off behavior is consistent for
  // first-time users (no LS key) and explicit-off users (LS = "0").
  useEffect(() => {
    try {
      localStorage.setItem(LS_SOUND, soundEnabled ? "1" : "0");
    } catch {
      /* LS write best-effort · privacy mode / quota · ignore */
    }
  }, [soundEnabled]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_COMPARE, compareEnabled ? "1" : "0");
    } catch {
      /* LS write best-effort · privacy mode / quota · ignore */
    }
  }, [compareEnabled]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragTrackedRef = useRef(false);
  const lastTierForSoundRef = useRef<StackTier | null>(null);
  const lastShatterScoreRef = useRef<number>(0);
  const blockPulseRef = useRef(false);

  /* ---------------- Override resolution ---------------- */
  // Priority: drag > simulation > synthetic > live.
  // override source tracking is mainly for the readout chip below.
  const overrideScore: number | null =
    dragScore ?? simScore ?? syntheticScore;
  const overrideSource: OverrideSource = dragScore !== null
    ? "drag"
    : simScore !== null
      ? "sim"
      : syntheticScore !== null
        ? "synthetic"
        : null;
  const displayedScore = overrideScore ?? actualScore;
  const displayedTier = scoreToTier(Math.round(displayedScore));

  /* ---------------- Sound ---------------- */
  const playSound = useGaugeAudio(soundEnabled);

  // Tier-change ding — fires when entering the BUY zone (HOT or MOLTEN)
  // from below.
  useEffect(() => {
    const prev = lastTierForSoundRef.current;
    lastTierForSoundRef.current = displayedTier;
    if (prev == null) return;
    if (
      (displayedTier === "HOT" || displayedTier === "MOLTEN") &&
      prev !== "HOT" &&
      prev !== "MOLTEN"
    ) {
      playSound("ding");
    }
    if (
      displayedTier === "COLD" &&
      prev !== "COLD" &&
      displayedScore < FROST_BREAK_SCORE
    ) {
      playSound("iceCrack");
    }
  }, [displayedTier, displayedScore, playSound]);

  /* ---------------- Needle physics ---------------- */
  const targetDeg = scoreToNeedleDeg(displayedScore);
  const needleAngle = useSpring(targetDeg, {
    stiffness: SPRING_STIFFNESS,
    damping: SPRING_DAMPING,
  });

  useEffect(() => {
    needleAngle.set(targetDeg);
  }, [targetDeg, needleAngle]);

  // Block-height pulse — tiny needle nudge each new block. We snap
  // back to `targetDeg` (the settled target), NOT to needleAngle.get()
  // (which is the instantaneous spring-mid-flight value). If the
  // spring is still animating when a block arrives, get() returns an
  // intermediate value and the snap-back parks the needle at that
  // intermediate position rather than the true target — visible as a
  // brief jitter on fast machines.
  useEffect(() => {
    if (blockHeight == null) return;
    blockPulseRef.current = true;
    needleAngle.set(targetDeg + 1.5);
    const t = setTimeout(() => {
      needleAngle.set(targetDeg);
      blockPulseRef.current = false;
    }, 200);
    return () => clearTimeout(t);
  }, [blockHeight, needleAngle, targetDeg]);

  // Idle micro-jitter — only when not actively interacting.
  useEffect(() => {
    if (overrideScore !== null) return;
    const id = setInterval(() => {
      if (blockPulseRef.current) return;
      const jitter = (Math.random() - 0.5) * 0.6;
      needleAngle.set(targetDeg + jitter);
    }, 2000);
    return () => clearInterval(id);
  }, [targetDeg, needleAngle, overrideScore]);

  // Direct ref subscription — bypass React's reconciler for per-frame
  // SVG attribute writes. Critical for 60fps spring response.
  const needleRef = useRef<SVGGElement | null>(null);
  useEffect(() => {
    const apply = (v: number) => {
      needleRef.current?.setAttribute(
        "transform",
        `rotate(${v} ${CX} ${CY})`,
      );
    };
    apply(needleAngle.get());
    return needleAngle.on("change", apply);
  }, [needleAngle]);

  /* ---------------- Shatter trigger ---------------- */
  // Fire a shard burst when crossing SHATTER_AT_SCORE upward.
  useEffect(() => {
    const prev = lastShatterScoreRef.current;
    lastShatterScoreRef.current = displayedScore;
    if (prev < SHATTER_AT_SCORE && displayedScore >= SHATTER_AT_SCORE) {
      setShatterTrigger((t) => t + 1);
      playSound("shatter");
    }
  }, [displayedScore, playSound]);

  // Glitch the readout when the score changes by more than 5 points
  // in a single update.
  const lastDisplayedRef = useRef(displayedScore);
  useEffect(() => {
    if (Math.abs(displayedScore - lastDisplayedRef.current) > 5) {
      setGlitchTick((t) => t + 1);
    }
    lastDisplayedRef.current = displayedScore;
  }, [displayedScore]);

  /* ---------------- Score odometer ---------------- */
  const odometer = useMotionValue(0);
  const odometerText = useTransform(odometer, (v) => Math.round(v).toString());
  const hasMounted = useRef(false);
  useEffect(() => {
    if (hasMounted.current) {
      odometer.set(displayedScore);
      return;
    }
    hasMounted.current = true;
    const controls = animate(odometer, displayedScore, {
      duration: 1.4,
      ease: [0.23, 1, 0.32, 1],
    });
    return () => controls.stop();
  }, [displayedScore, odometer]);

  /* ---------------- Drag mechanics ---------------- */
  const pointerToScore = useCallback(
    (clientX: number, clientY: number): number => {
      const svg = containerRef.current?.querySelector("svg");
      if (!svg) return actualScore;
      const rect = svg.getBoundingClientRect();
      const scale = rect.width / VW;
      const svgX = (clientX - rect.left) / scale;
      const svgY = (clientY - rect.top) / scale;
      const dx = svgX - CX;
      const dy = svgY - CY;
      let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      // Map any positive (below) angle to the closer edge.
      if (angleDeg > 0) {
        angleDeg = dx < 0 ? -180 : 0;
      }
      const clamped = Math.max(-180, Math.min(0, angleDeg));
      return Math.round(((clamped + 180) / 180) * 100);
    },
    [actualScore],
  );

  const startDrag = useCallback(
    (clientX: number, clientY: number) => {
      const s = pointerToScore(clientX, clientY);
      setDragScore(s);
      if (!dragTrackedRef.current) {
        dragTrackedRef.current = true;
        track("stack_gauge_drag");
      }
      if (!hasDragged) setHasDragged(true);
      playSound("tick");
    },
    [pointerToScore, hasDragged, playSound],
  );

  const updateDrag = useCallback(
    (clientX: number, clientY: number) => {
      const s = pointerToScore(clientX, clientY);
      setDragScore((prev) => {
        if (prev !== null && Math.abs(prev - s) >= 5) playSound("tick");
        return s;
      });
    },
    [pointerToScore, playSound],
  );

  const endDrag = useCallback(() => {
    if (dragScore === null) return;
    const start = scoreToNeedleDeg(dragScore);
    setDragScore(null);
    needleAngle.jump(start);
    // Snap to whatever override is *active besides drag* — sim score
    // first, then synthetic score, then live. Reading `overrideScore`
    // here would be a stale closure: that derived value still includes
    // dragScore from the pre-setDragScore(null) render, causing the
    // needle to snap to the drag position instead of the synthetic
    // score the user set in the influence panel.
    const targetSnap = simScore ?? syntheticScore ?? actualScore;
    animate(needleAngle, scoreToNeedleDeg(targetSnap), {
      type: "spring",
      stiffness: SPRING_RELEASE_STIFFNESS,
      damping: SPRING_RELEASE_DAMPING,
      restDelta: 0.05,
    });
    playSound("tick");
  }, [dragScore, actualScore, simScore, syntheticScore, needleAngle, playSound]);

  // Pointer move tracker for the cursor-follow glass highlight (always
  // on, runs while pointer is over the gauge container).
  const trackPointer = useCallback((clientX: number, clientY: number) => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / VW;
    setPointerSvg({
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    });
  }, []);

  // Global pointer handlers while dragging.
  useEffect(() => {
    if (dragScore === null) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      updateDrag(e.clientX, e.clientY);
      trackPointer(e.clientX, e.clientY);
    };
    const onUp = () => endDrag();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragScore, updateDrag, endDrag, trackPointer]);

  /* ---------------- Keyboard accessibility ---------------- */
  // Arrow keys nudge the override score; PageUp/Down jump 10; Home/End
  // snap to extremes. Sets syntheticScore so the gauge holds the value
  // until the user resets via the panel.
  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const cur = displayedScore;
      let next: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") next = cur + 1;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = cur - 1;
      else if (e.key === "PageUp") next = cur + 10;
      else if (e.key === "PageDown") next = cur - 10;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = 100;
      else if (e.key === " ") {
        // Space resets to live.
        e.preventDefault();
        setSyntheticScore(null);
        setSimScore(null);
        setSimRunning(false);
        return;
      }
      if (next != null) {
        e.preventDefault();
        const clamped = Math.max(0, Math.min(100, next));
        setSyntheticScore(clamped);
        playSound("tick");
      }
    },
    [displayedScore, playSound],
  );

  /* ---------------- Easter eggs ---------------- */
  const triggerWobble = useCallback(() => {
    setBezelWobble((n) => n + 1);
    track("stack_gauge_rivet_click");
  }, []);

  const onHubDoubleClick = useCallback(() => {
    // Reset all overrides + brief odometer spin to actual.
    setSyntheticScore(null);
    setSimScore(null);
    setSimRunning(false);
    track("stack_gauge_hub_doubleclick");
    // Kick the spring with a tiny overshoot so it feels mechanical.
    const cur = needleAngle.get();
    animate(needleAngle, cur + 8, {
      duration: 0.12,
      ease: "easeOut",
      onComplete: () => {
        animate(needleAngle, scoreToNeedleDeg(actualScore), {
          type: "spring",
          stiffness: 60,
          damping: 8,
        });
      },
    });
    playSound("tick");
  }, [needleAngle, actualScore, playSound]);

  /* ---------------- Simulation Mode ---------------- */
  // True score wanders via small random walks plus occasional shocks.
  // User can drag to push back into the green zone. We track time in
  // zone and elapsed time. 60-second round.
  const SIM_DURATION_MS = 60_000;
  const simTrueRef = useRef<number>(50);
  const simStartRef = useRef<number>(0);
  const simInZoneStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!simRunning) return;
    simTrueRef.current = 50;
    simStartRef.current = performance.now();
    simInZoneStartRef.current = null;
    setSimElapsedMs(0);
    setSimTimeInZone(0);

    const id = setInterval(() => {
      // Random walk + occasional shocks
      const drift = (Math.random() - 0.5) * 4;
      const shock = Math.random() < 0.08 ? (Math.random() - 0.5) * 30 : 0;
      simTrueRef.current = Math.max(
        0,
        Math.min(100, simTrueRef.current + drift + shock),
      );
      // If user is dragging, their drag overrides — but the "true"
      // value still drifts underneath; on release, the gauge snaps to
      // it. So we set simScore to simTrue.
      setSimScore(simTrueRef.current);

      const elapsed = performance.now() - simStartRef.current;
      setSimElapsedMs(elapsed);

      const inZone = simTrueRef.current >= BUY_SIGNAL_LO;
      if (inZone) {
        if (simInZoneStartRef.current == null) {
          simInZoneStartRef.current = performance.now();
        }
      } else {
        if (simInZoneStartRef.current != null) {
          setSimTimeInZone(
            (z) => z + (performance.now() - simInZoneStartRef.current!),
          );
          simInZoneStartRef.current = null;
        }
      }

      if (elapsed >= SIM_DURATION_MS) {
        // Finalize zone time, then update personal best if this round
        // improved on it. Persist to localStorage so the best survives
        // refreshes and tab close.
        let finalZoneMs = 0;
        setSimTimeInZone((z) => {
          const final = simInZoneStartRef.current != null
            ? z + (performance.now() - simInZoneStartRef.current!)
            : z;
          finalZoneMs = final;
          return final;
        });
        // Defer the best-check by one tick so finalZoneMs is set.
        setTimeout(() => {
          setSimBestMs((prev) => {
            if (prev != null && prev >= finalZoneMs) return prev;
            try { localStorage.setItem(LS_SIM_BEST, String(finalZoneMs)); } catch {
      /* LS write best-effort · privacy mode / quota · ignore */
    }
            track("stack_sim_best_updated");
            return finalZoneMs;
          });
        }, 0);
        setSimRunning(false);
        setSimScore(null);
      }
    }, 200);

    return () => clearInterval(id);
  }, [simRunning]);

  /* ---------------- Derived display state ---------------- */
  const inStackZone = displayedScore >= BUY_SIGNAL_LO;
  const intensity = Math.max(0, Math.min(1, (displayedScore - 60) / 40));
  const frostIntensity = Math.max(0, Math.min(1, (40 - displayedScore) / 40));
  const isFrozen = displayedScore < 40;
  const lavaEndAngle = scoreToGaugeDeg(displayedScore);

  const frostExtremeIntensity = Math.max(
    0,
    Math.min(1, (FROST_SOFT - displayedScore) / FROST_SOFT),
  );
  const heatExtremeIntensity = Math.max(
    0,
    Math.min(1, (displayedScore - HEAT_SOFT) / (HEAT_HARD - HEAT_SOFT)),
  );
  const isAboutToBreak = displayedScore <= 15;
  const isAboutToExplode = displayedScore >= 90;

  const needleColor = isFrozen ? ICE_GLOW : "var(--accent)";
  const hubGradId = isFrozen ? "hubGradFrozen" : "hubGrad";
  const coreGradId = isFrozen ? "frozenCore" : "moltenCore";

  // The neutral branch used --border-subtle, which is a HAIRLINE token:
  // rgba(247,238,224,.085) dark and rgba(26,25,22,.12) light. As 51px display
  // type that is 1.28:1 in BOTH themes, so the verdict word — the one thing
  // this page exists to say — was legible only by its own glow whenever the
  // score sat in the middle band, which is most days. --text-secondary is the
  // muted-but-readable token the rest of the site uses for exactly this.
  const accentColor = inStackZone
    ? "var(--accent)"
    : isFrozen
      ? ICE_GLOW
      : displayedScore <= 35
        ? COOL_BLUE
        : "var(--text-secondary)";
  const badgeBg = inStackZone
    ? "rgba(247, 147, 26, 0.12)"
    : isFrozen
      ? "rgba(126, 192, 255, 0.14)"
      : displayedScore <= 35
        ? "rgba(84, 120, 184, 0.12)"
        : "rgba(255, 255, 255, 0.04)";

  const isDragging = dragScore !== null;

  /* ---------------- Render ---------------- */
  return (
    <div className="relative mx-auto w-full max-w-[1000px]">
      {/* Top caption */}
      {/* The eyebrow here read "Bitcoin Buying Gauge · Live Verdict",
          which is the page's own h1 repeated verbatim about 300px below
          itself. Between the h1, the lede and this block the page made
          the same statement three times before showing the instrument.
          The paragraph stays — "no bag to pump, no thesis to sell" is
          the page's argument and appears nowhere else — but the
          duplicate label is gone. */}
      <div className="text-center mb-6">
        <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto leading-relaxed">
          Should you be stacking right now? The needle has no bag to pump,
          no thesis to sell, and no feelings · it just reads ten on-chain
          and market signals. Higher means a better entry. Watch where it
          points, then read the verdict below.
          <span className="block t-xs text-[var(--text-tertiary)] mt-2 italic">
            Try it: drag the needle, twist the signals, or hit play to start a sim.
          </span>
        </p>
      </div>

      {/* Two-column layout (gauge + influence panel) on lg+, stacked
          single column on mobile. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 lg:gap-8 items-start">
        {/* === LEFT: gauge + readout === */}
        <div className="relative mx-auto w-full max-w-[640px]">
          {/* Backdrop molten/frozen glow */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-12 h-[420px] -z-10 pointer-events-none blur-3xl"
            style={{
              background: inStackZone
                ? `radial-gradient(ellipse 60% 50% at 50% 60%, rgba(247,147,26,${0.14 + intensity * 0.2}), transparent 70%)`
                : isFrozen
                  ? `radial-gradient(ellipse 60% 50% at 50% 60%, rgba(126,192,255,${0.1 + frostIntensity * 0.16}), transparent 70%)`
                  : "radial-gradient(ellipse 60% 50% at 50% 60%, rgba(247,147,26,0.04), transparent 70%)",
              opacity: 0.85,
            }}
          />

          {/* The gauge container · pointer events for drag + cursor follow */}
          <div
            ref={containerRef}
            className={`relative aspect-[700/600] overflow-visible touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:rounded-full ${
              isDragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            tabIndex={0}
            onKeyDown={onKey}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              startDrag(e.clientX, e.clientY);
              trackPointer(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => trackPointer(e.clientX, e.clientY)}
            onPointerLeave={() => setPointerSvg(null)}
            role="slider"
            aria-label="Bitcoin Buying Gauge score. Drag, use arrow keys, or play with signals to preview any value"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(displayedScore)}
          >
            <svg
              viewBox={`0 0 ${VW} ${VH}`}
              className={`absolute inset-0 w-full h-full ${
                isAboutToExplode
                  ? "gauge-pressure-shake"
                  : isAboutToBreak
                    ? "gauge-frost-shake"
                    : ""
              }`}
              style={{ overflow: "visible", pointerEvents: "none" }}
            >
              <defs>
                {/* Unified ice→lava gradient (smooth fill on top of zones) */}
                <linearGradient
                  id="lavaGrad"
                  x1={CX - 200}
                  y1="0"
                  x2={CX + 200}
                  y2="0"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="var(--cool-ink)" stopOpacity="0.85" />
                  <stop offset="14%" stopColor="#5478b8" stopOpacity="0.95" />
                  <stop offset="38%" stopColor="rgba(180,180,200,0.4)" />
                  <stop offset="60%" stopColor="rgba(220,200,180,0.55)" />
                  <stop offset="78%" stopColor="#FFA64D" stopOpacity="0.95" />
                  <stop offset="92%" stopColor="#F7931A" stopOpacity="1" />
                  <stop offset="100%" stopColor="#FF5A08" stopOpacity="1" />
                </linearGradient>

                <radialGradient id="moltenCore" cx="50%" cy="100%" r="60%">
                  <stop offset="0%" stopColor="rgba(247,147,26,0.22)" />
                  <stop offset="35%" stopColor="rgba(247,147,26,0.06)" />
                  <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                  <animate
                    attributeName="r"
                    values="58%;66%;58%"
                    dur="4s"
                    repeatCount="indefinite"
                  />
                </radialGradient>

                <radialGradient id="frozenCore" cx="50%" cy="100%" r="60%">
                  <stop offset="0%" stopColor="rgba(126, 192, 255, 0.18)" />
                  <stop offset="35%" stopColor="rgba(126, 192, 255, 0.05)" />
                  <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                  <animate
                    attributeName="r"
                    values="58%;64%;58%"
                    dur="6s"
                    repeatCount="indefinite"
                  />
                </radialGradient>

                <filter id="lavaGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="6" />
                  <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                <filter id="needleGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" />
                  <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                <radialGradient id="hubGrad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#FFD89B" />
                  <stop offset="40%" stopColor="#F7931A" />
                  <stop offset="100%" stopColor="#7a4408" />
                </radialGradient>

                <radialGradient id="hubGradFrozen" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#dbeeff" />
                  <stop offset="40%" stopColor="#5478b8" />
                  <stop offset="100%" stopColor="#1d3258" />
                </radialGradient>

                {/* Needle metallic gradient · silver/orange chrome look */}
                <linearGradient
                  id="needleMetal"
                  x1="0"
                  y1={CY - R_NEEDLE_TIP}
                  x2="0"
                  y2={CY}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="#fff7e0" />
                  <stop offset="40%" stopColor="#f7931a" />
                  <stop offset="100%" stopColor="#7a4408" />
                </linearGradient>
              </defs>

              {/* === BEZEL (back of the stack · wraps everything) === */}
              <g
                className={
                  bezelWobble > 0 ? "gauge-bezel-wobble" : ""
                }
                key={bezelWobble}
              >
                <Bezel onRivetClick={triggerWobble} />
              </g>

              {/* Dial-face background · subtle radial that gives the
                  black void some structure. Like the matte luminous
                  paint on a real instrument, the face has micro-
                  texture even at rest. Two layers: a deep navy radial
                  + a faint concentric ring set at fixed radii. */}
              <defs>
                <radialGradient id="dialFaceBase" cx="50%" cy="50%" r="100%">
                  <stop offset="0%" stopColor="#0e1019" />
                  <stop offset="60%" stopColor="#08090d" />
                  <stop offset="100%" stopColor="#02030a" />
                </radialGradient>
              </defs>
              <ellipse
                cx={CX}
                cy={CY}
                rx={R_BEZEL_INNER - 6}
                ry={R_BEZEL_INNER - 6}
                fill="url(#dialFaceBase)"
              />
              {/* Faint concentric guide rings · barely visible but
                  give depth on close inspection (think real instrument
                  graduation rings). */}
              {[0.55, 0.72, 0.88].map((f, i) => (
                <circle
                  key={i}
                  cx={CX}
                  cy={CY}
                  r={(R_BEZEL_INNER - 6) * f}
                  fill="none"
                  stroke="rgba(255,255,255,0.025)"
                  strokeWidth="0.7"
                />
              ))}

              {/* Pulsing dial-face core glow (animated tier-color halo) */}
              <ellipse
                cx={CX}
                cy={CY}
                rx={R_DIAL - 4}
                ry={R_DIAL - 4}
                fill={`url(#${coreGradId})`}
              />

              {/* Discrete color zones (red / amber / green) */}
              <DialZones />

              {/* Cardinal scale labels removed from the SVG entirely.
                  A circular dial is too cramped to render them at a
                  legible size without colliding (verified twice). The
                  HODL→FULL SEND scale now lives as a large, theme-safe
                  HTML legend below the dial · see <TierScaleLegend>
                  in the readout block. The dial is visual-only:
                  needle + zones + glow. */}

              {/* Tick marks */}
              {Array.from({ length: 21 }).map((_, i) => {
                const deg = -180 + (i / 20) * 180;
                const isMajor = i % 5 === 0;
                const innerR = isMajor ? R_TICK_INNER : R_TICK_INNER + 4;
                const outerR = R_TICK_OUTER;
                const inner = polar(innerR, deg);
                const outer = polar(outerR, deg);
                return (
                  <line
                    key={i}
                    x1={inner.x}
                    y1={inner.y}
                    x2={outer.x}
                    y2={outer.y}
                    stroke="var(--text-tertiary)"
                    strokeWidth={isMajor ? 1.5 : 1}
                    opacity={isMajor ? 0.7 : 0.32}
                  />
                );
              })}

              {/* Numeric scale (0/25/50/75/100) intentionally removed:
                  it shared the exact 5 angles as the cardinal words,
                  so at a legible size the two collided. The precise
                  value is already the giant 7rem readout below + the
                  needle position · the words carry the scale here.
                  Do not re-add without solving the angle collision. */}

              {/* Main dial track (background) */}
              <path
                d={arcPath(R_DIAL, -180, 0)}
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
              />

              {/* Lava-fill arc · smooth gradient on top of zones */}
              <path
                d={arcPath(R_DIAL, -180, lavaEndAngle)}
                stroke="url(#lavaGrad)"
                strokeWidth="7"
                fill="none"
                strokeLinecap="round"
                filter="url(#lavaGlow)"
              />

              {/* STACK ZONE marker */}
              {(() => {
                const p1 = polar(R_DIAL - 14, scoreToGaugeDeg(BUY_SIGNAL_LO));
                const p2 = polar(R_DIAL + 14, scoreToGaugeDeg(BUY_SIGNAL_LO));
                return (
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="var(--accent)"
                    strokeWidth="1.5"
                    opacity={inStackZone ? 0.95 : 0.45}
                    strokeDasharray="3 2"
                  />
                );
              })()}

              {/* Inner depth arcs */}
              <path
                d={arcPath(R_DEPTH_2, -180, 0)}
                stroke="var(--border-subtle)"
                strokeWidth="1"
                fill="none"
                opacity="0.18"
              />
              <path
                d={arcPath(R_DEPTH_3, -180, 0)}
                stroke="var(--border-subtle)"
                strokeWidth="1"
                fill="none"
                opacity="0.1"
              />

              {/* BUY SIGNAL indicator + Nameplate */}
              <BuySignalLight active={inStackZone} />
              <Nameplate />

              {/* Dramatic-extreme overlays */}
              <FrostOverlay intensity={frostExtremeIntensity} />
              <HeatOverlay intensity={heatExtremeIntensity} />
              <GlassCracks kind="frost" intensity={frostExtremeIntensity} />
              <GlassCracks kind="heat" intensity={heatExtremeIntensity} />

              {/* Ghost needle (compare-to-30d-ago) · translucent
                  silhouette of where the gauge sat 30 days ago.
                  Only renders when the user has the toggle ON and we
                  have a meaningful historical reading. Drawn BEHIND
                  the live needle so the live one always wins visual
                  hierarchy. Tiny "30d ago" label hovers at the
                  ghost-needle tip. */}
              {compareEnabled && compareBaseline != null && (
                <g style={{ pointerEvents: "none", opacity: 0.45 }}>
                  <g
                    transform={`rotate(${scoreToNeedleDeg(compareBaseline.score)} ${CX} ${CY})`}
                  >
                    {/* Outline needle · dashed stroke to read as
                        "ghost / past state," distinct from the solid
                        live needle. */}
                    <polygon
                      points={`${CX - 5},${CY + 1} ${CX + 5},${CY + 1} ${CX + 1.5},${CY - R_NEEDLE_TIP + 12} ${CX - 1.5},${CY - R_NEEDLE_TIP + 12}`}
                      fill="none"
                      stroke="rgba(255,255,255,0.55)"
                      strokeWidth="1"
                      strokeDasharray="2.5 2"
                    />
                    {/* Tip dot */}
                    <circle
                      cx={CX}
                      cy={CY - R_NEEDLE_TIP + 4}
                      r={2.5}
                      fill="rgba(255,255,255,0.7)"
                      style={{
                        filter: "drop-shadow(0 0 3px rgba(255,255,255,0.6))",
                      }}
                    />
                    {/* Mini label · uses the ACTUAL age of the data
                        (e.g. "27d ago" when KV only has 27 days), not
                        a hardcoded "30d ago" that would lie when the
                        history window is shorter. */}
                    <text
                      x={CX}
                      y={CY - R_NEEDLE_TIP - 12}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="rgba(255,255,255,0.9)"
                      style={{
                        fontFamily: "var(--font-jetbrains-mono)",
                        fontSize: 13,
                        letterSpacing: "0.16em",
                        textTransform: "uppercase",
                      }}
                    >
                      {daysAgo(compareBaseline.date)}d ago · {Math.round(compareBaseline.score)}
                    </text>
                  </g>
                </g>
              )}

              {/* Needle (metallic, beefier than v1 to read at any
                  rendered width). Composition:
                    1. Soft outer glow (drop-shadow) for halo
                    2. Counter-balance tail (small triangle behind hub)
                    3. Tapered metallic body · base 9px → tip 2px
                    4. Center highlight stripe (specular cue)
                    5. Filled arrowhead in tier color
                    6. Glowing ₿ at the tip when score ≥ 50 */}
              <g ref={needleRef} transform={`rotate(${targetDeg} ${CX} ${CY})`}>
                {/* Outer glow · wider than the needle, blurred, for a
                    soft halo effect. This is what gives the needle
                    presence at small render sizes. */}
                <polygon
                  points={`${CX - 10},${CY + 4} ${CX + 10},${CY + 4} ${CX + 4},${CY - R_NEEDLE_TIP + 8} ${CX - 4},${CY - R_NEEDLE_TIP + 8}`}
                  fill={needleColor}
                  opacity={0.18}
                  style={{ filter: "blur(8px)" }}
                />
                {/* Counter-balance tail */}
                <polygon
                  points={`${CX - 5},${CY} ${CX + 5},${CY} ${CX + 2},${CY + 30} ${CX - 2},${CY + 30}`}
                  fill="rgba(40,42,48,0.95)"
                />
                {/* Main needle body · beefier taper (9px base → 2.5px
                    near tip, then arrowhead). */}
                <polygon
                  points={`${CX - 9},${CY + 2} ${CX + 9},${CY + 2} ${CX + 2.5},${CY - R_NEEDLE_TIP + 12} ${CX - 2.5},${CY - R_NEEDLE_TIP + 12}`}
                  fill="url(#needleMetal)"
                  filter="url(#needleGlow)"
                />
                {/* Center highlight stripe · thin bright line down the
                    middle of the needle reads as polished metal. */}
                <line
                  x1={CX}
                  y1={CY + 2}
                  x2={CX}
                  y2={CY - R_NEEDLE_TIP + 12}
                  stroke="rgba(255,247,224,0.5)"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
                {/* Arrowhead · wider + longer for visibility */}
                <polygon
                  points={`${CX - 7},${CY - R_NEEDLE_TIP + 12} ${CX + 7},${CY - R_NEEDLE_TIP + 12} ${CX},${CY - R_NEEDLE_TIP - 6}`}
                  fill={needleColor}
                  filter="url(#needleGlow)"
                />
                {/* Tiny ₿ at the very tip · opacity ramps in starting
                    at score 50 so the bullish needle is "marked." */}
                <text
                  x={CX}
                  y={CY - R_NEEDLE_TIP - 18}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={needleColor}
                  opacity={Math.max(0, Math.min(1, (displayedScore - 50) / 30))}
                  style={{
                    fontFamily: "var(--font-jetbrains-mono)",
                    fontSize: 20,
                    fontWeight: 800,
                    filter: `drop-shadow(0 0 6px ${needleColor})`,
                    transition: "opacity 0.4s, fill 0.4s",
                  }}
                >
                  ₿
                </text>
              </g>

              {/* Hub · multilayered metallic disc, double-clickable to reset */}
              <g
                onDoubleClick={onHubDoubleClick}
                style={{ cursor: "pointer", pointerEvents: "auto" }}
              >
                <circle
                  cx={CX}
                  cy={CY}
                  r={R_HUB}
                  fill={`url(#${hubGradId})`}
                  filter="url(#needleGlow)"
                />
                <circle cx={CX} cy={CY} r={R_HUB - 9} fill="#12110F" />
                <circle cx={CX} cy={CY} r={R_HUB - 14} fill={needleColor} />
                {/* Tiny inner highlight */}
                <circle
                  cx={CX - 1.5}
                  cy={CY - 1.5}
                  r={1}
                  fill="rgba(255,255,255,0.6)"
                />
              </g>

              {/* === GLASS DOME (front-most layer) === */}
              <GlassDome pointerSvg={pointerSvg} />
            </svg>

            {/* Particle overlays (DOM-based for the existing systems) */}
            <Embers intensity={intensity} />
            <Snowflakes intensity={frostIntensity} />
            <SteamWisps intensity={heatExtremeIntensity} />

            {/* Canvas overlay for shatter shards */}
            <ShardCanvas trigger={shatterTrigger} />

            {/* Drag-hint overlay (first-time only) */}
            {!hasDragged && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity duration-300">
                <span className="micro-label text-[var(--text-secondary)] bg-[var(--bg-base)]/80 backdrop-blur-sm rounded-full px-3 py-1.5 border border-[var(--border-subtle)]">
                  ✊ click & drag · or use arrow keys
                </span>
              </div>
            )}
          </div>

          {/* === Score readout (digital with scanline) === */}
          <div className="mt-2 text-center relative">
            <div className="font-mono tabular-nums leading-none gauge-readout-wrap">
              <motion.div
                key={glitchTick}
                initial={{ opacity: 0.4, x: -1 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  fontSize: "7rem",
                  color: isFrozen ? ICE_GLOW : "var(--accent)",
                  textShadow: isFrozen
                    ? "0 0 24px rgba(126,192,255,0.65), 0 0 48px rgba(126,192,255,0.35), 0 0 96px rgba(126,192,255,0.18)"
                    : "0 0 24px rgba(247,147,26,0.65), 0 0 48px rgba(247,147,26,0.35), 0 0 96px rgba(247,147,26,0.18)",
                  transition: "color 0.6s, text-shadow 0.6s",
                  display: "inline-block",
                  position: "relative",
                }}
                className="gauge-readout-digit"
              >
                {/* The number itself */}
                {isDragging || overrideScore != null ? (
                  <span>{Math.round(displayedScore)}</span>
                ) : (
                  <motion.span>{odometerText}</motion.span>
                )}
                <span className="text-[var(--text-tertiary)] text-2xl ml-1 align-baseline">
                  /100
                </span>
              </motion.div>
            </div>
            <div className="mt-3">
              <span
                className="inline-block uppercase font-extrabold text-4xl sm:text-5xl tracking-[0.1em] leading-none transition-all duration-300"
                style={{
                  border: `2px solid ${accentColor}`,
                  background: badgeBg,
                  borderRadius: 10,
                  padding: "12px 28px",
                  color: accentColor,
                  textShadow: `0 0 22px ${accentColor}, 0 0 44px ${accentColor}`,
                  boxShadow: inStackZone
                    ? "0 0 28px rgba(247,147,26,0.6), inset 0 0 18px rgba(247,147,26,0.15)"
                    : isFrozen
                      ? "0 0 28px rgba(126,192,255,0.55), inset 0 0 18px rgba(126,192,255,0.15)"
                      : `0 0 18px ${accentColor}`,
                }}
              >
                {TIER_LABEL[displayedTier]}
              </span>
            </div>

            {/* Tier scale legend · the readable HODL→FULL SEND scale,
                moved OUT of the cramped circular dial into theme-safe
                HTML (this is on the page background, which flips with
                the theme, so var(--text-tertiary) for the dim cells is
                correct here · the saturated hex actives read on both
                cream and near-black). Order = the dial's left→right
                sweep: worst entry → best. The cell matching the live
                tier lights up. */}
            <div className="mt-5 w-full max-w-md mx-auto">
              <div className="grid grid-cols-5 gap-1.5">
                {(
                  [
                    ["COLD", "#ff5a6a"],
                    ["CHILL", "#ff8c42"],
                    ["WARM", "#ffb547"],
                    ["HOT", "#5fd38a"],
                    ["MOLTEN", "#f7931a"],
                  ] as const
                ).map(([t, c]) => {
                  const isActive = displayedTier === t;
                  return (
                    <div
                      key={t}
                      className="flex flex-col items-center gap-1.5 rounded-lg px-1 py-2 transition-all duration-300"
                      style={{
                        border: `1px solid ${isActive ? c : "var(--border-subtle)"}`,
                        background: isActive ? `${c}1f` : "transparent",
                        boxShadow: isActive ? `0 0 16px ${c}66` : "none",
                      }}
                    >
                      <span
                        className="h-1 w-full rounded-full"
                        style={{
                          background: c,
                          opacity: isActive ? 1 : 0.4,
                        }}
                      />
                      <span
                        className="font-mono uppercase tracking-[0.04em] text-center leading-tight"
                        style={{
                          fontSize: isActive ? "0.8rem" : "0.66rem",
                          fontWeight: isActive ? 800 : 600,
                          // The five scale hexes are tuned for the dark gauge
                          // face, but this legend sits on the PAGE, so in
                          // light theme the active label ran 1.42:1 (#ffb547)
                          // to 1.51:1 (#5fd38a) on cream. The colour still
                          // identifies the tier — it is in the swatch bar
                          // above, the border, the background tint and the
                          // glow. Four channels is plenty; the word itself
                          // can afford to be readable.
                          color: isActive
                            ? "var(--text-primary)"
                            : "var(--text-tertiary)",
                          textShadow: isActive ? `0 0 10px ${c}80` : "none",
                        }}
                      >
                        {TIER_LABEL[t]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Status line · context-aware. */}
            {isAboutToExplode ? (
              <div className="micro-label mt-3 text-[var(--accent)] animate-pulse">
                ⚠ pressure critical · full send ·{" "}
                <span className="opacity-70">historically rare</span>
              </div>
            ) : isAboutToBreak ? (
              <div
                className="micro-label mt-3"
                style={{
                  color: ICE_GLOW,
                  textShadow: "0 0 8px rgba(126,192,255,0.5)",
                }}
              >
                ❄ frozen solid · hodl ·{" "}
                <span className="opacity-70">historically rare</span>
              </div>
            ) : isDragging ? (
              <div className="micro-label mt-3 text-[var(--accent)] animate-pulse">
                ← previewing · release to snap back to live
              </div>
            ) : overrideSource === "synthetic" ? (
              <div className="micro-label mt-3 text-[var(--accent)]">
                ⚙ what-if mode · reset to return to live
              </div>
            ) : overrideSource === "sim" ? (
              <div className="micro-label mt-3 text-[var(--accent)] animate-pulse">
                ▶ sim mode · {Math.max(0, Math.round((SIM_DURATION_MS - simElapsedMs) / 1000))}s remaining
              </div>
            ) : (
              blockHeight != null && (
                <div className="micro-label mt-3 text-[var(--text-tertiary)]">
                  block #{blockHeight.toLocaleString()} · live
                </div>
              )
            )}

            {/* Sim mode round-end summary · celebrates a NEW personal
                best inline so the user sees their progress at a glance. */}
            {!simRunning && simElapsedMs >= SIM_DURATION_MS && (
              <div className="micro-label mt-3 inline-flex items-baseline gap-2 border border-[var(--accent)]/40 bg-[var(--accent)]/10 rounded-md px-3 py-1.5">
                <span className="text-[var(--text-tertiary)]">Sim:</span>
                <span className="text-[var(--accent)] font-semibold">
                  {(simTimeInZone / 1000).toFixed(1)}s
                </span>
                <span className="text-[var(--text-secondary)]">in zone of 60s</span>
                {simBestMs != null && simTimeInZone >= simBestMs && simTimeInZone > 0 && (
                  <span className="text-[var(--accent)] font-bold ml-1">★ NEW BEST</span>
                )}
              </div>
            )}

            {/* Persistent personal best chip · shown whenever the user
                has a recorded best (and a fresh round isn't already
                showing the summary above). */}
            {simBestMs != null && simBestMs > 0 && !(!simRunning && simElapsedMs >= SIM_DURATION_MS) && !simRunning && (
              <div className="micro-label mt-3 text-[var(--text-tertiary)]">
                ★ best: <span className="text-[var(--accent)]">{(simBestMs / 1000).toFixed(1)}s</span>{" "}in zone
              </div>
            )}

            {/* Sim + sound + compare toggles. Wraps on mobile so all
                three pills stay reachable on narrow viewports. */}
            <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  if (simRunning) {
                    setSimRunning(false);
                    setSimScore(null);
                  } else {
                    setSyntheticScore(null);
                    setSimRunning(true);
                  }
                }}
                className={`t-xs uppercase tracking-[0.25em] font-mono px-3 py-1.5 rounded-full border transition-colors ${
                  simRunning
                    ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
                }`}
              >
                {simRunning ? "■ Stop sim" : "▶ Simulation mode"}
              </button>
              <button
                type="button"
                onClick={() => setSoundEnabled((s) => !s)}
                className={`t-xs uppercase tracking-[0.25em] font-mono px-3 py-1.5 rounded-full border transition-colors ${
                  soundEnabled
                    ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
                }`}
                aria-pressed={soundEnabled}
                title="Toggle gauge sound effects"
              >
                {soundEnabled ? "♪ Sound on" : "♪ Sound off"}
              </button>
              {/* Compare toggle · only visible when we have a
                  meaningful 30-day baseline to compare against. KV
                  outage / day-1 deploy → no button at all (silent
                  graceful degradation, no broken-control feel). */}
              {compareBaseline != null && (
                <button
                  type="button"
                  onClick={() => setCompareEnabled((c) => !c)}
                  className={`t-xs uppercase tracking-[0.25em] font-mono px-3 py-1.5 rounded-full border transition-colors ${
                    compareEnabled
                      ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                      : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
                  }`}
                  aria-pressed={compareEnabled}
                  title={`Show ghost needle at the score from ${daysAgo(compareBaseline.date)} days ago`}
                >
                  {compareEnabled
                    ? `◐ vs ${daysAgo(compareBaseline.date)}d (${Math.round(compareBaseline.score)})`
                    : `◐ vs ${daysAgo(compareBaseline.date)}d ago`}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* === RIGHT: metric influence panel (collapsible on mobile · B5a) === */}
        <div className="w-full lg:max-w-[280px] mx-auto">
          {/* Mobile disclosure · the panel is a play-tool, not the answer,
              so it stays folded until asked for (mirrors /fit's collapsed-
              by-default Asset Universe). lg keeps it open beside the gauge. */}
          <button
            type="button"
            onClick={() => setShowSignals((v) => !v)}
            aria-expanded={showSignals}
            className="micro-label lg:hidden w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--text-tertiary)] transition-colors"
          >
            <span aria-hidden>{showSignals ? "−" : "+"}</span>
            {showSignals ? "Hide the 10 signals" : "Twist the 10 signals"}
            <span aria-hidden className="text-[var(--text-tertiary)]">→</span>
          </button>
          <div className={`${showSignals ? "block" : "hidden"} lg:block mt-3 lg:mt-0`}>
            <MetricInfluencePanel
              signals={signals ?? []}
              isOverridden={syntheticScore !== null}
              disabled={simRunning}
              onSyntheticScore={setSyntheticScore}
            />
          </div>
        </div>
      </div>

      {/* Keyframes · bezel wobble, shake animations, scanline overlay.
          Shake is applied to the SVG only, NOT the interactive
          container, so getBoundingClientRect() in the drag handler
          reads a stable hit area while the gauge "vibrates" under
          stress.

          Cold shake is slow and gentle (the gauge struggling against
          the freeze). Hot shake is faster and more violent (pressure
          building toward release). Both translate ±1-2px on a
          deliberately slightly-irregular keyframe schedule. */}
      <style>{`
        @keyframes gauge-frost-shake {
          0%, 100% { transform: translate(0, 0); }
          12%      { transform: translate(-1px, 0.5px); }
          24%      { transform: translate(0.8px, -0.6px); }
          37%      { transform: translate(-0.6px, -1px); }
          55%      { transform: translate(1px, 0.7px); }
          70%      { transform: translate(-0.5px, 1px); }
          85%      { transform: translate(0.6px, -0.5px); }
        }
        .gauge-frost-shake { animation: gauge-frost-shake 5.2s ease-in-out infinite; }
        @keyframes gauge-pressure-shake {
          0%, 100% { transform: translate(0, 0); }
          8%       { transform: translate(-2px, 1px); }
          16%      { transform: translate(2px, -1px); }
          25%      { transform: translate(-1.5px, -2px); }
          34%      { transform: translate(2px, 1.5px); }
          44%      { transform: translate(-2px, 0.5px); }
          55%      { transform: translate(1.5px, 2px); }
          66%      { transform: translate(-1.5px, -1px); }
          78%      { transform: translate(2px, -1.5px); }
          90%      { transform: translate(-1px, 1.5px); }
        }
        .gauge-pressure-shake { animation: gauge-pressure-shake 1.4s linear infinite; }

        /* Bezel wobble — fired by clicking a rivet */
        @keyframes gauge-bezel-wobble {
          0%, 100% { transform: rotate(0deg); transform-origin: ${CX}px ${CY}px; }
          15%      { transform: rotate(-1.4deg); }
          30%      { transform: rotate(1.0deg); }
          45%      { transform: rotate(-0.7deg); }
          60%      { transform: rotate(0.5deg); }
          80%      { transform: rotate(-0.2deg); }
        }
        .gauge-bezel-wobble { animation: gauge-bezel-wobble 0.55s ease-out; }

        /* Scanline overlay on the digital readout — soft horizontal
           band that scrolls across the number area. */
        .gauge-readout-wrap {
          position: relative;
          display: inline-block;
        }
        .gauge-readout-wrap::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(
            to bottom,
            transparent 0%,
            transparent 48%,
            rgba(255, 255, 255, 0.06) 50%,
            transparent 52%,
            transparent 100%
          );
          background-size: 100% 4px;
          opacity: 0.35;
          mix-blend-mode: overlay;
        }
      `}</style>
    </div>
  );
}
