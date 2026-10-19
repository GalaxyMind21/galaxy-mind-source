import { ASSETS_BY_TICKER, Asset } from "./assets";

export type AccountType = "taxable" | "traditional" | "roth";
export type Tolerance = 1 | 2 | 3 | 4 | 5 | 6;

export type MarketSignals = {
  // mNAV by ticker (MSTR's mNAV is the primary engine signal).
  mNAVByTicker?: Record<string, number | null | undefined>;
  // Crypto Fear & Greed index 0–100. Null when fetch fails.
  fearGreed?: number | null;
  // BTC 30-day realized volatility, annualized %. Null when unknown.
  btcVol30d?: number | null;
};

export type RecommendInput = {
  horizonYears: number;
  volatilityTolerance: Tolerance;
  accountType: AccountType;
} & MarketSignals;

export type SleeveRole =
  | "core_btc"
  | "leveraged_eq"
  | "treasury_diversifier"
  | "treasury_diversifier_2"  // 2nd-cheapest treasury · top tolerance + long horizon
  | "income_low_vol"        // STRC · variable rate, ~par. vol score 2
  | "income_fixed"          // STRF · 10% fixed perpetual. vol score 2
  | "income_high_yield"     // STRD · 11–13%, more swing. vol score 3
  | "income_hybrid"         // STRK · convertible. vol score 5 (NOT for Minimal!)
  | "preferred_diversifier" // SATA · Strive issuer 13%. vol score 3
  | "deriv_income"          // MSTY · covered call on MSTR
  | "speculative"
  | "ludicrous_lev";

export type Sleeve = {
  role: SleeveRole;
  asset: Asset;
  weight: number;
  rationale: string;
};

// Risk-free rate used for Sharpe (3-month Treasury, mid-2026 ~4.3%). Update
// periodically; doesn't have to be live since Sharpe is robust to small
// shifts here.
export const RISK_FREE_RATE = 0.043;

export type ExpectedReturn = {
  // Annualized values (decimal: 0.22 = 22%/yr)
  annualCentral: number;
  annualLow: number;
  annualHigh: number;
  // Compounded over the user's horizon. Multiplier (1.0 = no change,
  // 2.0 = doubled).
  totalCentral: number;
  totalLow: number;
  totalHigh: number;
  // Per-sleeve contribution to the central annual return — useful for the
  // "how was this calculated" breakdown.
  contributions: { ticker: string; weight: number; expected: number; contribution: number }[];
  // Risk metrics. Portfolio volatility uses the conservative
  // weighted-average-of-sigmas (assumes 100% correlation across sleeves) —
  // this is an UPPER BOUND on actual portfolio vol but never understates
  // risk, which is the right bias for a tool warning users about drawdowns.
  portfolioVolatility: number;
  sharpeRatio: number; // (return - rf) / vol
};

export type Recommendation = {
  primary: Asset;
  allocation: Sleeve[];
  portfolioRationale: string;
  avoid: [Asset, Asset];
  caveats: string[];
  expectedReturn: ExpectedReturn;
};

