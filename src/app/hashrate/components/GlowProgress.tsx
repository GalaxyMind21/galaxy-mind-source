"use client";
// Glowing progress ring with honest step copy, for the moments a renter waits on us:
// confirming a payment, reserving rigs, switching them to the pool. the operator 2026-10-17: "a nice
// animation or spinning glowing circle so the human knows it hasn't timed out". The ring spins
// (a still ring under prefers-reduced-motion), the elapsed clock ticks every second, and after
// `slowAfterSec` a calm fallback line says what is happening and what not to do.
import { useEffect, useState } from "react";

export type GlowStep = { label: string };

export function GlowProgress({
  title,
  steps,
  active,
  slowAfterSec = 60,
  slowCopy = "Still working on it. Your payment is safe; please don't pay again. You can keep this page open or come back later on this device.",
  note,
}: {
  title: string;
  steps: GlowStep[];
  /** Index of the step in progress; earlier steps show as done. */
  active: number;
  slowAfterSec?: number;
  slowCopy?: string;
  note?: string;
}) {
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - t0) / 1000));
  const slow = secs >= slowAfterSec;
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <div className="glow-progress rent-glass rounded-2xl p-5 sm:p-6" role="status" aria-live="polite" data-glow-progress>
      <div className="flex items-center gap-4">
        <span className="glow-ring" aria-hidden>
          <span className="glow-ring-core" />
        </span>
        <div className="min-w-0">
          <p className="text-[17px] font-semibold text-[var(--text-primary)]">{title}</p>
          <p className="mt-0.5 font-mono text-[13px] tabular-nums text-[var(--text-tertiary)]" aria-label={`${secs} seconds elapsed`}>
            {clock} elapsed
          </p>
        </div>
      </div>
      <ol className="mt-5 space-y-2.5">
        {steps.map((s, i) => {
          const state = i < active ? "done" : i === active ? "now" : "next";
          return (
            <li key={s.label} className="flex items-center gap-3 text-[15px]" data-step-state={state}>
              <span
                aria-hidden
                className={
                  state === "done"
                    ? "flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[12px] font-bold text-black"
                    : state === "now"
                      ? "glow-dot h-5 w-5 rounded-full border-2 border-[var(--accent)]"
                      : "h-5 w-5 rounded-full border border-[var(--nb-hair-2)]"
                }
              >
                {state === "done" ? "✓" : null}
              </span>
              <span className={state === "next" ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"}>
                {s.label}
                {state === "now" ? "…" : ""}
              </span>
              <span className="sr-only">{state === "done" ? " (done)" : state === "now" ? " (in progress)" : ""}</span>
            </li>
          );
        })}
      </ol>
      {note && <p className="mt-4 text-[14px] leading-relaxed text-[var(--text-secondary)]">{note}</p>}
      {slow && <p className="mt-4 rounded-lg border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-4 py-3 text-[14px] leading-relaxed text-[var(--text-primary)]" data-glow-slow>{slowCopy}</p>}
    </div>
  );
}
