"use client";

/* =====================================================================
 * MapExplorer · the full-page Bitcoin circular-economy atlas (B8)
 *
 * The homepage VendorMap grown into a flagship surface: same offline-
 * generated Natural Earth outlines + equirectangular projection (dots
 * land pixel-perfect on their countries, d3 stays a devDep), but here
 * a country click opens a VENDOR PANEL · every verified merchant in
 * that country, linking to their /v pages · instead of filtering a
 * grid that lives on another page. "Browse these in the directory"
 * hands off to /?country=XX for the full filter experience.
 *
 * The vendor roster arrives as props from the server page (grouped
 * once, server-side) so this component owns zero data derivation and
 * the crawlable per-country lists on the page below can never
 * disagree with the panel.
 * ===================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { track } from "@vercel/analytics";
import worldPaths from "@/lib/world-paths.json";
import { COUNTRIES, COUNTRY_COORDS } from "@/lib/vendors";
import { Globe } from "./Globe";

export type MapVendor = {
  name: string;
  slug: string;
  category: string;
  handle: string;
};

export type CountryGroup = {
  count: number;
  vendors: MapVendor[];
};

const VIEW_W = worldPaths.width; // 1000
const VIEW_H = worldPaths.height; // 500

function project(lat: number, lon: number): { x: number; y: number } {
  return {
    x: (VIEW_W / 360) * lon + VIEW_W / 2,
    y: VIEW_H / 2 - (VIEW_H / 180) * lat,
  };
}

const ACCENT = "#F7931A";
const CONTINENT_FILL = "#2c2c34";
const CONTINENT_STROKE = "#4a4a56";
const OCEAN_FILL = "#0d1320";

// Deterministic stagger · module scope so re-renders never re-roll
// (same rationale as VendorMap's DOT_DELAYS).
const DOT_DELAYS: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  let i = 0;
  for (const cc of Object.keys(COUNTRY_COORDS)) {
    m[cc] = (i++ % 7) * 0.05;
  }
  return m;
})();

export function MapExplorer({
  byCountry,
}: {
  byCountry: Record<string, CountryGroup>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // Keyboard-focused dot · Safari (WebKit) never paints CSS outlines
  // on SVG container elements, so the global [tabindex]:focus-visible
  // ring is invisible there. We mirror the selection stroke instead ·
  // an in-SVG indicator renders everywhere (review 2026-07-07).
  const [focusedCc, setFocusedCc] = useState<string | null>(null);
  // The dot-halo pulse is decorative: it stops for reduced-motion
  // users (WCAG 2.3.3 · MotionConfig can't reach attribute keyframes)
  // and while the atlas is scrolled offscreen (~20 infinite rAF
  // animations otherwise run for the page's whole lifetime).
  const reduceMotion = useReducedMotion();
  const sceneRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { rootMargin: "100px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const pulse = inView && !reduceMotion;
  const maxCount = Math.max(1, ...Object.values(byCountry).map((g) => g.count));

  // 3D globe by default (operator request 2026-07-09) · the flat SVG
  // atlas remains as the no-WebGL fallback AND the always-available
  // keyboard path stays in the chip row below (ALL countries).
  const [glFailed, setGlFailed] = useState(false);

  const globeDots = useMemo(
    () =>
      Object.entries(byCountry)
        .map(([cc, group]) => {
          const coord = COUNTRY_COORDS[cc];
          if (!coord) return null;
          return {
            cc,
            lat: coord.lat,
            lon: coord.lon,
            weight: group.count / maxCount,
          };
        })
        .filter((d): d is NonNullable<typeof d> => d != null),
    [byCountry, maxCount],
  );

  const selectedGroup = selected ? byCountry[selected] : null;
  const selectedInfo = selected ? COUNTRIES[selected] : null;

  // Every country, busiest first · with the globe on a canvas this
  // row is the keyboard and screen-reader selection path, so it is
  // no longer capped at six.
  const topCountries = useMemo(
    () =>
      Object.entries(byCountry).sort((a, b) => b[1].count - a[1].count),
    [byCountry],
  );

  function pick(cc: string) {
    setSelected((cur) => (cur === cc ? null : cc));
    track("map_explorer_country", { country: cc });
  }

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6 lg:items-start">
      {/* The atlas · machined bezel, fixed-dark scene like every
          instrument (the map is a data graphic · identical in both
          themes). */}
      <div
        ref={sceneRef}
        className="rounded-xl p-[1.5px] bezel-metal nb-seated"
      >
        <div className="rounded-[11px] bg-[#12110F] p-3 sm:p-4">
          {!glFailed ? (
            <>
              <Globe
                dots={globeDots}
                selected={selected}
                onPick={pick}
                onClear={() => setSelected(null)}
                onFail={() => setGlFailed(true)}
                inView={inView}
                reduceMotion={reduceMotion ?? false}
              />
              <p className="mt-2 font-mono t-xs uppercase tracking-[0.2em] text-[rgba(235,225,210,0.55)]">
                Drag to spin · scroll or pinch to zoom · the shadow is
                the true night side, live
              </p>
            </>
          ) : (
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-auto select-none"
            role="img"
            aria-label="World map of every verified Bitcoin merchant in the Galaxy Mind directory"
            onClick={() => setSelected(null)}
          >
            <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill={OCEAN_FILL} />
            <path
              d={worldPaths.path}
              fill={CONTINENT_FILL}
              stroke={CONTINENT_STROKE}
              strokeWidth="0.8"
              fillRule="evenodd"
            />
            {Object.entries(byCountry).map(([cc, group]) => {
              const coord = COUNTRY_COORDS[cc];
              if (!coord) return null;
              const { x, y } = project(coord.lat, coord.lon);
              const radius = 5 + Math.sqrt(group.count / maxCount) * 10;
              const isSelected = selected === cc;
              const dimmed = selected !== null && !isSelected;
              const info = COUNTRIES[cc];
              const label = info
                ? `${info.flag} ${info.label} · ${group.count} merchant${group.count === 1 ? "" : "s"}`
                : `${cc} · ${group.count}`;
              return (
                <motion.g
                  key={cc}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: dimmed ? 0.3 : 1 }}
                  transition={{
                    duration: 0.4,
                    delay: DOT_DELAYS[cc] ?? 0,
                    type: "spring",
                    stiffness: 200,
                    damping: 15,
                  }}
                  style={{ transformOrigin: `${x}px ${y}px`, cursor: "pointer" }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Show merchants in ${label}`}
                  aria-pressed={isSelected}
                  onClick={(e) => {
                    e.stopPropagation();
                    pick(cc);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      pick(cc);
                    }
                  }}
                  onFocus={(e) => {
                    if (e.currentTarget.matches(":focus-visible")) {
                      setFocusedCc(cc);
                    }
                  }}
                  onBlur={() => {
                    setFocusedCc((cur) => (cur === cc ? null : cur));
                  }}
                >
                  {/* Invisible hit target · same tap-floor fix as the
                      homepage VendorMap (audit 2026-07-08). */}
                  <circle cx={x} cy={y} r={Math.max(radius * 2, 14)} fill="transparent" />
                  <motion.circle
                    cx={x}
                    cy={y}
                    r={radius}
                    fill={ACCENT}
                    opacity={0.25}
                    initial={{ r: radius, opacity: 0.25 }}
                    animate={
                      pulse
                        ? {
                            r: [radius, radius * 2.1, radius],
                            opacity: [0.25, 0, 0.25],
                          }
                        : { r: radius, opacity: 0.25 }
                    }
                    transition={
                      pulse
                        ? { duration: 2.5, repeat: Infinity, ease: "easeOut" }
                        : { duration: 0.2 }
                    }
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r={radius}
                    fill={ACCENT}
                    stroke={isSelected || focusedCc === cc ? "#fff" : ACCENT}
                    strokeWidth={isSelected || focusedCc === cc ? 2 : 0}
                    style={{ filter: `drop-shadow(0 0 ${radius}px ${ACCENT})` }}
                  />
                  <title>{label}</title>
                </motion.g>
              );
            })}
          </svg>
          )}

          {/* Country chips · ALL countries, busiest first. With the
              globe on a canvas this is the keyboard path. Fixed-dark
              scene → fixed-light dim text (AA values from the
              instrument panels). */}
          <div className="mt-3 flex flex-wrap gap-2">
            {topCountries.map(([cc, group]) => {
              const info = COUNTRIES[cc];
              if (!info) return null;
              const active = selected === cc;
              return (
                <button
                  key={cc}
                  type="button"
                  onClick={() => pick(cc)}
                  className="micro-label px-2.5 py-1 rounded-full border transition-colors"
                  style={{
                    borderColor: active ? ACCENT : "rgba(235,225,210,0.14)",
                    color: active ? ACCENT : "rgba(235,225,210,0.66)",
                    background: active ? "rgba(247,147,26,0.1)" : "transparent",
                  }}
                >
                  {info.flag} {cc} · {group.count}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Country panel · rail on lg+, below the map on mobile. */}
      <aside
        className="mt-4 lg:mt-0"
        aria-live="polite"
        aria-label="Merchants in the selected country"
      >
        {selectedGroup && selectedInfo && selected ? (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 elevate">
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                {selectedInfo.flag} {selectedInfo.label}
              </h2>
              <span className="t-xs text-[var(--text-tertiary)] tabular-nums">
                {selectedGroup.count} verified
              </span>
            </div>
            <ul className="space-y-1.5 max-h-[46vh] overflow-y-auto pr-1">
              {selectedGroup.vendors.map((v) => (
                <li key={v.slug}>
                  <Link
                    href={`/v/${v.slug}`}
                    onClick={() =>
                      track("map_explorer_vendor_click", { handle: v.handle })
                    }
                    className="flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 border border-transparent hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 transition-colors"
                  >
                    <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {v.name}
                    </span>
                    <span className="t-xs text-[var(--text-tertiary)] shrink-0">
                      {v.category}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href={`/?country=${selected.toLowerCase()}`}
              onClick={() =>
                track("map_explorer_to_directory", { country: selected })
              }
              className="mt-4 inline-flex items-baseline gap-2 t-xs font-medium text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
            >
              Browse these in the directory →
            </Link>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-5 text-sm text-[var(--text-tertiary)] leading-relaxed">
            Tap a glowing dot · every one is a country where verified
            merchants take bitcoin for everyday goods. Drag the planet to
            spin it, scroll or pinch to zoom, and watch the night side
            creep · the shadow tracks the actual sun, right now.
          </div>
        )}
      </aside>
    </div>
  );
}
