// Cross-device cloud save for X-linked arcade players (2026-07-18).
//
// The problem: game progress lives in per-device localStorage, so a player
// who links their X account on two devices still sees a blank slate on the
// second one. This layer syncs the SAVE (not the leaderboard) to KV keyed
// by the immutable X user id the session already proves, so progress
// follows the login.
//
// Design contract (mirrors arcade-identity.ts):
//   · OPTIONAL + additive. Unlinked / KV-unset / X-unconfigured players are
//     byte-identical to today (local-only). Nothing here gates play.
//   · Merge is BEST-OF and authoritative on the server: the client POSTs
//     its local save, the server merges it into the stored one and returns
//     the merged result, which the client adopts. So a device that is
//     behind can only GAIN progress — no sync ever wipes a device that is
//     ahead. One call is bidirectional (upload local's unique progress +
//     download the cloud's).
//   · Only durable RECORDS/UNLOCKS/COMPLETIONS sync. Never: date-specific
//     day state (would falsely lock/unlock a puzzle), outbox/retry buffers
//     (would replay stale board posts), device settings, or large
//     replay/ghost frame lists (regenerable from the synced PB).
//   · Personal data footprint: game completion tied to the X id. The
//     unlink flow deletes the whole hash (the deletion story), same as the
//     X profile hash.
//
// KV shape: ONE hash per user, gm:cloud:save:{userId}, field per game.

/** One KV hash per linked player · field = game key, value = that game's synced save. */
export const cloudKey = (userId: string) => `gm:cloud:save:${userId}`;

// ---------------------------------------------------------------------------
// merge primitives · every rule is best-of so a stale device never wins
// ---------------------------------------------------------------------------

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

/** like num() but preserves fractions · for metrics that aren't integers
 *  (the Gauntlet's alpha is percentage points and can be NEGATIVE). */
const numF = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
};

/** max of two same-key numeric fields, each clamped, absent -> 0. */
const maxField = (a: any, b: any, key: string, lo: number, hi: number): number =>
  Math.max(num(a && a[key], lo, hi) ?? 0, num(b && b[key], lo, hi) ?? 0);

/** boolean OR · once true, stays true (an unlock is permanent). */
const orBool = (a: unknown, b: unknown): boolean => a === true || b === true;

/** map id -> number, keep the MAX per key (balloons, per-key records). */
function perKeyMax(a: Record<string, number>, b: Record<string, number>, lo: number, hi: number, cap: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const src of [a, b]) {
    if (!src || typeof src !== "object") continue;
    for (const k of Object.keys(src)) {
      if (out[k] === undefined && Object.keys(out).length >= cap) continue; // bloat guard
      const v = num(src[k], lo, hi);
      if (v === null) continue;
      out[k] = out[k] === undefined ? v : Math.max(out[k], v);
    }
  }
  return out;
}

/** map id -> number, keep the MIN per key (lower is better: cup rank, ms). */
function perKeyMin(a: Record<string, number>, b: Record<string, number>, lo: number, hi: number, cap: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const src of [a, b]) {
    if (!src || typeof src !== "object") continue;
    for (const k of Object.keys(src)) {
      if (out[k] === undefined && Object.keys(out).length >= cap) continue;
      const v = num(src[k], lo, hi);
      if (v === null) continue;
      out[k] = out[k] === undefined ? v : Math.min(out[k], v);
    }
  }
  return out;
}

/** map id -> true (bossBeaten, challenges): union of the true keys. */
function perKeyOr(a: Record<string, unknown>, b: Record<string, unknown>, cap: number): Record<string, true> {
  const out: Record<string, true> = {};
  for (const src of [a, b]) {
    if (!src || typeof src !== "object") continue;
    for (const k of Object.keys(src)) {
      if (src[k] === true && (out[k] || Object.keys(out).length < cap)) out[k] = true;
    }
  }
  return out;
}