// Portfolio expected return = weighted average of per-asset expected returns.
// Compounded over horizon for the total. Range bands are also weighted —
// this assumes asset returns are perfectly correlated for the band, which is
// CONSERVATIVE on the upside (in practice, diversification narrows the band)
// and AGGRESSIVE on the downside. We accept that simplification here because
// estimating cross-asset correlation honestly would require historical
// covariance matrices, and our short windows (some assets have <1y history)
// can't support that without overfitting to one regime.
export function computeExpectedReturn(
  allocation: Sleeve[],
  horizonYears: number,
): ExpectedReturn {
  let annualCentral = 0;
  let annualLow = 0;
  let annualHigh = 0;
  const contributions: ExpectedReturn["contributions"] = [];

  for (const s of allocation) {
    const er = s.asset.expectedAnnualReturn;
    const [lo, hi] = s.asset.expectedReturnRange;
    annualCentral += s.weight * er;
    annualLow += s.weight * lo;
    annualHigh += s.weight * hi;
    contributions.push({
      ticker: s.asset.ticker,
      weight: s.weight,
      expected: er,
      contribution: s.weight * er,
    });
  }

  // Compound over horizon. (1 + r)^h - 1 in decimal terms.
  const totalCentral = Math.pow(1 + annualCentral, horizonYears) - 1;
  const totalLow = Math.pow(1 + annualLow, horizonYears) - 1;
  const totalHigh = Math.pow(1 + annualHigh, horizonYears) - 1;

  // Portfolio volatility — weighted average (100%-correlation upper bound).
  // See ExpectedReturn type comment for why we use this construction.
  let portfolioVolatility = 0;
  for (const s of allocation) {
    portfolioVolatility += s.weight * s.asset.expectedVolatility;
  }

  const sharpeRatio =
    portfolioVolatility > 0
      ? (annualCentral - RISK_FREE_RATE) / portfolioVolatility
      : 0;

  return {
    annualCentral,
    annualLow,
    annualHigh,
    totalCentral,
    totalLow,
    totalHigh,
    contributions,
    portfolioVolatility,
    sharpeRatio,
  };
}

export const TOLERANCE_LABELS: Record<Tolerance, string> = {
  1: "Minimal",
  2: "Low",
  3: "Moderate",
  4: "High",
  5: "Maxi",
  6: "Ludicrous",
};

// Rank the treasury-equity diversifier candidates cheapest-mNAV-first.
// Known mNAVs sort ascending (cheapest premium = most BTC-per-dollar of
// accretion); candidates with no live mNAV fall to the back in their
// declared order, so the ranking is fully deterministic even with no
// signals at all (→ MPJPY, XXI, ASST). The single-name diversifier reads
// index 0; the Maxi + long-horizon split reads index 0 and 1, which the
// stable ordering guarantees are two DISTINCT issuers.
function rankTreasuriesByMNAV(
  candidates: readonly string[],
  signals?: MarketSignals,
): { ticker: string; mNAV: number | null }[] {
  const mNAVs = signals?.mNAVByTicker;
  const known: { ticker: string; mNAV: number }[] = [];
  const unknown: string[] = [];
  for (const t of candidates) {
    const m = mNAVs?.[t];
    if (typeof m === "number" && isFinite(m) && m > 0) {
      known.push({ ticker: t, mNAV: m });
    } else {
      unknown.push(t);
    }
  }
  known.sort((a, b) => a.mNAV - b.mNAV);
  return [
    ...known.map((x) => ({ ticker: x.ticker, mNAV: x.mNAV as number | null })),
    ...unknown.map((t) => ({ ticker: t, mNAV: null as number | null })),
  ];
}

// The diversifier candidate set · single source of truth so the picker,
// the weight split, and the rationale annotation can never drift apart.
const TREASURY_DIVERSIFIERS = ["MPJPY", "XXI", "ASST"] as const;

function pickAssetForRole(
  role: SleeveRole,
  account: AccountType,
  signals?: MarketSignals,
): Asset | null {
  switch (role) {
    case "core_btc":
      // Non-taxable (IRA/401k/Roth) spot-BTC wrapper · MSBT, not IBIT.
      // MSBT is the same spot-BTC exposure at a 0.14% fee vs IBIT's
      // 0.25% · strictly lower drag, so it dominates IBIT as the
      // retirement-account wrapper at every horizon (operator
      // directive 2026-05-16). Taxable still self-custodies BTC.
      return account === "taxable"
        ? ASSETS_BY_TICKER.BTC
        : ASSETS_BY_TICKER.MSBT;
    case "leveraged_eq":
      return ASSETS_BY_TICKER.MSTR;
    case "treasury_diversifier": {
      const ranked = rankTreasuriesByMNAV(TREASURY_DIVERSIFIERS, signals);
      return ASSETS_BY_TICKER[ranked[0]?.ticker] ?? ASSETS_BY_TICKER.MPJPY;
    }
    case "treasury_diversifier_2": {
      // Second-cheapest issuer · only materializes in the top-tolerance
      // long-horizon split, where a single non-MSTR name is still too
      // much concentration. Distinct from treasury_diversifier by
      // construction (index 1 of the same stable ranking).
      const ranked = rankTreasuriesByMNAV(TREASURY_DIVERSIFIERS, signals);
      return ASSETS_BY_TICKER[ranked[1]?.ticker] ?? ASSETS_BY_TICKER.XXI;
    }
    case "income_low_vol":
      return ASSETS_BY_TICKER.STRC;
    case "income_fixed":
      return ASSETS_BY_TICKER.STRF;
    case "income_high_yield":
      return ASSETS_BY_TICKER.STRD;
    case "income_hybrid":
      return ASSETS_BY_TICKER.STRK;
    case "preferred_diversifier":
      return ASSETS_BY_TICKER.SATA;
    case "deriv_income":
      return ASSETS_BY_TICKER.MSTY;
    case "speculative":
      return ASSETS_BY_TICKER.MSTU;
    case "ludicrous_lev":
      return ASSETS_BY_TICKER.MSTX;
  }
}

