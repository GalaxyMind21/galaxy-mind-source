"use client";

/* =====================================================================
 * GauntletGame · the cabinet (v2 · blind-history roguelike).
 *
 * All game logic lives in ./engine (pure, tested headless). This file
 * is the painter and the controls:
 *
 *   · 60fps values (chart, price, day counter, net worth, live alpha)
 *     write straight to DOM via refs · React renders only on phase
 *     changes, cards, and trades. Dynamic glyph layers (day-change
 *     bars, trade arrows) are each ONE <path> whose `d` is rebuilt
 *     per frame · no per-node churn, no innerHTML.
 *   · The tape advances in fractional days at a player-chosen speed;
 *     integer day boundaries run through engine.advanceDay, which is
 *     where salary, bills, margin checks, bots, and headlines happen.
 *   · Dates are MASKED while running (a lock where the calendar
 *     would be) and unmasked by <Reveal /> when the run settles.
 *   · Daily mode = one shared seeded window per UTC day, one scored
 *     attempt, streaks in localStorage. Practice = unlimited seeds.
 * ===================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { submitScore } from "@/lib/arcade";
import { useArcadeCloud } from "@/lib/useArcadeCloud";
import { loadBtcHistory, type BtcPoint } from "@/lib/btc-history-client";
import {
  CTX_DAYS,
  RUN_DAYS,
  type EventCard,
  type FinalReport,
  type GameState,
  type RunSetup,
  advanceDay,
  buy,
  createState,
  finish,
  gauntletNumber,
  marginEquity,
  mulberry32,
  netWorth,
  nextGauntletAt,
  openMargin,
  priceAt,
  sell,
  setupRun,
} from "./engine";
import Link from "next/link";
import { Reveal } from "./Reveal";
import { useGauntletAudio } from "./useGauntletAudio";

const SPEEDS = [3, 6, 12]; // days per real second
const SPEED_LABELS = [1, 2, 4];

// Decision-cadence pacing · when the tape goes calm (no card AND no
// trade for this many days) the game drops a gentle, non-blocking prompt
// so a quiet stretch still reads as a choice, not dead air. Capped per
// run so it prompts, never nags (games audit 2026-07-09).
const QUIET_DAYS = 45;
const MAX_NUDGES = 2;
const QUIET_LINES = [
  "Quiet tape. Accumulating, or holding fiat for a better entry?",
  "Nothing is forcing your hand. Sitting still is a position too.",
];
const VIEW = 120; // visible display days in the tape window
const W = 100;
const H = 40;

const DIM = "rgba(235,225,210,0.55)";
const DIM2 = "rgba(235,225,210,0.66)";

const K_RES = (n: number) => `gm:g2:res:${n}`;
const K_STREAK = "gm:g2:streak";
const K_BADGES = "gm:g2:badges";
const K_BEST = "gm:g2:best";
const K_LOG = "gm:g2:log";
// Set once the player has seen the first-run coaching card · gates the
// guided (paused) opener so it shows exactly once (games audit).
const K_ONBOARDED = "gm:g2:onboarded";

// A challenge link replays someone else's exact practice window:
// ?w=<seed36>.<epochDay36>&a=<their alpha>. The epoch day lets
// setupRun shift the window back to the same absolute dates.
type Challenge = { seed: number; shift: number; alpha: number | null };

type LogEntry = { m: "d" | "p"; n: number | null; a: number; tier: string };

type Phase = "loading" | "error" | "ready" | "running" | "card" | "reveal";

type Float = { id: number; text: string; tone: "up" | "down" };

// Replay-proof action · [runDay, kind, engineArg] with kind 0=buy(usd),
// 1=sell(fraction), 2=openMargin(usd). The score API replays this log
// through the same pure engine and rejects a score the sim doesn't
// reproduce (lib/arcade-replay · 2026-07-11).
type ProofAction = [number, number, number];

// `proof` rides in the stored daily result so the boot-time retry of a
// failed board post can still carry it.
type DailyDone = {
  alpha: number;
  tier: string;
  grid: string;
  proof?: ProofAction[];
};

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode etc · game still works, nothing persists */
  }
}

function fmtUsd(v: number): string {
  return "$" + Math.round(v).toLocaleString("en-US");
}

// Triangle glyph path segments · one path per color class keeps the
// per-frame work to a handful of setAttribute("d") calls.
const upTri = (x: number, y: number) =>
  `M${x.toFixed(2)} ${(y + 1.4).toFixed(2)}l1.05 1.9h-2.1z`;
const downTri = (x: number, y: number) =>
  `M${x.toFixed(2)} ${(y - 1.4).toFixed(2)}l1.05 -1.9h-2.1z`;
const cross = (x: number, y: number) =>
  `M${(x - 1).toFixed(2)} ${(y - 1).toFixed(2)}L${(x + 1).toFixed(2)} ${(y + 1).toFixed(2)}M${(x - 1).toFixed(2)} ${(y + 1).toFixed(2)}L${(x + 1).toFixed(2)} ${(y - 1).toFixed(2)}`;
const barSeg = (x: number, y: number, h: number) =>
  `M${x.toFixed(2)} ${y.toFixed(2)}h0.56v${h.toFixed(2)}h-0.56z`;

