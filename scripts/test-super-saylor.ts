/**
 * Super Saylor level + house-rule invariants (public/super-saylor.html).
 *
 * The game is a single static HTML file. This suite extracts the level
 * data + physics constants from marker blocks in that file and proves,
 * with a jump-envelope reachability graph, that every one of the 21
 * levels is completable by plain running and jumping (plus the power
 * gates the design intends). A level that ships unreachable is a
 * player-facing dead end, so this runs in `npm run verify`.
 *
 * Invariants:
 *   1. 21 levels present (18 designed + bosses 7/14/21), unique ids.
 *   2. Spawn, checkpoint, goal, and every rule tablet sit over solid
 *      ground and are BFS-reachable from spawn within the jump
 *      envelope derived from PHYS (dash/MSTR bonuses only where the
 *      enabling pickup exists earlier in the level).
 *   3. Exactly one rule tablet per non-boss level (rule id == level n),
 *      exactly 3 B tokens, goal in the final stretch of the level.
 *   4. Bears patrol over ground; patrol bounds sane.
 *   5. House rules on the whole file: no em dashes, no innerHTML, the
 *      disclaimer + music-slot documentation present, no "88" in the
 *      player-facing copy block, file under 400KB.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  encodeSaylorCard,
  decodeSaylorCard,
  fmtSummitMs,
  SUMMIT_BASE_MS,
  type SaylorCard,
} from "../src/lib/saylor-card";

const html = readFileSync(join(process.cwd(), "public", "super-saylor.html"), "utf8");

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; }
  else { fail++; console.error("  FAIL:", msg); }
}

function slice(startMark: string, endMark: string): string {
  const a = html.indexOf(startMark);
  const b = html.indexOf(endMark);
  if (a < 0 || b < 0) throw new Error("marker missing: " + startMark);
  return html.slice(a + startMark.length, b);
}

// ---- PHYS (regex per key · the block is JS, not JSON) ------------------
const physBlock = slice("/*__PHYS_START__*/", "/*__PHYS_END__*/");
function num(key: string): number {
  const m = physBlock.match(new RegExp(key + ":\\s*(-?[\\d.]+)"));
  if (!m) throw new Error("PHYS key missing: " + key);
  return parseFloat(m[1]);
}
const GRAV = num("GRAV"), RUN = num("RUN_MAX"), JV = num("JUMP_V");
const DASH = num("DASH_V") * num("DASH_T");
const MSTR_MUL = num("MSTR_JUMP_MUL");
const JH = (v: number) => (v * v) / (2 * GRAV); // apex height for jump velocity v

// horizontal reach jumping from A, landing dy px HIGHER (dy>0) or lower (dy<0)
function reach(v: number, dy: number): number {
  const disc = v * v - 2 * GRAV * dy;
  if (disc < 0) return -1; // cannot rise that high
  const t = (v + Math.sqrt(disc)) / GRAV;
  return t * RUN;
}

// ---- level data ----------------------------------------------------------
const LEVELS_DATA = JSON.parse(
  slice("/*__LEVELS_DATA_START__*/", "/*__LEVELS_DATA_END__*/")
    .replace("const LEVELS_DATA =", "").trim().replace(/;$/, ""),
);
const BOSS_LEVELS = JSON.parse(
  slice("/*__BOSS_START__*/", "/*__BOSS_END__*/")
    .replace("const BOSS_LEVELS =", "").trim().replace(/;$/, ""),
);

type Rect = { x0: number; x1: number; y: number; enterY?: number };

