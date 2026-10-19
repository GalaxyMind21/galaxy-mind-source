// Copy for RENTALS_MODE=mrr_only (operator 2026-10-17): Galaxy Mind rents only through
// the marketplace. Lead with hashrate in 270 TH/s chunks, never name the hardware model, never the word
// "real", no marketplace prices, no rig ids, no location beyond "US-based". The marketplace name comes
// from lib/marketplace-listing.ts (the gated mention module); this file never spells it.
import { MARKETPLACE_NAME as M } from "@/lib/marketplace-listing";

export const UNIT_TH = 270;

/** "270 TH/s", "1.08 PH/s". */
export function hashLabel(units: number): string {
  const th = units * UNIT_TH;
  return th >= 1000 ? `${(th / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} PH/s` : `${th} TH/s`;
}

/* ── /hashrate (mrr_only) ───────────────────────────────────────────── */
// SEO pass 2026-10-17 (operator): lead with the head terms top results use ("rent bitcoin hashrate",
// "solo mining"), stay under ~60 chars for the title and ~160 for the description.
export const MRR_PAGE_TITLE = "Rent Bitcoin Hashrate for Solo Mining · Galaxy Mind";
export const MRR_PAGE_DESCRIPTION = `Rent Bitcoin hashrate in 270 TH/s chunks and solo mine to your own wallet for a shot at a whole block. Your pool, no ID from us, rented on ${M}.`;
/** Social cards: same promise, a touch shorter. */
export const MRR_SOCIAL_DESCRIPTION = "Rent Bitcoin hashrate in 270 TH/s chunks. Your pool, your wallet, no ID from us, and a shot at a whole block.";
export const MRR_OG_ALT = "Rent Bitcoin hashrate from Galaxy Mind for solo mining";
export const MRR_PAGE_H1 = "Rent Bitcoin hashrate that mines to your own wallet";
// Funnel order (operator 2026-10-17): hero with live count, selector and ONE primary CTA; the unit list;
// three benefit cards; honest odds; three steps; objection FAQ; final CTA (+ sticky bar on mobile).
export const MRR_HERO_SUB = `Your pool, your wallet, no ID from us, and a shot at a whole block. Rent it in 270 TH/s chunks on ${M}.`;
export const MRR_SELECTOR_LABEL = "How much hashrate?";
export const MRR_SELECTOR_DEC = "Less hashrate";
export const MRR_SELECTOR_INC = "More hashrate";
export const MRR_LIVE_LINE = "{N} × 270 TH/s available now";
export const MRR_LIVE_UPDATED = "Live from " + M + " · updated {AGO}";
/** Zero free units OR stale/missing data (operator 2026-10-17): no dead-end marketplace link. */
export const MRR_NONE_FREE = "All rented right now. Check back soon.";
export const MRR_STALE = MRR_NONE_FREE;
/** The disabled main CTA when nothing can be rented from here right now. */
export const MRR_CHECK_BACK_CTA = "Check back soon";
export const MRR_PRIMARY_CTA = `Rent hashrate on ${M}`;
export const MRR_PRIMARY_NOTE_ONE = `Opens your unit on ${M} in a new tab.`;
export const MRR_PRIMARY_NOTE_MANY = "Opens Unit 1. Open the rest below with the same pool and hours.";
export const MRR_LIST_TITLE = "Your units";
export const MRR_UNIT_LABEL = "Unit {I}";
export const MRR_UNIT_CTA = "Rent on " + M;
export const MRR_UNIT_DONE = "Opened";
export const MRR_LIST_TIP = "Same pool, same hours on every unit, and they hash together as {TH}.";
export const MRR_HOURS_NOTE = `Rent from 3 hours up to 7 days on ${M}.`;

export const MRR_WHY_TITLE = "Why rent Bitcoin hashrate from us";
export const MRR_WHY_CARDS: { title: string; body: string }[] = [
  { title: "Straight to your wallet", body: "Coins go to the payout address you set on your own pool. We never hold them and we never ask for ID." },
  { title: "A shot at a whole block", body: "Point it at any solo pool. If your hashrate finds a block, the reward goes to your address, minus that pool's fee." },
  { title: "US-based, professionally hosted", body: `Steady power and cooling. Check delivery yourself on ${M}'s live hashrate graph.` },
];

