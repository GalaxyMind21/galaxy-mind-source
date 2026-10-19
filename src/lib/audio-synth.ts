/* =====================================================================
 * lib/audio-synth.ts · procedural Web Audio synthesis primitives
 *
 * Shared between the /stack PressureGauge and the /float Reservoir.
 * Every primitive is "fire-and-forget": you call it with a context,
 * a destination, and a start time, and it schedules its own
 * oscillators / noise / filters / envelopes and self-cleans when
 * the sound ends.
 *
 * v2 · MODAL SYNTHESIS REWRITE
 * ────────────────────────────
 * The earlier additive-synthesis primitives (a few sines + one noise
 * burst) were better than single-oscillator beeps but still sounded
 * "synthesized." Real instruments have many more discrete vibration
 * modes than a synthesizer typically models · a real bell has 20-30
 * identifiable modes, a real glass shatter has 4 distinct phases
 * (impact, propagating cracks, body collapse, debris), a real water
 * drop has 3 phases (impact, cavity collapse, ripple).
 *
 * v2 leans into:
 *   - MODAL synthesis · multi-resonator filter banks where each
 *     resonator represents a physical vibration mode (bandpass +
 *     short noise excitation + per-mode decay envelope)
 *   - PHYSICALLY-CORRECT phase structure · sounds are arranged as
 *     timed sequences of micro-events (impact → resonance → decay)
 *     instead of single homogeneous bursts
 *   - LAYERED noise · pink noise + multi-band-filtered grains
 *     sound much more natural than white noise alone
 *   - RANDOM JITTER on partial frequencies + decay rates so the
 *     same primitive doesn't sound identical between calls
 *   - FM CROSS-MODULATION between oscillators creates inharmonic
 *     spectra that pure additive synthesis can't produce
 *
 * All synthesis stays procedural · no external audio files. Pages
 * stay slim, sounds work offline.
 *
 * Browser autoplay: every primitive expects the AudioContext to be
 * already initialized (post-user-gesture). Caller is responsible
 * for gesture-gating context creation.
 *
 * Memory: nodes are scheduled with explicit stop() times and rely
 * on browser GC after they finish · no leaks.
 * ===================================================================== */

export type Synth = {
  ctx: AudioContext;
  master: GainNode;
};

// ────────────────────────────────────────────────────────────────────
// SHARED UTILITIES
// ────────────────────────────────────────────────────────────────────

/**
 * Cheap reverb tail · a single delay node with feedback into a low-
 * pass filter. Not a true convolution reverb but adds enough "space"
 * to keep bells / glass from sounding dry. Returns an input node;
 * connect your source to it.
 */
export function makeReverbBus(synth: Synth, decay = 0.5): GainNode {
  const { ctx, master } = synth;
  const input = ctx.createGain();
  const delay = ctx.createDelay(0.5);
  delay.delayTime.value = 0.08;
  const feedback = ctx.createGain();
  feedback.gain.value = Math.min(0.7, decay);
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 4000;
  input.connect(delay);
  delay.connect(tone);
  tone.connect(feedback);
  feedback.connect(delay);
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  tone.connect(wet);
  wet.connect(master);
  return input;
}

/**
 * White noise buffer with optional amplitude envelope shape.
 *   taper 1 = linear fade-out · 2 = quadratic · 3 = cubic
 */
export function noiseBuffer(
  ctx: AudioContext,
  durationSec: number,
  taper = 1,
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / length;
    const env = Math.pow(1 - t, taper);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  return buf;
}

/**
 * Pink noise buffer · 1/f spectrum, sounds much more natural than
 * white noise for splashes, water, and texture. Uses Paul Kellet's
 * approximation (5-state IIR · cheap and good enough for FX).
 */
export function pinkNoiseBuffer(
  ctx: AudioContext,
  durationSec: number,
  taper = 1,
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
    const t = i / length;
    const env = Math.pow(1 - t, taper);
    data[i] = pink * env;
  }
  return buf;
}

/**
 * Schedule a single resonator mode · a bandpass filter excited by a
 * brief noise burst, with its own decay envelope. The building block
 * of modal synthesis: real materials (bell, glass, wood, metal)
 * have many such modes ringing simultaneously at different
 * frequencies and decay rates.
 *
 * @param frequency  resonant frequency in Hz
 * @param q          filter Q · higher = longer ring, more tonal
 * @param decay      seconds to silence
 * @param amplitude  peak gain at strike (0-1)
 * @param exciteDur  duration of noise excitation (seconds, default 8ms)
 */
function modeRing(
  synth: Synth,
  t0: number,
  frequency: number,
  q: number,
  decay: number,
  amplitude: number,
  exciteDur = 0.008,
): void {
  const { ctx, master } = synth;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, exciteDur, 2);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = frequency;
  bp.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(amplitude, t0 + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  noise.connect(bp).connect(env).connect(master);
  noise.start(t0);
  noise.stop(t0 + decay + 0.02);
}

/**
 * Cosine attack envelope · smoother than linear, prevents click
 * artifacts at the start of percussive sounds. Returns a GainNode
 * pre-configured with the envelope, ready to insert in a chain.
 */
function makeEnvGain(
  ctx: AudioContext,
  t0: number,
  attackSec: number,
  peak: number,
  decaySec: number,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  // Two-segment ramp · linear up to a small midpoint, then exponential
  // decay. Pure exponential up sounds clicky; pure linear up sounds
  // dull. Cosine would be perfect but requires setValueCurve which is
  // overkill here.
  g.gain.linearRampToValueAtTime(peak, t0 + attackSec);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attackSec + decaySec);
  return g;
}

// ────────────────────────────────────────────────────────────────────
// TONAL PRIMITIVES
// ────────────────────────────────────────────────────────────────────

/**
 * Brass bell · v2 with 9 modal partials (was 5).
 *
 * Real bells have ~20 identifiable modes. The 9-mode model captures
 * the "hum, prime, tierce, quint, nominal" + 4 inharmonic upper
 * partials that physical bells exhibit. Each mode decays at a
 * different rate · the overall timbre evolves from "metallic strike"
 * to "warm hum" over the decay window. That evolution is what your
 * ear identifies as a real bell.
 *
 * Key v2 additions:
 *   - 9 partials (previously 5)
 *   - Slight beating (~3 Hz) between near-frequency partials creates
 *     the characteristic shimmer you hear in real bells
 *   - Mode amplitudes randomized ±15% per call so each strike sounds
 *     slightly unique (real bells aren't perfectly repeatable either)
 *   - Wider strike noise band for more realistic "mallet" attack
 *   - Subharmonic at 0.5× fundamental for "body weight"
 */
