"use client";

// Vendor world map — visualizes the directory's geographic spread.
//
// World map data: Natural Earth 110m via world-atlas, projected with
// d3-geo's equirectangular at 1000×500 viewBox. The full SVG path
// string is generated offline by scripts/build-world-map.mjs and
// committed at src/lib/world-paths.json (~77KB raw, ~20KB gzipped
// over the wire). This keeps d3-geo + topojson-client + world-atlas
// out of the runtime bundle entirely — they're devDeps used only at
// generation time.
//
// Projection rationale: equirectangular (plate carrée) — same one
// the path generation uses, so the lat/lon dot positions below align
// pixel-perfect with the country outlines. Geographically imperfect
// (Greenland looks oversized, poles stretch) but for a "where are our
// vendors" overlay this is the right tradeoff vs cartographic accuracy.

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { COUNTRIES, COUNTRY_COORDS } from "@/lib/vendors";
import { track } from "@vercel/analytics";
import worldPaths from "@/lib/world-paths.json";

// Country lat/lon centroids now live in src/lib/vendors.ts beside
// COUNTRIES (imported above as COUNTRY_COORDS) so the two tables can't
// silently drift — a country with vendors but no coords renders no dot
// (see the `if (!coord) return null` below). scripts/check-vendors.ts
// enforces COUNTRIES <-> COUNTRY_COORDS parity, so a missing row fails
// the validator before it can ship. The equirectangular projection
// below must still match scripts/build-world-map.mjs exactly so the
// dots land on their countries.

// Equirectangular projection — must match the projection used by
// scripts/build-world-map.mjs exactly so country dots align with the
// country outlines.
//
// d3-geo's equirectangular at scale (W / 2π) and translate (W/2, H/2)
// maps lon/lat in radians: x = scale * lon + translate.x.
// In degrees: x = (W / 360) * lon + W/2, y = H/2 - (H/180) * lat.
const VIEW_W = worldPaths.width;   // 1000
const VIEW_H = worldPaths.height;  // 500

function project(lat: number, lon: number): { x: number; y: number } {
  return {
    x: (VIEW_W / 360) * lon + VIEW_W / 2,
    y: VIEW_H / 2 - (VIEW_H / 180) * lat,
  };
}

const ACCENT = "#F7931A";
// Map color palette tuned for legibility on iPhone Safari (the canary
// browser for "is the contrast enough"). Earlier values were too close
// to the page background — land and ocean blurred together.
//
//   • CONTINENT_FILL: was #1C1C21 (~5% lightness over the BG of the
//                     day, the since-retired #0A0A0B)
//                     now #2c2c34 — clearly distinct neutral grey
//   • CONTINENT_STROKE: was BORDER #26262C (invisible against fill)
//                     now #4a4a56 — visible edge around each landmass
//   • OCEAN_FILL: was transparent (showing page BG)
//                 now #0d1320 — slight cool blue tint so the eye picks
//                 up "land = warm grey, ocean = cool dark blue"
//                 instantly without needing to read the dot positions
const CONTINENT_FILL = "#2c2c34";
const CONTINENT_STROKE = "#4a4a56";
const OCEAN_FILL = "#0d1320";

// Per-country dot animation delay. Computed ONCE at module load, not on
// every render — calling Math.random() inline in the framer-motion
// transition prop re-randomized on every re-render (e.g., every filter
// click), causing all dots to jarringly re-animate from scratch with
// different timing each time. Deterministic-but-staggered values are
// what a user actually wants visually.
const DOT_DELAYS: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (const cc of Object.keys(COUNTRY_COORDS)) {
    m[cc] = Math.random() * 0.3;
  }
  return m;
})();

