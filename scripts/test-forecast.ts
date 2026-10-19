import { computeForecast, pickBestWindow } from "../src/lib/forecast";
import { computeStackVerdict } from "../src/lib/stack";
import type { MarketSnapshot } from "../src/lib/market";

const snap: MarketSnapshot = {
  btcPrice: 95000, btcVol30d: 55,
  fearGreed: 30, fearGreedLabel: "Fear",
  treasuries: [],
  mvrv: 1.4, puell: 1.0, fundingRate: -0.0001,
  hourlyCloses: null, hourlyTimestamps: null,
  blockHeight: 877432,
  asOf: new Date().toISOString(), source: "test",
};
const verdict = computeStackVerdict(snap);
const cells = computeForecast(snap, verdict);

let pass = 0, fail = 0;
function assert(label: string, cond: boolean) {
  if (cond) { pass++; console.log("PASS  " + label); }
  else { fail++; console.log("FAIL  " + label); }
}

assert("forecast has 168 cells", cells.length === 168);
assert("each cell has score 0-100",
  cells.every((c) => c.score >= 0 && c.score <= 100 && Number.isInteger(c.score)));
assert("exactly one cell isCurrent",
  cells.filter((c) => c.isCurrent).length === 1);
assert("each cell has valid etHour 0-23",
  cells.every((c) => c.etHour >= 0 && c.etHour <= 23));
assert("each cell has utcDate string",
  cells.every((c) => typeof c.utcDate === "string" && c.utcDate.length === 10));

const bw = pickBestWindow(cells);
assert("bestWindow is non-null", bw !== null);
assert("bestWindow label includes 'ET'", bw !== null && bw.label.includes("ET"));
assert("bestWindow dow 0-6", bw !== null && bw.dayOfWeek >= 0 && bw.dayOfWeek <= 6);
assert("bestWindow hour 0-23", bw !== null && bw.hourLocalET >= 0 && bw.hourLocalET <= 23);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
