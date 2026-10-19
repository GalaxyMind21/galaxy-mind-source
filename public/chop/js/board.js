// CHOP · board.js
// Daily leaderboard client: culture handle, the shared arcade integrity
// token (byte-for-byte replica of src/lib/arcade-token.ts), score post
// with one unsent-retry slot, and board fetch.
//
// INTEGRITY POSTURE (documented, not implied): CHOP is NOT replay-
// verified. Scoring reads the geometry of a continuous touch stroke —
// entry point, exit point, axis, speed — which the server cannot
// re-derive from an action log the way it re-sims WEN/Gauntlet/Trail.
// So CHOP takes the Kart/Saylor posture: salt-token + hard server-side
// score bounds + ZADD-GT (a member's score can only ever improve).
// The salt ships in this file by design; its only job is to raise the
// bar past a one-line curl. Do not "upgrade" it to real crypto and do
// not break the client/server determinism.
//
// The board is DAILY-ONLY. The chart is generated from the live chain
// tip, so runs are only comparable inside one UTC day — an all-time
// board would rank runs against blocks with wildly different tx counts.

function netTimeout(ms) {
  try {
    if (AbortSignal && AbortSignal.timeout) return AbortSignal.timeout(ms);
  } catch { /* older engines */ }
  return undefined;
}

const SALT = "gm-arcade-v1-9f3c2a7e51";

export function scoreToken(game, score, day, name) {
  const msg = SALT + "|" + game + "|" + String(score) + "|" + (day ?? "") + "|" + name;
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < msg.length; i++) {
    h ^= msg.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let g = (0xdeadbeef ^ h) >>> 0;
  for (let i = msg.length - 1; i >= 0; i--) {
    g ^= msg.charCodeAt(i);
    g = Math.imul(g, 0x85ebca6b) >>> 0;
  }
  return ((h ^ g) >>> 0).toString(16).padStart(8, "0");
}

// UTC day number · MUST match src/lib/gauntlet-day.ts gauntletNumber
// byte-for-byte or every post is rejected as stale_day. Caught in
// integration probing: a raw Unix day number is off by the arcade epoch
// and the server rejected 100% of posts. Drift-guarded by
// scripts/test-chop-board.ts.
export const CHOP_EPOCH_DAY_ONE = Math.floor(Date.UTC(2026, 6, 8) / 86400000);
export function chopDay(now) {
  return Math.floor((now == null ? Date.now() : now) / 86400000)
    - CHOP_EPOCH_DAY_ONE + 1;
}

const LS = {
  get(k, d) {
    try { const v = localStorage.getItem("gm:chop:" + k); return v == null ? d : JSON.parse(v); }
    catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem("gm:chop:" + k, JSON.stringify(v)); } catch { /* private mode */ }
  },
};

const HANDLE_ADJ = [
  "Orange", "Sovereign", "Laser", "Molten", "Drifting", "Stacked",
  "Volatile", "Immutable", "Turbo", "Golden", "Chained", "Halving",
];
const HANDLE_NOUN = [
  "Slicer", "Stacker", "Hodler", "Blade", "Node", "Pleb",
  "Chopper", "Apex", "Maxi", "Miner", "Signal", "Mempool",
];

export function getHandle() {
  const saved = LS.get("handle", null);
  if (saved) return saved;
  let digits = "";
  do {
    digits = String(Math.floor(Math.random() * 900) + 100);
  } while (digits.includes("88")); // house rule, every cabinet
  const handle =
    HANDLE_ADJ[Math.floor(Math.random() * HANDLE_ADJ.length)] + " " +
    HANDLE_NOUN[Math.floor(Math.random() * HANDLE_NOUN.length)] + " #" + digits;
  LS.set("handle", handle);
  return handle;
}

/**
 * Post a finished block's sats to today's board. Fire-and-forget with a
 * single retry slot: a failed post parks in localStorage and the NEXT
 * successful run flushes it, so a subway-tunnel finish is not lost.
 * Never throws, never blocks the ceremony.
 */
