// Cross-device cloud save for X-linked arcade players.
//   GET  · pull every game's stored save for the session's X id
//   POST · {game, save} → best-of merge into the stored save, return merged
//
// Auth is the arcade X session (gm_xs cookie) — the same immutable user id
// the board uses. No session / X-unconfigured / KV-unset all degrade to a
// 200 {ok:false, disabled:true}, so the client stays local-only exactly as
// before. Nothing here is a leaderboard: a forged save only affects the
// forger's own progress display, so this validates SHAPE + bounds (anti
// bloat / malformed) rather than running the board's replay-verify.

import { NextResponse } from "next/server";
import { resolveLinkedSession, isXIdentityConfigured } from "@/lib/arcade-identity";
import { isKvConfigured, kvHMGetChecked, kvHSet } from "@/lib/kv";
import { cloudKey, isCloudGame, isTrivialSave, mergeCloudSave, CLOUD_MERGES } from "@/lib/arcade-cloud";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const GAMES = Object.keys(CLOUD_MERGES);

function disabled() {
  return NextResponse.json({ ok: false, disabled: true }, { headers: noStore });
}

// Flood/cost guard shared by both verbs · every hit touches KV. Generous:
// a real player's traffic is one boot pull + a debounced push per race
// finish. Degrades open when KV is unconfigured/failing, same posture as
// the sibling arcade routes (this is cost protection, not a boundary).
async function limited(req: Request) {
  return rateLimit(req, { name: "arcade-cloud", limit: 60, windowSec: 60 });
}

export async function GET(req: Request) {
  if (!isXIdentityConfigured() || !isKvConfigured()) return disabled();
  const link = await resolveLinkedSession(req.headers.get("cookie"));
  if (link.kind === "anonymous") return disabled();
  if (link.kind === "read_failed") {
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 503, headers: noStore });
  }
  if (link.kind === "unlinked") {
    return NextResponse.json({ ok: false, error: "unlinked" }, { status: 409, headers: noStore });
  }
  const xs = { userId: link.userId };

  const rl = await limited(req);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { ...noStore, ...rl.headers } });
  }

  const read = await kvHMGetChecked<unknown>(cloudKey(xs.userId), GAMES);
  if (!read.ok) {
    // a failed read is NOT "no saves" · say so rather than imply an empty cloud
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 503, headers: { ...noStore, ...rl.headers } });
  }
  const saves: Record<string, unknown> = {};
  GAMES.forEach((g, i) => { if (read.values[i] != null) saves[g] = read.values[i]; });
  return NextResponse.json({ ok: true, saves }, { headers: { ...noStore, ...rl.headers } });
}

export async function POST(req: Request) {
  if (!isXIdentityConfigured() || !isKvConfigured()) return disabled();
  const link = await resolveLinkedSession(req.headers.get("cookie"));
  if (link.kind === "anonymous") return disabled();
  if (link.kind === "read_failed") {
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 503, headers: noStore });
  }
  if (link.kind === "unlinked") {
    return NextResponse.json({ ok: false, error: "unlinked" }, { status: 409, headers: noStore });
  }
  const xs = { userId: link.userId };

  const rl = await limited(req);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { ...noStore, ...rl.headers } });
  }

  // 64KB body cap · a save is a few KB; anything larger is malformed/abuse
  const raw = await req.text();
  if (raw.length > 64 * 1024) {
    return NextResponse.json({ ok: false, error: "too_large" }, { status: 413, headers: { ...noStore, ...rl.headers } });
  }
  let body: { game?: unknown; save?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400, headers: { ...noStore, ...rl.headers } });
  }
  // JSON.parse("null") SUCCEEDS, so a 4-byte body of `null` sails past the
  // try/catch above and the first property read below throws — an opaque
  // 500 on a route whose every other rejection is a typed 400. Same guard
  // submit-vendor and prefs already use.
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400, headers: { ...noStore, ...rl.headers } });
  }
  const game = typeof body.game === "string" ? body.game : "";
  if (!isCloudGame(game)) {
    return NextResponse.json({ ok: false, error: "unknown_game" }, { status: 400, headers: { ...noStore, ...rl.headers } });
  }

  // Unlink durability: resolveLinkedSession already applied the
  // profile-hash revocation signal (same check GET uses).

  const key = cloudKey(xs.userId);
  // The stored save MUST be read successfully before we merge-and-overwrite.
  // kvHMGet returns null for an absent field AND a transient read failure
  // indistinguishably, so a plain kvHMGet would let a returning device that
  // is BEHIND the cloud clobber it on a KV blip — the best-of guarantee only
  // holds when the base was actually read (review 2026-07-18). kvHMGetChecked
  // separates the two: ok:false means the read failed, so we skip the write
  // entirely (the client keeps its local save and retries next sync).
  const read = await kvHMGetChecked<unknown>(key, [game]);
  if (!read.ok) {
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 503, headers: { ...noStore, ...rl.headers } });
  }
  const stored = read.values[0];
  const merged = mergeCloudSave(game, stored, body.save);
  // Now that the read is trustworthy, only WRITE when the POST adds progress:
  //   · a TRIVIAL save (a fresh device's boot pull, all defaults) is
  //     pull-only — it has nothing to contribute.
  //   · when the merge equals what's stored, the write is a pure no-op
  //     (saves a KV command on every idle sync).
  // The client still receives `merged` in every case, so pull-only devices
  // still download the cloud's progress.
  if (!isTrivialSave(game, body.save) && JSON.stringify(merged) !== JSON.stringify(stored)) {
    await kvHSet(key, game, merged);
  }
  return NextResponse.json({ ok: true, merged }, { headers: { ...noStore, ...rl.headers } });
}
