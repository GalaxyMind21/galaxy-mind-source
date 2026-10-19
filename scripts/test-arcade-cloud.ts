// Cross-device cloud-save merge invariants (src/lib/arcade-cloud.ts).
// The merge is best-of: syncing a behind device must only ADD progress,
// never wipe a device that is ahead. These guard that no-data-loss
// contract per field + the bounds/anti-bloat clamps.
//
// Run: npx tsx scripts/test-arcade-cloud.ts   (wired into npm run verify)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeCloudSave, isCloudGame, isTrivialSave, cloudKey } from "../src/lib/arcade-cloud";

let pass = 0, fail = 0;
function ok(cond: unknown, msg: string) {
  if (cond) pass++;
  else { fail++; console.error("  ✗ " + msg); }
}

// ---------------------------------------------------------------------------
console.log("arcade-cloud · registry");
ok(isCloudGame("kart"), "kart is a cloud game");
ok(isCloudGame("streak"), "streak is a cloud game");
ok(isCloudGame("chop"), "chop is a cloud game");
ok(!isCloudGame("nope"), "unknown game rejected");
ok(mergeCloudSave("nope", {}, {}) === null, "unknown game merges to null");
ok(cloudKey("123") === "gm:cloud:save:123", "cloud key shape");

// ---------------------------------------------------------------------------
console.log("arcade-cloud · kart best-of merge");

const laptop = {
  progress: {
    balloons: { "pizza-beach": 3, "genesis-circuit": 3, "gox-docks": 3, "winter-2014": 3, "blocksize-fog": 3, "euphoria-neon": 3, "printer-runway": 3, "obituary-alley": 3, "glass-tower-loop": 3, "etf-dawn": 3, "one-chair-peak": 3, "schiff-gold-mine": 3 },
    bossBeaten: { bear2014: true, headline: true, schiff: true },
    beatSchiff: true, satoshiUnlocked: true, goldenSatoshi: true, genesisRun: true,
    cups: { genesis: 1, neon: 1, corporate: 1 },
    challenges: { "diamond-hands": true, "moon-lander": true },
    codex: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  },
  pbs: { "pizza-beach": 95000, "genesis-circuit": 120000 },
};
// a fresh iPhone with almost nothing
const phone = {
  progress: { balloons: { "pizza-beach": 1 }, bossBeaten: {}, cups: {}, challenges: {}, codex: [3, 13] },
  pbs: { "pizza-beach": 99000, "gox-docks": 88000 },
};

// the user's exact scenario: phone pulls, merges laptop's completion
const m = mergeCloudSave("kart", laptop, phone) as any;
ok(m.progress.goldenSatoshi === true, "100% completion survives the merge onto a blank phone");
ok(m.progress.satoshiUnlocked === true && m.progress.beatSchiff === true && m.progress.genesisRun === true, "all unlock booleans OR to true");
ok(Object.keys(m.progress.balloons).length === 12 && m.progress.balloons["schiff-gold-mine"] === 3, "all 12 tracks' balloons carried");
ok(m.progress.balloons["pizza-beach"] === 3, "balloon per-key MAX (laptop 3 beats phone 1)");
ok(m.progress.bossBeaten.schiff === true, "boss clears union");
ok(m.progress.cups.genesis === 1 && m.progress.cups.neon === 1, "cup trophies carried");
ok(m.progress.codex.length === 13 && m.progress.codex.includes(13), "codex is a de-duped union (phone's 13 added, no dupe of 3)");
ok(m.progress.challenges["diamond-hands"] === true, "challenges union");
// storySeen OR-union (adventure story beats + cinematics · 2026-07-21)
{
  const a = { progress: { storySeen: { hubArrival: true, "worldOpen:genesis": true } }, pbs: {} };
  const b = { progress: { storySeen: { hubArrival: true, "bossEnter:schiff": true } }, pbs: {} };
  const ms = mergeCloudSave("kart", a, b) as any;
  ok(ms.progress.storySeen.hubArrival === true && ms.progress.storySeen["worldOpen:genesis"] === true && ms.progress.storySeen["bossEnter:schiff"] === true,
    "storySeen OR-unions across devices");
}
// PBs: faster (lower) wins per track; union of tracks
ok(m.pbs["pizza-beach"] === 95000, "PB per-key MIN (laptop 95k beats phone 99k)");
ok(m.pbs["gox-docks"] === 88000, "phone-only PB carried");

