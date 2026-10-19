/**
 * CHOP device-latency calibration invariants.
 *
 * Drives the REAL estimator (public/chop/js/latency.js — imported, not
 * paraphrased) through simulated devices and players.
 *
 * WHY THIS IS WORTH A TEST SUITE
 *   `AudioContext.outputLatency` is unimplemented in WebKit, so on the
 *   primary target device (iPhone) nothing will tell us how far behind the
 *   sound is. Uncalibrated that gap runs 100-200 ms, which is wider than
 *   the +/-90 ms "on beat" window — meaning PERFECT, NAILED and every
 *   praise callout were not merely rare on iOS, they were unreachable, and
 *   the cube visibly arrived at its gate before the beat you cut it on.
 *   The estimator is the only thing standing between us and that, and it
 *   is a feedback loop, which is a shape that fails quietly.
 *
 *   It already failed once: a sliding window across adoptions re-read
 *   samples that had been measured under a previous correction, integrated
 *   the same error repeatedly, and drove the bias to the wrong clamp rail
 *   (a simulated 140 ms device ended at -100 ms bias / 240 ms residual —
 *   worse than no calibration at all). Case "converges" below is what
 *   catches that class of regression.
 */
import {
  createCalibrator, GAIN, TIMING_MIN, BIAS_MIN, BIAS_MAX, SAMPLE_GATE, DEADBAND,
} from "../public/chop/js/latency.js";

