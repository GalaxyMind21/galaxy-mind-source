"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { track } from "@vercel/analytics";
import type { SignalReading } from "@/lib/stack";
import { MiniSparkline } from "./MiniSparkline";

const COOL_BLUE = "#5478b8";

// Mini-gauge geometry. Bigger viewBox (120 × 65) than v1 to give the
// fill-arc + tick marks + endpoint dot proper breathing room. Center at
// (60, 60) so the dial sits at the bottom of the viewBox and the half-
// circle arc reaches up.
const CX = 60;
const CY = 60;
const R = 50;

// Plain-language descriptions shown when a visitor clicks the (i) icon.
// Kept short — one sentence on what the metric is, one on how to read it.
// Most visitors don't know MVRV, Mayer Multiple, mNAV, etc.; this is
// the dummy-proofing layer that makes the cockpit usable to a newcomer.
const SIGNAL_INFO: Record<string, { full: string; plain: string }> = {
  MVRV: {
    full: "Market Value to Realized Value",
    plain:
      "Total market cap divided by what holders actually paid for their coins. Below 1.0 means the average bitcoin holder is underwater on cost basis · historically a strong accumulation zone.",
  },
  "Mayer Multiple": {
    full: "Price ÷ 200-day Moving Average",
    plain:
      "How stretched price is from its long-run trend. Below 1.0 puts you in 'cheap relative to cycle' territory; above 2.4 has historically marked frothy cycle tops.",
  },
  "Puell Multiple": {
    full: "Daily Issuance USD ÷ 365-day MA",
    plain:
      "Today's bitcoin issuance value (USD) divided by its 365-day moving average. Below 0.5 marks miner capitulation · every major bottom (Dec 2018, Mar 2020, Nov 2022) printed below 0.5. Above 4.0 marks miner over-earning · every major cycle top printed above 4.0.",
  },
  "Funding Rate": {
    full: "BTC Perpetual Futures Funding (8h)",
    plain:
      "What long-side traders pay short-side traders to hold a position open (or vice versa). Negative funding means shorts are paying longs · the market is positioned bearishly. That's contrarian-bullish for spot buyers.",
  },
  "Fear & Greed": {
    full: "Crowd Sentiment Index (0 = fear, 100 = greed)",
    plain:
      "A composite of social sentiment, volatility, and momentum. We invert it: extreme fear in the crowd is a green light for accumulators; extreme greed is a yellow flag.",
  },
  "Price vs 30d MA": {
    full: "Short-term Mean Reversion",
    plain:
      "Where price sits relative to its 30-day moving average. Trading below the 30-day tends to mean-revert upward; trading well above tends to mean-revert downward.",
  },
  "30d Realized Vol": {
    full: "Recent Volatility (annualized)",
    plain:
      "Annualized vol from the last 30 days of returns. Quiet markets (under 40%) often precede moves; very high vol (over 100%) often brackets capitulation lows.",
  },
  "Hour-of-Day": {
    full: "Time-of-Day Pattern",
    plain:
      "Average hourly return at the current ET hour over the last ~2 years. Hours that have historically underperformed become better entry windows.",
  },
  "Day-of-Week": {
    full: "Day-of-Week Pattern",
    plain:
      "Same idea as Hour-of-Day but for weekdays. Sunday afternoons and weekday Asian-session opens have historically shown different baselines than US trading hours.",
  },
  "MSTR mNAV": {
    full: "Treasury Premium (Smart Money Proxy)",
    plain:
      "Strategy's market cap divided by the value of its bitcoin holdings. When this premium compresses below 1.05×, treasury equity trades near or below its underlying BTC value · historically correlated with BTC bottoms.",
  },
};

// Canonical glossary anchor per signal, where one exists (B1 glossary
// wiring 2026-07-07). The popover's plain-language blurb stays the
// fast answer; this is the "go deeper" path into the citable
// DefinedTerm pages. Signals without a glossary entry (time-of-day /
// day-of-week patterns, price vs 30d MA) simply omit the link.
const SIGNAL_GLOSSARY_SLUG: Record<string, string> = {
  MVRV: "mvrv",
  "Mayer Multiple": "mayer-multiple",
  "Puell Multiple": "puell-multiple",
  "Funding Rate": "funding-rate",
  "Fear & Greed": "fear-greed",
  "30d Realized Vol": "realized-volatility",
  "MSTR mNAV": "mnav",
};

