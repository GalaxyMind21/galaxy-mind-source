// Themed loading skeleton shown via <Suspense fallback> while
// StackContent's data fetch is pending (1-12 seconds depending on
// upstream API health).
//
// DESIGN INTENT (v3): match the cinematic PressureGauge aesthetic so
// the skeleton → live swap feels seamless. The skeleton renders a
// SKELETAL VERSION of the same instrument — same bezel, same dial,
// same color zones, same nameplate — with a sweep needle (radar-style)
// in place of the live needle and "CALIBRATING" copy in place of the
// score. Users see "the instrument is here, it's just waking up,"
// not "a different placeholder."
//
// ALL ANIMATIONS ARE PURE CSS @keyframes. Why: CSS animations start
// the moment the HTML is rendered, with NO JavaScript needed. Framer-
// motion animations only start AFTER React hydrates, which on slow
// connections / cold caches can be 1-2 seconds of stillness while
// users are already waiting. Pure CSS = bars animate immediately,
// perceived instantaneous responsiveness.
//
// No "use client" needed because there's no useState/useEffect. The
// component is a static server component that ships its CSS animations
// inline. React unmounts it the moment StackContent streams in.

import { SAYLOR_QUOTES } from "@/lib/saylor-quotes";

// Per-source rows. Only `name` + `fillMs` are used at render time —
// each source's bar fills over its own duration so the column has
// visible movement (sources finishing at staggered times rather than
// all-at-once). Durations roughly mirror real upstream-fetch latencies.
const SOURCES: { name: string; fillMs: number }[] = [
  { name: "MVRV",                fillMs: 1100 },
  { name: "Mayer Multiple",      fillMs: 1300 },
  { name: "Puell Multiple",      fillMs: 1500 },
  { name: "Funding Rate",        fillMs: 1200 },
  { name: "Fear & Greed",        fillMs: 900  },
  { name: "Price vs 30d MA",     fillMs: 1700 },
  { name: "30d Realized Vol",    fillMs: 1800 },
  { name: "Hour-of-Day pattern", fillMs: 1900 },
  { name: "Day-of-Week pattern", fillMs: 1900 },
  { name: "MSTR mNAV",           fillMs: 2000 },
  { name: "Block height",        fillMs: 800  },
];

const MASTER_DURATION_MS = 2200;

// SAYLOR_QUOTES is now the single shared source in
// @/lib/saylor-quotes (imported above · pure data, server-safe) so
// the loading screen, the 21-click brand-mark egg, and the
// <SaylorQuoteStrip> on /float /treasuries /fit all speak with one
// voice. Pure-CSS rotation below derives its timing from the count.
// Seconds each quote holds before the next cross-fades in. Total
// loop = SAYLOR_QUOTES.length × this · long enough that a typical
// 1-12s load shows a few, never feels like a stuck single frame.
const QUOTE_HOLD_MS = 3500;

// Geometry — mirrors PressureGauge.tsx exactly so the visual shape is
// identical. Kept as constants here (rather than imported) so the
// skeleton stays "use-server" friendly and self-contained.
const VW = 700;
const VH = 600;
const CX = 350;
const CY = 320;
const R_BEZEL_OUTER = 280;
const R_BEZEL_INNER = 234;
const R_RIVET = 268;
const RIVET_COUNT = 12;
const R_DIAL = 215;
const R_TICK_OUTER = 226;
const R_TICK_INNER = 210;
// (R_CARDINAL removed · mirrors the live gauge · scale labels are now
// an HTML legend below the dial, not SVG text on the cramped face.)
const R_NEEDLE_TIP = 188;
const R_HUB = 19;

const RED_ZONE = "#ff3a4f";
const AMBER_ZONE = "#ffb547";
const GREEN_ZONE = "#34e394";

