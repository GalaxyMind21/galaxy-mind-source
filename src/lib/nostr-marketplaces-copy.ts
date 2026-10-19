// Copy for /nostr-marketplaces · a neutral "what is a Nostr marketplace"
// explainer (competitor teardown lesson A5, 2026-10-18). the operator okayed naming
// Conduit, Shopstr and Plebeian Market on Oct 18:
// factual and neutral, lead with Galaxy Mind's strengths, no disparaging
// claims, and cite only what each project states on its own site or GitHub.
// One module so the visible page and the FAQPage JSON-LD read the same text.

export const NM_PATH = "/nostr-marketplaces";
export const NM_URL = `https://galaxymind.space${NM_PATH}`;

export const NM_TITLE = "What is a Nostr marketplace?";
export const NM_META_TITLE = "Nostr Marketplaces: Conduit, Shopstr, Plebeian · Galaxy Mind";
export const NM_DESCRIPTION =
  "What a Nostr marketplace is, how Conduit, Shopstr and Plebeian Market work, and how they differ from Galaxy Mind's free, human-verified directory.";
export const NM_OG_ALT =
  "Galaxy Mind explainer card: What is a Nostr marketplace? Signed listings, Lightning checkout and encrypted order messages, compared with a free, human-verified directory.";

export const NM_SHORT =
  "A Nostr marketplace is an app where shops publish signed product listings to the open Nostr network. Shoppers browse those listings, pay over Lightning, and send order details to the seller as encrypted messages. No single company owns the listings or the seller's identity, so a shop can appear in more than one marketplace app at once.";

/** Galaxy Mind's strengths, shown first (operator 2026-10-18). */
export const NM_LEAD_TITLE = "Where Galaxy Mind fits";
export const NM_LEAD: string[] = [
  "Free to browse and free to list, with no paid placement and no affiliate links.",
  "Every shop is confirmed by a person, and each listing shows the date of that check.",
  "No account needed. You pay each shop directly on its own checkout.",
  "Shops found through X, Nostr or their own websites sit together in one list.",
];

export type NmBlock = { title: string; body: string };

export const NM_HOW: NmBlock[] = [
  {
    title: "Signed listings",
    body: "A seller publishes each product as a Nostr event signed with their private key. Open specs such as NIP-15 and NIP-99 describe the format, so any compatible app can read the same listing.",
  },
  {
    title: "npub identity",
    body: "The seller's identity is a public key, written as an npub, often paired with a NIP-05 address that looks like an email. Nobody can take that identity away or transfer it without the key.",
  },
  {
    title: "Lightning checkout",
    body: "Payment usually happens over Lightning, bitcoin's fast payment network. The buyer pays an invoice and the seller receives bitcoin directly, with no card network in the middle.",
  },
  {
    title: "Encrypted order messages",
    body: "Shipping details and order updates travel as encrypted Nostr messages between buyer and seller. Only the two of them can read those messages.",
  },
];

export type NmRow = { label: string; marketplace: string; directory: string };

export const NM_COMPARE: NmRow[] = [
  {
    label: "Where you pay",
    marketplace: "Inside the marketplace app, usually over Lightning.",
    directory: "On the shop's own checkout, after you click through.",
  },
  {
    label: "Which shops appear",
    marketplace: "Shops that publish listings to Nostr.",
    directory: "Any shop that takes bitcoin, wherever it sells.",
  },
  {
    label: "Who checks the seller",
    marketplace: "It varies by app, and many rely on reputation.",
    directory: "At Galaxy Mind, a person confirms each shop and shows the date.",
  },
  {
    label: "Account needed",
    marketplace: "It depends on the app, and some let you check out as a guest.",
    directory: "None. You browse freely and buy from the shop.",
  },
];

export type NmProject = {
  name: string;
  url: string;
  urlLabel: string;
  what: string;
  checkout: string;
  code: string;
  codeUrl: string;
};

/** Each row summarizes the project's OWN site or GitHub as read on
 *  2026-10-18. Facts only; no rankings, no traffic claims. */
export const NM_AS_OF = "October 18, 2026";
export const NM_PROJECTS: NmProject[] = [
  {
    name: "Conduit",
    url: "https://conduit.market/",
    urlLabel: "conduit.market",
    what: "A Nostr marketplace with a shopper app and a merchant portal. It says it is not the seller, merchant of record, payment custodian, carrier or escrow service.",
    checkout: "Yes. Shoppers pay the merchant directly over Lightning, and eligible orders can use guest checkout. Order details travel as encrypted messages.",
    code: "Code published on GitHub.",
    codeUrl: "https://github.com/Conduit-BTC",
  },
  {
    name: "Shopstr",
    url: "https://shopstr.market/",
    urlLabel: "shopstr.market",
    what: "A global, permissionless Nostr marketplace for bitcoin commerce. It states there are no mandatory platform fees.",
    checkout: "Yes. Buyers pay sellers directly with Lightning or Cashu, and the site includes a built-in wallet.",
    code: "Open source under GPL-3.0.",
    codeUrl: "https://github.com/shopstr-eng/shopstr",
  },
  {
    name: "Plebeian Market",
    url: "https://plebeian.market/",
    urlLabel: "plebeian.market",
    what: "A Nostr marketplace that describes its software as a circular economic community builder.",
    checkout: "See its site for current payment options.",
    code: "Open source under GPL-3.0.",
    codeUrl: "https://github.com/PlebeianApp/market",
  },
];

export const NM_WHY =
  "Bitcoin shops sell in many places. Some run their own store, some sell through X, and some publish to Nostr marketplaces. A shopper should not need to know which. Galaxy Mind keeps one free list of shops that a person confirmed take bitcoin, whatever platform they use, and it links you straight to the shop.";

export type NmFaq = { q: string; a: string };

export const NM_FAQ: NmFaq[] = [
  {
    q: "What is a Nostr marketplace?",
    a: "It is an app that shows product listings published to the open Nostr network. Sellers sign their listings with their own keys, and buyers usually pay over Lightning.",
  },
  {
    q: "Do I need a Nostr account to buy?",
    a: "It depends on the app. Some let you check out as a guest, and others ask you to sign in with a Nostr key so the seller can reply to your order.",
  },
  {
    q: "How is a Nostr marketplace different from a directory?",
    a: "A marketplace lets you pay inside its app. A directory such as Galaxy Mind points you to shops, and you pay each shop on its own checkout.",
  },
  {
    q: "What are some Nostr marketplaces?",
    a: "Conduit, Shopstr and Plebeian Market are three Nostr marketplaces. Each publishes its own details on its site, and the code for each is on GitHub.",
  },
  {
    q: "Is Galaxy Mind a Nostr marketplace?",
    a: "No. Galaxy Mind is a free, human-verified directory of shops that take bitcoin. It lists Nostr-native shops alongside shops found through X or their own websites.",
  },
  {
    q: "Can a shop on a Nostr marketplace also be listed here?",
    a: "Yes, and listing is free. Submit the shop with its npub, NIP-05 address or X handle, and a person reviews it, usually within 24 to 48 hours.",
  },
  {
    q: "How can I check a Nostr seller before I pay?",
    a: "Look for a NIP-05 address on the seller's own domain and a history of posts. Start with a small order, and keep your order messages until the package arrives.",
  },
];
