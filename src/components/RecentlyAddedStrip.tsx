"use client";

// "Recently Added" hero strip — surfaces the newest 4 vendors above
// the alphabetical/chrono grid below.
//
// Why this exists:
// The full directory grid renders all vendors at uniform visual weight,
// which makes new additions invisible. Visitors who've been here
// before have no way to see "what's new since my last visit." This
// strip is editorial spotlight — same vendor cards but in a brighter
// container with a "JUST ADDED" ribbon.
//
// The strip auto-populates from VENDORS sorted by addedAt desc, taking
// the top 4. As new vendors land in vendors.ts, the strip updates on
// next deploy. No manual curation needed.

import { motion } from "framer-motion";
import { track } from "@vercel/analytics";
import {
  CATEGORY_LABELS,
  isStale,
  isNewThisWeek,
  formatVerifiedDate,
  getPlatform,
  getActionUrl,
  getActionLabel,
  getDisplayHandle,
  vendorKey,
  type Vendor,
} from "@/lib/vendors";
import { CountryMark } from "@/components/CountryMark";

export function RecentlyAddedStrip({
  vendors,
  onOpenDetail,
}: {
  vendors: Vendor[];
  // Optional · when provided, clicking a recent-vendor tile opens
  // the page-level VendorDetailModal instead of bouncing the
  // visitor off-site to the platform link. Same engagement-vs-
  // bounce pattern as VendorCard on the directory grid.
  onOpenDetail?: (vendor: Vendor) => void;
}) {
  // Take the 4 newest by addedAt. Don't show the strip at all if we
  // don't have at least 3 vendors (avoids weird single-card layout
  // during early-stage seeding).
  const recent = [...vendors]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 4);
  if (recent.length < 3) return null;

  // Count of vendors verified in the last 7 days (whole directory,
  // not just the 4 shown · the lane is a "this week" heartbeat even
  // if some this-week vendors fall outside the top-4-by-addedAt
  // window). When ≥1, the eyebrow swaps from the all-time "Just
  // added" framing to a time-pressured "X this week" so the lane
  // honestly reflects the current cadence.
  // Wrap so Array.filter's (element, index) signature doesn't shadow
  // the helper's optional `nowSec` second arg with a tiny index value.
  const thisWeekCount = vendors.filter((v) => isNewThisWeek(v)).length;

  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 mb-8">
      <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-4 sm:p-5 relative overflow-hidden">
        {/* Subtle orange wash gradient on the left edge · visual marker
            this is the "fresh" section without screaming for attention. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 w-24 pointer-events-none"
          style={{
            background:
              "linear-gradient(90deg, rgba(247,147,26,0.08), transparent)",
          }}
        />

        <div className="relative flex items-baseline justify-between mb-4 gap-3">
          <div>
            <div className="t-xs font-medium text-[var(--accent-ink)] mb-1 flex items-center gap-2">
              {thisWeekCount > 0 ? (
                <>
                  <span
                    aria-hidden
                    className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse"
                  />
                  <span>
                    <span className="tabular-nums">{thisWeekCount}</span>{" "}
                    this week
                  </span>
                </>
              ) : (
                <span>Just added</span>
              )}
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)] leading-tight">
              The newest {recent.length} on the directory
            </h3>
          </div>
          <span className="t-xs text-[var(--text-tertiary)] hidden sm:inline">
            updated continuously
          </span>
        </div>

        <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {recent.map((v, i) => (
            <RecentCard
              key={vendorKey(v)}
              vendor={v}
              index={i}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// Compact vendor card for the strip — same structure as the grid card
// but tighter (no description, no share button) so 4 fit a row on
// desktop and the strip stays at one screen-height of vertical space.
function RecentCard({
  vendor,
  index,
  onOpenDetail,
}: {
  vendor: Vendor;
  index: number;
  onOpenDetail?: (vendor: Vendor) => void;
}) {
  const platform = getPlatform(vendor);
  const actionUrl = getActionUrl(vendor);
  const actionLabel = getActionLabel(vendor);
  const displayHandle = getDisplayHandle(vendor);


  // When wired with onOpenDetail (the modal-on-click pattern), render
  // the card as a button that opens the modal · keeps visitors on
  // Galaxy Mind. When not wired, fall back to the legacy <a> behavior
  // so the strip works standalone (e.g. if it's ever embedded outside
  // the homepage where the modal isn't mounted).
  const useModal = !!onOpenDetail;

  const handleOpen = () => {
    if (useModal && onOpenDetail) {
      onOpenDetail(vendor);
      track("vendor_modal_open", {
        handle: vendor.handle,
        surface: "recently_added",
      });
    } else {
      track("vendor_click", {
        handle: vendor.handle,
        platform,
        surface: "recently_added_strip",
        category: vendor.category,
      });
    }
  };

  const Wrapper = useModal ? motion.button : motion.a;
  const wrapperProps = useModal
    ? {
        type: "button" as const,
        onClick: handleOpen,
        // NO aria-label (2026-07-29). This card's visible content is
        // already its label: brand name, country, handle, category,
        // verification date, and a "View detail" CTA. An aria-label
        // OVERRIDES all of that, so the button announced one short
        // phrase while showing six pieces of information, and WCAG 2.5.3
        // "Label in Name" failed because a voice-control user saying any
        // visible phrase but the name matched nothing.
        //
        // Letting the content compute the name fixes both at once: the
        // accessible name becomes exactly the visible text, so it cannot
        // drift, and a screen-reader user hears the same details a
        // sighted user reads. Verified against Lighthouse rather than
        // assumed. Tried "Name — view detail" first; still a mismatch,
        // because the rule wants the WHOLE visible label, not a prefix.
      }
    : {
        href: actionUrl,
        target: platform === "lightning" ? undefined : "_blank",
        rel: platform === "lightning" ? undefined : "noopener noreferrer",
        onClick: handleOpen,
      };

  return (
    <Wrapper
      {...wrapperProps}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      whileHover={{ y: -2 }}
      // p-4 on mobile (tighter on desktop) so the touch target hits
      // iOS HIG's 44pt min height for primary tap targets. text-left
      // is needed when the wrapper renders as <button> · button
      // default text-align is center.
      className="block w-full text-left rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] p-4 sm:p-3 hover:border-[var(--accent)]/50 hover:lit-active transition-all cursor-pointer"
    >
      {/* Business name primary · handle secondary. Mirrors the
          VendorCard hierarchy on / · brand the visitor recognizes
          first, identifier below. Nostr bech32 vendors collapse to
          a single line (getDisplayHandle returns vendor.name in
          that case, so the secondary line would duplicate). */}
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <span
          className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] truncate"
          title={vendor.name}
        >
          {vendor.name}
        </span>
        {vendor.country && <CountryMark code={vendor.country} />}
      </div>
      {displayHandle !== vendor.name && (
        <div
          className="font-mono t-xs text-[var(--text-tertiary)] mb-2 truncate"
          title={vendor.handle}
        >
          {displayHandle}
        </div>
      )}
      <div className="flex items-baseline gap-2 mb-2">
        <span className="t-xs font-medium text-[var(--accent-ink)] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 border border-[var(--accent)]/30">
          {CATEGORY_LABELS[vendor.category]}
        </span>
        <span
          className={`font-mono t-xs uppercase tracking-widest ${
            isStale(vendor.verifiedAt)
              ? "text-[var(--warning)]"
              : "text-[var(--text-tertiary)]"
          }`}
        >
          {isStale(vendor.verifiedAt)
            ? "stale"
            : formatVerifiedDate(vendor.verifiedAt)}
        </span>
      </div>
      <div className="t-xs font-medium text-[var(--accent-ink)] flex items-center justify-between">
        <span>{useModal ? "View detail" : actionLabel.replace(" →", "")}</span>
        <span aria-hidden>→</span>
      </div>
    </Wrapper>
  );
}
