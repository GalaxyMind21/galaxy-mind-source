"use client";

// Score-based easter egg ribbon shown next to the gauge when the
// verdict happens to land on a culturally significant Bitcoin number.
//
// Numbers honored:
//   • 21    — "Twenty-one. Like the supply." Most reverent number in
//             bitcoin culture.
//   • 100   — "SAYLOR-LEVEL CONVICTION." Maximum gauge — the moment
//             this fires is when Saylor would say "what are you waiting
//             for?"
//   •  0    — "Even Saylor would wait." Inverse — the gauge has called
//             every cycle top this low has historically come close to.
//   • 69    — "Nice." Universal humor, deserves a tiny nod.
//   • 42    — "The answer." HHGTTG reference, fits the analytics tone.
//
// All show as a small ribbon below the gauge that fades in once and
// auto-disappears after 6 seconds. Visitor can dismiss with a click.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SCORE_RIBBONS: Record<
  number,
  { label: string; sub: string; color: string }
> = {
  21: {
    label: "Twenty-one.",
    sub: "Like the supply.",
    color: "var(--accent)",
  },
  42: {
    label: "The answer.",
    sub: "Hitchhiker-grade verdict.",
    color: "#A78BFA",
  },
  69: {
    label: "Nice.",
    sub: "·",
    color: "#FB923C",
  },
  100: {
    label: "SAYLOR-LEVEL CONVICTION.",
    sub: "What are you waiting for?",
    color: "var(--accent)",
  },
  0: {
    label: "Even Saylor would wait.",
    sub: "Cycle top territory.",
    color: "var(--cool-ink)",
  },
};

export function ScoreEasterEgg({ score }: { score: number }) {
  const [show, setShow] = useState(true);
  const ribbon = SCORE_RIBBONS[score];

  // Auto-dismiss after 6 seconds
  useEffect(() => {
    if (!ribbon) return;
    const t = setTimeout(() => setShow(false), 6000);
    return () => clearTimeout(t);
  }, [ribbon]);

  if (!ribbon || !show) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="mt-3 flex justify-center"
        initial={{ opacity: 0, y: 6, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.95 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <button
          onClick={() => setShow(false)}
          className="micro-label px-3 py-1.5 rounded-full border bg-[var(--bg-elevated)]/80 backdrop-blur-sm hover:scale-105 transition-transform"
          style={{
            borderColor: ribbon.color,
            color: ribbon.color,
            boxShadow: `0 0 16px ${ribbon.color}40`,
          }}
          aria-label={`Easter egg: score ${score}`}
        >
          ★ {ribbon.label}{" "}
          <span className="text-[var(--text-tertiary)] normal-case tracking-wider">
            {ribbon.sub}
          </span>
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
