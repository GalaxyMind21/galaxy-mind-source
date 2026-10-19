// POST /api/arcade/score · public arcade leaderboard submissions.
//
// No accounts: identity is a client-minted culture handle, validated
// against the exact generator pattern. Anti-abuse is layered, not
// perfect (an arcade board on a directory site is not a security
// boundary): strict shape + bounds validation, per-IP rate limit,
// ZADD GT (a member's score can only ever improve · griefing someone
// else's handle DOWN is impossible), and daily gauntlet boards that
// self-expire. Degrades to a silent no-op when KV is unconfigured.
//
// WEN + Gauntlet go one further (2026-07-11): both are pure engines
// keyed on the UTC day number, so their submissions must carry a
// `proof` (WEN: the guess list · Gauntlet: the player-action log) that
// the server REPLAYS against the same price series; a claimed score
// the replay doesn't reproduce is a 400. Proofless wen/gauntlet posts
// are rejected outright (clean cut · the boards reset daily anyway).
// Runner / horizon / saylor / summit keep the documented
// forgeable-by-design posture.

import { NextResponse } from "next/server";
import { gauntletNumber } from "@/app/gauntlet/engine";
import {
  isKvConfigured,
  kvExpire,
  kvZAddGt,
  kvZRevRank,
  kvZTrimTop,
} from "@/lib/kv";
import { scoreToken } from "@/lib/arcade-token";
import {
  HORIZON_SATS_MAX,
  isValidRunnerScore,
} from "@/lib/arcade-score";
import { isValidWenScore } from "@/lib/wen";
import { isValidTrailScore } from "@/lib/hodl-trail";
import {
  parseGauntletProof,
  parseTrailProof,
  parseWenProof,
  verifyGauntletProof,
  verifyTrailProof,
  verifyWenProof,
  type GauntletAction,
  type TrailAction,
} from "@/lib/arcade-replay";
import { loadBtcHistoryServer } from "@/lib/btc-history-server";
import { matchProfanityOrSlur } from "@/lib/nostr-content-filter";
import { rateLimit } from "@/lib/rate-limit";
import { resolveLinkedSession } from "@/lib/arcade-identity";

export const runtime = "nodejs";

// "Adjective Noun #123" exactly as lib/arcade generates it. Each part
// must START and END with a letter (no all-dash / all-space names can
// seat a blank row on the board), letters/spaces/hyphens between ·
// nothing markup-ish can land on the public board.
const HANDLE_RE =
  /^[A-Za-z][A-Za-z-]{1,14}[A-Za-z] [A-Za-z][A-Za-z ]{1,14}[A-Za-z] #\d{3}$/;

