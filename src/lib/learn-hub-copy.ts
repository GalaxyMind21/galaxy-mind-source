// Copy for /learn · the hub behind the "Learn" nav group (SEO desk idea 14,
// 2026-10-18). The nav has said "Learn" since the 2026-07-08 rethink, but
// /learn itself was a 404, so a visitor (or a crawler) guessing the obvious
// URL hit a dead end. This page gathers the guides that already exist into
// one crawlable index. It links only to live in-site routes, quotes no
// numbers that can drift, and the CollectionPage/ItemList JSON-LD is built
// from the same LEARN_SECTIONS array the page renders.

export const LEARN_PATH = "/learn";
export const LEARN_URL = `https://galaxymind.space${LEARN_PATH}`;

export const LEARN_TITLE = "Learn bitcoin: every Galaxy Mind guide in one place";
export const LEARN_META_TITLE = "Learn Bitcoin: Beginner Guides to Buy, Spend and Mine · Galaxy Mind";
export const LEARN_DESCRIPTION =
  "Free, plain-English bitcoin guides: how to buy it safely, pay with Lightning, spend it at verified shops, accept it at your business and rent hashrate.";
export const LEARN_OG_ALT =
  "Galaxy Mind guide card: Learn bitcoin. Every guide in one place, from buying safely to spending, accepting and mining.";

export const LEARN_SHORT =
  "New to bitcoin? Start with how to buy it safely, then learn how to pay with Lightning and where to spend it. Business owners can learn how to accept it, and curious miners can see how renting hashrate works. Every guide here is free, and none of them carries an affiliate link.";

export type LearnLink = { href: string; title: string; blurb: string };
export type LearnSection = { id: string; title: string; intro: string; links: LearnLink[] };

export const LEARN_SECTIONS: LearnSection[] = [
  {
    id: "start-here",
    title: "Start here",
    intro: "The first questions most people ask, answered in plain words.",
    links: [
      { href: "/how-to-buy-bitcoin", title: "How to buy bitcoin safely", blurb: "Six careful steps, the scams to avoid, and seven books worth reading." },
      { href: "/how-to-pay-with-lightning", title: "How to pay with Lightning", blurb: "Pay a Lightning invoice even if you do not own any bitcoin yet." },
      { href: "/glossary", title: "Bitcoin glossary", blurb: "Clear definitions for the words you will meet, one term at a time." },
      { href: "/is-it-too-late-to-buy-bitcoin", title: "Is it too late to buy bitcoin?", blurb: "A live gauge of market signals plus the fixed 21 million supply." },
    ],
  },
  {
    id: "spend",
    title: "Spend bitcoin",
    intro: "Where bitcoin works as money today, with every shop checked by a person.",
    links: [
      { href: "/online-stores-that-accept-bitcoin", title: "Online stores that accept bitcoin", blurb: "The full verified list of independent shops, grouped by what they sell." },
      { href: "/spend-bitcoin-on", title: "Spend bitcoin by category", blurb: "Browse clothing, food, hardware and more, with live shop counts." },
      { href: "/buy-coffee-with-bitcoin", title: "Buy coffee with bitcoin", blurb: "Roasters that ship beans and take bitcoin at checkout." },
      { href: "/spend-and-replace", title: "Spend and replace", blurb: "Pay in bitcoin, rebuy the same amount, and keep your stack whole." },
      { href: "/nostr-marketplaces", title: "Nostr marketplaces", blurb: "How open, Nostr-based markets work and how they differ from a directory." },
      { href: "/state-of-bitcoin-directories", title: "The state of bitcoin directories", blurb: "Which merchant directories are still alive, checked one by one." },
    ],
  },
  {
    id: "business",
    title: "For businesses",
    intro: "For shop owners who want to take bitcoin and be found by people who spend it.",
    links: [
      { href: "/how-to-accept-bitcoin", title: "How to accept bitcoin payments", blurb: "Three simple routes for a small business, and how to keep dollars or bitcoin." },
      { href: "/how-many-businesses-accept-bitcoin", title: "How many businesses accept bitcoin?", blurb: "The count we can prove, with the method in the open." },
      { href: "/how-to-help-grow-bitcoin", title: "How to help grow bitcoin", blurb: "Small habits that grow the circular economy without selling your stack." },
    ],
  },
  {
    id: "mining",
    title: "Mining and hashrate",
    intro: "How blocks are found, what the odds look like, and how renting hashrate works.",
    links: [
      { href: "/hashrate/how-to-rent", title: "How to rent hashrate, step by step", blurb: "Point rented SHA-256 hashrate at the pool of your choice." },
      { href: "/lottery-mining-bitcoin", title: "Lottery mining bitcoin", blurb: "The honest odds of finding a block, and renting versus owning a miner." },
      { href: "/solo-mining-calculator", title: "Solo mining odds calculator", blurb: "The exact chance of finding a block for any hashrate and time window." },
      { href: "/bitcoin-halving-countdown", title: "Bitcoin halving countdown", blurb: "Days and blocks until the next cut to new supply." },
    ],
  },
  {
    id: "treasuries",
    title: "Bitcoin treasury companies",
    intro: "For readers comparing public companies that hold bitcoin on their balance sheet.",
    links: [
      { href: "/gross-vs-net-mnav", title: "Gross vs net mNAV", blurb: "Three ways to value a bitcoin treasury company, side by side." },
      { href: "/what-is-amplification", title: "What is amplification?", blurb: "How much extra bitcoin per share senior leverage adds." },
      { href: "/mstr-vs-bitcoin", title: "MSTR vs bitcoin", blurb: "When the stock holds bitcoin at a discount, and when it does not." },
      { href: "/ibit-vs-mstr", title: "IBIT vs MSTR", blurb: "A spot fund and a leveraged treasury company, compared live." },
    ],
  },
  {
    id: "reference",
    title: "How we work",
    intro: "The methods behind every number and every listing on the site.",
    links: [
      { href: "/methodology", title: "Methodology", blurb: "How each tool is computed and how every shop is vetted." },
      { href: "/faq", title: "Frequently asked questions", blurb: "Short answers about the directory, the tools and renting hashrate." },
    ],
  },
];

export const LEARN_ALL_LINKS: LearnLink[] = LEARN_SECTIONS.flatMap((s) => s.links);
