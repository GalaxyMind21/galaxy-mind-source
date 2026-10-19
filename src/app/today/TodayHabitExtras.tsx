"use client";

/**
 * Client habit layer for /today · personal last-visit score delta,
 * gauge streak, and the cross-cabinet arcade streak. Pure localStorage;
 * no new APIs. Per-game daily state (WEN / Gauntlet / Runner) moved to
 * <DailyLoop> 2026-07-11 · one checklist beats scattered pills.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { readActiveStreak } from "@/lib/streak";
import { readActiveArcadeStreak } from "@/lib/arcade-streak";

/** Personal delta for /today only · do NOT write gm_last_gauge_check
 *  (that key belongs to LastCheckedDelta on /stack). */
const LS_TODAY_GAUGE = "gm:today:lastGauge";
const LS_TODAY_VISIT = "gm:today:lastVisit";

type Props = {
  currentScore: number | null;
  currentTier: string | null;
  degraded: boolean;
};

export function TodayHabitExtras({
  currentScore,
  currentTier,
  degraded,
}: Props) {
  const [gaugeDelta, setGaugeDelta] = useState<number | null>(null);
  const [streak, setStreak] = useState<number | null>(null);
  const [arcadeStreak, setArcadeStreak] = useState<number>(0);

  useEffect(() => {
    setStreak(readActiveStreak());
    setArcadeStreak(readActiveArcadeStreak());

    try {
      if (
        !degraded &&
        currentScore != null &&
        typeof currentTier === "string"
      ) {
        const prevRaw = window.localStorage.getItem(LS_TODAY_GAUGE);
        if (prevRaw) {
          const prev = JSON.parse(prevRaw) as {
            score?: number;
            at?: number;
          };
          const hours =
            typeof prev.at === "number"
              ? (Date.now() - prev.at) / 3_600_000
              : 99;
          if (
            hours > 4 &&
            typeof prev.score === "number" &&
            prev.score !== currentScore
          ) {
            setGaugeDelta(currentScore - prev.score);
          }
        }
        window.localStorage.setItem(
          LS_TODAY_GAUGE,
          JSON.stringify({
            score: currentScore,
            tier: currentTier,
            at: Date.now(),
          }),
        );
      }

      window.localStorage.setItem(
        LS_TODAY_VISIT,
        JSON.stringify({ at: Date.now() }),
      );
    } catch {
      /* private mode */
    }
  }, [currentScore, currentTier, degraded]);

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {gaugeDelta != null && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1 font-mono t-xs uppercase tracking-[0.18em] text-[var(--text-secondary)]">
          Since last check{" "}
          <span
            className={
              gaugeDelta > 0
                ? "text-[var(--accent-ink)] tabular-nums"
                : "text-[var(--cool-ink)] tabular-nums"
            }
          >
            {gaugeDelta > 0 ? "+" : ""}
            {gaugeDelta}
          </span>
        </span>
      )}
      {streak != null && (
        <Link
          href="/stack#streak"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/30 bg-[var(--bg-elevated)] px-3 py-1 font-mono t-xs uppercase tracking-[0.18em] text-[var(--accent-ink)] hover:bg-[var(--bg-elevated-2)]"
        >
          Gauge streak {streak}d →
        </Link>
      )}
      {/* Day 1 shows too — a streak the player can't see on its first
          day never earns its day 2 (the whole Wordle mechanic). The
          sitewide >=2 gates (header/nav badges) are a different writer
          contract and stay untouched. */}
      {arcadeStreak === 1 && (
        <Link
          href="/arcade"
          className="micro-label inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-1 text-[var(--accent-ink)] hover:bg-[var(--bg-elevated-2)]"
        >
          Streak day 1 · come back tomorrow to keep it →
        </Link>
      )}
      {arcadeStreak >= 2 && (
        <Link
          href="/arcade"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-1 font-mono t-xs uppercase tracking-[0.18em] text-[var(--accent-ink)] hover:bg-[var(--bg-elevated-2)]"
        >
          Arcade streak {arcadeStreak}d · keep it →
        </Link>
      )}
    </div>
  );
}
