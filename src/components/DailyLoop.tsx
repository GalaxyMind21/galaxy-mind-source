"use client";

/**
 * DailyLoop · the daily checklist card on /today (2026-07-11).
 *
 * One card showing every daily ritual and its state: WEN (solved with
 * sats, or open), CHOP (today's block sliced, or open), the HODL Trail
 * (expedition done, or open), the Gauntlet (done, or open), the Runner's
 * daily tape (your rank, or the invitation), the Daily Summit (best
 * climb time, or the invitation), and the Kart Daily Circuit (best lap
 * time, or the invitation), plus a live countdown to the next drops. An incomplete checklist is the
 * strongest come-back pull there is · this makes the daily loop VISIBLE
 * in one glance instead of scattered across cabinet pages.
 *
 * Pure localStorage + one board read for the runner rank · no new
 * upstream calls, matching /today's zero-new-fetch contract. LS keys
 * are hand-synced to the game components (deliberate bundle-splitting
 * choice · see TodayHabitExtras).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { isStaticHtmlRoute } from "@/lib/nav";
import { track } from "@vercel/analytics";
import { fetchBoard, fetchIdentity, getHandle } from "@/lib/arcade";
import { readActiveArcadeStreak } from "@/lib/arcade-streak";
import { gauntletNumber, nextGauntletAt } from "@/lib/gauntlet-day";
import { subscribeDailyStorage } from "@/lib/daily-state";

type ItemState =
  | { kind: "open" }
  | { kind: "done"; note: string };

function Row({
  href,
  label,
  state,
  cta,
  game,
  primary,
}: {
  href: string;
  label: string;
  state: ItemState;
  cta: string;
  game: string;
  /** First incomplete daily · louder border so the next habit is obvious */
  primary?: boolean;
}) {
  const done = state.kind === "done";
  return (
    <Link
      href={href}
      prefetch={isStaticHtmlRoute(href) ? false : undefined}
      onClick={() =>
        track("daily_loop_click", {
          game,
          state: done ? "done" : "open",
          primary: !!primary,
        })
      }
      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-colors ${
        primary && !done
          ? "border-[var(--accent)]/50 bg-[var(--accent)]/5 hover:border-[var(--accent)]/70"
          : "border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/60 hover:border-[var(--accent)]/40"
      }`}
    >
      <span
        aria-hidden
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full border t-xs font-bold ${
          done
            ? "border-[var(--success)]/60 text-[var(--success)]"
            : "border-[var(--accent)]/50 text-[var(--accent-ink)]"
        }`}
      >
        {done ? "✓" : "·"}
      </span>
      <span className="micro-label text-[var(--text-primary)]">
        {label}
      </span>
      <span className="ml-auto font-mono t-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)] text-right">
        {done ? state.note : cta}
      </span>
    </Link>
  );
}

