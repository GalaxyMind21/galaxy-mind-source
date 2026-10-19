"use client";

/**
 * Non-email retention for /fit · "since you last tuned, live signals
 * would shift sleeve X". Stores last (h,t,a) + sleeve weights in LS.
 */

import { useEffect, useState } from "react";
import type { recommend } from "@/lib/recommend";

const LS_KEY = "gm:fit:lastResult";

type FitResult = ReturnType<typeof recommend>;

type Stored = {
  h: number;
  t: number;
  a: string;
  at: number;
  sleeves: { ticker: string; weight: number }[];
};

export function FitLastVisitPulse({
  horizon,
  tolerance,
  account,
  result,
}: {
  horizon: number;
  tolerance: number;
  account: string;
  result: FitResult | null;
}) {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    // Always clear first so a profile change never leaves a stale banner.
    setMsg(null);
    if (!result?.allocation?.length) return;
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      const now: Stored = {
        h: horizon,
        t: tolerance,
        a: account,
        at: Date.now(),
        sleeves: result.allocation.map((s: FitResult["allocation"][number]) => ({
          ticker: s.asset.ticker,
          weight: s.weight,
        })),
      };

      if (raw) {
        const prev = JSON.parse(raw) as Stored;
        const hours = (Date.now() - (prev.at || 0)) / 3_600_000;
        const sameProfile =
          prev.h === horizon && prev.t === tolerance && prev.a === account;
        if (hours > 12 && sameProfile && Array.isArray(prev.sleeves)) {
          let biggest: { ticker: string; delta: number } | null = null;
          for (const s of now.sleeves) {
            const p = prev.sleeves.find((x) => x.ticker === s.ticker);
            const pw = p?.weight ?? 0;
            // weights are 0–1 · convert delta to percentage points
            const d = Math.round((s.weight - pw) * 1000) / 10;
            if (!biggest || Math.abs(d) > Math.abs(biggest.delta)) {
              biggest = { ticker: s.ticker, delta: d };
            }
            if (!p && s.weight > 0) {
              const dNew = Math.round(s.weight * 1000) / 10;
              if (!biggest || Math.abs(dNew) > Math.abs(biggest.delta)) {
                biggest = { ticker: s.ticker, delta: dNew };
              }
            }
          }
          if (biggest && Math.abs(biggest.delta) >= 3) {
            const sign = biggest.delta > 0 ? "+" : "";
            setMsg(
              `Since your last visit with this profile, live signals shift ${biggest.ticker} by ${sign}${biggest.delta}pp`,
            );
          }
        }
      }

      window.localStorage.setItem(LS_KEY, JSON.stringify(now));
    } catch {
      /* ignore */
    }
  }, [horizon, tolerance, account, result]);

  if (!msg) return null;

  return (
    <div className="mb-4 rounded-lg border border-[var(--accent)]/25 bg-[var(--accent)]/5 px-4 py-2.5 font-mono t-xs text-[var(--text-secondary)]">
      <span className="text-[var(--accent-ink)]">Welcome back · </span>
      {msg}
    </div>
  );
}