export async function postScore(sats) {
  const score = Math.max(0, Math.floor(sats));
  if (!score) return { ok: false };
  const day = chopDay();
  const name = getHandle();
  // flush a parked post first (yesterday's parked score is dropped by the
  // server's day-freshness check, which is correct — it is a stale run)
  const parked = LS.get("unsent", null);
  if (parked && parked.day === day) {
    LS.set("unsent", null);
    send(parked.score, parked.day, parked.name);
  }
  const res = await send(score, day, name);
  if (!res.ok) LS.set("unsent", { score, day, name });
  return res;
}

async function send(score, day, name) {
  try {
    const r = await fetch("/api/arcade/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        game: "chop", score, day, name,
        token: scoreToken("chop", score, day, name),
      }),
      signal: netTimeout(6000),
    });
    if (!r.ok) return { ok: false };
    const j = await r.json();
    return { ok: !!j.ok, rank: j.rank ?? null };
  } catch {
    return { ok: false };
  }
}

/** Today's top rows. Returns [] on any failure — the card degrades quietly. */
export async function fetchBoard() {
  try {
    const r = await fetch("/api/arcade/scores?game=chop&day=" + chopDay(), {
      signal: netTimeout(6000),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.rows) ? j.rows : [];
  } catch {
    return [];
  }
}

// viewer's optional X-link state · the session cookie is HttpOnly so a
// static page can't read it; this no-store probe is the only signal.
export async function fetchLinkState() {
  try {
    const res = await fetch("/api/auth/x/me", { cache: "no-store", signal: netTimeout(4000) });
    if (!res.ok) return { enabled: false, handle: null };
    const j = await res.json();
    return {
      enabled: !!(j && j.enabled),
      handle: j && j.linked && typeof j.handle === "string" ? "@" + j.handle : null,
    };
  } catch {
    return { enabled: false, handle: null };
  }
}

// Durable cloud payload only: all-time best + run count. Never
// gm:chop:res:{day}, unsent, handle, difficulty, or latency.
export function readChopCloudSave() {
  const best = Math.max(0, Number(LS.get("best", 0)) || 0);
  const played = Math.max(0, Number(LS.get("runs", 0)) || 0);
  return { best: best > 0 ? best : null, stats: { played, best } };
}

// Adopt the server's merge by per-key MAX against CURRENT local, never
// a wholesale replace (in-flight-clobber-safe). Returns true if LS changed.
export function applyChopCloud(merged) {
  if (!merged || typeof merged !== "object") return false;
  const st = merged.stats || {};
  const cloudBest = Math.max(
    0,
    typeof merged.best === "number" && Number.isFinite(merged.best) ? merged.best : 0,
    typeof st.best === "number" && Number.isFinite(st.best) ? st.best : 0,
  );
  const cloudPlayed = Math.max(
    0,
    typeof st.played === "number" && Number.isFinite(st.played) ? st.played : 0,
  );
  const localBest = Math.max(0, Number(LS.get("best", 0)) || 0);
  const localPlayed = Math.max(0, Number(LS.get("runs", 0)) || 0);
  const nextBest = Math.max(localBest, cloudBest);
  const nextPlayed = Math.max(localPlayed, cloudPlayed);
  if (nextBest === localBest && nextPlayed === localPlayed) return false;
  if (nextBest > localBest) LS.set("best", nextBest);
  if (nextPlayed > localPlayed) LS.set("runs", nextPlayed);
  return true;
}

// Cross-device cloud save (X-linked players only). POSTs this device's
// durable chop save; the server best-of merges it and returns the result
// the caller adopts. Returns null when disabled/anonymous/offline.
export async function cloudSyncChop(save) {
  try {
    const res = await fetch("/api/arcade/cloud", {
      method: "POST",
      cache: "no-store",
      signal: netTimeout(6000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game: "chop", save }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.ok && j.merged ? j.merged : null;
  } catch {
    return null;
  }
}
