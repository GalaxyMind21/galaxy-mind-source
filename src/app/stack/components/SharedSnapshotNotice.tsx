"use client";

/* =====================================================================
 * SharedSnapshotNotice · context strip for shared-verdict arrivals.
 *
 * The site's highest-intent acquisition moment is someone clicking a
 * shared /stack?s=95&t=MOLTEN&d=... link from X. Before this strip,
 * they landed on the LIVE page · if the gauge had moved, the page
 * silently contradicted the card they clicked ("95 MOLTEN" became
 * "77 HOT" with no explanation), so either the tool looked broken or
 * the sharer looked wrong (review 2026-06-11).
 *
 * Renders only when valid snapshot params are present AND the live
 * reading differs. Param validation mirrors generateMetadata in
 * /stack/page.tsx exactly (integer 0-100, allow-listed tier,
 * YYYY-MM-DD date) · no prose from the URL is ever rendered, every
 * shown value is re-derived from validated primitives.
 *
 * Integrity gate (2026-07-10 Grok audit · M7): shape validity is not
 * enough. A hand-crafted /stack?s=99&t=MOLTEN&d=2026-07-01 is shaped
 * fine but never corresponded to a real reading · echoing it on the
 * page presents a fabricated "official snapshot" (the same reputation
 * attack the OG card gate refuses). We now verify the (date, score,
 * tier) triple against the server-supplied `verifiedByDate` map — the
 * exact stored history rows — and render nothing when it doesn't match,
 * mirroring the /api/og/stack gate's date+score+tier check.
 *
 * useSearchParams needs a Suspense boundary above it · satisfied by
 * the StackSkeleton boundary that already wraps StackContent.
 * ===================================================================== */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { track } from "@vercel/analytics";

const VALID_TIERS = new Set(["COLD", "CHILL", "WARM", "HOT", "MOLTEN"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function SharedSnapshotNotice({
  liveScore,
  liveTier,
  verifiedByDate,
}: {
  liveScore: number;
  liveTier: string;
  // date → the exact stored reading for that day (server-supplied from
  // stack:history). A shared snapshot is echoed only if its triple is in
  // here · this is the integrity gate, not a display detail.
  verifiedByDate: Record<string, { score: number; tier: string }>;
}) {
  const sp = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  const sRaw = sp.get("s");
  const tRaw = sp.get("t");
  const dRaw = sp.get("d");

  const score =
    sRaw !== null && /^\d{1,3}$/.test(sRaw)
      ? Math.max(0, Math.min(100, Number.parseInt(sRaw, 10)))
      : null;
  const tier = tRaw && VALID_TIERS.has(tRaw) ? tRaw : null;
  const date = dRaw && DATE_RE.test(dRaw) ? dRaw : null;

  // Require the full triple incl. a valid date · aligns with the
  // OG-card integrity gate (audit 2026-06-14). A bare ?s=&t= with no
  // date is an unverifiable claim, so we don't echo it on the page
  // either · legit shares always carry the date.
  if (dismissed || score === null || tier === null || date === null)
    return null;
  // Integrity gate · the triple must match a real stored row for that
  // date (same contract as /api/og/stack). A shape-valid but fabricated
  // snapshot is silently ignored · never echoed as if it were official.
  const real = verifiedByDate[date];
  if (!real || real.score !== score || real.tier !== tier) return null;
  // Same reading → the page agrees with the card, nothing to explain.
  if (score === liveScore && tier === liveTier) return null;

  const direction = liveScore > score ? "up from" : "down from";

  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-[var(--accent)]/35 bg-[var(--bg-elevated)] px-4 py-2.5 flex items-baseline gap-3 t-xs font-sans leading-relaxed"
    >
      <span className="flex-1 text-[var(--text-secondary)]">
        You came from a shared snapshot:{" "}
        <span className="font-mono tabular-nums text-[var(--text-primary)]">
          {score} {tier}
        </span>
        {date ? <> on <span className="font-mono tabular-nums">{date}</span></> : null}
        . The gauge now reads{" "}
        <span className="font-mono tabular-nums text-[var(--accent-ink)]">
          {liveScore} {liveTier}
        </span>{" "}
        · {direction} the moment it was shared. That movement is the
        whole point ·{" "}
        <a
          href="#alerts"
          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
          onClick={() => track("snapshot_notice_alerts_click")}
        >
          get alerted when it moves again →
        </a>
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss snapshot notice"
        className="shrink-0 font-mono text-lg leading-none px-2 py-1 -my-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
