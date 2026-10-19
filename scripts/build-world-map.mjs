// Generate SVG path strings for every country from Natural Earth 110m
// data, write them to src/lib/world-paths.json.
//
// Why offline generation: react-simple-maps + d3-geo + world-atlas at
// runtime would add ~90KB to the page bundle and pull in React-coupled
// dependencies that don't peer-dep with React 19. Generating the SVG
// paths once at build time gives us:
//   - Real Natural Earth geography (not made-up shapes)
//   - Zero runtime JS dependencies for the map
//   - ~25KB JSON file gz-compressed (versus 90KB JS at runtime)
//
// Re-run after upgrading world-atlas (rare — Natural Earth is updated
// at decade timescales) or to switch projection:
//   node scripts/build-world-map.mjs
//
// Output: src/lib/world-paths.json
//   { paths: ["M..Z", "M..Z", ...], width: 1000, height: 500 }

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { feature } from "topojson-client";
import { geoEquirectangular, geoPath } from "d3-geo";

const VIEW_W = 1000;
const VIEW_H = 500;

// world-atlas ships pre-built TopoJSON files at multiple resolutions.
// 110m is the smallest (~100KB raw); fine for a vendor-presence map
// where we don't need country borders, just continent silhouettes.
// "land" is the union of all countries (no internal borders).
const topoPath = resolve(
  "node_modules/world-atlas/land-110m.json",
);
const topo = JSON.parse(readFileSync(topoPath, "utf-8"));
// `feature(topo, topo.objects.land)` returns a GeoJSON FeatureCollection
// for the land masses. The geo data uses spherical coordinates; the
// projection below maps them to the SVG viewBox.
const land = feature(topo, topo.objects.land);

// Equirectangular projection — same kind of plate-carrée I was *trying*
// to approximate by hand. Center in the middle of the viewBox; the
// scale of 159.155 is the "default" that makes a 1000x500 viewBox match
// -180..180 lon × -90..90 lat exactly.
const projection = geoEquirectangular()
  .translate([VIEW_W / 2, VIEW_H / 2])
  .scale(VIEW_W / (2 * Math.PI));

const pathGen = geoPath(projection);

// `pathGen(featureCollection)` returns one big SVG path string with
// all features merged via "M…Z M…Z M…Z". For a continent-outline use
// case that's exactly what we want — single fill, single stroke.
const d = pathGen(land);
if (!d) {
  console.error("path generation returned empty");
  process.exit(1);
}

const out = {
  // Single combined path for the world's land masses.
  path: d,
  width: VIEW_W,
  height: VIEW_H,
  source: "Natural Earth 110m via world-atlas",
  generatedAt: new Date().toISOString(),
};

const dest = resolve("src/lib/world-paths.json");
writeFileSync(dest, JSON.stringify(out));

console.log(`✓ world map generated`);
console.log(`  source: Natural Earth 110m (world-atlas)`);
console.log(`  viewBox: ${VIEW_W} × ${VIEW_H}`);
console.log(`  path length: ${d.length} chars`);
console.log(`  written → src/lib/world-paths.json`);
