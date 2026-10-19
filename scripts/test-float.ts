// Unit tests for /float page math libraries. Same pattern as
// scripts/test-stack.ts · runnable via `npx tsx scripts/test-float.ts`.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  HALVING_INTERVAL,
  TOTAL_BTC_SUPPLY,
  blockSubsidyAt,
  minedSupplyAt,
  yetToMineAt,
  nextHalvingHeight,
  daysUntilNextHalving,
  HALVING_SCHEDULE,
} from "../src/lib/bitcoin-supply";

let pass = 0;
let fail = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` · ${detail}` : ""}`);
  }
}

console.log("\n── bitcoin-supply.ts ─────────────────────────────");

// Constants
assert("HALVING_INTERVAL = 210000", HALVING_INTERVAL === 210_000);
assert("TOTAL_BTC_SUPPLY = 21M", TOTAL_BTC_SUPPLY === 21_000_000);

// Block subsidy at known halvings
assert("subsidy pre-halving #1 = 50 BTC", blockSubsidyAt(0) === 50);
assert("subsidy at last block of era 0 = 50", blockSubsidyAt(209_999) === 50);
assert("subsidy at halving #1 = 25", blockSubsidyAt(210_000) === 25);
assert("subsidy at halving #2 = 12.5", blockSubsidyAt(420_000) === 12.5);
assert("subsidy at halving #3 = 6.25", blockSubsidyAt(630_000) === 6.25);
assert("subsidy at halving #4 (Apr 2024) = 3.125", blockSubsidyAt(840_000) === 3.125);
assert("subsidy at halving #5 (~Apr 2028) = 1.5625", blockSubsidyAt(1_050_000) === 1.5625);

// Mined supply at known checkpoints (round to whole BTC for assertions)
const minedAt840k = minedSupplyAt(840_000);
assert(
  "mined at block 840000 ≈ 19,687,500",
  Math.abs(minedAt840k - 19_687_500) < 1,
  `got ${minedAt840k}`,
);

const minedAt950k = minedSupplyAt(950_000);
// 19,687,500 + (950000 - 840000) * 3.125 = 19,687,500 + 343,750 = 20,031,250
assert(
  "mined at block 950000 ≈ 20,031,250",
  Math.abs(minedAt950k - 20_031_250) < 1,
  `got ${minedAt950k}`,
);

// Yet to mine
assert(
  "yetToMine at 840000 ≈ 1,312,500",
  Math.abs(yetToMineAt(840_000) - (TOTAL_BTC_SUPPLY - 19_687_500)) < 1,
);

// Next halving
assert("next halving after 840000 = 1050000", nextHalvingHeight(840_000) === 1_050_000);
assert("next halving after 840001 = 1050000", nextHalvingHeight(840_001) === 1_050_000);
assert("next halving after 1050000 = 1260000", nextHalvingHeight(1_050_000) === 1_260_000);
assert("nextHalvingHeight(-1) returns first halving (genesis-relative)", nextHalvingHeight(-1) === HALVING_INTERVAL);

// Halving schedule contains expected entries
assert("halving schedule has at least 5 entries", HALVING_SCHEDULE.length >= 5);
assert(
  "4th halving entry has height 840000",
  HALVING_SCHEDULE[3].height === 840_000,
);

// Days until next halving (10-min block average)
const daysToNext = daysUntilNextHalving(950_000);
// (1050000 - 950000) blocks * 10 min / 1440 min per day ≈ 694 days
assert("days until next halving from 950000 ≈ 694", daysToNext >= 690 && daysToNext <= 700, `got ${daysToNext}`);


// ──────────────────────────────────────────────────────────────────
import {
  composeFloatSnapshot,
  computeDailyDelta,
  floatSnapshotImproves,
  isCohortDataPlausible,
  recomputeFromCohorts,
  syntheticHistoricalSnapshot,
  syntheticHistory,
  type FloatSnapshot,
  LOST_BTC_ESTIMATE,
  LTH_BTC_BASELINE,
  EXCHANGE_BTC_BASELINE,
  COHORT_CEILINGS,
} from "../src/lib/float-snapshot";

console.log("\n── float-snapshot.ts ─────────────────────────────");

// composeFloatSnapshot · happy path
const snap1 = composeFloatSnapshot({
  blockHeight: 950_000,
  asOf: "2026-05-11T00:15:00.000Z",
  governmentsBtc: 250_000,
  etfsBtc: 1_200_000,
  publicCompaniesBtc: 750_000,
});
assert("snapshot preserves block height", snap1.blockHeight === 950_000);
assert("snapshot.totalSupply = 21M", snap1.totalSupply === TOTAL_BTC_SUPPLY);
assert(
  "snapshot.minedSupply at 950k correct",
  Math.abs(snap1.minedSupply - 20_031_250) < 1,
);
assert("governments cohort copied", snap1.cohorts.governments === 250_000);
assert("etfs cohort copied", snap1.cohorts.etfs === 1_200_000);
assert("publicCompanies copied", snap1.cohorts.publicCompanies === 750_000);
assert("lost cohort = constant", snap1.cohorts.lost === LOST_BTC_ESTIMATE);
assert(
  "yetToMine = 21M - mined",
  Math.abs(snap1.cohorts.yetToMine - (TOTAL_BTC_SUPPLY - 20_031_250)) < 1,
);
// lthOther = max(0, LTH_BASELINE - (lost + gov + ETFs + publicCo)) ·
// the overlap-adjusted long-term-holder remainder.
const namedCohorts1 = LOST_BTC_ESTIMATE + 250_000 + 1_200_000 + 750_000;
const expectedLthOther = Math.max(0, LTH_BTC_BASELINE - namedCohorts1);
assert(
  `lthOther = max(0, LTH - named) · expected ${expectedLthOther}, got ${snap1.cohorts.lthOther}`,
  Math.abs(snap1.cohorts.lthOther - expectedLthOther) < 1,
);
// inPlay = mined - lost - gov - ETFs - publicCo - lthOther
const expectedInPlay =
  20_031_250 - LOST_BTC_ESTIMATE - 250_000 - 1_200_000 - 750_000 - expectedLthOther;
assert(
  `inPlay computed correctly · expected ${expectedInPlay}, got ${snap1.inPlay}`,
  Math.abs(snap1.inPlay - expectedInPlay) < 1,
);
// Sanity: with LTH ≈ 14M and named cohorts ≈ 5.2M, inPlay should
// be the short-term-holder supply (~5-6M range at this block height).
assert(
  `inPlay is in the "supply willing to sell" range · got ${snap1.inPlay.toLocaleString()}`,
  snap1.inPlay > 1_000_000 && snap1.inPlay < 10_000_000,
);

// All cohorts + inPlay should sum to totalSupply (within rounding) ·
// the 21M cap invariant. The new lthOther cohort is included in the sum.
const sum = snap1.cohorts.lost + (snap1.cohorts.governments ?? 0) + (snap1.cohorts.etfs ?? 0) +
            (snap1.cohorts.publicCompanies ?? 0) + snap1.cohorts.lthOther +
            snap1.cohorts.yetToMine + snap1.inPlay;
assert("all cohorts + inPlay sum to 21M", Math.abs(sum - TOTAL_BTC_SUPPLY) < 1);

// composeFloatSnapshot · graceful with missing cohort (parser failed)
const snap2 = composeFloatSnapshot({
  blockHeight: 950_000,
  asOf: "2026-05-11T00:15:00.000Z",
  governmentsBtc: null, // parser failed for this cohort
  etfsBtc: 1_200_000,
  publicCompaniesBtc: 750_000,
});
assert("missing cohort stays null, not 0", snap2.cohorts.governments === null);
{
  const legacy = recomputeFromCohorts({
    ...snap1,
    partial: true,
    cohorts: { ...snap1.cohorts, publicCompanies: 0 },
  });
  assert(
    "legacy KV 0 + partial recomputes to null, not a fake empty cohort",
    legacy.cohorts.publicCompanies === null,
  );
}
assert("snapshot flagged partial when cohort missing", snap2.partial === true);
// lthOther grows to absorb the missing cohort (LTH baseline is fixed)
assert(
  "lthOther grows when a named cohort goes missing",
  snap2.cohorts.lthOther > snap1.cohorts.lthOther,
);

// composeFloatSnapshot · throws on malformed asOf
let threwOnBadAsOf = false;
try {
  composeFloatSnapshot({
    blockHeight: 950_000,
    asOf: "garbage", // malformed
    governmentsBtc: 250_000,
    etfsBtc: 1_200_000,
    publicCompaniesBtc: 750_000,
  });
} catch {
  threwOnBadAsOf = true;
}
assert("composeFloatSnapshot throws on malformed asOf", threwOnBadAsOf);

// composeFloatSnapshot · all three live cohorts null (worst-case cron failure)
const snap3 = composeFloatSnapshot({
  blockHeight: 950_000,
  asOf: "2026-05-11T00:15:00.000Z",
  governmentsBtc: null,
  etfsBtc: null,
  publicCompaniesBtc: null,
});
assert("all three null cohorts → partial = true", snap3.partial === true);
assert("all three null cohorts → governments = null", snap3.cohorts.governments === null);
assert("all three null cohorts → etfs = null", snap3.cohorts.etfs === null);
assert("all three null cohorts → publicCompanies = null", snap3.cohorts.publicCompanies === null);
// With all three live cohorts null, lthOther = max(0, LTH - lost) and
// inPlay = mined - lost - lthOther = mined - LTH (LTH dominates).
const expectedLthOtherAllNull = Math.max(0, LTH_BTC_BASELINE - LOST_BTC_ESTIMATE);
assert(
  "all three null → lthOther absorbs the LTH baseline minus lost",
  Math.abs(snap3.cohorts.lthOther - expectedLthOtherAllNull) < 1,
);
assert(
  "all three null → inPlay = mined - lost - lthOther (collapses to mined - LTH)",
  Math.abs(snap3.inPlay - (20_031_250 - LOST_BTC_ESTIMATE - expectedLthOtherAllNull)) < 1,
);

// Cohort ceiling clamp (regression guard · 2026-06-13 publicCompanies
// inflation). A reading above the plausible ceiling is clamped AND the
// snapshot is flagged partial so the banner shows + crons skip.
const snapInflated = composeFloatSnapshot({
  blockHeight: 950_000,
  asOf: "2026-05-11T00:15:00.000Z",
  governmentsBtc: 600_000,
  etfsBtc: 1_300_000,
  publicCompaniesBtc: 4_600_000, // the bitcointreasuries parse error
});
assert(
  "implausible publicCompanies is clamped to its ceiling",
  snapInflated.cohorts.publicCompanies === COHORT_CEILINGS.publicCompanies,
);
assert(
  "a clamped cohort flags the snapshot partial",
  snapInflated.partial === true,
);
assert(
  "plausible cohorts pass through unclamped (no false trip)",
  snapInflated.cohorts.governments === 600_000 &&
    snapInflated.cohorts.etfs === 1_300_000,
);
const snapNormal = composeFloatSnapshot({
  blockHeight: 950_000,
  asOf: "2026-05-11T00:15:00.000Z",
  governmentsBtc: 600_000,
  etfsBtc: 1_300_000,
  publicCompaniesBtc: 1_200_000,
});
assert(
  "all-plausible cohorts → not partial",
  snapNormal.partial === false,
);

// Pathological cohort input · the clamp now catches it BEFORE it can
// overflow the model (gov 50M → ceiling), so the snapshot stays sane
// and flagged partial. inPlay + lthOther both stay non-negative.
const snapHuge = composeFloatSnapshot({
  blockHeight: 950_000,
  asOf: "2026-05-11T00:15:00.000Z",
  governmentsBtc: 50_000_000, // pathological
  etfsBtc: 1_200_000,
  publicCompaniesBtc: 750_000,
});
assert("pathological governments clamps to its ceiling", snapHuge.cohorts.governments === COHORT_CEILINGS.governments);
assert("pathological input flags partial", snapHuge.partial === true);

{
  const day = "2026-09-22T00:15:00.000Z";
  const partialDay = composeFloatSnapshot({
    blockHeight: 950_000,
    asOf: day,
    governmentsBtc: null,
    etfsBtc: null,
    publicCompaniesBtc: 1_059_000,
  });
  const completeDay = composeFloatSnapshot({
    blockHeight: 950_000,
    asOf: "2026-09-22T18:00:00.000Z",
    governmentsBtc: 629_000,
    etfsBtc: 1_440_000,
    publicCompaniesBtc: 1_059_000,
  });
  const stillPartial = composeFloatSnapshot({
    blockHeight: 950_000,
    asOf: "2026-09-22T18:00:00.000Z",
    governmentsBtc: 629_000,
    etfsBtc: null,
    publicCompaniesBtc: 1_059_000,
  });
  const nextDay = composeFloatSnapshot({
    blockHeight: 950_000,
    asOf: "2026-09-23T00:15:00.000Z",
    governmentsBtc: 629_000,
    etfsBtc: 1_440_000,
    publicCompaniesBtc: 1_059_000,
  });
  assert(
    "a complete snapshot may replace the same day's partial row",
    floatSnapshotImproves(partialDay, completeDay),
  );
  assert(
    "a complete row is not rewritten by another complete run",
    !floatSnapshotImproves(completeDay, completeDay),
  );
  assert(
    "a later outage does not replace a complete row",
    !floatSnapshotImproves(completeDay, partialDay),
  );
  assert(
    "a still-partial rerun does not replace a partial row",
    !floatSnapshotImproves(partialDay, stillPartial),
  );
  assert(
    "a different UTC day is not an in-place replacement",
    !floatSnapshotImproves(partialDay, nextDay),
  );
  const route = readFileSync(
    join(process.cwd(), "src", "app", "api", "cron", "snapshot-float", "route.ts"),
    "utf8",
  );
  assert(
    "snapshot-float replaces a partial day in place",
    /floatSnapshotImproves/.test(route) &&
      /kvListSet\(HISTORY_KEY, 0, snapshot\)/.test(route) &&
      !/LPUSH on top of today's/.test(route),
  );
}
assert("inPlay floors at 0 under pathological inputs", snapHuge.inPlay >= 0);
assert("lthOther stays non-negative under pathological inputs", snapHuge.cohorts.lthOther >= 0);

// LTH/EXCHANGE constants have plausibility tests so an accidental edit is caught
assert("LTH baseline is positive and < 21M", LTH_BTC_BASELINE > 0 && LTH_BTC_BASELINE < 21_000_000);
assert("Exchange baseline is positive and < 21M", EXCHANGE_BTC_BASELINE > 0 && EXCHANGE_BTC_BASELINE < 21_000_000);

// recomputeFromCohorts · idempotent on a fresh snapshot
const recomp = recomputeFromCohorts(snap1);
assert(
  "recomputeFromCohorts is idempotent · inPlay matches",
  Math.abs(recomp.inPlay - snap1.inPlay) < 1,
);
assert(
  "recomputeFromCohorts is idempotent · lthOther matches",
  Math.abs(recomp.cohorts.lthOther - snap1.cohorts.lthOther) < 1,
);
// Simulate a legacy snapshot that lacks lthOther (pre-May-2026 KV
// entry). recomputeFromCohorts should fill it in and tighten inPlay.
const legacySnap = {
  ...snap1,
  inPlay: snap1.minedSupply - LOST_BTC_ESTIMATE - 250_000 - 1_200_000 - 750_000,
  cohorts: {
    lost: LOST_BTC_ESTIMATE,
    governments: 250_000,
    etfs: 1_200_000,
    publicCompanies: 750_000,
    lthOther: 0,
    yetToMine: snap1.cohorts.yetToMine,
  },
} as FloatSnapshot;
const fixedLegacy = recomputeFromCohorts(legacySnap);
assert(
  "recomputeFromCohorts retroactively tightens legacy inPlay",
  fixedLegacy.inPlay < legacySnap.inPlay,
);
assert(
  "recomputeFromCohorts retroactively populates lthOther on legacy snapshot",
  fixedLegacy.cohorts.lthOther > 0,
);

// computeDailyDelta · simple subtraction
const yesterday: FloatSnapshot = { ...snap1, inPlay: snap1.inPlay + 1247 };
const delta = computeDailyDelta(snap1, yesterday);
assert(`delta = today - yesterday = -1247, got ${delta}`, delta === -1247);

// computeDailyDelta · no prior snapshot
const deltaNull = computeDailyDelta(snap1, null);
assert("delta is null when no prior snapshot", deltaNull === null);

// ── synthetic historical backfill ─────────────────────────────────
// These tests guard the chart's "from inception" curve · regressions
// here surface as wonky shapes on the live /float page.

console.log("\n── synthetic history (chart backfill) ────────────");

const todayCohorts = { governments: 600_000, etfs: 1_500_000, publicCompanies: 1_600_000 };
const todayDate = "2026-05-14";

// Genesis snapshot · everything is yet-to-mine, nothing in any cohort.
const genesis = syntheticHistoricalSnapshot("2009-01-03", todayCohorts, todayDate);
assert("genesis · minedSupply ≈ 0", genesis.minedSupply < 100);
assert(
  `genesis · yetToMine ≈ 21M (got ${genesis.cohorts.yetToMine.toLocaleString()})`,
  Math.abs(genesis.cohorts.yetToMine - 21_000_000) < 100,
);
assert("genesis · all named cohorts = 0 (pre-launch)", genesis.cohorts.governments === 0 && genesis.cohorts.etfs === 0 && genesis.cohorts.publicCompanies === 0);
assert("genesis · inPlay = 0 (nothing mined yet)", genesis.inPlay === 0);
// Available = inPlay + yetToMine should = total supply at genesis
const genesisAvailable = genesis.inPlay + genesis.cohorts.yetToMine;
assert(
  `genesis · available ≈ 21M (got ${genesisAvailable.toLocaleString()})`,
  Math.abs(genesisAvailable - 21_000_000) < 100,
);

// Today's anchor · should match the live "supply willing to sell" math.
const today = syntheticHistoricalSnapshot(todayDate, todayCohorts, todayDate);
const todayAvailable = today.inPlay + today.cohorts.yetToMine;
assert(
  `today · available is in 5-10M range (got ${todayAvailable.toLocaleString()})`,
  todayAvailable > 5_000_000 && todayAvailable < 10_000_000,
);

// Pre-MSTR date · publicCompanies should be 0
const preCorporate = syntheticHistoricalSnapshot("2020-08-10", todayCohorts, todayDate);
assert(
  "publicCompanies = 0 the day before MSTR's first buy (2020-08-11)",
  preCorporate.cohorts.publicCompanies === 0,
);

// Pre-ETF date · etfs should be 0
const preEtf = syntheticHistoricalSnapshot("2024-01-10", todayCohorts, todayDate);
assert(
  "etfs = 0 the day before spot ETF launch (2024-01-11)",
  preEtf.cohorts.etfs === 0,
);

// Available curve should be MONOTONIC decreasing from genesis to today.
// This is the user-facing expectation: "steady downward progression."
const history = syntheticHistory(todayCohorts, todayDate);
// History is newest-first; reverse for chronological walk.
const chronological = [...history].reverse();
const availables = chronological.map(s => s.inPlay + s.cohorts.yetToMine);
let monotonic = true;
let firstViolation = -1;
for (let i = 1; i < availables.length; i++) {
  // Allow tiny float rounding tolerance (1 BTC).
  if (availables[i] > availables[i - 1] + 1) {
    monotonic = false;
    firstViolation = i;
    break;
  }
}
assert(
  `available curve is monotonically non-increasing genesis → today${
    !monotonic ? ` · violation at index ${firstViolation}: ${chronological[firstViolation].date}` : ""
  }`,
  monotonic,
);
assert(
  `synthetic history starts near 21M (genesis: ${availables[0].toLocaleString()})`,
  Math.abs(availables[0] - 21_000_000) < 1000,
);
assert(
  `synthetic history ends near today's value (last: ${availables[availables.length - 1].toLocaleString()})`,
  availables[availables.length - 1] < 10_000_000,
);

