"use client";

/* =====================================================================
 * RecentlyViewedVendors · "Continue browsing where you left off" strip
 *
 * Reads the LS-backed vendor-journey (recorded on every /v/[slug]
 * page-view by VendorJourneyTracker) and renders the 5 most recent
 * vendor pills on the homepage. Tap → goes to /v/[slug] for the
 * fastest "pick up where I was" UX.
 *
 * Why: this is the single strongest return-visitor hook on the site.
 * The directory has 63 vendors but ONLY the recently-viewed ones are
 * the ones THIS user has indicated interest in. Surfacing them at
 * the top of / on the next visit converts curiosity-driven bounces
 * ("I saw a cool vendor but didn't have time") into multi-session
 * engagement.
 *
 * Hidden states:
 *   - typeof window === "undefined" (SSR) · renders nothing on the
 *     server, hydrates with LS data after mount
 *   - No vendors visited yet · renders nothing (don't show an empty
 *     "you have no history" message · pure dead weight for new
 *     visitors)
 *   - All visited listings are unknown (e.g. vendor was removed from
 *     VENDORS since the visit was recorded) · renders nothing
 *
 * Layout: horizontal-scroll on mobile (matches DailyPulse) so the
 * strip stays compact even with 5 pills; grid on lg+.
 *
 * Privacy: LS only · the strip never leaves the device.
 * ===================================================================== */

import Link from "next/link";
import { useEffect, useState } from "react";
import { getJourney } from "@/lib/vendor-journey";
import {
  vendorSlug,
  vendorKey,
  findVendorByKey,
  normalizeVendorRefs,
  getDisplayHandle,
  type Vendor,
} from "@/lib/vendors";

const MAX_PILLS = 5;

export function RecentlyViewedVendors({
  excludeKey,
  headline = "⌬ Continue browsing",
  className = "max-w-5xl mx-auto px-4 sm:px-6 pt-3 sm:pt-4",
}: {
  /**
   * If set, this listing key (slug) is filtered out of the rendered
   * list. Used on /v/[slug] so the page doesn't surface the vendor the
   * visitor is already looking at. (A sibling shop under the same
   * handle still shows · it is a different listing.)
   */
  excludeKey?: string;
  /** Override the section title (e.g. "Also viewed" on /v/[slug]). */
  headline?: string;
  /** Override the section's outer-class so callers control spacing. */
  className?: string;
} = {}) {
  // null = pre-mount (SSR + first client render). The strip is
  // intentionally invisible during pre-mount to avoid hydration
  // flicker for first-time visitors who have nothing in LS.
  const [journey, setJourney] = useState<{
    vendors: Vendor[];
    uniqueCount: number;
  } | null>(null);

  useEffect(() => {
    const j = getJourney();
    if (j.handles.length === 0) {
      setJourney({ vendors: [], uniqueCount: 0 });
      return;
    }

    // Resolve stored refs → vendor objects. normalizeVendorRefs maps
    // legacy handle entries to listing keys and de-duplicates; unknown
    // refs (vendor removed since the visit) drop out at lookup. Apply
    // excludeKey in the same pass so we don't waste a pill slot
    // rendering the current vendor.
    const keys = normalizeVendorRefs(j.handles);
    const vendors: Vendor[] = [];
    for (const k of keys) {
      if (excludeKey && k === excludeKey) continue;
      const v = findVendorByKey(k);
      if (v) vendors.push(v);
      if (vendors.length >= MAX_PILLS) break;
    }
    setJourney({ vendors, uniqueCount: keys.length });
  }, [excludeKey]);

  if (!journey || journey.vendors.length === 0) return null;

  const { vendors } = journey;

  return (
    <section aria-label="Recently viewed vendors" className={className}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="t-xs font-medium text-[var(--accent-ink)]">
            {headline}
          </span>
        </div>
      </div>

      {/* Horizontal scroll on mobile so the strip stays compact even
          with 5 pills. Grid-of-fixed on lg+. */}
      <ul className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible">
        {vendors.map((v) => {
          const handle = getDisplayHandle(v);
          return (
            <li
              key={vendorKey(v)}
              className="snap-start shrink-0 sm:shrink"
            >
              <Link
                href={`/v/${vendorSlug(v)}`}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 hover:bg-[var(--bg-elevated)] hover:border-[var(--accent)]/40 transition-colors group"
              >
                <span
                  className="text-xs text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors truncate max-w-[8rem]"
                  title={`${v.name} · ${handle}`}
                >
                  {v.name}
                </span>
                <span
                  aria-hidden
                  className="font-mono t-xs text-[var(--text-tertiary)] group-hover:text-[var(--accent-ink)] transition-colors"
                >
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