const ROLE_RATIONALE: Record<SleeveRole, string> = {
  core_btc:
    "Pure BTC exposure · the base case. No counterparty, no leverage, no decay.",
  leveraged_eq:
    "Treasury-equity beta to BTC. Compounds BTC-per-share when mNAV > 1, lags BTC when premium compresses. Long horizon required for the accretion to dominate path risk.",
  treasury_diversifier:
    "Second treasury issuer to reduce single-name MSTR dependence in the leveraged sleeve.",
  treasury_diversifier_2:
    "Third treasury issuer · at top tolerance over a long horizon the leveraged sleeve spreads across two non-MSTR names so no single treasury company carries the whole bet.",
  income_low_vol:
    "Variable-rate preferred designed to anchor near par. Lowest-vol way to harvest BTC-treasury yield.",
  income_fixed:
    "10% fixed perpetual preferred · predictable coupon, slightly more interest-rate sensitivity than STRC. ROC-eligible.",
  income_high_yield:
    "Higher coupon (10–13%) at the cost of more price swing than STRC/STRF.",
  income_hybrid:
    "STRK earns 8% on $100 par AND converts 10:1 into MSTR at $1,000 · bond-like floor, equity-like upside. The asymmetric pick.",
  preferred_diversifier:
    "Strive-issuer preferred (~13% variable). Reduces single-issuer concentration · the rest of the income sleeve sits inside the MSTR capital stack.",
  deriv_income:
    "Covered-call ETF on MSTR. Headline yield is genuine; principal erodes in flat-or-up markets. Treat distributions as partial return of capital.",
  speculative:
    "2x daily MSTR · daily reset compounds against you in any sideways market. Position as a short-dated directional bet, not a hold.",
  ludicrous_lev:
    "2x daily MSTR via swaps/futures. Same decay structure as MSTU; this is the 'send it' sleeve. Review weekly, size accordingly.",
};

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function rescaleAllExcept(w: Map<SleeveRole, number>, target: number) {
  const sum = Array.from(w.values()).reduce((a, b) => a + b, 0);
  if (sum <= 0) return;
  const k = target / sum;
  for (const [role, weight] of w) w.set(role, weight * k);
}

