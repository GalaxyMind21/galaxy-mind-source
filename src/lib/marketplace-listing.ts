// The one copy module that may name MiningRigRentals in public output.
// History: the operator, 2026-10-17 added it as a secondary mention
// with our referral id. Galaxy Mind goes back to
// MiningRigRentals only, so this is now the PRIMARY way to rent
// (RENTALS_MODE=mrr_only, lib/rentals/mode.ts).
// the profile page (/u/...) is login-walled for signed-out visitors, so it is no longer linked anywhere;
// every "rent" link points at our own /hashrate (lib/rent-page.ts).
// scripts/check-no-mrr-public.ts holds this file to scripts/lib/no-mrr-mention.ts:
// only the one exact URL below, no digits or ref outside them, no prices, rig ids
// or locations, and the referral disclosed. Per-unit rig links are NOT here: they
// are generated only by lib/mrr-units.ts (its own narrow rule).

/** MRR signup, same referral id (an official referral link per MRR's help center). */
export const MARKETPLACE_REGISTER_URL = "https://www.miningrigrentals.com/register?ref=2770797";

export const MARKETPLACE_NAME = "MiningRigRentals";

/** Primary CTA everywhere (hero, header, home, rent page). */
export const MARKETPLACE_PRIMARY_CTA = "Rent on MiningRigRentals";
export const MARKETPLACE_REGISTER_CTA = "New to MiningRigRentals? Create an account";

/** /hashrate/rent and the fallback card when live availability is not current. */
export const MARKETPLACE_CARD_EYEBROW = "How to rent";
export const MARKETPLACE_CARD_TITLE = "Rent our hashrate on MiningRigRentals";
export const MARKETPLACE_CARD_BODY =
  "Every unit is listed on MiningRigRentals, where you pay, set your pool and follow the rental live.";
export const MARKETPLACE_CARD_CTA = "Pick your hashrate";
/** MRR's Referral Program bans hidden links, so the referral is disclosed wherever it appears. */
export const MARKETPLACE_REFERRAL_NOTE =
  "Referral link: MiningRigRentals may pay us a small referral reward if you sign up through it.";

/** Sitewide footer link to our own /hashrate page (internal, so no referral disclosure). */
export const MARKETPLACE_FOOTER_LINK = "Rent hashrate";

/** /hashrate FAQ entry, rendered with the main FAQ and in the FAQPage JSON-LD. */
export const MARKETPLACE_FAQ = {
  q: "Why do I rent through MiningRigRentals?",
  a: "Galaxy Mind rents its hashrate only through MiningRigRentals now. You get their account, escrow and refund policy, and you set your pool and hours there. Our links to them are referral links, so MiningRigRentals may pay us a small referral reward if you sign up through them.",
} as const;

/** Appended to the /faq "affiliate or referral links" answer so it stays true. */
export const MARKETPLACE_REFERRAL_FAQ_NOTE =
  "One exception outside the directory: the MiningRigRentals links on the hashrate pages are referral links, so MiningRigRentals may pay us a small referral reward if you sign up through them.";

/** Every closed direct-rental route and tool (HTTP 410 / MCP redirect). */
export const MARKETPLACE_CLOSED_MESSAGE = "Galaxy Mind rents through MiningRigRentals now. Direct checkout on galaxymind.space has closed.";
/** closeTheSale().how in mrr_only. */
export const MARKETPLACE_HOW = "Rent Galaxy Mind hashrate on MiningRigRentals.";

/** /terms/rental banner. */
export const MARKETPLACE_TERMS_BANNER_BODY =
  "New rentals happen on MiningRigRentals under their terms. This page stays as the record for rentals placed here before the close.";

/** Opens in a new tab, never passes a referrer. */
export const MARKETPLACE_LINK_REL = "noopener noreferrer";