/** array of ids (codex): de-duped union, capped, order-stable. */
function unionArr(a: unknown, b: unknown, cap: number): (number | string)[] {
  const seen = new Set<number | string>();
  const out: (number | string)[] = [];
  for (const src of [a, b]) {
    if (!Array.isArray(src)) continue;
    for (const v of src) {
      if ((typeof v === "number" || typeof v === "string") && !seen.has(v) && out.length < cap) {
        seen.add(v);
        out.push(v);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// per-game merge registry · each entry validates + merges one game's save
// ---------------------------------------------------------------------------

export type CloudMerge = (stored: any, incoming: any) => any;

const KART: CloudMerge = (stored, incoming) => {
  const sp = (stored && stored.progress) || {};
  const ip = (incoming && incoming.progress) || {};
  return {
    progress: {
      // per-track balloons 0..3 · union of best (the Satoshi/Golden gates read totalBalloons)
      balloons: perKeyMax(sp.balloons || {}, ip.balloons || {}, 0, 3, 40),
      bossBeaten: perKeyOr(sp.bossBeaten || {}, ip.bossBeaten || {}, 20),
      beatSchiff: orBool(sp.beatSchiff, ip.beatSchiff),
      satoshiUnlocked: orBool(sp.satoshiUnlocked, ip.satoshiUnlocked),
      goldenSatoshi: orBool(sp.goldenSatoshi, ip.goldenSatoshi),
      genesisRun: orBool(sp.genesisRun, ip.genesisRun),
      // cup trophy rank 1..3 · LOWER is better (1 = gold), so per-key MIN
      cups: perKeyMin(sp.cups || {}, ip.cups || {}, 1, 3, 20),
      challenges: perKeyOr(sp.challenges || {}, ip.challenges || {}, 20),
      // first-visit story beats · OR-union so a watched chapter never
      // re-fires after cloud adopt (cap keeps KV payloads bounded)
      storySeen: perKeyOr(sp.storySeen || {}, ip.storySeen || {}, 80),
      codex: unionArr(sp.codex, ip.codex, 40),
    },
    // per-track time-trial PB in ms · faster (lower) wins
    pbs: perKeyMin((stored && stored.pbs) || {}, (incoming && incoming.pbs) || {}, 1, 3_600_000, 40),
  };
};

// Day-continuity streak merge, reused by the shared cross-cabinet streak AND
// by the per-game streak pairs inside WEN ({streak, lastDay}) and the
// Gauntlet ({n, last}). A naive max(len) over-credits when the two devices
// last played different days. Take the more RECENT last; when the two lasts
// are exactly one apart, the older chain continues into the newer (len + 1);
// a tie keeps the longer len; a real gap keeps the newer device's streak.
// (`len` also tolerates the `n` field name the Gauntlet uses natively.)
type Streak = { last: number; len: number };
function cleanStreak(s: any): Streak | null {
  const last = num(s && s.last, 0, 10_000_000);
  const len = num(s && (s.len ?? s.n), 0, 100_000);
  return last === null || len === null ? null : { last, len };
}
function mergeStreak(a: Streak | null, b: Streak | null): Streak | undefined {
  if (!a) return b || undefined;
  if (!b) return a;
  const [older, newer] = a.last <= b.last ? [a, b] : [b, a];
  if (newer.last === older.last) return { last: newer.last, len: Math.max(a.len, b.len) };
  if (newer.last === older.last + 1) return { last: newer.last, len: Math.max(newer.len, older.len + 1) };
  return newer;
}
// Shared cross-cabinet streak {last: utcDay, len}. (The client still clamps
// display to today/yesterday.)
const STREAK: CloudMerge = (stored, incoming) => mergeStreak(cleanStreak(stored), cleanStreak(incoming));

// SUPER SAYLOR · 21-level campaign. maxLevel MAX, codex union, best keeps the
// higher-score run, lifetime stats are per-field MAX (they're monotonic
// counters — summing across devices double-counts shared runs), wizardMet is a
// sticky-OR unlock (the secret hero). Day-state (summit), the board outbox,
// device settings, and the local board are deliberately NOT synced.
function sanitizeSaylorBest(e: any): any | null {
  if (!e || typeof e !== "object") return null;
  const score = num(e.score, 0, 100_000_000);
  if (score === null) return null;
  const str = (v: any, cap: number) => (typeof v === "string" ? v.slice(0, cap) : "");
  return {
    handle: str(e.handle, 40), score,
    sats: num(e.sats, 0, 1e12) ?? 0, bears: num(e.bears, 0, 1e9) ?? 0,
    levels: num(e.levels, 0, 21) ?? 0, rules: num(e.rules, 0, 21) ?? 0,
    grade: str(e.grade, 8), at: num(e.at, 0, 1e15) ?? 0,
  };
}
const SAYLOR: CloudMerge = (stored, incoming) => {
  const s = stored || {}, i = incoming || {};
  const sa = sanitizeSaylorBest(s.best), ib = sanitizeSaylorBest(i.best);
  const best = !sa ? ib : !ib ? sa : (ib.score > sa.score ? ib : sa);
  return {
    progress: { maxLevel: Math.max(num((s.progress || {}).maxLevel, 1, 21) ?? 1, num((i.progress || {}).maxLevel, 1, 21) ?? 1) },
    codex: unionArr(s.codex, i.codex, 30),
    best,
    stats: {
      sats: maxField(s.stats, i.stats, "sats", 0, 1e12),
      bears: maxField(s.stats, i.stats, "bears", 0, 1e9),
      runs: maxField(s.stats, i.stats, "runs", 0, 1e7),
      deaths: maxField(s.stats, i.stats, "deaths", 0, 1e7),
    },
    wizardMet: orBool(s.wizardMet, i.wizardMet),
  };
};

// WEN · daily chart-dating puzzle. best is sats MAX (cap 10k), the lifetime
// counters are per-field MAX (no cross-device per-day idempotency, so max
// never inflates), bands[5] is a per-bucket MAX histogram, and the
// {streak,lastDay} pair rides the day-continuity merge (never a naive max).
// The synced `best` is kept identical to stats.best so the client's two
// stores (gm:wen:best + stats.best) stay consistent.
const WEN: CloudMerge = (stored, incoming) => {
  const s = stored || {}, i = incoming || {};
  const ss = s.stats || {}, is = i.stats || {};
  const st = mergeStreak(
    cleanStreak({ last: ss.lastDay, len: ss.streak }),
    cleanStreak({ last: is.lastDay, len: is.streak }),
  ) || { last: 0, len: 0 };
  const bands: number[] = [];
  for (let k = 0; k < 5; k++) {
    bands.push(Math.max(num((ss.bands || [])[k], 0, 1e9) ?? 0, num((is.bands || [])[k], 0, 1e9) ?? 0));
  }
  const best = Math.max(
    num(s.best, 0, 10_000) ?? 0, num(i.best, 0, 10_000) ?? 0,
    num(ss.best, 0, 10_000) ?? 0, num(is.best, 0, 10_000) ?? 0,
  );
  return {
    best,
    stats: {
      played: maxField(ss, is, "played", 0, 1e7),
      totalSats: maxField(ss, is, "totalSats", 0, 1e12),
      best,
      bullseyes: maxField(ss, is, "bullseyes", 0, 1e7),
      streak: st.len,
      lastDay: st.last,
      bands,
    },
  };
};

// THE HODL TRAIL · daily expedition. Same posture as WEN: best is sats MAX
// (cap 2.1M), lifetime counters are per-field MAX (no cross-device per-day
// idempotency, so max never inflates), and the {streak,lastDay} pair rides
// the day-continuity merge. Today's run state / unsent outbox are NOT synced
// (day-state, per the durable-only contract).
const TRAIL: CloudMerge = (stored, incoming) => {
  const s = stored || {}, i = incoming || {};
  const ss = s.stats || {}, is = i.stats || {};
  const st = mergeStreak(
    cleanStreak({ last: ss.lastDay, len: ss.streak }),
    cleanStreak({ last: is.lastDay, len: is.streak }),
  ) || { last: 0, len: 0 };
  const best = Math.max(
    num(s.best, 0, 2_100_000) ?? 0, num(i.best, 0, 2_100_000) ?? 0,
    num(ss.best, 0, 2_100_000) ?? 0, num(is.best, 0, 2_100_000) ?? 0,
  );
  return {
    best,
    stats: {
      played: maxField(ss, is, "played", 0, 1e7),
      totalSats: maxField(ss, is, "totalSats", 0, 1e12),
      best,
      citadels: maxField(ss, is, "citadels", 0, 1e7),
      plebsLost: maxField(ss, is, "plebsLost", 0, 1e8),
      streak: st.len,
      lastDay: st.last,
    },
  };
};

// THE GAUNTLET · daily trading roguelike. best is alpha (percentage points vs
// the DCA bot) — higher wins, but it can be NEGATIVE so bounds allow it and it
// stays null until a run exists. badges are a de-duped union; the {n,last}
// streak pair rides the day-continuity merge. Today's stamped result (with its
// replay proof) and the display log are NOT synced.
const GAUNTLET: CloudMerge = (stored, incoming) => {
  const s = stored || {}, i = incoming || {};
  const ba = numF(s.best, -1000, 1000), bb = numF(i.best, -1000, 1000);
  const best = ba === null ? bb : bb === null ? ba : Math.max(ba, bb);
  const st = mergeStreak(cleanStreak(s.streak), cleanStreak(i.streak)) || { last: 0, len: 0 };
  return { best, badges: unionArr(s.badges, i.badges, 40), streak: st };
};

// NODE RUNNER · endless runner. One record {days, sats}: days is primary
// (distance survived), sats the tiebreak, both higher-better. The board outbox
// is NOT synced.
function cleanRunner(b: any): { days: number; sats: number } | null {
  if (!b || typeof b !== "object") return null;
  const days = num(b.days, 0, 1e7), sats = num(b.sats, 0, 1e12);
  if (days === null && sats === null) return null;
  return { days: days ?? 0, sats: sats ?? 0 };
}
const RUNNER: CloudMerge = (stored, incoming) => {
  const a = cleanRunner((stored || {}).best), b = cleanRunner((incoming || {}).best);
  const best = !a ? b : !b ? a : (b.days !== a.days ? (b.days > a.days ? b : a) : (b.sats > a.sats ? b : a));
  return { best: best || null };
};

// HORIZON · scarcity arena. One record {s, h}: sats is the ordering key
// (higher-better), height rides along with the winning record for display.
function cleanHorizon(b: any): { s: number; h: number } | null {
  if (!b || typeof b !== "object") return null;
  const s = num(b.s, 0, 1e12), h = num(b.h, 0, 1e9);
  if (s === null && h === null) return null;
  return { s: s ?? 0, h: h ?? 0 };
}
const HORIZON: CloudMerge = (stored, incoming) => {
  const a = cleanHorizon((stored || {}).best), b = cleanHorizon((incoming || {}).best);
  const best = !a ? b : !b ? a : (b.s !== a.s ? (b.s > a.s ? b : a) : (b.h > a.h ? b : a));
  return { best: best || null };
};

// CHOP · live-block slicer. best is all-time sats MAX (cap matches the
// board envelope CHOP_MAX), lifetime played is per-field MAX (no
// cross-device per-run idempotency, so summing would double-count).
// Today's gm:chop:res:{day}, unsent posts, difficulty, latency, and
// the culture handle are NOT synced.
const CHOP_BEST_CAP = 12_000_000;
const CHOP: CloudMerge = (stored, incoming) => {
  const s = stored || {}, i = incoming || {};
  const ss = s.stats || {}, is = i.stats || {};
  const best = Math.max(
    num(s.best, 0, CHOP_BEST_CAP) ?? 0, num(i.best, 0, CHOP_BEST_CAP) ?? 0,
    num(ss.best, 0, CHOP_BEST_CAP) ?? 0, num(is.best, 0, CHOP_BEST_CAP) ?? 0,
  );
  return {
    best: best > 0 ? best : null,
    stats: {
      played: maxField(ss, is, "played", 0, 1e7),
      best,
    },
  };
};

export const CLOUD_MERGES: Record<string, CloudMerge> = {
  kart: KART,
  streak: STREAK,
  saylor: SAYLOR,
  wen: WEN,
  trail: TRAIL,
  gauntlet: GAUNTLET,
  runner: RUNNER,
  horizon: HORIZON,
  chop: CHOP,
};

export function isCloudGame(game: string): boolean {
  return Object.prototype.hasOwnProperty.call(CLOUD_MERGES, game);
}

// A "trivial" save carries no real progress — e.g. a fresh device's boot
// PULL, whose save is just empty defaults. The endpoint treats those as
// pull-only (never writes them). This matters because kvHMGet returns null
// for BOTH an absent field AND a transient read failure, so writing an
// empty merge on a read blip could wipe a rich cloud save. A trivial POST
// has nothing to contribute, so skipping its write is always safe.
const anyKeys = (m: unknown) => !!m && typeof m === "object" && Object.keys(m as object).length > 0;
const posNum = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
const CLOUD_TRIVIAL: Record<string, (s: any) => boolean> = {
  kart: (s) => {
    const p = (s && s.progress) || {};
    return !(anyKeys(p.balloons) || anyKeys(p.bossBeaten) || anyKeys(p.cups) || anyKeys(p.challenges) ||
      (Array.isArray(p.codex) && p.codex.length > 0) || p.beatSchiff || p.satoshiUnlocked ||
      p.goldenSatoshi || p.genesisRun || anyKeys(s && s.pbs));
  },
  streak: (s) => !(s && typeof s.len === "number" && s.len > 0),
  saylor: (s) => {
    const p = (s && s.progress) || {}, st = (s && s.stats) || {};
    return !(posNum(p.maxLevel) && p.maxLevel > 1) &&
      !(Array.isArray(s && s.codex) && s.codex.length > 0) &&
      !(s && s.best) && !(s && s.wizardMet) &&
      !(posNum(st.sats) || posNum(st.bears) || posNum(st.runs) || posNum(st.deaths));
  },
  wen: (s) => {
    const st = (s && s.stats) || {};
    return !posNum(s && s.best) && !posNum(st.best) && !posNum(st.played);
  },
  trail: (s) => {
    const st = (s && s.stats) || {};
    return !posNum(s && s.best) && !posNum(st.best) && !posNum(st.played);
  },
  gauntlet: (s) => {
    // best can be negative yet real, so "has a run" = best is any finite number
    const hasRun = typeof (s && s.best) === "number" && Number.isFinite(s.best);
    const badges = Array.isArray(s && s.badges) && s.badges.length > 0;
    const streak = s && s.streak && posNum(s.streak.len ?? s.streak.n);
    return !hasRun && !badges && !streak;
  },
  runner: (s) => {
    const b = (s && s.best) || null;
    return !(b && (posNum(b.days) || posNum(b.sats)));
  },
  horizon: (s) => {
    const b = (s && s.best) || null;
    return !(b && posNum(b.s));
  },
  chop: (s) => {
    const st = (s && s.stats) || {};
    return !posNum(s && s.best) && !posNum(st.best) && !posNum(st.played);
  },
};
export function isTrivialSave(game: string, save: unknown): boolean {
  const fn = CLOUD_TRIVIAL[game];
  return fn ? fn(save) : false;
}

/** Merge an incoming client save into the stored one (best-of). Returns the
 *  merged value the client should adopt, or null if the game is unknown. */
export function mergeCloudSave(game: string, stored: unknown, incoming: unknown): unknown {
  const fn = CLOUD_MERGES[game];
  if (!fn) return null;
  return fn(stored ?? null, incoming ?? null);
}