// Board keys · version bumps retire polluted boards (old posts keep
// their KV TTL and drop off without a manual purge).
//   gauntlet v2 · post token/bounds hardening
//   runner   v3 · 2026-07-10 integer days*1e6+sats packing (v2 was
//                 days + min(sats,9999)/1e4 and every long run showed
//                 "9,999 sats")
//   horizon  v3 · Timechain rebuild rescaled scoring
const KEY_GAUNTLET = (n: number) => `gm:lb:g:v2:${n}`;
const KEY_RUNNER = "gm:lb:runner:v3";
// Per-day runner board · the tape is daily-seeded (same run for everyone
// each UTC day), so a daily board is fair competition and the return
// hook. All-time stays the durable hall of fame above (2026-07-10).
const KEY_RUNNER_DAY = (n: number) => `gm:lb:runner:day:v3:${n}`;
const KEY_HORIZON = "gm:lb:horizon:v3";
// WEN · one puzzle per UTC day, so the daily board is the race and the
// all-time board is best-ever single-day sats (2026-07-11).
const KEY_WEN = "gm:lb:wen:v1";
const KEY_WEN_DAY = (n: number) => `gm:lb:wen:day:v1:${n}`;
// Super Saylor · the flagship platformer's all-time global board
// (the game is not daily-seeded, so no per-day key).
const KEY_SAYLOR = "gm:lb:saylor:v1";
// Daily Summit · Super Saylor's daily time attack. One deterministic
// level per UTC day; the board is daily-only (there is no meaningful
// all-time race across different mountains).
const KEY_SUMMIT_DAY = (n: number) => `gm:lb:summit:day:v1:${n}`;
// Bitcoin Kart Daily Circuit · one deterministic track + class + mirror
// combo per UTC day (public/bitcoin-kart/js/data.js dailyCombo). Daily-
// only for the same reason as the Summit: times across different tracks
// are not comparable. Not replay-verified (rAF game) · salt-token +
// bounds + ZADD-GT posture, documented like runner/saylor.
const KEY_KART_DAY = (n: number) => `gm:lb:kart:day:v1:${n}`;
// THE HODL TRAIL · one expedition per UTC day, replay-verified like
// WEN/Gauntlet (the deck is code, so the replay needs no price series).
// Daily board is the race; all-time is best-ever single-day sats.
const KEY_TRAIL = "gm:lb:trail:v1";
const KEY_TRAIL_DAY = (n: number) => `gm:lb:trail:day:v1:${n}`;
// CHOP · the live-block rhythm slicer. The chart is generated from the
// CURRENT tip's hash, so every player racing "today" is cutting a
// different block as the chain advances — a daily board is the honest
// race (all-time would compare runs against blocks of wildly different
// tx counts). Not replay-verified: scoring reads a continuous touch
// stroke's geometry, which the server cannot re-derive from an action
// log, so CHOP takes the Kart/Saylor posture (salt-token + hard bounds
// + ZADD-GT), documented here rather than implied.
const KEY_CHOP_DAY = (n: number) => `gm:lb:chop:day:v1:${n}`;
const GAUNTLET_BOARD_TTL = 60 * 60 * 24 * 30; // 30 days of history
const RUNNER_BOARD_TTL = 60 * 60 * 24 * 180; // 6 months · abandoned pollution self-heals
const RUNNER_DAY_TTL = 60 * 60 * 24 * 8; // a week of daily boards + grace
const HORIZON_BOARD_TTL = 60 * 60 * 24 * 180; // 6 months · same self-heal as the runner
const WEN_BOARD_TTL = 60 * 60 * 24 * 180; // 6 months · same self-heal
const WEN_DAY_TTL = 60 * 60 * 24 * 8; // a week of daily boards + grace
const SAYLOR_BOARD_TTL = 60 * 60 * 24 * 180; // 6 months · same self-heal
const SUMMIT_DAY_TTL = 60 * 60 * 24 * 8; // a week of daily boards + grace
const KART_DAY_TTL = 60 * 60 * 24 * 8; // a week of daily boards + grace
const TRAIL_BOARD_TTL = 60 * 60 * 24 * 180; // 6 months · same self-heal as WEN
const TRAIL_DAY_TTL = 60 * 60 * 24 * 8; // a week of daily boards + grace
const CHOP_DAY_TTL = 60 * 60 * 24 * 8; // a week of daily boards + grace
const BOARD_KEEP = 200; // hard cap on board size (top-N by score)

