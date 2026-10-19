"use client";

/**
 * Compact capture strip for SEO / doorway pages.
 * Live gauge teaser + email for extremes + link to daily briefing.
 */

import Link from "next/link";
import { InlineSubscribePrompt } from "@/components/InlineSubscribePrompt";

export function HabitCaptureStrip({
  eyebrow = "Come back tomorrow",
}: {
  eyebrow?: string;
}) {
  return (
    <section className="my-10 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-6">
      <div className="mb-1 font-mono t-xs uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
        {eyebrow}
      </div>
      <h2 className="mb-2 text-lg font-semibold tracking-tight text-[var(--text-primary)]">
        Make Galaxy Mind your daily Bitcoin read
      </h2>
      <p className="mb-4 max-w-xl text-sm text-[var(--text-secondary)] leading-relaxed">
        Extreme days hit email when you want them. Every morning,{" "}
        <Link href="/today" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
          Today in Bitcoin
        </Link>{" "}
        composes the gauge, float, cheapest treasury, and new merchants in
        one place.
      </p>
      <InlineSubscribePrompt
        source="seo"
        headline="Alert me on extreme gauge days"
        subhead="Free · one click · change channels anytime in prefs."
      />
      <div className="micro-label mt-4 flex flex-wrap gap-3">
        <Link
          href="/today"
          className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]"
        >
          Open today&apos;s briefing →
        </Link>
        <Link
          href="/stack"
          className="text-[var(--text-tertiary)] hover:text-[var(--accent-ink)]"
        >
          Live Buying Gauge
        </Link>
        <Link
          href="/gauntlet"
          className="text-[var(--text-tertiary)] hover:text-[var(--accent-ink)]"
        >
          Daily Gauntlet
        </Link>
      </div>
    </section>
  );
}
