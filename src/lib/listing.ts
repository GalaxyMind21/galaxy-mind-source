/**
 * The bitcoin.org Spend Bitcoin listing.
 *
 * PR #4912 merged 2026-08-19. The Shop-online card on
 * https://bitcoin.org/en/spend-bitcoin names this directory. The
 * listing is revocable: vendors must genuinely accept bitcoin, the
 * site must not promote illicit activity or gambling, and the roster
 * must stay curated and up to date.
 *
 * Use these constants anywhere the listing is cited so the URL and
 * the claim cannot drift apart.
 */
export const BITCOIN_ORG_SPEND_URL = "https://bitcoin.org/en/spend-bitcoin";
export const BITCOIN_ORG_LISTING_LABEL = "Listed on bitcoin.org";

/**
 * Independence claim shown on public trust surfaces (homepage, about,
 * faq, footer, support). Must stay true of the live site.
 *
 * Coupled to `MRR_REFERRAL_ID` in lib/mrr.ts: if that id is ever
 * non-null, this sentence cannot claim the whole site has no referral
 * links. The bitcoin.org listing is why the DIRECTORY stays unpaid;
 * MiningRigRentals rent links on /hashrate are a separate, disclosed
 * referral. Both facts have to be true at once.
 */
export const INDEPENDENCE_CLAIM =
  "No ads, no listing fees. This directory has no affiliate links.";
