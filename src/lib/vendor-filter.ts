// Single source of truth for the homepage vendor directory's filtering
// AND its facet counts (category pills, country pills, world-map dots).
//
// WHY THIS MODULE EXISTS
// ----------------------
// The count shown on a facet and the grid you get when you click it MUST
// come from the same predicate. They used to be computed separately:
//
//   • the grid applied category + country + shipsIntl + search TOGETHER
//   • each facet count was a naive single-dimension tally, e.g.
//     `VENDORS.filter(v => v.country === cc).length` — blind to every
//     other active filter.
//
// Result (the bug this fixes): with a sticky `category` filter active
// (filters persist in localStorage), the El Salvador pill could read
// "1" while clicking it produced an EMPTY grid — the lone SV vendor is
// `collectibles`, so it vanished the instant the active category was
// anything else. "It says there are results but none appear."
//
// THE FACETED-COUNT RULE
// ----------------------
// Each facet group's counts reflect EVERY OTHER active filter but NOT
// the group's own dimension. So the country counts answer: "if I pick
// this country, keeping my category/search/shipsIntl, how many results?"
// — which is exactly what a click yields. A facet whose count is 0 under
// the current other-filters is therefore never a lie; the UI disables it
// so a misleading click is impossible.
//
// Keep ALL directory filtering logic here. The page component should
// never re-implement a `.filter()` predicate inline — that's how the two
// paths drifted in the first place. scripts/test-vendor-filter.ts pins
// the grid-vs-facet equivalence as a hard invariant.

import {
  CATEGORY_LABELS,
  COUNTRIES,
  type Vendor,
  type VendorCategory,
  vendorKey,
} from "./vendors";

export type SortMode = "newest" | "az";

export type DirectoryFilters = {
  search: string;
  /** Multi-select (2026-07-02) · empty array = all categories. */
  categories: VendorCategory[];
  country: "all" | string;
  shipsIntl: boolean;
  /** Favorites (2026-07-02) · when true, only vendors in `saved`.
   *  Personal state: never URL-synced, never persisted in prefs ·
   *  another visitor's link must not silently filter by MY hearts. */
  savedOnly: boolean;
  /** Listing keys (vendorKey · slug), not handles. */
  saved: ReadonlySet<string>;
};

export type FilterDimension =
  | "category"
  | "country"
  | "shipsIntl"
  | "search"
  | "saved";

// ── Fuzzy search (2026-07-02 · zero-dep, replaces plain substring) ──
//
// Design goals, in order: (1) never lose a match the old substring
// search found; (2) tolerate the typos people actually make in a
// 12-char search box (dropped letter, swapped pair); (3) rank sanely ·
// a name hit beats a description hit, a prefix beats a mid-word hit;
// (4) multi-token queries AND together across fields so "coffee
// canada" works; (5) stay inside this tested module so the facet
// parity invariant covers it automatically. ~60 lines beats a Fuse.js
// dependency at this corpus size (119 vendors · scoring is O(n) per
// keystroke and unmeasurable).
//
// Per-field capability is deliberate: fuzzy (subsequence + bigram)
// matching runs only on the SHORT identity fields (name, handle,
// category, country) where a typo is recoverable signal. Long
// descriptions get exact/prefix/substring only · fuzzy over prose is
// how you get "qqq matches everything" noise.

/** Include threshold · a token must clear this on some field. */
export const SEARCH_THRESHOLD = 0.3;

/** Lowercase + strip diacritics so "café" matches "cafe". */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Greedy in-order subsequence · returns density (chars/span) or 0. */
function subsequenceDensity(token: string, word: string): number {
  let wi = 0;
  let start = -1;
  for (let ti = 0; ti < token.length; ti++) {
    wi = word.indexOf(token[ti], wi);
    if (wi === -1) return 0;
    if (start === -1) start = wi;
    wi += 1;
  }
  return token.length / (wi - start);
}

/** Dice coefficient over character bigrams · transposition tolerance. */
function bigramDice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      shared++;
      grams.set(g, n - 1);
    }
  }
  return (2 * shared) / (a.length + b.length - 2);
}

/** Score one query token against one field string, 0..1. */
function tokenFieldScore(token: string, field: string, fuzzy: boolean): number {
  if (!field) return 0;
  if (field === token) return 1;
  if (field.startsWith(token)) return 0.9;
  const words = field.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(token))) return 0.8;
  if (field.includes(token)) return 0.65;
  // Fuzzy guards (review 2026-07-02 · real false positives shipped
  // without these: "hat" subsequence-matched "heating" ABOVE literal
  // hat sellers, and "candle"/"meat" bigram-matched the filler words
  // "and"/"great", each producing a confidently-wrong sole result).
  // Rules: 3-char tokens are too noisy to fuzz at all; typos almost
  // never hit the first letter, so the word must agree on it; dice
  // only against words of comparable length.
  if (!fuzzy || token.length < 4) return 0;
  let best = 0;
  for (const w of words) {
    if (w[0] !== token[0]) continue;
    const d = subsequenceDensity(token, w);
    if (d >= 0.5) best = Math.max(best, 0.6 * d);
    if (w.length >= token.length - 1) {
      const dice = bigramDice(token, w);
      if (dice >= 0.5) best = Math.max(best, 0.55 * dice);
    }
  }
  return best;
}

