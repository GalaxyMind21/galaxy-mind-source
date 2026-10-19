export type AssetCategory =
  | "spot"
  | "equity"
  | "preferred"
  | "income-etf"
  | "spot-etf"
  | "leveraged-etf";

export type Asset = {
  ticker: string;
  name: string;
  category: AssetCategory;
  oneLiner: string;
  longDescription: string;
  volatilityScore: number;
  incomeOrientation: number;
  growthOrientation: number;
  rocEligible: boolean;
  bestHorizonMin: number;
  bestHorizonMax: number;
  yieldRange: [number, number] | null;
  notes: string;
  // Expected annualized total return (price + yield/dividends combined).
  // These are CENTRAL ESTIMATES, not promises — long-horizon assumptions
  // grounded in:
  //   - BTC: a forward 22%/yr central case (compressed vs historical 40–60%
  //     because halvings have less impact on the supply cliff and the
  //     marginal buyer is now institutional, not retail).
  //   - Treasury equities: BTC return × accretion premium (mNAV > 1
  //     compounds BTC-per-share over time).
  //   - Preferreds: their coupon, which is usually the whole story.
  //   - Covered-call ETFs: distributions minus structural NAV decay.
  //   - 2x ETFs: 2x the underlying minus daily-rebalance volatility decay
  //     (significant in choppy markets — the central case is BELOW 2x BTC).
  // The range is a 1-sigma-ish band, NOT a worst/best case. For a 1-year
  // horizon the realization can easily land outside the band; for 10+
  // years convergence to the mean is more reliable. Update these as your
  // own thesis changes.
  expectedAnnualReturn: number;          // central, decimal (0.22 = 22%)
  expectedReturnRange: [number, number]; // [low, high]
  // Annualized volatility (sigma), decimal. 0.55 = 55%/yr stdev.
  // Used for portfolio Sharpe and risk presentation. Calibrated to
  // forward-looking thesis, not point-in-time realized vol.
  expectedVolatility: number;
};

