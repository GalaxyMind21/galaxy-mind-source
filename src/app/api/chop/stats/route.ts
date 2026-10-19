import { NextResponse, type NextRequest } from "next/server";
import { kvPushCapped, isKvConfigured } from "@/lib/kv";
import { rateLimit } from "@/lib/rate-limit";

/**
 * CHOP gameplay telemetry · anonymous, aggregate-only, opt-out-able.
 *
 * WHY THIS EXISTS (operator 2026-08-06): "some way to track metrics for
 * the game like how people are playing it and for how long which we can
 * use to improve it." Every tuning decision in CHOP so far has come from
 * one operator on one phone; this is the first channel that can say what
 * ANY player does — where they quit, which difficulty they pick, whether
 * they come back for a second block.
 *
 * WHY NOT VERCEL WEB ANALYTICS: CHOP is a static page under its own
 * locked-down CSP (`connect-src 'self'`), so it structurally cannot talk
 * to a third-party analytics host without weakening that policy. A
 * same-origin endpoint is the only shape that fits, and it also means no
 * third party ever sees a player.
 *
 * PRIVACY POSTURE — these are constraints, not preferences:
 *   · NO identifiers of any kind. No IP is stored, no cookie is read, no
 *     device id is minted, and the arcade culture handle is deliberately
 *     NOT sent. Two runs by the same person are indistinguishable from
 *     two runs by two people, BY DESIGN — this measures the game, not
 *     players.
 *   · Everything is bucketed at the client before it is sent (durations
 *     to 5s, run counts to bands), so the payload cannot be a fingerprint.
 *   · A strict allow-list projection below: an unknown field is dropped,
 *     never stored. Adding a field is a deliberate edit here AND on
 *     /privacy, in the same commit (the README rule).
 *   · Players can turn it off in the game's own settings; the client then
 *     never calls this route.
 *
 * COST POSTURE: one capped LPUSH per event (kvPushCapped = LPUSH+LTRIM),
 * behind a per-IP rate limit, on a free Upstash tier metered at 10K
 * commands/day. The rate limit is generous for a human (a run is ~70s)
 * and ruinous for a script. Degrades to a silent no-op when KV is
 * unconfigured — telemetry must NEVER be able to break the game.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "gm:chop:events:v1";
const CAP = 5000; // ~ the last few thousand events; aggregation reads this
const MAX_BODY = 1024;

const KINDS = new Set(["boot", "run"]);
const DIFFS = new Set(["pleb", "hodler", "maxi"]);
const GRADES = new Set(["SSS", "SS", "S", "A", "B", "C", "D"]);
const OUTCOMES = new Set(["sealed", "orphaned", "quit"]);
const RUNBANDS = new Set(["first", "early", "regular", "veteran"]);

function num(v: unknown, lo: number, hi: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i >= lo && i <= hi ? i : null;
}
function pick<T>(v: unknown, allowed: Set<string>): T | null {
  return typeof v === "string" && allowed.has(v) ? (v as T) : null;
}

export async function POST(req: NextRequest) {
  // Cheapest checks first, and the free ones before the metered one:
  // shape rejection costs nothing, the KV-backed limiter costs a command.
  // (Same ordering rule the vendor-submission route documents.)
  // Measure the body we actually received. Content-Length is optional
  // and spoofable; subscribe/submit already learned this. A missing
  // or tiny header plus a multi-MB JSON body used to skip the cap and
  // still hit req.json().
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
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
  const kind = pick<string>(body.kind, KINDS);
  if (!kind) return NextResponse.json({ ok: false }, { status: 400 });

  if (!isKvConfigured()) return NextResponse.json({ ok: true, stored: false });

  // 120/hour/IP: a real player cannot finish 120 runs in an hour (a run is
  // ~70s plus ceremony), so this never touches a human, and it bounds what
  // one host can spend of the daily KV budget.
  const limited = await rateLimit(req, { name: "chop-stats", limit: 120, windowSec: 3600 });
  if (!limited.ok) return NextResponse.json({ ok: false }, { status: 429 });

  // ALLOW-LIST PROJECTION. Anything not named here never reaches storage.
  const ev: Record<string, unknown> = {
    k: kind,
    // day bucket, not a timestamp: enough to trend, too coarse to correlate
    d: new Date().toISOString().slice(0, 10),
  };
  if (kind === "boot") {
    ev.touch = body.touch === true;
    ev.returning = body.returning === true;
  } else {
    ev.diff = pick<string>(body.diff, DIFFS);
    ev.band = pick<string>(body.band, RUNBANDS);
    ev.out = pick<string>(body.out, OUTCOMES);
    ev.grade = pick<string>(body.grade, GRADES);
    ev.sec = num(body.sec, 0, 600);       // run length, client-bucketed to 5s
    ev.hits = num(body.hits, 0, 2000);
    ev.miss = num(body.miss, 0, 2000);
    ev.acc = num(body.acc, 0, 100);
    ev.combo = num(body.combo, 0, 5000);
    ev.tut = body.tut === true;
    ev.guide = body.guide === true;
    ev.bombs = num(body.bombs, 0, 100);
    ev.fin = num(body.fin, 0, 21);        // CLOSE THE BLOCK ticks landed
  }

  await kvPushCapped(KEY, ev, CAP);
  return NextResponse.json({ ok: true, stored: true });
}
