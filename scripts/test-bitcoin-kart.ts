// BITCOIN KART invariants · mirrors the test-super-saylor.ts contract style.
// The game's data modules are pure ESM with no DOM access, so this suite
// imports them directly instead of regex-parsing sentinel markers.
//
// Run: npx tsx scripts/test-bitcoin-kart.ts   (wired into `npm run verify`)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { MINIFY_OPTS } from "./build-kart.mjs";

import {
  ROSTER, BOSSES, TRACKS, CUPS, CUP_POINTS, WORLDS, GATES, CODEX, COPY,
  ITEMS, ITEM_WEIGHTS, DEFAULT_DRIVER, TAGLINE, SHARE_URL, NS,
  balloonsForResult, CLASSES, MIRROR_DESC, kartDayNumber, dailyCombo, KART_BASE_MS,
  CHALLENGES,
} from "../public/bitcoin-kart/js/data.js";
import { THEMES, MUSIC_KEYS } from "../public/bitcoin-kart/js/music.js";
import {
  scoreToken as clientToken, dailyScore, HANDLE_ADJ, HANDLE_NOUN,
} from "../public/bitcoin-kart/js/board.js";
import { scoreToken as libToken } from "../src/lib/arcade-token";
import { buildTrack } from "../public/bitcoin-kart/js/track.js";
import { makeKart, stepKart, wrapAngle, chaseNear } from "../public/bitcoin-kart/js/physics.js";
import { aiInput } from "../public/bitcoin-kart/js/ai.js";
import { SETTINGS_DEFAULTS } from "../public/bitcoin-kart/js/data.js";
import { gauntletNumber, kartComboFor } from "../src/lib/gauntlet-day";
import { validateGhostFrames, framesMatchTime, validateDareMeta, KART_DARE_ID_RE, kartDailyScore, KART_GHOST_BASE_MS, KART_GHOST_MIN_MS } from "../src/lib/kart-ghost";
import {
  encodeKartCard, decodeKartCard, formatKartCardTime,
  KART_TRACK_IDS, KART_TRACK_NAMES, KART_DRIVER_IDS, KART_DRIVER_NAMES,
  KART_CLASS_LABELS,
} from "../src/lib/kart-card";

let pass = 0;
let fail = 0;
function ok(cond: unknown, msg: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error("  ✗ " + msg);
  }
}

const ROOT = join(process.cwd(), "public", "bitcoin-kart");

function allGameFiles(dir = ROOT): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...allGameFiles(p));
    else out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · roster");

const EXPECTED_STATS: Record<string, number[]> = {
  // speed / accel / handling / weight / itemLuck · exact per the 2026-07-16
  // buff-only rebalance (the kart roster balance notes): field raised toward saylor, NO stat reduced anywhere.
  // Gate: scripts/sim-kart-balance.ts asserts unlocked race-time spread.
  saylor: [9, 5, 4, 9, 5],
  phong: [8, 7, 6, 6, 6],
  wizard: [7, 6, 7, 5, 9],
  mallers: [8, 9, 6, 4, 6],
  bukele: [8, 6, 7, 6, 6],
  satoshi: [10, 10, 10, 10, 10], // maxed reward pick (operator 2026-07-18)
  schiff: [7, 6, 5, 9, 5],
  dimon: [7, 5, 5, 10, 4],
  warren: [7, 6, 6, 7, 7],
  buffett: [7, 5, 6, 9, 5],
  cuban: [8, 7, 6, 6, 6],
};

ok(ROSTER.length === 11, "roster has 11 slots (got " + ROSTER.length + ")");
ok(DEFAULT_DRIVER === "saylor", "default selected driver is saylor");

// team framing (operator decision 2026-07-14): these are real people, so
// the sides are TEAM BITCOIN vs TEAM FIAT, never hero/villain.
const teamBtc = ROSTER.filter((d: any) => d.side === "btc");
const teamFiat = ROSTER.filter((d: any) => d.side === "fiat");
ok(teamBtc.length === 6, "6 on Team Bitcoin incl. satoshi (got " + teamBtc.length + ")");
ok(teamFiat.length === 5, "5 on Team Fiat (got " + teamFiat.length + ")");
ok(ROSTER.every((d: any) => d.side === "btc" || d.side === "fiat"), "no hero/villain side values remain");
ok((COPY as any).teams && (COPY as any).teams.btc === "TEAM BITCOIN" && (COPY as any).teams.fiat === "TEAM FIAT", "team display names locked");
ok(Object.values(BOSSES).every((b: any) => b.side === "fiat"), "boss rivals ride for Team Fiat");

for (const d of ROSTER as any[]) {
  const exp = EXPECTED_STATS[d.id];
  ok(!!exp, "driver id " + d.id + " is in the locked roster set");
  if (exp) {
    const got = [d.stats.speed, d.stats.accel, d.stats.handling, d.stats.weight, d.stats.itemLuck];
    ok(got.join(",") === exp.join(","), d.id + " stats match the brief (" + got.join("/") + ")");
    const total = got.reduce((a, b) => a + b, 0);
    // satoshi is the maxed unlock reward · everyone else stays in the band
    if (d.id === "satoshi") ok(total === 50, "satoshi is maxed at 50 (got " + total + ")");
    else ok(total >= 28 && total <= 34, d.id + " stat total ~30±2 window (got " + total + ")");
  }
  ok(Array.isArray(d.taunts) && d.taunts.length >= 6, d.id + " has 6+ taunts");
  // quote-flavored banks (2026-07-14): humans carry 10+ lines so a
  // 3-lap race rarely repeats; satoshi stays protocol-voiced (6-8
  // fragments). Every line must fit the 240px bubble (~58 char ceiling).
  if (d.id !== "satoshi") ok(d.taunts.length >= 10, d.id + " has a 10+ line quote bank");
  ok(d.taunts.every((t: string) => t.length <= 58), d.id + " taunts fit the bubble (<=58 chars)");
  ok(typeof d.bio === "string" && d.bio.length <= 90, d.id + " bio <= 90 chars");
  ok(d.palette && d.palette.body && d.palette.accent, d.id + " has a kart palette");
  ok(typeof d.signature === "string" && d.signature.length > 0, d.id + " has a signature line");
}

const unlockedAtStart = ROSTER.filter((d: any) => d.unlocked);
ok(unlockedAtStart.length === 10, "exactly 10 racers start unlocked (got " + unlockedAtStart.length + ")");
const satoshi = ROSTER.find((d: any) => d.id === "satoshi") as any;
ok(satoshi && satoshi.unlocked === false, "satoshi starts locked");
ok(satoshi && satoshi.unlock && satoshi.unlock.corporateAccess === true, "satoshi unlock requires corporate access");
ok(satoshi && satoshi.unlock && satoshi.unlock.beatSchiff === true, "satoshi unlock requires beating Schiff");
ok(satoshi && satoshi.unlock && satoshi.unlock.balloons === 12, "satoshi unlock requires 12 Orange Balloons");
ok(satoshi && typeof satoshi.lockHint === "string" && satoshi.lockHint.includes("Recover the signal"), "satoshi lock hint present");

ok(!!BOSSES.bear2014 && !!BOSSES.headline, "boss rivals bear2014 + headline defined");
for (const b of Object.values(BOSSES) as any[]) {
  ok(b.taunts.length >= 8, b.id + " has an 8+ line boss bank");
  ok(b.taunts.every((t: string) => t.length <= 58), b.id + " taunts fit the bubble");
}
// satoshi never trash-talks · protocol fragments only (short, no prose)
{
  const s = (ROSTER as any[]).find((d) => d.id === "satoshi");
  ok(s.taunts.every((t: string) => t.length <= 16), "satoshi stays protocol-voiced (fragments only)");
}
// anti-repeat pick is wired (race.js tauntLine nudges off the last index)
{
  const raceSrc0 = readFileSync(join(ROOT, "js", "race.js"), "utf8");
  ok(raceSrc0.includes("lastTauntIdx"), "taunt picks avoid immediate repeats");
}
const schiff = ROSTER.find((d: any) => d.id === "schiff") as any;
ok(schiff && schiff.sig && schiff.sig.finalBoss === true, "schiff carries the final-boss flag");

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · events, worlds, cups");

const EXPECTED_EVENTS = [
  "pizza-beach", "genesis-circuit", "gox-docks", "winter-2014",
  "blocksize-fog", "euphoria-neon", "printer-runway", "obituary-alley",
  "glass-tower-loop", "etf-dawn", "one-chair-peak", "schiff-gold-mine",
];
ok(TRACKS.length === 12, "12 events present (got " + TRACKS.length + ")");
ok(
  EXPECTED_EVENTS.every((id) => (TRACKS as any[]).some((t) => t.id === id)),
  "all 12 expected event ids present",
);

for (const t of TRACKS as any[]) {
  ok(Array.isArray(t.pts) && t.pts.length >= 10, t.id + " spline has 10+ control points");
  ok(t.pts.every((p: number[]) => p.length === 3), t.id + " control points are [x,y,z]");
  ok(t.width >= 12 && t.width <= 18, t.id + " width in the 12..18 band");
  // lap tuning 2026-07-14: short circuits (<890u measured) run 4 laps so
  // races keep an item-comeback arc; longer tracks stay at 3
  ok(t.laps === 3 || t.laps === 4, t.id + " runs 3 or 4 laps");
  ok(Array.isArray(t.boxes) && t.boxes.length >= 3, t.id + " has 3+ item box clusters");
  ok(Array.isArray(t.boost) && t.boost.length >= 2, t.id + " has 2+ boost pads");
  ok(Array.isArray(t.sats) && t.sats.length >= 3, t.id + " has 3+ sat trails");
  ok(Array.isArray(t.billboards) && t.billboards.length >= 4, t.id + " has 4+ billboards (culture density floor)");
  ok(typeof t.tip === "string" && t.tip.length > 0, t.id + " has a loading tip");
  ok((THEMES as any)[t.music], t.id + " music key '" + t.music + "' exists in THEMES");
}

const bossMap: Record<string, string> = { "winter-2014": "bear2014", "obituary-alley": "headline", "schiff-gold-mine": "schiff" };
for (const [tid, boss] of Object.entries(bossMap)) {
  const t = (TRACKS as any[]).find((x) => x.id === tid);
  ok(t && t.boss === boss, tid + " is a boss race vs " + boss);
  ok((GATES as any)[tid] && (GATES as any)[tid].balloons > 0, tid + " has a balloon gate");
}
ok((GATES as any)["schiff-gold-mine"].balloons === 12, "final gate costs 12 balloons");

ok((WORLDS as any[]).length === 3, "three worlds");
ok((WORLDS as any[]).map((w) => w.cost).join(",") === "0,5,10", "world door costs 0/5/10");
for (const w of WORLDS as any[]) {
  const n = (TRACKS as any[]).filter((t) => t.world === w.id).length;
  ok(n === 4, w.id + " world has 4 events (got " + n + ")");
}

ok((CUPS as any[]).length === 3, "three cups");
const cupEvents = (CUPS as any[]).flatMap((c) => c.events);
ok(cupEvents.length === 12 && new Set(cupEvents).size === 12, "cups cover all 12 events exactly once");
ok(cupEvents.every((id: string) => EXPECTED_EVENTS.includes(id)), "cup event ids all valid");
ok(CUP_POINTS.join(",") === "10,8,6,4,3,2,1,0", "cup points 10-8-6-4-3-2-1-0");

ok(balloonsForResult(1, false) === 2 && balloonsForResult(3, false) === 1 && balloonsForResult(4, false) === 0, "balloon awards: 1st=2, top3=1, else 0");
ok(balloonsForResult(1, true) === 2 && balloonsForResult(2, true) === 0, "boss balloons: only 1st pays");
ok(balloonsForResult(1, false, true) === 3 && balloonsForResult(1, true, true) === 3, "full-sat-stack win pays the third challenge balloon");
ok(balloonsForResult(2, false, true) === 1, "full stack without the win pays nothing extra");