// History should have a sane number of points (monthly samples over ~17 years)
assert(
  `synthetic history has reasonable density (got ${history.length} points)`,
  history.length > 150 && history.length < 250,
);

// ── plausibility filter ──────────────────────────────────────────
const goodSnapshot = composeFloatSnapshot({
  blockHeight: 950_000,
  asOf: "2026-05-11T00:15:00.000Z",
  governmentsBtc: 600_000,
  etfsBtc: 1_500_000,
  publicCompaniesBtc: 1_600_000,
});
assert("plausibility filter accepts a clean snapshot", isCohortDataPlausible(goodSnapshot));

// Simulate a corrupt KV snapshot · cohort in billions (real-world
// failure mode from bitcointreasuries.net devalue parser).
const corruptSnapshot: FloatSnapshot = {
  ...goodSnapshot,
  cohorts: { ...goodSnapshot.cohorts, etfs: 3_714_616_023 },
};
assert(
  "plausibility filter rejects cohort with >21M BTC (corrupt parse)",
  !isCohortDataPlausible(corruptSnapshot),
);
const negativeSnapshot: FloatSnapshot = {
  ...goodSnapshot,
  cohorts: { ...goodSnapshot.cohorts, governments: -1000 },
};
assert(
  "plausibility filter rejects negative cohort value",
  !isCohortDataPlausible(negativeSnapshot),
);

// market.ts smoke test · just verify the function is exported (we
// don't hit the network in tests · the cron runs the actual fetches).
import { getTreasuryAggregates } from "../src/lib/market";
import { computeSupplyBuckets } from "../src/app/float/components/TwentyOneMillionGrid";

console.log("\n── market.ts getTreasuryAggregates ──────────────");
assert(
  "getTreasuryAggregates is exported as a function",
  typeof getTreasuryAggregates === "function",
);

{
  const og = readFileSync(
    join(process.cwd(), "src/app/api/og/float/route.tsx"),
    "utf8",
  );
  assert("float OG fails closed without a history match", og.includes("if (!snapshot)"));
  assert("float OG no longer mints the hardcoded baseline", !og.includes("fallbackSnapshot"));
  assert("float OG names the honest empty state", og.includes("float syncing"));
}

{
  const known = computeSupplyBuckets(goodSnapshot);
  assert("trackedKnown when every live cohort is a number", known.trackedKnown === true);
  const withheld = computeSupplyBuckets(snap3);
  assert(
    "trackedKnown false when live cohorts are withheld",
    withheld.trackedKnown === false,
  );
  assert(
    "withheld tracked sum is 0 for residual math, never quoted as a reading",
    withheld.tracked === 0,
  );
}

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