export function brassBell(
  synth: Synth,
  t0: number,
  fundamental: number,
  decay = 1.6,
  volume = 0.4,
): void {
  const { ctx, master } = synth;

  // 9 modal partials · ratios from real bell spectroscopy
  // (Carillon mode analysis · Rossing 1990).
  // Format: [ratio, levelMultiplier, decayMultiplier, detuneCents]
  const partials: [number, number, number, number][] = [
    [0.5, 0.45, 1.4, 0], // Hum tone (subharmonic body)
    [1.0, 1.0, 1.0, 0], // Prime (fundamental)
    [1.18, 0.55, 0.85, 4], // Sub-second (slight inharmonic)
    [1.5, 0.62, 0.75, -2], // Tierce (minor third up · gives bell its sad timbre)
    [2.0, 0.75, 0.65, 3], // Octave
    [2.66, 0.45, 0.55, -5], // Quint (inharmonic)
    [3.0, 0.5, 0.5, 6], // Nominal
    [4.2, 0.32, 0.4, -8], // Upper inharmonic
    [5.4, 0.22, 0.3, 11], // High inharmonic
    [8.2, 0.12, 0.2, -7], // Highest partial · the "ping" component
  ];

  // Strike transient · 14ms noise burst with bandpass at 4× fundamental.
  // The mallet attack is what distinguishes "struck" from "hummed."
  const strike = ctx.createBufferSource();
  strike.buffer = noiseBuffer(ctx, 0.014, 2);
  const strikeBp = ctx.createBiquadFilter();
  strikeBp.type = "bandpass";
  strikeBp.frequency.value = fundamental * 4;
  strikeBp.Q.value = 5;
  const strikeGain = makeEnvGain(ctx, t0, 0.001, volume * 0.45, 0.06);
  strike.connect(strikeBp).connect(strikeGain).connect(master);
  strike.start(t0);
  strike.stop(t0 + 0.08);

  // Higher-frequency mallet "click" · small high transient that
  // gives the strike its sharpness.
  const click = ctx.createBufferSource();
  click.buffer = noiseBuffer(ctx, 0.005, 3);
  const clickHp = ctx.createBiquadFilter();
  clickHp.type = "highpass";
  clickHp.frequency.value = 5000;
  const clickGain = makeEnvGain(ctx, t0, 0.0005, volume * 0.3, 0.012);
  click.connect(clickHp).connect(clickGain).connect(master);
  click.start(t0);
  click.stop(t0 + 0.015);

  // Reverb bus · shared by the highest partials so the bell has a
  // coherent space.
  const reverb = makeReverbBus(synth, 0.5);

  for (const [ratio, level, decayMult, detuneCents] of partials) {
    // Per-strike random jitter (±15% level) so each call sounds
    // slightly different · matches how a real bell never sounds
    // exactly the same twice.
    const lvlJitter = 1 + (Math.random() - 0.5) * 0.3;
    const dcyJitter = 1 + (Math.random() - 0.5) * 0.2;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = fundamental * ratio;
    osc.detune.value = detuneCents;
    const partialDecay = decay * decayMult * dcyJitter;
    const peak = volume * level * lvlJitter;
    const env = makeEnvGain(ctx, t0, 0.005, peak, partialDecay);
    osc.connect(env);
    env.connect(master);

    // Beating partial · for upper-mid modes, add a second sine at
    // slightly offset frequency. The two slightly-detuned waves
    // create amplitude beating (~3Hz) that gives the "shimmer" real
    // bells have.
    if (ratio >= 1 && ratio <= 3) {
      const beat = ctx.createOscillator();
      beat.type = "sine";
      beat.frequency.value = fundamental * ratio;
      beat.detune.value = detuneCents + 6 + Math.random() * 4;
      const beatEnv = makeEnvGain(ctx, t0, 0.005, peak * 0.45, partialDecay);
      beat.connect(beatEnv).connect(master);
      beat.start(t0);
      beat.stop(t0 + partialDecay + 0.05);
    }

    // High partials route to the reverb bus for shimmer in space.
    if (ratio >= 2.66) {
      const send = ctx.createGain();
      send.gain.value = 0.3;
      env.connect(send);
      send.connect(reverb);
    }
    osc.start(t0);
    osc.stop(t0 + partialDecay + 0.05);
  }
}

/**
 * Water drop · v2 with proper 3-phase physics.
 *
 * Real water drops have THREE acoustic phases:
 *   1. IMPACT (1-3ms) · droplet meets surface · broadband click
 *   2. CAVITY COLLAPSE (10-40ms) · air bubble forms below the
 *      surface, oscillates as it collapses · this is the "boop"
 *      tonal phase. Pitch falls rapidly as the cavity shrinks.
 *   3. RIPPLE (50-200ms) · surface tension oscillates after the
 *      cavity closes · faint tonal tail at the cavity's final pitch
 *
 * v2 implements all 3 phases as separate, timed events. Result:
 *   sounds like an actual water drop instead of a sine sweep.
 *
 * @param pitchTop Hz at the start of cavity phase (higher = smaller drop)
 */
export function waterDrop(
  synth: Synth,
  t0: number,
  pitchTop = 1100,
  volume = 0.5,
): void {
  const { ctx, master } = synth;

  // Per-call jitter so consecutive drips don't sound identical
  const pitchJitter = 1 + (Math.random() - 0.5) * 0.25;
  const f0 = pitchTop * pitchJitter;
  // Cavity bottom pitch · the "boop" lands ~5× lower than top
  const fEnd = f0 * 0.18;

  // ─── PHASE 1 · IMPACT (1.5ms broadband click) ─────────────────
  // Highpass-filtered noise pop · the moment of contact. Very short
  // so it reads as a single percussive event.
  const impact = ctx.createBufferSource();
  impact.buffer = noiseBuffer(ctx, 0.0035, 3);
  const impactHp = ctx.createBiquadFilter();
  impactHp.type = "highpass";
  impactHp.frequency.value = 1500;
  const impactGain = makeEnvGain(ctx, t0, 0.0003, volume * 0.5, 0.005);
  impact.connect(impactHp).connect(impactGain).connect(master);
  impact.start(t0);
  impact.stop(t0 + 0.006);

  // ─── PHASE 2 · CAVITY COLLAPSE (35ms tonal "boop") ─────────────
  // The signature water-drop sound. Two oscillators with FM cross-
  // modulation create the inharmonic richness that pure sine sweeps
  // lack. Pitch falls logarithmically (cavity volume shrinks
  // exponentially as it collapses).
  const t1 = t0 + 0.003;
  const cavityDur = 0.035;

  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.setValueAtTime(f0, t1);
  carrier.frequency.exponentialRampToValueAtTime(fEnd, t1 + cavityDur);

  // FM modulator · adds slight inharmonic content as the carrier
  // sweeps · gives the boop a "wet" character a clean sine lacks.
  const modulator = ctx.createOscillator();
  modulator.type = "sine";
  modulator.frequency.setValueAtTime(f0 * 1.7, t1);
  modulator.frequency.exponentialRampToValueAtTime(fEnd * 1.7, t1 + cavityDur);
  const modGain = ctx.createGain();
  modGain.gain.value = 80; // FM depth (Hz of frequency deviation)
  modulator.connect(modGain);
  modGain.connect(carrier.frequency);

  const cavityBp = ctx.createBiquadFilter();
  cavityBp.type = "bandpass";
  cavityBp.frequency.setValueAtTime(f0 * 0.5, t1);
  cavityBp.frequency.exponentialRampToValueAtTime(fEnd * 0.5, t1 + cavityDur);
  cavityBp.Q.value = 6;

  const cavityEnv = makeEnvGain(ctx, t1, 0.003, volume * 0.85, cavityDur);
  carrier.connect(cavityBp).connect(cavityEnv).connect(master);

  carrier.start(t1);
  modulator.start(t1);
  carrier.stop(t1 + cavityDur + 0.01);
  modulator.stop(t1 + cavityDur + 0.01);

  // ─── PHASE 3 · RIPPLE (80ms faint tonal tail) ──────────────────
  // 2 short tones at the cavity's final pitch · slightly detuned
  // for chorus effect · simulates surface tension oscillation
  // after the cavity closes.
  const t2 = t1 + cavityDur;
  const rippleDur = 0.08;
  for (let i = 0; i < 2; i++) {
    const rip = ctx.createOscillator();
    rip.type = "sine";
    rip.frequency.value = fEnd * (1 + i * 0.05);
    rip.detune.value = (Math.random() - 0.5) * 25;
    const ripEnv = makeEnvGain(ctx, t2, 0.005, volume * 0.18, rippleDur);
    rip.connect(ripEnv).connect(master);
    rip.start(t2);
    rip.stop(t2 + rippleDur + 0.01);
  }
}

