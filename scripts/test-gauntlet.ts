/* Gauntlet engine invariants (v2 · 2026-07-08).
 *
 * The whole game is a pure engine (src/app/gauntlet/engine.ts) so it
 * tests headless: determinism per seed, bot fairness, forced-sale
 * liquidity mechanics, margin liquidation math, badge triggers, and
 * the spoiler-free share grid. The UI is a thin painter over this.
 */

import {
  BILL_COUNT,
  CTX_DAYS,
  RUN_DAYS,
  SEGMENTS,
  START_CASH,
  advanceDay,
  buy,
  createState,
  eraMarkers,
  finish,
  gauntletNumber,
  marginEquity,
  mulberry32,
  openMargin,
  priceAt,
  sell,
  setupRun,
  shareText,
  type BtcPoint,
  runnerStartBackDays,
  locateRunnerStart,
} from "../src/app/gauntlet/engine";

let failures = 0;
function check(desc: string, ok: boolean) {
  if (ok) console.log(`  PASS  ${desc}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${desc}`);
  }
}

// Synthetic but realistic series: 1900 daily closes, trend + swing.
// t anchored so the FTX date (2022-11-08) falls inside when we want it.
function synthSeries(startIso: string, days: number, gen: (i: number) => number): BtcPoint[] {
  const t0 = Math.floor(new Date(startIso + "T00:00:00Z").getTime() / 1000);
  return Array.from({ length: days }, (_, i) => ({
    t: t0 + i * 86_400,
    p: gen(i),
  }));
}

const wave = synthSeries(
  "2021-06-01",
  1900,
  (i) => 30_000 + 12_000 * Math.sin(i / 60) + i * 8,
);

console.log("\n🎰 Gauntlet engine invariants\n");

// ── Determinism ──────────────────────────────────────────────────────
{
  const a = setupRun(wave, 1234, "daily", 7);
  const b = setupRun(wave, 1234, "daily", 7);
  check(
    "same seed → identical window",
    a.prices[0] === b.prices[0] &&
      a.times[CTX_DAYS] === b.times[CTX_DAYS] &&
      a.prices.length === CTX_DAYS + RUN_DAYS + 1,
  );
  const c = setupRun(wave, 1235, "daily", 8);
  check("different seed → different window", a.times[0] !== c.times[0]);

  const s1 = createState(a);
  const s2 = createState(b);
  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  for (let d = 1; d <= RUN_DAYS; d++) {
    advanceDay(s1, a, r1);
    advanceDay(s2, b, r2);
    if (d === 40) {
      buy(s1, a, 2000);
      buy(s2, b, 2000);
    }
  }
  check(
    "same seed + same actions → identical outcome",
    Math.abs(s1.youSeries[RUN_DAYS] - s2.youSeries[RUN_DAYS]) < 1e-9 &&
      s1.bills.map((x) => x.day).join() === s2.bills.map((x) => x.day).join(),
  );
  check(
    `bills pre-rolled (${BILL_COUNT}) inside the run`,
    s1.bills.length === BILL_COUNT &&
      s1.bills.every((x) => x.day >= 15 && x.day <= RUN_DAYS - 10),
  );
}

// ── Bot fairness · same salary, same bills ───────────────────────────
{
  const setup = setupRun(wave, 99, "practice", null);
  const s = createState(setup);
  const rng = mulberry32(7);
  for (let d = 1; d <= RUN_DAYS; d++) advanceDay(s, setup, rng);
  const report = finish(s, setup);
  const totalIn =
    START_CASH +
    Math.floor((RUN_DAYS - 1) / 30) * 1000 -
    s.bills.reduce((a, b) => a + b.amount, 0);
  check(
    "no-coiner bot ends at exactly cash-in minus bills",
    Math.abs(report.cashFinal - totalIn) < 0.01,
  );
  check(
    "idle player (all cash) tracks the no-coiner bot",
    Math.abs(s.fiat - report.cashFinal) < 0.01,
  );
  check("DCA bot holds BTC, not cash", s.dcaBtc > 0 && s.dcaFiat <= 0.01);
}

