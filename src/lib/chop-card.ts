// Per-run share card transport for CHOP.
//
// A finished block encodes into ONE url-safe path segment that rides in
// the share link (/chop/card/<seg>). The ENCODER is duplicated: the game
// is a static no-build directory (public/chop/), so it cannot import this
// module · `cardSeg()` in public/chop/js/main.js is a byte-for-byte mirror
// of encodeChopCard() below, drift-guarded by scripts/test-chop-board.ts.
// Change the field set or key letters in BOTH places or the test fails.
//
// The segment is attacker-reachable, so the page/OG never trust a raw
// value: numbers are clamped, and the grade is only accepted from the
// allow-list below. Same posture as lib/run-card.ts / lib/kart-card.ts.

export const CHOP_SATS_MAX = 12_000_000; // board envelope CHOP_MAX
export const CHOP_HEIGHT_MAX = 99_999_999;
export const CHOP_COMBO_MAX = 999;

export const CHOP_GRADES = ["SSS", "SS", "S", "A", "B", "C", "D"] as const;
export type ChopGrade = (typeof CHOP_GRADES)[number];

export type ChopCard = {
  sats: number;
  grade: ChopGrade | "";
  height: number | null;
  combo: number;
  orphaned: boolean;
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

function isGrade(v: string): v is ChopGrade {
  return (CHOP_GRADES as readonly string[]).includes(v);
}

/**
 * Build the single (already percent-encoded) path segment.
 * Field order s/g/h/x/o is the wire contract · the client mirror in
 * main.js emits the exact same bytes.
 */
export function encodeChopCard(c: ChopCard): string {
  const parts = ["s" + clampInt(c.sats, 0, CHOP_SATS_MAX)];
  if (c.grade && isGrade(c.grade)) parts.push("g" + c.grade);
  if (c.height != null) parts.push("h" + clampInt(c.height, 0, CHOP_HEIGHT_MAX));
  const combo = clampInt(c.combo, 0, CHOP_COMBO_MAX);
  if (combo > 0) parts.push("x" + combo);
  if (c.orphaned) parts.push("o1");
  return encodeURIComponent(parts.join(DELIM));
}

/**
 * Parse a route param back into a ChopCard. Route params arrive decoded,
 * but we defensively decode again if a stray "%" survived. Returns null
 * when the core `sats` field is unusable · the caller then renders a
 * generic fallback rather than a broken card.
 */
export function decodeChopCard(raw: string): ChopCard | null {
  let s = raw;
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s);
    } catch {
      /* leave as-is · every field is validated below */
    }
  }

  const out: ChopCard = {
    sats: NaN,
    grade: "",
    height: null,
    combo: 0,
    orphaned: false,
  };

  for (const f of s.split(DELIM)) {
    if (!f) continue;
    const k = f[0];
    const v = f.slice(1);
    if (k === "s") out.sats = clampInt(v, 0, CHOP_SATS_MAX, NaN);
    else if (k === "g" && isGrade(v)) out.grade = v;
    else if (k === "h") out.height = clampInt(v, 0, CHOP_HEIGHT_MAX);
    else if (k === "x") out.combo = clampInt(v, 0, CHOP_COMBO_MAX);
    else if (k === "o") out.orphaned = v === "1";
  }

  if (!Number.isFinite(out.sats)) return null;
  return out;
}
