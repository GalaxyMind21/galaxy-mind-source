// /hashrate/antminer-s21-xp copy (2026-10-18, SEO brief rank 1).
// The operator approved naming the Antminer S21 XP on THIS page only, as a
// one-time exception to the no-model-names rule that governs every other
// rental surface (lib/mrr-page-copy.ts). Two sibling models appear once, in
// the comparison table and the hydro paragraph, because the brief targets
// "s21 xp vs s21 pro" and autocomplete mixes the air and hydro versions.
//
// House rules this file keeps (scripts/test-s21xp-page.ts enforces them):
//   - every spec comes from Bitmain's own support pages, cited by URL;
//   - no marketplace prices, no dollar projections, no "will" forecasts;
//   - none of the hashrate vocabulary bans (TIER1/TIER2 in hashrate-copy);
//   - no pool names, no rig ids, no listing titles, no location beyond
//     "US-based", no word "real", no em-dash clause breaks;
//   - no outbound marketplace link at all: every rent CTA goes to /hashrate,
//     which owns the single gated marketplace mention and the referral.

export const S21XP_URL = "https://galaxymind.space/hashrate/antminer-s21-xp";
export const S21XP_PUBLISHED = "2026-10-18";
export const S21XP_UPDATED = "2026-10-18";

export const S21XP_META_TITLE = "Antminer S21 XP Specs & How to Rent One · Galaxy Mind";
export const S21XP_DESCRIPTION =
  "Antminer S21 XP specs from Bitmain (270 TH/s, 13.5 J/TH), what one unit's solo odds look like today, and how to rent US-based S21 XP hashrate by the hour.";
export const S21XP_H1 = "Antminer S21 XP: Specs, Solo-Mining Odds, and How to Rent One by the Hour";
export const S21XP_OG_ALT =
  "Antminer S21 XP specs, solo-mining odds and how to rent one by the hour · Galaxy Mind";

/** The answer box (40 to 60 words). Opens with a direct, quotable answer. */
export const S21XP_SHORT =
  "The Antminer S21 XP is Bitmain's air-cooled Bitcoin miner, rated at about 270 TH/s while drawing about 3,645 W, which works out to 13.5 J/TH. It mines SHA-256 coins and needs a 220 to 277 V circuit. If you only want to try one, you can rent a US-based S21 XP's hashrate by the hour on our rent page.";

/* ── Specs (Bitmain support page, created 2024-07-22, updated 2024-07-25) ── */
export const BITMAIN_S21XP_SPEC_URL =
  "https://support.bitmain.com/hc/en-us/articles/35383015643673-S21-XP-Specifications";
export const BITMAIN_S21PRO_SPEC_URL =
  "https://support.bitmain.com/hc/en-us/articles/31321354157593-S21-Pro-Specification";
export const BITMAIN_S21XPHYD_SPEC_URL =
  "https://support.bitmain.com/hc/en-us/articles/34523540504857-S21-XP-Hyd-Specification";

/** The numbers the page computes with. Typical values from Bitmain. */
export const S21XP_TH = 270;
export const S21XP_WATTS = 3645;
export const S21XP_J_PER_TH = 13.5;

export const S21XP_SPECS: { label: string; value: string }[] = [
  { label: "Maker", value: "Bitmain" },
  { label: "Algorithm", value: "SHA-256" },
  { label: "Coins", value: "BTC, BCH, BSV" },
  { label: "Hashrate", value: "270 TH/s typical (±3%)" },
  { label: "Power at the wall", value: "3,645 W at 25 °C inlet air (±5%)" },
  { label: "Efficiency", value: "13.5 J/TH at 25 °C inlet air (±5%)" },
  { label: "Input voltage", value: "220 to 277 V AC, 50 to 60 Hz" },
  { label: "Input current", value: "20 A, single phase" },
  { label: "Power supply rating", value: "4,000 W" },
  { label: "Cooling", value: "Air (fans)" },
  { label: "Noise", value: "76 dBA at maximum fan speed" },
  { label: "Network", value: "RJ45 Ethernet 10/100M" },
  { label: "Size without box", value: "449 × 219 × 293 mm" },
  { label: "Net weight", value: "18.7 kg" },
  { label: "Operating temperature", value: "-20 to 45 °C" },
  { label: "Operating humidity", value: "10 to 90% RH, non-condensing" },
];
export const S21XP_SPEC_SOURCE =
  "Source: Bitmain's S21 XP Specifications page. Hashrate and power are typical values. Bitmain says hashrate can vary by ±3% and power by ±5%.";

