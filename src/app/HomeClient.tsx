"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { track } from "@vercel/analytics";
import {
  CATEGORY_LABELS,
  COUNTRIES,
  VENDORS,
  Vendor,
  VendorCategory,
  countrySlug,
  findVendorByKey,
  formatVerifiedDate,
  normalizeVendorRefs,
  oldestVerifiedAt,
  vendorKey,
} from "@/lib/vendors";
import {
  type DirectoryFilters,
  type DirectoryUrlState,
  type SortMode,
  countByCategory,
  countByCountry,
  countMatching,
  directoryUrlHasFilter,
  filterAndSortVendors,
  parseDirectoryUrl,
} from "@/lib/vendor-filter";
import { FooterDisclaimer } from "@/components/Disclaimer";
import { CrossPageCTA } from "@/components/CrossPageCTA";
import {
  BITCOIN_ORG_LISTING_LABEL,
  BITCOIN_ORG_SPEND_URL,
} from "@/lib/listing";
import { SystemHealthStrip } from "@/components/SystemHealthStrip";
import { InlineSubscribePrompt } from "@/components/InlineSubscribePrompt";
import { SubmitVendorModal } from "@/components/SubmitVendorModal";
import { VendorDetailModal } from "@/components/VendorDetailModal";
import { VendorCard } from "@/components/VendorCard";
import { VendorMapLazy } from "@/components/VendorMapLazy";
import { DailyPulse } from "@/components/DailyPulse";
import { ReturnVisitorBand } from "@/components/ReturnVisitorBand";
import { LiveEconomyStrip } from "@/components/LiveEconomyStrip";
import { SiteHeader } from "@/components/SiteHeader";
import { HomeForShops } from "@/components/HomeForShops";
import { HomeFaq } from "@/components/HomeFaq";
import { useT } from "@/components/LocaleProvider";
import {
  loadDirectoryPrefs,
  saveDirectoryPrefs,
} from "@/lib/directory-prefs";
import { looksLikeLatamQuery } from "@/lib/latam";
import { geoShipHint } from "@/lib/geo-hint";
import {
  HOME_CARD_HOOK,
  XSELL_OUT_HASHRATE_HOOK,
  XSELL_OUT_HASHRATE_TITLE,
} from "@/lib/hashrate-copy";

const CATEGORY_ORDER: ("all" | VendorCategory)[] = [
  "all",
  "apparel",
  "general-goods",
  "hardware",
  "consumables",
  "collectibles",
  "services",
  "books",
];
const PRIMARY_CATEGORIES: ("all" | VendorCategory)[] = [
  "all",
  "apparel",
  "hardware",
  "consumables",
];

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "newest", label: "Newest First" },
  { value: "az", label: "A–Z" },
];

// All valid category values · used to validate LS-restored prefs
// against the current schema so corrupted or stale (e.g. removed
// category) values silently fall back to "all".
const VALID_CATEGORIES = new Set<string>([
  "all",
  "apparel",
  "general-goods",
  "hardware",
  "consumables",
  "collectibles",
  "services",
  "books",
]);
const EMPTY_URL: DirectoryUrlState = {
  categories: [],
  country: "all",
  sort: "newest",
  shipsIntl: false,
  search: "",
  present: {
    category: false,
    country: false,
    sort: false,
    intl: false,
    q: false,
  },
};

const GEO_HINT_DISMISSED_KEY = "gm:geo-hint-dismissed:v1";