// reverse direction must be identical (best-of is commutative on records)
const m2 = mergeCloudSave("kart", phone, laptop) as any;
ok(m2.progress.goldenSatoshi === true && Object.keys(m2.progress.balloons).length === 12, "merge is order-independent (commutative)");
ok(m2.pbs["pizza-beach"] === 95000, "PB min is order-independent");

// no-data-loss: a device that is AHEAD never loses to a blank incoming
const blank = { progress: {}, pbs: {} };
const m3 = mergeCloudSave("kart", laptop, blank) as any;
ok(m3.progress.goldenSatoshi === true && Object.keys(m3.progress.balloons).length === 12 && m3.pbs["pizza-beach"] === 95000, "merging a blank device NEVER wipes a completed one");

// cup rank direction: 1 (gold) must beat 3 (bronze)
const cupA = { progress: { cups: { genesis: 3 } }, pbs: {} };
const cupB = { progress: { cups: { genesis: 1 } }, pbs: {} };
ok((mergeCloudSave("kart", cupA, cupB) as any).progress.cups.genesis === 1, "cup MIN: gold(1) beats bronze(3)");

// ---------------------------------------------------------------------------
console.log("arcade-cloud · kart bounds + anti-bloat");

// out-of-range balloons clamp (a forged 999 becomes 3; negative becomes 0)
const forged = { progress: { balloons: { "pizza-beach": 999, x: -5 }, codex: [] }, pbs: { t: -10 } };
const mf = mergeCloudSave("kart", {}, forged) as any;
ok(mf.progress.balloons["pizza-beach"] === 3, "over-cap balloon clamped to 3");
ok(mf.progress.balloons.x === 0, "negative balloon clamped to 0");
ok(mf.pbs.t === 1, "sub-floor PB clamped to the 1ms floor");

// codex bloat cap (a 1000-id array truncates)
const bloat = { progress: { codex: Array.from({ length: 1000 }, (_, i) => i) }, pbs: {} };
ok((mergeCloudSave("kart", {}, bloat) as any).progress.codex.length <= 40, "codex union caps to prevent KV bloat");

// non-numeric / malformed values are dropped, not thrown
ok(!!mergeCloudSave("kart", { progress: { balloons: { a: "x", b: null as any } } }, {}), "malformed balloon values don't throw");

// ---------------------------------------------------------------------------
console.log("arcade-cloud · trivial-save guard (pull-only, never overwrites)");

// The endpoint refuses to WRITE a trivial save so a transient KV read blip
// (kvHMGet null == absent OR failed) can't wipe a rich cloud save with a
// fresh device's empty boot pull. These lock the trivial classifier.
ok(isTrivialSave("kart", { progress: {}, pbs: {} }), "empty kart save is trivial (a boot pull writes nothing)");
ok(isTrivialSave("kart", {}), "kart save with no progress/pbs is trivial");
ok(isTrivialSave("kart", { progress: { balloons: {}, bossBeaten: {}, cups: {}, challenges: {}, codex: [] }, pbs: {} }), "all-empty-collections kart save is trivial");
ok(!isTrivialSave("kart", { progress: { balloons: { "pizza-beach": 1 } }, pbs: {} }), "one balloon makes a kart save non-trivial");
ok(!isTrivialSave("kart", { progress: { satoshiUnlocked: true } }, ), "an unlock boolean makes a kart save non-trivial");
ok(!isTrivialSave("kart", { progress: { codex: [1] } }), "one codex id makes a kart save non-trivial");
ok(!isTrivialSave("kart", { progress: {}, pbs: { "pizza-beach": 95000 } }), "a PB makes a kart save non-trivial");
ok(isTrivialSave("streak", { last: 200, len: 0 }), "a zero-length streak is trivial");
ok(!isTrivialSave("streak", { last: 200, len: 3 }), "a real streak is non-trivial");
ok(!isTrivialSave("unknown", { anything: true }), "unknown game defaults to non-trivial (never silently pull-only)");

