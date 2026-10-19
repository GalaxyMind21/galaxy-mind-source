/* =====================================================================
 * VendorPager · prev/next/random navigation strip at the top of
 * /v/[slug]. Server component · no client JS, deterministic at
 * build time.
 *
 * Why: /v/[slug] is the strongest acquisition surface (vendor's RT
 * lands their audience here). Today, when a curious visitor lands
 * on a vendor page, the only forward paths are:
 *   - Click the vendor's external profile (we lose them)
 *   - Scroll to "More {category} vendors" (3 picks)
 *   - Click "← All vendors" back to the directory (cognitive cost)
 *
 * A pager turns vendor-page browsing into a swipe-able feed:
 * one tap to the next vendor, one tap back. Wrap-around (last →
 * first, first → last) means there's no dead-end.
 *
 * Random pick is the engagement hack: "give me a surprise" beats
 * "let me think about what to look at next" for the casual visitor
 * who isn't searching for anything specific.
 *
 * Mobile-first: 3 large tap targets across the full width, with
 * the vendor's "X of N" position in the middle as a deterministic
 * anchor.
 * ===================================================================== */

import Link from "next/link";
import { VENDORS, vendorSlug, type Vendor } from "@/lib/vendors";

// Build the navigable order ONCE per render. Sort by addedAt so
// prev/next walk in the same order as the directory's "Newest First"
// default, but ascending so the EARLIEST vendor is index 0 (more
// stable for a "1 of N" mental model · longer-tenured = lower number).
const ORDERED = [...VENDORS].sort((a, b) => a.addedAt - b.addedAt);
const ORDERED_SLUGS = ORDERED.map((v) => vendorSlug(v));

// Deterministic "random next" picker: pick the vendor whose slug-hash
// is N positions away in a shuffle that's seeded by the current
// vendor's handle. This means "random" is stable per-vendor (no
// hydration mismatch) but feels random to a visitor moving through
// the catalogue.
function pickRandomNeighbor(currentIdx: number, currentHandle: string): Vendor {
  // Simple deterministic offset: hash the handle to a value in [3, N-3]
  // so we don't just hop to the immediate neighbor (boring) or the
  // exact opposite (predictable).
  let seed = 0;
  for (let i = 0; i < currentHandle.length; i++) {
    seed = (seed * 31 + currentHandle.charCodeAt(i)) | 0;
  }
  const range = ORDERED.length - 1;
  if (range <= 0) return ORDERED[currentIdx]!;
  const offset = (Math.abs(seed) % (range - 2)) + 3; // [3, range-1]
  const idx = (currentIdx + offset) % ORDERED.length;
  return ORDERED[idx]!;
}

export function VendorPager({ currentKey }: { currentKey: string }) {
  // Located by listing key (slug): one handle may run several shops.
  const currentIdx = ORDERED_SLUGS.indexOf(currentKey);
  if (currentIdx < 0 || ORDERED.length < 2) return null;
  // The random-hop seed stays the handle so every existing page keeps
  // the exact same "random" neighbour it had before the key move.
  const currentHandle = ORDERED[currentIdx]!.handle;

  // Wrap-around so there's never a dead-end. Last → first, first → last.
  const prevIdx = (currentIdx - 1 + ORDERED.length) % ORDERED.length;
  const nextIdx = (currentIdx + 1) % ORDERED.length;

  const prev = ORDERED[prevIdx]!;
  const next = ORDERED[nextIdx]!;
  const random = pickRandomNeighbor(currentIdx, currentHandle);

  const prevSlug = ORDERED_SLUGS[prevIdx];
  const nextSlug = ORDERED_SLUGS[nextIdx];
  const randomSlug = vendorSlug(random);

  return (
    <nav
      aria-label="Vendor navigation"
      className="flex items-stretch gap-2 mb-6"
    >
      <Link
        href={`/v/${prevSlug}`}
        className="flex-1 group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 hover:bg-[var(--bg-elevated)] hover:border-[var(--accent)]/40 px-3 py-2 transition-colors min-w-0"
        aria-label={`Previous vendor: ${prev.name}`}
        rel="prev"
      >
        <div className="t-xs font-medium text-[var(--text-tertiary)] group-hover:text-[var(--accent-ink)] transition-colors">
          ← Prev
        </div>
        <div className="text-xs text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] truncate transition-colors">
          {prev.name}
        </div>
      </Link>

      <Link
        href={`/v/${randomSlug}`}
        className="shrink-0 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 hover:bg-[var(--accent)]/10 px-3 py-2 flex flex-col items-center justify-center transition-colors"
        aria-label={`Random vendor: ${random.name}`}
        title={`Surprise me · jump to ${random.name}`}
      >
        <div className="micro-label text-[var(--accent-ink)] leading-tight">
          ⌬
        </div>
        <div className="micro-label text-[var(--accent-ink)] leading-tight tabular-nums">
          {currentIdx + 1}/{ORDERED.length}
        </div>
      </Link>

      <Link
        href={`/v/${nextSlug}`}
        className="flex-1 group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 hover:bg-[var(--bg-elevated)] hover:border-[var(--accent)]/40 px-3 py-2 transition-colors text-right min-w-0"
        aria-label={`Next vendor: ${next.name}`}
        rel="next"
      >
        <div className="t-xs font-medium text-[var(--text-tertiary)] group-hover:text-[var(--accent-ink)] transition-colors">
          Next →
        </div>
        <div className="text-xs text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] truncate transition-colors">
          {next.name}
        </div>
      </Link>
    </nav>
  );
}
