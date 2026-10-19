"use client";

/* =====================================================================
 * WenGame · the daily chart-dating cabinet (client).
 *
 * A real 90-close slice of the BTC tape, price axis shown, dates
 * redacted. Five guesses at WEN it was via an auto-zoom timeline ·
 * each guess answers earlier/later + a heat band, and the timeline
 * re-ranges to the surviving interval so eliminated history visibly
 * disappears. Scoring is closeness sats (lib/wen) · everyone finishes
 * with a number worth sharing, nobody "loses".
 *
 * House invariants honored here:
 * - Day number captured ONCE at init (s.dayN) · a session crossing UTC
 *   midnight keeps its start puzzle (Runner lesson, 2026-07-10).
 * - Series = loadBtcHistory() minus the trailing 2 closes · identical
 *   sim for every player intraday (Gauntlet convention).
 * - The scored answer is the located CLOSE's own UTC day (effAnswer),
 *   so scoring, reveal chart, and share all agree even if the raw
 *   engine date fell in a data gap.
 * - One scored play per UTC day · gm:wen:res:${n} locks the cabinet
 *   into the result view until the next puzzle. No practice mode ·
 *   scarcity IS the ritual; the post-game slot funnels to the other
 *   cabinets instead.
 * - Fixed-dark instrument surface with fixed-light text (dark dials
 *   never use theme vars) · type floor 10px · no em dashes · nothing
 *   singles out 88.
 * ===================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { loadBtcHistory, type BtcPoint } from "@/lib/btc-history-client";
import {
  DAY_MS,
  WEN_GUESSES,
  K_WEN_BEST,
  K_WEN_COACHED,
  K_WEN_PROG,
  K_WEN_RES,
  K_WEN_STATS,
  K_WEN_UNSENT,
  buildShareText,
  encodeWenCard,
  evaluateGuess,
  gridCell,
  scoreRun,
  utcDayIndex,
  wenAnswerUtc,
  wenGuessBounds,
  type WenGuessResult,
} from "@/lib/wen";
import {
  gauntletNumber,
  nextGauntletAt,
} from "@/lib/gauntlet-day";
import { submitScore } from "@/lib/arcade";
import { useArcadeCloud } from "@/lib/useArcadeCloud";
import { nostrShareVariant, withAttribution, xIntentUrl } from "@/lib/share-templates";
import { NAMED_ERAS } from "@/app/gauntlet/engine";

// Fixed-light palette for the dark instrument (never theme vars).
const INK = "#F2EFE9";
const INK_MUTED = "#A5A096";
const ACCENT = "#F7931A";
const PANEL = "#0E0E11";
const GRID_LINE = "#26262C";

type Phase = "loading" | "error" | "coach" | "play" | "done";

type StoredResult = {
  sats: number;
  cells: WenGuessResult[];
  guesses: number[]; // guess UTC-midnight ms, in order
  answerUtc: number;
  rank?: number | null;
};

type WenStats = {
  played: number;
  totalSats: number;
  best: number;
  bullseyes: number;
  streak: number;
  lastDay: number;
  // score-band histogram · 0-2k / 2-4k / 4-6k / 6-8k / 8k+
  bands: [number, number, number, number, number];
};

const EMPTY_STATS: WenStats = {
  played: 0,
  totalSats: 0,
  best: 0,
  bullseyes: 0,
  streak: 0,
  lastDay: 0,
  bands: [0, 0, 0, 0, 0],
};

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* best-effort */
  }
}

const fmtDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const fmtMonY = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});

/** Band → the human hint under a stamped guess (never the exact days
 *  off · that would make the game a precision ruler). */
function bandHint(r: WenGuessResult): string {
  if (r.band === "bull") return "MOON. Nailed it";
  const dir = r.direction === "earlier" ? "earlier" : "later";
  if (r.band === "close") return `so close · a touch ${dir}`;
  if (r.band === "warm") return `warm · weeks ${dir}`;
  if (r.band === "cold") return `cold · months ${dir}`;
  return `frozen · years ${dir}`;
}

/** Nearest named era to the answer · the reveal's "what was happening". */
function eraLabelFor(answerUtc: number, windowStartUtc: number): string | null {
  let best: { label: string; dist: number } | null = null;
  for (const e of NAMED_ERAS) {
    const t = Date.parse(`${e.iso}T00:00:00Z`);
    const inWindow = t >= windowStartUtc && t <= answerUtc;
    const dist = inWindow ? 0 : Math.min(
      Math.abs(t - answerUtc),
      Math.abs(t - windowStartUtc),
    );
    if (dist <= 45 * DAY_MS && (best == null || dist < best.dist)) {
      best = { label: e.label, dist };
    }
  }
  return best?.label ?? null;
}