/**
 * Liquid splash · v2 with multi-band pink noise + grain texture
 * + comb-filter ripple tail.
 *
 * Real splashes have 4 layered components:
 *   1. Sharp impact (broadband transient)
 *   2. Many tiny droplets cascading (high-frequency texture)
 *   3. Burble/cavity (mid-frequency)
 *   4. Sustained surface ripple (low-mid resonance)
 *
 * v2 stacks all 4: pink noise base (more natural than white) +
 * 6 random grain pings + comb-filtered tail for ripple effect.
 */
export function liquidSplash(
  synth: Synth,
  t0: number,
  volume = 0.45,
): void {
  const { ctx, master } = synth;

  // ─── Layer 1 · Initial impact transient ────────────────────────
  const impact = ctx.createBufferSource();
  impact.buffer = noiseBuffer(ctx, 0.012, 2);
  const impactHp = ctx.createBiquadFilter();
  impactHp.type = "highpass";
  impactHp.frequency.value = 2000;
  const impactGain = makeEnvGain(ctx, t0, 0.0005, volume * 0.55, 0.018);
  impact.connect(impactHp).connect(impactGain).connect(master);
  impact.start(t0);
  impact.stop(t0 + 0.02);

  // ─── Layer 2 · Pink noise body with sweeping highpass ──────────
  // Pink noise (1/f spectrum) sounds like real water · white noise
  // sounds like a hissing radio. The downward filter sweep
  // simulates the splash spreading out and absorbing high freqs.
  const body = ctx.createBufferSource();
  body.buffer = pinkNoiseBuffer(ctx, 0.22, 2);
  const bodyHp = ctx.createBiquadFilter();
  bodyHp.type = "highpass";
  bodyHp.frequency.setValueAtTime(2200, t0 + 0.005);
  bodyHp.frequency.exponentialRampToValueAtTime(500, t0 + 0.22);
  bodyHp.Q.value = 1.2;
  const bodyGain = makeEnvGain(ctx, t0 + 0.002, 0.005, volume * 0.65, 0.22);
  body.connect(bodyHp).connect(bodyGain).connect(master);
  body.start(t0);
  body.stop(t0 + 0.24);

  // ─── Layer 3 · Cascade of 6 droplet grains ────────────────────
  // Random tiny pinged tones over the next 200ms · the "splatter"
  // of water droplets falling around the central impact.
  const grainCount = 6;
  for (let i = 0; i < grainCount; i++) {
    const offset = 0.005 + Math.random() * 0.18;
    const pitch = 1800 + Math.random() * 4500;
    const dur = 0.012 + Math.random() * 0.015;
    const grain = ctx.createBufferSource();
    grain.buffer = noiseBuffer(ctx, dur, 2.5);
    const grainBp = ctx.createBiquadFilter();
    grainBp.type = "bandpass";
    grainBp.frequency.value = pitch;
    grainBp.Q.value = 12 + Math.random() * 8;
    const grainGain = makeEnvGain(
      ctx,
      t0 + offset,
      0.001,
      volume * (0.12 + Math.random() * 0.18),
      dur,
    );
    grain.connect(grainBp).connect(grainGain).connect(master);
    grain.start(t0 + offset);
    grain.stop(t0 + offset + dur + 0.01);
  }

  // ─── Layer 4 · Comb-filtered ripple tail ──────────────────────
  // A delay node with feedback creates a comb filter · sounds like
  // resonant ripples spreading outward on the surface. Low Q means
  // the ripple decays naturally rather than ringing.
  const tail = ctx.createBufferSource();
  tail.buffer = pinkNoiseBuffer(ctx, 0.32, 2);
  const tailLp = ctx.createBiquadFilter();
  tailLp.type = "lowpass";
  tailLp.frequency.value = 1200;
  const tailDelay = ctx.createDelay(0.05);
  tailDelay.delayTime.value = 0.018;
  const tailFb = ctx.createGain();
  tailFb.gain.value = 0.35;
  const tailGain = makeEnvGain(ctx, t0 + 0.05, 0.01, volume * 0.18, 0.3);
  tail.connect(tailLp);
  tailLp.connect(tailDelay);
  tailDelay.connect(tailFb);
  tailFb.connect(tailDelay);
  tailDelay.connect(tailGain);
  tailGain.connect(master);
  tail.start(t0 + 0.04);
  tail.stop(t0 + 0.36);
}

/**
 * Vault thud · v2 with 5-mode modal synthesis + sustained rumble.
 *
 * Real heavy impacts (thick wood door, vault, anvil) have multiple
 * body resonances at distinct frequencies, each decaying at its own
 * rate. v2 models 5 such modes (instead of v1's single sine) plus
 * a sustained low-noise rumble for "weight."
 */
