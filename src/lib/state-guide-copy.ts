// /spend-bitcoin-in/tennessee copy (2026-10-18, SEO brief rank 2).
// The operator approved naming Tennessee at the state level and presenting
// Galaxy Mind as a Tennessee bitcoin treasury company. That framing stays
// one factual sentence: no investment claims, returns, price talk or
// holdings figures. This page never mentions mining, hashrate or where any
// machines run, and it links nothing on the rental side of the site.
//
// Every named business was checked on 2026-10-18 (own site, X or Nostr, and
// a current way to pay in bitcoin). The evidence is kept outside the repo
// in a private log. Businesses that
// only had a third-party map pin are left off and reached via BTC Map links.
// Legal content is a dated factual summary with citations, not legal advice.
import { VENDORS, type Vendor } from "@/lib/vendors";

export const TN_URL = "https://galaxymind.space/spend-bitcoin-in/tennessee";
export const TN_PUBLISHED = "2026-10-18";
export const TN_UPDATED = "2026-10-18";
/** The "as of" date for the legal status and the business checks. */
export const TN_AS_OF = "October 18, 2026";

export const TN_META_TITLE = "Spend Bitcoin in Tennessee (2026) · After the ATM Ban";
export const TN_DESCRIPTION =
  "Bitcoin ATMs have been banned in Tennessee since July 1, 2026. See where you can still spend bitcoin across the state and online.";
export const TN_H1 = "Where to Spend Bitcoin in Tennessee (2026)";
export const TN_OG_ALT =
  "Where to spend bitcoin in Tennessee in 2026, after the state's bitcoin ATM ban · Galaxy Mind";

/** The answer box (50 to 70 words). */
export const TN_SHORT =
  "Bitcoin ATMs have been illegal to operate in Tennessee since July 1, 2026, but spending and owning bitcoin are still legal. For walk-in places, use BTC Map, which shows many pins in every part of the state, from Memphis to Knoxville. To shop online, our directory lists hand-checked US shops that ship. To get bitcoin safely without a kiosk, read our beginner's guide.";

export const NOT_LEGAL_ADVICE =
  "This page is a plain summary of public sources as of the date shown. It is not legal advice.";

/* ── The ATM ban ──────────────────────────────────────────────────────── */
export const TN_LAW_URL = "https://www.capitol.tn.gov/Bills/114/Bill/HB2505.pdf";
export const TN_BILL_URL = "https://wapp.capitol.tn.gov/apps/BillInfo/Default?BillNumber=HB2505&ga=114";
export const TN_TDFI_URL = "https://www.tn.gov/tdfi/mortgage-consumer-lending/mort-lending-bulletins/virtual-currency-kiosks.html";
export const TN_AG_URL = "https://www.tn.gov/attorneygeneral/news/2026/7/7/pr26-26.html";
export const TN_DOCKET_URL = "https://dockets.justia.com/docket/tennessee/tnedce/3:2026cv00284/125020";
export const FTC_ATM_URL = "https://consumer.ftc.gov/consumer-alerts/2024/09/scammers-use-bitcoin-atms-steal-your-money";

export const TN_LAW_QUOTE =
  "knowingly install or allow installation of, permit, place, or otherwise operate a virtual currency kiosk in this state";
export const TN_LAW_SUMMARY =
  "Public Chapter 766 (House Bill 2505) passed the House 94 to 0 and the Senate 32 to 0, was signed on April 13, 2026, and took effect on July 1, 2026. It makes it a Class A misdemeanor to:";
export const TN_LAW_SCOPE =
  "The state's Department of Financial Institutions explains that the law reaches kiosk operators and also anyone who knowingly lets a kiosk sit on property they own, lease or control.";
export const TN_WHY =
  "The Attorney General's office says the legislature acted after testimony about crypto ATMs being used in scams that have cost victims millions of dollars nationwide.";
export const TN_LAWSUIT =
  "Kiosk operator CoinFlip and others sued in federal court in the Eastern District of Tennessee. The court denied their request for a temporary restraining order on June 30, 2026, so the law took effect on schedule. The plaintiffs filed an amended complaint on August 3, 2026, and the case is still open.";
