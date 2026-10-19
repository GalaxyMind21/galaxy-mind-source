"use client";

/* =====================================================================
 * StickyPortfolioBar
 *
 * Pinned-to-top chip that appears once the user has scrolled past the
 * "Your Portfolio" ResultCard on /fit. Mirrors the StickyScoreBar
 * pattern from /stack: a single-row reminder of the answer the page
 * exists to give, kept in peripheral vision while the visitor reads
 * the expected-return panel, scenario compare, backtest chart, and
 * "how calculated" prose below.
 *
 * Why this matters:
 * /fit's value-prop is the recommended sleeve mix. Without a sticky
 * anchor, the moment the user scrolls into the supporting sections
 * the answer falls off-screen and they have to scroll back up to
 * remember what it was. The sticky bar collapses that mental cost.
 *
 * Visibility logic:
 *   - Hidden when ResultCard's bottom is still on-screen
 *   - Visible once ResultCard has scrolled fully above the viewport
 *
 * Tap behavior:
 *   - Click → smooth-scroll back to ResultCard
 *
 * Server-friendly: takes static snapshot props (top sleeves, tolerance
 * label, horizon). Doesn't refetch · all data already lives on /fit
 * via the live recommendation memo.
 * ===================================================================== */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type SleeveSummary = {
  ticker: string;
  pct: number;
};

type Props = {
  // Top 2-3 sleeves by weight. Caller decides how many to pass.
  topSleeves: SleeveSummary[];
  // Compact label e.g. "Maxi · 10y · Roth". Free-form so the page can
  // build whatever string fits its tier vocabulary.
  summary: string;
  // Total sleeve count, shown after the visible top sleeves so users
  // know there are more positions ("+ 4 more" hint).
  totalSleeves: number;
};

export function StickyPortfolioBar({
  topSleeves,
  summary,
  totalSleeves,
}: Props) {
  const [visible, setVisible] = useState(false);

  // Show/hide based on scroll position. Watch for the ResultCard to be
  // off-screen above the viewport. Throttled with rAF so we don't burn
  // CPU on scroll. Selector matches the data-fit-result attribute on
  // ResultCard's wrapper div.
  useEffect(() => {
    let rafId: number | null = null;
    const update = () => {
      rafId = null;
      const card = document.querySelector("[data-fit-result]");
      if (!card) {
        setVisible(false);
        return;
      }
      const rect = card.getBoundingClientRect();
      // Show when card's bottom has crossed above the viewport top by a
      // small margin (avoids flicker right at the edge).
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

  // Smooth scroll back to ResultCard on click.
  const onTap = useCallback(() => {
    const card = document.querySelector("[data-fit-result]");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    window.scrollTo({
      top: window.scrollY + rect.top - 80,
      behavior: "smooth",
    });
  }, []);

  const remaining = Math.max(0, totalSleeves - topSleeves.length);

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
          className="fixed top-3 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-2.5 px-4 py-2 rounded-full backdrop-blur-md border border-[var(--accent)] bg-[var(--bg-base)]/85 cursor-pointer hover:bg-[var(--bg-elevated)]/95 transition-colors max-w-[92vw]"
          style={{
            // Lit, not emissive (spec 4.7). This chip floats over the page,
            // so it is seated like the rest of the floating chrome; the
            // accent border alone already carries "this is your portfolio".
            boxShadow: "var(--nb-lift-lamp)",
          }}
          aria-label={`Your portfolio · ${summary}. Click to return to recommendation.`}
        >
          {/* Pulse dot in accent color · matches StickyScoreBar's
              visual rhythm so the two stickys feel like siblings. */}
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: "var(--accent)",
              boxShadow: "0 0 6px var(--accent)",
              animation: "stickyPortfolioPulse 1.6s ease-in-out infinite",
            }}
            aria-hidden
          />
          <span className="t-xs font-medium text-[var(--accent-ink)] hidden sm:inline">
            Your Portfolio
          </span>
          <span className="t-xs font-medium text-[var(--text-tertiary)] hidden md:inline">
            ·
          </span>
          {/* Top sleeves rendered as ticker:pct pills · the at-a-glance
              answer. tabular-nums keeps the % aligned across rerenders. */}
          <span className="flex items-baseline gap-1.5 font-mono text-xs tabular-nums text-[var(--text-primary)] truncate">
            {topSleeves.map((s, i) => (
              <span key={s.ticker} className="inline-flex items-baseline gap-1">
                <span className="font-semibold">{s.ticker}</span>
                <span className="text-[var(--accent-ink)]">
                  {Math.round(s.pct * 100)}%
                </span>
                {i < topSleeves.length - 1 && (
                  <span className="text-[var(--text-tertiary)] ml-0.5">·</span>
                )}
              </span>
            ))}
            {remaining > 0 && (
              <span className="text-[var(--text-tertiary)] t-xs ml-1">
                +{remaining}
              </span>
            )}
          </span>
          <span className="t-xs text-[var(--text-tertiary)] ml-1 shrink-0">
            ↑
          </span>
          <style>{`
            @keyframes stickyPortfolioPulse {
              0%, 100% { opacity: 0.5; }
              50%      { opacity: 1; }
            }
          `}</style>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
