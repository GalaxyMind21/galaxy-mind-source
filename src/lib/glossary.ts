// Single source of truth for glossary terms · the page renders from
// this list and the layout's DefinedTermSet JSON-LD reads the same
// shape. Keeping the data here (vs inline in page.tsx) means a future
// /api/glossary.json endpoint or an embed widget can reuse the exact
// same definitions without duplicating prose.
//
// Terms are intentionally written to stand alone · each Definition is
// a complete answer to "what is X" without requiring context from
// other terms. This optimizes for AI-agent quoting (Perplexity,
// ChatGPT) and snippet selection (Google featured snippets).
//
// Organization: terms grouped by section. Within each section terms
// are ordered by importance (most-asked-about first), not alphabetical
// · readers scanning the page should hit the high-value definitions
// before the long tail.

export type GlossaryTerm = {
  // Anchor slug (used in /glossary#mnav). Lowercase, hyphenated,
  // ASCII only. Stable · don't rename without a redirect.
  slug: string;
  // Display name (the headword). Mixed case, with units / context
  // (e.g. "MVRV (Market Value to Realized Value)").
  term: string;
  // Short definition · 1-3 sentences. Standalone, complete, citable.
  // This is what the DefinedTerm schema's `description` exposes to
  // AI agents and search engines.
  definition: string;
  // Optional longer expansion · context, why-it-matters, threshold
  // values. Rendered below the definition in a smaller text style.
  expansion?: string;
  // External authoritative source for the term. The DefinedTerm
  // schema's `subjectOf` references this so agents can attribute
  // upstream when quoting.
  sourceUrl?: string;
  // Internal link · usually the page on Galaxy Mind that uses this
  // term most prominently. Renders as "See it live →" link.
  internalUrl?: string;
};

export type GlossarySection = {
  // Section anchor + display name.
  slug: string;
  title: string;
  blurb: string;
  terms: GlossaryTerm[];
};

