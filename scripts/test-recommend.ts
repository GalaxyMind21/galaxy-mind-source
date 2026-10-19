import { recommend, RecommendInput } from "../src/lib/recommend";

const cases: {
  input: RecommendInput;
  expectedPrimary: string | string[];
  label: string;
  expectIncludes?: string[];
  expectExcludes?: string[];
}[] = [
  {
    input: { horizonYears: 3, volatilityTolerance: 1, accountType: "taxable" },
    expectedPrimary: "STRC",
    label: "Short + Minimal + Taxable (Sharpe-optimal: STRC + SATA only)",
    expectIncludes: ["STRC", "SATA"],
    expectExcludes: ["MSTR", "MSTU", "BITX", "STRK", "STRF", "BTC", "MSBT"],
  },
  {
    input: { horizonYears: 10, volatilityTolerance: 5, accountType: "taxable" },
    expectedPrimary: "MSTR",
    label: "Long + Maxi + Taxable",
    expectIncludes: ["MSTR", "BTC"],
    expectExcludes: ["MSTU", "MSTX", "MST"], // Maxi shouldn't unlock 2x
  },
  {
    input: { horizonYears: 10, volatilityTolerance: 6, accountType: "taxable" },
    expectedPrimary: "MSTR",
    label: "Long + Ludicrous + Taxable (unlocks 2x)",
    expectIncludes: ["MSTR", "MSTX"],
  },
  {
    input: { horizonYears: 1, volatilityTolerance: 6, accountType: "taxable" },
    expectedPrimary: ["MSTX", "MSTY"],
    label: "Very Short + Ludicrous + Taxable (heavy 2x slot)",
    expectIncludes: ["MSTX"],
  },
  {
    input: { horizonYears: 10, volatilityTolerance: 5, accountType: "roth" },
    expectedPrimary: "MSTR",
    label: "Long + Maxi + Roth",
    expectIncludes: ["MSTR", "MSBT"],
  },
  {
    input: { horizonYears: 20, volatilityTolerance: 3, accountType: "roth" },
    expectedPrimary: ["MSTR", "MSBT"],
    label: "Generational + Moderate + Roth",
    expectIncludes: ["MSBT"],
  },
  {
    input: { horizonYears: 2, volatilityTolerance: 3, accountType: "taxable" },
    expectedPrimary: ["STRD", "STRK", "SATA"],
    label: "Short + Moderate + Taxable",
    expectIncludes: ["STRK", "SATA"],
    expectExcludes: ["MSTR"],
  },
  {
    input: { horizonYears: 1, volatilityTolerance: 4, accountType: "taxable" },
    expectedPrimary: ["MSTY", "STRD", "STRK"],
    label: "Very Short + High + Taxable",
    expectIncludes: ["MSTY"],
  },
  // mNAV adjustment
  {
    input: {
      horizonYears: 10,
      volatilityTolerance: 5,
      accountType: "taxable",
      mNAVByTicker: { MSTR: 2.4 },
    },
    expectedPrimary: ["MSTR", "BTC"],
    label: "Long + Maxi + RICH mNAV (BTC rises vs MSTR)",
    expectIncludes: ["BTC"],
  },
  {
    input: {
      horizonYears: 10,
      volatilityTolerance: 5,
      accountType: "taxable",
      mNAVByTicker: { MSTR: 0.95 },
    },
    expectedPrimary: "MSTR",
    label: "Long + Maxi + COMPRESSED mNAV (caveat triggers)",
    expectIncludes: ["MSTR"],
  },
  // Fear & Greed signal
  {
    input: {
      horizonYears: 10,
      volatilityTolerance: 5,
      accountType: "taxable",
      fearGreed: 88,
    },
    expectedPrimary: ["MSTR", "BTC"],
    label: "Maxi + Extreme Greed (engine trims leverage)",
    expectIncludes: ["BTC"],
  },
  {
    input: {
      horizonYears: 10,
      volatilityTolerance: 4,
      accountType: "taxable",
      fearGreed: 12,
    },
    expectedPrimary: "MSTR",
    label: "High + Extreme Fear (engine tilts to MSTR)",
    expectIncludes: ["MSTR"],
  },
  // BTC vol signal
  {
    input: {
      horizonYears: 1,
      volatilityTolerance: 6,
      accountType: "taxable",
      btcVol30d: 95,
    },
    expectedPrimary: ["MSTR", "MSTX", "MSTY"],
    label: "Short + Ludicrous + EXTREME vol (2x sleeve halved)",
    expectIncludes: [],
  },
];