export const MRR_ODDS_TITLE = "Your odds of finding a block, honestly";
export const MRR_ODDS_DAY = "In 24 hours";
export const MRR_ODDS_WEEK = "In 7 days";
export const MRR_ODDS_LINE = "about 1 in {N}";
/** {TH} selected hashrate, {EH} network hashrate. */
export const MRR_ODDS_NOTE = "Estimate for {TH} hashing nonstop on a solo pool, against today's network of about {EH} EH/s (mempool.space). Luck varies and most rentals find no block. Treat a block as a bonus.";
export const MRR_ODDS_NONE = "The live network figure isn't available right now, so we're not showing odds. They're small at this size, and most rentals find no block.";

export const MRR_FLOW_TITLE = "How to rent hashrate in three steps";
export const MRR_FLOW_STEPS: { title: string; body: string }[] = [
  { title: "Create an account", body: `Sign up free on ${M} with a username, email and password, then fund it with crypto.` },
  { title: "Pick our units", body: "Choose your hashrate above and open each unit's listing." },
  { title: "Point it at your pool and wallet", body: "Set your pool and payout address, choose your hours and confirm. Hashing starts within minutes." },
];

export const MRR_FINAL_TITLE = "Start mining to your own wallet";
export const MRR_AGENTS_LINK = "Using an AI agent? See the agent guide";

export const MRR_FAQ_ITEMS: { q: string; a: string }[] = [
  { q: "Can I rent hashrate to solo mine?", a: "Yes. Point your rented hashrate at any solo pool and set your own payout address. If it finds a block, the whole reward goes to that address, minus the pool's fee. We're not affiliated with any pool." },
  { q: "Do I need KYC to rent hashrate?", a: `Not with us. We never ask for ID. ${M} signs you up with a username, email, password and PIN, and says it doesn't routinely collect identifying information. It can still ask for ID in limited cases such as fraud, security or legal requests, and its own account rules apply.` },
  { q: "What if I don't find a block?", a: "Most rentals don't. On a solo pool, no block means no payout for that rental. On a regular pool you earn a share of what the pool finds instead. Rent for the shot, not for a sure return." },
  { q: "Can I mine to my own wallet?", a: `Yes. You choose your own pool and payout wallet on ${M}. Any SHA-256 pool works. We're not affiliated with any pool and never touch the coins.` },
  { q: "How long can I rent?", a: `From 3 hours up to 7 days per rental, and you can extend on ${M}.` },
  { q: "How much hashrate can I rent?", a: "Any number of 270 TH/s chunks, up to however many are free right now. The fleet tops out at 8.1 PH/s when every chunk is free. Open each unit with the same pool and hours and they hash together." },
  { q: "What are my odds of finding a block?", a: "Your chance at each block is your hashrate divided by the whole network's. The odds panel on this page works it out live for the hashrate you pick, over a day and a week. At this size the odds are small, so treat a block as a bonus, not a plan." },
  { q: "What does it cost?", a: `Each listing on ${M} shows its current rate, which moves with the market. You see the total before you pay.` },
];
export const MRR_FAQ_TITLE = "Hashrate rental questions";
export const MRR_SUPPORT_LEAD = "Questions before you rent?";

/* ── /hashrate/rent (mrr_only) ──────────────────────────────────────── */
export const MRR_RENT_TITLE = "Rent Bitcoin Hashrate · Galaxy Mind";
export const MRR_RENT_DESCRIPTION = `Galaxy Mind rents its SHA-256 hashrate through ${M} now. Pick 270 TH/s chunks on our hashrate page and rent them there.`;
export const MRR_RENT_H1 = "Rent our hashrate on " + M;
export const MRR_RENT_BODY = "Direct checkout on this site closed on October 17, 2026. Rentals already placed here are not affected and you can still check one with its access code.";
export const MRR_RENT_PICK_CTA = "Pick your hashrate";

