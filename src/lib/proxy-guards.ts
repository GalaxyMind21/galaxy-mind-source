// Small pure helpers for src/proxy.ts (kept out of the proxy file so it only exports proxy + config).

/**
 * Malformed percent-encoding (/v/%ff, /api/badge/vendor/%ff%fe) used to throw inside dynamic routes and answer 500.
 * The proxy refuses it up front with a plain 400 (security audit 2026-10-18, L1). No stack, no echo of the input.
 */
export function malformedPath(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return false;
  } catch {
    return true;
  }
}

/**
 * upgrade-insecure-requests on every CSP the proxy sends (security audit 2026-10-18, L9). Production only: on
 * plain-HTTP local dev it would upgrade same-origin subresources to https://localhost and break the page.
 */
export const UPGRADE_INSECURE: readonly string[] =
  process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : [];
