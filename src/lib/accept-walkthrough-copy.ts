// Setup walkthrough for /how-to-accept-bitcoin (2026-10-18). Three practical
// paths: Square's built-in bitcoin payments, a Lightning address or simple
// Lightning wallet, and self-hosted BTCPay Server. Every factual claim about
// Square or BTCPay is sourced to that company's or project's own pages, linked
// below as plain links. Providers are named only as examples, with no
// affiliate or referral links and no "best app" claims. Kept in one module so
// the visible page, the FAQPage JSON-LD and the guard test read the same strings.

// Page-level SEO strings (2026-10-18 SEO/AEO pass). The meta title and
// description lead with "how to accept bitcoin payments" and "small business",
// and name Lightning for "accept lightning payments".
export const ACCEPT_GUIDE_URL = "https://galaxymind.space/how-to-accept-bitcoin";
export const ACCEPT_META_TITLE = "How to Accept Bitcoin Payments as a Small Business · Galaxy Mind";
export const ACCEPT_SOCIAL_TITLE = "How to accept bitcoin and Lightning payments at your business";
export const ACCEPT_DESCRIPTION =
  "How to accept bitcoin and Lightning payments at a small business: Square's built-in option, a free Lightning address or BTCPay Server. Keep dollars or BTC.";
/** ISO dates for the Article JSON-LD; UPDATED is also the visible "Last updated". */
export const ACCEPT_PUBLISHED = "2026-06-20";
export const ACCEPT_UPDATED = "2026-10-18";

export type Source = { label: string; href: string };
export type WalkthroughBlock = { heading: string; items: string[] };
export type WalkthroughPath = {
  id: string;
  eyebrow: string;
  title: string;
  fit: string;
  blocks: WalkthroughBlock[];
  tradeoff: string;
  sources: Source[];
};

export const SQUARE_HELP =
  "https://squareup.com/help/us/en/article/8622-accept-and-manage-bitcoin-payments";
export const SQUARE_BITCOIN = "https://squareup.com/us/en/bitcoin";
export const SQUARE_PRESS = "https://squareup.com/us/en/press/square-bitcoin";

// One-line Square summary reused in the short answer, step 2 and the FAQ.
// Sourced: auto-enabled for eligible US locations with dollar settlement by
// default, 0% processing fee until Dec 31 2026 and 1% after (Square help
// article 8622 and the Square Bitcoin page). Square publishes no seller count,
// so the page gives none.
export const SQUARE_SUMMARY =
  "Square now turns on bitcoin payments over the Lightning Network for eligible US sellers by default, settles them to you in dollars unless you choose bitcoin, and charges a 0% processing fee through December 31, 2026 (1% after that).";