export function VendorMap({
  vendorsByCountry,
  selectedCountry,
  onCountryClick,
  listedCount,
}: {
  vendorsByCountry: Record<string, number>;
  selectedCountry: "all" | string;
  onCountryClick: (countryCode: string) => void;
  /** Roster size for the current other-filters (including vendors
   *  with no country). The map only plots located rows, so summing
   *  vendorsByCountry under-counts vs the rest of the page (123 vs
   *  130 on 2026-08-21). Pass the un-located-inclusive total so the
   *  header cannot contradict the hero. */
  listedCount?: number;
}) {
  const maxCount = Math.max(1, ...Object.values(vendorsByCountry));
  const totalCountries = Object.keys(vendorsByCountry).length;
  const mappedVendors = Object.values(vendorsByCountry).reduce((a, b) => a + b, 0);
  const totalVendors = listedCount ?? mappedVendors;

  // PULSE GATE (perf + a11y 2026-07-25).
  //
  // The halo below is `repeat: Infinity` on ~20 dots. UnGated that is 20
  // never-ending framer-motion animations driving SVG `r`/`opacity` — so
  // the compositor and main thread keep working forever on a widget that
  // sits ~12,000px below the fold and that most visitors never scroll to.
  // Two gates:
  //   · prefers-reduced-motion — an infinitely pulsing element is exactly
  //     what that setting exists to stop, and the rest of the site honors
  //     it via MotionConfig.
  //   · viewport — IntersectionObserver, so the dots only breathe while
  //     actually on screen. The static core circle always renders, so the
  //     map is complete and legible either way; only the halo is gated.
  const reduceMotion = useReducedMotion();
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = sceneRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      // No IO (very old browser) · fall back to animating, matching the
      // previous behavior rather than silently freezing the map.
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { rootMargin: "100px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const pulse = inView && !reduceMotion;

  return (
    // Machined champagne bezel (2026-06-29 · Supply Clock language on
    // the homepage). Metal ring is theme-neutral; the inner panel stays
    // theme-aware so the header text keeps its light-mode contrast.
    <div className="rounded-xl p-[1.5px] bezel-metal nb-seated">
    <div className="rounded-xl bg-[var(--bg-elevated)] p-4 sm:p-5">
      {/* Header strip */}
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div className="t-xs font-medium text-[var(--text-tertiary)]">
          Global Reach
        </div>
        <div className="t-xs font-medium text-[var(--text-tertiary)] tabular-nums">
          <span className="text-[var(--accent-ink)]">{totalVendors}</span>{" "}
          vendors ·{" "}
          <span className="text-[var(--accent-ink)]">{totalCountries}</span>{" "}
          countries
        </div>
      </div>

      {/* Map. preserveAspectRatio="xMidYMid meet" so dots stay aligned
          with the continents at any container width.

          Click handler on the SVG calls onCountryClick("all") · clears
          any active country filter when the user clicks the ocean,
          continents, or any non-dot area. The dot click handlers below
          stopPropagation so a click on a dot doesn't bubble up here
          and immediately clear the filter the dot just set. */}
      <div className="relative" ref={sceneRef}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-auto select-none"
          role="img"
          aria-label="World map showing countries with Galaxy Mind vendors"
          onClick={() => {
            // Only fires when the click bubbled all the way up — dots
            // stop propagation. Always-on (no-op when filter is "all").
            if (selectedCountry !== "all") {
              onCountryClick("all");
              track("vendor_map_clear_filter", { source: "background_click" });
            }
          }}
          style={{
            cursor: selectedCountry !== "all" ? "pointer" : "default",
          }}
        >
          {/* Ocean · slight cool blue tint so the eye distinguishes
              ocean from land at a glance, even on iPhone Safari where
              the previous transparent + dark-grey land combo blurred
              together. */}
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill={OCEAN_FILL} />

          {/* Continents · Natural Earth 110m via world-atlas, projected
              equirectangular. Single path string covering all land masses.
              Stroke width bumped from 0.5 to 0.8 so each continent's
              outline reads at small sizes. */}
          <path
            d={worldPaths.path}
            fill={CONTINENT_FILL}
            stroke={CONTINENT_STROKE}
            strokeWidth="0.8"
            fillRule="evenodd"
          />

          {/* Country dots */}
          {Object.entries(vendorsByCountry).map(([cc, count]) => {
            const coord = COUNTRY_COORDS[cc];
            if (!coord) return null;
            const { x, y } = project(coord.lat, coord.lon);
            // Radius scales with vendor count, but with diminishing
            // returns so a US (16) vendor doesn't dwarf a CH (1)
            // vendor visually. sqrt scaling tested across 1-30 range.
            const radius = 4 + Math.sqrt(count / maxCount) * 8;
            const isSelected = selectedCountry === cc;
            const isFiltered =
              selectedCountry !== "all" && selectedCountry !== cc;
            const country = COUNTRIES[cc];
            const label = country
              ? `${country.flag} ${country.label} · ${count} vendor${count === 1 ? "" : "s"}`
              : `${cc} · ${count}`;

            return (
              <motion.g
                key={cc}
                initial={{ scale: 0, opacity: 0 }}
                animate={{
                  scale: 1,
                  opacity: isFiltered ? 0.3 : 1,
                }}
                transition={{
                  duration: 0.4,
                  delay: DOT_DELAYS[cc] ?? 0,
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                }}
                style={{
                  transformOrigin: `${x}px ${y}px`,
                  cursor: "pointer",
                }}
                // a11y (audit 2026-05): the dots are real controls —
                // clicking one filters the directory to that country.
                // They used to be mouse-only (onClick + <title> but no
                // role/tabIndex/keyboard), invisible to keyboard and
                // screen-reader users. Give them button semantics so
                // the map is operable without a pointer. aria-label
                // uses the same string as the <title> tooltip.
                role="button"
                tabIndex={0}
                aria-label={`Filter directory to ${label}`}
                onClick={(e) => {
                  // stopPropagation so the SVG-level handler (which
                  // clears the filter) doesn't immediately undo this.
                  e.stopPropagation();
                  onCountryClick(cc);
                  track("vendor_map_click", {
                    country: cc,
                    count,
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    // Space would otherwise scroll the page; Enter is
                    // harmless but normalize both.
                    e.preventDefault();
                    e.stopPropagation();
                    onCountryClick(cc);
                    track("vendor_map_click", {
                      country: cc,
                      count,
                    });
                  }
                }}
              >
                {/* Invisible hit target · the visible dot can render
                    ~6px on phones, far below the 24px tap floor. The
                    transparent circle widens the touchable area
                    without changing the visual (audit 2026-07-08).
                    Dense clusters cap it at 2x so neighbors stay
                    individually tappable · the country chips and the
                    crawlable index remain the large-target routes. */}
                <circle cx={x} cy={y} r={Math.max(radius * 2, 14)} fill="transparent" />
                {/* Pulse halo · animated outer ring. Larger countries
                    pulse more visibly because their radius is bigger. */}
                <motion.circle
                  cx={x}
                  cy={y}
                  r={radius}
                  fill={ACCENT}
                  opacity={0.25}
                  // Explicit initial matching the static r/opacity ·
                  // without it, framer-motion's first frame for an
                  // ANIMATED SVG `r` attribute emits r="undefined"
                  // before the keyframes resolve, throwing
                  // `<circle> attribute r: Expected length,
                  // "undefined"` once per dot (17 console errors on
                  // the homepage · audit 2026-05). Visually identical;
                  // do not remove as "redundant".
                  initial={{ r: radius, opacity: 0.25 }}
                  // Only breathe while on-screen and motion is allowed
                  // (see the PULSE GATE note above). When gated off we
                  // hold the resting frame — identical to `initial`, so
                  // there is no visual pop when it resumes.
                  animate={
                    pulse
                      ? {
                          r: [radius, radius * 2.2, radius],
                          opacity: [0.25, 0, 0.25],
                        }
                      : { r: radius, opacity: 0.25 }
                  }
                  transition={
                    pulse
                      ? { duration: 2.5, repeat: Infinity, ease: "easeOut" }
                      : { duration: 0 }
                  }
                />
                {/* Solid core */}
                <circle
                  cx={x}
                  cy={y}
                  r={radius}
                  fill={ACCENT}
                  stroke={isSelected ? "#fff" : ACCENT}
                  strokeWidth={isSelected ? 2 : 0}
                  style={{
                    filter: `drop-shadow(0 0 ${radius * 1.2}px ${ACCENT})`,
                  }}
                />
                {/* Label that appears on hover. SVG `<title>` is the
                    cheapest accessible tooltip · uses the browser's
                    native tooltip rendering, no JS needed. */}
                <title>{label}</title>
              </motion.g>
            );
          })}
        </svg>
      </div>

      {/* Legend / hint strip */}
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <div className="t-xs font-medium text-[var(--text-tertiary)]">
          {selectedCountry === "all"
            ? "Click a country to filter"
            : `Filtered: ${COUNTRIES[selectedCountry]?.flag ?? ""} ${COUNTRIES[selectedCountry]?.label ?? selectedCountry} · click anywhere to clear`}
          {selectedCountry === "all" && (
            <>
              {" · "}
              <a
                href="/map"
                className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
                onClick={() => track("vendor_map_to_atlas")}
              >
                Open the full map →
              </a>
            </>
          )}
        </div>
        {selectedCountry !== "all" && (
          <button
            onClick={() => onCountryClick("all")}
            className="t-xs font-medium text-[var(--accent-ink)] hover:text-[var(--accent-hover)] transition-colors"
          >
            Clear filter ×
          </button>
        )}
      </div>
    </div>
    </div>
  );
}
