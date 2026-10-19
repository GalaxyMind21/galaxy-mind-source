"use client";

/**
 * Renders nothing · a global listener that advances the cross-cabinet
 * arcade streak whenever any game finishes. Mounted once in the root
 * layout so a run on any page counts, not just /today (growth sprint
 * 2026-07-10). All cabinets dispatch gm:arcade-finished on death or
 * reveal · see lib/arcade-streak.
 *
 * Cross-device (2026-07-18): for X-linked players the streak also syncs to
 * /api/arcade/cloud so it follows the login across devices. This is the ONE
 * place the shared streak is synced (it's the sole writer), so no per-game
 * wiring is needed. Anonymous / X-unconfigured players are unaffected.
 */

import { useEffect, useRef } from "react";
import { recordArcadePlay, readRawStreak, adoptStreak } from "@/lib/arcade-streak";
import { fetchIdentity, cloudSync } from "@/lib/arcade";

export function ArcadeStreakTracker() {
  const linkedRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    const syncStreak = () => {
      if (!linkedRef.current) return;
      // a null local (never played) posts as a trivial {0,0} the server
      // treats as pull-only, so a fresh device still downloads the streak
      const local = readRawStreak() ?? { last: 0, len: 0 };
      void cloudSync("streak", local).then((merged) => {
        if (aliveRef.current && merged) adoptStreak(merged);
      });
    };

    void fetchIdentity().then((id) => {
      if (!aliveRef.current || !id.linked) return;
      linkedRef.current = true;
      syncStreak(); // boot pull
    });

    const onFinished = () => {
      recordArcadePlay();
      syncStreak(); // push the freshly-advanced streak to the cloud
    };
    window.addEventListener("gm:arcade-finished", onFinished);
    return () => {
      aliveRef.current = false;
      window.removeEventListener("gm:arcade-finished", onFinished);
    };
  }, []);

  return null;
}
