// CHOP · latency.js
//
// Device output-latency estimation, as pure math with no Web Audio, no
// DOM and no module state. It lives in its own file precisely so that
// scripts/test-chop-latency.ts can import THIS code — not a paraphrase of
// it — and drive it through simulated devices in Node.
//
// ── WHY ─────────────────────────────────────────────────────────────
// A rhythm game asks the player to act on what they HEAR. What they hear
// lags what we scheduled by the output latency: OS buffers, the DAC, and
// above all any Bluetooth link (AirPods alone are 120-180 ms).
//
// The Web Audio spec exposes `AudioContext.outputLatency` for exactly
// this. Chrome implements it honestly (~32 ms on desktop). WebKit does
// not implement it at all — and the tempting fallback, `baseLatency`, is
// a different quantity entirely (the render quantum, ~5 ms). Reporting
// baseLatency as output latency is what CHOP did, so on an iPhone the
// game compensated 5 ms for a real 100-200 ms. Two consequences, both
// reported as separate bugs by the operator:
//
//   * the cube visibly reaches its gate long before you hear the beat
//     it is supposed to be cut on;
//   * every cut's timing error was biased by that same 100-200 ms, which
//     is outside the +/-90 ms "on beat" window — so PERFECT, NAILED and
//     every praise callout were not rare on iOS, they were impossible.
//
// Since no API will tell us, we measure it from play. Each cut yields a
// signed error; its MEDIAN is the device offset, because a player's own
// timing scatter is roughly symmetric about their intent and cancels in a
// median, while a constant device shift does not. An outlier (a panic
// swipe) barely moves a median. Same principle as Clone Hero's auto-cal,
// and it costs the player nothing — no calibration screen, no tapping.
//
// ── THE TRAP ────────────────────────────────────────────────────────
// Every sample is an error measured RELATIVE TO THE BIAS IN FORCE WHEN IT
// WAS TAKEN. Change the bias and the older samples describe a correction
// that no longer exists. The first implementation kept a sliding window
// across adoptions and therefore integrated the same error repeatedly:
// simulating a 140 ms device, it over-corrected on every pass and drove
// the bias to the opposite clamp rail (-100 ms, a 240 ms residual —
// strictly worse than doing nothing). `observe()` flushes on every
// adoption for that reason. The Node test pins the behaviour.

/** Total compensation may never exceed these. Beyond ~400 ms is not a real
 *  audio path, it is a broken estimate, and letting it run would desync
 *  the visuals catastrophically in the name of fixing them. */
export const BIAS_MIN = -0.10;
export const BIAS_MAX = 0.40;

/** Below this many samples a median is not measuring anything. */
export const TIMING_MIN = 12;
/** Cap on a window that keeps failing the spread gate. */
export const TIMING_WINDOW = 40;
/** Samples further out than this are near-misses, not timing information.
 *  Generous, because on an uncalibrated device the true bias may itself
 *  be 200 ms and a tighter gate would reject the very evidence we need. */
export const SAMPLE_GATE = 0.28;
/** Inter-quartile spread above which the player is inconsistent enough
 *  that the median is measuring them, not their hardware. */
export const SPREAD_GATE = 0.13;
/** Deadband: a correction smaller than this is not worth a visible shift. */
export const DEADBAND = 0.012;
/** Fraction of the measured median adopted per pass. Full correction on a
 *  noisy median oscillates; 0.6 takes a 140 ms error to 56 -> 22 -> 9 ms
 *  over three adoptions, i.e. inside the onBeat window after the first
 *  twelve cuts and inside NAILED after twenty-four. */
export const GAIN = 0.6;

export function clampBias(sec) {
  if (!Number.isFinite(sec)) return 0;
  return Math.max(BIAS_MIN, Math.min(BIAS_MAX, sec));
}

/**
 * Create a calibrator. Caller owns the returned object; nothing is global.
 * @param {number} [initialBias] persisted bias from a previous session
 */
export function createCalibrator(initialBias = 0) {
  let bias = clampBias(initialBias);
  let measured = Number.isFinite(initialBias) && initialBias !== 0;
  const samples = [];

  return {
    get bias() { return bias; },
    get measured() { return measured; },
    get sampleCount() { return samples.length; },

    reset() { bias = 0; measured = false; samples.length = 0; },

    setBias(sec) { bias = clampBias(sec); measured = true; },

    /**
     * Feed one cut's signed timing error in seconds, as the player
     * experienced it: (whenTheyCut - whenTheBeatWas) on the heard clock.
     * Positive means late by our current reckoning.
     * @returns {number|null} the newly adopted bias, or null if no change
     */
    observe(dtSigned) {
      if (!Number.isFinite(dtSigned)) return null;
      if (Math.abs(dtSigned) > SAMPLE_GATE) return null;
      samples.push(dtSigned);
      if (samples.length < TIMING_MIN) return null;

      const sorted = samples.slice().sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      if (q3 - q1 > SPREAD_GATE) {
        // Chaotic stretch: do not adopt, but do not let it poison the
        // window forever either — keep only the recent tail.
        if (samples.length > TIMING_WINDOW) samples.splice(0, samples.length - TIMING_MIN);
        return null;
      }

      // FLUSH ON ADOPT — see "THE TRAP" above. Non-negotiable.
      samples.length = 0;
      if (Math.abs(median) < DEADBAND) { measured = true; return null; }

      bias = clampBias(bias + median * GAIN);
      measured = true;
      return bias;
    },
  };
}