// track set pieces (v1.3 · epic-air pass 2026-07-18): jumps, tunnels, falls
const jumps = (TRACKS as any[]).filter((t) => Array.isArray(t.jumps) && t.jumps.length > 0);
const tunnels = (TRACKS as any[]).filter((t) => Array.isArray(t.tunnels) && t.tunnels.length > 0);
const hazards = (TRACKS as any[]).filter((t) => Array.isArray(t.hazards) && t.hazards.length > 0);
ok(jumps.length === 12, "EVERY track carries ramp jumps (got " + jumps.length + ")");
ok(tunnels.length >= 4, "4+ tracks carry tunnels (got " + tunnels.length + ")");
ok(hazards.length >= 3, "3+ tracks carry open fall edges (got " + hazards.length + ")");
// vertical identity (operator mandate 2026-07-18): every track must own a
// SIGNATURE lip (h >= 5.5) so cups stop sharing the same polite hop · the
// h ceiling is 9 (slope saturates the physics 0.55 launch clamp near 8-10)
// and per-jump launch boost stays inside the 1..1.4 authored band
ok(
  (TRACKS as any[]).every((t) => (t.jumps || []).some((j: any) => j.h >= 5.5)),
  "every track has a signature mega jump (h >= 5.5)",
);
for (const t of TRACKS as any[]) {
  for (const j of t.jumps || []) {
    ok(j.t > 0 && j.t < 1 && j.h > 0 && j.h <= 9, t.id + " jump params sane");
    ok(j.boost === undefined || (j.boost > 1 && j.boost <= 1.4), t.id + " jump boost in the authored band");
  }
  for (const tn of t.tunnels || []) ok(tn.t0 >= 0 && tn.t1 > tn.t0 && tn.t1 < 1, t.id + " tunnel window sane");
  for (const hz of t.hazards || []) {
    ok(hz.t0 >= 0 && hz.t1 > hz.t0 && hz.t1 < 1, t.id + " hazard window sane");
    ok(hz.side === "out" || hz.side === "in", t.id + " hazard side is out/in");
  }
}

// engine classes
ok(CLASSES.bits.mult === 1 && CLASSES.sats.mult < 1 && CLASSES.fullsend.mult > 1, "engine class multipliers ordered");
ok(Object.values(CLASSES).every((c: any) => typeof c.desc === "string" && c.desc.length > 8), "every engine class explains itself");
ok(typeof MIRROR_DESC === "string" && MIRROR_DESC.length > 8, "mirror mode explains itself");

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · Daily Circuit (cross-file drift guards)");

// day numbering shares the sitewide arcade epoch exactly
for (const ms of [Date.UTC(2026, 6, 8, 0, 1), Date.UTC(2026, 6, 14, 12), Date.UTC(2026, 11, 31, 23, 59)]) {
  ok(kartDayNumber(ms) === gauntletNumber(ms), "kart day matches gauntlet day for " + new Date(ms).toISOString());
}

// the integrity token replica is byte-for-byte the shared lib
for (const [g, s, d, n] of [["kart", 512345, 7, "Orange Racer #123"], ["kart", 1, 400, "Molten Chair #999"], ["saylor", 42, null, "x y #101"]] as const) {
  ok(clientToken(g, s as number, d as number | null, n) === libToken(g, s as number, d as number | null, n),
    "token replica matches lib for " + g + "/" + s);
}

// daily combo: deterministic, valid, and the rotation visits every track
{
  const a = dailyCombo(37), b = dailyCombo(37);
  ok(a.trackId === b.trackId && a.klass === b.klass && a.mirror === b.mirror, "dailyCombo is deterministic");
  const seen = new Set<string>();
  for (let d = 1; d <= 12; d++) seen.add(dailyCombo(d).trackId);
  ok(seen.size === 12, "12-day rotation visits every track (got " + seen.size + ")");
  // class/mirror must NOT be locked per track (day%3 and day%2 both
  // divide 12): over 6 rotations a track should see multiple variants
  const variants = new Map<string, Set<string>>();
  for (let d = 1; d <= 72; d++) {
    const c = dailyCombo(d);
    if (!variants.has(c.trackId)) variants.set(c.trackId, new Set());
    variants.get(c.trackId)!.add(c.klass + ":" + c.mirror);
  }
  let multi = 0;
  for (const v of variants.values()) if (v.size >= 2) multi++;
  ok(multi >= 10, "class/mirror vary per track across rotations (" + multi + "/12 tracks have 2+ variants)");
  for (let d = 1; d <= 30; d++) {
    const c = dailyCombo(d);
    ok(!!(TRACKS as any[]).find((t) => t.id === c.trackId), "day " + d + " combo track exists");
    ok(!!(CLASSES as any)[c.klass], "day " + d + " combo class exists");
  }
}

// the Next-side mirror (social drafts, /today, header chip) must track
// dailyCombo() exactly · same contract as summitLevelFor
{
  const okKlass: Record<string, string> = { sats: "SATS", bits: "BITS", fullsend: "FULL SEND" };
  let drift = 0;
  for (let d = 1; d <= 90; d++) {
    const game = dailyCombo(d);
    const mirror = kartComboFor(d);
    const name = (TRACKS as any[]).find((t) => t.id === game.trackId)!.name;
    if (mirror.track !== name || mirror.klass !== okKlass[game.klass] || mirror.mirror !== game.mirror) drift++;
  }
  ok(drift === 0, "kartComboFor (src/lib/gauntlet-day) mirrors dailyCombo exactly over 90 days (" + drift + " drifted)");
}

// score packing + server bounds drift guards
ok(dailyScore(95_000) === KART_BASE_MS - 95_000, "daily score = base - ms");
ok(dailyScore(KART_BASE_MS + 999) === 1, "over-cap runs clamp to the floor");
// A sub-60s finish is REAL: lib/kart-ghost measured a ~56s best with
// satoshi on FULL SEND, which is why the ghost floor is 40s. The board
// envelope has to record those runs rather than flatten them, because
// the arcade backend is ZADD GT: every sub-60s run scoring the identical
// ceiling means the player's row can never improve again, and the board
// renders the time back as base - score, i.e. a permanent 1:00.000.
ok(dailyScore(45_000) === KART_BASE_MS - 45_000, "a genuine 45s finish keeps its real time");
ok(dailyScore(45_000) > dailyScore(52_000), "a faster sub-60s run outranks a slower sub-60s run");
const scoreRoute = readFileSync(join(process.cwd(), "src", "app", "api", "arcade", "score", "route.ts"), "utf8");
ok(scoreRoute.includes('b.game === "kart"'), "score route accepts game 'kart'");
ok(scoreRoute.includes("gm:lb:kart:day:v1"), "score route writes the versioned kart day board");
ok(scoreRoute.includes("KART_BASE = 600_000") && KART_BASE_MS === 600000, "KART_BASE matches the client constant");
// The envelope floor lives in three places (board.js, the score route,
// lib/kart-ghost). They disagreed once and it cost every sub-minute
// finish its time, so pin all three together.
ok(scoreRoute.includes("KART_FLOOR = 40_000"), "score route floor is the physical floor");
ok(KART_BASE_MS - dailyScore(1) === KART_GHOST_MIN_MS, "board envelope floor equals the ghost physical floor");
const scoresRoute = readFileSync(join(process.cwd(), "src", "app", "api", "arcade", "scores", "route.ts"), "utf8");
ok(scoresRoute.includes('game !== "kart"') && scoresRoute.includes("gm:lb:kart:day:v1"), "scores route reads the kart day board");

// handle generator: every pool combo passes the server HANDLE_RE and the
// digit roll filters "88" (checked in source · house rule)
const API_HANDLE_RE = /^[A-Za-z][A-Za-z-]{1,14}[A-Za-z] [A-Za-z][A-Za-z ]{1,14}[A-Za-z] #\d{3}$/;
for (const a of HANDLE_ADJ) {
  for (const nn of HANDLE_NOUN) {
    ok(API_HANDLE_RE.test(a + " " + nn + " #123"), "handle combo passes API regex: " + a + " " + nn);
  }
}
const boardJs = readFileSync(join(ROOT, "js", "board.js"), "utf8");
ok(boardJs.includes('includes("88")'), "handle digits filter the 88 house rule");

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · items");

const EXPECTED_ITEMS = ["peel", "fud", "ratio", "hammer", "laser", "chair", "bolt", "headline", "shield", "pill", "goldbar"];
ok(EXPECTED_ITEMS.every((id) => (ITEMS as any)[id]), "all 11 item nouns present");
for (const bucket of ["lead", "mid", "tail"] as const) {
  const w = (ITEM_WEIGHTS as any)[bucket];
  ok(w && Object.keys(w).length > 0, "item weight bucket '" + bucket + "' present");
  ok(Object.keys(w).every((id) => (ITEMS as any)[id]), bucket + " bucket references valid items");
}
ok(!(ITEM_WEIGHTS as any).lead.chair, "leader can never roll the One Chair");
ok((ITEM_WEIGHTS as any).tail.chair > 0, "tail of the pack can roll the One Chair");

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · codex + copy");

ok((CODEX as any[]).length === 12, "codex has 12 rules");
ok((CODEX as any[]).every((r, i) => r.id === i + 1), "codex ids run 1..12");
ok(
  (CODEX as any[]).every((r) => EXPECTED_EVENTS.includes(r.event)) &&
  new Set((CODEX as any[]).map((r) => r.event)).size === 12,
  "one codex rule per event",
);

ok(COPY.disclaimer.includes("not affiliated with Strategy Inc."), "disclaimer names Strategy Inc.");
ok(COPY.disclaimer.includes("not affiliated with Nintendo"), "disclaimer names Nintendo non-affiliation");
ok(COPY.disclaimer.includes("not financial advice"), "disclaimer includes not-financial-advice");
ok(TAGLINE === "One chair. Ten racers. No second best.", "tagline locked");
ok(SHARE_URL === "https://galaxymind.space/bitcoin-kart", "share URL locked");
ok(NS === "gm:bitcoin-kart:", "save namespace locked");
ok(COPY.tips.length >= 10, "10+ loading tips");
ok(COPY.victory.includes("TIMELINE RESTORED"), "victory copy present");

// cause-flavored hit callouts: one pool per spin-capable item entity, so
// PAPER HANDS fires on a peel and REGULATED on the hammer (items.js passes
// ent.type through spinOut as the cause)
for (const cause of ["peel", "headline", "fud", "ratio", "goldbar", "hammer"]) {
  const pool = (COPY.raceEvents as any).causes?.[cause];
  ok(Array.isArray(pool) && pool.length >= 1, "hit callout pool for '" + cause + "'");
}
ok(
  typeof (COPY.raceEvents as any).pill?.stole === "string" && typeof (COPY.raceEvents as any).pill?.consolation === "string",
  "orange pill feedback lines (steal + consolation) present",
);
ok(typeof (COPY.raceEvents as any).pill?.robbed === "string", "pill victim feedback line present");

// Tier 1 · challenges are data-driven, cosmetic, and unique
ok((CHALLENGES as any[]).length === 10, "ten challenges on the shelf (engagement pack 2026-07-21)");
ok(new Set((CHALLENGES as any[]).map((c) => c.id)).size === (CHALLENGES as any[]).length, "challenge ids unique");
ok((CHALLENGES as any[]).every((c) => c.title && c.desc), "every challenge has title + desc");