const ONBEAT_WINDOW = 0.09;  // must match cutNote()'s onBeat gate
const NAILED_WINDOW = 0.035; // must match cutNote()'s nailed gate

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}${detail ? " · " + detail : ""}`); }
}

/** Deterministic PRNG. A plain LCG loses precision past 2^53 in JS doubles
 *  and silently stops producing noise — which briefly made an earlier
 *  harness look like it was testing something it was not. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulate a player on a device whose true output latency exceeds what the
 * API admits by `trueExtra`. Each cut's observed error is the residual
 * uncorrected latency plus that player's own scatter.
 */
function simulate(trueExtra: number, scatterSd: number, cuts: number, seed: number) {
  const cal = createCalibrator(0);
  const r = mulberry32(seed);
  // sum-of-4-uniforms ~ Bates: symmetric, finite support, sd = scatterSd/sqrt(3)
  const scatter = () => (r() + r() + r() + r() - 2) * scatterSd;
  const adoptions: number[] = [];
  for (let i = 0; i < cuts; i++) {
    const residual = trueExtra - cal.bias;
    if (cal.observe(residual + scatter()) != null) adoptions.push(i + 1);
  }
  return { cal, residual: trueExtra - cal.bias, adoptions };
}

console.log("CHOP latency calibration");

// ── 1. converges from every plausible device ────────────────────────
console.log("\n  convergence · residual must land inside the judging windows");
const DEVICES: Array<[string, number, number]> = [
  ["wired iPhone      (+90ms)", 0.090, 0.040],
  ["AirPods on iOS    (+140ms)", 0.140, 0.045],
  ["slow Bluetooth    (+200ms)", 0.200, 0.050],
  ["desktop, accurate (0ms)", 0.000, 0.045],
  ["over-compensating (-40ms)", -0.040, 0.040],
];
for (const [name, extra, sd] of DEVICES) {
  const { residual, adoptions } = simulate(extra, sd, 60, 7);
  check(
    `${name} -> residual ${Math.round(residual * 1000)}ms, inside NAILED`,
    Math.abs(residual) < NAILED_WINDOW,
    `adoptions at cuts [${adoptions.join(", ")}]`,
  );
}

// ── 2. FAST ENOUGH TO MATTER ────────────────────────────────────────
// A calibration that needs 200 cuts is a calibration nobody ever gets. One
// stage is ~150 notes, so being playable must arrive well inside one run.
console.log("\n  speed · one short run must be enough to become playable");
for (const [name, extra, sd] of DEVICES) {
  const { residual } = simulate(extra, sd, TIMING_MIN * 2, 11);
  check(
    `${name} -> inside onBeat after ${TIMING_MIN * 2} cuts`,
    Math.abs(residual) < ONBEAT_WINDOW,
    `residual ${Math.round(residual * 1000)}ms`,
  );
}

// ── 3. THE REGRESSION THAT SHIPPED ──────────────────────────────────
// The sliding-window bug made the loop run AWAY from the answer. Assert
// monotone improvement, not just a good endpoint: a loop that overshoots
// to the far rail and happens to come back would pass an endpoint-only test.
console.log("\n  stability · never worse than uncalibrated, never at a rail");
for (const [name, extra, sd] of DEVICES) {
  const cal = createCalibrator(0);
  const r = mulberry32(23);
  const scatter = () => (r() + r() + r() + r() - 2) * sd;
  let worst = 0;
  for (let i = 0; i < 90; i++) {
    const residual = extra - cal.bias;
    worst = Math.max(worst, Math.abs(residual));
    cal.observe(residual + scatter());
  }
  const startErr = Math.abs(extra);
  check(
    `${name} -> never overshoots past its own starting error`,
    worst <= startErr + 0.02,
    `worst ${Math.round(worst * 1000)}ms vs start ${Math.round(startErr * 1000)}ms`,
  );
  check(
    `${name} -> bias settles off the clamp rails`,
    cal.bias > BIAS_MIN + 1e-9 && cal.bias < BIAS_MAX - 1e-9,
    `bias ${Math.round(cal.bias * 1000)}ms`,
  );
}

// ── 4. does not disturb a device that is already right ──────────────
{
  const { cal, residual } = simulate(0, 0.045, 120, 3);
  check(
    "accurate device stays accurate over a long session",
    Math.abs(residual) < DEADBAND * 2,
    `residual ${Math.round(residual * 1000)}ms, bias ${Math.round(cal.bias * 1000)}ms`,
  );
}

// ── 5. refuses to learn from noise ──────────────────────────────────
{
  // A player whose cuts are essentially random must not move the grid: the
  // spread gate exists so we never "calibrate" to someone flailing.
  const cal = createCalibrator(0);
  const r = mulberry32(99);
  for (let i = 0; i < 200; i++) cal.observe((r() - 0.5) * 0.5);
  check(
    "random flailing does not move the bias far",
    Math.abs(cal.bias) < 0.05,
    `bias ${Math.round(cal.bias * 1000)}ms`,
  );
}

// ── 6. input hygiene ────────────────────────────────────────────────
{
  const cal = createCalibrator(0);
  check("NaN is ignored", cal.observe(NaN) === null && cal.sampleCount === 0);
  check("Infinity is ignored", cal.observe(Infinity) === null && cal.sampleCount === 0);
  check(
    "a near-miss beyond the sample gate is ignored",
    cal.observe(SAMPLE_GATE + 0.01) === null && cal.sampleCount === 0,
  );
  cal.setBias(999);
  check("setBias clamps high", cal.bias === BIAS_MAX, `got ${cal.bias}`);
  cal.setBias(-999);
  check("setBias clamps low", cal.bias === BIAS_MIN, `got ${cal.bias}`);
  cal.reset();
  check("reset clears everything", cal.bias === 0 && !cal.measured && cal.sampleCount === 0);
}

// ── 7. the constants the game depends on ────────────────────────────
{
  check("gain is a partial step (no full-correction oscillation)", GAIN > 0 && GAIN < 1);
  check("needs a real sample count before acting", TIMING_MIN >= 8);
  check(
    "sample gate is wider than the worst uncalibrated bias we expect",
    SAMPLE_GATE > 0.2,
    "an uncalibrated BT device can be 200ms out; a tighter gate would reject the evidence",
  );
}

if (failures) {
  console.error(`\n✗ ${failures} latency calibration check(s) failed`);
  process.exit(1);
}
console.log("\n✓ calibration converges inside the judging windows on every simulated device");
