"use client";

/* =====================================================================
 * DailyPulse · cross-page preview strip on the homepage
 *
 * A horizontal row of "what's happening today" pills that turns the
 * vendor directory into a HUB · the casual visitor who came to spend
 * bitcoin discovers the data tools (/stack, /float, /treasuries)
 * without having to scroll to the desktop-only header pills or open
 * the mobile bottom nav.
 *
 * Each pill shows a daily-fresh number + a one-line story + an
 * accent-tinted hover state · gives the visitor a reason to click
 * through to a tool they didn't know they wanted.
 *
 * Data sources (parallel client-side fetch on mount):
 *   /api/stack            · today's Buying Gauge verdict (score + tier)
 *   /api/float            · today's float (inPlay + dailyDelta)
 *   /api/treasuries       · cheapest treasury right now (lowest mNAV)
 *
 * Loading state: skeleton pills (~80ms typical, the endpoints are
 * 30-min edge cached).
 * Error state: hide the failed pill silently · the strip continues
 * to display whichever pills loaded successfully. Never blocks the
 * homepage from rendering.
 *
 * Mobile: horizontal-scroll row (snap-x) so the pills don't crush
 * to unreadable widths on a 375px viewport.
 *
 * "use client" because we read live API data on mount and don't
 * want to delay the initial paint of the homepage on the data fetch.
 * ===================================================================== */

import { useEffect, useState } from "react";
import Link from "next/link";
import { TIER_VERDICT } from "@/lib/tier";

type StackData = { score: number; tier: string };
type FloatData = {
  inPlay: number;
  dailyDelta: number | null;
  /** True when a live cohort was withheld. The headline can still move. */
  partial: boolean;
};
type CheapestData = {
  ticker: string;
  mNAV: number;
  // The mNAV rating from /treasuries (mNavInterpretation.label),
  // precomputed server-side so this pill stays consistent with that page.
  label: string;
  bias: "cheap" | "fair" | "rich" | "unknown";
};

// Verdict-action labels imported from the shared tier module · the
// same map the catalyst pages render, so a visitor who clicks through
// finds language consistency (consolidated 2026-06-13).

// Tier-color tokens so the Buying Gauge pill changes color with
// today's verdict · COLD/CHILL = blue-ish (cold), WARM = neutral,
// HOT/MOLTEN = orange (the brand accent for "go").
const TIER_RING: Record<string, string> = {
  COLD: "border-[#7ec0ff]/40",
  CHILL: "border-[#7ec0ff]/30",
  WARM: "border-[var(--border-subtle)]",
  HOT: "border-[var(--accent)]/50",
  MOLTEN: "border-[var(--accent)] lit-active",
};

const TIER_TEXT: Record<string, string> = {
  COLD: "text-[var(--cool-ink)]",
  CHILL: "text-[var(--cool-ink)]",
  WARM: "text-[var(--text-secondary)]",
  HOT: "text-[var(--accent-ink)]",
  MOLTEN: "text-[var(--accent-ink)]",
};

