"use client";

/* =====================================================================
 * ShareFloatButton · "Share what's left to buy" → X compose
 *
 * Mirrors src/app/stack/components/ShareVerdictButton for parity.
 * The /float page has zero viral surfaces today · everything else
 * here is a CONSUMPTION surface (look at the Reservoir, scroll the
 * trend chart). This adds ONE shareable surface for the moment a
 * visitor thinks "wait, the float is moving how fast?!"
 *
 * Tweet structure: live "in-play" number + daily delta with the
 * sign-aware vocabulary the homepage already uses ("drained" /
 * "added"). Links to https://galaxymind.space/float — the OG card
 * (/api/og/float) renders a live snapshot on the social-card scrape,
 * so each share is a fresh visual.
 *
 * Mobile: Web Share API when available (the OS-native share sheet
 * is dramatically higher-conversion on iPhone vs the X-only
 * fallback), with X compose as the desktop-and-fallback path.
 * ===================================================================== */

import { track } from "@vercel/analytics";
import { useState } from "react";

const SITE_URL = "https://galaxymind.space";

export function ShareFloatButton({
  inPlay,
  dailyDelta,
}: {
  inPlay: number;
  dailyDelta: number | null;
}) {
  const [copied, setCopied] = useState(false);

  // Compose the share text. Sign-aware so a positive day reads
  // "added" and a negative day reads "drained" · matches LastVisitPulse
  // vocabulary on the homepage. The thesis line has to agree with
  // that number: a refill day cannot also say the float kept draining.
  const inPlayM = (inPlay / 1_000_000).toFixed(2);
  const delta =
    dailyDelta !== null && Number.isFinite(dailyDelta) ? dailyDelta : null;
  const deltaLine =
    delta === null
      ? null
      : delta < 0
        ? `▼ ${Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 0 })} BTC drained in the last 24h.`
        : delta > 0
          ? `▲ ${delta.toLocaleString(undefined, { maximumFractionDigits: 0 })} BTC added in the last 24h.`
          : "The in-play supply held steady over the last 24h.";
  const thesis =
    delta === null
      ? "Live supply clock:"
      : delta < 0
        ? "The float keeps draining. Live supply clock:"
        : delta > 0
          ? "Yesterday the in-play supply grew. Live supply clock:"
          : "The in-play supply held steady. Live supply clock:";

  const tweet = [
    `${inPlayM}M BTC left actually in play.`,
    deltaLine,
    "",
    thesis,
    `${SITE_URL}/float`,
  ]
    .filter(Boolean)
    .join("\n");

  const composeUrl =
    "https://x.com/intent/tweet?text=" + encodeURIComponent(tweet);

  // Web Share API: try native first (huge UX win on iOS where it
  // surfaces the user's actual contacts/apps). Falls back to X
  // compose if the API isn't available or rejects.
  function handleShare(e: React.MouseEvent<HTMLAnchorElement>) {
    track("float_share", {
      inPlayM: Number(inPlayM),
      hasDelta: deltaLine !== null,
    });

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      e.preventDefault();
      navigator
        .share({
          title: "The Bitcoin Float · Galaxy Mind",
          text: tweet,
          url: `${SITE_URL}/float`,
        })
        .catch(() => {
          // User cancelled or browser refused · fall through to X
          // compose by manually navigating.
          window.open(composeUrl, "_blank", "noopener,noreferrer");
        });
    }
    // If no native share, the default <a href> behavior opens X compose.
  }

  // Copy-to-clipboard fallback affordance · for users who want the
  // raw text for Nostr / Discord / wherever.
  async function copyText() {
    try {
      await navigator.clipboard.writeText(tweet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      track("float_share_copied");
    } catch {
      /* clipboard refused · no-op */
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6 text-center">
      <div className="micro-label text-[var(--text-tertiary)] mb-2">
        Share the Supply Clock
      </div>
      <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)] mb-3">
        Tell someone how much bitcoin is{" "}
        <span className="text-[var(--accent-ink)] glow-text">actually left</span>
      </h3>
      <p className="text-xs text-[var(--text-secondary)] mb-5 max-w-md mx-auto">
        Opens your share sheet (or X compose) with a pre-filled message.
        Recipients see a live preview card with today&apos;s float number.
        The snapshot auto-updates when the data moves.
      </p>
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <a
          href={composeUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleShare}
          className="micro-label inline-flex items-baseline gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black font-semibold lit-primary hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
        >
          Share →
        </a>
        <button
          type="button"
          onClick={copyText}
          className="micro-label inline-flex items-baseline gap-2 px-4 py-2.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--accent-ink)] transition-colors"
          title="Copy the share text"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
