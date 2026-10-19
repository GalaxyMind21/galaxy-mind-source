"use client";

/* =====================================================================
 * ShareStreakButton · "Share my N-day streak"
 *
 * The streak (GaugeCheckStreak) is one of the strongest habit loops on
 * the site but had no viral surface · this turns a personal flex into
 * distribution. Mirrors ShareFloatButton's proven pattern:
 *   - Web Share API on mobile (the OS sheet covers X, Nostr clients,
 *     Messages, etc. and converts far better than an X-only link)
 *   - X compose-intent as the desktop + fallback path
 *   - copy-to-clipboard as the universal last resort (paste into any
 *     Nostr client), with a "Copied" confirmation
 *
 * Text comes from src/lib/share-templates.ts so the voice stays
 * consistent with the other share surfaces.
 * ===================================================================== */

import { useState } from "react";
import { track } from "@vercel/analytics";
import { streakShareText, xIntentUrl } from "@/lib/share-templates";

export function ShareStreakButton({ count }: { count: number }) {
  const [copied, setCopied] = useState(false);
  const text = streakShareText(count);

  async function onShare() {
    track("streak_share", { count });
    // Mobile · native share sheet reaches every app including Nostr.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // User dismissed the sheet, or it's unavailable · fall through
        // to the copy path rather than failing silently.
      }
    }
    // Desktop / fallback · copy so it can paste into X, Nostr, anywhere.
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked · open X compose as the final fallback.
      window.open(xIntentUrl(text), "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="flex items-center justify-center gap-2 mt-2">
      <button
        type="button"
        onClick={onShare}
        className="micro-label inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] hover:border-[var(--accent)]/50 transition-colors"
        aria-label={`Share your ${count}-day streak`}
      >
        {copied ? "Copied ✓" : "Share my streak →"}
      </button>
      <a
        href={xIntentUrl(text)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track("streak_share_x", { count })}
        className="hidden sm:inline-flex items-center px-3 py-1 rounded-full border border-[var(--border-subtle)] text-[var(--text-tertiary)] font-mono t-xs uppercase tracking-[0.22em] hover:text-[var(--accent-ink)] hover:border-[var(--accent)]/50 transition-colors"
      >
        On X
      </a>
    </div>
  );
}