export function DailyPulse() {
  const [stack, setStack] = useState<StackData | null>(null);
  const [floatData, setFloatData] = useState<FloatData | null>(null);
  const [cheapest, setCheapest] = useState<CheapestData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Parallel fetch · each promise catches its own errors so a
    // single failed endpoint doesn't take down the whole strip.
    const stackP = fetch("/api/stack")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { verdict?: { score?: unknown; tier?: unknown } } | null) => {
        if (
          j?.verdict &&
          typeof j.verdict.score === "number" &&
          typeof j.verdict.tier === "string"
        ) {
          setStack({ score: j.verdict.score, tier: j.verdict.tier });
        }
      })
      .catch(() => {
        /* silent · pill hides */
      });

    const floatP = fetch("/api/float")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: {
          current?: { inPlay?: unknown; partial?: unknown };
          dailyDelta?: unknown;
          degraded?: unknown;
        } | null) => {
          if (j?.current && typeof j.current.inPlay === "number") {
            setFloatData({
              inPlay: j.current.inPlay,
              dailyDelta:
                typeof j.dailyDelta === "number" ? j.dailyDelta : null,
              partial: j.current.partial === true || j.degraded === true,
            });
          }
        },
      )
      .catch(() => {
        /* silent · pill hides */
      });

    // Cheapest treasury right now = lowest mNAV among tickers that
    // report one. The `interpretation` label/bias is the SAME rating
    // computed for /treasuries (mNavInterpretation, precomputed
    // server-side), so the pill stays consistent with that page.
    const cheapestP = fetch("/api/treasuries")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: {
          rows?: Array<{
            ticker?: unknown;
            mNAV?: unknown;
            interpretation?: { label?: unknown; bias?: unknown };
          }>;
        } | null) => {
          if (!j?.rows) return;
          let best: CheapestData | null = null;
          for (const row of j.rows) {
            if (
              typeof row?.ticker !== "string" ||
              typeof row?.mNAV !== "number" ||
              !Number.isFinite(row.mNAV)
            )
              continue;
            if (!best || row.mNAV < best.mNAV) {
              const label =
                typeof row.interpretation?.label === "string"
                  ? row.interpretation.label
                  : "";
              const bias =
                row.interpretation?.bias === "cheap" ||
                row.interpretation?.bias === "fair" ||
                row.interpretation?.bias === "rich"
                  ? row.interpretation.bias
                  : "unknown";
              best = { ticker: row.ticker, mNAV: row.mNAV, label, bias };
            }
          }
          if (best) setCheapest(best);
        },
      )
      .catch(() => {
        /* silent · pill hides */
      });

    Promise.allSettled([stackP, floatP, cheapestP]).then(() =>
      setLoaded(true),
    );
  }, []);

  // Hide the entire strip until at least one pill has data · prevents
  // a layout-shift flash when all three resolve at slightly different
  // times. If everything fails, the strip stays hidden (graceful).
  const anyData = stack || floatData || cheapest;
  if (loaded && !anyData) return null;

  return (
    <section
      aria-label="Today's Bitcoin pulse"
      className="max-w-5xl mx-auto px-4 sm:px-6 pt-3 sm:pt-6"
    >
      <div className="mb-2 sm:mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="t-xs font-medium text-[var(--text-tertiary)]">
          Today on Galaxy Mind
        </div>
        <Link
          href="/today"
          className="t-xs font-medium text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
        >
          Full briefing →
        </Link>
      </div>
      {/* Horizontal-scroll on mobile so 3 pills don't crush at 375px;
          snap-x gives a satisfying carousel feel without JS scroll
          libraries. Desktop wraps to a normal grid. */}
      <div className="flex gap-2 sm:grid sm:grid-cols-3 sm:gap-3 overflow-x-auto snap-x snap-mandatory pb-1 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0">
        {/* Pill 1 · Buying Gauge */}
        {stack ? (
          <PulsePill
            href="/stack"
            label="Buying Gauge"
            value={`${stack.score}`}
            valueClass={TIER_TEXT[stack.tier] ?? "text-[var(--text-primary)]"}
            ringClass={TIER_RING[stack.tier] ?? "border-[var(--border-subtle)]"}
            sublabel={`${TIER_VERDICT[stack.tier as keyof typeof TIER_VERDICT] ?? stack.tier}`}
            footnote="0–100"
          />
        ) : !loaded ? (
          <PulseSkeleton />
        ) : null}

        {/* Pill 2 · Float (only renders when we have a number) */}
        {floatData ? (
          <PulsePill
            href="/float"
            label="Bitcoin Float"
            value={`${(floatData.inPlay / 1_000_000).toFixed(2)}M`}
            valueClass="text-[var(--accent-ink)]"
            ringClass="border-[var(--accent)]/40"
            sublabel={
              floatData.dailyDelta !== null && floatData.dailyDelta !== 0
                ? `${floatData.dailyDelta < 0 ? "▼" : "▲"} ${Math.abs(floatData.dailyDelta).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${floatData.dailyDelta < 0 ? "drained" : "added"} yesterday${floatData.partial ? " · cohort syncing" : ""}`
                : floatData.partial
                  ? "BTC still in play · cohort syncing"
                  : "BTC still in play"
            }
            sublabelClass={
              floatData.dailyDelta !== null && floatData.dailyDelta < 0
                ? "text-[var(--warning)]"
                : floatData.dailyDelta !== null && floatData.dailyDelta > 0
                  ? "text-[var(--success)]"
                  : "text-[var(--text-tertiary)]"
            }
            footnote={
              floatData.partial ? "cohort syncing" : "of 21M cap · live"
            }
          />
        ) : !loaded ? (
          <PulseSkeleton />
        ) : null}

        {/* Pill 3 · Cheapest treasury right now (lowest mNAV) */}
        {cheapest ? (
          <PulsePill
            href="/treasuries"
            label="Cheapest Treasury"
            value={`${cheapest.mNAV.toFixed(2)}×`}
            valueClass={
              cheapest.bias === "cheap"
                ? "text-[var(--success)]"
                : cheapest.bias === "rich"
                  ? "text-[var(--warning)]"
                  : "text-[var(--text-primary)]"
            }
            ringClass={
              cheapest.bias === "cheap"
                ? "border-[var(--success)]/40"
                : cheapest.bias === "rich"
                  ? "border-[var(--warning)]/40"
                  : "border-[var(--border-subtle)]"
            }
            sublabel={`${cheapest.ticker} · ${cheapest.label}`}
            footnote="mNAV vs its bitcoin"
          />
        ) : !loaded ? (
          <PulseSkeleton />
        ) : null}
      </div>
    </section>
  );
}

