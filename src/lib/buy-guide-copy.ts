// Copy for /how-to-buy-bitcoin, the beginner guide (2026-10-18). General
// education only: no price calls, no "buy now", no exchange or app picks,
// and a plain "not financial advice" line. Peer-to-peer and no-ID options are
// described neutrally with their trade-offs. Hardware wallets are described
// generically; software wallets are named only as open-source examples.
// Books link to the author's or publisher's own page, or a free official copy,
// never to a retailer or affiliate link. One module feeds the visible page,
// the HowTo, FAQPage and ItemList JSON-LD and the guard test.

export const BUY_GUIDE_PATH = "/how-to-buy-bitcoin";
export const BUY_GUIDE_URL = `https://galaxymind.space${BUY_GUIDE_PATH}`;

export const BUY_GUIDE_TITLE = "How to buy bitcoin: a beginner's guide";
// Meta title and description target "how to buy bitcoin", "how to buy
// bitcoin safely" and "best bitcoin books for beginners" (2026-10-18 SEO pass).
export const BUY_GUIDE_META_TITLE = "How to Buy Bitcoin Safely: Beginner's Guide + 7 Books · Galaxy Mind";
export const BUY_GUIDE_SOCIAL_TITLE = "How to buy bitcoin safely: a beginner's guide, plus 7 bitcoin books";
export const BUY_GUIDE_DESCRIPTION =
  "How to buy bitcoin safely in six steps: start small, compare ways to buy, check fees, move coins to your own wallet and avoid scams. Plus 7 bitcoin books.";
/** ISO date shown as "Last updated" and used as the Article dateModified. */
export const BUY_GUIDE_PUBLISHED = "2026-10-18";
export const BUY_GUIDE_UPDATED = "2026-10-18";
export const BUY_GUIDE_OG_ALT =
  "Galaxy Mind guide card: How to buy bitcoin. Start small, compare fees, move coins to your own wallet and avoid scams.";

export const BUY_GUIDE_SHORT =
  "To buy bitcoin safely, start with a small amount you could hold through a long drop without selling. Buy through a regulated app, a bitcoin-only app with recurring buys, or a peer-to-peer market, and compare the total cost including the spread. Once you are comfortable, move your coins to a wallet you control and keep the recovery words offline. Never send bitcoin to anyone who contacts you first.";

export const NOT_ADVICE =
  "Not financial advice. This page is general education about how buying works, not a recommendation to buy, and bitcoin's price can fall a long way.";

export type BuyStep = { n: string; title: string; body: string; href?: string; hrefLabel?: string };

export const BUY_STEPS: BuyStep[] = [
  {
    n: "1",
    title: "Decide how much and how often",
    body: "Pick an amount you could leave alone for years, even if it halves first. Many beginners buy a small fixed amount on a schedule, called dollar-cost averaging, instead of trying to time one big purchase.",
    href: "/glossary/dollar-cost-averaging",
    hrefLabel: "What dollar-cost averaging is →",
  },
  {
    n: "2",
    title: "Pick a way to buy",
    body: "Most people start with a regulated exchange or brokerage app, or a bitcoin-only app that does recurring buys. Bitcoin ATMs and peer-to-peer markets are other routes, each with its own trade-offs below.",
  },
  {
    n: "3",
    title: "Check the total cost",
    body: "Add up the trading fee, the spread between the buy price and the market price, any card or deposit fee, and the fee to withdraw. The simplest comparison is how many sats you end up with for the same dollars.",
  },
  {
    n: "4",
    title: "Make a small first buy",
    body: "Start with a small purchase to learn the flow, then set up any recurring buy you want. Turn on two-factor authentication with an authenticator app rather than text messages.",
  },
  {
    n: "5",
    title: "Move it to your own wallet",
    body: "Coins left on an app belong to you only as long as the company holds up its end. When the amount matters to you, withdraw to a wallet where you hold the keys, sending a small test amount first.",
    href: "/glossary/self-custody",
    hrefLabel: "What self-custody means →",
  },
  {
    n: "6",
    title: "Guard your recovery words",
    body: "Write the 12 or 24 recovery words on paper or metal, store them offline and never type them into a website or share them. Anyone with those words can take the coins.",
  },
];

export type BuyMethod = {
  id: string;
  title: string;
  how: string;
  pros: string;
  cons: string;
  /** External project sites, plain links, no referral params. */
  links?: { label: string; href: string }[];
  /** On-site follow-ups. */
  internal?: { label: string; href: string }[];
};