// Stage 1: compute base sleeve weights from inputs alone (no live signals).
function computeBaseSleeveWeights(
  input: RecommendInput,
): Map<SleeveRole, number> {
  const t = input.volatilityTolerance;
  const h = input.horizonYears;
  const acct = input.accountType;

  // tNorm: 0 (Minimal) .. 1 (Ludicrous)
  const tNorm = (t - 1) / 5;
  const hNorm = Math.min(h, 25) / 25;
  let R = 0.55 * tNorm + 0.45 * hNorm;
  if (acct === "roth") R = Math.min(1, R + 0.07);
  if (acct === "taxable") R = Math.max(0, R - 0.04);

  const w = new Map<SleeveRole, number>();

  // Income block. Tier weights are deliberately graduated to match each
  // tolerance level's actual mandate:
  //   - Minimal/Low: ONLY vol-2 to vol-3 preferreds (STRC, STRF, SATA, STRD).
  //     STRK is excluded entirely — its conversion option to MSTR makes it
  //     vol-5 in practice, which violates the "sleep at night" mandate.
  //   - Moderate: STRK enters as a meaningful "income with kicker" sleeve.
  //   - High+: tiny income carve, mostly STRK for upside; STRC drops away.
  const incomeTotal = clamp(1 - R * 1.15, 0, 1);
  if (incomeTotal > 0.001) {
    if (t === 1) {
      // Sharpe-optimal Minimal blend: STRC (~2% vol) + SATA (~4% vol).
      // STRF (~6% vol) and BTC (~55% vol) are explicitly excluded — they
      // add volatility without proportional return to STRC/SATA, which
      // would hurt the portfolio Sharpe in a tier defined by "lowest vol."
      w.set("income_low_vol", incomeTotal * 0.65);
      w.set("preferred_diversifier", incomeTotal * 0.35);
    } else if (t === 2) {
      // Low: introduce STRF (fixed-rate duration) and STRD (modest higher yield).
      w.set("income_low_vol", incomeTotal * 0.40);
      w.set("income_fixed", incomeTotal * 0.20);
      w.set("income_high_yield", incomeTotal * 0.20);
      w.set("preferred_diversifier", incomeTotal * 0.20);
    } else if (t === 3) {
      // Moderate: STRK now appropriate (user can stomach 30% drawdowns).
      w.set("income_low_vol", incomeTotal * 0.20);
      w.set("income_high_yield", incomeTotal * 0.30);
      w.set("income_hybrid", incomeTotal * 0.30);
      w.set("preferred_diversifier", incomeTotal * 0.20);
    } else {
      // High+: tiny income carve, mostly STRK for the upside kicker.
      w.set("income_high_yield", incomeTotal * 0.45);
      w.set("income_hybrid", incomeTotal * 0.45);
      w.set("preferred_diversifier", incomeTotal * 0.10);
    }
  }

  // Growth block
  // Minimal tolerance: zero out growth entirely + scale income to 100%.
  // Even a 1–2% BTC residual pollutes the Sharpe of an otherwise pristine
  // STRC + SATA portfolio.
  if (t === 1) {
    const sum = Array.from(w.values()).reduce((a, b) => a + b, 0);
    if (sum > 0) for (const [role, weight] of w) w.set(role, weight / sum);
  }
  const growthTotal = t === 1 ? 0 : 1 - incomeTotal;
  if (growthTotal > 0.001) {
    let leverageShare = clamp(0.15 + 0.55 * tNorm + 0.25 * hNorm, 0, 0.85);
    if (t === 5) leverageShare = Math.min(0.92, leverageShare + 0.1);
    if (t === 6) leverageShare = Math.min(0.95, leverageShare + 0.15);

    const leveragedW = growthTotal * leverageShare;
    const coreW = growthTotal - leveragedW;

    if (coreW > 0.001) w.set("core_btc", coreW);
    if (leveragedW > 0.001) {
      if (leveragedW >= 0.4) {
        // Carve a diversifier slice out of the leveraged sleeve so MSTR
        // isn't the only treasury name. The leveraged-sleeve TOTAL is held
        // constant at leveragedW (0.78 + 0.22) regardless of how the
        // diversifier portion is split — this only changes WHICH
        // treasuries fill it, never the growth/income balance, so the
        // monotonicity invariant is untouched.
        w.set("leveraged_eq", leveragedW * 0.78);
        const diversifierW = leveragedW * 0.22;
        if (t >= 5 && h >= 10) {
          // Top tolerance (Maxi / Ludicrous) + long horizon: one non-MSTR
          // name is still meaningful single-issuer risk, so split the
          // diversifier across the two cheapest issuers 60/40. Sum of the
          // two equals diversifierW exactly — no net weight change.
          w.set("treasury_diversifier", diversifierW * 0.6);
          w.set("treasury_diversifier_2", diversifierW * 0.4);
        } else {
          w.set("treasury_diversifier", diversifierW);
        }
      } else {
        w.set("leveraged_eq", leveragedW);
      }
    }
  }

  // Short-horizon covered-call ETF (MSTY) carve-out. MSTY's real expected
  // return is ~8% because of NAV decay — lower than STRD/STRK. So we only
  // give it a small slot at High tolerance (the user might want the cash
  // stream even if total return is mediocre), and a meaningful slot only
  // at Maxi short horizon where the "send it" mandate justifies the decay
  // tradeoff. Anything higher and we'd violate "more tolerance ⇒ more
  // expected return."
  if (t >= 4 && t <= 5 && h <= 2) {
    // MSTY only at h<=2 — at h>=3 the NAV decay overwhelms distributions
    // and pulls portfolio expected return below the next-lower tolerance
    // tier, breaking the monotonicity invariant.
    // 5% at High = seasoning; 25% at Maxi = "send it" mandate.
    const dvWeight = t === 5 ? 0.25 : 0.05;
    rescaleAllExcept(w, 1 - dvWeight);
    w.set("deriv_income", dvWeight);
  }

  // Maxi (5) at very short horizon: small speculative slot
  if (t === 5 && h <= 2) {
    const sp = 0.1;
    rescaleAllExcept(w, 1 - sp);
    w.set("speculative", sp);
  }

  // Ludicrous (6): replace a chunk of leveraged_eq with 2x daily ETFs.
  // The exact size scales with horizon — shorter = more ludicrous, longer
  // horizons need MSTR's accretion to dominate decay.
  if (t === 6) {
    const ludicrousShare = h <= 2 ? 0.4 : h <= 5 ? 0.3 : 0.2;
    rescaleAllExcept(w, 1 - ludicrousShare);
    w.set("ludicrous_lev", ludicrousShare);
  }

  return w;
}

