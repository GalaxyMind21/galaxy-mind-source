// Run: npx tsx scripts/check-ticker-consistency.ts
//
// Guards against treasury ticker-list drift. TARGET_TICKERS in
// src/lib/market.ts is the canonical list; the README documents the
// ~mirrored touch points that must move together when a ticker is
// added or removed (TREASURY_META, the history allow-list, the chart
// palette, JSON-LD, etc.). The existing check-treasury-mnav.ts verifies
// the mNAV MATH against the live API but says nothing about whether the
// various hardcoded ticker enumerations actually agree with each other.
// This catches the common drift: you update the canonical list (or one
// mirror) and forget another, so /treasuries renders a ghost row or
// drops a real one.
//
// Checks (all importable / literal-parsed · no brittle heuristics):
//   1. TREASURY_META keys (treasuries.ts) === TARGET_TICKERS, exactly.
//   2. The history API allow-list literal === TARGET_TICKERS, exactly
//      (both directions · catches a missing ticker AND a stale removed one).
//   3. The MNavHistoryChart COLORS palette has a swatch for every ticker.
//
// As more files grow hardcoded ticker enumerations, add a parse+compare
// block here rather than a presence-grep (presence greps false-positive
// on files that DERIVE from TARGET_TICKERS, e.g. the chart's ALL_TICKERS).

import { readFileSync } from "node:fs";
import { TARGET_TICKERS } from "../src/lib/market";
import { TREASURY_META } from "../src/lib/treasuries";

let pass = 0;
let fail = 0;
const ok = (m: string) => {
  pass++;
  console.log(`  ✓ ${m}`);
};
const bad = (m: string) => {
  fail++;
  console.log(`  ✗ ${m}`);
};

const canon = [...TARGET_TICKERS].slice().sort();
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length &&
  a.slice().sort().join(",") === b.slice().sort().join(",");

// ── 1 · TREASURY_META keys ↔ TARGET_TICKERS ───────────────────────
const metaKeys = Object.keys(TREASURY_META);
if (sameSet(metaKeys, [...TARGET_TICKERS])) {
  ok(`TREASURY_META keys match TARGET_TICKERS (${canon.join(", ")})`);
} else {
  bad(
    `TREASURY_META keys [${metaKeys.slice().sort().join(", ")}] != TARGET_TICKERS [${canon.join(", ")}]`,
  );
}

// ── 2 · history API allow-list literal ↔ TARGET_TICKERS ───────────
{
  const path = "src/app/api/treasuries/history/route.ts";
  const src = readFileSync(path, "utf8");
  const m = src.match(/ALLOWED_TICKERS\s*=\s*new Set\(\[([^\]]*)\]/);
  if (!m) {
    bad(`could not locate ALLOWED_TICKERS literal in ${path}`);
  } else {
    const tickers = [...m[1].matchAll(/["'`]([A-Z][A-Z0-9]*)["'`]/g)].map(
      (x) => x[1],
    );
    if (sameSet(tickers, [...TARGET_TICKERS])) {
      ok("history ALLOWED_TICKERS matches TARGET_TICKERS");
    } else {
      bad(
        `history ALLOWED_TICKERS [${tickers.slice().sort().join(", ")}] != TARGET_TICKERS [${canon.join(", ")}]`,
      );
    }
  }
}

// ── 3 · MNavHistoryChart COLORS palette covers every ticker ───────
{
  const path = "src/app/treasuries/components/MNavHistoryChart.tsx";
  const src = readFileSync(path, "utf8");
  const start = src.indexOf("const COLORS");
  const end = start >= 0 ? src.indexOf("\n};", start) : -1;
  if (start < 0 || end < 0) {
    bad(`could not locate COLORS palette in ${path}`);
  } else {
    const block = src.slice(start, end);
    const missing = TARGET_TICKERS.filter(
      (t) => !new RegExp(`\\b${t}\\s*:`).test(block),
    );
    if (missing.length === 0) {
      ok("MNavHistoryChart COLORS palette covers all tickers");
    } else {
      bad(`MNavHistoryChart COLORS missing swatch for: ${missing.join(", ")}`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