export function vaultThud(
  synth: Synth,
  t0: number,
  volume = 0.55,
): void {
  const { ctx, master } = synth;

  // Per-call jitter so consecutive thuds vary slightly
  const jitter = 1 + (Math.random() - 0.5) * 0.06;

  // ─── Pre-impact transient · sharp wood-on-metal click ─────────
  // Very short noise burst with bandpass at mid-low frequency.
  // Gives the thud its "attack edge" before the body modes ring.
  const click = ctx.createBufferSource();
  click.buffer = noiseBuffer(ctx, 0.006, 3);
  const clickBp = ctx.createBiquadFilter();
  clickBp.type = "bandpass";
  clickBp.frequency.value = 380;
  clickBp.Q.value = 3;
  const clickGain = makeEnvGain(ctx, t0, 0.0005, volume * 0.4, 0.012);
  click.connect(clickBp).connect(clickGain).connect(master);
  click.start(t0);
  click.stop(t0 + 0.015);

  // ─── 5 body resonance modes · modal synthesis ─────────────────
  // Frequencies chosen from typical "heavy box" resonance spectra ·
  // distributed across the bass register so the thud has body
  // weight without muddying. Each mode has its own decay rate ·
  // higher modes die faster (physical correctness).
  const modes: [number, number, number, number][] = [
    // [freqHz, Q, decaySec, levelMult]
    [52, 12, 0.42, 1.0], // Deep boom (sub-bass)
    [78, 14, 0.32, 0.85], // Low body (kick range)
    [113, 16, 0.24, 0.7], // Mid-low body
    [165, 14, 0.18, 0.55], // Mid body
    [240, 12, 0.12, 0.4], // Upper mid (gives the "knock" character)
  ];

  for (const [freq, q, decay, level] of modes) {
    modeRing(synth, t0, freq * jitter, q, decay, volume * level, 0.012);
  }

  // ─── Sustained low rumble · pink noise lowpassed for weight ───
  // Adds "air movement" / sub-rumble that makes the impact feel
  // physically large. Without this, the modal stack alone sounds
  // like a marimba note · the rumble is what makes it heavy.
  const rumble = ctx.createBufferSource();
  rumble.buffer = pinkNoiseBuffer(ctx, 0.28, 2);
  const rumbleLp = ctx.createBiquadFilter();
  rumbleLp.type = "lowpass";
  rumbleLp.frequency.value = 180;
  rumbleLp.Q.value = 1;
  const rumbleGain = makeEnvGain(ctx, t0, 0.003, volume * 0.5, 0.28);
  rumble.connect(rumbleLp).connect(rumbleGain).connect(master);
  rumble.start(t0);
  rumble.stop(t0 + 0.3);
}

/**
 * Metallic tap · v2 with 3-mode modal synthesis.
 *
 * v1 was a single noise transient + 2 sines. v2 uses 3 distinct
 * resonance modes for richer brass timbre, plus a sharper noise
 * excitation. Used for gauge needle ticks and UI button presses.
 */
export function metalTap(
  synth: Synth,
  t0: number,
  pitch = 1800,
  volume = 0.45,
): void {
  const { ctx, master } = synth;

  // Sharp excitation · highpass noise burst at 2× pitch
  const strike = ctx.createBufferSource();
  strike.buffer = noiseBuffer(ctx, 0.005, 3);
  const strikeHp = ctx.createBiquadFilter();
  strikeHp.type = "highpass";
  strikeHp.frequency.value = pitch * 2;
  const strikeGain = makeEnvGain(ctx, t0, 0.0003, volume * 0.4, 0.018);
  strike.connect(strikeHp).connect(strikeGain).connect(master);
  strike.start(t0);
  strike.stop(t0 + 0.02);

  // 3 modal partials · brass-like inharmonic ratios
  const modes: [number, number, number, number][] = [
    // [pitchMult, Q, decay, level]
    [1.0, 18, 0.09, 1.0], // Fundamental ring
    [2.4, 14, 0.07, 0.55], // Inharmonic upper mode
    [0.5, 16, 0.13, 0.55], // Body weight
  ];
  for (const [mult, q, decay, level] of modes) {
    modeRing(synth, t0, pitch * mult, q, decay, volume * level, 0.005);
  }
}

/**
 * Coin drop · small metal coin landing on a hard surface (wood / metal).
 *
 * Acoustic profile of a real coin drop:
 *   1. Sharp metallic STRIKE (1-2ms) · noise transient highpassed
 *      around 6-8kHz · the moment of contact · "tick"
 *   2. High-frequency RING (40-100ms) · bandpass-filtered sine at
 *      4-5.5kHz with high Q · the metal vibrating after impact · the
 *      "ting" you hear
 *   3. Brief low BODY thunk (15-30ms) · the coin's mass adds a quick
 *      mid-low resonance underneath
 *   4. Optional secondary BOUNCE (30-60ms after main) · ~30% chance
 *      per call · simulates the coin hitting the surface a second
 *      time before settling
 *
 * Per-call jitter on pitch (~±20%) makes successive drops sound like
 * different coins · prevents the "machine-gun cloned" feel during
 * the dense REPLAY animation.
 *
 * Replaces the `waterDrop` calls in /float/components/BitcoinReservoir
 * for the mining-tap and demand-drain coin spawns · the previous
 * water-drop sound was too "wet" for what's visually a metallic coin
 * falling into a brass instrument.
 *
 * @param pitch Base ring frequency in Hz (default 4500 · ~quarter coin
 *              size · pass lower for "heavier" coins)
 * @param volume 0-1 master amplitude
 */
export function coinDrop(
  synth: Synth,
  t0: number,
  pitch = 4500,
  volume = 0.5,
): void {
  const { ctx, master } = synth;

  // Per-call random jitter so consecutive drops sound like different
  // coins · ±18% pitch variation, ±15% volume.
  const pitchJ = pitch * (1 + (Math.random() - 0.5) * 0.36);
  const volJ = volume * (1 + (Math.random() - 0.5) * 0.3);

  // ─── PHASE 1 · Sharp metallic strike (1.5ms) ────────────────────
  // Very short noise burst, highpassed very high · the "tick" of
  // metal hitting hard surface.
  const strike = ctx.createBufferSource();
  strike.buffer = noiseBuffer(ctx, 0.0018, 3);
  const strikeHp = ctx.createBiquadFilter();
  strikeHp.type = "highpass";
  strikeHp.frequency.value = 7000;
  const strikeGain = makeEnvGain(ctx, t0, 0.0002, volJ * 0.55, 0.005);
  strike.connect(strikeHp).connect(strikeGain).connect(master);
  strike.start(t0);
  strike.stop(t0 + 0.008);

  // ─── PHASE 2 · High-frequency ring (60-100ms) ──────────────────
  // The "ting" · bandpass-filtered noise at the coin's resonant
  // frequency, high Q for sharp tonal character.
  modeRing(synth, t0, pitchJ, 32, 0.08, volJ * 0.85, 0.003);
  // Slightly detuned harmonic at 1.4× for inharmonic shimmer
  modeRing(synth, t0, pitchJ * 1.4, 26, 0.05, volJ * 0.4, 0.003);
  // Higher partial for "brilliance" · short, just adds high-end
  modeRing(synth, t0, pitchJ * 2.1, 22, 0.03, volJ * 0.25, 0.002);

  // ─── PHASE 3 · Brief mid-low body (15-25ms) ────────────────────
  // The coin's mass · without this, the drop sounds like a tiny
  // hi-hat hit rather than a small object with weight.
  modeRing(synth, t0, pitchJ * 0.18, 14, 0.025, volJ * 0.4, 0.004);

  // ─── PHASE 4 · Optional secondary bounce (30-60ms after main) ──
  // ~35% probability per call · gives some drops the natural "tap-
  // tap" rhythm of a coin not sticking on first contact. Quieter +
  // slightly lower pitch.
  if (Math.random() < 0.35) {
    const bounceOffset = 0.03 + Math.random() * 0.03;
    const bouncePitch = pitchJ * 0.85;
    const bounceStrike = ctx.createBufferSource();
    bounceStrike.buffer = noiseBuffer(ctx, 0.0012, 3);
    const bounceHp = ctx.createBiquadFilter();
    bounceHp.type = "highpass";
    bounceHp.frequency.value = 6500;
    const bounceGain = makeEnvGain(
      ctx,
      t0 + bounceOffset,
      0.0002,
      volJ * 0.3,
      0.004,
    );
    bounceStrike.connect(bounceHp).connect(bounceGain).connect(master);
    bounceStrike.start(t0 + bounceOffset);
    bounceStrike.stop(t0 + bounceOffset + 0.006);
    modeRing(
      synth,
      t0 + bounceOffset,
      bouncePitch,
      28,
      0.05,
      volJ * 0.45,
      0.002,
    );
  }
}

