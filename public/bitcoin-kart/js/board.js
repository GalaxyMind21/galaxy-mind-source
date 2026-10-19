// BITCOIN KART · board.js
// Daily Circuit leaderboard client: culture-handle generator, the shared
// arcade integrity token (byte-for-byte replica of src/lib/arcade-token.ts,
// drift-guarded by scripts/test-bitcoin-kart.ts), score post with a single
// unsent-retry slot, and board fetch. Obfuscation, not security: same
// posture as the runner/horizon/saylor boards.

import { KART_BASE_MS } from "./data.js";
import { store } from "./save.js";

// every board fetch is bounded: a stalled mobile socket must never hold
// the results screen hostage (review finding 2026-07-14)
function netTimeout(ms) {
  try {
    if (AbortSignal && AbortSignal.timeout) return AbortSignal.timeout(ms);
  } catch { /* older engines */ }
  return undefined;
}

// ---- integrity token · replica of src/lib/arcade-token.ts ----
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

// ---- culture handle · "Adjective Noun #123" (server HANDLE_RE shape) ----
// exported for the drift-guard test: every combo must pass the API regex
export const HANDLE_ADJ = [
  "Orange", "Sovereign", "Laser", "Molten", "Drifting", "Stacked",
  "Volatile", "Immutable", "Turbo", "Golden", "Chained", "Halving",
];
export const HANDLE_NOUN = [
  "Racer", "Stacker", "Hodler", "Chair", "Node", "Pleb",
  "Kart", "Apex", "Maxi", "Miner", "Signal", "Drift",
];

export function getHandle() {
  const saved = store.get("handle", null);
  if (saved) return saved;
  let digits = "";
  do {
    digits = String(Math.floor(Math.random() * 900) + 100);
  } while (digits.includes("88")); // house rule, same as every cabinet
  const handle =
    HANDLE_ADJ[Math.floor(Math.random() * HANDLE_ADJ.length)] + " " +
    HANDLE_NOUN[Math.floor(Math.random() * HANDLE_NOUN.length)] + " #" + digits;
  store.set("handle", handle);
  return handle;
}

// ---- daily score post · score = KART_BASE_MS - finish ms ----
// Clamp to the server's honest envelope [1, KART_BASE - KART_FLOOR_MS].
// The floor is the PHYSICAL fastest finish, not a round number: it was
// 60s, which flattened every sub-minute run to one identical ceiling
// score. Because the board is ZADD GT that froze those players at a
// permanent 1:00.000 that no faster lap could ever improve, and lib/
// kart-ghost had already measured a real ~56s best with satoshi on FULL
// SEND. 40s matches KART_GHOST_MIN_MS so the board and the ghost routes
// cannot disagree about what a legal run is (fixed 2026-07-28).
export const KART_FLOOR_MS = 40000;
export const KART_SCORE_MAX = KART_BASE_MS - KART_FLOOR_MS;
export function dailyScore(timeMs) {
  return Math.max(1, Math.min(KART_SCORE_MAX, KART_BASE_MS - Math.round(timeMs)));
}

export async function postDailyScore(day, timeMs) {
  const name = getHandle();
  const score = dailyScore(timeMs);
  const payload = {
    game: "kart",
    score,
    day,
    name,
    token: scoreToken("kart", score, day, name),
  };
  try {
    const res = await fetch("/api/arcade/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: netTimeout(6000),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.ok) {
      store.set("unsent", null);
      return { ok: true, rank: out.rank ?? null };
    }
    // a 5xx/429 is worth retrying next boot; a 400 means the day rolled
    if (res.status >= 500 || res.status === 429) store.set("unsent", payload);
    return { ok: false };
  } catch {
    store.set("unsent", payload);
    return { ok: false };
  }
}

// one-slot retry: fire-and-forget on boot, ZADD GT makes it idempotent
export function retryUnsent() {
  const p = store.get("unsent", null);
  if (!p) return;
  fetch("/api/arcade/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  }).then((res) => {
    if (res.status !== 429 && res.status < 500) store.set("unsent", null);
  }).catch(() => { /* keep the slot for next time */ });
}

// viewer's optional X-link state · the session cookie is HttpOnly so a
// static page can't read it; this no-store probe is the only signal.
// enabled=false means the feature is unconfigured sitewide (hide any
// Link X affordance) · handle is "@name" when linked, else null.
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

export async function fetchLinkedHandle() {
  return (await fetchLinkState()).handle;
}

