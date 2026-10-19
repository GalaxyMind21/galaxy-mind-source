"use client";

// A quiet, tasteful rotating Michael Saylor quote strip · the
// site-wide "bitcoin meme culture" injection on /float, /treasuries,
// and /fit (the /stack loading screen + 21-click egg have their own
// renderers; all three pull the SAME shared list so the voice is
// consistent). Deliberately understated: this sits in the calm space
// between the dense data and the footer, not over the tools.
//
// Theme-safe by construction · it renders on the page background
// (which flips light/dark), so the theme vars below adapt correctly.
// Reduced-motion: no auto-rotate and no fade · shows one quote
// statically (still randomized per visit).

import { useEffect, useState } from "react";
import { SAYLOR_QUOTES } from "@/lib/saylor-quotes";

export function SaylorQuoteStrip() {
  // Start at 0 to match SSR (no hydration mismatch); the client
  // randomizes the start in the effect so different pages/visits open
  // on different quotes, then it rotates sequentially.
  const [i, setI] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    setI(Math.floor(Math.random() * SAYLOR_QUOTES.length));
    if (mq.matches) return; // respect reduced motion · no rotation
    const id = window.setInterval(
      () => setI((p) => (p + 1) % SAYLOR_QUOTES.length),
      7000,
    );
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <div className="text-center">
        <div className="micro-label text-[var(--text-tertiary)] mb-3">
          Words to stack by
        </div>
        <blockquote
          key={i}
          className={`text-[var(--text-secondary)] text-lg sm:text-xl italic leading-snug max-w-2xl mx-auto ${
            reduced ? "" : "sq-fade"
          }`}
        >
          {SAYLOR_QUOTES[i]}
        </blockquote>
        <div className="mt-2 t-xs font-medium text-[var(--accent-ink)]">
          · Michael Saylor
        </div>
      </div>
      <style>{`@keyframes sq-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}.sq-fade{animation:sq-fade .5s ease-out}`}</style>
    </section>
  );
}