export const BUY_METHODS: BuyMethod[] = [
  {
    id: "exchange",
    title: "A regulated exchange or brokerage app",
    how: "Sign up, verify your identity, link a bank account or card and place an order. Many stock brokerages and payment apps now sell bitcoin too.",
    pros: "Familiar, quick, with bank transfers and customer support. Usually the cheapest route for larger amounts when you pay by bank transfer.",
    cons: "You hand over ID and your history is on record. Some brokerages do not let you withdraw to your own wallet, so check that before you buy.",
  },
  {
    id: "bitcoin-only",
    title: "A bitcoin-only app with recurring buys",
    how: "These apps sell only bitcoin and focus on automatic daily, weekly or monthly buys, often with automatic withdrawal to your own wallet.",
    pros: "Simple dollar-cost averaging, fewer distractions from other coins, and easy self-custody habits.",
    cons: "Still requires ID. Fees vary widely between apps and between card and bank funding, so read the fee page.",
  },
  {
    id: "atm",
    title: "A bitcoin ATM",
    how: "Insert cash, scan your wallet's receive QR code, and the machine sends the bitcoin to it.",
    pros: "Works with cash and needs no bank account. Small purchases may need little or no ID, depending on local rules.",
    cons: "Fees and markups are usually far higher than an app. ATMs are also a favorite tool of scammers, so never use one because someone on the phone told you to.",
  },
  {
    id: "p2p",
    title: "Peer-to-peer and no-ID markets",
    how: "You buy directly from another person, and the software holds the bitcoin in escrow until the seller confirms your payment. Bisq is a desktop app, RoboSats runs over Lightning, and Hodl Hodl is a website.",
    pros: "No account with a company and no ID upload, so more privacy. Your coins go straight to your own wallet.",
    cons: "Prices often carry a premium over the market, trades are slower, and you must follow each platform's rules and dispute process closely. Bank-transfer fraud and local law are your risk, so start small.",
    links: [
      { label: "Bisq", href: "https://bisq.network/" },
      { label: "RoboSats", href: "https://learn.robosats.org/" },
      { label: "Hodl Hodl", href: "https://hodlhodl.com/" },
    ],
  },
  {
    id: "earn",
    title: "Earn it instead of buying it",
    how: "Sell goods or services and ask to be paid in bitcoin, take part of a paycheck in it, or contribute hashrate to the network through mining.",
    pros: "No exchange account needed, and earned sats usually come with no ID upload.",
    cons: "Mining at home is rarely profitable on electricity alone, and income in bitcoin can still be taxable where you live.",
    internal: [
      { label: "Take bitcoin for what you sell →", href: "/how-to-accept-bitcoin" },
      { label: "Or rent hashrate by the hour →", href: "/hashrate" },
    ],
  },
];

export const FEES_POINTS: string[] = [
  "Trading fee: a percentage or flat charge per order, often higher for small orders and card payments.",
  "Spread: the gap between the price you pay and the market price. Apps that advertise no fees often make their money here.",
  "Funding fee: card purchases usually cost more than bank transfers.",
  "Withdrawal or network fee: what it costs to send the coins to your own wallet. Batching into fewer, larger withdrawals keeps this low.",
];

export const WALLET_POINTS: string[] = [
  "Start with a well-reviewed open-source wallet app. Electrum and Sparrow are long-running open-source examples on desktop.",
  "For larger amounts, many people use a hardware wallet, a small device that keeps the keys offline and asks you to confirm each payment on its own screen. Buy one directly from its maker, never secondhand.",
  "Your wallet shows 12 or 24 recovery words once. Write them down by hand, keep them offline in a safe place and never photograph them.",
  "Send a small test amount first, check the address on the wallet's screen, and only then move the rest.",
];

export const SCAM_POINTS: string[] = [
  "No government agency, bank, utility or tech support desk will ever ask you to pay with bitcoin or at a bitcoin ATM.",
  "Guaranteed returns, doubling giveaways and celebrity endorsements are scams.",
  "Online friends or romantic matches who steer you toward a trading site are a common long con. Nobody legitimate needs your recovery words.",
  "Download wallet apps only from the maker's own site or official app store listing, and check the spelling of any site you sign in to.",
];

export type Book = { title: string; author: string; year: number; blurb: string; href: string; linkNote: string };

