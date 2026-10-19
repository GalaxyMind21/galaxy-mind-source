"use client";

/* =====================================================================
 * SupplyStory · scrollytelling wrapper for the 21M grid (B7 · 2026-07-07)
 *
 * On lg+ the server-rendered TwentyOneMillionGrid goes sticky while
 * four caption steps scroll past in a side rail. Each step dims every
 * cohort except the one it narrates (CSS transitions keyed off a
 * data-step attribute · see .supply-story rules in globals.css), so
 * the supply story physically happens under the reader's scroll:
 * the dark mass of lost coins, the institutional lock-up, then the
 * startlingly small orange that is actually for sale.
 *
 * Engineering constraints honored:
 *   · The grid stays a SERVER component (crawlable SVG, no-JS
 *     visitors get the full graphic) · this wrapper only decorates.
 *   · Step detection is IntersectionObserver, not scroll-linked rAF ·
 *     works everywhere, costs nothing between steps.
 *   · Animation is a single CSS opacity transition; prefers-reduced-
 *     motion turns it off (instant swaps) via the media query in
 *     globals.css. Default step is "all", so SSR + no-JS render the
 *     untouched grid.
 *   · Below lg the rail is hidden and the grid renders exactly as
 *     before · zero mobile risk, no double-render.
 * ===================================================================== */

import { useEffect, useRef, useState, type ReactNode } from "react";

export type SupplyStoryStep = {
  id: "lost" | "tracked" | "available" | "all";
  title: string;
  body: string;
};

export function SupplyStory({
  steps,
  children,
}: {
  steps: SupplyStoryStep[];
  children: ReactNode;
}) {
  const [step, setStep] = useState<SupplyStoryStep["id"]>("all");
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    // Story mode is a lg+ affordance · on smaller screens the rail is
    // display:none. The breakpoint is LIVE, not mount-sampled: crossing
    // it (tablet rotation, window resize) attaches/detaches the
    // observer and resets the step, so the grid can never get stuck
    // dimmed on mobile nor arrive at lg with the observer missing.
    const mq = window.matchMedia("(min-width: 1024px)");
    let io: IntersectionObserver | null = null;

    const attach = () => {
      if (io) return;
      const sentinels = Array.from(
        rail.querySelectorAll<HTMLElement>("[data-story-step]"),
      );
      if (sentinels.length === 0) return;
      io = new IntersectionObserver(
        (entries) => {
          // Pick the most-visible intersecting sentinel · scrolling up
          // and down both settle on the right step.
          const visible = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (visible) {
            const id = visible.target.getAttribute(
              "data-story-step",
            ) as SupplyStoryStep["id"] | null;
            if (id) setStep(id);
          }
        },
        { threshold: [0.4, 0.6], rootMargin: "-15% 0px -15% 0px" },
      );
      for (const el of sentinels) io.observe(el);
    };

    const sync = () => {
      if (mq.matches) {
        attach();
      } else {
        io?.disconnect();
        io = null;
        setStep("all");
      }
    };

    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      io?.disconnect();
      io = null;
    };
  }, []);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8 lg:items-start">
      <div
        className="supply-story lg:sticky lg:top-24"
        data-step={step}
      >
        {children}
      </div>
      {/* Caption rail · sentinel per step. Generous heights give each
          beat room to breathe; the final "all" step restores the full
          grid as the reader exits the section. */}
      <div ref={railRef} className="hidden lg:block" aria-hidden={false}>
        {steps.map((s) => (
          <div
            key={s.id}
            data-story-step={s.id}
            className="min-h-[55vh] flex items-center"
          >
            <div
              className={`rounded-xl border p-5 transition-colors duration-300 ${
                step === s.id
                  ? "border-[var(--accent)]/50 bg-[var(--bg-elevated)] elevate"
                  : "border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50"
              }`}
            >
              <div
                className={`font-mono t-xs uppercase tracking-[0.22em] mb-2 ${
                  step === s.id
                    ? "text-[var(--accent-ink)]"
                    : "text-[var(--text-tertiary)]"
                }`}
              >
                {s.title}
              </div>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                {s.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