export function GauntletGame() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setup, setSetup] = useState<RunSetup | null>(null);
  const [card, setCard] = useState<EventCard | null>(null);
  const [report, setReport] = useState<FinalReport | null>(null);
  // Today's board rank · arrives async from the score post, feeds the
  // reveal share text (operator request 2026-07-09).
  const [boardRank, setBoardRank] = useState<number | null>(null);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [floats, setFloats] = useState<Float[]>([]);
  const [dailyDone, setDailyDone] = useState<DailyDone | null>(null);
  const [streak, setStreak] = useState(0);
  const [shelf, setShelf] = useState<string[]>([]);
  const [best, setBest] = useState<number | null>(null);
  const [newBadges, setNewBadges] = useState<string[]>([]);
  const [countdown, setCountdown] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  // The one-time guided opener · the first run ever starts paused behind
  // a coaching card so a newcomer reads the loop before the tape moves.
  const [firstRunHint, setFirstRunHint] = useState(false);
  // Quiet-window nudge · a transient, non-blocking prompt (see QUIET_*).
  const [nudge, setNudge] = useState<string | null>(null);
  const { audioOn, toggleAudio, play } = useGauntletAudio();

  // Node Runner now lives on its own page (operator request
  // 2026-07-08) · old /gauntlet#runner deep links redirect there.
  useEffect(() => {
    if (window.location.hash === "#runner") {
      window.location.replace("/runner");
    }
  }, []);

  const pointsRef = useRef<BtcPoint[]>([]);
  const gsRef = useRef<GameState | null>(null);
  // The run's executed player actions, in order · becomes the replay
  // proof on a daily submit. Only calls the engine actually traded on
  // are recorded (trades-length growth · the engine's clamps decide).
  const actionsRef = useRef<ProofAction[]>([]);
  const setupRefCurrent = useRef<RunSetup | null>(null);
  const phaseRef = useRef<Phase>("loading");
  const mountedRef = useRef(true);
  // Quiet-window pacing state · the day of the last card/trade, how many
  // nudges this run has fired, and the auto-dismiss timer.
  const lastActiveDayRef = useRef(0);
  const nudgeCountRef = useRef(0);
  const nudgeTimerRef = useRef<number | null>(null);
  const rngRef = useRef<() => number>(() => 0.5);
  const dayFloatRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const speedRef = useRef(SPEEDS[0]);
  const pausedRef = useRef(false);
  const floatIdRef = useRef(0);
  const reducedMotion = useRef(false);
  const numberRef = useRef(1);

  // Paint targets
  const cabinetRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const barsUpRef = useRef<SVGPathElement>(null);
  const barsDownRef = useRef<SVGPathElement>(null);
  const buysRef = useRef<SVGPathElement>(null);
  const sellsRef = useRef<SVGPathElement>(null);
  const forcedRef = useRef<SVGPathElement>(null);
  const marginTradesRef = useRef<SVGPathElement>(null);
  const liqRef = useRef<SVGPathElement>(null);
  const priceRef = useRef<HTMLSpanElement>(null);
  const dayRef = useRef<HTMLSpanElement>(null);
  const netRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLSpanElement>(null);
  const btcRef = useRef<HTMLSpanElement>(null);
  const fiatRef = useRef<HTMLSpanElement>(null);
  const marginRef = useRef<HTMLDivElement>(null);

  speedRef.current = SPEEDS[speedIdx];
  pausedRef.current = paused;
  setupRefCurrent.current = setup;
  phaseRef.current = phase;

  // ── Boot ─────────────────────────────────────────────────────────
  useEffect(() => {
    reducedMotion.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const n = gauntletNumber(Date.now());
    numberRef.current = n;
    const doneToday = readJson<DailyDone>(K_RES(n));
    setDailyDone(doneToday);
    // Retry today's board post if it never got verified · submitScore
    // dedupes internally (it only marks "sent" after a confirmed write), so
    // this re-posts a failed one and is a no-op once it succeeded. Without
    // this, a completed run whose first post failed never reappears, since
    // handleComplete only submits when there is no stored daily result yet
    // (2026-07-10 bug audit · H1).
    if (doneToday) {
      submitScore("gauntlet", doneToday.alpha, n, doneToday.proof);
    }
    const st = readJson<{ last: number; n: number }>(K_STREAK);
    setStreak(st && (st.last === n || st.last === n - 1) ? st.n : 0);
    setShelf(readJson<string[]>(K_BADGES) ?? []);
    const b = readJson<number>(K_BEST);
    if (typeof b === "number") setBest(b);
    setLog(readJson<LogEntry[]>(K_LOG) ?? []);

    // Challenge link? Strictly validated · anything off spec is ignored.
    try {
      const w = new URLSearchParams(window.location.search).get("w");
      const aRaw = new URLSearchParams(window.location.search).get("a");
      if (w && /^[0-9a-z]{1,8}\.[0-9a-z]{1,8}$/.test(w)) {
        const [s36, d36] = w.split(".");
        const seed = parseInt(s36, 36);
        const day = parseInt(d36, 36);
        const todayDay = Math.floor(Date.now() / 86_400_000);
        const shift = todayDay - day;
        if (
          Number.isInteger(seed) &&
          seed > 0 &&
          shift >= 0 &&
          shift < 1400
        ) {
          const alpha =
            aRaw && /^-?\d{1,3}(\.\d)?$/.test(aRaw) ? Number(aRaw) : null;
          setChallenge({ seed, shift, alpha });
        }
      }
    } catch {
      /* malformed URL · plain visit */
    }

    let alive = true;
    loadBtcHistory()
      .then((pts) => {
        if (!alive) return;
        // Trim the trailing two closes: the last point mutates
        // intraday, and daily mode needs every player on the same
        // UTC day to sim the exact same window.
        pointsRef.current = pts.slice(0, pts.length - 2);
        setPhase("ready");
      })
      .catch(() => alive && setPhase("error"));
    return () => {
      alive = false;
      mountedRef.current = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (nudgeTimerRef.current != null) clearTimeout(nudgeTimerRef.current);
    };
  }, []);

  // The daily lock must roll over WITHOUT a reload · a tab left open
  // past UTC midnight (or a phone waking the next morning) recomputes
  // its gauntlet number on visibility changes and a slow tick,
  // unlocking the new shared window (review 2026-07-08). An active
  // run is untouched · endRun attributes to the number the run
  // started under.
  useEffect(() => {
    const sync = () => {
      const n = gauntletNumber(Date.now());
      if (n === numberRef.current) return;
      numberRef.current = n;
      setDailyDone(readJson<DailyDone>(K_RES(n)));
      const st = readJson<{ last: number; n: number }>(K_STREAK);
      setStreak(st && (st.last === n || st.last === n - 1) ? st.n : 0);
    };
    document.addEventListener("visibilitychange", sync);
    const iv = setInterval(sync, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      clearInterval(iv);
    };
  }, []);

  // Countdown to the next daily · ticks while the stamped screen shows.
  useEffect(() => {
    if (phase !== "ready" || !dailyDone) return;
    const tick = () => {
      const ms = nextGauntletAt(Date.now()) - Date.now();
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setCountdown(`${h}h ${m}m`);
    };
    tick();
    const iv = setInterval(tick, 30_000);
    return () => clearInterval(iv);
  }, [phase, dailyDone]);

  // ── Painter ──────────────────────────────────────────────────────
  const paint = useCallback(() => {
    const s = gsRef.current;
    const st = setupRefCurrent.current;
    if (!s || !st) return;
    const prices = st.prices;
    const df = dayFloatRef.current;
    const i = CTX_DAYS + Math.min(RUN_DAYS, Math.floor(df));
    const frac = Math.min(1, df - Math.floor(df));
    const pNow =
      prices[i] + (prices[Math.min(prices.length - 1, i + 1)] - prices[i]) * frac;

    const end = CTX_DAYS + df;
    const start = Math.max(0, end - VIEW);
    const lo0 = Math.max(0, Math.floor(start));
    const hi0 = Math.min(prices.length - 1, Math.floor(end));
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = lo0; k <= hi0; k++) {
      if (prices[k] < lo) lo = prices[k];
      if (prices[k] > hi) hi = prices[k];
    }
    if (pNow < lo) lo = pNow;
    if (pNow > hi) hi = pNow;
    const pad = (hi - lo) * 0.12 || 1;
    lo -= pad;
    hi += pad;

    const X = (idx: number) => ((idx - start) / (end - start || 1)) * W;
    const Y = (p: number) => H - ((p - lo) / (hi - lo)) * H;

    let d = "";
    for (let k = lo0; k <= hi0; k++) {
      d += (d === "" ? "M" : "L") + X(k).toFixed(2) + " " + Y(prices[k]).toFixed(2);
    }
    d += "L" + X(end).toFixed(2) + " " + Y(pNow).toFixed(2);
    lineRef.current?.setAttribute("d", d);
    areaRef.current?.setAttribute(
      "d",
      d + `L${X(end).toFixed(2)} ${H}L${X(lo0).toFixed(2)} ${H}Z`,
    );

    // Day-change bar strip · one path per color, height by |Δ|.
    let up = "";
    let down = "";
    for (let k = Math.max(lo0, 1); k <= hi0; k++) {
      const chg = prices[k] / prices[k - 1] - 1;
      const bh = Math.min(4, Math.abs(chg) * 55);
      if (bh < 0.15) continue;
      const seg = barSeg(X(k) - 0.28, H + 1.2 + (4 - bh), bh);
      if (chg >= 0) up += seg;
      else down += seg;
    }
    barsUpRef.current?.setAttribute("d", up);
    barsDownRef.current?.setAttribute("d", down);

    // Trade glyphs in the visible window · one path per class.
    let buys = "";
    let sells = "";
    let forced = "";
    let marginT = "";
    let liq = "";
    for (const t of s.trades) {
      const idx = CTX_DAYS + t.day;
      if (idx < start || idx > end) continue;
      const x = X(idx);
      const y = Y(t.price);
      if (t.kind === "buy") buys += upTri(x, y);
      else if (t.kind === "margin-open") marginT += upTri(x, y);
      else if (t.kind === "liq") liq += cross(x, y);
      else if (t.kind === "forced") forced += downTri(x, y);
      else sells += downTri(x, y);
    }
    buysRef.current?.setAttribute("d", buys);
    sellsRef.current?.setAttribute("d", sells);
    forcedRef.current?.setAttribute("d", forced);
    marginTradesRef.current?.setAttribute("d", marginT);
    liqRef.current?.setAttribute("d", liq);

    // HUD
    if (priceRef.current) {
      priceRef.current.textContent =
        "$" + Math.round(pNow).toLocaleString("en-US");
    }
    if (dayRef.current) {
      dayRef.current.textContent = `DAY ${Math.min(RUN_DAYS, Math.floor(df))} / ${RUN_DAYS}`;
    }
    const net = netWorth(s, pNow);
    if (netRef.current) netRef.current.textContent = fmtUsd(net);
    const dcaNow = s.dcaFiat + s.dcaBtc * pNow;
    const alpha = dcaNow > 0 ? (net / dcaNow - 1) * 100 : 0;
    if (alphaRef.current) {
      alphaRef.current.textContent = `${alpha >= 0 ? "+" : ""}${alpha.toFixed(1)}% vs bot`;
      alphaRef.current.style.color = alpha >= 0 ? "#31C48D" : "#FB923C";
    }
    if (btcRef.current) btcRef.current.textContent = "₿ " + s.btc.toFixed(5);
    if (fiatRef.current) fiatRef.current.textContent = fmtUsd(s.fiat);
    if (marginRef.current) {
      if (s.margin) {
        const eq = Math.max(0, marginEquity(s.margin, pNow));
        marginRef.current.style.display = "";
        marginRef.current.textContent = `2X OPEN · ${fmtUsd(eq)} · liq ${fmtUsd(s.margin.entry * 0.625)}`;
      } else {
        marginRef.current.style.display = "none";
      }
    }
  }, []);

  // ── cross-device cloud save (X-linked players · 2026-07-18) ─────────
  // Sync the DURABLE record only: best alpha, badge shelf, and the day
  // streak. Today's stamped result (K_RES · carries the replay proof) and
  // the display log are day/recency state and must never sync. The streak
  // is translated to the shared {last, len} shape (local uses {last, n}).
  const readCloud = useCallback(() => {
    const st = readJson<{ last: number; n: number }>(K_STREAK);
    return {
      best: readJson<number>(K_BEST), // number | null (alpha, can be negative)
      badges: readJson<string[]>(K_BADGES) ?? [],
      streak: st ? { last: st.last, len: st.n } : { last: 0, len: 0 },
    };
  }, []);
  const adoptCloud = useCallback((m: { best?: number | null; badges?: string[]; streak?: { last: number; len: number } }) => {
    if (!m || typeof m !== "object") return;
    // best alpha · adopt only if strictly better (never regress on device)
    if (typeof m.best === "number" && Number.isFinite(m.best)) {
      const cur = readJson<number>(K_BEST);
      if (cur == null || m.best > cur) { writeJson(K_BEST, m.best); setBest(m.best); }
    }
    // badges · union with current local
    if (Array.isArray(m.badges) && m.badges.length > 0) {
      const prev = readJson<string[]>(K_BADGES) ?? [];
      const merged = [...prev];
      for (const id of m.badges) if (typeof id === "string" && !merged.includes(id)) merged.push(id);
      if (merged.length !== prev.length) { writeJson(K_BADGES, merged); setShelf(merged); }
    }
    // streak · day-continuity, never regress a chain extended on this device
    const ms = m.streak;
    if (ms && typeof ms.last === "number" && typeof ms.len === "number") {
      const cur = readJson<{ last: number; n: number }>(K_STREAK) ?? { last: 0, n: 0 };
      if (ms.last > cur.last || (ms.last === cur.last && ms.len > cur.n)) {
        writeJson(K_STREAK, { last: ms.last, n: ms.len });
        const today = numberRef.current;
        setStreak(ms.last === today || ms.last === today - 1 ? ms.len : 0);
      }
    }
  }, []);
  const pushCloud = useArcadeCloud("gauntlet", readCloud, adoptCloud);

  // ── End of run ───────────────────────────────────────────────────
  const endRun = useCallback(() => {
    const s = gsRef.current;
    const st = setupRefCurrent.current;
    if (!s || !st) return;
    const rep = finish(s, st);
    const prevShelf = readJson<string[]>(K_BADGES) ?? [];
    const fresh = rep.badges
      .map((b) => b.id)
      .filter((id) => !prevShelf.includes(id));
    if (fresh.length > 0) {
      writeJson(K_BADGES, [...prevShelf, ...fresh]);
      setShelf([...prevShelf, ...fresh]);
    }
    setNewBadges(fresh);
    const prevBest = readJson<number>(K_BEST);
    if (prevBest == null || rep.alpha > prevBest) {
      writeJson(K_BEST, rep.alpha);
      setBest(rep.alpha);
    }
    if (st.mode === "daily" && st.number != null) {
      // One scored run per day means the FIRST completed run stands ·
      // a second tab whose in-memory state was stale must not
      // overwrite the result or reset the streak (review 2026-07-08).
      const existing = readJson<DailyDone>(K_RES(st.number));
      const done = existing ?? {
        alpha: rep.alpha,
        tier: rep.tier,
        grid: rep.grid,
        proof: actionsRef.current,
      };
      if (!existing) {
        writeJson(K_RES(st.number), done);
        // First (= the scored) run posts to today's public board
        // under the player's arcade handle · the returned rank feeds
        // the share text once it lands. The action log rides along as
        // the replay proof (server re-sims the run before it lands).
        setBoardRank(null);
        submitScore("gauntlet", rep.alpha, st.number, actionsRef.current).then(
          (res) => {
            if (mountedRef.current && res && res.rank != null)
              setBoardRank(res.rank);
          },
        );
      }
      setDailyDone(done);
      const prev = readJson<{ last: number; n: number }>(K_STREAK);
      const nStreak =
        prev && prev.last === st.number
          ? prev.n
          : prev && prev.last === st.number - 1
            ? prev.n + 1
            : 1;
      writeJson(K_STREAK, { last: st.number, n: nStreak });
      setStreak(nStreak);
    }
    // Pilot log · last six runs on the ready screen.
    const entry: LogEntry = {
      m: st.mode === "daily" ? "d" : "p",
      n: st.number,
      a: Math.round(rep.alpha * 10) / 10,
      tier: rep.tier,
    };
    const nextLog = [entry, ...(readJson<LogEntry[]>(K_LOG) ?? [])].slice(0, 6);
    writeJson(K_LOG, nextLog);
    setLog(nextLog);
    pushCloud(); // sync best + badges + streak to the X account (linked players)
    play("stamp");
    setReport(rep);
    setPhase("reveal");
    track("gauntlet2_done", {
      mode: st.mode,
      alpha: Math.round(rep.alpha * 10) / 10,
      tier: rep.tier,
    });
  }, [play]);

  // ── Loop ─────────────────────────────────────────────────────────
  const loop = useCallback(
    (ts: number) => {
      const s = gsRef.current;
      const st = setupRefCurrent.current;
      if (!s || !st) return;
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = Math.min(0.1, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      if (!document.hidden && !pausedRef.current) {
        dayFloatRef.current += dt * speedRef.current;
      }

      while (s.day < Math.min(RUN_DAYS, Math.floor(dayFloatRef.current))) {
        const c = advanceDay(s, st, rngRef.current);
        if (c) {
          dayFloatRef.current = s.day;
          lastActiveDayRef.current = s.day;
          paint();
          setCard(c);
          setPhase("card");
          play(
            c.id.startsWith("liq-")
              ? "liq"
              : c.tone === "fear"
                ? "card-fear"
                : c.tone === "euphoria"
                  ? "card-euphoria"
                  : c.tone === "bill"
                    ? "card-bill"
                    : "card-margin",
          );
          if (
            (c.tone === "fear" || c.tone === "bill") &&
            !reducedMotion.current &&
            cabinetRef.current
          ) {
            cabinetRef.current.classList.add("gauntlet-shake");
            setTimeout(
              () => cabinetRef.current?.classList.remove("gauntlet-shake"),
              500,
            );
          }
          track("gauntlet2_card", { id: c.id.replace(/-\d+$/, "") });
          return;
        }
      }

      if (dayFloatRef.current >= RUN_DAYS) {
        dayFloatRef.current = RUN_DAYS;
        paint();
        endRun();
        return;
      }

      // Quiet-window nudge · the tape has been calm (no card, no trade)
      // for QUIET_DAYS. Drop one gentle prompt, then re-arm for another
      // quiet stretch, up to MAX_NUDGES per run. Non-blocking · the sim
      // keeps running underneath.
      if (
        phaseRef.current === "running" &&
        nudgeCountRef.current < MAX_NUDGES &&
        s.day - lastActiveDayRef.current >= QUIET_DAYS
      ) {
        const line = QUIET_LINES[nudgeCountRef.current % QUIET_LINES.length];
        nudgeCountRef.current += 1;
        lastActiveDayRef.current = s.day;
        setNudge(line);
        if (nudgeTimerRef.current != null) clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = window.setTimeout(() => {
          if (mountedRef.current) setNudge(null);
        }, 4800);
      }

      paint();
      // Only the running phase keeps the loop alive · a defensive stop
      // so no stray chain can advance the sim behind a modal or a
      // finished run (double-start guard 2026-07-09).
      if (phaseRef.current !== "running") return;
      rafRef.current = requestAnimationFrame(loop);
    },
    [paint, endRun, play],
  );

  const startRun = useCallback(
    (mode: "daily" | "practice", chal?: Challenge | null) => {
      const pts = pointsRef.current;
      if (pts.length === 0) return;
      // Double-click / double-tap guard · a second start before the
      // phase leaves the ready screen would spawn a SECOND rAF loop
      // (2x tape speed, the sim running behind the event-card modal,
      // and an orphaned loop leaking past unmount). Cancel any pending
      // frame and refuse to start while a run is already live.
      if (phaseRef.current === "running" || phaseRef.current === "card") return;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      const n = numberRef.current;
      const seed = chal
        ? chal.seed
        : mode === "daily"
          ? (0x5eed ^ Math.imul(n, 2654435761)) >>> 0
          : (Math.floor(Math.random() * 2 ** 31) ^ 0x9e37) >>> 0;
      let st: RunSetup;
      try {
        st = setupRun(
          pts,
          seed,
          mode,
          mode === "daily" ? n : null,
          chal?.shift ?? 0,
        );
      } catch {
        setPhase("error");
        return;
      }
      setSetup(st);
      setupRefCurrent.current = st;
      gsRef.current = createState(st);
      actionsRef.current = [];
      rngRef.current = mulberry32(seed ^ 0x51ed);
      dayFloatRef.current = 0;
      lastTsRef.current = null;
      lastActiveDayRef.current = 0;
      nudgeCountRef.current = 0;
      setNudge(null);
      setReport(null);
      setCard(null);
      // Guided first run · a newcomer's opening run starts paused behind
      // the coaching card. Mark them onboarded so it only ever shows
      // once. Set the ref directly too, so the loop scheduled below
      // sees the pause on its very first frame.
      const firstEver = (() => {
        try {
          return !window.localStorage.getItem(K_ONBOARDED);
        } catch {
          return false;
        }
      })();
      if (firstEver) {
        try {
          window.localStorage.setItem(K_ONBOARDED, "1");
        } catch {
          /* private mode · the hint just shows again next session */
        }
      }
      setFirstRunHint(firstEver);
      setPaused(firstEver);
      pausedRef.current = firstEver;
      setPhase("running");
      track("gauntlet2_start", { mode });
      paint();
      rafRef.current = requestAnimationFrame(loop);
    },
    [loop, paint],
  );

  // ── Player actions ───────────────────────────────────────────────
  const pushFloat = useCallback((text: string, tone: "up" | "down") => {
    const id = ++floatIdRef.current;
    setFloats((f) => [...f.slice(-4), { id, text, tone }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1100);
  }, []);

  // Append to the proof log when the engine call actually traded. The
  // recorded value is the EXACT arg passed to the engine, so the
  // server replay hits the same clamps and lands on identical floats.
  const recordTraded = useCallback(
    (s: GameState, tradesBefore: number, kind: 0 | 1 | 2, v: number) => {
      if (s.trades.length > tradesBefore) {
        actionsRef.current.push([s.day, kind, v]);
      }
    },
    [],
  );

  const doBuy = useCallback(
    (usd: number) => {
      const s = gsRef.current;
      const st = setupRefCurrent.current;
      if (!s || !st || phaseRef.current !== "running") return;
      const amt = Math.min(usd, s.fiat);
      if (amt < 1) return;
      const before = s.trades.length;
      buy(s, st, amt);
      recordTraded(s, before, 0, amt);
      lastActiveDayRef.current = s.day;
      pushFloat(`BOUGHT ${fmtUsd(amt)}`, "up");
      play("buy");
      paint();
    },
    [paint, pushFloat, play, recordTraded],
  );

  const doSell = useCallback(
    (frac: number) => {
      const s = gsRef.current;
      const st = setupRefCurrent.current;
      if (!s || !st || phaseRef.current !== "running") return;
      const p = priceAt(st, s.day);
      const usd = s.btc * frac * p;
      if (usd < 1) return;
      const before = s.trades.length;
      sell(s, st, frac);
      recordTraded(s, before, 1, frac);
      lastActiveDayRef.current = s.day;
      pushFloat(`SOLD ${fmtUsd(usd)}`, "down");
      play("sell");
      paint();
    },
    [paint, pushFloat, play, recordTraded],
  );

  const dismissCard = useCallback(() => {
    setCard(null);
    setPhase("running");
    lastTsRef.current = null;
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const cardActions = useCallback(
    (c: EventCard): { label: string; hint?: string; run: () => void }[] => {
      const s = gsRef.current;
      const st = setupRefCurrent.current;
      if (!s || !st) return [];
      const done = (fn?: () => void) => () => {
        fn?.();
        dismissCard();
      };
      if (c.tone === "margin" && c.marginOffer) {
        const offer = c.marginOffer;
        return [
          {
            label: `Take 2x · ${fmtUsd(offer)} collateral`,
            hint: "liquidation 37.5% below here",
            run: done(() => {
              const before = s.trades.length;
              openMargin(s, st, offer);
              recordTraded(s, before, 2, offer);
              pushFloat(`2X OPEN ${fmtUsd(offer)}`, "down");
              play("buy");
            }),
          },
          { label: "Decline · stay spot only", run: done() },
        ];
      }
      if (c.tone === "fear") {
        return [
          {
            label: "Sell everything",
            hint: "make the feeling stop",
            run: done(() => {
              const p = priceAt(st, s.day);
              const usd = s.btc * p;
              if (usd >= 1) {
                const before = s.trades.length;
                sell(s, st, 1);
                recordTraded(s, before, 1, 1);
                pushFloat(`SOLD ${fmtUsd(usd)}`, "down");
                play("sell");
              }
            }),
          },
          {
            label: "Buy $1,000 of the blood",
            hint: "if the pocket covers it",
            run: done(() => {
              const amt = Math.min(1000, s.fiat);
              if (amt >= 1) {
                const before = s.trades.length;
                buy(s, st, amt);
                recordTraded(s, before, 0, amt);
                pushFloat(`BOUGHT ${fmtUsd(amt)}`, "up");
                play("buy");
              }
            }),
          },
          { label: "Hold the line", run: done() },
        ];
      }
      if (c.tone === "euphoria") {
        return [
          {
            label: "Take profits · sell half",
            run: done(() => {
              const p = priceAt(st, s.day);
              const usd = s.btc * 0.5 * p;
              if (usd >= 1) {
                const before = s.trades.length;
                sell(s, st, 0.5);
                recordTraded(s, before, 1, 0.5);
                pushFloat(`SOLD ${fmtUsd(usd)}`, "down");
                play("sell");
              }
            }),
          },
          { label: "Let it ride", run: done() },
        ];
      }
      return [{ label: "Carry on", run: done() }];
    },
    [dismissCard, pushFloat, play, recordTraded],
  );

  // ── Keyboard ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never steal keys from form fields, the palette input, or
      // modified shortcuts (review 2026-07-08).
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (phase === "card" && card) {
        const acts = cardActions(card);
        const k = parseInt(e.key, 10);
        if (k >= 1 && k <= acts.length) {
          e.preventDefault();
          acts[k - 1].run();
        }
        return;
      }
      if (phase !== "running") return;
      // The guided opener holds the controls until the player begins.
      if (firstRunHint) return;
      const s = gsRef.current;
      if (!s) return;
      if (e.key === "1") doBuy(250);
      else if (e.key === "2") doBuy(1000);
      else if (e.key === "3") doBuy(s.fiat);
      else if (e.key === "4") doSell(0.25);
      else if (e.key === "5") doSell(1);
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "s" || e.key === "S") {
        setSpeedIdx((i) => (i + 1) % SPEEDS.length);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, card, cardActions, doBuy, doSell, firstRunHint]);

  // ── Render ───────────────────────────────────────────────────────
  const n = numberRef.current;

  if (phase === "reveal" && report && setup && gsRef.current) {
    return (
      <div className="rounded-xl p-[1.5px] bezel-metal nb-seated">
        <div
          className="rounded-[11px] overflow-hidden"
          style={{ background: "linear-gradient(180deg, #16100a 0%, #0a0605 60%)" }}
        >
          <Reveal
            setup={setup}
            state={gsRef.current}
            report={report}
            streak={streak}
            newBadges={newBadges}
            boardRank={boardRank}
            onAgain={() => startRun("practice")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-[1.5px] bezel-metal nb-seated">
      <div
        ref={cabinetRef}
        className="relative rounded-[11px] overflow-hidden"
        style={{ background: "linear-gradient(180deg, #16100a 0%, #0a0605 60%)" }}
      >
        {/* Header · title, day counter, MASKED calendar, tape price */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 sm:px-5 pt-4">
          <span className="micro-label" style={{ color: DIM }}>
            The Gauntlet
          </span>
          <span className="font-mono t-xs tabular-nums flex items-baseline gap-3" style={{ color: DIM2 }}>
            <span ref={dayRef}>DAY 0 / {RUN_DAYS}</span>
            <span title="Dates are hidden until the run ends" aria-label="Dates hidden until the run ends">
              ⌀ ····-··-··
            </span>
            <span ref={priceRef} className="text-[var(--accent)]">
              $··,···
            </span>
          </span>
        </div>

        {/* Tape */}
        <div className="relative px-4 sm:px-5 pt-2">
          <svg
            viewBox={`0 0 ${W} ${H + 6}`}
            preserveAspectRatio="none"
            className="w-full h-[280px] sm:h-[360px] lg:h-[420px] block"
            aria-hidden
          >
            <defs>
              <linearGradient id="g2-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F7931A" stopOpacity="0.26" />
                <stop offset="100%" stopColor="#F7931A" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path ref={areaRef} d="" fill="url(#g2-fill)" />
            <path
              ref={lineRef}
              d=""
              fill="none"
              stroke="#F7931A"
              strokeWidth="0.6"
              strokeLinejoin="round"
              style={{ filter: "drop-shadow(0 0 3px rgba(247,147,26,0.6))" }}
            />
            <path ref={barsUpRef} d="" fill="#31C48D" opacity="0.75" />
            <path ref={barsDownRef} d="" fill="#ff3a4f" opacity="0.75" />
            <path ref={buysRef} d="" fill="#31C48D" />
            <path ref={sellsRef} d="" fill="#ff3a4f" />
            <path ref={forcedRef} d="" fill="#FB923C" />
            <path ref={marginTradesRef} d="" fill="#7ec0ff" />
            <path ref={liqRef} d="" fill="none" stroke="#ff3a4f" strokeWidth="0.42" />
          </svg>
          {/* trade confirmation floats */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {floats.map((f) => (
              <span
                key={f.id}
                className="g2-float absolute right-6 font-mono text-xs font-bold tracking-widest"
                style={{ top: "38%", color: f.tone === "up" ? "#31C48D" : "#FB923C" }}
              >
                {f.text}
              </span>
            ))}
          </div>
        </div>

        {/* HUD rack */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-4 sm:px-5 pt-1">
          <div>
            <div className="micro-label mb-0.5" style={{ color: DIM }}>
              Net worth
              {" · "}
              <span ref={alphaRef} className="tabular-nums">
                +0.0% vs bot
              </span>
            </div>
            <div
              ref={netRef}
              className="font-mono text-2xl sm:text-3xl font-bold tabular-nums"
              style={{ color: "#FFD9A0", textShadow: "0 0 14px rgba(247,147,26,0.45)" }}
            >
              {fmtUsd(10_000)}
            </div>
          </div>
          <div className="flex items-baseline gap-4 font-mono text-sm tabular-nums">
            <span style={{ color: "#F2EFE9" }}>
              <span ref={btcRef}>₿ 0.00000</span>
            </span>
            <span style={{ color: DIM2 }}>
              <span ref={fiatRef}>{fmtUsd(10_000)}</span>
            </span>
            <div
              ref={marginRef}
              className="micro-label px-2 py-1 rounded border"
              style={{ display: "none", color: "#7ec0ff", borderColor: "rgba(126,192,255,0.4)" }}
            />
          </div>
        </div>

        {/* Quiet-window nudge · transient, non-blocking, in normal flow
            so it never covers the tape or the controls. */}
        {nudge && phase === "running" && (
          <div className="px-4 sm:px-5 pt-2">
            <div
              className="mx-auto max-w-md rounded-lg border px-4 py-2 text-center font-mono t-xs leading-snug"
              style={{
                borderColor: "rgba(247,147,26,0.4)",
                background: "rgba(247,147,26,0.06)",
                color: "rgba(235,225,210,0.8)",
              }}
            >
              {nudge}
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 sm:px-5 py-3">
          {[
            { label: "BUY $250", key: "1", run: () => doBuy(250) },
            { label: "BUY $1K", key: "2", run: () => doBuy(1000) },
            { label: "BUY MAX", key: "3", run: () => doBuy(gsRef.current?.fiat ?? 0) },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={b.run}
              className="micro-label px-2.5 sm:px-3 py-2 rounded-md border transition-all hover:border-[#31C48D] hover:text-[#31C48D]"
              style={{ borderColor: "rgba(49,196,141,0.35)", color: "#8fd9bb" }}
            >
              {b.label}
              <kbd className="hidden sm:inline ml-1.5 opacity-50">{b.key}</kbd>
            </button>
          ))}
          <span className="w-1.5" />
          {[
            { label: "SELL ¼", key: "4", run: () => doSell(0.25) },
            { label: "SELL ALL", key: "5", run: () => doSell(1) },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={b.run}
              className="micro-label px-2.5 sm:px-3 py-2 rounded-md border transition-all hover:border-[#ff3a4f] hover:text-[#ff8a95]"
              style={{ borderColor: "rgba(255,58,79,0.35)", color: "#e79aa3" }}
            >
              {b.label}
              <kbd className="hidden sm:inline ml-1.5 opacity-50">{b.key}</kbd>
            </button>
          ))}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
            aria-label={`Tape speed ×${SPEED_LABELS[speedIdx]} · click to change`}
            className="micro-label px-2.5 py-2 rounded-md border transition-all hover:border-[var(--accent)]"
            style={{ borderColor: "rgba(235,225,210,0.2)", color: DIM2 }}
          >
            ×{SPEED_LABELS[speedIdx]}
          </button>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Resume" : "Pause"}
            className="px-3 py-2 rounded-md border font-mono t-xs transition-all hover:border-[var(--accent)]"
            style={{ borderColor: "rgba(235,225,210,0.2)", color: DIM2 }}
          >
            {paused ? "▶" : "❚❚"}
          </button>
          <button
            type="button"
            onClick={toggleAudio}
            aria-pressed={audioOn}
            aria-label={audioOn ? "Sound on · click to mute" : "Sound off · click to enable"}
            title={audioOn ? "Sound on" : "Sound off"}
            className="px-2.5 py-2 rounded-md border font-mono t-xs transition-all hover:border-[var(--accent)]"
            style={{
              borderColor: audioOn ? "rgba(247,147,26,0.5)" : "rgba(235,225,210,0.2)",
              color: audioOn ? "var(--accent)" : DIM2,
            }}
          >
            {audioOn ? "♪" : "∅"}
          </button>
        </div>

        {/* ── Overlays ── */}
        {phase === "loading" && (
          <Overlay solid>
            <div className="font-mono text-sm animate-pulse" style={{ color: DIM2 }}>
              Loading the tape...
            </div>
          </Overlay>
        )}

        {phase === "error" && (
          <Overlay solid>
            <div className="text-center max-w-sm px-6">
              <div className="micro-label mb-2" style={{ color: DIM }}>
                Tape unavailable
              </div>
              <p className="text-sm" style={{ color: DIM2 }}>
                Price history is not reporting right now. Come back in a
                minute · the gauntlet only runs on actual data.
              </p>
            </div>
          </Overlay>
        )}

        {phase === "ready" && (
          <Overlay solid>
            <div className="text-center max-w-lg px-6 py-6">
              <div className="micro-label mb-2" style={{ color: "var(--accent)" }}>
                Gauntlet #{n}
                {streak > 1 ? ` · streak ${streak}` : ""}
              </div>
              {challenge && (
                <div
                  className="mb-4 rounded-lg border px-4 py-3 text-left"
                  style={{ borderColor: "rgba(126,192,255,0.45)", background: "rgba(126,192,255,0.06)" }}
                >
                  <div className="micro-label mb-1" style={{ color: "#7ec0ff" }}>
                    ◆ Challenge received
                  </div>
                  <p className="text-sm mb-2" style={{ color: DIM2 }}>
                    Someone dares you to beat
                    {challenge.alpha != null
                      ? ` their ${challenge.alpha >= 0 ? "+" : ""}${challenge.alpha.toFixed(1)}% vs the bot`
                      : " them"}{" "}
                    on their exact hidden window. Same prices, same bills.
                  </p>
                  <button
                    type="button"
                    onClick={() => startRun("practice", challenge)}
                    className="micro-label px-5 py-2.5 rounded-lg font-semibold text-black transition-all"
                    style={{ background: "#7ec0ff" }}
                  >
                    Accept the challenge →
                  </button>
                </div>
              )}
              {dailyDone ? (
                <>
                  <div className="text-xl font-semibold mb-1" style={{ color: "#F2EFE9" }}>
                    Today is stamped · {dailyDone.tier}
                  </div>
                  <div className="font-mono text-sm tabular-nums mb-1" style={{ color: DIM2 }}>
                    {dailyDone.alpha >= 0 ? "+" : ""}
                    {dailyDone.alpha.toFixed(1)}% vs the DCA bot
                  </div>
                  <div className="font-mono text-sm mb-4">{dailyDone.grid}</div>
                  <div className="micro-label mb-5" style={{ color: DIM }}>
                    Next shared window in {countdown}
                  </div>
                  {/* Today is stamped, but the PRIMARY action stays in
                      THIS game: unlimited practice windows. Pivoting to
                      the siblings is the consistent secondary door
                      (operator flow pass 2026-07-09 · "Play Node Runner"
                      as the featured button here read as an eviction). */}
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => startRun("practice")}
                      className="px-7 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.22em] font-bold hover:bg-[var(--accent-hover)] hover:shadow-[0_0_28px_var(--accent-glow)] transition-all"
                    >
                      Practice a window →
                    </button>
                    <Link
                      href="/arcade"
                      className="micro-label px-5 py-3 rounded-lg border transition-all hover:border-[var(--accent)] inline-flex items-center"
                      style={{ borderColor: "rgba(235,225,210,0.25)", color: DIM2 }}
                    >
                      More games
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm mb-1 leading-relaxed" style={{ color: DIM2 }}>
                    You are about to be dropped somewhere in actual bitcoin
                    history with the dates hidden. $10,000, a paycheck
                    every 30 days, bills that do not care about the
                    chart. The DCA bot gets exactly the same and never
                    thinks. Beat it if you can.
                  </p>
                  <p className="micro-label mb-5" style={{ color: DIM }}>
                    Same window for everyone today · one scored run
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => startRun("daily")}
                      className="px-7 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.22em] font-bold hover:bg-[var(--accent-hover)] hover:shadow-[0_0_28px_var(--accent-glow)] transition-all"
                    >
                      Enter the gauntlet →
                    </button>
                    <button
                      type="button"
                      onClick={() => startRun("practice")}
                      className="micro-label px-5 py-3 rounded-lg border transition-all hover:border-[var(--accent)]"
                      style={{ borderColor: "rgba(235,225,210,0.25)", color: DIM2 }}
                    >
                      Practice first
                    </button>
                    <Link
                      href="/arcade"
                      className="micro-label px-5 py-3 rounded-lg border transition-all hover:border-[var(--accent)] inline-flex items-center"
                      style={{ borderColor: "rgba(235,225,210,0.25)", color: DIM2 }}
                    >
                      More games
                    </Link>
                  </div>
                </>
              )}
              {(best != null || shelf.length > 0) && (
                <div className="micro-label mt-5" style={{ color: DIM }}>
                  {best != null && (
                    <span>
                      Best alpha {best >= 0 ? "+" : ""}
                      {best.toFixed(1)}%
                    </span>
                  )}
                  {best != null && shelf.length > 0 && " · "}
                  {shelf.length > 0 && (
                    <span>
                      {shelf.length} badge{shelf.length === 1 ? "" : "s"} earned
                    </span>
                  )}
                </div>
              )}
              {log.length > 0 && (
                <div className="mt-3 inline-block text-left">
                  <div className="micro-label mb-1" style={{ color: DIM }}>
                    Pilot log
                  </div>
                  {log.slice(0, 4).map((e, i) => (
                    <div key={i} className="font-mono t-xs tabular-nums" style={{ color: DIM2 }}>
                      {e.m === "d" ? `#${e.n}` : "practice"} · {e.a >= 0 ? "+" : ""}
                      {e.a.toFixed(1)}% · {e.tier}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Overlay>
        )}

        {/* Guided opener · shows once, over the paused tape, before the
            player's first-ever run begins moving. */}
        {firstRunHint && phase === "running" && (
          <Overlay>
            <div
              role="dialog"
              aria-modal="true"
              aria-label="How the Gauntlet works"
              className="w-full max-w-md mx-4 rounded-xl p-5 sm:p-6 text-left"
              style={{
                background: "#100b07",
                border: "1px solid rgba(247,147,26,0.5)",
                boxShadow: "0 0 34px -8px rgba(247,147,26,0.5)",
              }}
            >
              <div className="micro-label mb-3" style={{ color: "var(--accent)" }}>
                First run · the loop in three lines
              </div>
              <ul className="space-y-2 mb-5 text-sm leading-relaxed" style={{ color: DIM2 }}>
                <li>
                  <span style={{ color: "#F2EFE9" }}>The line is the actual bitcoin price.</span>{" "}
                  The dates stay hidden until the run ends · you trade blind.
                </li>
                <li>
                  <span style={{ color: "#31C48D" }}>Buy the dips</span> and{" "}
                  <span style={{ color: "#ff8a95" }}>sell the rips</span>{" "}
                  with the buttons below (or number keys 1 to 5). Pause with
                  space, change speed with S.
                </li>
                <li>
                  A paycheck lands every 30 days and bills hit no matter the chart.
                  The DCA bot gets the same salary and never thinks ·{" "}
                  <span style={{ color: "#FFD9A0" }}>beat its return</span>.
                </li>
              </ul>
              <button
                type="button"
                onClick={() => {
                  setFirstRunHint(false);
                  setPaused(false);
                  pausedRef.current = false;
                  lastTsRef.current = null;
                }}
                className="w-full px-5 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.2em] font-bold hover:bg-[var(--accent-hover)] hover:shadow-[0_0_24px_var(--accent-glow)] transition-all"
              >
                Start the tape →
              </button>
            </div>
          </Overlay>
        )}

        {phase === "card" && card && (
          <Overlay>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={card.title}
              className="w-full max-w-md mx-4 rounded-xl p-5 sm:p-6"
              style={{
                background: "#100b07",
                border: `1px solid ${toneEdge(card.tone)}`,
                boxShadow: `0 0 34px -8px ${toneEdge(card.tone)}`,
              }}
            >
              <div className="micro-label mb-2" style={{ color: toneEdge(card.tone) }}>
                {card.tone === "fear"
                  ? "⚠ Breaking"
                  : card.tone === "euphoria"
                    ? "▲ Euphoria"
                    : card.tone === "margin"
                      ? "◆ The desk calls"
                      : card.tone === "bill"
                        ? "· Life"
                        : "● Update"}
                {" · day "}
                {gsRef.current?.day}
              </div>
              <h3 className="text-lg sm:text-xl font-semibold mb-2" style={{ color: "#F2EFE9" }}>
                {card.title}
              </h3>
              <p className="text-sm leading-relaxed mb-5" style={{ color: DIM2 }}>
                {card.body}
              </p>
              <div className="space-y-2">
                {cardActions(card).map((a, i) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={a.run}
                    className="micro-label w-full text-left px-4 py-3 rounded-lg border transition-all hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]"
                    style={{ borderColor: "rgba(235,225,210,0.18)", color: "#F2EFE9" }}
                  >
                    <span style={{ color: "rgba(235,225,210,0.45)" }}>{i + 1} · </span>
                    {a.label}
                    {a.hint && (
                      <span className="block mt-0.5 normal-case tracking-normal" style={{ color: "rgba(235,225,210,0.5)" }}>
                        {a.hint}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </Overlay>
        )}
      </div>
    </div>
  );
}

function toneEdge(tone: EventCard["tone"]): string {
  switch (tone) {
    case "fear":
      return "#ff3a4f";
    case "euphoria":
      return "var(--accent)";
    case "margin":
      return "#7ec0ff";
    case "bill":
      return "rgba(235,225,210,0.35)";
    default:
      return "var(--success)";
  }
}

function Overlay({
  children,
  solid = false,
}: {
  children: React.ReactNode;
  solid?: boolean;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto"
      style={{
        background: solid ? "rgba(10,6,5,0.96)" : "rgba(6,4,2,0.82)",
        backdropFilter: solid ? undefined : "blur(2px)",
      }}
    >
      {children}
    </div>
  );
}