export const TN_ATM_MEANING: string[] = [
  "Any bitcoin ATM still operating in Tennessee would be breaking state law, even if a map app still shows it.",
  "The ban covers kiosks only. Owning, buying, selling and spending bitcoin are still legal in Tennessee.",
  "If anyone tells you to put cash into a bitcoin machine to protect your money or pay a bill, it is a scam. Hang up and call your bank using a number you already know.",
];

/* ── Walk-in places ───────────────────────────────────────────────────── */
export type TnPlace = {
  name: string;
  city: string;
  body: string;
  /** The business's own site. */
  href: string;
  /** Set only for businesses present in src/lib/vendors.ts. */
  inDirectory: boolean;
};

export const TN_DIRECTORY_INTRO =
  "BTC Map shows more pins around the state's largest city than anywhere else in the state. These two places are in our directory, and we checked both again on the date shown.";
export const TN_DIRECTORY_PLACES: TnPlace[] = [
  {
    name: "Bitcoin Park",
    city: "Tennessee",
    body: "A community campus for bitcoiners with free monthly public meetups, workshops and coworking for members. You can support it in bitcoin through its crowdfunding page.",
    href: "https://bitcoinpark.com",
    inDirectory: true,
  },
  {
    name: "Bitcoin Museum & Art Gallery",
    city: "Tennessee",
    body: "Bitcoin art, artifacts and history, with original artworks auctioned and paid for in bitcoin.",
    href: "https://museum.b.tc",
    inDirectory: true,
  },
];
export const TN_CHAIN_PLACE: TnPlace = {
  name: "Steak 'n Shake",
  city: "Statewide",
  body: "The burger chain has taken bitcoin since May 2025, and BTC Map shows locations across the state. Check your location before you go.",
  href: "https://www.steaknshake.com",
  inDirectory: false,
};
export const TN_CONFERENCE_TIP =
  "Planning a visit for a bitcoin event? Bitcoin Park posts its public meetups on its schedule page, and the museum's site lists what is on view.";

export const BTCMAP_URL = "https://btcmap.org/map";
export type TnCity = { name: string; body: string; mapHref: string; extra?: { label: string; href: string } };
export const TN_CITIES: TnCity[] = [
  {
    name: "Knoxville",
    body: "Knoxville has an active local bitcoin community that keeps its own merchant list on BTC Map. Start there for restaurants and shops that take bitcoin in person.",
    mapHref: "https://btcmap.org/map#13/35.9606/-83.9207",
    extra: { label: "Knoxville Bitcoin merchants on BTC Map", href: "https://btcmap.org/community/knoxville-bitcoin" },
  },
  {
    name: "Chattanooga",
    body: "Chattanooga's bitcoin community runs its own map of local businesses that accept bitcoin, and BTC Map has more pins across the area, including a Steak 'n Shake.",
    mapHref: "https://btcmap.org/map#13/35.0456/-85.3097",
    extra: { label: "Bitcoin Chatt business map", href: "https://www.bitcoinchatt.com/map/" },
  },
  {
    name: "Memphis",
    body: "Memphis has a smaller set of pins, from shops on Beale Street to local services. Open BTC Map before you go, because pins can change.",
    mapHref: "https://btcmap.org/map#13/35.1495/-90.0490",
  },
];
export const TN_MAP_NOTE =
  "We link to BTC Map for walk-in places rather than copying its pins, because its volunteers keep them current. Our own directory covers shops that sell online.";

/* ── Online ───────────────────────────────────────────────────────────── */
export const TN_ONLINE_INTRO =
  "You can shop online with bitcoin from anywhere in Tennessee. Every shop below is in our directory, and a person confirmed it takes bitcoin, with the date shown on its page.";

/* ── Getting bitcoin without an ATM ───────────────────────────────────── */
export const TN_GET_BITCOIN: string[] = [
  "The kiosk ban does not stop you from buying bitcoin. People in Tennessee still buy through exchanges and apps, from other people, or by being paid in bitcoin for work.",
  "Start small, compare the total cost including spreads and fees, and move your coins to a wallet you control.",
  "Never buy bitcoin because someone on the phone told you to. That is the most common scam pattern there is.",
];