/**
 * Viscous flow · thick liquid (lava / molten metal / magma) flowing
 * out of an orifice. The /float Reservoir's per-event sound · the
 * mining-tap inflow and the demand-drain outflow.
 *
 * Operator directive 2026-05-16: the Reservoir depicts glowing
 * liquid BTC moving through a glass cylinder, so the event sound
 * should be the LIQUID it shows — a thick, lava-like flow — not the
 * metallic `coinDrop` it used to be (which itself had superseded
 * `waterDrop` for being "too wet" when the event was conceived of as
 * a coin). The event is now conceived of as liquid, full stop. Both
 * `coinDrop` and `waterDrop` are retained as library primitives but
 * are no longer wired into the Reservoir · don't repoint back.
 *
 * High viscosity has a specific acoustic signature · the onset is
 * SOFT and rounded (the opposite of a coin's metallic tick) and the
 * body is LOW and dark (no hiss). Three overlapping components:
 *   1. EFFLUX BODY (180-300ms) · the continuous dark "pour" · low-
 *      passed pink noise swept downward · the stream itself leaving
 *      the orifice. Soft 18ms attack · no percussive transient.
 *   2. GLUG CAVITY (1-2 staggered, ~140-220ms) · the signature
 *      thick-liquid "bloop" · a low FM-modulated sine sweeping DOWN
 *      (a big, slow trapped air pocket collapsing · ~5x lower and
 *      ~4x longer than waterDrop's thin "boop", with deeper FM for
 *      the wet/glottal thickness a clean sine can't make).
 *   3. SUB BODY (≈180ms) · a low resonant mode for the molten
 *      "mass" · without it the pour sounds hollow rather than heavy.
 *
 * Per-call jitter (pitch + glug timing) so successive flows don't
 * machine-gun-clone during the dense REPLAY animation (100 coins/8s).
 *
 * Signature mirrors `coinDrop(synth,t0,pitch,volume)` so the call-
 * site swap in BitcoinReservoir is 1:1.
 *
 * @param pitch  base glug frequency Hz (default 240 · higher = a
 *               thinner/lighter stream, lower = heavier/more molten)
 * @param volume 0-1 master amplitude
 */
export function viscousFlow(
  synth: Synth,
  t0: number,
  pitch = 240,
  volume = 0.45,
): void {
  const { ctx, master } = synth;

  // Per-call jitter · ±16% pitch, ±14% volume · a different gout of
  // liquid each time, without the cloned feel.
  const pitchJ = pitch * (1 + (Math.random() - 0.5) * 0.32);
  const volJ = volume * (1 + (Math.random() - 0.5) * 0.28);

  // ─── COMPONENT 1 · Efflux body (dark filtered-noise pour) ──────
  // Pink noise (1/f · natural liquid texture) heavily lowpassed and
  // swept downward. The 18ms linear attack is deliberate · viscosity
  // means NO percussive onset, and that softness is exactly what
  // makes the ear read "thick liquid" instead of "coin/water tick."
  const bodyDur = 0.24 + Math.random() * 0.06;
  const body = ctx.createBufferSource();
  body.buffer = pinkNoiseBuffer(ctx, bodyDur + 0.04, 1.5);
  const bodyLp = ctx.createBiquadFilter();
  bodyLp.type = "lowpass";
  bodyLp.frequency.setValueAtTime(pitchJ * 2.4, t0);
  bodyLp.frequency.exponentialRampToValueAtTime(pitchJ * 1.05, t0 + bodyDur);
  bodyLp.Q.value = 1.4;
  const bodyEnv = ctx.createGain();
  bodyEnv.gain.setValueAtTime(0, t0);
  bodyEnv.gain.linearRampToValueAtTime(volJ * 0.5, t0 + 0.018);
  bodyEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + bodyDur);
  body.connect(bodyLp).connect(bodyEnv).connect(master);
  body.start(t0);
  body.stop(t0 + bodyDur + 0.04);

  // ─── COMPONENT 2 · Glug cavities (1-2 thick "bloops") ──────────
  // The signature of a viscous pour · a big, slow air pocket
  // collapsing. Like waterDrop's cavity phase but far lower, far
  // longer, with heavier FM depth (∝ f0) for the glottal thickness.
  // 60% chance of a 2nd staggered glug → the "glug-glug" of a real
  // flow rather than a single isolated blip.
  const glugs = Math.random() < 0.6 ? 2 : 1;
  for (let g = 0; g < glugs; g++) {
    const gOff = g === 0 ? 0 : 0.06 + Math.random() * 0.07;
    const gJit = 1 + (Math.random() - 0.5) * 0.18;
    const f0 = pitchJ * gJit;
    const fEnd = f0 * 0.34; // collapses well below start · thick = big drop
    const cavDur = (0.15 + Math.random() * 0.06) * (g === 0 ? 1 : 0.78);
    const tg = t0 + gOff;

    const carrier = ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.setValueAtTime(f0, tg);
    carrier.frequency.exponentialRampToValueAtTime(fEnd, tg + cavDur);

    // FM modulator · deeper than waterDrop (depth ∝ f0) for the
    // glottal "thickness" a clean sine sweep can't produce.
    const mod = ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.setValueAtTime(f0 * 1.4, tg);
    mod.frequency.exponentialRampToValueAtTime(fEnd * 1.4, tg + cavDur);
    const modGain = ctx.createGain();
    modGain.gain.value = f0 * 0.6;
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = f0 * 3;
    lp.Q.value = 2;
    const env = makeEnvGain(
      ctx,
      tg,
      0.012,
      volJ * (g === 0 ? 0.8 : 0.5),
      cavDur,
    );
    carrier.connect(lp).connect(env).connect(master);
    carrier.start(tg);
    mod.start(tg);
    carrier.stop(tg + cavDur + 0.02);
    mod.stop(tg + cavDur + 0.02);
  }

  // ─── COMPONENT 3 · Sub body (molten mass) ──────────────────────
  // Low resonant mode under everything · the "weight" of molten
  // material. Long soft 20ms excitation + low Q → a rounded "wummp"
  // rather than a struck note. Without this the pour sounds hollow.
  modeRing(synth, t0, pitchJ * 0.45, 9, 0.18, volJ * 0.42, 0.02);
}

