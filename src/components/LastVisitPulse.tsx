"use client";

/* =====================================================================
 * LastVisitPulse · "Welcome back · since you last visited..." banner
 *
 * Shown on the homepage to returning visitors who came back at least
 * 24h after their last visit. Headline is the cumulative delta on the
 * Bitcoin float since their last visit. A shrink reads "drained from
 * the float"; a growth reads "added to the float". Hook: turns the homepage into a
 * "what happened while I was gone?" surface that rewards return.
 *
 * Storage:
 *   localStorage.gm_last_visit_iso  · last time the user landed
 *   localStorage.gm_last_visit_in_play · float at that visit
 *
 * Update protocol:
 *   1. On mount, read existing values
 *   2. Fetch /api/float for current inPlay
 *   3. If we have stored values AND >24h has passed: render banner
 *      with the delta. Then update storage with current values.
 *   4. If no stored values (first-ever visit): silently store and
 *      show nothing (no banner on first visit).
 *   5. If <24h passed: silently update storage with current values
 *      so the next "first visit of the day" computes delta from
 *      yesterday's first-visit, not from a tab-refresh 5 min ago.
 *
 * Privacy: all storage is local (localStorage) · no server-side
 * tracking, no cookies, no analytics beyond the existing track()
 * call when the banner is shown.
 *
 * Mobile: same compact banner as desktop, just wraps cleanly. Mounted
 * inside ReturnVisitorBand ABOVE the homepage vendor grid so returners
 * see it before the catalog (not buried under every card).
 * ===================================================================== */

import { useEffect, useState } from "react";
import { track } from "@vercel/analytics";

const LS_LAST_VISIT_ISO = "gm_last_visit_iso";
const LS_LAST_VISIT_IN_PLAY = "gm_last_visit_in_play";
// Don't show the banner unless at least 24h has passed since the
// last recorded visit · prevents tab-refresh / same-day-multiple-visits
// from triggering a "you were here 5 min ago" banner.
const MIN_GAP_MS = 24 * 60 * 60 * 1000;

type BannerData = {
  daysAgo: number;
  delta: number;
  current: number;
};

export function LastVisitPulse() {
  const [banner, setBanner] = useState<BannerData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // try/catch: Safari private mode throws on localStorage access.
    let lastIso: string | null = null;
    let lastInPlayStr: string | null = null;
    try {
      lastIso = localStorage.getItem(LS_LAST_VISIT_ISO);
      lastInPlayStr = localStorage.getItem(LS_LAST_VISIT_IN_PLAY);
    } catch {
      return; // no storage → no since-last-visit mechanic
    }
    const lastInPlay = lastInPlayStr ? Number.parseFloat(lastInPlayStr) : NaN;
    const now = new Date();

    fetch("/api/float")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: { current?: { inPlay?: unknown } } | null) => {
          if (!j?.current || typeof j.current.inPlay !== "number") return;
          const currentInPlay = j.current.inPlay;

          // Compute banner if we have prior data AND it's been >24h
          if (lastIso && Number.isFinite(lastInPlay)) {
            const lastDate = new Date(lastIso);
            const elapsedMs = now.getTime() - lastDate.getTime();
            if (elapsedMs >= MIN_GAP_MS) {
              const delta = currentInPlay - lastInPlay;
              const daysAgo = Math.max(1, Math.round(elapsedMs / (24 * 60 * 60 * 1000)));
              setBanner({ daysAgo, delta, current: currentInPlay });
              track("last_visit_pulse_shown", {
                daysAgo,
                deltaSign: delta < 0 ? "down" : "up",
              });
            }
          }
          // Always update storage on EVERY mount so successive same-day
          // refreshes don't accidentally trigger the banner the next day
          // (they refresh the timestamp · the "last meaningful visit" is
          // the most recent landing).
          try {
            localStorage.setItem(LS_LAST_VISIT_ISO, now.toISOString());
            localStorage.setItem(
              LS_LAST_VISIT_IN_PLAY,
              String(currentInPlay),
            );
          } catch {
            /* best-effort */
          }
        },
      )
      .catch(() => {
        /* silent · banner stays hidden */
      });
  }, []);

  if (!banner || dismissed) return null;

  const { daysAgo, delta } = banner;
  const drainedAbs = Math.abs(delta);
  const sign = delta < 0 ? "▼" : delta > 0 ? "▲" : "·";
  const phrase =
    delta < 0
      ? "drained from the float."
      : delta > 0
        ? "added to the float."
        : "no change in the float.";
  const colorClass =
    delta < 0
      ? "text-[var(--warning)]"
      : delta > 0
        ? "text-[var(--success)]"
        : "text-[var(--text-secondary)]";
  const dayLabel = daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;

  return (
    <section
      aria-label="Welcome back"
      className="max-w-6xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6"
    >
      <div className="bg-[var(--nb-surface)] border border-[var(--accent)]/30 rounded-[var(--r-card)] p-3 sm:p-4 flex items-start sm:items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 flex-wrap min-w-0">
          <span className="t-xs font-medium text-[var(--accent-ink)] shrink-0">
            ⌬ Welcome back
          </span>
          <span className="text-xs sm:text-sm text-[var(--text-secondary)] leading-snug">
            Since you visited <span className="text-[var(--text-primary)]">{dayLabel}</span>:{" "}
            <span className={`font-mono font-semibold ${colorClass}`}>
              {sign} {drainedAbs.toLocaleString(undefined, { maximumFractionDigits: 0 })} BTC
            </span>{" "}
            <span className="text-[var(--text-tertiary)]">{phrase}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-lg leading-none px-2 py-1 -my-1 -mr-1 rounded transition-colors"
          aria-label="Dismiss welcome-back banner"
          title="Dismiss"
        >
          ×
        </button>
      </div>
    </section>
  );
}
