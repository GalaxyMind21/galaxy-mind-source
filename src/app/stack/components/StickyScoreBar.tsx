"use client";

/* =====================================================================
 * StickyScoreBar
 *
 * Pinned-to-top chip that appears once the user has scrolled past the
 * gauge. Keeps the verdict ("STACK NOW · 72/100") in their peripheral
 * vision while they're reading the contrarian thesis / signal cockpit
 * / DCA backtest below — every section becomes re-anchored to the
 * single answer the page exists to give.
 *
 * Visibility logic:
 *   - Hidden when window.scrollY < gauge.bottom (gauge still on screen)
 *   - Visible otherwise — slides down from the top edge with a
 *     soft-spring animation
 *
 * Tap behavior:
 *   - Click the bar → smooth-scroll back to the gauge
 *
 * Server-friendly: takes a static `score` + `tier` snapshot prop, so
 * it doesn't need to re-fetch verdict data. Lives inside StackContent
 * which already has the verdict in scope.
 * ===================================================================== */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { StackTier } from "@/lib/stack";
import { TIER_LABEL } from "@/lib/stack";

const ICE_GLOW = "var(--cool-ink)";

type Props = {
  score: number;
  tier: StackTier;
};

export function StickyScoreBar({ score, tier }: Props) {
  const [visible, setVisible] = useState(false);

  // Show/hide based on scroll position. We watch for the gauge SVG to
  // be off-screen above the viewport. Throttled with rAF so we don't
  // burn CPU on scroll.
  useEffect(() => {
    let rafId: number | null = null;
    const update = () => {
      rafId = null;
      // The gauge has role="slider" — easiest stable selector.
      const gauge = document.querySelector('[role="slider"]');
      if (!gauge) return;
      const rect = gauge.getBoundingClientRect();
      // Show when the gauge's bottom has crossed above the viewport top
      // by at least a small margin (avoids flicker right at the edge).
      const shouldShow = rect.bottom < -20;
      setVisible(shouldShow);
    };
    const onScroll = () => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Smooth scroll back to the gauge on click.
  const onTap = useCallback(() => {
    const gauge = document.querySelector('[role="slider"]');
    if (!gauge) return;
    const rect = gauge.getBoundingClientRect();
    window.scrollTo({
      top: window.scrollY + rect.top - 80,
      behavior: "smooth",
    });
  }, []);

  // Color theming — matches the gauge's tier coloring.
  const isFrozen = score < 40;
  const inBuyZone = score >= 65;
  const accentColor = inBuyZone
    ? "var(--accent)"
    : isFrozen
      ? ICE_GLOW
      : "var(--text-secondary)";
  const glow = inBuyZone
    ? "0 0 20px rgba(247,147,26,0.45)"
    : isFrozen
      ? "0 0 20px rgba(126,192,255,0.4)"
      : "none";

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={onTap}
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 24 }}
          // top offset clears the sticky SiteHeader (h-14 on mobile,
          // h-16 on sm+). Without this the chip's z-40 paints over
          // the header's z-30, occluding the brand wordmark + CTA.
          // Audit 2026-05-22 · was top-3 (12px) → overlapped header.
          className="fixed top-[60px] sm:top-[72px] left-1/2 -translate-x-1/2 z-40 inline-flex items-baseline gap-2.5 px-4 py-2 rounded-full backdrop-blur-md border bg-[var(--bg-base)]/80 cursor-pointer hover:bg-[var(--bg-elevated)]/95 transition-colors"
          style={{
            borderColor: accentColor,
            boxShadow: glow,
          }}
          aria-label={`Bitcoin Buying Gauge · ${TIER_LABEL[tier]}, score ${score} of 100. Click to return to gauge.`}
        >
          {/* Mini-pulse dot in the tier color */}
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: accentColor,
              boxShadow: `0 0 6px ${accentColor}`,
              animation: "stickyPulse 1.6s ease-in-out infinite",
            }}
            aria-hidden
          />
          <span
            className="micro-label"
            style={{ color: accentColor }}
          >
            {TIER_LABEL[tier]}
          </span>
          <span className="font-mono text-sm tabular-nums text-[var(--text-primary)] font-semibold">
            {score}
            <span className="text-[var(--text-tertiary)] t-xs ml-0.5">/100</span>
          </span>
          <span className="micro-label text-[var(--text-tertiary)] ml-1">
            ↑ gauge
          </span>
          <style>{`
            @keyframes stickyPulse {
              0%, 100% { opacity: 0.5; }
              50%      { opacity: 1; }
            }
          `}</style>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
