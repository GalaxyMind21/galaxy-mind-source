// CHOP · beatgrid.js
//
// WHY THIS FILE EXISTS
//   The whole game is "cut on the beat". That promise is only as good as
//   our belief about WHERE the beats are. We were taking that belief from
//   a hand-typed manifest — integer BPMs and `offsetSec: 0` for every
//   track — and it was wrong on every single one:
//
//     track            manifest   measured    first downbeat   drift/stage
//     ascend.m4a         130      129.875        389 ms           68 ms
//     starting-over      122      123.855        275 ms         1073 ms
//     flying-temple      128      127.660        376 ms          188 ms
//     lost-utopia        127      126.940        457 ms           33 ms
//     drama              130      129.875        429 ms           68 ms
//     extended           120      119.845        288 ms           91 ms
//
//   Beat length is 460-500 ms, so a 275-457 ms phase error is most of a
//   beat, WRONG FROM THE FIRST NOTE — not a drift that creeps in. That is
//   the operator's report ("the chops aren't lined up with the beats") in
//   one number. The tempo errors then add drift on top, and one track
//   (starting-over) is out by over a full second by the end of a block.
//
//   Two candidate root causes both point the same way, so we stopped
//   guessing and measured the DECODED buffer: (a) the pack's published
//   BPMs are rounded integers, (b) AAC-LC decode adds encoder priming at
//   the head (~2112 samples ≈ 48 ms) that a WAV-authored "starts at 0:00"
//   assumption cannot see. Analysing what the browser actually decoded
//   folds in both without having to attribute blame.
//
// WHAT IT DOES
//   Pure functions over a decoded AudioBuffer. No DOM, no Web Audio graph,
//   no state — so the same code runs in the page, in the QA rig, and in
//   scripts/check-chop-beatgrid.ts. Returns a grid plus the evidence for
//   trusting it, because a beat detector that cannot report its own
//   confidence is not usable in a shipping product.
//
// THE TWO-BAND TRICK
//   Tempo comes from the FULL-band onset envelope (every transient helps
//   the period estimate). Phase comes from a LOW-band envelope (< ~160 Hz)
//   because in four-on-the-floor the kick is the downbeat, and a full-band
//   phase search happily locks onto the backbeat snare — half a beat wrong,
//   which is the single worst failure mode here since it feels *almost*
//   right. Confidence is reported as the ratio between the winning phase
//   and its half-beat rival, so a caller can refuse a coin flip.

/** Downmix to mono Float32 at a decimated rate. Analysis needs ~200 Hz of
 *  envelope resolution, not 48 kHz, and decimating first is what makes the
 *  whole pass affordable on a phone. */
export function toMono(buffer, targetRate = 12000) {
  const srcRate = buffer.sampleRate;
  const stride = Math.max(1, Math.floor(srcRate / targetRate));
  const rate = srcRate / stride;
  const n = Math.floor(buffer.length / stride);
  const chans = Math.min(2, buffer.numberOfChannels);
  const a = buffer.getChannelData(0);
  const b = chans > 1 ? buffer.getChannelData(1) : null;
  const out = new Float32Array(n);
  // Box-average across the stride instead of point-sampling: point-sampling
  // a 48 kHz signal every 4th sample aliases high frequencies straight down
  // into the band we are about to measure onsets in.
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * stride;
    for (let k = 0; k < stride; k++) {
      const j = base + k;
      s += b ? (a[j] + b[j]) * 0.5 : a[j];
    }
    out[i] = s / stride;
  }
  return { data: out, rate };
}

/** One-pole low-pass, run forward only. Phase shift is a constant group
 *  delay at these cutoffs and we compensate for it below. */
function lowpass(data, rate, cutoffHz) {
  const dt = 1 / rate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const a = dt / (rc + dt);
  const out = new Float32Array(data.length);
  let y = 0;
  for (let i = 0; i < data.length; i++) { y += a * (data[i] - y); out[i] = y; }
  return out;
}

/** Half-wave-rectified energy flux — the standard cheap onset envelope.
 *  Returns {env, fps}. */
export function onsetEnvelope(data, rate, hop = 64) {
  const frames = Math.floor(data.length / hop);
  const env = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const base = f * hop;
    for (let i = 0; i < hop; i++) { const v = data[base + i] || 0; s += v * v; }
    const e = Math.sqrt(s / hop);
    env[f] = Math.max(0, e - prev); // rises only: a decay is not an onset
    prev = e;
  }
  let mx = 0;
  for (let i = 0; i < frames; i++) if (env[i] > mx) mx = env[i];
  if (mx > 0) for (let i = 0; i < frames; i++) env[i] /= mx;
  return { env, fps: rate / hop };
}