// ────────────────────────────────────────────────────────────────────
// IMPACT PRIMITIVES
// ────────────────────────────────────────────────────────────────────

/**
 * Glass shatter · v2 with proper 4-stage cascade.
 *
 * Real shatter follows a physically-determined sequence:
 *   1. MICRO-CRACKS (50ms) · 6-8 rapid tiny pings as fractures
 *      propagate through the material before the body collapses
 *   2. MAIN BREAK (300ms) · pink-noise body filtered to glass
 *      frequencies, with multiple bandpass humps
 *   3. DEBRIS CASCADE (1.2s) · 12-15 random pings as shards
 *      hit the floor at different times and frequencies
 *   4. SETTLING (400ms) · quiet pink-noise tail · the "after
 *      it's quiet" sound of dust and tiny shards still moving
 *
 * Total duration ~2 seconds · much more dramatic than v1's
 * single white-noise burst, and physically/acoustically correct.
 */
export function glassShatter(
  synth: Synth,
  t0: number,
  volume = 0.7,
): void {
  const { ctx, master } = synth;
  const reverb = makeReverbBus(synth, 0.55);

  // ─── STAGE 1 · Micro-cracks (50ms · 7 rapid tiny pings) ────────
  // The fracture-propagation phase · before the body collapses,
  // small cracks shoot through the glass. Acoustically these are
  // very short, very high-pitched events at random pitches.
  const microCount = 7;
  for (let i = 0; i < microCount; i++) {
    const offset = (i / microCount) * 0.05 + Math.random() * 0.008;
    const pitch = 4000 + Math.random() * 5000;
    modeRing(synth, t0 + offset, pitch, 22, 0.025, volume * 0.4, 0.003);
  }

  // ─── STAGE 2 · Main break (300ms · pink-noise body) ───────────
  // The body of the shatter · pink noise filtered with multiple
  // bandpass humps to mimic glass's mid-band spectral signature.
  const t2 = t0 + 0.04;
  const body = ctx.createBufferSource();
  body.buffer = pinkNoiseBuffer(ctx, 0.32, 2);
  // Two-band parallel bandpass · gives the body a "glassy" formant
  // structure rather than just hissing white noise.
  const bp1 = ctx.createBiquadFilter();
  bp1.type = "bandpass";
  bp1.frequency.value = 2400;
  bp1.Q.value = 2.5;
  const bp2 = ctx.createBiquadFilter();
  bp2.type = "bandpass";
  bp2.frequency.value = 4800;
  bp2.Q.value = 3;
  const bodyMix = ctx.createGain();
  bodyMix.gain.value = volume * 0.85;
  const bodyEnv = makeEnvGain(ctx, t2, 0.003, 1, 0.32);
  // Send into both bandpasses in parallel
  body.connect(bp1);
  body.connect(bp2);
  bp1.connect(bodyMix);
  bp2.connect(bodyMix);
  bodyMix.connect(bodyEnv);
  bodyEnv.connect(master);
  // Half to reverb for spatial depth
  const bodySend = ctx.createGain();
  bodySend.gain.value = 0.45;
  bodyEnv.connect(bodySend);
  bodySend.connect(reverb);
  body.start(t2);
  body.stop(t2 + 0.34);

  // ─── STAGE 3 · Debris cascade (1.2s · 14 random pings) ────────
  // Shards hitting the floor at different times. Pitch range
  // 1200-5500Hz spans small shards (high) to large shards (lower).
  // Distributed exponentially so most pings land early (right
  // after the break) with stragglers trailing off.
  const debrisCount = 14;
  for (let i = 0; i < debrisCount; i++) {
    // Exponential offset distribution · packs more events early
    const offset = 0.1 + Math.pow(Math.random(), 1.5) * 1.2;
    const pitch = 1200 + Math.random() * 4300;
    const lvl = 0.12 + Math.random() * 0.18;
    modeRing(synth, t0 + offset, pitch, 16, 0.08, volume * lvl, 0.004);
    // Occasionally also fire a higher harmonic for "double hit"
    if (Math.random() < 0.4) {
      modeRing(
        synth,
        t0 + offset + 0.005,
        pitch * 2.1,
        14,
        0.05,
        volume * lvl * 0.5,
        0.003,
      );
    }
  }

  // ─── STAGE 4 · Settling (400ms · quiet noise fade) ────────────
  // Very low-volume noise tail · the "tiny shards are still moving"
  // ambience. Conveys finality.
  const settle = ctx.createBufferSource();
  settle.buffer = pinkNoiseBuffer(ctx, 0.4, 2);
  const settleHp = ctx.createBiquadFilter();
  settleHp.type = "highpass";
  settleHp.frequency.value = 3000;
  const settleGain = makeEnvGain(ctx, t0 + 0.5, 0.05, volume * 0.08, 0.4);
  settle.connect(settleHp).connect(settleGain).connect(master);
  settle.start(t0 + 0.5);
  settle.stop(t0 + 0.92);
}

/**
 * Ice crack · v2 with FM-modulated rumble + 8 crack events.
 *
 * v1 was 4-5 short pings on a flat noise rumble. v2:
 *   - Doubles the crack count to 8-10 with wider pitch range
 *   - The rumble is now FM-modulated (slowly oscillating filter
 *     cutoff) · sounds like ice "groaning" under stress, not
 *     just hissing
 *   - Cracks have varied decay times so they don't all sound
 *     the same
 *   - Final fading rumble for the "settling" tail
 */
