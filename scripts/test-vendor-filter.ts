// Regression guard for the homepage vendor directory's filtering.
//
// The bug this pins: facet counts (category pills, country pills, world-
// map dots) used to be computed from a different predicate than the grid
// — each count tallied a single dimension and ignored every other active
// filter. So a country pill could read "El Salvador · 1" while clicking
// it (which ALSO applies the active category) showed an empty grid.
//
// THE INVARIANT (what makes the bug impossible going forward):
//   For any combination of OTHER active filters, the count shown on a
//   facet value EQUALS the number of vendors the grid renders when you
//   select that value. Counts never over-promise.
//
// Run in the validator suite (see the README). Exits non-zero on drift.

import {
  CATEGORY_LABELS,
  HOUSE_HANDLE,
  VENDORS,
  vendorWebsite,
  type VendorCategory,
  vendorKey,
} from "../src/lib/vendors";
import {
  type DirectoryFilters,
  SEARCH_THRESHOLD,
  countByCategory,
  countByCountry,
  countMatching,
  directoryUrlHasFilter,
  filterAndSortVendors,
  parseDirectoryUrl,
  searchScore,
} from "../src/lib/vendor-filter";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`);
  }
}

const base: DirectoryFilters = {
  search: "",
  categories: [], // empty = all
  country: "all",
  shipsIntl: false,
  savedOnly: false,
  saved: new Set<string>(),
};

// Universe derived from the live data so new vendors/countries are
// covered automatically.
const CATEGORIES = Array.from(new Set(VENDORS.map((v) => v.category))).sort();
const COUNTRIES = Array.from(
  new Set(VENDORS.map((v) => v.country).filter((c): c is string => !!c)),
).sort();
const SORTS = ["newest", "az"] as const;

console.log(
  `Vendor-filter invariants · ${VENDORS.length} vendors, ${CATEGORIES.length} categories, ${COUNTRIES.length} countries\n`,
);

// ── 1 · Default view parity ──────────────────────────────────────────
// With no filters active, the sibling-aware counts must equal the naive
// single-dimension tallies (so the common, unfiltered map/pills are
// pixel-identical to before — the fix only changes behavior once a
// sibling filter is on).
{
  const byCountry = countByCountry(VENDORS, base);
  const naiveCountry: Record<string, number> = {};
  for (const v of VENDORS) if (v.country) naiveCountry[v.country] = (naiveCountry[v.country] ?? 0) + 1;
  check(
    "default country counts equal naive per-country tally",
    JSON.stringify(byCountry) === JSON.stringify(naiveCountry),
  );

  const byCat = countByCategory(VENDORS, base);
  let catOk = byCat.all === VENDORS.length;
  for (const c of CATEGORIES) {
    const naive = VENDORS.filter((v) => v.category === c).length;
    if ((byCat[c] ?? 0) !== naive) catOk = false;
  }
  check("default category counts equal naive per-category tally", catOk);
}

// ── 2 · The El Salvador reproduction ─────────────────────────────────
// Document the exact reported failure and prove it's resolved. SV has a
// single vendor and it is `collectibles`; with `apparel` active the
// naive count (the OLD code) still says 1, but the grid is empty. The
// new count must agree with the grid (0).
{
  const sv = VENDORS.filter((v) => v.country === "SV");
  check("exactly one El Salvador vendor exists (test premise)", sv.length === 1, `found ${sv.length}`);
  if (sv.length === 1) {
    const svCat = sv[0].category;
    const conflicting: VendorCategory = svCat === "apparel" ? "hardware" : "apparel";
    const f: DirectoryFilters = { ...base, categories: [conflicting] };
    const naive = VENDORS.filter((v) => v.country === "SV").length; // OLD buggy count
    const newCount = countByCountry(VENDORS, f)["SV"] ?? 0; // sibling-aware
    const grid = filterAndSortVendors(VENDORS, { ...f, country: "SV" }, "newest").length;
    check(
      "El Salvador: old naive count over-promised (regression context)",
      naive === 1 && grid === 0,
      `naive=${naive} grid=${grid}`,
    );
    check(
      "El Salvador: sibling-aware count matches the (empty) grid",
      newCount === grid && newCount === 0,
      `count=${newCount} grid=${grid}`,
    );
  }
}

// ── 3 · INVARIANT A · country facet count === grid on click ──────────
// Across every (category × shipsIntl) context, each country facet's
// count must equal the grid you'd get by selecting that country.
{
  let ok = true;
  let firstDetail = "";
  for (const cat of ["all", ...CATEGORIES] as ("all" | VendorCategory)[]) {
    for (const intl of [false, true]) {
      const ctx: DirectoryFilters = {
        ...base,
        categories: cat === "all" ? [] : [cat],
        shipsIntl: intl,
      };
      const counts = countByCountry(VENDORS, ctx);
      for (const cc of COUNTRIES) {
        const promised = counts[cc] ?? 0;
        const actual = filterAndSortVendors(VENDORS, { ...ctx, country: cc }, "newest").length;
        if (promised !== actual) {
          ok = false;
          if (!firstDetail) firstDetail = `category=${cat} intl=${intl} country=${cc}: count=${promised} grid=${actual}`;
        }
      }
      // "All countries" pill
      const allPromised = countMatching(VENDORS, ctx, { country: true });
      const allActual = filterAndSortVendors(VENDORS, { ...ctx, country: "all" }, "newest").length;
      if (allPromised !== allActual) {
        ok = false;
        if (!firstDetail) firstDetail = `category=${cat} intl=${intl} country=all: count=${allPromised} grid=${allActual}`;
      }
    }
  }
  check("country facet counts equal the grid for every category×intl context", ok, firstDetail);
}

// ── 4 · INVARIANT B · category facet count === grid on click ─────────
{
  let ok = true;
  let firstDetail = "";
  for (const country of ["all", ...COUNTRIES]) {
    for (const intl of [false, true]) {
      const ctx: DirectoryFilters = { ...base, country, shipsIntl: intl };
      const counts = countByCategory(VENDORS, ctx);
      for (const c of CATEGORIES) {
        const promised = counts[c] ?? 0;
        const actual = filterAndSortVendors(VENDORS, { ...ctx, categories: [c] }, "newest").length;
        if (promised !== actual) {
          ok = false;
          if (!firstDetail) firstDetail = `country=${country} intl=${intl} category=${c}: count=${promised} grid=${actual}`;
        }
      }
      const allPromised = counts.all;
      const allActual = filterAndSortVendors(VENDORS, { ...ctx, categories: [] }, "newest").length;
      if (allPromised !== allActual) {
        ok = false;
        if (!firstDetail) firstDetail = `country=${country} intl=${intl} category=all: count=${allPromised} grid=${allActual}`;
      }
    }
  }
  check("category facet counts equal the grid for every country×intl context", ok, firstDetail);
}

// ── 5 · INVARIANT with a search query layered in ─────────────────────
// Search is the third sibling; make sure facet counts honor it too.
{
  const probe = "bitcoin";
  let ok = true;
  let firstDetail = "";
  const ctx: DirectoryFilters = { ...base, search: probe };
  const byCountry = countByCountry(VENDORS, ctx);
  for (const cc of COUNTRIES) {
    const promised = byCountry[cc] ?? 0;
    const actual = filterAndSortVendors(VENDORS, { ...ctx, country: cc }, "newest").length;
    if (promised !== actual) {
      ok = false;
      if (!firstDetail) firstDetail = `search="${probe}" country=${cc}: count=${promised} grid=${actual}`;
    }
  }
  check(`country facet counts honor an active search ("${probe}")`, ok, firstDetail);
}

// ── 6 · The user-facing guarantee, stated directly ───────────────────
// "Every non-zero facet count, in every context, yields a non-empty
// grid." This is the property the user reported violated.
{
  let violations = 0;
  let firstDetail = "";
  for (const cat of ["all", ...CATEGORIES] as ("all" | VendorCategory)[]) {
    const ctx: DirectoryFilters = { ...base, categories: cat === "all" ? [] : [cat] };
    const counts = countByCountry(VENDORS, ctx);
    for (const cc of COUNTRIES) {
      const promised = counts[cc] ?? 0;
      if (promised > 0) {
        const grid = filterAndSortVendors(VENDORS, { ...ctx, country: cc }, "newest").length;
        if (grid === 0) {
          violations++;
          if (!firstDetail) firstDetail = `category=${cat} country=${cc}: promised ${promised} but grid empty`;
        }
      }
    }
  }
  check("no facet ever advertises results it cannot deliver", violations === 0, firstDetail);
}

// ── 7 · Sort never changes the membership, only the order ────────────
{
  const f: DirectoryFilters = { ...base };
  const setOf = (sort: (typeof SORTS)[number]) =>
    new Set(filterAndSortVendors(VENDORS, f, sort).map((v) => v.handle));
  const a = setOf("newest");
  const b = setOf("az");
  check(
    "sort mode does not change which vendors match (only order)",
    a.size === b.size && [...a].every((h) => b.has(h)),
  );
}

// ── 8 · Fuzzy search (2026-07-02 · zero-dep scorer) ──────────────────
// Pins the four behaviors the upgrade promises: typo tolerance on
// identity fields, multi-token AND across fields, relevance ranking
// (name hit beats description hit), and NO regression of the old
// substring matches. Uses real roster entries where the premise is
// checked first, so a vendor removal fails loudly instead of silently
// weakening the test.
{
  const q = (s: string) =>
    filterAndSortVendors(VENDORS, { ...base, search: s }, "newest");

  const gheezer = VENDORS.find((v) => v.handle === "Gheezer_us");
  check("fuzzy test premise: Gheezer_us exists in the roster", !!gheezer);
  if (gheezer) {
    check(
      "exact name scores a full 1.0",
      searchScore(gheezer, "gheezer") === 1,
    );
    check(
      "pasted @handle matches the stored handle",
      searchScore(gheezer, "@Gheezer_us") === searchScore(gheezer, "Gheezer_us"),
    );
    check(
      "typo (dropped letter): 'gheezr' still finds Gheezer",
      q("gheezr").some((v) => v.handle === "Gheezer_us"),
    );
    check(
      "old substring behavior preserved: 'peanut' (description) finds Gheezer",
      q("peanut").some((v) => v.handle === "Gheezer_us"),
    );
  }

  check(
    "transposition: 'admirla wildlife' finds Admiral Wildlife Services",
    q("admirla wildlife").some((v) => v.handle === "AdmiralWild"),
  );

  // Multi-token AND across DIFFERENT fields: name + country label.
  const coffeeCa = q("coffee canada");
  check(
    "multi-token AND: 'coffee canada' top hit is a Canadian coffee vendor",
    coffeeCa.length >= 1 &&
      coffeeCa[0].country === "CA" &&
      /coffee/i.test(coffeeCa[0].name),
  );

  // Relevance: a name match must outrank description-only matches.
  const coffee = q("coffee");
  check(
    "ranking: a name match ranks first for 'coffee'",
    coffee.length >= 1 && /coffee/i.test(coffee[0].name),
  );

  check("garbage query matches nothing", q("qqqxyzv").length === 0);

  // Review 2026-07-02 regressions · fuzzy false positives. Before the
  // first-letter + length guards: "hat" subsequence-matched "heating"
  // ABOVE literal hat sellers, and "candle"/"meat" bigram-matched the
  // filler words "and"/"great" as confidently-wrong sole results.
  const hat = q("hat");
  check(
    "fuzzy guard: every 'hat' result literally contains 'hat'",
    hat.length > 0 &&
      hat.every((v) =>
        `${v.name} ${v.handle} ${v.description}`.toLowerCase().includes("hat"),
      ),
  );
  for (const probe of ["candle", "meat"]) {
    check(
      `fuzzy guard: '${probe}' never matches via filler-word bigrams`,
      q(probe).every((v) =>
        `${v.name} ${v.handle} ${v.description} ${CATEGORY_LABELS[v.category]}`
          .toLowerCase()
          .includes(probe.slice(0, 3)),
      ),
    );
  }
  check(
    "threshold gate: scores below SEARCH_THRESHOLD are excluded from the grid",
    q("qqqxyzv").every((v) => searchScore(v, "qqqxyzv") >= SEARCH_THRESHOLD),
  );

  // The parity invariant with a live query (section 5) plus these
  // behavior pins means facet counts and the ranked grid stay in
  // lockstep even under fuzzy matching.
}

// ── 9 · Multi-select categories (2026-07-02) ─────────────────────────
{
  const [a, b] = CATEGORIES;
  const both = filterAndSortVendors(VENDORS, { ...base, categories: [a, b] }, "newest");
  const onlyA = filterAndSortVendors(VENDORS, { ...base, categories: [a] }, "newest");
  const onlyB = filterAndSortVendors(VENDORS, { ...base, categories: [b] }, "newest");
  check(
    "multi-select is the UNION of the single selections",
    both.length === onlyA.length + onlyB.length &&
      both.every((v) => v.category === a || v.category === b),
  );
  // Facet counts stay sibling-aware under a multi-select context: each
  // category count answers "results if this category were the pick,
  // keeping search/country/ships" · independent of current selection.
  const ctx: DirectoryFilters = { ...base, categories: [a, b] };
  const counts = countByCategory(VENDORS, ctx);
  let ok = true;
  for (const c of CATEGORIES) {
    const grid = filterAndSortVendors(VENDORS, { ...ctx, categories: [c] }, "newest").length;
    if ((counts[c] ?? 0) !== grid) ok = false;
  }
  check("category facet counts stay grid-accurate under multi-select", ok);
  check(
    "empty selection equals all categories",
    filterAndSortVendors(VENDORS, { ...base, categories: [] }, "newest").length === VENDORS.length,
  );
}

// ── 10 · Favorites dimension (2026-07-02) ────────────────────────────
{
  // Saved set holds LISTING KEYS (slugs) since 2026-10, not handles.
  const savedHandles = new Set([vendorKey(VENDORS[0]), vendorKey(VENDORS[5]), vendorKey(VENDORS[9])]);
  const f: DirectoryFilters = { ...base, savedOnly: true, saved: savedHandles };
  const grid = filterAndSortVendors(VENDORS, f, "newest");
  check(
    "savedOnly shows exactly the saved set",
    grid.length === 3 && grid.every((v) => savedHandles.has(vendorKey(v))),
  );
  check(
    "saved chip count (countMatching with savedOnly forced) equals the grid",
    countMatching(VENDORS, f) === grid.length,
  );
  // Intersection with another dimension
  const cat = VENDORS[0].category;
  const inter = filterAndSortVendors(VENDORS, { ...f, categories: [cat] }, "newest");
  check(
    "savedOnly intersects with category selection",
    inter.every((v) => savedHandles.has(vendorKey(v)) && v.category === cat),
  );
  check(
    "empty saved set with savedOnly on yields an empty grid (honest zero)",
    filterAndSortVendors(VENDORS, { ...base, savedOnly: true, saved: new Set() }, "newest").length === 0,
  );
  // Facet parity: country counts must honor the saved narrowing
  const byCountry = countByCountry(VENDORS, f);
  let parityOk = true;
  for (const [cc, n] of Object.entries(byCountry)) {
    const g = filterAndSortVendors(VENDORS, { ...f, country: cc }, "newest").length;
    if (n !== g) parityOk = false;
  }
  check("country facet counts stay grid-accurate under savedOnly", parityOk);
}

// vendorWebsite: website wins; shopUrl is the fallback. The house
// listing shipped shopUrl-only and every renderer missed it.
check(
  "vendorWebsite prefers website over shopUrl",
  vendorWebsite({
    website: "https://example.com/a",
    shopUrl: "https://example.com/b",
  }) === "https://example.com/a",
);
check(
  "vendorWebsite falls back to shopUrl",
  vendorWebsite({ shopUrl: "https://example.com/b" }) ===
    "https://example.com/b",
);
check("vendorWebsite empty when neither set", vendorWebsite({}) === undefined);

// ── Directory URL decoder (Ahrefs /?country=de slow-page) ────────────
{
  const de = parseDirectoryUrl({ country: "de" });
  check("country=de is present and uppercased", de.present.country && de.country === "DE");
  check("country=de is a URL filter", directoryUrlHasFilter(de));
  const deGrid = filterAndSortVendors(
    VENDORS,
    { ...base, country: de.country },
    "newest",
  );
  check(
    "country=de grid is Germany-only and much smaller than the full roster",
    deGrid.length > 0 &&
      deGrid.length < VENDORS.length / 4 &&
      deGrid.every((v) => v.country === "DE"),
  );

  const empty = parseDirectoryUrl({});
  check("bare URL has no filter keys present", !directoryUrlHasFilter(empty) && !empty.present.country);
  check("bare URL country defaults to all", empty.country === "all");

  const all = parseDirectoryUrl({ country: "ALL" });
  check("country=ALL is an explicit all", all.present.country && all.country === "all");

  const junk = parseDirectoryUrl({ country: "zz" });
  check("unknown country is not a URL filter (prefs win)", !junk.present.country);

  const cats = parseDirectoryUrl({ category: "hardware,consumables" });
  check(
    "multi category param parses",
    cats.present.category &&
      cats.categories.length === 2 &&
      cats.categories[0] === "hardware" &&
      cats.categories[1] === "consumables",
  );
  const cleared = parseDirectoryUrl({ category: "all" });
  check("category=all is present with empty selection", cleared.present.category && cleared.categories.length === 0);

  const qs = parseDirectoryUrl(new URLSearchParams("country=de&intl=1&q=ghee"));
  check(
    "URLSearchParams form matches the Next searchParams form",
    qs.country === "DE" && qs.shipsIntl && qs.search === "ghee" && qs.present.q,
  );
}
{
  const house = VENDORS.find((v) => v.handle === HOUSE_HANDLE);
  check(
    "house listing has a shop URL the UI can render",
    !!house && vendorWebsite(house) === "https://galaxymind.space/hashrate",
  );
}

console.log("");
if (failures > 0) {
  console.error(`✗ ${failures} invariant(s) failed.`);
  process.exit(1);
}
console.log("✓ all vendor-filter invariants hold.");