function analyzeLevel(d: any): string[] {
  const errs: string[] = [];
  const H = d.height || 216;

  // platform surface list (tops)
  const tops: Rect[] = [];
  for (const p of d.plats || []) tops.push({ x0: p[0], x1: p[0] + p[2], y: p[1] });
  for (const p of d.conveyors || []) tops.push({ x0: p[0], x1: p[0] + p[2], y: p[1] });
  for (const p of d.oneways || []) tops.push({ x0: p[0], x1: p[0] + p[2], y: p[1] });
  for (const m of d.movers || []) {
    // permissive elevator model: enter at its lowest/furthest position,
    // exit anywhere along travel (use most favorable)
    const [x, y, w, , axis, dist] = m;
    if (axis) tops.push({ x0: x, x1: x + w, y: y, enterY: y + dist });
    else tops.push({ x0: x, x1: x + w + dist, y: y });
  }
  // power-gated ghost platforms count only if the granting pickup exists
  // at smaller x (the design contract)
  const powXs = (d.powerups || []).map((r: any[]) => ({ t: String(r[0]), x: r[1] }));
  const gate = (t: string, gx: number) => powXs.some((p: any) => p.t === t && p.x < gx + 20);
  for (const g of d.mstrPlats || []) if (gate("MSTR", g[0])) tops.push({ x0: g[0], x1: g[0] + g[2], y: g[1] });
  for (const g of d.strfPlats || []) if (gate("STRF", g[0])) tops.push({ x0: g[0], x1: g[0] + g[2], y: g[1] });

  // power envelopes apply only to hops whose takeoff is past the pickup
  const powMinX = (t: string) => Math.min(...powXs.filter((p: any) => p.t === t).map((p: any) => p.x), Infinity);
  const dashX = powMinX("STRD"), mstrX = powMinX("MSTR");
  const jumpV = JV; // base envelope
  const mstrV = JV * MSTR_MUL;

  // ground under a point (within a generous drop)
  const groundIdx = (x: number, y: number): number => {
    let best = -1, bestY = Infinity;
    tops.forEach((t, i) => {
      if (x < t.x0 - 8 || x > t.x1 + 8) return;
      if (t.y >= y - 24 && t.y < bestY) { bestY = t.y; best = i; }
    });
    return best;
  };

  const spawnI = groundIdx(d.spawn[0], d.spawn[1]);
  const cpI = groundIdx(d.checkpoint[0], d.checkpoint[1]);
  const goalI = groundIdx(d.goal[0], d.goal[1]);
  if (spawnI < 0) errs.push("spawn floats over a pit");
  if (cpI < 0) errs.push("checkpoint floats over a pit");
  if (goalI < 0) errs.push("goal floats over a pit");

  // BFS over the platform graph
  const n = tops.length;
  const seen = new Array(n).fill(false);
  if (spawnI >= 0) seen[spawnI] = true;
  const queue = spawnI >= 0 ? [spawnI] : [];
  const canHop = (A: Rect, B: Rect): boolean => {
    const aY = A.y, bY = B.enterY ?? B.y;
    const dy = aY - bY; // >0 means B is higher
    // MSTR envelope for any hop taking off after the MSTR pickup ·
    // the 9s window is long enough for the gated stretch by design
    const v = A.x1 >= mstrX ? mstrV : jumpV;
    let r = reach(v, Math.max(0, dy));
    if (r < 0) return false;
    if (dy <= 0) r = reach(v, dy); // falling: more air time
    // horizontal gap between the rects (0 if overlapping)
    let g = 0;
    if (B.x0 > A.x1) g = B.x0 - A.x1;
    else if (A.x0 > B.x1) g = A.x0 - B.x1;
    else g = 0;
    if (dy > 0 && g === 0) return dy <= JH(v) + 2; // step up in place
    let allow = r - 6; // landing margin
    if (A.x1 >= dashX && dy <= 10) allow += DASH;
    return g <= allow;
  };
  while (queue.length) {
    const i = queue.pop()!;
    for (let j2 = 0; j2 < n; j2++) {
      if (seen[j2]) continue;
      if (canHop(tops[i], tops[j2])) { seen[j2] = true; queue.push(j2); }
    }
  }

  if (cpI >= 0 && !seen[cpI]) errs.push("checkpoint unreachable");
  if (goalI >= 0 && !seen[goalI]) errs.push("goal unreachable");
  for (const t of d.tablets || []) {
    const ti = groundIdx(t[0], t[1] + 20);
    if (ti < 0) errs.push("tablet floats over a pit");
    else if (!seen[ti]) errs.push("tablet platform unreachable");
  }
  for (const pw of d.powerups || []) {
    const pi = groundIdx(pw[1], pw[2] + 24);
    if (pi >= 0 && !seen[pi]) errs.push(pw[0] + " powerup platform unreachable");
  }

  // structural checks
  if (!d.boss) {
    ok((d.tablets || []).length === 1, "L" + d.n + " exactly one tablet");
    if ((d.tablets || []).length === 1) ok(d.tablets[0][2] === d.n, "L" + d.n + " tablet rule id == n");
  }
  ok((d.btokens || []).length === 3, "L" + d.n + " exactly 3 B tokens");
  ok(d.goal[0] >= d.width - 200 && d.goal[0] <= d.width - 40, "L" + d.n + " goal in final stretch");
  ok(d.spawn[0] < 140, "L" + d.n + " spawn near start");
  for (const b of d.bears || []) {
    const bi = groundIdx(b[1], b[2]);
    if (bi < 0) errs.push("bear at x=" + b[1] + " floats over a pit");
    ok(b[4] >= b[3], "L" + d.n + " bear patrol bounds ordered"); // == means stationary (media)
  }
  // no pickup may be born inside a solid (the loader dislodges at
  // runtime, but clean data keeps placements intentional)
  const solidRects = (d.plats || []).concat(d.conveyors || []);
  const embedded = (x: number, y: number, w: number, h: number) =>
    solidRects.some((r: number[]) => x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]);
  for (const run of d.sats || []) {
    const step = run[3] || 16;
    for (let i = 0; i < run[2]; i++)
      if (embedded(run[0] + i * step, run[1], 8, 8)) { errs.push("sat embedded in solid at x=" + (run[0] + i * step)); break; }
  }
  for (const it of (d.btokens || []).concat(d.tablets || [], d.oneups || []))
    if (embedded(it[0], it[1], 10, 10)) errs.push("pickup embedded in solid at x=" + it[0]);
  // death plane sanity
  ok(H === 216 || H === 324 || H === 432, "L" + d.n + " valid height");
  return errs;
}

