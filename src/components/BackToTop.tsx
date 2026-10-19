"use client";

/* =====================================================================
 * BackToTop · floating "↑" pill that appears once the visitor has
 * scrolled past a threshold. Smooth-scrolls back to the top on tap.
 *
 * Why: /float is a long-scroll page (~6+ viewport heights on mobile).
 * Without a scroll-up affordance, mobile users are stuck thumbing
 * all the way back up to switch tools or share. /stack used to share
 * this same need, but StickyScoreBar already shows the verdict chip
 * with tap-to-scroll-back UX once the gauge leaves the viewport ·
 * the BackToTop pill there was redundant AND its right-side position
 * sometimes overlapped MetricInfluencePanel slider thumbs on mobile.
 * So /stack opts out (path check below).
 *
 * Self-gating: the scroll-threshold check means this component is
 * effectively invisible on short pages (homepage above-the-fold,
 * /about, /faq) so we can safely mount it globally in the root
 * layout without per-page wiring.
 *
 * Positioning:
 *   - Anchored bottom-LEFT (2026-06-02). It used to live bottom-right,
 *     but StickySubscribeChip ("Get the signal") also owns the bottom-
 *     right and EXPANDS upward into a 360px card · the two collided
 *     there (operator report: overlap on Safari/desktop). The chip is
 *     the priority CTA with a variable footprint, so the fixed-size
 *     utility arrow is the one that moves. Left corner is free on both
 *     breakpoints (the only other bottom elements are the bottom-center
 *     easter-egg bubble and top-anchored sticky bars), so this removes
 *     the overlap entirely with no z-index coupling to the chip.
 *   - Mobile: bottom-[7rem] (clears the MobileBottomNav + iOS chrome)
 *   - Desktop: bottom-6 (no nav to dodge)
 *   - z-30 sits BELOW MobileBottomNav (z-40) so the nav always wins
 *     visually if there's an overlap (shouldn't happen given the
 *     bottom offsets but defensive).
 * ===================================================================== */

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const REVEAL_AT_PX = 800;

export function BackToTop() {
  const pathname = usePathname() ?? "/";
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function onScroll() {
      setVisible(window.scrollY > REVEAL_AT_PX);
    }

    onScroll();
    // passive listener — we don't preventDefault, browser optimizes scroll
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Opt out on /stack · StickyScoreBar already does this job (verdict
  // chip with tap-to-scroll-back) AND the right-side BackToTop pill
  // sometimes overlapped MetricInfluencePanel slider thumbs on mobile
  // (audit 2026-05-22). Path check is intentionally narrow so /float +
  // / + /treasuries + /fit still get the pill.
  if (pathname.startsWith("/stack")) return null;
  // /hashrate (2026-10-17 funnel): the mobile sticky "Rent hashrate" CTA owns the bottom edge there.
  if (pathname === "/hashrate") return null;
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Scroll back to top"
      title="Back to top"
      // Mobile bottom offset clears the MobileBottomNav (~64px) AND
      // iOS Safari's bottom toolbar / home indicator. iPhone bug
      // (audit 2026-05): plain bottom-20 (80px) sat behind Safari's
      // bottom chrome on large iPhones (17 Pro Max) → partially cut
      // off. 7rem clears nav + chrome; the env() term self-adds the
      // home-indicator inset where exposed (degrades to 0 otherwise —
      // we intentionally don't force viewport-fit:cover since the
      // sticky header lacks safe-area-inset-top and would slide under
      // the Dynamic Island).
      className="fixed left-4 sm:left-6 bottom-[calc(var(--mobile-nav-clearance)+3.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 z-30 w-11 h-11 sm:w-12 sm:h-12 rounded-full border border-[var(--accent)]/40 bg-[var(--bg-elevated)]/90 backdrop-blur-md text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 hover:border-[var(--accent)] hover:lit-active transition-all flex items-center justify-center text-lg font-bold"
    >
      <span aria-hidden>↑</span>
    </button>
  );
}
