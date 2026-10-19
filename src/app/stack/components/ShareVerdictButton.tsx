"use client";

// "Share this verdict" button — opens X compose with a pre-filled
// tweet about the current Buying Gauge state. Drives organic
// distribution: every shared link includes the dynamic OG card from
// /stack/opengraph-image.tsx, which shows the score at share-time.
//
// Lives below the contrarian pitch on /stack so visitors share AFTER
// they've internalized the score — not impulsively at first sight.

import { track } from "@vercel/analytics";
import { TIER_LABEL, type StackTier } from "@/lib/stack";

const SITE_URL = "https://galaxymind.space";

// UTC YYYY-MM-DD · keeps the snapshot URL deterministic across time
// zones. We anchor the snapshot to the current UTC day; the OG renderer
// (/api/og/stack) just echoes whatever date string we pass.
function todayUtcIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Tier-specific "vibe" line that goes in the tweet body. Picked to
// feel quotable and shareable in each regime — not too clinical, not
// too cringe.
const TIER_VIBE: Record<StackTier, string> = {
  COLD:   "Crowd is euphoric. The data isn't impressed. Patience.",
  CHILL:  "Below-average entry. No edge in either direction.",
  WARM:   "Mixed signals. DCA on schedule.",
  HOT:    "Conditions are favorable. Stack with conviction.",
  MOLTEN: "🩸 Blood in the streets. The exact moment Baron Rothschild was talking about.",
};

export function ShareVerdictButton({
  score,
  tier,
  verified,
}: {
  score: number;
  tier: StackTier;
  // The newest FINALIZED daily snapshot (score/tier/date), when history is
  // available. Prefer it for the share URL: the OG history gate
  // (/api/og/stack) only renders a card when s/t/d match a stored row, and
  // the live intraday reading usually won't, so a live-valued card
  // silently falls back to the generic image (2026-07-10 Grok audit · C1).
  verified?: { date: string; score: number; tier: StackTier } | null;
}) {
  // Share the official reading when we have it; fall back to the live
  // verdict only when history is unavailable (the card may then miss the
  // gate, but the tweet still goes out — better than nothing).
  const cardScore = verified ? verified.score : score;
  const cardTier = verified ? verified.tier : tier;
  const cardDate = verified ? verified.date : todayUtcIso();

  const tierLabel = TIER_LABEL[cardTier];
  const vibe = TIER_VIBE[cardTier];

  // Per-verdict URL · s/t/d point at the finalized daily row so the OG
  // card renders the real reading. The page itself always shows the live
  // verdict when clicked through; only the social preview is frozen. See
  // generateMetadata in /stack/page.tsx + /api/og/stack route.
  const snapshotUrl = `${SITE_URL}/stack?s=${cardScore}&t=${cardTier}&d=${cardDate}`;

  const tweet = [
    `Bitcoin Buying Gauge: ${cardScore}/100 · ${tierLabel}.`,
    "",
    vibe,
    "",
    snapshotUrl,
  ].join("\n");

  const composeUrl =
    "https://x.com/intent/tweet?text=" + encodeURIComponent(tweet);

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6 text-center">
      <div className="micro-label text-[var(--text-tertiary)] mb-2">
        Share the verdict
      </div>
      <h2 className="text-base sm:text-lg font-semibold text-[var(--text-primary)] mb-3">
        Tell someone the gauge says{" "}
        <span className="text-[var(--accent-ink)] glow-text">{tierLabel}</span>
      </h2>
      {/* Copy 2026-07-10 · the card renders today's OFFICIAL daily
          reading (the value the OG history gate will accept), not the
          live intraday number. Say that plainly · claiming "this exact
          reading" over the live gauge was the mismatch that made cards
          fall back to the generic image (Grok audit · C1). */}
      <p className="text-xs text-[var(--text-secondary)] mb-5 max-w-md mx-auto">
        Opens X with a pre-filled tweet. The link carries a snapshot card
        of today&apos;s official reading · a timestamped call. The page
        itself always shows the live verdict.
      </p>
      <a
        href={composeUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() =>
          track("stack_share_verdict", { score: cardScore, tier: cardTier })
        }
        className="micro-label inline-flex items-baseline gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] text-black font-semibold hover:bg-[var(--accent-hover)] hover:lit-primary transition-all"
      >
        Share on X →
      </a>
      <div className="micro-label mt-3 text-[var(--text-tertiary)]">
        Card stays frozen at {cardScore} · today&apos;s official reading
      </div>
    </div>
  );
}
