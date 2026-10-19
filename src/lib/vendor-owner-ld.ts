// schema.org owner node for multi-shop identities (2026-10).
//
// A LocalBusiness `sameAs` asserts "these URLs are THIS entity". That is
// right for a single-shop handle (the X profile IS the shop's account),
// and wrong once one handle runs several shops: every sibling page would
// claim the same profile, i.e. that two businesses are one entity.
//
// So when a listing has siblings, the profile moves into a shared
// `parentOrganization` whose @id is identical on every sibling page
// (search / AI agents merge on @id), and each LocalBusiness keeps only
// its own storefront in `sameAs`. Single-shop pages are untouched.

import {
  getDisplayHandle,
  getPlatform,
  getProfileUrl,
  type Vendor,
} from "@/lib/vendors";

export function ownerOrganizationId(
  v: Pick<Vendor, "handle" | "platform">,
  siteUrl: string,
): string {
  return `${siteUrl}/#id-${getPlatform(v)}-${encodeURIComponent(v.handle.toLowerCase())}`;
}

export function ownerOrganizationLd(
  v: Pick<Vendor, "handle" | "platform" | "name">,
  siteUrl: string,
): Record<string, unknown> {
  const profile = getProfileUrl(v);
  return {
    "@type": "Organization",
    "@id": ownerOrganizationId(v, siteUrl),
    // The identity, not any one shop: @handle / NIP-05 / LN address.
    name: getPlatform(v) === "nostr" && /^(npub1|nprofile1)/.test(v.handle)
      ? v.handle.slice(0, 16) + "…"
      : getDisplayHandle(v),
    ...(profile ? { url: profile, sameAs: [profile] } : {}),
  };
}