console.log("Super Saylor invariants");
const allN = Array.from({ length: 21 }, (_, i) => i + 1);
for (const n of allN) {
  const d = BOSS_LEVELS[String(n)] || LEVELS_DATA[String(n)];
  ok(!!d, "level " + n + " present");
  if (!d) continue;
  const errs = analyzeLevel(d);
  ok(errs.length === 0, "L" + n + " (" + d.name + "): " + errs.join("; "));
}

// ---- house rules on the whole file --------------------------------------
ok(!html.includes("—"), "no em dashes anywhere in the file");
ok(!html.includes("innerHTML"), "no innerHTML (repo hook + injection hygiene)");
ok(html.includes("not affiliated with Strategy Inc."), "disclaimer present");
ok(html.includes("MUSIC SLOTS"), "licensed-music slot documentation present");
ok(html.includes('includes("88")'), "handle generator filters the 88 substring");
ok(html.length < 400 * 1024, "file under 400KB (" + (html.length / 1024).toFixed(0) + "KB)");
// the copy block itself must not carry 88 (level geometry numbers are fine)
const copyBlock = html.slice(html.indexOf("const COPY ="), html.indexOf("const MUSIC_OVERRIDES"));
ok(!/88/.test(copyBlock), "no 88 in player-facing copy");

// ---- global board drift guards -------------------------------------------
// The game posts to /api/arcade/score with the shared handle format,
// token salt, and game id. These three contracts live in different
// files; a drift in any of them silently kills global submissions.
const HANDLE_RE_SERVER =
  /^[A-Za-z][A-Za-z-]{1,14}[A-Za-z] [A-Za-z][A-Za-z ]{1,14}[A-Za-z] #\d{3}$/;