/** SVG path for a series slice · MiniSparkline approach at cabinet size. */
function linePath(
  pts: { t: number; p: number }[],
  w: number,
  h: number,
  pad: number,
): string {
  if (pts.length < 2) return "";
  let min = Infinity;
  let max = -Infinity;
  for (const q of pts) {
    if (q.p < min) min = q.p;
    if (q.p > max) max = q.p;
  }
  const span = max - min || 1;
  const step = (w - pad * 2) / (pts.length - 1);
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const x = pad + i * step;
    const y = pad + (1 - (pts[i].p - min) / span) * (h - pad * 2);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

export function WenGame() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [series, setSeries] = useState<BtcPoint[]>([]);
  const [guesses, setGuesses] = useState<
    { utc: number; res: WenGuessResult }[]
  >([]);
  const [bounds, setBounds] = useState<{ lo: number; hi: number } | null>(null);
  const [selDay, setSelDay] = useState(0); // day offset within bounds
  const [result, setResult] = useState<StoredResult | null>(null);
  const [stats, setStats] = useState<WenStats>(EMPTY_STATS);
  const [countdown, setCountdown] = useState("");
  const [copied, setCopied] = useState(false);
  const [stamping, setStamping] = useState(false);

  // Captured ONCE at init · the whole session plays this puzzle.
  const dayNRef = useRef<number>(0);
  const answerRef = useRef<number>(0); // effAnswer UTC-midnight ms
  const windowRef = useRef<BtcPoint[]>([]);

  const dayN = dayNRef.current;

  // ── init · lock check, history load, window locate ────────────────
  useEffect(() => {
    let alive = true;
    const n = gauntletNumber(Date.now());
    dayNRef.current = n;
    setStats(readJson<WenStats>(K_WEN_STATS) ?? EMPTY_STATS);

    // Flush a post that never got verified last time (offline/429/
    // KV-down) · repeats are idempotent server-side (ZADD GT) and the
    // daily sent-flag only exists after a VERIFIED ok (H3 pattern).
    // The retry needs the guess list too (server-side replay proof) ·
    // and only TODAY's puzzle is still postable (the API rejects stale
    // days outright now), so anything else just drops the marker.
    try {
      const unsent = window.localStorage.getItem(K_WEN_UNSENT);
      if (unsent) {
        const u = JSON.parse(unsent) as {
          sats?: number;
          n?: number;
          g?: number[];
        };
        if (typeof u.sats === "number" && u.n === n && Array.isArray(u.g)) {
          void submitScore("wen", u.sats, u.n, u.g).then((res) => {
            if (res) {
              try {
                window.localStorage.removeItem(K_WEN_UNSENT);
              } catch {
                /* best-effort */
              }
            }
          });
        } else {
          window.localStorage.removeItem(K_WEN_UNSENT);
        }
      }
    } catch {
      /* best-effort · never block the puzzle on a retry */
    }

    loadBtcHistory()
      .then((raw) => {
        if (!alive) return;
        // Trailing 2 closes trimmed · the last mutates intraday
        // (Gauntlet convention) so every player sims the same series.
        // /api/history stamps t in unix SECONDS · normalize to ms once
        // here (heuristic survives either unit) so all the day math in
        // lib/wen stays in one unit.
        const pts = raw
          .slice(0, raw.length - 2)
          .map((q) => (q.t < 1e12 ? { t: q.t * 1000, p: q.p } : q));
        const targetDay = utcDayIndex(wenAnswerUtc(n));
        // Locate the answer close · exact day, else nearest earlier
        // within 3 days (data gaps). Everyone shares the series, so
        // everyone lands on the same effective answer.
        let idx = -1;
        for (let i = pts.length - 1; i >= 0; i--) {
          const d = utcDayIndex(pts[i].t);
          if (d <= targetDay) {
            if (targetDay - d <= 3) idx = i;
            break;
          }
        }
        if (idx < 89) {
          setPhase("error");
          return;
        }
        const effAnswer = utcDayIndex(pts[idx].t) * DAY_MS;
        answerRef.current = effAnswer;
        windowRef.current = pts.slice(idx - 89, idx + 1);
        setSeries(pts);

        // Finished already today → straight to the result view.
        const stored = readJson<StoredResult>(K_WEN_RES(n));
        if (stored) {
          setResult(stored);
          setPhase("done");
          return;
        }

        // Bounds · engine range clamped to what the series can render.
        const gb = wenGuessBounds(n);
        const lo = Math.max(gb.minUtc, utcDayIndex(pts[89].t) * DAY_MS);
        const hi = Math.min(
          gb.maxUtc,
          utcDayIndex(pts[pts.length - 1].t) * DAY_MS,
        );

        // Restore an in-progress run (refresh mid-game keeps guesses).
        const prog = readJson<{ g: number[] }>(K_WEN_PROG(n));
        let zl = lo;
        let zh = hi;
        const restored: { utc: number; res: WenGuessResult }[] = [];
        if (prog?.g?.length) {
          for (const g of prog.g.slice(0, WEN_GUESSES)) {
            const res = evaluateGuess(g, effAnswer);
            restored.push({ utc: g, res });
            if (res.direction === "earlier") zh = Math.min(zh, g - DAY_MS);
            else if (res.direction === "later") zl = Math.max(zl, g + DAY_MS);
          }
        }
        setGuesses(restored);
        setBounds({ lo: zl, hi: zh });
        setSelDay(
          Math.floor((utcDayIndex(zh) - utcDayIndex(zl)) / 2),
        );

        let coached = false;
        try {
          coached = window.localStorage.getItem(K_WEN_COACHED) === "1";
        } catch {
          /* ignore */
        }
        setPhase(coached || restored.length > 0 ? "play" : "coach");
      })
      .catch(() => {
        if (alive) setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  // ── countdown to the next puzzle (result view) ─────────────────────
  // `rolled` flips once the UTC day number moves past the puzzle this
  // session solved · the reliable "new puzzle exists" signal (the raw
  // clock re-targets the NEXT midnight after rollover, so a
  // countdown-hit-zero check would only flash for one second).
  const [rolled, setRolled] = useState(false);
  useEffect(() => {
    if (phase !== "done") return;
    const tick = () => {
      if (gauntletNumber(Date.now()) > dayNRef.current) {
        setRolled(true);
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
    return () => window.clearInterval(id);
  }, [phase]);

  const selUtc = useMemo(() => {
    if (!bounds) return 0;
    return (utcDayIndex(bounds.lo) + selDay) * DAY_MS;
  }, [bounds, selDay]);

  const rangeDays = bounds
    ? utcDayIndex(bounds.hi) - utcDayIndex(bounds.lo)
    : 0;

  // ── cross-device cloud save (X-linked players · 2026-07-18) ─────────
  // Sync the DURABLE record only: best + lifetime stats. Today's result /
  // in-progress guesses (K_WEN_RES / K_WEN_PROG) and the board outbox
  // (K_WEN_UNSENT) are day-state and must never sync.
  const readCloud = useCallback(() => ({
    best: Number(window.localStorage.getItem(K_WEN_BEST) ?? 0) || 0,
    stats: readJson<WenStats>(K_WEN_STATS) ?? EMPTY_STATS,
  }), []);
  const adoptCloud = useCallback((m: { best?: number; stats?: Partial<WenStats> }) => {
    if (!m || typeof m !== "object") return;
    const cur = readJson<WenStats>(K_WEN_STATS) ?? EMPTY_STATS;
    const ms = m.stats ?? {};
    // per-key best-of against CURRENT local · adoption can only raise a value
    const next: WenStats = {
      played: Math.max(cur.played, ms.played ?? 0),
      totalSats: Math.max(cur.totalSats, ms.totalSats ?? 0),
      best: Math.max(cur.best, ms.best ?? 0, m.best ?? 0),
      bullseyes: Math.max(cur.bullseyes, ms.bullseyes ?? 0),
      streak: cur.streak,
      lastDay: cur.lastDay,
      bands: cur.bands.map((v, i) => Math.max(v, (ms.bands ?? [])[i] ?? 0)) as WenStats["bands"],
    };
    // day-continuity streak: adopt only if strictly more recent, or longer today
    if (typeof ms.lastDay === "number" && typeof ms.streak === "number" &&
        (ms.lastDay > cur.lastDay || (ms.lastDay === cur.lastDay && ms.streak > cur.streak))) {
      next.lastDay = ms.lastDay;
      next.streak = ms.streak;
    }
    writeJson(K_WEN_STATS, next);
    setStats(next);
    // K_WEN_BEST is a RAW numeric string everywhere else (finish writes
    // String(sats), reads Number(...)) · writeJson would double-encode it to
    // '"1234"' and every Number() read would then be NaN (review 2026-07-18).
    try { window.localStorage.setItem(K_WEN_BEST, String(next.best)); } catch { /* best-effort */ }
  }, []);
  const pushCloud = useArcadeCloud("wen", readCloud, adoptCloud);

  // ── finish · score, persist, board, streak event ───────────────────
  const finish = useCallback(
    (all: { utc: number; res: WenGuessResult }[]) => {
      const n = dayNRef.current;
      const cells = all.map((g) => g.res);
      const sats = scoreRun(cells);
      const res: StoredResult = {
        sats,
        cells,
        guesses: all.map((g) => g.utc),
        answerUtc: answerRef.current,
      };
      writeJson(K_WEN_RES(n), res);
      try {
        window.localStorage.removeItem(K_WEN_PROG(n));
      } catch {
        /* ignore */
      }
      // Stats · streak counts consecutive puzzle days.
      setStats((prev) => {
        const next: WenStats = {
          played: prev.played + 1,
          totalSats: prev.totalSats + sats,
          best: Math.max(prev.best, sats),
          bullseyes:
            prev.bullseyes + (cells.some((c) => c.band === "bull") ? 1 : 0),
          streak: prev.lastDay === n - 1 ? prev.streak + 1 : 1,
          lastDay: n,
          bands: [...prev.bands] as WenStats["bands"],
        };
        next.bands[Math.min(4, Math.floor(sats / 2000))]++;
        writeJson(K_WEN_STATS, next);
        return next;
      });
      try {
        const best = Number(window.localStorage.getItem(K_WEN_BEST) ?? 0);
        if (sats > best) window.localStorage.setItem(K_WEN_BEST, String(sats));
      } catch {
        /* ignore */
      }
      setResult(res);
      setPhase("done");
      pushCloud(); // sync best + stats to the X account (linked players)
      // Board post (verified-success sent-flag lives in submitScore) +
      // the cross-cabinet streak / install-nudge event. The unsent
      // marker survives until the post is VERIFIED · retried on the
      // next visit otherwise (H3 pattern, same as the Runner). The
      // guess list rides along as the replay proof · the server
      // re-derives today's answer and re-scores it (lib/arcade-replay).
      const proof = all.map((g) => g.utc);
      writeJson(K_WEN_UNSENT, { sats, n, g: proof });
      void submitScore("wen", sats, n, proof).then((r) => {
        if (r) {
          try {
            window.localStorage.removeItem(K_WEN_UNSENT);
          } catch {
            /* best-effort */
          }
        }
        if (r && typeof r.rank === "number") {
          setResult((cur) => {
            if (!cur) return cur;
            const withRank = { ...cur, rank: r.rank };
            writeJson(K_WEN_RES(n), withRank);
            return withRank;
          });
        }
      });
      try {
        window.dispatchEvent(new CustomEvent("gm:arcade-finished"));
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const onGuess = useCallback(() => {
    if (!bounds || phase !== "play" || stamping) return;
    const res = evaluateGuess(selUtc, answerRef.current);
    const all = [...guesses, { utc: selUtc, res }];
    setStamping(true);
    window.setTimeout(() => setStamping(false), 350);
    setGuesses(all);
    writeJson(K_WEN_PROG(dayNRef.current), { g: all.map((g) => g.utc) });
    if (res.band === "bull" || all.length >= WEN_GUESSES) {
      finish(all);
      return;
    }
    // Auto-zoom · the surviving interval only.
    let lo = bounds.lo;
    let hi = bounds.hi;
    if (res.direction === "earlier") hi = Math.min(hi, selUtc - DAY_MS);
    else lo = Math.max(lo, selUtc + DAY_MS);
    if (hi < lo) hi = lo;
    setBounds({ lo, hi });
    setSelDay(Math.floor((utcDayIndex(hi) - utcDayIndex(lo)) / 2));
  }, [bounds, phase, stamping, selUtc, guesses, finish]);

  const shareText = useMemo(() => {
    if (!result) return "";
    // The link is the per-result card path · unfurls into the OG
    // billboard (sats + drawn grid) instead of the generic page card.
    const seg = encodeWenCard({
      n: dayN,
      sats: result.sats,
      cells: result.cells.map((c) => ({
        direction: c.direction,
        band: c.band,
      })),
    });
    return buildShareText(
      dayN,
      result.sats,
      result.cells,
      `galaxymind.space/wen/c/${seg}`,
    );
  }, [result, dayN]);

  const onCopy = useCallback(() => {
    if (!shareText) return;
    void navigator.clipboard?.writeText(shareText).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }, [shareText]);

  // Nostr hand-off · clipboard with the hashtag variant (no compose-
  // intent URL standard exists across Nostr clients). 44 of the
  // directory's vendors are Nostr-native and the WEN emoji grid is
  // exactly the Wordle-grid format that spreads there (audit
  // 2026-07-12) · don't make X the only one-tap destination.
  const [copiedNostr, setCopiedNostr] = useState(false);
  const onCopyNostr = useCallback(() => {
    if (!shareText) return;
    void navigator.clipboard?.writeText(nostrShareVariant(shareText)).then(() => {
      setCopiedNostr(true);
      window.setTimeout(() => setCopiedNostr(false), 1600);
    });
  }, [shareText]);

  // ── window chart (play) · dates redacted ──────────────────────────
  const mysteryChart = useMemo(() => {
    const w = windowRef.current;
    if (w.length < 2) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const q of w) {
      if (q.p < min) min = q.p;
      if (q.p > max) max = q.p;
    }
    return { d: linePath(w, 640, 260, 18), min, max };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── reveal chart (done) · full tape + window + guess pins ─────────
  const revealChart = useMemo(() => {
    if (phase !== "done" || !result || series.length < 2) return null;
    const W = 640;
    const H = 180;
    const PAD = 14;
    let min = Infinity;
    let max = -Infinity;
    for (const q of series) {
      if (q.p < min) min = q.p;
      if (q.p > max) max = q.p;
    }
    const span = max - min || 1;
    const t0 = series[0].t;
    const t1 = series[series.length - 1].t;
    const xFor = (t: number) =>
      PAD + ((t - t0) / (t1 - t0 || 1)) * (W - PAD * 2);
    const winStart = result.answerUtc - 89 * DAY_MS;
    const winPts = series.filter(
      (q) => q.t >= winStart - DAY_MS && q.t <= result.answerUtc + DAY_MS,
    );
    let winD = "";
    for (let i = 0; i < winPts.length; i++) {
      const x = xFor(winPts[i].t);
      const y = PAD + (1 - (winPts[i].p - min) / span) * (H - PAD * 2);
      winD += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return {
      fullD: linePath(series, W, H, PAD),
      winD,
      winX0: xFor(winStart),
      winX1: xFor(result.answerUtc),
      pins: result.guesses.map((g) => xFor(g)),
      answerX: xFor(result.answerUtc),
    };
  }, [phase, result, series]);

  const sinceLine = useMemo(() => {
    if (!result || series.length < 2) return null;
    const winPts = windowRef.current;
    const endClose = winPts[winPts.length - 1]?.p;
    const nowClose = series[series.length - 1]?.p;
    if (!endClose || !nowClose) return null;
    const pct = ((nowClose - endClose) / endClose) * 100;
    const sign = pct >= 0 ? "+" : "";
    return `BTC is ${sign}${pct.toFixed(0)}% since this window`;
  }, [result, series]);

  // ═══════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════

  if (phase === "loading") {
    return (
      <div
        className="micro-label rounded-2xl border border-[var(--border-subtle)] p-8 text-center"
        style={{ background: PANEL, color: INK_MUTED }}
      >
        Loading the tape…
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div
        className="rounded-2xl border border-[var(--border-subtle)] p-8 text-center"
        style={{ background: PANEL }}
      >
        <div
          className="micro-label mb-2"
          style={{ color: ACCENT }}
        >
          Tape syncing
        </div>
        <p className="text-sm" style={{ color: INK_MUTED }}>
          The price history feed is not answering right now. No fake
          puzzles on an honesty-branded site · try again in a minute.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="micro-label mt-4 min-h-[44px] px-6 py-2 rounded-lg border"
          style={{ borderColor: GRID_LINE, color: INK }}
        >
          Try again
        </button>
      </div>
    );
  }

  // In the done view the STORED answer is authoritative (it survives
  // reloads); during play the ref is the live one. They agree by
  // construction, this just removes the ordering dependency.
  const answerDate = result?.answerUtc ?? answerRef.current;

  return (
    <div
      className="relative rounded-2xl border border-[var(--border-subtle)] overflow-hidden"
      style={{ background: PANEL }}
    >
      {/* Cabinet header strip */}
      <div className="flex items-baseline justify-between px-4 sm:px-5 pt-4">
        <div
          className="micro-label"
          style={{ color: ACCENT }}
        >
          WEN #{dayN}
        </div>
        <div
          className="font-mono t-xs uppercase tracking-[0.2em]"
          style={{ color: INK_MUTED }}
        >
          {phase === "done"
            ? "solved · new tape soon"
            : `guess ${Math.min(guesses.length + 1, WEN_GUESSES)} of ${WEN_GUESSES}`}
        </div>
      </div>

      {/* ── COACH · one sentence, one button ─────────────────────── */}
      {phase === "coach" && (
        <div className="px-4 sm:px-8 py-10 text-center">
          <div
            className="micro-label mb-3"
            style={{ color: INK_MUTED }}
          >
            Wen moon? Wen dip? Wen was THIS?
          </div>
          <p
            className="text-base sm:text-lg max-w-md mx-auto mb-6 leading-relaxed"
            style={{ color: INK }}
          >
            This is an actual 90 day slice of the Bitcoin tape with the
            dates redacted. You get {WEN_GUESSES} guesses at WEN it was.
            Every arrow narrows the timeline.
          </p>
          <button
            type="button"
            onClick={() => {
              try {
                window.localStorage.setItem(K_WEN_COACHED, "1");
              } catch {
                /* ignore */
              }
              setPhase("play");
            }}
            className="micro-label min-h-[44px] px-6 py-2.5 rounded-lg font-semibold text-black transition-all hover:shadow-[0_0_24px_var(--accent-glow)]"
            style={{ background: ACCENT }}
          >
            Show me the tape →
          </button>
        </div>
      )}

      {/* ── PLAY ──────────────────────────────────────────────────── */}
      {phase === "play" && mysteryChart && bounds && (
        <div className="px-3 sm:px-5 pb-5">
          {/* The classified tape */}
          <div className="relative mt-3 rounded-xl overflow-hidden border" style={{ borderColor: GRID_LINE }}>
            <svg
              viewBox="0 0 640 260"
              className="block w-full"
              role="img"
              aria-label="A 90 day bitcoin price chart with the dates hidden"
            >
              <rect width="640" height="260" fill="#0A0A0C" />
              {[0.25, 0.5, 0.75].map((f) => (
                <line
                  key={f}
                  x1="18"
                  x2="622"
                  y1={18 + f * 224}
                  y2={18 + f * 224}
                  stroke={GRID_LINE}
                  strokeWidth="1"
                />
              ))}
              <path
                d={mysteryChart.d}
                fill="none"
                stroke={ACCENT}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* price axis · the honest hint */}
              <text x="622" y="26" textAnchor="end" fontSize="12" fontFamily="monospace" fill={INK}>
                ${Math.round(mysteryChart.max).toLocaleString("en-US")}
              </text>
              <text x="622" y="252" textAnchor="end" fontSize="12" fontFamily="monospace" fill={INK}>
                ${Math.round(mysteryChart.min).toLocaleString("en-US")}
              </text>
              {/* redacted date axis */}
              {[80, 230, 380, 530].map((x) => (
                <text
                  key={x}
                  x={x}
                  y="252"
                  fontSize="11"
                  fontFamily="monospace"
                  fill={INK_MUTED}
                  opacity="0.7"
                >
                  ▓▓▓▓
                </text>
              ))}
              <text
                x="24"
                y="30"
                fontSize="10"
                fontFamily="monospace"
                fill={INK_MUTED}
                letterSpacing="3"
              >
                CLASSIFIED · 90 DAYS · TRUE TAPE
              </text>
            </svg>
          </div>

          {/* Stamped guesses */}
          {guesses.length > 0 && (
            <div
              className="mt-3 flex flex-col gap-1.5"
              role="status"
              aria-label="Guess results"
            >
              {guesses.map((g, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-1.5 ${
                    i === guesses.length - 1 && stamping ? "animate-pulse" : ""
                  }`}
                  style={{ borderColor: GRID_LINE, background: "#1C1A16" }}
                >
                  <span className="text-base leading-normal">{gridCell(g.res)}</span>
                  <span
                    className="font-mono t-xs tabular-nums"
                    style={{ color: INK }}
                  >
                    {fmtDay.format(g.utc)}
                  </span>
                  <span
                    className="ml-auto font-mono t-xs uppercase tracking-[0.14em]"
                    style={{ color: INK_MUTED }}
                  >
                    {bandHint(g.res)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Auto-zoom timeline */}
          <div className="mt-4">
            <div
              className="text-center font-mono text-lg sm:text-xl tabular-nums mb-2"
              style={{ color: INK }}
            >
              {fmtDay.format(selUtc)}
            </div>
            <input
              type="range"
              min={0}
              max={rangeDays}
              step={1}
              value={selDay}
              onChange={(e) => setSelDay(Number(e.target.value))}
              aria-label="Pick a date on the timeline"
              aria-valuetext={fmtDay.format(selUtc)}
              className="w-full accent-[var(--accent)] h-2 cursor-pointer"
            />
            <div
              className="mt-1 flex justify-between font-mono t-xs uppercase tracking-[0.14em]"
              style={{ color: INK_MUTED }}
            >
              <span>{fmtMonY.format(bounds.lo)}</span>
              {guesses.length > 0 && (
                <span style={{ color: ACCENT }}>
                  {rangeDays.toLocaleString("en-US")} days left
                </span>
              )}
              <span>{fmtMonY.format(bounds.hi)}</span>
            </div>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setSelDay((d) => Math.max(0, d - 1))}
                aria-label="One day earlier"
                className="min-h-[44px] px-4 py-2 rounded-lg border font-mono text-xs"
                style={{ borderColor: GRID_LINE, color: INK }}
              >
                −1d
              </button>
              <button
                type="button"
                onClick={onGuess}
                className="flex-1 max-w-xs px-6 py-3 rounded-lg font-mono text-sm uppercase tracking-[0.25em] font-semibold text-black transition-all hover:shadow-[0_0_24px_var(--accent-glow)]"
                style={{ background: ACCENT }}
              >
                Lock it in
              </button>
              <button
                type="button"
                onClick={() => setSelDay((d) => Math.min(rangeDays, d + 1))}
                aria-label="One day later"
                className="min-h-[44px] px-4 py-2 rounded-lg border font-mono text-xs"
                style={{ borderColor: GRID_LINE, color: INK }}
              >
                +1d
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DONE · reveal + share + countdown + stats ─────────────── */}
      {phase === "done" && result && (
        <div className="px-3 sm:px-5 pb-6">
          {/* Sats headline */}
          <div className="text-center mt-4">
            <div
              className="font-mono text-4xl sm:text-5xl font-bold tabular-nums"
              style={{ color: ACCENT }}
            >
              {result.sats.toLocaleString("en-US")}
              <span className="text-xl sm:text-2xl"> sats</span>
            </div>
            {/* leading-normal + real margin · emoji draw TALLER than
                their line box (especially iOS), so leading-none let the
                sats headline overlap the grid row (operator report
                2026-07-11). */}
            <div className="mt-2 text-xl leading-normal">
              {result.cells.map((c, i) => (
                <span key={i} className="mx-0.5">
                  {gridCell(c)}
                </span>
              ))}
            </div>
            {typeof result.rank === "number" && (
              <div
                className="micro-label mt-1"
                style={{ color: INK_MUTED }}
              >
                #{result.rank} on today&apos;s board
              </div>
            )}
          </div>

          {/* The unmasking */}
          <div className="mt-4 text-center">
            <div
              className="micro-label mb-1"
              style={{ color: INK_MUTED }}
            >
              The window was
            </div>
            <div className="font-mono text-base sm:text-lg tabular-nums" style={{ color: INK }}>
              {fmtDay.format(answerDate - 89 * DAY_MS)} → {fmtDay.format(answerDate)}
            </div>
            {eraLabelFor(answerDate, answerDate - 89 * DAY_MS) && (
              <div
                className="micro-label mt-1"
                style={{ color: ACCENT }}
              >
                {eraLabelFor(answerDate, answerDate - 89 * DAY_MS)}
              </div>
            )}
            {sinceLine && (
              <div className="mt-1 text-sm" style={{ color: INK_MUTED }}>
                {sinceLine}
              </div>
            )}
          </div>

          {/* Full-tape reveal · window in place, guess pins converging */}
          {revealChart && (
            <div className="relative mt-4 rounded-xl overflow-hidden border" style={{ borderColor: GRID_LINE }}>
              <svg
                viewBox="0 0 640 180"
                className="block w-full"
                role="img"
                aria-label="The full bitcoin tape with the mystery window and your guesses marked"
              >
                <rect width="640" height="180" fill="#0A0A0C" />
                <rect
                  x={revealChart.winX0}
                  y="0"
                  width={Math.max(3, revealChart.winX1 - revealChart.winX0)}
                  height="180"
                  fill={ACCENT}
                  opacity="0.12"
                />
                <path
                  d={revealChart.fullD}
                  fill="none"
                  stroke={INK_MUTED}
                  strokeWidth="1.2"
                  opacity="0.7"
                />
                <path
                  d={revealChart.winD}
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                {revealChart.pins.map((x, i) => (
                  <g key={i}>
                    <line x1={x} x2={x} y1="6" y2="20" stroke={INK} strokeWidth="1.5" opacity="0.85" />
                    <text
                      x={x}
                      y="32"
                      textAnchor="middle"
                      fontSize="10"
                      fontFamily="monospace"
                      fill={INK_MUTED}
                    >
                      {i + 1}
                    </text>
                  </g>
                ))}
                <line
                  x1={revealChart.answerX}
                  x2={revealChart.answerX}
                  y1="0"
                  y2="180"
                  stroke={ACCENT}
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
              </svg>
            </div>
          )}

          {/* Share · the whole point */}
          <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-2">
            <a
              href={xIntentUrl(withAttribution(shareText))}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto text-center px-6 py-3 rounded-lg font-mono text-sm uppercase tracking-[0.22em] font-semibold text-black transition-all hover:shadow-[0_0_24px_var(--accent-glow)]"
              style={{ background: ACCENT }}
            >
              Share on X →
            </a>
            <button
              type="button"
              onClick={onCopyNostr}
              className="w-full sm:w-auto px-6 py-3 rounded-lg border font-mono text-sm uppercase tracking-[0.22em]"
              style={{ borderColor: GRID_LINE, color: INK }}
            >
              {copiedNostr ? "Copied ✓" : "Copy for Nostr"}
            </button>
            <button
              type="button"
              onClick={onCopy}
              className="w-full sm:w-auto px-6 py-3 rounded-lg border font-mono text-sm uppercase tracking-[0.22em]"
              style={{ borderColor: GRID_LINE, color: INK }}
            >
              {copied ? "Copied ✓" : "Copy result"}
            </button>
          </div>

          {/* Countdown + streak · at 00:00:00 the next puzzle exists,
              so the clock becomes the door (a reload re-inits on the
              new day number). */}
          <div className="mt-5 text-center">
            {rolled ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="micro-label px-6 py-2.5 rounded-lg font-semibold text-black transition-all hover:shadow-[0_0_24px_var(--accent-glow)]"
                style={{ background: ACCENT }}
              >
                New WEN is live · play it →
              </button>
            ) : (
              <>
                <div
                  className="micro-label"
                  style={{ color: INK_MUTED }}
                >
                  Next WEN in
                </div>
                <div
                  className="font-mono text-2xl tabular-nums mt-0.5"
                  style={{ color: INK }}
                >
                  {countdown}
                </div>
              </>
            )}
            {stats.streak >= 2 && (
              <div
                className="micro-label mt-1"
                style={{ color: ACCENT }}
              >
                🔥 {stats.streak} day WEN streak
              </div>
            )}
          </div>

          {/* Stats panel · the Wordle compulsion */}
          {stats.played > 0 && (
            <div
              className="mt-5 mx-auto max-w-sm rounded-xl border p-4"
              style={{ borderColor: GRID_LINE, background: "#1C1A16" }}
            >
              <div
                className="font-mono t-xs uppercase tracking-[0.22em] mb-2 text-center"
                style={{ color: INK_MUTED }}
              >
                Your tape record
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["played", String(stats.played)],
                  ["avg sats", Math.round(stats.totalSats / stats.played).toLocaleString("en-US")],
                  ["best", stats.best.toLocaleString("en-US")],
                ].map(([label, v]) => (
                  <div key={label}>
                    <div className="font-mono text-lg tabular-nums" style={{ color: INK }}>
                      {v}
                    </div>
                    <div
                      className="font-mono t-xs uppercase tracking-[0.16em]"
                      style={{ color: INK_MUTED }}
                    >
                      {label}
                    </div>
                  </div>
                ))}
              </div>
              {/* score-band histogram */}
              <div className="mt-3 flex items-end gap-1 h-10" aria-hidden>
                {stats.bands.map((c, i) => {
                  const max = Math.max(1, ...stats.bands);
                  return (
                    <div key={i} className="flex-1 flex flex-col justify-end">
                      <div
                        className="rounded-sm"
                        style={{
                          height: `${Math.max(8, (c / max) * 100)}%`,
                          background: c > 0 ? ACCENT : GRID_LINE,
                          opacity: c > 0 ? 0.9 : 0.5,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div
                className="mt-1 flex justify-between font-mono t-xs uppercase tracking-[0.1em]"
                style={{ color: INK_MUTED }}
              >
                <span>0</span>
                <span>sats per day</span>
                <span>10k</span>
              </div>
            </div>
          )}

          {/* The funnel · scarcity over practice, siblings get the itch */}
          <div className="mt-5 text-center text-sm" style={{ color: INK_MUTED }}>
            One tape a day. Still got the itch? Today&apos;s tape is also
            running in{" "}
            <Link href="/runner" className="hover:underline" style={{ color: ACCENT }}>
              Node Runner
            </Link>{" "}
            and{" "}
            <Link href="/gauntlet" className="hover:underline" style={{ color: ACCENT }}>
              the Gauntlet
            </Link>
            .
          </div>
        </div>
      )}
    </div>
  );
}