// Polar to Cartesian, half-circle gauge convention:
//   -180° = leftmost (score 0), -90° = top (score 50), 0° = rightmost (score 100).
function polar(r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + Math.cos(rad) * r, y: CY + Math.sin(rad) * r };
}

function arcPath(r: number, startDeg: number, endDeg: number) {
  const a = polar(r, startDeg);
  const b = polar(r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const sweepFlag = sweep > 0 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${b.x} ${b.y}`;
}

// Score 0..100 → angle on the half-circle gauge (-180° at left to 0° at right).
function valueToAngle(v: number) {
  return -180 + (Math.max(0, Math.min(100, v)) / 100) * 180;
}

export function SignalDial({
  s,
  history,
}: {
  s: SignalReading;
  // Per-signal historical normalized values (oldest → newest), or null
  // if no history is available (KV unset, day-1 site, etc.). Sparkline
  // gracefully renders nothing in that case.
  history?: number[] | null;
}) {
  const [showInfo, setShowInfo] = useState(false);
  // Grace-period close · the popover now contains a clickable glossary
  // link, so an instant mouseleave-close would make it unreachable by
  // mouse (pointer leaves the (i), popover vanishes before it arrives).
  // 160ms is enough to travel the gap, short enough to feel instant.
  const closeTimer = useRef<number | null>(null);
  const openInfo = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setShowInfo(true);
  };
  const scheduleClose = () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setShowInfo(false), 160);
  };
  const live = s.weight > 0;

  const direction: "bullish" | "bearish" | "neutral" | "unavailable" = !live
    ? "unavailable"
    : s.normalized >= 65
      ? "bullish"
      : s.normalized <= 35
        ? "bearish"
        : "neutral";

  // "Energy" = how extreme the value is (close to 0 or 100). Drives glow
  // intensity, stroke width, and the secondary effects at both extremes.
  const energy = Math.abs(s.normalized - 50) / 50; // 0..1
  const isHighEnergy = s.normalized >= 80; // lava-explosive: "ready to burst"
  const isFrozen = live && s.normalized <= 20; // ice-frozen: mirror of high
  const isCharged = s.normalized >= 65;

  const primaryColor =
    direction === "unavailable"
      ? "rgba(255,255,255,0.18)"
      : direction === "bullish"
        ? "var(--accent)"
        : direction === "bearish"
          ? COOL_BLUE
          : "var(--text-tertiary)";

  const fillEndAngle = valueToAngle(s.normalized);
  const fillEndPoint = polar(R, fillEndAngle);

  const indicator =
    direction === "bullish"
      // -ink twins, not the raw fill/scale colours: this indicator is TEXT
      // and it sits on the page, not on the dark dial face. Measured on
      // production, --accent ran 2.04:1 and COOL_BLUE 3.88:1 on cream.
      ? { arrow: "↑", label: "BUY SIGNAL", color: "var(--accent-ink)" }
      : direction === "bearish"
        ? { arrow: "↓", label: "WAIT", color: "var(--cool-ink)" }
        : direction === "neutral"
          ? { arrow: "→", label: "NEUTRAL", color: "var(--text-tertiary)" }
          : { arrow: "·", label: "NO DATA", color: "var(--text-tertiary)" };

  const slug = s.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const fillGradId = `fillgrad-${slug}`;
  const glowFilterId = `glowfilter-${slug}`;
  const tintGradId = `tint-${slug}`;

  const info = SIGNAL_INFO[s.name];

  // Card border — orange pulsing at peak (lava), blue pulsing at frozen
  // bottom (ice), faded for everything in between. Symmetrical effect at
  // both ends of the spectrum so visitors learn one visual language.
  const borderClass = isHighEnergy
    ? "border-[var(--accent)]"
    : isFrozen
      ? "border-[#7ec0ff]"
      : isCharged
        ? "border-[var(--text-tertiary)]/50"
        : "border-[var(--border-subtle)]";
  const cardShadow = isHighEnergy
    ? "0 0 28px rgba(247,147,26,0.22), inset 0 0 12px rgba(247,147,26,0.08)"
    : isFrozen
      ? "0 0 28px rgba(126,192,255,0.22), inset 0 0 12px rgba(126,192,255,0.08)"
      : isCharged
        ? "0 0 14px rgba(247,147,26,0.08)"
        : "none";

  const animationClass = isHighEnergy
    ? "stack-dial-pulse-warm"
    : isFrozen
      ? "stack-dial-pulse-cold"
      : "";

  return (
    <div
      className={`group relative rounded-lg border bg-[var(--bg-elevated)] p-4 transition-all duration-300 hover:border-[var(--text-tertiary)] ${borderClass} ${animationClass}`}
      style={{ boxShadow: cardShadow }}
    >
      {/* Direction-tinted radial gradient backdrop. Intensity scales with
          energy so a near-peak dial visibly *glows* with its direction. */}
      {direction !== "unavailable" && direction !== "neutral" && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none rounded-lg"
          style={{
            background:
              direction === "bullish"
                ? `radial-gradient(ellipse 90% 70% at 50% 100%, rgba(247,147,26,${0.04 + energy * 0.1}), transparent 75%)`
                : `radial-gradient(ellipse 90% 70% at 50% 100%, rgba(84,120,184,${0.04 + energy * 0.08}), transparent 75%)`,
          }}
        />
      )}

      <div className="relative">
        {/* Header: name + (i) info button */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
            {s.name}
          </span>
          {info && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowInfo((v) => {
                  if (!v) track("stack_signal_info_open", { signal: s.name });
                  return !v;
                });
              }}
              onMouseEnter={openInfo}
              onMouseLeave={scheduleClose}
              className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full border border-[var(--border-subtle)] t-xs text-[var(--text-tertiary)] hover:border-[var(--accent)] hover:text-[var(--accent-ink)] transition-colors leading-none"
              aria-label={`What is ${s.name}?`}
              aria-expanded={showInfo}
            >
              i
            </button>
          )}
        </div>

        {/* Info tooltip · toggles on icon click or hover */}
        {showInfo && info && (
          <div
            className="absolute top-9 right-0 z-20 w-64 p-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--bg-base)] text-xs leading-relaxed shadow-xl"
            style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}
            onMouseEnter={openInfo}
            onMouseLeave={scheduleClose}
          >
            <div className="micro-label text-[var(--accent-ink)] mb-1.5">
              {info.full}
            </div>
            <p className="text-[var(--text-secondary)]">{info.plain}</p>
            <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] t-xs text-[var(--text-tertiary)] flex justify-between">
              <span>Weight in verdict</span>
              <span className="text-[var(--text-primary)] font-mono">
                {(s.weight * 100).toFixed(0)}%
              </span>
            </div>
            {SIGNAL_GLOSSARY_SLUG[s.name] && (
              <Link
                href={`/glossary/${SIGNAL_GLOSSARY_SLUG[s.name]}`}
                onClick={(e) => {
                  e.stopPropagation();
                  track("stack_signal_glossary_click", { signal: s.name });
                }}
                className="micro-label mt-2 inline-block text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
              >
                Full definition →
              </Link>
            )}
          </div>
        )}

        {/* The fill-arc gauge. Replaces the old needle with a track that
            actually fills proportional to value · Apple Health rings
            principle. The more "filled," the brighter it glows. */}
        <div className="mt-3 relative w-full aspect-[2/1.05]">
          <svg
            viewBox="0 0 120 65"
            className="w-full h-full"
            style={{ overflow: "visible" }}
          >
            <defs>
              {/* Fill arc gradient · full ice→lava spectrum mapped to the
                  gauge's user-space coordinates. userSpaceOnUse means a
                  short fill (low value) naturally exposes only the icy left
                  portion; a long fill (high value) shows the warm/lava end.
                  Same color logic as the hero gauge. */}
              <linearGradient
                id={fillGradId}
                x1="10"
                y1="0"
                x2="110"
                y2="0"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="var(--cool-ink)" stopOpacity="0.95" />
                <stop offset="14%" stopColor={COOL_BLUE} stopOpacity="1" />
                <stop offset="38%" stopColor="rgba(180,180,200,0.4)" />
                <stop offset="60%" stopColor="rgba(220,200,180,0.55)" />
                <stop offset="78%" stopColor="#FFA64D" stopOpacity="0.95" />
                <stop offset="92%" stopColor="#F7931A" stopOpacity="1" />
                <stop offset="100%" stopColor="#FF5A08" stopOpacity="1" />
              </linearGradient>

              {/* Glow filter · stdDeviation scales with energy so peak dials
                  bloom dramatically while neutral dials stay clean. */}
              <filter
                id={glowFilterId}
                x="-50%"
                y="-50%"
                width="200%"
                height="200%"
              >
                <feGaussianBlur stdDeviation={1.5 + energy * 4.5} />
                <feMerge>
                  <feMergeNode />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              {/* Subtle radial tint for the dial face */}
              <radialGradient id={tintGradId} cx="50%" cy="100%" r="80%">
                <stop offset="0%" stopColor="rgba(247,147,26,0.04)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
            </defs>

            {/* Dial face tint */}
            {isCharged && (
              <ellipse
                cx={CX}
                cy={CY}
                rx={R - 4}
                ry={R - 4}
                fill={`url(#${tintGradId})`}
              />
            )}

            {/* Track (dim base) */}
            <path
              d={arcPath(R, -180, 0)}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="3.5"
              fill="none"
              strokeLinecap="round"
            />

            {/* Tick marks at 0, 25, 50, 75, 100 */}
            {[0, 25, 50, 75, 100].map((v) => {
              const a = valueToAngle(v);
              const isMajor = v === 0 || v === 50 || v === 100;
              const inner = polar(R - 4, a);
              const outer = polar(R + 3, a);
              return (
                <line
                  key={v}
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth={isMajor ? 1.2 : 0.8}
                />
              );
            })}

            {/* Fill arc · the headline visualization. Grows from leftmost
                point to current value. Glow intensity scales with energy. */}
            {live && s.normalized > 0 && (
              <path
                d={arcPath(R, -180, fillEndAngle)}
                stroke={`url(#${fillGradId})`}
                strokeWidth={4 + energy * 1.5}
                fill="none"
                strokeLinecap="round"
                filter={energy > 0.25 ? `url(#${glowFilterId})` : undefined}
              />
            )}

            {/* "Lava-explosive" cracking lines at the fill endpoint when
                pegged near max. Five short rays radiate outward · gives
                the steampunk/cyberpunk "ready to burst" vibe. */}
            {isHighEnergy &&
              [-32, -16, 0, 16, 32].map((angleOffset) => {
                const a = fillEndAngle + angleOffset;
                const inner = polar(R + 4, a);
                const outer = polar(R + 9 + Math.abs(angleOffset) * 0.05, a);
                return (
                  <line
                    key={angleOffset}
                    x1={inner.x}
                    y1={inner.y}
                    x2={outer.x}
                    y2={outer.y}
                    stroke="var(--accent)"
                    strokeWidth={angleOffset === 0 ? 1.5 : 0.8}
                    opacity={0.85 - Math.abs(angleOffset) * 0.015}
                    style={{
                      filter: "drop-shadow(0 0 3px var(--accent))",
                    }}
                  />
                );
              })}

            {/* Ice-spike shards · symmetrical mirror of the lava cracks
                above, fired when the dial is pegged at the cold floor.
                Same five-ray fan, dashed strokes for crystalline character,
                cool-blue color and glow. */}
            {isFrozen &&
              [-32, -16, 0, 16, 32].map((angleOffset) => {
                const a = fillEndAngle + angleOffset;
                const inner = polar(R + 4, a);
                const outer = polar(R + 9 + Math.abs(angleOffset) * 0.05, a);
                return (
                  <line
                    key={`ice-${angleOffset}`}
                    x1={inner.x}
                    y1={inner.y}
                    x2={outer.x}
                    y2={outer.y}
                    stroke="var(--cool-ink)"
                    strokeWidth={angleOffset === 0 ? 1.5 : 0.8}
                    strokeDasharray={angleOffset === 0 ? undefined : "1.5 1"}
                    opacity={0.85 - Math.abs(angleOffset) * 0.015}
                    style={{
                      filter: "drop-shadow(0 0 3px #7ec0ff)",
                    }}
                  />
                );
              })}

            {/* Needle · hub → fill endpoint (2026-06-11 · operator: the
                hub dot with no needle read as a broken instrument). The
                fill arc stays the value display; the needle gives the
                mini-dials the same pointer vocabulary as the hero gauge. */}
            {live && (
              <line
                x1={CX}
                y1={CY}
                x2={polar(R - 9, fillEndAngle).x}
                y2={polar(R - 9, fillEndAngle).y}
                stroke={primaryColor}
                strokeWidth="1.6"
                strokeLinecap="round"
                opacity="0.9"
              />
            )}

            {/* Endpoint dot at the fill end · visual anchor for the
                precise value, glows hot at peak */}
            {live && (
              <circle
                cx={fillEndPoint.x}
                cy={fillEndPoint.y}
                r={isHighEnergy ? 3.5 : 2.5}
                fill={primaryColor}
                filter={energy > 0.4 ? `url(#${glowFilterId})` : undefined}
              />
            )}

            {/* Hub · machined pivot the needle visibly mounts into
                (was a lone faded dot). */}
            <circle
              cx={CX}
              cy={CY}
              r="3"
              fill="var(--bg-elevated-2)"
              stroke={live ? primaryColor : "var(--border-subtle)"}
              strokeWidth="0.8"
              opacity="0.95"
            />
            <circle
              cx={CX}
              cy={CY}
              r="1.1"
              fill={live ? primaryColor : "var(--text-tertiary)"}
              opacity="0.9"
            />
          </svg>

          {/* Particles: rising embers when pegged warm, falling snowflakes
              when pegged cold. Symmetrical visual vocabulary. */}
          {isHighEnergy && <DialEmbers />}
          {isFrozen && <DialSnowflakes />}
        </div>

        {/* Per-signal historical sparkline · short trail of this
            signal's normalized value over the last ~30 days. Renders
            nothing if KV history isn't available, so day-1 deploys
            and degraded snapshots fall through cleanly. */}
        {history && history.length >= 3 && (
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="micro-label text-[var(--text-tertiary)] shrink-0">
              30d
            </span>
            <div className="flex-1">
              <MiniSparkline series={history} />
            </div>
          </div>
        )}

        {/* Score + plain-language indicator */}
        <div className="mt-2 text-center">
          <div className="font-mono tabular-nums text-lg leading-none">
            <span
              style={
                isHighEnergy
                  ? { textShadow: "0 0 12px rgba(247,147,26,0.6)" }
                  : isFrozen
                    ? { textShadow: "0 0 12px rgba(126,192,255,0.6)" }
                    : undefined
              }
            >
              {s.normalized}
            </span>
            <span className="text-[var(--text-tertiary)] text-xs">/100</span>
          </div>
          <div className="mt-1.5">
            <span
              className="micro-label inline-flex items-center gap-1"
              style={{
                color: indicator.color,
                ...(direction === "unavailable"
                  ? { borderBottom: "1px dashed var(--border-subtle)" }
                  : {}),
              }}
            >
              <span aria-hidden>{indicator.arrow}</span>
              <span>{indicator.label}</span>
            </span>
          </div>
        </div>

        {/* Rationale (collapses on default, expands on hover) */}
        <p className="mt-3 t-xs leading-snug text-[var(--text-secondary)] line-clamp-2 group-hover:line-clamp-none transition-all duration-200">
          {s.rationale}
        </p>

        {/* Weight bar */}
        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <span className="micro-label text-[var(--text-tertiary)]">
              weight
            </span>
            <span className="font-mono t-xs tabular-nums text-[var(--text-tertiary)]">
              {(s.weight * 100).toFixed(0)}%
            </span>
          </div>
          <div className="mt-1 h-[3px] w-full rounded-full bg-[var(--border-subtle)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${s.weight * 100}%`,
                backgroundColor: primaryColor,
                boxShadow:
                  isHighEnergy && direction === "bullish"
                    ? "0 0 6px var(--accent)"
                    : "none",
              }}
            />
          </div>
        </div>
      </div>

      {/* Card-level pulse keyframes for the two extreme states. Inline
          styles dedupe across multiple peak/frozen dials in the cockpit. */}
      {(isHighEnergy || isFrozen) && (
        <style>{`
          @keyframes stack-dial-pulse-warm {
            0%, 100% { box-shadow: 0 0 28px rgba(247,147,26,0.22), inset 0 0 12px rgba(247,147,26,0.08); }
            50%      { box-shadow: 0 0 36px rgba(247,147,26,0.32), inset 0 0 16px rgba(247,147,26,0.14); }
          }
          .stack-dial-pulse-warm { animation: stack-dial-pulse-warm 2.4s ease-in-out infinite; }
          @keyframes stack-dial-pulse-cold {
            0%, 100% { box-shadow: 0 0 28px rgba(126,192,255,0.22), inset 0 0 12px rgba(126,192,255,0.08); }
            50%      { box-shadow: 0 0 36px rgba(126,192,255,0.32), inset 0 0 16px rgba(126,192,255,0.14); }
          }
          .stack-dial-pulse-cold { animation: stack-dial-pulse-cold 3.2s ease-in-out infinite; }
        `}</style>
      )}
    </div>
  );
}