// ── Forced sale · the liquidity lesson ───────────────────────────────
{
  const setup = setupRun(wave, 5, "practice", null);
  const s = createState(setup);
  const rng = mulberry32(5);
  // Advance to the eve of the first bill, THEN go all-in · paydays
  // along the way cannot refill the pocket before the bill lands.
  for (let d = 1; d < s.bills[0].day; d++) advanceDay(s, setup, rng);
  buy(s, setup, s.fiat);
  advanceDay(s, setup, rng);
  check(
    "bill with empty fiat pocket forces a BTC sale",
    s.trades.some((t) => t.kind === "forced" && t.btc > 0),
  );
}

// ── Margin math ──────────────────────────────────────────────────────
{
  // Crash series: -3%/day → 2x position must liquidate before term.
  const crash = synthSeries("2024-01-01", 800, (i) => 60_000 * Math.pow(0.97, i));
  const setup = setupRun(crash, 11, "practice", null);
  const s = createState(setup);
  const rng = mulberry32(11);
  openMargin(s, setup, 2000);
  let liqDay = -1;
  for (let d = 1; d <= 40; d++) {
    advanceDay(s, setup, rng);
    if (s.liquidated && liqDay < 0) liqDay = d;
  }
  check("2x into a -3%/day crash → liquidated", s.liquidated && liqDay > 0);
  check(
    "liquidation eats the collateral (no refund trade)",
    !s.trades.some((t) => t.kind === "margin-close"),
  );

  // Pump series: +2%/day → position survives term and pays out.
  const pump = synthSeries("2024-01-01", 800, (i) => 30_000 * Math.pow(1.02, i));
  const setup2 = setupRun(pump, 12, "practice", null);
  const s2 = createState(setup2);
  const rng2 = mulberry32(12);
  const fiat0 = s2.fiat;
  openMargin(s2, setup2, 2000);
  for (let d = 1; d <= 35; d++) advanceDay(s2, setup2, rng2);
  const close = s2.trades.find((t) => t.kind === "margin-close");
  check(
    "2x into a pump closes at term with a profit",
    !!close && close.usd > 2000 && s2.fiat > fiat0 - 2000 + close!.usd - 0.01,
  );
  const eq = marginEquity({ collateral: 1000, entry: 100, openedDay: 0 }, 110);
  check("margin equity math: 2x exposure", Math.abs(eq - 1200) < 1e-9);
}

// ── Badges + share artifacts ─────────────────────────────────────────
{
  const setup = setupRun(wave, 21, "practice", null);
  const s = createState(setup);
  const rng = mulberry32(21);
  // Script a bottom-tick buy and a top-tick sell using known extremes.
  // Seed a position on day 1 so the top can be sold even when it
  // arrives before the low.
  buy(s, setup, 3000);
  for (let d = 1; d <= RUN_DAYS; d++) {
    advanceDay(s, setup, rng);
    const p = priceAt(setup, d);
    if (p <= setup.runMin * 1.001 && s.fiat > 500) buy(s, setup, 500);
    if (p >= setup.runMax * 0.999 && s.btc > 0) sell(s, setup, 0.5);
  }
  const report = finish(s, setup);
  const ids = report.badges.map((b) => b.id);
  check("knife-catcher badge on a low-tick buy", ids.includes("knife-catcher"));
  check("top-seller badge on a high-tick sell", ids.includes("top-seller"));
  check(`share grid is ${SEGMENTS} squares`, [...report.grid].length >= SEGMENTS);
  const txt = shareText(report, 12, 3);
  check(
    "daily share text carries number + streak + no dates",
    txt.includes("#12") && txt.includes("streak 3") && !txt.includes("202"),
  );
  const practice = shareText(report, null, 1);
  check("practice share text has no number", practice.includes("practice run"));
}