// Cross-device cloud save (X-linked players only · 2026-07-18). POSTs this
// device's kart save; the server best-of merges it into the stored one and
// returns the merged result, which the caller adopts. Bidirectional in one
// call. Returns null when disabled/anonymous/offline (stay local-only).
export async function cloudSyncKart(save) {
  try {
    const res = await fetch("/api/arcade/cloud", {
      method: "POST",
      cache: "no-store",
      signal: netTimeout(6000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game: "kart", save }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.ok && j.merged ? j.merged : null;
  } catch {
    return null;
  }
}

export async function fetchDailyBoard(day) {
  try {
    const res = await fetch("/api/arcade/scores?game=kart&day=" + day, { signal: netTimeout(6000) });
    if (!res.ok) return null;
    const out = await res.json();
    if (!Array.isArray(out.rows)) return null;
    return { rows: out.rows, total: typeof out.total === "number" ? out.total : out.rows.length };
  } catch {
    return null;
  }
}

// menu-board fetch cache (social board 2026-07-17): the menu re-renders
// after every race and settings change · a 25s TTL matches the API's CDN
// cache so menu hops never hammer the route
let boardCache = { day: 0, ts: 0, data: null };
export async function fetchDailyBoardCached(day) {
  if (boardCache.day === day && boardCache.data && Date.now() - boardCache.ts < 25_000) {
    return boardCache.data;
  }
  const data = await fetchDailyBoard(day);
  if (data) boardCache = { day, ts: Date.now(), data };
  return data;
}

// ---- world-leader ghost · upload when you take #1, download at start ----
// Both are best-effort cosmetics: a failure costs the glowing rival
// line, never the race or the score.
export async function uploadLeaderGhost(day, timeMs, frames) {
  if (!frames || frames.length < 10) return;
  const name = getHandle();
  const score = dailyScore(timeMs);
  try {
    await fetch("/api/arcade/kart-ghost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day, name, timeMs, frames, token: scoreToken("kart", score, day, name) }),
      signal: netTimeout(8000),
    });
  } catch { /* cosmetic · never blocks the results screen */ }
}

export async function fetchLeaderGhost(day) {
  try {
    const res = await fetch("/api/arcade/kart-ghost?day=" + day, { signal: netTimeout(5000) });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || j.ok !== true || !Array.isArray(j.frames) || typeof j.t !== "number") return null;
    // defensive shape check before anything reaches the renderer
    const frames = j.frames.filter(
      (f) => Array.isArray(f) && f.length === 4 && f.every((v) => typeof v === "number" && isFinite(v)),
    );
    if (frames.length < 10) return null;
    return { t: j.t, name: typeof j.name === "string" ? j.name.slice(0, 24) : "the leader", frames };
  } catch {
    return null;
  }
}

// ---- dare ghosts · "race my ghost" deep links (2026-07-16) ----
// Minted ONLY on share intent (never on a plain finish · KV volume stays
// proportional to sharing), fetched by the ?ghost=<id> boot path. The
// track index stands in for the token's day slot so track/time/name are
// all bound. Both best-effort: a failure degrades to a dare-less share.
export async function mintDareGhost(meta) {
  // meta: { trackId, trackIdx, klass, mirror, timeMs, frames }
  if (!meta || !meta.frames || meta.frames.length < 10) return null;
  const name = getHandle();
  const timeMs = Math.round(meta.timeMs);
  try {
    const res = await fetch("/api/arcade/kart-dare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trackId: meta.trackId,
        klass: meta.klass,
        mirror: !!meta.mirror,
        timeMs,
        name,
        frames: meta.frames,
        token: scoreToken("kart-dare", timeMs, meta.trackIdx, name),
      }),
      signal: netTimeout(8000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.ok === true && typeof j.id === "string" && /^[a-f0-9]{12}$/.test(j.id) ? j.id : null;
  } catch {
    return null;
  }
}

export async function fetchDareGhost(id) {
  try {
    const res = await fetch("/api/arcade/kart-dare?id=" + encodeURIComponent(id), { signal: netTimeout(6000) });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || j.ok !== true || !Array.isArray(j.frames) || typeof j.t !== "number") return null;
    if (typeof j.trackId !== "string" || typeof j.klass !== "string") return null;
    const frames = j.frames.filter(
      (f) => Array.isArray(f) && f.length === 4 && f.every((v) => typeof v === "number" && isFinite(v)),
    );
    if (frames.length < 10) return null;
    return {
      t: j.t,
      name: typeof j.name === "string" ? j.name.slice(0, 24) : "a rider",
      trackId: j.trackId,
      klass: j.klass,
      mirror: j.mirror === true,
      frames,
    };
  } catch {
    return null;
  }
}

export function formatKartTime(score) {
  const ms = KART_BASE_MS - score;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const d = Math.floor((ms % 1000) / 100);
  return m + ":" + String(s).padStart(2, "0") + "." + d;
}
