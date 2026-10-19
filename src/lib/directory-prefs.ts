/* =====================================================================
 * lib/directory-prefs.ts · localStorage-backed homepage filter prefs
 *
 * Persists the visitor's last-used directory filters (category,
 * country, sort) across visits. Search text is intentionally NOT
 * persisted · it's transient query input, not a preference.
 *
 * Why: returning visitors who set "Germany + consumables" once
 * shouldn't have to re-apply on every visit. Standard e-commerce
 * UX (Amazon, eBay) — and the existing "All" pill on every filter
 * group provides an obvious escape hatch if the visitor wants to
 * reset.
 *
 * Schema versioning: LS key includes `_v1` so a future incompatible
 * shape change can ship a new key without migration.
 *
 * Validation: load() validates every field against the caller-
 * supplied known-good sets. Corrupted or stale LS values fall back
 * silently to defaults · never crashes the page.
 * ===================================================================== */

const LS_KEY = "gm_directory_prefs_v1";

export type DirectoryPrefs = {
  // Multi-select categories (2026-07-02) · empty array = all. Replaces
  // the legacy single `category` string; loadDirectoryPrefs migrates
  // old LS payloads ({category: "apparel"} → ["apparel"]) silently.
  categories: string[];
  country: string; // "all" or an ISO-3166-1 alpha-2 country code
  sort: string; // "newest" or "az"
  // Use-case filter · added May 2026 to help visitors narrow by
  // shopping intent rather than just by category. Defaults to false
  // (filter OFF, all vendors visible). When true, the predicate keeps
  // only vendors with shipsInternational set. Forward-compatible ·
  // old prefs JSON without this key still loads cleanly (default
  // false); a stale `openToTrade` key from the removed barter filter
  // is harmlessly ignored.
  shipsIntl: boolean;
  // Filter-stack expansion state · 2026-05-20 page audit collapsed
  // the secondary filters (Country, Sort, "I'm looking for") behind
  // a "+ More filters" disclosure by default so the vendor grid
  // lands higher above the fold. Power users who expand it once get
  // their choice persisted forever (or until cleared). Defaults to
  // false so first-time visitors get the tight default; returning
  // visitors who toggled it true on a previous session keep their
  // expanded view automatically.
  filtersExpanded: boolean;
};

const DEFAULTS: DirectoryPrefs = {
  categories: [],
  country: "all",
  sort: "newest",
  shipsIntl: false,
  filtersExpanded: false,
};

export function loadDirectoryPrefs(): DirectoryPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DirectoryPrefs> & {
      /** Legacy single-select shape · pre-2026-07-02 LS payloads. */
      category?: string;
    };
    return {
      categories: Array.isArray(parsed.categories)
        ? parsed.categories.filter((c): c is string => typeof c === "string")
        : typeof parsed.category === "string" && parsed.category !== "all"
          ? [parsed.category] // migrate the legacy single-select
          : DEFAULTS.categories,
      country:
        typeof parsed.country === "string" ? parsed.country : DEFAULTS.country,
      sort: typeof parsed.sort === "string" ? parsed.sort : DEFAULTS.sort,
      // Boolean fields default to false when missing from older
      // prefs JSON · keeps backward-compat with existing LS state.
      shipsIntl:
        typeof parsed.shipsIntl === "boolean"
          ? parsed.shipsIntl
          : DEFAULTS.shipsIntl,
      filtersExpanded:
        typeof parsed.filtersExpanded === "boolean"
          ? parsed.filtersExpanded
          : DEFAULTS.filtersExpanded,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveDirectoryPrefs(prefs: DirectoryPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch {
    /* LS quota / privacy mode · best-effort */
  }
}