/* ── Comparison (each row from that model's own Bitmain spec page) ─────── */
export const S21XP_COMPARE: { model: string; th: string; watts: string; eff: string; cooling: string; power: string; source: string }[] = [
  { model: "S21 XP", th: "270 TH/s", watts: "3,645 W", eff: "13.5 J/TH", cooling: "Air", power: "220 to 277 V, single phase", source: BITMAIN_S21XP_SPEC_URL },
  { model: "S21 Pro", th: "234 TH/s", watts: "3,510 W", eff: "15 J/TH", cooling: "Air", power: "220 to 277 V, single phase", source: BITMAIN_S21PRO_SPEC_URL },
  { model: "S21 XP Hyd", th: "473 TH/s", watts: "5,676 W", eff: "12.0 J/TH", cooling: "Water", power: "380 to 415 V, three phase", source: BITMAIN_S21XPHYD_SPEC_URL },
];
export const S21XP_COMPARE_NOTE =
  "Air-cooled figures are at 25 °C inlet air. The hydro figures are at 35 °C inlet coolant. All three come from Bitmain's own specification pages.";
export const S21XP_EFFICIENCY =
  "The S21 XP uses about 10% less energy per terahash than the S21 Pro, and it hashes about 15% faster from a similar power draw. Lower J/TH means more hashing for every kilowatt-hour you pay for.";
export const S21XP_HYDRO =
  "The S21 XP Hyd is the water-cooled sibling, rated at 473 TH/s and 12.0 J/TH. It runs on three-phase power and a coolant loop, so it belongs in a mining site, not a garage. If a search result mixes the two, the 270 TH/s figure is the air-cooled S21 XP.";

/* ── Is it worth running? Formula plus live sources, never a projection ── */
export const S21XP_WORTH_SHORT =
  "Whether an S21 XP pays for its power depends on two numbers that move every day: what you pay for electricity and the live hashprice. Nobody can promise the answer ahead of time, so here is how to work it out yourself.";
export const S21XP_WORTH_NUMBERS: string[] = [
  "Hashprice: what one unit of hashrate is paid each day across the network. It moves with the value of bitcoin, fees and network difficulty.",
  "Power cost: one S21 XP uses about 87.5 kWh a day (3.645 kW for 24 hours). Multiply that by what you pay per kWh.",
  "Uptime: a miner that is off, too hot or misconfigured hashes nothing. Count the hours it actually runs.",
];
export const S21XP_WORTH_FORMULA =
  "Daily result = hashrate × hashprice − power cost. Plug in today's numbers rather than anyone's forecast.";
export const S21XP_WORTH_SOURCES: { label: string; href: string; note: string }[] = [
  { label: "mempool.space mining dashboard", href: "https://mempool.space/mining", note: "Live network hashrate and difficulty." },
  { label: "Hashrate Index", href: "https://hashrateindex.com", note: "Live hashprice as a data source." },
];

/* ── Solo odds ────────────────────────────────────────────────────────── */
export const S21XP_ODDS_SHORT =
  "One S21 XP is a tiny slice of the whole Bitcoin network, so its chance of finding a block alone is small. The figures below use today's network hashrate from mempool.space and update through the day.";
export const S21XP_ODDS_DAY = "Chance in 24 hours";
export const S21XP_ODDS_WEEK = "Chance in 7 days";
export const S21XP_ODDS_LINE = "about 1 in {N}";
export const S21XP_ODDS_NOTE =
  "Estimate for one 270 TH/s unit hashing nonstop on a solo pool, against today's network of about {EH} EH/s. Most solo attempts find nothing, and that is normal.";
export const S21XP_ODDS_NONE =
  "The live network figure isn't available right now, so we're not showing odds. They're small for a single unit, and the calculator below will show them once the data is back.";
export const S21XP_ODDS_WHY =
  "Each block goes to whoever finds a valid hash first. Your chance at each block is your hashrate divided by the network's, and a single machine is well under one millionth of the total. Many solo miners run for months and find nothing. Treat a block as a bonus, never a plan.";

/* ── Rent instead of buying ───────────────────────────────────────────── */
export const S21XP_RENT_SHORT =
  "Yes. Galaxy Mind rents professionally hosted, US-based S21 XP hashrate in 270 TH/s chunks, from 3 hours up to 7 days. You choose the pool and the payout address, and we never hold your coins.";
