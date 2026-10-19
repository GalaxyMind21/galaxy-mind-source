/* =====================================================================
 * hashrate-copy.ts · every word of /hashrate, in one scannable place.
 *
 * Centralised so the banned-vocabulary gate in scripts/test-hashprice.ts
 * can walk a known set of exported strings instead of grepping meaning
 * out of JSX. Prose typed straight into a component escapes the gate.
 *
 * REWRITTEN 2026-08-02 (operator direction). The first version led with
 * the market's expected value and ranked our rigs against every cheap
 * listing on the rental marketplace. That measured the wrong thing: nobody
 * renting at this scale is trying to out-earn a pool. They are buying a
 * shot at finding a block. Same live numbers, different instrument —
 * and in lottery terms the numbers are good rather than damning.
 *
 * Keep it SHORT. This is a sales page, not an essay.
 * ===================================================================== */

/* ── BLOCK SHOT · the product's name (operator ask, 2026-08-04) ───────
 * One brand word for the rental offering, used everywhere the site
 * points at it: nav, footer, palette, the /today strip, the page
 * eyebrow, the drafts email. The name is the page's own verb ("take a
 * shot at a whole block") promoted to a noun — nothing to re-explain,
 * nothing the vocabulary gate could object to. SEO surfaces keep the
 * query terms ("rent bitcoin hashrate") FIRST; the brand rides behind. */
import { MARKETPLACE_NAME } from "@/lib/marketplace-listing";

export const BRAND_NAME = "Block Shot";
export const BRAND_EYEBROW = "Block Shot · the house fleet";

/**
 * DEMOTED 2026-08-08 (operator call, and the right one).
 *
 * "Block Shot" briefly labelled the offering in the NAV, the ⌘K
 * palette, the footer and the homepage card. That was a mistake:
 * nobody searches for "Block Shot", so a visitor scanning a menu for
 * hashrate rental met a word with no meaning, and a 2.4k-follower
 * account cannot fund a second brand alongside Galaxy Mind. Every
 * NAVIGATIONAL and DISCOVERY label now says what the thing IS; the
 * name survives only as flavor on the page itself (BRAND_EYEBROW,
 * above an H1 that already reads "Rent bitcoin hashrate").
 *
 * The tell that it was never carrying its weight: the SEO titles had
 * to keep the query phrase FIRST and the footer had to gloss it as
 * "Block Shot · rent hashrate" — hedges around a name that needed
 * explaining. If a future agent wants to re-promote it, the bar is
 * evidence that people search the name, not that it sounds cool.
 */
export const NAV_LABEL = "Rent hashrate";

// Title is query phrase + brand. The product name used to sit in the
// middle, spending SERP pixels on a word nobody searches (demotion
// 2026-08-08 · see NAV_LABEL).
// Query-first SEO: people search "rent bitcoin hashrate", "USA ASIC rental",
// "solo mining hashrate" — not brand flavor. Keep the money phrase first.
// 2026-10-17 SEO pass (operator: lead with hash power, not miner models).
// Every top-ranking rental page titles itself [Rent|Buy] Bitcoin Hashrate
// + qualifier + brand, and none of them names hardware.
export const PAGE_TITLE =
  "Rent Bitcoin Hashrate (SHA-256) by the Day · Galaxy Mind";

/** The visible H1 on /hashrate. Query phrase first, as the title. */
export const PAGE_H1 = "Rent Bitcoin hashrate by the day";

/** SERP snippet and social card. Lives here so the gate can scan it. */
export const PAGE_DESCRIPTION =
  "Rent SHA-256 Bitcoin hash power by the day, for 1 to 7 days, from a US-based fleet already hashing. Point it at any pool, solo included, and pay from your own wallet. No account.";

export const MASTHEAD =
  "US-based hash power, already running. Choose how much hashrate you want for 1 to 7 days, point it at your pool, and any block it finds pays out to you. No account needed.";

// {PRIZE} = current block reward in USD · {ODDS} = best fleet odds
export const HERO_KICKER = "Whoever finds the next block takes";
export const HERO_PRIZE_NOTE =
  "Block subsidy plus fees, at today's bitcoin price. It goes to whoever finds it, including you.";

// "Your shot" was atmospheric; this says what the section DOES
// (operator 2026-08-08: make it obvious how to rent). The #your-shot
// anchor id is unchanged — the hero CTA and inbound links use it.
export const ODDS_TITLE = "Block odds calculator";
export const ODDS_SUB =
  "More machines and a longer window raise the chance of finding a block. Dial both against live network hashrate.";
/** Sits under ODDS_SUB on the chooser — the marketplace handoff is the cliff.
 *  Lead-in only; HOWTO_GUIDE_LINK is the anchor text (already says
 *  "First time?" — do not repeat that here). */
export const ODDS_HOWTO_HINT =
  "Ask your AI bot for a quote, then finish your rental with us.";

export const FLEET_LABEL = "Every open machine";
export const ODDS_BEST_BADGE = "Best odds · multi-machine pack";
export const ODDS_RENT_CTA = "Rent now";
/** The price on screen is the whole pack, and the button opens the checkout
 *  with the whole pack and window filled in (one rental, one payment). */
export const ODDS_RENT_FIRST = "Rent now";
export const ODDS_RENT_FIRST_NOTE =
  "Opens checkout with this pack and window filled in. You can change either there.";
/** Duration picker on the chooser · whole days, 1 to 30. */
export const ODDS_WINDOW_LABEL = "How long do you want it?";
export const ODDS_WINDOW_FOR = "for {WINDOW}";
/** Amount picker on the chooser · people think in machines, not PH. */
export const ODDS_AMOUNT_LABEL = "How much of the fleet?";
export const ODDS_AMOUNT_ONE = "1 machine";
export const ODDS_AMOUNT_ALL = "All open";
export const ODDS_AMOUNT_N = "{N} machines";
/** {CADENCE} = humanizeYears() output ("13 years", "6 months", "9 days").
 *  This is a hashrate fact, not a window fact — same machines, any
 *  duration, same cadence. The 1-in-N is what the window changes. */
export const ODDS_CADENCE =
  "At this hashrate the math says about one block every {CADENCE}.";
export const ODDS_COMPARE_ONE = "1 machine";
export const ODDS_COMPARE_PICK = "Your pick";
export const ODDS_COMPARE_ALL = "All open";
/** {TH} {AMOUNT} {WINDOW} · the line under the big 1-in-N.
 *  {AMOUNT} is ODDS_AMOUNT_ONE / _N / _ALL so "1 machines" cannot happen. */
export const ODDS_SELECTED = "{TH} TH · {AMOUNT} · {WINDOW}";
export const ODDS_RENT_THESE = "The machines";
/** {OPEN} open count · {N} rented count. Used only when some are rented. */
export const ODDS_OCCUPANCY = "{OPEN} open · {N} rented";
/** {OPEN} when every actionable machine is free. */
export const ODDS_OCCUPANCY_ALL_OPEN = "{OPEN} open";
export const ODDS_RENTED_STRIP = "{N} rented right now";
export const ODDS_RENTED_NEXT = "next frees in ~{H}h";
export const ODDS_BAY_OPEN = "Open";
export const ODDS_BAY_RENTED = "Rented";
export const ODDS_SORT_BAY = "Bay";
export const ODDS_NONE_OPEN = "Nothing is open to rent right now.";
export const ODDS_PRIZE_LABEL = "the block pays";
export const ODDS_COST_LABEL = "this rental";
export const ODDS_CHANCE_LABEL = "chance of a block in this window";
/** {N} = extra machines the next pack step adds. */
export const ODDS_NUDGE_MORE = "Add {N} more";
export const ODDS_NUDGE_ALL = "Take every open machine";
/** {WINDOW} = "1 day" / "7 days". */
export const ODDS_NUDGE_LONGER = "Make it {WINDOW}";
/** {ODDS} = "1 in 2,676". */
export const ODDS_NUDGE_BECOMES = "chance becomes {ODDS}";
/** Sits with the price. The next step is another rental, priced. */
export const ODDS_NUDGE_HEAD = "Larger rentals";
/** {CADENCE} = humanizeYears(). Only the more-machines step moves this. */
export const ODDS_NUDGE_CADENCE = "about one block every {CADENCE}";
/** {N} = formatImprovement() output ("19", "2.4"). */
export const ODDS_VS_BASELINE =
  "about {N}× the chance of a 1-day single";