// Real achievable envelopes · a spoofer can't post a value the game
// can't physically produce and have it read as a real number on an
// honesty-branded board. Gauntlet: alpha% vs the DCA bot over a 240-
// day 2x-margin window (well under +1000). Runner: integer packing
// (lib/arcade-score). Horizon = Timechain sats + height fraction.
// CHOP: sats banked in one block. Per-note pay is
// round(sats * mult * score/115 * timing), sats = 90 + feeNorm*2400,
// mult caps at 8, geometry caps at 115/115, timing at 1.2. The coinbase
// is NOT formula-paid since the CLOSE THE BLOCK finale (2026-08-05): it
// pays a fixed 210,000 subsidy plus at most 21 fee ticks x 21,000 =
// 441,000 — a 651,000 constant ceiling, deliberately mult-independent so
// every player on the block faces the same cap (this board is
// bounds-checked, not replay-verified). Bombs pay zero. A flawless MAXI
// run on a fat block is now ~2.6M; 12M stays a generous physical
// ceiling no honest run reaches. Integer by construction.
const CHOP_MIN = 1;
const CHOP_MAX = 12_000_000;
const GAUNTLET_MIN = -100;
const GAUNTLET_MAX = 1000;
// Super Saylor composite: sats + bears*50 + rules*210 + levels*1000 +
// convictions*500 + grade bonus - deaths*100. An honest full clear
// lands ~45k; 75k is the physical ceiling with generous grinding.
// Integer by construction (runScore rounds).
const SAYLOR_MIN = 0;
const SAYLOR_MAX = 75_000;
// Daily Summit: score = SUMMIT_BASE - elapsed ms, so faster climbs are
// higher scores and ZADD GT's "only improves" stays true. Attempts cap
// at 4 minutes and no level is honestly clearable under 5 seconds, so
// valid scores are integers in [1, SUMMIT_BASE - 5000]. The base
// constant is drift-guarded against the game client.
const SUMMIT_BASE = 240_000;
const SUMMIT_MIN = 1;
const SUMMIT_MAX = SUMMIT_BASE - 5_000;
// Daily Circuit: score = KART_BASE - finish ms. Races cap under 10
// minutes, so valid scores are integers in [1, KART_BASE - KART_FLOOR].
// The floor was 60_000 on the assumption that no honest circuit finishes
// inside a minute. That assumption is wrong (lib/kart-ghost measured a
// ~56s best with satoshi on FULL SEND) and it cost those players their
// times: every sub-minute run scored the identical ceiling, and under
// ZADD GT a ceiling score can never improve. Floor now matches
// KART_GHOST_MIN_MS. Both are drift-guarded against the game client
// (scripts/test-bitcoin-kart.ts).
const KART_BASE = 600_000;
const KART_FLOOR = 40_000;
const KART_MIN = 1;
const KART_MAX = KART_BASE - KART_FLOOR;
const HORIZON_MIN = 0;
const HORIZON_MAX = HORIZON_SATS_MAX + 0.999;

