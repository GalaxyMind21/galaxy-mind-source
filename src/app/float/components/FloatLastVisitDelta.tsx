"use client";

/**
 * "Since your last visit" for the float (2026-07-11) · the /stack
 * LastCheckedDelta pattern cloned onto the scarcity number. "1,850 BTC
 * left the float since Tuesday" makes depletion PERSONAL, which is the
 * whole retention thesis of this page. Pure localStorage · no server
 * call, no privacy surface.
 *
 * Direction language: the float SHRINKING is the bullish-scarcity event
 * (accent orange); a refill renders in the cool blue the site uses for
 * "down" gauge moves. Threshold 25 BTC + 4h so a same-session reload
 * never shows noise.
 */

import { useEffect, useState } from "react";

const LS_KEY = "gm:float:lastSeen";

export function FloatLastVisitDelta({ inPlayBtc }: { inPlayBtc: number }) {
  const [delta, setDelta] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(inPlayBtc) || inPlayBtc <= 0) return;
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (raw) {
        const prev = JSON.parse(raw) as { inPlay?: number; at?: number };
        const hours =
          typeof prev.at === "number" ? (Date.now() - prev.at) / 3_600_000 : 0;
        if (
          typeof prev.inPlay === "number" &&
          hours > 4 &&
          Math.abs(inPlayBtc - prev.inPlay) >= 25
        ) {
          setDelta(inPlayBtc - prev.inPlay);
        }
      }
      window.localStorage.setItem(
        LS_KEY,
        JSON.stringify({ inPlay: inPlayBtc, at: Date.now() }),
      );
    } catch {
      /* private mode · silently nothing */
    }
  }, [inPlayBtc]);

  if (delta == null) return null;
  const drained = delta < 0;
  const abs = Math.round(Math.abs(delta));

  return (
    <div className="mt-4 flex justify-center">
      <div className="micro-label inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-3 py-1 text-[var(--text-secondary)]">
        Since your last visit:
        <span
          className={`tabular-nums font-semibold ${
            drained ? "text-[var(--accent-ink)]" : "text-[var(--cool-ink)]"
          }`}
        >
          {drained ? "▼" : "▲"} {abs.toLocaleString("en-US")} BTC
        </span>
        <span className="text-[var(--text-tertiary)]">
          {drained ? "left the float" : "flowed back in"}
        </span>
      </div>
    </div>
  );
}