/* ── The draw strip and the odds ladder (ported 2026-08-20) ─────────
 * Two ways of showing the same arithmetic the 1-in-N already states,
 * because 1-in-N alone describes the disappointment and neither of these
 * does.
 *
 * DRAWS: the scale problem on this page is that a machine's share of the
 * network cannot be drawn — it is one pixel in a stadium. The BLOCKS can
 * be counted, though. A window contains a specific, countable number of
 * separate chances, and that is a true picture of what was bought.
 *
 * LADDER: odds span three orders of magnitude between the smallest
 * ticket and the whole fleet for a week, so the rail is LOGARITHMIC and
 * says so. It replaces two text nudges with one picture of where the
 * visitor is standing and what the next step costs.
 */
/* ── WHERE YOU POINT IT · the fork that widens the product ──────────
 * The desk already computes a recovery ratio per rig (hashprice ÷ ask):
 * how much of the rental cost the machine mines back. It was rendered in
 * exactly one place — a state-lottery comparison that was the page's
 * one live bitcoin.org exposure. That comparison is gone.
 *
 * Pulled out and stated plainly it does more work, because it is only
 * true for ONE of the two ways to point a rental, and naming both turns a
 * single hard sale into a choice:
 *   · a normal pool pays steadily, and most of the rent comes back
 *   · a solo pool pays nothing at all until it pays everything
 * A page that only sells the second is selling the harder half.
 *
 * HONESTY CONSTRAINT: the percentage assumes pool-average payouts over
 * many rentals. It is NOT what a solo rental gets, and it is not a
 * guarantee for any single window — hashprice moves and difficulty moves.
 * Never state it without the pool condition attached.
 */
/* ── WHAT THE PREMIUM BUYS · owning the #1 objection ────────────────
 * The loudest complaint in this market is "you will pay more than you
 * can mine with it". True, and unavoidable: renting is always dearer
 * than the same hashrate mines, because the seller carries the hardware,
 * the power contract and the downtime.
 *
 * The recovery percentage above already states that gap numerically, so
 * this sentence supplies the missing half — what the gap BUYS — rather
 * than a second number. Deliberately NOT a price comparison against the
 * order book: publishing "our ask sits N% above the last ten clears" on
 * our own sales page hands a motivated buyer a reason to go shopping,
 * which is the click-through leakage this page already fights. Own the
 * objection with the reason, not with a delta.
 */
export const ODDS_PREMIUM_NOTE =
  "Renting always costs more than the same hashrate mines. The gap is what a short, self-directed window on somebody else's hardware costs. No machine to buy, no power contract, no downtime that is yours to fix.";

/* ── MEASURED vs LISTED · the proof this market never gets ──────────
 * the marketplace publishes a live 5-minute average per rig, and the desk already
 * fetches it. The market's loudest complaint is listings that deliver
 * LESS than advertised; showing the live measured figure next to the
 * listed one is the inverse claim, and it is checkable on the marketplace's own
 * graphs rather than being something we assert.
 *
 * Rendered whatever it says. A machine reconnecting to a new pool ramps
 * for 10–30 minutes, so the honest number sometimes sits UNDER the
 * listed one — that is the same ramp the FAQ already explains, and
 * hiding the figure on those days would make the good days worthless.
 */
export const FLEET_MEASURED_LABEL = "Measuring right now";
/** {LISTED} {MEASURED} — both in TH, already formatted. {N} = how many
 *  machines are behind them.
 *
 *  BOTH FIGURES ARE SCOPED TO THE MACHINES REPORTING (2026-09-05), and
 *  the sentence now says so. They always were: a box with no reading yet
 *  is excluded from the listed side as well as the measured one, because
 *  counting it in the numerator and not the denominator would overstate
 *  the shortfall. But the panel's own header counts the WHOLE fleet, so
 *  a reader who subtracted saw an unexplained gap of exactly one machine
 *  sitting between two adjacent numbers. Naming the population closes
 *  the arithmetic instead of leaving them to guess. */
export const FLEET_MEASURED_NOTE =
  "Listed at {LISTED}, measuring {MEASURED} across the {N} machines reporting right now. We list under peak on purpose, and your pool shows the live figure once you rent.";

export const ODDS_POINT_TITLE = "Where you point it";
/** {PCT} = live recovery ratio for the selected pack, as a percent. */
export const ODDS_POINT_POOL =
  "Point it at a normal pool and about {PCT}% of what you pay comes back as mined bitcoin, spread over the window.";
export const ODDS_POINT_SOLO =
  "Point it at a solo pool and it either finds a block or it does not. Nothing in between, and the whole block is yours if it lands.";
export const ODDS_POINT_NOTE =
  "Same machine, same price. The pool you name when you book decides which of these you are buying.";

/* ── The sticky booking bar ─────────────────────────────────────────
 * The page runs long and every rent control lived inside the chooser, so
 * once a visitor scrolled past it there was no way to act without
 * scrolling back. Mirrors the StickyPortfolioBar / StickyScoreBar idiom
 * already used on /fit and /stack.
 */
export const STICKY_LABEL = "Your pick";
export const STICKY_CTA = "Rent now";
/** {TH} {AMOUNT} {WINDOW} — mirrors ODDS_SELECTED, compressed. */
export const STICKY_SUMMARY = "{TH} TH · {WINDOW}";

export const ODDS_DRAWS_TITLE = "You are in every draw";
/** {N} = blocks the network will find during the chosen window. */
export const ODDS_DRAWS_NOTE =
  "{N} blocks get found worldwide while your rental runs, and your machines are racing for all of them.";
export const ODDS_LADDER_TITLE = "More machines, more days, better shot";
export const ODDS_LADDER_HINT = "Tap ahead on the rail to see what it takes.";
export const ODDS_LADDER_SCALE = "Log scale · each step is a bigger jump than it looks.";
/** {WINDOW} = the shortest window this fleet sells. */
export const ODDS_LADDER_FLOOR = "1 machine · {WINDOW}";
/** {WINDOW} = the longest window this pack can be sold for. */
export const ODDS_LADDER_CEIL = "every open machine · {WINDOW}";
export const ODDS_LADDER_YOU = "you are here";

export const ODDS_BEST_TICKET =
  "Best chance the open fleet can buy right now.";
export const ODDS_STEPPER_DEC = "Fewer";
export const ODDS_STEPPER_INC = "More";
export const ODDS_SORT_LABEL = "Sort miners";
export const ODDS_SORT_PRICE = "Price / TH";
export const ODDS_SORT_POWER = "Hashpower";
export const ODDS_SORT_COST = "Rental cost";
export const ODDS_COL_MACHINE = "Bay";
export const ODDS_COL_POWER = "TH/s";
export const ODDS_COL_PRICE = "$ / TH·day";
export const ODDS_COL_COST = "This window";
/** Said "Two-minute setup" until 2026-08-19, while GUIDE_INTRO, the FAQ
 *  and the how-to page all said "about ten minutes" — two of our own
 *  numbers, five times apart. The honest one is the longer one, and even
 *  it excluded the step we do not control: funding a marketplace balance is an
 *  ON-CHAIN deposit, so the real wait is confirmations on a fee market.
 *  Promising two minutes to someone who is nine minutes into a bitcoin
 *  confirmation teaches them our numbers are decorative, which is an
 *  expensive lesson on a page whose whole pitch is honest arithmetic.
 *  Keep this vague where we cannot be accurate, never optimistic. */