/* ── Businesses ───────────────────────────────────────────────────────── */
export const TN_BUSINESS =
  "Run a Tennessee business? Taking bitcoin can be as simple as a Lightning app on your phone or a setting in the point-of-sale system you already use. Our merchant guide walks through the options. If you sell online, you can ask to be listed in our directory for free.";

/* ── About us (the approved treasury framing, kept factual) ────────────── */
export const TN_ABOUT_TITLE = "About Galaxy Mind";
export const TN_TREASURY_LINE = "Galaxy Mind is a Tennessee bitcoin treasury company.";
export const TN_ABOUT_BODY =
  "We run a free directory of shops that take bitcoin, and a person checks every listing. We wrote this guide for people across the state who want to use bitcoin as money.";

/* ── FAQ (visible list and FAQPage JSON-LD share these strings) ──────── */
export const TN_FAQ: { q: string; a: string }[] = [
  {
    q: "Are bitcoin ATMs legal in Tennessee?",
    a: "No. Since July 1, 2026, Public Chapter 766 makes it a Class A misdemeanor to knowingly install, allow, place or operate a virtual currency kiosk in Tennessee. A federal court declined to block the law, and the lawsuit against it is still open as of October 18, 2026.",
  },
  {
    q: "Why did Tennessee ban crypto ATMs?",
    a: "The Attorney General's office says lawmakers acted after testimony that crypto ATMs were being used in scams that have cost victims millions of dollars nationwide.",
  },
  {
    q: "Does the ban apply to every kiosk company?",
    a: "Yes. It covers any kiosk operator and anyone who knowingly allows a kiosk on property they own, lease or control. CoinFlip is one of the operators challenging the law in court.",
  },
  {
    q: "Can I still buy bitcoin in Tennessee?",
    a: "Yes. The ban covers kiosks, not owning, buying or spending bitcoin. Our beginner's guide explains the main ways to buy and how to avoid scams.",
  },
  {
    q: "Which Tennessee places are in the Galaxy Mind directory?",
    a: "Bitcoin Park and the Bitcoin Museum & Art Gallery are both in our directory. BTC Map shows many more walk-in places across the state.",
  },
  {
    q: "Where can I spend bitcoin in Knoxville, Chattanooga or Memphis?",
    a: "Use BTC Map for current walk-in pins. Knoxville and Chattanooga also have local bitcoin communities that keep their own merchant maps, and Steak 'n Shake takes bitcoin across the state.",
  },
  {
    q: "Can I shop online with bitcoin from Tennessee?",
    a: "Yes. Our directory lists US shops that take bitcoin, each confirmed by a person, so you can order from home.",
  },
  {
    q: "Is a bitcoin ATM still showing on a map near me?",
    a: "Map listings can be out of date. Under current Tennessee law, an operating kiosk would be illegal, and anyone telling you to deposit cash into one is running a scam.",
  },
];

/** Online picks: one US shop per category, in this order. */
export const TN_ONLINE_CATEGORIES = ["apparel", "hardware", "consumables", "books", "collectibles", "general-goods"] as const;

/** Galaxy Mind's own listing is US-tagged too; it never belongs in the shop picks. */
export function isUsShop(v: Vendor): boolean {
  return v.country === "US" && !/galaxy mind/i.test(v.name);
}

/** One US shop per category, alphabetical, skipping the walk-in anchors above. */
export function onlinePicks(): Vendor[] {
  const anchors = new Set(TN_DIRECTORY_PLACES.map((p) => p.name));
  const out: Vendor[] = [];
  for (const cat of TN_ONLINE_CATEGORIES) {
    const pick = VENDORS.filter((v) => isUsShop(v) && v.category === cat && !anchors.has(v.name)).sort((a, b) =>
      a.name.localeCompare(b.name),
    )[0];
    if (pick) out.push(pick);
  }
  return out;
}

