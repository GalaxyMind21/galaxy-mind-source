// Deep-dive content for /glossary/[slug] pages · the depth layer on
// top of lib/glossary.ts (content pass 2026-06-12).
//
// Why a separate file: lib/glossary.ts is the citable contract · its
// definitions feed the DefinedTerm JSON-LD, llms.txt, and the MCP
// get_glossary_term tool, and scripts/check-llms-txt.ts guards their
// sync. This file is presentation-only prose the term PAGES render
// below that contract. Adding or editing a deep dive can never break
// the citable layer.
//
// Every term gets three blocks:
//   howToRead   · interpretation bands, what moves it, traps
//   onGalaxyMind· where it lives on this site and what it drives
//   context     · historical anchors and practical framing
//
// Voice: plain, confident, no hedging filler. Numbers are either
// stable historical anchors or explicitly stamped "as of mid-2026".

export type DeepDive = {
  howToRead: string;
  onGalaxyMind: string;
  context: string;
};

export const DEEP_DIVES: Record<string, DeepDive> = {
  // ── Treasury company metrics ────────────────────────────────────
  mnav: {
    howToRead:
      "Read mNAV as the price of the wrapper. At 1.0× you pay exactly what the company's bitcoin is worth. At 1.5× you pay fifty percent extra for management, leverage, and the accretion machine. Below 1.0× the market is handing you bitcoin at a discount through the equity, which usually signals doubt about the company itself. The trap: mNAV alone ignores debt structure and dilution terms, so a deep discount sometimes means the market sees a problem you do not.",
    onGalaxyMind:
      "mNAV is the organizing number of the /treasuries scoreboard: every tracked company (MSTR, XXI, MPJPY, ASST) is ranked by it live, the cheapest gets the green pill, and the richest gets the red one. MSTR's mNAV is also one of the ten Buying Gauge signals at 6% weight: a rich premium reads as crowd euphoria, a compressed one as fear. The cheap and rich mNAV email alerts fire from the same number.",
    context:
      "MSTR has traded from roughly 1.0× in deep bear markets to above 3.0× at peak euphoria. Twenty One Capital (XXI) has historically printed 0.7× to 1.2×, regularly offering treasury exposure below the value of its coins. The 1.6× line the site flags as rich is not magic, it is simply the zone where buying the wrapper has historically been worse than buying spot bitcoin outright.",
  },
  "btc-per-share": {
    howToRead:
      "This is the only treasury number that compounds for you. Price per share and mNAV bounce around with sentiment, but BTC per share only moves when the company actually adds or sheds coins relative to its share count. Read it quarter over quarter: a rising line means the flywheel works, a flat line means you own an expensive spot proxy, a falling line means dilution is eating the thesis.",
    onGalaxyMind:
      "The /treasuries table carries BTC holdings and market cap per company, which together give you this figure, and the per-ticker pages chart its inputs over time. The allocation engine on /fit leans on the same idea: MSTR anchors aggressive long-horizon portfolios precisely because BTC per share has historically grown every quarter.",
    context:
      "Strategy sat at roughly 0.00124 BTC per share (about 124,000 sats) as of mid-2026, up from under 90,000 sats two years earlier. Saylor's framing is that a share of MSTR is a claim on a growing stack: dilution that grows the stack faster than the share count is a feature, not a cost.",
  },
  "effective-btc-price": {
    howToRead:
      "Multiply spot by mNAV and you get the price you are actually paying per coin through the stock. If spot is $60,000 and mNAV is 1.4×, your effective price is $84,000. Compare that number, not the share price, against what you would pay on an exchange. When effective price drops below spot, the equity is the cheaper way in, before considering custody and tax differences.",
    onGalaxyMind:
      "The /treasuries table shows effective BTC price as its decision column, color-coded: cyan when you are buying coins at a discount through the equity, orange when the premium is rich, muted inside the five percent band where the difference is noise. The /mstr-vs-bitcoin page is built entirely around this comparison, live.",
    context:
      "The spread moves more than people expect: the same company can offer coins at a ten percent discount in a fearful quarter and charge a sixty percent premium two quarters later. Buyers who anchor on share price history instead of effective BTC price routinely overpay at exactly the wrong moment.",
  },
  accretion: {
    howToRead:
      "The test is simple: did BTC per share rise through the financing? Issuing stock at 2.0× mNAV to buy coins is massively accretive, each dollar raised buys a full dollar of bitcoin while costing shareholders only half a dollar of stack. The same issuance at 0.9× destroys value. So accretion is not a property of the company, it is a property of the premium at the moment of issuance.",
    onGalaxyMind:
      "Accretion is why the /treasuries scoreboard watches premiums so closely: a company trading rich has a working accretion engine, and the market knows it, which partly justifies the premium. It is also wired into the /fit engine's logic: rich premiums trim treasury sleeves toward spot bitcoin, compressed premiums hold the full sleeve.",
    context:
      "Strategy invented the modern playbook: sell equity and convertible debt into a premium, buy bitcoin, grow sats per share, repeat. The flywheel runs as long as the premium holds. The bear case has always been the same: at sub-1.0× mNAV the machine runs in reverse, which is why the discount zone is simultaneously the value zone and the danger zone.",
  },

  // ── On-chain + cycle signals ────────────────────────────────────
  mvrv: {
    howToRead:
      "MVRV compares what the market says all coins are worth against what holders actually paid. Below 1.0 the average holder is underwater, which historically marks capitulation. Between 1.0 and 2.5 is the unremarkable middle. Above 3.5 the average coin has more than tripled and the urge to take profit becomes a structural headwind. It is a slow, cycle-scale signal: useless for timing a week, excellent for telling you which part of the cycle you are standing in.",
    onGalaxyMind:
      "MVRV is the heaviest signal in the Buying Gauge at 16%. The /stack signal cockpit shows its current value, its normalized 0-100 contribution, and a 30-day sparkline. When Coinmetrics is unreachable the gauge redistributes the weight rather than guessing, and the signal card says so.",
    context:
      "Every major cycle bottom printed MVRV below 1.0: December 2018, March 2020, November 2022. Every major top printed above 3.5, and the 2017 peak reached nearly 4.7. The metric's power is its memory: realized value moves slowly because it reprices only when coins actually move.",
  },
  "puell-multiple": {
    howToRead:
      "Puell measures miner income against its own yearly average. Below 0.5 means miners are earning half their normal take, the zone where weak miners shut off machines and forced selling exhausts itself. Above 4.0 means miners are over-earning, which historically coincides with price tops. Between those bands it says little. Note that halvings mechanically cut the numerator, so readings straddling a halving need care.",
    onGalaxyMind:
      "Puell carries 13% of the Buying Gauge. The /stack cockpit computes it from Coinmetrics daily issuance value against the 365-day average, and the methodology page documents the exact construction so the number is reproducible.",
    context:
      "Every major bottom since 2012 has landed in the sub-0.5 zone, including the post-FTX November 2022 low. The signal is one of the few that reads the supply side directly: it tracks the people who must sell bitcoin to pay power bills, which is why capitulation there has been such a reliable floor marker.",
  },
  "mayer-multiple": {
    howToRead:
      "Price divided by the 200-day moving average. Below 1.0 you are buying under the long-run trend, the accumulation zone. Around 1.0 to 1.5 is trend-following territory. Above 2.4 price has run far ahead of trend and mean reversion historically follows. It is the simplest of the cycle signals and the easiest to verify yourself with nothing but a price chart.",
    onGalaxyMind:
      "Mayer is the second-heaviest Buying Gauge signal at 14%. Because it needs only price history, it is also the gauge's most outage-resistant input: when fancier on-chain feeds drop, Mayer usually keeps reporting.",
    context:
      "Trader Mayer popularized the multiple as a discipline tool: systematically buying below 1.0 and sitting on hands above 2.4 has historically beaten lump-sum timing attempts. As bitcoin matures the extremes compress, the 2.4 ceiling was hit routinely in 2013 and 2017 but only briefly since, which is worth remembering when waiting for textbook extremes.",
  },
  "funding-rate": {
    howToRead:
      "Funding is the crowd's leverage talking. Positive funding means longs pay shorts to keep their positions, so the leveraged crowd is bullish. Heavily positive funding is euphoria on margin, fragile and prone to long squeezes. Negative funding means shorts pay longs, fear on margin, and short squeezes fuel sharp rallies. The baseline is around +0.01% per 8 hours; deviations from that, not the sign alone, carry the signal.",
    onGalaxyMind:
      "Funding carries 12% of the Buying Gauge, read live from the OKX BTC-USDT perpetual. The gauge scores it contrarian: negative funding pushes the score up, frothy funding drags it down. The cockpit card shows the raw 8-hour rate next to its normalized contribution.",
    context:
      "The deepest negative funding prints cluster around capitulation lows, March 2020 being the canonical example, when shorts paid extraordinary rates and the market ripped upward off the bottom. Persistent high funding preceded both the May 2021 and November 2021 drawdowns. Of the gauge's ten signals this is the fastest-moving, and the first to flip when sentiment turns.",
  },
  "fear-greed": {
    howToRead:
      "A 0-100 sentiment composite. Below 25 is Extreme Fear, where the crowd has already sold and forced sellers set prices. Above 75 is Extreme Greed, where the marginal buyer is already in. The middle is noise. Use it strictly as a contrarian input and never alone: fear can stay extreme for months in a genuine bear market.",
    onGalaxyMind:
      "Fear & Greed carries 10% of the Buying Gauge, scored contrarian, fear raises the score and greed lowers it. The cockpit shows today's print and its recent path, and it is one of the inputs the /stack forecast projects forward by hour and day.",
    context:
      "The index spent weeks in single digits at the 2022 bottom near $16,000, and pinned in the 90s near both 2021 tops. Its components, volatility, momentum, social volume, dominance, and search trends, all measure the same crowd from different angles, which is exactly why it works as a contrarian thermometer.",
  },
  "bitcoin-float": {
    howToRead:
      "Float thinking starts from one observation: the 21 million cap is not the supply that matters, because most coins cannot or will not move. Subtract what is provably lost, what governments hold, what sits inside ETFs, what corporate treasuries have locked up, and what is not yet mined, and the purchasable remainder is startlingly small. Read the float as a direction, it only shrinks structurally, rather than as a precise count.",
    onGalaxyMind:
      "The /float page is built around this idea: the reservoir instrument shows the in-play remainder as liquid draining toward the sealed vault, with the mining tap dripping in new supply six times slower than demand removes it. The float milestone email alerts fire when the number crosses round thresholds.",
    context:
      "Estimates of lost coins alone run three to four million. ETFs absorbed over a million coins within two years of approval, and treasuries keep adding. Each halving cuts the refill rate in half, April 2028 drops daily issuance from about 450 to about 225 BTC. The supply squeeze is not an event, it is a schedule.",
  },
  "halving-runway": {
    howToRead:
      "The runway lays the next several halvings against current demand. The key is that demand does not need to grow for scarcity to intensify: issuance halves on a fixed schedule, so a 6× demand-to-mining ratio today becomes 12× in April 2028 and 24× in 2032 with demand merely flat. Read each bar as the same buyers chasing half the new coins.",
    onGalaxyMind:
      "The /float page renders the runway as a four-bar chart of the demand-to-mining ratio at each of the next three halvings, and the reservoir's FORECAST mode animates the same drain through 2036 with a thud at each halving milestone. The /bitcoin-halving-countdown page tracks blocks and days to the next cut, live.",
    context:
      "Halvings land every 210,000 blocks, roughly four years: 2012, 2016, 2020, 2024, next around April 2028. Issuance is currently about 450 BTC per day and absorbs no negotiation: no price, no demand level, no miner lobbying changes the schedule. That predictability is the entire point.",
  },
  "demand-mining-ratio": {
    howToRead:
      "Divide daily coins absorbed by daily coins minted. At 1× the market simply digests new issuance. At 6× buyers need five additional coins from existing holders for every minted one, which is how the float drains. Watch the jumps: the ratio doubles overnight at each halving even when demand goes nowhere.",
    onGalaxyMind:
      "This ratio is the engine of the /float story: the visible difference between the tap dripping every few minutes and the drain pulling every half minute IS the ratio, rendered as plumbing. The halving runway bars project it through the next three halvings.",
    context:
      "As of mid-2026 demand around 2,700 BTC per day stands against about 450 BTC mined, roughly 6×. ETFs alone have frequently absorbed multiples of daily issuance. A ratio persistently above 1 means the marginal coin must come from someone changing their mind about holding, and the price is the instrument that changes minds.",
  },
  "in-play": {
    howToRead:
      "In-play is the strictest practical cut of supply: coins that realistically could trade. It removes the provably lost, government stashes, ETF custody, corporate treasuries, and the deep-dormant cohort that has not moved in many years. What survives is the bitcoin actually available to absorb new demand. Read it next to circulating supply to see how misleading the headline number is.",
    onGalaxyMind:
      "In-play is the liquid in the /float reservoir and the headline 'left to buy' number above it, about 6 million BTC as of mid-2026. The allocation breakdown below the instrument shows exactly which cohort holds every other coin, and the daily snapshot cron keeps a five-year history behind the trend chart.",
    context:
      "Out of roughly 19.9 million mined coins, around 14 million sit in cohorts that have not sold through entire cycles. The hump matters too: in-play ROSE through 2016 as mined coins distributed, peaked near 46% of supply, and has receded since as ETFs and treasuries absorbed it, which is why the reservoir etches its high-water mark at 2016.",
  },
  "realized-volatility": {
    howToRead:
      "Realized vol is what actually happened, annualized from the last 30 days of moves. High vol means wide daily swings and demands smaller position sizes. The subtler read is the opposite end: unusually quiet periods compress like springs, and large moves disproportionately begin from low-vol regimes. Direction is not predicted, only the likelihood of motion.",
    onGalaxyMind:
      "Thirty-day realized vol carries 7% of the Buying Gauge, scored to favor calm accumulation windows. It also feeds /fit directly: the engine sizes sleeves against your volatility tolerance, and live vol shifts what the same tolerance can hold.",
    context:
      "Bitcoin's realized vol has trended down across cycles, from routine 100%+ annualized readings in the early years toward ranges that overlap high-beta tech equities. It remains several times the volatility of gold or broad indices, which is exactly why position sizing, not signal timing, is where most investors actually fail.",
  },

  // ── Buying & custody basics ─────────────────────────────────────
  "dollar-cost-averaging": {
    howToRead:
      "DCA converts a timing problem into a discipline problem. A fixed dollar amount on a fixed schedule mechanically buys more coin when price is low and less when it is high. Its true value is behavioral: the schedule keeps you buying through the exact periods your instincts scream to stop, which is where most of a cycle's return concentrates.",
    onGalaxyMind:
      "DCA is the assumed baseline of the whole Buying Gauge: the tiers are phrased as adjustments to a schedule you already run, lean in at STACK NOW, stay the course at STACK, never abandon. The /stack DCA backtest lets you replay any weekly amount against the actual hourly price series, with one-tap 3-month to max-history windows.",
    context:
      "Backtests across bitcoin's history show simple weekly DCA beating the large majority of attempted market timing, primarily because timers miss the violent recovery days that cluster near bottoms. The strategy's weakness is symmetrical: it also buys through tops, which is exactly the gap the gauge's lean-in and ease-off framing tries to close.",
  },
  "spot-bitcoin-etf": {
    howToRead:
      "A spot ETF is bitcoin exposure in a brokerage wrapper: actual coins in custody, share price tracking spot minus a fee of roughly a quarter percent per year. You give up self-custody and gain retirement-account access, estate simplicity, and zero key management. The fee compounds against you forever, which is the honest price of convenience.",
    onGalaxyMind:
      "ETFs appear twice on the site: as a sleeve option in the /fit allocation engine for accounts where direct custody is impractical, and as a supply-side force on /float, where ETF custody is one of the cohorts draining the in-play reservoir. The /ibit-vs-mstr page compares the ETF wrapper against the treasury-equity wrapper live.",
    context:
      "The January 2024 US approvals changed bitcoin's market structure: IBIT alone became one of the fastest-growing ETFs in history, and the category absorbed over a million coins in its first two years. Every share bought routes demand into coins that leave the tradable float, often permanently.",
  },
  "lightning-network": {
    howToRead:
      "Lightning is bitcoin's spending layer: payment channels settle transfers instantly for fractions of a cent, anchored to the main chain for security. For a buyer the experience is scan, confirm, done. The practical entry point is a Lightning address that looks like an email, which any modern Lightning wallet can pay.",
    onGalaxyMind:
      "Lightning is one of the three vendor platforms in the directory: merchants listed with a Lightning address get a 'Pay via Lightning' action on their cards and pages. The site's own tip jar runs on a Lightning address too. Vendor submissions are verified for native bitcoin rails, on-chain or Lightning, never wrapped tokens.",
    context:
      "Lightning is what makes the circular economy on the homepage possible: coffee, soap, and hardware sold for sats with fees too small to notice. Public capacity numbers understate it, since well-run nodes recycle liquidity privately. The trade-off remains liveness, channels need management, which is why custodial Lightning wallets dominate casual use.",
  },
  "self-custody": {
    howToRead:
      "Self-custody means the keys, and therefore the coins, are yours alone. No exchange failure, no fund gate, no custodian freeze can touch them. The cost is that every safeguard is now your job: seed backup, inheritance planning, physical security. Read the decision as a spectrum, not a purity test, from custodial app to ETF to hardware wallet to multisig, each step trading convenience for sovereignty.",
    onGalaxyMind:
      "The /fit engine respects the spectrum: account type is one of its three inputs, and portfolios differ between taxable brokerage, IRA wrappers, and direct holdings. The vendor directory is the other half of the story, self-custodied sats are most alive when there are merchants to spend them with.",
    context:
      "Every cycle re-teaches the lesson: Mt. Gox, Celsius, FTX. 'Not your keys, not your coins' survives because it keeps being right. The counterweight is the quiet epidemic of lost coins, several million BTC by most estimates, gone to forgotten seeds and dead drives, which is why the honest advice is custody matched to competence, not maximalism.",
  },

  // ── Buying Gauge vocabulary ─────────────────────────────────────
  "buying-gauge-tier": {
    howToRead:
      "The tiers translate a number into posture. HOLD says the crowd is euphoric, patience pays. STACK SMALL says entries are below average. STACK is the mixed middle: stay on schedule. STACK NOW says conditions historically favored buyers, lean in. STACK HUGE marks blood-in-the-streets extremes that have appeared a handful of times per cycle. The boundaries are even 20-point bands, deliberately simple.",
    onGalaxyMind:
      "The tier is the color and the label everywhere the gauge appears: the needle zone on /stack, the embed widget, the SVG badge, the shared verdict cards, and the tier-flip email alert that fires when the gauge crosses from one band into another.",
    context:
      "The tier exists because a bare 77 invites overthinking while STACK NOW invites action. The site keeps tier history in the gauge's daily KV snapshots, which is what powers the highest-since line under the dial and the 30-day trail in the sparkline.",
  },
  "buying-gauge-score": {
    howToRead:
      "The score is a weighted blend of ten signals, each normalized to 0-100 before weighting, so no single input can dominate beyond its assigned share. Cycle-scale value signals (MVRV, Mayer, Puell) carry over 40% combined; sentiment and positioning carry the middle; small time-of-day and day-of-week effects power the forecast surface. Treat single-digit moves as noise and tier changes as signal.",
    onGalaxyMind:
      "The score drives everything on /stack: the needle, the tier, the 7-day hourly forecast, the alert thresholds at 80 and 20, and the daily KV snapshot that builds the history line. The signal cockpit shows every input's raw value, normalized score, and weight so the blend is fully auditable, and the influence panel lets you bend each slider to see the math respond.",
    context:
      "Two design rules keep the score honest: null signals redistribute their weight instead of being silently scored neutral, and the all-null fallback pins to exactly 50 WARM so an outage can never masquerade as a verdict. Both are enforced by the test suite, and the degraded banner tells you when the redistribution is active.",
  },
  "degraded-snapshot": {
    howToRead:
      "Degraded means too many upstream feeds failed at once for the verdict to be trustworthy: four or more of the eight weight-bearing market signals returned null. The math still produces a number, but the site treats it as a placeholder, not a reading. When you see the degraded banner, the right read is 'data outage', not 'neutral market'.",
    onGalaxyMind:
      "The degraded flag is wired end to end: /stack, /treasuries, and /float show an honesty banner, every public API response carries a degraded boolean, the MCP tools pass it through to AI assistants, and all the alert crons refuse to fire on a degraded snapshot so no email or push ever broadcasts the fallback score.",
    context:
      "The rule exists because the all-null fallback is score 50, tier WARM, which looks exactly like a genuine mixed-market verdict. During one multi-day upstream outage that distinction is the difference between subscribers receiving fabricated signals and receiving silence. Silence won, permanently.",
  },

  // ── Allocation engine vocabulary ────────────────────────────────
  sleeve: {
    howToRead:
      "A sleeve is one slot in the portfolio with a job description: anchor for the core conviction position, accretion for treasury-equity compounding, hedge, yield, leverage, or plain spot. Weights sum to 100. Reading a recommendation sleeve by sleeve tells you what the engine thinks your constraints allow, which is more informative than the headline expected return.",
    onGalaxyMind:
      "Every /fit recommendation is one to four-plus sleeves, each with its role, asset, and weight, plus the caveats the engine attaches. The sticky portfolio bar mirrors the top sleeves as you scroll, and the weekly fit-change alert emails you when your saved inputs would now produce a meaningfully different sleeve set.",
    context:
      "The sleeve vocabulary keeps the engine honest about purpose: when the diversifier sleeve picks whichever treasury is cheapest on mNAV that day, or the yield sleeve refuses to appear beyond a two-year horizon because NAV decay overwhelms distributions, each rule is legible because each sleeve has a stated job.",
  },
  "volatility-tolerance": {
    howToRead:
      "Tolerance is a promise about behavior, not a personality quiz: it asks how deep a drawdown you can watch without selling. The six tiers run from Minimal, which holds only the income instruments, to Ludicrous, which carries leveraged sleeves with brutal interim swings. The honest read is one notch below where your ego points, because the tolerance that matters is the one you have at minus sixty percent.",
    onGalaxyMind:
      "Tolerance is the first dial on /fit and the engine's hardest constraint: STRK never appears in Minimal portfolios, leverage only unlocks at the top tiers, and expected return is guaranteed non-decreasing as tolerance rises, a monotonicity invariant the test suite enforces on every engine change.",
    context:
      "Bitcoin has drawn down more than seventy-five percent from its high in every completed cycle. Every tier of the engine is calibrated against that reality: the question is never whether a deep drawdown comes, it is which instruments you can hold through it without converting a temporary loss into a permanent one.",
  },
  "sharpe-ratio": {
    howToRead:
      "Sharpe asks how much return you earn per unit of volatility endured, above what cash pays risk-free. Below 0.5 the ride is poorly paid. Around 1.0 is solid. Above 1.5 is excellent and rarely persists. Its known blind spot: volatility counts upside swings as risk, which systematically understates explosive assets like bitcoin. Compare Sharpe between portfolios, never in isolation.",
    onGalaxyMind:
      "Every /fit recommendation reports a portfolio-level Sharpe computed against a 4.3% risk-free rate, the mid-2026 three-month Treasury yield, with sleeve correlations factored in rather than naively summed. It is the number that lets a Minimal income portfolio and a Ludicrous leveraged one be compared on the same axis.",
    context:
      "Despite its violence, bitcoin's long-run Sharpe has beaten most major asset classes across full cycles, the returns overpaid for the volatility. The engine's Minimal tier exists because of Sharpe logic: the income instruments deliver a smoother unit of return, exactly what a sleep-at-night mandate is actually asking for.",
  },
};