export const ODDS_FIRST_TIME =
  "First time? Here is every step, including the bitcoin deposit";
/** Closed by default. The draw strip and odds ladder are true, and they
 *  used to sit between the price and the rent buttons. */
export const ODDS_PICTURE_SUMMARY = "See how the odds picture is built";
export const ODDS_SHOW_UNAVAILABLE =
  "Show {N} that are not open right now";
export const ODDS_HIDE_UNAVAILABLE = "Hide machines that are not open";
/** Shown when some machines are open AND more are still staging.
 *  Distinct from the sold-out waitlist — that panel would be a lie here. */
export const WAITLIST_COMING_TITLE = "More machines are coming online";
export const WAITLIST_COMING_SUB =
  "Leave your email. We email you when more machines are open to rent. At most one email a day.";
export const WAITLIST_COMING_HEADLINE = "Get on the fleet list";
/** Rented/offline machines keep a link but must not carry a buy verb —
 *  the listing is where a visitor sees when it frees up. The old
 *  "View listing · rent it when it frees" line blew past a 390px row
 *  (micro-label tracking + a shrink-to-content pill). Status already
 *  says when it frees; the button just opens the listing. */
export const ODDS_VIEW_CTA = "How to rent";
export const ODDS_STATUS_AVAILABLE = "available now";
export const ODDS_STATUS_RENTED = "rented right now";
export const ODDS_STATUS_OFFLINE = "offline";
export const ODDS_STATUS_COMING = "coming online";

/* Residual copy for a coming-online summary. The live marketplace never emits
 * that state (operator 2026-09-14); kept so a phantom slot or a
 * fixture can still render. {N} = machine count, {TH} = hashrate. */
export const ODDS_COMING_ONLINE_NOTE =
  "{N} more machines ({TH} TH/s) are racked and listed, still being brought online. They are not bookable yet, and they are counted in the fleet total above rather than in what is open now.";
/** Unit tag distinguishing identical machines — "machine 1", "machine 2". */
/* ── The link to /solo-mining-calculator ────────────────────────────
 * /solo-mining-calculator linked HERE twice; nothing here linked back,
 * so a visitor who already mines and wants to model our machines
 * alongside their own had no route except leaving. The two pages own
 * different intents on purpose — this one owns "rent bitcoin hashrate",
 * that one owns "solo mining calculator" — so the anchor below is
 * deliberately INFORMATIONAL. Pointing a transactional anchor at it
 * would start the two competing for the same phrase, which is the
 * split-relevance trap the homepage and /online-stores-that-accept-
 * bitcoin already document. */
export const CALC_XSELL_LEAD = "Already mining, or sizing up a rig you do not own yet?";
export const CALC_XSELL_LINK = "Model any hashrate over any window";

export const ODDS_MACHINE_WORD = "machine";
// {H} = whole hours until the current rental ends (from the live feed)
export const ODDS_FREES_IN = "frees in ~{H}h";
export const HERO_CTA_LABEL = "Rent hashrate";
/** Shown INSTEAD of the rent CTA when the whole fleet is booked. A
 *  button reading "Rent now" that lands on a chooser with nothing
 *  rentable is a small lie; this keeps the hero honest without hiding
 *  the section. */
export const HERO_CTA_LABEL_NONE = "See availability";
/** Hero ticket under the prize drum · {PRICE} is the cheapest day, {TH}
 *  is bookable hashrate. Only rendered when a machine is actually open. */
export const HERO_TICKET_OPEN =
  "One day on a full-size machine is about {PRICE}. {TH} TH is open now.";
export const HERO_TICKET_NONE =
  "No machine is bookable right now. See availability below.";
export const FLEET_NOTE =
  "Each bay is one of our machines. Open ones you can take now. Rented ones come back when their window ends.";

/** Waitlist when sold out — email via existing /api/subscribe source=hashrate */
/* Fires whenever NOTHING is available, which since 2026-08-08 has two
 * causes: the live machines are all rented, or the rest are still being
 * brought online. "Every machine is rented" was true under the first and
 * false under the second, so the title states the fact the panel is
 * actually gated on. */
export const WAITLIST_TITLE = "Nothing is open to rent right now";
export const WAITLIST_SUB =
  "Leave your email. We email you when another USA machine opens. At most one email a day.";
/** Chooser empty-state when the feed is up but nothing is bookable.
 *  Distinct from RIG_SYNCING_NOTE: ourRigs being non-empty means the marketplace
 *  answered; collapsing that into SYNCING was a conversion-killing lie. */
export const ODDS_EMPTY_TITLE = "Nothing to book right now";
export const ODDS_EMPTY_COMING =
  "The rest of the fleet is racked and listed, still being brought online. Leave your email below for the fleet list.";
export const ODDS_EMPTY_RENTED =
  "Every live machine is rented. They free up on a rolling basis. Leave your email below for the fleet list.";
export const WAITLIST_HEADLINE = "Get on the fleet list";
export const WAITLIST_SUCCESS =
  "Check your inbox to confirm.";

// {RETURN} = stake-return percentage, live
// {YEARS} = 7-day fleet odds translated to a once-every-N-years cadence,
// computed live from the same blockOdds() the cards quote.
export const ODDS_YEAR_SCALE =
  "At those 7-day odds, a renter going back-to-back all year would statistically land a block about once every {YEARS} years.";


export const FLEET_GAUGE_TITLE = "Galaxy Mind total hashpower";

/** Label beside the live availability figure (the number renders separately). */
export const FLEET_GAUGE_AVAILABLE = "available to rent right now";

/** Label beside the live machine count (the integer renders separately). */
export const FLEET_GAUGE_MACHINES = "machines";

export const FLEET_GAUGE_NOTE =
  "SHA256 hashpower from our own fleet. Each block in the bar above is a machine, sized to its output; availability updates live from our fleet feed.";

export const HISTORY_TITLE = "Hashprice trail";
export const HISTORY_SUB =
  "BTC per PH per day, from the same desk that prices the fleet.";
export const HISTORY_EMPTY =
  "History accumulating. The daily snapshot needs a week of rows before a trail is honest.";

export const WHY_TITLE = "Why rent ours";

export const WHY_POINTS: string[] = [
  "Named machines already hashing, professionally hosted in the US. Point them at your pool and wallet as soon as the rental starts.",
  "USA latency. Lower ping to US solo and pool endpoints than EU/Asia farms, so shares land faster and setup is simpler if your pool is in the States.",
  "Reliable power and cooling, professionally run. Uptime is how we keep RPI and repeat renters.",
  // No hardcoded TH figure here on purpose: the chooser renders each
  // machine's live listed hashrate, and a number frozen into prose goes
  // stale the moment a listing moves (this line said 255 while every
  // machine listed at 260).
  "Current-generation machines, each listed at its own hashrate rather than a vague fleet average.",
  "We deliberately list under peak speed. After a pool switch the graph ramps for about 10–30 minutes; under-listing means the hashrate you booked shows up for the bulk of the window.",
  "People answer when something looks off, and every rental supports US mining jobs.",
  `You choose your own pool and payout wallet on ${MARKETPLACE_NAME}: any SHA-256 pool, a solo pool or your own node. The machine switches over as soon as the rental starts. Stack multiple Galaxy Mind machines for better combined odds.`,
];

