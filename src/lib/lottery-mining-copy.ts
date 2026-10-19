// Copy for /lottery-mining-bitcoin (SEO brief 2026-10-18, rank 3, cluster B).
// House rules for this page: sell the experience, never a return. No "profit",
// "earn" or "you could win" framing, no price predictions, no dollar figures,
// no hardware model names, no pool names (Galaxy Mind is not affiliated with
// any pool), and every probability is either live from lib/lottery-odds.ts or
// shown as a formula. The marketplace name comes from the gated mention module
// (lib/marketplace-listing.ts); this file never spells it. One module, so the
// visible page and the Article/HowTo/FAQPage JSON-LD read the same strings.
import { MARKETPLACE_NAME as M } from "@/lib/marketplace-listing";

export const LOTTERY_PATH = "/lottery-mining-bitcoin";
export const LOTTERY_URL = `https://galaxymind.space${LOTTERY_PATH}`;
/** Bump when the copy materially changes (Article dateModified + sitemap lastmod). */
export const LOTTERY_MODIFIED = "2026-10-18";

export const LOTTERY_H1 = "Lottery mining bitcoin: the honest odds, renting vs owning, and how to try it";
export const LOTTERY_META_TITLE = "Lottery Mining Bitcoin: Honest Odds, Rent vs Own · Galaxy Mind";
export const LOTTERY_DESCRIPTION =
  "What lottery (solo) mining is, the odds of finding a block worked out live, whether to rent hashrate or own a miner, and how to point hashrate at a solo pool.";
export const LOTTERY_OG_ALT =
  "Galaxy Mind guide card: Lottery mining bitcoin. The honest odds of finding a block, renting vs owning, and how to try it.";

export const LOTTERY_SHORT =
  "Lottery mining is solo mining with a small slice of the network's hashrate, hoping to find a whole block. Your chance for each block is your hashrate divided by the network's. Most attempts find nothing, so treat a block as a bonus and spend only what you are happy to lose.";

/* ── What it is ─────────────────────────────────────────────────────── */
export const WHAT_TITLE = "What is lottery mining?";
export const WHAT_BODY = [
  "Lottery mining is solo mining when your hashrate is tiny next to the whole network. In a normal pool, thousands of miners share every block the pool finds, so each one gets a small, steady payout. In solo mining nobody shares. You either find a block yourself and keep the reward, minus any pool fee, or you get nothing.",
  "A block reward is the new-coin subsidy plus the fees inside that block. The subsidy has been 3.125 BTC since the April 2024 halving, and it halves again roughly every four years. That all-or-nothing prize is why people call it a lottery.",
];

/* ── The odds ───────────────────────────────────────────────────────── */
export const ODDS_TITLE = "The odds, honestly";
export const FORMULA_TITLE = "The formula in one line";
export const FORMULA_BODY =
  "Bitcoin aims for one block about every ten minutes, which is 144 blocks a day. Each block, your chance of finding it is p = your hashrate ÷ network hashrate. Over n blocks, the chance of finding at least one is 1 − (1 − p)^n, which is almost exactly 1 − e^(−n × p) when p is small.";
export const FORMULA_EXAMPLE_LEAD = "Worked example with today's network:";
export const TABLE_TITLE = "Odds at three sizes, live";
export const TABLE_NOTE =
  "Computed from the network hashrate estimate on mempool.space, refreshed about every ten minutes. Odds move with the network, so they will not match yesterday's figures. Rounded to two significant figures.";
export const TABLE_SYNCING =
  "The live network figure is syncing right now. The calculator has the same math and will show today's odds as soon as the feed is back.";
export const MEMORY_TITLE = "Why longer doesn't mean closer";
export const MEMORY_BODY = [
  "Mining has no memory. Every hash is a fresh, independent draw, so a miner that has run for a month is no closer to a block than one that started a minute ago. There is no progress bar.",
  "What matters is total hashing: hashrate multiplied by time. Six hours at 1 PH/s buys exactly the same chance as twelve hours at 500 TH/s. While the chance is small, doubling the time roughly doubles it.",
];

/* ── Worth it? ──────────────────────────────────────────────────────── */
export const WORTH_TITLE = "Is lottery mining worth it? The math, not a pitch";
export const HASHPRICE_TITLE = "Hashprice vs what you pay";
export const HASHPRICE_BODY = [
  "Hashprice is the reward a unit of hashrate can expect on average over a day. It comes straight from the odds above multiplied by the block reward. Hashrate Index publishes it live.",
  "On average, solo mining pays out exactly hashprice, just in rare lumps instead of a steady trickle. Anyone selling hashrate has to cover power and hardware, so rented hashrate usually costs at least what it is expected to return. That makes the average outcome a small loss, and the gap is what you pay for a chance at a whole block.",
];
export const OWNED_TITLE = "Owned hardware: upfront cost, power and resale";
export const OWNED_BODY =
  "Owning a miner swaps the rental price for an upfront purchase and an ongoing power bill. The average return per unit of hashrate is the same hashprice either way. What changes is that you keep the machine, which can be resold or kept running for years.";
