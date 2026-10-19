// Monthly "Letter from the directory" (operator-approved 2026-10-18, Conduit
// (b) item 5). One entry per month, newest first. Copy rules: warm,
// complete sentences; only shop-facing facts that can be checked in the
// repo (vendors.ts history, merged PRs) or on the live site; no invented
// numbers; no hashrate business numbers; no location details beyond a
// shop's country. Each letter is a dated snapshot, so figures are written
// as of its publish date and never recomputed.

export type LetterBlock =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | {
      kind: "shops";
      items: { name: string; href: string; note: string }[];
    };

export type Letter = {
  /** URL segment, YYYY-MM. */
  slug: string;
  /** "October 2026". */
  month: string;
  title: string;
  /** One-sentence summary for the index, meta description and JSON-LD. */
  summary: string;
  /** ISO date (UTC) the letter was published. */
  published: string;
  /** ISO date (UTC) of the last edit. */
  modified: string;
  body: LetterBlock[];
};

export const LETTERS: Letter[] = [
  {
    slug: "2026-10",
    month: "October 2026",
    title: "Letter from the directory · October 2026",
    summary:
      "Three new shops, one maker with two storefronts, new Also sold on links, and a shop we took down when its site stopped loading.",
    published: "2026-10-18",
    modified: "2026-10-18",
    body: [
      {
        kind: "p",
        text: "This is the first monthly letter from the Galaxy Mind directory. Once a month we will write down, in plain words, which shops joined, what we fixed and what we are working on next. As of October 18 the directory holds 139 listings across 21 countries, and a person checked each one before it went live.",
      },
      { kind: "h2", text: "New shops this month" },
      {
        kind: "p",
        text: "Three shops joined in October. Each one passed the same bar as every other listing: you can pay the shop itself in bitcoin, and we can see who runs it.",
      },
      {
        kind: "shops",
        items: [
          {
            name: "VoltVault",
            href: "/v/voltvault",
            note: "Open-box, unused electronics from the United States, with a guest checkout in on-chain bitcoin. Listed October 8.",
          },
          {
            name: "BitcoinStuffStore",
            href: "/v/bitcoinstuffstore",
            note: "Home mining gear, nodes and hardware wallets from the Netherlands, paid through the shop's own BTCPay Server. Listed October 15.",
          },
          {
            name: "Bitcoin Art Store",
            href: "/v/bitcoin-art-store",
            note: "Original bitcoin-inspired art prints from the United States, paid in Lightning or on-chain. Listed October 17.",
          },
        ],
      },
      { kind: "h2", text: "One maker, two shops" },
      {
        kind: "p",
        text: "Bitcoin Art Store comes from the same person who runs The Belief Machine, so this month we taught the directory that one owner can list more than one shop. Each shop keeps its own page and its own card, and each page now points to the owner's other shops.",
      },
      { kind: "h2", text: "Where else to find a shop" },
      {
        kind: "p",
        text: "Some shops in the directory also run a storefront on Conduit, a marketplace built on Nostr. Seven shop cards now carry a small Also sold on link, added only after we opened each storefront and matched it to the shop.",
      },
      { kind: "h2", text: "What broke, and what we did" },
      {
        kind: "p",
        text: "On October 13 we took PlebSource.com off the directory because its storefront stopped loading. We would rather show you one fewer shop than send you to a dead page, and its old link now brings you back to the directory instead of an error.",
      },
      {
        kind: "p",
        text: "VoltVault asked us to describe it as open-box, unused electronics, and we updated its card the same week. If anything on your own listing is out of date, tell us and we will fix it.",
      },
      { kind: "h2", text: "For shops" },
      {
        kind: "p",
        text: "Listing is free. There are no ads, no listing fees and no affiliate links, and nobody can pay to move up the page. If you sell for bitcoin and want to be found by people who hold it, you can apply on the submit page.",
      },
      {
        kind: "p",
        text: "Thank you for reading, and thank you to every shop that takes bitcoin. We will write again in November.",
      },
    ],
  },
];

export function letterBySlug(slug: string): Letter | undefined {
  return LETTERS.find((l) => l.slug === slug);
}

/** Visible text of a letter, in order (for tests and JSON-LD wordCount). */
export function letterText(l: Letter): string {
  return l.body
    .map((b) =>
      b.kind === "shops"
        ? b.items.map((i) => `${i.name}. ${i.note}`).join(" ")
        : b.text,
    )
    .join("\n");
}