/* ── From click to hashing · the marketplace-handoff walkthrough ──────────────
 * Every rent CTA lands on a dense marketplace listing with three
 * unannounced setup steps between the visitor and a running rental.
 * Naming the steps up front is the difference between a bounce and a
 * booking. Kept in the marketplace's own vocabulary (account · balance · pool
 * profile) so nothing here goes stale when their UI restyles. */
export const HOWTO_TITLE = "What happens after you click rent";
/** Link out to the full walkthrough · the four steps below are the
 *  summary, the guide page is the hand-holding version (operator ask
 *  2026-08-08: people need to know what to do once the marketplace loads). */
export const HOWTO_GUIDE_LINK = "First time? Read the step-by-step guide";
export const HOWTO_STEPS: string[] = [
  "Ask your AI bot, or the Galaxy Mind MCP, which machines are available.",
  "Get a quote for the machines and days you want.",
  "Finish your rental and set your own pool and payout address. For a solo attempt, use any solo pool with your own payout address.",
  "Check status any time with your access code.",
];

/* ═══ /hashrate/how-to-rent · the hand-holding walkthrough ════════════
 * Operator ask 2026-08-08: "give people a way to guide them step by
 * step as to how to rent, aka what to do once they click rent now and
 * get forwarded to the rental marketplace." The four-step summary on
 * /hashrate answers "what happens"; this page answers "what do I click".
 *
 * Every mechanic here is one the repo already relies on in code, not
 * a guess about somebody else's UI: the captcha-gated signup and
 * balance funding come from QUOTE_PREREQS, the algo-must-match rule and
 * duration-before-price validation come from the live key-scope probe
 * (scripts/check-mrr-key-scope.ts, the README), and the marketplace fee
 * note is QUOTE_FEE_NOTE. Deliberately NO screenshots and NO
 * click-by-click UI choreography: the marketplace restyles on its own schedule and
 * a stale screenshot is worse than none. Describe the NOUNS (account,
 * balance, pool profile, listing) — those are stable.
 * ═══════════════════════════════════════════════════════════════════ */
export const GUIDE_PAGE_TITLE =
  "How to Rent Bitcoin Hashrate, Step by Step · Galaxy Mind";
export const GUIDE_PAGE_DESCRIPTION =
  "How to rent SHA256 hashrate step by step, in your browser or through your AI: pick rigs and days, choose the pool that decides where a block lands, pay in USDC, and the one first-run mistake.";
export const GUIDE_MASTHEAD =
  "Rent in your browser, or ask your AI. No account needed. It takes a few minutes, and here is every step.";

export const GUIDE_PREREQ_TITLE = "What you need first";
export const GUIDE_PREREQS: string[] = [
  "A wallet with USDC on Base (Coinbase Wallet, a Base Account passkey, MetaMask or any wallet that can sign on Base).",
  "A payout address for any block you might find. Use an address from your own wallet, never an exchange deposit address.",
  "A few minutes. No account needed: you get a private access code after you pay.",
];

export const GUIDE_STEPS: { title: string; body: string; note?: string }[] = [
  {
    title: "Rent in your browser, or ask your AI",
    body: "Open galaxymind.space/hashrate/rent and pick your rigs and days, or ask your AI bot through the Galaxy Mind MCP. Both show the same open bays and the same price.",
  },
  {
    title: "Get a quote",
    body: "Ask for a quote for the number of rigs and days you want. Rentals are quoted in whole S21 XP rigs (270 TH each) and whole days, 1 to 7 during the pilot. The checkout, the page and your AI all show the same price, valid for 15 minutes.",
  },
  {
    title: "Accept the terms and pay",
    body: "Accept the Rental Terms and pay in USDC on Base from your wallet, or scan the QR code to pay from your phone. An AI bot uses the create_rental tool and hands you the same payment.",
  },
  {
    title: "Point it at your pool",
    body: "Pick a pool from the list and enter your username in that pool's format (shown under the field). For a solo attempt pick any solo pool with your own bitcoin address as the username, so a found block pays out to you and nobody else. Any other public pool works too as host:port; it is checked by hand after payment.",
  },
  {
    title: "Check status with your access code",
    body: "You receive a private access code once your rigs are switched. Keep it like a password. Use it in Check a rental on the page, or give it to your AI to check status.",
  },
];

export const GUIDE_MISTAKES_TITLE = "The thing that goes wrong";
export const GUIDE_MISTAKES: string[] = [
  "Using an exchange deposit address as the solo payout address. Exchanges credit expected deposits, not surprise block rewards, and some will not credit it at all. Use an address from a wallet you hold the keys to.",
];

export const GUIDE_CLOSING_TITLE = "Then what?";
export const GUIDE_CLOSING =
  "That is the whole loop. Most people rent one day the first time to watch how it works (expect the hashrate graph to climb for the first 10–30 minutes after the pool switch), then decide whether a longer rental is worth it. The odds on the rental page update with the live network, so the number you see is the number you get.";

/* ── FAQ · question-shaped versions of the honest answers above ─────── */
export const FAQ_TITLE = "Hashrate rental FAQ";
export const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "What is hashrate rental?",
    a: "Hashrate rental lets you point SHA-256 mining power at a pool you choose for a set number of days, without buying or running a miner. You pick how much hashrate and for how long, and the work goes to your pool and payout address.",
  },
  {
    q: "How much does it cost to rent Bitcoin hashrate?",
    a: "One price per day for each block of hashrate, shown live at the top of this page, for 1 to 7 days during the pilot in whole days. The checkout shows the total before you pay. There is no subscription and nothing recurring.",
  },
  {
    q: "Can rented hashrate find a block?",
    a: "Yes. A block pays whoever the hashrate was pointed at when it hit, and rented hashrate has found solo blocks before. The odds shown here are the live numbers for that chance, long as they are.",
  },
  {
    q: "Where does the bitcoin go if my rental finds a block?",
    a: "To the pool and payout address you set when you booked. The whole reward settles from the pool to you; the machines never mine to our wallet during your window.",
  },
  {
    q: "Which pools can I point it at?",
    a: `Any SHA-256 pool, solo included. You choose your own pool and payout wallet on ${MARKETPLACE_NAME} when you set up the rental. We are not affiliated with any pool.`,
  },
  {
    q: "Do you hold my money or my bitcoin?",
    a: "No. You finish your rental directly with us, and anything the hashrate finds goes to the pool you chose. We never custody anything the machines find.",
  },
  {
    q: "Why does hashrate look low for the first minutes?",
    a: "When a rental starts the miner reconnects to your pool and difficulty settles. Most graphs climb over about 10–30 minutes. That is normal pool-switch ramp, not a dead machine. We list under peak speed so the average for your window still tracks what you booked. Over a one-day rental, that ramp is a small slice of the graph.",
  },
  {
    q: "Can I rent more hash power at once?",
    a: "Yes. Add more hashrate in the calculator above, up to what is open right now, for the same window. Your odds of finding a block scale with the total hashrate you point at your pool.",
  },
  {
    q: "Why rent US-based hashrate?",
    a: "Lower latency to US pools, stable power and cooling, and an operator who answers in your timezone. The price is the same on the page, in the checkout and through your AI. You are paying for delivery and support, not a mystery share of a farm.",
  },
  {
    q: "Why rent hashrate instead of buying a miner?",
    a: "A full-size miner costs thousands of dollars and takes weeks to arrive. A rental is 1 to 7 days of hash power that is already running. Point it at your pool and wallet, and when the rental ends, it stops. If you want a miner of your own, the directory lists shops that sell them.",
  },
  {
    q: "Do I have to maintain the miner?",
    a: "No. We host and run the machines. You pick the days and the pool, and the hashrate switches over when the rental starts.",
  },
  {
    q: "What happens when the window ends?",
    a: "The hashrate comes back to our fleet and your pool settings stop applying. Rent again whenever you like; the odds shown here always track the live network.",
  },
];

