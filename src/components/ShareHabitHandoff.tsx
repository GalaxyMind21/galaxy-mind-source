/**
 * ShareHabitHandoff · secondary CTAs on arcade share-landing pages.
 *
 * Share cards exist to convert a social click into a play. Primary CTA
 * stays the game. This strip is the cross-funnel: one calm path into the
 * daily briefing + instruments so viral arcade traffic can become
 * recurring instrument traffic instead of a one-session spike.
 *
 * Pure server component · no client JS. Used on every /…/card/[data]
 * (and Super Saylor / WEN c/ siblings).
 */

import Link from "next/link";

export function ShareHabitHandoff({
  source,
}: {
  /** Analytics-friendly label for which cabinet landed the visitor. */
  source:
    | "wen"
    | "gauntlet"
    | "runner"
    | "saylor"
    | "kart"
    | "chop";
}) {
  return (
    <div
      className="mt-10 pt-6 border-t border-[var(--border-subtle)]"
      data-share-habit-handoff={source}
    >
      {/* micro-label · canonical mono eyebrow, holds the 12px floor */}
      <div className="micro-label text-[var(--text-tertiary)] mb-3">
        While you&apos;re here
      </div>
      <div className="micro-label flex flex-wrap justify-center gap-x-4 gap-y-2">
        <Link
          href="/today"
          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)] underline-offset-4"
        >
          Today&apos;s briefing
        </Link>
        <span aria-hidden className="text-[var(--text-tertiary)]">
          ·
        </span>
        <Link
          href="/stack"
          className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
        >
          Buying Gauge
        </Link>
        <span aria-hidden className="text-[var(--text-tertiary)]">
          ·
        </span>
        <Link
          href="/"
          className="text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
        >
          Spend bitcoin
        </Link>
      </div>
      {/* 12px floor · this is read prose, not decorative instrument type */}
      <p className="mt-3 t-xs text-[var(--text-tertiary)] leading-relaxed max-w-sm mx-auto">
        Four live numbers every morning · gauge, float, cheapest treasury,
        new merchants. Free tools, no account.
      </p>
    </div>
  );
}