// Stage 2: apply live-signal tilts. Each signal nudges weights between
// pre-existing sleeves (no new sleeves created here).
//
// Takes the full RecommendInput (not just MarketSignals) because the
// Fear & Greed branch needs `volatilityTolerance` to decide whether to
// engage capitulation buying. Previous version cast `signals as
// RecommendInput` which would have crashed if the function were ever
// called with bare signals from a non-recommend caller.
function applyMarketSignals(
  base: Map<SleeveRole, number>,
  signals: RecommendInput,
): { weights: Map<SleeveRole, number>; caveats: string[] } {
  const w = new Map(base);
  const caveats: string[] = [];

  // ----- mNAV (MSTR is the bellwether) -----
  const mNAV = signals.mNAVByTicker?.MSTR;
  if (typeof mNAV === "number" && isFinite(mNAV) && mNAV > 0) {
    if (mNAV >= 1.9) {
      // Very rich premium — paying ~2x for accretion. Trim 35% of treasury
      // equity into spot BTC. Both diversifier names are trimmed (not just
      // the cheapest) so the trim is proportional and the cheaper issuer
      // never ends up weighted below the pricier one.
      shiftBetween(w, ["leveraged_eq", "treasury_diversifier", "treasury_diversifier_2"], "core_btc", 0.35);
      caveats.push(
        `MSTR mNAV is rich (${mNAV.toFixed(2)}x). Treasury-equity sleeve has been trimmed in favor of spot BTC · at this premium you'd buy BTC at par instead of paying for accretion.`,
      );
    } else if (mNAV >= 1.6) {
      shiftBetween(w, ["leveraged_eq", "treasury_diversifier", "treasury_diversifier_2"], "core_btc", 0.18);
      caveats.push(
        `MSTR mNAV is elevated (${mNAV.toFixed(2)}x). Modest trim of treasury equity in favor of core BTC.`,
      );
    } else if (mNAV < 0.85) {
      shiftBetween(w, ["leveraged_eq", "treasury_diversifier", "treasury_diversifier_2"], "core_btc", 0.5);
      caveats.push(
        `MSTR mNAV is below 1.0x (${mNAV.toFixed(2)}x). Equity issuance becomes dilutive at sub-NAV · trimming leveraged sleeve into core BTC.`,
      );
    } else if (mNAV < 1.05) {
      caveats.push(
        `MSTR mNAV is compressed (${mNAV.toFixed(2)}x) · accretion is cheap, treasury-equity sleeve holds full weight.`,
      );
    }
  }

  // ----- Crypto Fear & Greed -----
  const fg = signals.fearGreed;
  if (typeof fg === "number" && fg >= 0 && fg <= 100) {
    if (fg >= 80) {
      // Extreme greed — fade leverage, prefer cash-like BTC.
      shiftBetween(w, ["leveraged_eq", "speculative", "ludicrous_lev"], "core_btc", 0.20);
      caveats.push(
        `Crypto Fear & Greed = ${fg} (Extreme Greed). Engine has trimmed leveraged sleeves toward spot BTC · euphoric tops historically precede sharp drawdowns.`,
      );
    } else if (fg >= 65) {
      shiftBetween(w, ["leveraged_eq", "speculative", "ludicrous_lev"], "core_btc", 0.10);
      caveats.push(
        `Crypto Fear & Greed = ${fg} (Greed). Modest trim of leverage into core BTC.`,
      );
    } else if (fg <= 20) {
      // Extreme fear — buy when blood's in the street, IF user tolerates risk.
      const t = signals.volatilityTolerance ?? 3;
      if (t >= 3) {
        shiftBetween(w, ["core_btc", "income_low_vol"], "leveraged_eq", 0.15);
        caveats.push(
          `Crypto Fear & Greed = ${fg} (Extreme Fear). Engine has tilted toward MSTR · mNAV usually compresses with sentiment, making accretion cheaper at fear extremes.`,
        );
      } else {
        caveats.push(
          `Crypto Fear & Greed = ${fg} (Extreme Fear). Tilt to leveraged equity skipped because your tolerance is ${TOLERANCE_LABELS[t as Tolerance]} · capitulation buying isn't for everyone.`,
        );
      }
    } else if (fg <= 35) {
      const t = signals.volatilityTolerance ?? 3;
      if (t >= 4) {
        shiftBetween(w, ["core_btc"], "leveraged_eq", 0.08);
        caveats.push(
          `Crypto Fear & Greed = ${fg} (Fear). Modest tilt toward leveraged equity for high-tolerance profiles.`,
        );
      }
    }
  }

  // ----- 30-day BTC realized volatility -----
  const vol = signals.btcVol30d;
  if (typeof vol === "number" && vol > 0) {
    if (vol >= 90) {
      // Extreme volatility — daily-reset products eat NAV here. Cut by half.
      shiftBetween(w, ["speculative", "ludicrous_lev"], "leveraged_eq", 0.5);
      caveats.push(
        `BTC 30-day realized volatility is ${vol.toFixed(0)}% (extreme). Daily-reset 2x ETFs decay aggressively in this regime · speculative + ludicrous sleeves halved into MSTR equity.`,
      );
    } else if (vol >= 70) {
      shiftBetween(w, ["speculative", "ludicrous_lev"], "leveraged_eq", 0.25);
      caveats.push(
        `BTC 30-day vol is ${vol.toFixed(0)}% (elevated). Speculative + ludicrous sleeves trimmed because volatility decay on daily-reset products is meaningful at this level.`,
      );
    }
  }

  return { weights: w, caveats };
}