export const ASSETS: Asset[] = [
  {
    ticker: "BTC",
    name: "Spot Bitcoin",
    category: "spot",
    oneLiner: "The base asset. No counterparty, no fees, no yield.",
    longDescription:
      "Direct ownership of bitcoin via self-custody or a regulated exchange. Lowest ongoing cost (no expense ratio), but not directly holdable in most retirement accounts. The cleanest expression of the long thesis.",
    volatilityScore: 8,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 4,
    bestHorizonMax: 30,
    yieldRange: null,
    expectedAnnualReturn: 0.22,
    expectedReturnRange: [0.1, 0.36],
    expectedVolatility: 0.55,
    notes:
      "Cannot be held inside most IRAs/401(k)s · substitute MSBT/IBIT/FBTC/BITB for those accounts.",
  },
  {
    ticker: "IBIT",
    name: "iShares Bitcoin Trust",
    category: "spot-etf",
    oneLiner: "Most liquid spot BTC ETF. 0.25% expense ratio.",
    longDescription:
      "BlackRock's spot bitcoin ETF, the largest by AUM. Tracks bitcoin closely. Holdable in any brokerage account including IRAs and 401(k)s. The default spot wrapper for retirement accounts.",
    volatilityScore: 8,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 3,
    bestHorizonMax: 30,
    yieldRange: null,
    expectedAnnualReturn: 0.217,
    expectedReturnRange: [0.1, 0.36],
    expectedVolatility: 0.55,
    notes:
      "Expense ratio 0.25% · small drag, but creates a structural lag vs. self-custodied BTC over multi-decade horizons.",
  },
  {
    ticker: "FBTC",
    name: "Fidelity Wise Origin Bitcoin Fund",
    category: "spot-etf",
    oneLiner: "Fidelity's spot BTC ETF. 0.25% fee. Strong custody story.",
    longDescription:
      "Fidelity's spot bitcoin ETF with self-custody via Fidelity Digital Assets. Identical exposure to IBIT at the same fee, preferred by Fidelity-native investors and those who value the in-house custody.",
    volatilityScore: 8,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 3,
    bestHorizonMax: 30,
    yieldRange: null,
    expectedAnnualReturn: 0.217,
    expectedReturnRange: [0.1, 0.36],
    expectedVolatility: 0.55,
    notes: "Functionally interchangeable with IBIT in most workflows.",
  },
  {
    ticker: "BITB",
    name: "Bitwise Bitcoin ETF",
    category: "spot-etf",
    oneLiner: "Lowest-cost mainstream spot BTC ETF at 0.20%.",
    longDescription:
      "Bitwise's spot bitcoin ETF. Slightly lower expense ratio than IBIT/FBTC. Bitwise also publishes the underlying BTC addresses for transparency.",
    volatilityScore: 8,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 3,
    bestHorizonMax: 30,
    yieldRange: null,
    expectedAnnualReturn: 0.218,
    expectedReturnRange: [0.1, 0.36],
    expectedVolatility: 0.55,
    notes:
      "5 bps cheaper than IBIT, meaningful only at large balances and long horizons.",
  },
  {
    ticker: "MSBT",
    name: "Morgan Stanley Spot Bitcoin ETF",
    category: "spot-etf",
    oneLiner: "Cheapest spot BTC ETF at 0.14%. Launched April 2026.",
    longDescription:
      "Morgan Stanley's spot bitcoin ETF, the lowest-fee mainstream wrapper at 0.14%. Same spot-BTC exposure as IBIT/FBTC at roughly half the expense ratio, so it strictly dominates them as the wrapper for any account that can't self-custody · the engine's default spot sleeve for retirement accounts. Newer than IBIT/FBTC so AUM and liquidity are still building; the fee edge compounds hardest over long horizons but never works against shorter ones.",
    volatilityScore: 8,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 3,
    bestHorizonMax: 30,
    yieldRange: null,
    expectedAnnualReturn: 0.219,
    expectedReturnRange: [0.1, 0.36],
    expectedVolatility: 0.55,
    notes:
      "Newer entrant · confirm liquidity is sufficient for your position size.",
  },
  {
    ticker: "MSTR",
    name: "Strategy",
    category: "equity",
    oneLiner: "Bitcoin treasury equity. Accretive when mNAV > 1, decay when below.",
    longDescription:
      "Operates as a bitcoin treasury company · issues equity, convertibles, and preferreds whenever mNAV trades above 1.0x and uses proceeds to buy BTC, accreting BTC-per-share. Premium currently ~1.2x (vs. 2.6x peak). The senior debt and preferred layer amplifies bitcoin exposure per common share, so gross bitcoin-per-share (BPS) runs above the net-of-claims CEBE BPS. That Amplification adds upside when BTC's return beats the cost of capital, and downside when short-duration or high-cost claims come due. On long horizons the accretion compounds; over rolling 12-month windows MSTR can and has underperformed BTC due to premium compression. See the BPS / CEBE BPS / Amplification breakdown on the per-ticker treasury page.",
    volatilityScore: 10,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 5,
    bestHorizonMax: 30,
    yieldRange: null,
    expectedAnnualReturn: 0.3,
    expectedReturnRange: [-0.15, 0.65],
    expectedVolatility: 0.85,
    notes:
      "BTC-yield ~9.6% YTD 2026 · accretion is the long thesis, but premium compression can make trailing returns lag BTC for years.",
  },
  {
    ticker: "STRC",
    name: "Strategy Variable Rate Preferred",
    category: "preferred",
    oneLiner: "Variable-rate preferred designed to trade near $100 par.",
    longDescription:
      "Monthly rate adjustments aim to keep the price anchored near par. Lowest volatility in the MSTR preferred stack. Dividends are typically treated as Return of Capital, deferring tax and reducing cost basis in taxable accounts.",
    volatilityScore: 2,
    incomeOrientation: 0.95,
    growthOrientation: 0.05,
    rocEligible: true,
    bestHorizonMin: 1,
    bestHorizonMax: 8,
    yieldRange: [9, 11],
    expectedAnnualReturn: 0.1,
    expectedReturnRange: [0.09, 0.11],
    expectedVolatility: 0.02,
    notes: "Default income sleeve for low tolerance in a taxable account.",
  },
  {
    ticker: "STRF",
    name: "Strategy 10% Fixed Preferred (Strife)",
    category: "preferred",
    oneLiner: "10% perpetual fixed-rate preferred. Predictable income.",
    longDescription:
      "$10/yr coupon on $100 par, paid quarterly. No conversion. Slightly more interest-rate sensitivity than STRC because the coupon is fixed. ROC-eligible.",
    volatilityScore: 2,
    incomeOrientation: 0.95,
    growthOrientation: 0.05,
    rocEligible: true,
    bestHorizonMin: 3,
    bestHorizonMax: 15,
    yieldRange: [10, 10],
    expectedAnnualReturn: 0.1,
    expectedReturnRange: [0.07, 0.13],
    expectedVolatility: 0.06,
    notes: "Pairs well with STRC in a dividend-rotation strategy.",
  },
  {
    ticker: "STRE",
    name: "Strategy Euro Perpetual (Stream)",
    category: "preferred",
    oneLiner: "Euro-denominated mirror of STRF. €100 par, 10% coupon.",
    longDescription:
      "Listed on the Luxembourg Stock Exchange. 10% perpetual coupon on €100 par. For euro-balance-sheet investors who want STRF-style exposure without taking USD/EUR FX risk on the income stream.",
    volatilityScore: 2,
    incomeOrientation: 0.95,
    growthOrientation: 0.05,
    rocEligible: true,
    bestHorizonMin: 3,
    bestHorizonMax: 15,
    yieldRange: [10, 10],
    expectedAnnualReturn: 0.1,
    expectedReturnRange: [0.03, 0.17],
    expectedVolatility: 0.08,
    notes:
      "Use when your liabilities are in EUR. US-tax investors generally have no reason to use STRE over STRF.",
  },
  {
    ticker: "STRK",
    name: "Strategy Convertible Preferred (Strike)",
    category: "preferred",
    oneLiner:
      "8% coupon + 10:1 conversion to MSTR at $1,000. Income with a genuine call option.",
    longDescription:
      "Each STRK converts into 0.1 MSTR shares at a $1,000 conversion price. Pays 8% on $100 par (cumulative). Below MSTR=$1000, behaves like a preferred with bond-like volatility; the conversion option compounds quietly. Above $1,000, it tracks MSTR at a 10:1 ratio. Over 5-10y BTC bull markets the option is realistic, not vestigial.",
    volatilityScore: 5,
    incomeOrientation: 0.4,
    growthOrientation: 0.6,
    rocEligible: true,
    bestHorizonMin: 3,
    bestHorizonMax: 15,
    yieldRange: [8, 8],
    expectedAnnualReturn: 0.13,
    expectedReturnRange: [0.08, 0.3],
    expectedVolatility: 0.25,
    notes:
      "Conversion feature is the asymmetric kicker · collect coupon while waiting, get equity upside above $1k MSTR.",
  },
  {
    ticker: "STRD",
    name: "Strategy Higher-Yield Preferred (Stride)",
    category: "preferred",
    oneLiner:
      "Highest stated yield in the MSTR perpetual stack (10–13% range).",
    longDescription:
      "Trades a richer headline yield in exchange for greater price swings vs. STRC/STRF. Suited to moderate tolerance + medium horizons where the income compounds meaningfully.",
    volatilityScore: 3,
    incomeOrientation: 0.9,
    growthOrientation: 0.1,
    rocEligible: true,
    bestHorizonMin: 2,
    bestHorizonMax: 10,
    yieldRange: [10, 13],
    expectedAnnualReturn: 0.12,
    expectedReturnRange: [0.09, 0.15],
    expectedVolatility: 0.05,
    notes: "ROC-eligible, meaningful tax deferral in taxable accounts.",
  },
  {
    ticker: "SATA",
    name: "Strive Variable Rate Preferred (Series A)",
    category: "preferred",
    oneLiner:
      "Strive's variable-rate Series A preferred. ~13% rate, sister to ASST common.",
    longDescription:
      "Variable Rate Series A Perpetual Preferred Stock issued by Strive (parent of ASST common). Currently carries a 13% dividend rate; the rate adjusts so the preferred trades close to par. Functions as a Strive-issuer alternative to the MSTR preferred stack · same general mechanics, smaller balance sheet, more idiosyncratic counterparty risk.",
    volatilityScore: 3,
    incomeOrientation: 0.9,
    growthOrientation: 0.1,
    rocEligible: true,
    bestHorizonMin: 2,
    bestHorizonMax: 8,
    yieldRange: [12, 14],
    expectedAnnualReturn: 0.13,
    expectedReturnRange: [0.1, 0.16],
    expectedVolatility: 0.04,
    notes:
      "Single-issuer concentration risk vs. the MSTR stack · useful as a diversifier in a preferred sleeve, not as the only income holding.",
  },
  {
    ticker: "SMLR",
    name: "Semler Scientific (common)",
    category: "equity",
    oneLiner:
      "Healthcare-wrapper BTC treasury equity. ~5k BTC, targeting 105k by 2027.",
    longDescription:
      "Semler Scientific's common stock. Cardiovascular diagnostics business with a bitcoin treasury overlay. Volatility profile sits between MSTR and BTC; smaller, less liquid, but with operational cash flow funding part of the BTC accumulation.",
    volatilityScore: 9,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 5,
    bestHorizonMax: 20,
    yieldRange: null,
    expectedAnnualReturn: 0.25,
    expectedReturnRange: [-0.25, 0.55],
    expectedVolatility: 0.8,
    notes:
      "Lower BTC-per-share than MSTR but still treasury-equity beta. Diversifier in a leveraged sleeve.",
  },
  {
    ticker: "MPJPY",
    name: "Metaplanet (sponsored ADR)",
    category: "equity",
    oneLiner:
      "Japan's largest BTC treasury (~40k BTC). MPJPY is the Deutsche Bank-sponsored US ADR.",
    longDescription:
      "Tokyo-listed Metaplanet (3350.T) is the 3rd-largest bitcoin treasury company globally. Trades in the US under MPJPY (Deutsche Bank sponsored ADR, launched Dec 2025) and the older unsponsored MTPLF symbol on OTCQX. Same accretion playbook as MSTR · issue equity at a premium, buy BTC, increase BTC-per-share · in a Japanese balance-sheet wrapper. Stated target of 210k BTC.",
    volatilityScore: 10,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 5,
    bestHorizonMax: 25,
    yieldRange: null,
    expectedAnnualReturn: 0.28,
    expectedReturnRange: [-0.15, 0.65],
    expectedVolatility: 0.9,
    notes:
      "ADR liquidity is thinner than MSTR. Geographic diversifier in a leveraged sleeve.",
  },
  {
    ticker: "ASST",
    name: "Strive Inc",
    category: "equity",
    oneLiner: "Smaller US-listed BTC treasury equity (~14.5k BTC).",
    longDescription:
      "Vivek Ramaswamy's asset manager turned bitcoin treasury, listed via the Asset Entities reverse merger. Similar leveraged-BTC thesis to MSTR with a smaller balance sheet, more execution risk, and less established capital-markets machinery.",
    volatilityScore: 9,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 5,
    bestHorizonMax: 20,
    yieldRange: null,
    expectedAnnualReturn: 0.25,
    expectedReturnRange: [-0.25, 0.55],
    expectedVolatility: 0.85,
    notes:
      "Position size for the possibility of total loss in a stress scenario.",
  },
  {
    ticker: "XXI",
    name: "Twenty One Capital",
    category: "equity",
    oneLiner: "Cantor/Tether-backed BTC treasury vehicle (~43k BTC).",
    longDescription:
      "Treasury-equity beta to BTC, sponsored by Cantor and Tether. 2nd-largest BTC treasury company by holdings. Different sponsor profile than MSTR; shorter operating history.",
    volatilityScore: 9,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 5,
    bestHorizonMax: 20,
    yieldRange: null,
    expectedAnnualReturn: 0.25,
    expectedReturnRange: [-0.2, 0.55],
    expectedVolatility: 0.85,
    notes: "Less price history than MSTR · model with care.",
  },
  {
    ticker: "MSTY",
    name: "YieldMax MSTR Option Income ETF",
    category: "income-etf",
    oneLiner:
      "Sells calls on MSTR. Headline yield 40–80% with explicit NAV decay.",
    longDescription:
      "Covered-call ETF on MSTR. Distributions can run very high but the strategy systematically caps upside while exposing the fund to full downside. NAV decay in flat or rising markets is a known feature, not a bug.",
    volatilityScore: 7,
    incomeOrientation: 0.85,
    growthOrientation: 0.15,
    rocEligible: true,
    bestHorizonMin: 1,
    bestHorizonMax: 4,
    yieldRange: [40, 80],
    expectedAnnualReturn: 0.08,
    expectedReturnRange: [-0.25, 0.3],
    expectedVolatility: 0.5,
    notes:
      "Recommend only when the user explicitly tolerates principal erosion.",
  },
  {
    ticker: "YBIT",
    name: "YieldMax Bitcoin Option Income (IBIT)",
    category: "income-etf",
    oneLiner:
      "Covered-call ETF on IBIT. Lower-vol cousin of MSTY · same decay dynamic.",
    longDescription:
      "Sells call spreads on IBIT for weekly distributions. Lower underlying volatility than MSTY (BTC vs MSTR), so headline yields are smaller but NAV decay is also milder. Useful as the diversifier in a deriv-income sleeve.",
    volatilityScore: 6,
    incomeOrientation: 0.85,
    growthOrientation: 0.15,
    rocEligible: true,
    bestHorizonMin: 1,
    bestHorizonMax: 4,
    yieldRange: [25, 60],
    expectedAnnualReturn: 0.06,
    expectedReturnRange: [-0.15, 0.22],
    expectedVolatility: 0.35,
    notes:
      "Same caveat as MSTY: distributions are partly principal return, not pure income.",
  },
  {
    ticker: "BITX",
    name: "Volatility Shares 2x Bitcoin Strategy ETF",
    category: "leveraged-etf",
    oneLiner: "2x daily BTC futures. Daily-rebalance decay in choppy markets.",
    longDescription:
      "Targets 2x the daily return of bitcoin futures. The most liquid 2x BTC product. As a daily-reset product, path-dependent decay erodes returns in volatile, sideways markets · never a long-term hold.",
    volatilityScore: 10,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 0,
    bestHorizonMax: 1,
    yieldRange: null,
    expectedAnnualReturn: 0.28,
    expectedReturnRange: [-0.5, 0.8],
    expectedVolatility: 1.1,
    notes:
      "Holding period measured in weeks, not years. Suited to a high-conviction directional bet, not a buy-and-hold.",
  },
  {
    ticker: "MSTU",
    name: "T-REX 2x Long MSTR Daily Target ETF",
    category: "leveraged-etf",
    oneLiner: "2x daily MSTR. Extreme decay risk demonstrated in 2025–26.",
    longDescription:
      "2x daily leveraged MSTR. In a recent 12-month window where MSTR fell ~53%, MSTU lost ~91% due to compounding decay on a high-vol underlying. Extremely path-dependent. Underwent a reverse split.",
    volatilityScore: 10,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 0,
    bestHorizonMax: 1,
    yieldRange: null,
    expectedAnnualReturn: 0.3,
    expectedReturnRange: [-0.7, 0.9],
    expectedVolatility: 1.7,
    notes:
      "Recommended only as a small speculative sleeve, never as a core holding.",
  },
  {
    ticker: "MSTX",
    name: "Defiance Daily Target 2x Long MSTR ETF",
    category: "leveraged-etf",
    oneLiner: "Defiance's 2x daily MSTR via swaps + futures. 1.31% expense ratio.",
    longDescription:
      "Defiance's 2x daily leveraged MSTR. Implemented via swap agreements, futures, and options on MSTR · does not directly hold MSTR shares. Same daily-reset decay dynamics as MSTU; pick whichever has tighter spreads at the moment of trade. Underwent a reverse split in early 2026.",
    volatilityScore: 10,
    incomeOrientation: 0,
    growthOrientation: 1,
    rocEligible: false,
    bestHorizonMin: 0,
    bestHorizonMax: 1,
    yieldRange: null,
    expectedAnnualReturn: 0.3,
    expectedReturnRange: [-0.7, 0.9],
    expectedVolatility: 1.7,
    notes:
      "Functionally interchangeable with MSTU. Use to diversify counterparty risk inside a leveraged sleeve.",
  },
  {
    ticker: "MST",
    name: "Defiance Leveraged Long + Income MSTR ETF",
    category: "leveraged-etf",
    oneLiner:
      "1.5–2x MSTR with weekly income from credit-call spreads. Hybrid leverage + yield.",
    longDescription:
      "Defiance's hybrid product: targets ~150–200% daily MSTR exposure while running a credit-call-spread overlay on ~100% of net notional, distributing the harvested premium weekly. Cap on upside, full participation on downside. Effectively a leveraged covered-call on MSTR.",
    volatilityScore: 9,
    incomeOrientation: 0.6,
    growthOrientation: 0.4,
    rocEligible: true,
    bestHorizonMin: 0,
    bestHorizonMax: 2,
    yieldRange: [30, 60],
    expectedAnnualReturn: 0.18,
    expectedReturnRange: [-0.4, 0.55],
    expectedVolatility: 1.3,
    notes:
      "Pairs leverage decay with covered-call decay · both eat NAV in choppy markets. Distinct from MSTY (MST is leveraged; MSTY is unleveraged covered-call).",
  },
];

export const ASSETS_BY_TICKER: Record<string, Asset> = Object.fromEntries(
  ASSETS.map((a) => [a.ticker, a]),
);
