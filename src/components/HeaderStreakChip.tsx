"use client";

/* =====================================================================
 * HeaderStreakChip · ambient "🔥 Nd" streak pill in the SiteHeader
 *
 * Read-only mirror of the streak record written by GaugeCheckStreak
 * on /stack (LS key `gm_gauge_streak`). Surfaces the daily habit on
 * every other surface so a returning visitor sees their streak from
 * the moment any page renders, not only when they reach /stack.
 *
 * Hides itself in three cases so it never lies:
 *   1. no active streak (handled by `readActiveStreak()`)
 *   2. on /stack itself · the in-page pill already shows the streak
 *      bigger and warmer; a header copy would just duplicate
 *
 * Hidden below `md` to protect the right-cluster width (past Safari
 * 16" overflow pain, see SiteHeader history). The MobileBottomNav
 * surfaces the streak on phones via a small badge on the /stack tab
 * instead, so phone users still see the signal.
 *
 * No localStorage writes. No analytics events (those belong to the
 * canonical increment on /stack).
 * ===================================================================== */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  readActiveStreakDetail,
  streakTier,
  type ActiveStreak,
} from "@/lib/streak";

export function HeaderStreakChip() {
  const pathname = usePathname() ?? "/";
  const [streak, setStreak] = useState<ActiveStreak | null>(null);

  useEffect(() => {
    setStreak(readActiveStreakDetail());
  }, []);

  // Source-of-truth pill already lives on /stack · don't duplicate.
  if (pathname.startsWith("/stack")) return null;
  if (streak === null) return null;

  const { count, graceTokens } = streak;
  const tier = streakTier(count);
  const styleByTier = [
    "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent-ink)] hover:border-[var(--accent)]/40",
    "border-[var(--accent)]/50 text-[var(--accent-ink)] hover:border-[var(--accent)] lit-active",
    "border-[var(--accent)] text-[var(--accent-ink)] lit-active",
  ];

  const freezeNote =
    graceTokens > 0
      ? ` · ${graceTokens} grace freeze${graceTokens === 1 ? "" : "s"} banked`
      : "";

  return (
    <Link
      href="/stack#streak"
      aria-label={`Daily gauge streak: ${count} days${freezeNote}. Open the Buying Gauge streak.`}
      title={`Daily gauge streak: ${count} days${freezeNote} · keep it alive`}
      className={[
        "hidden md:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md border bg-[var(--bg-elevated)]/40 backdrop-blur-sm font-mono t-xs uppercase tracking-[0.18em] transition-all",
        styleByTier[tier],
      ].join(" ")}
    >
      <span aria-hidden className="t-xs leading-none">🔥</span>
      <span className="tabular-nums font-semibold">{count}</span>
      <span aria-hidden className="opacity-80">d</span>
      {graceTokens > 0 && (
        <span
          className="inline-flex items-center gap-0.5 opacity-90"
          aria-hidden
        >
          <span className="t-xs leading-none">🧊</span>
          <span className="tabular-nums t-xs">{graceTokens}</span>
        </span>
      )}
    </Link>
  );
}
