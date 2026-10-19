/**
 * Vendor-badge outreach · the flywheel's "tell the merchant it exists"
 * half.
 *
 * The SVG at /api/badge/vendor/[slug] is a click-through trust mark:
 * shoppers on the merchant's own site see "Accepts Bitcoin · Verified",
 * tap it, and land on /v/[slug] where a human confirmation is
 * sitting in the open. Adoption was ~zero because the only people who
 * ever saw the snippet were submitters who left an email, plus whoever
 * the operator remembered to DM.
 *
 * There is still no DM sender in this repo (standing decision). What
 * this module automates is the draft: one paste-ready DM per vendor,
 * dripped 3/day through the social-post-drafts email the operator
 * already opens each morning, with sent-state in KV so the same shop
 * is not drafted twice. New submitters still get the snippet in the
 * you're-live email; this covers the rest of the roster, and anyone
 * added by hand.
 *
 * Voice: the DM is a message a person types, not a page. No interpunct,
 * no em dashes, no "not just" filler. The voice gate in
 * scripts/test-social-drafts.ts walks every vendor's DM.
 */
import {
  STALE_THRESHOLD_DAYS,
  VENDOR_BADGE,
  getDisplayHandle,
  getPlatform,
  getProfileUrl,
  vendorBadgeSnippet,
  vendorSlug,
  vendorWebsite,
  type Vendor,
  type VendorPlatform,
} from "./vendors";

/** One hash, field per handle. Public handle + a unix sentAt. No email. */
export const BADGE_OUTREACH_KEY = "gm:badge-outreach:v2";

/** Daily drip size. Small enough to actually send; 103 shop URLs take ~5 weeks. */
export const BADGE_OUTREACH_BATCH = 3;

/** The self-serve grab page. One URL for every listed merchant. */
export const BADGE_PAGE_PATH = "/badge";
export const BADGE_PAGE_HOST = "galaxymind.space/badge";
export const BADGE_PAGE_URL = `https://${BADGE_PAGE_HOST}`;

/**
 * One public post so the whole roster hears about the badge without
 * 131 DMs. Voice-contract: no interpunct, no em dash, URL last, first
 * line has no URL. Char count uses X's 23-char t.co length.
 */
export function badgeLaunchPost(): { text: string; charCount: number } {
  const url = BADGE_PAGE_HOST;
  const text = [
    "If you sell for bitcoin and you're listed on Galaxy Mind, your verified badge is ready.",
    "",
    "It says Accepts Bitcoin, Verified. A shopper who clicks it lands on your listing.",
    "",
    `Grab yours: ${url}`,
  ].join("\n");
  const charCount = text.length - url.length + 23;
  return { text, charCount };
}

export type BadgeOutreachRecord = { sentAt: number };

export type BadgeOutreachVendor = Pick<Vendor, "name" | "handle"> &
  Partial<
    Pick<Vendor, "platform" | "website" | "shopUrl" | "listedAt" | "nostrPubkey">
  >;

export type BadgeOutreachChannel = {
  platform: VendorPlatform;
  href: string | null;
  label: string;
};

/**
 * Shop-owner benefits. Used on /v and in the modal (site typography
 * allowed). The DM restates the same facts in prose so the two cannot
 * disagree about what the badge does.
 */
export const BADGE_BENEFITS = [
  "Shoppers see they can pay with bitcoin without hunting through the page.",
  "A click opens your Galaxy Mind listing, so they can confirm a person here checked that you take bitcoin.",
  "The badge stays honest on its own. If a human has not re-checked you recently it flips to “check listing”, never a stale green.",
  "Free. No account, no listing fee, no affiliate.",
] as const;

export function badgeListingUrl(slug: string): string {
  return `https://galaxymind.space/v/${slug}`;
}

export function badgeOutreachChannel(
  v: BadgeOutreachVendor,
): BadgeOutreachChannel {
  const platform = getPlatform(v);
  return {
    platform,
    href: getProfileUrl(v),
    label: getDisplayHandle(v),
  };
}

/**
 * Paste-ready DM. Full sentences, hyphen bullets, one listing URL, the
 * live embed snippet. The HTML in the snippet is the thing they paste
 * into their shop; it has to stay in the message.
 */
export function badgeDmText(v: BadgeOutreachVendor): string {
  const slug = vendorSlug(v);
  const page = badgeListingUrl(slug);
  const { label, live, stale } = VENDOR_BADGE;
  return [
    `Hey! Galaxy Mind here. ${v.name} is listed with us: ${page}`,
    ``,
    `We made you a badge for your shop. It says "${label}, ${live}". A customer who clicks it lands on that listing and can confirm a person here checked that you take bitcoin.`,
    ``,
    `Why put it on the site:`,
    `- Shoppers see they can pay with bitcoin without hunting through the page`,
    `- The click is third-party proof they can check themselves`,
    `- It stays honest on its own. If a human has not re-checked you in ${STALE_THRESHOLD_DAYS} days it flips to "${stale}" instead of going stale green`,
    `- Free. No account, no listing fee, no affiliate`,
    ``,
    `Paste this in your footer or near checkout:`,
    vendorBadgeSnippet(slug),
    ``,
    `If you would rather we tweak the wording or leave you alone, just say so.`,
  ].join("\n");
}

/**
 * Operator paste block printed by add-vendor / review-submissions.
 * The DM itself is the payload; the rule lines are so it is obvious
 * where to select.
 */
export function badgeHandoffText(v: BadgeOutreachVendor): string {
  const channel = badgeOutreachChannel(v);
  const where = channel.href ? `Send via ${channel.href}` : "Send as a DM";
  return [
    "",
    "─ Send them this ────────────────────────────────────────────",
    "",
    where,
    "",
    badgeDmText(v),
    "",
    "─────────────────────────────────────────────────────────────",
    "",
  ].join("\n");
}

/**
 * Next n vendors to draft. Shops first (they have a page to put the
 * badge on), newest listed first (they are still paying attention),
 * Lightning-only rows skipped (no DM channel). `sentHandles` is the
 * exact handle string stored on the Vendor row.
 */
export function pickBadgeOutreachBatch(
  vendors: readonly BadgeOutreachVendor[],
  sentHandles: ReadonlySet<string>,
  n: number = BADGE_OUTREACH_BATCH,
): BadgeOutreachVendor[] {
  const remaining = vendors.filter((v) => {
    if (sentHandles.has(v.handle)) return false;
    if (getPlatform(v) === "lightning") return false;
    return true;
  });
  const newerFirst = (a: BadgeOutreachVendor, b: BadgeOutreachVendor) =>
    (b.listedAt ?? 0) - (a.listedAt ?? 0);
  const withShop = remaining.filter((v) => vendorWebsite(v)).sort(newerFirst);
  const without = remaining.filter((v) => !vendorWebsite(v)).sort(newerFirst);
  return [...withShop, ...without].slice(0, Math.max(0, n));
}