// Field weights · identity fields dominate prose. Country label is
// searchable ("germany") even though the flag pill also covers it.
const FIELDS: {
  weight: number;
  fuzzy: boolean;
  get: (v: Vendor) => string;
}[] = [
  { weight: 1.0, fuzzy: true, get: (v) => norm(v.name) },
  { weight: 0.92, fuzzy: true, get: (v) => norm(v.handle) },
  { weight: 0.85, fuzzy: true, get: (v) => norm(CATEGORY_LABELS[v.category]) },
  {
    weight: 0.8,
    fuzzy: true,
    get: (v) => (v.country ? norm(COUNTRIES[v.country]?.label ?? "") : ""),
  },
  { weight: 0.55, fuzzy: false, get: (v) => norm(v.description) },
];

/**
 * Relevance score for a vendor against a raw query, 0..1.
 * Multi-token queries AND: the weakest token bounds the score, so
 * every word the user typed has to land somewhere.
 */
export function searchScore(v: Vendor, rawQuery: string): number {
  const tokens = norm(rawQuery)
    .split(/\s+/)
    .map((t) => t.replace(/^@+/, ""))
    .filter(Boolean);
  if (tokens.length === 0) return 1;
  let weakest = 1;
  for (const t of tokens) {
    let best = 0;
    for (const f of FIELDS) {
      const s = tokenFieldScore(t, f.get(v), f.fuzzy);
      if (s * f.weight > best) best = s * f.weight;
      if (best >= f.weight) break; // can't beat a full hit on this field
    }
    if (best < weakest) weakest = best;
    if (weakest === 0) return 0;
  }
  return weakest;
}

/** The free-text search predicate · thin boolean view over searchScore. */
function matchesSearch(v: Vendor, rawQuery: string): boolean {
  return searchScore(v, rawQuery) >= SEARCH_THRESHOLD;
}

/**
 * The ONE predicate. Every surface (grid + all facet counts) routes
 * through this so they can never diverge.
 *
 * `ignore` drops one or more dimensions, which is what lets a facet
 * counter answer "results if I pick this value, keeping my other
 * filters" — the counter for the country group passes `{ country: true }`
 * so its tally honors category/search/shipsIntl but not country.
 */
export function matchesVendor(
  v: Vendor,
  f: DirectoryFilters,
  ignore?: Partial<Record<FilterDimension, boolean>>,
): boolean {
  // Multi-select categories · empty selection = no category narrowing.
  if (
    !ignore?.category &&
    f.categories.length > 0 &&
    !f.categories.includes(v.category)
  ) {
    return false;
  }
  if (!ignore?.country && f.country !== "all" && v.country !== f.country) {
    return false;
  }
  // shipsIntl only narrows when toggled on, and requires an EXPLICIT
  // `shipsInternational === true`. Absence of the field means "unknown",
  // which is not a yes — those vendors are excluded when the toggle is on.
  if (!ignore?.shipsIntl && f.shipsIntl && v.shipsInternational !== true) {
    return false;
  }
  // Favorites · narrows only when toggled on. The saved set lives in
  // localStorage on the caller's side; an empty set with savedOnly on
  // legitimately yields zero rows (the empty state explains itself).
  if (!ignore?.saved && f.savedOnly && !f.saved.has(vendorKey(v))) {
    return false;
  }
  if (!ignore?.search && !matchesSearch(v, f.search)) {
    return false;
  }
  return true;
}

/** The grid list · all dimensions applied, then sorted.
 *
 * When a query is live the grid is RELEVANCE-ranked: scored once per
 * vendor, gated on the same SEARCH_THRESHOLD the boolean predicate
 * uses (facet parity depends on grid and counts sharing one gate),
 * with the user's chosen sort as the tiebreak. With no query, the
 * chosen sort applies directly, exactly as before. */
export function filterAndSortVendors(
  vendors: readonly Vendor[],
  f: DirectoryFilters,
  sort: SortMode,
): Vendor[] {
  // "Newest" sorts on listedAt, the real date the card shows a reader,
  // NOT the addedAt ordinal. Those agreed closely enough to look the
  // same until the roster grew: 94.8% of cards render the same
  // verifiedAt, so an order driven by an invisible integer read as
  // arbitrary to anyone looking at the grid (operator, 2026-08-27).
  // listedAt ties (a batch listed on one day), so addedAt descending
  // stays the secondary key · without it, ties fall back to array
  // order and the grid reshuffles for no visible reason.
  //
  // Deliberately scoped to the directory grid. The feed, /api/vendors.json,
  // the MCP tool, VendorPager and the recently-added strips all still
  // order by addedAt, which is the stable ordinal they need.
  const tiebreak = (a: Vendor, b: Vendor) =>
    sort === "az"
      ? a.name.localeCompare(b.name)
      : b.listedAt - a.listedAt || b.addedAt - a.addedAt;

  const q = f.search.trim();
  if (q) {
    const scored: { v: Vendor; s: number }[] = [];
    for (const v of vendors) {
      if (!matchesVendor(v, f, { search: true })) continue;
      const s = searchScore(v, q);
      if (s >= SEARCH_THRESHOLD) scored.push({ v, s });
    }
    scored.sort((a, b) => (b.s !== a.s ? b.s - a.s : tiebreak(a.v, b.v)));
    return scored.map((x) => x.v);
  }

  const list = vendors.filter((v) => matchesVendor(v, f));
  list.sort(tiebreak);
  return list;
}

