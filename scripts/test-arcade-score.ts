/**
 * Arcade score packing invariants · runner integer packing + horizon
 * height fraction. Prevents the 9,999-sat board saturation regression.
 * Plus the WEN/Gauntlet replay-verification invariants (2026-07-11):
 * a valid proof replays to its claimed score; tampered scores, wrong
 * days, and malformed proofs bounce.
 */

import {
  decodeHorizonScore,
  decodeRunnerScore,
  encodeHorizonScore,
  encodeRunnerScore,
  formatRunnerScore,
  isValidRunnerScore,
  RUNNER_DAYS_MAX,
  RUNNER_SATS_BASE,
  RUNNER_SATS_MAX,
} from "../src/lib/arcade-score";
import { matchProfanityOrSlur } from "../src/lib/nostr-content-filter";
import {
  MAX_GAUNTLET_ACTIONS,
  gauntletDailySeed,
  parseGauntletProof,
  parseWenProof,
  verifyGauntletProof,
  verifyWenProof,
  type GauntletAction,
} from "../src/lib/arcade-replay";
import {
  RUN_DAYS,
  advanceDay,
  buy,
  createState,
  finish,
  mulberry32,
  openMargin,
  sell,
  setupRun,
  type BtcPoint,
} from "../src/app/gauntlet/engine";
import {
  DAY_MS,
  evaluateGuess,
  scoreRun,
  utcDayIndex,
  wenAnswerUtc,
  wenGuessBounds,
  type WenGuessResult,
} from "../src/lib/wen";
import { gauntletDayStartUtc } from "../src/lib/gauntlet-day";

let failures = 0;
function check(desc: string, ok: boolean) {
  if (ok) console.log(`  PASS  ${desc}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${desc}`);
  }
}

console.log("\n🕹️  Arcade score packing\n");

{
  const packed = encodeRunnerScore(1415, 48_320);
  check("encode: days*1e6 + sats", packed === 1_415_048_320);
  const { days, sats } = decodeRunnerScore(packed);
  check("decode round-trip", days === 1415 && sats === 48_320);
  check(
    "format shows real sats not 9999",
    formatRunnerScore(packed).includes("48,320") &&
      !formatRunnerScore(packed).includes("9,999"),
  );
}

{
  // The broken legacy shape every long run produced under v2 packing.
  check("legacy 1415.9999 rejected", !isValidRunnerScore(1415.9999));
  check("legacy 1.9999 rejected", !isValidRunnerScore(1.9999));
  check("valid packed accepted", isValidRunnerScore(encodeRunnerScore(100, 5000)));
  check("zero days rejected", !isValidRunnerScore(encodeRunnerScore(0, 100)));
  // encode CLAMPS days at max so a present-reacher is never silently
  // rejected (2026-07-10) · but the validator still rejects a raw
  // over-max score a spoofer might hand-craft.
  check(
    "encode clamps days at max (present-reacher always posts)",
    isValidRunnerScore(encodeRunnerScore(RUNNER_DAYS_MAX + 5, 4200)) &&
      decodeRunnerScore(encodeRunnerScore(RUNNER_DAYS_MAX + 5, 4200)).days ===
        RUNNER_DAYS_MAX,
  );
  check(
    "validator rejects a raw over-max score",
    !isValidRunnerScore((RUNNER_DAYS_MAX + 1) * RUNNER_SATS_BASE),
  );
}

{
  // Cap: sats above RUNNER_SATS_MAX clamp, still valid, still ordered
  // after a same-day lower run.
  const a = encodeRunnerScore(200, 50_000);
  const b = encodeRunnerScore(200, 2_000_000); // clamps to max
  const c = encodeRunnerScore(201, 0);
  check("sats cap applied", decodeRunnerScore(b).sats === RUNNER_SATS_MAX);
  check("more sats ranks higher same days", b > a);
  check("more days ranks higher than sats", c > b);
}

{
  const h = encodeHorizonScore(614_515, 37);
  const d = decodeHorizonScore(h);
  check("horizon encode/decode", d.sats === 614_515 && d.height === 37);
}

{
  // Leaderboard-name profanity screen · /api/arcade/score runs the
  // trimmed handle through matchProfanityOrSlur before any ZADD, so a
  // crafted-but-regex-valid handle can't sit on a public board for its
  // 180-day TTL. Assert the shared matcher catches handle-shaped
  // strings and passes the generator's real vocabulary.
  check(
    "profane handle caught (word-boundary, case-insensitive)",
    matchProfanityOrSlur("Fucking Hornet #421")?.kind === "profanity",
  );
  check(
    "slur handle caught",
    matchProfanityOrSlur("Nigga Whale #123")?.kind === "slur",
  );
  check(
    "hyphenated part still word-boundary matched",
    matchProfanityOrSlur("Shit-Coiner Marty #777") != null,
  );
  check(
    "legit generator-style handle passes",
    matchProfanityOrSlur("Sovereign Hornet #210") === null,
  );
  check(
    // "class"/"assess"-style embeddings must NOT trip the boundary
    // match · the screen rejects words, not substrings.
    "embedded substring does not false-positive",
    matchProfanityOrSlur("Classy Assessor #333") === null,
  );
}