export const TRUST_TITLE = "How this works";

export const TRUST_POINTS: string[] = [
  "You are renting whole machines from our own fleet for a fixed window, not buying a share of somebody's farm.",
  "Anything it finds goes to the pool and wallet you nominate. Never to us.",
  "You finish your rental directly with Galaxy Mind. We never take custody of anything the machines find.",
  "Galaxy Mind owns and operates these USA machines and is paid when they rent.",
  "Your pool shows the work as it arrives, so you can watch delivery for yourself.",
];

export const SOLO_TITLE = "Going for a block";
export const SOLO_NOTE =
  `Point the rental at any solo pool and a block it finds pays out to your own address, minus that pool's fee. Point it at a normal pool instead and you get a steady share rather than the whole block. You choose your own pool and payout wallet on ${MARKETPLACE_NAME}.`;

export const TERM_CROSSSELL_LEAD = "Want a year rather than a month?";
export const TERM_CROSSSELL_BODY =
  "sells term hashrate by the year and is listed in our directory. It's a different product for a different buyer, worth a look if you want hashrate running long after a month's rental would have ended.";

/* ── Cross-surface sentences · every place the site mentions the desk ──
 * These render on OTHER pages (nav flyout, /arcade, /stack, /float,
 * /bitcoin-halving-countdown, the homepage cross-sell) but they are
 * /hashrate sales prose, so they live here where the vocabulary gate
 * scans them. Prose typed into those components would escape it. */
/* CROSS-SURFACE REGISTER · REWRITTEN 2026-08-13 (operator).
 *
 * Every sentence below used to sell the desk in the LOTTERY register —
 * "a shot at a whole block", "one long-odds swing", "the block prize" —
 * and those sentences rendered on the directory homepage, the spend
 * money page, the post-submission screen, both sitewide chrome slots and
 * nine instrument/game pages. Sitewide, the site's most repeated verb
 * was a wager.
 *
 * That is a problem on its own terms and a specific one while bitcoin.org
 * lists this site on its Spend Bitcoin page: its reviewer stated the
 * bar as "no casinos", and its maintainer had just removed 99bitcoins for
 * turning into an affiliate portal. A merchant directory whose loudest
 * recurring call to action reads as a raffle ticket invites exactly that
 * comparison.
 *
 * The rule now: OFF /hashrate, describe the SERVICE (rent a machine by
 * the hour, point it at any pool, solo blocks pay whoever finds them) and
 * never the WAGER. Probability language stays where it belongs — on
 * /hashrate itself, next to the real numbers and the honest math. Do not
 * reintroduce "shot/swing/prize/odds" into any constant on this list.
 *
 * The per-page LEAD/LINK pairs for /arcade, /stack, /float, /runner,
 * /fit, /treasuries and the stores hook were DELETED rather than
 * rewritten: those promos are gone from those pages entirely, and a
 * rewritten constant nobody renders is just a dead string the gate has
 * to keep scanning. */
export const NAV_SUB = "USA ASICs, already running. Point them at your pool.";
/** LEAD renders as plain text, LINK as the underlined anchor to /hashrate —
 *  the TERM_CROSSSELL_LEAD/BODY split, so components never type prose. */
export const XSELL_HALVING_LEAD =
  "Every one of those blocks is found by a machine somewhere.";
export const XSELL_HALVING_LINK =
  "Ours rent by the day, pointed at whichever pool you choose";
export const XSELL_HELP_TITLE = "Rent a USA machine for a day";
export const XSELL_HELP_BODY =
  "USA machines, already racked. Point them at your pool and wallet. From one day up to 30. Any block they find pays the renter.";
export const XSELL_HELP_LINK = "See daily rental pricing";
export const XSELL_HELP_FAQ_Q = "Can renting a miner help grow bitcoin?";
export const XSELL_HELP_FAQ_A =
  "Yes. Pointing rented hashrate at a pool is genuine work on the network. Galaxy Mind rents USA ASICs that are already running; you point them at your pool. Any block they find pays the renter.";
// 2026-10-17 MRR-only (operator): cross-sell and FAQ copy points at the marketplace.
export const XSELL_OUT_HASHRATE_TITLE = "Rent hashrate in 270 TH/s chunks";
export const XSELL_OUT_HASHRATE_HOOK =
  `US-based SHA-256 hashrate, rented through ${MARKETPLACE_NAME}. Point it at your pool.`;
export const HOME_CARD_HOOK =
  `US-based SHA-256 hashrate in 270 TH/s chunks, rented through ${MARKETPLACE_NAME}. Point it at your pool.`;
/** /faq and /about · off the sales page, so SERVICE language only. */
export const SITE_FAQ_RENT_Q = "Can I rent a bitcoin miner without buying one?";
export const SITE_FAQ_RENT_A =
  `Yes. Galaxy Mind rents its own hashrate through ${MARKETPLACE_NAME}, in 270 TH/s chunks from 3 hours to 7 days. You point it at your pool and wallet. The directory also lists shops that sell home miners if you want a box of your own.`;
/** Hardware-hub FAQ · same facts, plus the shops on that page. */
export const HUB_RENT_Q = "Can I rent a miner instead of buying one?";
export const HUB_RENT_A =
  `Yes. Galaxy Mind rents its own hashrate through ${MARKETPLACE_NAME}, in 270 TH/s chunks from 3 hours to 7 days. You point it at your pool and wallet. The shops on this page sell home miners if you want a box of your own. Details at galaxymind.space/hashrate.`;
export const ABOUT_HASHRATE_BLURB =
  `Our own ASIC fleet, rented through ${MARKETPLACE_NAME}. You point it at your pool. Zero custody. This is the disclosed income that keeps the rest of the site online, not a directory listing for sale.`;
/** Bottom-of-page cross-sell cards (the page must not be a dead end). */
export const XSELL_OUT_STACK_HOOK =
  "Ten live market signals scored 0-100 · is today a good day to buy?";
export const XSELL_OUT_ARCADE_HOOK =
  "Eight bitcoin games on actual data · a new daily set every UTC day.";

/* ── Live desk strip · the one-line block-prize band on habit pages ───
 * Client-rendered from the CDN-cached /api/hashrate (the embed-widget
 * pattern — no server fetch rides the page render). Renders nothing at
 * all until healthy data arrives; absence beats a wrong number.
 * Was mounted on /today, the homepage, /stack, /float, /arcade,
 * /runner, /fit, /treasuries, and the React arcade cabinets until
 * 2026-08-13. Removed from those habit pages so the directory cannot
 * be read as a hashrate storefront (bitcoin.org listing terms). The
 * component still exists for a future operator-approved mount. */
export const STRIP_KICKER = "Rent hashrate";
// {PRIZE} = live block reward in USD
export const STRIP_PRIZE = "next block pays {PRIZE}";
// {N} = machines currently open to rent
export const STRIP_OPEN_MANY = "{N} machines open to rent";
export const STRIP_OPEN_ONE = "1 machine open to rent";
/** All *live* machines rented — never used when the rest are coming-online. */
export const STRIP_OPEN_NONE = "nothing open to rent right now";
/** {N} = coming-online count. Used only when openCount is 0. */
export const STRIP_OPEN_COMING = "{N} more machines coming online";
// {TH} = combined open hashrate in TH — the number a visitor can book
export const STRIP_OPEN_TH = "{TH} TH open";
// {PRICE} = cheapest 1-day rental across open machines, in USD
export const STRIP_ENTRY = "1 day from {PRICE}";
export const STRIP_CTA = "Rent now";
/** Same honesty split as HERO_CTA_LABEL_NONE · used when the strip
 *  already knows nothing is bookable. */
