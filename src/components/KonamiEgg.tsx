"use client";

// The Konami code · ↑ ↑ ↓ ↓ ← → ← → B A on the arcade hub rains a few
// coins and flashes WAGMI, then clears itself. Cosmetic only. Never
// steals keys from form fields, and honours reduced-motion (toast only,
// no falling coins).

import { useEffect, useState } from "react";

const SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

export function KonamiEgg() {
  const [active, setActive] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    let idx = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (e.key.toLowerCase() === SEQUENCE[idx].toLowerCase()) {
        idx += 1;
        if (idx === SEQUENCE.length) {
          idx = 0;
          setActive(true);
        }
      } else {
        // A wrong key restarts · but a fresh first key re-anchors so a
        // fumbled attempt doesn't need a full reset.
        idx = e.key.toLowerCase() === SEQUENCE[0].toLowerCase() ? 1 : 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setActive(false), 4200);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!active) return null;

  const coins = reduced ? [] : Array.from({ length: 18 });

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
    >
      <style>{`@keyframes gm-konami-fall{0%{transform:translateY(-12vh) rotate(0deg);opacity:0}10%{opacity:1}100%{transform:translateY(112vh) rotate(360deg);opacity:0.9}}`}</style>
      {coins.map((_, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${(i * 53) % 100}%`,
            top: 0,
            fontSize: `${18 + (i % 4) * 6}px`,
            color: "#F7931A",
            animation: `gm-konami-fall ${1.8 + (i % 5) * 0.25}s linear ${(i % 6) * 0.12}s 1`,
          }}
        >
          ₿
        </span>
      ))}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--accent)] bg-black/80 px-6 py-4 text-center">
        <div className="micro-label text-[var(--accent)]">
          ↑ ↑ ↓ ↓ ← → ← → B A
        </div>
        <div className="mt-1 font-mono text-lg font-bold tracking-[0.2em] text-[var(--text-primary)]">
          WAGMI
        </div>
      </div>
    </div>
  );
}