// ═════════════════════════════════════════════════════════════════════
// Replay verification · lib/arcade-replay (WEN + Gauntlet daily boards)
// ═════════════════════════════════════════════════════════════════════

console.log("\n🔁 Gauntlet replay verification\n");

// Fixed wall clock + synthetic Yahoo-shaped raw series (unix seconds,
// daily midnight closes, ends "today") · everything below is
// deterministic.
const NOW_MS = Date.UTC(2026, 6, 10, 15, 0, 0);
const nowMidSec = Math.floor(NOW_MS / 86_400_000) * 86_400;
const RAW_DAYS = 1830;
const raw: BtcPoint[] = Array.from({ length: RAW_DAYS }, (_, i) => ({
  t: nowMidSec - (RAW_DAYS - 1 - i) * 86_400,
  p: 30_000 + 12_000 * Math.sin(i / 60) + i * 8,
}));

// What a fresh client sees: /api/history's 1825d cutoff, then the
// game's trailing-2 trim.
const cutoffSec = Math.floor(NOW_MS / 1000) - 1825 * 86_400;
const i0 = raw.findIndex((p) => p.t >= cutoffSec);
const clientPts = raw.slice(i0, raw.length - 2);
// What a client whose /api/history response was cached before the day
// boundary sees: one extra leading point.
const stalePts = raw.slice(i0 - 1, raw.length - 2);

/** Drive the engine exactly the way GauntletGame + the server replay
 *  do: actions at run-day d apply after the day-d boundary. */
function simulateGauntlet(
  pts: BtcPoint[],
  day: number,
  actions: GauntletAction[],
): number {
  const seed = gauntletDailySeed(day);
  const setup = setupRun(pts, seed, "daily", day, 0);
  const s = createState(setup);
  const rng = mulberry32(seed ^ 0x51ed);
  let ai = 0;
  const applyAt = (d: number) => {
    while (ai < actions.length && actions[ai][0] === d) {
      const [, k, v] = actions[ai++];
      if (k === 0) buy(s, setup, v);
      else if (k === 1) sell(s, setup, v);
      else openMargin(s, setup, v);
    }
  };
  applyAt(0);
  while (s.day < RUN_DAYS) {
    advanceDay(s, setup, rng);
    applyAt(s.day);
  }
  return finish(s, setup).alpha;
}

{
  const day = 3;
  const actions: GauntletAction[] = [
    [0, 0, 2_000],
    [5, 0, 1_000],
    [80, 1, 0.5],
    [120, 0, 250],
    [200, 1, 1],
  ];
  const alpha = simulateGauntlet(clientPts, day, actions);
  check(
    "valid replay accepted",
    verifyGauntletProof(raw, NOW_MS, day, actions, alpha),
  );
  check(
    "tampered score rejected",
    !verifyGauntletProof(raw, NOW_MS, day, actions, alpha + 1) &&
      !verifyGauntletProof(raw, NOW_MS, day, actions, alpha + 0.2),
  );
  check(
    "wrong day rejected (different seed → different window)",
    !verifyGauntletProof(raw, NOW_MS, day + 1, actions, alpha),
  );
  check(
    "tampered action log rejected",
    !verifyGauntletProof(
      raw,
      NOW_MS,
      day,
      [...actions, [230, 0, 5_000]],
      alpha,
    ),
  );
  check(
    "empty action log (pure hold) accepted",
    verifyGauntletProof(raw, NOW_MS, day, [], simulateGauntlet(clientPts, day, [])),
  );
  const withMargin: GauntletAction[] = [
    [0, 0, 5_000],
    [40, 2, 1_500],
  ];
  check(
    "margin action replays",
    verifyGauntletProof(
      raw,
      NOW_MS,
      day,
      withMargin,
      simulateGauntlet(clientPts, day, withMargin),
    ),
  );
}

{
  // Leading-edge tolerance: find a day whose seed clamps to index 0
  // (window depends on the series' leading edge), play it on the STALE
  // series, and confirm the verifier still accepts via its offset
  // candidates. Guards the /api/history 6h-response-cache skew.
  let clampedDay = -1;
  for (let d = 1; d <= 500; d++) {
    const seed = gauntletDailySeed(d);
    const a = setupRun(clientPts, seed, "daily", d, 0);
    const b = setupRun(stalePts, seed, "daily", d, 0);
    if (a.times[0] !== b.times[0]) {
      clampedDay = d;
      break;
    }
  }
  check("a leading-edge-sensitive day exists in the scan", clampedDay > 0);
  if (clampedDay > 0) {
    const actions: GauntletAction[] = [
      [10, 0, 3_000],
      [90, 1, 0.25],
    ];
    const staleAlpha = simulateGauntlet(stalePts, clampedDay, actions);
    const freshAlpha = simulateGauntlet(clientPts, clampedDay, actions);
    check(
      "stale-cache client window really differs",
      Math.abs(staleAlpha - freshAlpha) > 1e-9,
    );
    check(
      "stale-cache client score still verifies (lead-offset candidate)",
      verifyGauntletProof(raw, NOW_MS, clampedDay, actions, staleAlpha),
    );
  }
}

