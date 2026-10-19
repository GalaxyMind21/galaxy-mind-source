"use client";

import { useEffect, useState } from "react";
import type { StackTier } from "@/lib/stack";

const LS_KEY = "gm_last_gauge_check";

/**
 * "Since you last checked" retention hook.
 *
 * Shows returning visitors exactly what changed since their previous
 * visit (score delta + tier change). This is pure "what did I miss?"
 * dopamine and is one of the cheapest, highest-ROI retention features
 * possible.
 *
 * Data is 100% localStorage — no server call, no privacy surface.
 * Matches the streak mechanic so both features reinforce each other.
 */
export function LastCheckedDelta({
  currentScore,
  currentTier,
}: {
  currentScore: number;
  currentTier: StackTier;
}) {
  const [delta, setDelta] = useState<{
    previousScore: number;
    previousTier: StackTier;
    scoreDelta: number;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = localStorage.getItem(LS_KEY);
      const now = { score: currentScore, tier: currentTier, at: Date.now() };

      if (raw) {
        const prev = JSON.parse(raw) as { score: number; tier: StackTier; at: number };

        // Only show if this is meaningfully a "return visit"
        const hoursSince = (Date.now() - prev.at) / (1000 * 60 * 60);
        if (hoursSince > 4 && prev.score !== currentScore) {
          setDelta({
            previousScore: prev.score,
            previousTier: prev.tier,
            scoreDelta: currentScore - prev.score,
          });
        }
      }

      // Always update the last-seen record
      localStorage.setItem(LS_KEY, JSON.stringify(now));
    } catch {
      // LS unavailable or corrupted — silently do nothing
    }
  }, [currentScore, currentTier]);

  if (!delta) return null;

  const { previousScore, previousTier, scoreDelta } = delta;
  const direction = scoreDelta > 0 ? "up" : "down";
  const tierChanged = previousTier !== currentTier;

  return (
    <div className="mt-4 flex justify-center">
      <div className="micro-label inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-3 py-1 text-[var(--text-secondary)]">
        Since last time you checked:
        <span className={`tabular-nums font-semibold ${direction === "up" ? "text-[var(--accent-ink)]" : "text-[var(--cool-ink)]"}`}>
          {direction === "up" ? "+" : ""}{scoreDelta}
        </span>
        <span className="text-[var(--text-tertiary)]">· now {currentScore} vs {previousScore}</span>
        {tierChanged && (
          <span className="text-[var(--accent-ink)]">· tier changed</span>
        )}
      </div>
    </div>
  );
}
