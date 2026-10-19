"use client";

/* =====================================================================
 * TreasuryLastVisitPulse · "Since you visited, MSTR moved from X to Y"
 *
 * /treasuries equivalent of the homepage LastVisitPulse. Shown to
 * returning visitors who came back at least 24h after their last
 * visit to this page. Picks the BIGGEST mover (largest absolute
 * mNAV delta) and highlights it as the headline — the data point
 * most likely to draw a "wait, what?" reaction and keep the
 * visitor scrolling into the table.
 *
 * Storage:
 *   localStorage.gm_treasuries_last_visit_v1 = {
 *     ts: ISO string,
 *     mNavs: { MSTR: 1.95, XXI: 1.5, MPJPY: 2.1, ASST: 1.7 }
 *   }
 *
 * Trigger conditions (ALL must hold):
 *   - >24h since last recorded visit
 *   - We have stored mNAV values for at least one of today's tickers
 *   - The biggest mover has |delta_pct| >= MIN_PCT_TO_SHOW (2%)
 *     · prevents noisy "0.4% move since 26h ago" pulses
 *
 * On every mount we silently refresh LS with the current values so
 * the next visit computes delta from the most recent landing, not
 * from a tab-refresh 5min ago.
 *
 * Privacy: localStorage only · no server tracking.
 * ===================================================================== */

import { useEffect, useState } from "react";
import { track } from "@vercel/analytics";

const LS_KEY = "gm_treasuries_last_visit_v1";
const MIN_GAP_MS = 24 * 60 * 60 * 1000;
const MIN_PCT_TO_SHOW = 2.0; // absolute percent

type TreasuryRow = {
  ticker: string;
  name: string;
  mNAV: number | null;
};

type LastVisit = {
  ts: string;
  mNavs: Record<string, number>;
};

type MoverPayload = {
  ticker: string;
  name: string;
  prev: number;
  curr: number;
  deltaPct: number;
  daysAgo: number;
};

export function TreasuryLastVisitPulse() {
  const [mover, setMover] = useState<MoverPayload | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    fetch("/api/treasuries")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (json: { rows?: TreasuryRow[] } | null) => {
          if (cancelled || !json?.rows) return;

          // Build a snapshot of CURRENT mNAVs to persist regardless
          // of whether we render a pulse.
          const currentMNavs: Record<string, number> = {};
          for (const r of json.rows) {
            if (typeof r.mNAV === "number" && Number.isFinite(r.mNAV)) {
              currentMNavs[r.ticker] = r.mNAV;
            }
          }

          // Read stored snapshot.
          let stored: LastVisit | null = null;
          try {
            const raw = window.localStorage.getItem(LS_KEY);
            if (raw) {
              const parsed = JSON.parse(raw) as LastVisit;
              if (
                parsed &&
                typeof parsed.ts === "string" &&
                parsed.mNavs &&
                typeof parsed.mNavs === "object"
              ) {
                stored = parsed;
              }
            }
          } catch {
            /* corrupted LS · ignore */
          }

          if (stored) {
            const elapsedMs = Date.now() - new Date(stored.ts).getTime();
            if (elapsedMs >= MIN_GAP_MS) {
              // Find the biggest mover by |delta_pct|.
              let best: MoverPayload | null = null;
              for (const r of json.rows) {
                const prev = stored.mNavs[r.ticker];
                const curr = currentMNavs[r.ticker];
                if (
                  typeof prev !== "number" ||
                  typeof curr !== "number" ||
                  prev <= 0
                ) {
                  continue;
                }
                const deltaPct = ((curr - prev) / prev) * 100;
                if (Math.abs(deltaPct) < MIN_PCT_TO_SHOW) continue;
                if (best === null || Math.abs(deltaPct) > Math.abs(best.deltaPct)) {
                  best = {
                    ticker: r.ticker,
                    name: r.name,
                    prev,
                    curr,
                    deltaPct,
                    daysAgo: Math.max(
                      1,
                      Math.round(elapsedMs / (24 * 60 * 60 * 1000)),
                    ),
                  };
                }
              }
              if (best) {
                setMover(best);
                track("treasury_last_visit_pulse_shown", {
                  ticker: best.ticker,
                  deltaSign: best.deltaPct < 0 ? "down" : "up",
                  daysAgo: best.daysAgo,
                });
              }
            }
          }

          // Always update LS so successive same-day refreshes don't
          // accidentally trigger the pulse tomorrow.
          try {
            window.localStorage.setItem(
              LS_KEY,
              JSON.stringify({
                ts: new Date().toISOString(),
                mNavs: currentMNavs,
              }),
            );
          } catch {
            /* LS quota · best-effort */
          }
        },
      )
      .catch(() => {
        /* silent · banner stays hidden */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!mover || dismissed) return null;

  const { ticker, name, prev, curr, deltaPct, daysAgo } = mover;
  const dayLabel = daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;
  const sign = deltaPct < 0 ? "▼" : "▲";
  // Color logic: a DROPPING mNAV is GOOD for buyers (cheaper relative
  // to BTC holdings) so it gets the "success" green. Rising is the
  // opposite. Matches the cheapest-callout color hierarchy.
  const colorClass =
    deltaPct < 0 ? "text-[var(--success)]" : "text-[var(--warning)]";

  return (
    <section
      aria-label={`mNAV move since your last visit ${dayLabel}`}
      className="mt-6"
    >
      {/* Background swapped from hardcoded dark hex gradient
          (#1f1714 / #0a0807 / #050403) to theme-aware vars on
          2026-05-22 · the old gradient painted as dark patches in
          light theme. Subtle accent tint keeps the "since you
          visited" framing distinct from neutral cards while
          adapting to whichever theme is active. */}
      <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 sm:bg-gradient-to-br sm:from-[var(--accent)]/10 sm:via-[var(--bg-elevated-2)]/60 sm:to-[var(--bg-elevated)]/40 p-3 sm:p-4 flex items-start sm:items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 flex-wrap min-w-0">
          <span className="micro-label text-[var(--accent-ink)] shrink-0">
            ⌬ Since you visited
          </span>
          <span className="text-xs sm:text-sm text-[var(--text-secondary)] leading-snug">
            <span className="text-[var(--text-primary)]">{dayLabel}</span>:{" "}
            <span className="text-[var(--text-primary)] font-semibold">{name}</span>{" "}
            <span className="text-[var(--text-tertiary)]">
              ({ticker})
            </span>{" "}
            mNAV
            <span className="font-mono tabular-nums text-[var(--text-primary)]">
              {" "}
              {prev.toFixed(2)} → {curr.toFixed(2)}{" "}
            </span>
            <span className={`font-mono font-semibold tabular-nums ${colorClass}`}>
              {sign} {Math.abs(deltaPct).toFixed(1)}%
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-lg leading-none px-2 py-1 -my-1 -mr-1 rounded transition-colors"
          aria-label="Dismiss mNAV-move banner"
          title="Dismiss"
        >
          ×
        </button>
      </div>
    </section>
  );
}
