// Per-run share card transport for BITCOIN KART (2026-07-14).
//
// A finished race encodes into ONE url-safe path segment that rides in
// the share link (/bitcoin-kart/card/<seg>). The ENCODER is duplicated:
// the game is a static no-build directory (public/bitcoin-kart/), so it
// cannot import this module · `cardSeg()` in public/bitcoin-kart/js/main.js
// is a byte-for-byte mirror of encodeKartCard() below, drift-guarded by
// scripts/test-bitcoin-kart.ts (it evals the client function from source
// and compares outputs). Change the field set or key letters in BOTH
// places or the test fails.
//
// The segment is attacker-reachable, so the page/OG must never trust a
// raw value: numbers are clamped, and the track/driver/class strings are
// only accepted when they match the hardcoded allow-lists below · display
// names come from OUR maps, never from the URL, so the card can't become
// an arbitrary-text billboard. Same posture as lib/run-card.ts.

// ── Allow-lists · mirror public/bitcoin-kart/js/data.js exactly ──
// (TRACKS ids/names, ROSTER ids/displayNames, CLASSES names · all
// drift-guarded by scripts/test-bitcoin-kart.ts.)

export const KART_TRACK_IDS = [
  "pizza-beach",
  "genesis-circuit",
  "gox-docks",
  "winter-2014",
  "blocksize-fog",
  "euphoria-neon",
  "printer-runway",
  "obituary-alley",
  "glass-tower-loop",
  "etf-dawn",
  "one-chair-peak",
  "schiff-gold-mine",
] as const;

export const KART_TRACK_NAMES: Record<string, string> = {
  "pizza-beach": "Pizza Beach",
  "genesis-circuit": "Genesis Circuit",
  "gox-docks": "Gox Docks",
  "winter-2014": "Winter of 2014",
  "blocksize-fog": "Blocksize Fog",
  "euphoria-neon": "Euphoria Neon",
  "printer-runway": "Printer Runway",
  "obituary-alley": "Obituary Alley",
  "glass-tower-loop": "Glass Tower Loop",
  "etf-dawn": "ETF Dawn Speedway",
  "one-chair-peak": "One Chair Peak",
  "schiff-gold-mine": "Schiff's Gold Mine",
};

export const KART_DRIVER_IDS = [
  "saylor",
  "phong",
  "wizard",
  "mallers",
  "bukele",
  "satoshi",
  "schiff",
  "dimon",
  "warren",
  "buffett",
  "cuban",
] as const;

export const KART_DRIVER_NAMES: Record<string, string> = {
  saylor: "Michael Saylor",
  phong: "Phong Le",
  wizard: "The Bitcoin Wizard",
  mallers: "Jack Mallers",
  bukele: "Nayib Bukele",
  satoshi: "Satoshi Nakamoto",
  schiff: "Peter Schiff",
  dimon: "Jamie Dimon",
  warren: "Elizabeth Warren",
  buffett: "Warren Buffett",
  cuban: "Mark Cuban",
};

export const KART_CLASS_LABELS = {
  sats: "SATS",
  bits: "BITS",
  fullsend: "FULL SEND",
} as const;

export type KartClass = keyof typeof KART_CLASS_LABELS;

// KART_BASE_MS in the game · a run can never legitimately exceed the
// ten-minute daily envelope, so the card clamps to it too.
export const KART_TIME_MAX_MS = 600_000;

export type KartCard = {
  trackId: string; // member of KART_TRACK_IDS
  driverId: string; // member of KART_DRIVER_IDS
  timeMs: number; // 1..KART_TIME_MAX_MS
  day: number | null; // Daily Circuit number · null = not a daily run
  rank: number | null; // finishing position 1..8 · null = unreported
  klass: KartClass | null; // engine class · null = unreported
  mirror: boolean;
  // dare ghost id (2026-07-16) · when present the card page's CTA boots
  // /bitcoin-kart?ghost=<id> into a race against the sharer's line
  ghostId?: string | null;
};

// hex only, bounded · the segment is attacker-reachable and this value
// lands in a link href, so nothing outside the shape ever rides along
const GHOST_ID_RE = /^[a-f0-9]{8,16}$/;

const DELIM = "~"; // url-unreserved, absent from every field value below

function clampInt(
  n: number | string,
  lo: number,
  hi: number,
  fallback = lo,
): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Build the single (already percent-encoded) path segment.
 * Field order t/d/m then n/r/c/x is the wire contract · the client
 * mirror in main.js emits the exact same bytes.
 */
export function encodeKartCard(c: KartCard): string {
  const parts = [
    "t" + c.trackId,
    "d" + c.driverId,
    "m" + clampInt(c.timeMs, 1, KART_TIME_MAX_MS),
  ];
  if (c.day != null) parts.push("n" + clampInt(c.day, 1, 99_999));
  if (c.rank != null) parts.push("r" + clampInt(c.rank, 1, 8));
  if (c.klass) parts.push("c" + c.klass);
  if (c.mirror) parts.push("x1");
  if (c.ghostId && GHOST_ID_RE.test(c.ghostId)) parts.push("g" + c.ghostId);
  return encodeURIComponent(parts.join(DELIM));
}

/**
 * Parse a route param back into a KartCard. Route params arrive decoded,
 * but we defensively decode again if a stray "%" survived. Returns null
 * when the track, driver, or time is unusable · the caller then renders
 * a generic fallback rather than a broken card.
 */
export function decodeKartCard(raw: string): KartCard | null {
  let s = raw;
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s);
    } catch {
      /* leave as-is · every field is validated below */
    }
  }

  const out: KartCard = {
    trackId: "",
    driverId: "",
    timeMs: NaN,
    day: null,
    rank: null,
    klass: null,
    mirror: false,
    ghostId: null,
  };

  for (const f of s.split(DELIM)) {
    if (!f) continue;
    const k = f[0];
    const v = f.slice(1);
    if (k === "t") out.trackId = v;
    else if (k === "d") out.driverId = v;
    else if (k === "m") out.timeMs = clampInt(v, 1, KART_TIME_MAX_MS, NaN);
    else if (k === "n") out.day = clampInt(v, 1, 99_999);
    else if (k === "r") out.rank = clampInt(v, 1, 8);
    // own-property check, NOT `in` · the prototype chain would accept
    // "constructor"/"__proto__" and crash the card render on a crafted URL
    else if (k === "c" && Object.prototype.hasOwnProperty.call(KART_CLASS_LABELS, v)) out.klass = v as KartClass;
    else if (k === "x") out.mirror = v === "1";
    else if (k === "g" && GHOST_ID_RE.test(v)) out.ghostId = v;
  }

  // Hard gate: unknown ids never reach a render · allow-list or nothing.
  if (!(KART_TRACK_IDS as readonly string[]).includes(out.trackId)) return null;
  if (!(KART_DRIVER_IDS as readonly string[]).includes(out.driverId)) return null;
  if (!Number.isFinite(out.timeMs)) return null;
  return out;
}

/** m:ss.d · same format as the game's fmtTime / board.js formatKartTime. */
export function formatKartCardTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const d = Math.floor((ms % 1000) / 100);
  return m + ":" + String(s).padStart(2, "0") + "." + d;
}
