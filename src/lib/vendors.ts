// Community-curated directory of vendors (X / Nostr / Lightning) selling
// physical goods for Bitcoin. See VendorPlatform below for the per-platform
// identity model. Default platform is "x" for backward compat with entries
// added before the multi-platform rewrite shipped.
//
// The shop URL defaults to the platform profile because most merchants
// transact primarily through DMs / profile-linked storefronts; when a stable
// storefront URL is known we'd add it as `shopUrl` and use that on the card
// button.
//
// `addedAt` is a stable index used for the "Newest First" sort. Larger =
// more recently added to this directory.

export type VendorCategory =
  | "apparel"
  | "general-goods"
  | "hardware"
  | "consumables"
  | "collectibles"
  | "services"
  | "books";

// Identity platform a vendor lives on. Drives display + link-out
// behavior in <VendorCard />:
//   • "x"         → handle is an X username (no @);   profile = x.com/handle
//   • "nostr"     → handle is a NIP-05 address (foo@bar.com) OR an npub1…;
//                   profile = njump.me/<handle>
//   • "lightning" → handle is a Lightning Address (foo@bar.com);
//                   primary CTA opens the wallet via lightning: URI scheme
//
// Field is OPTIONAL with a default of "x" — every existing vendor was
// added before Nostr/Lightning support shipped, so they implicitly stay
// on X. New vendors must specify if they're not on X.
export type VendorPlatform = "x" | "nostr" | "lightning";

export type Vendor = {
  // Platform-specific identifier:
  //   X        → bare username (no @)
  //   Nostr    → NIP-05 address (`name@domain`) or `npub1…` hex pubkey
  //   Lightning→ Lightning Address (`name@domain`)
  // The IDENTITY that runs the shop, not the listing's key. Since
  // 2026-10 one handle may own several listings (each its own shop,
  // name, website and /v page); the listing key is vendorKey() = the
  // slug. check-vendors holds slugs and storefronts (websites) unique.
  handle: string;
  // Where this vendor's primary identity lives. Defaults to "x" when
  // omitted, preserving backwards compat with the original schema.
  platform?: VendorPlatform;
  name: string;
  description: string;
  // DEPRECATED. The original schema distinguished payment rails
  // (Bitcoin only / Lightning / Lightning + on-chain) but the
  // distinction was noise — the directory's entire premise is "they
  // take bitcoin", and which rail a vendor uses is internal plumbing
  // most visitors don't care about. Field is kept optional so existing
  // entries don't have to be edited; new entries can omit it; the
  // card no longer renders it.
  paymentNote?: string;
  category: VendorCategory;
  shopUrl?: string;
  addedAt: number; // ordinal: stable index for "Newest First" sort
  // Unix-seconds, UTC midnight of the day this vendor FIRST appeared in
  // the directory. IMMUTABLE — a re-verification sweep must never touch it.
  //
  // This is the field every "recently added" surface reads. verifiedAt
  // answers a different question (is this listing still good?) and the two
  // were conflated until 2026-08-15, when a genuine hand re-walk of the
  // roster reset 128 verifiedAt values and consequently marked the entire
  // directory NEW, re-published the whole RSS feed, and came within a day
  // of emailing subscribers all 129 vendors as "new this week". Keep them
  // separate. Required, not optional: an optional field invites a
  // `?? verifiedAt` fallback, which is exactly the coupling being removed.
  listedAt: number;
  // Unix-seconds timestamp of last manual confirmation that the vendor
  // still accepts BTC. Update when re-verifying. Used to surface "verified
  // recently" trust signals in the UI; vendors past STALE_THRESHOLD_DAYS
  // get a re-verification hint.
  verifiedAt: number;
  // ISO-3166-1 alpha-2 country code where the vendor primarily operates.
  // Optional because we only set it when known with confidence. Used for
  // the country filter and to render a flag emoji on the card.
  country?: string;

  // ════════════════════════════════════════════════════════════════
  // Circular-economy enrichment (added May 2026 · all optional)
  //
  // These fields move Galaxy Mind from a one-way directory toward
  // the connector layer for the Bitcoin circular economy.
  //
  // Every field is optional · old entries continue to work
  // unchanged. The modal and /v/[slug] page render each field only
  // when present.
  // ════════════════════════════════════════════════════════════════

  // Lightning Address for direct payment receiving · independent of
  // the vendor's primary platform. A vendor whose handle is on X
  // can still expose a lud16 here for direct sats. Format:
  // `name@domain.tld` (LNURL-pay endpoint will be at
  // https://domain.tld/.well-known/lnurlp/name).
  lightningAddress?: string;

  // Nostr public key (npub1... bech32 form preferred) for NIP-04 /
  // NIP-44 direct messages. Lets bitcoiners message the vendor on
  // Bitcoin-native infrastructure even when their primary platform
  // is X. May duplicate the `handle` field on Nostr-platform
  // vendors · that's fine, the renderers handle the duplication.
  nostrPubkey?: string;

  // Explicit "yes, on-chain BTC works" / "yes, Lightning works"
  // signals. Default assumption (when unset) is BOTH yes · setting
  // either to `false` is a meaningful signal ("Lightning only
  // please" · "on-chain only, no LN setup yet"). Surfaces as small
  // badges in the modal.
  acceptsOnChain?: boolean;
  acceptsLightning?: boolean;

  // Physical-goods vendors: do they ship internationally? Enables
  // cross-border discovery once the country filter has its second
  // dimension. For services / digital vendors leave unset (n/a).
  shipsInternational?: boolean;

  // Circular-economy hooks · the heart of the Phase 1A enrichment.
  //
  // tradeFriendly · explicit "open to barter / trade with other
  //                  vendors" · surfaces a ★ Open to trade badge.
  // interestedIn  · categories the vendor would consider trading
  //                  FOR. A consumables vendor with
  //                  interestedIn: ["hardware"] is signaling "I'd
  //                  swap food for a Bitaxe."
  tradeFriendly?: boolean;
  interestedIn?: VendorCategory[];

  // Human touch · the founder/operator's first name (or chosen
  // identity). "Made by Sarah" reads more personal than just the
  // shop name. Optional · vendors who want to stay anonymous skip.
  founderName?: string;

  // Promoted form of the legacy shopUrl field · displayed in the
  // modal as a tertiary "Visit shop →" link, NOT a primary CTA
  // (the X / Nostr / Lightning action stays primary because that's
  // where the conversation happens). Either field works; if both
  // are set, `website` wins. Renderers MUST go through vendorWebsite()
  // — reading `.website` alone drops any shopUrl-only row (the house
  // listing shipped that way and the /v page had no rent CTA).
  website?: string;

  // Profile picture URL · the vendor's avatar, used in the
  // VendorCard and detail modal. For X vendors we fall back to
  // unavatar.io/x/<handle> dynamically so this field is OPTIONAL
  // for X. For Nostr vendors with bech32 handles (npub/nprofile),
  // there's no public CDN we can hit · the kind:0 metadata fetch
  // is the only way, and it requires a WebSocket relay query that
  // would add 1-3s of latency to every modal open. Pre-populating
  // this field at vendor-add time (via the /submit form's
  // enrichment OR a periodic refresh script) eliminates the
  // runtime cost. Falls back to the initials chip if missing.
  pictureUrl?: string;

  // Optional founder photo · DISTINCT from pictureUrl (which is the
  // brand logo / shop avatar). When set, /v/[slug] renders a small
  // human-face block under "Made by <founderName>" so visitors can
  // associate a real person with the shop. Vendors who want to stay
  // anonymous (or whose brand and founder are visually
  // interchangeable, like a sole proprietor) leave this unset and
  // the founder appears as text only.
  //
  // Source: vendor-supplied URL (their own CDN, primal.net blossom,
  // Nostr kind:0 metadata's `picture` field if it's a face rather
  // than a logo, etc.). Same CSP img-src ('self' data: https:) covers
  // it · no allow-list needed at runtime.
  founderPhoto?: string;

  // Optional founder quote · a single sentence (~< 200 chars) in
  // the founder's own voice that adds personality beyond the
  // formal vendor description. Renders as a styled blockquote on
  // /v/[slug] with attribution to founderName. Leave unset for a
  // pure-shop vibe; set when the founder has a clear "why" they
  // want to convey ("I started this so plebs could heat their
  // homes with hashrate," etc.).
  //
  // Distinct from `description` because:
  //   · description is the third-person shop summary (factual)
  //   · quote is the first-person founder statement (emotional)
  // Both render on /v/[slug] but in different visual blocks.
  quote?: string;

  // "Also sold on" (operator-approved 2026-10-18, Conduit (b) item 3).
  // The shop's OWN storefront on a Nostr marketplace, rendered as
  // small nofollow outbound links on the card. Populate only after a
  // human (or bot) has opened the URL and confirmed it is this shop's
  // storefront: same npub as our listing, or the shop's own profile /
  // website / X bio links it. Never guess from a name match alone.
  // check-vendors.ts holds each url to its marketplace's host.
  alsoSoldOn?: AlsoSoldOn[];
};

export type Marketplace = "conduit" | "shopstr" | "plebeian";

export type AlsoSoldOn = {
  marketplace: Marketplace;
  url: string;
};

// Display label + the only hosts a url may point at, per marketplace.
export const MARKETPLACES: Record<
  Marketplace,
  { label: string; hosts: readonly string[] }
> = {
  conduit: { label: "Conduit", hosts: ["shop.conduit.market"] },
  shopstr: { label: "Shopstr", hosts: ["shopstr.store"] },
  plebeian: { label: "Plebeian Market", hosts: ["plebeian.market"] },
};

/**
 * Validated "Also sold on" links for a vendor: https only, host must be
 * one of that marketplace's hosts, at most one link per marketplace.
 * Anything malformed is dropped rather than rendered.
 */
export function alsoSoldOnLinks(
  v: Pick<Vendor, "alsoSoldOn">,
): { marketplace: Marketplace; label: string; url: string }[] {
  const out: { marketplace: Marketplace; label: string; url: string }[] = [];
  const seen = new Set<Marketplace>();
  for (const entry of v.alsoSoldOn ?? []) {
    const m = MARKETPLACES[entry.marketplace];
    if (!m || seen.has(entry.marketplace)) continue;
    let u: URL;
    try {
      u = new URL(entry.url);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" || !m.hosts.includes(u.hostname)) continue;
    seen.add(entry.marketplace);
    out.push({ marketplace: entry.marketplace, label: m.label, url: u.toString() });
  }
  return out;
}

// ---- Platform helpers ----------------------------------------------
// Centralize per-platform behavior so the rendering layer doesn't sprinkle
// `if (v.platform === "x") ...` everywhere.

export function getPlatform(v: Pick<Vendor, "platform">): VendorPlatform {
  return v.platform ?? "x";
}

/**
 * Public profile URL for the vendor. Returns null for Lightning addresses
 * (they're a payment endpoint, not a profile to visit).
 */
export function getProfileUrl(
  v: Pick<Vendor, "platform" | "handle">,
): string | null {
  switch (getPlatform(v)) {
    case "x":
      return `https://x.com/${v.handle}`;
    case "nostr":
      // njump.me redirects either NIP-05 or npub to the right Nostr
      // identity page on whichever client renders it best.
      return `https://njump.me/${v.handle}`;
    case "lightning":
      return null;
  }
}

// Lightning Address shape · mirrors NIP05_OR_LN_RE in
// scripts/check-vendors.ts and /api/submit-vendor. The validator is
// the PRIMARY gate (every entry passes it at commit time); this is a
// render-time defense-in-depth guard so an address that somehow
// bypassed validation (manual hand-edit, a programmatic-enrichment
// bug, a future bulk import) can never be interpolated into a
// `lightning:` URI / href. Audit 2026-05.
const LN_ADDRESS_RE = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Build a `lightning:` URI from a Lightning Address, returning null if
 * the address is malformed. Callers MUST treat null as "render no
 * link" rather than emitting a broken/again-unvalidated href.
 */
export function lightningHref(
  address: string | undefined | null,
): string | null {
  if (!address) return null;
  return LN_ADDRESS_RE.test(address) ? `lightning:${address}` : null;
}

/**
 * URL the primary CTA navigates to. Same as getProfileUrl for X/Nostr;
 * for Lightning it's the lightning: URI which opens the user's wallet.
 * A malformed Lightning handle degrades to "#" (dead anchor) rather
 * than emitting an unvalidated `lightning:` string.
 */
export function getActionUrl(v: Vendor): string {
  if (getPlatform(v) === "lightning") return lightningHref(v.handle) ?? "#";
  return getProfileUrl(v) ?? "#";
}

/**
 * Human-readable handle for display on the card.
 *   X        → `@username`
 *   Nostr    → NIP-05 (`name@domain`) shown as-is. Bech32 identifiers
 *              (`npub1…`, `nprofile1…`) are unreadable to humans, so we
 *              fall back to `vendor.name` for those. The bech32 string
 *              is still the source of truth for routing — only the
 *              displayed label changes.
 *   Lightning → bare Lightning Address (already includes `@`).
 */
export function getDisplayHandle(
  v: Pick<Vendor, "platform" | "handle" | "name">,
): string {
  const platform = getPlatform(v);
  if (platform === "x") return `@${v.handle}`;
  if (platform === "nostr") {
    const isBech32 =
      v.handle.startsWith("npub1") || v.handle.startsWith("nprofile1");
    return isBech32 ? v.name : v.handle;
  }
  return v.handle;
}

/**
 * URL-safe slug for a vendor's dedicated page at /v/[slug].
 *
 * Derived from `vendor.name` (NOT handle) because:
 *   - X handles like "soapminer1" are URL-safe but ugly · "soap-miner"
 *     reads better and ranks better for "Soap Miner bitcoin" queries
 *   - Nostr bech32 handles (npub1..., nprofile1...) are 60+ char
 *     opaque strings · entirely useless as URLs
 *   - Lightning handles ("name@domain") have @ which needs encoding
 *
 * Algorithm: lowercase the name, replace any run of non-alphanumeric
 * with a single hyphen, trim leading/trailing hyphens. Pure function ·
 * deterministic given the same name.
 *
 * Uniqueness: enforced at validate-time by scripts/check-vendors.ts.
 * If two vendors slugify to the same value, the validator fails the
 * commit and the human picks a tweak (usually appending a number to
 * the second vendor's name).
 */
export function vendorSlug(v: { name: string }): string {
  // split/filter/join instead of a ^-+|-+$ trim regex: linear on any
  // input (CodeQL js/polynomial-redos), and it collapses runs the same way.
  return v.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .split("-")
    .filter(Boolean)
    .join("-");
}

/**
 * Drop every trailing "/" from a string. A plain loop, not a regex:
 * `/\/+$/` backtracks quadratically on long runs of slashes (CodeQL
 * js/polynomial-redos), and this runs on user-submitted URLs.
 */
export function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return end === s.length ? s : s.slice(0, end);
}

/**
 * Storefront URL the UI actually renders. `website` is the field new
 * rows and /submit write; `shopUrl` is the legacy twin. The type
 * comment has claimed "either field works" since 2026-05, but every
 * renderer read `.website` only — so a shopUrl-only listing (the
 * house hashrate row) silently had no "Visit shop" link on /v or in
 * the modal. One helper, both fields.
 */
export function vendorWebsite(
  v: Pick<Vendor, "website" | "shopUrl">,
): string | undefined {
  return v.website || v.shopUrl;
}

/**
 * Canonical form of a storefront URL for identity comparisons (a shop
 * is listed once, under one handle): lowercased host without a leading
 * `www.`, plus the path without trailing slashes. Scheme, port, query
 * and hash are dropped, and the path is lowercased too, so
 * `https://WWW.Shop.com/Store/` and `http://shop.com/store?ref=x`
 * compare equal. Folding path case errs toward "same shop": a false
 * duplicate costs a reviewer a look, a missed one double-lists a
 * storefront (and storefront slugs like etsy.com/shop/X are
 * case-insensitive anyway). Unparseable input falls
 * back to a trimmed, lowercased string so it still compares to itself.
 */
