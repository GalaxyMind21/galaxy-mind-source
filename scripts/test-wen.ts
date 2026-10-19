// WEN engine invariants. Run with `npx tsx scripts/test-wen.ts`.
// Wired into `npm run verify` · exits non-zero on any failure.

import {
  DAY_MS,
  WEN_BULLSEYE_DAYS,
  WEN_GUESSES,
  WEN_RECENT_EXCLUDE_DAYS,
  WEN_SATS_MAX,
  WEN_SPAN_DAYS,
  WEN_WINDOW_DAYS,
  bandFor,
  buildShareText,
  cardGridLine,
  decodeWenCard,
  encodeWenCard,
  evaluateGuess,
  gridCell,
  isValidWenScore,
  scoreRun,
  wenAnswerUtc,
  wenGuessBounds,
  type WenGuessResult,
} from "../src/lib/wen";
import { gauntletDayStartUtc, gauntletNumber } from "../src/lib/gauntlet-day";

let failures = 0;
function check(desc: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${desc}`);
  } else {
    failures++;
    console.error(`  FAIL  ${desc}${detail ? ` · ${detail}` : ""}`);
  }
}

console.log("\n🕰️  WEN engine\n");

// ── day math round-trip ─────────────────────────────────────────────
{
  const n = 37;
  const start = gauntletDayStartUtc(n);
  check(
    "gauntletDayStartUtc inverts gauntletNumber",
    gauntletNumber(start) === n && gauntletNumber(start + DAY_MS - 1) === n,
  );
}

// ── answer determinism + eligibility ────────────────────────────────
{
  let deterministic = true;
  let inBounds = true;
  let excluded = true;
  let insideApiWindow = true;
  const seen = new Set<number>();
  for (let n = 1; n <= 2000; n++) {
    const a1 = wenAnswerUtc(n);
    const a2 = wenAnswerUtc(n);
    if (a1 !== a2) deterministic = false;
    const { minUtc, maxUtc } = wenGuessBounds(n);
    if (a1 < minUtc || a1 > maxUtc) inBounds = false;
    const dayStart = gauntletDayStartUtc(n);
    const backDays = (dayStart - a1) / DAY_MS;
    if (backDays < WEN_RECENT_EXCLUDE_DAYS) excluded = false;
    // Window START (answer - 89d) must sit ≥30d inside the API's
    // 1825-day sliding window as of the puzzle day.
    const windowStartBack = backDays + (WEN_WINDOW_DAYS - 1);
    if (windowStartBack > 1825 - 30) insideApiWindow = false;
    seen.add(a1);
  }
  check("answer is deterministic per day", deterministic);
  check("answer always inside the guessable bounds", inBounds);
  check(
    `recent ${WEN_RECENT_EXCLUDE_DAYS}d never the answer`,
    excluded,
  );
  check("window start stays ≥30d inside the 1825d API window", insideApiWindow);
  check(
    "answers vary across days (≥1200 distinct in 2000)",
    seen.size >= 1200,
    `distinct=${seen.size}`,
  );
  check(
    "guessable span equals WEN_SPAN_DAYS",
    (wenGuessBounds(7).maxUtc - wenGuessBounds(7).minUtc) / DAY_MS ===
      WEN_SPAN_DAYS,
  );
}

// ── guess evaluation: direction + bands + boundaries ────────────────
{
  const answer = Date.UTC(2024, 3, 19); // arbitrary fixed date
  const at = (d: number) => evaluateGuess(answer + d * DAY_MS, answer);
  check("exact guess is a bullseye hit", at(0).direction === "hit" && at(0).band === "bull");
  check("+7d is still bullseye", at(7).band === "bull" && at(-7).band === "bull");
  check("+8d guess (after answer) → answer is EARLIER", at(8).direction === "earlier" && at(8).band === "close");
  check("-8d guess (before answer) → answer is LATER", at(-8).direction === "later");
  check("30d boundary is close band", at(30).band === "close" && at(31).band === "warm");
  check("90d boundary is warm band", at(90).band === "warm" && at(91).band === "cold");
  check("365d boundary is cold band", at(365).band === "cold" && at(366).band === "ice");
  check("daysOff is absolute", at(-44).daysOff === 44 && at(44).daysOff === 44);
  check(
    "bandFor monotone across 0..500",
    (() => {
      const order = ["bull", "close", "warm", "cold", "ice"];
      let last = 0;
      for (let d = 0; d <= 500; d++) {
        const idx = order.indexOf(bandFor(d));
        if (idx < last) return false;
        last = idx;
      }
      return true;
    })(),
  );
}

// ── scoring: bounds, monotonicity, bonus semantics ──────────────────
{
  const r = (daysOff: number): WenGuessResult => ({
    daysOff,
    band: bandFor(daysOff),
    direction: bandFor(daysOff) === "bull" ? "hit" : "earlier",
  });
  check("empty run scores 0", scoreRun([]) === 0);
  check(
    "perfect first guess is exactly the cap",
    scoreRun([r(0)]) === WEN_SATS_MAX,
  );
  check(
    "all scores within 0..cap across sweep",
    (() => {
      for (let d = 0; d <= 2000; d += 13) {
        const s = scoreRun([r(d)]);
        if (s < 0 || s > WEN_SATS_MAX) return false;
      }
      return true;
    })(),
  );
  check(
    "closer best guess never scores fewer sats",
    (() => {
      let prev = Infinity;
      for (let d = 0; d <= 2000; d += 7) {
        const s = scoreRun([r(d)]);
        if (s > prev) return false;
        prev = s;
      }
      return true;
    })(),
  );
  const bullFirst = scoreRun([r(3)]);
  const bullThird = scoreRun([r(400), r(50), r(3)]);
  const bullLast = scoreRun([r(400), r(300), r(200), r(50), r(3)]);
  check(
    "earlier bullseye earns a bigger unused-guess bonus",
    bullFirst > bullThird && bullThird > bullLast,
    `1st=${bullFirst} 3rd=${bullThird} 5th=${bullLast}`,
  );
  check(
    "five-guess bullseye gets base only (no bonus)",
    // Same best guess (3d off) · bull at 1 carries the full 4x250
    // bonus, bull at 5 carries none, so they differ by exactly 1000.
    bullFirst - bullLast === 1000 && bullLast <= 9000,
  );
  check(
    "knowledgeable solve beats a bisection stall",
    scoreRun([r(400), r(60), r(5)]) > scoreRun([r(800), r(400), r(200), r(100), r(50)]),
  );
}

// ── share grid: fidelity + no spoilers ──────────────────────────────
{
  const rows: WenGuessResult[] = [
    { direction: "earlier", band: "cold", daysOff: 200 },
    { direction: "later", band: "warm", daysOff: 60 },
    { direction: "hit", band: "bull", daysOff: 2 },
  ];
  check("bullseye cell is the target alone", gridCell(rows[2]) === "🎯");
  check("earlier+cold cell", gridCell(rows[0]) === "⏪🟥");
  check("later+warm cell", gridCell(rows[1]) === "⏩🟧");
  const text = buildShareText(12, 8450, rows);
  const lines = text.split("\n");
  check("share text is exactly 3 lines", lines.length === 3);
  check(
    "share header carries number + formatted sats",
    lines[0] === "WEN #12 · 8,450 sats",
  );
  check("share grid row matches guesses", lines[1] === "⏪🟥 ⏩🟧 🎯");
  check("share links the game", lines[2] === "galaxymind.space/wen");
  check(
    "share text leaks no year (spoiler-free)",
    !/20\d\d/.test(text),
  );
  check("guess count constant is 5", WEN_GUESSES === 5);
  check("bullseye radius constant is 7", WEN_BULLSEYE_DAYS === 7);
}

// ── share card transport: roundtrip + clamps + fabrication rules ────
{
  const card = {
    n: 12,
    sats: 8450,
    cells: [
      { direction: "earlier" as const, band: "cold" as const },
      { direction: "later" as const, band: "warm" as const },
      { direction: "hit" as const, band: "bull" as const },
    ],
  };
  const seg = encodeWenCard(card);
  const back = decodeWenCard(seg);
  check(
    "card roundtrips exactly",
    !!back &&
      back.n === 12 &&
      back.sats === 8450 &&
      back.cells.length === 3 &&
      back.cells[2].band === "bull",
  );
  check(
    "card grid line matches share vocabulary",
    !!back && cardGridLine(back.cells) === "⏪🟥 ⏩🟧 🎯",
  );
  check(
    "card segment is a single url-safe token",
    !seg.includes("/") && !seg.includes("&") && !seg.includes("?"),
  );
  const over = decodeWenCard(encodeWenCard({ ...card, sats: 999_999 }));
  check("card sats clamp to the achievable cap", over?.sats === WEN_SATS_MAX);
  check(
    "mid-run bullseye is a fabricated shape · cells dropped",
    decodeWenCard("n4~s100~gttek")?.cells.length === 0,
  );
  check(
    "six cells is a fabricated shape · cells dropped",
    decodeWenCard("n4~s100~gekekekekekek")?.cells.length === 0,
  );
  check(
    "garbage cells drop without killing the card",
    (() => {
      const d = decodeWenCard("n4~s100~gzz");
      return !!d && d.cells.length === 0 && d.sats === 100;
    })(),
  );
  check("unusable core fields reject the card", decodeWenCard("gek") === null);
  check(
    "default share link unchanged · card link passes through",
    buildShareText(1, 5, []).endsWith("galaxymind.space/wen") &&
      buildShareText(1, 5, [], "galaxymind.space/wen/c/x").endsWith("/c/x"),
  );
}

// ── board score validation envelope ─────────────────────────────────
{
  check("valid: 0 and cap", isValidWenScore(0) && isValidWenScore(WEN_SATS_MAX));
  check(
    "valid: tolerates ZSET float noise",
    isValidWenScore(8449.9999) && isValidWenScore(8450.0001),
  );
  check(
    "invalid: negative, over-cap, non-integers, NaN",
    !isValidWenScore(-1) &&
      !isValidWenScore(WEN_SATS_MAX + 1) &&
      !isValidWenScore(4500.5) &&
      !isValidWenScore(Number.NaN),
  );
}

if (failures > 0) {
  console.error(`\n✗ ${failures} WEN invariant(s) failed.\n`);
  process.exit(1);
}
console.log("\n✓ all WEN invariants hold.\n");
