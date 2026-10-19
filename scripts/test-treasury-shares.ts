// Run: npx tsx scripts/test-treasury-shares.ts
//
// Unit tests for lib/treasury-shares.ts · the filing-sourced share-count
// override that corrects bitcointreasuries.net market caps for
// fast-diluting names (ASST, MPJPY) and the staleness drift guard. Pure
// assert harness (same shape as check-ticker-consistency.ts).

import {
  resolveTreasuryMarketCapM,
  SHARE_COUNTS,
} from "../src/lib/treasury-shares";

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
const near = (a: number | null, b: number, eps = 1e-6) =>
  a != null && Math.abs(a - b) <= eps;

console.log("\n📊 treasury-shares.ts unit tests\n");

// 1 · No override (MSTR, XXI) → feed market cap returned untouched.
if (resolveTreasuryMarketCapM("MSTR", 43635.87, 124.255) === 43635.87) {
  ok("MSTR (no override) passes the feed market cap through");
} else {
  bad("MSTR should return the feed value untouched");
}
if (resolveTreasuryMarketCapM("XXI", 1982.26, 5.72) === 1982.26) {
  ok("XXI (no override) passes the feed market cap through");
} else {
  bad("XXI should return the feed value untouched");
}

// 2 · Override (ASST, MPJPY) → sharesM × price, ignoring the feed value.
const asst = SHARE_COUNTS.ASST;
const mpjpy = SHARE_COUNTS.MPJPY;
if (!asst || !mpjpy) {
  bad("expected SHARE_COUNTS overrides for ASST and MPJPY");
} else {
  if (asst.sharesM === 94.934558 && asst.asOf === "2026-09-04") {
    ok("ASST share count is the 2026-09-04 8-K effective common");
  } else {
    bad(`ASST share count drifted: ${asst.sharesM} asOf ${asst.asOf}`);
  }
  if (near(resolveTreasuryMarketCapM("ASST", 939, 15.055)!, asst.sharesM * 15.055)) {
    ok("ASST overrides the stale feed with shares × price");
  } else {
    bad("ASST override should equal sharesM × price");
  }
  if (near(resolveTreasuryMarketCapM("MPJPY", 1722.87, 1.51)!, mpjpy.sharesM * 1.51)) {
    ok("MPJPY overrides the stale feed with shares × price");
  } else {
    bad("MPJPY override should equal sharesM × price");
  }

  // 3 · price null → cannot apply override → feed value returned.
  if (resolveTreasuryMarketCapM("ASST", 939, null) === 939) {
    ok("ASST with null price falls back to the feed value");
  } else {
    bad("ASST should fall back to the feed when price is null");
  }

  // 4 · feed null but override + price present → override still applies.
  if (near(resolveTreasuryMarketCapM("ASST", null, 15.055)!, asst.sharesM * 15.055)) {
    ok("ASST override applies even when the feed value is null");
  } else {
    bad("ASST override should apply with a null feed value");
  }

  // 5 · Drift guard warns ONLY when the feed implies MORE shares than our
  //     dated constant (the signal that the constant has gone stale).
  {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => {
      warns.push(a.map(String).join(" "));
    };
    // feed implies 100M shares (1500/15) > ASST 94.93M × 1.05 → should warn
    resolveTreasuryMarketCapM("ASST", 1500, 15);
    // feed implies ~62.6M shares (939/15) < threshold → should NOT warn
    resolveTreasuryMarketCapM("ASST", 939, 15);
    console.warn = orig;
    const fired = warns.filter((w) => w.includes("ASST")).length;
    if (fired === 1) {
      ok("drift guard fires only when the feed overtakes the constant");
    } else {
      bad(`drift guard fired ${fired}x (expected 1): ${warns.join(" | ")}`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
