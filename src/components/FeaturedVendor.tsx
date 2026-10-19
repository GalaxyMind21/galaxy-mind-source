"use client";

/* =====================================================================
 * FeaturedVendor · vendor-of-the-week spotlight
 *
 * A larger, editorially-weighted card above the directory that says
 * "this week we're highlighting X." Auto-rotates by ISO week number,
 * so:
 *   - No manual curation required · the function picks deterministically
 *     from the full vendor list every Monday at 00:00 UTC
 *   - Returning visitors see new content week-over-week even if no
 *     new vendors land · directory feels alive
 *   - The same week always shows the same vendor (deterministic), so
 *     visitors navigating away and back don't see a flicker
 *
 * Algorithm: ISO week-of-year → modulo vendor count → that vendor.
 * Filters out stale vendors (those past 90-day re-verification) so a
 * featured vendor isn't a dead link.
 *
 * Dismissable: a user who's seen this week's feature can close the card
 * and it stays closed for the rest of the week (localStorage keyed by
 * year-week). Re-opens automatically next week.
 * ===================================================================== */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { track } from "@vercel/analytics";
import {
  CATEGORY_LABELS,
  formatVerifiedDate,
  getPlatform,
  getActionUrl,
  getActionLabel,
  getDisplayHandle,
  type Vendor,
} from "@/lib/vendors";
import { isoWeek, pickFeaturedVendor } from "@/lib/featured-vendor";
import { CountryMark } from "@/components/CountryMark";

export function FeaturedVendor({
  vendors,
  onOpenDetail,
}: {
  vendors: Vendor[];
  // Optional · when provided, clicking the featured card opens the
  // page-level VendorDetailModal instead of bouncing the visitor
  // off-site to the platform CTA. The CTA button still exists inside
  // the modal as the explicit leave-Galaxy-Mind moment.
  onOpenDetail?: (vendor: Vendor) => void;
}) {
  // SSR-safe rendering · pick on the server using "now". Hydration on
  // the client uses the same Date.now() within the same minute so
  // there's no mismatch in practice. We compute on every render but
  // useMemo so the calculation is cheap.
  const featured = useMemo(
    () => pickFeaturedVendor(vendors, new Date()),
    [vendors],
  );

  // Dismissable per-week. localStorage key encodes the ISO week so
  // dismissing this week's feature doesn't persist past Monday.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const { year, week } = isoWeek(new Date());
    const key = `gm:featured-dismissed:${year}-${week}`;
    if (window.localStorage.getItem(key) === "1") {
      setDismissed(true);
    }
  }, []);

  const onDismiss = () => {
    if (typeof window !== "undefined") {
      const { year, week } = isoWeek(new Date());
      window.localStorage.setItem(`gm:featured-dismissed:${year}-${week}`, "1");
    }
    setDismissed(true);
    track("featured_vendor_dismissed", {
      handle: featured?.handle ?? "",
    });
  };

  if (!featured || dismissed) return null;

  const platform = getPlatform(featured);
  const actionUrl = getActionUrl(featured);
  const actionLabel = getActionLabel(featured);
  const displayHandle = getDisplayHandle(featured);


  // Card-body click → opens the page-level modal (when onOpenDetail
  // is wired). Dismiss button and the platform CTA are nested
  // <button> / <a> elements; we early-return when the click
  // originated on one of them so they keep their own behavior.
  const onCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onOpenDetail) return;
    const target = e.target as HTMLElement;
    if (target.closest("a, button")) return;
    onOpenDetail(featured);
    track("vendor_modal_open", {
      handle: featured.handle,
      surface: "featured",
    });
  };

  return (
    <AnimatePresence>
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="max-w-5xl mx-auto px-4 sm:px-6 mb-8"
        aria-label="Featured vendor"
      >
        <div
          className={`relative rounded-xl border-2 border-[var(--accent)]/70 pulse-border bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-elevated-2)] p-5 sm:p-6 overflow-hidden ${
            onOpenDetail ? "cursor-pointer" : ""
          }`}
          style={{
            // THE BENCH LAMP, not an orange bloom (2026-09-04). This slot
            // is the editorial centerpiece and still announces itself —
            // but spec 4.7 is explicit that depth comes from warm white
            // light, never from orange, precisely so the accent stays
            // free to mean "live" and "press this". A 48px orange halo on
            // a card in an orange-accented grid says neither.
            // --nb-lift-lamp is the same light the hovered/focused vendor
            // cell already gets, so the featured slot now reads as the one
            // object under the lamp rather than the one object that glows.
            boxShadow: "var(--nb-lift-lamp)",
          }}
          onClick={onCardClick}
        >
          {/* Subtle accent wash on the right edge · marks this as the
              editorial slot without screaming for attention. */}
          <div
            aria-hidden
            className="absolute inset-y-0 right-0 w-32 pointer-events-none"
            style={{
              background:
                "linear-gradient(-90deg, rgba(247,147,26,0.10), transparent)",
            }}
          />

          {/* Dismiss button · top-right corner, low-key but accessible. */}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss featured vendor"
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated-2)]/80 transition-colors text-lg leading-none"
          >
            ×
          </button>

          <div className="relative flex items-baseline gap-2 mb-4">
            <span className="micro-label text-[var(--accent-ink)]">
              ★ Featured Vendor
            </span>
          </div>

          <div className="relative flex flex-col sm:flex-row sm:items-start gap-5">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-3 flex-wrap mb-2">
                <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)] leading-tight">
                  {featured.name}
                </h3>
                {featured.country && <CountryMark code={featured.country} />}
              </div>
              <div className="font-mono text-xs text-[var(--accent-ink)] mb-3 truncate">
                {displayHandle}
              </div>
              <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed mb-4 max-w-prose">
                {featured.description}
              </p>

              <div className="flex flex-wrap items-baseline gap-2 mb-5">
                <span className="t-xs font-medium text-[var(--accent-ink)] px-2 py-1 rounded bg-[var(--accent)]/10 border border-[var(--accent)]/30">
                  {CATEGORY_LABELS[featured.category]}
                </span>
                <span className="t-xs text-[var(--text-tertiary)]">
                  Verified{" "}
                  <span className="text-[var(--text-secondary)]">
                    {formatVerifiedDate(featured.verifiedAt)}
                  </span>
                </span>
              </div>

              <a
                href={actionUrl}
                target={platform === "lightning" ? undefined : "_blank"}
                rel={platform === "lightning" ? undefined : "noopener noreferrer"}
                onClick={() =>
                  track("vendor_click", {
                    handle: featured.handle,
                    platform,
                    surface: "featured_of_the_week",
                    category: featured.category,
                  })
                }
                className="inline-flex items-baseline gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black text-[14px] font-semibold hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
              >
                {actionLabel}
              </a>
            </div>
          </div>
        </div>
      </motion.section>
    </AnimatePresence>
  );
}