export const GLOSSARY: GlossarySection[] = [
  {
    slug: "treasury-metrics",
    title: "Treasury company metrics",
    blurb:
      "How to read public Bitcoin treasury companies (MSTR, XXI, MPJPY, ASST).",
    terms: [
      {
        slug: "mnav",
        term: "mNAV (multiple of net asset value)",
        definition:
          "A Bitcoin treasury company's market capitalization divided by the value of the bitcoin it holds. mNAV = 1.0× means the stock trades for exactly the value of its BTC. Above 1.0× = the market is paying a premium. Below 1.0× = the stock trades for less than the bitcoin it holds (treasury-cheap).",
        expansion:
          "Threshold guide: below 1.0× is historically a strong accumulation signal · between 1.0× and 1.6× is a normal premium · above 1.6× is rich premium territory and historically a yellow flag for fresh entries.",
        internalUrl: "https://galaxymind.space/treasuries",
      },
      {
        slug: "ev-mnav",
        term: "EV / fully-diluted mNAV",
        definition:
          "Enterprise-value (fully-diluted) mNAV: (market cap + debt + preferred − cash) ÷ bitcoin value. It adds the notional senior stack to the numerator instead of subtracting it from the bitcoin side, so it is always greater than or equal to gross mNAV. At BTC Prague 2026 Michael Saylor argued mNAV should be calculated this way · including the notional value of convertible debt, preferred, and common.",
        expansion:
          "It is one of three lenses Galaxy Mind publishes side by side: gross mNAV (ignores capital structure), EV / fully-diluted mNAV (this one), and CEBE net mNAV (the conservative common-equity view). Pending where senior-claims figures are not yet sourced.",
        internalUrl: "https://galaxymind.space/gross-vs-net-mnav",
      },
      {
        slug: "spiral-of-doom",
        term: "Spiral of doom (mNAV reflexivity)",
        definition:
          "The reflexive risk a Bitcoin treasury company faces when its stock falls below NAV (mNAV under 1.0). Above NAV it can issue shares accretively, raising a dollar to buy more than a dollar of bitcoin per share; below NAV that flywheel reverses, because issuing equity becomes dilutive and cuts off the cheapest funding for more bitcoin, which can pressure the stock further.",
        expansion:
          "A brief, shallow discount is noise; a deep, persistent one is what turns reflexivity into a genuine risk rather than a buying opportunity. Gross mNAV alone can overstate the danger, since a leveraged company can sit at or above parity on a net (CEBE) basis once senior claims are accounted for.",
        internalUrl: "https://galaxymind.space/bitcoin-treasuries-below-nav",
      },
      {
        slug: "btc-per-share",
        term: "BTC per share",
        definition:
          "The bitcoin held by a treasury company divided by its diluted share count. Tells you how much actual BTC each share represents · the only metric that matters for long-term shareholder accretion.",
        expansion:
          "Strategy (MSTR) was at roughly 0.00124 BTC (124,000 sats) per share as of mid-2026 and has grown this number every quarter via accretive equity issuance.",
        internalUrl: "https://galaxymind.space/treasuries",
      },
      {
        slug: "effective-btc-price",
        term: "Effective BTC price",
        definition:
          "The actual price you pay per bitcoin when buying a treasury company's stock. Computed as spot BTC price × mNAV. Below spot means you're getting a discount; above spot means you're paying a premium for the wrapper (operating leverage, regulated equity access, future accretion).",
        internalUrl: "https://galaxymind.space/treasuries",
      },
      {
        slug: "sats-per-dollar",
        term: "Sats per dollar (sats per $1)",
        definition:
          "How many sats of bitcoin one dollar of a treasury company's stock effectively buys · bitcoin held × 1e8 ÷ market cap. It is the reciprocal of the effective BTC price, expressed in sats, and is share-count independent (the share count cancels out of market cap), so it compares cleanly across companies.",
        expansion:
          "When a stock's sats per $1 exceeds spot bitcoin's (1e8 ÷ BTC price), the company trades below NAV and each dollar stacks more sats through the equity wrapper than buying bitcoin outright. It is the mNAV discount, counted in sats.",
        internalUrl: "https://galaxymind.space/treasuries",
      },
      {
        slug: "accretion",
        term: "BTC-per-share accretion",
        definition:
          "The mechanism by which a treasury company can grow its bitcoin holdings faster than it dilutes shareholders. When a company issues equity at mNAV > 1.0× and uses the proceeds to buy BTC, BTC-per-share goes UP because each new dollar raised buys more BTC than the dilution dilutes. Saylor's Strategy made this the central thesis for MSTR.",
      },
      {
        slug: "bps",
        term: "BPS (Bitcoin Per Share)",
        definition:
          "The amount of bitcoin backing each common share of a treasury company BEFORE senior claims. Michael Saylor's growth metric for a Bitcoin Treasury Company. Galaxy Mind reports it as sats per $100 of stock · a higher BPS means each share commands more gross bitcoin exposure.",
        expansion:
          "BPS rises when a company issues equity at a premium (mNAV above 1.0×) and buys more bitcoin, or funds purchases with long-duration, low-cost capital. BTC Yield measures how well management grows BPS over time. With no debt or preferred, BPS equals CEBE BPS.",
        internalUrl: "https://galaxymind.space/treasuries",
      },
      {
        slug: "cebe-bps",
        term: "CEBE BPS (Common Equity Bitcoin Exposure per share)",
        definition:
          "The bitcoin backing each common share AFTER senior claims · the debt and preferred stock that get paid before common holders. The conservative, net-of-leverage counterpart to BPS, and Michael Saylor's risk metric. Galaxy Mind reports it as sats per $100 of stock.",
        expansion:
          "If a company's liabilities came due today, CEBE BPS is the more relevant number · it is what common shareholders would actually have a claim to. The shorter a company's liability duration, the more CEBE BPS matters relative to BPS. With no debt or preferred, CEBE BPS equals BPS.",
        sourceUrl: "https://www.cebetracker.io",
        internalUrl: "https://galaxymind.space/treasuries",
      },
      {
        slug: "amplification",
        term: "Amplification",
        definition:
          "The difference between a treasury company's BPS and its CEBE BPS · the extra gross bitcoin-per-share exposure created by senior leverage. Galaxy Mind reports it as a ratio (BPS ÷ CEBE BPS): 1.0× means no debt or preferred and the stock should track bitcoin like an ETF; higher values mean more senior leverage.",
        expansion:
          "Amplification is the lever that lets a Bitcoin Treasury Company outperform bitcoin, but only when it is well-structured. Short-duration, high-cost liabilities turn amplification into risk and underperformance; long-duration, low-cost liabilities turn it into common-equity upside. If a company's bitcoin annualized return (BTC ARR) exceeds its cost of capital, a well-capitalized company should outperform bitcoin.",
        internalUrl: "https://galaxymind.space/treasuries",
      },
      {
        slug: "btc-yield",
        term: "BTC Yield",
        definition:
          "The rate at which a treasury company grows its bitcoin-per-share (BPS) over a period, net of share dilution. It measures management's execution of accretive bitcoin acquisition · how effectively each capital raise adds more BTC per share than it dilutes. It is a BPS-execution metric, not a cash yield · no dividend is paid.",
        expansion:
          "Strategy popularized BTC Yield as the headline KPI for the treasury model. A positive BTC Yield means per-share bitcoin is rising. See BTC-per-share accretion for the underlying mechanism.",
        internalUrl: "https://galaxymind.space/treasuries",
      },
      {
        slug: "btc-arr",
        term: "BTC ARR (bitcoin annualized return) vs cost of capital",
        definition:
          "The yardstick that decides whether a treasury company's leverage helps or hurts. BTC ARR is the company's bitcoin annualized rate of return; the cost of capital is the blended rate on its debt and preferred. Saylor's framing: if BTC ARR exceeds the cost of capital, a well-capitalized Bitcoin Treasury Company should outperform holding bitcoin directly.",
        expansion:
          "This is why liability quality matters more than liability size. Cheap, long-dated capital deployed into bitcoin that compounds faster than that capital costs is accretive; expensive, short-dated capital is not. It is the economic engine behind Amplification.",
        internalUrl: "https://galaxymind.space/treasuries",
      },
    ],
  },
  {
    slug: "onchain-signals",
    title: "On-chain + cycle signals",
    blurb:
      "The publicly observable Bitcoin metrics used in the Buying Gauge.",
    terms: [
      {
        slug: "mvrv",
        term: "MVRV (Market Value to Realized Value)",
        definition:
          "Bitcoin's market capitalization divided by the aggregate cost basis of all coins (their realized value). MVRV below 1.0 means the average holder is underwater · historically a strong accumulation signal. Every major Bitcoin cycle bottom (Dec 2018, Mar 2020, Nov 2022) printed MVRV below 1.0.",
        sourceUrl: "https://coinmetrics.io/",
        internalUrl: "https://galaxymind.space/stack",
      },
      {
        slug: "puell-multiple",
        term: "Puell Multiple",
        definition:
          "Daily Bitcoin issuance value (in USD) divided by its 365-day moving average. Below 0.5 = miner capitulation · every major cycle bottom landed in this zone. Above 4.0 = miners are over-earning, top territory.",
        sourceUrl: "https://coinmetrics.io/",
        internalUrl: "https://galaxymind.space/stack",
      },
      {
        slug: "mayer-multiple",
        term: "Mayer Multiple",
        definition:
          "Bitcoin's spot price divided by its 200-day moving average. Below 1.0 = price below the long-run trend (historically a green light for accumulators). Above 2.4 = top territory.",
        internalUrl: "https://galaxymind.space/stack",
      },
      {
        slug: "funding-rate",
        term: "Perpetual funding rate",
        definition:
          "The fee paid between long and short holders of a perpetual futures contract, settled every 8 hours. Negative funding = shorts paying longs (bearish positioning, often a contrarian buy signal). Heavily positive funding = longs paying shorts (euphoric leverage, often a sell signal).",
        sourceUrl: "https://www.okx.com/",
        internalUrl: "https://galaxymind.space/stack",
      },
      {
        slug: "fear-greed",
        term: "Crypto Fear & Greed Index",
        definition:
          "A 0-100 composite of crypto market sentiment combining volatility, momentum, social media activity, dominance, and search trends. Below 25 = Extreme Fear (historically excellent accumulation zones). Above 75 = Extreme Greed (historically caution territory).",
        sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
        internalUrl: "https://galaxymind.space/stack",
      },
      {
        slug: "bitcoin-float",
        term: "Bitcoin Float",
        definition:
          "The amount of bitcoin realistically available to buy, after removing the coins that cannot or will not trade. The strict in-play cut used as the headline on /float subtracts provably lost coins, government holdings, spot ETF custody, public-company treasuries, and deep-dormant long-term holdings from the mined supply · roughly 6M BTC of the 21M maximum as of mid-2026, and shrinking structurally · the live number is the /float headline.",
        internalUrl: "https://galaxymind.space/float",
      },
      {
        slug: "halving-runway",
        term: "Halving Runway",
        definition:
          "The schedule of upcoming Bitcoin halving events compared to current daily demand absorption. Each halving cuts the daily mining issuance in half on a known block-height schedule (every 210,000 blocks ≈ every 4 years). Today's demand absorbs ~6× the new mining supply; after the next halving (April 2028), the ratio doubles overnight.",
        internalUrl: "https://galaxymind.space/float",
      },
      {
        slug: "demand-mining-ratio",
        term: "Demand-mining ratio",
        definition:
          "How many times current daily bitcoin demand exceeds the new supply minted by miners each day. A ratio of 6× means buyers are absorbing six bitcoin for every one freshly mined. Because mining issuance is fixed and halves every four years, a demand-mining ratio above 1 is the structural scarcity pressure behind the float shrinking over time.",
        expansion:
          "The ratio jumps discontinuously at each halving: if demand holds steady, a 6× ratio becomes 12× the day issuance is cut in half. This is the supply-side argument the /float page visualizes.",
        internalUrl: "https://galaxymind.space/float",
      },
      {
        slug: "in-play",
        term: "In-play supply (in-play BTC)",
        definition:
          "The bitcoin realistically able to change hands: mined supply minus provably lost coins, government-seized holdings, spot-ETF custody, and public-company treasuries. It is the headline number on the Galaxy Mind float tracker and the strictest practical answer to \"how much bitcoin is actually left to buy.\"",
        expansion:
          "Distinct from \"circulating supply\" (which counts lost and locked coins as circulating) and from exchange balances (which measure only custodial liquidity). In-play shrinks structurally: ETFs and treasuries absorb coins daily while mining issuance halves every four years.",
        internalUrl: "https://galaxymind.space/float",
      },
      {
        slug: "realized-volatility",
        term: "Realized volatility",
        definition:
          "The actual, backward-looking volatility of bitcoin's price over a trailing window (Galaxy Mind uses 30 days), expressed as an annualized percentage. Unlike implied volatility, which is the market's forecast priced into options, realized volatility measures what already happened. It is one of the ten weighted signals in the Buying Gauge: unusually low realized volatility often precedes large moves.",
        sourceUrl: "https://coinmetrics.io/",
        internalUrl: "https://galaxymind.space/stack",
      },
    ],
  },
  {
    slug: "buying-custody",
    title: "Buying & custody basics",
    blurb:
      "Plain-language terms for actually acquiring and holding bitcoin · the vocabulary behind the gauge, the allocation engine, and the vendor directory.",
    terms: [
      {
        slug: "dollar-cost-averaging",
        term: "Dollar-cost averaging (DCA)",
        definition:
          "Buying a fixed dollar amount of bitcoin on a regular schedule (for example, every week) regardless of price. DCA removes the need to time the market: you buy more when the price is low and less when it is high, smoothing your average entry over time. It is the default strategy the Buying Gauge assumes when conditions are mixed.",
        expansion:
          "The Buying Gauge does not replace DCA · it tells you when to lean into or ease off your scheduled buys. A STACK NOW reading is a cue to deploy extra on top of the baseline DCA, not to abandon the schedule.",
        internalUrl: "https://galaxymind.space/stack",
      },
      {
        slug: "spot-bitcoin-etf",
        term: "Spot Bitcoin ETF",
        definition:
          "An exchange-traded fund that holds actual bitcoin and whose shares track the spot price one-to-one, minus a small annual expense ratio. Examples include BlackRock's IBIT (0.25% fee), Fidelity's FBTC, and others. A spot ETF gives bitcoin price exposure inside an ordinary brokerage or retirement account without self-custody, in exchange for the fund fee and trusting the custodian.",
        expansion:
          "Spot ETFs differ from a Bitcoin treasury company like MSTR: an ETF tracks spot with no leverage or premium, while a treasury equity adds operating leverage and trades at an mNAV premium or discount. The /ibit-vs-mstr page compares the two live.",
        internalUrl: "https://galaxymind.space/ibit-vs-mstr",
      },
      {
        slug: "lightning-network",
        term: "Lightning Network",
        definition:
          "A payment layer built on top of Bitcoin that settles transactions instantly and for fractions of a cent by moving them off the main chain into payment channels. It is what makes bitcoin practical for everyday purchases like coffee. Many vendors in the Galaxy Mind directory accept Lightning, often via a human-readable Lightning address that looks like an email.",
        sourceUrl: "https://lightning.network/",
        internalUrl: "https://galaxymind.space",
      },
      {
        slug: "self-custody",
        term: "Self-custody",
        definition:
          "Holding your own bitcoin directly, controlling the private keys yourself, rather than leaving it with an exchange, ETF, or other third party. The phrase 'not your keys, not your coins' captures the trade-off: self-custody removes counterparty risk but puts the responsibility for key security entirely on you. It is the opposite end of the spectrum from holding a spot ETF.",
        internalUrl: "https://galaxymind.space/fit",
      },
      {
        slug: "spend-and-replace",
        term: "Spend and replace",
        definition:
          "A habit that lets you use bitcoin as money without shrinking your stack: pay a merchant in bitcoin, then immediately rebuy the same amount with fiat on your usual exchange or DCA. Your bitcoin balance ends up unchanged while bitcoin still circulates as a medium of exchange, which is what grows the circular economy.",
        expansion:
          "It resolves the Gresham's-law tension that makes pure hoarding rational for an individual but self-defeating for bitcoin's monetization: spend-and-replace is not spend OR hold, it is both at once. It is how working circular economies like Bitcoin Beach sustain themselves.",
        internalUrl: "https://galaxymind.space/spend-and-replace",
      },
      {
        slug: "bitcoin-circular-economy",
        term: "Bitcoin circular economy",
        definition:
          "A local or online economy where bitcoin is earned, spent, and re-spent as money rather than only held, so it keeps circulating between people and merchants instead of leaving the bitcoin economy. Examples include Bitcoin Beach (El Zonte, El Salvador) and Bitcoin Ekasi (South Africa).",
        expansion:
          "Circular economies depend on bitcoin staying in motion. Spend-and-replace is the individual behavior that keeps the loop alive: more spenders give merchants a reason to accept bitcoin, and more merchants give holders more places to spend.",
        internalUrl: "https://galaxymind.space/spend-and-replace",
      },
      {
        slug: "hifo",
        term: "HIFO (Highest In, First Out)",
        definition:
          "A cost-basis accounting method, a form of specific identification, where you dispose of the bitcoin lots with the highest purchase price first. Because the highest-cost coins have appreciated the least, HIFO minimizes the taxable capital gain (or maximizes the loss) on each sale or spend. In the US the default is FIFO unless you specifically identify lots with adequate records.",
        expansion:
          "HIFO pairs naturally with spend-and-replace: replacing constantly mints fresh lots at the current price, so spending the highest-basis coins first realizes little or no gain while long-held low-basis coins keep deferring. Requires contemporaneous records (acquisition date, cost, wallet) and is US-centric. Not tax advice.",
        internalUrl: "https://galaxymind.space/spend-and-replace",
      },
    ],
  },
  {
    slug: "buying-gauge",
    title: "Buying Gauge vocabulary",
    blurb:
      "How the Galaxy Mind Buying Gauge translates 10 weighted signals into a single 0-100 verdict.",
    terms: [
      {
        slug: "buying-gauge-tier",
        term: "Buying Gauge tier",
        definition:
          "The five-tier mapping from the Buying Gauge's 0-100 score to a plain-language verdict. HOLD (0-20) = euphoric crowd, patience. STACK SMALL (21-40) = below-average entry, no edge. STACK (41-60) = mixed signals, DCA on schedule. STACK NOW (61-80) = conditions favorable, stack with conviction. STACK HUGE (81-100) = blood-in-the-streets territory.",
        internalUrl: "https://galaxymind.space/stack",
      },
      {
        slug: "buying-gauge-score",
        term: "Buying Gauge score",
        definition:
          "A 0-100 verdict computed from 10 weighted signals: MVRV (16%), Mayer Multiple (14%), Puell Multiple (13%), Funding Rate (12%), Fear & Greed (10%), Price vs 30-day MA (9%), 30-day Realized Vol (7%), Hour-of-Day (7%), Day-of-Week (6%), MSTR mNAV (6%). When a signal is null (upstream outage), its weight is redistributed proportionally across the survivors.",
        internalUrl: "https://galaxymind.space/stack",
      },
      {
        slug: "degraded-snapshot",
        term: "Degraded snapshot",
        definition:
          "A market snapshot in which 4 or more of the 8 weight-bearing market signals are null. Cron jobs that send email alerts refuse to fire on a degraded snapshot · this prevents Galaxy Mind from broadcasting decisions based on the all-null fallback (score=50, tier=WARM) during multi-day upstream outages.",
      },
    ],
  },
  {
    slug: "allocation-engine",
    title: "Allocation engine vocabulary",
    blurb:
      "Terms used by the /fit decision engine and its sleeve recommendations.",
    terms: [
      {
        slug: "sleeve",
        term: "Sleeve (allocation)",
        definition:
          "A single position in a recommended portfolio. Each sleeve has a role (anchor / accretion / hedge / yield / leverage / spot), an asset, and a weight that sums with the others to 100%.",
        internalUrl: "https://galaxymind.space/fit",
      },
      {
        slug: "volatility-tolerance",
        term: "Volatility tolerance",
        definition:
          "User-selected appetite for portfolio volatility, on a 6-tier scale from Minimal (sleep at night, STRC + SATA only) to Ludicrous (heavy 2× leveraged sleeves). Higher tolerance unlocks more aggressive sleeves; the engine guarantees expected return is non-decreasing as tolerance rises (monotonicity invariant).",
        internalUrl: "https://galaxymind.space/fit",
      },
      {
        slug: "sharpe-ratio",
        term: "Sharpe ratio",
        definition:
          "A measure of risk-adjusted return: (expected return − risk-free rate) / volatility. Higher is better. Galaxy Mind uses a 4.3% risk-free rate (3-month Treasury, mid-2026). The engine computes Sharpe at the portfolio level, factoring in correlation between sleeves.",
        internalUrl: "https://galaxymind.space/fit",
      },
    ],
  },
];

// Flat list of all terms · convenient for the JSON-LD generator and
// for /api routes that might want to expose the full term set.
export const ALL_TERMS: GlossaryTerm[] = GLOSSARY.flatMap((s) => s.terms);
