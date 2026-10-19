"use client";

// Home page rental tile (operator 2026-10-17; moved): a quiet, secondary pointer to /hashrate that renders
// BELOW the directory grid. The home page's first viewport stays the free vendor directory (bitcoin.org listing). Live count reuses lib/mrr-units.ts (same 15-minute freshness rule as
// /hashrate, re-checked here every 30 s): stale or missing data hides the count, zero free shows "All rented right now.
// Check back soon." with no outbound link (the marketplace profile page is login-walled, 2026-10-17). Click events are anonymous (@vercel/analytics: surface + state).
// No prices, no hardware model, no rig ids, no named pool.
import Link from "next/link";
import { useEffect, useState } from "react";
import { track } from "@vercel/analytics";

export type HomeRentView = { state: "live"; at: number; freeCount: number } | { state: "stale" | "unavailable" };
export type HomeRentCopy = {
  kicker: string; title: string; sub: string; live: string; none: string; cta: string;
};

const STALE_MS = 15 * 60 * 1000;

export function HomeRentHero({ view, copy }: { view: HomeRentView; copy: HomeRentCopy }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const fresh = view.state === "live" && (now == null || now - view.at <= STALE_MS) ? view : null;
  const state = fresh ? (fresh.freeCount > 0 ? "live" : "none_free") : "stale";

  return (
    <section aria-labelledby="home-rent-h" className="mx-auto mb-6 max-w-6xl px-4 sm:px-6" data-home-rent={state}>
      <div className="hero-glass rounded-2xl p-4 sm:p-5">
        <p className="micro-label text-[var(--text-tertiary)]">{copy.kicker}</p>
        <h2 id="home-rent-h" className="mt-1 max-w-2xl text-[17px] font-medium leading-snug text-[var(--text-primary)] sm:text-[19px]">
          {copy.title}
        </h2>
        <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-[var(--text-secondary)]">{copy.sub}</p>

        {state === "live" && fresh && (
          <p className="mt-3 inline-flex items-center gap-2 font-mono text-[13px] tabular-nums text-[var(--text-secondary)]" data-home-live-line>
            <span aria-hidden className="bay-dot-open inline-block h-2 w-2 rounded-full" />
            {copy.live.replace("{N}", String(fresh.freeCount))}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link
            href="/hashrate"
            onClick={() => track("home_rent_cta_click", { surface: "home_below_directory", state })}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full border border-[var(--border-subtle)] px-4 text-[14px] font-medium text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--accent)]/60 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            data-home-rent-cta
          >
            {copy.cta}
            <span aria-hidden>→</span>
          </Link>
        </div>

        {state === "none_free" && (
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-secondary)]" data-home-none-free>{copy.none}</p>
        )}
      </div>
    </section>
  );
}
