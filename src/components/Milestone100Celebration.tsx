"use client";

// 100-vendor celebration · POPULAR-EXTENSION mode (operator request
// 2026-05-16). It started as a one-time, count-gated, 3-day overlay;
// the confetti proved popular, so for ONE WEEK it now fires for
// EVERYONE on EVERY homepage visit, regardless of vendor count.
//
// Auto-deprecates: after MILESTONE_DATE + WINDOW_MS the component
// renders null with no code change (ship-and-forget). It can then be
// deleted entirely. There is NO localStorage (intentionally fires
// every visit). Dismiss is session-only — it returns on reload, by
// design ("pop up for everyone for the week"). prefers-reduced-motion
// still skips the particle burst; the ribbon still shows (a11y).
//
// Hand-rolled canvas confetti (no dependency), removed from the DOM
// ~2.6s after firing.

import { useEffect, useRef, useState } from "react";

// 2026-05-16 00:00 UTC · the day the roster crossed 100.
const MILESTONE_DATE = Date.UTC(2026, 4, 16);
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // ~7 days, then auto-off

export function Milestone100Celebration() {
  const [show, setShow] = useState(false);
  const [fireConfetti, setFireConfetti] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Client-only decision (clock only), so SSR is always null → no
  // hydration mismatch. Runs once per mount → fires on every visit
  // within the window, for every visitor (no localStorage gate).
  useEffect(() => {
    if (Date.now() > MILESTONE_DATE + WINDOW_MS) return; // auto-deprecated
    setShow(true);
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!reduce) setFireConfetti(true);
  }, []);

  // Hand-rolled confetti · ~2.6s, then the canvas unmounts itself.
  useEffect(() => {
    if (!fireConfetti) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const COLORS = ["#F7931A", "#FFD591", "#FFFFFF", "#4ADE80"];
    const particles = Array.from({ length: 150 }, () => ({
      x: Math.random() * W,
      y: -20 - Math.random() * H * 0.3,
      vx: (Math.random() - 0.5) * 6,
      vy: 3 + Math.random() * 5,
      size: 5 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[(Math.random() * COLORS.length) | 0],
    }));

    const start = performance.now();
    const DURATION = 2600;
    let raf = 0;

    const tick = (t: number) => {
      const elapsed = t - start;
      const fade = elapsed > DURATION - 600 ? Math.max(0, (DURATION - elapsed) / 600) : 1;
      ctx.clearRect(0, 0, W, H);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12; // gravity
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = fade;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (elapsed < DURATION) {
        raf = requestAnimationFrame(tick);
      } else {
        setFireConfetti(false); // unmount the canvas
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fireConfetti]);

  if (!show) return null;

  // Session-only · no persistence. It returns on the next visit/reload
  // for the duration of the week (operator intent).
  function dismiss() {
    setShow(false);
    setFireConfetti(false);
  }

  return (
    <>
      {fireConfetti && (
        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[60]"
          style={{ width: "100vw", height: "100vh" }}
        />
      )}
      <div
        role="status"
        className="relative z-[55] border-b border-[var(--accent)]/40 bg-[var(--accent)]/10"
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3">
          <span aria-hidden className="text-base">
            🎉
          </span>
          <p className="flex-1 t-xs sm:text-sm text-[var(--text-primary)] leading-snug">
            <span className="font-semibold text-[var(--accent-ink)]">
              100 vendors.
            </span>{" "}
            The directory passed 100 merchants accepting bitcoin for everyday
            goods. Thank you for building the circular economy.
          </p>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss the celebration"
            className="shrink-0 rounded-md px-2 py-1 font-mono text-[15px] leading-none text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
    </>
  );
}