// ---------------------------------------------------------------------------
console.log("arcade-cloud · shared streak day-continuity merge");

// same day → keep the longer streak
ok((mergeCloudSave("streak", { last: 200, len: 5 }, { last: 200, len: 9 }) as any).len === 9, "same-day streak keeps the longer len");
// consecutive days → the older chain continues into the newer
{
  const s = mergeCloudSave("streak", { last: 199, len: 15 }, { last: 200, len: 1 }) as any;
  ok(s.last === 200 && s.len === 16, "consecutive-day streak chains (15 -> 16), not resets to 1");
}
// a real gap → the newer device's streak stands (no false credit)
{
  const s = mergeCloudSave("streak", { last: 190, len: 40 }, { last: 200, len: 2 }) as any;
  ok(s.last === 200 && s.len === 2, "a multi-day gap does not over-credit a broken streak");
}
// one side missing
ok((mergeCloudSave("streak", null, { last: 5, len: 3 }) as any).len === 3, "streak merge tolerates a missing side");

// ---------------------------------------------------------------------------
console.log("arcade-cloud · super saylor (campaign + unlocks + stats)");
{
  const laptopSS = {
    progress: { maxLevel: 21 },
    codex: [1, 2, 3, 4, 5],
    best: { handle: "SAYLOR #1", score: 42000, sats: 900, bears: 8, levels: 21, rules: 5, grade: "S", at: 1_700_000 },
    stats: { sats: 5000, bears: 40, runs: 30, deaths: 12 },
    wizardMet: true,
  };
  const phoneSS = {
    progress: { maxLevel: 3 },
    codex: [3, 6],
    best: { handle: "SAYLOR #1", score: 1200, sats: 100, bears: 1, levels: 3, rules: 1, grade: "C", at: 1_800_000 },
    stats: { sats: 200, bears: 2, runs: 4, deaths: 3 },
    wizardMet: false,
  };
  const m = mergeCloudSave("saylor", laptopSS, phoneSS) as any;
  ok(m.progress.maxLevel === 21, "saylor maxLevel MAX (21 beats 3)");
  ok(m.codex.length === 6 && m.codex.includes(6), "saylor codex union (phone's 6 added)");
  ok(m.best.score === 42000, "saylor best keeps the higher-score run");
  ok(m.stats.sats === 5000 && m.stats.bears === 40 && m.stats.runs === 30 && m.stats.deaths === 12, "saylor lifetime stats per-field MAX (not summed — shared runs would double-count)");
  ok(m.wizardMet === true, "saylor wizardMet sticky-OR unlock survives");
  // no-data-loss onto a blank device
  const mb = mergeCloudSave("saylor", laptopSS, { progress: {}, stats: {} }) as any;
  ok(mb.progress.maxLevel === 21 && mb.wizardMet === true && mb.best.score === 42000, "saylor: merging a blank device never wipes a completed campaign");
  // commutative
  const mc = mergeCloudSave("saylor", phoneSS, laptopSS) as any;
  ok(mc.progress.maxLevel === 21 && mc.best.score === 42000 && mc.stats.runs === 30, "saylor merge is order-independent");
  // trivial guard
  ok(isTrivialSave("saylor", { progress: { maxLevel: 1 }, codex: [], stats: { sats: 0, bears: 0, runs: 0, deaths: 0 }, wizardMet: false, best: null }), "fresh saylor save is trivial (pull-only)");
  ok(!isTrivialSave("saylor", { progress: { maxLevel: 2 } }), "reaching level 2 makes saylor non-trivial");
  ok(!isTrivialSave("saylor", { wizardMet: true }), "wizard unlock makes saylor non-trivial");
}

