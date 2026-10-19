// Run: npx tsx scripts/test-float-urgency.ts
import {
  computeSinceLastVisit,
  computeTension,
  drainPerSecond,
  ghostFillPct,
  projectDepletionYears,
  readLastView,
  writeLastView,
  type LastView,
} from "../src/lib/float-urgency";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const HOUR = 3_600_000;

// computeSinceLastVisit
ok("null prev → null", computeSinceLastVisit(null, 14_600_000, 1_000) === null);
ok(
  "< 6h elapsed → null",
  computeSinceLastVisit({ ts: 0, inPlayBTC: 14_600_100 }, 14_600_000, 5 * HOUR) === null,
);
ok(
  "delta < 1 BTC → null",
  computeSinceLastVisit({ ts: 0, inPlayBTC: 14_600_000.4 }, 14_600_000, 7 * HOUR) === null,
);
ok(
  "negative delta (level rose / skew) → null",
  computeSinceLastVisit({ ts: 0, inPlayBTC: 14_599_000 }, 14_600_000, 7 * HOUR) === null,
);
{
  const r = computeSinceLastVisit({ ts: 0, inPlayBTC: 14_605_000 }, 14_600_000, 7 * HOUR);
  ok("valid → rounded deltaBTC=5000", r !== null && r.deltaBTC === 5000);
}

// computeTension : 0 across the normal range, ramps only when genuinely low
ok("tension full reservoir = 0", computeTension(0.95) === 0);
ok("tension at 0.50 fill = 0 (normal)", computeTension(0.5) === 0);
ok("tension at/below 0.15 fill = 1", computeTension(0.15) === 1 && computeTension(0.05) === 1);
{
  const mid = computeTension(0.325); // halfway between 0.15 and 0.50
  ok("tension mid ~0.5 and bounded", mid > 0.4 && mid < 0.6);
}
ok("tension clamps junk input", computeTension(-3) === 1 && computeTension(9) === 0);

// ghostFillPct : level as of most recent past halving; null when not derivable
ok("ghost null when no historical inPlay", ghostFillPct({ totalSupply: 21_000_000 }) === null);
{
  const g = ghostFillPct({ inPlayAtLastHalving: 16_800_000, totalSupply: 21_000_000 });
  ok("ghost = 80.0", g !== null && Math.abs(g - 80) < 1e-9);
}

// storage helpers (injected fake Storage)
{
  const store: Record<string, string> = {};
  const fake = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  };
  ok("readLastView empty → null", readLastView(fake) === null);
  const v: LastView = { ts: 123, inPlayBTC: 14_600_000 };
  writeLastView(fake, v);
  const back = readLastView(fake);
  ok("write→read round-trips", back !== null && back.ts === 123 && back.inPlayBTC === 14_600_000);
  store["gm:float:lastview"] = "{not json";
  ok("corrupt JSON → null (no throw)", readLastView(fake) === null);
}

// projectDepletionYears : thought-experiment runway, silent unless meaningful
ok("depletion null when dailyDelta null", projectDepletionYears(6_000_000, null) === null);
ok("depletion null when float grew", projectDepletionYears(6_000_000, 1_200) === null);
ok("depletion null when flat", projectDepletionYears(6_000_000, 0) === null);
ok("depletion null on sub-noise drain (-10/day)", projectDepletionYears(6_000_000, -10) === null);
ok("depletion null on NaN delta", projectDepletionYears(6_000_000, Number.NaN) === null);
ok("depletion null on nonpositive inPlay", projectDepletionYears(0, -2_500) === null);
{
  const y = projectDepletionYears(6_000_000, -2_500);
  // 6,000,000 / 2,500 / 365.25 ≈ 6.57 years
  ok("depletion ≈ 6.57y at 2500/day", y !== null && Math.abs(y - 6_000_000 / 2_500 / 365.25) < 1e-9);
}
ok(
  "depletion null when projection exceeds 100y (anti-complacency)",
  projectDepletionYears(6_000_000, -60) === null, // ≈ 274 years → suppressed
);

// drainPerSecond : live tick rate, 0 unless the float is actually shrinking
ok("drain/s 0 when delta null", drainPerSecond(null) === 0);
ok("drain/s 0 when delta positive", drainPerSecond(500) === 0);
ok("drain/s 0 on NaN", drainPerSecond(Number.NaN) === 0);
{
  const d = drainPerSecond(-2_592); // 2592/86400 = 0.03/s exactly
  ok("drain/s = 0.03 at -2592/day", Math.abs(d - 0.03) < 1e-12);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