const adjSrc = html.match(/HANDLE_ADJ = \[([\s\S]*?)\]/);
const nounSrc = html.match(/HANDLE_NOUN = \[([\s\S]*?)\]/);
ok(!!adjSrc && !!nounSrc, "handle pools present");
if (adjSrc && nounSrc) {
  const adjs = [...adjSrc[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const nouns = [...nounSrc[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  let badCombos = 0;
  for (const a of adjs) for (const nn of nouns) {
    if (!HANDLE_RE_SERVER.test(a + " " + nn + " #123")) badCombos++;
  }
  ok(badCombos === 0, "every generated handle passes the server regex (" + badCombos + " fail)");
}
const tokenLib = readFileSync(join(process.cwd(), "src", "lib", "arcade-token.ts"), "utf8");
const saltMatch = tokenLib.match(/SALT = "([^"]+)"/);
ok(!!saltMatch && html.includes('ARCADE_SALT = "' + saltMatch![1] + '"'),
  "game token salt matches lib/arcade-token");
const postRoute = readFileSync(join(process.cwd(), "src", "app", "api", "arcade", "score", "route.ts"), "utf8");
const getRoute = readFileSync(join(process.cwd(), "src", "app", "api", "arcade", "scores", "route.ts"), "utf8");
ok(postRoute.includes('"saylor"') && postRoute.includes("gm:lb:saylor:v1"),
  "score POST route accepts the saylor game");
ok(getRoute.includes('"saylor"') && getRoute.includes("gm:lb:saylor:v1"),
  "scores GET route serves the saylor board");
ok(html.includes('game: "saylor"'), "game client posts as saylor");

// ---- Daily Summit drift guards --------------------------------------------
// The summit day number, level rotation, and score packing are shared
// contracts between the static game and the Next API/lib layer.
const dayLib = readFileSync(join(process.cwd(), "src", "lib", "gauntlet-day.ts"), "utf8");
ok(dayLib.includes("Date.UTC(2026, 6, 8)") && html.includes("Date.UTC(2026, 6, 8)"),
  "summit day epoch matches lib/gauntlet-day (Gauntlet #1 = 2026-07-08)");
ok(postRoute.includes('"summit"') && postRoute.includes("gm:lb:summit:day:v1"),
  "score POST route accepts the summit game");
ok(getRoute.includes('"summit"') && getRoute.includes("gm:lb:summit:day:v1"),
  "scores GET route serves the summit daily board");
ok(html.includes('game: "summit"'), "game client posts as summit");
// score base: client SUMMIT_BASE_MS and route SUMMIT_BASE must agree
const baseClient = html.match(/SUMMIT_BASE_MS = (\d+)/);
const baseRoute = postRoute.match(/SUMMIT_BASE = ([\d_]+)/);
ok(!!baseClient && !!baseRoute &&
  Number(baseClient![1]) === Number(baseRoute![1].replace(/_/g, "")),
  "summit score base matches between game and route");
// level rotation: non-boss only, and the 18-day cycle covers all 18
const SUMMIT_LEVELS_T = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20];
ok(html.includes("SUMMIT_LEVELS = [" + SUMMIT_LEVELS_T.join(", ") + "]"),
  "summit level pool is exactly the 18 non-boss levels");
{
  const seen = new Set<number>();
  for (let d = 1; d <= 18; d++) {
    seen.add(SUMMIT_LEVELS_T[(((d * 11 + 5) % 18) + 18) % 18]);
  }
  ok(seen.size === 18, "summit rotation visits every non-boss level in 18 days");
  ok(html.includes("(((day * 11 + 5) % 18) + 18) % 18"),
    "summit rotation formula pinned in the game client");
}
// day fairness: submissions carry the day the ATTEMPT STARTED
ok(html.includes("GAME.summitDay; // the day the attempt started"),
  "summit posts use the attempt-start day (UTC-midnight crossing safe)");
// The Next-side rotation lives ONCE in lib/gauntlet-day (social drafts
// and the daily-drop push both import it) · must match the game client.
ok(dayLib.includes("(((day * 11 + 5) % 18) + 18) % 18") &&
  dayLib.includes("SUMMIT_LEVELS = [" + SUMMIT_LEVELS_T.join(", ") + "]"),
  "lib/gauntlet-day summit rotation matches the game client");
const draftsLib = readFileSync(join(process.cwd(), "src", "lib", "social-drafts.ts"), "utf8");
const dropRoute = readFileSync(join(process.cwd(), "src", "app", "api", "cron", "wen-drop", "route.ts"), "utf8");
ok(draftsLib.includes("summitLevelFor") && dropRoute.includes("summitLevelFor"),
  "social drafts + daily-drop push use the shared rotation");

// ---- Ratio Bear ------------------------------------------------------------
// The reply-guy enemy (L15-20). Placement MUST be deterministic (the
// Daily Summit races these levels) and the weeping-angel rule is the
// whole mechanic · both are pinned here.
ok(html.includes("ratio: { body:") && html.includes('b.type === "ratio"'),
  "ratio bear palette + AI branch present");
ok(html.includes("++fudSeen % 3 === 0") && html.includes("NEVER random"),
  "ratio placement is counter-based and deterministic (summit-fair)");
ok(html.includes("P.face === (bcx >= pcx ? 1 : -1)"),
  "ratio bear freezes when watched (weeping-angel rule)");
ok(/"ratio": \[/.test(html), "ratio taunt pool present");
ok(html.includes('"COUNTER RATIO"'), "counter-ratio stomp payoff present");

// Cross-cabinet streak · the static page replicates lib/arcade-streak's
// recordArcadePlay against the SAME localStorage key and dispatches the
// shared finished event; a key rename in either file must fail here.
const streakLib = readFileSync(join(process.cwd(), "src", "lib", "arcade-streak.ts"), "utf8");
const streakKey = streakLib.match(/KEY = "([^"]+)"/);
ok(!!streakKey && html.includes('ARCADE_STREAK_KEY = "' + streakKey![1] + '"'),
  "game streak key matches lib/arcade-streak");
ok(html.includes('dispatchEvent(new CustomEvent("gm:arcade-finished"))'),
  "run end dispatches the shared gm:arcade-finished event");
ok((html.match(/recordArcadeStreak\(\);/g) || []).length >= 2,
  "streak recorded on both run-end paths (game over + victory cinema)");

// Retry-queue semantics · a post settles (never retries) on 2xx and on
// 4xx except 429; 429/5xx/network stay queued. The 429 carve-out is the
// load-bearing part (a rate-limited legit score must not be dropped).
ok(html.includes("status !== 429"), "429 responses stay queued for retry");
// Clears must be token-matched · a response settling run B must never
// wipe a different, still-unsent queued run A (best-score loss).
ok(html.includes("q.token === token") &&
  !html.includes('settlesPost(r.status)) store.set("unsentGlobal", null)'),
  "queue clears are token-matched (settling B never wipes unsent A)");

// ---- Home-screen install (icon + manifest + coached card) ------------------
// Without an apple-touch-icon iPadOS shows a text monogram (operator's
// son got a letter S). These pin the whole install surface.
ok(html.includes('src="/arcade-open-browser.js"'),
  "loads the in-app-browser coach (X/IG WebView)");
ok(html.includes('<link rel="apple-touch-icon" href="/super-saylor-icon-180.png">'),
  "apple-touch-icon present (no more letter-S tile)");
ok(html.includes('content="SUPER SAYLOR"') && html.includes('<link rel="manifest" href="/super-saylor.webmanifest">'),
  "web-app title + manifest linked");
for (const f of ["super-saylor-icon-180.png", "super-saylor-icon-192.png", "super-saylor-icon-512.png"]) {
  const buf = readFileSync(join(process.cwd(), "public", f));
  ok(buf.length > 5000 && buf[0] === 0x89 && buf[1] === 0x50,
    `icon ${f} is a real PNG (${buf.length} bytes)`);
}
{
  const man = JSON.parse(readFileSync(join(process.cwd(), "public", "super-saylor.webmanifest"), "utf8"));
  ok(man.start_url === "/super-saylor" && man.icons?.length === 2,
    "webmanifest points at the game with both icons");
}
const proxySrc = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf8");
ok(proxySrc.includes("manifest-src 'self'"),
  "game CSP carve-out allows the manifest fetch");
ok(html.includes("beforeinstallprompt") && html.includes("a2hsMode"),
  "in-game Add to Home Screen card wired (Android prompt + iOS steps)");

// ---- Mobile touch UX (2026-07-12 · player feedback pass) -------------------
// Rotate hint: portrait phones get one dismissable nudge toward landscape.
ok(html.includes("initRotateHint") && html.includes("gm:ss:rot-hint"),
  "rotate-to-landscape hint wired with a session dismiss key");
ok(html.includes('matchMedia("(orientation: portrait)")'),
  "rotate hint gates on portrait orientation");
ok(html.includes("ROTATE FOR THE FULL TIMELINE"),
  "rotate hint copy present");
// Touch pads: square hit zones bigger than the visible circle (the
// ::before draws the ring · border-radius clips hit-testing, which is
// why the old round pads dropped edge taps and cost players lives).
ok(html.includes(".pad::before"),
  "pads draw the circle via ::before (square hit zone = invisible slop)");
ok(!html.includes('mk("CHAIR"') && html.includes('"SUPER"'),
  "cryptic CHAIR pad renamed SUPER");
for (const cap of ['"JUMP"', '"DUCK"', '"POWER"']) {
  ok(html.includes(cap), `touch pad caption ${cap} present`);
}
ok(html.includes("superbtn.ready") && html.includes("TOUCH.supState"),
  "SUPER pad glows only when conviction is full (state synced from HUD loop)");
ok(html.includes("powbtn.armed") && html.includes("TOUCH.powArmed"),
  "POWER pad lights only while a STRK/STRD powerup is carried");

// ---- viral loop · per-run share cards + challenge deep link (2026-07-12) ---
// The card route (/super-saylor/c/[data]) DECODES what the game ENCODES.
// The game is a static file that can't import lib/saylor-card, so it
// keeps a byte-identical encoder replica · these guards pin the two
// implementations together (base URL, kind codes, field tags, clamp
// bounds) and roundtrip the lib codec.
{
  // The two new route files exist (build-gate proves they compile; this
  // pins the path the game's replica hard-codes).
  for (const f of [
    "src/lib/saylor-card.ts",
    "src/app/super-saylor/c/[data]/page.tsx",
    "src/app/super-saylor/c/[data]/opengraph-image.tsx",
  ]) {
    ok(readFileSync(join(process.cwd(), f), "utf8").length > 200,
      `share-card route file present: ${f}`);
  }
}
// Codec roundtrips for every variant · decode(encode(x)) === x.
{
  const samples: SaylorCard[] = [
    { kind: "summit", handle: "ORANGE-PILLED SAYLOR #123", day: 42, ms: 83450, sats: 0, bears: 0, levels: 0, convictions: 0 },
    { kind: "victory", handle: "LASER-EYED PLEB #777", day: 0, ms: 0, sats: 128400, bears: 63, levels: 21, convictions: 5 },
    { kind: "run", handle: null, day: 0, ms: 0, sats: 9400, bears: 14, levels: 12, convictions: 0 },
  ];
  for (const s of samples) {
    const round = decodeSaylorCard(encodeSaylorCard(s));
    ok(!!round && round.kind === s.kind, `saylor-card roundtrip keeps kind (${s.kind})`);
    if (s.kind === "summit") {
      ok(round?.day === s.day && round?.ms === s.ms, "summit card roundtrips day + ms");
    } else {
      ok(round?.sats === s.sats && round?.bears === s.bears && round?.levels === s.levels,
        `${s.kind} card roundtrips sats + bears + levels`);
    }
  }
  // A missing/unknown kind nulls the card (generic fallback billboard).
  ok(decodeSaylorCard("n42~m1000") === null, "card with no kind decodes to null");
  ok(decodeSaylorCard("kZ~n42") === null, "card with unknown kind decodes to null");
  // fmtSummitMs mirrors the game's mm:ss.cc and bounds to the budget.
  ok(fmtSummitMs(83450) === "1:23.45", "fmtSummitMs formats mm:ss.cc");
  ok(SUMMIT_BASE_MS === 240000, "SUMMIT_BASE_MS pinned at the 4:00 budget");
}
// Game-side encoder replica pins (the static file's saylorCardUrl must
// stay byte-identical to encodeSaylorCard).
ok(html.includes('"galaxymind.space/super-saylor/c/"'),
  "game hard-codes the card base URL the route serves");
ok(html.includes('{ summit: "s", victory: "v", run: "r" }'),
  "game kind codes match the lib KIND_TO_CH map");
for (const tag of ['"k" +', '"n" +', '"m" +', '"t" +', '"b" +', '"l" +', '"c" +', '"h" +']) {
  ok(html.includes(tag), `game replica emits field tag ${tag}`);
}
ok(html.includes("saylorCardUrl({ kind: \"summit\"") &&
   html.includes("saylorCardUrl({ kind: \"victory\"") &&
   html.includes("saylorCardUrl({ kind: \"run\""),
  "all three share texts mint a card URL (summit/victory/run)");
// Wordle-style daily ritual line · day-numbered, spoiler-free, mountain
// glyph + honest minutes ribbon (no fabricated quality tiers).
ok(html.includes("SUPER SAYLOR ⛰️ Daily Summit #") && html.includes("summitRibbon"),
  "summit share leads with the day-numbered ritual line");
ok(html.includes('"🟧".repeat(used)') && html.includes('"⬛".repeat(4 - used)'),
  "minutes ribbon is honest (one block per minute of the 4:00 budget)");
// Challenge deep link · ?summit=<ms>&sd=<day>, day-gated, fair.
ok(html.includes("function readChallenge()") && html.includes('q.get("summit")') && html.includes('q.get("sd")'),
  "challenge deep link reads ?summit + ?sd");
ok(html.includes("sd === arcadeDayNumber()"),
  "challenge only activates on today's mountain (fairness · same level for all)");
ok(html.includes("ms <= SUMMIT_BASE_MS"),
  "challenge ms is clamped to the summit budget");
ok(html.includes("if (readChallenge()) UI.open(UI.summitPanel())"),
  "challenge lands on the summit hub, routing play through real startSummit()");
// Fairness: the deep link must NOT auto-start via __SS (assisted runs
// never post) and must not feed the URL day into submitSummit.
ok(!/readChallenge[\s\S]{0,400}__SS/.test(html),
  "challenge handler never touches the __SS assisted path");

// ---- The Bitcoin Wizard · Adam Livingston (2026-07-12) ---------------------
// Third playable hero + capital-era NPC ally. Sprite shares the human
// rig; cfg.wizard adds a big hat + full robe (Saylor/Phong untouched).
ok(html.includes("const WIZARD_CFG = {") && html.includes("wizard: true, hatBand:"),
  "WIZARD_CFG present and flags wizard: true");
ok(html.includes('["wizard", WIZARD_CFG]'),
  "wizard baked into the SPR.cast roster");
ok(html.includes("function bakeWizard(") && html.includes("cfg.wizard ? bakeWizard("),
  "wizard baked via bakeWizard (Saylor/Phong stay on bakeHuman)");
ok(html.includes("c.width = 28; c.height = 48;"),
  "wizard rides a taller 48px canvas (room for a full robe + big hat)");
ok(html.includes("set.idle.height > 40") && html.includes("spr.height > 40"),
  "player + ally draw the taller wizard at 24px with the feet aligned");
// EVERY active-hero draw must be height-aware · the finale cinema walk-in
// draws via a local `frame` var and was the one site that slipped the net
// (review 2026-07-12). Pin all four active-hero draw sites height-guarded.
ok(html.includes("frame.height > 40") && html.includes("SPR.saylor.idle.height > 40"),
  "cinema walk-in + HUD/title hero draws are height-aware (no wizard squish)");
ok((html.match(/height > 40/g) || []).length >= 5,
  "every active-hero draw site guards the taller wizard canvas");
ok(html.includes("CTRL_NAME = { saylor:") && html.includes("wizard:"),
  "setHero maps the wizard mission-control portrait");
// NPC ally · capital-era levels, kept OUT of the pickup/reachability set.
ok(html.includes("data.n === 15 || data.n === 17 || data.n === 19"),
  "wizard NPC hard-placed on capital levels 15/17/19");
ok(html.includes("bears, pickups, projectiles: [], allies,"),
  "allies ride their own array (not pickups · never a reachability gate)");
ok(html.includes("P.pow.STRK = BAL.POW_T.STRK") && html.includes("CEBE ORB"),
  "NPC boon reuses the STRK powerup plumbing (CEBE orb · declaw)");
ok(html.includes("SAVE.wizardMet = true; persist(\"wizardMet\")"),
  "meeting the NPC unlocks the playable wizard (persisted)");
// Playable · save migration + toggle + alchemy identity.
ok(html.includes('wizardMet: !!store.get("wizardMet", false)'),
  "SAVE carries the wizard-unlock flag");
ok(html.includes('SAVE.wizardMet ? ["saylor", "phong", "wizard"] : ["saylor", "phong"]'),
  "hero toggle gates the wizard behind the unlock");
ok(html.includes('SAVE.settings.hero === "wizard"') && /hero === "wizard"[\s\S]{0,80}addSats\(25/.test(html),
  "wizard alchemy banks +25 real sats on a non-boss stomp");
// Quote bank · in-character, house rules honored.
{
  // slice() keys off the first global "];", which precedes this array ·
  // extract the block by hand instead (first "];" AFTER the start).
  const qStart = html.indexOf("const WIZARD_QUOTES = [");
  const qEnd = html.indexOf("];", qStart);
  const qs = qStart >= 0 && qEnd > qStart ? html.slice(qStart, qEnd) : "";
  ok(qs.length > 100, "WIZARD_QUOTES bank present");
  ok(!qs.includes("—"), "no em dashes in the wizard quotes");
  ok(!qs.includes("88"), "no 88 in the wizard quotes");
  ok(/DECLAW|truth money|alchemy|siege engine/i.test(qs),
    "quotes carry Adam's voice (declaw / truth money / alchemy)");
}

// ---- Regression guards (2026-07-12) ----------------------------------------
// Zoom-token render must pivot the pull-back around the SCREEN centre
// (CAM + half-view), NOT the world origin · pivoting around (VW/2, VH/2)
// flung the player off-screen on wide right-side levels next to a pit
// (summit LV20 "character disappears and loses a life").
ok(html.includes("CAM.x + VW / 2") && html.includes("x2.scale(z, z)"),
  "zoom pull-back pivots around the screen centre (off-screen-death fix)");
ok(!/x2\.translate\(VW \/ 2, VH \/ 2\);\s*x2\.scale\(z, z\)/.test(html),
  "zoom no longer pivots around the world origin");
// Wizard alchemy must bank sats WITHOUT conviction · else the wizard-only
// One Chair (faster + invincible) would beat Saylor/Phong on the
// time-based daily summit board (fairness).
ok(html.includes("function addSats(n, x, y, noConv, noGrade)") && html.includes("if (!noConv) P.conviction"),
  "addSats supports a no-conviction mode");
ok(html.includes('addSats(25, b.x, b.y, true, true)'),
  "wizard alchemy banks sats with NO conviction (summit fairness)");

// ---- Wizard fairness / integrity (audit 2026-07-13) -----------------------
// The CEBE ORB boon (STRK declaw + conviction) is CAMPAIGN ONLY · on a
// summit day whose mountain is 15/17/19 it would hand free crowd control +
// a faster One Chair to whoever finds him, on a shared TIME board. Summit
// keeps the flavor + unlock; the grant lives in the campaign `else`.
ok(html.includes('GAME.mode === "summit"') && html.includes('"TRUTH MONEY"') &&
   /GAME\.mode === "summit"[\s\S]{0,300}else \{[\s\S]{0,240}P\.pow\.STRK = BAL\.POW_T\.STRK/.test(html),
  "wizard boon is campaign-only · summit is flavor (TRUTH MONEY) + unlock, no STRK/conviction");
// Alchemy sats bank to RUN.sats but NOT the clear grade · else a few kills
// buy an S-rank sat line without collecting orange dots.
ok(html.includes("if (!noGrade) LVL.satGot += n"),
  "alchemy sats are excluded from LVL.satGot (grade fairness)");
// CEBE ORB can't be re-farmed by dying next to the wizard · respawn
// restores each ally's used flag the way it restores pickups.
ok(html.includes("allyUsed: (LVL.allies || []).map((a) => a.used)") &&
   html.includes("LVL.allies.forEach((a, i) => { if (keep.allyUsed[i]) a.used = true; })"),
  "ally used-state survives respawn (no CEBE ORB death-farm)");
// Ally stands on the MAIN walkway, not a raised platform (level 17 was a
// missable unlock) · placement prefers the lowest solid near spawn ground.
ok(html.includes("the lowest solid = main floor") && html.includes("Math.abs(top - groundTop) <= 40"),
  "ally placement prefers the ground walkway near spawn, not a high ledge");
// Boot can't start an illegally-unlocked wizard from a tampered save.
ok(/!SAVE\.wizardMet && SAVE\.settings\.hero === "wizard"[\s\S]{0,90}SAVE\.settings\.hero = "saylor"/.test(html),
  "boot clamps hero to saylor when the wizard is not yet unlocked");
// The staff was never drawn · cfg + comments must not claim one.
ok(!html.includes("staff:") && !html.includes("hat + staff"),
  "no phantom staff · WIZARD_CFG and comments match the drawn sprite");

// SEO/a11y shell
ok(html.includes('<link rel="canonical" href="https://galaxymind.space/super-saylor">'),
  "canonical URL pinned (page is reachable at two URLs)");
ok(html.includes("<main") && html.includes("</main>") && html.includes("<h1"),
  "cabinet wrapped in <main> with an <h1>");
// Site-discovery frame (2026-07-13) · the game must not be a dead end · a
// brand marquee + explore bar link to the rest of Galaxy Mind so players
// can find the tools + directory (growth). Same-origin nav, inline SVG.
ok(
  html.includes('id="marquee"') &&
    html.includes('id="explore"') &&
    html.includes('href="/arcade"') &&
    html.includes('href="/stack"') &&
    html.includes('href="/float"') &&
    html.includes('href="/treasuries"'),
  "site-discovery frame links out to the rest of Galaxy Mind (no dead end)",
);

console.log(fail === 0 ? `  all ${pass} assertions passed` : `  ${fail} FAILED / ${pass} passed`);
if (fail > 0) process.exit(1);