export function normalizeWebsite(url: string): string {
  const raw = url.trim();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    const path = trimTrailingSlashes(u.pathname).toLowerCase();
    return host + path;
  } catch {
    return trimTrailingSlashes(raw.toLowerCase());
  }
}

/**
 * Shop-facing copy for the vendor backlink badge. The SVG lives on
 * someone else's site, in front of a shopper, so the words are a
 * commerce claim plus a verification stamp — not payroll language
 * ("pays in bitcoin") and not operator jargon ("re-verification due")
 * when the listing ages out.
 *
 * Live  = Accepts Bitcoin | Verified
 * Stale = Accepts Bitcoin | check listing  (amber; never a stale-green
 *         "Verified"). The issuer is the click (the /v listing) and
 *         the alt ("verified by Galaxy Mind").
 */
export const VENDOR_BADGE = {
  label: "Accepts Bitcoin",
  live: "Verified",
  stale: "check listing",
  unknownLabel: "Galaxy Mind",
  unknownValue: "not listed",
  alt: "Accepts Bitcoin, verified by Galaxy Mind",
} as const;

export function vendorBadgeAlt(vendorName?: string): string {
  return vendorName
    ? `${vendorName} accepts Bitcoin, verified by Galaxy Mind`
    : VENDOR_BADGE.alt;
}

/**
 * Copy-paste embed snippet for a vendor's backlink badge (2026-07-29).
 *
 * The badge route calls itself "the backlink engine", but the snippet
 * only existed inline on /v/[slug] — two thirds down a page most
 * merchants never scroll. It now has one definition that the vendor
 * page, the you're-live email, and both operator CLIs all render, so
 * the three surfaces can never drift.
 *
 * The anchor matters as much as the image: the <img> is the badge, the
 * wrapping <a> is the link back to us. Never ship the <img> alone.
 */
export function vendorBadgeSnippet(slug: string): string {
  return `<a href="https://galaxymind.space/v/${slug}">
  <img src="https://galaxymind.space/api/badge/vendor/${slug}"
       alt="${VENDOR_BADGE.alt}" height="24" />
</a>`;
}

/** URL slug for a country landing page (/spend-bitcoin-in/germany).
 *  Derived from the COUNTRIES label with the same normalization as
 *  vendorSlug so the two slug vocabularies can never diverge. */
export function countrySlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Look up a vendor by slug. Returns null if no match. O(n) but n is
 * ~50 · the linear scan is faster than building a map for cold-start
 * dynamic routes.
 */
export function findVendorBySlug(slug: string): Vendor | null {
  return VENDORS.find((v) => vendorSlug(v) === slug) ?? null;
}

// ---- Listing key vs identity ----------------------------------------
//
// A LISTING is one shop: its key is the /v/[slug] slug, which the
// validator already holds unique. An IDENTITY is the X / Nostr /
// Lightning `handle` (+ platform) that runs it. Shop-scoped state
// (modal, favourites, recently viewed, shelf screenshots, site probes,
// re-verify queue, outcome-email KV) keys by vendorKey(); account-
// scoped state (avatar, posting activity, dormancy, badge outreach)
// stays on the handle.
//
// Browser storage written before 2026-10 holds HANDLES. resolveVendorRef
// accepts either form: slug first, then a legacy handle. check-vendors
// keeps that unambiguous by failing if any handle equals a DIFFERENT
// vendor's slug.

/** Stable shop-scoped key for a listing (its /v slug). */
export function vendorKey(v: { name: string }): string {
  return vendorSlug(v);
}

let BY_KEY: Map<string, Vendor> | null = null;
function byKey(): Map<string, Vendor> {
  if (!BY_KEY) BY_KEY = new Map(VENDORS.map((v) => [vendorKey(v), v]));
  return BY_KEY;
}

/** Exact listing-key lookup (no legacy fallback). */
export function findVendorByKey(key: string): Vendor | null {
  return byKey().get(key) ?? null;
}

function platformOf(p: VendorPlatform | undefined): VendorPlatform {
  return p ?? "x";
}

/**
 * Every listing owned by one identity, case-insensitive on the handle,
 * oldest listing first. `platform` defaults to X like the Vendor type;
 * pass null to match the handle on any platform.
 */
export function vendorsByHandle(
  handle: string,
  platform: VendorPlatform | null = "x",
  vendors: readonly Vendor[] = VENDORS,
): Vendor[] {
  const h = handle.trim().replace(/^@/, "").toLowerCase();
  if (!h) return [];
  return vendors
    .filter(
      (v) =>
        v.handle.toLowerCase() === h &&
        (platform === null || platformOf(v.platform) === platform),
    )
    .sort((a, b) => a.listedAt - b.listedAt || a.addedAt - b.addedAt);
}

/**
 * The OTHER listings run by the same identity (same handle, case-
 * insensitive, same platform), oldest first. Empty for every vendor
 * that is the only shop under its handle, which is all of them today.
 */
export function vendorSiblings(
  v: Pick<Vendor, "handle" | "platform" | "name">,
  vendors: readonly Vendor[] = VENDORS,
): Vendor[] {
  const self = vendorKey(v);
  return vendorsByHandle(v.handle, platformOf(v.platform), vendors).filter(
    (s) => vendorKey(s) !== self,
  );
}

/**
 * Resolve a stored reference to a listing: a listing key (slug) first,
 * else a legacy handle from pre-2026-10 storage, which maps to that
 * identity's OLDEST listing (the only one that existed when it was
 * stored). Null when nothing matches.
 */
export function resolveVendorRef(ref: string): Vendor | null {
  if (typeof ref !== "string" || ref.length === 0) return null;
  return findVendorByKey(ref) ?? vendorsByHandle(ref, null)[0] ?? null;
}

/**
 * Normalize a stored list of vendor refs (favourites, journey) to
 * listing keys: legacy handles become their listing's key, unknown
 * strings are KEPT verbatim (a vendor briefly missing from VENDORS must
 * not erase a visitor's heart), non-strings are dropped, and the result
 * is de-duplicated preserving first occurrence.
 */
export function normalizeVendorRefs(refs: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of refs) {
    if (typeof r !== "string" || r.length === 0) continue;
    const v = resolveVendorRef(r);
    const key = v ? vendorKey(v) : r;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Filter VENDORS by a set of dormant handles. Used at every consumer
 * boundary that should hide dormant vendors (homepage grid, featured
 * rotation, RecentlyAddedStrip, /api/vendors.json default). Pass the
 * dormant set from `getDormantHandles()` in lib/vendor-dormancy.ts.
 *
 * Defined here (not in vendor-dormancy.ts) so the synchronous
 * VENDORS array stays the single source of truth and consumers don't
 * have to import from two files to get the filtered shape.
 */
export function filterActive(
  vendors: Vendor[],
  dormantHandles: Set<string>,
): Vendor[] {
  if (dormantHandles.size === 0) return vendors;
  return vendors.filter((v) => !dormantHandles.has(v.handle));
}

/**
 * Primary-CTA button text per platform.
 */
export function getActionLabel(v: Vendor): string {
  switch (getPlatform(v)) {
    case "x":
      return "View on 𝕏 →";
    case "nostr":
      return "View on Nostr →";
    case "lightning":
      return "⚡ Pay via Lightning";
  }
}

/**
 * Short platform tag rendered as a small badge on the card so visitors
 * see at a glance whether it's an X / Nostr / Lightning identity.
 */
export function getPlatformBadge(v: Vendor): { label: string; symbol: string } {
  switch (getPlatform(v)) {
    case "x":
      return { label: "X", symbol: "𝕏" };
    case "nostr":
      return { label: "Nostr", symbol: "ᯅ" };
    case "lightning":
      return { label: "Lightning", symbol: "⚡" };
  }
}

// Minimal country metadata for the vendors we know — flag emoji + label.
// Add entries as new vendors with known regions are added.
export const COUNTRIES: Record<string, { flag: string; label: string }> = {
  US: { flag: "🇺🇸", label: "United States" },
  GB: { flag: "🇬🇧", label: "United Kingdom" },
  DE: { flag: "🇩🇪", label: "Germany" },
  ZA: { flag: "🇿🇦", label: "South Africa" },
  IT: { flag: "🇮🇹", label: "Italy" },
  FR: { flag: "🇫🇷", label: "France" },
  CH: { flag: "🇨🇭", label: "Switzerland" },
  CO: { flag: "🇨🇴", label: "Colombia" },
  TH: { flag: "🇹🇭", label: "Thailand" },
  SI: { flag: "🇸🇮", label: "Slovenia" },
  NZ: { flag: "🇳🇿", label: "New Zealand" },
  SV: { flag: "🇸🇻", label: "El Salvador" },
  NL: { flag: "🇳🇱", label: "Netherlands" },
  HU: { flag: "🇭🇺", label: "Hungary" },
  ES: { flag: "🇪🇸", label: "Spain" },
  AU: { flag: "🇦🇺", label: "Australia" },
  CA: { flag: "🇨🇦", label: "Canada" },
  AT: { flag: "🇦🇹", label: "Austria" },
  FI: { flag: "🇫🇮", label: "Finland" },
  BR: { flag: "🇧🇷", label: "Brazil" },
  IE: { flag: "🇮🇪", label: "Ireland" },
};

// Approximate geographic centroids for the homepage <VendorMap> dots.
// Lives HERE, next to COUNTRIES, on purpose: the two tables share one
// invariant — EVERY country in COUNTRIES must have a COUNTRY_COORDS
// row, or that country's vendors render with NO dot on the map (the
// component does `if (!coord) return null`). This used to be a local
// table inside VendorMap.tsx and silently drifted: AU/NZ/NL/HU/SV/ES
// all had vendors but no dot (audit 2026-05). scripts/check-vendors.ts
// now enforces COUNTRIES <-> COUNTRY_COORDS parity in BOTH directions,
// so adding a country without coords (or vice-versa) fails the
// validator before it can ship. Centroids are geographic (not
// population-weighted, matching the US "continental center" choice);
// the equirectangular projection tolerates ~5° error before a dot
// visibly drifts off its landmass, so eyeball new rows on a real map.
export const COUNTRY_COORDS: Record<string, { lat: number; lon: number }> = {
  US: { lat: 39.5, lon: -98.5 }, // continental US center
  GB: { lat: 54.0, lon: -2.5 },
  DE: { lat: 51.0, lon: 10.5 },
  FR: { lat: 46.5, lon: 2.5 },
  IT: { lat: 42.5, lon: 12.5 },
  CH: { lat: 46.8, lon: 8.2 },
  ZA: { lat: -29.0, lon: 24.0 },
  CO: { lat: 4.6, lon: -74.1 }, // Bogotá area
  TH: { lat: 15.0, lon: 100.0 }, // central Thailand
  SI: { lat: 46.1, lon: 14.8 }, // Ljubljana area
  NZ: { lat: -41.0, lon: 174.0 }, // North/South Island
  NL: { lat: 52.2, lon: 5.3 },
  HU: { lat: 47.2, lon: 19.5 },
  SV: { lat: 13.8, lon: -88.9 }, // El Salvador
  ES: { lat: 40.3, lon: -3.7 }, // Madrid-central
  AU: { lat: -25.0, lon: 134.5 }, // continental Australia centroid
  CA: { lat: 56.1, lon: -106.3 }, // central Canada (Saskatchewan) · readable, off the Arctic
  AT: { lat: 47.6, lon: 14.2 }, // central Austria
  FI: { lat: 63.5, lon: 26.0 }, // central Finland · south of Lapland so the dot reads on the landmass
  BR: { lat: -14.2, lon: -51.9 }, // geographic centroid of Brazil
  IE: { lat: 53.4, lon: -8.0 }, // inland Ireland, west of Dublin so the dot sits on the island
};

export const CATEGORY_LABELS: Record<VendorCategory, string> = {
  apparel: "Apparel",
  "general-goods": "General goods",
  hardware: "Hardware & Mining",
  consumables: "Consumables",
  collectibles: "Collectibles & 3D",
  services: "Services",
  books: "Books & Education",
};

// Vendors not re-verified within this window get a "needs re-verification"
// indicator.
//
// 30 -> 180 on 2026-08-15, when continuous monitoring shipped. This stopped
// being the freshness story and became a HUMAN-TOUCH BACKSTOP: the nightly
// monitor-vendors cron watches every listing daily and queues anything that
// changes, so freshness no longer depends on a periodic sweep. This number
// now answers a different question — how long may a listing go without a
// person looking at it, even when nothing has changed. Do not tighten it
// back toward 30 thinking it improves freshness; that would only recreate
// the wall where the whole roster flips stale on one day.
export const STALE_THRESHOLD_DAYS = 180;
export const STALE_THRESHOLD_SECONDS = STALE_THRESHOLD_DAYS * 86_400;

// Format a UNIX-second timestamp as "May 6" — short, friendly, year-less
// when the year matches now (the common case). Used on cards and headers.
/**
 * Earliest `verifiedAt` on the roster. Empty input returns 0.
 *
 * A max() here is the wrong aggregate. The homepage used to print the
 * newest shop's date as "last checked", and the cards underneath it
 * showed an older day for nearly the whole roster. The date next to
 * "confirmed by a person" has to be the one the claim survives.
 */
export function oldestVerifiedAt(
  vendors: readonly { verifiedAt: number }[],
): number {
  let oldest = Number.POSITIVE_INFINITY;
  for (const v of vendors) {
    if (v.verifiedAt < oldest) oldest = v.verifiedAt;
  }
  return Number.isFinite(oldest) ? oldest : 0;
}

export function formatVerifiedDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getUTCFullYear() !== now.getUTCFullYear()) {
    opts.year = "numeric";
  }
  return d.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

