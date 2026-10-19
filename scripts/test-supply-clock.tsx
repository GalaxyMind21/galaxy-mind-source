// Run: npx tsx scripts/test-supply-clock.tsx
//
// Render + contract tests for the /float hero instrument (the Supply
// Clock · successor to test-hourglass.tsx, which retired with the
// hourglass on 2026-06-29). Two layers:
//   1. renderToStaticMarkup smoke of the REAL component with a real
//      composed snapshot · asserts the SSR output carries the exact
//      stored headline (no tick before hydration), the a11y contract,
//      the honest state labels, and every strata legend entry.
//   2. Source-level guards · the legibility + determinism rules the
//      hourglass learned the hard way, adapted to an HTML-first hero:
//      no SVG text at all, no sub-10px type, no Math.random anywhere
//      (the bubble field must stay deterministic for hydration).

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";
import { SupplyClock } from "../src/app/float/components/SupplyClock";
import { composeFloatSnapshot } from "../src/lib/float-snapshot";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const snapshot = composeFloatSnapshot({
  blockHeight: 952_000,
  asOf: "2026-06-12T00:15:00.000Z",
  governmentsBtc: 250_000,
  etfsBtc: 1_200_000,
  publicCompaniesBtc: 750_000,
});

// ── 1 · live-data render ─────────────────────────────────────────────
const html = renderToStaticMarkup(
  <SupplyClock snapshot={snapshot} dailyDelta={-1_200} btcPrice={63_000} />,
);

const expectedInt = Math.floor(snapshot.inPlay).toLocaleString("en-US");
ok(
  "figure aria-label carries the exact stored headline (SSR = snapshot, no tick)",
  html.includes(`${expectedInt} bitcoin still in play`),
);
ok('clock + bar wrapped in a single labeled role="img"', html.includes('role="img"'));
ok("nameplate present (and HTML text, never near ornament)", html.includes("Supply Clock"));
ok("status lamp reads DRAINING on a negative delta", html.includes("DRAINING"));
ok("21M denominator stated", html.includes("21,000,000"));
ok(
  "all four strata legend entries render",
  ["LOST + HELD", "ETF + GOV + CO", "STILL IN PLAY", "UNMINED"].every((s) =>
    html.includes(s),
  ),
);
ok("deterministic bubble field present", html.includes("sc-bubble"));
ok(
  "urgency tiles render",
  ["Spoken for", "Net flow", "The next cut"].every((s) => html.includes(s)),
);
// dailyDelta −1200 → runway ≈ 13.8y (< 100y cap) → the tile + honesty
// footnote must both render.
ok("runway tile renders for a meaningful drain", html.includes("Runway*"));
ok(
  "runway footnote declares the thought experiment",
  html.includes("thought experiment"),
);
ok(
  "extrapolation honesty note present",
  html.includes("extrapolated between daily snapshots"),
);

// ── 2 · degraded states stay honest ─────────────────────────────────
const fallbackHtml = renderToStaticMarkup(
  <SupplyClock snapshot={snapshot} dailyDelta={null} isFallback />,
);
ok("fallback lamp reads BASELINE", fallbackHtml.includes("BASELINE"));
ok(
  "fallback note says static baseline",
  fallbackHtml.includes("static baseline"),
);

const syncingHtml = renderToStaticMarkup(
  <SupplyClock snapshot={snapshot} dailyDelta={null} />,
);
ok("null delta lamp reads SYNCING", syncingHtml.includes("SYNCING"));
ok(
  "null delta swaps runway for the pressure ratio tile",
  syncingHtml.includes("daily demand vs newly mined supply"),
);
ok(
  "null delta shows placeholder flow, not an invented number",
  syncingHtml.includes("first snapshots accumulating"),
);

const partialSnap = composeFloatSnapshot({
  blockHeight: 952_000,
  asOf: "2026-06-12T00:15:00.000Z",
  governmentsBtc: 250_000,
  etfsBtc: 1_200_000,
  publicCompaniesBtc: null,
});
const partialHtml = renderToStaticMarkup(
  <SupplyClock snapshot={partialSnap} dailyDelta={-1_200} />,
);
ok(
  "withheld live cohort legend says syncing, not a fake 0%",
  partialHtml.includes("syncing"),
);
ok(
  "withheld live cohort a11y does not claim a precise ETF/gov/co percent",
  !partialHtml.includes("percent with ETFs, governments and public companies"),
);

// ── 3 · source-level guards ──────────────────────────────────────────
const src = readFileSync(
  join(process.cwd(), "src/app/float/components/SupplyClock.tsx"),
  "utf8",
);
ok("HTML-first hero · no <svg (the SVG-text garble class is retired)", !src.includes("<svg"));
{
  const tiny = [...src.matchAll(/text-\[(\d+)px\]/g)].filter(
    (m) => Number(m[1]) < 10,
  );
  ok("no sub-10px type anywhere (legibility rule)", tiny.length === 0);
}
ok("no Math.random (deterministic render, hydration-safe)", !src.includes("Math.random"));
ok(
  "extrapolation is capped (stalled cron cannot drain the display)",
  src.includes("EXTRAPOLATION_CAP_S"),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