// Tier 1 · world-leader ghost validators (src/lib/kart-ghost)
{
  const mkFrames = (n: number) => Array.from({ length: n }, (_, i) => [i * 0.5, 1.2, -i * 0.3, 0.01 * i]);
  const good = validateGhostFrames(mkFrames(1200));
  ok(!!good && good.length === 1200, "a legal 2-minute frame list validates");
  ok(good![5].every((v, j) => v === Math.round(mkFrames(1200)[5][j] * (j === 3 ? 100 : 10)) / (j === 3 ? 100 : 10)), "frames re-quantize server-side");
  ok(validateGhostFrames(mkFrames(10)) === null, "too-short ghost rejected");
  ok(validateGhostFrames(mkFrames(9000)) === null, "too-long ghost rejected");
  ok(validateGhostFrames([...mkFrames(500), [1, 2, 3]]) === null, "3-tuple frame rejected");
  ok(validateGhostFrames([...mkFrames(500), [1, 2, NaN, 0]]) === null, "NaN frame rejected");
  ok(validateGhostFrames([...mkFrames(500), [5000, 0, 0, 0]]) === null, "out-of-world frame rejected");
  ok(framesMatchTime(1200, 120_000), "1200 frames matches a 2:00 run");
  ok(!framesMatchTime(5400, 120_000), "9 minutes of frames cannot be a 2:00 run's ghost");
  const ghostRoute = readFileSync(join(process.cwd(), "src", "app", "api", "arcade", "kart-ghost", "route.ts"), "utf8");
  ok(ghostRoute.includes("gm:lb:kart:day:v1") && ghostRoute.includes("kvZTop"), "ghost route checks leadership against the live daily board");
  ok(ghostRoute.includes("stale_day"), "ghost route enforces day freshness");
  const boardSrc = readFileSync(join(ROOT, "js", "board.js"), "utf8");
  ok(boardSrc.includes("uploadLeaderGhost") && boardSrc.includes("fetchLeaderGhost"), "board client ships ghost upload + fetch");
  const mainSrc = readFileSync(join(ROOT, "js", "main.js"), "utf8");
  ok(mainSrc.includes("setRivalGhost"), "main.js injects the rival ghost into the race");
  ok(mainSrc.includes("awardChallenge"), "main.js awards challenges at the finish line");
}

// bug-audit v3 regression guards (2026-07-14)
{
  // H1 · every surfaceImmune value maps to a real theme surface
  const trackSrc = readFileSync(join(ROOT, "js", "track.js"), "utf8");
  const surfaces = new Set([...trackSrc.matchAll(/surface: "([a-z]+)"/g)].map((m) => m[1]));
  ok(surfaces.size >= 6, "theme surface set parsed (" + surfaces.size + " kinds)");
  for (const d of [...(ROSTER as any[]), ...(Object.values(BOSSES) as any[])]) {
    for (const s of (d.sig && d.sig.surfaceImmune) || []) {
      ok(surfaces.has(s), (d.id || d.displayName) + " surfaceImmune '" + s + "' exists in the theme surface set");
    }
  }
  // H2 · lap contract: grid spawns just before the line + wrap thresholds
  ok(trackSrc.includes("S.total - (9"), "start grid spawns just before the finish line (lap contract)");
  const physSrc = readFileSync(join(ROOT, "js", "physics.js"), "utf8");
  ok(physSrc.includes("total * 0.85") && physSrc.includes("total * 0.15"), "lap wrap thresholds locked");
  ok(physSrc.includes("k.lap = Math.max(0, k.lap - 1)"), "reverse over the line can never take lap below 0 (M1)");
  // balloon award matrix
  ok(balloonsForResult(1, false, true) === 3 && balloonsForResult(1, false, false) === 2, "1st = 2 balloons · 3 with full sats");
  ok(balloonsForResult(2, false, false) === 1 && balloonsForResult(3, false, true) === 1 && balloonsForResult(4, false, false) === 0, "top three = 1 · below = 0");
  ok(balloonsForResult(1, true, false) === 2 && balloonsForResult(1, true, true) === 3 && balloonsForResult(2, true, false) === 0, "boss matrix: win only");
  // M10 · sw PRECACHE covers every shipped js/css file
  const swSrc = readFileSync(join(ROOT, "sw.js"), "utf8");
  for (const f of allGameFiles()) {
    if ((!f.endsWith(".js") && !f.endsWith(".css")) || f.endsWith("sw.js")) continue;
    const rel = "/bitcoin-kart" + f.split("bitcoin-kart")[1];
    ok(swSrc.includes('"' + rel + '"'), "sw PRECACHE includes " + rel);
  }
  // M5/M6 · shield absorb is not a hit · One Chair smashes traps
  ok(physSrc.includes('return "shield"') && physSrc.includes('return "spun"'), "spinOut reports absorb vs spin (M5)");
  const itemsSrc = readFileSync(join(ROOT, "js", "items.js"), "utf8");
  ok(itemsSrc.includes('=== "spun"'), "item callouts fire only on real spins (M5)");
  ok(itemsSrc.includes("trapSmash"), "One Chair smashes traps instead of hoarding them (M6)");
  ok(!/e\.life > \d/.test(itemsSrc), "owner-immunity windows unified on armT (M9)");
  // H3 · pause contract
  const mainSrc3 = readFileSync(join(ROOT, "js", "main.js"), "utf8");
  ok(/if \(!racePaused\) \{?\s*\n?\s*race\.update/.test(mainSrc3), "sim freeze rides racePaused, not the overlay string (H3)");
  ok(mainSrc3.includes("BACK TO PAUSE"), "settings from pause returns to pause (H3)");
  ok(physSrc.includes("trapImmuneT"), "post-rescue trap grace exists (L1)");
  // M11 · per-boss clear lines
  for (const b of ["bear2014", "headline", "schiff"]) {
    ok(typeof (COPY.adventure as any).bossCleared?.[b] === "string", "boss clear line for " + b);
  }
  // results award composition (audit 2026-07-19): never "BOSS CLEARED · Cleared…"
  for (const b of ["bear2014", "headline", "schiff"]) {
    const body = (COPY.adventure as any).bossCleared[b] as string;
    ok(!/^cleared\b/i.test(body.trim()), "bossCleared." + b + " does not restate Cleared (prefix is BOSS CLEARED ·)");
    const composed = "BOSS CLEARED · " + body;
    ok(!/BOSS CLEARED · Cleared/i.test(composed), "composed boss award for " + b + " is not double-cleared");
  }
  ok(typeof (COPY.adventure as any).goldenSatoshi === "string" && typeof (COPY.adventure as any).goldenSatoshiSub === "string",
    "golden unlock ships title + subtitle as separate copy keys");
  ok(mainSrc3.includes('awards.push("★ " + COPY.adventure.goldenSatoshi)') &&
    mainSrc3.includes("awards.push(COPY.adventure.goldenSatoshiSub)"),
    "golden unlock pushes title and subtitle as separate award lines");
  ok(mainSrc3.includes("if (!def || !playerRow)") && mainSrc3.includes("if (!t || !playerRow)"),
    "finishRace + renderResults guard missing track/player (no white-screen)");
}

// Tier 2 · flavor layer drift guards
{
  const hubSrc = readFileSync(join(ROOT, "js", "hub.js"), "utf8");
  ok(hubSrc.includes("NON-REFUNDABLE") && hubSrc.includes("ratioBear"), "atoll gags present (vendor sign + weeping-angel bear)");
  ok(hubSrc.includes("> 0.55"), "ratio bear freezes inside the visibility cone");
  const audioSrc2 = readFileSync(join(ROOT, "js", "audio.js"), "utf8");
  ok(audioSrc2.includes("setLayer") && audioSrc2.includes("this.layerOn = false"), "P1 music layer wired and reset on theme change");
  ok(audioSrc2.includes('surface === "ice"'), "surface-flavored skid loop");
  const raceSrc2 = readFileSync(join(ROOT, "js", "race.js"), "utf8");
  ok(raceSrc2.includes("Snd.setLayer("), "race drives the P1 layer off live rank");
  ok(raceSrc2.includes("hud.offRoad(") && raceSrc2.includes("wrongBeepT"), "off-road vignette + wrong-way beep driven");
  const mainSrc2 = readFileSync(join(ROOT, "js", "main.js"), "utf8");
  ok(mainSrc2.includes("vibrationActuator"), "gamepad rumble rides buzz()");
}

// v1.6 juice pass · source-level drift guards
{
  const raceSrc = readFileSync(join(ROOT, "js", "race.js"), "utf8");
  ok(
    raceSrc.includes('bear2014: { type: "peel"') &&
    raceSrc.includes('headline: { type: "headline"') &&
    raceSrc.includes('schiff: { type: "goldbar"'),
    "boss phases define all three signature drops",
  );
  ok(raceSrc.includes("finalLapOnly: true"), "schiff goldbar rain is final-lap gated");
  ok(raceSrc.includes("function speak(") && raceSrc.includes("projectToScreen"), "world-space taunt bubbles wired");
  const audioSrc = readFileSync(join(ROOT, "js", "audio.js"), "utf8");
  ok(audioSrc.includes('case "crowd"'), "crowd swell sfx composed");
}

// the laser-eyes brand moment: Saylor and Mallers carry the sig flag the
// renderer keys the emissive eye orbs off
ok((ROSTER as any[]).find((d) => d.id === "saylor")?.sig?.laserEyes === "red", "Saylor has red laser eyes");
ok((ROSTER as any[]).find((d) => d.id === "mallers")?.sig?.laserEyes === "cyan", "Mallers has cyan laser eyes");

// player-facing string sweep: no em dashes, no "88"
const playerStrings: string[] = [];
const collect = (v: unknown) => {
  if (typeof v === "string") playerStrings.push(v);
  else if (Array.isArray(v)) v.forEach(collect);
  else if (v && typeof v === "object") Object.values(v).forEach(collect);
};
collect(COPY);
collect(CODEX);
collect(CHALLENGES);
for (const d of ROSTER as any[]) { collect(d.taunts); collect(d.bio); collect(d.displayName); collect(d.signature); collect(d.kartName); }
for (const b of Object.values(BOSSES) as any[]) { collect(b.taunts); collect(b.displayName); }
for (const t of TRACKS as any[]) { collect(t.name); collect(t.intro); collect(t.tip); for (const bb of t.billboards) collect(bb.lines); }
// finale copy rides the same house rules
{
  const f = (COPY as any).finale;
  collect(f.intro); collect(f.credits);
  collect([f.hubTitle, f.hubOpen, f.hubDone, f.trackName, f.start, f.defeat, f.retry, f.victory, f.ngPlus, f.share]);
}
ok(playerStrings.every((s) => !s.includes("—")), "no em dashes in player-facing copy");
ok(playerStrings.every((s) => !s.includes("88")), "no '88' in player-facing copy");
// timeTrial moved to the {url} card/dare link in the 2026-07-16 dare pass
for (const key of ["beatSchiff", "satoshi", "cup"]) {
  ok((COPY.shareLines as any)[key].includes("galaxymind.space/bitcoin-kart"), "share line '" + key + "' links the game");
}
// win + daily route through the per-run share card instead of the bare URL
for (const key of ["win", "daily"]) {
  ok((COPY.shareLines as any)[key].includes("{url}"), "share line '" + key + "' carries the {url} card-link slot");
}
// share-funnel contract (audit 2026-07-26): EVERY grid finisher shares.
// P4-P8 ride shareLines.field, dare links race a full gentle grid, and
// the results screen offers the native-media photo companion.
{
  const f = (COPY.shareLines as any).field as string;
  ok(typeof f === "string" && f.includes("{url}") && f.includes("{rank}"), "field share line carries {rank} + {url}");
  const mainSrcShare = readFileSync(join(ROOT, "js", "main.js"), "utf8");
  ok(mainSrcShare.includes("COPY.shareLines.field"), "main.js routes P4-P8 finishers to the field share line");
  ok(!/rank <= 3\) \{\s*\n\s*\/\/ podium-wide share/.test(mainSrcShare), "share affordance is no longer gated on rank <= 3");
  ok(/mode === "challenge"\)[\s\S]{0,600}pickRivals\(selectedDriver, 7\)/.test(mainSrcShare), "dare links race a full grid (challenge mode is not solo)");
  ok(mainSrcShare.includes('ctx.mode === "challenge") gentle = true'), "dare visitors always get the eased band");
  ok(mainSrcShare.includes("capturePhotoBlob") && mainSrcShare.includes("readPixels"), "photo share captures the live GL frame");
  ok(mainSrcShare.includes('"image/png"') && !mainSrcShare.includes("video/webm"), "photo share is PNG · never WebM (X rejects it)");
}

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · road gaps (EXTREME pass 2026-07-21)");

