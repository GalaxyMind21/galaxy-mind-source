"use client";

/* =====================================================================
 * GalaxyMindActivity · unified "your Galaxy Mind footprint" ribbon
 *
 * Aggregates the LS-tracked engagement state into a single compact
 * stat strip near the top of /. Surfaces every retention signal the
 * visitor has built up across the site:
 *
 *   📍 N vendors explored (from gm_vendor_journey_v1)
 *   🔥 X-day gauge streak (from gm_gauge_streak)
 *
 * Why: each individual signal already exists on its own page (the
 * streak counter on /stack, the vendor count inside the recently-
 * viewed strip). Pulling them BOTH together onto the homepage
 * means a returning visitor's first sight is "look how much I've
 * built up." That's the dopamine moment habit-forming products
 * are built around.
 *
 * Auto-hides for new visitors: if every stat is 0, the component
 * renders nothing. No empty-state padding, no "you've explored
 * 0 vendors" patronizing message.
 *
 * Component is "use client" because it touches localStorage. Pre-
 * mount it returns null (avoids hydration flicker for new visitors
 * who have no LS state).
 *
 * Privacy: LS only · never leaves the device.
 * ===================================================================== */

import Link from "next/link";
import { useEffect, useState } from "react";
import { getJourney } from "@/lib/vendor-journey";
import { VENDORS, normalizeVendorRefs } from "@/lib/vendors";

const STREAK_LS_KEY = "gm_gauge_streak";

type Stats = {
  vendorsExplored: number;
  streakCount: number;
};

function readStreakCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(STREAK_LS_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { count?: unknown };
    return typeof parsed.count === "number" && parsed.count > 0
      ? parsed.count
      : 0;
  } catch {
    return 0;
  }
}

export function GalaxyMindActivity() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    setStats({
      vendorsExplored: normalizeVendorRefs(getJourney().handles).length,
      streakCount: readStreakCount(),
    });
  }, []);

  // Pre-mount or zero-state · render nothing. New visitors are
  // intentionally untouched.
  if (
    !stats ||
    (stats.vendorsExplored === 0 && stats.streakCount === 0)
  ) {
    return null;
  }

  return (
    <section
      aria-label="Your Galaxy Mind activity"
      className="max-w-5xl mx-auto px-4 sm:px-6 pt-3 sm:pt-4"
    >
      <div className="micro-label flex items-baseline gap-2 flex-wrap">
        <span className="text-[var(--accent-ink)] mr-1">⌬ Your footprint</span>

        {stats.vendorsExplored > 0 && (
          <Link
            href="#vendor-directory"
            className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 hover:border-[var(--accent)]/40 transition-colors text-[var(--text-secondary)] hover:text-[var(--accent-ink)]"
            title="Vendors you've opened on this device"
          >
            <span aria-hidden>📍</span>
            <span className="tabular-nums text-[var(--text-primary)]">
              {stats.vendorsExplored}
            </span>
            <span className="text-[var(--text-tertiary)]">of {VENDORS.length}</span>
            <span>vendors explored</span>
          </Link>
        )}

        {stats.streakCount >= 2 && (
          <Link
            href="/stack"
            className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/15 transition-colors text-[var(--accent-ink)]"
            title="Days in a row you've checked the Buying Gauge"
          >
            <span aria-hidden>🔥</span>
            <span className="tabular-nums">{stats.streakCount}</span>
            <span>day gauge streak</span>
          </Link>
        )}
      </div>
    </section>
  );
}