export function iceCrack(
  synth: Synth,
  t0: number,
  volume = 0.5,
): void {
  const { ctx, master } = synth;

  // ─── Low groaning rumble with LFO-modulated filter ────────────
  // The deep "structure under stress" undertone. LFO on the filter
  // cutoff makes it sound like the ice is shifting / settling.
  const rumble = ctx.createBufferSource();
  rumble.buffer = pinkNoiseBuffer(ctx, 0.7, 1.5);
  const rumbleLp = ctx.createBiquadFilter();
  rumbleLp.type = "lowpass";
  rumbleLp.frequency.value = 220;
  rumbleLp.Q.value = 4;
  // LFO modulates filter cutoff at 5Hz · slow groan
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 5;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 60;
  lfo.connect(lfoDepth);
  lfoDepth.connect(rumbleLp.frequency);
  const rumbleGain = makeEnvGain(ctx, t0, 0.005, volume * 0.55, 0.65);
  rumble.connect(rumbleLp).connect(rumbleGain).connect(master);
  rumble.start(t0);
  lfo.start(t0);
  rumble.stop(t0 + 0.7);
  lfo.stop(t0 + 0.7);

  // ─── Discrete crack events · 8 short high-frequency pings ─────
  // Each crack is a single high-Q resonator strike. Wider pitch
  // range (2-6kHz) than v1 makes the cracks feel like discrete
  // fractures rather than a uniform texture.
  const crackCount = 8;
  for (let i = 0; i < crackCount; i++) {
    const offset = Math.random() * 0.45;
    const pitch = 2000 + Math.random() * 4000;
    const decay = 0.04 + Math.random() * 0.08;
    const lvl = 0.3 + Math.random() * 0.35;
    modeRing(synth, t0 + offset, pitch, 18, decay, volume * lvl, 0.004);
    // Half the cracks get a follow-up echo · simulates the crack
    // propagating across the ice surface to a second fracture.
    if (Math.random() < 0.5) {
      const echoPitch = pitch * (0.7 + Math.random() * 0.4);
      modeRing(
        synth,
        t0 + offset + 0.018 + Math.random() * 0.025,
        echoPitch,
        16,
        decay * 0.6,
        volume * lvl * 0.55,
        0.003,
      );
    }
  }
}

/**
 * Glass tap · v2 with 3-mode resonance for richer chime.
 *
 * v1 was a single bandpass ping + sine ring. v2 uses 3 modal
 * resonators at glass-typical frequencies. Used for UI button
 * presses on the Reservoir.
 */
export function glassTap(
  synth: Synth,
  t0: number,
  volume = 0.35,
): void {
  // 3 modal modes · glass typically resonates at 2-6kHz
  modeRing(synth, t0, 5200, 24, 0.13, volume * 1.0, 0.004);
  modeRing(synth, t0, 7800, 22, 0.09, volume * 0.6, 0.004);
  modeRing(synth, t0, 3400, 20, 0.18, volume * 0.55, 0.005);
}

/**
 * Rocket whoosh · a lift-off roar for the Runner's "to the moon"
 * launch (2026-07-10). Three layered components over `dur` seconds:
 *   1. ROAR · looped-ish pink noise through a lowpass that opens up as
 *      thrust builds · the broadband body of the burn
 *   2. RISE · a bandpass swept UP in frequency · the doppler "whoosh"
 *      that sells acceleration away from the listener
 *   3. SUB · a low sine that climbs an octave · the engine spooling up
 * Envelope swells in over the first third, holds, then releases.
 *
 * @param dur    total seconds (default 1.3)
 * @param volume 0-1 master amplitude
 */
export function rocketWhoosh(
  synth: Synth,
  t0: number,
  dur = 1.3,
  volume = 0.5,
): void {
  const { ctx, master } = synth;
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0, t0);
  bus.gain.linearRampToValueAtTime(volume, t0 + dur * 0.32);
  bus.gain.setValueAtTime(volume, t0 + dur * 0.72);
  bus.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  bus.connect(master);

  // ─── Roar · pink-noise body, filter opens as thrust builds ─────
  const roar = ctx.createBufferSource();
  roar.buffer = pinkNoiseBuffer(ctx, dur + 0.1, 0);
  const roarLp = ctx.createBiquadFilter();
  roarLp.type = "lowpass";
  roarLp.frequency.setValueAtTime(320, t0);
  roarLp.frequency.exponentialRampToValueAtTime(3200, t0 + dur * 0.7);
  roarLp.Q.value = 1.1;
  const roarGain = ctx.createGain();
  roarGain.gain.value = 0.7;
  roar.connect(roarLp).connect(roarGain).connect(bus);
  roar.start(t0);
  roar.stop(t0 + dur + 0.05);

  // ─── Rise · bandpass swept up · the accelerating "whoosh" ──────
  const rise = ctx.createBufferSource();
  rise.buffer = pinkNoiseBuffer(ctx, dur + 0.1, 0);
  const riseBp = ctx.createBiquadFilter();
  riseBp.type = "bandpass";
  riseBp.frequency.setValueAtTime(280, t0);
  riseBp.frequency.exponentialRampToValueAtTime(2600, t0 + dur);
  riseBp.Q.value = 3.5;
  const riseGain = ctx.createGain();
  riseGain.gain.value = 0.5;
  rise.connect(riseBp).connect(riseGain).connect(bus);
  rise.start(t0);
  rise.stop(t0 + dur + 0.05);

  // ─── Sub · engine spool, climbs an octave ─────────────────────
  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(46, t0);
  sub.frequency.exponentialRampToValueAtTime(92, t0 + dur * 0.8);
  const subGain = ctx.createGain();
  subGain.gain.value = 0.55;
  sub.connect(subGain).connect(bus);
  sub.start(t0);
  sub.stop(t0 + dur + 0.05);
}

// ────────────────────────────────────────────────────────────────────
// SUSTAINED PRIMITIVES (return a stop() handle, not fire-and-forget)
// ────────────────────────────────────────────────────────────────────

/**
 * Ambient resonance · a barely-perceptible continuous "powered on"
 * hum for the /float Reservoir. Three quiet sustained oscillators
 * (52, 78, 113 Hz · matches the vaultThud body modes for tonal
 * cohesion) with slow LFO breathing on amplitude so it's not a
 * flat drone.
 *
 * Designed to sit JUST AT the threshold of perception — the visitor
 * shouldn't consciously notice it, but the Reservoir feels "alive"
 * vs "dead" with vs without it. The kind of subtle production
 * detail that separates premium tools from amateur ones.
 *
 * Returns a `stop()` function · caller must invoke on toggle-off
 * or component unmount.
 *
 * @param synth   Audio context + master gain
 * @param volume  0-1 master amplitude (default 0.05 · very quiet)
 * @param fadeIn  Seconds to fade in to full volume (default 1.5s ·
 *                avoids a sudden "machine turns on" pop)
 */