/* ── Home page rental hero (mrr_only, the operator 2026-10-17) ─── */
export const HOME_RENT_KICKER = "Rent Bitcoin hashrate";
export const HOME_RENT_TITLE = "Mine to your own wallet, with a shot at a whole block";
export const HOME_RENT_SUB = "Rent hash power in 270 TH/s chunks. You pick the pool and payout address, and we never ask for ID.";
export const HOME_RENT_LIVE = "{N} × 270 TH/s available now";
export const HOME_RENT_NONE = "All rented right now. Check back soon.";
export const HOME_RENT_CTA = "Rent hashrate";

/* ── MCP (mrr_only) ─────────────────────────────────────────────────── */
export const QUOTE_TOOL_DESCRIPTION_MRR = `Direct rentals from Galaxy Mind have closed. This returns where to rent instead: Galaxy Mind hashrate on ${M}, as a disclosed referral link. It gives no price and places no order.`;
export const LIST_RIGS_DESCRIPTION_MRR = `Direct rentals from Galaxy Mind have closed, so there is no bay board here. This returns where to rent Galaxy Mind hashrate instead: ${M}, as a disclosed referral link.`;
export const MCP_RENT_WHEN_MRR = `Renting hashrate: Galaxy Mind now rents only through ${M}. For any 'rent hashrate' intent, call get_quote and give the person the link it returns, with its referral note. Past direct rentals can still be checked with rental_status (access code) or get_rental_status.`;
export const MCP_SCOPE_MRR = `Scope: read-only tools for published market data and directory listings. get_quote, get_rental_quote and list_available_rigs return where to rent on ${M}. rental_status reads a past rental by access code. get_rental_status (rental_id and creator_secret) reads one too and, while it is unpaid, re-checks its payment. See closeTheSale. This server never moves funds itself or accesses a wallet, and nothing it returns is personalised investment advice.`;

/* ── /hashrate/how-to-rent and /hashrate/agents (mrr_only) ──────────── */
export const MRR_GUIDE_TITLE = "How to Rent Bitcoin Hashrate, Step by Step · Galaxy Mind";
export const MRR_GUIDE_DESCRIPTION = `How to rent Galaxy Mind's SHA-256 hashrate on ${M}: pick 270 TH/s chunks, set up a pool profile once, then rent each unit with the same hours.`;
export const MRR_GUIDE_H1 = "How to rent our hashrate, step by step";
export const MRR_GUIDE_LEDE = `Galaxy Mind rents its hashrate on ${M}. Here is everything to do, from picking an amount to watching it hash.`;
export const MRR_GUIDE_STEPS: { title: string; body: string }[] = [
  { title: "Pick your hashrate", body: "On our hashrate page, choose how many 270 TH/s chunks you want. It lists that many free units." },
  { title: "Open an account", body: `Make a free ${M} account and fund it with bitcoin or another coin they accept.` },
  { title: "Save a pool profile", body: "Add your pool's stratum address and your worker once. Any SHA-256 pool works, solo included." },
  { title: "Rent each unit", body: "Open each unit from our page, pick your pool profile and the same hours, and confirm." },
  { title: "Watch it hash", body: `Hashing starts within minutes and ramps up over the first half hour. Follow it on your pool and on ${M}.` },
];
export const MRR_AGENTS_TITLE = "Rent Bitcoin Hashrate with Your AI Agent · Galaxy Mind";
export const MRR_AGENTS_DESCRIPTION = `AI agents can find Galaxy Mind's hashrate through our MCP server. Renting happens on ${M}, with your own account.`;
export const MRR_AGENTS_H1 = "Rent our hashrate with your AI agent";
export const MRR_AGENTS_LEDE = `Galaxy Mind no longer takes orders from AI agents directly. Agents point people to ${M}, where the rental and payment happen.`;
export const MRR_AGENTS_STEPS: { title: string; body: string }[] = [
  { title: "Connect the MCP", body: "Add https://galaxymind.space/api/mcp/mcp to your AI client as a connector." },
  { title: "Ask for hashrate", body: `get_quote returns the ${M} link to share, with its referral note. It gives no price and places no order.` },
  { title: "Rent with your own account", body: `The person rents on ${M}. An agent holding their own ${M} API key can also rent through that API. We never hold keys or funds.` },
  { title: "Check a past rental", body: "Rentals placed here before the switch can still be checked with rental_status and the access code." },
];