// Move a fraction `pct` of the total weight in `fromRoles` into `toRole`.
// If toRole isn't currently present, it's created.
function shiftBetween(
  w: Map<SleeveRole, number>,
  fromRoles: SleeveRole[],
  toRole: SleeveRole,
  pct: number,
) {
  let moved = 0;
  for (const r of fromRoles) {
    const cur = w.get(r) ?? 0;
    if (cur > 0) {
      const m = cur * pct;
      w.set(r, cur - m);
      moved += m;
    }
  }
  if (moved > 0) w.set(toRole, (w.get(toRole) ?? 0) + moved);
}

function buildPortfolioRationale(
  sleeves: Sleeve[],
  input: RecommendInput,
): string {
  const tol = TOLERANCE_LABELS[input.volatilityTolerance].toLowerCase();
  const acctStr =
    input.accountType === "taxable"
      ? "taxable account"
      : input.accountType === "roth"
        ? "Roth IRA"
        : "Traditional IRA / 401(k)";
  const horizonStr = `${input.horizonYears}-year`;
  const top = sleeves[0];
  return `Here's a suggested mix for your answers. For a ${horizonStr} horizon and ${tol} volatility tolerance in a ${acctStr}, the engine anchors with ${top.asset.ticker} (${(top.weight * 100).toFixed(0)}%) and rounds out the rest of the mix below. The breakdown shows what each piece is doing in the portfolio.`;
}