// Relative age of a verification, e.g. "today", "3 days ago", "2 weeks ago".
// Relative rather than absolute BECAUSE the promise is a cadence: a static
// date reads as decoration, while an age visibly decays toward the stale
// flag. The absolute date is kept on /v/[slug], which is the citable
// surface. Past STALE_THRESHOLD_DAYS the card shows the stale label
// instead of an age, so no months/years form is needed.
export function formatVerifiedAge(
  unixSec: number,
  nowSec = Date.now() / 1000,
): string {
  const days = Math.max(0, Math.floor((nowSec - unixSec) / 86_400));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} weeks ago`;
}

export function isStale(unixSec: number, nowSec = Date.now() / 1000): boolean {
  return nowSec - unixSec > STALE_THRESHOLD_SECONDS;
}

// Weekly rolling re-verify batch. Oldest verifiedAt first, skip anyone
// touched in the last REVERIFY_MIN_AGE_DAYS so last week's bump does not
// reappear. 25/week is the de-clustering cadence: a one-day bulk bump
// just moves the wall. Nothing here writes verifiedAt.
export const REVERIFY_BATCH_SIZE = 25;
export const REVERIFY_MIN_AGE_DAYS = 30;

export function oldestVerifiedBatch(
  vendors: readonly Vendor[],
  nowSec: number,
  opts: { limit?: number; minAgeDays?: number } = {},
): Vendor[] {
  const minAgeDays = opts.minAgeDays ?? REVERIFY_MIN_AGE_DAYS;
  const pool = vendors
    .filter((v) => nowSec - v.verifiedAt >= minAgeDays * 86_400)
    .sort((a, b) => a.verifiedAt - b.verifiedAt);
  return opts.limit != null ? pool.slice(0, opts.limit) : pool;
}

export type VerifiedAtClusterStats = {
  total: number;
  largest: {
    date: string;
    verifiedAt: number;
    count: number;
    fraction: number;
    daysUntilStale: number;
  } | null;
  nextBatch: {
    handle: string;
    name: string;
    date: string;
    ageDays: number;
  }[];
};

/** Read-only cluster view. Never writes verifiedAt. */
export function verifiedAtClusterStats(
  vendors: readonly Vendor[],
  nowSec = Date.now() / 1000,
  opts: { batchSize?: number; minAgeDays?: number } = {},
): VerifiedAtClusterStats {
  const total = vendors.length;
  const byDay = new Map<number, number>();
  for (const v of vendors) {
    byDay.set(v.verifiedAt, (byDay.get(v.verifiedAt) ?? 0) + 1);
  }
  let largestAt = 0;
  let largestCount = 0;
  for (const [verifiedAt, count] of byDay) {
    if (
      count > largestCount ||
      (count === largestCount && verifiedAt < largestAt)
    ) {
      largestAt = verifiedAt;
      largestCount = count;
    }
  }
  const largest =
    total === 0
      ? null
      : {
          date: new Date(largestAt * 1000).toISOString().slice(0, 10),
          verifiedAt: largestAt,
          count: largestCount,
          fraction: largestCount / total,
          daysUntilStale: Math.round(
            (largestAt + STALE_THRESHOLD_SECONDS - nowSec) / 86_400,
          ),
        };
  const nextBatch = oldestVerifiedBatch(vendors, nowSec, {
    limit: opts.batchSize ?? REVERIFY_BATCH_SIZE,
    minAgeDays: opts.minAgeDays ?? REVERIFY_MIN_AGE_DAYS,
  }).map((v) => ({
    handle: v.handle,
    name: v.name,
    date: new Date(v.verifiedAt * 1000).toISOString().slice(0, 10),
    ageDays: Math.floor((nowSec - v.verifiedAt) / 86_400),
  }));
  return { total, largest, nextBatch };
}

// "NEW" indicator window: vendors LISTED in the last 14 days get a badge
// on their card. 14 is short enough that the badge retains meaning, long
// enough that it doesn't disappear before most people have seen the page
// once. Keyed on listedAt, never verifiedAt — a re-verification sweep is
// not an announcement (2026-08-13 marked all 129 cards NEW when it was).
export const NEW_THRESHOLD_DAYS = 14;
const NEW_THRESHOLD_SECONDS = NEW_THRESHOLD_DAYS * 86_400;
export function isNew(
  vendor: { listedAt: number },
  nowSec = Date.now() / 1000,
): boolean {
  return nowSec - vendor.listedAt < NEW_THRESHOLD_SECONDS;
}

// Tighter "THIS WEEK" window for the RecentlyAddedStrip lane · 7 days
// matches the weekly-digest cadence and the "+X added this week"
// velocity line below the grid, so the strip's eyebrow agrees with
// the footer count on the same page. Returns are 0 on quiet weeks
// (the strip falls back to its "Just added" all-time framing).
export const NEW_THIS_WEEK_DAYS = 7;
const NEW_THIS_WEEK_SECONDS = NEW_THIS_WEEK_DAYS * 86_400;
export function isNewThisWeek(
  vendor: { listedAt: number },
  nowSec = Date.now() / 1000,
): boolean {
  return nowSec - vendor.listedAt < NEW_THIS_WEEK_SECONDS;
}

export const VENDORS: Vendor[] = [
  {
    handle: "soapminer1",
    name: "Soap Miner",
    description: "Handmade grass-fed beef tallow soap.",
    paymentNote: "Lightning + on-chain",
    category: "consumables",
    addedAt: 1,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://soapminer.com",
  },
  {
    handle: "CryptoCloaks",
    name: "CryptoCloaks",
    description:
      "3D-printed Bitcoin accessories made in Colorado · home-miner builds (Bitaxe, Avalon Nano), hardware-wallet cases (Coldcard, Trezor), seed-backup jigs, node cases, art, and stickers.",
    paymentNote: "Lightning + on-chain",
    category: "collectibles",
    addedAt: 2,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    shipsInternational: true,
    website: "https://cryptocloaks.com",
  },
  {
    handle: "solosatoshi",
    name: "Solo Satoshi",
    description:
      "Bitcoin mining hardware from Houston, TX · Bitaxe solo miners (Gamma, Touch, GT), Canaan Avalon, Start9 nodes, Blockstream Jade wallets, heatsinks, and apparel. Same-day shipping.",
    paymentNote: "Lightning + on-chain",
    category: "hardware",
    addedAt: 3,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    shipsInternational: true,
    website: "https://solosatoshi.com",
  },
  {
    handle: "21Million__",
    name: "21 Million",
    description:
      "Premium Bitcoin-themed streetwear · jackets, hoodies, technical apparel, swimwear, plus signature Orange Jackets™ and the Orange Pill necklace.",
    paymentNote: "Lightning + on-chain",
    category: "apparel",
    addedAt: 4,
    listedAt: 1778025600,
    verifiedAt: 1786579200,
    country: "US",
    shipsInternational: true,
    website: "https://21million-fashion.com",
  },
  {
    handle: "mx12art",
    name: "MX12 Art",
    description:
      "Cryptoartist since 2017 · original Bitcoin art prints, tees, hoodies, mugs, and stickers, plus Bitcoin NFTs.",
    paymentNote: "Lightning + on-chain",
    category: "apparel",
    addedAt: 5,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://mx12.art",
  },
  {
    handle: "0xCryptoGoodies",
    name: "0x Crypto Goodies",
    description: "Crypto and Bitcoin merch · tees, hoodies, stickers, accessories.",
    paymentNote: "Lightning + on-chain",
    category: "apparel",
    addedAt: 6,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://cryptogoodies.shop",
  },
  {
    handle: "afilini",
    name: "afilini",
    description: "Open-source 3D-printed Bitcoin gadgets and collectibles.",
    paymentNote: "Lightning + on-chain",
    category: "collectibles",
    addedAt: 8,
    listedAt: 1778025600,
    verifiedAt: 1786579200,
    country: "IT",
  },
  {
    handle: "BitcoinFrndlySA",
    name: "Bitcoin Friendly SA",
    description:
      "South African Bitcoin marketplace + online store · local goods like rooibos tea, coffee, food, and crafts, with 10% satsback on every order.",
    paymentNote: "Bitcoin only",
    category: "consumables",
    addedAt: 9,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "ZA",
    website: "https://bitcoinfriendlysa.co.za",
  },
  {
    handle: "btcdiaries21",
    name: "The Bitcoin Diaries Fashion",
    description:
      "Bitcoin fashion by graphic designer Jen Barton · premium tees, hoodies, hats, shoes, and bags. On-chain + Lightning, free worldwide shipping.",
    paymentNote: "Lightning + on-chain",
    category: "apparel",
    addedAt: 10,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    founderName: "Jen Barton",
    shipsInternational: true,
    website: "https://thebitcoindiaries.com",
  },
  {
    handle: "21hodlshop",
    name: "21 Hodl Shop",
    description:
      "HODL-themed Bitcoin apparel · tees, hoodies, hats, crop tops, baby & kids, mugs, stickers, and accessories. Ships worldwide.",
    paymentNote: "Lightning + on-chain",
    category: "apparel",
    addedAt: 11,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    shipsInternational: true,
    website: "https://thehodlshop.com",
  },
  {
    handle: "satoshoes",
    name: "Satoshoes",
    description:
      "Bitcoin-themed sneakers (high-top & low-top), plus hoodies, tees, beanies, and mugs. Ships worldwide.",
    paymentNote: "Bitcoin",
    category: "apparel",
    addedAt: 13,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "GB",
    shipsInternational: true,
    website: "https://satoshoes.co.uk",
    // Conduit storefront verified 2026-10-18 (X @satoshoes profile URL links this storefront).
    alsoSoldOn: [
      { marketplace: "conduit", url: "https://shop.conduit.market/npub196gnqcsauj9pk4z29s4jkj3wtw0s3tlyw0mh8g2ef6ksw80jhlaqzpfq54" },
    ],
  },
  {
    handle: "lindeymagee",
    name: "Lindey Magee",
    description:
      "“Bitcoin: A Treasure to HODL” · a rhyming children's picture book, sold solo or in classroom packs (3, 12, or 25).",
    paymentNote: "Lightning + on-chain",
    category: "books",
    shopUrl: "https://lindeymagee.com",
    addedAt: 14,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://lindeymagee.com",
  },
  {
    handle: "SnorkelHotTubs",
    name: "Snorkel Hot Tubs",
    description:
      "Powered and wood-fired hot tubs, plus accessories and parts · Seattle, WA.",
    paymentNote: "Bitcoin",
    category: "services",
    addedAt: 15,
    listedAt: 1778025600,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://snorkel.com",
  },
  {
    handle: "XXIWines",
    name: "XXI Wines",
    description: "Premium wines accepting Bitcoin.",
    paymentNote: "Bitcoin",
    category: "consumables",
    addedAt: 16,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "DE",
    website: "https://21wines.de/",
  },
  {
    handle: "delgadosfuego",
    name: "Delgado's Fuego L.L.C.",
    description:
      "Authentic Peruvian Rocoto-based hot sauces (incl. Misti-uchu) and branded tees.",
    paymentNote: "Bitcoin",
    category: "consumables",
    addedAt: 17,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://delgadosfuego.com",
    // Pubkey is triple-anchored: the nprofile linked from their own site
    // footer and the NIP-05 delgadosfuego@nostrplebs.com both resolve to
    // this same key, byte-identical.
    //
    // lightningAddress is deliberately ABSENT. Two different addresses are
    // in circulation and they disagree: the signature-verified kind:0
    // carries lud16 delgadosfuego@cake.cash, while the X bio and the site's
    // own /pages/btc publish delgadosfuego@getalby.com ("Send us sats!").
    // Both resolve. The signed lud16 is the only unforgeable source
    // (lib/ln-guard), but a lud16 is a zap wallet and not necessarily the
    // business till, and the shop's real checkout is Shopify with Bitcoin
    // as a payment method. Picking either one here could point a visitor's
    // irreversible payment at a wallet the vendor has moved off. Adopt only
    // after the vendor confirms which is current, out of band.
    nostrPubkey:
      "npub1jz5pyzg6zrqqtqafslg95r8hhp2wcnr7zupgm20a9spd7pagxklqzfvd4d",
    // Conduit storefront verified 2026-10-18 (same npub as our nostrPubkey).
    alsoSoldOn: [
      { marketplace: "conduit", url: "https://shop.conduit.market/npub1jz5pyzg6zrqqtqafslg95r8hhp2wcnr7zupgm20a9spd7pagxklqzfvd4d" },
    ],
  },
  {
    handle: "without_rulers",
    name: "Without Rulers",
    description:
      "Bitcoin-themed apparel and art prints: tees, hoodies, hats across themed collections. Bitcoin via BTCPay.",
    paymentNote: "Lightning + on-chain (BTCPay)",
    category: "apparel",
    shopUrl: "https://without-rulers.com",
    addedAt: 18,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://without-rulers.com",
  },
  {
    handle: "scorevivo",
    name: "ScoreVivo",
    description: "Downloadable flute sheet music.",
    paymentNote: "Lightning",
    category: "books",
    shopUrl: "https://scorevivo.com",
    addedAt: 19,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://scorevivo.com",
  },
  {
    handle: "ServingBitcoin",
    name: "Serving Bitcoin",
    description: "Refurbished Bitcoin nodes running StartOS · DIY-ready.",
    paymentNote: "Lightning + on-chain",
    category: "hardware",
    shopUrl: "https://servingbitcoin.com",
    addedAt: 20,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://servingbitcoin.com",
  },
  {
    handle: "TheOrangeHabit",
    name: "The Orange Habit",
    description:
      "Bitcoin clothing, hats, and accessories for men, women, children & pets · plus Bitcoin home and office decor.",
    paymentNote: "Lightning + on-chain",
    category: "apparel",
    shopUrl: "https://svrnsociety.com",
    addedAt: 21,
    listedAt: 1778025600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://svrnsociety.com",
  },
  {
    handle: "factory_house",
    name: "Factory House",
    description:
      "Bitcoin apparel, accessories, home decor, and books · 21% off when paying with Bitcoin (on-chain or Lightning).",
    paymentNote: "Lightning + on-chain",
    category: "apparel",
    addedAt: 22,
    listedAt: 1778112000,
    verifiedAt: 1792281600,
    country: "FR",
    website: "https://factoryhouse.io",
  },
  {
    handle: "GreatGheeCo",
    name: "Great Ghee Co.",
    description: "Premium ghee (clarified butter / cooking fat) · Bitcoin preferred.",
    paymentNote: "Bitcoin",
    category: "consumables",
    addedAt: 23,
    listedAt: 1778112000,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://greatghee.com",
  },
  {
    handle: "beehoney21_orig",
    name: "Beehoney 21",
    description:
      "Premium German honey · Nakamoto & Satoshi varietals, single jars or duos. Lightning accepted.",
    paymentNote: "Lightning + on-chain",
    category: "consumables",
    addedAt: 24,
    listedAt: 1778112000,
    verifiedAt: 1786579200,
    country: "DE",
    founderName: "Patrick Delfs",
    website: "https://beehoney21.de",
  },
  {
    handle: "altair_tech",
    name: "Altair Tech",
    description: "Bitcoin mining equipment · ASICs and accessories.",
    paymentNote: "Lightning + on-chain",
    category: "hardware",
    addedAt: 25,
    listedAt: 1778198400,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://altairtech.io",
  },
  // First Nostr vendor — primary identity is their Primal/Nostr profile
  // (richer 'social' destination than a Lightning Address, which is just
  // a payment endpoint). Their Lightning Address (nowaste@getalby.com)
  // is on their Nostr profile bio for visitors who want to pay directly.
  {
    handle: "nprofile1qqsvmqxje4aa4grz6sxqlwpsukzhaf44aav3f65kcj8s2ts6rx992ysqw37j2",
    platform: "nostr",
    name: "NoWasteBTCSigns",
    description:
      "Handmade bitcoin signs and decor with an environmental focus · sustainable materials, low-waste production.",
    category: "collectibles",
    addedAt: 26,
    listedAt: 1778198400,
    verifiedAt: 1792281600,
    country: "US",
    // Re-confirmed 2026-10-18: the shop's own X (@NoWasteBTCsigns, active
    // Oct 2026) links this Geyser store, where 37 signs are sold for sats
    // over Lightning. Its Etsy shop is card-only, so it is not the website.
    website: "https://geyser.fund/project/nowastebtcsigns",
    pictureUrl: "https://image.nostr.build/71055a51db84d6964e4bd90e1310731023659b8829a0c9672f2e1016f790fdd9.jpg",
  },
  {
    handle: "getsoundHSA",
    name: "GetSound HSA",
    description:
      "First self-directed, commercially available bitcoin Health Savings Account. For US residents with a high-deductible health insurance plan (HDHP).",
    category: "services",
    addedAt: 27,
    listedAt: 1778198400,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://soundhsa.com",
  },
  {
    handle: "nprofile1qqst4xzdkg809agzwcy2qus0grfluve0kcwypd0dvre3dw3qgzqnr6gasghcj",
    platform: "nostr",
    name: "FBO Developments",
    description:
      "Swiss software development · self-sovereign tech and data, building for an economy free of digital middlemen.",
    category: "services",
    addedAt: 28,
    listedAt: 1778284800,
    verifiedAt: 1792281600,
    country: "CH",
    website: "https://fbo.network",
    pictureUrl: "https://bafybeiev3bzkpr7bcm2memybq4xjv6lgniswixwkyum3jlbjqxwplrp43q.ipfs.dweb.link/FB_favicon.png",
  },
  {
    handle: "nprofile1qqszaw7pc27v5gnygnuz5e86jr6kxfurpfqcd84a2sjuegp5lzgd7fslhftjg",
    platform: "nostr",
    name: "Melody",
    description:
      "Hand-made comfrey salve · three clean ingredients (comfrey, olive oil or grass-fed tallow, beeswax). Small US producer.",
    category: "consumables",
    addedAt: 29,
    listedAt: 1778284800,
    verifiedAt: 1792281600,
    country: "US",
    pictureUrl: "https://blossom.primal.net/54d55a0d4dc12cd8e08c1c098d86974cbc3415c771823c5d60979e4fa264bd30.jpg",
  },
  {
    handle: "nprofile1qqswp94gnm4epqsgjkndl4lnd8krzdj5u4mzuppdtxksdymkty63g7gdurlfc",
    platform: "nostr",
    name: "Oshi",
    description:
      "Artisan butters, date bars, and chocolates.",
    category: "consumables",
    addedAt: 30,
    listedAt: 1778284800,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://oshigood.us",
    pictureUrl: "https://image.nostr.build/595cb381ed71dc676e14244e9bac2ede661c7bcb2569d690992b22c987c7d24e.jpg",
    // Conduit storefront verified 2026-10-18 (same key as our nprofile handle).
    alsoSoldOn: [
      { marketplace: "conduit", url: "https://shop.conduit.market/npub1uzt238htjzpq39dxmltlx60vxym9fetk9czz6kddq6fhvkf4z3usy9qtrh" },
    ],
  },
  {
    handle: "proofofink",
    name: "Proof of Ink",
    description:
      "Merch and apparel · also offers wholesale and distribution services for other Bitcoin brands.",
    category: "apparel",
    addedAt: 31,
    listedAt: 1778284800,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://proofofink.com",
  },
  {
    // NIP-05 form (matches Primal's vanity URL `primal.net/bullish`).
    // Stays human-readable in the card header — no bech32 fallback to
    // brand name needed.
    handle: "bullish@primal.net",
    // Pinned 2026-08-19 from the domain's own NIP-05 resolution, so a
    // later change in the pubkey it vouches for reads as `gone`.
    nostrPubkey:
      "npub15ypxpg429uyjmp0zczuza902chuvvr4pn35wfzv8rx6cej4z8clq6jmpcx",
    platform: "nostr",
    name: "The Bullish ₿itcoiner",
    description:
      "Bitcoin and Nostr apparel and merch.",
    category: "apparel",
    addedAt: 32,
    listedAt: 1778284800,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://thebullish.shop",
    pictureUrl: "https://thebullishbitcoiner.wordpress.com/wp-content/uploads/2025/04/imb_waphoe.gif",
  },
  {
    handle: "nprofile1qqs82dgjyfj8ef3yectyk9azy4n25a6dy0mgqn24hlf0vvy8zr7ae4q430axp",
    platform: "nostr",
    name: "Small Batch Steve",
    description:
      "Small-batch home-style BBQ seasoning blend, made in North Texas.",
    category: "consumables",
    addedAt: 33,
    listedAt: 1778284800,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://smallbatchsteve.com",
    pictureUrl: "https://cdn.nostrcheck.me/9f2762633b58969358b82269021f44c81151e4056ad77bcc2f54edf144870563.webp",
  },
  {
    handle: "nprofile1qqszys6cr4042ayr53yacphv8zec7shn9qevm5zue6t5eruzwutk9tg5cruw3",
    platform: "nostr",
    name: "Kidwarp",
    description:
      "Vanilla paste from Kidwarp's Vanilla Shop · small US producer. US shipping only.",
    category: "consumables",
    addedAt: 34,
    listedAt: 1778284800,
    verifiedAt: 1792281600,
    country: "US",
    shipsInternational: false,
    website: "https://www.takemysats.com/kidwarps-vanilla-shop",
    pictureUrl: "https://profilepics.nostur.com/profilepic_v1/1579c9eef1eef6d57a765b21ddbba0a4eea4a108681afd840db54a84c0ebb122/profilepic.jpg?1773773271",
  },
  {
    handle: "nprofile1qqspqxs39j9dctnfuqqrz98lrswnddlumcrdsn28j689n824susmphcfxudsz",
    platform: "nostr",
    name: "Permanerd",
    description:
      "Freeze-dried fruits and herbs · the Sats 4 Snacks homestead operation.",
    category: "consumables",
    addedAt: 36,
    listedAt: 1778284800,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://sats4snacks.com",
    pictureUrl: "https://image.nostr.build/01e213f3cd9d2a77f2363c1a2c0e99c17c334841f25769f20722f1516318a4cd.jpg",
  },
  {
    handle: "josebitcoiner",
    name: "The Bitcoin Coffee Guy",
    description:
      "Colombian specialty coffee (340g), plus Bitcoiner bracelets and keychains. On-chain + Lightning.",
    category: "consumables",
    addedAt: 37,
    listedAt: 1778284800,
    verifiedAt: 1792281600,
    country: "CO",
    // Re-confirmed 2026-10-18: the old .com is parked; the shop's own X
    // (@LightningKoffee, linked from @josebitcoiner) points to this store,
    // whose checkout hands off to BTCPay Server for bitcoin payment.
    website: "https://lightningkoffee.io",
  },
  {
    handle: "nprofile1qqs9v5v8trgum5msr6cd82j3r77mhj94sk0adcp2232sdy65srusmdqhrh0j2",
    platform: "nostr",
    name: "Seedkeys",
    description:
      "Tamper-evident stainless-steel seed-phrase backups and the Penlock · physical Bitcoin security tools.",
    category: "hardware",
    addedAt: 38,
    listedAt: 1778284800,
    verifiedAt: 1792281600,
    country: "TH",
    website: "https://seedkeys.xyz",
    pictureUrl: "https://seedkeys.xyz/wp-content/uploads/2025/09/seed-keys-logo-for-press-kit.jpg",
  },
  {
    handle: "nprofile1qqs07xqktt77qzzj6jdyuyckexqu0tcpvnqczrqtcrlyr5mpm4720uqkmrufh",
    platform: "nostr",
    name: "GoldfishThumb1",
    description:
      "Custom hand-engraved dive-style watches (one-off pieces), plus pencil, pen, and paint artwork.",
    category: "collectibles",
    addedAt: 39,
    listedAt: 1778284800,
    verifiedAt: 1792281600,
    country: "US",
    pictureUrl: "https://image.nostr.build/1a6151bdb5ef627a128bed3892de75af0aed2623badae65b711555ea8d2e5b96.jpg",
  },
  {
    handle: "nprofile1qqspdj6t8rlf5aytvcy0dfvkjyue9h79pyr9ynyrz8xnvz7yqg32h9q2cmvu9",
    platform: "nostr",
    name: "Hash Power Music",
    description:
      "Value-for-value music collective · physical media and band merch from independent artists (The Retrograde, The Velvicks, Circle the Earth, and more).",
    category: "collectibles",
    addedAt: 40,
    listedAt: 1778284800,
    verifiedAt: 1786579200,
    country: "US",
    pictureUrl: "https://image.nostr.build/5faa58bb177c6feffd501595985c4470e1b4a0d412b63afeac1cc6a9d0f22595.jpg",
  },
  {
    handle: "nprofile1qqs097ssxndkq0ztnx4wz3u0p6jevjvd0503kul3ljq8skx6n2cyv9qjrjlyf",
    platform: "nostr",
    name: "orangepin21",
    description:
      "German webshop · Bitcoin merch, Bitbox + Seedor hardware, food, 3D-printed accessories.",
    category: "hardware",
    addedAt: 41,
    listedAt: 1778284800,
    verifiedAt: 1786579200,
    country: "DE",
    website: "https://orangepin21.com",
    pictureUrl: "https://m.primal.net/QduH.png",
  },
  {
    handle: "nprofile1qqsv28cf7dxykcw28zcqg3c7l24tce5trztfghss4pu3jyrr694hxlsnc0pgg",
    platform: "nostr",
    name: "TonyCe",
    description:
      "Slovenian webshop · bitcoin wallets and merch, run by the president of Bitcoin Association Slovenia.",
    category: "hardware",
    addedAt: 42,
    listedAt: 1778284800,
    verifiedAt: 1786579200,
    country: "SI",
    website: "https://bitcoin.si",
    pictureUrl: "https://svetkapitala.delo.si/media/images/20220209/1129018.width-660.jpg",
  },
  {
    handle: "nprofile1qqsrn8dv4gdkcghcv2zkatp20jnf8e7256lra2ud36nnsg6t5gg3fds2938sq",
    platform: "nostr",
    name: "RiverMesa",
    description:
      "Handcrafted Southwest jewelry · stamped copper, strung turquoise, and leather work: rings, bracelets, necklaces, earrings.",
    category: "collectibles",
    addedAt: 43,
    listedAt: 1778284800,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://rivermesa.etsy.com",
    pictureUrl: "https://blossom.primal.net/b24fc874eba52790f5be905644aec4481cc1d657e2659b8c87352ff4f538c348.png",
  },
  {
    // NIP-05 form (matches Primal's vanity URL `primal.net/BitcoinBeans`).
    // Stays human-readable in the card header.
    handle: "BitcoinBeans@primal.net",
    // Pinned 2026-08-19 from the domain's own NIP-05 resolution, so a
    // later change in the pubkey it vouches for reads as `gone`.
    nostrPubkey:
      "npub1jx702fwvkdtqkhd9p8n6ctgnycpl6whsx07a0h9s9h2hlgx6q60svk2c49",
    platform: "nostr",
    name: "Bitcoin Beans",
    description:
      "100% Colombian cacao, paid for in bitcoin.",
    category: "consumables",
    addedAt: 44,
    listedAt: 1778284800,
    verifiedAt: 1786579200,
    country: "CO",
    website: "https://www.bitcoinbeans.co/",
    pictureUrl: "https://blossom.primal.net/902673a760fd2f736c6dbacf669a3173972d525646b7f25dc61ad2ccc2c66189.jpg",
  },
  {
    handle: "nprofile1qqswaptqf78vde8zf78272nzf5zza02rrkhyfrlpzau6mnakhdu9whswqxaws",
    platform: "nostr",
    name: "Satoshi Coffee Co.",
    description:
      "Specialty coffee beans, paid for on-chain or Lightning at sats.coffee.",
    category: "consumables",
    addedAt: 45,
    listedAt: 1778371200,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://sats.coffee",
    shopUrl: "https://sats.coffee",
    pictureUrl: "https://coinos.io/api/public/2ed0f46ad6505ea799ce767d7a0dca1bffe5b33e2152eb2b477ce2d02ceeaf29.webp",
  },
  {
    handle: "nprofile1qqs2d8d2znj02kfun836r9he7nawqhnps94vpdfguqrl0l7jrzst7wckmvkts",
    platform: "nostr",
    name: "Poppy",
    description:
      "Bitcoin merch and apparel from New Zealand.",
    category: "apparel",
    addedAt: 46,
    listedAt: 1778371200,
    verifiedAt: 1792281600,
    country: "NZ",
    pictureUrl: "https://m.primal.net/KQkG.jpg",
  },
  {
    handle: "nprofile1qqsg8vu4lh5gtdmwhe6qvk9lx98fzs2df4htd7uj8y5h25477vduwmqpptul0",
    platform: "nostr",
    name: "SweetSats",
    description:
      "Pure, raw honey traded for Bitcoin · US producer.",
    category: "consumables",
    addedAt: 47,
    listedAt: 1778371200,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://sweetsats.io",
    pictureUrl: "https://m.primal.net/HZkq.png",
  },
  {
    handle: "nprofile1qqsdua0tr4axvfuq02xl7ranxl8u7xy706d032mz98mg3anywyxrq9qzy52kh",
    platform: "nostr",
    name: "Yojimble",
    description:
      "Small-batch foraged jam from Northampton, England · stacking sats with jam. Worldwide shipping.",
    category: "consumables",
    addedAt: 48,
    listedAt: 1778371200,
    verifiedAt: 1792281600,
    country: "GB",
    shipsInternational: true,
    website: "https://jimblesjumble.netlify.app",
    pictureUrl: "https://blossom.primal.net/456f947497f7afd50e4b7d03486e3a479bb7cd838fde652d8819265566fce5e2.jpg",
    // Conduit storefront verified 2026-10-18 (same key as our nprofile handle).
    alsoSoldOn: [
      { marketplace: "conduit", url: "https://shop.conduit.market/npub1me67k8t6vcncq75dlu8mxd70euvful56lz4ky20k3rmxgugvxq2qy23gnm" },
    ],
  },
  {
    // NIP-05 form (matches Primal's vanity URL `primal.net/BenJustman`).
    // Stays human-readable in the card header.
    handle: "BenJustman@primal.net",
    // Pinned 2026-08-19 from the domain's own NIP-05 resolution, so a
    // later change in the pubkey it vouches for reads as `gone`.
    nostrPubkey:
      "npub153xmex42x4chdf757hp3q6zxagykkek7pdgwuwd074964dkyha9s82ryu8",
    platform: "nostr",
    name: "Peony Lane Wine",
    description:
      "Low-sulfite wine from the highest-elevation US vineyards · Governor's Cup award winner (2022–2024).",
    category: "consumables",
    addedAt: 49,
    listedAt: 1778371200,
    verifiedAt: 1792281600,
    country: "US",
    founderName: "Ben Justman",
    website: "https://peonylanewine.com",
    pictureUrl: "https://i.imgur.com/opkDhvJ.jpg",
  },
  {
    handle: "nprofile1qqsz789t5fk44xes5zmg2zxdva5kfqvlvevwfc3y09lspjy07s3983qm380c2",
    platform: "nostr",
    name: "Bunkie Life",
    description:
      "Ready-to-build cabin kits, paid for in bitcoin.",
    category: "hardware",
    addedAt: 50,
    listedAt: 1778371200,
    verifiedAt: 1786579200,
    country: "US",
    pictureUrl: "https://bunkielife.com/wp-content/uploads/2023/03/C54d1NrH_400x400.jpeg",
  },
  {
    // VENDOR #50 — milestone entry. AliceA, May 10, 2026.
    handle: "nprofile1qqszgczjcdug97qae84nqge9dg0wv6qzf7zff52r0uaf82fzre9n69s2wj4qf",
    platform: "nostr",
    name: "AliceA",
    description:
      "Artisan hot chocolate spice mixes, paid for in bitcoin.",
    category: "consumables",
    addedAt: 51,
    listedAt: 1778371200,
    verifiedAt: 1792281600,
    country: "US",
    pictureUrl: "https://blossom.primal.net/1c90c806fa14c5c6114746e8437c03eafa28f832e74c6eb113c54a0f4664663b.jpg",
  },
  {
    handle: "100AcresRanch",
    name: "100 Acres Ranch",
    description:
      "Solar DC mining rigs, mining-controller software, the Thermohashostat, plus hashrate rentals.",
    category: "hardware",
    addedAt: 52,
    listedAt: 1778371200,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://100acresranch.com",
  },
  {
    handle: "nprofile1qqsv8tj2mrsx4ywzqpr466w2jpzq6m25meef60g7ttavl0dku4x5djctspncj",
    platform: "nostr",
    name: "Beejay",
    description:
      "Low-sugar jerky made from ground beef, bison, elk, and chicken.",
    category: "consumables",
    addedAt: 53,
    listedAt: 1778371200,
    verifiedAt: 1792281600,
    country: "US",
    pictureUrl: "https://image.nostr.build/9f3e46eb78f8e6ef6ea7771358e088095423c5f0083362ecfa5e2da50224de47.jpg",
  },
  {
    handle: "lightningenable",
    name: "Lightning Enable",
    description:
      "L402 / Lightning-payment infrastructure · lets AI agents pay for API access over Lightning instead of card auth. Client libraries plus paid producer tiers.",
    category: "services",
    addedAt: 54,
    listedAt: 1778457600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://lightningenable.com",
  },
  {
    handle: "drink_sote",
    name: "Salt of the Earth",
    description:
      "Electrolyte drink sticks (variety packs + flavors) and creatine, for athletes and orange-pilled humans. Ships worldwide.",
    category: "consumables",
    addedAt: 55,
    listedAt: 1778457600,
    verifiedAt: 1786579200,
    country: "US",
    shipsInternational: true,
    website: "https://drinksote.com",
  },
  {
    handle: "Bitaxeshop",
    name: "Bitaxe Shop",
    description:
      "Bitaxe & NerdQaxe open-source solo miners (Gamma, NerdOctaxe, Avalon Nano), cooling kits, and Sovereign Stack bundles · shipped from Germany, 5% Bitcoin discount.",
    category: "hardware",
    addedAt: 56,
    listedAt: 1778457600,
    verifiedAt: 1792281600,
    country: "DE",
    shipsInternational: true,
    acceptsLightning: true,
    acceptsOnChain: true,
    website: "https://bitaxe.de",
  },
  {
    handle: "IxTechCrypto",
    name: "IxTech",
    description: "Bitaxe and Nerdaxe Bitcoin miners, 3D-printed accessories, and laser-etched Bitcoin art.",
    category: "hardware",
    addedAt: 57,
    listedAt: 1778457600,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://ixtech.xyz/",
    shipsInternational: true,
    tradeFriendly: true,
    interestedIn: ["consumables", "apparel"],
    acceptsLightning: true,
    acceptsOnChain: true,
  },
  {
    handle: "GingerSherpa",
    name: "BlockTron",
    description: "BlockTron LED Bitcoin price ticker · desktop-friendly hardware that displays live BTC price.",
    category: "hardware",
    addedAt: 58,
    listedAt: 1778457600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://blocktron.io",
    shopUrl: "https://blocktron.io",
    shipsInternational: true,
    acceptsLightning: true,
    acceptsOnChain: true,
  },
  {
    handle: "NEEDcreations",
    name: "603BTC",
    description: "Bitcoin Education Playing Cards (standard deck for poker or other card games) and a Bitcoin Children's Book for ages 3-8.",
    category: "books",
    addedAt: 59,
    listedAt: 1778457600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://603btc.com/pleb-shop",
    shopUrl: "https://603btc.com/pleb-shop",
    lightningAddress: "needcreations@strike.me",
    shipsInternational: true,
    tradeFriendly: true,
    acceptsLightning: true,
    acceptsOnChain: true,
  },
  {
    handle: "forkandcoin",
    name: "Fork and Coin",
    description:
      "An American Izakaya & Supper Club in Portage Park, Chicago. A new take on the traditional public-house and grill, focusing on natural foods & strong community.",
    category: "services",
    addedAt: 60,
    listedAt: 1778544000,
    verifiedAt: 1792281600,
    country: "US",
    // Restaurant · brick-and-mortar, no shipsInternational (per schema:
    // service / place-based vendors leave the field unset).
    acceptsLightning: true,
    acceptsOnChain: true,
    website: "https://forkandcoin.com",
  },
  {
    handle: "npub17nd4yu9anyd3004pumgrtazaacujjxwzj36thtqsxskjy0r5urgqf6950x",
    platform: "nostr",
    name: "isolabellart",
    description:
      "Oil paintings inspired by time, silence, and light. Each work is unique and for sale in Bitcoin. Italian artist working with classical technique.",
    category: "collectibles",
    addedAt: 61,
    listedAt: 1778544000,
    verifiedAt: 1786579200,
    country: "IT",
    website: "https://isolabellart.it.com/",
    shopUrl: "https://gallery.isolabellart.it.com",
    lightningAddress: "isolabellart@blitzwalletapp.com",
    founderName: "Isolabellart",
    shipsInternational: true,
    acceptsLightning: true,
    acceptsOnChain: true,
    pictureUrl: "https://relay.isolabellart.it.com/83daa5146401b52844625474cfe5bd4dcdeceff250955eb7f185345e18524a8f.png",
  },
  {
    handle: "Karpuzmining",
    name: "Karpuz Mining",
    description:
      "Bitcoin miners, lab-tested mining mods, and a variety of 3D print files available for free to the community.",
    category: "hardware",
    addedAt: 62,
    listedAt: 1778544000,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://www.karpuzmining.com",
    shopUrl: "https://www.karpuzmining.com",
    founderName: "Ryan Blass",
    shipsInternational: true,
    tradeFriendly: true,
    interestedIn: ["hardware", "consumables", "apparel", "collectibles", "services"],
    acceptsLightning: true,
    acceptsOnChain: true,
  },
  {
    handle: "BitcoinBrabant",
    name: "Bitcoin Brabant",
    description:
      "EU bitcoin-only reseller. One of the longest-running official Bitaxe partners (first to sell at scale), plus Canaan miners, books, and hundreds of bitcoin items.",
    category: "hardware",
    addedAt: 63,
    listedAt: 1778544000,
    verifiedAt: 1792281600,
    country: "NL",
    shipsInternational: true,
    acceptsLightning: true,
    acceptsOnChain: true,
    website: "https://bitcoinbrabant.com",
  },
  {
    handle: "npub1ywjh20r8us43tzpkmqk4sw2eq3pyecvkg56msljla35xkkhjwd8qg6latt",
    platform: "nostr",
    name: "TitanDot",
    description:
      "Premium titanium seed phrase backups. Solid titanium plates built for long-term self-custody · stronger than paper, designed to outlast everything but the keys.",
    category: "hardware",
    addedAt: 64,
    listedAt: 1778544000,
    verifiedAt: 1792281600,
    country: "HU",
    lightningAddress: "mordai@blink.sv",
    founderName: "mordai",
    shipsInternational: true,
    acceptsLightning: true,
    acceptsOnChain: true,
    pictureUrl: "https://image.nostr.build/9548ac24e896491c35c5f8303448a0de4049cb355d8c37f7a275b8babf0978b0.jpg",
  },
  {
    // LIGHTNING address migrated zalgebar@zalgebar.com →
    // zalgebar@rizful.com (audit 2026-05). The old endpoint LNURL-pay'd
    // 404 "address removed"; live probe confirms zalgebar.com is 200 and
    // zalgebar@rizful.com returns a valid LNURL-pay payRequest — the
    // business just changed Lightning providers. verifiedAt bumped then:
    // the live LNURL probe IS a fresh confirmation they accept BTC.
    //
    // Re-homed lightning → nostr (2026-07-16). This was the roster's only
    // platform:"lightning" row, which made it look like a counterexample
    // to the X-or-Nostr-required rule; it isn't. zalgebar.com links a
    // Nostr profile, and its NIP-05 (zalgebar@zalgebar.com), the linked
    // nprofile, and the npub all decode to the SAME pubkey
    // 784c3547…d941 — verified via decodeNostrBech32ToPubkey. The Nostr
    // identity was simply never recorded; the LN address was standing in
    // as the handle.
    //
    // NOTE the string collision: the NIP-05 handle below and the OLD
    // Lightning address are both "zalgebar@zalgebar.com". Different
    // protocols that happen to share a domain — this is NOT a revert of
    // the LN migration above. The live LN address stays rizful.com.
    //
    // verifiedAt deliberately NOT bumped: a resolving NIP-05 proves
    // identity, not that they still accept BTC. That's the LNURL probe's
    // job, and the last one was May.
    handle: "zalgebar@zalgebar.com",
    platform: "nostr",
    name: "Zalgebar Media",
    description: "Bitcoin Swag, SeedSigner Merch, and Custom 3D Prints.",
    category: "collectibles",
    addedAt: 65,
    listedAt: 1778544000,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://zalgebar.com",
    shopUrl: "https://zalgebar.com",
    lightningAddress: "zalgebar@rizful.com",
    nostrPubkey:
      "npub10pxr236ey2xmufaw6sg66pr3gxkjfhgrs77urqpjwqfxplc7m9qsh6mwhg",
    shipsInternational: true,
    acceptsLightning: true,
  },
  {
    handle: "cluborange",
    name: "Club Orange",
    description:
      "Location-based social network for Bitcoiners · nearby-people discovery, a Bitcoin-only event directory spanning 71 countries, merchant map, and a built-in Lightning wallet.",
    category: "services",
    addedAt: 66,
    listedAt: 1778544000,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://cluborange.org",
  },
  {
    handle: "npub1cluc6gran6qtzntkq0wlh06hl6yuhz5cwgpf7qyhgxvth3wtcheqnqtgjy",
    platform: "nostr",
    name: "SlingshotVPN",
    description:
      "Privacy-focused VPN. Hides your ISP-visible IP address and encrypts your internet traffic.",
    category: "services",
    addedAt: 67,
    listedAt: 1778544000,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://slingshotvpn.com/",
    lightningAddress: "noblebear13@primal.net",
    founderName: "Bruno",
    shipsInternational: true,
    tradeFriendly: true,
    interestedIn: ["consumables", "services"],
    acceptsLightning: true,
  },
  {
    handle: "npub1739pl5l8tcdq34hwyt97vwjk50lc2px0wp8wu99a4pwpuvg36sgs8s8kts",
    platform: "nostr",
    name: "Onyx Cat Pottery",
    description:
      "Handmade pottery: wheel-thrown plus hand- and slab-built functional pieces, nine years in the craft.",
    category: "collectibles",
    addedAt: 68,
    listedAt: 1778630400,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://onyxcatpottery.com",
    lightningAddress: "onyxcatpottery@getalby.com",
    founderName: "Suzanne",
    shipsInternational: true,
    tradeFriendly: true,
    acceptsLightning: true,
    pictureUrl: "https://blossom.primal.net/39091d0e9413599af9a8e6e0c77889cd0d75ae9bfb3d83d7ca2a3d9e3be086a1.gif",
  },
  {
    handle: "npub1j00fzjx3n8lzkn8h9dkmj7hcf2cpganrw520fdgsdljzl46kmzwq9xvfer",
    platform: "nostr",
    name: "LTAS: let’s talk about sats",
    description:
      "Bitcoin-coded apparel & culture, plus short-form educational content from the founders.",
    category: "apparel",
    addedAt: 69,
    listedAt: 1778630400,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://letstalkaboutsats.xyz",
    lightningAddress: "letstalkabtsats@strike.me",
    founderName: "alana & alyssa",
    shipsInternational: true,
    acceptsLightning: true,
    pictureUrl: "https://blossom.primal.net/f2a5beb260bef221e0d8ae7918115d4774402c8dd39be69e2af3cf1fc0eeff2a.jpg",
  },
  {
    handle: "futurebit",
    name: "FutureBit",
    description:
      "American-made Bitcoin nodes and miners. Plug-and-play hardware for home self-custody and small-scale mining.",
    category: "hardware",
    addedAt: 70,
    listedAt: 1778630400,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://futurebit.io",
  },
  {
    handle: "GekkoScienceLLC",
    name: "GekkoScience LLC",
    description:
      "Bitcoin Home Miners and accessories, designed + built in America since 2013. Also accepts custom Engineering and Design commissions in BTC (Sales@GekkoScience.com).",
    category: "hardware",
    addedAt: 71,
    listedAt: 1778630400,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://www.gekkoscience.com/",
  },
  {
    handle: "npub1wmug87v3shweqg8a7w88fdcdlf9h3glcfm9pu8f6592cm0nqyqzqnrzguz",
    platform: "nostr",
    name: "The Trading Channel",
    description:
      "Free Twitch trading stream + paid TradingView/MetaTrader indicators. Also sells Bitcoin memorabilia (historic El Salvadoran Bitcoin newspapers).",
    category: "collectibles",
    addedAt: 72,
    listedAt: 1778630400,
    verifiedAt: 1786579200,
    country: "SV",
    website: "https://www.twitch.tv/bingtrading",
    lightningAddress: "bingtrading@pay.bbw.sv",
    shipsInternational: true,
    pictureUrl: "https://pbs.twimg.com/profile_images/1512173772371070976/CwDvs31__400x400.png",
  },
  {
    handle: "Ttokkyo2",
    name: "CryptoMachine.Shop",
    description:
      "US-based online shop for Bitcoin home-mining accessories · LAN mods, 3D prints, breakout boards. Ships from South Florida.",
    category: "hardware",
    addedAt: 73,
    listedAt: 1778630400,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://cryptomachine.shop",
  },
  {
    handle: "we_satoshis",
    name: "Wesatoshis",
    description:
      "Bitcoin hardware terminal for moving sats anytime, anywhere. No phones, no apps, no gatekeeper.",
    category: "hardware",
    addedAt: 74,
    listedAt: 1778630400,
    verifiedAt: 1786579200,
    // Operator rule: when a vendor's nation can't be discerned,
    // default to US (so it always renders a flag). Not a
    // re-verification → verifiedAt unchanged.
    country: "US",
    website: "https://www.wesatoshis.com/",
  },
  {
    handle: "npub17u3tzvwjkqat3nusk0uqlqtrwd00hj0g94vj57gh873wy52qptlsn2mh3l",
    platform: "nostr",
    name: "ReHash Heating",
    description:
      "Home hashrate heaters for plebs · double-spend your electricity to heat your home with bitcoin.",
    category: "hardware",
    addedAt: 75,
    listedAt: 1778630400,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://rehashheating.com",
    lightningAddress: "rehashheating@coinos.io",
    pictureUrl: "https://coinos.io/api/public/80069ff80c1f3c346e25d482b5e143e15824c5d0e06ff452e789d5c445f2a4b9.webp",
  },
  {
    handle: "nerdminerstore",
    name: "Nerdminer Store",
    description:
      "Europe’s first open-source Bitcoin mining shop · supporting home miners since 2023.",
    category: "hardware",
    addedAt: 78,
    listedAt: 1778716800,
    verifiedAt: 1792281600,
    country: "ES",
    website: "https://nerdminerstore.com/",
  },
  {
    handle: "npub1u6l09lpjphm6lpcataztsmgwghaxuym7tp7uv9ay88s9ksnd6v5qttjrx8",
    platform: "nostr",
    name: "4EVR.ink",
    description:
      "The permanent record of human expression on Bitcoin. Declarations, scripture, and memorials inscribed into the blockchain via OP_RETURN, where they’ll outlast every server, platform, and algorithm.",
    category: "services",
    addedAt: 77,
    listedAt: 1778716800,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://4evr.ink",
    lightningAddress: "boldtiger29@primal.net",
    founderName: "Aaron Melear",
    shipsInternational: true,
    tradeFriendly: true,
  },
  {
    handle: "saifedean",
    name: "Saifedean Ammous Shop",
    description:
      "Bitcoin economist and author of The Bitcoin Standard, The Fiat Standard, The Gold Standard, and Principles of Economics · books, e-courses, and Saif Academy memberships, payable in BTC (Lightning + on-chain).",
    category: "books",
    addedAt: 79,
    listedAt: 1778716800,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://academy.saifedean.com",
    founderName: "Dr. Saifedean Ammous",
    shipsInternational: true,
  },
  {
    handle: "btc_cards",
    name: "Bitcoin Trading Cards",
    description:
      "Physical trading card collectibles for Bitcoiners · finite supply, transparent provenance, original commissioned art. Trading cards, breaker mats, binders, and posters · payable in BTC.",
    category: "collectibles",
    addedAt: 80,
    listedAt: 1778716800,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://basedtradingcards.com",
    shipsInternational: true,
  },
  {
    // Renamed on X from @FOUNDATIONdvcs, which now 404s (verified
    // 2026-08-13). Handle correction only — the business is very much
    // alive, so verifiedAt is deliberately NOT bumped.
    handle: "foundationhq",
    name: "Foundation",
    description:
      "Passport Prime · personal security platform combining Bitcoin self-custody, 2FA codes, security keys, additional seeds, and encrypted file storage. Runs KeyOS, supports third-party apps.",
    category: "hardware",
    addedAt: 81,
    listedAt: 1778716800,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://foundation.xyz/buy-passport-prime/",
    founderName: "Zach Herbert",
    shipsInternational: true,
  },
  {
    handle: "CincoDoggos",
    name: "Cinco Doggos",
    description:
      "3D print-on-demand for Bitcoin miners and plebs · rig modifications, branded merch, custom items. 21% discount when paying in bitcoin.",
    category: "hardware",
    addedAt: 82,
    listedAt: 1778803200,
    verifiedAt: 1792281600,
    country: "US",
    // Conduit storefront verified 2026-10-18 (storefront profile: Cinco Doggos 3D print-on-demand + Bitcoin Mining Show, same as X @CincoDoggos bio).
    alsoSoldOn: [
      { marketplace: "conduit", url: "https://shop.conduit.market/npub1k238aff50v0xwx4z9h9c2mpg6qlhn45fm5t0zlmelys2c5243x7slv60vh" },
    ],
  },
  {
    handle: "ViciTax",
    platform: "x",
    name: "VICI TAX (Richard W Dewey CPA LLC)",
    description:
      "US tax consulting and preparation for individuals and small businesses. Specialization in serving the globally mobile (expat tax) and have served clients on six continents.",
    category: "services",
    addedAt: 83,
    listedAt: 1778889600,
    verifiedAt: 1792281600,
    country: "US",
    shipsInternational: true,
    // Operator-supplied X handle (May 2026). Primary identity moved
    // Lightning → X (same precedent as Cinco Doggos) so the vendor is
    // discoverable via its public profile; the Lightning payment path
    // is preserved here rather than dropped. verifiedAt NOT bumped —
    // this is an identity/metadata update, not a re-confirmation that
    // they still accept BTC.
    lightningAddress: "VICITax@coinos.io",
  },
  {
    handle: "fugum",
    name: "FUGUM",
    description:
      "Chewing gum and lifestyle brand · gum, apparel, and stickers built around pause, clarity, and calm in a noisy world.",
    category: "consumables",
    addedAt: 84,
    listedAt: 1778716800,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://chewfugum.com",
  },
  {
    handle: "BitcoinArtMag",
    name: "Bitcoin Art Magazine",
    description:
      "The world's first Bitcoin Art Magazine · featuring the work of Fractal Encrypt, Madex, Mear One, Bitcoin Trading Cards, Asanoha and many more.",
    category: "books",
    addedAt: 85,
    listedAt: 1778803200,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://bitcoinartmagazine.com",
  },
  {
    handle: "npub15t9z3yhgfz3y9h9ydj267440ukpxcp6fnxjrytmlrywx34efyqysh9dgu8",
    platform: "nostr",
    name: "FOMO21",
    description:
      "Bitcoin-themed apparel & lifestyle brand · tees, hoodies, hats, drinkware and accessories with HODL, Satoshi and proof-of-work designs.",
    category: "apparel",
    addedAt: 86,
    listedAt: 1778803200,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://fomo21.com",
    lightningAddress: "urbanchicken6@primal.net",
    founderName: "Neil Jacobs",
    shipsInternational: true,
    pictureUrl:
      "https://image.nostr.build/6f9f2f6a3317b2dfabf8422c6e5794c29edacd416273bc61d37a5b1fc14ea304.jpg",
  },
  {
    handle: "BMAG_HQ",
    name: "Bitcoin Museum & Art Gallery",
    description:
      "Permanent Nashville institution and BTC Inc cultural platform · Bitcoin art, artifacts and history, with original fine artworks priced and sold in bitcoin.",
    category: "collectibles",
    addedAt: 87,
    listedAt: 1778803200,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://museum.b.tc",
  },
  {
    handle: "npub1mgw623kdngk63q5h7gz8dvkjpamap5zssc6eh909xfy67sq2cjvqddvdmn",
    platform: "nostr",
    name: "Lightning Bazaar",
    description:
      "Australian online bazaar · raw honey, 3D prints, vinyl, eBooks and a crypto-ticker gadget. Pay on-chain or Lightning for 20% off in sats.",
    category: "collectibles",
    addedAt: 88,
    listedAt: 1778803200,
    verifiedAt: 1792281600,
    country: "AU",
    website: "https://lightningbazaar.com.au",
    lightningAddress: "safezebra4@primal.net",
    acceptsOnChain: true,
    acceptsLightning: true,
    pictureUrl: "https://m.primal.net/KTXR.jpg",
  },
  {
    handle: "npub16jq5v5q7gfx6dnprmzxyjdu6ncmah0mfajavfmwcsm82c7ljtj0q5dzvfc",
    platform: "nostr",
    name: "Turkovich Family Wines",
    description:
      "California family winery & regenerative farm · small-lot wines (red, white, sparkling) and grass-fed lamb. Bitcoin and Lightning accepted on-site.",
    category: "consumables",
    addedAt: 89,
    listedAt: 1778889600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://bitcoinvintner.com",
    lightningAddress: "brownlizard2@primal.net",
    founderName: "Chris Turkovich",
    pictureUrl: "https://m.primal.net/HhgA.jpg",
  },
  {
    handle: "npub16xcnlkwcvrasle96yzpqywqy5hqyku483lwk843a0r70gsmr4r9sa7np3r",
    platform: "nostr",
    name: "Panties For Bitcoin",
    description:
      "Small-batch underwear & intimate apparel made in Italy · panties, bras, boxers and silk foulards. Bitcoin accepted, 10% off paying in BTC.",
    category: "apparel",
    addedAt: 90,
    listedAt: 1778889600,
    verifiedAt: 1792281600,
    country: "CA",
    website: "https://pantiesforbitcoin.com",
    pictureUrl:
      "https://pbs.twimg.com/profile_images/1522010219865419776/lsH3-PiQ_400x400.jpg",
  },
  {
    handle: "coin_vigilante",
    name: "Coin Vigilante",
    description:
      "Bitcoin-themed watches and timepieces · limited Genesis, Transparency and 100K editions, plus straps.",
    category: "collectibles",
    addedAt: 92,
    listedAt: 1778889600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://coinvigilante.com",
    shipsInternational: true,
  },
  {
    handle: "PlaySHAmory",
    name: "SHAmory",
    description:
      "STEM-authenticated Bitcoin card game plus the 'Goodnight Bitcoin' children's book · Bitcoin education for kids and adults.",
    category: "books",
    addedAt: 93,
    listedAt: 1778889600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://shamory.com",
  },
  {
    handle: "TheLeatherMint",
    name: "Leathermint",
    description:
      "Leather goods built around the Bitcoin standard · cordovan wallets, belts, signing-device cases and accessories. Prices shown in bitcoin.",
    category: "apparel",
    addedAt: 94,
    listedAt: 1778889600,
    verifiedAt: 1786579200,
    country: "CA",
    website: "https://theleathermint.com",
    // Conduit storefront verified 2026-10-18 (storefront website theleathermint.com = our website).
    alsoSoldOn: [
      { marketplace: "conduit", url: "https://shop.conduit.market/npub1v0tfjv5ahr3c260jtzdk5w48krerrnkg8fmcnc5lpguk0qda04eqzm3m3e" },
    ],
  },
  {
    handle: "bitcoinpark_",
    name: "Bitcoin Park",
    description:
      "Community-supported Bitcoin campus in Nashville, TN and Austin, TX · memberships, meetups, workshops and coworking for grassroots freedom-tech adoption.",
    category: "services",
    addedAt: 95,
    listedAt: 1778889600,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://bitcoinpark.com",
  },
  {
    handle: "npub1l94pd4qu4eszrl6ek032ftcnsu3tt9a7xvq2zp7eaxeklp6mrpzssmq8pf",
    platform: "nostr",
    name: "Prime Curator DPYC",
    description:
      "The DPYC (“Don't Pester Your Customer”) community storefront: Austrian-economics-themed coffee, mugs, books and brewing gear. Bitcoin accepted via BTCPay.",
    category: "consumables",
    addedAt: 96,
    listedAt: 1778889600,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://stablecoin.myshopify.com",
    lightningAddress: "tollbooth@btcpay.digitalthread.link",
    founderName: "Lonnie VanZandt",
    pictureUrl:
      "https://blossom.primal.net/439906c627ca93743a74d94462985fffd131617bfe41678cf27ef06ece8314ca.jpg",
  },
  {
    handle: "omg21btc",
    name: "Orange Manufacturing Group",
    description:
      "Handcrafted Bitcoin accessories · Lightning keychains, SeedSigner cases, NFC hardwood signs and steel seed sleeves, made with video proof-of-work. Bitcoin preferred.",
    category: "collectibles",
    addedAt: 97,
    listedAt: 1778889600,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://omg21btc.com",
    lightningAddress: "sats@omg21btc.com",
    founderName: "omg21",
    shipsInternational: true,
  },
  {
    handle: "bitcointile1",
    name: "JRC TILE",
    description:
      "Tile and flooring installation for commercial and residential projects · accepts bitcoin for the job.",
    category: "services",
    addedAt: 98,
    listedAt: 1778889600,
    verifiedAt: 1792281600,
    country: "US",
  },
  {
    handle: "BitcoinManor",
    name: "Bitcoin Manor",
    description:
      "Custom Bitcoin merch and handcrafted goods · laser engravings, woodworking, Bitcoin Metric Displays, and the Block Chain Gang children's book series.",
    category: "collectibles",
    addedAt: 99,
    listedAt: 1778889600,
    verifiedAt: 1786579200,
    country: "CA",
    website: "https://bitcoinmanor.com",
    founderName: "Christopher",
  },
  {
    handle: "GoBrrr_me",
    name: "Go₿rrr.me",
    description:
      "Austrian shop for on-demand 3D prints and open-source Bitcoin hardware · Bitaxe, NerdQaxe, SeedSigner and node kits.",
    category: "hardware",
    addedAt: 100,
    listedAt: 1778889600,
    verifiedAt: 1792281600,
    country: "AT",
    website: "https://gobrrr.me",
  },
  {
    handle: "npub1k0pcwa9sgfqfa787ay7nkjrqejfffqe5spehcxhpz6qtgc2u9efq9jmatt",
    platform: "nostr",
    name: "satwize",
    description:
      "Bitcoin-related collectibles and a wide selection of books.",
    category: "books",
    addedAt: 101,
    listedAt: 1778889600,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://www.satwize.com",
    lightningAddress: "satwize@stacker.news",
    shipsInternational: true,
    pictureUrl: "https://blossom.primal.net/20890d7286c2826a94bedcfe5932dd9ef20a374365e92b96e6802fd2ddda7465.png",
  },
  {
    handle: "Bitcoinbutlers",
    name: "Bitcoin Butlers",
    description:
      "Custom self-custody tooling and a free, open-source self-custody concierge wizard with step-by-step tutorials.",
    category: "hardware",
    addedAt: 102,
    listedAt: 1778889600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://www.bitcoinbutlers.com/",
  },
  {
    handle: "SeedVaultMarket",
    name: "Seed Vault Market",
    description:
      "High-quality vegetable and produce seeds plus garden accessories, for growing food freedom.",
    category: "consumables",
    addedAt: 103,
    listedAt: 1778889600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://seedvault.market",
    lightningAddress: "Seedvaultmarket@sathoarder.com",
  },
  {
    handle: "Dustinwatchman",
    name: "Dunawi Group",
    description:
      "Collaborative projects spanning real estate, urban farming, language-center partnerships, and volunteering, with guidance and partnership opportunities.",
    category: "services",
    addedAt: 104,
    listedAt: 1778976000,
    verifiedAt: 1786579200,
  },
  {
    handle: "UnruggableGG",
    name: "Become Unruggable",
    description:
      "One-on-one Bitcoin Self-Custody mentoring and consulting. Helping people all over the world to become sovereign individuals.",
    category: "services",
    addedAt: 105,
    listedAt: 1778976000,
    verifiedAt: 1786579200,
    website: "https://beunruggable.com",
  },
  {
    handle: "npub1mtuzjsdkc6c9ydac0am4dkdefcfszsr3cjx3kly5t4zasq626zhqpvvxl7",
    platform: "nostr",
    name: "FAFORocks",
    description:
      "Free step-by-step guide to accepting Bitcoin and Lightning payments for products, services, events, or donations.",
    category: "books",
    addedAt: 106,
    listedAt: 1779062400,
    verifiedAt: 1786579200,
    country: "GB",
    website: "https://tinyurl.com/FAFO-Rocks",
    lightningAddress: "lfg@rizful.com",
    founderName: "Tam",
    pictureUrl: "https://blossom.primal.net/97fc67408bffde30763fde29deb3dc5d036ff500aae8c01e2aa041475a25aaab.jpg",
  },
  {
    handle: "crinklrewards",
    name: "Crinkl",
    description:
      "Scan any receipt. It becomes a cryptographic proof. Claim bitcoin. No identity required.",
    category: "services",
    addedAt: 107,
    listedAt: 1779148800,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://www.crinkl.xyz/",
  },
  {
    handle: "Lightningmaxi",
    name: "MrSatoshi",
    description:
      "Bitcoin apparel for Number-Go-Up maximalists. NGU.Wear · everyday merch for accumulators.",
    category: "apparel",
    addedAt: 108,
    listedAt: 1779235200,
    verifiedAt: 1786579200,
    country: "US",
    nostrPubkey:
      "npub1s3ts8vt9sq5jwcsharahw95z28nn3k9u2gmy9far4lvw75769zfsjlt90k",
  },
  {
    handle: "bitcoin_ranch",
    name: "Bitcoin Ranch",
    description:
      "Bitcoin lifestyle ranch in Oklahoma · land, cattle, apparel, and art for the country-meets-crypto crossover.",
    category: "apparel",
    addedAt: 109,
    listedAt: 1779235200,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://bitcoinranch.com",
    founderName: "Jeff Williams",
  },
  {
    handle: "Satosphere21",
    name: "Satosphere",
    description:
      "Bitcoin-only solar-ambient-light globe · powers itself from indoor light, no plug or battery. Handmade kinetic sculpture. Founder: @AC_616.",
    category: "collectibles",
    addedAt: 110,
    listedAt: 1779321600,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://satosphere21.com",
  },
  {
    handle: "sportdrink",
    name: "Sport Drink",
    description:
      "Athletic electrolyte powder, handmade in the US. Real sugar, real fruit, clean salt, fluoride-free.",
    category: "consumables",
    addedAt: 111,
    listedAt: 1779321600,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://sport-drink.com",
    shipsInternational: true,
  },
  {
    handle: "CunyRenaud",
    name: "The Bitcoin Portal",
    description:
      "Bitcoin Monetary Health Index · structural read of the blockchain, updated daily.",
    category: "services",
    addedAt: 112,
    listedAt: 1779494400,
    verifiedAt: 1786579200,
    website: "https://thebitcoinportal.com",
    founderName: "Renaud",
  },
  {
    handle: "atoms",
    name: "Atoms",
    description:
      "A NYC-based brand that makes sneakers, masks, and friends unlike any other. Sometimes art and chai too.",
    category: "apparel",
    addedAt: 113,
    listedAt: 1779494400,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://atoms.com/",
  },
  {
    handle: "npub1qmh57wjhcmjffterlfn0yrex086plhqfllnah0ya486wvdh4zsqqma4qdt",
    platform: "nostr",
    name: "PirateHash",
    description:
      "Bitcoin books, posters, and collectibles · physical merch for plebs who like things tactile. Catalog includes annotated editions and a Collector's Edition hardcover.",
    category: "books",
    addedAt: 114,
    listedAt: 1779926400,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://piratehash.com",
    lightningAddress: "piratehash@getalby.com",
    pictureUrl: "https://blob.satellite.earth/f5c075d5634f295ffdb1a8a224d6b64fcc40960860582ab59da923398362cc7d",
  },
  {
    handle: "Trails@trailscoffee.com",
    platform: "nostr",
    name: "Trails Coffee",
    description:
      "Specialty coffee roaster in Anmore BC · single-origin Guatemalan, the Buntzen Blend, monthly subscription. 10% Bitcoin discount. Nostr-exclusive releases kick proceeds to Open Sats, HRF, BTCPay.",
    category: "consumables",
    addedAt: 115,
    listedAt: 1779926400,
    verifiedAt: 1792281600,
    country: "CA",
    website: "https://trailscoffee.com",
  },
  {
    handle: "npub13kkpytvjcxsqka9pdshw3094urgh8fxwx7ru258lved9wr7f35mspal584",
    platform: "nostr",
    name: "BTC SWAG",
    description:
      "Bitcoin apparel, accessories, and posters · including stacker.news community swag and ad-style posters made by the SN crowd. Founded by AGORA. Ships internationally, pay over Lightning.",
    category: "apparel",
    addedAt: 116,
    listedAt: 1780185600,
    verifiedAt: 1792281600,
    country: "CH",
    founderName: "AGORA",
    website: "https://swag.btc.pub",
    lightningAddress: "agora@coinos.io",
    pictureUrl: "https://coinos.io/api/public/d31e8708953808fbd4f5bf313a28298a27b232728f6c5d25c5eeb0c4bc1eb280.webp",
  },
  {
    handle: "nprofile1qqs0np8wrvynyjpfjlwn37d3kyts729akgh6h8k57xwtzv4vuj3ryxgmr3ks4",
    platform: "nostr",
    name: "BitPrint Solutions",
    description:
      "Print-on-demand Bitcoin apparel and custom merchandise. Pay with Lightning or on-chain at checkout (OpenNode).",
    category: "apparel",
    addedAt: 117,
    listedAt: 1780358400,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://bitprintsolutions.com",
    shopUrl: "https://store.bitprintsolutions.com",
    pictureUrl: "https://blossom.primal.net/4be216cca984cab166863f6280d49b6627b4a7dc6f5836cb17613d0b70907d34.jpg",
  },
  {
    handle: "Opensource_de",
    name: "Open Source Miners",
    description: "Handmade open source Bitcoin mining hardware.",
    category: "hardware",
    addedAt: 118,
    listedAt: 1780617600,
    verifiedAt: 1792281600,
    country: "DE",
    website: "https://opensourceminers.de/",
  },
  {
    handle: "orangestdshop",
    name: "Orange Standard",
    description:
      "Bitcoin streetwear and apparel. Shirts and merch with sound-money and sovereignty motifs, payable over Lightning.",
    category: "apparel",
    addedAt: 119,
    listedAt: 1781308800,
    verifiedAt: 1786579200,
    website: "https://orange-standard-2.myshopify.com/",
  },
  {
    handle: "AdmiralWild",
    name: "Admiral Wildlife Services",
    description:
      "Wildlife removal for homes and businesses around Indianapolis, IN · trapping, bat and bird evictions, exclusion repair, dead-animal removal, and inspections. Takes Bitcoin and Lightning.",
    category: "services",
    addedAt: 120,
    listedAt: 1782432000,
    verifiedAt: 1786579200,
    country: "US",
    founderName: "Kirk Neuner",
    website: "https://admiralwildlifeservices.com",
    lightningAddress: "effulgentperseverance539004@getalby.com",
  },
  {
    handle: "Gheezer_us",
    name: "Gheezer",
    description:
      "Handmade ghee-based peanut butter · low-PUFA and seed-oil-free.",
    category: "consumables",
    addedAt: 121,
    listedAt: 1782691200,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://gheezer.us",
  },
  {
    handle: "ladylaurette21",
    name: "Lady Laurette",
    description:
      "Linen dresses and natural-fabric clothing made in Finland · high quality clothing for high quality money.",
    category: "apparel",
    addedAt: 122,
    listedAt: 1783036800,
    verifiedAt: 1792281600,
    country: "FI",
    website: "https://ladylaurette.com",
  },
  {
    handle: "bitlancework",
    name: "BitLance",
    description:
      "Freelance platform for the Bitcoin economy · find jobs, hire talent, and earn sats globally without borders.",
    category: "services",
    addedAt: 123,
    listedAt: 1783814400,
    verifiedAt: 1792281600,
    founderName: "Destiny Smart",
    website: "https://www.bitlance.work/",
    lightningAddress: "bitlance@blink.sv",
    acceptsLightning: true,
  },
  {
    handle: "CoinCards",
    name: "CoinCards",
    description:
      "Buy gift cards, mobile top-ups, and prepaid vouchers with on-chain Bitcoin or Lightning · no account needed. Serving Canada, the US, UK, Australia, and Europe · helping people live on a Bitcoin standard since 2014.",
    category: "services",
    addedAt: 124,
    listedAt: 1783641600,
    verifiedAt: 1792281600,
    country: "CA",
    website: "https://coincards.com/",
    acceptsLightning: true,
  },
  {
    handle: "btcogmaxi",
    name: "BTC OG MAXI",
    description:
      "Luxury sunglasses built for maximalists · pay in Bitcoin for a discount. OPSEC-minded Bitcoin art on the inside, HFSP on the outside.",
    category: "apparel",
    addedAt: 125,
    listedAt: 1783728000,
    verifiedAt: 1792281600,
    website: "https://btcogmaxi.com/",
  },
  {
    // Digital service (Estonian OÜ) · country unset per the services
    // guidance above. Handle + live explorer re-verified on add.
    handle: "BlockSight_Live",
    name: "BlockSight.Live",
    description:
      "Free Bitcoin block explorer built to make blockchain data easier to understand. Visual, privacy focused, available in 31 languages, with a powerful API for businesses and developers building on Bitcoin.",
    category: "services",
    addedAt: 126,
    listedAt: 1783814400,
    verifiedAt: 1786579200,
    website: "https://blocksight.live/",
  },
  {
    handle: "Goldentallow",
    name: "Golden Tallow",
    description:
      "Handmade skincare made from wagyu beef tallow. Small-batch US producer.",
    category: "consumables",
    addedAt: 127,
    listedAt: 1783987200,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://www.goldentallow.com/",
  },
  {
    handle: "npub1ekg23ya6t2npktwa26sw3d74htpnmeeaqg0sz2n03rzwpaa483fqyzqwns",
    platform: "nostr",
    name: "Sat’s Oil",
    description:
      "Family olive grove in Sicily · limited-edition extra-virgin olive oil, a story in every tin. Ships worldwide to bitcoiners.",
    category: "consumables",
    addedAt: 128,
    listedAt: 1784764800,
    verifiedAt: 1792281600,
    country: "IT",
    website: "https://satsoil.carrd.co/",
    lightningAddress: "maroonbear19@primal.net",
    shipsInternational: true,
    founderName: "Alessandro",
    pictureUrl:
      "https://blossom.primal.net/651138b63a280a9d1640b206f41e77cdedb5462971f84252cb61d84af0e4074b.jpg",
  },
  {
    handle: "npub1kx8fc8xfllpkr28jychmnf2prgrpxs42ld97k9dfv59w2y2ddp3qpcr0qu",
    platform: "nostr",
    name: "The Bitcoin Act",
    description:
      "Twice-weekly newsletter on Bitcoin law and regulation · guest articles published on the site, open to outside writers.",
    category: "services",
    addedAt: 129,
    listedAt: 1785024000,
    verifiedAt: 1786579200,
    country: "US",
    website: "https://thebitcoinact.xyz",
    lightningAddress: "rusttiger22@primal.net",
    founderName: "Satoshi’s Lawyer",
    pictureUrl:
      "https://blossom.primal.net/a6d1d8f55ca72dd1e3a9a4ce0ee1c926c69a0d275288e47d5ddb426940ce4a79.png",
  },
  {
    handle: "SEAisMEDICINE",
    name: "BTC Aloha",
    description:
      "Bitcoin beachwear, art and aloha · shirts, dresses, towels and bags in linen, organic cotton and silk, handmade to order in England.",
    category: "apparel",
    addedAt: 130,
    listedAt: 1785110400,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://www.btcaloha.shop",
    founderName: "Naomi",
    shipsInternational: true,
    // Same brand on Nostr · confirmed against the signature-verified
    // kind:0 (name "SEAisMEDICINE", website btcaloha.shop). The
    // profile's lud16 is deliberately NOT adopted as lightningAddress
    // — a zap wallet is not necessarily the business till (lib/ln-guard).
    nostrPubkey:
      "npub15x4z39e8l52s7ql29q9z385pymjw8g67220exvck7uqt3ll2y0pq3myf4y",
  },
  {
    // THE HOUSE LISTING (2026-08-08 · operator request). Galaxy Mind
    // sells a real product for bitcoin — hourly SHA256 rental — and a
    // directory that lists a competitor doing exactly that (100 Acres
    // Ranch, addedAt 52) while hiding its own would be the less honest
    // choice. Three guards keep it from reading as self-dealing:
    //
    //   1. The description DISCLOSES the relationship in its first
    //      clause. A reader can never mistake whose listing this is.
    //   2. HOUSE_HANDLE (below) excludes it from every surface that
    //      PROMOTES a merchant — the weekly Featured Vendor rotation
    //      and the social spotlight drafts. Being in the directory is
    //      a listing; being picked as "a merchant worth knowing about
    //      this week" by our own rotation would be astroturfing.
    //   3. The verification claim stays auditable like everyone
    //      else's: the machines are listed publicly on
    //      MiningRigRentals and the live book is at /api/hashrate.
    //
    // If this listing ever feels like a thumb on the scale, delete it —
    // the directory's credibility is worth more than one row.
    handle: "GalaxyMind",
    // Named for what it is, not for the product brand: a directory row
    // reading "Block Shot" looked like a third party, which is the
    // opposite of the disclosure this listing is built on.
    name: "Galaxy Mind Hashrate",
    description:
      "Galaxy Mind's own fleet (yes, this site) · rent US-based Bitcoin hashrate in 270 TH/s chunks and point it at any pool you choose. Zero custody, the renter keeps whatever it finds.",
    category: "services",
    website: "https://galaxymind.space/hashrate",
    addedAt: 131,
    listedAt: 1786147200,
    verifiedAt: 1792281600,
    country: "US",
  },
  {
    handle: "ToshiTreasures",
    name: "Toshi Treasures",
    // First general-merchandise vendor. The shop is not Bitcoin-themed
    // apparel — it is a store that ACCEPTS bitcoin for overstock of
    // many kinds. Stretching Apparel was the listing-day compromise;
    // general-goods is the honest bucket.
    description:
      "Mother-and-son resale shop in Grand Prairie, Texas · Amazon returns and overstock (clothing, home goods, tools, electronics) sold for bitcoin, with a further discount for paying in sats.",
    category: "general-goods",
    addedAt: 132,
    listedAt: 1786752000,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://toshitreasures.com/",
    founderName: "Patrick",
    // Continental US 48 only · no AK/HI or territories (stated on
    // the shop's own "How it works" and enforced at checkout).
    shipsInternational: false,
    // The submitted lightningAddress (opalcardinal0@aqua.net) is
    // deliberately NOT listed. It's an X-platform vendor, so there is
    // no signed kind:0 to compare against — ln-guard returned
    // "no-anchor"/needsConfirm — and the handle is an auto-generated
    // Aqua wallet name, i.e. personal-wallet shaped rather than a
    // verifiable business till (same call as BTC Aloha, addedAt 130).
    // The shop's own hosted checkout is the payment path. Adopt it
    // only after an out-of-band confirmation with the vendor.
  },
  {
    handle: "Bcuz21",
    name: "The Belief Machine",
    description:
      "Signed paperbacks of The Belief Machine, Brett Hansen's book on what Bitcoin reveals about how we believe · shipped directly by the author.",
    category: "books",
    addedAt: 133,
    listedAt: 1787011200,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://thebeliefmachine.org",
    founderName: "Brett Hansen",
    // The submitted lightningAddress (bcuz21@mannabitcoin.com) is NOT
    // listed. It resolves healthily and its username matches the X
    // handle, but a custodial username is first-come-first-serve and
    // proves nothing on its own; this is an X-platform vendor, so there
    // is no signed kind:0 to compare against and ln-guard returned
    // "no-anchor"/needsConfirm. The shop sells through its own BTCPay
    // Server checkout either way. Adopt the address only after an
    // out-of-band confirmation (same call as BTC Aloha addedAt 130 and
    // Toshi Treasures addedAt 132).
    // Conduit storefront verified 2026-10-18 (storefront website thebeliefmachine.org = our website; lists The Belief Machine paperback).
    alsoSoldOn: [
      { marketplace: "conduit", url: "https://shop.conduit.market/npub1g3kct3d6e9ct9p6gck9qeqjl3euvek7tfe9qv3y53wac9ahxngasqym3wz" },
    ],
  },
  {
    handle: "Bitbrandshop",
    name: "BitBrand",
    // Submitter picked apparel. Catalog is handmade Bitcoin art
    // (branding irons, branded leather) so collectibles — hats stay
    // in the description, per the single-category convention.
    description:
      "Hand-branded Bitcoin leather coasters, hats, stickers, and branding irons, made in the USA.",
    category: "collectibles",
    addedAt: 134,
    listedAt: 1787270400,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://bitbrandshop.com/",
    shipsInternational: true,
  },
  {
    // Submitted via /submit as Hardware & Mining (id
    // mt4wgbv7-cf1850e5-89c2-4ad2-9c16-eed07e0acd25). Live X
    // @RiglyBlockParty · weekly Saturday mining party at
    // blockparty.rigly.io. Buy-in is hashrate priced in sats, or
    // point your own miner; they found block 955,703 on 2026-06-27.
    handle: "RiglyBlockParty",
    name: "Rigly Block Party",
    description:
      "Weekly Saturday mining party. Buy hashrate in bitcoin or point your own miner with the group. Found block 955,703.",
    category: "hardware",
    addedAt: 135,
    listedAt: 1787356800,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://blockparty.rigly.io",
  },
  {
    // Sourced 2026-08-25 from bitcoin.com.br/marketplace. Shop
    // copy (and the @homedock bio) state on-chain + Lightning at
    // checkout; operator accepted that claim as confirmation.
    handle: "homedock",
    name: "Homedock",
    description:
      "Brazilian furniture and home décor, shipping nationwide since 2013. Checkout takes bitcoin on-chain or Lightning.",
    category: "general-goods",
    addedAt: 136,
    listedAt: 1787616000,
    verifiedAt: 1787616000,
    country: "BR",
    website: "https://homedock.com.br",
    founderName: "Daniela Costa",
    shipsInternational: false,
    acceptsOnChain: true,
    acceptsLightning: true,
  },
  {
    // Sourced 2026-08-25 from bitcoin.com.br/marketplace. BTCPay
    // checkout (3h on-chain invoice, 5% bitcoin discount) is
    // documented on kriptobr.com; operator accepted that claim.
    handle: "BrKripto",
    name: "KriptoBR",
    description:
      "Official Brazilian reseller of Trezor, Ledger, SecuX and YubiKey, stocked in São Paulo. Pay with bitcoin at checkout.",
    category: "hardware",
    addedAt: 137,
    listedAt: 1787616000,
    verifiedAt: 1792281600,
    country: "BR",
    website: "https://kriptobr.com",
    shipsInternational: false,
    acceptsOnChain: true,
    acceptsLightning: false,
  },
  {
    // Submitted via /submit (id mtbhdfty-10cf2ec0-cbbb-40e1-8f1c-f673cbe1e2a5).
    // Vetting 2026-08-27: 33gamma.com registered 2021-03-26 (5.5y, the
    // opposite of the days-old-domain signal), disclosed legal entity
    // "33 Gamma L.L.C." with a named CEO (Christopher Shilts), a 90-day
    // warranty, a returns/damage policy, and a privacy policy. The shop
    // states "Priced in Bitcoin" and "Buy NES & SNES Games With Bitcoin"
    // on its own pages. X @33_gamma resolves, which is the identity
    // anchor new listings require · a website alone would not be enough.
    // Also runs a buy-back paying BTC at 50% of PriceCharting value,
    // which is why the description mentions it: two-way flow is the
    // circular-economy case, not just a checkout button.
    handle: "33_gamma",
    name: "33 Gamma",
    description:
      "Cleaned, tested, authentic NES and SNES cartridges priced in bitcoin, backed by a 90-day warranty. Also buys games back for BTC.",
    category: "collectibles",
    addedAt: 138,
    listedAt: 1787788800,
    verifiedAt: 1792281600,
    country: "US",
    website: "https://33gamma.com/",
  },
  {
    // SparkieLabs (X @satslist) · this row has now been pointed at all
    // three of their products, and the history is worth keeping because
    // each move was a correction rather than a preference.
    //
    // 1. Listed 2026-09-05 as Lightning Control Center, on the strength
    //    of the SatsList page carrying bitcoin/lightning/sats vocabulary.
    //    Reading the listing BODY says the opposite: the Community
    //    Edition is "free forever", MIT licensed, installed with a curl
    //    one-liner, priced 0 sats. Nobody pays bitcoin for it, so it
    //    failed northstar clause 1. Keyword density is not a payment path.
    // 2. Repointed to SoloLedger, their bookkeeping SaaS, which was the
    //    submission still sitting in the queue and does have a
    //    first-party Lightning checkout.
    // 3. Repointed to SATSLIST on 2026-09-07 (operator call). This is the
    //    brand the handle actually names, and it is a marketplace rather
    //    than one product: fourteen categories, listings priced in sats,
    //    non-custodial so buyer and seller settle directly. It is the
    //    larger spending surface and the one a visitor arriving from
    //    @satslist expects to land on.
    //
    // One row today. The old "one row per identity" rule is retired
    // (2026-10, multi-shop): a handle may own several listings, so
    // SoloLedger could earn its own row under @satslist through /submit
    // like any second shop (own name and website, ownership proof at
    // review). sparkielabs.com is still a pre-launch placeholder with no
    // checkout, so it is not a listable storefront either way.
    //
    // The shop-shelf image is a SCREENSHOT, not an og:image: satslist.shop
    // publishes none, so snapshot-vendor-shelves.ts fell back as designed.
    //
    // The submitted Lightning address is STILL DELIBERATELY NOT LISTED.
    // The intake guard returned no-anchor / needsConfirm: there is no
    // signed kind:0 to verify it against, and a lud16 is a zap wallet
    // rather than necessarily the business till. Add it only after an
    // out-of-band confirmation, per the ln-guard rule. (Their own footer
    // publishes zap@satslist.shop as a DONATION address, which is not the
    // same thing as a payment rail for goods.)
    handle: "satslist",
    name: "SatsList",
    description:
      "A bitcoin marketplace for gear, services and collectibles, listed and priced in sats across fourteen categories. Non-custodial, so buyer and seller settle directly.",
    category: "general-goods",
    addedAt: 139,
    listedAt: 1788566400,
    verifiedAt: 1792281600,
    country: "US",
    founderName: "Luca",
    acceptsLightning: true,
    website: "https://www.satslist.shop/",
  },
  // Approved 2026-09-25 from /submit (mugm8n8v). @mineshop_eu is the
  // shop's own X account (Ireland, since 2023). The live FAQ names
  // Bitcoin at checkout through Coinbase Commerce. Mining Hardware
  // Limited, company 596721. They also run a solo pool and a hashrate
  // rental desk; this row is the hardware shop.
  {
    handle: "mineshop_eu",
    name: "Mineshop.eu",
    description:
      "ASIC Bitcoin miners, home-mining hardware, and accessories, shipped from Ireland. Bitcoin at checkout via Coinbase Commerce.",
    category: "hardware",
    addedAt: 140,
    listedAt: 1790294400,
    verifiedAt: 1790294400,
    country: "IE",
    shipsInternational: true,
    website: "https://mineshop.eu/",
  },
  // Approved 2026-10-08 from /submit (muh8uhds-26f85923-90fa-4f89-a336-
  // c929ba251514), operator call after a scam-risk warning. All three bars
  // pass: guest checkout offers on-chain BTC (no account, no Lightning);
  // @shopvoltvault is the shop's own X; the npub below is published in
  // shopvoltvault.com/.well-known/nostr.json ("_" and "voltvault") and its
  // kind:0 names VoltVault with nip05 _@shopvoltvault.com. Caveats noted at
  // vet time: the X account dates from 2026-08 with a small following,
  // prices sit well under retail, and the checkout's BTC address showed no
  // prior use. Re-verify on the normal cadence and pull the row if a buyer
  // reports non-delivery.
  //
  // The submission and kind:0 also list ETH, SOL and stablecoins; the
  // description sticks to bitcoin. The kind:0 has no lud16, so there is no
  // lightningAddress, and acceptsLightning is false to say so. The
  // submission said free US shipping, but the live checkout and how-to-pay
  // pages say free worldwide shipping from Utah, so shipsInternational
  // follows the site.
  {
    handle: "shopvoltvault",
    name: "VoltVault",
    description:
      "Open-box, unused electronics: PS5, Xbox, Switch 2, iPhone, Galaxy, AirPods and iPad accessories. Guest checkout in on-chain bitcoin, shipped from Utah with a 30-day money-back policy.",
    category: "general-goods",
    addedAt: 141,
    listedAt: 1791417600,
    verifiedAt: 1791417600,
    country: "US",
    website: "https://shopvoltvault.com/",
    acceptsOnChain: true,
    acceptsLightning: false,
    shipsInternational: true,
    nostrPubkey:
      "npub1408d6rukveczrtpa9myrkexaayuv29v0e83g0la38k3kkt57aq6s46rxes",
  },
  // Approved 2026-10-15 by the operator after Mario replied yes to the outreach
  // invite (AgentMail thread 87852258-1605-424e-bab4-86b60aeda9dc). All three
  // bars re-checked live that day: WooCommerce guest checkout offers the
  // shop's own BTCPay Server (Lightning + on-chain) alongside iDEAL etc.;
  // @ZijlstraMario ("Mario | BitcoinStuffStore.com") is linked from the
  // shop's site and posted that day; the npub below is in that X bio.
  // Owner Mario Zijlstra, Meppel NL (KVK 90462769). Resells Start9 /
  // Bitaxe gear; the shop is the listing, not those brands.
  {
    handle: "ZijlstraMario",
    name: "BitcoinStuffStore",
    description:
      "Bitaxe miners, nodes, hardware wallets, Lightning gadgets and bitcoin merch from an official Bitaxe reseller in the Netherlands. Guest checkout in Lightning or on-chain via the shop's own BTCPay Server.",
    category: "hardware",
    addedAt: 142,
    listedAt: 1792022400,
    verifiedAt: 1792022400,
    country: "NL",
    founderName: "Mario",
    website: "https://www.bitcoinstuffstore.com/",
    acceptsOnChain: true,
    acceptsLightning: true,
    nostrPubkey:
      "npub135q6dvnjah9023xszmjs2wvd4gqhn2trku52wt2lv8cl4hc8ltjsk0w4sq",
  },
  // Approved 2026-10-17 by the operator from /submit (mvbm23ht-d6a88266-71ae-4cb4-
  // a9af-9c8dd6931de2). Second shop under @Bcuz21 (multi-shop), separate
  // from The Belief Machine row above, which is unchanged. All three bars
  // checked live that day: WooCommerce guest checkout (no account) offers
  // BTCPay (Lightning + on-chain) alongside card; @Bcuz21's bio links
  // bitcoinartstore.com ("AI Artist") and posts daily; the npub below has
  // nip05 bcuz@conduit.market (resolves) and names The Belief Machine, and
  // Brett sells on Conduit per his own X posts. Same owner: the About page
  // says "created by Brett Hansen"; both domains share registrar, Bluehost
  // NS and host. No lightningAddress until confirmed out-of-band (ln-guard
  // rule, same as the row above). The submission said "3D"; the live
  // catalog is prints only, so the description follows the site.
  {
    handle: "Bcuz21",
    name: "Bitcoin Art Store",
    description:
      "Original Bitcoin-inspired art prints on canvas, framed canvas, fine art paper, aluminum and acrylic, made by Brett Hansen. Guest checkout in Lightning or on-chain via BTCPay.",
    category: "collectibles",
    addedAt: 143,
    listedAt: 1792195200,
    verifiedAt: 1792195200,
    country: "US",
    founderName: "Brett Hansen",
    website: "https://bitcoinartstore.com/",
    acceptsOnChain: true,
    acceptsLightning: true,
    nostrPubkey:
      "npub1g3kct3d6e9ct9p6gck9qeqjl3euvek7tfe9qv3y53wac9ahxngasqym3wz",
  },
  // Conduit trio (operator approved 2026-10-18; D-20261018-07, -08,
  // -10). All checked live 2026-10-18. The npub below each row signs the
  // kind:30402 listings on its Conduit storefront, and that storefront is
  // where bitcoin pay happens. No lightningAddress on any of the three:
  // they are X-platform rows, so ln-guard wants out-of-band confirmation
  // first (same call as BTC Aloha addedAt 130). Country is set only where
  // it was verified.
  //
  // Born To Be Free (D-20261018-07): borntobefree.store is a Shopify site
  // that takes card/PayPal only, so the website points at the Conduit
  // storefront, where every item is priced and paid in bitcoin. The
  // npub's kind:0 names borntobefree.store as its website and carries
  // nip05 borntobefree@primal.net; @BornTo_BeFree posts actively.
  {
    handle: "BornTo_BeFree",
    name: "Born To Be Free",
    description:
      "Small-batch tallow skincare made with grass-fed beef tallow: body butters, lip butters and scented soap bars. Seed-oil free and plastic free, paid in bitcoin through their Conduit storefront.",
    category: "consumables",
    addedAt: 144,
    listedAt: 1792281600,
    verifiedAt: 1792281600,
    country: "US",
    website:
      "https://shop.conduit.market/npub1vdaw2fegp4aqkf4mds4htwk3wt6m6my23vvs0vgzy2tgpncv8p5qpwgm7x",
    nostrPubkey:
      "npub1vdaw2fegp4aqkf4mds4htwk3wt6m6my23vvs0vgzy2tgpncv8p5qpwgm7x",
    alsoSoldOn: [
      { marketplace: "conduit", url: "https://shop.conduit.market/npub1vdaw2fegp4aqkf4mds4htwk3wt6m6my23vvs0vgzy2tgpncv8p5qpwgm7x" },
    ],
  },
  // BTC Black Sheep (D-20261018-08): bitcoinblacksheep.com (WooCommerce)
  // checkout offers "Pay with Bitcoin" over Lightning; @BTCBlackSheep's
  // bio links the site. The npub has nip05 blacksheep@conduit.market and
  // runs a sats-priced Conduit storefront with the same catalog. Country
  // not verified, so unset.
  {
    handle: "BTCBlackSheep",
    name: "BTC Black Sheep",
    description:
      "Bitcoin apparel for the ones who never fit the mold: hoodies, graphic tees, beanies and embroidered hats, with hip hop and retro gaming nods. Pay in bitcoin over Lightning on their site or in sats on Conduit.",
    category: "apparel",
    addedAt: 145,
    listedAt: 1792281600,
    verifiedAt: 1792281600,
    website: "https://bitcoinblacksheep.com",
    acceptsLightning: true,
    nostrPubkey:
      "npub18gy27jjcvvdrmucrx4ghc03m4rn5aef89nwx02farcxylcrk65asw744n8",
    alsoSoldOn: [
      { marketplace: "conduit", url: "https://shop.conduit.market/npub18gy27jjcvvdrmucrx4ghc03m4rn5aef89nwx02farcxylcrk65asw744n8" },
    ],
  },
  // NOVA (D-20261018-10): @TheBitcoinNova posts actively; the npub has
  // nip05 staci@conduit.market and runs a sats-priced Conduit storefront
  // (one "Test Zap" item is ignored). The website points at that
  // storefront, which is where bitcoin pay happens. No founderName and no
  // surname anywhere (PII). Country not verified, so unset.
  {
    handle: "TheBitcoinNova",
    name: "NOVA",
    description:
      "Family-made pantry goods from Greece, small-batch extra virgin olive oil and Cretan wildflower honey, plus hair care and beauty picks. Priced in sats on their Conduit storefront.",
    category: "consumables",
    addedAt: 146,
    listedAt: 1792281600,
    verifiedAt: 1792281600,
    website:
      "https://shop.conduit.market/npub1tan2cwtf8s7zxvck79qllzaa7smy03y9ftd50gk6jnag2htnslssyfhjmr",
    nostrPubkey:
      "npub1tan2cwtf8s7zxvck79qllzaa7smy03y9ftd50gk6jnag2htnslssyfhjmr",
    alsoSoldOn: [
      { marketplace: "conduit", url: "https://shop.conduit.market/npub1tan2cwtf8s7zxvck79qllzaa7smy03y9ftd50gk6jnag2htnslssyfhjmr" },
    ],
  },
  // North Idaho Tallow Co. (D-20261018-14; /submit Oct 17,
  // the operator approved; executed 2026-10-18 under his delegation).
  // Bars checked live 2026-10-18 without buying anything: the site's own
  // nav ("₿itcoin Shop") links its BTCPay Server point-of-sale on Voltage,
  // which lists the same soaps and balms and says orders paid in bitcoin
  // ship free; @idahotallow's bio links idahotallow.com and says it takes
  // Bitcoin. The npub's kind:0 is "Idaho Tallow" and carries the same
  // lud16 the shop submitted, so it ties to the submitter, but the site
  // and X do not link it yet. No lightningAddress: X-platform row, so
  // ln-guard wants out-of-band confirmation first (same call as BTC Aloha
  // addedAt 130). The submission's website field was the BTCPay host;
  // the listing uses the shop's own domain. founderName is the first name
  // the shop submitted.
  {
    handle: "idahotallow",
    name: "North Idaho Tallow Co.",
    description:
      "Handmade grass-fed beef tallow skincare from a family-owned shop: soaps, balms, lip balms, hair pomade, beard balm and candles. Bitcoin orders go through the shop's own BTCPay store and ship free.",
    category: "consumables",
    addedAt: 147,
    listedAt: 1792281600,
    verifiedAt: 1792281600,
    country: "US",
    founderName: "Melissa",
    website: "https://idahotallow.com/",
    nostrPubkey:
      "npub1zfsefp6xmflreww84n84l5ns064p9xh023unymr37zureqs3f32s4h0exw",
  },
  // Layer1 Studio (D-20261018-22; /submit Oct 18, operator's yes
  // Bars checked live 2026-10-18 without buying anything: the
  // WooCommerce store's public Store API lists a BTCPay gateway ("BTCPay
  // (Bitcoin, Lightning Network, ...)") ahead of card, and the About page
  // says the shop takes bitcoin; @layer1_studio links layer1.studio and the
  // site links back (account is new: first posts Oct 18). The npub below is
  // the submitter's signed key: kind:0 "Layer1 Studio", nip05
  // _@layer1.studio (layer1.studio/.well-known/nostr.json resolves to the
  // same key), and lud16 hi@layer1.studio. That matches the submitted
  // Lightning address, so ln-guard's nostr rule (form == signed lud16)
  // allows publishing it; its LNURL-pay endpoint answered with the same
  // nostrPubkey. founderName is the first name the shop submitted.
  {
    handle: "npub1ucerdfkcv9t0m5kjewtxegaapnz9n28hcgtyhrq8h6jerhf730tqpvlymj",
    platform: "nostr",
    name: "Layer1 Studio",
    description:
      "Premium 3D-printed and hand-poured resin Bitcoin coasters, coaster holders and magnets, modelled, printed and hand-finished in-house. Checkout offers bitcoin and Lightning via BTCPay.",
    category: "general-goods",
    addedAt: 148,
    listedAt: 1792281600,
    verifiedAt: 1792281600,
    country: "AU",
    founderName: "Chris",
    website: "https://layer1.studio/",
    lightningAddress: "hi@layer1.studio",
    pictureUrl:
      "https://blossom.primal.net/c2e495a45c7a7bf3bebc7ebbdba2354da7874766e24c675457af2a90adf90197.png",
  },
];

/**
 * The directory's one self-listing (see the entry above). Exported so
 * every surface that PROMOTES a vendor can exclude it with a named
 * reference instead of a magic string. Listing ourselves is fine;
 * putting ourselves in a spotlight rotation we control is not.
 */
export const HOUSE_HANDLE = "GalaxyMind";
