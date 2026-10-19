"use client";

/* =====================================================================
 * THE HODL TRAIL · client cabinet (cabinet #7 · 2026-07-25).
 *
 * All game math lives in lib/hodl-trail (pure, shared verbatim with
 * the server replay verifier) · this component is only screens, the
 * localStorage action log, and the board/cloud plumbing. Mid-run
 * resume replays the saved action log through runTrailPartial, so a
 * refresh can never fork a run away from what the proof will say.
 * ===================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  K_TRAIL_PROG,
  K_TRAIL_RES,
  K_TRAIL_STATS,
  K_TRAIL_UNSENT,
  TRAIL_LEGS,
  TRAIL_PARTY_SIZE,
  TRAIL_START_SATS,
  TRAIL_SURVIVOR_BONUS,
  buildTrailShareText,
  runTrail,
  runTrailPartial,
  survivorLineFor,
  trailEventsFor,
  trailPartyFor,
  type TrailAction,
  type TrailLegOutcome,
} from "@/lib/hodl-trail";
import { TRAIL_ERAS } from "@/lib/trail-deck";
import { gauntletNumber, nextGauntletAt } from "@/lib/gauntlet-day";
import { submitScore } from "@/lib/arcade";
import { recordArcadePlay } from "@/lib/arcade-streak";
import { useArcadeCloud } from "@/lib/useArcadeCloud";
import { withAttribution, xIntentUrl } from "@/lib/share-templates";

type Phase = "intro" | "leg" | "outcome" | "done";

type TrailStats = {
  played: number;
  totalSats: number;
  best: number;
  citadels: number;
  plebsLost: number;
  streak: number;
  lastDay: number;
};

const EMPTY_STATS: TrailStats = {
  played: 0,
  totalSats: 0,
  best: 0,
  citadels: 0,
  plebsLost: 0,
  streak: 0,
  lastDay: 0,
};

function lsGet<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function lsSet(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* best-effort */
  }
}
function lsDel(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* best-effort */
  }
}

function fmtSats(n: number): string {
  return n.toLocaleString("en-US");
}