export function recommend(input: RecommendInput): Recommendation {
  const base = computeBaseSleeveWeights(input);
  const { weights: finalWeights, caveats: signalCaveats } = applyMarketSignals(
    base,
    input,
  );

  // Materialize sleeves — pass live signals so role→asset mapping can
  // pick e.g. the cheapest-mNAV treasury for diversifier.
  const rawSleeves: Sleeve[] = [];
  for (const [role, weight] of finalWeights) {
    if (weight < 0.005) continue;
    const asset = pickAssetForRole(role, input.accountType, input);
    if (!asset) continue;
    let rationale = ROLE_RATIONALE[role];
    // Annotate either diversifier sleeve with the full consideration set ·
    // all three candidates are evaluated every run; show their live mNAVs
    // and where this pick landed in the ranking, so "what was considered"
    // is transparent at the moment of recommendation (operator request
    // 2026-06-13).
    if (role === "treasury_diversifier" || role === "treasury_diversifier_2") {
      const ranked = rankTreasuriesByMNAV(TREASURY_DIVERSIFIERS, input).filter(
        (x) => x.mNAV != null && x.mNAV > 0,
      );
      if (ranked.length) {
        const list = ranked
          .map((x) => `${x.ticker} ${(x.mNAV as number).toFixed(2)}x`)
          .join(" · ");
        const place =
          role === "treasury_diversifier" ? "cheapest" : "second-cheapest";
        rationale = `${ROLE_RATIONALE[role]} All three evaluated by mNAV (${list}); ${asset.ticker} is the ${place}.`;
      }
    }
    rawSleeves.push({ role, asset, weight, rationale });
  }

  // Merge sleeves resolving to same asset
  const merged = new Map<string, Sleeve>();
  for (const s of rawSleeves) {
    const ex = merged.get(s.asset.ticker);
    if (ex) ex.weight += s.weight;
    else merged.set(s.asset.ticker, { ...s });
  }

  // Hard horizon filter
  const horizonFiltered = Array.from(merged.values()).filter(
    (s) => input.horizonYears >= s.asset.bestHorizonMin - 2,
  );

  const sleeves = horizonFiltered;
  const sum = sleeves.reduce((a, s) => a + s.weight, 0);
  if (sum > 0) for (const s of sleeves) s.weight /= sum;

  for (const s of sleeves) s.weight = Math.round(s.weight * 100) / 100;
  const roundSum = sleeves.reduce((a, s) => a + s.weight, 0);
  if (Math.abs(roundSum - 1) > 0.0001 && sleeves.length > 0) {
    sleeves.sort((a, b) => b.weight - a.weight);
    // Apply the correction, clamping to [0.01, 1.0] so the largest
    // sleeve can't go negative when many small sleeves each round up
    // (cumulative roundSum overshoot > largestSleeve). Without the
    // clamp, the subsequent .filter(w > 0) silently drops the core
    // BTC sleeve and the portfolio no longer sums to 100%.
    const corrected =
      Math.round((sleeves[0].weight + (1 - roundSum)) * 100) / 100;
    sleeves[0].weight = Math.max(0.01, Math.min(1.0, corrected));
  }

  const finalSleeves = sleeves
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  // Defensive: if every sleeve was filtered out (impossible under
  // current invariants but cheap to guard against — extreme input
  // combos in the future could cause this), synthesize a STRC-only
  // fallback rather than crashing the whole /fit page on
  // `finalSleeves[0].asset` of undefined.
  if (finalSleeves.length === 0) {
    const fallbackAsset = ASSETS_BY_TICKER.STRC ?? Object.values(ASSETS_BY_TICKER)[0];
    finalSleeves.push({
      asset: fallbackAsset,
      weight: 1.0,
      role: "income_low_vol",
      rationale: "Defensive fallback: your inputs filtered out every sleeve.",
    });
    caveatsFallback: {
      // Use a marker so we know we hit this path; surfaced to the
      // caller via signalCaveats below.
      signalCaveats.push(
        "Fallback portfolio applied · your inputs filtered out every sleeve. This is a bug; please report.",
      );
    }
  }

  const primary = finalSleeves[0].asset;
  const portfolioRationale = buildPortfolioRationale(finalSleeves, input);
  const avoid = pickAvoid(input, finalSleeves.map((s) => s.asset.ticker));

  const caveats: string[] = [...signalCaveats];

  // Per-asset caveats
  if (finalSleeves.some((s) => s.asset.ticker === "STRK")) {
    caveats.push(
      "STRK conversion is at MSTR=$1,000 (10:1). Below that, it behaves like a coupon preferred; above, it tracks MSTR shares.",
    );
  }
  if (finalSleeves.some((s) => s.asset.ticker === "MSTY")) {
    caveats.push(
      "MSTY's headline yield is partly principal return · NAV decays in flat or rising markets. Don't reinvest distributions assuming the share price holds.",
    );
  }
  // MSTU / MSTX / BITX are pure 2x daily-reset ETFs — they suffer from
  // volatility decay in choppy markets. MST is a hybrid (leveraged +
  // covered call) and doesn't share the same daily-reset mechanic, so
  // it's deliberately excluded from this caveat.
  if (
    finalSleeves.some((s) =>
      ["MSTU", "MSTX", "BITX"].includes(s.asset.ticker),
    )
  ) {
    caveats.push(
      "Daily-reset 2x ETFs lose value in choppy markets even when the underlying ends flat. Treat the leveraged sleeve as a tactical position to review weekly, not a hold.",
    );
  }
  if (finalSleeves.some((s) => s.asset.ticker === "SATA")) {
    caveats.push(
      "SATA is a Strive-issuer preferred (variable, ~13%) · different issuer balance sheet from the MSTR preferred stack. The point is diversification, not extra yield per se.",
    );
  }

  const expectedReturn = computeExpectedReturn(
    finalSleeves,
    input.horizonYears,
  );

  return {
    primary,
    allocation: finalSleeves,
    portfolioRationale,
    avoid,
    caveats,
    expectedReturn,
  };
}