function PulsePill({
  href,
  label,
  value,
  valueClass,
  ringClass,
  sublabel,
  sublabelClass = "text-[var(--text-tertiary)]",
  footnote,
}: {
  href: string;
  label: string;
  value: string;
  valueClass: string;
  ringClass: string;
  sublabel: string;
  sublabelClass?: string;
  footnote: string;
}) {
  return (
    <Link
      href={href}
      className={`snap-start shrink-0 w-[78%] sm:w-auto group flex flex-col bg-[var(--bg-elevated)] border ${ringClass} hover:border-[var(--accent)]/60 rounded-xl p-3 sm:p-4 transition-colors`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="micro-label text-[var(--text-tertiary)]">
          {label}
        </span>
        <span className="font-mono t-xs text-[var(--accent-ink)] opacity-0 group-hover:opacity-100 transition-opacity">
          →
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={`font-mono text-2xl sm:text-3xl font-bold leading-none tracking-tight tabular-nums ${valueClass}`}
        >
          {value}
        </span>
        <span
          className={`font-mono t-xs uppercase tracking-widest font-semibold ${valueClass}`}
        >
          {sublabel.startsWith("▼") || sublabel.startsWith("▲") ? "" : sublabel}
        </span>
      </div>
      <div className={`t-xs mt-1 leading-snug ${sublabelClass}`}>
        {sublabel.startsWith("▼") || sublabel.startsWith("▲") ? sublabel : footnote}
      </div>
      {!sublabel.startsWith("▼") && !sublabel.startsWith("▲") && (
        <div className="t-xs text-[var(--text-tertiary)] mt-0.5 sm:hidden">
          {footnote}
        </div>
      )}
    </Link>
  );
}

function PulseSkeleton() {
  return (
    <div
      className="snap-start shrink-0 w-[78%] sm:w-auto bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl p-3 sm:p-4 animate-pulse"
      aria-hidden
    >
      <div className="h-2 w-20 bg-[var(--border-subtle)] rounded mb-2" />
      <div className="h-7 w-24 bg-[var(--border-subtle)] rounded mb-1" />
      <div className="h-2 w-32 bg-[var(--border-subtle)] rounded" />
    </div>
  );
}
