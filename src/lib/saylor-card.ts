/* Per-run share-card codec for SUPER SAYLOR (2026-07-12 · viral loop).
 *
 * The flagship is a static file OUTSIDE the Next bundle
 * (public/super-saylor.html), so it CANNOT import this module. It keeps
 * a byte-identical encoder replica (`saylorCardUrl` in the HTML),
 * drift-guarded by scripts/test-super-saylor.ts. This module owns the
 * DECODE side (read by the /super-saylor/c/[data] landing + its
 * opengraph-image) plus an `encode` used by the roundtrip test.
 *
 * Same clamp-everything discipline as lib/run-card.ts and lib/wen.ts:
 * the path segment is attacker-reachable, so every field is bounded on
 * encode AND decode, malformed sub-fields degrade rather than throw,
 * and only a missing/invalid KIND nulls the whole card (the card page
 * and OG then render a generic branded fallback).
 *
 * Three variants, one flat record:
 *   summit  · a Daily Summit climb   · day + climb ms (+ handle)
 *   victory · a 21/21 campaign clear  · sats + bears + One Chair count
 *   run     · a campaign run that ended · sats + bears + levels reached
 */

export type SaylorCardKind = "summit" | "victory" | "run";

export type SaylorCard = {
  kind: SaylorCardKind;
  handle: string | null;
  // summit variant
  day: number; // Daily Summit number
  ms: number; // climb time in ms (0..SUMMIT_BASE_MS)
  // campaign variants (victory / run)
  sats: number;
  bears: number;
  levels: number; // levels reached (run); victory is always 21
  convictions: number; // One Chair activations (victory)
};

// Pinned against the game (SUMMIT_BASE_MS) and the arcade route
// (SUMMIT_BASE) · the summit budget is a 4:00 climb.
export const SUMMIT_BASE_MS = 240_000;

const DELIM = "~";
const KIND_TO_CH: Record<SaylorCardKind, string> = {
  summit: "s",
  victory: "v",
  run: "r",
};
const CH_TO_KIND: Record<string, SaylorCardKind> = {
  s: "summit",
  v: "victory",
  r: "run",
};

function clampInt(n: number | string, lo: number, hi: number, fallback = lo): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

// Strip to a bounded, printable subset · the OG image and page must
// never trust a raw value (Satori has no escaping, and length still
// drives layout). Mirrors safeText in lib/run-card.ts.
function safeText(v: string, max: number): string {
  return v
    .replace(/[^A-Za-z0-9 #.,'’&+\-]/g, "")
    .slice(0, max)
    .trim();
}

/** Build the single (already percent-encoded) path segment. */
export function encodeSaylorCard(c: SaylorCard): string {
  const parts: string[] = ["k" + (KIND_TO_CH[c.kind] ?? "r")];
  if (c.kind === "summit") {
    parts.push("n" + clampInt(c.day, 1, 50_000));
    parts.push("m" + clampInt(c.ms, 0, SUMMIT_BASE_MS));
  } else {
    parts.push("t" + clampInt(c.sats, 0, 9_999_999));
    parts.push("b" + clampInt(c.bears, 0, 9_999));
    parts.push("l" + clampInt(c.levels, 0, 21));
    if (c.kind === "victory") parts.push("c" + clampInt(c.convictions, 0, 999));
  }
  const handle = c.handle ? safeText(c.handle, 40) : "";
  if (handle) parts.push("h" + handle);
  return encodeURIComponent(parts.join(DELIM));
}

/** Parse a route param back into a SaylorCard. Returns null only when
 *  the KIND is missing/unknown · callers render a generic fallback. */
export function decodeSaylorCard(raw: string): SaylorCard | null {
  let s = raw;
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s);
    } catch {
      /* leave as-is · clamps below still bound every field */
    }
  }
  let kind: SaylorCardKind | null = null;
  const out: SaylorCard = {
    kind: "run",
    handle: null,
    day: 0,
    ms: 0,
    sats: 0,
    bears: 0,
    levels: 0,
    convictions: 0,
  };
  for (const f of s.split(DELIM)) {
    if (!f) continue;
    const k = f[0];
    const v = f.slice(1);
    if (k === "k") kind = CH_TO_KIND[v] ?? null;
    else if (k === "n") out.day = clampInt(v, 0, 50_000);
    else if (k === "m") out.ms = clampInt(v, 0, SUMMIT_BASE_MS);
    else if (k === "t") out.sats = clampInt(v, 0, 9_999_999);
    else if (k === "b") out.bears = clampInt(v, 0, 9_999);
    else if (k === "l") out.levels = clampInt(v, 0, 21);
    else if (k === "c") out.convictions = clampInt(v, 0, 999);
    else if (k === "h") out.handle = safeText(v, 40) || null;
  }
  if (!kind) return null;
  out.kind = kind;
  return out;
}

/** mm:ss.cc from ms · byte-mirror of the game's fmtMs (bounded). */
export function fmtSummitMs(ms: number): string {
  const clamped = Math.max(0, Math.min(SUMMIT_BASE_MS, Math.round(ms)));
  const s = Math.floor(clamped / 1000);
  const cs = Math.floor((clamped % 1000) / 10);
  return (
    Math.floor(s / 60) +
    ":" +
    String(s % 60).padStart(2, "0") +
    "." +
    String(cs).padStart(2, "0")
  );
}