export const BOOKS: Book[] = [
  {
    title: "Bitcoin Is for Everyone",
    author: "Natalie Brunell",
    year: 2025,
    blurb: "A warm, plain-language first read on why today's money system strains and why bitcoin is open to anyone, written for complete newcomers.",
    href: "https://harriman-house.com/authors/natalie-brunell/bitcoin-is-for-everyone/9781804091135",
    linkNote: "Publisher's page (Harriman House)",
  },
  {
    title: "The Bitcoin Standard",
    author: "Saifedean Ammous",
    year: 2018,
    blurb: "The history of money from shells to gold to central banking, and the case for bitcoin as sound money.",
    href: "https://www.wiley.com/en-us/The+Bitcoin+Standard%3A+The+Decentralized+Alternative+to+Central+Banking-p-9781119473862",
    linkNote: "Publisher's page (Wiley)",
  },
  {
    title: "Broken Money",
    author: "Lyn Alden",
    year: 2023,
    blurb: "How money and payment networks evolved, why the current system strains, and where bitcoin fits.",
    href: "https://www.lynalden.com/broken-money/",
    linkNote: "Author's page",
  },
  {
    title: "Inventing Bitcoin",
    author: "Yan Pritzker",
    year: 2019,
    blurb: "A short, non-technical walk through how bitcoin works, built up one problem at a time.",
    href: "https://books.google.com/books/about/Inventing_Bitcoin.html?id=y3qZxgEACAAJ",
    linkNote: "Book listing (Google Books)",
  },
  {
    title: "Mastering Bitcoin, 3rd edition",
    author: "Andreas M. Antonopoulos and David A. Harding",
    year: 2023,
    blurb: "The technical reference on keys, addresses, transactions and the network, for readers who want depth.",
    href: "https://github.com/bitcoinbook/bitcoinbook",
    linkNote: "Free official copy (GitHub)",
  },
  {
    title: "The Blocksize War",
    author: "Jonathan Bier",
    year: 2021,
    blurb: "A history of the 2015 to 2017 fight over block size and who controls bitcoin's rules.",
    href: "https://farside.co.uk/the-blocksize-war/",
    linkNote: "Author's announcement",
  },
  {
    title: "Layered Money",
    author: "Nik Bhatia",
    year: 2021,
    blurb: "How money works in layers, from gold to central bank reserves, and how bitcoin and Lightning map onto them.",
    href: "https://www.layeredmoney.com/",
    linkNote: "Author's site",
  },
];

export type BuyFaq = { q: string; a: string };

/** Spelled-out book count for prose ("Seven well-known titles"). */
const NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const BOOKS_COUNT_WORD = NUM_WORDS[BOOKS.length] ?? String(BOOKS.length);

export const BUY_FAQ: BuyFaq[] = [
  {
    q: "What is the easiest way to buy bitcoin?",
    a: "For most beginners it is a regulated exchange, brokerage or bitcoin-only app: verify your identity, link a bank account and place a small order. Check that the app lets you withdraw to your own wallet before you buy.",
  },
  {
    q: "How much bitcoin should a beginner buy?",
    a: "Only an amount you could hold through a long price drop without needing to sell. Many people start with a small fixed amount on a regular schedule. This is general education, not financial advice.",
  },
  {
    q: "Do I have to buy a whole bitcoin?",
    a: "No. Each bitcoin divides into 100 million sats, and most apps let you buy a few dollars' worth.",
  },
  {
    q: "Can I buy bitcoin without ID?",
    a: "Peer-to-peer markets such as Bisq, RoboSats and Hodl Hodl let you trade directly with another person without uploading ID to a company. Expect higher prices, slower trades and more care around payment fraud, and check local law. Earning bitcoin by selling goods or services is another route.",
  },
  {
    q: "Should I keep my bitcoin on the exchange?",
    a: "Small amounts for learning are fine, but coins on an exchange depend on that company. Many people withdraw to a wallet where they hold the keys once the amount matters to them.",
  },
  {
    q: "What is a seed phrase?",
    a: "It is the list of 12 or 24 recovery words your wallet shows when you create it. Those words can restore your coins on a new device, so anyone who sees them can take your bitcoin. Write them down offline and never share them.",
  },
  {
    q: "What are the best bitcoin books for beginners?",
    a: "For a gentle first read, try Bitcoin Is for Everyone by Natalie Brunell or Inventing Bitcoin by Yan Pritzker. The Bitcoin Standard, Broken Money and Layered Money explain the history of money and where bitcoin fits. Mastering Bitcoin is the technical reference, and its authors publish a free official copy.",
  },
  {
    q: "Where can I spend bitcoin once I have it?",
    a: "Galaxy Mind keeps a free directory of online shops that take bitcoin, and each listing shows the date a person last confirmed it. Many of them take Lightning, which settles in seconds for a tiny fee.",
  },
];
