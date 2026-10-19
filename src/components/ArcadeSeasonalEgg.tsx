"use client";

// Seasonal arcade banner · shows a real bitcoin-history anniversary on
// its day, nothing otherwise. Client-side so it keys off the viewer's
// local date (not the hourly-cached server render). Renders nothing on
// the first paint to avoid a hydration mismatch, then fills in on mount.

import { useEffect, useState } from "react";
import { seasonalEgg, type SeasonalEgg } from "@/lib/arcade-easter-eggs";

export function ArcadeSeasonalEgg() {
  const [egg, setEgg] = useState<SeasonalEgg | null>(null);

  useEffect(() => {
    setEgg(seasonalEgg(new Date()));
  }, []);

  if (!egg) return null;

  return (
    <div className="mb-8 flex max-w-2xl items-start gap-3 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/5 px-4 py-3">
      <span className="text-2xl leading-none" aria-hidden>
        {egg.emoji}
      </span>
      <span className="min-w-0">
        <span className="block font-mono t-xs uppercase tracking-[0.2em] text-[var(--accent-ink)]">
          {egg.title}
        </span>
        <span className="block text-sm text-[var(--text-secondary)] leading-relaxed">
          {egg.note}
        </span>
      </span>
    </div>
  );
}
