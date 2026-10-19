"use client";

/* =====================================================================
 * GaugeCheckStreak · "🔥 N-day streak" habit-forming pill
 *
 * Why: the Buying Gauge is a daily-check tool by design (one of the
 * 10 signals — Hour-of-Day, Day-of-Week — moves every cycle). Habit-
 * forming UI is the proven way to convert "I checked once" into "I
 * check every morning with my coffee." A visible streak counter
 * turns the next visit into something the user *owes themselves*.
 *
 * Mechanics:
 *   - On mount, read `gm_gauge_streak` (LS) → { lastDateUTC, count,
 *     graceTokens }
 *   - lastDateUTC === today: silent · streak unchanged
 *   - lastDateUTC === yesterday: increment count · update lastDate ·
 *     bank one grace token at every GRACE_EARN_EVERY-day mark (cap
 *     GRACE_TOKEN_CAP)
 *   - exactly ONE missed day AND a grace token banked: consume the
 *     token, keep the streak alive (count still increments for
 *     today's check) · show a "grace day used" note. One bad day no
 *     longer flushes a 30-day habit — the single biggest churn
 *     moment of streak mechanics (2026-06-10).
 *   - older than that (or no token): reset to 1 · tokens reset to 0
 *     (a fresh streak earns its own protection)
 *   - no record: initialize at 1
 *   - Render only when count >= 2 (don't congratulate single visits ·
 *     would feel patronizing for a brand-new visitor)
 *
 * This component is the ONLY writer of the streak record. Read-only
 * mirrors (HeaderStreakChip, MobileBottomNav badge) go through
 * lib/streak.ts `readActiveStreak()`, which predicts the grace path
 * without writing. Constants + types are imported from lib/streak.ts
 * so writer and readers can't drift.
 *
 * Date math uses UTC midnight to avoid timezone-shift bugs (a user
 * in Tokyo would otherwise see streak resets at weird local times).
 * Yes, this means a US user checking at 11pm ET vs 1am ET could
 * accidentally double-count or miss · accepted trade-off vs. the
 * "your streak broke because you traveled to Asia" surprise.
 *
 * Privacy: localStorage only · no server tracking, no cookies.
 * ===================================================================== */

import { useEffect, useRef, useState } from "react";
import { ShareStreakButton } from "./ShareStreakButton";
import { track } from "@vercel/analytics";
import {
  STREAK_LS_KEY,
  STREAK_MIN_DISPLAY_COUNT,
  STREAK_TIER_1,
  STREAK_TIER_2,
  GRACE_EARN_EVERY,
  GRACE_TOKEN_CAP,
  normalizeGraceTokens,
  utcDateString,
  dayDelta,
  type StreakRecord,
} from "@/lib/streak";

/** Target for /stack#streak · header chip + /today habit links.
 *  Always mounted (even when the pill is hidden) so hash navigation
 *  has a node after Suspense streams StackContent in. */
const STREAK_ANCHOR_ID = "streak";