// ---------------------------------------------------------------------------
console.log("arcade-cloud · WEN (best + lifetime stats + day streak)");
{
  const a = { best: 8200, stats: { played: 40, totalSats: 300000, best: 8200, bullseyes: 4, streak: 10, lastDay: 200, bands: [1, 2, 5, 10, 22] } };
  const b = { best: 6000, stats: { played: 12, totalSats: 90000, best: 6000, bullseyes: 1, streak: 1, lastDay: 201, bands: [0, 1, 3, 4, 4] } };
  const m = mergeCloudSave("wen", a, b) as any;
  ok(m.best === 8200 && m.stats.best === 8200, "wen best is sats MAX and stays consistent with stats.best");
  ok(m.stats.played === 40 && m.stats.totalSats === 300000 && m.stats.bullseyes === 4, "wen lifetime counters per-field MAX (no double-count)");
  ok(m.stats.bands[4] === 22 && m.stats.bands[2] === 5, "wen bands histogram per-bucket MAX");
  ok(m.stats.lastDay === 201 && m.stats.streak === 11, "wen day streak chains (day 200 len10 -> day 201 len11), not naive max");
  ok(JSON.stringify(mergeCloudSave("wen", { best: 9000 }, { best: 0 })) === JSON.stringify(mergeCloudSave("wen", { best: 9000 }, { best: 0 })), "wen merge deterministic (stable output for the endpoint's idempotent-write check)");
  ok((mergeCloudSave("wen", a, {}) as any).best === 8200, "wen: blank incoming never lowers best");
  ok(isTrivialSave("wen", { best: 0, stats: { played: 0 } }), "fresh wen save is trivial");
  ok(!isTrivialSave("wen", { best: 5000, stats: {} }), "a real wen best is non-trivial");
  ok(!isTrivialSave("wen", { stats: { played: 3 } }), "having played wen is non-trivial");
}

// ---------------------------------------------------------------------------
console.log("arcade-cloud · Gauntlet (negative-capable best + badges + streak)");
{
  const a = { best: 7.5, badges: ["oracle", "bot-slayer"], streak: { last: 200, n: 6 } };
  const b = { best: -3.2, badges: ["steady", "oracle"], streak: { last: 201, n: 1 } };
  const m = mergeCloudSave("gauntlet", a, b) as any;
  ok(m.best === 7.5, "gauntlet best keeps the higher alpha");
  ok(m.badges.length === 3 && m.badges.includes("steady"), "gauntlet badges union");
  ok(m.streak.last === 201 && m.streak.len === 7, "gauntlet day streak chains (n:6 -> len:7)");
  // negative alpha is a REAL run, not absence
  const neg = mergeCloudSave("gauntlet", { best: -50 }, { best: -10 }) as any;
  ok(neg.best === -10, "gauntlet best allows negatives and picks the greater (less bad) alpha");
  ok(!isTrivialSave("gauntlet", { best: -50, badges: [] }), "a negative-alpha run is NON-trivial (they played)");
  ok(isTrivialSave("gauntlet", { badges: [], streak: { last: 0, n: 0 } }), "never-played gauntlet (no best) is trivial");
  ok(!isTrivialSave("gauntlet", { badges: ["oracle"] }), "owning a badge is non-trivial");
}

// ---------------------------------------------------------------------------
console.log("arcade-cloud · Runner + Horizon (single best record)");
{
  // Runner: days primary, sats tiebreak
  const r1 = mergeCloudSave("runner", { best: { days: 5, sats: 100 } }, { best: { days: 8, sats: 1 } }) as any;
  ok(r1.best.days === 8 && r1.best.sats === 1, "runner: more days wins even with fewer sats");
  const r2 = mergeCloudSave("runner", { best: { days: 8, sats: 100 } }, { best: { days: 8, sats: 400 } }) as any;
  ok(r2.best.days === 8 && r2.best.sats === 400, "runner: equal days -> higher sats tiebreak");
  ok((mergeCloudSave("runner", { best: { days: 8, sats: 400 } }, {}) as any).best.days === 8, "runner: blank incoming never lowers best");
  ok(isTrivialSave("runner", { best: null }), "no runner best is trivial");
  ok(isTrivialSave("runner", {}), "absent runner best is trivial");
  ok(!isTrivialSave("runner", { best: { days: 1, sats: 0 } }), "one day survived is non-trivial");

  // Horizon: sats is the ordering key, height rides along
  const h1 = mergeCloudSave("horizon", { best: { s: 500, h: 30 } }, { best: { s: 900, h: 12 } }) as any;
  ok(h1.best.s === 900 && h1.best.h === 12, "horizon: higher sats wins, its own height rides along");
  ok((mergeCloudSave("horizon", { best: { s: 900, h: 12 } }, {}) as any).best.s === 900, "horizon: blank incoming never lowers best");
  ok(isTrivialSave("horizon", { best: null }), "no horizon best is trivial");
  ok(!isTrivialSave("horizon", { best: { s: 10, h: 1 } }), "a real horizon score is non-trivial");
}

