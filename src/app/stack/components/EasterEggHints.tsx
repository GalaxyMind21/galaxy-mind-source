"use client";

/* =====================================================================
 * EasterEggHints
 *
 * Tiny footer chip on /stack that reveals "X hidden things on this
 * page" — gives HINTS not solutions, so the discovery moment is still
 * earned. Drives engagement (users will go play with the gauge once
 * they know there's something to find).
 *
 * Why hints instead of giving everything away:
 *   - Solving an Easter egg yourself is the satisfaction.
 *   - Telling the user "click any rivet on the bezel" makes the
 *     discovery feel mechanical instead of magical.
 *   - Hints calibrated to point at the surface, not the move.
 *
 * Tracked via Vercel Analytics so we can see if anyone opens it.
 * ===================================================================== */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { track } from "@vercel/analytics";

type EggHint = {
  emoji: string;
  hint: string;
  // Optional ultra-specific clue users can hover/tap to peek at —
  // for the genuinely stuck.
  peek?: string;
};

const HINTS: EggHint[] = [
  {
    emoji: "🪛",
    hint: "The bezel has fasteners. Proper instruments rattle when you touch them.",
    peek: "Click any rivet around the metallic ring.",
  },
  {
    emoji: "🎯",
    hint: "The hub at the needle's center reacts to a deliberate gesture.",
    peek: "Double-click the orange hub.",
  },
  {
    emoji: "🎰",
    hint: "Certain scores are culturally meaningful. The gauge knows.",
    peek: "Push the score (drag, sliders, or arrow keys) to 21, 42, 69, 100, or 0.",
  },
  {
    emoji: "₿",
    hint: "Twenty-one. Like the supply. The brand mark counts.",
    peek: "Click the GALAXY MIND logo 21 times.",
  },
  {
    emoji: "⌨️",
    hint: "Type a Bitcoiner word. Anywhere on the page.",
    peek: "Try: saylor, hodl, fiat, moon, laser, pizza, 21m.",
  },
  {
    emoji: "🐝",
    hint: "Old thumbs remember a certain cheat. The swarm answers to it.",
    peek: "Konami code: ↑ ↑ ↓ ↓ ← → ← → B A.",
  },
  {
    emoji: "🎹",
    hint: "The gauge is a slider · keyboard nav included.",
    peek: "Focus the gauge, then arrows · PgUp/Dn · Home/End · Space.",
  },
  {
    emoji: "🔊",
    hint: "There's a tiny audio synth waiting in the off position.",
    peek: "Toggle Sound on, then drag the needle around.",
  },
];

export function EasterEggHints() {
  const [open, setOpen] = useState(false);
  const [peeking, setPeeking] = useState<number | null>(null);

  return (
    <div className="text-center mt-12">
      <button
        type="button"
        onClick={() => {
          if (!open) track("stack_eggs_opened");
          setOpen((v) => !v);
        }}
        className="micro-label text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors px-3 py-1.5 rounded-full border border-[var(--border-subtle)] hover:border-[var(--accent)]/40"
        aria-expanded={open}
      >
        🥚 {HINTS.length} hidden things on this page
        <span className="ml-2 opacity-60">{open ? "↑" : "↓"}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 16 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="max-w-2xl mx-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 text-left">
              <div className="micro-label text-[var(--text-tertiary)] mb-3">
                Hints · try to find them
              </div>
              <ul className="space-y-2.5 text-sm text-[var(--text-secondary)]">
                {HINTS.map((h, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="text-base leading-snug" aria-hidden>
                      {h.emoji}
                    </span>
                    <div className="flex-1 leading-relaxed">
                      {h.hint}{" "}
                      {h.peek && (
                        <button
                          type="button"
                          onClick={() => {
                            setPeeking((p) => (p === i ? null : i));
                            track("stack_eggs_peek");
                          }}
                          className="micro-label ml-1 text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] transition-colors"
                        >
                          {peeking === i ? "hide" : "peek"}
                        </button>
                      )}
                      {peeking === i && h.peek && (
                        <div className="mt-1 t-xs text-[var(--accent-ink)] font-mono">
                          ↳ {h.peek}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="micro-label mt-4 pt-3 border-t border-[var(--border-subtle)] text-[var(--text-tertiary)] text-center">
                no points · just delight
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