{
  check("proof parse: valid log accepted", parseGauntletProof([[0, 0, 250]]) != null);
  check(
    "proof parse: over-cap log rejected",
    parseGauntletProof(
      Array.from({ length: MAX_GAUNTLET_ACTIONS + 1 }, () => [0, 0, 250]),
    ) == null,
  );
  check(
    "proof parse: non-chronological days rejected",
    parseGauntletProof([
      [50, 0, 250],
      [10, 0, 250],
    ]) == null,
  );
  check("proof parse: unknown kind rejected", parseGauntletProof([[0, 3, 250]]) == null);
  check(
    "proof parse: sell fraction above 1 rejected",
    parseGauntletProof([[0, 1, 1.5]]) == null,
  );
  check(
    "proof parse: sub-dollar buy rejected",
    parseGauntletProof([[0, 0, 0.5]]) == null,
  );
  check("proof parse: non-array rejected", parseGauntletProof("hax") == null);
}

console.log("\n🔁 WEN replay verification\n");

{
  // Pick a puzzle day whose answer sits comfortably mid-range (so the
  // ±60d test guesses stay inside the guessable bounds) AND whose
  // NEXT day's answer is far away (so the wrong-day check can't
  // accidentally still be a bullseye). Deterministic scan.
  let n = -1;
  for (let d = 300; d <= 900; d++) {
    const back =
      (gauntletDayStartUtc(d) - wenAnswerUtc(d)) / DAY_MS;
    const drift = Math.abs(
      utcDayIndex(wenAnswerUtc(d)) - utcDayIndex(wenAnswerUtc(d + 1)),
    );
    if (back >= 200 && back <= 1600 && drift > 30) {
      n = d;
      break;
    }
  }
  check("a mid-range WEN day exists in the scan", n > 0);

  // Series ends on the puzzle day · daily midnights, no gaps, so the
  // effective answer equals the engine answer.
  const dayStartSec = gauntletDayStartUtc(n) / 1000;
  const wenRaw: BtcPoint[] = Array.from({ length: 1830 }, (_, i) => ({
    t: dayStartSec - (1829 - i) * 86_400,
    p: 40_000 + 9_000 * Math.sin(i / 45) + i * 5,
  }));
  const answer = wenAnswerUtc(n);

  // First-guess bullseye → perfect 10,000.
  const perfect = scoreRun([evaluateGuess(answer, answer)]);
  check("perfect run scores 10,000", perfect === 10_000);
  check(
    "valid replay accepted (bullseye)",
    verifyWenProof(wenRaw, n, [answer], perfect),
  );
  check(
    "tampered score rejected",
    !verifyWenProof(wenRaw, n, [answer], perfect - 1),
  );
  check(
    "wrong day rejected (answer re-derives from the day number)",
    !verifyWenProof(wenRaw, n + 1, [answer], perfect),
  );

  // Full five-guess run, no bullseye · closing in from ±60 days.
  const offsets = [60, -45, 30, -20, 9];
  const guesses = offsets.map((o) => answer + o * DAY_MS);
  const results: WenGuessResult[] = guesses.map((g) =>
    evaluateGuess(g, answer),
  );
  const sats = scoreRun(results);
  check(
    "five-guess run stays inside the guessable bounds",
    guesses.every(
      (g) => g >= wenGuessBounds(n).minUtc && g <= wenGuessBounds(n).maxUtc,
    ) && results.every((r) => r.band !== "bull"),
  );
  check("valid replay accepted (5 guesses)", verifyWenProof(wenRaw, n, guesses, sats));
  check(
    "tampered 5-guess score rejected",
    !verifyWenProof(wenRaw, n, guesses, sats + 1),
  );
  check(
    "short run without a bullseye rejected (fabricated early exit)",
    !verifyWenProof(wenRaw, n, guesses.slice(0, 3), scoreRun(results.slice(0, 3))),
  );
  check(
    "mid-run bullseye rejected (a hit ends the round)",
    !verifyWenProof(
      wenRaw,
      n,
      [answer, answer + 100 * DAY_MS],
      scoreRun([
        evaluateGuess(answer, answer),
        evaluateGuess(answer + 100 * DAY_MS, answer),
      ]),
    ),
  );
  check(
    "guess outside the guessable bounds rejected",
    !verifyWenProof(wenRaw, n, [gauntletDayStartUtc(n)], 0),
  );
  check("proof parse: empty rejected", parseWenProof([]) == null);
  check(
    "proof parse: six guesses rejected",
    parseWenProof([1, 2, 3, 4, 5, 6].map((x) => answer + x * DAY_MS)) == null,
  );
  check("proof parse: non-number rejected", parseWenProof(["soon"]) == null);
}

if (failures > 0) {
  console.error(`\n✗ ${failures} arcade-score invariant(s) failed`);
  process.exit(1);
}
console.log("\n✓ all arcade-score invariants hold.");
