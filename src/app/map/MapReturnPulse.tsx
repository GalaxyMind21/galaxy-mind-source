"use client";

/**
 * Return-visitor pulse for /map (2026-07-11) · the homepage's "N new
 * since your last visit" pattern on the atlas. Makes a repeat visit
 * open with movement instead of a static map. Pure localStorage.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

const LS_KEY = "gm:map:lastVisit";

export function MapReturnPulse({
  listedAts,
}: {
  /** listedAt unix-seconds for every vendor · tiny payload. */
  listedAts: number[];
}) {
  const [fresh, setFresh] = useState(0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (raw) {
        const prev = JSON.parse(raw) as { at?: number };
        const hours =
          typeof prev.at === "number" ? (Date.now() - prev.at) / 3_600_000 : 0;
        if (hours > 4 && typeof prev.at === "number") {
          const cutoffSec = prev.at / 1000;
          setFresh(listedAts.filter((v) => v > cutoffSec).length);
        }
      }
      window.localStorage.setItem(LS_KEY, JSON.stringify({ at: Date.now() }));
    } catch {
      /* private mode · silently nothing */
    }
  }, [listedAts]);

  if (fresh < 1) return null;

  return (
    <div className="mb-4 flex">
      <Link
        href="/?sort=new"
        className="micro-label inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/35 bg-[var(--bg-elevated)] px-3 py-1 text-[var(--accent-ink)] hover:bg-[var(--bg-elevated-2)]"
      >
        {fresh} new merchant{fresh === 1 ? "" : "s"} since your last visit →
      </Link>
    </div>
  );
}