// def.gaps removes the road deck after a ramp lip. The contract, proven by
// the game's REAL physics headless: the slowest kart in the game (lowest
// speed stat, SATS class) clears every gap at full throttle, and a
// half-throttle kart falls in (the danger is real, not decorative).
{
  const ctxProxy = new Proxy({ measureText: () => ({ width: 10 }) }, { get: (t, k2) => (k2 in t ? (t as any)[k2] : () => {}), set: () => true });
  (globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctxProxy }) };
  const stubR = { createMesh: (d: any) => d, createUVMesh: (d: any) => d, createTexture: (x: any) => x };
  const DT = 1 / 120;
  const simGap = (def: any, driverId: string, klass: string, throttle: number) => {
    const track = buildTrack(stubR, def, null);
    const S = track.S;
    const gap = def.gaps[0];
    const jump = def.jumps.reduce((a: any, b: any) => (gap.t0 - b.t <= 0.02 && b.t < gap.t0 ? b : a), def.jumps[0]);
    const i0 = Math.floor((((jump.t - 0.14) + 1) % 1) * S.n);
    const driver = (ROSTER as any[]).find((d) => d.id === driverId);
    const k = makeKart(driver, { x: S.pos[i0][0], y: S.pos[i0][1], z: S.pos[i0][2], heading: Math.atan2(S.tan[i0][0], S.tan[i0][2]) }, false, (CLASSES as any)[klass].mult);
    k.speed = k.baseSpeed * 0.85;
    k.sIdx = i0;
    let takeoff: number | null = null;
    for (let step = 0; step < 120 * 14; step++) {
      const look = (k.sIdx + (k.speed > 40 ? 18 : 10)) % S.n;
      const want = Math.atan2(S.pos[look][0] - k.pos[0], S.pos[look][2] - k.pos[2]);
      const steer = Math.max(-1, Math.min(1, wrapAngle(want - k.heading) * (k.speed > 40 ? 1.5 : 2.2)));
      const wasAir = k.airborne, wasFalling = k.falling;
      stepKart(k, { throttle, steer, drift: false }, track, DT, null);
      if (!wasAir && k.airborne && takeoff === null && Math.abs(k.sIdx - Math.floor(jump.t * S.n)) < 25) takeoff = k.sIdx;
      if (takeoff !== null && wasAir && !k.airborne && !k.falling) return { landed: k.sIdx, fell: null };
      if (!wasFalling && k.falling) return { landed: null, fell: k.sIdx };
    }
    return { landed: null, fell: null };
  };
  let gapCount = 0;
  for (const t of TRACKS as any[]) {
    for (const g of t.gaps || []) {
      gapCount++;
      ok(g.t0 > 0 && g.t1 < 1 && g.t0 < g.t1, t.id + " gap window sane");
      ok((t.jumps || []).some((j: any) => g.t0 - j.t > 0 && g.t0 - j.t < 0.02), t.id + " gap opens right off a ramp lip");
      ok((t.chasms || []).some((c: any) => c.t0 <= g.t0 && c.t1 >= g.t1), t.id + " gap rides inside its chasm");
      ok(!(t.tunnels || []).some((tn: any) => tn.t0 < g.t1 && tn.t1 > g.t0), t.id + " gap clear of tunnels");
      // no on-road pickups or pads inside the missing deck. Boxes are
      // PLAIN NUMBERS (t fractions) · the original b.t check compared
      // undefined and never fired, which is how peak shipped a box row
      // floating over the Aurora Abyss (operator-reported 2026-07-22)
      ok(!(t.boxes || []).some((b: number) => b > g.t0 && b < g.t1), t.id + " no item boxes in the gap");
      ok(!(t.boost || []).some((b: any) => b.t > g.t0 && b.t < g.t1), t.id + " no boost pads in the gap");
      ok(!(t.sats || []).some((s: any) => s.t0 < g.t1 && s.t1 > g.t0), t.id + " no sat lines in the gap");
      ok(!(t.billboards || []).some((bb: any) => bb.t > g.t0 - 0.005 && bb.t < g.t1 + 0.005), t.id + " no billboards over the gap");
    }
    if ((t.gaps || []).length) {
      const worst = simGap(t, "dimon", "sats", 1.0);
      ok(worst.landed !== null && worst.landed / 480 > t.gaps[0].t1, t.id + " slowest kart clears the gap at full throttle (landed " + (worst.landed !== null ? (worst.landed / 480).toFixed(3) : "never") + ")");
      const slow = simGap(t, "bukele", "bits", 0.5);
      ok(slow.fell !== null, t.id + " a half-throttle kart falls in (the danger is real)");
    }
  }
  ok(gapCount >= 4, "at least four real road gaps shipped (got " + gapCount + ")");
  // ---- ramp guardrail contract (operator-reported 2026-07-22) ----
  // The danger of a signature jump is the JUMP · the approach is not a
  // trap. Every jump's carve rise (16 samples) keeps its walls: no open
  // hazard window may overlap it, and no boost pad may sit inside an
  // open window (a shove with no rails is a cheap fall, not drama).
  // Billboards live on solid ground, never planted out over a chasm
  // carve (they float over the void and read edge-on from the flight).
  const RISE_T = 16 / 480;
  for (const t of TRACKS as any[]) {
    for (const j of t.jumps || []) {
      ok(!(t.hazards || []).some((hz: any) => j.t - RISE_T < hz.t1 && j.t > hz.t0),
        t.id + " jump t" + j.t + " rise keeps its guardrails");
    }
    for (const bp of t.boost || []) {
      ok(!(t.hazards || []).some((hz: any) => bp.t > hz.t0 && bp.t < hz.t1),
        t.id + " boost pad t" + bp.t + " sits on walled road");
    }
    for (const bb of t.billboards || []) {
      ok(!(t.chasms || []).some((c: any) => bb.t > c.t0 && bb.t < c.t1 && Math.abs(bb.side) > 1.2),
        t.id + " billboard t" + bb.t + " stands on solid ground");
    }
  }
  const physSrc = readFileSync(join(ROOT, "js/physics.js"), "utf8");
  ok(physSrc.includes("gapFall") && physSrc.includes("gapEndFor"), "physics turns missing-deck contact into a fall with a past-gap rescue");
  const trackSrc4 = readFileSync(join(ROOT, "js/track.js"), "utf8");
  ok(trackSrc4.includes("def.gaps") && trackSrc4.includes("gapAt"), "track.js severs the deck over gaps");
}

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · difficulty tiers (retune 2026-07-21)");

// The drift-abort fix made the fleet 20-53% faster (it had been quietly
// grinding walls), so the rubber band was re-priced. Contract, proven by
// the game's real AI + physics headless: the SATS gentle band is a real
// learning tier (meaningfully slower laps), and hard mode's 0.97 floor
// keeps bosses at least as fast as the normal band.
{
  const stubR = { createMesh: (d: any) => d, createUVMesh: (d: any) => d, createTexture: (x: any) => x };
  const DT = 1 / 120;
  const items = { ents: [] as any[] };
  // The winnability lever is the MERCY band (AI leading the player eases
  // off) · sim a lap with the player far behind so the mercy is active the
  // whole way. Solo base-band deltas are within corner-noise on short
  // tracks; the mercy deltas are structural (0.68 / 0.78 / 0.97 throttle).
  const behindPlayer = { progress: -1e9, finished: false } as any;
  const lapTime = (hard: boolean, gentle: boolean) => {
    const def = (TRACKS as any[]).find((t) => t.id === "genesis-circuit");
    const track = buildTrack(stubR, def, null);
    const S = track.S;
    const driver = (ROSTER as any[]).find((d) => d.id === "dimon");
    const k = makeKart(driver, { x: S.pos[0][0], y: S.pos[0][1], z: S.pos[0][2], heading: Math.atan2(S.tan[0][0], S.tan[0][2]) }, false, 1.0);
    k.sIdx = 0; (k as any).progress = 0; (k as any).rank = 4; (k as any).aiT = 0;
    (k as any).aiSteerHold = 0; (k as any).aiStuckT = 0; (k as any).itemCd = 0; (k as any).roulette = 0;
    let prevIdx = 0, t = 0;
    for (let step = 0; step < 120 * 120; step++) {
      const inp = aiInput(k, track, [k], items, behindPlayer, DT, hard, gentle);
      stepKart(k, inp, track, DT, null);
      t += DT;
      if (prevIdx > S.n * 0.8 && k.sIdx < S.n * 0.2) return t;
      prevIdx = k.sIdx;
    }
    return -1;
  };
  const normal = lapTime(false, false);
  const gentleT = lapTime(false, true);
  const hardT = lapTime(true, false);
  ok(normal > 0 && gentleT > 0 && hardT > 0, "all three difficulty tiers complete a lap");
  ok(gentleT > normal * 1.04, "SATS mercy leans in hardest (gentle " + gentleT.toFixed(1) + "s vs normal " + normal.toFixed(1) + "s)");
  ok(normal > hardT * 1.02, "hard mode barely eases for a trailing player (hard " + hardT.toFixed(1) + "s vs normal " + normal.toFixed(1) + "s)");
  const aiSrc2 = readFileSync(join(ROOT, "js/ai.js"), "utf8");
  ok(aiSrc2.includes("gentle") && aiSrc2.includes("difficulty retune"), "ai.js carries the retuned band with its rationale");
  const raceSrc2 = readFileSync(join(ROOT, "js/race.js"), "utf8");
  ok(raceSrc2.includes("gentleAI"), "race.js derives the gentle tier from the SATS class");
}

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · SHINE graphics pass (2026-07-22)");

{
  const glSrc2 = readFileSync(join(ROOT, "js/gl.js"), "utf8");
  // living water: analytic wave normals + sun glint + the baked foam field
  ok(glSrc2.includes("vShore") && glSrc2.includes("layout(location=2) in vec4 aColor;\nuniform mat4 uVP;"), "water shader reads the baked foam field from the color channel");
  ok(glSrc2.includes("reflect(-V, N), uSunDir"), "water carries a real sun glint path off the wave normal");
  // sheen: one term serves kart metal AND wet floors · halo pass resets it
  ok(glSrc2.includes("uSheen") && glSrc2.includes("uSheenSky"), "sky-reflection sheen term exists in the main shader");
  ok(/function glow\([\s\S]{0,400}uSheen, 0\)/.test(glSrc2), "glow() resets sheen so it never leaks into the halo pass");
  // filmic grade + DoF plumbing in the composite
  ok(glSrc2.includes("uGain") && glSrc2.includes("uLift") && glSrc2.includes("uDof"), "composite carries the per-world grade + cinema DoF uniforms");
  ok(glSrc2.includes("dofOk"), "depth resolve degrades silently when a driver refuses the target");
  ok(!glSrc2.includes("2.51 * c"), "the raw ACES fit stays out (it washed the sky to milk · S-curve instead)");
  const trackSrc5 = readFileSync(join(ROOT, "js/track.js"), "utf8");
  ok(trackSrc5.includes("env.grade") && trackSrc5.includes("env.roadSheen"), "track env carries the per-world grade + wet-floor sheen");
  ok(trackSrc5.includes("seaBed") && trackSrc5.includes("quad4"), "water build bakes the shoreline foam field from the heightfield");
  const raceSrc4 = readFileSync(join(ROOT, "js/race.js"), "utf8");
  ok(raceSrc4.includes("DUST_COL") && raceSrc4.includes("streakAcc"), "speed language shipped: surface dust + wind streaks");
  ok(raceSrc4.includes("grade: track.env.grade"), "the grade rides every present call");
  ok(raceSrc4.includes("cam.dofAmt") && raceSrc4.includes("!opts.reduceFx") , "cinema lens is per-shot and respects reduced motion");
  ok(/const rush[\s\S]{0,80}player\.speed/.test(raceSrc4), "wind streaks scale with real speed");
  ok(raceSrc4.includes("sheen: specOn"), "kart sheen rides the specular reduceFx master switch");
  const geoSrc2 = readFileSync(join(ROOT, "js/geometry.js"), "utf8");
  ok(geoSrc2.includes("quad4"), "meshBuilder ships the per-corner-color quad the foam bake needs");
}

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · difficulty system (2026-07-22)");

