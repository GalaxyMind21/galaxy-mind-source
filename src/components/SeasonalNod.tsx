"use client";

// Seasonal one-line nod. Two bitcoin-culture dates only · Pizza Day
// (May 22, the 10,000-BTC pizza of 2010) and the genesis block
// (Jan 3, 2009). Renders a single quiet line on those two days and
// NOTHING on every other day · returns null, so no layout shift and
// nothing to regress the other 363 days.
//
// Mount-gated (returns null until the client effect runs) so there is
// no SSR/client hydration mismatch at a date boundary. Uses LOCAL
// date on purpose · "is it Pizza Day where the reader is" is the
// intuitive read, and mount-gating removes the hydration risk that
// would normally argue for UTC. Sits on the page background, so
// theme vars are correct here (legible in light and dark).

import { useEffect, useState } from "react";

type Nod = { emoji: string; date: string; line: string };

function nodFor(month: number, day: number): Nod | null {
  // month is 1-12.
  if (month === 5 && day === 22) {
    return {
      emoji: "🍕",
      date: "May 22",
      line: "Bitcoin Pizza Day. Two pizzas cost 10,000 BTC in 2010. This directory is a list of better things to spend it on.",
    };
  }
  if (month === 1 && day === 3) {
    return {
      emoji: "🧱",
      date: "January 3",
      line: 'The genesis block was mined in 2009. "Chancellor on brink of second bailout for banks."',
    };
  }
  return null;
}

export function SeasonalNod() {
  const [nod, setNod] = useState<Nod | null>(null);

  useEffect(() => {
    const now = new Date();
    setNod(nodFor(now.getMonth() + 1, now.getDate()));
  }, []);

  if (!nod) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 mb-6">
      <div className="flex items-center gap-3 rounded-lg border border-[var(--accent)]/25 bg-[var(--accent)]/[0.06] px-4 py-2.5 text-[12px] sm:text-[13px] text-[var(--text-secondary)]">
        <span aria-hidden className="text-base flex-shrink-0">
          {nod.emoji}
        </span>
        <span className="leading-relaxed">
          <span className="font-mono text-[var(--accent-ink)] uppercase tracking-[0.2em] mr-2">
            {nod.date}
          </span>
          {nod.line}
        </span>
      </div>
    </div>
  );
}