export const WALKTHROUGH_PATHS: WalkthroughPath[] = [
  {
    id: "setup-square",
    eyebrow: "Path 1 · Already on Square",
    title: "Turn on Square's bitcoin payments",
    fit: "Best fit for shops that already ring sales up on Square in the US.",
    blocks: [
      {
        heading: "Where the setting lives",
        items: [
          "Eligible US sellers have bitcoin payments turned on automatically. Square checks eligibility itself, and it is not offered to businesses located in New York.",
          "To set it up or pick how you get paid, open Square Dashboard and go to Banking, then Bitcoin. Older accounts click Get started there and verify the business.",
          "In the Square POS app, Bitcoin appears under Settings, then Checkout, then Payment. You can reorder it there or tap the X to turn it off.",
        ],
      },
      {
        heading: "What the customer sees",
        items: [
          "You ring up the sale, tap Pay and choose Bitcoin. A Lightning QR code appears and the customer scans it with any Lightning wallet.",
          "On Square Register the customer can pick Bitcoin on their own screen, and the 2nd generation Register also takes an NFC tap from a Lightning wallet.",
          "Payments settle in seconds. An unpaid QR expires after five minutes and you start a new cart at the fresh rate.",
        ],
      },
      {
        heading: "How you get paid",
        items: [
          "Dollars by default: Square converts each payment to dollars immediately. You can instead keep the bitcoin in your Square bitcoin wallet.",
          "Each payment can be up to the bitcoin equivalent of $600, with a $20,000 daily limit.",
        ],
      },
      {
        heading: "Fees",
        items: [
          "Bitcoin payments carry a 0% processing fee through December 31, 2026, then 1% per transaction.",
          "Separate Square bitcoin features cost extra: converting card sales into bitcoin and buying or selling bitcoin each carry a 1% fee.",
        ],
      },
    ],
    tradeoff:
      "Bitcoin payments have no chargebacks, and refunds go out as a Square gift card for the same dollar amount. If you keep bitcoin, tax on any gain is yours to track.",
    sources: [
      { label: "Square Support: Accept and manage bitcoin payments", href: SQUARE_HELP },
      { label: "Square Bitcoin: features, limits and fees", href: SQUARE_BITCOIN },
      { label: "Square newsroom: Square Bitcoin launch (Oct 8, 2025)", href: SQUARE_PRESS },
    ],
  },
  {
    id: "setup-lightning-address",
    eyebrow: "Path 2 · Tiny shops and online sellers",
    title: "Get a free Lightning address",
    fit: "Best fit for market stalls, makers, side businesses and anyone selling online without a full checkout.",
    blocks: [
      {
        heading: "How to get one",
        items: [
          "A Lightning address looks like an email address, such as yourshop@wallet.example, and lets anyone send you bitcoin from a Lightning wallet.",
          "Many Lightning wallet apps hand you one for free when you sign up. Examples include Wallet of Satoshi, Strike, Blink and Coinos, where they are available. Check identity checks, country availability and fees in the app first.",
          "Apps that hold the coins for you are the quickest start. Self-custody wallets keep the keys on your phone and take a little more setup.",
        ],
      },
      {
        heading: "How to show it",
        items: [
          "Print the address and its QR code on a small card at the register, a market table or the back of a menu.",
          "Online, put it on your order page, in your invoice emails and in your social bios. Some wallet apps also give you a simple web keypad page you can open on a tablet as a register.",
        ],
      },
      {
        heading: "How to take a payment",
        items: [
          "For an exact amount, create an invoice in your wallet app for the price and let the customer scan the QR code. It shows as paid within seconds.",
          "With the printed address, the customer scans it, types the amount and sends. Check that the payment arrived in your app before you hand over the goods.",
        ],
      },
    ],
    tradeoff:
      "Fees are usually a fraction of a cent, but an app that holds your coins is trusting a company with them, so move savings to your own wallet regularly. Bookkeeping and taxes are on you, since there is no processor report.",
    sources: [
      { label: "Lightning Address: how the name@domain format works", href: "https://lightningaddress.com/" },
    ],
  },
  {
    id: "setup-btcpay",
    eyebrow: "Path 3 · Online stores that want no middleman",
    title: "Self-host BTCPay Server",
    fit: "Best fit for online stores on WooCommerce, Shopify and similar platforms that want payments straight to their own wallet.",
    blocks: [
      {
        heading: "Set it up",
        items: [
          "BTCPay Server is free, open-source payment software with no processing fee. Payments go straight to your own wallet.",
          "Pick a deployment: a third-party host to try it out, or your own server or cloud machine for full control.",
          "Create a store, connect your wallet so BTCPay can make a fresh address for every order, and add Lightning if you want instant small payments.",
          "Install the plugin for your platform, such as WooCommerce or Shopify, or use the built-in Point of Sale app as a simple shop or register page. Then place one small test order.",
        ],
      },
    ],
    tradeoff:
      "You run the server, keep it updated and keep backups. Lightning also needs a node with some liquidity, so plan an afternoon for setup.",
    sources: [
      { label: "BTCPay Server docs: choosing a deployment", href: "https://docs.btcpayserver.org/Deployment/" },
      { label: "BTCPay Server docs: third-party hosting", href: "https://docs.btcpayserver.org/ThirdPartyHosting/" },
      { label: "BTCPay Server docs: WooCommerce integration", href: "https://docs.btcpayserver.org/WooCommerce/" },
      { label: "BTCPay Server docs: Shopify integration", href: "https://docs.btcpayserver.org/Shopify/" },
      { label: "BTCPay Server docs: Point of Sale and other apps", href: "https://docs.btcpayserver.org/Apps/" },
    ],
  },
];

export const WALKTHROUGH_NOTE =
  "We name providers only as examples. We do not recommend one over another and earn nothing from any of them, and this page has no affiliate or referral links.";

export const WALKTHROUGH_SOURCES: Source[] = WALKTHROUGH_PATHS.flatMap((p) => p.sources);