export const WORTH_DISCLAIMER = "This is educational math, not financial advice.";

/* ── Rent vs own ────────────────────────────────────────────────────── */
export const COMPARE_TITLE = "Renting hashrate vs buying a miner";
export const COMPARE_ROWS: { label: string; rent: string; own: string }[] = [
  { label: "Upfront cost", rent: "Nothing beyond the rental itself.", own: "You buy the hardware first." },
  { label: "Ongoing cost", rent: "The rental price, with power included.", own: "Your own power bill, every hour it runs." },
  { label: "Noise and heat", rent: "None at home. The machines are professionally hosted in the US.", own: "Small home miners are quiet. Large machines are loud, hot and may need their own circuit." },
  { label: "Flexibility", rent: "Pick a new amount of hashrate and new hours every time.", own: "Fixed hashrate, running as long as you like." },
  { label: "What you keep", rent: "Nothing once the rental ends.", own: "The hardware, which has resale value." },
  { label: "Setup time", rent: "Minutes once your pool profile is saved.", own: "Unbox, connect, configure and keep it updated." },
  { label: "Shape of the chance", rent: "A big hashrate for a short window.", own: "A small hashrate for a long window. Equal total hashing means an equal chance." },
];
export const COMPARE_CLOSE =
  "Neither is the right answer for everyone. Pick based on whether you want an ongoing hobby or a one-off shot.";

/* ── HowTo: rented ──────────────────────────────────────────────────── */
export const RENT_HOWTO_TITLE = "How to lottery mine with rented hashrate";
export const RENT_HOWTO_STEPS: { title: string; body: string }[] = [
  { title: "Open a marketplace account", body: `Create a free ${M} account and fund it with bitcoin or another coin it accepts.` },
  { title: "Choose a solo pool and save its address", body: "Pick a pool that offers solo mining and copy its stratum address. Use a hostname, not a bare IP, and save at least two endpoints so the hashrate can fail over." },
  { title: "Set your payout address as the worker", body: "Many solo pools use your bitcoin address as the username, so a found block pays that address. Use an address from a wallet you control, and follow your pool's own guide." },
  { title: "Set the difficulty", body: "Use the fixed or suggested difficulty your pool recommends for rented hashrate. A setting that is far too low or too high can make shares fail." },
  { title: "Rent the hashrate and watch the shares", body: "Pick your hashrate on our hashrate page and rent it with your saved pool profile. Hashing ramps up over the first half hour, and accepted shares should appear on your pool." },
];
export const MISTAKES_TITLE = "Common setup mistakes";
export const MISTAKES = [
  "Pointing hashrate at a bare IP address instead of the pool's hostname.",
  "Saving only one pool endpoint, so the hashrate has nowhere to go if it drops.",
  "Leaving the difficulty far from what the pool recommends for rented hashrate.",
  "Using an exchange deposit address as the payout address instead of your own wallet.",
];
export const ARRIVING_TITLE = "How to check the hashrate is arriving";
export const ARRIVING_BODY = `Watch two places. ${M} shows a live hashrate graph for every rental, and your pool shows accepted shares and your current hashrate. If both climb over the first half hour, the hashrate is arriving.`;

/* ── Own miner ──────────────────────────────────────────────────────── */
export const OWN_TITLE = "How to lottery mine with your own miner";
export const OWN_BODY = [
  "Open your miner's settings page, enter a solo pool's stratum address, and put your bitcoin address in the worker or username field. Most pools ignore the password field, so any short value works.",
  "Small home miners are quiet enough for a desk and draw little power. Several shops in our directory sell mining hardware for bitcoin.",
];

/* ── Pools ──────────────────────────────────────────────────────────── */
export const POOLS_TITLE = "Choosing a solo pool";
export const POOLS_BODY =
  "Several well-known pools offer a solo mode. Before you point hashrate at one, check its fee, whether it pays the block reward straight to your address, and whether it accepts rented hashrate. Read those terms on the pool's own site on the day you start. Galaxy Mind is not affiliated with any pool.";