export const S21XP_RENT_POINTS: string[] = [
  "Hashrate in 270 TH/s chunks, which is one S21 XP each.",
  "Rentals from 3 hours up to 7 days.",
  "Your pool and your payout wallet. We never touch the coins and never ask for ID.",
  "US-based, professionally hosted machines with steady power and cooling.",
];
export const S21XP_DELIVERY: string[] = [
  "Watch the live hashrate graph for each unit you rent.",
  "Check the accepted shares on your own pool's dashboard.",
  "If a unit underdelivers, the rental marketplace's own refund rules apply, and you can see them before you pay.",
];

/* ── Rent vs buy (tradeoffs only, no recommendation) ───────────────────── */
export const S21XP_RENT_VS_BUY: { topic: string; buy: string; rent: string }[] = [
  { topic: "Upfront cost", buy: "You pay for the machine before it hashes.", rent: "You pay for the hours you choose." },
  { topic: "Power", buy: "About 3.6 kW on a 220 to 277 V circuit, around the clock.", rent: "None at your place." },
  { topic: "Noise and heat", buy: "Up to 76 dBA, with the heat of a large space heater.", rent: "Neither reaches your home." },
  { topic: "Resale", buy: "You own hardware you can sell later.", rent: "Nothing to sell, nothing to store." },
  { topic: "Flexibility", buy: "Runs as long as you keep it powered.", rent: "From 3 hours up to 7 days at a time." },
];

/* ── Noise ────────────────────────────────────────────────────────────── */
export const S21XP_NOISE =
  "Bitmain rates the S21 XP at 76 dBA with the fans at full speed, which is loud enough to fill a room. It also turns about 3.6 kW into heat and needs a dedicated 220 to 277 V circuit. Renting keeps the noise, the heat and the wiring out of your house.";

/* ── Buy instead (vendors already in the directory) ────────────────────── */
export const S21XP_BUY_INSTEAD =
  "Prefer a machine on your own desk? These shops sell home-mining hardware for bitcoin and are listed in our directory.";
export const S21XP_BUY_VENDORS = ["Solo Satoshi", "Bitaxe Shop", "FutureBit"];

/* ── FAQ (same strings feed the visible list and FAQPage JSON-LD) ──────── */
export const S21XP_FAQ: { q: string; a: string }[] = [
  {
    q: "What is the Antminer S21 XP?",
    a: "It is Bitmain's air-cooled SHA-256 Bitcoin miner, rated at about 270 TH/s and 13.5 J/TH. It draws about 3,645 W at the wall and runs on 220 to 277 V.",
  },
  {
    q: "What is the hashrate of the S21 XP?",
    a: "Bitmain rates it at 270 TH/s typical, give or take 3%. Galaxy Mind rents hashrate in the same 270 TH/s chunks.",
  },
  {
    q: "How much power does the S21 XP use?",
    a: "About 3,645 W at the wall with 25 °C inlet air, give or take 5%. That is about 87.5 kWh over a full day.",
  },
  {
    q: "What is the difference between the S21 XP and the S21 Pro?",
    a: "The S21 XP is rated at 270 TH/s and 13.5 J/TH, and the S21 Pro at 234 TH/s and 15 J/TH. Both are air-cooled and run on single-phase 220 to 277 V.",
  },
  {
    q: "Is the S21 XP Hyd the same machine?",
    a: "No. The S21 XP Hyd is water-cooled, rated at 473 TH/s and 12.0 J/TH, and needs three-phase 380 to 415 V power and a coolant loop.",
  },
  {
    q: "What are the odds one S21 XP finds a block solo?",
    a: "Small. Your chance at each block is your hashrate divided by the network's. This page and the solo mining calculator work it out live for 270 TH/s over a day and a week.",
  },
  {
    q: "Can I rent an S21 XP instead of buying one?",
    a: "Yes. Galaxy Mind rents US-based S21 XP hashrate in 270 TH/s chunks for 3 hours up to 7 days. You set your own pool and payout address.",
  },
  {
    q: "Do I need KYC to rent?",
    a: "Not with us. We never ask for ID. The rental marketplace has its own account rules, and those still apply.",
  },
];

/** "26,000" style rounding to two significant figures, for odds lines. */
export function roundOneIn(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 10) return n.toFixed(1);
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return (Math.round(n / mag) * mag).toLocaleString("en-US");
}