let pass = 0,
  fail = 0;
for (const c of cases) {
  const r = recommend(c.input);
  const expected = Array.isArray(c.expectedPrimary)
    ? c.expectedPrimary
    : [c.expectedPrimary];
  let ok = expected.includes(r.primary.ticker);
  const tickers = r.allocation.map((s) => s.asset.ticker);
  if (c.expectIncludes) {
    for (const t of c.expectIncludes) if (!tickers.includes(t)) ok = false;
  }
  if (c.expectExcludes) {
    for (const t of c.expectExcludes) if (tickers.includes(t)) ok = false;
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.label}`);
  console.log(
    `      alloc=${r.allocation.map((s) => `${s.asset.ticker}:${(s.weight * 100).toFixed(0)}%`).join(" ")}`,
  );
  if (!ok) {
    console.log(
      `      expected primary=${expected.join("|")} got=${r.primary.ticker}`,
    );
    if (c.expectIncludes)
      console.log(
        `      expectIncludes=${c.expectIncludes.join(",")} present=${tickers.join(",")}`,
      );
    if (c.expectExcludes)
      console.log(
        `      expectExcludes=${c.expectExcludes.join(",")} present=${tickers.filter((t) => c.expectExcludes!.includes(t)).join(",")}`,
      );
  }
  if (r.caveats.length)
    console.log(`      caveats(${r.caveats.length}): ${r.caveats[0].slice(0, 80)}…`);
  ok ? pass++ : fail++;
}

// ----------------------------------------------------------------------
// Monotonicity property test: expected annualized return must be
// non-decreasing as tolerance level rises, holding (horizon, account) fixed.
// "Volatility tolerance is positively correlated with expected return."
// ----------------------------------------------------------------------
console.log("\n--- monotonicity: tolerance ↑ ⇒ expected return ↑ ---");
let monoPass = 0,
  monoFail = 0;
const HORIZONS = [1, 3, 5, 10, 20];
const ACCOUNTS: ("taxable" | "traditional" | "roth")[] = [
  "taxable",
  "traditional",
  "roth",
];
for (const h of HORIZONS) {
  for (const a of ACCOUNTS) {
    const series: { t: number; ann: number }[] = [];
    for (let t = 1; t <= 6; t++) {
      const r = recommend({
        horizonYears: h,
        volatilityTolerance: t as 1 | 2 | 3 | 4 | 5 | 6,
        accountType: a,
      });
      series.push({ t, ann: r.expectedReturn.annualCentral });
    }
    let monotonic = true;
    for (let i = 1; i < series.length; i++) {
      // Allow tiny float noise (≤ 0.001) but never a real drop
      if (series[i].ann < series[i - 1].ann - 0.001) {
        monotonic = false;
        break;
      }
    }
    const fmt = series
      .map((s) => `t${s.t}:${(s.ann * 100).toFixed(1)}%`)
      .join("  ");
    console.log(
      `${monotonic ? "PASS" : "FAIL"}  h=${h}y ${a.padEnd(11)} ${fmt}`,
    );
    monotonic ? monoPass++ : monoFail++;
  }
}
console.log(
  `\nallocation: ${pass}/${pass + fail} | monotonicity: ${monoPass}/${monoPass + monoFail}`,
);
process.exit(fail + monoFail > 0 ? 1 : 0);
