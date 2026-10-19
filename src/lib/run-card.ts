// Per-run share card transport (2026-07-09).
//
// A finished Runner run encodes into ONE url-safe path segment that
// rides in the share link (/runner/card/<seg>). Shared by the client
// (builds the link in TapeRunner) and the server (parses it for the
// landing page + the dynamic OG image). Everything is clamped on the
// way in AND on the way out · the segment is attacker-reachable, so the
// image and page must never trust a raw value.

export type RunCard = {
  days: number;
  sats: number;
  present: boolean;
  combo: number;
  era: string | null; // short label, e.g. "LUNA collapse"
  handle: string | null;
};

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

// Strip to a bounded, printable subset · defends the image/page against
// control chars or overflowing text (React escapes, but length + glyphs
// still matter for layout, and Satori has no such guard).
function safeText(v: string, max: number): string {
  return v.replace(/[^A-Za-z0-9 #.,'’&+\-]/g, "").slice(0, max).trim();
}

/** Build the single (already percent-encoded) path segment. */
export function encodeRunCard(c: RunCard): string {
  const parts = [
    "d" + clampInt(c.days, 0, 1900),
    "s" + clampInt(c.sats, 0, 9_999_999),
    "p" + (c.present ? 1 : 0),
    "c" + clampInt(c.combo, 0, 99),
  ];
  const era = c.era ? safeText(c.era, 28) : "";
  if (era) parts.push("e" + era);
  const handle = c.handle ? safeText(c.handle, 40) : "";
  if (handle) parts.push("h" + handle);
  return encodeURIComponent(parts.join(DELIM));
}

/**
 * Parse a route param back into a RunCard. Route params arrive decoded,
 * but we defensively decode again if a stray "%" survived. Returns null
 * only when the core `days` field is unusable · the caller then renders
 * a generic fallback rather than a broken card.
 */
export function decodeRunCard(raw: string): RunCard | null {
  let s = raw;
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s);
    } catch {
      /* leave as-is · safeText still bounds every field */
    }
  }

  const out: RunCard = {
    days: NaN,
    sats: 0,
    present: false,
    combo: 0,
    era: null,
    handle: null,
  };

  for (const f of s.split(DELIM)) {
    if (!f) continue;
    const k = f[0];
    const v = f.slice(1);
    if (k === "d") out.days = clampInt(v, 0, 1900, NaN);
    else if (k === "s") out.sats = clampInt(v, 0, 9_999_999);
    else if (k === "p") out.present = v === "1";
    else if (k === "c") out.combo = clampInt(v, 0, 99);
    else if (k === "e") out.era = safeText(v, 28) || null;
    else if (k === "h") out.handle = safeText(v, 40) || null;
  }

  if (!Number.isFinite(out.days)) return null;
  return out;
}

/* ── The Gauntlet's per-run card · same transport, different fields. ── */

export type GauntletCard = {
  tier: string;
  alpha: number; // % vs the DCA bot, one decimal (can be negative)
  number: number | null; // daily gauntlet number, null for practice
  rank: number | null; // today's board rank (daily only)
  handle: string | null;
  liquidated: boolean;
};

/** Build the single (already percent-encoded) Gauntlet card segment. */
export function encodeGauntletCard(c: GauntletCard): string {
  // alpha rides as tenths so one decimal survives the round trip.
  const parts = [
    "a" + clampInt(Math.round(c.alpha * 10), -1000, 10000),
    "l" + (c.liquidated ? 1 : 0),
  ];
  if (c.number != null) parts.push("n" + clampInt(c.number, 0, 99999));
  if (c.rank != null) parts.push("r" + clampInt(c.rank, 1, 999999));
  const tier = c.tier ? safeText(c.tier, 20) : "";
  if (tier) parts.push("t" + tier);
  const handle = c.handle ? safeText(c.handle, 40) : "";
  if (handle) parts.push("h" + handle);
  return encodeURIComponent(parts.join(DELIM));
}

export function decodeGauntletCard(raw: string): GauntletCard | null {
  let s = raw;
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s);
    } catch {
      /* leave as-is · every field is bounded below */
    }
  }

  let alphaTenths = NaN;
  const out: GauntletCard = {
    tier: "",
    alpha: 0,
    number: null,
    rank: null,
    handle: null,
    liquidated: false,
  };

  for (const f of s.split(DELIM)) {
    if (!f) continue;
    const k = f[0];
    const v = f.slice(1);
    if (k === "a") alphaTenths = clampInt(v, -1000, 10000, NaN);
    else if (k === "l") out.liquidated = v === "1";
    else if (k === "n") out.number = clampInt(v, 0, 99999);
    else if (k === "r") out.rank = clampInt(v, 1, 999999);
    else if (k === "t") out.tier = safeText(v, 20);
    else if (k === "h") out.handle = safeText(v, 40) || null;
  }

  if (!Number.isFinite(alphaTenths)) return null;
  out.alpha = alphaTenths / 10;
  return out;
}
