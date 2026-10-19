"use client";

// New-bitcoiner onboarding affordance · the audit found that a
// first-time visitor asking "how do I actually pay one of these
// vendors?" has no path from the directory hero · the page jumps
// straight into search/filters. A single dismissable line near the
// top closes that leak.
//
// Inverted LastVisit pattern: shown to NEW visitors (no LS flag yet),
// silently hidden once dismissed. Returning visitors who explicitly
// dismissed it never see it again. We never SHOW it on the second
// visit if it wasn't dismissed on the first · the gm_visited LS
// marker is bumped on first paint, so the affordance is strictly
// a "your first time here" prompt.

import { useEffect, useState } from "react";
import Link from "next/link";
import { track } from "@vercel/analytics";

const LS_DISMISSED = "gm_new_bitcoiner_nudge_dismissed";
const LS_VISITED = "gm_visited";

export function NewBitcoinerNudge() {
  // Default null = unknown · don't flash on first paint while we read
  // LS. Once the effect runs we either set true (show) or false (hide).
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      setShow(false);
      return;
    }
    try {
      const dismissed = window.localStorage.getItem(LS_DISMISSED) === "1";
      const visited = window.localStorage.getItem(LS_VISITED) === "1";
      // Show only when: (a) never dismissed AND (b) first visit ever
      // OR the visited marker is missing (treat as first visit).
      if (dismissed) {
        setShow(false);
        return;
      }
      if (!visited) {
        // Mark visited so this becomes a returning visitor on the
        // next page load · the nudge is strictly first-visit.
        window.localStorage.setItem(LS_VISITED, "1");
        setShow(true);
        track("new_bitcoiner_nudge_shown");
      } else {
        setShow(false);
      }
    } catch {
      setShow(false);
    }
  }, []);

  function dismiss() {
    setShow(false);
    try {
      window.localStorage.setItem(LS_DISMISSED, "1");
    } catch {
      /* best-effort */
    }
    track("new_bitcoiner_nudge_dismissed");
  }

  if (show !== true) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 mb-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5">
        <div className="text-sm text-[var(--text-secondary)]">
          <span aria-hidden className="mr-1.5">👋</span>
          New to spending bitcoin?{" "}
          <Link
            href="/faq"
            className="text-[var(--accent-ink)] underline decoration-[var(--accent)]/40 underline-offset-2 hover:decoration-[var(--accent)] transition-colors"
            onClick={() => track("new_bitcoiner_nudge_clicked")}
          >
            How this works
          </Link>{" "}
          <span className="text-[var(--text-tertiary)]">
            · Lightning, on-chain, and how to actually pay one of these
            merchants.
          </span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] text-lg leading-none px-1.5 font-mono flex-shrink-0"
        >
          ×
        </button>
      </div>
    </div>
  );
}
