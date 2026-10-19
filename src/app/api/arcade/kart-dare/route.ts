// Bitcoin Kart · dare ghost store ("race my ghost" deep links · 2026-07-16).
//
// POST: mint a dare. The client uploads a finished run's ghost frames +
// run meta ONLY when the player taps share (mint-on-share · KV volume is
// proportional to sharing intent, not to play). The server verifies the
// salt token + the same frame bounds as the daily leader ghost, then
// stores the run under a random id with a 7-day TTL. There is NO
// leadership check — any finished run can dare — so the integrity story
// is bounds-only, exactly kart's documented ceiling (not replay-verified;
// a dare proves a bounded run happened, never a "verified time").
//
// GET: the ?ghost=<id> boot path pulls a dare by id. Content under an id
// is immutable, so a short CDN cache absorbs viral bursts; the fetch
// counter undercounts inside the cache window, which is acceptable for a
// directional funnel metric (fetches-per-mint).

import { NextResponse } from "next/server";
import { gauntletNumber } from "@/app/gauntlet/engine";
import { isKvConfigured, kvGet, kvHMGet, kvIncrWithTtl, kvSet } from "@/lib/kv";
import { scoreToken } from "@/lib/arcade-token";
import { resolveLinkedSession, X_PROFILE_HASH, type XProfile } from "@/lib/arcade-identity";
import { KART_TRACK_IDS } from "@/lib/kart-card";
import {
  KART_DARE_COUNTER,
  KART_DARE_COUNTER_TTL,
  KART_DARE_ID_RE,
  KART_DARE_KEY,
  KART_DARE_TTL,
  framesMatchTime,
  validateDareMeta,
  validateGhostFrames,
  type GhostFrame,
} from "@/lib/kart-ghost";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// same culture-handle shape the score + ghost routes enforce
const HANDLE_RE =
  /^[A-Za-z][A-Za-z-]{1,14}[A-Za-z] [A-Za-z][A-Za-z ]{1,14}[A-Za-z] #\d{3}$/;

// GLOBAL daily mint ceiling (audit 2026-07-25).
//
// Every other KV store in this repo is bounded — boards BOARD_KEEP 200,
// push/submission indexes 500, history lists 365, the leader ghost is one
// key per day by its leadership check. The dare store was the exception:
// the ONLY brake was the 5/min per-IP rate limit, which one scripted IP
// converts into 7,200 mints/day × up to ~130KB each, held for
// KART_DARE_TTL (7 days). That is multiple GB against the Upstash tier
// the whole site shares, and the failure is not contained to the arcade:
// once KV writes start refusing, the snapshot crons lose their daily
// append, /api/subscribe can't mint DOI tokens, and lib/rate-limit.ts
// degrades OPEN — the brake disappears exactly when it is needed.
//
// Sizing: a typical 3-lap race is ~1,800 frames ≈ 45KB, so 500/day is
// ~157MB of steady-state worst case across the 7-day window and far above
// any real sharing day for this site's traffic. The mint counter was
// already being written here and simply never read — this reads it.
// Raise deliberately if a genuine viral day ever trips it.
const KART_DARE_MINTS_PER_DAY = 500;

// short keys, same convention as the leader ghost's StoredGhost
type StoredDare = {
  t: number; // finish ms
  m: string; // member: culture handle or x:{userId}
  tr: string; // trackId
  k: string; // klass
  x: 0 | 1; // mirror
  f: GhostFrame[];
};

function randomDareId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: Request) {
  const rl = await rateLimit(req, { name: "kart-dare-mint", limit: 5, windowSec: 60 });
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: rl.headers });
  }

  let body: unknown;
  try {
    const raw = await req.text();
    // 5400 quantized frames serialize to ~130KB · 256KB is generous
    if (raw.length > 262_144) return NextResponse.json({ ok: false }, { status: 400 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const b = body as { name?: unknown; token?: unknown; frames?: unknown };

  const meta = validateDareMeta(body);
  if (!meta) return NextResponse.json({ ok: false }, { status: 400 });

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!HANDLE_RE.test(name)) return NextResponse.json({ ok: false }, { status: 400 });

  // salt token: same shared-secret path as every arcade post · the track
  // index stands in for the day slot so track/time/name are all bound
  const trackIdx = (KART_TRACK_IDS as readonly string[]).indexOf(meta.trackId);
  if (b.token !== scoreToken("kart-dare", meta.timeMs, trackIdx, name)) {
    return NextResponse.json({ ok: false, error: "bad_token" }, { status: 400 });
  }

  const frames = validateGhostFrames(b.frames);
  if (!frames || !framesMatchTime(frames.length, meta.timeMs)) {
    return NextResponse.json({ ok: false, error: "bad_frames" }, { status: 400 });
  }

  if (!isKvConfigured()) return NextResponse.json({ ok: false, configured: false });

  // an X-linked sharer dares under their real handle (resolved on GET,
  // same enrichment as the boards)
  const link = await resolveLinkedSession(req.headers.get("cookie"));
  if (link.kind === "read_failed") {
    return NextResponse.json(
      { ok: false, error: "read_failed" },
      { status: 503, headers: rl.headers },
    );
  }
  const member = link.kind === "linked" ? `x:${link.userId}` : name;

  // Claim a slot in today's global mint budget BEFORE storing. The INCR
  // is atomic, so concurrent mints can't both slip past the ceiling. A
  // null return means the EVAL itself failed — degrade OPEN there (same
  // posture as lib/rate-limit.ts), which is safe because a KV that can't
  // INCR can't kvSet either, so nothing accumulates anyway.
  const minted = await kvIncrWithTtl(
    KART_DARE_COUNTER("mint", gauntletNumber(Date.now())),
    KART_DARE_COUNTER_TTL,
  );
  if (minted != null && minted > KART_DARE_MINTS_PER_DAY) {
    return NextResponse.json(
      { ok: false, error: "mint_budget" },
      { status: 429, headers: rl.headers },
    );
  }

  const id = randomDareId();
  await kvSet(
    KART_DARE_KEY(id),
    { t: meta.timeMs, m: member, tr: meta.trackId, k: meta.klass, x: meta.mirror ? 1 : 0, f: frames } satisfies StoredDare,
    KART_DARE_TTL,
  );
  return NextResponse.json({ ok: true, id }, { headers: rl.headers });
}

export async function GET(req: Request) {
  const rl = await rateLimit(req, { name: "kart-dare-read", limit: 60, windowSec: 60 });
  if (!rl.ok) {
    return NextResponse.json({ ok: false }, { status: 429, headers: rl.headers });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!KART_DARE_ID_RE.test(id)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!isKvConfigured()) return NextResponse.json({ ok: false, configured: false });

  const g = await kvGet<StoredDare>(KART_DARE_KEY(id));
  const headers = {
    ...rl.headers,
    // immutable content per id · 60s regional cache keeps the fetch
    // counter directionally honest under a viral burst
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
  };
  if (!g || !Array.isArray(g.f)) {
    return NextResponse.json({ ok: false, error: "expired" }, { headers });
  }
  void kvIncrWithTtl(KART_DARE_COUNTER("fetch", gauntletNumber(Date.now())), KART_DARE_COUNTER_TTL);

  let display = g.m;
  if (g.m.startsWith("x:")) {
    const [p] = await kvHMGet<XProfile>(X_PROFILE_HASH, [g.m.slice(2)]);
    display = p && typeof p.h === "string" ? `@${p.h}` : "unlinked rider";
  }
  return NextResponse.json(
    { ok: true, t: g.t, name: display, trackId: g.tr, klass: g.k, mirror: g.x === 1, frames: g.f },
    { headers },
  );
}