/** Linear read into the envelope at a fractional index.
 *
 *  THIS IS LOad-BEARING, not a nicety. The first version of this file
 *  probed the comb with `env[Math.round(i + lag)]`, which quantises every
 *  probe to one 5.3 ms envelope frame. Tempo candidates whose 4-beat lag
 *  happens to sit near a frame boundary then score spuriously high, and
 *  the bias is systematically toward SHORTER lags: fed a synthetic track
 *  at exactly 128.000 BPM, that estimator returned 127.700, and 130.000
 *  came back 129.900. Those are the exact "corrections" it then reported
 *  for four of our six real tracks — i.e. it was measuring itself.
 *  Interpolating removes the artifact; the ground-truth suite in
 *  scripts/derive-chop-beatgrid.md is what keeps it honest. */
function lerpAt(env, x) {
  if (x <= 0) return env[0] || 0;
  const i = x | 0;
  if (i >= env.length - 1) return env[env.length - 1] || 0;
  const f = x - i;
  return env[i] * (1 - f) + env[i + 1] * f;
}

/** Comb-filter score for a candidate tempo: how much does the envelope
 *  agree with itself at 1..4 beats' lag. */
function combScore(env, fps, bpm) {
  const lag = (60 / bpm) * fps;
  const span = lag * 4;
  if (span < 2 || span >= env.length) return 0;
  let acc = 0, n = 0;
  for (let i = 0; i + span < env.length; i++) {
    acc += env[i] * (lerpAt(env, i + lag) + lerpAt(env, i + lag * 2)
                   + lerpAt(env, i + lag * 3) + lerpAt(env, i + lag * 4));
    n++;
  }
  return n ? acc / n : 0;
}

/** Coarse-to-fine tempo search. Two passes beat one fine sweep by ~40x.
 *  The fine pass is deliberately no finer than 0.01 BPM: the ground-truth
 *  suite puts this estimator's real accuracy at roughly +/-0.05 BPM, and
 *  reporting three decimals of a two-decimal measurement is how you end up
 *  "correcting" a manifest that was right. */
function findTempo(env, fps, loBpm, hiBpm) {
  let best = loBpm, bestS = -1;
  for (let b = loBpm; b <= hiBpm + 1e-9; b += 0.05) {
    const s = combScore(env, fps, b);
    if (s > bestS) { bestS = s; best = b; }
  }
  let fine = best, fineS = bestS;
  for (let b = best - 0.08; b <= best + 0.08 + 1e-9; b += 0.01) {
    const s = combScore(env, fps, b);
    if (s > fineS) { fineS = s; fine = b; }
  }
  return { bpm: Math.round(fine * 100) / 100, score: fineS };
}

/** Mean envelope energy landing on a beat grid of the given phase. */
function phaseScore(env, beatFrames, phase) {
  let acc = 0, n = 0;
  for (let k = 0; ; k++) {
    const x = phase + k * beatFrames;
    const i = Math.round(x);
    if (i >= env.length) break;
    // 3-frame window: a kick transient is not one frame wide, and an
    // exact-index-only score is brittle to sub-frame grid rounding.
    acc += Math.max(lerpAt(env, x), env[i - 1] || 0, env[i + 1] || 0);
    n++;
  }
  return n ? acc / n : 0;
}

/**
 * Analyse a decoded AudioBuffer for its true beat grid.
 *
 * @param {AudioBuffer} buffer
 * @param {{hintBpm?:number, searchWidth?:number}} [opts]
 *   hintBpm narrows the tempo search around a published value. It is a
 *   HINT and nothing more — the result is free to disagree with it, which
 *   is the entire point of this module.
 * @returns {{bpm:number, offsetSec:number, beatSec:number,
 *            medianBeatToOnsetMs:number, phaseConfidence:number,
 *            tempoStability:number, onsetsMatched:number, analysisMs:number}}
 */