// Three small embers rising from peak-energy dials — same visual vocabulary
// as the hero gauge's embers, scaled down for the card. CSS-only keyframes
// so they stay lightweight even with multiple peak dials on screen.
function DialEmbers() {
  return (
    <div
      className="absolute inset-x-0 top-0 h-full pointer-events-none overflow-visible"
      aria-hidden
    >
      {[
        { left: 28, delay: 0 },
        { left: 50, delay: 0.7 },
        { left: 72, delay: 1.4 },
      ].map((p, i) => (
        <span
          key={i}
          className="absolute w-[2px] h-[2px] rounded-full"
          style={{
            left: `${p.left}%`,
            top: "55%",
            background: "var(--accent)",
            boxShadow: "0 0 4px var(--accent), 0 0 8px rgba(247,147,26,0.6)",
            animation: `dial-ember-rise 2.4s linear ${p.delay}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes dial-ember-rise {
          0% { opacity: 0; transform: translate(0, 0) scale(0.4); }
          15% { opacity: 1; transform: translate(0, -10px) scale(1); }
          100% { opacity: 0; transform: translate(0, -45px) scale(0.2); }
        }
      `}</style>
    </div>
  );
}

// Symmetrical mirror of DialEmbers for frozen-floor dials. Snowflakes
// fall DOWN from the dial face (gravity), cool blue color.
function DialSnowflakes() {
  return (
    <div
      className="absolute inset-x-0 top-0 h-full pointer-events-none overflow-visible"
      aria-hidden
    >
      {[
        { left: 28, delay: 0 },
        { left: 50, delay: 0.9 },
        { left: 72, delay: 1.8 },
      ].map((p, i) => (
        <span
          key={i}
          className="absolute w-[2px] h-[2px] rounded-full"
          style={{
            left: `${p.left}%`,
            top: "20%",
            background: "rgba(180, 220, 255, 0.95)",
            boxShadow:
              "0 0 4px rgba(180,220,255,0.8), 0 0 8px rgba(120,180,255,0.6)",
            animation: `dial-snow-fall 3s linear ${p.delay}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes dial-snow-fall {
          0% { opacity: 0; transform: translate(0, 0) scale(0.4); }
          15% { opacity: 1; transform: translate(0, 10px) scale(1); }
          100% { opacity: 0; transform: translate(0, 60px) scale(0.2); }
        }
      `}</style>
    </div>
  );
}
