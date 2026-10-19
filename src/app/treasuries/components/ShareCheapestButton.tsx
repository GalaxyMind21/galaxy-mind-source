"use client";

/* =====================================================================
 * ShareCheapestButton · "Share the cheapest treasury"
 *
 * The CheapestCallout is the most screenshot-worthy line on /treasuries
 * ("MSTR at 1.42× is cheapest right now"). A share button turns that
 * passive observation into distribution. Mirrors the ShareStreakButton
 * pattern: Web Share API on mobile → clipboard → X compose fallback.
 *
 * Text lives in src/lib/share-templates.ts so voice stays consistent
 * with the streak / float / verdict share surfaces.
 * ===================================================================== */

import { useState } from "react";
import { track } from "@vercel/analytics";
import { cheapestTreasuryShareText, xIntentUrl } from "@/lib/share-templates";

export function ShareCheapestButton({
  ticker,
  mNAV,
  name,
}: {
  ticker: string;
  mNAV: number;
  name?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = cheapestTreasuryShareText(ticker, mNAV, name);

  async function onShare() {
    track("cheapest_treasury_share", { ticker, mNAV });
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // User cancelled or unsupported · fall through to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.open(xIntentUrl(text), "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="mt-5 flex items-center gap-2">
      <button
        type="button"
        onClick={onShare}
        className="micro-label inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] hover:border-[var(--accent)]/50 transition-colors"
        aria-label={`Share ${ticker} as the cheapest Bitcoin treasury`}
      >
        {copied ? "Copied ✓" : "Share this →"}
      </button>
      <a
        href={xIntentUrl(text)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track("cheapest_treasury_share_x", { ticker, mNAV })}
        className="hidden sm:inline-flex items-center px-3 py-1 rounded-full border border-[var(--border-subtle)] text-[var(--text-tertiary)] font-mono t-xs uppercase tracking-[0.22em] hover:text-[var(--accent-ink)] hover:border-[var(--accent)]/50 transition-colors"
      >
        On X
      </a>
    </div>
  );
}
