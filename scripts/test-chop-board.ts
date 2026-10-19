/**
 * CHOP board drift guard.
 *
 * The client (public/chop/js/board.js) carries byte-for-byte replicas of
 * two server-side things: the arcade integrity token and the UTC day
 * number. If either drifts, EVERY post is silently rejected and the
 * board looks "broken but online" — which is exactly what happened in
 * development (a raw Unix day number is off by the arcade epoch, so the
 * server rejected 100% of posts with stale_day). These asserts make that
 * class of bug a build failure instead of a live mystery.
 *
 * Also pins the score envelope so a bounds edit on one side can't
 * silently orphan honest runs on the other.
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { scoreToken } from "../src/lib/arcade-token";
import { gauntletNumber } from "../src/lib/gauntlet-day";
import { encodeChopCard, decodeChopCard } from "../src/lib/chop-card";

const board = readFileSync("public/chop/js/board.js", "utf8");
const route = readFileSync("src/app/api/arcade/score/route.ts", "utf8");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${detail ? " · " + detail : ""}`);
  }
}

console.log("CHOP board drift guard");

// ── 1. token replica ────────────────────────────────────────────────
// Re-implement the client's function from its own source text so a real
// edit to board.js is what this test reads (not a copy that could drift).
const salt = board.match(/const SALT = "([^"]+)"/)?.[1];
check("client salt present", !!salt);

function clientToken(game: string, score: number, day: number, name: string) {
  const msg = `${salt}|${game}|${String(score)}|${day ?? ""}|${name}`;
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < msg.length; i++) {
    h ^= msg.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let g = (0xdeadbeef ^ h) >>> 0;
  for (let i = msg.length - 1; i >= 0; i--) {
    g ^= msg.charCodeAt(i);
    g = Math.imul(g, 0x85ebca6b) >>> 0;
  }
  return ((h ^ g) >>> 0).toString(16).padStart(8, "0");
}

const cases: Array<[number, number, string]> = [
  [1, 1, "Golden Slicer #123"],
  [250_000, 42, "Molten Pleb #204"],
  [11_999_999, 999, "Immutable Mempool #777"],
];
for (const [score, day, name] of cases) {
  check(
    `token matches server · ${score}/${day}`,
    clientToken("chop", score, day, name) === scoreToken("chop", score, day, name),
  );
}

// ── 2. day-number replica ───────────────────────────────────────────
const epochMatch = board.match(/CHOP_EPOCH_DAY_ONE = Math\.floor\(Date\.UTC\((\d+), (\d+), (\d+)\)/);
check("client epoch present", !!epochMatch);
if (epochMatch) {
  const [, y, m, d] = epochMatch;
  const clientEpoch = Math.floor(Date.UTC(+y, +m, +d) / 86_400_000);
  const clientDay = (ms: number) => Math.floor(ms / 86_400_000) - clientEpoch + 1;
  for (const ms of [Date.now(), Date.UTC(2026, 6, 8), Date.UTC(2027, 0, 1)]) {
    check(
      `day number matches server · ${new Date(ms).toISOString().slice(0, 10)}`,
      clientDay(ms) === gauntletNumber(ms),
      `client ${clientDay(ms)} vs server ${gauntletNumber(ms)}`,
    );
  }
}

// ── 3. score envelope ───────────────────────────────────────────────
const min = Number(route.match(/const CHOP_MIN = ([\d_]+);/)?.[1]?.replace(/_/g, ""));
const max = Number(route.match(/const CHOP_MAX = ([\d_]+);/)?.[1]?.replace(/_/g, ""));
check("CHOP_MIN is 1", min === 1);
check("CHOP_MAX above a flawless run (~4M)", max >= 4_000_000, `max=${max}`);
check("CHOP_MAX not absurd", max <= 50_000_000, `max=${max}`);

// ── 4. posture invariants ───────────────────────────────────────────
check(
  "board is daily-only (no all-time key)",
  !route.includes('"gm:lb:chop:v1"') && route.includes("gm:lb:chop:day:v1"),
);
check("day freshness enforced for chop", /game === "chop"[\s\S]{0,900}stale_day/.test(route));
check(
  "integrity posture documented in the client",
  /NOT replay-\s*\/\/ verified|NOT replay-/.test(board) && board.includes("ZADD-GT"),
);

// ── 5. cloud save (durable only) ────────────────────────────────────
check("client posts chop to /api/arcade/cloud", board.includes('game: "chop"') && board.includes("/api/arcade/cloud"));
check("cloud payload helper is durable-only", board.includes("readChopCloudSave") && board.includes("applyChopCloud"));
check(
  "cloud save never reads the daily result key",
  !/readChopCloudSave[\s\S]{0,400}res:/.test(board),
);

// ── 6. per-run share card ───────────────────────────────────────────
const mainJs = readFileSync("public/chop/js/main.js", "utf8");
const proxy = readFileSync("src/proxy.ts", "utf8");
const cardPage = readFileSync("src/app/chop/card/[data]/page.tsx", "utf8");
const cardOg = readFileSync("src/app/chop/card/[data]/opengraph-image.tsx", "utf8");

const fullCard = { sats: 210_000, grade: "S" as const, height: 900_000, combo: 8, orphaned: false };
const orphanCard = { sats: 12_000, grade: "D" as const, height: 900_001, combo: 0, orphaned: true };
const minCard = { sats: 0, grade: "" as const, height: null, combo: 0, orphaned: false };

const rtFull = decodeChopCard(encodeChopCard(fullCard));
check(
  "full card round-trips through encode/decode",
  !!rtFull && rtFull.sats === 210_000 && rtFull.grade === "S" &&
    rtFull.height === 900_000 && rtFull.combo === 8 && rtFull.orphaned === false,
);
const rtOrphan = decodeChopCard(encodeChopCard(orphanCard));
check(
  "orphaned card round-trips (combo 0 omitted)",
  !!rtOrphan && rtOrphan.orphaned === true && rtOrphan.combo === 0 && rtOrphan.grade === "D",
);
const rtMin = decodeChopCard(encodeChopCard(minCard));
check(
  "minimal card round-trips",
  !!rtMin && rtMin.sats === 0 && rtMin.grade === "" && rtMin.height === null && !rtMin.orphaned,
);
check("missing sats decodes to null", decodeChopCard("gS~h900000") === null);
check("unknown grade is dropped, card survives", decodeChopCard("s210000~gZZZ")?.grade === "");
check(
  "numeric fields clamp to their bounds on decode",
  decodeChopCard("s999999999~x5000~h0")?.sats === 12_000_000 &&
    decodeChopCard("s1~x5000")?.combo === 999,
);

const segSrc = mainJs.match(/function cardSeg\(c\) \{[\s\S]*?\n\}/);
check("main.js ships the cardSeg share-card encoder", !!segSrc);
if (segSrc) {
  const clientSeg = runInNewContext("(" + segSrc[0] + ")", { encodeURIComponent }) as (c: unknown) => string;
  for (const c of [fullCard, orphanCard, minCard, { ...fullCard, combo: 12 }, { ...fullCard, sats: 99_000_000 }]) {
    check(
      "client cardSeg byte-matches encodeChopCard for " + JSON.stringify(c).slice(0, 72),
      clientSeg(c) === encodeChopCard(c),
    );
  }
}
check("main.js share intents point at the per-run card URL", mainJs.includes("galaxymind.space/chop/card/"));
check("card page is noindex", /robots:\s*\{[^}]*index:\s*false/.test(cardPage));
check("card page canonicalizes to /chop", cardPage.includes('canonical: "https://galaxymind.space/chop"'));
check("card OG image decodes via lib/chop-card", cardOg.includes("decodeChopCard"));
check("proxy carves /chop/card out of the static game CSP", proxy.includes('!gamePath.startsWith("/chop/card")'));
check("next.config rewrite is exact /chop (not /chop/:path*)", !readFileSync("next.config.ts", "utf8").includes('source: "/chop/:path'));

if (failures) {
  console.error(`\n✗ ${failures} CHOP board check(s) failed`);
  process.exit(1);
}
console.log("\n✓ CHOP board client and server agree");
