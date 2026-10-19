/* =====================================================================
 * First-party EN/ES for ONE page: /spend-bitcoin-in-latin-america.
 * The rest of the site is English. A sitewide /es rewrite + gm_locale
 * cookie used to stamp lang="es" on English tools and suppress the
 * browser translate prompt. Do not bring that back.
 * ===================================================================== */

export type Locale = "en" | "es";

export const LOCALES: readonly Locale[] = ["en", "es"] as const;
export const DEFAULT_LOCALE: Locale = "en";
/** Retired 2026-09-05. Proxy expires it when present so old clients drop it. */
export const LOCALE_COOKIE = "gm_locale";
export const LOCALE_HEADER = "x-gm-locale";
/** "1" when the request URL is the Spanish LATAM page. */
export const LOCALE_PREFIX_HEADER = "x-gm-locale-prefix";

export const LATAM_PATH = "/spend-bitcoin-in-latin-america";
export const LATAM_ES_PATH = "/es/spend-bitcoin-in-latin-america";

/**
 * Guessed empty-roster URLs that still 308 to the Spanish LATAM page.
 * Keep in lockstep with the `/es${source}` redirects in next.config.ts
 * (test-latam.ts asserts both lists).
 */
export const ES_LATAM_ALIAS_PATHS = [
  "/es/spend-bitcoin-in/argentina",
  "/es/spend-bitcoin-in/ar",
  "/es/spend-bitcoin-in/peru",
  "/es/spend-bitcoin-in/pe",
  "/es/vendors/peru",
  "/es/spend-bitcoin-in/latin-america",
  "/es/spend-bitcoin-in/latinoamerica",
] as const;

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "es";
}

export function hasLocalePrefix(pathname: string): boolean {
  return pathname === "/es" || pathname.startsWith("/es/");
}

export function stripLocalePrefix(pathname: string): string {
  if (pathname === "/es") return "/";
  if (pathname.startsWith("/es/")) {
    const rest = pathname.slice(3);
    return rest.length ? rest : "/";
  }
  return pathname;
}

export function withLocalePrefix(pathname: string, locale: Locale): string {
  const path = stripLocalePrefix(pathname);
  if (locale !== "es") return path || "/";
  if (!path || path === "/") return "/es";
  return `/es${path}`;
}

/** The only URL that is allowed to render as Spanish. */
export function isSpanishLatamPath(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  return path === LATAM_ES_PATH;
}

export function isSpanishLatamAlias(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  return (ES_LATAM_ALIAS_PATHS as readonly string[]).includes(path);
}

export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key]),
  );
}
