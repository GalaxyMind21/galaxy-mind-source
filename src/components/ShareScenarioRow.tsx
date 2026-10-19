"use client";

import { useState } from "react";
import { track } from "@vercel/analytics";
import type { Sleeve, Tolerance } from "@/lib/recommend";
import { TOLERANCE_LABELS } from "@/lib/recommend";

const ACCOUNT_LABELS: Record<"taxable" | "traditional" | "roth", string> = {
  taxable: "Taxable",
  traditional: "Traditional IRA",
  roth: "Roth IRA",
};

// "Share this scenario" row that appears under the recommendation. Two
// affordances:
//   - Copy URL: clipboard write of the canonical /fit URL with state params.
//     Visitors who paste it into a tweet/Discord get a direct link to
//     exactly the recommendation they're looking at.
//   - Tweet this allocation: opens X compose with a pre-filled summary.
// Neither requires a backend or a tracking pixel — both leverage the URL-
// state design we already have.
export function ShareScenarioRow({
  allocation,
  horizon,
  tolerance,
  account,
}: {
  allocation: Sleeve[];
  horizon: number;
  tolerance: Tolerance;
  account: "taxable" | "traditional" | "roth";
}) {
  const [copied, setCopied] = useState(false);

  // Build the canonical URL on click rather than render time so we get
  // the actual host (works for galaxymind.space + preview deploys + dev).
  function buildShareUrl(): string {
    if (typeof window === "undefined") return "";
    const url = new URL("/fit", window.location.origin);
    url.searchParams.set("h", String(horizon));
    url.searchParams.set("t", String(tolerance));
    url.searchParams.set("a", account);
    return url.toString();
  }

  // Compact summary suitable for an X post — top 3 sleeves only, with the
  // user's profile inline. Stays well under the tweet character cap even
  // with the URL appended.
  function buildTweetText(): string {
    const top = allocation
      .slice(0, 3)
      .map((s) => `${(s.weight * 100).toFixed(0)}% ${s.asset.ticker}`)
      .join(" / ");
    const profile = `${horizon}y · ${TOLERANCE_LABELS[tolerance]} · ${ACCOUNT_LABELS[account]}`;
    return `@GalaxyMind says my fit (${profile}) is ${top}.\n\n`;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildShareUrl());
      setCopied(true);
      track("share_scenario_copy", { horizon, tolerance, account });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Older browsers / blocked clipboard — fall through silently. The
      // tweet button still works.
    }
  }

  function handleTweet() {
    const text = buildTweetText();
    const url = buildShareUrl();
    const composeUrl =
      "https://x.com/intent/tweet?text=" +
      encodeURIComponent(text) +
      "&url=" +
      encodeURIComponent(url);
    track("share_scenario_tweet", { horizon, tolerance, account });
    window.open(composeUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-4">
      {/* Label on its own line, buttons in a clean row below · avoids
          the previous awkward wrap where the Tweet button dropped to a
          second row only when the label took too much horizontal space. */}
      <div className="t-xs font-medium text-[var(--text-tertiary)] mb-3">
        Share this scenario
        <span className="hidden sm:inline normal-case tracking-normal text-[var(--text-tertiary)]">
          {" "}↳ deep links to this exact recommendation
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleCopy}
          className="micro-label inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated-2)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50 hover:text-[var(--accent-ink)] transition-colors"
          aria-label="Copy shareable URL to clipboard"
        >
          {copied ? "✓ Copied" : "🔗 Copy URL"}
        </button>
        <button
          onClick={handleTweet}
          className="micro-label inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent-ink)] hover:bg-[var(--accent)]/20 hover:lit-active transition-all"
          aria-label="Compose tweet with this scenario"
        >
          𝕏 Tweet this allocation
        </button>
      </div>
    </div>
  );
}