export const STRIP_CTA_NONE = "See availability";

/* ── /solo-mining-calculator · the odds-calculator pSEO page ──────────
 * The one search family that feeds the revenue page directly ("odds of
 * solo mining a block", "solo mining calculator"). All its sentences
 * live here under the same gate as the desk itself. The exact phrase
 * "rent hashrate" stays OUT of its title — split-relevance discipline,
 * same rule as / vs /online-stores-that-accept-bitcoin. */
export const CALC_TITLE =
  "Bitcoin Solo Mining Calculator · Odds of Finding a Block · Galaxy Mind";
export const CALC_DESCRIPTION =
  "What are the odds of solo mining a bitcoin block? Enter any hashrate and time window for the exact probability, computed from the live network.";
export const CALC_MASTHEAD =
  "Enter a hashrate and a window. The calculator answers with the chance of finding at least one block, computed from the live network, and what that block pays right now.";
export const CALC_TH_LABEL = "Your hashrate";
export const CALC_HOURS_LABEL = "Running for";
export const CALC_RESULT_ODDS = "chance of at least one block";
export const CALC_RESULT_PRIZE = "the block pays right now";
export const CALC_RESULT_EXPECTED = "expected blocks in the window";
// {EVERY} = humanized cadence ("34 years", "5 months", "9 days")
export const CALC_RESULT_YEARS =
  "Running nonstop at this rate, a block lands about once every {EVERY} on average.";
export const CALC_SYNCING_NOTE =
  "Live network data is unavailable right now, so the calculator cannot quote honest odds. It comes back the moment the feed does.";
/* ── The combine panel · the bridge from "could I?" to "rent it" ─────
 * This page wins informational searches ("solo mining calculator",
 * "odds of finding a bitcoin block"). Those visitors are not ready to
 * buy — but someone who has just typed in the hashrate they ALREADY own
 * and watched one line tell them what ours adds to it is a qualified
 * lead who arrived through a keyword the sales page could never win.
 *
 * Anchors stay informational here and transactional on /hashrate, so the
 * two pages keep owning different intents instead of competing for one
 * phrase. Wording is gate-safe: no invest/earn/return/yield/profit.
 */
export const CALC_COMBINE_TITLE = "Already mining? Add ours to yours";
export const CALC_COMBINE_HINT =
  "Enter what you already run. We will show what our open machines add to it over the same window.";
export const CALC_COMBINE_OWN_LABEL = "Your own hashrate";
/** {OWN} {WINDOW} {ALONE} {TOTAL} {BOTH} {LIFT} */
export const CALC_COMBINE_RESULT =
  "On its own, {OWN} TH/s over {WINDOW} runs at {ALONE}. Add our {TOTAL} TH/s and the same window becomes {BOTH}, about {LIFT}× the chance.";
export const CALC_COMBINE_NONE_OPEN =
  "Nothing of ours is open to rent this minute, so there is nothing to add yet. The rent page lists what frees next.";
export const CALC_COMBINE_CTA = "See what our open machines cost";

export const CALC_RENT_LEAD = "No hardware of your own?";
export const CALC_RENT_LINK =
  "Our USA machines rent by the day, pointed at your pool · live cost and block odds";
// {PRICE} = live 1-day minimum across our available machines
export const CALC_RENT_PRICE =
  "One day on a full-size machine is about {PRICE}.";
// {TH} = combined open hashrate right now
export const CALC_RENT_OPEN = "{TH} TH is open to rent right now.";
export const CALC_HOWTO_LEAD = "First time renting?";
export const CALC_HOWTO_LINK = "Read the step-by-step guide";
export const CALC_FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "What are the odds of solo mining a bitcoin block?",
    a: "They scale with your share of the network. This calculator divides your hashrate by the live network rate and compounds it over every block mined in your window. The result is the exact probability, not an approximation.",
  },
  {
    q: "What happens if I find a block solo?",
    a: "The whole block reward, subsidy plus fees, pays out to you. On a solo pool the payout is yours alone, minus that pool's fee. You choose the pool; we are not affiliated with any.",
  },
  {
    q: "How much hashrate do I need to find a block?",
    a: "Any amount can find one (tiny desk miners have done it), but the chance scales linearly: double the hashrate, double the odds. Use the calculator to see your once-every-how-long number at any size.",
  },
  {
    q: "Is solo mining a good idea?",
    a: "As a business, almost never; a pool pays steadily for the same work. As a whole-block attempt it is exactly priced: rare, honest odds at the entire reward. Know which of the two you are buying.",
  },
  {
    q: "Can I rent hashrate instead of buying a machine?",
    a: "Yes, that is what our own USA machines are for. They are already running; you rent by the day, point them at a solo pool, and any block they find pays out to you. The directory also lists shops that sell home miners if you want a box of your own.",
  },
];

/* ── Agent rental quote · the machine-readable rent surface ───────────
 * Served by the get_rental_quote MCP tool, /api/hashrate/quote, and
 * /hashrate/agents. Every sentence lives here so the vocabulary gate
 * scans it — including the MCP tool description, the first tool whose
 * entire purpose is rental copy (the other tools' descriptions still
 * live ungated in route.ts; scope-contained cleanup for another day). */

export const QUOTE_TOOL_DESCRIPTION =
  "Identical to get_quote: the same price from the same function, plus quoteId and validUntil. Direct rental quote from Galaxy Mind for whole S21 XP rigs (270 TH each), priced per PH per day at today's price and never below our floor. Give rigs (1 to 4 per order) or ph (rounded to whole rigs), and days (1 to 7 during the pilot, default 1). create_rental charges the same number if it is created within 15 minutes. This tool takes no payment and places no order; to rent, call create_rental (see closeTheSale).";

/** Handshake text for the MCP server. Agents read this when deciding
 *  whether to call get_quote. Keep it factual; the gate scans it. */
export const MCP_RENT_WHEN =
  "Renting hashrate: for any 'rent hashrate' or 'rent a miner' intent, call list_available_rigs to see which bays are open, then get_quote (or its alias get_rental_quote) for the price, valid 15 minutes. The renter points the machines at any pool they like, solo included. To rent, call create_rental with accept_terms=true and terms_version (Rental Terms: https://galaxymind.space/terms/rental). It replies with an x402 payment request in USDC on Base that a human or an x402-capable agent wallet can pay; closeTheSale says if rentals are paused. Track it with get_rental_status, or rental_status with the access code. People can also rent in a browser at https://galaxymind.space/hashrate/rent, no account needed.";

export const QUOTE_HANDOFF_STEPS: string[] = [
  "Check availability with list_available_rigs on the Galaxy Mind MCP.",
  "Get the price with get_quote (whole rigs, 270 TH minimum, 1 to 7 days during the pilot).",
  "Finish the rental with create_rental (accept_terms=true and terms_version), then pay the x402 request in USDC on Base. closeTheSale says if rentals are paused.",
  "Check the rental with rental_status and your access code.",
];

export const QUOTE_PREREQS: string[] = [
  "A pool and payout address of your own.",
];

export const QUOTE_FEE_NOTE =
  "costBtc is an estimate. The final amount is set when you finish your rental with us.";

/** Standalone single-rental caveat — free of tier-2 words so it can
 *  ride the chooser and the quote surface. */
export const QUOTE_SINGLE_RENTAL_NOTE =
  "Odds are an average over many plays. Any single rental either finds a block or does not.";

// {H} = quoted hours · {MIN}/{MAX} = our rental term in hours (1 to 7 days during the pilot)
export const QUOTE_HOURS_CLAMPED =
  "Adjusted to {H} hours. Rentals run in whole days, from {MIN} to {MAX} hours (1 to 7 days during the pilot).";