{
  ok(["auto", "relaxed", "standard"].includes((SETTINGS_DEFAULTS as any).difficulty), "difficulty setting exists with a sane default");
  ok((SETTINGS_DEFAULTS as any).difficulty === "auto", "dynamic assist is the default (novice protection out of the box)");
  const mainSrc4 = readFileSync(join(ROOT, "js/main.js"), "utf8");
  ok(mainSrc4.includes("assist-ranks") && mainSrc4.includes("assist-on"), "AUTO assist tracks recent finishes with hysteresis (device-local)");
  ok(mainSrc4.includes("boss-losses:"), "boss mercy counts consecutive losses per track");
  ok(mainSrc4.includes("THE BOSS BLINKS") && mainSrc4.includes("THE FIELD EASES"), "assists announce themselves · never silent");
  ok(mainSrc4.includes("DIFFICULTY"), "settings carries the difficulty row");
  const raceSrc5 = readFileSync(join(ROOT, "js/race.js"), "utf8");
  ok(raceSrc5.includes("opts.gentle") && /gentleAI = !hardAI && \(opts\.klass === "sats" \|\| !!opts\.gentle\)/.test(raceSrc5), "race honors the difficulty lever through the existing gentle band");
  // shake fix sentinels (same batch): interpolated ground + slewed lens
  const trackSrc6 = readFileSync(join(ROOT, "js/track.js"), "utf8");
  ok(trackSrc6.includes("shake fix 2026-07-22"), "surfaceQuery interpolates height along the tangent (camera judder fix)");
  ok(raceSrc5.includes("fovSpd"), "the speed lens reads slewed speed, not raw (crest pulse fix)");
}

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · RACE SCHOOL (first-play coach · 2026-07-21)");

{
  const coachSrc = readFileSync(join(ROOT, "js/coach.js"), "utf8");
  ok(coachSrc.includes("createCoach"), "coach.js ships the RACE SCHOOL module");
  ok(coachSrc.includes("coach:") && coachSrc.includes("storySeen"), "lessons persist as storySeen coach:* beat ids (cloud OR-merge for free)");
  const mainSrc2 = readFileSync(join(ROOT, "js/main.js"), "utf8");
  ok(mainSrc2.includes("createCoach(") && mainSrc2.includes("coach.observe(") && mainSrc2.includes("coach.start(") && mainSrc2.includes("coach.stop("), "main.js wires the coach into the race lifecycle");
  ok(mainSrc2.includes("coach:rocket") && mainSrc2.includes("veteran"), "veteran saves retire the basics silently at boot");
  ok(mainSrc2.includes("COACH TIPS"), "settings carries the coach off switch");
  ok(mainSrc2.includes("autoGas: touch.enabled"), "input reports machine throttle vs player throttle");
  // copy exists for every input mode the coach can meet
  const c = (COPY as any).coach;
  ok(c && c.rocketKb && c.rocketGas && c.rocketAuto && c.driftKb && c.driftTouch && c.itemKb && c.itemTouch && c.sats && c.gap, "COPY.coach covers keyboard + both touch modes");
  ok((SETTINGS_DEFAULTS as any).coachTips === true, "coach tips default ON");
  const cssSrc = readFileSync(join(ROOT, "css/style.css"), "utf8");
  ok(cssSrc.includes(".hud-coach") && cssSrc.includes(".coach-key"), "coach card + key glyph styles shipped");
  ok(cssSrc.includes("html[data-reducefx=\"1\"] .hud-coach.pop"), "coach entrance respects reduced motion");
  // the auto-gas start ritual: default mobile settings must never eat the
  // jump-start penalty (throttle is the machine's, not the player's)
  const raceSrc3 = readFileSync(join(ROOT, "js/race.js"), "utf8");
  ok(raceSrc3.includes("sawBrakeHold") && raceSrc3.includes("input.autoGas"), "auto-gas launches neutral · brake-release ritual arms the rocket start");
  ok(coachSrc.includes("pointerdown") && coachSrc.includes("driftRetired") && coachSrc.includes("coach-drift-n"), "drift card dismisses on tap and retires after two dismissals");
  ok(coachSrc.includes("curT > 5") && coachSrc.includes("curT > 4"), "drift card auto-dismisses on both stages");
  ok(cssSrc.includes(".hud-coach-dismiss") && cssSrc.includes("pointer-events: auto"), "coach card accepts taps");
  ok(mainSrc2.includes("touchAssist: !!(touch.enabled") && !mainSrc2.includes("pointerleave"), "touch drift holds through pointer capture, not pointerleave");
  ok(mainSrc2.includes('closest(".scr")'), "results pans are not eaten by the race touch lock");
  ok(cssSrc.includes("justify-content: safe center") && cssSrc.includes("-webkit-overflow-scrolling: touch"), "results screen is the scrollport");
  ok(raceSrc3.includes("chaseNear"), "chase camera scales on a short viewport");
  const desk = chaseNear(800);
  const phone = chaseNear(390);
  ok(desk.dist === 1 && desk.eye === 1, "desktop chase framing is unchanged");
  ok(phone.dist < 0.7 && phone.dist > 0.55 && phone.eye < phone.dist, "phone chase camera is closer and lower");
  ok(chaseNear(0).dist === 1, "a missing viewport does not pull the camera in");
}

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · touch drift (phone)");

{
  const ctxProxy = new Proxy({ measureText: () => ({ width: 10 }) }, { get: (t, k2) => (k2 in t ? (t as any)[k2] : () => {}), set: () => true });
  (globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctxProxy }) };
  const stubR = { createMesh: (d: any) => d, createUVMesh: (d: any) => d, createTexture: (x: any) => x };
  const def = (TRACKS as any[]).find((t) => t.id === "pizza") || (TRACKS as any[])[0];
  const track = buildTrack(stubR, def, null);
  const S = track.S;
  const i0 = Math.floor(0.22 * S.n);
  const driver = (ROSTER as any[]).find((d) => d.id === "saylor");
  const pose = {
    x: S.pos[i0][0], y: S.pos[i0][1], z: S.pos[i0][2],
    heading: Math.atan2(S.tan[i0][0], S.tan[i0][2]),
  };
  const boot = (touchAssist: boolean, steer: number) => {
    const k = makeKart(driver, pose, true, 1);
    k.speed = 36;
    k.sIdx = i0;
    stepKart(k, { throttle: 1, steer, drift: true, touchAssist }, track, 1 / 60, null);
    return k;
  };
  const shyTouch = boot(true, 0.18);
  const shyKey = boot(false, 0.18);
  ok(shyTouch.drift.active, "touch drift starts from a small stick deflection");
  ok(!shyKey.drift.active, "keyboard drift still requires a committed steer");
  const hopTouch = boot(true, 0.5);
  const hopKey = boot(false, 0.5);
  ok(hopTouch.drift.active && hopKey.drift.active, "both models enter a drift from a committed steer");
  ok(hopTouch.vy < hopKey.vy, "touch drift hops lower than the keyboard hop");
  const hold = (touchAssist: boolean) => {
    const k = boot(touchAssist, 0.45);
    const h0 = k.heading;
    let fell = false;
    for (let i = 0; i < 90; i++) {
      stepKart(k, { throttle: 1, steer: 0.15, drift: true, touchAssist }, track, 1 / 60, null);
      if (k.falling) fell = true;
    }
    return { turn: Math.abs(wrapAngle(k.heading - h0)), fell, speed: k.speed };
  };
  const phoneHold = hold(true);
  const keyHold = hold(false);
  ok(!phoneHold.fell, "a gentle touch drift stays on the road for 1.5s");
  ok(phoneHold.turn < keyHold.turn, "touch drift yaws less than the keyboard slide at the same stick");
  const physSrc = readFileSync(join(ROOT, "js/physics.js"), "utf8");
  ok(physSrc.includes("touchAssist") && physSrc.includes("4.6"), "touch drift uses the higher grip path");
}

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · epic-scale chasms (2026-07-21)");

