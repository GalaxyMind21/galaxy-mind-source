"use client";

/* =====================================================================
 * TapeRunner · the arcade half of the Gauntlet (v2 · 2026-07-08).
 *
 * The Chrome-dino loop, played ON real bitcoin history: the terrain
 * IS the daily-close series, so the 2022 bear is literally a downhill
 * death run and the ETF ramp a climb. One input · tap to jump (double
 * jump in the air). Red-candle spikes grow out of the real big down
 * days (height scales with the actual drop), sats orbs float over the
 * real green days. Die and the mask lifts for one line · the REAL
 * date and the named week that killed you · then TAP TO RUN IT BACK
 * restarts instantly. The daily seed drops everyone at the same spot.
 * Reaching the present launches you TO THE MOON · a low-gravity,
 * daily-seeded lunar overtime that never ends (2026-07-10).
 *
 * Canvas-rendered (the only canvas on the site): parallax starfield,
 * era-tinted sky, chart-skyline silhouettes (candle spires with wicks),
 * lunar nebula wisps, glowing terrain ridge, coin trail, era watermarks
 * scrolling past, particle shatter + slow-mo on death. All state
 * lives in refs · React renders only the overlays.
 * ===================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { getHandle, submitScore } from "@/lib/arcade";
import { useArcadeCloud } from "@/lib/useArcadeCloud";
import { encodeRunnerScore } from "@/lib/arcade-score";
import { encodeRunCard } from "@/lib/run-card";
import { loadBtcHistory } from "@/lib/btc-history-client";
import {
  NAMED_ERAS,
  gauntletNumber,
  locateRunnerStart,
  mulberry32,
  runnerStartBackDays,
} from "./engine";
import { gauntletDayStartUtc } from "@/lib/gauntlet-day";
import { buildMoonChunk } from "./moon";

const DAY_W = 26; // px per day of history
const GRAVITY = 1500;
const JUMP_VY = -520;
const BASE_SPEED = 150; // px/s · ramps with distance
const PLAYER_X = 0.24; // fraction of canvas width
const PLAYER_R = 11;
const SPIKE_DROP = 0.045; // a real daily drop this size grows a spike
const ORB_GAIN = 0.02; // a real daily gain this size floats an orb
const COMBO_WINDOW = 3.2; // seconds to grab the next orb and keep the chain
// TO THE MOON · reaching the present launches you off the tape into a
// low-gravity lunar overtime that never ends (2026-07-10).
const LAUNCH_DUR = 1.8; // seconds of the lift-off cinematic
const MOON_GRAVITY = 620; // ~0.4g · big floaty jumps ("number go up")
const MOON_SEED_XOR = 0x4d4f4f4e; // "MOON" · offsets the daily seed

// Era epoch-seconds, parsed once at module load · the labels are
// compile-time constants, so re-parsing the ISO strings every frame
// (~9 x 60fps) was pure waste (2026-07-10).
const ERA_SECS = NAMED_ERAS.map((e) => ({
  label: e.label,
  sec: Date.parse(e.iso + "T00:00:00Z") / 1000,
}));

// Era sky tints (2026-07-12 · deferred graphics pass). The tape sky
// takes a SUBTLE hue per market era · same luminance family as the
// base dusk (#1c130a / #140d07) so contrast rules hold, only the cast
// changes: CRT green for the genesis years, cold blue for the first
// winter, violet for 2017 mania, cold rose for 2018, gold for the
// 2020 bull, ember for 2022, institutional amber from 2023 on.
const ERA_TINTS: { fromSec: number; top: string; mid: string }[] = [
  { fromSec: 0, top: "#122017", mid: "#0d150e" },
  { fromSec: Date.UTC(2014, 0, 1) / 1000, top: "#141a24", mid: "#0e1218" },
  { fromSec: Date.UTC(2017, 0, 1) / 1000, top: "#211430", mid: "#150d1e" },
  { fromSec: Date.UTC(2018, 1, 1) / 1000, top: "#1f141c", mid: "#140d12" },
  { fromSec: Date.UTC(2020, 3, 1) / 1000, top: "#241a08", mid: "#171105" },
  { fromSec: Date.UTC(2022, 0, 1) / 1000, top: "#24100e", mid: "#160a09" },
  { fromSec: Date.UTC(2023, 0, 1) / 1000, top: "#1c130a", mid: "#140d07" },
];

const K_RUN_BEST = "gm:g2:runner:best";
// A best whose board post has not been verified yet · retried on the next
// load/death so a failed post can't strand a strong run (2026-07-10 · H3).
const K_RUN_UNSENT = "gm:g2:runner:unsent";

type RunnerBest = { days: number; sats: number };

type DeathInfo = {
  days: number;
  sats: number;
  dateIso: string;
  eraLine: string | null;
  reachedPresent: boolean;
  onMoon: boolean;
  moonDays: number;
  isBest: boolean;
  peakCombo: number;
};

type Terrain = {
  y: number[]; // canvas-space ground height per day
  spike: number[]; // spike height px (0 = none)
  orb: boolean[];
  times: number[];
  startIdx: number;
  moon?: boolean; // lunar overtime terrain · no real dates
};

// Daily-seeded lunar course · same moon for everyone today (board
// fairness). Maps the pure 0..1 profile into canvas space and gives the
// very first chunk a spike-free landing zone.
function buildMoonTerrain(
  height: number,
  seed: number,
  chunk: number,
): Terrain {
  const { norm, spike, orb } = buildMoonChunk(seed, chunk);
  const y = norm.map((n) => height * (0.82 - n * 0.52));
  const sp = spike.slice();
  if (chunk === 0) for (let d = 0; d < 8 && d < sp.length; d++) sp[d] = 0;
  for (let d = 1; d < y.length - 1; d++) {
    y[d] = (y[d - 1] + y[d] * 2 + y[d + 1]) / 4;
  }
  return {
    y,
    spike: sp,
    orb: orb.slice(),
    times: new Array(y.length).fill(0),
    startIdx: 0,
    moon: true,
  };
}

// Seed the moon from the run's captured day number (not a fresh
// Date.now()), so a run that crosses UTC midnight keeps generating the
// SAME lunar course it started on · the daily board stays a fair race
// into overtime (2026-07-10 review).
function moonSeedForDay(day: number): number {
  const base = (0x2b0b ^ Math.imul(day, 2654435761)) >>> 0;
  return (base ^ MOON_SEED_XOR) >>> 0;
}

function readBest(): RunnerBest | null {
  try {
    const raw = window.localStorage.getItem(K_RUN_BEST);
    return raw ? (JSON.parse(raw) as RunnerBest) : null;
  } catch {
    return null;
  }
}

export function TapeRunner({
  onExit,
  audio,
}: {
  onExit: () => void;
  // The cabinet owns the ONE audio hook instance and passes it down ·
  // two independent hook instances desync the on/off pref mid-session
  // (review 2026-07-08).
  audio: {
    audioOn: boolean;
    toggleAudio: () => void;
    play: (
      k: import("./useGauntletAudio").GauntletSound,
      level?: number,
    ) => void;
  };
}) {
  const [ready, setReady] = useState(false);
  const [death, setDeath] = useState<DeathInfo | null>(null);
  // The player's rank on the all-time board · arrives async from the
  // score post, feeds the share text (operator request 2026-07-09).
  const [deathRank, setDeathRank] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [best, setBest] = useState<RunnerBest | null>(null);
  const [failed, setFailed] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainRef = useRef<Terrain | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const reducedMotion = useRef(false);
  // Guards the async rank resolver from setState-after-unmount (a
  // player can tap "More games" before the score post returns).
  const mountedRef = useRef(true);
  useEffect(() => {
    // Re-arm on setup · Strict Mode's dev double-invoke otherwise
    // leaves this false for the whole real lifetime (review 2026-07-09).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const { audioOn, toggleAudio, play } = audio;

  // Live game state · refs only, no React in the hot path.
  const g = useRef({
    t: 0, // seconds since run start
    dist: 0, // world px scrolled
    y: 0,
    vy: 0,
    grounded: true,
    jumps: 2,
    sats: 0,
    rot: 0,
    lastTs: null as number | null,
    trail: [] as { x: number; y: number }[],
    particles: [] as {
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
    }[],
    collected: new Set<number>(),
    slowmo: 0, // seconds of slow motion left (death)
    dead: false,
    floats: [] as { x: number; y: number; life: number; text: string }[],
    stars: [] as { x: number; y: number; r: number; layer: number }[],
    // Sats-orb combo · chaining orbs inside COMBO_WINDOW multiplies the
    // gain. Bull ramps let you chain; bears break it (2026-07-09).
    combo: 0,
    comboT: 0, // seconds since the last orb
    peakCombo: 0,
    // Phase · the tape, the lift-off cinematic, then the endless moon.
    phase: "tape" as "tape" | "launch" | "moon",
    launchT: 0, // seconds left in the lift-off
    launchPadY: 0, // ground Y where the rocket sits during the cinematic
    presentReached: false,
    presentDays: 0, // tape length at the present · the scored day cap
    presentIso: "", // the present's date, for the death screen
    totalDist: 0, // px scrolled across ALL phases · drives the speed ramp
    moonChunks: 0, // lunar chunks generated so far
    // Captured at run START · the daily-board day and the moon seed both
    // derive from this so a midnight-crossing run stays on ITS day/course.
    dayNumber: 0,
    moonSeed: 0,
    // Juice · pure feel, never touches scoring or the seed. shake = px of
    // camera kick, freeze = hard hit-stop seconds, squash = land compress
    // 0..1, jumpBuf = seconds a "too early" tap is remembered so a jump a
    // few frames before landing still fires (high-speed fairness).
    shake: 0,
    freeze: 0,
    squash: 0,
    jumpBuf: 0,
    // Background dressing (2026-07-12 · the deferred graphics pass).
    // All pre-built: silhouettes are Path2D layers, the nebula is an
    // offscreen canvas · per-frame cost is a couple of translated fills.
    silhouette: null as {
      cw: number;
      far: Path2D;
      near: Path2D;
      wicks: Path2D;
    } | null,
    nebula: null as HTMLCanvasElement | null,
    // Era sky tint · cached per tape day so the per-frame draw never
    // allocates a Date or recomputes the era lookup.
    tintDay: -1,
    tintTop: "#1c130a",
    tintMid: "#140d07",
  });

  // ── Terrain from real history · rolling-window normalization keeps
  // local shape pronounced across a 7x price range. ─────────────────
  const buildTerrain = useCallback((height: number) => {
    const ptsFull = ptsRef.current;
    if (ptsFull.length < 500) return null;
    // Time-anchored course (2026-07-11 · fairness debt fix): the start
    // is a DATE derived from the day number alone, then located in
    // whatever series this client loaded · a one-point history
    // difference no longer rerolls the whole course or shifts the
    // score cap (see runnerStartBackDays in engine.ts).
    const n = gauntletNumber(Date.now());
    const anchorSec =
      (gauntletDayStartUtc(n) - runnerStartBackDays(n) * 86_400_000) / 1000;
    const startIdx = locateRunnerStart(
      ptsFull.map((q) => q.t),
      anchorSec,
    );
    const days = ptsFull.length - startIdx;
    const y: number[] = new Array(days);
    const spike: number[] = new Array(days).fill(0);
    const orb: boolean[] = new Array(days).fill(false);
    const times: number[] = new Array(days);
    const HALF = 90;
    for (let d = 0; d < days; d++) {
      const i = startIdx + d;
      times[d] = ptsFull[i].t;
      let lo = Infinity;
      let hi = -Infinity;
      for (
        let k = Math.max(0, i - HALF);
        k <= Math.min(ptsFull.length - 1, i + HALF);
        k++
      ) {
        const p = ptsFull[k].p;
        if (p < lo) lo = p;
        if (p > hi) hi = p;
      }
      const norm = hi > lo ? (ptsFull[i].p - lo) / (hi - lo) : 0.5;
      // High price = high ground. Band between 30% and 82% of height.
      y[d] = height * (0.82 - norm * 0.52);
      if (d > 0) {
        const chg = ptsFull[i].p / ptsFull[i - 1].p - 1;
        if (chg <= -SPIKE_DROP) {
          spike[d] = Math.min(74, 26 + Math.abs(chg) * 900);
        } else if (chg >= ORB_GAIN) {
          orb[d] = true;
        }
      }
    }
    // Light smoothing pass so the coin rolls, not rattles.
    for (let d = 1; d < days - 1; d++) {
      y[d] = (y[d - 1] + y[d] * 2 + y[d + 1]) / 4;
    }
    // Spawn grace · the player starts at day 2 with zero reaction
    // time, so a seed whose opening days were real crash days would
    // be an unavoidable instant death. The first 10 days are always
    // clear (review 2026-07-08 · fairness, not data editing · the
    // terrain itself is untouched).
    for (let d = 0; d < 10 && d < days; d++) spike[d] = 0;
    return { y, spike, orb, times, startIdx } satisfies Terrain;
  }, []);

  const ptsRef = useRef<{ t: number; p: number }[]>([]);

  useEffect(() => {
    reducedMotion.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    setBest(readBest());
    // Flush a best whose post never got verified last time (offline/429/
    // KV-down) · the server's ZADD GT makes a repeat idempotent (H3).
    try {
      const unsent = window.localStorage.getItem(K_RUN_UNSENT);
      if (unsent) {
        const u = JSON.parse(unsent) as { score?: number; dayNumber?: number };
        if (typeof u.score === "number") {
          submitScore("runner", u.score, u.dayNumber).then((res) => {
            if (res) {
              try {
                window.localStorage.removeItem(K_RUN_UNSENT);
              } catch {
                /* best-effort */
              }
            }
          });
        }
      }
    } catch {
      /* best-effort · never block the game on a retry */
    }
    let alive = true;
    loadBtcHistory()
      .then((pts) => {
        if (!alive) return;
        ptsRef.current = pts.slice(0, pts.length - 2);
        setReady(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      runningRef.current = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const groundAt = useCallback((worldX: number): number => {
    const T = terrainRef.current!;
    const df = worldX / DAY_W;
    const d0 = Math.max(0, Math.min(T.y.length - 2, Math.floor(df)));
    const f = Math.min(1, Math.max(0, df - d0));
    return T.y[d0] + (T.y[d0 + 1] - T.y[d0]) * f;
  }, []);

  // cross-device cloud save (X-linked players · 2026-07-18): the ONE record
  // is the personal best {days, sats}. The board outbox (K_RUN_UNSENT) is
  // device-local retry state and must never sync.
  const readCloud = useCallback(() => ({ best: readBest() }), []);
  const adoptCloud = useCallback((m: { best?: { days?: number; sats?: number } | null }) => {
    const mb = m && m.best;
    if (!mb || typeof mb.days !== "number" || typeof mb.sats !== "number") return;
    const cur = readBest();
    // never regress: days primary, sats tiebreak (matches the die() comparator)
    const better = !cur || mb.days > cur.days || (mb.days === cur.days && mb.sats > cur.sats);
    if (!better) return;
    try {
      window.localStorage.setItem(K_RUN_BEST, JSON.stringify({ days: mb.days, sats: mb.sats }));
    } catch { /* best-effort */ }
    setBest({ days: mb.days, sats: mb.sats });
  }, []);
  const pushCloud = useArcadeCloud("runner", readCloud, adoptCloud);

  const die = useCallback(() => {
    const s = g.current;
    if (s.dead) return; // summit + spike in one frame → first wins
    const T = terrainRef.current!;
    s.dead = true;
    s.slowmo = reducedMotion.current ? 0 : 0.7;
    // Hit-stop · a hard freeze on the impact frame before slow-mo eases in.
    s.freeze = reducedMotion.current ? 0 : 0.07;
    const onMoon = T.moon === true;
    const reachedPresent = s.presentReached;
    // Scored days cap at the present · the moon is overtime, not real
    // history, so it can't inflate the day count on the board. Sats keep
    // climbing on the moon, and sats are the tiebreak among finishers.
    const rawDay = Math.floor(s.dist / DAY_W);
    const day = reachedPresent ? s.presentDays : rawDay;
    // Moon distance starts at DAY_W*2 (the spawn lead-in), so subtract it
    // back out · landing reads 0 days on the moon, not 2.
    const moonDays = onMoon ? Math.max(0, rawDay - 2) : 0;
    // Date + the era that killed you only exist on the real tape.
    let dateIso = s.presentIso;
    let eraLine: string | null = null;
    if (!onMoon) {
      const t = T.times[Math.min(T.times.length - 1, rawDay)];
      dateIso = new Date(t * 1000).toISOString().slice(0, 10);
      for (const era of ERA_SECS) {
        const diff = (t - era.sec) / 86_400;
        if (diff >= -3 && diff <= 7) {
          eraLine = era.label;
          break;
        }
      }
    }
    // Shatter
    if (!reducedMotion.current) {
      s.shake = 6; // camera kick on the crash
      const cw = canvasRef.current?.clientWidth ?? 600;
      const px = cw * PLAYER_X;
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 90 + Math.random() * 260;
        s.particles.push({
          x: px,
          y: s.y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 120,
          life: 0.9,
        });
      }
    }
    const prev = readBest();
    // Days primary, sats secondary · matching the board packing so a
    // same-day higher-sats run still updates local best + posts.
    const isBest =
      !prev ||
      day > prev.days ||
      (day === prev.days && s.sats > (prev.sats ?? 0));
    if (isBest) {
      try {
        window.localStorage.setItem(
          K_RUN_BEST,
          JSON.stringify({ days: day, sats: s.sats }),
        );
      } catch {
        /* best-effort */
      }
      setBest({ days: day, sats: s.sats });
    }
    setDeath({
      days: day,
      sats: s.sats,
      dateIso,
      eraLine,
      reachedPresent,
      onMoon,
      moonDays,
      isBest,
      peakCombo: s.peakCombo,
    });
    setDeathRank(null);
    if (isBest && day >= 1) {
      // Personal bests post to the all-time board · integer packing
      // days * 1e6 + sats (lib/arcade-score). The old four-decimal
      // scheme capped every long run at 9,999 sats on the board.
      // Passing today's gauntlet number ALSO posts to today's daily
      // board · same tape for everyone this UTC day, so it's the fair
      // head-to-head. Uses the day the run STARTED on (s.dayNumber), not
      // a fresh clock read · a run that crosses UTC midnight must not land
      // on the next day's board (which plays a different seed). The server
      // then correctly skips the daily write for a stale day (2026-07-10
      // review). Returned rank is all-time (the hall of fame).
      const packed = encodeRunnerScore(day, s.sats);
      // Remember the post until it's verified · cleared on success, retried
      // on the next load/death otherwise (2026-07-10 bug audit · H3).
      try {
        window.localStorage.setItem(
          K_RUN_UNSENT,
          JSON.stringify({ score: packed, dayNumber: s.dayNumber }),
        );
      } catch {
        /* best-effort */
      }
      submitScore("runner", packed, s.dayNumber).then((res) => {
        if (res) {
          try {
            window.localStorage.removeItem(K_RUN_UNSENT);
          } catch {
            /* best-effort */
          }
          if (mountedRef.current && res.rank != null) setDeathRank(res.rank);
        }
      });
    }
    // Crashing on the moon is a hard-won, celebratory end (you made it);
    // dying on the tape is the glass shatter.
    play(onMoon ? "summit" : "death");
    track("gauntlet2_runner_death", {
      days: day,
      sats: s.sats,
      present: reachedPresent,
      moonDays,
    });
    pushCloud(); // sync the personal best to the X account (linked players)
    // Delight moment · a finished run is the best time to invite a
    // home-screen install (InstallNudge listens · 2026-07-10).
    try {
      window.dispatchEvent(new CustomEvent("gm:arcade-finished"));
    } catch {
      /* no window · ignore */
    }
  }, [play]);

  // ── The frame ────────────────────────────────────────────────────
  const frame = useCallback(
    (ts: number) => {
      if (!runningRef.current) return;
      const canvas = canvasRef.current;
      const T0 = terrainRef.current;
      if (!canvas || !T0) return;
      // `let` · reaching the present swaps the tape terrain for the moon
      // mid-frame (enterMoon), and the draw below must use the new one.
      let T: Terrain = T0;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const s = g.current;
      // Cap at 2 · a DPR-3 phone would back 9x the CSS-pixel area (vs 4x
      // at cap 2) for every fill and shadowBlur, invisible on a fast
      // scrolling scene but a big per-frame cost. The sizing guard below
      // re-fits the backing store when the cap changes it (2026-07-10).
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== Math.round(cw * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Camera kick · a few px of jitter on impact frames (death, launch,
      // hard landings), applied over the dpr transform so the whole scene
      // shakes together. Capped under 8px; off under reduced motion. The
      // sky fill below overscans to cover the exposed edge (2026-07-10).
      if (s.shake > 0 && !reducedMotion.current) {
        ctx.translate(
          (Math.random() * 2 - 1) * s.shake,
          (Math.random() * 2 - 1) * s.shake,
        );
      }

      if (s.lastTs == null) s.lastTs = ts;
      let dt = Math.min(0.05, (ts - s.lastTs) / 1000);
      s.lastTs = ts;
      // Same tab-hide rule as the cabinet · the world must not move
      // while the player cannot see it.
      if (document.hidden) dt = 0;
      // Wall-clock frame time · the juice timers (shake, squash, buffered
      // jump) decay on THIS, not on the slow-mo/freeze-scaled dt below, so
      // a death freeze can't stretch the shake or the jump window.
      const rawDt = dt;
      // Hit-stop · a hard freeze on the death-impact frame reads as the
      // crash connecting before slow-mo eases in. Decrement with the real
      // clamped dt · using (ts - lastTs) would be 0 here (lastTs was just
      // reassigned) and soft-lock the loop forever (2026-07-10).
      if (s.freeze > 0) {
        s.freeze -= dt;
        dt = 0;
      } else if (s.slowmo > 0) {
        s.slowmo -= dt;
        dt *= 0.18;
      }
      if (s.shake > 0) s.shake = Math.max(0, s.shake - 42 * rawDt);
      if (s.squash > 0) s.squash = Math.max(0, s.squash - 6 * rawDt);
      if (s.jumpBuf > 0) s.jumpBuf -= rawDt;

      const px = cw * PLAYER_X;
      // Speed ramps with TOTAL distance across all phases · the moon
      // keeps accelerating right where the tape left off. Softly capped
      // so a very long moon run stays humanly reactable.
      const speed =
        BASE_SPEED * (1 + Math.min(s.totalDist / DAY_W, 2100) / 350);

      // ── Phase transitions · reach the present → launch → moon ──
      const beginLaunch = (dayNow: number) => {
        s.phase = "launch";
        s.launchT = LAUNCH_DUR;
        s.presentReached = true;
        s.presentDays = Math.floor(dayNow); // the tape length · scored cap
        const tt = T.times[T.times.length - 1] || 0;
        s.presentIso = tt ? new Date(tt * 1000).toISOString().slice(0, 10) : "";
        s.grounded = false;
        s.launchPadY = groundAt(s.dist); // the candle the rocket sits on
        if (!reducedMotion.current) s.shake = 4; // lift-off rumble
        play("launch");
        try {
          track("gauntlet2_runner_present", {
            days: s.presentDays,
            sats: s.sats,
          });
        } catch {
          /* analytics best-effort */
        }
      };
      const enterMoon = (): Terrain => {
        // Seed from the run's captured day so every later chunk (and every
        // player today) shares the same course, even across midnight.
        s.moonSeed = moonSeedForDay(s.dayNumber);
        const moonT = buildMoonTerrain(canvas.clientHeight, s.moonSeed, 0);
        terrainRef.current = moonT;
        s.moonChunks = 1;
        s.phase = "moon";
        s.dist = DAY_W * 2;
        s.vy = 0;
        s.grounded = true;
        s.jumps = 2;
        s.collected = new Set<number>();
        s.trail = [];
        s.combo = 0;
        s.comboT = 0;
        s.jumpBuf = 0; // a stale buffered tap must not auto-jump frame one
        s.stars = []; // regenerate a denser starfield for deep space
        s.y = groundAt(s.dist);
        return moonT;
      };
      const extendMoon = () => {
        const { norm, spike, orb } = buildMoonChunk(
          s.moonSeed,
          s.moonChunks,
        );
        const base = T.y.length;
        for (let d = 0; d < norm.length; d++) {
          T.y.push(canvas.clientHeight * (0.82 - norm[d] * 0.52));
          T.spike.push(spike[d]);
          T.orb.push(orb[d]);
          T.times.push(0);
        }
        for (let d = Math.max(1, base - 1); d < T.y.length - 1; d++) {
          T.y[d] = (T.y[d - 1] + T.y[d] * 2 + T.y[d + 1]) / 4;
        }
        s.moonChunks += 1;
      };

      if (!s.dead) {
        s.t += dt;
        if (s.phase === "launch") {
          // Lift-off cinematic · the world holds while the bitcoin boards a
          // little rocket and blasts off (drawn in the overlay below), then
          // we cut to the lunar surface (enterMoon · 2026-07-10).
          s.launchT -= dt;
          const prog = 1 - Math.max(0, s.launchT) / LAUNCH_DUR;
          // Rocket base · on the pad through board + ignite, then eases up
          // and off the top on blast-off (same curve the draw uses).
          const bp = prog < 0.45 ? 0 : (prog - 0.45) / 0.55;
          const rocketBaseY = s.launchPadY - bp * bp * (s.launchPadY + 260);
          if (prog > 0.28 && !reducedMotion.current) {
            const full = prog >= 0.45; // small flame on ignite, big on blast-off
            for (let i = 0; i < (full ? 2 : 1); i++) {
              s.particles.push({
                x: px + (Math.random() - 0.5) * 10,
                y: rocketBaseY + 2,
                vx: (Math.random() - 0.5) * (full ? 70 : 30),
                vy: 120 + Math.random() * (full ? 200 : 90),
                life: 0.5,
              });
            }
            if (prog < 0.5) s.shake = Math.max(s.shake, 3); // ignition rumble
          }
          if (s.launchT <= 0) T = enterMoon();
        } else {
          s.totalDist += speed * dt;
          s.dist += speed * dt;
          const day = s.dist / DAY_W;
          const onMoonPhase = s.phase === "moon";
          if (s.phase === "tape" && day >= T.y.length - 2) {
            // Reached the present · don't end, go to the moon.
            beginLaunch(day);
          } else {
            // Grow the lunar course before the player runs off its edge.
            if (onMoonPhase && day >= T.y.length - 40) extendMoon();

            // Physics · low gravity on the moon makes the jumps float.
            const gravity = onMoonPhase ? MOON_GRAVITY : GRAVITY;
            const groundY = groundAt(s.dist);
            s.vy += gravity * dt;
            s.y += s.vy * dt;
            if (s.y >= groundY) {
              s.y = groundY;
              const impactVy = s.vy; // read before zeroing · drives the feel
              // Touchdown from a real fall gets a soft land tap · a
              // landing from the tiny ground-follow jitter does not.
              if (!s.grounded && impactVy > 240) {
                play("land");
                // Squash the coin, and on a harder fall kick up dust and a
                // small camera bump · gravity finally has a felt landing.
                s.squash = Math.min(1, impactVy / 900);
                if (impactVy > 300 && !reducedMotion.current) {
                  s.shake = Math.max(s.shake, Math.min(5, impactVy / 220));
                  const n = 5 + Math.floor(Math.random() * 3);
                  for (let i = 0; i < n; i++) {
                    s.particles.push({
                      x: px,
                      y: groundY,
                      vx: (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 60),
                      vy: -20 - Math.random() * 40,
                      life: 0.4 + Math.random() * 0.2,
                    });
                  }
                }
              }
              s.vy = 0;
              if (!s.grounded) s.rot = 0;
              s.grounded = true;
              s.jumps = 2;
              // Buffered jump · a tap a few frames before touchdown with
              // both jumps spent is remembered and fired now, so a fast
              // input near the speed cap isn't silently eaten (2026-07-10).
              if (s.jumpBuf > 0) {
                s.jumpBuf = 0;
                s.vy = JUMP_VY;
                s.jumps = 1;
                s.grounded = false;
                play("jump");
              }
            } else {
              s.grounded = false;
              s.rot += dt * 7;
            }

            // Collisions · forgiving hitboxes, dino-fair.
            const d0 = Math.floor(day);
            for (let d = d0 - 1; d <= d0 + 1; d++) {
              if (d < 0 || d >= T.y.length) continue;
              const sx = d * DAY_W - s.dist + px;
              if (T.spike[d] > 0) {
                const h = T.spike[d];
                const gy = T.y[d];
                if (Math.abs(sx - px) < DAY_W * 0.34 && s.y > gy - h * 0.72) {
                  die();
                  break;
                }
              }
              if (T.orb[d] && !s.collected.has(d)) {
                const oy = T.y[d] - 64;
                const dx = sx - px;
                const dy = oy - s.y;
                if (dx * dx + dy * dy < 26 * 26) {
                  s.collected.add(d);
                  // Combo · each orb inside the window steps the chain, and
                  // the chain multiplies the gain (capped at ×5). Miss the
                  // window and it resets (handled in the update below).
                  s.combo += 1;
                  s.comboT = 0;
                  if (s.combo > s.peakCombo) s.peakCombo = s.combo;
                  const mult = 1 + Math.min(s.combo - 1, 8) * 0.5;
                  const gain = Math.round(100 * mult);
                  s.sats += gain;
                  s.floats.push({
                    x: px + 14,
                    y: oy - 8,
                    life: 0.8,
                    text: s.combo >= 2 ? `+${gain} ×${s.combo}` : `+${gain}`,
                  });
                  // Pitch climbs with the chain; every 5th orb rings a
                  // milestone chime over the collect.
                  play("collect", s.combo);
                  if (s.combo >= 5 && s.combo % 5 === 0) play("combo");
                  // Pop burst · a small radial spray at the pickup so the
                  // collect has a visual twin to the chime, bigger on a
                  // longer chain. Reuses the shared particle pool (draw at
                  // ~917), so no new draw code (2026-07-10).
                  if (!reducedMotion.current) {
                    const nb = Math.min(4 + s.combo, 8);
                    for (let i = 0; i < nb; i++) {
                      const a = Math.random() * Math.PI * 2;
                      const v = 60 + Math.random() * 80;
                      s.particles.push({
                        x: sx,
                        y: oy,
                        vx: Math.cos(a) * v,
                        vy: Math.sin(a) * v,
                        life: 0.45,
                      });
                    }
                  }
                }
              }
            }

            // Trail · lengthens with the combo so a hot chain streaks.
            s.trail.push({ x: px, y: s.y });
            if (s.trail.length > 9 + Math.min(s.combo, 6)) s.trail.shift();

            // Combo decay · lose the chain if the next orb doesn't come
            // inside the window (bear-market droughts break your streak).
            if (s.combo > 0) {
              s.comboT += dt;
              if (s.comboT > COMBO_WINDOW) s.combo = 0;
            }
          } // end physics/collisions (not launch, not reaching present)
        } // end non-launch update
      }

      // Particles + floats
      for (const p of s.particles) {
        p.vy += GRAVITY * 0.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
      }
      s.particles = s.particles.filter((p) => p.life > 0);
      for (const f of s.floats) {
        f.y -= 36 * dt;
        f.life -= dt;
      }
      s.floats = s.floats.filter((f) => f.life > 0);

      // ── Draw ──
      const onMoon = T.moon === true;
      const launching = s.phase === "launch";
      // Sky · warm tape dusk on Earth, cold deep space on the moon. A
      // 3-stop gradient carries the depth. NO full-scene glow: the ambient
      // horizon wash flattened contrast across the whole frame and read as
      // haze. Depth now comes from value + the vignette, and glow is
      // reserved for the light-emitting things (the player, the sat orbs) ·
      // the way readable 2D games use bloom (2026-07-10 · glow reined in).
      const sky = ctx.createLinearGradient(0, 0, 0, ch);
      if (onMoon) {
        sky.addColorStop(0, "#070914");
        sky.addColorStop(0.6, "#04050d");
        sky.addColorStop(1, "#010108");
      } else {
        // Era tint · the sky's cast follows the years you're running
        // through. Cached per tape day (the lookup + Date math never
        // run per frame).
        const dNow = Math.max(
          0,
          Math.min(T.y.length - 1, Math.floor((s.dist + px) / DAY_W)),
        );
        if (s.tintDay !== dNow) {
          s.tintDay = dNow;
          const nowSec = T.times[dNow];
          let tint = ERA_TINTS[0];
          for (const e of ERA_TINTS) if (nowSec >= e.fromSec) tint = e;
          s.tintTop = tint.top;
          s.tintMid = tint.mid;
        }
        sky.addColorStop(0, s.tintTop);
        sky.addColorStop(0.55, s.tintMid);
        sky.addColorStop(1, "#080504");
      }
      ctx.fillStyle = sky;
      // Overscan · covers the edge exposed by the camera-shake translate.
      ctx.fillRect(-12, -12, cw + 24, ch + 24);

      // Nebula · two faint wisps behind the stars in the moon's deep
      // space. Pre-rendered ONCE to an offscreen canvas (radial
      // gradients are pricey per frame), drawn twice with a slow
      // parallax wrap. Alpha stays whisper-low · atmosphere, not fog.
      if (onMoon) {
        if (!s.nebula || s.nebula.width !== cw * 2) {
          const nc = document.createElement("canvas");
          nc.width = cw * 2;
          nc.height = Math.max(1, Math.round(ch * 0.75));
          const nx = nc.getContext("2d");
          if (nx) {
            const nrng = mulberry32(1971); // fiat exit year · fixed wisps
            const tones = [
              "109,91,184", // violet
              "59,124,140", // teal
              "140,90,43", // amber
            ];
            for (let i = 0; i < 5; i++) {
              const bx = nrng() * nc.width;
              const by = nc.height * (0.15 + nrng() * 0.6);
              const br = ch * (0.22 + nrng() * 0.3);
              const g = nx.createRadialGradient(bx, by, 0, bx, by, br);
              g.addColorStop(0, `rgba(${tones[i % 3]},0.11)`);
              g.addColorStop(0.6, `rgba(${tones[i % 3]},0.05)`);
              g.addColorStop(1, `rgba(${tones[i % 3]},0)`);
              nx.fillStyle = g;
              nx.fillRect(0, 0, nc.width, nc.height);
            }
          }
          s.nebula = nc;
        }
        const W = cw * 2;
        const shift = ((s.dist * 0.06) % W + W) % W;
        ctx.drawImage(s.nebula, -shift, 0);
        ctx.drawImage(s.nebula, W - shift, 0);
      }

      // Parallax stars · three depth tiers, denser and brighter in the
      // moon's deep space than in the warm tape sky. The field regenerates
      // on moon entry (s.stars reset in enterMoon · 2026-07-10).
      if (s.stars.length === 0) {
        const srng = mulberry32(77);
        const layers = [0.1, 0.22, 0.4];
        const count = onMoon ? 130 : 70;
        for (let i = 0; i < count; i++) {
          const layer = layers[i % 3];
          s.stars.push({
            x: srng() * cw * 2,
            y: srng() * ch * 0.72,
            r: (0.4 + srng() * 1.2) * (0.7 + layer),
            layer,
          });
        }
      }
      ctx.fillStyle = "rgba(235,225,210,1)";
      for (const st of s.stars) {
        const sx =
          ((((st.x - s.dist * st.layer) % (cw * 2)) + cw * 2) % (cw * 2)) -
          cw * 0.5;
        if (sx < -4 || sx > cw + 4) continue;
        // brightness rises with the depth tier · far dim, near bright.
        ctx.globalAlpha =
          st.layer < 0.15 ? 0.28 : st.layer < 0.3 ? 0.48 : 0.72;
        ctx.beginPath();
        ctx.arc(sx, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Distant skyline · two silhouette layers between the stars and
      // the tape (Earth phase only · the moon stays barren). The far
      // band is a soft ridge; the near band is CANDLE SPIRES with wicks,
      // so the horizon is literally a chart skyline. Pre-built Path2Ds
      // over a 2*cw loop · per frame this is four translated fills.
      if (!onMoon) {
        if (!s.silhouette || s.silhouette.cw !== cw) {
          const W = cw * 2;
          const rng = mulberry32(2140); // the last-sat year · fixed skyline
          const far = new Path2D();
          far.moveTo(0, ch);
          let ry = ch * 0.68;
          for (let x = 0; x <= W; x += 26) {
            ry = Math.max(
              ch * 0.56,
              Math.min(ch * 0.78, ry + (rng() - 0.5) * ch * 0.07),
            );
            far.lineTo(x, ry);
          }
          far.lineTo(W, ch);
          far.closePath();
          const near = new Path2D();
          const wicks = new Path2D();
          let nx = rng() * 30;
          while (nx < W) {
            const bw = 10 + rng() * 26; // candle body width
            const top = ch * (0.6 + rng() * 0.18);
            near.rect(nx, top, bw, ch - top);
            // the wick · a thin spike rising from the body top
            const wx = nx + bw / 2;
            wicks.moveTo(wx, top);
            wicks.lineTo(wx, top - (6 + rng() * ch * 0.05));
            nx += bw + 18 + rng() * 60;
          }
          s.silhouette = { cw, far, near, wicks };
        }
        const W = cw * 2;
        const drawLayer = (p: Path2D, f: number, stroke?: Path2D) => {
          const shift = ((s.dist * f) % W + W) % W;
          ctx.save();
          ctx.translate(-shift, 0);
          ctx.fill(p);
          if (stroke) ctx.stroke(stroke);
          ctx.translate(W, 0);
          ctx.fill(p);
          if (stroke) ctx.stroke(stroke);
          ctx.restore();
        };
        ctx.fillStyle = "rgba(30,19,10,0.55)";
        drawLayer(s.silhouette.far, 0.12);
        ctx.fillStyle = "rgba(42,25,11,0.6)";
        ctx.strokeStyle = "rgba(74,45,20,0.5)";
        ctx.lineWidth = 2;
        drawLayer(s.silhouette.near, 0.26, s.silhouette.wicks);
      }

      // Earth · a blue marble hanging over the lunar horizon. Far away,
      // so it barely drifts · just a gentle bob to feel alive.
      if (onMoon) {
        const ex = cw * 0.78;
        const ey = ch * 0.24 + Math.sin(s.t * 0.4) * 4;
        const er = Math.max(26, Math.min(cw, ch) * 0.14);
        ctx.save();
        const eg = ctx.createRadialGradient(
          ex - er * 0.3,
          ey - er * 0.3,
          er * 0.2,
          ex,
          ey,
          er,
        );
        eg.addColorStop(0, "#7cbcff");
        eg.addColorStop(0.65, "#2b6fd6");
        eg.addColorStop(1, "#123a7a");
        ctx.shadowColor = "rgba(90,150,255,0.55)";
        ctx.shadowBlur = 28;
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(ex, ey, er, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "#3fae6a";
        ctx.beginPath();
        ctx.ellipse(
          ex - er * 0.2,
          ey + er * 0.12,
          er * 0.42,
          er * 0.22,
          0.5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(
          ex + er * 0.35,
          ey - er * 0.25,
          er * 0.24,
          er * 0.16,
          -0.4,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        // Day/night terminator · a soft shadow sweeping in from the far
        // side gives the marble volume instead of a flat gradient ball.
        ctx.globalAlpha = 1;
        const term = ctx.createRadialGradient(
          ex - er * 0.45,
          ey - er * 0.45,
          er * 0.2,
          ex,
          ey,
          er * 1.15,
        );
        term.addColorStop(0, "rgba(3,8,22,0)");
        term.addColorStop(0.6, "rgba(3,8,22,0)");
        term.addColorStop(1, "rgba(2,5,16,0.62)");
        ctx.fillStyle = term;
        ctx.beginPath();
        ctx.arc(ex, ey, er, 0, Math.PI * 2);
        ctx.fill();
        // Atmosphere rim · a thin fresnel halo on the limb.
        ctx.strokeStyle = "rgba(150,195,255,0.55)";
        ctx.lineWidth = 1.6;
        ctx.shadowColor = "rgba(120,175,255,0.7)";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(ex, ey, er - 0.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // Era labels scrolling with the world · real history only. These
      // name the moment you're running through (FTX, the halving...), so
      // they must stay readable at full scroll speed. The old flat 0.13
      // red was a ghost against the dark sky and unreadable once fast ·
      // now a dark halo lifts a brighter red off whatever's behind it,
      // and each label fades in/out at the screen edges instead of
      // strobing past (legibility rule · 2026-07-10).
      if (!onMoon) {
        ctx.textAlign = "center";
        ctx.font = "700 27px ui-monospace, monospace";
        ctx.textBaseline = "alphabetic";
        for (const era of ERA_SECS) {
          const d = (era.sec - T.times[0]) / 86_400;
          if (d < 0 || d >= T.y.length) continue;
          const sx = d * DAY_W - s.dist + px;
          if (sx < -280 || sx > cw + 280) continue;
          // fade toward the edges so a label never snaps into view · the
          // window is ~180px wide on each side, plateau at full in between.
          const fade = Math.max(
            0,
            Math.min(1, (cw + 180 - sx) / 180, (sx + 180) / 180),
          );
          if (fade <= 0) continue;
          ctx.globalAlpha = fade * 0.92;
          ctx.shadowColor = "rgba(0,0,0,0.9)";
          ctx.shadowBlur = 8;
          ctx.fillStyle = "#ff6b5e";
          ctx.fillText(era.label.toUpperCase(), sx, ch * 0.3);
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      // Terrain ridge
      const dStart = Math.max(0, Math.floor((s.dist - px) / DAY_W));
      const dEnd = Math.min(
        T.y.length - 1,
        Math.ceil((s.dist + (cw - px)) / DAY_W) + 1,
      );
      ctx.beginPath();
      for (let d = dStart; d <= dEnd; d++) {
        const sx = d * DAY_W - s.dist + px;
        if (d === dStart) ctx.moveTo(sx, T.y[d]);
        else ctx.lineTo(sx, T.y[d]);
      }
      // fill under · warm orange terrain, or cool grey regolith.
      ctx.save();
      ctx.lineTo(dEnd * DAY_W - s.dist + px, ch);
      ctx.lineTo(dStart * DAY_W - s.dist + px, ch);
      ctx.closePath();
      // 3-stop fill · a more present, solid top band separates the ground
      // from the dark sky by VALUE (not glow), then falls to near-nothing
      // at the base for depth. This is where the terrain reads as solid
      // foreground now that the ambient glow is gone (2026-07-10).
      const fill = ctx.createLinearGradient(0, ch * 0.4, 0, ch);
      if (onMoon) {
        fill.addColorStop(0, "rgba(150,168,190,0.42)");
        fill.addColorStop(0.45, "rgba(120,140,166,0.15)");
        fill.addColorStop(1, "rgba(150,168,190,0.02)");
      } else {
        fill.addColorStop(0, "rgba(247,147,26,0.38)");
        fill.addColorStop(0.45, "rgba(214,120,20,0.15)");
        fill.addColorStop(1, "rgba(247,147,26,0.015)");
      }
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
      // Craters pocking the regolith · a dark bowl with a lit lower rim
      // (from the horizon glow) so they read as 3D pits, not ink smudges.
      if (onMoon) {
        for (let d = dStart; d <= dEnd; d++) {
          if ((d * 7919) % 11 !== 0) continue; // sparse, deterministic
          const sx = d * DAY_W - s.dist + px;
          const gy = T.y[d];
          ctx.fillStyle = "rgba(10,14,24,0.45)";
          ctx.beginPath();
          ctx.ellipse(sx, gy + 5, 9, 3.2, 0, 0, Math.PI * 2);
          ctx.fill();
          // lit far (lower) rim
          ctx.strokeStyle = "rgba(212,222,236,0.4)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(sx, gy + 5, 9, 3.2, 0, 0.15, Math.PI - 0.15);
          ctx.stroke();
          // shadowed near (upper) lip
          ctx.strokeStyle = "rgba(6,9,18,0.5)";
          ctx.beginPath();
          ctx.ellipse(sx, gy + 5, 9, 3.2, 0, Math.PI + 0.15, Math.PI * 2 - 0.15);
          ctx.stroke();
        }
      }
      // glowing stroke on top
      ctx.beginPath();
      for (let d = dStart; d <= dEnd; d++) {
        const sx = d * DAY_W - s.dist + px;
        if (d === dStart) ctx.moveTo(sx, T.y[d]);
        else ctx.lineTo(sx, T.y[d]);
      }
      ctx.strokeStyle = onMoon ? "#c3ceda" : "#F7931A";
      ctx.lineWidth = 2.4;
      // A tight glow keeps the neon-line identity without the wide haze ·
      // the crisp sunlit lip below does the edge definition (2026-07-10).
      ctx.shadowColor = onMoon
        ? "rgba(170,188,210,0.5)"
        : "rgba(247,147,26,0.75)";
      ctx.shadowBlur = 5;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Sunlit lip · a thin highlight riding just above the ridge (lit
      // from the horizon glow) so the edge reads as a solid crest rather
      // than the top of a colored region. Same path, shifted up 1.5px.
      ctx.save();
      ctx.translate(0, -1.5);
      ctx.strokeStyle = onMoon
        ? "rgba(232,240,250,0.5)"
        : "rgba(255,220,150,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // The planted flag · a ₿ banner staked into the moon at day ~5,
      // scrolling with the surface (Apollo, orange-pilled).
      if (onMoon) {
        const fd = 5;
        const fsx = fd * DAY_W - s.dist + px;
        if (fsx > -40 && fsx < cw + 40) {
          const fgy = T.y[Math.min(T.y.length - 1, fd)];
          ctx.strokeStyle = "#e8edf2";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(fsx, fgy);
          ctx.lineTo(fsx, fgy - 40);
          ctx.stroke();
          const flagGrad = ctx.createLinearGradient(fsx, 0, fsx + 24, 0);
          flagGrad.addColorStop(0, "#F7931A");
          flagGrad.addColorStop(1, "#c86f10");
          ctx.fillStyle = flagGrad;
          ctx.beginPath();
          ctx.moveTo(fsx, fgy - 40);
          ctx.lineTo(fsx + 24, fgy - 35);
          ctx.lineTo(fsx, fgy - 26);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#2a1804";
          ctx.font = "700 10px ui-monospace, monospace";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText("₿", fsx + 5, fgy - 33);
        }
      }

      // Spikes + orbs
      for (let d = dStart; d <= dEnd; d++) {
        const sx = d * DAY_W - s.dist + px;
        if (T.spike[d] > 0) {
          const h = T.spike[d];
          const gy = T.y[d];
          const grad = ctx.createLinearGradient(0, gy - h, 0, gy);
          if (onMoon) {
            // Warm the tip so a grey rock still reads as HAZARD at the
            // ~1050px/s moon speed, echoing the tape's red-spike danger
            // language. Body stays lunar grey · this is the one real
            // readability risk on the just-shipped moon (2026-07-10).
            grad.addColorStop(0, "#ff7a3a");
            grad.addColorStop(0.42, "#aeb8c6");
            grad.addColorStop(1, "rgba(120,132,150,0.3)");
          } else {
            grad.addColorStop(0, "#ff3a4f");
            grad.addColorStop(1, "rgba(255,58,79,0.25)");
          }
          ctx.fillStyle = grad;
          ctx.shadowColor = onMoon
            ? "rgba(255,138,58,0.5)"
            : "rgba(255,58,79,0.6)";
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(sx - DAY_W * 0.38, gy);
          ctx.lineTo(sx, gy - h);
          ctx.lineTo(sx + DAY_W * 0.38, gy);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        if (T.orb[d] && !s.collected.has(d)) {
          const oy = T.y[d] - 64;
          const pulse = 1 + Math.sin(s.t * 5 + d) * 0.15;
          // Bloom halo · a soft radial glow instead of a flat disc.
          const halo = ctx.createRadialGradient(sx, oy, 2, sx, oy, 15 * pulse);
          halo.addColorStop(0, "rgba(247,147,26,0.5)");
          halo.addColorStop(1, "rgba(247,147,26,0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(sx, oy, 15 * pulse, 0, Math.PI * 2);
          ctx.fill();
          // Shaded core · lit upper-left, like the player coin.
          const core = ctx.createRadialGradient(sx - 2, oy - 2, 1, sx, oy, 6.5);
          core.addColorStop(0, "#FFE9C6");
          core.addColorStop(1, "#F7931A");
          ctx.fillStyle = core;
          ctx.beginPath();
          ctx.arc(sx, oy, 6.5, 0, Math.PI * 2);
          ctx.fill();
          // Sats mark · a small lightning bolt (the sats / Lightning
          // symbol), NOT the ₿ whole-coin logo · these orbs are sats, so
          // a ₿ read as confusing (operator, 2026-07-10). Drawn as a path
          // so it stays crisp and on-color at this size. Plus a glint.
          ctx.fillStyle = "rgba(58,36,5,0.9)";
          ctx.beginPath();
          ctx.moveTo(sx + 1.5, oy - 4);
          ctx.lineTo(sx - 2.3, oy + 0.6);
          ctx.lineTo(sx - 0.3, oy + 0.6);
          ctx.lineTo(sx - 1.5, oy + 4);
          ctx.lineTo(sx + 2.3, oy - 0.6);
          ctx.lineTo(sx + 0.3, oy - 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "rgba(255,248,235,0.85)";
          ctx.beginPath();
          ctx.arc(sx - 2, oy - 2.5, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Trail
      for (let i = 0; i < s.trail.length; i++) {
        const tr = s.trail[i];
        const back = (s.trail.length - i) * (speed / 60);
        ctx.globalAlpha =
          (i / s.trail.length) * (0.28 + Math.min(s.combo, 8) * 0.02);
        ctx.fillStyle = "#F7931A";
        ctx.beginPath();
        ctx.arc(
          tr.x - back,
          tr.y - PLAYER_R,
          PLAYER_R * (0.4 + (i / s.trail.length) * 0.5),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Player coin · hidden during the lift-off cinematic, where the coin
      // is drawn boarding the rocket in the overlay instead.
      if ((!s.dead || s.particles.length === 0) && !launching) {
        ctx.save();
        // Squash-and-stretch · stretches along travel in the air, then
        // compresses on a hard landing (s.squash), anchored at the coin's
        // feet so it never detaches from the ground. Uses |vy| so the
        // upward pop stretches (signed vy would wrongly compress it). Flat
        // 1:1 when grounded and idle · byte-identical to the old translate
        // in that case (2026-07-10).
        let sqx = 1;
        let sqy = 1;
        if (!reducedMotion.current && !(s.grounded && s.squash === 0)) {
          const stretch = Math.min(0.18, Math.abs(s.vy) * 0.00028);
          sqy = 1 + stretch;
          sqx = 1 / sqy;
          if (s.squash > 0) {
            sqy = 1 - s.squash * 0.32;
            sqx = 1 + s.squash * 0.26;
          }
        }
        ctx.translate(px, s.y);
        ctx.scale(sqx, sqy);
        ctx.translate(0, -PLAYER_R);
        ctx.rotate(s.grounded ? 0 : s.rot);
        const coin = ctx.createRadialGradient(-3, -4, 2, 0, 0, PLAYER_R + 2);
        coin.addColorStop(0, "#FFD9A0");
        coin.addColorStop(1, "#F7931A");
        ctx.fillStyle = coin;
        ctx.shadowColor = "rgba(247,147,26,0.8)";
        // The player is the one thing that earns a glow (it's the focal,
        // light-emitting element) · a modest pop that climbs a little with
        // the combo, capped tight so it never blooms into haze (10..18).
        ctx.shadowBlur = 10 + Math.min(s.combo, 8);
        ctx.beginPath();
        ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#3a2405";
        ctx.font = "700 13px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("₿", 0, 1);
        ctx.restore();
      }

      // Particles
      ctx.fillStyle = "#F7931A";
      for (const p of s.particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;

      // Floats
      ctx.font = "700 12px ui-monospace, monospace";
      ctx.textAlign = "left";
      for (const f of s.floats) {
        ctx.globalAlpha = Math.max(0, f.life);
        ctx.fillStyle = "#31C48D";
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;

      // Vignette · darkens the corners so the eye settles on the player
      // lane and the frame reads as an arcade screen. Over the world, but
      // under the HUD so the readout stays crisp (2026-07-10 graphics pass).
      const vig = ctx.createRadialGradient(
        cw * 0.5,
        ch * 0.52,
        Math.min(cw, ch) * 0.35,
        cw * 0.5,
        ch * 0.52,
        Math.max(cw, ch) * 0.75,
      );
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, onMoon ? "rgba(1,2,10,0.46)" : "rgba(0,0,0,0.34)");
      ctx.fillStyle = vig;
      ctx.fillRect(-12, -12, cw + 24, ch + 24);

      // HUD (canvas · avoids DOM churn) · a dark halo lifts the readout
      // off bright terrain and orbs that pass under the fixed top-left
      // corner, mirroring the era-label halo (legibility rule, 2026-07-10).
      ctx.textAlign = "left";
      ctx.font = "700 14px ui-monospace, monospace";
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 6;
      ctx.fillStyle = onMoon ? "#cfe0ff" : "#FFD9A0";
      ctx.fillText(
        onMoon
          ? `🌙 MOON ${Math.max(0, Math.floor(s.dist / DAY_W) - 2)}`
          : `DAY ${Math.floor(s.dist / DAY_W)}`,
        14,
        24,
      );
      ctx.fillStyle = "#F7931A";
      ctx.fillText(`${s.sats.toLocaleString("en-US")} sats`, 14, 44);
      // Combo readout · appears once the chain is live, with a decay
      // bar counting down the window (2026-07-09).
      if (s.combo >= 2 && !s.dead) {
        const frac = Math.max(0, 1 - s.comboT / COMBO_WINDOW);
        ctx.fillStyle = "#31C48D";
        ctx.font = "700 14px ui-monospace, monospace";
        ctx.fillText(`COMBO ×${s.combo}`, 14, 66);
        ctx.shadowBlur = 0; // crisp decay bar · no halo bleed on thin rects
        ctx.fillStyle = "rgba(49,196,141,0.22)";
        ctx.fillRect(14, 73, 82, 4);
        ctx.fillStyle = "#31C48D";
        ctx.fillRect(14, 73, 82 * frac, 4);
      }
      ctx.shadowBlur = 0; // reset for the no-combo path before the hint
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(235,225,210,0.45)";
      ctx.font = "600 11px ui-monospace, monospace";
      ctx.fillText(
        onMoon ? "the future · uncharted" : "⌀ dates hidden until you fall",
        cw - 12,
        22,
      );

      // Lift-off cinematic · the bitcoin boards a little rocket and blasts
      // off to the moon. Three beats over LAUNCH_DUR: BOARD (0..0.28) the
      // coin hops off the tape into the rocket, IGNITE (0.28..0.45) the
      // engine lights and rumbles, BLAST-OFF (0.45..1) it accelerates up and
      // off the top. All canvas-drawn, crisp · glow only on the flame and
      // banner (2026-07-10 · operator request).
      if (launching) {
        const prog = 1 - Math.max(0, s.launchT) / LAUNCH_DUR;
        const padY = s.launchPadY;
        const bp = prog < 0.45 ? 0 : (prog - 0.45) / 0.55;
        const baseY = padY - bp * bp * (padY + 260); // rocket foot
        const igniting = prog > 0.28 && prog < 0.5 && !reducedMotion.current;
        const rx = px + (igniting ? (Math.random() - 0.5) * 2.5 : 0);
        ctx.save();

        // upward speed streaks once we're climbing (decorative · gated)
        if (bp > 0 && !reducedMotion.current) {
          ctx.strokeStyle = "rgba(247,147,26,0.45)";
          ctx.lineWidth = 2;
          ctx.globalAlpha = Math.min(1, bp * 1.5);
          for (const st of s.stars) {
            const sxp = ((st.x % cw) + cw) % cw;
            const yy = (st.y + bp * ch * 1.6) % ch;
            ctx.beginPath();
            ctx.moveTo(sxp, yy);
            ctx.lineTo(sxp, yy + 20);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }

        // exhaust flame · a glow is earned here (it's a light source)
        if (prog > 0.28) {
          const grow = prog < 0.45 ? (prog - 0.28) / 0.17 : 1;
          const flame = (14 + grow * 26) * (0.75 + Math.random() * 0.4);
          ctx.shadowColor = "rgba(247,147,26,0.7)";
          ctx.shadowBlur = 10;
          ctx.fillStyle = "#FF9B2E";
          ctx.beginPath();
          ctx.moveTo(rx - 7, baseY);
          ctx.quadraticCurveTo(rx, baseY + flame, rx + 7, baseY);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#FFE39A";
          ctx.beginPath();
          ctx.moveTo(rx - 3.5, baseY);
          ctx.quadraticCurveTo(rx, baseY + flame * 0.62, rx + 3.5, baseY);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        // rocket · fins, cream body, orange nose, window (crisp, no glow)
        ctx.fillStyle = "#F7931A";
        ctx.beginPath();
        ctx.moveTo(rx - 8, baseY - 6);
        ctx.lineTo(rx - 15, baseY + 4);
        ctx.lineTo(rx - 8, baseY);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(rx + 8, baseY - 6);
        ctx.lineTo(rx + 15, baseY + 4);
        ctx.lineTo(rx + 8, baseY);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ECE3D2";
        ctx.beginPath();
        ctx.moveTo(rx - 9, baseY - 4);
        ctx.lineTo(rx - 9, baseY - 34);
        ctx.quadraticCurveTo(rx - 9, baseY - 40, rx - 4, baseY - 42);
        ctx.lineTo(rx + 4, baseY - 42);
        ctx.quadraticCurveTo(rx + 9, baseY - 40, rx + 9, baseY - 34);
        ctx.lineTo(rx + 9, baseY - 4);
        ctx.quadraticCurveTo(rx, baseY, rx - 9, baseY - 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#F7931A";
        ctx.beginPath();
        ctx.moveTo(rx - 8, baseY - 40);
        ctx.lineTo(rx, baseY - 56);
        ctx.lineTo(rx + 8, baseY - 40);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(247,147,26,0.9)";
        ctx.fillRect(rx - 9, baseY - 16, 18, 3.5);
        ctx.fillStyle = "#0e1420";
        ctx.beginPath();
        ctx.arc(rx, baseY - 28, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(247,147,26,0.75)";
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // the bitcoin · arcs off the tape into the window (board), then rides
        if (prog < 0.28) {
          const t2 = prog / 0.28;
          const sxP = rx - 30;
          const syP = padY - PLAYER_R;
          const wy = baseY - 28;
          const cxp = sxP + (rx - sxP) * t2;
          const cyp = syP + (wy - syP) * t2 - Math.sin(t2 * Math.PI) * 34;
          const cg = ctx.createRadialGradient(cxp - 3, cyp - 3, 1, cxp, cyp, PLAYER_R);
          cg.addColorStop(0, "#FFD9A0");
          cg.addColorStop(1, "#F7931A");
          ctx.fillStyle = cg;
          ctx.beginPath();
          ctx.arc(cxp, cyp, PLAYER_R, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#3a2405";
          ctx.font = "700 12px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("₿", cxp, cyp + 1);
        } else {
          ctx.fillStyle = "#F7931A";
          ctx.font = "700 8px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("₿", rx, baseY - 27.5);
        }

        // banner · fades in on ignite, rides through blast-off
        const bannerA = Math.max(0, Math.min(1, (prog - 0.3) / 0.2));
        if (bannerA > 0) {
          ctx.globalAlpha = bannerA;
          ctx.textAlign = "center";
          ctx.fillStyle = "#FFD9A0";
          ctx.font = "800 30px ui-monospace, monospace";
          ctx.shadowColor = "rgba(247,147,26,0.9)";
          ctx.shadowBlur = 12;
          ctx.fillText("TO THE MOON", cw / 2, ch * 0.3);
          ctx.shadowBlur = 0;
          ctx.font = "700 13px ui-monospace, monospace";
          ctx.fillStyle = "rgba(235,225,210,0.8)";
          ctx.fillText("you caught the present", cw / 2, ch * 0.3 + 26);
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }

      if (s.dead && s.particles.length === 0 && s.slowmo <= 0) {
        runningRef.current = false;
        return;
      }
      rafRef.current = requestAnimationFrame(frame);
    },
    [die, groundAt, play],
  );

  const start = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    // Double-tap guard · a second start while a run is live would spawn
    // a second frame chain (2x speed, doubled CPU). Cancel any pending
    // frame so exactly one loop ever runs (review 2026-07-09).
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const T = buildTerrain(canvas.clientHeight);
    if (!T) {
      setFailed(true);
      return;
    }
    terrainRef.current = T;
    const s = g.current;
    s.t = 0;
    s.dist = DAY_W * 2;
    s.y = groundAt(s.dist);
    s.vy = 0;
    s.grounded = true;
    s.jumps = 2;
    s.sats = 0;
    s.rot = 0;
    s.lastTs = null;
    s.trail = [];
    s.particles = [];
    s.collected = new Set();
    s.slowmo = 0;
    s.dead = false;
    s.floats = [];
    s.combo = 0;
    s.comboT = 0;
    s.peakCombo = 0;
    s.shake = 0;
    s.freeze = 0;
    s.squash = 0;
    s.jumpBuf = 0;
    // Reset the moon-overtime state · every run starts on the tape.
    s.phase = "tape";
    s.launchT = 0;
    s.launchPadY = 0;
    s.presentReached = false;
    s.presentDays = 0;
    s.presentIso = "";
    s.totalDist = 0;
    s.moonChunks = 0;
    s.moonSeed = 0;
    // Capture the day this run belongs to · the daily board and the moon
    // course both key off this, so a run that crosses midnight stays on
    // its own day/course (2026-07-10 review). buildTerrain above seeds
    // the tape from the same gauntletNumber at this same instant.
    s.dayNumber = gauntletNumber(Date.now());
    s.stars = [];
    setDeath(null);
    setDeathRank(null);
    setStarted(true);
    runningRef.current = true;
    track("gauntlet2_runner_start");
    rafRef.current = requestAnimationFrame(frame);
  }, [ready, buildTerrain, frame, groundAt]);

  const jump = useCallback(() => {
    const s = g.current;
    if (!started || s.dead) return;
    // No jump during the lift-off cinematic · a tap would fire a grounded
    // jump on top of the launch thrust and yank the rocket rise, undercutting
    // the exact TO THE MOON moment (2026-07-10).
    if (s.phase === "launch") return;
    if (s.jumps > 0) {
      const grounded = s.jumps === 2;
      s.vy = JUMP_VY * (grounded ? 1 : 0.86);
      s.jumps -= 1;
      s.grounded = false;
      play(grounded ? "jump" : "jump2");
    } else {
      // Both jumps spent · remember the tap for ~100ms so an input a few
      // frames before touchdown still fires on landing (consumed in the
      // land branch · high-speed fairness, 2026-07-10).
      s.jumpBuf = 0.1;
    }
  }, [started, play]);

  // Input · pointer anywhere on the scene, space/up on the keyboard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never steal keys from form fields or other handlers (the
      // palette input lives on the same page · review 2026-07-08).
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (e.key === " " || e.key === "ArrowUp") {
        e.preventDefault();
        if (death) start();
        else jump();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump, start, death]);

  function shareHref(): string {
    if (!death) return "https://x.com/intent/tweet";
    const handle = getHandle();
    // The shared link is a per-run card URL · X unfurls its dynamic OG
    // image into a personalized preview (the run summary), and the page
    // it lands on has a Play button (lib/run-card + /runner/card).
    const cardUrl =
      "galaxymind.space/runner/card/" +
      encodeRunCard({
        days: death.days,
        sats: death.sats,
        present: death.reachedPresent,
        combo: death.peakCombo,
        era: death.eraLine,
        handle,
      });
    const rankLine =
      deathRank != null ? `\n#${deathRank} on the all-time board` : "";
    const comboLine =
      death.peakCombo >= 3 ? ` · ×${death.peakCombo} peak combo` : "";
    const moonLine =
      death.moonDays > 0 ? ` · ${death.moonDays} days on the moon 🌙` : "";
    const text = death.reachedPresent
      ? `Node Runner · I caught the present and went TO THE MOON as ${handle} 🚀${moonLine} · ${death.sats.toLocaleString("en-US")} sats.${rankLine}\n\nReach the present, then outrun the future. Your turn: ${cardUrl}`
      : `Node Runner · ${handle} survived ${death.days} days of actual bitcoin history · ${death.sats.toLocaleString("en-US")} sats${comboLine}${rankLine}${death.eraLine ? `\nKilled by ${death.eraLine.toLowerCase()} (${death.dateIso})` : `\nFell on ${death.dateIso}`}\n\nBeat my ${death.days} days: ${cardUrl}`;
    return "https://x.com/intent/tweet?text=" + encodeURIComponent(text);
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        onPointerDown={() => (death ? start() : jump())}
        className="w-full h-[64svh] min-h-[420px] sm:h-[480px] sm:min-h-0 lg:h-[540px] block touch-none select-none cursor-pointer"
        role="img"
        aria-label="Node Runner · a reflex game surfing the actual bitcoin price terrain. Tap, click, or press space to jump."
      />

      {/* Intro overlay */}
      {!started && !death && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center"
          style={{ background: "rgba(10,6,5,0.9)" }}
        >
          <div className="text-center max-w-md px-6">
            <div
              className="micro-label mb-2"
              style={{ color: "var(--accent)" }}
            >
              Node Runner
            </div>
            <p
              className="text-sm mb-1 leading-relaxed"
              style={{ color: "rgba(235,225,210,0.66)" }}
            >
              The terrain is the actual price tape. Red candles grew into the
              spikes · the bear markets run downhill. Tap to jump, tap again
              mid-air. Collect sats. Reach the present and you go to the moon.
            </p>
            {best && (
              <p
                className="micro-label mb-4"
                style={{ color: "rgba(235,225,210,0.55)" }}
              >
                Best · {best.days} days · {best.sats.toLocaleString("en-US")}{" "}
                sats
              </p>
            )}
            {failed ? (
              <p
                className="text-sm"
                style={{ color: "rgba(235,225,210,0.66)" }}
              >
                Price history is not reporting right now · the runner only runs
                on actual data.
              </p>
            ) : (
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={start}
                  disabled={!ready}
                  className="px-7 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.22em] font-bold hover:bg-[var(--accent-hover)] hover:shadow-[0_0_28px_var(--accent-glow)] transition-all disabled:opacity-50"
                >
                  {ready ? "Run →" : "Loading tape..."}
                </button>
                <button
                  type="button"
                  onClick={toggleAudio}
                  aria-pressed={audioOn}
                  className="micro-label px-4 py-3 rounded-lg border transition-all hover:border-[var(--accent)]"
                  style={{
                    borderColor: audioOn
                      ? "rgba(247,147,26,0.5)"
                      : "rgba(235,225,210,0.25)",
                    color: audioOn ? "var(--accent)" : "rgba(235,225,210,0.66)",
                  }}
                >
                  {audioOn ? "♪ Sound on" : "∅ Sound off"}
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  className="micro-label px-5 py-3 rounded-lg border transition-all hover:border-[var(--accent)]"
                  style={{
                    borderColor: "rgba(235,225,210,0.25)",
                    color: "rgba(235,225,210,0.66)",
                  }}
                >
                  More games
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Death / summit overlay · the whole surface restarts. A div
          with role=button (not <button>) because it contains the
          share link · nested interactive content is invalid HTML. */}
      {death && (
        <div
          role="button"
          tabIndex={0}
          onClick={start}
          onKeyDown={(e) => {
            if (e.key === "Enter") start();
          }}
          className="absolute inset-0 z-10 flex items-center justify-center w-full cursor-pointer"
          style={{ background: "rgba(6,4,2,0.88)" }}
          aria-label="Run it back"
        >
          <div className="text-center max-w-md px-6 pointer-events-none">
            <div
              className="g2-stamp inline-block px-5 py-2 rounded-lg border-2 font-mono text-xl sm:text-2xl font-bold tracking-[0.15em] mb-3"
              style={{
                color: death.reachedPresent ? "#7cbcff" : "#ff3a4f",
                borderColor: death.reachedPresent ? "#7cbcff" : "#ff3a4f",
                textShadow: `0 0 18px ${death.reachedPresent ? "#7cbcff" : "#ff3a4f"}`,
                animationDelay: "0.1s",
              }}
            >
              {death.reachedPresent ? "🌙 YOU MADE IT TO THE MOON" : "REKT"}
            </div>
            <div
              className="font-mono text-lg tabular-nums mb-1"
              style={{ color: "#F2EFE9" }}
            >
              {death.reachedPresent
                ? `${death.moonDays} days on the moon · ${death.sats.toLocaleString("en-US")} sats`
                : `${death.days} days · ${death.sats.toLocaleString("en-US")} sats`}
              {death.isBest && (
                <span
                  className="ml-2 t-xs uppercase tracking-widest"
                  style={{ color: "var(--accent)" }}
                >
                  · new best
                </span>
              )}
            </div>
            <div
              className="micro-label mb-4"
              style={{ color: "rgba(235,225,210,0.55)" }}
            >
              {death.reachedPresent
                ? "You caught the present, then outran the future"
                : death.eraLine
                  ? `Killed by ${death.eraLine} · ${death.dateIso}`
                  : `The mask lifts · you fell on ${death.dateIso}`}
            </div>
            {death.peakCombo >= 3 && (
              <div
                className="micro-label mb-3"
                style={{ color: "#31C48D" }}
              >
                Peak combo ×{death.peakCombo}
              </div>
            )}
            <div
              className="micro-label mb-3"
              style={{ color: "var(--accent)" }}
            >
              played as {getHandle()}
              {deathRank != null
                ? ` · #${deathRank} on the all-time board`
                : ""}
            </div>
            <div
              className="font-mono t-xs uppercase tracking-[0.25em] mb-4"
              style={{ color: "rgba(235,225,210,0.45)" }}
            >
              or tap anywhere to run it back
            </div>
            {/* Share is the loud primary · every shared run is a recruit,
                and the whole surface already restarts on tap, so rematch
                stays one tap away without a second loud button (growth
                sprint 2026-07-10). */}
            <span className="flex flex-wrap justify-center gap-2 pointer-events-auto">
              <a
                href={shareHref()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  track("gauntlet2_runner_share");
                }}
                onKeyDown={(e) => e.stopPropagation()}
                className="px-7 py-3 rounded-lg bg-[var(--accent)] text-black font-mono text-sm uppercase tracking-[0.2em] font-bold hover:bg-[var(--accent-hover)] hover:shadow-[0_0_28px_var(--accent-glow)] transition-all"
              >
                Share on X →
              </a>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  start();
                }}
                className="micro-label px-5 py-3 rounded-lg border transition-all hover:border-[var(--accent)]"
                style={{
                  borderColor: "rgba(247,147,26,0.5)",
                  color: "var(--accent)",
                }}
              >
                Run it back →
              </button>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onExit();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    onExit();
                  }
                }}
                className="micro-label px-5 py-3 rounded-lg border transition-all hover:border-[var(--accent)] inline-flex items-center"
                style={{
                  borderColor: "rgba(235,225,210,0.25)",
                  color: "#F2EFE9",
                }}
              >
                More games
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
