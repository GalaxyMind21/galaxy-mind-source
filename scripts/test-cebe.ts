// Run: npx tsx scripts/test-cebe.ts
//
// Unit tests for lib/cebe.ts · the CEBE / BPS / Amplification math that
// feeds the /treasuries net-mNAV view, the MCP get_treasuries tool, and
// the per-ticker pages. Pure-assert harness (same shape as
// check-ticker-consistency.ts). Constructs synthetic Quotes and checks
// the arithmetic + the pending-vs-available branching.

import { computeCebe, SENIOR_CLAIMS } from "../src/lib/cebe";
import type { Quote } from "../src/lib/market";

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

const q = (
  ticker: Quote["ticker"],
  price: number | null,
  marketCapM: number | null,
  btcHoldings: number | null,
): Quote => ({ ticker, price, marketCapM, btcHoldings, mNAV: null });

const BTC = 64090;
// MSTR senior claims per lib/cebe.ts: debt 6700 + preferred 15500 − cash 0.
// DERIVED, not copied. This was a hardcoded 22200 and the 2026-09-11
// refresh to the Q2 10-Q figures ($6,713.7M converts + $15,462.1M
// preferred) broke two assertions that had nothing wrong with them —
// the test was pinning an INPUT it had duplicated, not the maths it
// exists to check. Reading the same constant the code reads keeps those
// assertions about the EV / amplification FORMULAS, which is the point.
// Staleness of the components themselves is check-constant-freshness's
// job, not this file's.
const mstrClaims = SENIOR_CLAIMS.MSTR!;
const MSTR_CLAIMS_USD_M =
  mstrClaims.debtUsdM + mstrClaims.preferredUsdM - mstrClaims.cashUsdM;

console.log("\n📊 cebe.ts unit tests\n");

// 1 · Gross BPS is available even when CEBE is pending (MPJPY has no
//     SENIOR_CLAIMS entry · senior-claims data not sourced yet).
{
  const c = computeCebe(q("MPJPY", 1.51, 1934, 40177), BTC);
  if (
    !c.available &&
    c.cebeSatsPer100 === null &&
    c.amplificationRatio === null &&
    near(c.grossSatsPer100, (40177 * 10000) / 1934, 1)
  ) {
    ok("MPJPY: gross BPS computed while CEBE (net) stays pending");
  } else {
    bad(`MPJPY pending shape wrong: ${JSON.stringify(c)}`);
  }
}

// 2 · grossSatsPer100 (BPS) = holdings × 1e4 / marketCapM.
{
  const c = computeCebe(q("MSTR", 124.255, 43635.87, 845256), BTC);
  if (near(c.grossSatsPer100, (845256 * 10000) / 43635.87, 0.5)) {
    ok("BPS formula: holdings × 1e4 / marketCapM");
  } else {
    bad(`BPS formula off: got ${c.grossSatsPer100}`);
  }
}

// 3 · Amplification == BPS / CEBE BPS == holdings / (holdings − claims-in-BTC).
{
  const c = computeCebe(q("MSTR", 124.255, 43635.87, 845256), BTC);
  const claimsBtc = (MSTR_CLAIMS_USD_M * 1e6) / BTC;
  const expected = 845256 / (845256 - claimsBtc);
  if (
    c.amplificationRatio != null &&
    c.grossSatsPer100 != null &&
    c.cebeSatsPer100 != null &&
    near(c.amplificationRatio, c.grossSatsPer100 / c.cebeSatsPer100, 1e-6) &&
    near(c.amplificationRatio, expected, 1e-3) &&
    c.amplificationRatio > 1
  ) {
    ok(
      `Amplification == BPS/CEBE BPS == holdings/(holdings−claimsBtc) (${c.amplificationRatio.toFixed(
        3,
      )}x)`,
    );
  } else {
    bad(`Amplification mismatch: ${JSON.stringify(c)} expected≈${expected}`);
  }
}

// 4 · netMNav (and amplification) null when senior claims ≥ BTC value.
{
  const c = computeCebe(q("MSTR", 100, 1000, 1), BTC); // 1 BTC ≪ $18.5B claims
  if (c.available && c.netMNav === null && c.amplificationRatio === null) {
    ok("netMNav + amplification null when claims ≥ BTC value");
  } else {
    bad(`underwater-claims shape wrong: ${JSON.stringify(c)}`);
  }
}

// 5 · price null → CEBE pending, but gross BPS still computed.
{
  const c = computeCebe(q("MSTR", null, 43635.87, 845256), BTC);
  if (
    !c.available &&
    c.cebeSatsPer100 === null &&
    near(c.grossSatsPer100, (845256 * 10000) / 43635.87, 0.5)
  ) {
    ok("price null → CEBE pending, gross BPS still present");
  } else {
    bad(`price-null shape wrong: ${JSON.stringify(c)}`);
  }
}

// 6 · EV / fully-diluted mNAV = (market cap + claims) / BTC value, > gross.
{
  const c = computeCebe(q("MSTR", 124.255, 43635.87, 845256), BTC);
  const btcValueM = (845256 * BTC) / 1e6;
  const grossMnav = 43635.87 / btcValueM;
  const expectedEv = (43635.87 + MSTR_CLAIMS_USD_M) / btcValueM;
  if (near(c.evMNav, expectedEv, 1e-6) && c.evMNav != null && c.evMNav > grossMnav) {
    ok(`EV mNAV == (mktcap + claims)/btcValue and > gross (${c.evMNav.toFixed(3)}x)`);
  } else {
    bad(`EV mNAV wrong: got ${c.evMNav} expected ${expectedEv}`);
  }
}

// 7 · EV mNAV is null when CEBE is pending (no claims · MPJPY).
{
  const c = computeCebe(q("MPJPY", 1.51, 1934, 40177), BTC);
  if (c.evMNav === null) {
    ok("EV mNAV null when CEBE pending (MPJPY)");
  } else {
    bad(`EV mNAV should be null when pending: ${c.evMNav}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