// ── Era markers use real dates ───────────────────────────────────────
{
  // Window that must contain FTX day: series spans 2022-06-01 onward;
  // seed hunt for a window containing 2022-11-08.
  const span = synthSeries("2022-06-01", 1400, (i) => 25_000 + i * 5);
  let found = false;
  for (let seed = 0; seed < 200 && !found; seed++) {
    const st = setupRun(span, seed, "practice", null);
    const eras = eraMarkers(st);
    if (eras.some((e) => e.label.includes("FTX"))) {
      found = true;
      const m = eras.find((e) => e.label.includes("FTX"))!;
      check(
        "FTX marker lands on the true run day",
        Math.abs(st.times[CTX_DAYS + m.runDay] - new Date("2022-11-08T00:00:00Z").getTime() / 1000) < 86_401,
      );
    }
  }
  check("era scan finds FTX in at least one window", found);
}

// ── Absolute windows survive series reshaping ────────────────────────
{
  // Leading days dropped + trailing appended (sliding fixed-length feed):
  // time-anchored seed recovers the same calendar window without shift.
  const today = wave.slice(0, 1500);
  const later = wave.slice(3, 1503);
  const a = setupRun(today, 777, "practice", null);
  const b = setupRun(later, 777, "practice", null, 0);
  check(
    "same seed after leading-day drop → identical absolute window",
    a.times[CTX_DAYS] === b.times[CTX_DAYS] &&
      a.prices[CTX_DAYS] === b.prices[CTX_DAYS] &&
      a.times[a.times.length - 1] === b.times[b.times.length - 1],
  );
  // Legacy challenge shiftDays still degrades to a playable window.
  const c = setupRun(later, 777, "practice", null, 100_000);
  check(
    "absurd shift clamps to a playable window",
    c.prices.length === CTX_DAYS + RUN_DAYS + 1 && Number.isFinite(c.times[0]),
  );

  // Tip growth only (no leading drop) · Wordle fairness same UTC day.
  const n = 1600;
  const short = wave.slice(0, n);
  const longer = wave.slice(0, n + 1);
  const d = setupRun(short, 4242, "daily", 1);
  const e = setupRun(longer, 4242, "daily", 1);
  check(
    "same seed · length N vs N+1 → identical window times[CTX]",
    d.times[CTX_DAYS] === e.times[CTX_DAYS] &&
      d.prices[CTX_DAYS] === e.prices[CTX_DAYS],
  );
}

// ── Daily numbering ──────────────────────────────────────────────────
{
  const n1 = gauntletNumber(Date.UTC(2026, 6, 8, 12));
  const n2 = gauntletNumber(Date.UTC(2026, 6, 9, 0, 0, 1));
  check("2026-07-08 is Gauntlet #1, next UTC day is #2", n1 === 1 && n2 === 2);
}


// ── Runner course anchor (fairness debt fix 2026-07-11) ────────────
{
  let deterministic = true;
  let banded = true;
  for (let n = 1; n <= 1500; n++) {
    const a = runnerStartBackDays(n);
    if (a !== runnerStartBackDays(n)) deterministic = false;
    if (a < 400 || a >= 1700) banded = false;
  }
  check("runner anchor deterministic per day", deterministic);
  check("runner anchor stays in the [400,1700) band", banded);
  // Length-stability: the located start DATE must not move when the
  // loaded series grows or shrinks by a point at either end.
  const DAY = 86_400;
  const base = 1_600_000_000;
  const times = Array.from({ length: 1800 }, (_, i) => base + i * DAY);
  const anchorSec = base + 700 * DAY;
  const idxFull = locateRunnerStart(times, anchorSec);
  const idxShort = locateRunnerStart(times.slice(1), anchorSec);
  const idxLong = locateRunnerStart([base - DAY, ...times], anchorSec);
  check(
    "located start DATE survives a one-point head slide",
    times[idxFull] === times.slice(1)[idxShort] &&
      times[idxFull] === [base - DAY, ...times][idxLong],
  );
  check(
    "degenerate series still yields a playable clamp",
    locateRunnerStart(times.slice(0, 50), anchorSec) >= 1,
  );
}

if (failures > 0) {
  console.error(`\n✗ ${failures} gauntlet invariant(s) failed`);
  process.exit(1);
}
console.log("\n✓ all gauntlet engine invariants hold.");