export function DailyLoop() {
  const [n, setN] = useState(0);
  // Bumped by the countdown tick when the UTC day rolls · re-runs the
  // state reads so a tab left open overnight never shows yesterday's
  // done-states against a fresh countdown (audit 2026-07-11).
  const [epoch, setEpoch] = useState(0);
  const [wen, setWen] = useState<ItemState>({ kind: "open" });
  const [chop, setChop] = useState<ItemState>({ kind: "open" });
  const [gauntlet, setGauntlet] = useState<ItemState>({ kind: "open" });
  const [runner, setRunner] = useState<ItemState>({ kind: "open" });
  const [summit, setSummit] = useState<ItemState>({ kind: "open" });
  const [kart, setKart] = useState<ItemState>({ kind: "open" });
  const [trail, setTrail] = useState<ItemState>({ kind: "open" });
  const [arcadeStreak, setArcadeStreak] = useState(0);
  const [countdown, setCountdown] = useState("");

  useEffect(() => {
    const num = gauntletNumber(Date.now());
    setN(num);
    // Re-derive every row from scratch. The reads below only ever
    // transition a row to "done" — there is no path back — so on a UTC
    // rollover the epoch bump would re-run them against today's keys,
    // find nothing stored, and leave YESTERDAY's completions standing
    // against a fresh countdown. That is the exact state the epoch
    // mechanism was added to prevent (audit 2026-07-11); re-running the
    // reads is only half of it. These are batched with the reads in the
    // same effect body, so no row flickers on mount.
    setWen({ kind: "open" });
    setChop({ kind: "open" });
    setGauntlet({ kind: "open" });
    setRunner({ kind: "open" });
    setSummit({ kind: "open" });
    setKart({ kind: "open" });
    setTrail({ kind: "open" });
    try {
      const wraw = window.localStorage.getItem(`gm:wen:res:${num}`);
      if (wraw) {
        const wp = JSON.parse(wraw) as { sats?: number };
        setWen({
          kind: "done",
          note:
            typeof wp?.sats === "number"
              ? `${wp.sats.toLocaleString("en-US")} sats`
              : "solved",
        });
      }
      const craw = window.localStorage.getItem(`gm:chop:res:${num}`);
      if (craw) {
        const cp = JSON.parse(craw) as { sats?: number };
        setChop({
          kind: "done",
          note:
            typeof cp?.sats === "number"
              ? `${cp.sats.toLocaleString("en-US")} sats`
              : "cleared",
        });
      }
      if (window.localStorage.getItem(`gm:g2:res:${num}`)) {
        setGauntlet({ kind: "done", note: "done today" });
      }
      // Daily Summit · the game stores {day, bestMs} under its own
      // namespace (hand-synced key, same contract as the others)
      const sraw = window.localStorage.getItem("gm:super-saylor:summit");
      if (sraw) {
        const sp = JSON.parse(sraw) as { day?: number; bestMs?: number };
        if (sp?.day === num && typeof sp.bestMs === "number") {
          const s = Math.floor(sp.bestMs / 1000);
          const cs = Math.floor((sp.bestMs % 1000) / 10);
          setSummit({
            kind: "done",
            note: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${String(cs).padStart(2, "0")} best`,
          });
        }
      }
      // Kart Daily Circuit · the game stores today's best finish ms under
      // gm:bitcoin-kart:daily-best:{n} (hand-synced key, JSON number)
      const kraw = window.localStorage.getItem(`gm:bitcoin-kart:daily-best:${num}`);
      if (kraw) {
        const ms = JSON.parse(kraw) as number;
        if (typeof ms === "number" && ms > 0) {
          const ks = Math.floor(ms / 1000);
          const kd = Math.floor((ms % 1000) / 100);
          setKart({
            kind: "done",
            note: `${Math.floor(ks / 60)}:${String(ks % 60).padStart(2, "0")}.${kd} best`,
          });
        }
      }
      // HODL Trail · cabinet #7 stores today's finished run under
      // gm:trail:res:{n} (hand-synced key, same discipline as WEN). This
      // checklist had silently missed it — the newest daily generated
      // zero return pull from the habit page.
      if (window.localStorage.getItem(`gm:trail:res:${num}`)) {
        setTrail({ kind: "done", note: "expedition done" });
      }
      setArcadeStreak(readActiveArcadeStreak());
    } catch {
      /* private mode · everything reads open */
    }
    // Runner has no single daily completion · "done" = you're on
    // today's board. One cached board read, best-effort. X-linked
    // players' rows wear their @handle, so match that too.
    let alive = true;
    void (async () => {
      const [board, id] = await Promise.all([
        fetchBoard("runner", num),
        fetchIdentity(),
      ]);
      if (!alive || !board) return;
      const mine = new Set([getHandle()]);
      if (id.linked && id.handle) mine.add(`@${id.handle}`);
      const idx = board.rows.findIndex((r) => mine.has(r.name));
      if (idx >= 0) {
        setRunner({ kind: "done", note: `#${idx + 1} on today's tape` });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  useEffect(() => {
    const tick = () => {
      if (n > 0 && gauntletNumber(Date.now()) > n) {
        setEpoch((e) => e + 1);
        return;
      }
      const ms = Math.max(0, nextGauntletAt(Date.now()) - Date.now());
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      setCountdown(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    const unsub = subscribeDailyStorage(() => setEpoch((e) => e + 1));
    return () => {
      window.clearInterval(id);
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  if (n < 1) return null;
  // Count matches lib/daily-state (WEN, CHOP, Trail, Gauntlet, Summit,
  // Kart). Node Runner has no per-day done flag, so it is an extra
  // row, not part of the 6.
  const doneCount =
    (wen.kind === "done" ? 1 : 0) +
    (chop.kind === "done" ? 1 : 0) +
    (gauntlet.kind === "done" ? 1 : 0) +
    (summit.kind === "done" ? 1 : 0) +
    (kart.kind === "done" ? 1 : 0) +
    (trail.kind === "done" ? 1 : 0);

  // Open dailies first · the incomplete checklist is the return pull
  // (growth mandate 2026-07-13). Done rows sink so the next action is
  // always top-of-card on a phone.
  const rows: {
    href: string;
    label: string;
    state: ItemState;
    cta: string;
    game: string;
  }[] = [
    {
      href: "/wen",
      label: `WEN #${n}`,
      state: wen,
      cta: "date the tape · 30 seconds →",
      game: "wen",
    },
    {
      href: "/chop",
      label: `CHOP #${n}`,
      state: chop,
      cta: "slice today's block →",
      game: "chop",
    },
    {
      href: "/trail",
      label: `Trail day ${n}`,
      state: trail,
      cta: "lead the expedition →",
      game: "trail",
    },
    {
      href: "/gauntlet",
      label: `Gauntlet #${n}`,
      state: gauntlet,
      cta: "one scored run vs the bot →",
      game: "gauntlet",
    },
    {
      href: "/runner",
      label: "Node Runner",
      state: runner,
      cta: "race today's tape →",
      game: "runner",
    },
    {
      href: "/super-saylor",
      label: `Daily Summit #${n}`,
      state: summit,
      cta: "race today's mountain →",
      game: "summit",
    },
    {
      href: "/bitcoin-kart",
      label: `Daily Circuit #${n}`,
      state: kart,
      cta: "race today's combo →",
      game: "kart",
    },
  ];
  rows.sort((a, b) => {
    const ao = a.state.kind === "open" ? 0 : 1;
    const bo = b.state.kind === "open" ? 0 : 1;
    return ao - bo;
  });
  const firstOpen = rows.find((r) => r.state.kind === "open")?.game ?? null;

  return (
    <section
      className="mt-6 rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-4 sm:p-5"
      aria-label="Today's daily loop"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <span className="micro-label text-[var(--accent-ink)]">
          The daily loop · {doneCount}/6
        </span>
        <span className="font-mono t-xs uppercase tracking-[0.16em] text-[var(--text-tertiary)] tabular-nums">
          New drops in {countdown}
        </span>
      </div>
      {doneCount < 6 ? (
        <p className="text-xs text-[var(--text-secondary)] mb-3 leading-snug">
          {doneCount === 0
            ? "Six short dailies. Clear one now · come back tomorrow for a new set."
            : `${6 - doneCount} still open today. Tap the highlighted row.`}
        </p>
      ) : (
        // The Wordle day-2 mechanic: the moment everything is cleared is
        // exactly when tomorrow's return visit is decided. Show the streak
        // even at day 1 — day 1 is when a streak is born.
        <p className="text-xs text-[var(--text-secondary)] mb-3 leading-snug">
          All clear today
          {arcadeStreak >= 1 && (
            <>
              {" "}
              · arcade streak{" "}
              <span className="text-[var(--accent-ink)] tabular-nums">
                {arcadeStreak}d
              </span>
            </>
          )}{" "}
          · a fresh set drops in{" "}
          <span className="tabular-nums">{countdown}</span> — come back to
          keep it alive.
        </p>
      )}
      <div className="grid gap-2">
        {rows.map((r) => (
          <Row
            key={r.game}
            href={r.href}
            label={r.label}
            state={r.state}
            cta={r.cta}
            game={r.game}
            primary={r.game === firstOpen}
          />
        ))}
      </div>
    </section>
  );
}
