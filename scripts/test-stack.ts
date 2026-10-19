import {
  computeStackVerdict,
  scoreToTier,
  normMVRV,
  normMayer,
  normFunding,
  normFearGreed,
  normPriceVs30d,
  normVol,
  normMNAV,
  normPuell,
  type StackTier,
} from "../src/lib/stack";
import { buildRarityLine } from "../src/lib/stack-rarity";
import type { MarketSnapshot } from "../src/lib/market";

const NULL_SNAPSHOT: MarketSnapshot = {
  btcPrice: null,
  btcVol30d: null,
  fearGreed: null,
  fearGreedLabel: null,
  treasuries: [],
  mvrv: null,
  puell: null,
  fundingRate: null,
  hourlyCloses: null,
  hourlyTimestamps: null,
  blockHeight: null,
  asOf: new Date().toISOString(),
  source: "test",
};

let pass = 0,
  fail = 0;
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}${detail ? "  — " + detail : ""}`);
  }
}

// --- Tier mapping ---
const tierCases: { score: number; expected: StackTier }[] = [
  { score: 0, expected: "COLD" },
  { score: 20, expected: "COLD" },
  { score: 21, expected: "CHILL" },
  { score: 40, expected: "CHILL" },
  { score: 41, expected: "WARM" },
  { score: 60, expected: "WARM" },
  { score: 61, expected: "HOT" },
  { score: 80, expected: "HOT" },
  { score: 81, expected: "MOLTEN" },
  { score: 100, expected: "MOLTEN" },
];
for (const { score, expected } of tierCases) {
  assert(`scoreToTier(${score}) === ${expected}`, scoreToTier(score) === expected);
}

// --- Null snapshot is neutral ---
const v = computeStackVerdict(NULL_SNAPSHOT);
assert("null snapshot score === 50", v.score === 50, `got ${v.score}`);
assert("null snapshot tier === WARM", v.tier === "WARM");
assert("verdict has 10 signals", v.signals.length === 10, `got ${v.signals.length}`);
assert(
  "all signal weights sum to 1.0",
  Math.abs(v.signals.reduce((s, x) => s + x.weight, 0) - 1) < 1e-6,
);
assert(
  "score is integer 0-100",
  Number.isInteger(v.score) && v.score >= 0 && v.score <= 100,
);

assert("normMVRV(null) === 50", normMVRV(null) === 50);
assert("normMVRV(0.9) === 100", normMVRV(0.9) === 100);
assert("normMVRV(2.0) === 50", normMVRV(2.0) === 50);
assert("normMVRV(4.0) === 0", normMVRV(4.0) === 0);

assert("normMayer below 1.0 === 100", normMayer(50000, 60000) === 100);
assert("normMayer above 2.4 === 0", normMayer(150000, 50000) === 0);

assert("normFunding very negative === 100", normFunding(-0.001) === 100);
assert("normFunding mildly positive === 50", normFunding(0.0003) === 50);

assert("normFearGreed extreme fear === 100", normFearGreed(0) === 100);
assert("normFearGreed extreme greed === 0", normFearGreed(100) === 0);
assert("normFearGreed neutral === 50", normFearGreed(50) === 50);

assert("normPriceVs30d at MA === 50", normPriceVs30d(100, 100) === 50);
assert("normPriceVs30d 10% below clamps high", normPriceVs30d(90, 100) === 70);

assert("normVol low === 70", normVol(30) === 70);
assert("normVol very high === 80", normVol(120) === 80);

assert("normMNAV compressed === 100", normMNAV(1.0) === 100);
assert("normMNAV rich === 20", normMNAV(2.0) === 20);

assert("normPuell(null) === 50", normPuell(null) === 50);
assert("normPuell(0.3) === 100 (capitulation)", normPuell(0.3) === 100);
assert("normPuell(0.8) === 80", normPuell(0.8) === 80);
assert("normPuell(1.5) === 50 (typical)", normPuell(1.5) === 50);
assert("normPuell(3.0) === 20 (late-cycle)", normPuell(3.0) === 20);
assert("normPuell(5.0) === 0 (top zone)", normPuell(5.0) === 0);

// Realistic snapshot — should land in plausible range.
const REAL: MarketSnapshot = {
  ...NULL_SNAPSHOT,
  btcPrice: 95000,
  btcVol30d: 55,
  fearGreed: 30,
  fearGreedLabel: "Fear",
  mvrv: 1.4,
  puell: 1.1,
  fundingRate: -0.0001,
};
const realV = computeStackVerdict(REAL);
assert("real snapshot score in 0-100", realV.score >= 0 && realV.score <= 100);
assert("real snapshot tier defined", ["COLD","CHILL","WARM","HOT","MOLTEN"].includes(realV.tier));
assert("real summary is non-empty string", realV.summary.length > 10);
console.log(`  (real-data score: ${realV.score} ${realV.tier})`);

assert(
  "all signals have integer normalized values",
  realV.signals.every((s) => Number.isInteger(s.normalized)),
);

// --- Rarity line (production crash 2026-08: live score tied with
// the window max/min indexed hist[-1].date) ---
function histDays(
  n: number,
  scoreAt: (i: number) => number,
): { date: string; score: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
    score: scoreAt(i),
  }));
}

assert("rarity null under 30 days", buildRarityLine(50, histDays(29, () => 50)) === null);

{
  // 40 days of 50s, live score also 50 → tied for highest AND lowest.
  // Production threw TypeError: Cannot read properties of undefined (reading 'date').
  let threw = false;
  let line: string | null = null;
  try {
    line = buildRarityLine(50, histDays(40, () => 50));
  } catch {
    threw = true;
  }
  assert("rarity does not throw when live score equals window max", !threw);
  assert(
    "rarity names a tied high as highest of the window",
    typeof line === "string" && line.includes("Highest reading"),
    `got ${JSON.stringify(line)}`,
  );
}

{
  // Varied window whose min is 20. Live score 20 is a tied low, not a
  // tied high (the max is 60).
  let threw = false;
  let line: string | null = null;
  try {
    line = buildRarityLine(
      20,
      histDays(40, (i) => (i === 0 ? 20 : 60)),
    );
  } catch {
    threw = true;
  }
  assert("rarity does not throw when live score equals window min", !threw);
  assert(
    "rarity names a tied low as lowest of the window",
    typeof line === "string" && line.includes("Lowest reading"),
    `got ${JSON.stringify(line)}`,
  );
}

{
  // New high vs a 40-day window of 40s.
  const line = buildRarityLine(80, histDays(40, () => 40));
  assert(
    "rarity new high",
    line === "Highest reading of the last 40 days",
    `got ${JSON.stringify(line)}`,
  );
}

{
  // Mid-range: last higher reading 25 days ago (idx 15 of 40).
  const line = buildRarityLine(
    50,
    histDays(40, (i) => (i === 15 ? 70 : 40)),
  );
  assert(
    "rarity highest-since uses the last higher date",
    typeof line === "string" && line.startsWith("Highest since "),
    `got ${JSON.stringify(line)}`,
  );
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