// ---------------------------------------------------------------------------
console.log("arcade-cloud · CHOP (all-time best + played MAX, never SUM)");
{
  const a = { best: 820_000, stats: { played: 40, best: 820_000 } };
  const b = { best: 210_000, stats: { played: 12, best: 210_000 } };
  const m = mergeCloudSave("chop", a, b) as any;
  ok(m.best === 820_000 && m.stats.best === 820_000, "chop best is sats MAX and stays consistent with stats.best");
  ok(m.stats.played === 40, "chop played is MAX not SUM (shared runs would double-count)");
  ok((mergeCloudSave("chop", a, {}) as any).best === 820_000, "chop: blank incoming never lowers best");
  const c = mergeCloudSave("chop", b, a) as any;
  ok(c.best === 820_000 && c.stats.played === 40, "chop merge is order-independent");
  // best on one side, stats.best on the other · still the MAX of both
  const split = mergeCloudSave("chop", { best: 5000 }, { stats: { best: 8000, played: 2 } }) as any;
  ok(split.best === 8000 && split.stats.best === 8000 && split.stats.played === 2, "chop best unions top-level and stats.best");
  const forged = mergeCloudSave("chop", {}, { best: 99_000_000, stats: { played: -3 } }) as any;
  ok(forged.best === 12_000_000, "chop over-cap best clamps to the board envelope");
  ok(forged.stats.played === 0, "chop negative played clamps to 0");
  ok(isTrivialSave("chop", { best: null, stats: { played: 0, best: 0 } }), "fresh chop save is trivial (pull-only)");
  ok(isTrivialSave("chop", { best: 0, stats: { played: 0 } }), "zero chop best+played is trivial");
  ok(!isTrivialSave("chop", { best: 5000, stats: {} }), "a real chop best is non-trivial");
  ok(!isTrivialSave("chop", { stats: { played: 3 } }), "having played chop is non-trivial");
}

// ---------------------------------------------------------------------------
console.log("arcade-cloud · every registered game handles null/garbage inputs");
for (const g of ["kart", "streak", "saylor", "wen", "trail", "gauntlet", "runner", "horizon", "chop"]) {
  ok(isCloudGame(g), `${g} is registered`);
  // must never throw on adversarial input
  let threw = false;
  try {
    mergeCloudSave(g, null, null);
    mergeCloudSave(g, { junk: true, best: "not a number" }, { stats: 5, codex: "x", badges: 7 });
    isTrivialSave(g, undefined);
    isTrivialSave(g, { best: NaN });
  } catch { threw = true; }
  ok(!threw, `${g} merge + trivial guard tolerate garbage without throwing`);
}

// ---------------------------------------------------------------------------
{
  const cloudSrc = readFileSync(
    join(process.cwd(), "src/app/api/arcade/cloud/route.ts"),
    "utf8",
  );
  ok(cloudSrc.includes("resolveLinkedSession"), "cloud route uses profile-hash revocation");
  const getFn = cloudSrc.slice(cloudSrc.indexOf("export async function GET"));
  ok(getFn.includes('link.kind === "unlinked"'), "cloud GET refuses unlinked sessions");
}

if (fail === 0) console.log(`\ntest-arcade-cloud: ${pass}/${pass} invariants hold ✓`);
else { console.error(`\ntest-arcade-cloud: ${fail} FAILED (${pass} passed)`); process.exit(1); }