export function TrailGame() {
  // Day resolves on the client (Date.now is fine here · the ENGINE
  // never reads a clock). null until mounted to avoid SSR mismatch.
  const [day, setDay] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [actions, setActions] = useState<TrailAction[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [alloc, setAlloc] = useState(50);
  const [rank, setRank] = useState<number | null>(null);
  const [posted, setPosted] = useState<"idle" | "sending" | "ok" | "fail">(
    "idle",
  );
  const [stats, setStats] = useState<TrailStats>(EMPTY_STATS);
  const [countdown, setCountdown] = useState("");
  const [copied, setCopied] = useState(false);

  // ── cloud save (X-linked players only · durable fields, never
  //    day-state) ────────────────────────────────────────────────────
  const readCloud = useCallback(() => {
    const s = lsGet<TrailStats>(K_TRAIL_STATS) ?? EMPTY_STATS;
    return { best: s.best, stats: s };
  }, []);
  const adoptCloud = useCallback(
    (merged: { best?: number; stats?: Partial<TrailStats> } | null) => {
      if (!merged || typeof merged !== "object") return;
      const local = lsGet<TrailStats>(K_TRAIL_STATS) ?? EMPTY_STATS;
      const m = merged.stats ?? {};
      const next: TrailStats = {
        played: Math.max(local.played, m.played ?? 0),
        totalSats: Math.max(local.totalSats, m.totalSats ?? 0),
        best: Math.max(local.best, merged.best ?? 0, m.best ?? 0),
        citadels: Math.max(local.citadels, m.citadels ?? 0),
        plebsLost: Math.max(local.plebsLost, m.plebsLost ?? 0),
        // The server merge already applied day-continuity to the pair ·
        // adopt it only when it is at least as fresh as local.
        streak:
          (m.lastDay ?? 0) >= local.lastDay ? (m.streak ?? 0) : local.streak,
        lastDay: Math.max(local.lastDay, m.lastDay ?? 0),
      };
      lsSet(K_TRAIL_STATS, next);
      setStats(next);
    },
    [],
  );
  const pushCloud = useArcadeCloud("trail", readCloud, adoptCloud);

  // ── mount · resume today's run / result ───────────────────────────
  useEffect(() => {
    const n = gauntletNumber(Date.now());
    setDay(n);
    setStats(lsGet<TrailStats>(K_TRAIL_STATS) ?? EMPTY_STATS);
    const res = lsGet<{ actions: TrailAction[] }>(K_TRAIL_RES(n));
    if (res && runTrail(n, res.actions)) {
      setActions(res.actions);
      setPhase("done");
    } else {
      const prog = lsGet<{ actions: TrailAction[] }>(K_TRAIL_PROG(n));
      if (prog && runTrailPartial(n, prog.actions)) {
        setActions(prog.actions);
        setPhase(prog.actions.length > 0 ? "outcome" : "intro");
      }
    }
    // Unsent board post from an interrupted session · retry while the
    // day is still open, drop once it is stale (server rejects those).
    const unsent = lsGet<{ day: number; score: number; proof: TrailAction[] }>(
      K_TRAIL_UNSENT,
    );
    if (unsent) {
      if (unsent.day === n) {
        submitScore("trail", unsent.score, unsent.day, unsent.proof).then(
          (r) => {
            if (r) lsDel(K_TRAIL_UNSENT);
          },
        );
      } else {
        lsDel(K_TRAIL_UNSENT);
      }
    }
  }, []);

  const events = useMemo(() => (day ? trailEventsFor(day) : []), [day]);
  const party = useMemo(() => (day ? trailPartyFor(day) : []), [day]);
  const partial = useMemo(
    () => (day ? runTrailPartial(day, actions) : null),
    [day, actions],
  );
  const final = useMemo(
    () => (day && phase === "done" ? runTrail(day, actions) : null),
    [day, actions, phase],
  );
  const leg = actions.length;
  const sats = partial?.sats ?? TRAIL_START_SATS;
  const lastOutcome: TrailLegOutcome | null =
    partial && partial.outcomes.length > 0
      ? partial.outcomes[partial.outcomes.length - 1]
      : null;
  const deadNames = useMemo(
    () =>
      new Set(
        (partial?.outcomes ?? [])
          .filter((o) => o.death)
          .map((o) => o.death!.pleb),
      ),
    [partial],
  );

  // ── countdown on the done screen ──────────────────────────────────
  useEffect(() => {
    if (phase !== "done") return;
    const tick = () => {
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
    return () => window.clearInterval(id);
  }, [phase]);

  // ── commit a choice ────────────────────────────────────────────────
  const commit = useCallback(
    (choiceIdx: number, allocPct: number) => {
      if (day == null || leg >= TRAIL_LEGS) return;
      const next: TrailAction[] = [...actions, [leg, choiceIdx, allocPct]];
      if (!runTrailPartial(day, next)) return; // engine says illegal · ignore
      setActions(next);
      lsSet(K_TRAIL_PROG(day), { actions: next });
      setPicked(null);
      setAlloc(50);
      setPhase("outcome");
    },
    [day, leg, actions],
  );

  // ── finish the expedition ─────────────────────────────────────────
  const finalize = useCallback(() => {
    if (day == null) return;
    const r = runTrail(day, actions);
    if (!r) return;
    lsSet(K_TRAIL_RES(day), { actions });
    lsDel(K_TRAIL_PROG(day));
    // Stats · trail streak pair uses day-continuity, same as WEN.
    const prev = lsGet<TrailStats>(K_TRAIL_STATS) ?? EMPTY_STATS;
    if (prev.lastDay !== day) {
      const next: TrailStats = {
        played: prev.played + 1,
        totalSats: prev.totalSats + r.score,
        best: Math.max(prev.best, r.score),
        citadels: prev.citadels + (r.survivors > 0 ? 1 : 0),
        plebsLost: prev.plebsLost + (TRAIL_PARTY_SIZE - r.survivors),
        streak: prev.lastDay === day - 1 ? prev.streak + 1 : 1,
        lastDay: day,
      };
      lsSet(K_TRAIL_STATS, next);
      setStats(next);
    }
    recordArcadePlay();
    try {
      window.dispatchEvent(new CustomEvent("gm:arcade-finished"));
    } catch {
      /* private / non-window */
    }
    setPhase("done");
    setPosted("sending");
    submitScore("trail", r.score, day, actions).then((res) => {
      if (res) {
        setPosted("ok");
        setRank(res.rank);
        lsDel(K_TRAIL_UNSENT);
      } else {
        setPosted("fail");
        lsSet(K_TRAIL_UNSENT, { day, score: r.score, proof: actions });
      }
    });
    pushCloud();
  }, [day, actions, pushCloud]);

  const shareText = useMemo(() => {
    if (!final || day == null) return "";
    return buildTrailShareText(day, final.score, final.grid, final.survivors);
  }, [final, day]);

  const copyShare = useCallback(() => {
    if (!shareText) return;
    try {
      navigator.clipboard.writeText(withAttribution(shareText));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }, [shareText]);

  if (day == null) {
    return (
      <div className="micro-label rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-8 text-center text-[var(--text-tertiary)]">
        Loading the trail…
      </div>
    );
  }

  const partyStrip = (
    <div className="flex flex-wrap gap-2">
      {party.map((name) => {
        const dead = deadNames.has(name);
        return (
          <span
            key={name}
            className={`rounded-full border px-3 py-1 micro-label ${
              dead
                ? "border-red-900/60 text-red-400/70 line-through opacity-60"
                : "border-[var(--border-subtle)] text-[var(--text-secondary)]"
            }`}
          >
            {dead ? "🪦 " : ""}
            {name}
          </span>
        );
      })}
    </div>
  );

  const hud = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="micro-label text-[var(--text-tertiary)]">
        Expedition #{day}
        {phase !== "intro" && phase !== "done" ? (
          <span>
            {" "}· leg {Math.min(leg + (phase === "leg" ? 1 : 0), TRAIL_LEGS)}
            /{TRAIL_LEGS}
          </span>
        ) : null}
      </div>
      <div className="font-mono text-sm tabular-nums text-[var(--accent-ink)]">
        {fmtSats(sats)} sats
      </div>
    </div>
  );

  // ── INTRO ──────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7">
        {hud}
        <h2 className="text-lg sm:text-xl font-semibold mb-2">
          Four plebs. Fifteen years. One stack.
        </h2>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4 max-w-2xl">
          Lead your caravan from the 2011 backwoods to the citadel,
          {" "}{fmtSats(TRAIL_START_SATS)} sats in the family wagon. Ten legs,
          one per era, actual history in every one. Choices stake sats ·
          the right call is whatever bitcoin history actually rewarded.
          Everyone worldwide rides the same trail today.
        </p>
        <div className="mb-5">{partyStrip}</div>
        <ul className="mb-6 space-y-1.5 t-xs text-[var(--text-secondary)]">
          <li>· One expedition per UTC day · the board is the race</li>
          <li>
            · Heavy stakes on reckless calls can cost a pleb · survivors bank
            {" "}{fmtSats(TRAIL_SURVIVOR_BONUS)} sats each at the citadel
          </li>
          <li>· Scores are replay-verified · the board can&apos;t be faked</li>
        </ul>
        <button
          onClick={() => setPhase("leg")}
          className="micro-label rounded-lg bg-[var(--accent)] px-6 py-3 font-bold text-black transition-shadow hover:shadow-[0_0_18px_var(--accent-glow)]"
        >
          Hitch the wagon →
        </button>
      </section>
    );
  }

  // ── DONE ───────────────────────────────────────────────────────────
  if (phase === "done" && final) {
    const wiped = final.survivors === 0;
    return (
      <section
        className={`rounded-xl border p-5 sm:p-7 bg-[var(--bg-elevated)] ${
          wiped
            ? "border-red-900/60"
            : "border-[var(--accent)]/40 shadow-[0_0_28px_rgba(247,147,26,0.08)]"
        }`}
      >
        {hud}
        <div className="mb-1 micro-label text-[var(--text-tertiary)]">
          {wiped ? "The caravan was lost" : "Citadel reached"}
        </div>
        <div className="mb-2 text-3xl sm:text-4xl font-semibold tabular-nums">
          {fmtSats(final.score)}{" "}
          <span className="text-base text-[var(--text-secondary)]">sats</span>
        </div>
        <div className="mb-4 text-2xl tracking-[0.1em]">{final.grid}</div>
        <p className="mb-1 text-sm text-[var(--text-secondary)]">
          {wiped
            ? "Every pleb fell on the trail. The stack scattered to the mempool winds."
            : `${final.survivors} of ${TRAIL_PARTY_SIZE} plebs made it · ${fmtSats(final.sats)} on the wagon + ${fmtSats(final.survivors * TRAIL_SURVIVOR_BONUS)} survivor bonus.`}
        </p>
        <p className="micro-label mb-5 text-[var(--accent-ink)]">
          {wiped ? "🪦 GMI next time" : `🏰 ${survivorLineFor(day)}`}
        </p>
        <div className="mb-5">{partyStrip}</div>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <a
            href={xIntentUrl(withAttribution(shareText))}
            target="_blank"
            rel="noopener noreferrer"
            className="micro-label rounded-lg bg-[var(--accent)] px-5 py-2.5 font-bold text-black transition-shadow hover:shadow-[0_0_18px_var(--accent-glow)]"
          >
            Share the run
          </a>
          <button
            onClick={copyShare}
            className="micro-label rounded-lg border border-[var(--border-subtle)] px-5 py-2.5 text-[var(--text-secondary)] hover:border-[var(--accent)]/50"
          >
            {copied ? "✓ Copied" : "Copy result"}
          </button>
        </div>
        <div className="space-y-1 t-xs text-[var(--text-secondary)]">
          <p>
            {posted === "ok" && rank != null
              ? `#${rank} on today's board`
              : posted === "ok"
                ? "Posted to today's board"
                : posted === "sending"
                  ? "Posting to the board…"
                  : posted === "fail"
                    ? "Board post queued · retries on your next visit"
                    : ""}
          </p>
          {stats.streak > 1 ? (
            <p>
              🔥 {stats.streak}-day trail streak · best{" "}
              {fmtSats(stats.best)} sats
            </p>
          ) : null}
          <p className="micro-label text-[var(--text-tertiary)]">
            Next expedition in {countdown}
          </p>
        </div>
      </section>
    );
  }

  // ── OUTCOME ────────────────────────────────────────────────────────
  if (phase === "outcome" && lastOutcome) {
    const ev = events[lastOutcome.leg];
    const done =
      (partial?.wiped ?? false) || actions.length === TRAIL_LEGS;
    return (
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7">
        {hud}
        <div className="mb-1 micro-label text-[var(--text-tertiary)]">
          {TRAIL_ERAS[lastOutcome.leg].label} · {ev.year} · {ev.title}
        </div>
        <div
          className={`mb-2 text-3xl font-semibold tabular-nums ${
            lastOutcome.delta > 0
              ? "text-[var(--success)]"
              : lastOutcome.delta < 0
                ? "text-red-400"
                : "text-[var(--text-secondary)]"
          }`}
        >
          {lastOutcome.delta > 0 ? "+" : ""}
          {fmtSats(lastOutcome.delta)} sats
        </div>
        <p className="mb-3 text-sm text-[var(--text-secondary)]">
          {lastOutcome.death
            ? "It bit, and it bit deep."
            : lastOutcome.hit
              ? "The trail bit."
              : lastOutcome.big
                ? "The trail was generous."
                : lastOutcome.delta > 0
                  ? "The trail was kind."
                  : "The wagon rolls on, unchanged."}
        </p>
        {lastOutcome.death ? (
          <div className="mb-4 rounded-lg border border-red-900/60 bg-[var(--bg-elevated-2)] p-4">
            <div className="mb-1 micro-label text-red-400/80">
              🪦 Here lies {lastOutcome.death.pleb}
            </div>
            <div className="text-sm text-[var(--text-secondary)] italic">
              &ldquo;{lastOutcome.death.line}&rdquo;
            </div>
          </div>
        ) : null}
        {ev.hint ? (
          <p className="mb-5 border-l-2 border-[var(--border-subtle)] pl-3 t-xs leading-relaxed text-[var(--text-tertiary)]">
            {ev.hint}
          </p>
        ) : null}
        <button
          onClick={() => (done ? finalize() : setPhase("leg"))}
          className="micro-label rounded-lg bg-[var(--accent)] px-6 py-3 font-bold text-black transition-shadow hover:shadow-[0_0_18px_var(--accent-glow)]"
        >
          {done ? "See the reckoning →" : "Press on →"}
        </button>
      </section>
    );
  }

  // ── LEG ────────────────────────────────────────────────────────────
  const ev = events[leg];
  if (!ev) return null;
  const era = TRAIL_ERAS[leg];
  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7">
      {hud}
      <div className="mb-3">{partyStrip}</div>
      <div className="mb-1 micro-label text-[var(--accent-ink)]">
        {era.label} · {era.years}
      </div>
      <h2 className="mb-2 text-lg sm:text-xl font-semibold">
        {ev.year} · {ev.title}
      </h2>
      <p className="mb-5 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
        {ev.prose}
      </p>
      <div className="space-y-3">
        {ev.choices.map((c, i) => {
          const active = picked === i;
          const stakedPreview = c.slider
            ? Math.round((sats * alloc) / 100)
            : Math.round(sats * c.stake);
          return (
            <div
              key={i}
              className={`rounded-lg border transition-colors ${
                active
                  ? "border-[var(--accent)]/60 bg-[var(--bg-elevated-2)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-elevated-2)]/50 hover:border-[var(--accent)]/40"
              }`}
            >
              <button
                onClick={() =>
                  c.slider
                    ? setPicked(active ? null : i)
                    : commit(i, 0)
                }
                className="w-full p-4 text-left"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold">{c.label}</span>
                  <span className="shrink-0 micro-label text-[var(--text-tertiary)]">
                    {c.slider
                      ? active
                        ? `stakes ${fmtSats(stakedPreview)} sats`
                        : "you set the stake"
                      : c.stake > 0
                        ? `stakes ~${Math.round(c.stake * 100)}%`
                        : "stakes nothing"}
                  </span>
                </div>
                {c.detail ? (
                  <div className="mt-1 t-xs text-[var(--text-tertiary)]">
                    {c.detail}
                  </div>
                ) : null}
              </button>
              {c.slider && active ? (
                <div className="border-t border-[var(--border-subtle)] p-4">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={alloc}
                    onChange={(e) => setAlloc(Number(e.target.value))}
                    className="w-full accent-[var(--accent)]"
                    aria-label="Stake percentage"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-mono t-xs tabular-nums text-[var(--text-secondary)]">
                      {alloc}% · {fmtSats(stakedPreview)} sats at risk
                    </span>
                    <button
                      onClick={() => commit(i, alloc)}
                      className="rounded-lg bg-[var(--accent)] px-4 py-2 micro-label font-bold text-black transition-shadow hover:shadow-[0_0_18px_var(--accent-glow)]"
                    >
                      Commit
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