/* ── Found a block ──────────────────────────────────────────────────── */
export const FOUND_TITLE = "What happens if you find a block";
export const FOUND_BODY = [
  "The block's first transaction, called the coinbase, pays the whole reward. With a non-custodial solo pool it pays your address directly, minus the pool's fee.",
  "Those new coins cannot be spent until 100 more blocks have been mined on top, which takes about 17 hours. This is the coinbase maturity rule described in the Bitcoin developer guide.",
];

/* ── Has anyone won? ────────────────────────────────────────────────── */
export const WON_TITLE = "Has anyone really won a block this way?";
export const WON_LEAD =
  "Yes, several times a year. Two recent finds that news outlets reported, and that block explorers confirm:";
export const WON_CASES: { title: string; body: string; href: string }[] = [
  {
    title: "Block 966,351 · September 10, 2026",
    body: "A solo miner found the first solo block in nearly 40 days and received about 3.147 BTC.",
    href: "https://news.bitcoin.com/mining/solo-bitcoin-miner-hits-244k-jackpot-after-nearly-40-day-drought/",
  },
  {
    title: "Block 960,804 · August 2, 2026",
    body: "A solo miner received about 3.157 BTC. The pool's developer said the hashrate looked rented and peaked near 100 PH/s.",
    href: "https://news.bitcoin.com/mining/solo-bitcoin-miner-defies-the-odds-lands-200k-block-reward-jackpot/",
  },
];
export const WON_CLOSE = "These are rare events. For every reported find, a great many attempts found nothing.";

/* ── Reddit themes ──────────────────────────────────────────────────── */
export const REDDIT_TITLE = "What experienced miners say";
export const REDDIT_THEMES = [
  "It is basically gambling, and people who enjoy it treat it that way.",
  "Set a budget you are comfortable losing before you start, and stick to it.",
  "Check that your pool works with rented hashrate before you pay for any.",
];
export const REDDIT_SOURCES: { label: string; href: string }[] = [
  { label: "Solo mined a block (basically gambling)", href: "https://www.reddit.com/r/cryptomining/comments/1panbpx/solo_mined_a_block_basically_gambling/" },
  { label: "ASIC rentals?", href: "https://www.reddit.com/r/BitcoinMining/comments/1q97wj3/asic_rentals/" },
  { label: "Are mining rentals feasible?", href: "https://www.reddit.com/r/cryptomining/comments/1egfosq/are_mining_rentals_feasible/" },
];

/* ── FAQ ────────────────────────────────────────────────────────────── */
export const LOTTERY_FAQ: { q: string; a: string }[] = [
  { q: "What is lottery mining?", a: "Lottery mining is solo mining with a small share of the network's hashrate. You keep the whole block reward, minus any pool fee, if you find a block, and you get nothing if you don't." },
  { q: "What are the odds of finding a bitcoin block solo?", a: "Your chance for each block is your hashrate divided by the network's hashrate. Over n blocks, the chance of at least one is 1 − (1 − p)^n. This page and our solo mining calculator work it out live from the current network." },
  { q: "Does mining longer improve my odds?", a: "Only because you buy more total hashing. Mining has no memory, so you never get closer to a block. Six hours at 1 PH/s gives the same chance as twelve hours at 500 TH/s." },
  { q: "Is lottery mining profitable?", a: "On average, no. Solo mining pays out hashprice on average, and rented or owned hashrate usually costs at least that much. The small average loss is the price of a chance at a whole block." },
  { q: "Should I rent hashrate or buy a miner?", a: "Renting gives a big hashrate for a short window with nothing to keep afterwards. Owning gives a small hashrate for a long window plus hardware you can resell. Pick based on whether you want a hobby or a one-off shot." },
  { q: "Which pool should I use for solo mining?", a: "Pick a pool with a solo mode, then check its fee, whether it pays your address directly, and whether it accepts rented hashrate. Galaxy Mind is not affiliated with any pool." },
  { q: "What happens if I find a block?", a: "The coinbase transaction pays the reward, which is the subsidy plus fees minus the pool's fee. With a non-custodial solo pool it goes straight to your address. The coins can be spent after 100 more blocks." },
  { q: "Has anyone won a block by lottery mining?", a: "Yes. Solo finds are reported several times a year, including blocks 960,804 and 966,351 in 2026. They are rare, and most attempts find nothing." },
];

/* ── CTA ────────────────────────────────────────────────────────────── */
export const CTA_TITLE = "Try it, with your eyes open";
export const CTA_BODY =
  "Galaxy Mind rents US-based (US South) hashrate in 270 TH/s chunks that mine to your own wallet, through the pool you choose. Run the odds first, then pick an amount you are comfortable with.";
export const CTA_PRIMARY = "Rent 270 TH/s chunks that mine to your own wallet";
export const CTA_SECONDARY = "Run your odds";
