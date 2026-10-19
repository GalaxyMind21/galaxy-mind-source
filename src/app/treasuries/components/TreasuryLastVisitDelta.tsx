"use client";

/**
 * "Since your last visit" for the cheapest treasury (2026-07-11) · the
 * /stack LastCheckedDelta pattern on the mNAV race. Two stories worth
 * telling a returning visitor: the cheapest name got cheaper/richer, or
 * the crown changed hands ("cheapest flipped MPJPY → MSTR"). Pure
 * localStorage · 4h return-visit gate, 0.02x significance threshold.
 */

import { useEffect, useState } from "react";

const LS_KEY = "gm:treas:lastCheapest";

type Story =
  | { kind: "moved"; ticker: string; from: number; to: number }
  | { kind: "flipped"; from: string; to: string; mNAV: number };

export function TreasuryLastVisitDelta({
  rows,
}: {
  rows: { ticker: string; mNAV: number | null }[];
}) {
  const [story, setStory] = useState<Story | null>(null);

  useEffect(() => {
    const cheapest = rows
      .filter((r) => r.mNAV != null)
      .sort((a, b) => (a.mNAV ?? Infinity) - (b.mNAV ?? Infinity))[0];
    if (!cheapest || cheapest.mNAV == null) return;
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (raw) {
        const prev = JSON.parse(raw) as {
          ticker?: string;
          mNAV?: number;
          at?: number;
        };
        const hours =
          typeof prev.at === "number" ? (Date.now() - prev.at) / 3_600_000 : 0;
        // If the PREVIOUS cheapest ticker has a null mNAV this visit
        // (upstream data gap · a documented bitcointreasuries.net mode),
        // the crown only "flipped" because the data vanished. Say
        // nothing and keep the old baseline so the real comparison
        // survives the gap (audit 2026-07-11).
        const prevRowGapped =
          !!prev.ticker &&
          rows.some((r) => r.ticker === prev.ticker && r.mNAV == null);
        if (prevRowGapped) return;
        if (hours > 4 && typeof prev.mNAV === "number" && prev.ticker) {
          if (prev.ticker !== cheapest.ticker) {
            setStory({
              kind: "flipped",
              from: prev.ticker,
              to: cheapest.ticker,
              mNAV: cheapest.mNAV,
            });
          } else if (Math.abs(cheapest.mNAV - prev.mNAV) >= 0.02) {
            setStory({
              kind: "moved",
              ticker: cheapest.ticker,
              from: prev.mNAV,
              to: cheapest.mNAV,
            });
          }
        }
      }
      window.localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          ticker: cheapest.ticker,
          mNAV: cheapest.mNAV,
          at: Date.now(),
        }),
      );
    } catch {
      /* private mode · silently nothing */
    }
  }, [rows]);

  if (!story) return null;

  return (
    <div className="mt-3 flex justify-center">
      <div className="micro-label inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-3 py-1 text-[var(--text-secondary)]">
        Since your last visit:
        {story.kind === "flipped" ? (
          <span className="text-[var(--accent-ink)]">
            cheapest flipped {story.from} → {story.to} (
            {story.mNAV.toFixed(2)}x)
          </span>
        ) : (
          <>
            <span className="text-[var(--text-tertiary)]">
              {story.ticker} mNAV
            </span>
            <span
              className={`tabular-nums font-semibold ${
                story.to < story.from
                  ? "text-[var(--accent-ink)]"
                  : "text-[var(--cool-ink)]"
              }`}
            >
              {story.from.toFixed(2)}x → {story.to.toFixed(2)}x
            </span>
          </>
        )}
      </div>
    </div>
  );
}