export async function POST(req: Request) {
  const rl = await rateLimit(req, {
    name: "arcade-score",
    limit: 12,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: rl.headers },
    );
  }

  let body: unknown;
  try {
    // Body cap: the largest legit payload is a maxed-out gauntlet
    // action log (~400 compact tuples ≈ 11KB) · anything bigger is
    // not a game client.
    const raw = await req.text();
    if (raw.length > 16_384) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
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
  const b = body as {
    game?: unknown;
    score?: unknown;
    day?: unknown;
    name?: unknown;
    token?: unknown;
    proof?: unknown;
  };

  const game =
    b.game === "gauntlet" ||
    b.game === "runner" ||
    b.game === "horizon" ||
    b.game === "wen" ||
    b.game === "saylor" ||
    b.game === "summit" ||
    b.game === "kart" ||
    b.game === "trail" ||
    b.game === "chop"
      ? b.game
      : null;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const score = typeof b.score === "number" ? b.score : NaN;
  if (!game || !HANDLE_RE.test(name) || !Number.isFinite(score)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  // House rule holds server-side too: hand-crafted "#x88"-style
  // suffixes never reach the public board.
  if (name.slice(name.indexOf("#")).includes("88")) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  // Profanity/slur screen · the generator can't produce these words,
  // but the integrity token is client-derivable obfuscation, not auth,
  // and a crafted handle would sit on a public board for up to 180
  // days. Same word lists as the Nostr display filter — covers every
  // board (gauntlet / runner / horizon / wen) at this one choke point.
  if (matchProfanityOrSlur(name)) {
    return NextResponse.json({ ok: false, error: "bad_name" }, { status: 400 });
  }
  // Integrity token · the game bundle signs each post (obfuscation, not
  // security · see lib/arcade-token). Stops the board being filled with
  // a one-line curl. A mismatch is a 400 like any other bad shape.
  const dayForToken =
    typeof b.day === "number" ? Math.floor(b.day) : undefined;
  if (b.token !== scoreToken(game, score, dayForToken, name)) {
    return NextResponse.json({ ok: false, error: "bad_token" }, { status: 400 });
  }

  // ALL input validation happens before the availability gate · a
  // malformed request is a 400 even while the board is down, and the
  // local no-KV dev loop still exercises every rejection branch.
  let day = 0;
  let runnerDaily = false;
  let gauntletActions: GauntletAction[] | null = null;
  let wenGuesses: number[] | null = null;
  let trailActions: TrailAction[] | null = null;
  if (game === "gauntlet") {
    if (score < GAUNTLET_MIN || score > GAUNTLET_MAX) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const now = gauntletNumber(Date.now());
    day = typeof b.day === "number" ? Math.floor(b.day) : NaN;
    // Today's board only · plus a 10-minute grace after UTC midnight
    // for runs that finish across the rollover.
    const grace =
      day === now - 1 && Date.now() % 86_400_000 < 10 * 60 * 1000;
    if (day !== now && !grace) {
      return NextResponse.json({ ok: false, error: "stale_day" }, { status: 400 });
    }
    // Replay proof · the player-action log this run was built from.
    // Proofless / malformed = 400 (replay verification is mandatory
    // on the honesty-branded daily boards).
    gauntletActions = parseGauntletProof(b.proof);
    if (!gauntletActions) {
      return NextResponse.json(
        { ok: false, error: "bad_proof" },
        { status: 400 },
      );
    }
  } else if (game === "runner") {
    // Runner: days * 1e6 + sats (lib/arcade-score). Rejects the legacy
    // float packing (e.g. 1415.9999) so a stale client can't re-poison
    // the board with the 9,999-sat cap shape.
    if (!isValidRunnerScore(score)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // When the client sends today's gauntlet number (the daily seed),
    // ALSO post to today's runner board · a stale/absent day just skips
    // the daily write and the all-time board still gets it.
    if (typeof b.day === "number") {
      const now = gauntletNumber(Date.now());
      const d = Math.floor(b.day);
      const grace =
        d === now - 1 && Date.now() % 86_400_000 < 10 * 60 * 1000;
      if (d === now || grace) {
        day = d;
        runnerDaily = true;
      }
    }
  } else if (game === "wen") {
    // WEN: integer sats 0..10000 (lib/wen isValidWenScore · closeness
    // points, so ZADD GT's higher-is-better holds).
    if (!isValidWenScore(score)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // Day-freshness is now MANDATORY (same contract as the gauntlet:
    // today's number or the 10-minute post-midnight grace) · with
    // replay verification, accepting a stale day would let anyone
    // re-derive an old puzzle's answer offline and post a perfect
    // 10,000 to the all-time board. One puzzle per UTC day, one
    // submission window.
    const now = gauntletNumber(Date.now());
    day = typeof b.day === "number" ? Math.floor(b.day) : NaN;
    const grace =
      day === now - 1 && Date.now() % 86_400_000 < 10 * 60 * 1000;
    if (day !== now && !grace) {
      return NextResponse.json(
        { ok: false, error: "stale_day" },
        { status: 400 },
      );
    }
    // Replay proof · the guess list, replayed against the day's
    // re-derived answer. Proofless / malformed = 400.
    wenGuesses = parseWenProof(b.proof);
    if (!wenGuesses) {
      return NextResponse.json(
        { ok: false, error: "bad_proof" },
        { status: 400 },
      );
    }
  } else if (game === "trail") {
    // Trail: integer sats 0..2.1M (lib/hodl-trail isValidTrailScore).
    if (!isValidTrailScore(score)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // Same mandatory day-freshness contract as WEN: with replay
    // verification, a stale day would let anyone re-sim an old
    // expedition offline and farm the all-time board.
    const now = gauntletNumber(Date.now());
    day = typeof b.day === "number" ? Math.floor(b.day) : NaN;
    const grace =
      day === now - 1 && Date.now() % 86_400_000 < 10 * 60 * 1000;
    if (day !== now && !grace) {
      return NextResponse.json(
        { ok: false, error: "stale_day" },
        { status: 400 },
      );
    }
    // Replay proof · the [leg, choice, alloc] action log. Proofless /
    // malformed = 400.
    trailActions = parseTrailProof(b.proof);
    if (!trailActions) {
      return NextResponse.json(
        { ok: false, error: "bad_proof" },
        { status: 400 },
      );
    }
  } else if (game === "saylor") {
    // Flagship composite score · plain bounded integer, no day key.
    if (
      !Number.isInteger(score) ||
      score < SAYLOR_MIN ||
      score > SAYLOR_MAX
    ) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
  } else if (game === "summit") {
    if (
      !Number.isInteger(score) ||
      score < SUMMIT_MIN ||
      score > SUMMIT_MAX
    ) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // Day freshness is mandatory · today's mountain or the 10-minute
    // post-midnight grace, same contract as the gauntlet. Yesterday's
    // level is a different race; a stale post is meaningless.
    const now = gauntletNumber(Date.now());
    day = typeof b.day === "number" ? Math.floor(b.day) : NaN;
    const grace =
      day === now - 1 && Date.now() % 86_400_000 < 10 * 60 * 1000;
    if (day !== now && !grace) {
      return NextResponse.json(
        { ok: false, error: "stale_day" },
        { status: 400 },
      );
    }
  } else if (game === "chop") {
    if (!Number.isInteger(score) || score < CHOP_MIN || score > CHOP_MAX) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // Day freshness mandatory · the chart comes from the live tip, so a
    // stale post is a run against a block nobody else can play.
    const now = gauntletNumber(Date.now());
    day = typeof b.day === "number" ? Math.floor(b.day) : NaN;
    const grace =
      day === now - 1 && Date.now() % 86_400_000 < 10 * 60 * 1000;
    if (day !== now && !grace) {
      return NextResponse.json(
        { ok: false, error: "stale_day" },
        { status: 400 },
      );
    }
  } else if (game === "kart") {
    if (!Number.isInteger(score) || score < KART_MIN || score > KART_MAX) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // Same daily contract as the Summit: today's combo or the 10-minute
    // post-midnight grace. Yesterday's circuit is a different race.
    const now = gauntletNumber(Date.now());
    day = typeof b.day === "number" ? Math.floor(b.day) : NaN;
    const grace =
      day === now - 1 && Date.now() % 86_400_000 < 10 * 60 * 1000;
    if (day !== now && !grace) {
      return NextResponse.json(
        { ok: false, error: "stale_day" },
        { status: 400 },
      );
    }
  } else if (score < HORIZON_MIN || score > HORIZON_MAX) {
    // Timechain: sats banked, chain height packed into the fraction.
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!isKvConfigured()) {
    // Honest no-op · the client treats this as "board unavailable".
    return NextResponse.json({ ok: false, configured: false });
  }

  // ── Optional X identity (2026-07-14) ──────────────────────────────
  // Every validation above ran against the submitted culture handle
  // exactly as before. If (and only if) a valid signed session cookie
  // rides the request, the BOARD MEMBER becomes "x:{userId}" — a shape
  // HANDLE_RE can never produce, so it can't collide with anonymous
  // rows and needs no board version bump. ZADD GT then tracks one real
  // person across devices and handle rerolls, and posting under a real
  // @handle requires actually owning the X account. Logged-out and
  // env-unset paths are byte-identical to the old behavior.
  const link = await resolveLinkedSession(req.headers.get("cookie"));
  if (link.kind === "read_failed") {
    return NextResponse.json(
      { ok: false, error: "read_failed" },
      { status: 503, headers: rl.headers },
    );
  }
  const member = link.kind === "linked" ? `x:${link.userId}` : name;

  // ── Replay verification · wen + gauntlet ─────────────────────────
  // Recompute the day's puzzle from the day number and re-run the
  // proof; the claimed score must fall out of the sim. Sits after the
  // availability gate (shape errors 400 even with KV down, but the
  // upstream fetch only happens when a write is actually possible) and
  // before any ZADD. History-feed downtime is a 503, NOT a rejection ·
  // both game clients keep an unsent marker and retry, and ZADD GT
  // makes the retry idempotent.
  // Trail replay is pure (the deck is code · no price series), so it
  // verifies without touching the history feed and can never 503.
  if (game === "trail" && !verifyTrailProof(day, trailActions!, score)) {
    return NextResponse.json(
      { ok: false, error: "bad_proof" },
      { status: 400, headers: rl.headers },
    );
  }

  if (game === "gauntlet" || game === "wen") {
    const rawSeries = await loadBtcHistoryServer();
    if (!rawSeries) {
      return NextResponse.json(
        { ok: false, error: "replay_unavailable" },
        { status: 503, headers: rl.headers },
      );
    }
    const verified =
      game === "gauntlet"
        ? verifyGauntletProof(rawSeries, Date.now(), day, gauntletActions!, score)
        : verifyWenProof(rawSeries, day, wenGuesses!, score);
    if (!verified) {
      return NextResponse.json(
        { ok: false, error: "bad_proof" },
        { status: 400, headers: rl.headers },
      );
    }
  }

  if (game === "gauntlet") {
    const key = KEY_GAUNTLET(day);
    const rounded = Math.round(score * 10) / 10;
    await kvZAddGt(key, rounded, member);
    await kvExpire(key, GAUNTLET_BOARD_TTL);
    await kvZTrimTop(key, BOARD_KEEP);
    const rank = await kvZRevRank(key, member);
    return NextResponse.json(
      { ok: true, rank: rank == null ? null : rank + 1 },
      { headers: rl.headers },
    );
  }

  if (game === "runner") {
    // Integer packing · days * 1e6 + sats. ZADD GT so a member's score
    // only improves; top-N + TTL keep abandoned floods from sitting.
    const packed = Math.round(score);
    await kvZAddGt(KEY_RUNNER, packed, member);
    await kvExpire(KEY_RUNNER, RUNNER_BOARD_TTL);
    await kvZTrimTop(KEY_RUNNER, BOARD_KEEP);
    // Today's board too · same tape for everyone this UTC day, so this
    // is the fair head-to-head. Self-expires in a week. The rank we
    // return is the all-time one (the durable hall-of-fame number).
    if (runnerDaily) {
      const dkey = KEY_RUNNER_DAY(day);
      await kvZAddGt(dkey, packed, member);
      await kvExpire(dkey, RUNNER_DAY_TTL);
      await kvZTrimTop(dkey, BOARD_KEEP);
    }
    const rank = await kvZRevRank(KEY_RUNNER, member);
    return NextResponse.json(
      { ok: true, rank: rank == null ? null : rank + 1 },
      { headers: rl.headers },
    );
  }

  if (game === "wen") {
    // Day freshness is enforced above (replay verification), so every
    // accepted post writes both boards.
    const sats = Math.round(score);
    await kvZAddGt(KEY_WEN, sats, member);
    await kvExpire(KEY_WEN, WEN_BOARD_TTL);
    await kvZTrimTop(KEY_WEN, BOARD_KEEP);
    const dkey = KEY_WEN_DAY(day);
    await kvZAddGt(dkey, sats, member);
    await kvExpire(dkey, WEN_DAY_TTL);
    await kvZTrimTop(dkey, BOARD_KEEP);
    // Rank returned is the DAILY one · the race that matters for a
    // one-play-per-day game.
    const rank = await kvZRevRank(dkey, member);
    return NextResponse.json(
      { ok: true, rank: rank == null ? null : rank + 1 },
      { headers: rl.headers },
    );
  }

  if (game === "trail") {
    // Same two-board shape as WEN: all-time hall of fame + today's race.
    const sats = Math.round(score);
    await kvZAddGt(KEY_TRAIL, sats, member);
    await kvExpire(KEY_TRAIL, TRAIL_BOARD_TTL);
    await kvZTrimTop(KEY_TRAIL, BOARD_KEEP);
    const dkey = KEY_TRAIL_DAY(day);
    await kvZAddGt(dkey, sats, member);
    await kvExpire(dkey, TRAIL_DAY_TTL);
    await kvZTrimTop(dkey, BOARD_KEEP);
    const rank = await kvZRevRank(dkey, member);
    return NextResponse.json(
      { ok: true, rank: rank == null ? null : rank + 1 },
      { headers: rl.headers },
    );
  }

  if (game === "saylor") {
    await kvZAddGt(KEY_SAYLOR, score, member);
    await kvExpire(KEY_SAYLOR, SAYLOR_BOARD_TTL);
    await kvZTrimTop(KEY_SAYLOR, BOARD_KEEP);
    const rank = await kvZRevRank(KEY_SAYLOR, member);
    return NextResponse.json(
      { ok: true, rank: rank == null ? null : rank + 1 },
      { headers: rl.headers },
    );
  }

  if (game === "summit") {
    // Daily board only · the rank returned is today's race position.
    const key = KEY_SUMMIT_DAY(day);
    await kvZAddGt(key, score, member);
    await kvExpire(key, SUMMIT_DAY_TTL);
    await kvZTrimTop(key, BOARD_KEEP);
    const rank = await kvZRevRank(key, member);
    return NextResponse.json(
      { ok: true, rank: rank == null ? null : rank + 1 },
      { headers: rl.headers },
    );
  }

  if (game === "chop") {
    // Daily board only · today's chain, today's cuts.
    const key = KEY_CHOP_DAY(day);
    await kvZAddGt(key, score, member);
    await kvExpire(key, CHOP_DAY_TTL);
    await kvZTrimTop(key, BOARD_KEEP);
    const rank = await kvZRevRank(key, member);
    return NextResponse.json(
      { ok: true, rank: rank == null ? null : rank + 1 },
      { headers: rl.headers },
    );
  }

  if (game === "kart") {
    // Daily Circuit board only · today's combo, today's race.
    const key = KEY_KART_DAY(day);
    await kvZAddGt(key, score, member);
    await kvExpire(key, KART_DAY_TTL);
    await kvZTrimTop(key, BOARD_KEEP);
    const rank = await kvZRevRank(key, member);
    return NextResponse.json(
      { ok: true, rank: rank == null ? null : rank + 1 },
      { headers: rl.headers },
    );
  }

  // Timechain: sats banked, with the chain height packed into the
  // fraction (min(height,999)/1000 · display splits it back apart).
  // Same top-N cap + rolling TTL as the runner board.
  const sats = Math.floor(score);
  const hfrac = Math.max(0, Math.min(0.9999, score - sats));
  const pts = sats + hfrac;
  await kvZAddGt(KEY_HORIZON, pts, member);
  await kvExpire(KEY_HORIZON, HORIZON_BOARD_TTL);
  await kvZTrimTop(KEY_HORIZON, BOARD_KEEP);
  const rank = await kvZRevRank(KEY_HORIZON, member);
  return NextResponse.json(
    { ok: true, rank: rank == null ? null : rank + 1 },
    { headers: rl.headers },
  );
}