export function analyseBeatGrid(buffer, opts = {}) {
  const t0 = (typeof performance !== "undefined" ? performance.now() : 0);
  const hint = Number(opts.hintBpm) || 0;
  const width = Number(opts.searchWidth) || 14;
  const lo = hint ? Math.max(70, hint - width) : 80;
  const hi = hint ? Math.min(200, hint + width) : 190;

  const { data, rate } = toMono(buffer, 12000);
  const full = onsetEnvelope(data, rate, 64);
  const { bpm, score } = findTempo(full.env, full.fps, lo, hi);
  const beatSec = 60 / bpm;
  const beatFrames = beatSec * full.fps;

  // ── tempo stability: split into quarters and re-estimate. A produced
  // loop should agree with itself; a live take or a bad lock will not.
  // Reported so a caller can distrust a track rather than silently ship
  // a grid that is only right for the first 30 seconds.
  const stabs = [];
  const qn = Math.floor(full.env.length / 4);
  for (let q = 0; q < 4; q++) {
    const slice = full.env.subarray(q * qn, (q + 1) * qn);
    if (slice.length > beatFrames * 8) {
      stabs.push(findTempo(slice, full.fps, bpm - 2, bpm + 2).bpm);
    }
  }
  const tempoStability = stabs.length
    ? Math.max(...stabs) - Math.min(...stabs)
    : Number.POSITIVE_INFINITY;

  // ── phase from the KICK band. See the two-band note at the top: a
  // full-band phase search locks onto the backbeat about as often as the
  // downbeat, and half-a-beat-wrong is the failure that feels almost right.
  const lowSig = lowpass(data, rate, 160);
  const low = onsetEnvelope(lowSig, rate, 64);
  // one-pole group delay at cutoff, converted to envelope frames
  const groupDelayFrames = (1 / (2 * Math.PI * 160)) * low.fps;

  let phase = 0, phaseS = -1;
  for (let p = 0; p < beatFrames; p += 0.1) {
    const s = phaseScore(low.env, beatFrames, p);
    if (s > phaseS) { phaseS = s; phase = p; }
  }
  const rival = phaseScore(low.env, beatFrames, (phase + beatFrames / 2) % beatFrames);
  const phaseConfidence = phaseS / Math.max(1e-9, rival);

  const offsetSec = Math.max(0, (phase - groupDelayFrames) / low.fps);

  // ── validation: with this grid, how far is each beat from a real
  // transient? A correct grid sits within ~10 ms. A wrong one shows a
  // median around a quarter of a beat. This is the acceptance number.
  const peaks = [];
  const e = full.env;
  for (let i = 2; i < e.length - 2; i++) {
    if (e[i] > 0.10 && e[i] >= e[i - 1] && e[i] >= e[i + 1]
        && e[i] >= e[i - 2] && e[i] >= e[i + 2]) peaks.push(i);
  }
  const errs = [];
  let pi = 0;
  const phaseFull = offsetSec * full.fps;
  for (let k = 0; ; k++) {
    const bi = phaseFull + k * beatFrames;
    if (bi >= e.length) break;
    while (pi < peaks.length - 1 && peaks[pi] < bi - beatFrames) pi++;
    let best = Infinity;
    for (let j = pi; j < peaks.length; j++) {
      const d = Math.abs(peaks[j] - bi);
      if (d < best) best = d;
      if (peaks[j] > bi + beatFrames) break;
    }
    if (best < beatFrames / 2) errs.push((best / full.fps) * 1000);
  }
  errs.sort((a, b) => a - b);

  return {
    bpm: Math.round(bpm * 1000) / 1000,
    offsetSec: Math.round(offsetSec * 10000) / 10000,
    beatSec: Math.round(beatSec * 100000) / 100000,
    medianBeatToOnsetMs: errs.length ? Math.round(errs[errs.length >> 1] * 10) / 10 : null,
    phaseConfidence: Math.round(phaseConfidence * 100) / 100,
    tempoStability: Math.round(tempoStability * 1000) / 1000,
    onsetsMatched: errs.length,
    combScore: score,
    analysisMs: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - t0),
  };
}

/**
 * Is this grid trustworthy enough to drive a whole block's choreography?
 * Deliberately strict: shipping a confidently-wrong grid is worse than
 * falling back to the manifest, because a half-beat-wrong grid teaches the
 * player that the game's timing is broken.
 */
export function gridIsTrustworthy(g) {
  return !!g
    && g.medianBeatToOnsetMs != null
    && g.medianBeatToOnsetMs <= 25      // grid sits on real transients
    && g.phaseConfidence >= 1.15        // beat, not backbeat
    && g.tempoStability <= 1.5          // same tempo throughout
    && g.onsetsMatched >= 60;           // enough evidence to mean anything
}
