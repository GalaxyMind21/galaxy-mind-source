"use client";

// Live countdown to the next forecasted "strong accumulation window."
//
// The server (StackContent) computes the bestWindow from the 168-cell
// forecast and captures the exact target wallclock as targetMs (the
// hour-boundary milliseconds of the forecast cell start). This client
// component just renders "in Xh Ym" relative to now, ticking once a
// minute · no per-second precision needed for an hours-out forecast.
//
// Why this exists (retention rationale): the static "Sun 2am-4am ET"
// label is informational but not actionable. A countdown converts a
// passive readout into a scheduled appointment · a concrete reason to
// return at a specific time. Pairs with the opt-in
// notifyOnForecastWindow alert (A5b) that emails when an imminent
// window approaches.

import { useEffect, useState } from "react";

export function BestWindowCountdown({
  targetMs,
  windowLabel,
  windowScore,
}: {
  targetMs: number;
  windowLabel: string;
  windowScore: number;
}) {
  // Initial state seeds from Date.now() at mount, NOT a server-passed
  // value. This avoids any hydration mismatch · the value is only used
  // after the effect runs anyway.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = targetMs - now;
  let label: string;
  if (remainingMs <= 0) {
    // The forecast cell has passed since SSR. The next page load will
    // re-pick a fresh bestWindow; until then, say so honestly rather
    // than render a stale countdown.
    label = "open now";
  } else if (remainingMs < 60 * 60_000) {
    const m = Math.max(1, Math.ceil(remainingMs / 60_000));
    label = `in ${m}m`;
  } else {
    const totalMin = Math.floor(remainingMs / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    label = m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
  }

  return (
    <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
      <span className="micro-label text-[var(--text-tertiary)]">
        Next strong window
      </span>{" "}
      <span className="text-[var(--accent-ink)] font-semibold">{label}</span>
      <span className="text-[var(--text-tertiary)]"> · {windowLabel}</span>
      <span className="text-[var(--text-tertiary)]">
        {" "}
        · projected {windowScore}/100
      </span>
    </p>
  );
}
