// Listing dedupe + ownership-proof evidence (multi-shop, 2026-10).
//
// One identity (handle + platform) may own several listings; a
// STOREFRONT may be listed only once. Pure functions here so the submit
// route, the review CLI, the admin approve endpoint and the validator
// share one rule and it is testable without KV or network:
//
//   reject  · the website is already listed (under ANY handle) · this
//             also covers "same handle + same site"
//   reject  · the name slugifies onto an existing /v page
//   accept  · same handle + a NEW site, flagged `existing-handle` so
//             review demands ownership proof before it can go live
//
// Ownership proof (operator, 2026-10-16): a backlink from the new site to
// the handle's X / Nostr profile, or a nostr.json on the site's domain
// naming the handle's pubkey; a DM from the account is the fallback the
// reviewer records by hand.

import {
  normalizeWebsite,
  vendorSlug,
  vendorWebsite,
  vendorsByHandle,
  type Vendor,
  type VendorPlatform,
} from "@/lib/vendors";
import { decodeNostrBech32ToPubkey } from "@/lib/nostr-activity";

export type ListingCandidate = {
  handle: string;
  platform?: VendorPlatform;
  name: string;
  website?: string;
};

export type ListingConflicts = {
  /** An existing listing already carries this storefront. */
  siteTaken: Vendor | null;
  /** An existing listing already owns this /v slug. */
  slugTaken: Vendor | null;
  /** Live listings under the same identity (siblings-to-be). */
  sameHandle: Vendor[];
};

function platformOf(p: VendorPlatform | undefined): VendorPlatform {
  return p ?? "x";
}

export function findListingConflicts(
  c: ListingCandidate,
  vendors: readonly Vendor[],
): ListingConflicts {
  const site = c.website ? normalizeWebsite(c.website) : null;
  const slug = c.name ? vendorSlug({ name: c.name }) : null;
  let siteTaken: Vendor | null = null;
  let slugTaken: Vendor | null = null;
  for (const v of vendors) {
    const w = vendorWebsite(v);
    if (!siteTaken && site && w && normalizeWebsite(w) === site) siteTaken = v;
    if (!slugTaken && slug && vendorSlug(v) === slug) slugTaken = v;
  }
  const sameHandle = c.handle
    ? vendorsByHandle(c.handle, platformOf(c.platform), vendors)
    : [];
  return { siteTaken, slugTaken, sameHandle };
}

/** Human-readable reasons for a rejecting conflict (empty = none). */
export function conflictErrors(
  c: ListingCandidate,
  k: ListingConflicts,
): string[] {
  const out: string[] = [];
  if (k.siteTaken) {
    const sameOwner =
      k.siteTaken.handle.toLowerCase() === c.handle.toLowerCase();
    out.push(
      sameOwner
        ? `this website is already listed under "${k.siteTaken.handle}" as "${k.siteTaken.name}"`
        : `this website is already listed in the directory as "${k.siteTaken.name}" · each storefront is listed once`,
    );
  }
  if (k.slugTaken) {
    out.push(
      `name slugifies to "${vendorSlug({ name: c.name })}" which collides with existing vendor "${k.slugTaken.handle}" (${k.slugTaken.name}) · pick a more distinctive name`,
    );
  }
  return out;
}

/** The pending-queue twin: another submission already claims the same
 *  storefront or the same /v slug. */
export function findPendingConflict(
  c: ListingCandidate,
  pending: readonly { vendor: { name?: string; website?: string } }[],
): "site" | "slug" | null {
  const site = c.website ? normalizeWebsite(c.website) : null;
  const slug = c.name ? vendorSlug({ name: c.name }) : null;
  for (const p of pending) {
    if (site && p.vendor.website && normalizeWebsite(p.vendor.website) === site) return "site";
  }
  for (const p of pending) {
    if (slug && p.vendor.name && vendorSlug({ name: p.vendor.name }) === slug) return "slug";
  }
  return null;
}

// ── Ownership evidence ────────────────────────────────────────────────

export type OwnershipMethod = "backlink" | "nostr-json" | "dm";

export type OwnershipCheck = {
  /** Unix seconds the evidence was gathered (or the DM recorded). */
  checkedAt: number;
  ok: boolean;
  method?: OwnershipMethod;
  /** Short, reviewer-facing description of what was (not) found. */
  detail: string;
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does this page link back to the identity? HTML is attacker-controlled
 * text; we only pattern-match it, never render it.
 *   X         · x.com/<handle> or twitter.com/<handle> (case-insensitive,
 *               handle must end at a non-handle char)
 *   Nostr     · any npub1/nprofile1 on the page that decodes to the
 *               pubkey, the 64-hex pubkey itself, or the NIP-05 string
 *   Lightning · the Lightning Address itself
 */
export function pageLinksToIdentity(
  html: string,
  id: { handle: string; platform?: VendorPlatform; pubkeyHex?: string | null },
): boolean {
  const platform = platformOf(id.platform);
  const h = id.handle.trim().replace(/^@/, "");
  if (!h || !html) return false;
  if (platform === "x") {
    const re = new RegExp(
      `(?:^|[^a-z0-9_])(?:www\\.|mobile\\.)?(?:x|twitter)\\.com/(?:#!/)?@?${escapeRe(h)}(?![a-z0-9_])`,
      "i",
    );
    return re.test(html);
  }
  if (platform === "lightning") {
    return new RegExp(`(?:^|[^a-z0-9._%+-])${escapeRe(h)}(?![a-z0-9.-]*[a-z0-9])`, "i").test(html);
  }
  // nostr
  if (h.includes("@") && html.toLowerCase().includes(h.toLowerCase())) return true;
  const pk = id.pubkeyHex?.toLowerCase();
  if (!pk) return false;
  if (new RegExp(`(?:^|[^0-9a-f])${pk}(?![0-9a-f])`, "i").test(html)) return true;
  const tokens = html.match(/\b(?:npub1|nprofile1)[02-9ac-hj-np-z]{20,}/gi) ?? [];
  for (const t of tokens.slice(0, 50)) {
    if (decodeNostrBech32ToPubkey(t.toLowerCase()) === pk) return true;
  }
  return false;
}

/** Does a site's /.well-known/nostr.json name this pubkey? */
export function nostrJsonNamesPubkey(json: unknown, pubkeyHex: string | null | undefined): boolean {
  if (!pubkeyHex || !json || typeof json !== "object") return false;
  const names = (json as { names?: unknown }).names;
  if (!names || typeof names !== "object") return false;
  const pk = pubkeyHex.toLowerCase();
  return Object.values(names as Record<string, unknown>).some(
    (v) => typeof v === "string" && v.toLowerCase() === pk,
  );
}

/**
 * Approval gate for a listing whose identity already owns a live
 * listing. Returns null when approval may proceed, else the reason it
 * may not. `dmConfirmed` is the reviewer's recorded DM fallback.
 */
export function ownershipGate(opts: {
  sameHandle: readonly Vendor[];
  check?: OwnershipCheck | null;
  dmConfirmed?: boolean;
}): string | null {
  if (opts.sameHandle.length === 0) return null;
  if (opts.check?.ok) return null;
  if (opts.dmConfirmed) return null;
  return `@handle already owns ${opts.sameHandle.length} listing(s) (${opts.sameHandle
    .map((v) => v.name)
    .join(", ")}); needs ownership proof · a backlink or nostr.json on the new site, or a DM from the account`;
}
