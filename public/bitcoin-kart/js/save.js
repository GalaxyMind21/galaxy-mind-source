// BITCOIN KART · save.js
// localStorage persistence under gm:bitcoin-kart:* plus the SHARED
// cross-cabinet arcade streak (gm:arcade:streak + gm:arcade-finished event),
// mirroring src/lib/arcade-streak.ts like the other cabinets do.

import { NS, SETTINGS_DEFAULTS } from "./data.js";

export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
    } catch {
      // private mode: play on without saving
    }
  },
};

export const SAVE = {
  settings: null,
  progress: null,
  pbs: null,

  load() {
    this.settings = { ...SETTINGS_DEFAULTS, ...store.get("settings", {}) };
    this.progress = {
      balloons: {},      // eventId -> best balloons earned (0..3 · third is the full-sat-stack challenge win)
      bossBeaten: {},    // bossId -> true
      beatSchiff: false,
      codex: [],         // codex rule ids recovered
      satoshiUnlocked: false,
      goldenSatoshi: false, // 100%: every balloon + every level cleared
      cups: {},          // cupId -> best trophy rank (1..3)
      challenges: {},    // challengeId -> true (see data.js CHALLENGES)
      // first-visit story beats (cold open, boss entrances, unlock reels)
      // · OR-merged across cloud so a seen chapter never re-fires
      storySeen: {},     // beatId -> true
      ...store.get("progress", {}),
    };
    // older saves may lack storySeen; keep it a plain object always
    if (!this.progress.storySeen || typeof this.progress.storySeen !== "object") {
      this.progress.storySeen = {};
    }
    this.pbs = store.get("pbs", {}); // trackId -> ms
  },

  persistSettings() { store.set("settings", this.settings); },
  persistProgress() { store.set("progress", this.progress); },
  persistPbs() { store.set("pbs", this.pbs); },

  totalBalloons() {
    let n = 0;
    for (const id in this.progress.balloons) n += this.progress.balloons[id];
    return n;
  },

  // Adopt the server's cloud merge (cross-device sync · 2026-07-18) by
  // re-applying best-of PER KEY against CURRENT local, never a wholesale
  // replace. The server merged against the snapshot we POSTed; anything the
  // player earned during the round-trip is still in local, and per-key
  // max/min/OR guarantees this can only RAISE a value, never downgrade one
  // (the in-flight-clobber fix · review 2026-07-18). Returns true if
  // anything changed (the caller re-renders + re-checks the Golden unlock).
  applyCloud(merged) {
    if (!merged || typeof merged !== "object") return false;
    const before = JSON.stringify([this.progress, this.pbs]);
    const mp = merged.progress || {};
    const p = this.progress;
    const maxMap = (dst, src) => { for (const k in src || {}) dst[k] = Math.max(dst[k] || 0, src[k] || 0); };
    const minMap = (dst, src) => { for (const k in src || {}) dst[k] = dst[k] === undefined ? src[k] : Math.min(dst[k], src[k]); };
    const orMap = (dst, src) => { for (const k in src || {}) if (src[k]) dst[k] = true; };
    maxMap(p.balloons, mp.balloons);   // per-track balloons: higher wins
    orMap(p.bossBeaten, mp.bossBeaten);
    orMap(p.challenges, mp.challenges);
    if (!p.storySeen || typeof p.storySeen !== "object") p.storySeen = {};
    orMap(p.storySeen, mp.storySeen);  // story beats: once seen, stay seen
    minMap(p.cups, mp.cups);           // cup rank: lower (gold=1) wins
    p.beatSchiff = p.beatSchiff || !!mp.beatSchiff;
    p.satoshiUnlocked = p.satoshiUnlocked || !!mp.satoshiUnlocked;
    p.goldenSatoshi = p.goldenSatoshi || !!mp.goldenSatoshi;
    p.genesisRun = p.genesisRun || !!mp.genesisRun;
    if (Array.isArray(mp.codex)) for (const id of mp.codex) if (!p.codex.includes(id)) p.codex.push(id);
    minMap(this.pbs, merged.pbs);      // time-trial PB: faster (lower) wins
    if (JSON.stringify([this.progress, this.pbs]) === before) return false;
    this.persistProgress();
    this.persistPbs();
    return true;
  },
};

// ghost storage: positions sampled at 10 Hz, rounded to dm precision
// (exported · the leader-ghost upload quantizes with the same rule)
export function quantizeGhost(frames) {
  return frames.map((f) => [
    Math.round(f[0] * 10) / 10, Math.round(f[1] * 10) / 10,
    Math.round(f[2] * 10) / 10, Math.round(f[3] * 100) / 100,
  ]);
}

export function saveGhost(trackId, frames) {
  store.set("ghost:" + trackId, quantizeGhost(frames));
}

export function loadGhost(trackId) {
  return store.get("ghost:" + trackId, null);
}

// Daily Circuit ghost: ONE self-replacing slot ({day, frames}) so old
// days never accumulate in localStorage · yesterday's ghost is useless
// on today's combo anyway
export function saveDailyGhost(day, frames) {
  store.set("ghost:daily", { day, frames: quantizeGhost(frames) });
}

export function loadDailyGhost(day) {
  const g = store.get("ghost:daily", null);
  return g && g.day === day && Array.isArray(g.frames) && g.frames.length ? g.frames : null;
}

// ---- shared arcade streak (cross-cabinet contract) ----
const ARCADE_STREAK_KEY = "gm:arcade:streak";

export function recordArcadeRun() {
  try {
    const day = Math.floor(Date.now() / 86400000);
    const raw = localStorage.getItem(ARCADE_STREAK_KEY);
    let s = raw ? JSON.parse(raw) : { last: 0, len: 0 };
    if (s.last === day) {
      // already counted today
    } else if (s.last === day - 1) {
      s = { last: day, len: s.len + 1 };
    } else {
      s = { last: day, len: 1 };
    }
    localStorage.setItem(ARCADE_STREAK_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: streak silently skipped
  }
  try {
    window.dispatchEvent(new CustomEvent("gm:arcade-finished"));
  } catch {
    // non-browser context
  }
}