function pickAvoid(
  input: RecommendInput,
  inAllocation: string[],
): [Asset, Asset] {
  const t = input.volatilityTolerance;
  const h = input.horizonYears;
  const candidates: string[] = [];

  if (t <= 2) {
    candidates.push("MSTR", "MSTU", "MSTX", "BITX", "MSTY", "ASST", "XXI", "MST");
  } else if (t === 3) {
    candidates.push("MSTU", "MSTX", "BITX", "MSTY", "MST");
  } else if (t === 4) {
    candidates.push("STRC", "STRF", "STRE", "SATA");
  } else {
    candidates.push("STRC", "STRF", "STRE", "SATA");
  }

  if (h <= 3) {
    candidates.push("MSTR", "MPJPY", "ASST", "XXI", "SMLR");
  }
  if (h >= 10) {
    candidates.push("MSTU", "MSTX", "BITX", "MST", "MSTY");
  }

  const filtered = candidates.filter((c) => !inAllocation.includes(c));
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const c of filtered)
    if (!seen.has(c)) {
      seen.add(c);
      uniq.push(c);
    }

  const fallback = ["MSTU", "BITX", "MSTY", "ASST"];
  for (const c of fallback) {
    if (uniq.length >= 2) break;
    if (!inAllocation.includes(c) && !uniq.includes(c)) uniq.push(c);
  }

  return [
    ASSETS_BY_TICKER[uniq[0] ?? "MSTU"],
    ASSETS_BY_TICKER[uniq[1] ?? "BITX"],
  ];
}