export const QUOTE_REFUSAL_NOTE =
  "Live pricing for this machine is unavailable right now, so no honest quote can be given. It comes back the moment the feed does.";

export const QUOTE_CANNOT_LINE =
  "Nothing is paid by agents through this API. You finish the rental directly with Galaxy Mind, and anything the machine finds pays out to the pool you chose.";

/* ── Referral disclosure · the whole defense, so it is never optional ──
 * The referral rides EVERY rental marketplace link this site emits (signup,
 * rig deep-links, the seller page), so this sentence had to stop saying
 * "the signup link" — it was written when only the handoff carried it.
 * the marketplace's rules ban hidden links; disclosed ones are ordinary. Which is why
 * scripts/test-rental-quote.ts fails the build if a referral-bearing URL
 * ever ships without the disclosure beside it. */
export const QUOTE_REFERRAL_DISCLOSURE =
  "Links from this site to the rental marketplace are referral links. The marketplace pays Galaxy Mind a small commission on referred accounts, at no extra cost to the renter.";

/** The human-page twin — same fact, small type, one line. */
export const REFERRAL_NOTICE =
  "Our rental marketplace links are referral links · renting through them costs you nothing extra.";

/**
 * Link to the operator's public seller page. Every number on this page is
 * checkable there, and until 2026-08-08 nothing linked to it.
 */
/* The label PROMISED what the link could not deliver until 2026-08-27:
 * it read "See every machine listed on the rental marketplace" while pointing
 * at the algorithm page, which shows page 1 of ~1,361 listings with none
 * of ours on it. Two labels now, one per real destination, because a
 * verification link that overclaims is worse than none on a page selling
 * on honesty. */

/** Used when the link resolves to a real Galaxy Mind listing. */
export const SELLER_LINK_LABEL = "Rent with your AI bot";

/** Degraded fallback · the fleet feed is down and we have no live id. */
export const SELLER_LINK_LABEL_MARKET = "Rent with your AI bot";

/* ── The BYO-key API path · full agent autonomy, still zero custody ───
 * Stage 2 of the agent-rental design (spec §4), UNBLOCKED 2026-08-06 by
 * the operator's live key-scope probe (scripts/check-mrr-key-scope.ts):
 * a key whose Balance/Withdraw group is Read traversed the marketplace's entire
 * rental-creation path — auth, permissions, profile lookup, algo match,
 * duration — and was refused ONLY by the deliberate rate.price cap
 * ("Rig price exceeds filtered price"). So the fund-safe key advice
 * below is EMPIRICAL, not assumed, and the rate.price pin doubles as
 * the proven repricing protection. Everything here is data an agent
 * executes against the marketplace's own API with the RENTER'S key; Galaxy Mind
 * never sees the key, the balance, or the order. */

export const QUOTE_API_NOTE =
  "For agents holding the renter's own rental marketplace API key. Mint the key with Rentals set to Write, Rigs set to Read, and Balance/Withdraw set to Read or None: a key with no withdraw capability completes rental creation end to end (verified live 2026-08-06), so funds cannot be moved even if the key leaks. The rental is charged to the renter's own rental marketplace balance. Galaxy Mind never sees the key and never touches the money.";

export const QUOTE_API_AUTH =
  "HMAC auth per the marketplace apidocv2: send x-api-key, x-api-nonce (strictly increasing per key), and x-api-sign = SHA1-HMAC of key + nonce + endpoint signed with the API secret, where endpoint omits the /api/v2 prefix, any query string, and any trailing slash. Rate limit is 100 requests per minute.";

/** The call sequence, one step per row. Steps 4-6 are one-time setup;
 *  every string here is scanned by the vocabulary gate like all copy. */
export const QUOTE_API_STEPS: {
  step: number;
  method: string;
  path: string;
  params?: Record<string, string>;
  why: string;
}[] = [
  {
    step: 1,
    method: "GET",
    path: "/rig/{machineId}",
    why: "Availability and live price check. Public, no auth needed.",
  },
  {
    step: 2,
    method: "GET",
    path: "/whoami",
    why: "Verify the key's scopes before anything else: rent should be write-capable, withdraw should be read or none.",
  },
  {
    step: 3,
    method: "GET",
    path: "/account",
    why: "Confirm the balance covers the quote plus the marketplace fee the rental marketplace adds at checkout.",
  },
  {
    step: 4,
    method: "PUT",
    path: "/account/pool",
    params: { type: "sha256ab", name: "my pool", host: "your pool's stratum host", port: "your pool's port", user: "your own payout address", pass: "x" },
    why: "One-time setup. Use the stratum host and port of whichever pool you choose (any solo pool works) with your own payout address. The pool test in the next step confirms the details before anything commits.",
  },
  {
    step: 5,
    method: "PUT",
    path: "/account/pool/test",
    why: "Optional but wise: the rental marketplace checks the pool answers before a rental commits to it.",
  },
  {
    step: 6,
    method: "PUT",
    path: "/account/profile",
    params: { algo: "sha256ab", name: "my solo profile" },
    why: "One-time setup: the profile must be on the sha256ab algo exactly. A plain sha256 profile is a different book and the rental fails with a profile-type mismatch.",
  },
  {
    step: 7,
    method: "PUT",
    path: "/account/profile/{id}",
    params: { poolid: "the pool id from step 4", priority: "0" },
    why: "Attach the pool to the profile at priority 0. Without this attachment the profile has no destination and the rented machine has nowhere to point.",
  },
  {
    step: 8,
    method: "PUT",
    path: "/rental",
    params: {
      rig: "machine id from this quote, as an integer",
      length: "quotedHours from this quote, whole days, never below 24",
      profile: "your profile id",
      rate: 'one NESTED object, { "type": "ph", "price": <this machine\'s askBtcPerPhDay from this quote> } — not flat rate.type / rate.price fields',
    },
    why: "Creates the rental, charged to your own balance. Send rate as a nested object; the price field is a mandatory cap: if the ask moved after this quote, the rental marketplace refuses with a price error instead of overcharging you.",
  },
  {
    step: 9,
    method: "GET",
    path: "/rental/{id}",
    why: "Verify the rental and the rig's pool status. PUT /rental/{id}/pool is the fallback for pool fixes.",
  },
];

export const QUOTE_API_FIRST_RENTAL =
  "Start with the one-day minimum as a live end-to-end check before booking longer runs.";

/* ── /hashrate/agents · the agent-onboarding page ─────────────────────
 * Split-relevance discipline: the exact phrase "rent bitcoin hashrate"
 * belongs to /hashrate and stays OUT of this title. This page owns the
 * agent-intent query family instead. */
export const AGENT_PAGE_TITLE =
  "How AI Agents Rent Hashrate · Galaxy Mind";
export const AGENT_PAGE_DESCRIPTION =
  "Galaxy Mind's mining fleet is rentable by AI agents: availability and quotes over MCP and JSON, and you finish the rental directly with us. Zero custody.";
export const AGENT_PAGE_MASTHEAD =
  "An AI agent can check our machines, get a quote and hand its human the finish step. Here is the whole surface, machine-readable and honest.";
export const AGENT_PAGE_INTRO =
  "Every number an agent needs comes from the same live code the human page renders, so a person and a model can never see different figures. Nothing is custodied here; the rental itself is finished directly with Galaxy Mind.";
export const AGENT_PAGE_SURFACES_TITLE = "Three ways in";
export const AGENT_PAGE_API_TITLE = "The fully autonomous path";
export const AGENT_PAGE_API_BODY =
  "Agents use the Galaxy Mind MCP for availability, quotes and status, and the human finishes the rental directly with us.";
export const AGENT_PAGE_MACHINES_TITLE = "The machines, live";
export const AGENT_PAGE_STEPS_TITLE = "From quote to hashing";

