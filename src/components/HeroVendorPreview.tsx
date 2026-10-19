"use client";

// 3-up vendor preview · placed in the / hero so the visitor sees
// real vendor avatars + names BEFORE the filter stack pushes the
// grid below the fold. 2026-05-20 page-audit found that on a
// typical laptop viewport, ZERO vendors are visible above the
// fold despite the page's whole premise being "browse vendors."
// This component is the smallest possible proof-of-content fix:
// 3 newest vendors as 56px avatar chips with names underneath.
//
// Click → opens the same VendorDetailModal that the grid uses
// (via the onOpenDetail callback). No new navigation paradigm.
//
// Visual restraint · this is a "trailer" for the grid, not a
// duplicate. Compact, mono labels, no descriptions or category
// pills · just enough to say "real vendors live here."

import { useState } from "react";
import { getDisplayHandle, getPlatform, vendorKey, type Vendor } from "@/lib/vendors";
import { xAvatarSrc } from "@/lib/avatars";

function initials(s: string): string {
  const parts = s
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function HeroAvatar({ vendor, size = 56 }: { vendor: Vendor; size?: number }) {
  const [errored, setErrored] = useState(false);
  const platform = getPlatform(vendor);
  const handle = vendor.handle;

  // Same avatar resolution logic as the grid's <Avatar /> · pictureUrl
  // first (Nostr), then xAvatarSrc (local snapshot / unavatar.io) for
  // X, then initials fallback. Inlined here so this component is
  // self-contained without coupling to the page-level Avatar.
  let src: string | null = null;
  // Nostr vendors don't always have a pictureUrl exposed at the type
  // level · the Vendor schema doesn't enforce it. The grid's Avatar
  // accepts an optional pictureUrl prop · here we don't have one,
  // so X is the only source we try before falling back to initials.
  if (platform === "x" && !errored) {
    src = xAvatarSrc(handle);
  }

  if (!src) {
    return (
      <div
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] flex items-center justify-center font-mono text-sm font-semibold text-[var(--accent-ink)]"
        aria-hidden
      >
        {initials(vendor.name || handle)}
      </div>
    );
  }

  return (
    // Descriptive alt text added 2026-05-28 per SEO site-audit findings
    // (109 missing-alt warnings · all 5 avatar render sites had alt="").
    // Vendor name + "accepts Bitcoin" keyword density helps image-search
    // ranking + accessibility for screen-reader users. Falls back to
    // handle if vendor.name is empty.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${vendor.name || handle} · accepts Bitcoin`}
      width={size}
      height={size}
      onError={() => setErrored(true)}
      className="shrink-0 rounded-full object-cover border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]"
      loading="eager"
      referrerPolicy="no-referrer"
    />
  );
}

export function HeroVendorPreview({
  vendors,
  onOpenDetail,
  variant = "pill",
}: {
  vendors: Vendor[];
  onOpenDetail: (vendor: Vendor) => void;
  // "pill" · the original responsive strip (horizontal on sm+).
  // "rail" · always-vertical card for the desktop command-center right
  //   column (2026-06-20). The horizontal pill is ~660px wide and would
  //   overflow a narrow rail; the vertical card fills it and stacks the
  //   newest vendors as a live proof column. */
  variant?: "pill" | "rail";
}) {
  const isRail = variant === "rail";
  // 3 newest. Same selection rule as RecentlyAddedStrip (which picks
  // 4) · this hero strip is the tighter "trailer" version.
  const top3 = [...vendors]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 3);

  // Don't render at all if we don't have 3 · avoids weird empty/
  // single-card layout during very-early-stage seeding (defensive ·
  // production has 80+ vendors so this branch is unreachable today).
  if (top3.length < 3) return null;

  // Mobile/desktop split · 2026-05-20 audit caught overflow at 375px
  // where the inline-flex pill was clipping the 3rd vendor's name +
  // the "Just added" label entirely. Two layouts now:
  //
  //   < sm: stacked card · "JUST ADDED" eyebrow + one row per vendor
  //         (avatar + name). Names get the full container width so
  //         "Bitcoin Ranch" / "MrSatoshi" / "Crinkl" all fit without
  //         truncation.
  //   sm+ : original inline-flex pill (avatars + names + "Just added"
  //         badge on the right). Plenty of width on tablets and up.
  //
  // The same data + same click target on both · just different
  // composition. Keeps the proof-of-content visible on every viewport
  // without losing the desktop's sleek pill aesthetic.
  // Rail variant gets the machined champagne bezel (2026-06-29 · the
  // Supply Clock language arriving on the homepage). The bezel is
  // theme-neutral metal, so the theme-aware innards (avatars, names on
  // --bg-elevated) stay untouched and safe in light mode. The inner
  // panel is SOLID bg-elevated · the old /60 + backdrop-blur reads
  // muddy on top of the metal ring, and .elevate is redundant under it.
  const content = (
    <div
      // Note on responsive layout: `flex flex-col` (column at base)
      // needs an explicit `sm:flex-row` to reset direction at the
      // desktop breakpoint · without it, `sm:inline-flex` only
      // changes display-mode but leaves flex-direction:column, so
      // items still stack vertically on desktop (caught by mobile-
      // audit re-verify after first fix attempt 2026-05-20).
      className={
        isRail
          ? "flex flex-col gap-1.5 rounded-[15px] bg-[var(--bg-elevated)] p-3"
          : "mt-5 sm:mt-6 sm:inline-flex sm:flex-row sm:items-stretch sm:gap-3 flex flex-col gap-1 rounded-2xl sm:rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-2 sm:pr-4 backdrop-blur-sm"
      }
      aria-label="Recently added vendors"
    >
      {/* Mobile-only eyebrow · the sm+ pill puts "Just added" at the
          right edge; the mobile card needs it at the top so the row
          of vendor buttons reads as the content. */}
      <div
        className={
          isRail
            ? "font-mono t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)] px-1 pt-0.5"
            : "sm:hidden font-mono t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)] px-1 pt-0.5"
        }
      >
        Just added
      </div>
      {top3.map((v) => (
        <button
          key={vendorKey(v)}
          type="button"
          onClick={() => onOpenDetail(v)}
          className={
            isRail
              ? "flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-[var(--bg-elevated-2)]/60 transition-colors group text-left"
              : "flex items-center gap-2 rounded-lg sm:rounded-full px-1.5 py-1 sm:py-0.5 hover:bg-[var(--bg-elevated-2)]/60 transition-colors group text-left"
          }
          title={`Open ${v.name}`}
        >
          <HeroAvatar vendor={v} size={36} />
          {/* Name + a one-word category hook (2026-07-11 UX review ·
              bare names gave a first-timer nothing to bite on; the
              category keeps the trailer compact while answering
              "selling what?"). */}
          <span className="flex flex-col pr-1 min-w-0">
            <span className="font-mono t-xs text-[var(--text-secondary)] group-hover:text-[var(--accent-ink)] transition-colors whitespace-nowrap">
              {v.name}
            </span>
            <span className="font-mono t-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)] whitespace-nowrap">
              {v.category}
            </span>
          </span>
        </button>
      ))}
      {/* Desktop-only "Just added" badge · hidden on mobile because
          the eyebrow above already carries the label. */}
      {!isRail && (
        <div className="hidden sm:flex items-center pl-2 border-l border-[var(--border-subtle)]">
          <span className="font-mono t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
            Just added
          </span>
        </div>
      )}
    </div>
  );

  if (isRail) {
    return (
      <div className="mt-5 rounded-2xl p-[1.5px] bezel-metal nb-seated">
        {content}
      </div>
    );
  }
  return content;
}