export function ambientResonance(
  synth: Synth,
  volume = 0.05,
  fadeIn = 1.5,
): { stop: (fadeOut?: number) => void } {
  const { ctx, master } = synth;
  const t0 = ctx.currentTime;

  // v3 · MOLTEN SIMMER REWRITE (2026-06-11, operator: "the sound
  // effects are rudimentary"). v2 was three bare sines with an LFO ·
  // it read as a 1990s synth pad, not a vessel of molten liquid at
  // rest. v3 is three layers, all sub-perceptual:
  //   1. SUB BED · two deep sines (52/78Hz, vaultThud-coherent) with
  //      slow breathing · the instrument's powered-on weight
  //   2. SIMMER · looped pink noise through a low-pass whose cutoff
  //      is LFO-roiled · the surface of thick liquid barely moving
  //   3. BUBBLES · a self-rescheduling timer fires a soft random
  //      glug every ~3-6s · the liquid occasionally turning over.
  //      THIS is what makes the vessel feel alive between drips.
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 380;
  lp.Q.value = 0.7;
  lp.connect(master);

  const ambientGain = ctx.createGain();
  ambientGain.gain.setValueAtTime(0, t0);
  ambientGain.gain.linearRampToValueAtTime(volume, t0 + fadeIn);
  ambientGain.connect(lp);

  // ── Layer 1 · sub bed ───────────────────────────────────────────
  const oscFreqs = [52, 78];
  const oscLevels = [1.0, 0.55];
  const sources: { osc: OscillatorNode; lfo: OscillatorNode }[] = [];
  for (let i = 0; i < oscFreqs.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = oscFreqs[i];
    osc.detune.value = (Math.random() - 0.5) * 8;
    const oscGain = ctx.createGain();
    oscGain.gain.value = oscLevels[i];
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.07 + Math.random() * 0.06;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = oscLevels[i] * 0.4;
    lfo.connect(lfoDepth);
    lfoDepth.connect(oscGain.gain);
    osc.connect(oscGain).connect(ambientGain);
    osc.start(t0);
    lfo.start(t0);
    sources.push({ osc, lfo });
  }

  // ── Layer 2 · simmer (roiled noise floor) ──────────────────────
  const simmer = ctx.createBufferSource();
  simmer.buffer = pinkNoiseBuffer(ctx, 2.5, 0); // taper 0 = flat loop
  simmer.loop = true;
  const simmerLp = ctx.createBiquadFilter();
  simmerLp.type = "lowpass";
  simmerLp.frequency.value = 240;
  simmerLp.Q.value = 1.2;
  const roil = ctx.createOscillator();
  roil.type = "sine";
  roil.frequency.value = 0.09;
  const roilDepth = ctx.createGain();
  roilDepth.gain.value = 90; // cutoff sways 150-330Hz · slow churn
  roil.connect(roilDepth);
  roilDepth.connect(simmerLp.frequency);
  const simmerGain = ctx.createGain();
  simmerGain.gain.value = 0.5;
  simmer.connect(simmerLp).connect(simmerGain).connect(ambientGain);
  simmer.start(t0);
  roil.start(t0);

  // ── Layer 3 · occasional bubble turnover ───────────────────────
  // Soft FM glug, far quieter than the event sounds · scheduled on
  // a random 2.8-6.5s cadence via self-rechaining timeout (cleared
  // in stop()). Scheduling uses the wall clock; synthesis uses the
  // audio clock · standard hybrid.
  let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const scheduleBubble = () => {
    if (stopped) return;
    bubbleTimer = setTimeout(() => {
      if (stopped) return;
      const tb = ctx.currentTime;
      const f0 = 130 + Math.random() * 70;
      const dur = 0.12 + Math.random() * 0.06;
      const carrier = ctx.createOscillator();
      carrier.type = "sine";
      carrier.frequency.setValueAtTime(f0, tb);
      carrier.frequency.exponentialRampToValueAtTime(f0 * 0.45, tb + dur);
      const mod = ctx.createOscillator();
      mod.type = "sine";
      mod.frequency.value = f0 * 1.4;
      const modGain = ctx.createGain();
      modGain.gain.value = f0 * 0.5;
      mod.connect(modGain);
      modGain.connect(carrier.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, tb);
      g.gain.linearRampToValueAtTime(0.5, tb + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, tb + dur);
      carrier.connect(g).connect(ambientGain);
      carrier.start(tb);
      mod.start(tb);
      carrier.stop(tb + dur + 0.02);
      mod.stop(tb + dur + 0.02);
      scheduleBubble();
    }, 2800 + Math.random() * 3700);
  };
  scheduleBubble();

  return {
    stop(fadeOut = 0.6) {
      if (stopped) return;
      stopped = true;
      if (bubbleTimer) clearTimeout(bubbleTimer);
      const tStop = ctx.currentTime;
      ambientGain.gain.cancelScheduledValues(tStop);
      ambientGain.gain.setValueAtTime(ambientGain.gain.value, tStop);
      ambientGain.gain.linearRampToValueAtTime(0, tStop + fadeOut);
      for (const { osc, lfo } of sources) {
        try {
          osc.stop(tStop + fadeOut + 0.05);
          lfo.stop(tStop + fadeOut + 0.05);
        } catch {
          /* already stopped */
        }
      }
      try {
        simmer.stop(tStop + fadeOut + 0.05);
        roil.stop(tStop + fadeOut + 0.05);
      } catch {
        /* already stopped */
      }
    },
  };
}

/**
 * Pour stream · continuous molten-flow bed for the Reservoir's
 * cinematic modes (2026-06-11). The discrete viscousFlow glugs are
 * right for sparse LIVE drips, but REPLAY (100 events / 8s) and
 * FORECAST (a decade draining in 7s) need CONTINUITY under the
 * events · a sustained pour whose intensity follows the scene.
 * FORECAST previously played NOTHING · the page's most dramatic
 * moment was silent.
 *
 * Construction: looped pink noise → lowpass whose cutoff AND gain
 * track `intensity`, plus a sub-osc for mass. setIntensity ramps
 * smoothly so the bed swells/recedes without zipper noise.
 *
 * Returns { setIntensity, stop } · caller owns the lifecycle.
 */
export function pourStream(
  synth: Synth,
  volume = 0.4,
): {
  setIntensity: (intensity: number, rampSec?: number) => void;
  stop: (fadeOut?: number) => void;
} {
  const { ctx, master } = synth;
  const t0 = ctx.currentTime;

  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0, t0);
  bus.connect(master);

  const noise = ctx.createBufferSource();
  noise.buffer = pinkNoiseBuffer(ctx, 2, 0);
  noise.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(160, t0);
  lp.Q.value = 1.3;
  noise.connect(lp).connect(bus);
  noise.start(t0);

  // Sub-osc mass · keeps the pour from sounding like distant static.
  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = 46;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.35;
  sub.connect(subGain).connect(bus);
  sub.start(t0);

  let stopped = false;
  return {
    setIntensity(intensity: number, rampSec = 0.6) {
      if (stopped) return;
      const t = ctx.currentTime;
      const clamped = Math.max(0, Math.min(1, intensity));
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(volume * clamped * 0.5, t + rampSec);
      lp.frequency.cancelScheduledValues(t);
      lp.frequency.setValueAtTime(lp.frequency.value, t);
      lp.frequency.linearRampToValueAtTime(140 + clamped * 480, t + rampSec);
    },
    stop(fadeOut = 0.8) {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0, t + fadeOut);
      try {
        noise.stop(t + fadeOut + 0.05);
        sub.stop(t + fadeOut + 0.05);
      } catch {
        /* already stopped */
      }
    },
  };
}