// Polar helper, matched to PressureGauge.tsx. Rounded to 4 decimals
// so SSR-streamed numeric attributes never disagree with the eventual
// hydrated DOM (avoids React #418 if the live gauge renders into the
// same DOM region during transition).
function polar(r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return {
    x: Math.round((CX + Math.cos(rad) * r) * 10000) / 10000,
    y: Math.round((CY + Math.sin(rad) * r) * 10000) / 10000,
  };
}
function arcPath(r: number, startDeg: number, endDeg: number) {
  const a = polar(r, startDeg);
  const b = polar(r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const sweepFlag = sweep > 0 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r.toFixed(4)} ${r.toFixed(4)} 0 ${largeArc} ${sweepFlag} ${b.x} ${b.y}`;
}
function scoreToGaugeDeg(s: number) { return -180 + (s / 100) * 180; }

export function StackSkeleton() {
  return (
    <>
      <style>{SKELETON_CSS}</style>

      {/* Reserve space for the two blocks StackContent streams in ABOVE
          the gauge — BtcSpotPriceHero (lg) and the sm:hidden verdict
          chip — so the gauge doesn't jump down at first meaningful paint
          (CLS fix · UX audit 2026-07-13). Box model mirrors the live
          components (same my-3 sm:my-8 + mt-4) so the Y is stable across
          the skeleton→live swap. aria-hidden · the aria-busy panel below
          already announces the load. */}
      <div
        className="flex flex-col items-center text-center my-3 sm:my-8"
        aria-hidden
      >
        <div className="h-3 w-40 rounded bg-[var(--border-subtle)] mb-2 sk-dim-pulse" />
        <div className="h-9 sm:h-14 w-52 sm:w-80 rounded bg-[var(--border-subtle)] sk-dim-pulse" />
      </div>
      <div className="sm:hidden mt-4 flex justify-center" aria-hidden>
        <div className="h-11 w-48 rounded-full border border-[var(--accent)]/40 bg-[var(--bg-elevated)] sk-dim-pulse" />
      </div>
      {/* Reserve the sm:hidden verdict.summary line B5a lifted above the
          gauge (StackContent · mt-3 px-4 text-sm, ~2 lines) — without this
          the gauge still shifts down ~2 text-lines on mobile when the
          skeleton swaps to live (UX audit 2026-07-13 · N4 completeness). */}
      <div
        className="sm:hidden mt-3 px-4 flex flex-col items-center gap-1.5"
        aria-hidden
      >
        <div className="h-3.5 w-full max-w-xs rounded bg-[var(--border-subtle)] sk-dim-pulse" />
        <div className="h-3.5 w-3/4 max-w-[16rem] rounded bg-[var(--border-subtle)] sk-dim-pulse" />
      </div>

      {/* ====================================================== */}
      {/* Hero: live signal cockpit panel                        */}
      {/* ====================================================== */}
      {/* mt-8 matches the live gauge section (StackContent · id="gauge")
          so the instrument occupies the same Y before and after the
          swap · was mt-12. */}
      <section className="mt-8">
        <div
          className="relative rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden"
          aria-busy="true"
          aria-label="Bitcoin Buying Gauge · loading live signals"
        >
          {/* Subtle scanline gradient drifts across the panel for that
              retro-CRT/terminal feel. Pure CSS, GPU-cheap. */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-30"
            style={{
              background:
                "repeating-linear-gradient(180deg, transparent 0, transparent 2px, rgba(247,147,26,0.03) 2px, rgba(247,147,26,0.03) 3px)",
            }}
          />

          {/* MASTER PROGRESS BAR */}
          <div className="relative px-5 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-3 mb-3">
              <span className="sk-pulse-dot block w-2 h-2 rounded-full bg-[var(--accent)]" />
              <span className="font-mono text-[12px] sm:text-[12px] uppercase tracking-[0.3em] text-[var(--accent-ink)]">
                Acquiring live signals
              </span>
              <span
                className="ml-auto font-mono text-sm sm:text-base tabular-nums text-[var(--accent-ink)] glow-text sk-percent"
                aria-live="polite"
              />
            </div>
            <div className="relative h-1.5 rounded-full bg-[var(--border-subtle)] overflow-hidden">
              <div
                className="sk-master-bar absolute inset-y-0 left-0 rounded-full"
                style={{
                  background: "linear-gradient(90deg, var(--accent), #ffb454)",
                  boxShadow: "0 0 8px var(--accent)",
                }}
              />
              <div
                aria-hidden
                className="sk-master-shimmer absolute inset-y-0 w-1/3 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
                }}
              />
            </div>
          </div>

          {/* 2-column body matching the live layout */}
          <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 lg:gap-8 px-5 sm:px-6 py-6">
            {/* LEFT: skeleton gauge that LOOKS like the real gauge */}
            <div className="relative mx-auto w-full max-w-[640px]">
              <SkeletonGauge />

              {/* Readout zone · mirrors the live score+verdict position
                  (same badge size/shape as PressureGauge's verdict) so
                  skeleton → live doesn't reflow, AND turns the wait into
                  a dramatic Michael Saylor moment (operator request).
                  Pure CSS, server component · no JS, no hydration risk. */}
              <div className="mt-2 text-center">
                <span
                  className="inline-block uppercase font-extrabold text-3xl sm:text-4xl tracking-[0.12em] leading-none sk-pulse-text"
                  style={{
                    border: "2px solid rgba(247,147,26,0.45)",
                    background: "rgba(247,147,26,0.06)",
                    borderRadius: 10,
                    padding: "12px 26px",
                    color: "rgba(247,147,26,0.7)",
                    textShadow: "0 0 18px rgba(247,147,26,0.4)",
                  }}
                  aria-label="Bitcoin Buying Gauge calibrating"
                >
                  Calibrating
                </span>

                {/* Tier-scale-legend placeholder · mirrors the live
                    <TierScaleLegend> position/size so load → live
                    does not reflow. Dim cells · no active tier yet. */}
                <div className="mt-5 w-full max-w-md mx-auto">
                  <div className="grid grid-cols-5 gap-1.5">
                    {["HODL", "DCA", "STACK SATS", "SEND IT", "FULL SEND"].map(
                      (t) => (
                        <div
                          key={t}
                          className="flex flex-col items-center gap-1.5 rounded-lg px-1 py-2 border border-[var(--border-subtle)]"
                        >
                          <span className="h-1 w-full rounded-full bg-[var(--border-subtle)]" />
                          <span
                            className="font-mono uppercase tracking-[0.04em] text-center leading-tight text-[var(--text-tertiary)] sk-pulse-text"
                            style={{ fontSize: "0.66rem", fontWeight: 600 }}
                          >
                            {t}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </div>

                {/* Rotating real Saylor quotes · pure-CSS cross-fade,
                    one at a time, loops while data loads. Each is
                    absolutely stacked; its keyframe window is offset by
                    animationDelay so exactly one shows. reduced-motion
                    freezes to the first (no cycling). */}
                <div
                  className="relative mx-auto mt-7 h-20 max-w-md px-3"
                  aria-hidden
                >
                  {SAYLOR_QUOTES.map((q, i) => (
                    <blockquote
                      key={i}
                      className="sk-quote absolute inset-0 flex flex-col items-center justify-center gap-1.5"
                      style={
                        {
                          animationDelay: `${i * QUOTE_HOLD_MS}ms`,
                        } as React.CSSProperties
                      }
                    >
                      <span className="text-[var(--text-secondary)] text-base sm:text-lg italic leading-snug">
                        {q}
                      </span>
                      <span className="micro-label text-[var(--accent-ink)]">
                        · Michael Saylor
                      </span>
                    </blockquote>
                  ))}
                </div>
              </div>
            </div>
            {/* RIGHT: instrument-panel placeholder */}
            <div className="relative w-full lg:max-w-[280px] mx-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)]/40 p-4">
              <div className="micro-label text-[var(--text-tertiary)] mb-1">
                Instruments
              </div>
              <div className="font-mono text-xs text-[var(--text-tertiary)] mb-3">
                Twist to experiment
              </div>
              <div className="space-y-2">
                {SOURCES.slice(0, 10).map((src) => (
                  <div key={src.name} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="micro-label text-[var(--text-tertiary)] sk-pulse-text">
                        {src.name.split(" ")[0].toLowerCase()}
                      </span>
                      <span className="font-mono t-xs text-[var(--text-tertiary)]">·</span>
                    </div>
                    <div className="relative h-1 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                      <div
                        className="sk-source-bar absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
                        style={
                          {
                            animationDuration: `${src.fillMs}ms`,
                            opacity: 0.5,
                            boxShadow: "0 0 4px var(--accent)",
                          } as React.CSSProperties
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Source acquisition checklist */}
          <div className="relative px-5 sm:px-6 pb-5 sm:pb-6 border-t border-[var(--border-subtle)] pt-5">
            <div className="micro-label text-[var(--text-tertiary)] mb-3">
              Source acquisition
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 font-mono t-xs">
              {SOURCES.map((src) => (
                <SourceRow
                  key={src.name}
                  name={src.name}
                  fillMs={src.fillMs}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Below-the-fold dim placeholders so the page doesn't reflow
          when StackContent streams in. */}
      {[160, 200, 240, 240, 200, 180, 200].map((h, i) => (
        <section key={i} className="mt-12">
          <div
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] sk-dim-pulse"
            style={{ height: `${h}px`, opacity: 0.3 - i * 0.03 }}
            aria-hidden
          />
        </section>
      ))}
    </>
  );
}

// =====================================================================
// SkeletonGauge — a near-replica of the live PressureGauge with
// muted/skeletal styling. Renders the SAME bezel, rivets, dial face,
// color zones, BUY SIGNAL light, nameplate (in "calibrating" state),
// numeric scale, and ticks — but the live needle is replaced by a
// sweep-radar that animates left-right via pure CSS, communicating
// "scanning for data" rather than a stale random reading.
//
// Why duplicate the geometry instead of importing PressureGauge:
//   1. PressureGauge is "use client" — it pulls in framer-motion on
//      hydration. The skeleton must be a server component (renders
//      INSTANTLY before any JS loads).
//   2. Math.random() in PressureGauge's particle systems would cause
//      hydration mismatches if we tried to render a "frozen" version.
//   3. Geometry constants are intentionally synced with the live
//      version; if those drift, both files need updating — kept
//      deliberately co-located for that reason.
// =====================================================================
function SkeletonGauge() {
  // Pre-compute the 12 rivet positions so we don't repeat polar() in
  // the JSX.
  const rivets = Array.from({ length: RIVET_COUNT }).map((_, i) => {
    const deg = (i / RIVET_COUNT) * 360 - 90;
    return polar(R_RIVET, deg);
  });

  return (
    <div className="relative aspect-[700/600] mx-auto">
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="absolute inset-0 w-full h-full"
        style={{ overflow: "visible" }}
        aria-hidden
      >
        <defs>
          {/* Bezel metal · warm champagne/bronze to match the live gauge
              (instrument overhaul 2026-06-20), held slightly more muted so
              the skeleton still reads as "powered down / waking up." */}
          <radialGradient
            id="sk-bezel-metal"
            cx="50%"
            cy="0%"
            r="100%"
          >
            <stop offset="0%" stopColor="#c8c2b6" />
            <stop offset="20%" stopColor="#867e72" />
            <stop offset="50%" stopColor="#4a443d" />
            <stop offset="78%" stopColor="#221f1a" />
            <stop offset="100%" stopColor="#131110" />
          </radialGradient>

          <filter id="sk-brushed" x="-5%" y="-5%" width="110%" height="110%">
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

          <radialGradient id="sk-bezel-bevel" cx="50%" cy="100%" r="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.04)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.6)" />
          </radialGradient>

          <radialGradient id="sk-rivet" cx="35%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#dcd6ca" />
            <stop offset="40%" stopColor="#7f7669" />
            <stop offset="100%" stopColor="#1b1813" />
          </radialGradient>

          <radialGradient id="sk-dial-base" cx="50%" cy="50%" r="100%">
            <stop offset="0%" stopColor="#0e1019" />
            <stop offset="60%" stopColor="#08090d" />
            <stop offset="100%" stopColor="#02030a" />
          </radialGradient>

          {/* Pulsing core · slow soft pulse to feel "alive but waiting" */}
          <radialGradient id="sk-pulse-core" cx="50%" cy="100%" r="60%">
            <stop offset="0%" stopColor="rgba(247,147,26,0.10)">
              <animate
                attributeName="stop-opacity"
                values="0.06;0.14;0.06"
                dur="3.2s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="60%" stopColor="rgba(247,147,26,0.02)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>

          {/* Sweep gradient · bright at the tip, fades to invisible at
              the hub. This is what reads as "active scanning." */}
          <linearGradient
            id="sk-sweep-grad"
            x1="0"
            y1={CY - R_NEEDLE_TIP}
            x2="0"
            y2={CY}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="rgba(247,147,26,0.95)" />
            <stop offset="50%" stopColor="rgba(247,147,26,0.45)" />
            <stop offset="100%" stopColor="rgba(247,147,26,0)" />
          </linearGradient>

          {/* Trailing arc that the sweep leaves behind · fades to
              transparent. Gives a radar afterglow. */}
          <linearGradient id="sk-trail" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(247,147,26,0)" />
            <stop offset="60%" stopColor="rgba(247,147,26,0.35)" />
            <stop offset="100%" stopColor="rgba(247,147,26,0)" />
          </linearGradient>

          {/* Static glass dome highlight (top arc specular) */}
          <radialGradient id="sk-dome-hi" cx="50%" cy="0%" r="65%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
            <stop offset="40%" stopColor="rgba(255,255,255,0.05)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>

        {/* === BEZEL === */}
        <circle cx={CX} cy={CY} r={R_BEZEL_OUTER} fill="url(#sk-bezel-metal)" />
        <circle cx={CX} cy={CY} r={R_BEZEL_OUTER} fill="white" filter="url(#sk-brushed)" />
        <circle cx={CX} cy={CY} r={R_BEZEL_INNER} fill="var(--bg-base)" />
        <circle
          cx={CX}
          cy={CY}
          r={R_BEZEL_INNER + 4}
          fill="none"
          stroke="url(#sk-bezel-bevel)"
          strokeWidth="8"
        />
        <circle
          cx={CX}
          cy={CY}
          r={R_BEZEL_OUTER - 1}
          fill="none"
          stroke="rgba(255,255,255,0.20)"
          strokeWidth="1.5"
        />

        {/* Rivets */}
        {rivets.map((r, i) => (
          <g key={i}>
            <circle cx={r.x} cy={r.y} r={6} fill="rgba(0,0,0,0.6)" opacity="0.85" />
            <circle cx={r.x} cy={r.y} r={5} fill="url(#sk-rivet)" />
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
            <circle cx={r.x - 1.4} cy={r.y - 1.4} r={1} fill="rgba(255,255,255,0.55)" />
          </g>
        ))}

        {/* Engraved manufacturer plate */}
        <defs>
          <path id="sk-engrave-arc" d={arcPath(R_BEZEL_OUTER - 25, 30, 150)} />
        </defs>
        <text
          fill="rgba(185,190,200,0.6)"
          style={{
            fontFamily: "var(--font-jetbrains-mono)",
            fontSize: 15,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          <textPath href="#sk-engrave-arc" startOffset="50%" textAnchor="middle">
            GALAXY MIND · MOD-21M · CALIBRATING
          </textPath>
        </text>

        {/* === DIAL FACE === */}
        <ellipse
          cx={CX}
          cy={CY}
          rx={R_BEZEL_INNER - 6}
          ry={R_BEZEL_INNER - 6}
          fill="url(#sk-dial-base)"
        />
        {/* Concentric guide rings */}
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
        {/* Pulsing core */}
        <ellipse
          cx={CX}
          cy={CY}
          rx={R_DIAL - 4}
          ry={R_DIAL - 4}
          fill="url(#sk-pulse-core)"
        />

        {/* Color zones · muted version (lower opacity, no halo) */}
        {[
          { from: 0, to: 35, color: RED_ZONE },
          { from: 35, to: 65, color: AMBER_ZONE },
          { from: 65, to: 100, color: GREEN_ZONE },
        ].map((z) => (
          <path
            key={z.from}
            d={arcPath(R_DIAL - 18, scoreToGaugeDeg(z.from), scoreToGaugeDeg(z.to))}
            stroke={z.color}
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            opacity="0.32"
          />
        ))}

        {/* Cardinal scale labels removed · mirrors the live gauge.
            The dial is visual-only; the HODL→FULL SEND scale renders
            as a large theme-safe HTML legend below (the skeleton's
            placeholder for it is in the readout zone above). */}

        {/* Tick marks */}
        {Array.from({ length: 21 }).map((_, i) => {
          const deg = -180 + (i / 20) * 180;
          const isMajor = i % 5 === 0;
          const innerR = isMajor ? R_TICK_INNER : R_TICK_INNER + 4;
          const inner = polar(innerR, deg);
          const outer = polar(R_TICK_OUTER, deg);
          return (
            <line
              key={i}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="rgba(120,125,135,0.5)"
              strokeWidth={isMajor ? 1.5 : 1}
              opacity={isMajor ? 0.7 : 0.32}
            />
          );
        })}

        {/* Numeric scale removed · mirrors the live gauge (it shared
            the cardinal angles and collided at a legible size). */}

        {/* Background dial track */}
        <path
          d={arcPath(R_DIAL, -180, 0)}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />

        {/* BUY SIGNAL placeholder (dim · no signal yet) */}
        <text
          x={CX + 95}
          y={CY - R_DIAL + 10}
          textAnchor="middle"
          fill="rgba(150,155,165,0.5)"
          style={{
            fontFamily: "var(--font-jetbrains-mono)",
            fontSize: 18,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          Buy Signal
        </text>
        <circle
          cx={CX + 95}
          cy={CY - R_DIAL + 28}
          r={6}
          fill="rgba(40,45,55,0.95)"
          stroke="rgba(80,85,95,0.6)"
          strokeWidth="1"
          className="sk-pulse-dot-soft"
        />

        {/* Small static maker's-mark plate · mirrors the live gauge's
            Nameplate (verdict/scale moved to HTML below). The loading
            "Calibrating" state is the HTML badge in the readout zone. */}
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
          fill="rgba(200,205,215,0.7)"
          style={{
            fontFamily: "var(--font-jetbrains-mono)",
            fontSize: 11,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
          }}
        >
          BTC BUY PRESSURE
        </text>

        {/* === SWEEP NEEDLE === */}
        {/*
         * Radar-sweep needle in place of the live needle. Communicates
         * "scanning for data" rather than a stuck reading.
         *
         * IMPORTANT: uses SVG SMIL <animateTransform> instead of CSS
         * @keyframes. CSS transforms on inner SVG <g> elements are
         * notoriously buggy across browsers due to transform-box
         * inheritance — origin defaults to the element's bounding-box
         * CENTER, not the SVG user-space coords I want. SMIL's
         * `from`/`to` strings include the rotation pivot point
         * directly ("angle cx cy"), so the rotation is unambiguously
         * around the hub. Same syntax all browsers since 2010.
         *
         * Animation profile: -90° → 90° → -90° in 3.6s with ease-in-
         * out feel via keyTimes/keySplines. The keySplines values are
         * a cubic-bezier (0.42, 0, 0.58, 1), the SVG-spec equivalent
         * of CSS `ease-in-out`.
         */}
        <g>
          {/* Sweep needle · fading gradient stroke, tip dot bright */}
          <line
            x1={CX}
            y1={CY}
            x2={CX}
            y2={CY - R_NEEDLE_TIP}
            stroke="url(#sk-sweep-grad)"
            strokeWidth="3"
            strokeLinecap="round"
            style={{ filter: "drop-shadow(0 0 6px var(--accent))" }}
          />
          <circle
            cx={CX}
            cy={CY - R_NEEDLE_TIP + 2}
            r={4}
            fill="var(--accent)"
            style={{ filter: "drop-shadow(0 0 6px var(--accent))" }}
          />
          {/* SMIL transform animation · rotates the entire <g> around
              the hub. The transform value strings are
              "angle pivotX pivotY". additive="sum" lets this stack
              cleanly with any later transforms. */}
          <animateTransform
            attributeName="transform"
            attributeType="XML"
            type="rotate"
            values={`-90 ${CX} ${CY}; 90 ${CX} ${CY}; -90 ${CX} ${CY}`}
            keyTimes="0; 0.5; 1"
            keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
            calcMode="spline"
            dur="3.6s"
            repeatCount="indefinite"
          />
        </g>

        {/* Hub */}
        <circle
          cx={CX}
          cy={CY}
          r={R_HUB}
          fill="rgba(40,42,48,0.95)"
          stroke="rgba(247,147,26,0.4)"
          strokeWidth="1"
        />
        <circle cx={CX} cy={CY} r={R_HUB - 9} fill="#12110F" />
        <circle
          cx={CX}
          cy={CY}
          r={R_HUB - 14}
          fill="var(--accent)"
          opacity="0.6"
          className="sk-hub-pulse"
        />

        {/* === GLASS DOME === */}
        <circle
          cx={CX}
          cy={CY}
          r={R_BEZEL_INNER - 2}
          fill="url(#sk-dome-hi)"
        />
      </svg>
    </div>
  );
}

// =====================================================================
// Per-source row with its own animated progress bar.
// =====================================================================
function SourceRow({ name, fillMs }: { name: string; fillMs: number }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-[var(--text-secondary)] flex-shrink-0 min-w-[100px] sm:min-w-[120px]">
        {name}
      </span>
      <div className="flex-1 relative h-1 rounded-full bg-[var(--border-subtle)] overflow-hidden">
        <div
          className="sk-source-bar absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
          style={
            {
              animationDuration: `${fillMs}ms`,
              boxShadow: "0 0 4px var(--accent)",
            } as React.CSSProperties
          }
        />
      </div>
      <span
        className="micro-label sk-source-check flex-shrink-0 text-[var(--accent-ink)] w-[60px] text-right"
        style={
          {
            animationDelay: `${fillMs}ms`,
          } as React.CSSProperties
        }
      >
        ✓ done
      </span>
    </div>
  );
}

// =====================================================================
// All animations live here as a single inline <style> block.
// =====================================================================
const SKELETON_CSS = `
  /* Phase 1 — fast climb to 95% in 1.8s while we expect data. */
  @keyframes sk-pct-text {
    0%   { content: "0%"; }
    8%   { content: "5%"; }
    16%  { content: "12%"; }
    25%  { content: "20%"; }
    33%  { content: "30%"; }
    41%  { content: "40%"; }
    50%  { content: "50%"; }
    58%  { content: "60%"; }
    66%  { content: "70%"; }
    75%  { content: "80%"; }
    83%  { content: "88%"; }
    91%  { content: "92%"; }
    100% { content: "95%"; }
  }
  /* Phase 2 — slow crawl 95% → 99% over 8s. Fixes the "frozen at 95%"
     UX bug: when an upstream API hits its 5s ceiling, getMarketSnapshot
     waits ~5s+ before the gauge can stream in. Without this crawl,
     users see the bar stop dead and assume the page is broken. The
     5-step staggered tick (~1.6s per percent) keeps the eye engaged. */
  @keyframes sk-pct-text-crawl {
    0%   { content: "95%"; }
    20%  { content: "96%"; }
    45%  { content: "97%"; }
    72%  { content: "98%"; }
    100% { content: "99%"; }
  }
  .sk-percent::after {
    content: "0%";
    animation:
      sk-pct-text ${MASTER_DURATION_MS - 400}ms steps(13, end) forwards,
      sk-pct-text-crawl 8s steps(5, end) ${MASTER_DURATION_MS - 400}ms forwards;
  }

  @keyframes sk-master-fill {
    from { width: 0%; }
    to   { width: 95%; }
  }
  /* Bar matches the crawling % counter — width creeps 95% → 99% over
     8s in lockstep with the text. Linear interpolation (not ease-out)
     so the motion feels constant and active rather than asymptotic. */
  @keyframes sk-master-fill-crawl {
    from { width: 95%; }
    to   { width: 99%; }
  }
  .sk-master-bar {
    animation:
      sk-master-fill ${MASTER_DURATION_MS - 400}ms ease-out forwards,
      sk-master-fill-crawl 8s linear ${MASTER_DURATION_MS - 400}ms forwards;
  }

  @keyframes sk-shimmer {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }
  .sk-master-shimmer {
    animation: sk-shimmer 1.4s linear infinite;
  }

  @keyframes sk-source-fill {
    from { width: 0%; }
    to   { width: 100%; }
  }
  .sk-source-bar {
    width: 0%;
    animation-name: sk-source-fill;
    animation-timing-function: ease-out;
    animation-fill-mode: forwards;
  }

  @keyframes sk-source-check-in {
    from { opacity: 0; transform: scale(0.6); }
    to   { opacity: 1; transform: scale(1); }
  }
  .sk-source-check {
    opacity: 0;
    animation-name: sk-source-check-in;
    animation-duration: 200ms;
    animation-timing-function: ease-out;
    animation-fill-mode: forwards;
  }

  @keyframes sk-pulse-dot {
    0%, 100% { opacity: 0.4; box-shadow: 0 0 6px var(--accent); }
    50%      { opacity: 1;   box-shadow: 0 0 14px var(--accent); }
  }
  .sk-pulse-dot {
    animation: sk-pulse-dot 1.2s ease-in-out infinite;
  }
  /* Soft variant (no shadow change) for the BUY SIGNAL placeholder */
  @keyframes sk-pulse-dot-soft {
    0%, 100% { opacity: 0.5; }
    50%      { opacity: 0.85; }
  }
  .sk-pulse-dot-soft {
    animation: sk-pulse-dot-soft 1.8s ease-in-out infinite;
  }

  @keyframes sk-pulse-text {
    0%, 100% { opacity: 0.45; }
    50%      { opacity: 1;   }
  }
  .sk-pulse-text {
    animation: sk-pulse-text 1.6s ease-in-out infinite;
  }

  @keyframes sk-hub-pulse {
    0%, 100% { opacity: 0.4; }
    50%      { opacity: 0.85; }
  }
  .sk-hub-pulse {
    animation: sk-hub-pulse 1.4s ease-in-out infinite;
  }

  /* (Sweep needle rotation moved to SVG SMIL <animateTransform> in
     SkeletonGauge · CSS @keyframes on inner <g> elements pivot
     around the wrong point because of transform-box quirks. See the
     <animateTransform> block in the SVG for the canonical animation.) */

  @keyframes sk-dim-pulse {
    0%, 100% { opacity: var(--sk-dim-base, 0.3); }
    50%      { opacity: calc(var(--sk-dim-base, 0.3) * 1.4); }
  }
  .sk-dim-pulse {
    animation: sk-dim-pulse 2s ease-in-out infinite;
  }

  /* Saylor-quote cross-fade carousel · exactly one quote visible at a
     time. Window % is derived from the quote count so it stays correct
     if SAYLOR_QUOTES changes; each <blockquote> is phase-shifted by its
     inline animation-delay (i × QUOTE_HOLD_MS). Loop = count × hold. */
  @keyframes sk-quote-cycle {
    0% { opacity: 0; transform: translateY(6px); }
    ${((100 / SAYLOR_QUOTES.length) * 0.1).toFixed(3)}% { opacity: 1; transform: translateY(0); }
    ${((100 / SAYLOR_QUOTES.length) * 0.82).toFixed(3)}% { opacity: 1; transform: translateY(0); }
    ${(100 / SAYLOR_QUOTES.length).toFixed(3)}% { opacity: 0; transform: translateY(-6px); }
    100% { opacity: 0; }
  }
  .sk-quote {
    opacity: 0;
    animation: sk-quote-cycle ${SAYLOR_QUOTES.length * QUOTE_HOLD_MS}ms linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .sk-quote { animation: none; }
    .sk-quote:first-child { opacity: 1; }
  }
`;