export default function VendorsPage({
  initialUrl = EMPTY_URL,
  visitorCountry = null,
  visitorCountryLabel = null,
  rentHero = null,
}: {
  initialUrl?: DirectoryUrlState;
  /** Server-built hashrate rental tile (page.tsx), rendered below the directory grid. */
  rentHero?: ReactNode;
  /** ISO code from the edge header (page.tsx) · drives the geo hint. */
  visitorCountry?: string | null;
  visitorCountryLabel?: string | null;
}) {
  const { t } = useT();
  const [search, setSearch] = useState(
    initialUrl.present.q ? initialUrl.search : "",
  );
  // Multi-select categories (2026-07-02) · empty = all. Toggle pills.
  const [categories, setCategories] = useState<VendorCategory[]>(
    initialUrl.present.category ? initialUrl.categories : [],
  );
  // Favorites · listing-key (slug) set persisted under the ORIGINAL watchlist key
  // (legacy handle entries are migrated on load, see normalizeVendorRefs) so
  // hearts set back in May resurrect (the old feature was stripped in
  // aadf066 because its /watchlist page lost every entry point · v2's
  // entry point is the Saved chip inside the filter bar itself, so it
  // cannot be orphaned the same way). savedOnly is deliberately NOT
  // URL-synced and NOT persisted in prefs: it filters by MY hearts ·
  // meaningless in a shared link, confusing as a sticky default.
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [savedOnly, setSavedOnly] = useState(false);
  const [country, setCountry] = useState<"all" | string>(
    initialUrl.present.country ? initialUrl.country : "all",
  );
  const [sort, setSort] = useState<SortMode>(
    initialUrl.present.sort ? initialUrl.sort : "newest",
  );
  // Use-case filters · added May 2026 to help visitors narrow by
  // shopping intent. Both default to false (filter off, all vendors
  // visible). When toggled on, the predicate keeps only vendors with
  // the matching field set to true.
  const [shipsIntl, setShipsIntl] = useState(
    initialUrl.present.intl ? initialUrl.shipsIntl : false,
  );
  // Controls whether the secondary filter stack (Country / Sort /
  // "I'm looking for") is visible · default collapsed per 2026-05-20
  // page audit so the vendor grid lands higher above the fold.
  // Persisted: power users who expand keep their view across visits.
  const [filtersExpanded, setFiltersExpanded] = useState(
    directoryUrlHasFilter(initialUrl),
  );
  // Tracks whether we've finished hydrating from LS · prevents the
  // persistence effect below from overwriting LS with default values
  // during the first render BEFORE hydration runs.
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  // Submission modal — replaces the old direct-to-X compose links across
  // the page. Visitors pick X or Nostr inside the modal. See
  // SubmitVendorModal for the actual submission paths.
  const [submitOpen, setSubmitOpen] = useState(false);

  // Hydrate filter prefs from LS once on mount. Each restored value
  // is validated against the current schema · stale or corrupted
  // values silently fall back to defaults. Country is validated
  // dynamically against COUNTRIES so removing a country from the map
  // doesn't strand visitors on a dead filter.
  useEffect(() => {
    const prefs = loadDirectoryPrefs();
    // URL params override saved prefs per-key (2026-06-10) · a shared
    // link like /?country=DE&category=consumables must show the sender's
    // view, not the recipient's last-used filters. Any filter param in
    // the URL also expands the filter stack so the active filter is
    // visible rather than silently applied.
    // Same decoder the server uses, so /?country=de SSR and this
    // hydration cannot disagree on what the query means.
    const url = parseDirectoryUrl(new URLSearchParams(window.location.search));

    if (url.present.category) {
      // Only a MEANINGFUL param overrides prefs (explicit "all"
      // included). Review 2026-07-02: a malformed param used to
      // override with [] and the persistence effect then silently
      // ERASED the visitor's saved category prefs.
      setCategories(url.categories);
    } else {
      setCategories(
        prefs.categories.filter(
          (c): c is VendorCategory => c !== "all" && VALID_CATEGORIES.has(c),
        ),
      );
    }
    if (url.present.country) {
      setCountry(url.country);
    } else if (prefs.country === "all" || COUNTRIES[prefs.country]) {
      setCountry(prefs.country);
    }
    if (url.present.sort) {
      setSort(url.sort);
    } else if (prefs.sort === "newest" || prefs.sort === "az") {
      setSort(prefs.sort);
    }
    setShipsIntl(url.present.intl ? true : prefs.shipsIntl);
    if (url.present.q) setSearch(url.search);
    setFiltersExpanded(
      directoryUrlHasFilter(url) ? true : prefs.filtersExpanded,
    );
    setPrefsHydrated(true);
  }, []);

  // Mirror active filters into the URL (2026-06-10) so every filtered
  // view is shareable + the programmatic /spend-bitcoin-in|on pages have
  // canonical deep-link targets. replaceState (not pushState) · filter
  // twiddling shouldn't pollute Back-button history. Defaults are
  // omitted so the bare URL stays clean; search text IS included (a
  // shared link with a query is useful) but stays excluded from LS
  // persistence as before.
  useEffect(() => {
    if (!prefsHydrated) return;
    const sp = new URLSearchParams();
    if (categories.length > 0) sp.set("category", categories.join(","));
    if (country !== "all") sp.set("country", country);
    if (sort !== "newest") sp.set("sort", sort);
    if (shipsIntl) sp.set("intl", "1");
    if (search.trim()) sp.set("q", search.trim().slice(0, 100));
    const qs = sp.toString();
    const next = qs
      ? `${window.location.pathname}?${qs}`
      : window.location.pathname;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", next);
    }
  }, [categories, country, sort, shipsIntl, search, prefsHydrated]);

  // Persist filter prefs whenever they change · skipped before
  // hydration so we don't write defaults over saved state on first
  // render. Search text is intentionally excluded (transient input,
  // not a preference).
  useEffect(() => {
    if (!prefsHydrated) return;
    saveDirectoryPrefs({ categories, country, sort, shipsIntl, filtersExpanded });
  }, [categories, country, sort, shipsIntl, filtersExpanded, prefsHydrated]);

  // Favorites persistence · reuses the original watchlist key. Loaded
  // after mount (SSR and first client render agree on the empty set ·
  // no hydration mismatch); every toggle writes back best-effort.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("gm:watchlist:vendors");
      if (!raw) return;
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr)) {
        // Hearts saved before 2026-10 are HANDLES; normalize to listing
        // keys (slugs) and write the migrated list straight back.
        const keys = normalizeVendorRefs(arr);
        setSaved(new Set(keys));
        if (JSON.stringify(keys) !== raw) {
          window.localStorage.setItem(
            "gm:watchlist:vendors",
            JSON.stringify(keys),
          );
        }
      }
    } catch {
      /* private mode / corrupt JSON · start empty */
    }
  }, []);

  function toggleSaved(v: Vendor) {
    // Side effects OUTSIDE the state updater (review 2026-07-02 ·
    // React may invoke updaters twice, double-firing analytics).
    // Keyed by listing (slug), not handle: one handle may run several shops.
    const key = vendorKey(v);
    const handle = v.handle;
    const next = new Set(saved);
    const added = !next.has(key);
    if (added) next.add(key);
    else next.delete(key);
    try {
      window.localStorage.setItem(
        "gm:watchlist:vendors",
        JSON.stringify([...next]),
      );
    } catch {
      /* best-effort */
    }
    track("vendor_favorite_toggle", { handle, slug: key, added });
    // Focus rescue · un-hearting under the Saved filter unmounts the
    // card holding focus; park focus on the grid so Tab doesn't
    // restart from the top of the document.
    if (savedOnly && !added) {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && ae.closest("[data-vendor-card]")) {
        setTimeout(() => {
          document.querySelector<HTMLElement>("[data-vendor-grid]")?.focus();
        }, 0);
      }
    }
    setSaved(next);
  }

  // Tiny helper so all five entry points record the same event family
  // with a `source` tag identifying which CTA was clicked. Keeps the
  // analytics surface consistent and the call sites short.
  function openSubmit(source: string) {
    setSubmitOpen(true);
    track("submit_vendor_intent", { source });
  }

  const searchRef = useRef<HTMLInputElement>(null);

  // ----- "/" keyboard shortcut to focus search (skip when typing in any
  // form control already, so it doesn't hijack normal `/` typing). -----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (t && t.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ----- filter + sort -----
  // Public-facing dormancy filter removed 2026-05-20 (operator
  // decision). "Currently quiet" wasn't interesting or actionable
  // to a customer · they care whether a vendor accepts bitcoin,
  // and the answer is "the operator periodically prunes vendors
  // who've stopped." The cron + KV writes still happen for
  // operator awareness via scripts/audit-vendors.ts, but every
  // public surface (grid, RSS, /v/[slug], /api/vendors.json) now
  // shows every vendor in vendors.ts.
  const activeVendors = VENDORS;

  // Country filter pills + world-map counts derive from the SAME
  // universe as the grid (activeVendors). Public dormancy filter
  // removed 2026-05-20 so activeVendors === VENDORS now · the
  // useMemo wrapper stays in case a future filter (e.g.
  // operator-tagged "hidden") brings the alias back.
  // ── Filtering · ALL of it routes through src/lib/vendor-filter.ts so
  // the grid and the facet counts (category pills, country pills, world-
  // map dots) share ONE predicate and can never drift. The facet counts
  // are "sibling-aware": each reflects every OTHER active filter but not
  // its own dimension, so a count of N always yields N vendors on click.
  // (This is the fix for "a country says there are results but none
  // show" — the counts used to ignore the active category/search.)
  const filters = useMemo<DirectoryFilters>(
    () => ({ search, categories, country, shipsIntl, savedOnly, saved }),
    [search, categories, country, shipsIntl, savedOnly, saved],
  );

  // Full country universe · drives which pills exist (stable membership,
  // so pills don't reflow as you change category). Counts + disabled
  // state come from the sibling-aware tallies below.
  const availableCountries = useMemo(() => {
    const seen = new Set<string>();
    for (const v of activeVendors) if (v.country) seen.add(v.country);
    // Sort by the DISPLAYED label, not the ISO code · code order put
    // South Africa (ZA) last and the UK (GB) mid-list (a11y/UX audit
    // 2026-07-11).
    return Array.from(seen).sort((a, b) =>
      (COUNTRIES[a]?.label ?? a).localeCompare(COUNTRIES[b]?.label ?? b),
    );
  }, [activeVendors]);

  // Country counts ignore the active country (so each pill / map dot
  // reads "results if I switch here, keeping my other filters").
  const vendorsByCountry = useMemo(
    () => countByCountry(activeVendors, filters),
    [activeVendors, filters],
  );
  // The "All countries" pill · results with the country facet cleared.
  const allCountriesCount = useMemo(
    () => countMatching(activeVendors, filters, { country: true }),
    [activeVendors, filters],
  );
  // Category counts ignore the active category (same faceting rule).
  const categoryCounts = useMemo(
    () => countByCategory(activeVendors, filters),
    [activeVendors, filters],
  );

  const filtered = useMemo(
    () => filterAndSortVendors(activeVendors, filters, sort),
    [activeVendors, filters, sort],
  );

  // The grid renders in sort order, full stop (operator, 2026-08-27).
  //
  // The weekly featured shop used to be hoisted to position 0 under the
  // bench lamp. That made "Newest" untrue about its own first row, which
  // was half of why the ordering read as arbitrary · the other half being
  // that the sort key was an invisible ordinal. Both are fixed together.
  //
  // Letting the lamp simply follow the featured card was considered and
  // rejected on the numbers: the weekly pick lands at position 51-57 of
  // 135, far below the fold, so the treatment would have been invisible
  // while the code stayed. Better to remove it than to keep a feature
  // nobody can see.
  //
  // The bench lamp itself is NOT gone. VendorCard lights on `isFocused ||
  // lamp`, so keyboard focus still puts a card in the pool of light,
  // which is the Night Bench "one lit object" idea doing its real job.
  // pickFeaturedVendor also still drives the weekly social-post draft ·
  // that surface is independent of this grid and is untouched.
  const gridVendors = filtered;

  // "Shopping from {country}?" (2026-10-13) · see lib/geo-hint.ts. Most
  // bitcoin.org visitors are outside the US and the two filters that
  // answer "can I buy from here?" sit off-screen on the mobile rail.
  const geoHint = useMemo(
    () =>
      geoShipHint(visitorCountry, visitorCountryLabel, activeVendors, filters),
    [visitorCountry, visitorCountryLabel, activeVendors, filters],
  );
  const [geoHintDismissed, setGeoHintDismissed] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(GEO_HINT_DISMISSED_KEY) === "1") {
        setGeoHintDismissed(true);
      }
    } catch {
      // Storage blocked · the hint simply stays dismissible per visit.
    }
  }, []);
  const geoHintShownRef = useRef(false);
  const showGeoHint = geoHint !== null && !geoHintDismissed;
  useEffect(() => {
    if (!prefsHydrated || !showGeoHint || !geoHint || geoHintShownRef.current) {
      return;
    }
    geoHintShownRef.current = true;
    track("directory_geo_hint_shown", { cc: geoHint.cc });
  }, [prefsHydrated, showGeoHint, geoHint]);

  const oldestCheck = formatVerifiedDate(oldestVerifiedAt(VENDORS));

  // Active-filter summary + reset · powers the empty-state "clear"
  // affordance. With zero-count facets now disabled you can't click your
  // way into an empty grid, but a shared URL (e.g. /?country=SV&
  // category=apparel) or a no-match search query still can · this makes
  // that state a dead end you can escape in one tap, not a confusing wall.
  const activeFilterLabels = useMemo(() => {
    const out: string[] = [];
    for (const c of categories) out.push(CATEGORY_LABELS[c]);
    if (savedOnly) out.push("Saved ♥");
    if (country !== "all") {
      const m = COUNTRIES[country];
      out.push(m ? `${m.flag} ${m.label}` : country);
    }
    if (shipsIntl) out.push("Ships worldwide");
    if (search.trim()) out.push(`search "${search.trim()}"`);
    return out;
  }, [categories, country, shipsIntl, search, savedOnly]);

  function clearAllFilters() {
    setCategories([]);
    setSavedOnly(false);
    setCountry("all");
    setShipsIntl(false);
    setSearch("");
  }

  // Debounced screen-reader summary of result changes · announces the
  // settled count (or the zero-result explanation) once, ~500ms after
  // the last filter/search change, instead of on every keystroke.
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => {
      setAnnounced(
        filtered.length === 0
          ? t("home.emptyAnnounce")
          : t("home.announceShown", { n: filtered.length }),
      );
    }, 500);
    return () => window.clearTimeout(id);
  }, [filtered.length, t]);

  // ──────────────────────────────────────────────────────────────────
  // Vendor detail modal · in-page magnified view
  //
  // The modal is LISTING-KEYED (modalVendorKey: slug | null), not
  // index-keyed. Any source can open the modal · the directory grid,
  // the FeaturedVendor strip, the RecentlyAddedStrip, even a card
  // whose vendor isn't in the currently-filtered set.
  //
  // When the open vendor IS in `filtered`, the modal exposes
  // prev/next nav (and a "12 of 56" position counter) for slide-deck
  // browsing within the active filter context.
  //
  // When the open vendor is NOT in `filtered` (e.g. user filtered to
  // "consumables" but clicked the featured vendor which is hardware),
  // the modal is single-view · no prev/next, no counter. The user
  // closes and either clears the filter or navigates manually.
  //
  // The page-level keyboard layer (arrow keys to focus + Enter to
  // open) still operates on `filtered` · changing focus by arrow keys
  // doesn't reach into featured/recent strips. That's intentional ·
  // those strips are editorial highlights, not part of the
  // browsable grid sequence.
  // ──────────────────────────────────────────────────────────────────
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [modalVendorKey, setModalVendorKey] = useState<string | null>(
    null,
  );
  const filteredKey = `${categories.join(",")}|${country}|${sort}|${search}|${shipsIntl ? 1 : 0}|${savedOnly ? `s${saved.size}` : 0}`;
  useEffect(() => {
    setFocusedIndex(-1);
    setModalVendorKey(null);
    // Composite key is stable across identical filter combos · using
    // it as the dep instead of `filtered` itself prevents resetting
    // on incidental re-renders.
  }, [filteredKey]);

  // Derive the modal's vendor + nav context from the listing key.
  const modalState = useMemo(() => {
    if (!modalVendorKey) return null;
    const vendor = findVendorByKey(modalVendorKey);
    if (!vendor) return null;
    const indexInFiltered = gridVendors.findIndex(
      (v) => vendorKey(v) === modalVendorKey,
    );
    return {
      vendor,
      indexInFiltered,
      inFiltered: indexInFiltered >= 0,
    };
  }, [modalVendorKey, gridVendors]);

  // Page-level keyboard nav · runs ONLY when no input is focused
  // and the modal isn't open (modal owns its own keys).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Guard rewrite (review 2026-07-02, five confirmed bugs):
      //   1. Real interactives (filter pills, links, selects) keep
      //      their native keys · Space no longer hijacks a Tab-focused
      //      pill into opening a modal.
      //   2. Cards handle their own Enter/Space (no double-fire, no
      //      opening a different vendor than the DOM-focused one).
      //   3. Row stride reads the rendered grid's real column count
      //      instead of assuming 3.
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"]',
        )
      ) {
        return;
      }
      const onCard = !!target?.closest("[data-vendor-card]");
      if (!onCard && target?.closest("button, a, summary")) return;
      // When the modal is open, its keyboard handler takes over.
      if (modalVendorKey !== null) return;
      if (gridVendors.length === 0) return;

      const gridEl = document.querySelector("[data-vendor-grid]");
      const cols = gridEl
        ? getComputedStyle(gridEl).gridTemplateColumns.split(" ").length
        : 3;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        setFocusedIndex((i) => (i < 0 ? 0 : (i + 1) % gridVendors.length));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusedIndex(
          (i) => (i <= 0 ? gridVendors.length - 1 : i - 1),
        );
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => {
          if (i < 0) return 0;
          const next = i + cols;
          return next < gridVendors.length ? next : Math.min(i + 1, gridVendors.length - 1);
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => {
          if (i < 0) return 0;
          const prev = i - cols;
          return prev >= 0 ? prev : Math.max(i - 1, 0);
        });
      } else if (e.key === "Enter" || e.key === " ") {
        // A DOM-focused card presses itself (its own onKeyDown) ·
        // the document layer only acts for the roving ring case.
        if (onCard) return;
        if (focusedIndex < 0) return;
        e.preventDefault();
        const v = gridVendors[focusedIndex];
        if (!v) return; // membership can drift between key resets
        setModalVendorKey(vendorKey(v));
        track("vendor_modal_open", {
          handle: v.handle,
          surface: "keyboard",
        });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [gridVendors, focusedIndex, modalVendorKey]);

  // Roving DOM focus · the arrow-key ring IS the browser focus now
  // (review 2026-07-02: it used to be visual-only state, so the ring
  // could sit offscreen and Tab lived in a parallel universe).
  useEffect(() => {
    if (focusedIndex < 0) return;
    // NEVER move focus while a modal owns the screen (a11y 2026-07-25).
    // VendorDetailModal renders aria-modal="true", which tells a screen
    // reader the background does not exist; this effect was still pulling
    // DOM focus into a background card and scrolling it into view, so an
    // AT user landed on content their reader refused to announce and a
    // sighted keyboard user watched the page scroll behind the dialog.
    if (modalVendorKey !== null) return;
    const card = document.querySelector<HTMLElement>(
      `[data-vendor-card][data-vc-index="${focusedIndex}"]`,
    );
    if (!card) return;
    // Focus already inside this card (user tabbed to it or its heart)
    // · leave it alone so the ring sync never yanks focus around.
    if (card.contains(document.activeElement)) return;
    card
      .querySelector<HTMLElement>("[data-vc-open]")
      ?.focus({ preventScroll: true });
    card.scrollIntoView({ block: "nearest" });
  }, [focusedIndex, modalVendorKey]);

  // Open the modal for a given vendor from any source. Surfaces:
  //   "card_click"           - directory grid card body click
  //   "keyboard"             - Enter/Space on a focused card
  //   "featured"             - featured-vendor-of-the-week tile
  //   "recently_added"       - one of the 4 newest-vendor tiles
  const openVendorModal = (vendor: Vendor, surface: string) => {
    // Sync focusedIndex ONLY when the opener was the grid itself
    // (2026-07-25). The documented intent is "closing the modal restores
    // the ring where you were" — but seeding the ring from an OFF-GRID
    // surface inverts that: the featured tile and the recently-added rail
    // sit far from the grid, so on close the roving-focus effect above
    // would focus + scrollIntoView a card thousands of px away, throwing
    // the visitor somewhere they never were. For those surfaces the
    // correct restore target is the trigger, which useModalA11y already
    // handles.
    const fromGrid = surface === "card_click" || surface === "keyboard";
    const key = vendorKey(vendor);
    const i = gridVendors.findIndex((v) => vendorKey(v) === key);
    if (i >= 0 && fromGrid) setFocusedIndex(i);
    setModalVendorKey(key);
    track("vendor_modal_open", {
      handle: vendor.handle,
      surface,
    });
  };

  function renderCategoryPill(c: "all" | VendorCategory) {
    const active =
      c === "all" ? categories.length === 0 : categories.includes(c);
    const label = c === "all" ? t("home.all") : CATEGORY_LABELS[c];
    const count = c === "all" ? categoryCounts.all : categoryCounts[c] ?? 0;
    const disabled = !active && c !== "all" && count === 0;
    return (
      <button
        key={c}
        type="button"
        aria-pressed={active}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={() => {
          setCategories((prev) =>
            c === "all"
              ? []
              : prev.includes(c)
                ? prev.filter((x) => x !== c)
                : [...prev, c],
          );
          track("directory_filter", { kind: "category", value: c });
        }}
        className="nb-pill group"
      >
        {label}
        <span className="n">{count}</span>
        {active && c !== "all" && <FilterClearGlyph />}
      </button>
    );
  }

  return (
    <main className="night-bench min-h-screen flex-1">
      <SiteHeader />
      <SubmitVendorModal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
      />

      {/* In-page vendor detail modal · opens when a card is clicked
          or when the user presses Enter/Space on a keyboard-focused
          card. Arrow keys inside the modal swap to prev/next without
          closing, so visitors can browse the directory like a slide
          deck. The CTAs inside the modal still exit to X/Nostr/etc.
          (those are explicit leave actions); the modal itself is the
          "stay on Galaxy Mind" gravitational pull. */}
      <VendorDetailModal
        vendor={modalState?.vendor ?? null}
        onClose={() => setModalVendorKey(null)}
        // Prev/Next nav is only meaningful when the modal vendor is
        // in the currently-filtered set. When opened from
        // FeaturedVendor or RecentlyAddedStrip with a vendor outside
        // the filter, we hide the nav arrows · single-view modal.
        onPrev={
          modalState?.inFiltered && gridVendors.length > 1
            ? () => {
                const cur = modalState.indexInFiltered;
                const next = cur <= 0 ? gridVendors.length - 1 : cur - 1;
                setModalVendorKey(vendorKey(gridVendors[next]));
                setFocusedIndex(next);
              }
            : undefined
        }
        onNext={
          modalState?.inFiltered && gridVendors.length > 1
            ? () => {
                const cur = modalState.indexInFiltered;
                const next = (cur + 1) % gridVendors.length;
                setModalVendorKey(vendorKey(gridVendors[next]));
                setFocusedIndex(next);
              }
            : undefined
        }
        position={
          modalState?.inFiltered
            ? { index: modalState.indexInFiltered + 1, total: filtered.length }
            : undefined
        }
        // Swap modal to a different vendor without close+reopen ·
        // powers the "More vendors in [category]" panel inside the
        // modal. Also re-focuses the directory grid on the new
        // vendor (when it's in the filtered set) so closing the
        // modal lands the user on the just-explored card.
        onSelectVendor={(v) => {
          const key = vendorKey(v);
          setModalVendorKey(key);
          const idx = gridVendors.findIndex((f) => vendorKey(f) === key);
          if (idx >= 0) setFocusedIndex(idx);
        }}
      />

      {/* HERO · four lines of work, then the catalog. The first
          viewport IS the directory: bitcoin.org's spend page names
          us as independent online stores, manually verified, and
          that sentence has to complete before a visitor scrolls. */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-4 sm:pt-7 pb-2">
        {/* HOOK + CHIPS (competitor teardown lesson A1, 2026-10-18) · one
            compact line above the H1, never a second headline: the hook is
            kicker-size text and the three chips sit on the same line from
            sm up (hidden on phones), so the directory H1, search and grid
            keep their place in the first viewport for bitcoin.org visitors. */}
        <div className="mb-[10px] flex flex-wrap items-center gap-x-3 gap-y-1" data-home-hook>
          <p className="night-bench-kicker !m-0 !text-[var(--text-secondary)]">{t("home.hook")}</p>
          <ul aria-label={t("home.chipsAria")} className="hidden sm:flex flex-wrap items-center gap-1.5" data-home-chips>
            {(["home.chipDirect", "home.chipVerified", "home.chipNoFees"] as const).map((k) => (
              <li
                key={k}
                className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-2.5 py-0.5 text-[12px] leading-5 text-[var(--text-tertiary)]"
              >
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
        <h1 className="night-bench-title">
          {t("home.h1Lead")}{t("home.h1Bitcoin")}{t("home.h1End")}
        </h1>
        <p className="night-bench-lede">
          <strong>{t("home.heroStrong")}</strong>{" "}
          <a
            href={BITCOIN_ORG_SPEND_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--text-primary)] underline decoration-[var(--accent)]/40 underline-offset-2 hover:decoration-[var(--accent)]"
          >
            {BITCOIN_ORG_LISTING_LABEL}
          </a>
          .
        </p>
        <p className="night-bench-meta">
          {t("home.method", { date: oldestCheck })}{" "}
          <Link
            href="/methodology"
            className="underline decoration-[var(--text-tertiary)]/40 underline-offset-2 hover:decoration-[var(--text-secondary)]"
          >
            {t("home.humanVerified")}
          </Link>
          <span className="hidden sm:inline">
            {" · "}
            {t("home.independence")}
          </span>
        </p>

        <div className="night-bench-search">
          <label htmlFor="vendor-search" className="sr-only">
            {t("home.searchLabel")}
          </label>
          <input
            id="vendor-search"
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("home.searchPlaceholder")}
            aria-label={t("home.searchAria")}
          />
          <kbd
            className="hidden sm:inline font-mono t-xs text-[var(--text-tertiary)]"
            aria-hidden
          >
            /
          </kbd>
        </div>
      </section>

      {/* RETURNING-VISITOR BAND · self-gates on real history so a
          stranger never sees a gamified empty state. */}
      <ReturnVisitorBand />

      {/* CONTROLS · search + filters sit immediately under the hero
          (or return band) so the directory's primary tool is reachable
          without scrolling past discovery modules. overflow-x-clip
          contains the mobile sticky-pills bar's `-mx-4 px-4` full-bleed
          pattern · without it, browsers that render a vertical
          scrollbar with measurable width let the bar overflow by
          the scrollbar width and trigger horizontal page scroll
          (audit 2026-05-22). overflow-x-clip preserves sticky
          positioning of children, unlike overflow-x-hidden. */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 mb-6 overflow-x-clip">
        {/* Search moved up into the hero band (UX audit 2026-07-13) so
            it's reachable in the first mobile screen · see the hero
            section above. The category pills below remain the sticky
            re-filter tool. */}

        {/* Category pills · sticky on mobile (top-14 = under SiteHeader's
            h-14 mobile bar) so users browsing the long vendor list can
            re-filter without scrolling back up. Negative margin + padding
            lets the backdrop blur bleed to the screen edge. Desktop keeps
            the original relative position since the page is wide enough
            that the controls stay near the visible scroll area. */}
        <div className="nb-filter-rail mb-3">
          <div
            className="nb-filter-grp"
            role="group"
            // Stable, locale-independent hook for the focus rescue below.
            // Matching on the aria-label found nothing on /es, where it
            // reads "Filtrar por categoría", so focus fell to <body> —
            // the exact drop the rescue exists to prevent.
            data-filter-group="category"
            aria-label={t("home.filterCategoryAria")}
          >
            {PRIMARY_CATEGORIES.map(renderCategoryPill)}
            {CATEGORY_ORDER.some(
              (c) =>
                c !== "all" &&
                !PRIMARY_CATEGORIES.includes(c) &&
                categories.includes(c as VendorCategory),
            ) &&
              CATEGORY_ORDER.filter(
                (c) => c !== "all" && !PRIMARY_CATEGORIES.includes(c),
              )
                .filter((c) => categories.includes(c as VendorCategory))
                .map(renderCategoryPill)}
            {(saved.size > 0 || savedOnly) && (() => {
              const savedCount = countMatching(activeVendors, {
                ...filters,
                savedOnly: true,
              });
              return (
                <button
                  type="button"
                  aria-pressed={savedOnly}
                  aria-disabled={savedCount === 0 && !savedOnly}
                  disabled={savedCount === 0 && !savedOnly}
                  onClick={() => {
                    const turningOff = savedOnly;
                    setSavedOnly((p) => !p);
                    // Turning the filter off with zero hearts left
                    // unmounts this chip · park focus on the category
                    // group instead of dropping it on <body>.
                    if (turningOff && saved.size === 0) {
                      setTimeout(() => {
                        document
                          .querySelector<HTMLElement>(
                            '[data-filter-group="category"] button',
                          )
                          ?.focus();
                      }, 0);
                    }
                  }}
                  className="nb-pill group"
                >
                  <span aria-hidden>♥</span> {t("home.saved")}
                  <span className="n">{savedCount}</span>
                  {savedOnly && <FilterClearGlyph />}
                </button>
              );
            })()}
          <details className="country-sheet">
            <summary>
              <span>{t("home.moreFilters")}</span>
              <span aria-hidden className="text-[var(--text-tertiary)]">
                ↓
              </span>
            </summary>
            <div className="country-sheet-list" style={{ paddingTop: 8 }}>
              <div className="flex flex-wrap gap-2 px-2 pb-2">
                {CATEGORY_ORDER.filter(
                  (c) => !PRIMARY_CATEGORIES.includes(c),
                ).map(renderCategoryPill)}
              </div>
            </div>
          </details>
          </div>
          <Link
            href="/spend-bitcoin-on"
            className="nb-pill inline-flex items-center gap-1.5 text-[var(--accent-ink)] hover:underline underline-offset-2"
          >
            {t("nav.spendByCategory")}
            <span aria-hidden="true">→</span>
          </Link>

        {availableCountries.length > 0 && (
          <div className="nb-filter-grp" role="group" aria-label={t("home.filterCountryAria")}>
            <div className="nb-filter-sub">
              {availableCountries.includes("US") && (
                <button
                  type="button"
                  aria-pressed={country === "US"}
                  className="nb-pill"
                  disabled={!vendorsByCountry.US && country !== "US"}
                  onClick={() => {
                    const next = country === "US" ? "all" : "US";
                    setCountry(next);
                    track("directory_filter", { kind: "country", value: next });
                  }}
                >
                  United States
                  <span className="n">{vendorsByCountry.US ?? 0}</span>
                </button>
              )}
              {VENDORS.some((v) => v.shipsInternational === true) && (
                <button
                  type="button"
                  aria-pressed={shipsIntl}
                  className="nb-pill"
                  onClick={() => {
                    setShipsIntl((p) => !p);
                    track("directory_filter", {
                      kind: "ships_intl",
                      value: !shipsIntl ? "1" : "0",
                    });
                  }}
                >
                  {t("home.shipsIntl")}
                </button>
              )}
            <details className="country-sheet">
              <summary>
                <span>{t("home.countryMore")}</span>
                <span aria-hidden className="text-[var(--text-tertiary)]">
                  {country !== "all" && country !== "US"
                    ? COUNTRIES[country]?.label ?? country
                    : "↓"}
                </span>
              </summary>
              <div className="country-sheet-list">
                {availableCountries.map((cc) => {
                  const meta = COUNTRIES[cc] ?? { flag: "🏳️", label: cc };
                  const count = vendorsByCountry[cc] ?? 0;
                  const active = country === cc;
                  const hub = `/spend-bitcoin-in/${countrySlug(meta.label)}`;
                  return (
                    <div key={cc} className="country-sheet-row">
                      <button
                        type="button"
                        aria-pressed={active}
                        disabled={!active && count === 0}
                        className="nb-pill"
                        onClick={() => {
                          const next = active ? "all" : cc;
                          setCountry(next);
                          track("directory_filter", {
                            kind: "country",
                            value: next,
                          });
                        }}
                      >
                        {meta.label}
                        <span className="n">{count}</span>
                      </button>
                      <Link href={hub}>{t("home.countryHub")}</Link>
                    </div>
                  );
                })}
              </div>
            </details>
            </div>
          </div>
        )}
        </div>

        {showGeoHint && geoHint && (
          <div
            className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]"
            role="group"
            aria-label={t("home.geoHintLead", { country: geoHint.label })}
          >
            <span>{t("home.geoHintLead", { country: geoHint.label })}</span>
            {geoHint.worldwide > 0 && (
              <button
                type="button"
                className="nb-pill"
                onClick={() => {
                  setShipsIntl(true);
                  track("directory_filter", {
                    kind: "ships_intl",
                    value: "1",
                    source: "geo",
                  });
                }}
              >
                {t("home.shipsIntl")}
                <span className="n">{geoHint.worldwide}</span>
              </button>
            )}
            {geoHint.local > 0 && (
              <button
                type="button"
                className="nb-pill"
                onClick={() => {
                  setCountry(geoHint.cc);
                  track("directory_filter", {
                    kind: "country",
                    value: geoHint.cc,
                    source: "geo",
                  });
                }}
              >
                {t("home.geoHintLocal", { country: geoHint.label })}
                <span className="n">{geoHint.local}</span>
              </button>
            )}
            <button
              type="button"
              className="min-h-[44px] px-2 text-[var(--text-tertiary)] underline decoration-[var(--text-tertiary)]/40 underline-offset-2 hover:text-[var(--text-secondary)]"
              aria-label={t("home.geoHintDismissAria")}
              onClick={() => {
                setGeoHintDismissed(true);
                try {
                  window.localStorage.setItem(GEO_HINT_DISMISSED_KEY, "1");
                } catch {
                  // Storage blocked · hidden for this visit only.
                }
                track("directory_geo_hint_dismissed", { cc: geoHint.cc });
              }}
            >
              {t("home.geoHintDismiss")}
            </button>
          </div>
        )}

      </section>

      {/* GRID · the canonical "vendor-directory" anchor target.
          scroll-mt-20 keeps the header from tucking under any sticky
          bars from /stack or /fit if visitors arrived via cross-page
          nav. */}
      <section
        id="vendor-directory"
        className="nb-bench max-w-6xl mx-auto px-4 sm:px-6 pb-24 sm:pb-16 scroll-mt-20"
      >
        <div className="mb-3 flex items-baseline justify-between gap-3 flex-wrap text-sm text-[var(--text-tertiary)]">
          <span>
            {t("home.directory", { n: filtered.length })}
            {search.trim() !== "" && (
              <span className="ml-1.5">{t("home.rankedByMatch")}</span>
            )}
          </span>
          {/* Debounced SR announcement (review 2026-07-02 · a live
              region on the visible count re-announced every keystroke
              and the zero-result explanation sat outside it). */}
          <span role="status" className="sr-only">
            {announced}
          </span>
          {filtered.length === 0 ? (
            <span className="text-[var(--warning)]">{t("home.noMatches")}</span>
          ) : (
            /* Sort lives HERE, not in the filter sheet. It was buried
               inside "More filters" · a category error (filters subtract
               rows, sort reorders them) that made it unfindable, and made
               the grid's order look arbitrary. This is the result-set row,
               and sort is a property of the result set.
               radiogroup, not two aria-pressed toggles: these options are
               mutually exclusive, so a screen reader should hear
               "Newest, selected, 1 of 2" rather than two independent
               toggle buttons. */
            <div
              className="nb-seg"
              role="radiogroup"
              aria-label={t("home.sortAria")}
            >
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={sort === opt.value}
                  onClick={() => {
                    setSort(opt.value);
                    track("directory_filter", {
                      kind: "sort",
                      value: opt.value,
                    });
                  }}
                >
                  {opt.value === "newest"
                    ? t("home.sortNewest")
                    : t("home.sortAz")}
                </button>
              ))}
            </div>
          )}
        </div>
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-8 text-center">
            {activeFilterLabels.length > 0 ? (
              <>
                <p className="text-[var(--text-secondary)] text-sm mb-1">
                  {t("home.emptyMatch", { filters: activeFilterLabels.join(" · ") })}
                </p>
                <p className="text-[var(--text-tertiary)] t-xs mb-4">
                  {t("home.emptyHint")}
                </p>
                {looksLikeLatamQuery(search) && (
                  <p className="text-[var(--text-tertiary)] t-xs mb-4">
                    {t("home.emptyLatam")}{" "}
                    <Link
                      href="/spend-bitcoin-in-latin-america"
                      className="text-[var(--accent-ink)] underline decoration-[var(--accent)]/40 underline-offset-2"
                    >
                      {t("home.emptyLatamCta")}
                    </Link>
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="nb-pill"
                  >
                    {t("home.clearFilters")}
                  </button>
                  <button
                    type="button"
                    onClick={() => openSubmit("empty_state")}
                    className="nb-pill"
                  >
                    {t("home.submitVendor")}
                  </button>
                </div>
                {/* Quiet /hashrate path (2026-10-12) · a shopper who finds no
                    shop match had no next step besides submit. Service
                    language only (gated XSELL_OUT_HASHRATE_* in
                    lib/hashrate-copy). Underline link, not a pill, so
                    submit stays the directory-hygiene primary. */}
                <p className="text-[var(--text-tertiary)] t-xs mt-5">
                  {t("home.emptyHashrateLead")}{" "}
                  <Link
                    href="/hashrate"
                    onClick={() =>
                      track("directory_empty_hashrate_cta", { hasFilters: true })
                    }
                    className="text-[var(--accent-ink)] underline decoration-[var(--accent)]/40 underline-offset-2"
                  >
                    {XSELL_OUT_HASHRATE_TITLE}
                  </Link>
                  <span className="block mt-1">{XSELL_OUT_HASHRATE_HOOK}</span>
                </p>
              </>
            ) : (
              <>
                <p className="text-[var(--text-secondary)] text-sm mb-4">
                  {t("home.emptyNone")}
                </p>
                {looksLikeLatamQuery(search) && (
                  <p className="text-[var(--text-tertiary)] t-xs mb-4">
                    {t("home.emptyLatam")}{" "}
                    <Link
                      href="/spend-bitcoin-in-latin-america"
                      className="text-[var(--accent-ink)] underline decoration-[var(--accent)]/40 underline-offset-2"
                    >
                      {t("home.emptyLatamCta")}
                    </Link>
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => openSubmit("empty_state")}
                  className="nb-pill"
                >
                  {t("home.submitVendor")}
                </button>
                {/* Quiet /hashrate path (2026-10-12) · a shopper who finds no
                    shop match had no next step besides submit. Service
                    language only (gated XSELL_OUT_HASHRATE_* in
                    lib/hashrate-copy). Underline link, not a pill, so
                    submit stays the directory-hygiene primary. */}
                <p className="text-[var(--text-tertiary)] t-xs mt-5">
                  {t("home.emptyHashrateLead")}{" "}
                  <Link
                    href="/hashrate"
                    onClick={() =>
                      track("directory_empty_hashrate_cta", { hasFilters: false })
                    }
                    className="text-[var(--accent-ink)] underline decoration-[var(--accent)]/40 underline-offset-2"
                  >
                    {XSELL_OUT_HASHRATE_TITLE}
                  </Link>
                  <span className="block mt-1">{XSELL_OUT_HASHRATE_HOOK}</span>
                </p>
              </>
            )}
          </div>
        ) : (
          <>
          {/* Invisible section heading · the vendor-card h3s need an h2
              ancestor in the outline (design audit 2026-07-08). It sits
              OUTSIDE the grid as of 2026-07-29: role="list" only permits
              listitem children, so an h2 inside made the whole directory
              an invalid list to a screen reader (Lighthouse
              aria-required-children). Same heading, same outline, legal
              list. */}
          <h2 className="sr-only">
            {activeFilterLabels.length === 0
              ? t("home.allMerchantsSr")
              : t("home.filteredMerchantsSr", {
                  filters: activeFilterLabels.join(", "),
                })}
          </h2>
          <div
            data-vendor-grid
            // Marks the directory as occlusion-sensitive so the floating
            // StickySubscribeChip yields (hides) while the grid is in
            // view instead of covering the first vendor card's actions
            // (UX audit 2026-07-13 · the guard mechanism already exists,
            // it was just never applied outside the /stack sliders).
            data-occlusion-sensitive
            tabIndex={-1}
            className="nb-grid focus:outline-none scroll-mt-24"
            role="list"
          >
            <AnimatePresence mode="popLayout">
              {gridVendors.map((v, i) => (
                <VendorCard
                  key={vendorKey(v)}
                  vendor={v}
                  index={i}
                  isFocused={focusedIndex === i}
                  onFocusWithin={() => setFocusedIndex(i)}
                  saved={saved.has(vendorKey(v))}
                  onToggleSave={() => toggleSaved(v)}
                  onOpenDetail={() => openVendorModal(v, "card_click")}
                />
              ))}
            </AnimatePresence>
          </div>
          {/* Keyboard hint · moved BELOW the grid (2026-08-27) when the
              sort control took the count row's right slot. It is guidance,
              not state, so it does not need to sit above the fold · and
              arrow-key browsing only becomes relevant once you are already
              in the grid. Still desktop-only: there are no arrow keys to
              press on a phone. */}
          <p className="hidden md:block mt-4 t-xs text-[var(--text-tertiary)]">
            {t("home.browseTip")}
          </p>
          </>
        )}
      </section>

      {/* NO BITCOIN YET? (competitor teardown lesson A2, 2026-10-18) · a
          one-line pointer to the Lightning pay guide, BELOW the grid so the
          directory keeps the first viewport. */}
      <p className="max-w-6xl mx-auto px-4 sm:px-6 mb-6 text-sm text-[var(--text-secondary)]" data-home-pay-callout>
        <strong className="font-medium text-[var(--text-primary)]">{t("home.payCallout")}</strong>{" "}
        {t("home.payCalloutBody")}{" "}
        <Link
          href="/how-to-pay-with-lightning"
          className="text-[var(--accent-ink)] underline decoration-[var(--accent-ink)]/40 underline-offset-2 hover:decoration-[var(--accent-ink)]"
        >
          {t("home.payCalloutLink")} →
        </Link>
      </p>

      {/* RENT TILE · quiet, secondary hashrate-rental pointer (operator
          2026-10-17). It sits BELOW the directory: the first
          viewport must stay the free vendor directory (headline, search,
          categories, listings) to keep the bitcoin.org spend listing. */}
      {rentHero}

      {/* ───────── BELOW THE DIRECTORY · discovery + returning-visitor
          surfaces. Relocated beneath the grid (2026-05) so the value
          prop, search, and grid lead for new/campaign traffic. This
          is the "explore more / what's new / what I missed" layer. */}

      {/* WORLD MAP · geographic discovery. Countries are clickable ·
          a click sets the country filter that drives the grid above. */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 mb-6">
        <VendorMapLazy
          vendorsByCountry={vendorsByCountry}
          listedCount={allCountriesCount}
          selectedCountry={country}
          onCountryClick={(cc) => {
            const next = country === cc ? "all" : cc;
            setCountry(next);
            track("directory_filter", {
              kind: "map_country",
              value: next,
            });
            // The map lives ~12,000px BELOW the grid it filters ·
            // without this, the click reflows content far above the
            // viewport and the visitor is left staring at an
            // arbitrary spot (operator report 2026-07-09). Take them
            // to the result they asked for.
            const reduce = window.matchMedia(
              "(prefers-reduced-motion: reduce)",
            ).matches;
            // Defer past React's commit · the filter collapses the
            // grid and shifts every coordinate; measuring before the
            // reflow overshoots the landing by hundreds of px.
            setTimeout(() => {
              document.querySelector("[data-vendor-grid]")?.scrollIntoView({
                behavior: reduce ? "auto" : "smooth",
                block: "start",
              });
            }, 80);
          }}
        />
      </section>

      <p className="nb-doors max-w-6xl mx-auto px-4 sm:px-6 mt-8">
        <Link href="/online-stores-that-accept-bitcoin">
          {t("home.onlineStoresDoor")}
        </Link>
        <Link href="/spend-bitcoin-in-latin-america">{t("home.latamDoor")}</Link>
        <Link href="/spend-and-replace">{t("home.spendAndReplace")}</Link>
      </p>

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <LiveEconomyStrip />
      </div>

      {/* Inline subscribe prompt · 2026-05-20 audit moved this from
          ABOVE the controls/grid (which blocked the primary content)
          to AFTER the RecentlyAddedStrip. The natural pitch is now
          "you've seen what's in the directory + what's new · want
          this weekly?" instead of "give us your email before we
          show you anything." Copy matches the vendors source pref
          (notifyOnNewVendors) — gauge pitch was a value-prop mismatch
          on the spend homepage (2026-07-23). */}
      <div
        id="email-updates"
        className="max-w-3xl mx-auto px-4 sm:px-6 mt-8 mb-4 scroll-mt-20"
      >
        <InlineSubscribePrompt
          source="vendors"
          headline="Get new merchants by email"
          subhead="One quiet Sunday list when someone new lands in the directory. Most weeks you get nothing · only when there's news."
        />
      </div>

      {/* FOR SHOPS (competitor teardown lesson A3, 2026-10-18) · the
          merchant pitch with its own CTA, then the short FAQ (A4) whose
          FAQPage JSON-LD lives in app/page.tsx. Both sit far below the
          directory. */}
      <HomeForShops />
      <HomeFaq />

      {/* Radical-transparency social-proof strip · "the lights are on".
          Vendor/subscriber/country counts + live data freshness, each
          cell failing silently. Sits just above the cross-sell so the
          proof ("real people, fresh data") primes the tool CTAs. */}
      <div className="mt-12">
        <SystemHealthStrip />
      </div>
      <DailyPulse />

      {/* Cross-sell strip · most visitors land on the directory and
          never learn the tools exist. Plain-language, spender-first
          cards convert directory traffic into tool traffic · the #1
          leak since most entry is on / and /v/[slug] (2026-05-31).
          Leads with /hashrate (gated HOME_CARD_HOOK · quiet card, not
          a hero) then habit/arcade/buy-intent cards. Not another email
          ask (UX audit 2026-07-13): the single email prompt already
          sits above this strip. */}
      <div className="mt-12">
        <CrossPageCTA
          heading="More from Galaxy Mind"
          cards={[
            {
              href: "/hashrate",
              eyebrow: "RENT HASHRATE",
              title: XSELL_OUT_HASHRATE_TITLE,
              hook: HOME_CARD_HOOK,
            },
            {
              href: "/today",
              eyebrow: "DAILY BRIEFING",
              title: "Today in Bitcoin",
              hook: "The four live numbers in one glance: gauge, float, cheapest treasury, directory pulse.",
            },
            {
              href: "/arcade",
              eyebrow: "THE ARCADE",
              title: "Eight bitcoin games",
              hook: "The kart racer, the flagship platformer, and a new WEN, Gauntlet, Trail, and CHOP every UTC day.",
            },
            {
              href: "/should-i-buy-bitcoin",
              eyebrow: "SHOULD I BUY?",
              title: "Is now a good time to buy Bitcoin?",
              hook: "A live 0-100 gauge of 10 market signals, updated daily.",
            },
          ]}
        />
      </div>

      <FooterDisclaimer />

      {/* Mobile floating action removed May 11, 2026 · the FAB was
          rendering at z-30, but MobileBottomNav (which is a different
          component rendered in layout.tsx) is at z-40, so the FAB
          was literally invisible behind the nav on every iPhone.
          Submit is now a 5th item in MobileBottomNav itself · always
          visible, always one tap, no z-index dance. */}
    </main>
  );
}

function FilterClearGlyph() {
  return (
    <span
      aria-hidden
      className="ml-0.5 -mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[14px] leading-none text-[var(--accent-ink)]/70 group-hover:bg-[var(--accent)]/20 group-hover:text-[var(--accent-ink)] transition-colors"
      title="Clear this filter"
    >
      ×
    </span>
  );
}