// def.chasms carves glowing gorges around the signature jumps · the
// contract: every chasm spans its jump (the causeway flight), pairs with
// a REAL hazard fall window, and never collides with a tunnel ceiling
{
  let chasmCount = 0;
  for (const t of TRACKS as any[]) {
    for (const ch of t.chasms || []) {
      chasmCount++;
      ok(ch.t0 > 0 && ch.t1 < 1 && ch.t0 < ch.t1, t.id + " chasm window sane");
      ok(ch.w >= 10 && ch.w <= 60 && ch.depth >= 10 && ch.depth <= 34, t.id + " chasm scale in band");
      ok(ch.glow === null || /^#[0-9A-Fa-f]{6}$/.test(ch.glow), t.id + " chasm glow is hex or null (sea inlets)");
      ok((t.jumps || []).some((j: any) => j.t > ch.t0 && j.t < ch.t1), t.id + " chasm spans its jump (causeway flight contract)");
      ok((t.hazards || []).some((hz: any) => hz.t0 < ch.t1 && hz.t1 > ch.t0), t.id + " chasm has a real fall window");
      ok(!(t.tunnels || []).some((tn: any) => tn.t0 < ch.t1 && tn.t1 > ch.t0), t.id + " chasm clear of tunnels");
    }
  }
  ok(chasmCount >= 8, "at least eight chasm set pieces shipped (got " + chasmCount + ")");
  const glowing = (TRACKS as any[]).reduce((n: number, t: any) => n + (t.chasms || []).filter((c: any) => c.glow).length, 0);
  ok(glowing >= 6, "at least six chasms carry a glow river (got " + glowing + ")");
  // the mythic living-world plumbing (2026-07-21 · cap raised to 560KB)
  const trackSrc3 = readFileSync(join(ROOT, "js/track.js"), "utf8");
  ok(trackSrc3.includes("e.watch") && trackSrc3.includes("emitters"), "track.js carries watch flags + living emitters");
  const raceSrc3 = readFileSync(join(ROOT, "js/race.js"), "utf8");
  ok(raceSrc3.includes("inst.watch") && raceSrc3.includes("track.emitters"), "race.js turns watchers + feeds emitters");
  ok(raceSrc3.includes('inst.type === "holoB"') && raceSrc3.includes('inst.type === "timechainArc"'), "holo-B and the timechain spin");
  const mythicTypes = ["volcano", "wreckShip", "timechainArc", "auroraCurtain", "openingBell", "holoB"];
  for (const ty of mythicTypes) {
    ok((TRACKS as any[]).some((t: any) => (t.props || []).some((pr: any) => pr.type === ty)), "mythic prop " + ty + " placed on a track");
  }
  const emits = (TRACKS as any[]).flatMap((t: any) => (t.props || []).filter((pr: any) => pr.emit).map((pr: any) => pr.emit));
  ok(emits.length >= 2 && emits.every((e: string) => e === "paper" || e === "embers"), "living emitters are paper/embers only");
  // mountain ranges: ridge amps stay in a sane band and never ship on the
  // fog track (fogFar 150 would swallow them silently)
  for (const t of TRACKS as any[]) {
    if (t.ridge !== undefined) ok(t.ridge > 0 && t.ridge <= 60, t.id + " ridge amp in band");
  }
  ok((TRACKS as any[]).filter((t: any) => t.ridge).length >= 10, "ranges ring at least ten worlds");
  const trackSrc2 = readFileSync(join(ROOT, "js/track.js"), "utf8");
  ok(trackSrc2.includes("def.chasms") && trackSrc2.includes("chasmGlow"), "track.js carves chasms + glow floors");
  const geoSrc2 = readFileSync(join(ROOT, "js/geometry.js"), "utf8");
  ok(geoSrc2.includes("bearFin(seed)"), "bearFin prop builder shipped");
  const finCount = (TRACKS as any[]).reduce((n: number, t: any) => n + (t.props || []).filter((pr: any) => pr.type === "bearFin").length, 0);
  ok(finCount >= 10, "bear fins circle the waters (got " + finCount + ")");
}

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · story mode (THE ORANGE CIRCUIT · 2026-07-21)");

// COPY.story rides inside COPY so every string above was already swept for
// em dashes and "88" · these assert the structure the reels depend on
{
  const story = (COPY as any).story;
  ok(!!story, "COPY.story exists");
  ok(Array.isArray(story.hubArrival.cards) && story.hubArrival.cards.length >= 3, "cold open has 3+ cards");
  for (const w of ["genesis", "neon", "corporate"]) {
    ok(!!(story.worlds[w] && story.worlds[w].chapter && story.worlds[w].line), "world chapter card for " + w);
  }
  for (const g of ["neon", "corporate"]) {
    ok(Array.isArray(story.gates[g].cards) && story.gates[g].cards.length >= 2, "gate reel cards for " + g);
  }
  for (const b of ["bear2014", "headline", "schiff"]) {
    const s = story.bosses[b];
    ok(!!(s && s.title && s.pre && s.defeat), "boss theater lines for " + b);
  }
  ok(Array.isArray(story.satoshiUnlock.cards) && story.satoshiUnlock.cards.length >= 3, "signal recovery cards");
  ok(Array.isArray(story.goldenHour.cards) && story.goldenHour.cards.length >= 2, "golden hour cards");
  // every card's `at` is a sane reel progress (0..1, ascending per reel)
  for (const cards of [story.hubArrival.cards, story.gates.neon.cards, story.gates.corporate.cards, story.satoshiUnlock.cards, story.goldenHour.cards]) {
    let prev = -1;
    for (const c of cards) {
      ok(typeof c.at === "number" && c.at >= 0 && c.at < 1 && c.at > prev, "card `at` ascends within 0..1");
      prev = c.at;
    }
  }
}

// the cinema plumbing: race-side phase, hub-side reels, seen-flag gating
{
  const raceSrc = readFileSync(join(ROOT, "js/race.js"), "utf8");
  ok(raceSrc.includes('phase === "cinema"'), "race.js carries the cinema phase");
  ok(raceSrc.includes("function endCinema"), "race.js can end a reel (skip path)");
  ok(raceSrc.includes("cineOn"), "race.js drives the HUD cinema chrome");
  const hubSrc = readFileSync(join(ROOT, "js/hub.js"), "utf8");
  ok(hubSrc.includes("startCine") && hubSrc.includes("cineInfo"), "hub.js exposes the reel camera API");
  ok(hubSrc.includes("parkSatoshi"), "hub.js parks the Genesis Runner post-unlock");
  const mainSrc2 = readFileSync(join(ROOT, "js/main.js"), "utf8");
  ok(mainSrc2.includes("playHubCine"), "main.js drives hub reels");
  ok(mainSrc2.includes("buildBossCinema") && mainSrc2.includes("buildFinaleCinema") && mainSrc2.includes("buildChapterCinema"), "main.js builds all three race reels");
  ok(mainSrc2.includes('markStorySeen("bossEnter:'), "boss reels are first-visit gated");
  ok(mainSrc2.includes('storySeen("genesisReel")'), "finale reel is first-run gated");
  ok(mainSrc2.includes('"hubArrival"'), "cold open beat wired");
  const saveSrc = readFileSync(join(ROOT, "js/save.js"), "utf8");
  ok(saveSrc.includes("storySeen: {}"), "save.js defaults storySeen");
  ok(saveSrc.includes("orMap(p.storySeen, mp.storySeen)"), "storySeen OR-merges on cloud adopt");
}

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · music");

const NEEDED_THEMES = ["title", "atoll", "genesis", "winter", "neon", "printer", "corporate", "boss", "goldmine", "chair", "victory", "results"];
ok(NEEDED_THEMES.every((k) => (THEMES as any)[k]), "all 12 music slots composed");
ok(MUSIC_KEYS.length >= 12, "MUSIC_KEYS exported");
for (const k of NEEDED_THEMES) {
  const th = (THEMES as any)[k];
  ok(th.bpm >= 90 && th.bpm <= 160, k + " tempo in the kart band (" + th.bpm + " bpm)");
  ok(th.bars >= 2, k + " has 2+ bars");
  ok(Array.isArray(th.ch) && th.ch.length >= 2, k + " has 2+ pitched channels");
  ok(Array.isArray(th.dr) && th.dr.length > 0, k + " has percussion");
  ok(th.ch.every((c: any) => c.ev.every((e: number[]) => e.length === 3 && e[2] > 20 && e[2] < 110)), k + " note events are [step,dur,midi]");
}

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · shipped files (house rules)");

const files = allGameFiles().filter((f) => !f.endsWith(".png"));
ok(files.length >= 15, "game directory has its expected file set");
// Load-payload budget: html + css + js only. PWA icons (~67KB of PNG)
// are excluded · they download on install, not on page load.
// Load-payload budget now measures the DEPLOYED size: js/css are minified
// at build time (scripts/build-kart.mjs runs in the Vercel sandbox with
// these exact MINIFY_OPTS; committed source stays readable so the greps +
// module imports above keep working). This is the real minification sweep
// the earlier cap comment called for — ~600KB of commented source ships as
// ~370KB. Source size is now unconstrained; the cap guards actual LOAD.
let loadBytes = 0, sourceBytes = 0;
for (const f of files) {
  const body = readFileSync(f, "utf8");
  sourceBytes += Buffer.byteLength(body);
  ok(!body.includes("—"), "no em dashes in " + f.split("/public/")[1]);
  ok(!body.includes("inner" + "HTML"), "no HTML-string injection in " + f.split("/public/")[1]);
  if (f.endsWith(".js") || f.endsWith(".css")) {
    loadBytes += Buffer.byteLength(transformSync(body, { loader: f.endsWith(".css") ? "css" : "js", ...MINIFY_OPTS }).code);
  } else {
    loadBytes += Buffer.byteLength(body); // html + manifest ship as-is
  }
}
// Cap raised 420 -> 560KB with explicit operator approval (2026-07-21,
// the mythic content pass). Rationale: the wire cost is BROTLI of the
// minified build (~25% · 560KB minified ships ~140KB), parse cost at this
// size is <100ms on mid phones, and per-frame cost is governed by the
// quality tiers + instancing patterns, not payload bytes. The gate still
// exists so growth stays deliberate · next raise needs the operator again.
ok(loadBytes < 560 * 1024, "game ships under 560KB minified (got " + Math.round(loadBytes / 1024) + "KB minified · " + Math.round(sourceBytes / 1024) + "KB source)");

const NINTENDO_MARKS = [/mario/i, /luigi/i, /diddy/i, /rainbow road/i, /donkey kong/i, /koopa/i, /bowser/i];
for (const f of files) {
  const body = readFileSync(f, "utf8");
  ok(NINTENDO_MARKS.every((re) => !re.test(body)), "no Nintendo trademark strings in " + f.split("/public/")[1]);
}

const html = readFileSync(join(ROOT, "index.html"), "utf8");
ok(html.includes('src="/arcade-open-browser.js"'), "index.html loads the in-app-browser coach");
ok(html.includes("not affiliated with Strategy Inc."), "index.html carries the visible disclaimer");
ok(html.includes('rel="canonical" href="https://galaxymind.space/bitcoin-kart"'), "canonical URL declared");
for (const link of ["/arcade", "/super-saylor", "/stack", "/float", "/treasuries"]) {
  ok(html.includes('href="' + link + '"'), "site-discovery frame links " + link);
}
const musicJs = readFileSync(join(ROOT, "js", "music.js"), "utf8");
ok(html.includes("MUSIC SLOTS") && musicJs.includes("MUSIC SLOTS"), "MUSIC SLOTS operator docs present");

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · site integration drift guards");

const nextConfig = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
ok(nextConfig.includes('source: "/bitcoin-kart"'), "next.config.ts rewrites /bitcoin-kart");
ok(nextConfig.includes('source: "/bitcoin-kart/index.html"'), "next.config.ts 308s the raw index.html form");

const proxy = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf8");
ok(proxy.includes('gamePath.startsWith("/bitcoin-kart/")'), "proxy.ts carries the bitcoin-kart CSP branch");
const kartCspBlock = proxy.split("bitcoin-kart")[2] || "";
ok(kartCspBlock.includes("script-src 'self'"), "kart CSP uses script-src 'self' (no inline scripts)");

const arcadePage = readFileSync(join(process.cwd(), "src", "app", "arcade", "page.tsx"), "utf8");
ok(arcadePage.includes('"/bitcoin-kart"'), "arcade page lists the Bitcoin Kart cabinet");

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · per-run share card (lib/kart-card + main.js cardSeg)");

// allow-list drift guards: the card lib hardcodes ids/names so the Next
// page never renders URL-supplied text · they must mirror data.js exactly
ok(
  KART_TRACK_IDS.join(",") === (TRACKS as any[]).map((t) => t.id).join(","),
  "KART_TRACK_IDS matches TRACKS ids exactly (order + content)",
);
for (const t of TRACKS as any[]) {
  ok(KART_TRACK_NAMES[t.id] === t.name, "card track name mirrors data.js for " + t.id);
}
ok(
  KART_DRIVER_IDS.join(",") === (ROSTER as any[]).map((d) => d.id).join(","),
  "KART_DRIVER_IDS matches ROSTER ids exactly (order + content)",
);
for (const d of ROSTER as any[]) {
  ok(KART_DRIVER_NAMES[d.id] === d.displayName, "card driver name mirrors data.js for " + d.id);
}
ok(
  Object.keys(KART_CLASS_LABELS).join(",") === Object.keys(CLASSES).join(","),
  "card class key set mirrors CLASSES",
);
for (const k of Object.keys(KART_CLASS_LABELS)) {
  ok((KART_CLASS_LABELS as any)[k] === (CLASSES as any)[k].name, "card class label mirrors CLASSES for " + k);
}

// round-trip: every field survives encode → decode
const fullCard = { trackId: "etf-dawn", driverId: "mallers", timeMs: 154_321, day: 7, rank: 3, klass: "fullsend" as const, mirror: true };
const rtFull = decodeKartCard(encodeKartCard(fullCard));
ok(
  !!rtFull && rtFull.trackId === "etf-dawn" && rtFull.driverId === "mallers" &&
  rtFull.timeMs === 154_321 && rtFull.day === 7 && rtFull.rank === 3 &&
  rtFull.klass === "fullsend" && rtFull.mirror === true,
  "full card round-trips through encode/decode",
);
const minCard = { trackId: "pizza-beach", driverId: "saylor", timeMs: 95_000, day: null, rank: null, klass: null, mirror: false };
const rtMin = decodeKartCard(encodeKartCard(minCard));
ok(
  !!rtMin && rtMin.trackId === "pizza-beach" && rtMin.driverId === "saylor" &&
  rtMin.timeMs === 95_000 && rtMin.day === null && rtMin.rank === null &&
  rtMin.klass === null && rtMin.mirror === false,
  "minimal card round-trips through encode/decode",
);

// defensive decode: anything malformed → null (the page/OG then fall back
// to the generic card · the segment is attacker-reachable)
for (const bad of [
  "",
  "garbage",
  "tpizza-beach", // no driver, no time
  "tpizza-beach~dsaylor", // no time
  "tnot-a-track~dsaylor~m1000", // track off the allow-list
  "tpizza-beach~dnobody~m1000", // driver off the allow-list
  "tpizza-beach~dsaylor~mNaN", // unparsable time
  "t<script>~dsaylor~m1000", // markup never seats a card
  "%E0%A4%A", // malformed percent-encoding
]) {
  ok(decodeKartCard(bad) === null, "malformed segment " + JSON.stringify(bad) + " decodes to null");
}
// out-of-band numbers clamp instead of leaking through
const clampedCard = decodeKartCard("tpizza-beach~dsaylor~m999999999~r99~n0");
ok(
  !!clampedCard && clampedCard.timeMs === 600000 && clampedCard.rank === 8 && clampedCard.day === 1,
  "numeric fields clamp to their bounds on decode",
);
ok(formatKartCardTime(95_000) === "1:35.0", "card time format matches the game's m:ss.d");

// client-encoder drift guard: cardSeg in main.js must byte-match the lib.
// main.js touches the DOM at module scope so it can't be imported here ·
// evaluate the function straight out of the shipped source in a bare vm
// sandbox (encodeURIComponent is the only global it may touch).
const mainJs = readFileSync(join(ROOT, "js", "main.js"), "utf8");
const segSrc = mainJs.match(/function cardSeg\(c\) \{[\s\S]*?\n\}/);
ok(!!segSrc, "main.js ships the cardSeg share-card encoder");
if (segSrc) {
  const clientSeg = runInNewContext("(" + segSrc[0] + ")", { encodeURIComponent }) as (c: unknown) => string;
  // rank 12 exercises the 1..8 clamp on BOTH sides (review 2026-07-14:
  // an unclamped client once emitted r12 vs the lib's r8)
  for (const c of [fullCard, minCard, { ...fullCard, rank: null }, { ...minCard, mirror: true, klass: "sats" }, { ...fullCard, rank: 12 }]) {
    ok(
      clientSeg(c) === encodeKartCard(c as any),
      "client cardSeg byte-matches encodeKartCard for " + JSON.stringify(c).slice(0, 72),
    );
  }
}
ok(mainJs.includes("galaxymind.space/bitcoin-kart/card/"), "main.js share intents point at the per-run card URL");

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · dare ghosts (deep links · 2026-07-16)");

// card ~g field round-trips, and a malformed id is DROPPED (card still
// valid · the id lands in a link href so shape-or-nothing)
{
  const dareCard = { trackId: "etf-dawn", driverId: "mallers", timeMs: 154_321, day: null, rank: null, klass: "bits" as const, mirror: false, ghostId: "a1b2c3d4e5f6" };
  const rt = decodeKartCard(encodeKartCard(dareCard));
  ok(!!rt && rt.ghostId === "a1b2c3d4e5f6", "dare card ghostId round-trips through encode/decode");
  const noG = decodeKartCard("tetf-dawn~dmallers~m154321~gZZZ<script>");
  ok(!!noG && !noG.ghostId, "malformed ghostId is dropped, card survives");
  ok(!encodeKartCard({ ...dareCard, ghostId: "not-hex!" }).includes("g"), "encoder refuses a non-hex ghostId");
  // client mirror parity for the new field (valid, absent, and rejected)
  const segSrc2 = mainJs.match(/function cardSeg\(c\) \{[\s\S]*?\n\}/);
  if (segSrc2) {
    const clientSeg2 = runInNewContext("(" + segSrc2[0] + ")", { encodeURIComponent }) as (c: unknown) => string;
    for (const c of [dareCard, { ...dareCard, ghostId: null }, { ...dareCard, ghostId: "not-hex!" }]) {
      ok(clientSeg2(c) === encodeKartCard(c as any), "client cardSeg byte-matches encodeKartCard for ghostId=" + JSON.stringify((c as any).ghostId));
    }
  }
}

// dare meta validator: allow-list or nothing
ok(!!validateDareMeta({ trackId: "pizza-beach", klass: "bits", mirror: false, timeMs: 120_000 }), "dare meta accepts a legal run");
ok(validateDareMeta({ trackId: "not-a-track", klass: "bits", mirror: false, timeMs: 120_000 }) === null, "dare meta rejects an off-list track");
ok(validateDareMeta({ trackId: "pizza-beach", klass: "warp", mirror: false, timeMs: 120_000 }) === null, "dare meta rejects an off-list class");
ok(validateDareMeta({ trackId: "pizza-beach", klass: "constructor", mirror: false, timeMs: 120_000 }) === null, "dare meta rejects prototype-chain class names");
ok(validateDareMeta({ trackId: "pizza-beach", klass: "bits", mirror: false, timeMs: 10_000 }) === null, "dare meta rejects an impossible time (floor)");
ok(validateDareMeta({ trackId: "pizza-beach", klass: "bits", mirror: false, timeMs: 900_000 }) === null, "dare meta rejects an impossible time (ceiling)");
ok(KART_DARE_ID_RE.test("a1b2c3d4e5f6") && !KART_DARE_ID_RE.test("a1b2c3") && !KART_DARE_ID_RE.test("A1B2C3D4E5F6"), "dare id shape is 12 lowercase hex chars");

// GHOST/BOARD SCORE AGREEMENT (regression guard · fixed 2026-07-25).
//
// A genuine sub-60s finish is CLAMPED by the board into the score
// envelope (board.js dailyScore) and accepted. The ghost + dare routes
// used to (a) reject it on a 60s floor and (b) compute an UNCLAMPED
// score, so their salt token and leadership compare could never match
// the clamped row the board actually stored — no world ghost was seated
// for the day and the dare chain broke. Both directions are pinned here.
{
  const KART_SCORE_MAX = KART_GHOST_BASE_MS - KART_GHOST_MIN_MS;
  // the clamp mirrors board.js dailyScore(), including the ceiling, and
  // the ceiling rides the PHYSICAL floor so a real sub-60s run keeps its
  // own score instead of collapsing onto one frozen ZADD GT ceiling
  ok(kartDailyScore(55_000) === KART_GHOST_BASE_MS - 55_000, "kartDailyScore records a real 55s finish (board parity)");
  ok(kartDailyScore(30_000) === KART_SCORE_MAX, "kartDailyScore clamps a physically impossible finish to the ceiling");
  ok(dailyScore(55_000) === kartDailyScore(55_000), "board and ghost score a sub-60s finish identically");
  ok(kartDailyScore(120_000) === KART_GHOST_BASE_MS - 120_000, "kartDailyScore is linear inside the envelope");
  ok(kartDailyScore(KART_GHOST_BASE_MS + 60_000) === 1, "kartDailyScore floors at 1 for absurd times");
  // a real sub-60s run must now be mintable as a dare
  ok(
    !!validateDareMeta({ trackId: "pizza-beach", klass: "bits", mirror: false, timeMs: 55_000 }),
    "dare meta accepts a genuine sub-60s finish (the board accepts it, so the share loop must too)",
  );
  // ...but the physical floor still rejects the impossible
  ok(
    validateDareMeta({ trackId: "pizza-beach", klass: "bits", mirror: false, timeMs: 30_000 }) === null,
    "dare meta still rejects a physically impossible time below the 40s floor",
  );
}

// the client token mint for dares matches the server verifier byte-for-byte
ok(
  clientToken("kart-dare", 154_321, 9, "Orange Wizard #217") === libToken("kart-dare", 154_321, 9, "Orange Wizard #217"),
  "kart-dare salt token: client mirror matches lib",
);

// client plumbing drift guards (source-level, same style as lastTauntIdx)
{
  const raceSrc = readFileSync(join(ROOT, "js", "race.js"), "utf8");
  ok(raceSrc.includes('opts.mode === "challenge"'), "race.js knows the challenge mode");
  ok(/if \(phase === "run" && !player\.finished\) \{\n\s*ghostRecT/.test(raceSrc), "race.js records ghost frames on every player run (dare mints)");
  const boardSrc = readFileSync(join(ROOT, "js", "board.js"), "utf8");
  ok(boardSrc.includes("mintDareGhost") && boardSrc.includes("fetchDareGhost"), "board.js ships the dare mint/fetch helpers");
  ok(boardSrc.includes('"kart-dare"'), "board.js mints the dare token under the kart-dare game tag");
  ok(mainJs.includes('get("ghost")'), "main.js boot reads the ?ghost= deep-link param");
  ok(mainJs.includes('"challenge"') && mainJs.includes("startChallenge"), "main.js ships the challenge launcher");
  ok(mainJs.includes("wireDareShare"), "main.js share buttons mint dares on share intent");
  ok(mainJs.includes("crownLabel"), "results screen names the daily crown");
}

// pipeline prewarm (perf fix 2026-07-16): the pre-GO hitch fix · a hidden
// chase-pose frame at race creation pays first-draw GPU costs during load
{
  const raceSrc2 = readFileSync(join(ROOT, "js", "race.js"), "utf8");
  const glSrc = readFileSync(join(ROOT, "js", "gl.js"), "utf8");
  ok(raceSrc2.includes("R.setWarming(true)"), "createRace runs the pipeline prewarm frame");
  ok(raceSrc2.indexOf("R.setWarming(true)") < raceSrc2.lastIndexOf("return {"), "prewarm runs before the race object is handed to the game loop");
  ok(glSrc.includes("setWarming(on)"), "renderer ships the warming mode");
  ok(glSrc.includes("if (!warming) {"), "present() skips the canvas composite while warming");
}

// TODAY'S BOARD · menu social panel (2026-07-17)
{
  const mainSrc3 = readFileSync(join(ROOT, "js", "main.js"), "utf8");
  ok(mainSrc3.includes("mountMenuBoard"), "the menu ships TODAY'S BOARD panel");
  ok(mainSrc3.includes('store.set("daily-rank:" + day, posted.rank)'), "posting stores the reclaim baseline");
  ok(mainSrc3.includes("avatarChip"), "board rows wear avatar chips");
  ok(mainSrc3.includes("no-referrer"), "avatar images never leak a referrer");
  const boardSrc2 = readFileSync(join(ROOT, "js", "board.js"), "utf8");
  ok(boardSrc2.includes("fetchDailyBoardCached"), "menu board fetches ride a TTL cache");
  const proxySrc = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf8");
  ok(proxySrc.includes("img-src 'self' data: https://pbs.twimg.com"), "kart CSP allows exactly the X avatar CDN for images");
  ok(!proxySrc.includes("img-src 'self' data: https://pbs.twimg.com http"), "kart img-src stays a single extra origin");
  const mb = (COPY as any).menuBoard;
  ok(!!mb && mb.reclaim.includes("{name}") && mb.reclaim.includes("{rank}"), "reclaim copy carries name + rank slots");
}

// THE GENESIS RUN · story finale (2026-07-17)
{
  const f = (COPY as any).finale;
  ok(!!f && Array.isArray(f.intro) && f.intro.length >= 3, "finale intro carries the three story beats");
  ok(Array.isArray(f.credits) && f.credits.length >= 20, "credits roll has a full sequence (got " + (f.credits || []).length + ")");
  ok(typeof f.share === "string" && f.share.includes("galaxymind.space/bitcoin-kart"), "finale share line links the game");
  ok(f.credits.some((l: string) => l.includes("affectionate parody")), "credits keep the disclaimer posture");
  const mainSrc2 = readFileSync(join(ROOT, "js", "main.js"), "utf8");
  ok(mainSrc2.includes("function startFinale"), "main.js ships the finale launcher");
  ok(mainSrc2.includes('"bear2014", "headline"'), "the finale grid brings both bosses back");
  ok(/mode === "finale"[\s\S]{0,400}genesisRun = true/.test(mainSrc2.replace(/\n/g, " ")) || mainSrc2.includes("SAVE.progress.genesisRun = true"), "victory persists progress.genesisRun");
  ok(mainSrc2.includes("renderCredits"), "the credits roll ships");
  ok(mainSrc2.includes("satoshiUnlocked") && mainSrc2.includes("hub-finale"), "the hub finale card gates on the satoshi unlock");
  ok(TRACKS.length === 12, "the finale is an overlay, never a 13th TRACKS entry");
}

// map pass (2026-07-16): every placed prop type must have a builder, and
// terrain drama stays within the apron-safe envelope
{
  const geoSrc = readFileSync(join(ROOT, "js", "geometry.js"), "utf8");
  const builderBlock = geoSrc.match(/export const PROP_BUILDERS = \{([\s\S]*?)\n\};/);
  const builders = new Set(builderBlock ? [...builderBlock[1].matchAll(/\n  ([a-zA-Z0-9_]+)\(/g)].map((x) => x[1]) : []);
  ok(builders.has("waterfall"), "waterfall prop builder ships");
  for (const t of TRACKS as any[]) {
    for (const p of t.props || []) {
      ok(builders.has(p.type), t.id + " prop type '" + p.type + "' has a builder");
      ok(Math.abs(p.side || 0) <= 6, t.id + " prop side within the terrain apron (" + p.type + ")");
    }
    if (t.hillAmp !== undefined) {
      ok(t.hillAmp >= 0.5 && t.hillAmp <= 2.5, t.id + " hillAmp inside the safe envelope (" + t.hillAmp + ")");
    }
  }
  const nWaterfalls = (TRACKS as any[]).reduce((n, t) => n + (t.props || []).filter((p: any) => p.type === "waterfall").length, 0);
  ok(nWaterfalls >= 4, "at least 4 waterfalls placed across the map set (got " + nWaterfalls + ")");
  const trackSrc = readFileSync(join(ROOT, "js", "track.js"), "utf8");
  ok(trackSrc.includes("def.hillAmp"), "track.js honors per-track hillAmp");
  ok(trackSrc.includes("waterfalls"), "track.js collects waterfall positions for the mist");
}

// AI driving fix (2026-07-16): wall feeler + pinned-unstick must not be
// silently reverted · measured ~40% less low-speed grinding in real races
{
  const aiSrc = readFileSync(join(ROOT, "js", "ai.js"), "utf8");
  ok(aiSrc.includes("wall feeler"), "ai.js ships the predictive wall feeler");
  ok(aiSrc.includes("aiStuckT"), "ai.js ships the pinned-unstick reflex");
  ok(aiSrc.includes("STEERING-ONLY"), "wall avoidance stays steering-only (throttle variants broke the balance band)");
}

// dare share lines: dare copy exists and carries the dare url slot
ok(typeof (COPY as any).shareLines.dareWin === "string" && (COPY as any).shareLines.dareWin.includes("{url}"), "dareWin share line ships with a {url} slot");
ok(typeof (COPY as any).shareLines.dareLost === "string" && (COPY as any).shareLines.dareLost.includes("{url}"), "dareLost share line ships with a {url} slot");
ok(typeof (COPY as any).dare?.label === "string" && (COPY as any).dare.label.length > 0, "dare interstitial copy ships");
for (const k of ["win", "almost", "podium", "timeTrial", "daily"]) {
  ok(((COPY as any).shareLines[k] as string).includes("{url}"), "shareLine " + k + " carries the card/dare url slot");
}

// the Next side of the card: noindex, canonical on the game, OG decodes
// via the lib, and the proxy carves the path out of the static game CSP
// (a Next page's inline RSC-payload scripts would break under it)
const cardPage = readFileSync(join(process.cwd(), "src", "app", "bitcoin-kart", "card", "[data]", "page.tsx"), "utf8");
ok(/robots:\s*\{[^}]*index:\s*false/.test(cardPage), "card page is noindex");
ok(cardPage.includes('canonical: "https://galaxymind.space/bitcoin-kart"'), "card page canonicalizes to /bitcoin-kart");
const cardOg = readFileSync(join(process.cwd(), "src", "app", "bitcoin-kart", "card", "[data]", "opengraph-image.tsx"), "utf8");
ok(cardOg.includes("decodeKartCard"), "card OG image decodes via lib/kart-card");
ok(proxy.includes('!gamePath.startsWith("/bitcoin-kart/card")'), "proxy carves /bitcoin-kart/card out of the static game CSP");

// ---------------------------------------------------------------------------
console.log("BITCOIN KART · AAA round 3 terrain reads (2026-07-28)");

// Two reads proven on the REAL headless buildTrack output, not source greps:
// (a) the percentile snowline actually paints caps · the old maxRoadY + 8
// line sat above every ridge on the summit track and rendered ZERO white
// (the regression this round fixed), and non-snow worlds stay cap-free so
// the wmap corridor mask can never bleed white into a beach; (b) rock props
// seat ON the terrain heightfield (footprint-min + waterline floor) · the
// peak gorge shipped floating octahedra before the seating pass.
{
  const stubR = { createMesh: (d: any) => d, createUVMesh: (d: any) => d, createTexture: (x: any) => x };
  for (const def of TRACKS as any[]) {
    const track = buildTrack(stubR, def, null);
    const terr = track.meshes.terrain;
    let snow = 0;
    const total = terr.col.length / 4;
    for (let i = 0; i < terr.col.length; i += 4) {
      // near-white read: only the snowCol mix reaches this corner of the
      // cube (probed: winter cover 0.49, peak caps 0.07, all others 0.0)
      if (terr.col[i] > 0.78 && terr.col[i + 1] > 0.82 && terr.col[i + 2] > 0.85) snow++;
    }
    const snowy = track.surface === "snow" || track.surface === "rock";
    if (snowy) ok(snow / total > 0.02, def.id + " snow band paints real caps (" + (snow / total * 100).toFixed(1) + "% of terrain verts)");
    else ok(snow / total < 0.005, def.id + " stays snow-free (" + (snow / total * 100).toFixed(2) + "%)");
    // rebuild the terrain bilinear from the mesh's own grid verts (the
    // heightfield is not exported · the mesh IS the ground truth) and
    // re-derive each rock's seat exactly as track.js does: min over the
    // 4-sample footprint, e.y offset, waterline floor at level - 0.4
    const xs = new Set<number>(), zs = new Set<number>();
    for (let i = 0; i < terr.pos.length; i += 3) { xs.add(Math.round(terr.pos[i] * 100) / 100); zs.add(Math.round(terr.pos[i + 2] * 100) / 100); }
    const ux = [...xs].sort((a, b) => a - b), uz = [...zs].sort((a, b) => a - b);
    const H: number[][] = uz.map(() => new Array(ux.length).fill(0));
    // parallel colour grid · the wet-band read below needs the vertex
    // colour that sits on each height sample, and quad4 writes the same
    // corner colour to every cell that shares the vertex
    const CG: (number[] | null)[][] = uz.map(() => new Array(ux.length).fill(null));
    const xi = new Map(ux.map((v, i) => [v, i])), zi = new Map(uz.map((v, i) => [v, i]));
    for (let i = 0, v = 0; i < terr.pos.length; i += 3, v++) {
      const gx = xi.get(Math.round(terr.pos[i] * 100) / 100)!, gz = zi.get(Math.round(terr.pos[i + 2] * 100) / 100)!;
      H[gz][gx] = terr.pos[i + 1];
      CG[gz][gx] = [terr.col[v * 4], terr.col[v * 4 + 1], terr.col[v * 4 + 2]];
    }
    const G2 = ux.length - 1;
    const minX = ux[0], minZ = uz[0], cellW = (ux[G2] - minX) / G2, cellD = (uz[uz.length - 1] - minZ) / G2;
    const bil = (x: number, z: number) => {
      const fx = (x - minX) / cellW, fz = (z - minZ) / cellD;
      if (fx < 0 || fz < 0 || fx > G2 || fz > G2) return -7;
      const ix = Math.min(G2 - 1, Math.floor(fx)), iz = Math.min(G2 - 1, Math.floor(fz));
      const tx = fx - ix, tz = fz - iz;
      return (H[iz][ix] * (1 - tx) + H[iz][ix + 1] * tx) * (1 - tz) + (H[iz + 1][ix] * (1 - tx) + H[iz + 1][ix + 1] * tx) * tz;
    };
    const wLvl = track.meshes.water ? track.meshes.water.pos[1] : null;
    // instances preserve def.props order, so zip recovers scale + y offset
    const defRocks = (def.props || []).filter((e: any) => e.type === "rock" || e.type === "rockArch");
    const instRocks = track.instances.filter((it: any) => it.type === "rock" || it.type === "rockArch");
    ok(defRocks.length === instRocks.length, def.id + " every authored rock built an instance");
    instRocks.forEach((it: any, k: number) => {
      const e = defRocks[k];
      const fr = 1.5 * (e?.scale || 1);
      let gy = bil(it.model[12], it.model[14]);
      for (const [ox, oz] of [[fr, 0], [-fr, 0], [0, fr], [0, -fr]]) gy = Math.min(gy, bil(it.model[12] + ox, it.model[14] + oz));
      gy += e?.y || 0;
      if (wLvl !== null) gy = Math.max(gy, wLvl - 0.4);
      // Float32 grid + probe rounding · measured worst drift 0.0005
      ok(Math.abs(it.model[13] - gy) < 0.05, def.id + " rock t" + (e?.t ?? k) + " seats on the probed terrain (" + Math.abs(it.model[13] - gy).toFixed(4) + "u off)");
    });
    // (c) the damp shoreline band actually darkens the ground (round 4).
    // The clause shipped once as a HEIGHT ramp that compressed to nothing
    // on steep facets, so it re-keyed to GROUND distance: hdist =
    // (h - level) / max(|grad h|, 0.14), band 15u, darkening up to 0.45.
    // Probed at 5.6-9u of ground, NOT at the waterline: the surf foam
    // (+-5.5u, mixes toward off-white) owns everything closer, so a
    // 0-2.5u sample measures foam and reads BRIGHTER than dry ground
    // (1.13x pizza, 2.64x gox) and would pass with the wet clause gone.
    // Reference is the same track's own dry ground (hdist > 25) so the
    // check is a shade RATIO and never a palette constant. Measured
    // 0.642 pizza / 0.645 gox with the clause; 0.996 / 0.974 with it
    // commented out, so 0.75 sits well clear of both.
    if (wLvl !== null) {
      const lum = (c: number[]) => c[0] * 0.32 + c[1] * 0.5 + c[2] * 0.18;
      const band: number[] = [], dry: number[] = [];
      for (let gz = 0; gz <= G2; gz++) {
        for (let gx = 0; gx <= G2; gx++) {
          const c = CG[gz][gx];
          if (!c) continue;
          const gxm = Math.max(gx - 1, 0), gxp = Math.min(gx + 1, G2);
          const gzm = Math.max(gz - 1, 0), gzp = Math.min(gz + 1, G2);
          const dhx = (H[gz][gxp] - H[gz][gxm]) / ((gxp - gxm) * cellW);
          const dhz = (H[gzp][gx] - H[gzm][gx]) / ((gzp - gzm) * cellD);
          const hd = (H[gz][gx] - wLvl) / Math.max(Math.hypot(dhx, dhz), 0.14);
          if (hd > 25) dry.push(lum(c));
          else if (hd >= 5.6 && hd <= 9) band.push(lum(c));
        }
      }
      const med = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
      ok(band.length > 40 && dry.length > 40, def.id + " shoreline probe found both a wet band and dry reference (" + band.length + "/" + dry.length + " verts)");
      const ratio = med(band) / med(dry);
      ok(ratio <= 0.75, def.id + " damp shore band darkens the ground (" + ratio.toFixed(3) + "x dry median, needs <= 0.75)");
    }
  }
}

// ---------------------------------------------------------------------------
if (fail === 0) {
  console.log("\ntest-bitcoin-kart: " + pass + "/" + pass + " invariants hold ✓");
} else {
  console.error("\ntest-bitcoin-kart: " + fail + " FAILED (" + pass + " passed)");
  process.exit(1);
}
