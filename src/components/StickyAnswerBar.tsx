"use client";

/* =====================================================================
 * StickyAnswerBar · the /stack StickyScoreBar pattern, generalized
 * (UX audit 2026-07-13 · N3).
 *
 * /float and /treasuries are 5-6 screen pages whose ENTIRE reason for
 * existing is one number — the in-play BTC float, the cheapest-mNAV
 * treasury — yet that number scrolled away after ~1 screen with no
 * peripheral reminder (unlike /stack + /fit, which both ship a sticky
 * bar). This is the same top-anchored chip: it appears once the hero
 * (the element with id=targetId) scrolls above the viewport, keeps the
 * answer in view, and taps back up to it.
 *
 * Top-anchored on purpose (top-[60px] sm:top-[72px], clearing the
 * sticky SiteHeader) so it can never collide with the MobileBottomNav.
 * Scroll-listener (rAF-throttled), NOT IntersectionObserver, matching
 * the shipped StickyScoreBar. Renders from a server page with static
 * props (no re-fetch).
 * ===================================================================== */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Props = {
  /** id of the hero element to watch + scroll back to. */
  targetId: string;
  /** Short mono eyebrow, e.g. "IN PLAY" / "CHEAPEST". */
  label: string;
  /** The answer, e.g. "6.06M" / "MSTR 0.62×". */
  value: string;
};

export function StickyAnswerBar({ targetId, label, value }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let rafId: number | null = null;
    const update = () => {
      rafId = null;
      const t = document.getElementById(targetId);
      if (!t) return;
      // Show once the hero's bottom has crossed above the viewport top
      // (small margin avoids edge flicker) · same rule as StickyScoreBar.
      setVisible(t.getBoundingClientRect().bottom < -20);
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
  }, [targetId]);

  const onTap = useCallback(() => {
    const t = document.getElementById(targetId);
    if (!t) return;
    window.scrollTo({
      top: window.scrollY + t.getBoundingClientRect().top - 80,
      behavior: "smooth",
    });
  }, [targetId]);

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
          className="fixed top-[60px] sm:top-[72px] left-1/2 -translate-x-1/2 z-40 inline-flex items-baseline gap-2.5 rounded-full border border-[var(--accent)] bg-[var(--bg-base)]/80 px-4 py-2 backdrop-blur-md lit-active cursor-pointer hover:bg-[var(--bg-elevated)]/95 transition-colors"
          aria-label={`${label} ${value}. Tap to return to the top.`}
        >
          <span
            aria-hidden
            className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]"
            style={{ animation: "stickyAnsPulse 1.6s ease-in-out infinite" }}
          />
          <span className="micro-label text-[var(--accent-ink)]">
            {label}
          </span>
          <span className="font-mono text-sm tabular-nums font-semibold text-[var(--text-primary)]">
            {value}
          </span>
          <span className="t-xs text-[var(--text-tertiary)] ml-1">
            ↑
          </span>
          <style>{`
            @keyframes stickyAnsPulse {
              0%, 100% { opacity: 0.5; }
              50%      { opacity: 1; }
            }
          `}</style>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