export function GaugeCheckStreak() {
  const [count, setCount] = useState<number | null>(null);
  const [tokens, setTokens] = useState(0);
  const [graceUsed, setGraceUsed] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [ready, setReady] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const todayISO = utcDateString(new Date());
    let next: StreakRecord;
    let first = false;
    let usedGrace = false;

    try {
      const raw = localStorage.getItem(STREAK_LS_KEY);
      if (raw) {
        const prev = JSON.parse(raw) as StreakRecord;
        if (
          typeof prev.lastDateUTC === "string" &&
          typeof prev.count === "number" &&
          prev.count > 0
        ) {
          const delta = dayDelta(prev.lastDateUTC, todayISO);
          const banked = normalizeGraceTokens(prev.graceTokens);
          if (delta === 0) {
            next = prev;
          } else if (delta === 1) {
            const newCount = prev.count + 1;
            // Bank a token at every 7-day mark of CONSECUTIVE checks.
            // Grace-path days (delta 2 below) deliberately don't earn ·
            // a token shouldn't refund itself on the very next visit.
            const earned =
              newCount % GRACE_EARN_EVERY === 0
                ? Math.min(GRACE_TOKEN_CAP, banked + 1)
                : banked;
            next = {
              lastDateUTC: todayISO,
              count: newCount,
              graceTokens: earned,
            };
          } else if (delta === 2 && banked > 0) {
            // Exactly one missed UTC day + a banked token: the streak
            // survives. Count still increments for today's check.
            usedGrace = true;
            next = {
              lastDateUTC: todayISO,
              count: prev.count + 1,
              graceTokens: banked - 1,
            };
            track("gauge_streak_grace_used", { count: prev.count + 1 });
          } else if (delta < 0 || !Number.isFinite(delta)) {
            // Clock skew (or corrupt-but-string date → NaN delta):
            // don't punish · treat as unchanged today.
            next = prev;
          } else {
            next = { lastDateUTC: todayISO, count: 1, graceTokens: 0 };
          }
        } else {
          next = { lastDateUTC: todayISO, count: 1, graceTokens: 0 };
          first = true;
        }
      } else {
        next = { lastDateUTC: todayISO, count: 1, graceTokens: 0 };
        first = true;
      }

      localStorage.setItem(STREAK_LS_KEY, JSON.stringify(next));
      setCount(next.count);
      setTokens(normalizeGraceTokens(next.graceTokens));
      setGraceUsed(usedGrace);
      setIsFirstVisit(first);

      if (next.count === STREAK_TIER_1 || next.count === STREAK_TIER_2) {
        track("gauge_streak_milestone", { count: next.count });
      }
    } catch {
      /* corrupted LS · silently ignore */
    }
    setReady(true);
  }, []);

  // Hash scroll after Suspense stream · the browser's native #streak
  // resolve runs before this client component exists, so we re-scroll
  // once the anchor is in the DOM (header chip + /today links).
  useEffect(() => {
    if (!ready) return;
    if (typeof window === "undefined") return;
    if (window.location.hash !== `#${STREAK_ANCHOR_ID}`) return;
    const el = anchorRef.current;
    if (!el) return;
    // Double rAF · wait one frame after paint so layout (gauge height)
    // is settled before scrolling under the sticky header.
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [ready, count, isFirstVisit]);

  // New: gentle first-visit education so people understand the habit loop
  // immediately. Only shows on true first load (no prior LS record).
  if (isFirstVisit) {
    return (
      <div
        id={STREAK_ANCHOR_ID}
        ref={anchorRef}
        className="flex justify-center mt-3 scroll-mt-24"
      >
        <span
          className="micro-label inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/5 text-[var(--text-secondary)]"
          title="Checking the gauge daily builds a visible streak. Come back tomorrow."
        >
          🔥 Start your daily streak
        </span>
      </div>
    );
  }

  // Always mount the hash anchor so /stack#streak works even when the
  // count is still below the display threshold (day-1 check).
  if (count === null || count < STREAK_MIN_DISPLAY_COUNT) {
    return (
      <div
        id={STREAK_ANCHOR_ID}
        ref={anchorRef}
        className="scroll-mt-24"
        aria-hidden
      />
    );
  }

  const tier = count >= STREAK_TIER_2 ? 2 : count >= STREAK_TIER_1 ? 1 : 0;
  const emoji = tier === 2 ? "🔥🔥" : "🔥";

  // Tier-graded styling: warmer + brighter as the streak grows.
  const styleByTier = [
    // tier 0 (2-6 days)
    "border-[var(--accent)]/40 bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
    // tier 1 (7-29 days)
    "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent-ink)] lit-active",
    // tier 2 (30+ days)
    "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent-ink)] lit-active",
  ];

  // Tooltip is token-aware · the old "Miss a day and it resets" line
  // became inaccurate the moment grace shipped.
  const tooltip =
    `Your daily gauge habit · UTC days. Every ${GRACE_EARN_EVERY} days banks a grace freeze` +
    ` (max ${GRACE_TOKEN_CAP}) so one miss won't reset you.` +
    (tokens > 0
      ? ` ${tokens} freeze${tokens === 1 ? "" : "s"} banked.`
      : " None banked yet.");

  // Make the streak a first-class retention signal for returning users.
  // Bigger, warmer, and more celebratory as the streak grows. This is one of
  // the strongest habit loops on the entire site — we make it impossible to miss.
  return (
    <div
      id={STREAK_ANCHOR_ID}
      ref={anchorRef}
      className="flex flex-col items-center mt-4 mb-3 scroll-mt-24"
      aria-live="polite"
    >
      <div
        className={`inline-flex items-center gap-2.5 px-5 py-2 rounded-full border font-mono text-sm uppercase tracking-[0.2em] transition-all shadow-sm ${styleByTier[tier]}`}
        title={tooltip}
      >
        <span aria-hidden className="text-lg">{emoji}</span>
        <span className="font-bold tabular-nums text-lg">{count}</span>
        <span className="font-semibold">day{count === 1 ? "" : "s"} streak</span>
        {tokens > 0 && (
          <span
            className="ml-0.5 inline-flex items-center gap-0.5 t-xs tracking-normal opacity-90"
            title={`${tokens} grace freeze${tokens === 1 ? "" : "s"} banked`}
          >
            <span aria-hidden>🧊</span>
            <span className="tabular-nums">{tokens}</span>
          </span>
        )}
        {tier >= 1 && (
          <span className="ml-1 t-xs tracking-[0.3em] opacity-80 font-medium">· keep going</span>
        )}
      </div>
      {/* Honest grace acknowledgment · the user should know a token
          carried them, both to feel the save and to know the bank is
          one lighter. Session-scoped, disappears on next visit. */}
      {graceUsed && (
        <div className="mt-1.5 font-mono t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          🧊 grace freeze used · streak preserved
        </div>
      )}
      {/* Turn the personal flex into distribution · share surfaces only
          once the streak is worth bragging about (3+ days) to avoid
          one-visit "1 day streak" noise. */}
      {count >= 3 && <ShareStreakButton count={count} />}
    </div>
  );
}
