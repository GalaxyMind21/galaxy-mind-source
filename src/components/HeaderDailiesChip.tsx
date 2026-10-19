"use client";

/**
 * Header daily-state chip (2026-07-11 · replaced HeaderGauntletChip).
 *
 * The header used to promote only "Gauntlet #N" while WEN, the lowest-
 * friction daily, was invisible until the Arcade flyout. This chip shows
 * the STATE of the daily loop sitewide:
 *   · several dailies open → "N dailies open" → next still-open game
 *   · one open             → that game's own chip → its page
 *   · all done             → quiet "Dailies done ✓" → /today (the loop hub)
 * Roster lives in lib/daily-state (WEN, CHOP, Trail, Gauntlet, Summit,
 * Kart). The Runner has no per-day completion state, so it stays out
 * of the count · DailyLoop still lists it as an extra row.
 * Pure localStorage reads · same hand-synced result keys the games write.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { gauntletNumber } from "@/lib/gauntlet-day";
import { readDailyDone, countOpenDailies, nextOpenDaily, subscribeDailyStorage } from "@/lib/daily-state";

type ChipState =
  | { kind: "hidden" }
  | { kind: "open"; n: number; open: number; href: string; label: string; title: string }
  | { kind: "done" };

export function HeaderDailiesChip() {
  const pathname = usePathname() ?? "/";
  const [state, setState] = useState<ChipState>({ kind: "hidden" });
  // 60s day re-check · a tab parked overnight must not keep showing
  // "Dailies done" against the new day (audit 2026-07-11).
  const [dayEpoch, setDayEpoch] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setDayEpoch((e) => e + 1), 60_000);
    const unsub = subscribeDailyStorage(() => setDayEpoch((e) => e + 1));
    return () => {
      window.clearInterval(id);
      unsub();
    };
  }, []);

  useEffect(() => {
    try {
      const n = gauntletNumber(Date.now());
      if (n < 1) return;
      // Canonical done-map · lib/daily-state (the four daily-set surfaces
      // used to hand-copy this block and drifted apart).
      const d = readDailyDone(n);
      const open = countOpenDailies(d);
      const next = nextOpenDaily(d, n);
      if (open === 0 || !next) setState({ kind: "done" });
      else
        setState({
          kind: "open",
          n,
          open,
          href: next.href,
          label: open > 1 ? `${open} dailies open` : next.label,
          title: next.title,
        });
    } catch {
      setState({ kind: "hidden" });
    }
  }, [pathname, dayEpoch]);

  if (state.kind === "hidden") return null;
  // Off the arcade surfaces · the cabinets sell themselves there.
  if (
    pathname.startsWith("/arcade") ||
    pathname.startsWith("/wen") ||
    pathname.startsWith("/chop") ||
    pathname.startsWith("/trail") ||
    pathname.startsWith("/gauntlet") ||
    pathname.startsWith("/super-saylor") ||
    pathname.startsWith("/bitcoin-kart")
  ) {
    return null;
  }

  const base =
    "hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono t-xs uppercase tracking-[0.16em]";

  if (state.kind === "done") {
    return (
      <Link
        href="/today"
        className={`${base} border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--accent-ink)]`}
        title="All dailies done · see today's briefing"
        aria-label="All daily games are done. See today's briefing."
      >
        Dailies done <span aria-hidden>✓</span>
      </Link>
    );
  }

  const { href, label, title } = state;

  return (
    <Link
      href={href}
      className={`${base} border-[var(--accent)]/35 bg-[var(--bg-elevated)] text-[var(--accent-ink)] hover:bg-[var(--accent)]/10`}
      title={title}
      aria-label={title}
    >
      {label}
    </Link>
  );
}