/** Count of vendors matching the filters, optionally ignoring some dimensions. */
export function countMatching(
  vendors: readonly Vendor[],
  f: DirectoryFilters,
  ignore?: Partial<Record<FilterDimension, boolean>>,
): number {
  let n = 0;
  for (const v of vendors) if (matchesVendor(v, f, ignore)) n++;
  return n;
}

/**
 * Country code → count, applying every active filter EXCEPT country.
 * Feeds the country pills and the world-map dots. A country absent from
 * the result has no vendors under the current other-filters, so the UI
 * must not let the user click into it. Vendors without a `country` are
 * not bucketed (they only ever show under "All countries").
 */
export function countByCountry(
  vendors: readonly Vendor[],
  f: DirectoryFilters,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of vendors) {
    if (!v.country) continue;
    if (!matchesVendor(v, f, { country: true })) continue;
    counts[v.country] = (counts[v.country] ?? 0) + 1;
  }
  return counts;
}

/**
 * Category → count, applying every active filter EXCEPT category. Feeds
 * the category pills. `all` is the total under the other filters (what
 * the "All" category pill reads, and the count you'd get by clearing the
 * category facet).
 */
export function countByCategory(
  vendors: readonly Vendor[],
  f: DirectoryFilters,
): Record<"all" | VendorCategory, number> {
  const counts = { all: 0 } as Record<"all" | VendorCategory, number>;
  for (const v of vendors) {
    if (!matchesVendor(v, f, { category: true })) continue;
    counts.all += 1;
    counts[v.category] = (counts[v.category] ?? 0) + 1;
  }
  return counts;
}

// ── Directory URL (?country=de etc.) ────────────────────────────────
//
// HomeClient used to read the query string in a mount effect, so the
// server HTML for /?country=de was the FULL 120-card grid. Ahrefs then
// flagged that URL as a slow page (40 KB gzip HTML, ~1.1s TTFB) while
// a visitor saw a flash of every shop before Germany snapped in.
// parseDirectoryUrl is the single decoder for the server shell and the
// client hydration effect, so those two cannot drift.

export type DirectoryUrlState = {
  categories: VendorCategory[];
  country: "all" | string;
  sort: SortMode;
  shipsIntl: boolean;
  search: string;
  /** Which keys were actually in the query. Absent keys stay with
   *  localStorage prefs on the client; the server treats them as
   *  defaults so `/` is still the full directory. */
  present: {
    category: boolean;
    country: boolean;
    sort: boolean;
    intl: boolean;
    q: boolean;
  };
};

const URL_CATEGORIES = new Set<string>(Object.keys(CATEGORY_LABELS));
const URL_SORTS = new Set<SortMode>(["newest", "az"]);

function urlParam(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  if (input instanceof URLSearchParams) {
    return input.get(key) ?? undefined;
  }
  const v = input[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

export function directoryUrlHasFilter(u: DirectoryUrlState): boolean {
  return u.present.category || u.present.country || u.present.sort || u.present.intl;
}

export function parseDirectoryUrl(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
): DirectoryUrlState {
  const urlCategoryParam = urlParam(input, "category");
  const urlCats = (urlCategoryParam ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c): c is VendorCategory => c !== "all" && URL_CATEGORIES.has(c));

  const urlCountry = urlParam(input, "country")?.toUpperCase();
  const countryOk =
    urlCountry != null && (urlCountry === "ALL" || COUNTRIES[urlCountry] != null);
  const urlSort = urlParam(input, "sort");
  const sortOk = urlSort != null && URL_SORTS.has(urlSort as SortMode);
  const urlIntl = urlParam(input, "intl");
  const urlQ = urlParam(input, "q");

  return {
    categories:
      urlCategoryParam === "all" || urlCats.length > 0 ? urlCats : [],
    country: countryOk ? (urlCountry === "ALL" ? "all" : urlCountry!) : "all",
    sort: sortOk ? (urlSort as SortMode) : "newest",
    shipsIntl: urlIntl === "1",
    search: urlQ ? urlQ.slice(0, 100) : "",
    present: {
      category:
        urlCategoryParam != null &&
        (urlCategoryParam === "all" || urlCats.length > 0),
      country: countryOk,
      sort: sortOk,
      intl: urlIntl === "1",
      q: urlQ != null && urlQ.length > 0,
    },
  };
}
