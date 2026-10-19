/**
 * Rental Terms the renter must accept in create_rental. Bump the version when the page changes.
 * 2026-10-17 (B5c, the operator approved the exact text 2026-10-17): 1 to 7 days during the pilot, no pool
 * password field, no unreleased payment rail. Orders accepted under "2026-10-16-draft" keep that
 * version on their row (orders.terms_version) and stay valid for those orders.
 */
export const RENTAL_TERMS_VERSION = "2026-10-17";
export const PREVIOUS_RENTAL_TERMS_VERSIONS: readonly string[] = ["2026-10-16-draft"];
export const RENTAL_TERMS_PATH = "/terms/rental";
export const RENTAL_TERMS_URL = "https://galaxymind.space" + RENTAL_TERMS_PATH;
