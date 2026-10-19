// Local shop-shelf imagery for directory cards.
//
// Written by scripts/snapshot-vendor-shelves.ts. Two first-class
// kinds, both committed under public/vendor-shelves/:
//   og   — the shop's own og:image / twitter:image
//   shot — a full-page screenshot of the storefront, used only when
//          no usable social card exists
//
// Missing entries are a valid state: VendorCard falls back to the
// millboard shop-sign plate. Never hotlink a third-party CDN from
// the visitor's browser (same quota lesson as avatars).

import type { Vendor } from "@/lib/vendors";
import { vendorKey } from "@/lib/vendors";
import MANIFEST from "./shelf-manifest.json";

export type ShelfKind = "og" | "shot";
/** `w`/`h` are the committed file's real pixel size. They exist so the card
 *  can tell whether an image FITS the 4:3 shelf or has to be letterboxed:
 *  34% of these are og:image cards at 1.905 (and one at 2.515), and
 *  `object-fit: cover` was taking up to 47% off their width — straight
 *  through the middle of the shop's own name. Written by
 *  scripts/snapshot-vendor-shelves.ts; optional so a hand-added entry
 *  without them still renders (it just always gets the bed). */
export type ShelfEntry = {
  src: string;
  kind: ShelfKind;
  w?: number;
  h?: number;
};

/** The shelf is 4:3. Anything outside this band is letterboxed onto a
 *  blurred bed of itself rather than cropped. The band is deliberately
 *  narrow: a few percent of crop is invisible, 15% eats a word. */
export function shelfFits(entry: ShelfEntry): boolean {
  if (!entry.w || !entry.h) return false;
  const r = entry.w / entry.h;
  return r >= 1.27 && r <= 1.4;
}

const MANIFEST_MAP = MANIFEST as Record<string, ShelfEntry>;

/** Keyed by LISTING (vendorKey · slug) since 2026-10, not handle: a
 *  shelf is a picture of one storefront, and one handle may run several.
 *  check-vendors fails any manifest key that is not a live slug. */
export function vendorShelf(vendor: Vendor): ShelfEntry | null {
  return MANIFEST_MAP[vendorKey(vendor)] ?? null;
}
