"use client";

/* =====================================================================
 * LiveGaugeShell · client wrapper that re-fetches /api/stack
 * periodically and re-renders the PressureGauge with the fresh
 * verdict.
 *
 * Why: the /stack page is server-streamed once (Suspense around
 * GaugeWithBaseline). Without this wrapper a visitor sitting on
 * the page sees the same verdict for as long as the tab is open.
 * With this wrapper, the verdict re-fetches every 60s and the
 * PressureGauge's existing tier-transition useEffects fire sounds
 * + haptics when the score crosses a tier boundary · the page
 * becomes a live monitor.
 *
 * Server initial paint preserved
 * ──────────────────────────────
 * Initial state is hydrated from `initialVerdict` (passed by the
 * server-rendered parent), so the first paint matches the server's
 * HTML exactly · no flicker, no hydration warning. The polling
 * effect fires AFTER mount.
 *
 * Drag-friendly: PressureGauge's internal `displayedScore` is
 * derived as `dragScore ?? syntheticScore ?? simScore ?? actualScore`
 * (priority order). When the user is dragging, dragScore overrides
 * actualScore · our polling updates won't jerk the needle out from
 * under their finger.
 *
 * Battery-conscious: pauses polling when the tab is hidden via
 * visibilitychange. Resumes on re-focus with an immediate fetch so
 * a returning visitor sees fresh data right away.
 *
 * Failure mode: polling failures are silent. The displayed verdict
 * stays whatever the last successful fetch returned. The gauge keeps
 * working from the initial server-rendered data forever if /api/stack
 * is permanently down.
 * ===================================================================== */

import { useEffect, useRef, useState } from "react";
import type { StackVerdict } from "@/lib/stack";
import type { StackResponse } from "@/app/api/stack/route";
import { TIER_LABEL } from "@/lib/stack";
import { PressureGauge } from "./PressureGauge";

const POLL_INTERVAL_MS = 60_000;

export function LiveGaugeShell({
  initialVerdict,
  compareBaseline,
}: {
  initialVerdict: StackVerdict;
  compareBaseline: { score: number; date: string } | null;
}) {
  const [verdict, setVerdict] = useState<StackVerdict>(initialVerdict);
  // Cancellation flag · set on unmount so in-flight fetches don't
  // setState on a dead component.
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let timer: number | null = null;

    async function pollOnce() {
      try {
        // cache: "no-store" so we hit the route handler every time ·
        // the route itself caches at 120s revalidate so we're not
        // hammering upstreams. Browser cache would mask updates.
        const r = await fetch("/api/stack", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as Partial<StackResponse>;
        if (cancelledRef.current) return;
        if (data?.verdict && typeof data.verdict.score === "number") {
          setVerdict(data.verdict);
        }
      } catch {
        // Network blip · silent. We keep the previous verdict on
        // screen rather than showing an error · the gauge being
        // "wrong by 60s" is better than the gauge disappearing.
      }
    }

    function startTimer() {
      if (timer !== null) return;
      timer = window.setInterval(pollOnce, POLL_INTERVAL_MS);
    }
    function stopTimer() {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    }

    function handleVisibility() {
      if (document.hidden) {
        stopTimer();
      } else {
        // Coming back to focus · fetch immediately so a returning
        // visitor doesn't wait up to 60s for the next interval tick.
        pollOnce();
        startTimer();
      }
    }

    startTimer();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelledRef.current = true;
      stopTimer();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return (
    <>
      <PressureGauge
        score={verdict.score}
        tier={verdict.tier}
        blockHeight={verdict.blockHeight}
        signals={verdict.signals}
        compareBaseline={compareBaseline}
      />
      {/* Off-screen polite announcer for screen-reader users · the
          PressureGauge is a 2820-line SVG/Canvas instrument and SVG
          <text> elements don't reliably trigger aria-live across
          assistive tech. This mirrored region announces the polled
          verdict whenever it changes. Audit 2026-05-22. */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        Buying gauge score is {verdict.score} of 100, tier{" "}
        {TIER_LABEL[verdict.tier]}.
      </div>
    </>
  );
}