/** Split-headline pattern: LEAD renders as plain text, EM as the
 *  .headline-gradient span — same idea as the XSELL_*_LEAD/LINK splits,
 *  so the H1 never types prose straight into the component. */
export const AGENT_PAGE_H1_LEAD = "AI agents can";
export const AGENT_PAGE_H1_EM = "rent this fleet";

/** The three SURFACES rows' note field, in order (MCP / JSON / Human) —
 *  label/value stay inline in the component as code literals, but the
 *  note is prose and must ride through the vocabulary gate. */
export const AGENT_PAGE_SURFACE_NOTES: string[] = [
  "list_available_rigs, get_rental_quote and rental_status",
  "the same quote over plain HTTP · hours 24-720 in whole days",
  "the live page · same numbers, same code",
];

/** Machines-table rent-link text — same class as ODDS_RENT_CTA. */
export const AGENT_PAGE_RENT_LINK = "rent ↓";

/** /hashrate → /hashrate/agents cross-link (LEAD renders as plain text,
 *  LINK as the underlined anchor — the standing split so the sales page
 *  never types prose into JSX). Discovery aid: humans steering agents
 *  land on the sales page first. */
export const XSELL_AGENTS_LEAD = "Sending an AI agent instead of clicking around yourself?";
export const XSELL_AGENTS_LINK =
  "The agent surface explains how to rent with your AI bot";

/** Machines-table link text for a non-available machine — same class as
 *  ODDS_VIEW_CTA. The site-wide honesty invariant (also enforced on
 *  /hashrate's BlockShot chooser) is that a rent verb never renders next
 *  to a machine that isn't actually available to rent right now. */
export const AGENT_PAGE_VIEW_LINK = "rent it when it frees ↓";

export const RIG_SYNCING_NOTE =
  "Live machine status is unavailable right now. The machines themselves are unaffected.";

export const DESK_STATUS_LIVE = "Live from our fleet feed and mempool.space.";

export const DESK_STATUS_DEGRADED =
  "{COUNT} of {TOTAL} data feeds are unavailable right now: {FEEDS}. Anything that depends on them reads SYNCING instead of showing a number.";

export const DESK_STATUS_SWEEP_BROKE =
  "Reading the market data stopped early on an upstream error.";

export const ODDS_METHOD_NOTE =
  "Odds are the chance of finding at least one block in the window: your share of network hashrate, compounded over the blocks mined in that time. Prize is the current subsidy plus recent average fees at today's price. Both move with the network.";

/** Hard fail. These never appear in /hashrate copy under any framing. */
/* ── THE PACK QUEUE ────────────────────────────────────────────────
 * Added 2026-08-27. The chooser sells a multi-machine pack on combined
 * odds, and the CTA then opened exactly ONE listing (the first of the
 * pack) with nothing telling the renter where the rest were. The drop
 * happened AFTER the decision to take several machines, which is the
 * expensive place to lose someone.
 *
 * the rental marketplace checks out one rig at a time and there is no public
 * per-seller page to send people to: /u/GalaxyMind is login-walled
 * (HTTP 200 whose body reads "you need to be logged into our service"
 * and then "404 Not Found"), and the algo page's filter form carries no
 * owner field. So the queue lives here, on the page that already knows
 * which machines are in the pack and what window was chosen.
 *
 * The copy states the one-at-a-time truth rather than implying a single
 * click books the pack. That honesty is load-bearing: someone who
 * expects one checkout and meets five is a support ticket and a refund
 * request, not a repeat customer. */

/** {N} = machines in the current pack. */
export const PACK_QUEUE_TITLE = "Your pack · {N} machines";

/** Sits under the title. States the constraint before they hit it. */
export const PACK_QUEUE_NOTE =
  "Every machine in your pack is finished together in one rental with us.";

/** {DONE} {TOTAL} = machines started so far, and in the pack. */
export const PACK_QUEUE_PROGRESS = "{DONE} of {TOTAL} started";

/** Row state once its listing has been opened in a new tab. */
export const PACK_QUEUE_STARTED = "Opened";

/** Row action for a machine not yet opened. */
export const PACK_QUEUE_OPEN = "Finish your rental";

/** Shown when every machine in the pack has been opened. */
export const PACK_QUEUE_DONE =
  "Finish your rental with us and point every machine at the same pool.";

export const TIER1_BANNED = [
  "passive income",
  "cloud mining",
  "guaranteed",
  "ROI",
  "daily returns",
  "risk-free",
  "no risk",
  "safe returns",
  "APY",
  "APR",
  "mailbox money",
  "residual income",
  "set and forget",
  "we mine for you",
  "hashrate as a service",
  "HaaS",
  "liquidity mining",
  "beats DCA",
  "better than holding",
  "mine bitcoin from your browser",
  "mine from your phone",
  "verified earnings",
  "proven profits",
  "institutional grade",
  "double your",
  "join our miners",
];

/**
 * Banned on every hashrate surface. These words sell a return. The
 * old lottery-comparison exemption is gone: a single rental either
 * finds a block or does not, and that sentence does not need them.
 */
export const TIER2_CONTEXT_GATED = [
  "invest",
  "yield",
  "profit",
  "returns",
  "earn",
];

// ── Direct rental hero (2026-10-17 redesign). One price, one action. ────────
// 2026-10-17 SEO pass: the hero leads with hash power, the price and how
// to start. No miner model in any headline (operator: customers want hash
// power, not a hardware spec).
export const RENT_HERO_KICKER = "SHA-256 hashrate · US-based";
export const RENT_HERO_TITLE = "Bitcoin hash power, pointed at your pool";
export const RENT_HERO_SUB =
  "Choose your hashrate and days, add your pool, and pay with {RAILS} from your own wallet. Hashing starts within minutes. No account.";
/** {TH} = RIG_TH. The price is sold per block of hashrate, not per box. */
export const RENT_PRICE_UNIT = "per {TH} TH/s per day";
/** {PER_TH} = the same live price divided by RIG_TH, display only. */
export const RENT_PRICE_PER_TH = "About {PER_TH} per TH/s per day";
/** {RAILS} = payRailsLabel() (rails.ts): "USDC on Base", or "USDC on Base or Solana" when Solana is on. */
export const RENT_PRICE_FOOT = "Paid in {RAILS} · rent for 1 to 7 days";
export const RENT_PRICE_UNAVAILABLE = "Price unavailable right now";
export const RENT_CTA = "Rent hashrate";
export const RENT_BUILDER_TITLE = "Build your rental";
export const RENT_BUILDER_ODDS_LABEL = "Chance your pool finds a block";
export const RENT_BUILDER_ODDS_NOTE =
  "Mining is probabilistic. Most rentals find no block; you pay for hashrate delivered, not for a block.";
export const BAY_BOARD_TITLE = "Hashrate available now";
export const BAY_OPEN = "Open";
export const BAY_RENTED = "Rented";
export const BAY_UNAVAILABLE = "Unavailable";
export const RENT_FLOW_TITLE = "How to rent hashrate";
export const RENT_FLOW_STEPS = [
  { title: "Choose", body: "Hashrate and days. The price is shown before you pay." },
  { title: "Point", body: "Pick your pool from the list and add your worker name." },
  { title: "Pay", body: "One {RAILS} payment from your own wallet. No account." },
  { title: "Mine", body: "Your hashrate switches to your pool. Track it with your access code." },
];
export const PAUSED_KICKER = "Direct rentals paused";
export const PAUSED_TITLE = "New rentals are paused for a moment";
export const PAUSED_BODY =
  "Rentals already paid for are not affected. Leave your email and we will tell you when hashrate opens up again, or ask your AI bot to check for you.";
