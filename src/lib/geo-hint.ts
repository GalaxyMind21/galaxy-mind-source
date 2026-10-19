// "Shopping from {country}?" hint on the homepage directory (2026-10-13).
//
// WHY: bitcoin.org's spend page is the directory's biggest referrer
// (208 visitors in the 14 days to Oct 13, 2026), and only ~20% of them
// are in the US. The roster is ~70% US-based, so a visitor from India,
// the UK or the Philippines lands on a grid of mostly US shops. The two
// filters that answer "can I actually buy from here?" (Ships int'l and
// their own country) sit at the far end of the mobile filter rail,
// off-screen, and Ships int'l was used by 8 visitors in 30 days.
//
// The edge already knows the visitor's country (Vercel's
// x-vercel-ip-country request header). The server reads it per request
// (the homepage is already dynamic and private, no-store, because of
// the CSP nonce), and this module decides whether a one-line hint is
// worth showing. Nothing is stored or logged.
//
// Counts go through countMatching, the same predicate as the grid, so
// the number on a hint pill is exactly what a tap yields.

import { COUNTRIES, type Vendor } from "./vendors";
import { countMatching, type DirectoryFilters } from "./vendor-filter";

/** Only a two-letter ISO code is trusted from the edge header. */
export function parseVisitorCountry(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const cc = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

/**
 * English display name for a visitor country, or null when there is no
 * real name (XX, ZZ, unknown codes). A hint that reads "Shopping from
 * XX?" is worse than no hint.
 */
export function visitorCountryLabel(cc: string | null): string | null {
  if (!cc) return null;
  const known = COUNTRIES[cc]?.label;
  if (known) return known;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(cc);
    if (!name || name === cc || /unknown/i.test(name)) return null;
    return name;
  } catch {
    return null;
  }
}

export type GeoShipHint = {
  cc: string;
  label: string;
  /** Shops that ship worldwide under the visitor's other filters. */
  worldwide: number;
  /** Shops based in the visitor's country under their other filters. */
  local: number;
};

/**
 * The hint, or null when it should not render: US visitors (the roster
 * already fits them), unknown countries, or a visitor who has already
 * picked a country, Ships int'l, or Saved.
 */
export function geoShipHint(
  cc: string | null,
  label: string | null,
  vendors: readonly Vendor[],
  f: DirectoryFilters,
): GeoShipHint | null {
  if (!cc || !label || cc === "US") return null;
  if (f.country !== "all" || f.shipsIntl || f.savedOnly) return null;
  const worldwide = countMatching(vendors, { ...f, shipsIntl: true });
  const local = countMatching(vendors, { ...f, country: cc });
  if (worldwide === 0 && local === 0) return null;
  return { cc, label, worldwide, local };
}
