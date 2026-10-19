"use client";

// Share row for the daily briefing · composes an X post from today's
// live readings. Null-safe: any reading that's degraded/syncing is
// simply omitted from the copy, so a partial-outage day still produces
// an honest post instead of "gauge null/100".

import { useState } from "react";
import { track } from "@vercel/analytics";

export function TodayShareRow({
  score,
  tierLabel,
  inPlay,
  cheapestTicker,
  cheapestMNav,
}: {
  score: number | null;
  tierLabel: string | null;
  inPlay: number | null;
  cheapestTicker: string | null;
  cheapestMNav: number | null;
}) {
  const [copied, setCopied] = useState(false);

  function buildText(): string {
    const parts: string[] = [];
    if (score != null && tierLabel) {
      parts.push(`Buying Gauge ${score}/100 (${tierLabel})`);
    }
    if (inPlay != null) {
      parts.push(
        `${Math.round(inPlay).toLocaleString("en-US")} BTC still purchasable`,
      );
    }
    if (cheapestTicker && cheapestMNav != null) {
      parts.push(`cheapest treasury ${cheapestTicker} at ${cheapestMNav.toFixed(2)}x`);
    }
    const line = parts.length
      ? `Today in bitcoin: ${parts.join(" · ")}.`
      : "Today in bitcoin, in four live numbers.";
    return `${line}\n\ngalaxymind.space/today`;
  }

  function tweetHref(): string {
    return (
      "https://x.com/intent/tweet?text=" + encodeURIComponent(buildText())
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildText());
      setCopied(true);
      track("today_share_copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* older browsers · degrade silently */
    }
  }

  return (
    <div className="mt-8 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="t-xs font-medium text-[var(--text-tertiary)] mr-2">
        Pass the signal on
      </span>
      <a
        href={tweetHref()}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track("today_share_tweet")}
        className="micro-label inline-flex items-baseline gap-2 px-4 py-2 rounded-lg border border-[var(--accent)]/50 text-[var(--accent-ink)] hover:bg-[var(--accent)]/10 transition-colors"
      >
        Post today&apos;s numbers →
      </a>
      <button
        type="button"
        onClick={copy}
        className="micro-label inline-flex items-baseline gap-2 px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent-ink)] transition-colors"
      >
        {copied ? "✓ Copied" : "Copy briefing"}
      </button>
    </div>
      <p className="font-mono t-xs text-[var(--text-tertiary)]">
        Tip · bookmark{" "}
        <span className="text-[var(--text-secondary)]">galaxymind.space/today</span>{" "}
        as your morning tab · or install the app (Add to Home Screen) which opens here.
      </p>
    </div>
  );
}
