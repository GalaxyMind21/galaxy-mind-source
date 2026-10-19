// Invariants for the hashrate:history reader (lib/hashrate-history.ts).
//
// The cron writes newest-first via LPUSH. The sparkline wants oldest-first
// and must drop non-finite rows rather than draw a hole. Seven points is
// the honesty floor: fewer than that is "history accumulating".
//
// Run: npx tsx scripts/test-hashrate-history.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HASHRATE_HISTORY_KEY,
  HASHRATE_HISTORY_MIN_POINTS,
  hashpriceSeries,
  type HashrateHistoryRow,
} from "../src/lib/hashrate-history";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` · ${detail}` : ""}`);
  }
}

function row(
  date: string,
  hashprice: number,
): HashrateHistoryRow {
  return {
    date,
    hashprice,
    floor: null,
    medianAsk: null,
    clearedLast30: null,
    clearedLast10: null,
    ourBestRecovery: null,
  };
}

console.log("\n── hashrate-history ──────────────────────────────");

assert("KV key is hashrate:history", HASHRATE_HISTORY_KEY === "hashrate:history");
assert("honesty floor is a week", HASHRATE_HISTORY_MIN_POINTS === 7);

{
  const newestFirst = [
    row("2026-09-10", 0.0009),
    row("2026-09-09", 0.0008),
    row("2026-09-08", 0.0007),
  ];
  const series = hashpriceSeries(newestFirst);
  assert(
    "reverses LPUSH newest-first into oldest-first",
    series.map((p) => p.date).join(",") === "2026-09-08,2026-09-09,2026-09-10",
  );
  assert(
    "keeps finite positive hashprice",
    series.map((p) => p.hashprice).join(",") === "0.0007,0.0008,0.0009",
  );
}

{
  const mixed = [
    row("2026-09-10", 0.0009),
    row("2026-09-09", Number.NaN),
    row("2026-09-08", 0),
    row("2026-09-07", -1),
    row("2026-09-06", 0.0005),
  ];
  const series = hashpriceSeries(mixed);
  assert(
    "drops non-finite, zero, and negative rows",
    series.map((p) => p.date).join(",") === "2026-09-06,2026-09-10",
  );
}

assert("empty input yields empty series", hashpriceSeries([]).length === 0);

{
  const content = readFileSync(
    join(process.cwd(), "src/app/hashrate/HashrateContent.tsx"),
    "utf8",
  );
  assert(
    "/hashrate mounts HashrateHistoryChart",
    content.includes("HashrateHistoryChart") && content.includes("getHashrateHistory"),
  );
  const cron = readFileSync(
    join(process.cwd(), "src/app/api/cron/snapshot-hashrate/route.ts"),
    "utf8",
  );
  assert(
    "snapshot-hashrate writes the shared key",
    cron.includes("HASHRATE_HISTORY_KEY"),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
