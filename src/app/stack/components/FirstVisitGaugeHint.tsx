"use client";

/* =====================================================================
 * FirstVisitGaugeHint · "Try dragging the dial" inline hint
 *
 * Shown UNDER the PressureGauge to first-time /stack visitors so they
 * discover the gauge is interactive. Fades in 600ms after mount,
 * fades out after 8s, and sets a localStorage flag so it never
 * appears again on that device.
 *
 * Why: the gauge LOOKS like a static decoration; the dial-drag
 * physics + simulation mode + sound toggle are the engagement
 * surface but no first-visit signal points at them. A small
 * one-time hint lifts the discovery rate without bloating the page
 * for repeat visitors.
 *
 * Storage: localStorage.gm_stack_hint_seen · once true, hint never
 * shows again on this device (testing reset = devtools clear).
 *
 * Mobile-friendly: small chip-style hint, doesn't compete with the
 * gauge. Disappears on tap.
 * ===================================================================== */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const LS_HINT_SEEN = "gm_stack_hint_seen";
const FADE_OUT_AFTER_MS = 8_000;
const FADE_IN_DELAY_MS = 600;

export function FirstVisitGaugeHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // try/catch: Safari private mode throws on localStorage access ·
    // a crash here would take the hint AND its parent tree down.
    try {
      if (localStorage.getItem(LS_HINT_SEEN) === "1") return;
    } catch {
      return; // no storage → no way to mark seen → skip the hint
    }

    // Small delay so the hint appears AFTER the gauge has rendered ·
    // arriving with the gauge feels less like a teaching moment.
    const showTimer = setTimeout(() => setVisible(true), FADE_IN_DELAY_MS);
    const hideTimer = setTimeout(() => {
      setVisible(false);
      try {
        localStorage.setItem(LS_HINT_SEEN, "1");
      } catch {
        /* best-effort */
      }
    }, FADE_IN_DELAY_MS + FADE_OUT_AFTER_MS);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(LS_HINT_SEEN, "1");
    } catch {
      /* best-effort */
    }
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.4 }}
          className="mx-auto mt-2 max-w-fit"
        >
          <button
            type="button"
            onClick={dismiss}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--accent)]/40 text-[var(--text-secondary)] text-xs hover:bg-[var(--accent)]/10 transition-colors lit-active"
            aria-label="Try dragging the dial · tap to dismiss"
          >
            <span aria-hidden>🎮</span>
            <span>
              <span className="text-[var(--accent-ink)] font-semibold">Try dragging the dial</span>{" "}
              <span className="text-[var(--text-tertiary)]">· it&apos;s alive</span>
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
