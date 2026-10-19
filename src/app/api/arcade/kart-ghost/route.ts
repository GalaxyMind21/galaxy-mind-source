// Bitcoin Kart · world-leader ghost store (Tier 1 · 2026-07-14).
//
// POST: the daily #1 uploads their run's ghost right after the score
// post that made them #1. The server verifies the same salt token +
// bounds contract as the score route, then checks LEADERSHIP against
// the live daily board: the poster's member must hold the exact top
// score. One ghost per day key, only ever replaced by a faster run,
// self-expires with the board.
//
// GET: anyone starting today's circuit pulls the leader's line. Board-
// global data (no viewer state), so a short CDN cache absorbs the
// per-race-start reads.

import { NextResponse } from "next/server";
import { gauntletNumber } from "@/app/gauntlet/engine";
import { isKvConfigured, kvGet, kvHMGet, kvSet, kvZTop } from "@/lib/kv";
import { scoreToken } from "@/lib/arcade-token";
import { resolveLinkedSession, X_PROFILE_HASH, type XProfile } from "@/lib/arcade-identity";
import {
  KART_GHOST_BASE_MS,
  KART_GHOST_KEY,
  KART_GHOST_MIN_MS,
  KART_GHOST_TTL,
  framesMatchTime,
  kartDailyScore,
  validateGhostFrames,
  type GhostFrame,
} from "@/lib/kart-ghost";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// same culture-handle shape the score route enforces (kept in lockstep ·
// drift-guarded by scripts/test-bitcoin-kart.ts)
const HANDLE_RE =
  /^[A-Za-z][A-Za-z-]{1,14}[A-Za-z] [A-Za-z][A-Za-z ]{1,14}[A-Za-z] #\d{3}$/;

const KEY_KART_DAY = (n: number) => `gm:lb:kart:day:v1:${n}`;

type StoredGhost = { t: number; m: string; f: GhostFrame[] };

export async function POST(req: Request) {
  const rl = await rateLimit(req, { name: "kart-ghost", limit: 6, windowSec: 60 });
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
  // JSON.parse("null") SUCCEEDS, so a 4-byte body of `null` sails past the
  // try/catch above and the first property read below throws — an opaque
  // 500 on a route whose every other rejection is a typed 400. Same guard
  // submit-vendor and prefs already use.
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const b = body as { day?: unknown; name?: unknown; token?: unknown; timeMs?: unknown; frames?: unknown };

  const name = typeof b.name === "string" ? b.name.trim() : "";
  const timeMs = typeof b.timeMs === "number" ? Math.round(b.timeMs) : NaN;
  if (!HANDLE_RE.test(name) || !Number.isInteger(timeMs)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (timeMs < KART_GHOST_MIN_MS || timeMs > KART_GHOST_BASE_MS - 60_000) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  // day freshness · same contract as the score route (today + 10min grace)
  const now = gauntletNumber(Date.now());
  const day = typeof b.day === "number" ? Math.floor(b.day) : NaN;
  const grace = day === now - 1 && Date.now() % 86_400_000 < 10 * 60 * 1000;
  if (day !== now && !grace) {
    return NextResponse.json({ ok: false, error: "stale_day" }, { status: 400 });
  }
  // the SAME token the score post carried · one shared secret path.
  // MUST use the shared clamp (fixed 2026-07-25): the client signs the
  // token over the CLAMPED board score, so an unclamped value here made
  // every sub-60s run fail the token check and, past that, the leadership
  // compare below (which reads the clamped score back off the ZSET).
  const score = kartDailyScore(timeMs);
  if (b.token !== scoreToken("kart", score, day, name)) {
    return NextResponse.json({ ok: false, error: "bad_token" }, { status: 400 });
  }
  const frames = validateGhostFrames(b.frames);
  if (!frames || !framesMatchTime(frames.length, timeMs)) {
    return NextResponse.json({ ok: false, error: "bad_frames" }, { status: 400 });
  }

  if (!isKvConfigured()) return NextResponse.json({ ok: false, configured: false });

  // leadership check: the poster's board member must hold EXACTLY this
  // score at the top of the live daily ZSET · you cannot seat a ghost
  // you did not race to #1
  const link = await resolveLinkedSession(req.headers.get("cookie"));
  if (link.kind === "read_failed") {
    return NextResponse.json(
      { ok: false, error: "read_failed" },
      { status: 503, headers: rl.headers },
    );
  }
  const member = link.kind === "linked" ? `x:${link.userId}` : name;
  const top = await kvZTop(KEY_KART_DAY(day), 1);
  if (!top.length || top[0].member !== member || Math.round(top[0].score) !== score) {
    return NextResponse.json({ ok: false, error: "not_leader" }, { status: 403, headers: rl.headers });
  }

  // only a faster run replaces the stored ghost (re-uploads are no-ops)
  const key = KART_GHOST_KEY(day);
  const existing = await kvGet<StoredGhost>(key);
  if (existing && typeof existing.t === "number" && existing.t <= timeMs) {
    return NextResponse.json({ ok: true, stored: false }, { headers: rl.headers });
  }
  await kvSet(key, { t: timeMs, m: member, f: frames } satisfies StoredGhost, KART_GHOST_TTL);
  return NextResponse.json({ ok: true, stored: true }, { headers: rl.headers });
}

export async function GET(req: Request) {
  const rl = await rateLimit(req, { name: "kart-ghost-read", limit: 60, windowSec: 60 });
  if (!rl.ok) {
    return NextResponse.json({ ok: false }, { status: 429, headers: rl.headers });
  }
  const url = new URL(req.url);
  const now = gauntletNumber(Date.now());
  const dayRaw = url.searchParams.get("day");
  const day = dayRaw == null ? NaN : Math.floor(Number(dayRaw));
  if (!Number.isFinite(day) || day > now || day < Math.max(1, now - 7)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!isKvConfigured()) return NextResponse.json({ ok: false, configured: false });

  const g = await kvGet<StoredGhost>(KART_GHOST_KEY(day));
  const headers = {
    ...rl.headers,
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
  };
  if (!g || !Array.isArray(g.f)) {
    return NextResponse.json({ ok: false }, { headers });
  }
  // resolve an x:-member to their @handle, same enrichment as the boards
  let display = g.m;
  if (g.m.startsWith("x:")) {
    const [p] = await kvHMGet<XProfile>(X_PROFILE_HASH, [g.m.slice(2)]);
    display = p && typeof p.h === "string" ? `@${p.h}` : "unlinked rider";
  }
  return NextResponse.json({ ok: true, t: g.t, name: display, frames: g.f }, { headers });
}
