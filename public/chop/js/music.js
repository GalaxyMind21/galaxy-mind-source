// CHOP · mainstage festival EDM engine (2026-07-27 rewrite)
//
// GENRE: big-room house / progressive — Tomorrowland main stage at night.
// Every real block = a different TRACK. Interval → tempo + drum kit.
// Hash (tail-biased) → key/progression. Fee pressure → palette + punch/sat.
// Structure is a NARRATIVE phase machine (tension → release), not a loop bed.
//
// RADIO MODE (primary path): Music.radio(url, {bpm, offsetSec, title}) loads a
// same-origin produced track (CC0 m4a packs under /chop/audio/). Generated
// engine starts instantly on the gesture; when decode completes, handoff at the
// next bar downbeat with a 1-bar crossfade, then the grid REBASES to the track.
// Phase machine stays a bar-count timeline (visuals + chart density). Fetch/
// decode failure → generated-only (console.info once). Offline fallback = today.
//
// Pure WebAudio, shared noise buffer with per-hit offset, lookahead scheduler
// on AudioContext clock, pumpGain/duckBus series (kick sidechain vs SFX duck
// never share an AudioParam writer). Recorded bed rides duckBus so chopSfx
// ducking still applies.
//
// Call Music.configure({...}) BEFORE start (and again on each new block).
// Prefer Music.radio(...) after configure, before start (retunes intro BPM).
// Gameplay drop control: Music.armDrop() / Music.abortDrop() / Music.phase().
// Chart gen: Music.phaseAt(audioTime) · optional BTC whisper: Music.setPriceCurve(norm).

import { createCalibrator } from "/chop/js/latency.js";

export let BPM = 128;
let BEAT = 60 / BPM;
let BAR = BEAT * 4;
const LOOKAHEAD_S = 0.13;
const TICK_MS = 25;
const MAX_LAYER = 4;
const MAX_VOICES_PER_STEP = 28;
const NOISE_ATK = 0.0004; // 0.4ms linear attack · kills DC step

// ── phase machine bar map (52-bar phrase) ───────────────────────────
// INTRO      bars  0–7   kick + hats, filtered, no lead
// GROOVE     bars  8–23  bass + pluck + full drums
// BREAKDOWN  bars 24–31  NO KICK · pads + reverb + lone motif
// BUILD      bars 32–35  snare roll + risers + crowd swell
// GAP        last beat of bar 35 · near silence (the drop hinge)
// DROP       bars 36–51  full power supersaw + pump + crash
// then cycle (bar % 52 → intro again as filtered re-entry)
const PHRASE_BARS = 52;
const PHASE_INTRO = "intro";
const PHASE_GROOVE = "groove";
const PHASE_BREAKDOWN = "breakdown";
const PHASE_BUILD = "build";
const PHASE_DROP = "drop";
const PHASE_GAP = "gap"; // sub-phase of build's last beat — reported as "build" to API

const PHASE_IDX = {
  intro: 0,
  groove: 1,
  breakdown: 2,
  build: 3,
  drop: 4,
};

let ctx = null;
let master, comp, clip, verb, verbSend, verbSendGain;
let duckBus, pumpGain, layerGain, sfxBus;
let genBedGain; // single writer: radio handoff · fades generated bed under track
let radioGain;  // single writer: radio handoff · recorded track into duckBus
let drumDry, drumPumped, drumSat, drumSatMakeup;
let smashBus, smashComp, smashGain;
let crowdSrc, crowdFilter, crowdGain;
let started = false;
let startTime = 0;
let nextNote = 0;
let step = 0;
// Softlock defense: stop() freezes the musical clock; start() without a
// configDirty reconfigure REBASES startTime so step / hitTimes stay continuous.
let hasSession = false;
let pauseElapsed = 0;
let dropRemain = 0;
let muteRemain = 0;
let intensity = 0;
let pendingIntensity = 0;
let dropUntil = 0; // ceremony absolute gate (seconds on audio clock)
let muteUntil = 0;
let schedTimer = null;
let noiseBuf = null;
let lastWhooshT = 0;
const beatQueue = [];

let voicesThisStep = 0;

// ── radio mode (recorded bed · primary path) ────────────────────────
// "off" | "loading" | "on"
let radioState = "off";
let radioTitle = null;
let radioWantBpm = null;     // author BPM · re-applied after configure retune
let radioOffsetSec = 0;
let radioBuffer = null;
let radioSrc = null;
let radioLoadGen = 0;        // stale-fetch cancel
let radioHandoffAt = 0;      // absolute ctx time of bar-boundary handoff
let radioBedMuteAt = 0;      // handoff + 1 bar · when generated bed goes silent
let radioHandoffPending = false;
let radioBedSilent = false;  // true after 1-bar crossfade · bed instruments off
let radioPendingStart = false; // buffer ready, waiting for Music.start()
let radioResume = false;     // was live across stop() · restart on start()
const RADIO_PEAK = 0.62;     // linear into duckBus (clip+comp after)
const RADIO_FAIL_MSG = "[chop music] radio unavailable — generated engine";

// ── drop arming / phase state ───────────────────────────────────────
let dropArmed = false;       // armDrop() requested → enter BUILD next bar
let abortPending = false;    // abortDrop() → groove at next bar
let forcedPhase = null;      // null = automatic phrase map; else string phase
let forcedBarInPhase = 0;    // bar counter inside forced sequence
let currentPhaseName = PHASE_INTRO;
let phaseListeners = [];
let buildRiserArmed = false;

// ── price-curve whisper layer (optional · setPriceCurve) ────────────
// null = layer absent (API down / never called) · behaves as pre-curve
let priceCurve = null;       // sanitized float[] in [0,1], oldest first
let priceCurveLen = 0;
let priceBarIdx = 0;         // bar-step along the curve (loops)
let priceTrendUp = true;     // true → BREAK_MOTIF · false → BREAK_MOTIF_DN

// ── per-track seed ──────────────────────────────────────────────────
let configDirty = true;
let trackRootPc = 9;
let trackProgShape = 0;
let trackPalette = 0;
let trackSwing = 0.0;
let trackHalfDrop = false;
let trackBassPat = 0;
let trackLeadPat = 0;
let trackPressure = 0.45;
let trackFullness = 0.55;
let trackInterval = 600;
let trackKit = 1; // 0 SURGE · 1 STEEL · 2 GRINDER · 3 FURNACE
let trackPunch = 1;
let trackMetalMix = 0.45;
let trackGhostDens = 0.4;
let trackClapLayer = 0.85;
let trackHatMetalHz = 263;
let trackAnvilHz = 110;
let trackAnvilPartials = 0;
let trackSmashTier = 0.22;
let trackSeed = 1;
let brnd = () => Math.random();
let NIBBLES = new Array(64).fill(0);
let PROG = null;
let PENT_HZ = null;
let ROOT_HZ = 55;
let kitParams = null;

const KIT_NAMES = ["SURGE", "STEEL", "GRINDER", "FURNACE"];
const PALETTE_NAMES = ["supersaw", "pluck", "fm-bell", "dist-square"];

// ── musical constants ───────────────────────────────────────────────
const ROOT_PCS = [4, 5, 6, 7, 8, 9, 10, 11]; // E F F# G G# A A# B
const ROOT_NAMES = ["E", "F", "F#", "G", "G#", "A", "A#", "B"];

// 0 IRON VAMP · 1 DESCENT · 2 HOLLOW · 3 PHRYGIAN GATE
const PROG_SHAPES = [
  [0, 10, 0, 8],
  [0, 10, 8, 7],
  [0, 5, 0, 7],
  [0, 1, 0, 10],
];
const MELODY_SCALES = [
  [0, 3, 5, 7, 10],
  [0, 2, 3, 7, 8],
  [0, 2, 5, 7, 10],
  [0, 1, 5, 8, 10],
];

// Big-room bass: root-heavy 4-on-floor with offbeat subs
const BASS_PATS = [
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 2, 0, 1, 0, 3, 0],
  [1, 0, 1, 0, 1, 0, 3, 0, 1, 0, 1, 0, 1, 0, 2, 0],
  [1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 3, 0],
  [1, 0, 0, 3, 0, 0, 1, 0, 1, 0, 0, 2, 0, 0, 3, 0],
];

// Supersaw stab patterns (degree index into PENT; -1 rest)
const LEAD_PATS = [
  [0, -1, -1, -1, 2, -1, -1, -1, 0, -1, 4, -1, 3, -1, 1, -1],
  [-1, -1, 0, -1, -1, -1, 2, -1, -1, -1, 4, -1, 0, -1, 3, -1],
  [0, -1, -1, 2, -1, -1, 4, -1, 0, -1, -1, 3, -1, -1, 1, -1],
  [0, -1, 2, -1, 0, -1, 4, -1, 3, -1, 2, -1, 0, -1, 1, -1],
];

// Breakdown lone motif (sparse) · ascending contour (default / trend-up)
const BREAK_MOTIF = [
  0, -1, -1, -1, -1, -1, 2, -1, -1, -1, -1, -1, 4, -1, -1, -1,
];
// Descending mirror · used when price curve trends down (setPriceCurve)
const BREAK_MOTIF_DN = [
  4, -1, -1, -1, -1, -1, 2, -1, -1, -1, -1, -1, 0, -1, -1, -1,
];

// Minor-pentatonic degree ladder (root-relative) for the price-ping blip
// 2 octaves × 5 degrees = 10 consonant steps
const PRICE_PENT_DEGS = [0, 3, 5, 7, 10];
const PRICE_LADDER = 10;
// Linear gains ≈ dBFS targets for the whisper layer
const PING_GROOVE = 0.0501; // ~-26 dBFS
const PING_DROP = 0.100;    // ~-20 dBFS
// Beat-3 offbeat on the 16th grid (musician beat 3 "&") — never the downbeat
const PING_SIX = 10;

const HAT_V = [
  1.0, 0.28, 0.62, 0.34, 0.86, 0.26, 0.66, 0.4,
  0.94, 0.28, 0.6, 0.32, 0.82, 0.3, 0.7, 0.52,
];
const HAT_MICRO_MS = [0, 5, -1, 6, 0, 5, -2, 7, 0, 4, -1, 6, 0, 5, -2, 3];
const HAT_OPEN_BASE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0];

// 4-on-floor big room (intro thinned in schedule)
const KICK_4OF = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const KICK_INTRO = [1, 0, 0, 0, 0, 0, 0, 0, 0.85, 0, 0, 0, 0, 0, 0, 0];

// Big-room kick kits — long tonal pitch env · punchy click · distorted tail
// STEEL is the mainstage default (150→45 over 60ms)
const KICK_KITS = [
  // SURGE · fast blocks · snappier
  {
    startHz: 160, endHz: 48, pitchMs: 50, decayMs: 220, subAmp: 0.95,
    punchHz: 280, punchMs: 45, punchAmp: 0.4,
    clickHP: 4800, clickMs: 5, clickAmp: 0.38,
    distAmp: 0.22, distHz: 90,
    dip: 0.28, dipDrop: 0.25, relMs: 160, relMsDrop: 180,
    bodyHz: 200, rattleF0: 3000, rattleMs: 110, sizzle: 0.14, clapLayer: 1.0,
    breakSwing: 0.0, hatMetalHz: 300, anvilHz: 118,
  },
  // STEEL · mainstage house
  {
    startHz: 150, endHz: 45, pitchMs: 60, decayMs: 280, subAmp: 1.05,
    punchHz: 240, punchMs: 55, punchAmp: 0.36,
    clickHP: 4200, clickMs: 6, clickAmp: 0.32,
    distAmp: 0.28, distHz: 78,
    dip: 0.32, dipDrop: 0.25, relMs: 170, relMsDrop: 180,
    bodyHz: 188, rattleF0: 2500, rattleMs: 140, sizzle: 0.16, clapLayer: 0.9,
    breakSwing: 0.0, hatMetalHz: 263, anvilHz: 110,
  },
  // GRINDER · slow blocks · longer tail
  {
    startHz: 140, endHz: 42, pitchMs: 70, decayMs: 360, subAmp: 1.1,
    punchHz: 200, punchMs: 70, punchAmp: 0.32,
    clickHP: 2800, clickMs: 8, clickAmp: 0.22,
    distAmp: 0.32, distHz: 70,
    dip: 0.36, dipDrop: 0.25, relMs: 190, relMsDrop: 190,
    bodyHz: 170, rattleF0: 2000, rattleMs: 180, sizzle: 0.18, clapLayer: 0.7,
    breakSwing: 0.04, hatMetalHz: 228, anvilHz: 98,
  },
  // FURNACE · heavy fee pressure kit
  {
    startHz: 155, endHz: 44, pitchMs: 55, decayMs: 300, subAmp: 1.12,
    punchHz: 260, punchMs: 60, punchAmp: 0.45,
    clickHP: 3600, clickMs: 7, clickAmp: 0.36,
    distAmp: 0.34, distHz: 82,
    dip: 0.28, dipDrop: 0.25, relMs: 165, relMsDrop: 180,
    bodyHz: 182, rattleF0: 2300, rattleMs: 160, sizzle: 0.2, clapLayer: 0.95,
    breakSwing: 0.0, hatMetalHz: 241, anvilHz: 124,
  },
];

const ANVIL_PARTIALS = [
  [1, 2.756, 5.404, 8.933, 13.34],
  [1, 2.08, 3.41, 3.89, 5.0],
  [1, 2.76, 5.4, 8.93, 12.1],
  [1, 1.59, 2.13, 3.17, 4.61],
];

// Crowd levels (linear gain ≈ dBFS targets)
const CROWD_GROOVE = 0.079;  // ~-22 dBFS
const CROWD_BUILD_PEAK = 0.18;
const CROWD_DROP = 0.25;     // ~-12 dBFS

function midiToHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
function pcToMidi(pc, oct) {
  let m = pc + (oct + 1) * 12;
  while (m < 24) m += 12;
  while (m > 96) m -= 12;
  return m;
}

function buildProg(rootPc, shapeIdx) {
  const degs = PROG_SHAPES[shapeIdx % PROG_SHAPES.length];
  const out = [];
  for (let i = 0; i < 4; i++) {
    const pc = (rootPc + ((degs[i] % 12) + 12) % 12) % 12;
    const isMinor = degs[i] === 0 || degs[i] === 5 || degs[i] === 7;
    const third = isMinor ? 3 : 4;
    const bassM = pcToMidi(pc, 1);
    const midM = bassM + 12;
    out.push([
      midiToHz(bassM),
      midiToHz(midM),
      midiToHz(midM + third),
      midiToHz(midM + 7),
    ]);
  }
  return out;
}

function buildPent(rootPc, shapeIdx) {
  const degs = MELODY_SCALES[shapeIdx % MELODY_SCALES.length];
  return degs.map((d) => midiToHz(pcToMidi((rootPc + d) % 12, 3)));
}

/**
 * Mainstage big-room tempo band 124–132.
 * fast (<300s) → 130–132 · normal (~600s) → 128 · slow (>1800s) → 124–126
 * Smooth log curve, deterministic from block interval.
 */
export function intervalToBpm(intervalSec) {
  const t = Math.max(90, Math.min(3600, Number(intervalSec) || 600));
  const logT = Math.log(t);
  // Anchors on the log axis: ~200s → 132, ~600s → 128, ~2000s → 124
  const lo = Math.log(200);
  const hi = Math.log(2000);
  const u = Math.max(0, Math.min(1, (logT - lo) / (hi - lo)));
  const bpm = 132 - u * 8;
  return Math.round(Math.max(124, Math.min(132, bpm)));
}

function kitFromInterval(sec) {
  const t = Number(sec) || 600;
  if (t < 300) return 0;
  if (t < 620) return 1;
  if (t < 1100) return 2;
  return 3;
}

/** Hash nibble from the TAIL — leading PoW zeros destroy head entropy */
function hashNib(hash, i) {
  const h = String(hash || "").toLowerCase().replace(/[^0-9a-f]/g, "");
  if (h.length < 8) return 0;
  const c = h.charCodeAt(h.length - 1 - (i % 32));
  return c <= 57 ? c - 48 : c - 87;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickPalette(opts, pressure, fullness) {
  if (Number.isFinite(Number(opts.palette))) {
    return Math.max(0, Math.min(3, opts.palette | 0));
  }
  if (pressure >= 0.55 && fullness >= 0.55) return 0; // supersaw
  if (pressure < 0.55 && fullness >= 0.55) return 1; // pluck
  if (pressure < 0.55 && fullness < 0.55) return 2; // fm-bell
  return 3; // dist-square
}

function softClipCurve(k) {
  const n = 1024, c = new Float32Array(n);
  const kk = k || 1.6;
  const den = Math.tanh(kk);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * kk) / den;
  }
  return c;
}

function satCurve(sat) {
  const n = 2048, c = new Float32Array(n);
  const s = Math.max(0.4, Math.min(4, sat));
  const den = Math.tanh(s);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * s) / den;
  }
  return c;
}

/**
 * Synthesized stereo impulse: exponentially decaying filtered noise,
 * ~2.8s outdoor-mainstage tail, L/R decorrelated.
 */
function makeImpulse(seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    // independent seed path per channel for decorrelation
    let a = (ch + 1) * 0x9e3779b9;
    for (let i = 0; i < len; i++) {
      a = (Math.imul(a ^ (a >>> 13), 0x5bd1e995) + i) | 0;
      const noise = ((a >>> 0) / 4294967296) * 2 - 1;
      // early brightness fade + long exponential tail
      const env = Math.pow(1 - i / len, decay) * Math.exp(-i / (rate * 0.55));
      // mild lowpass by averaging with previous
      const prev = i > 0 ? d[i - 1] : 0;
      d[i] = (noise * 0.72 + prev * 0.28) * env;
    }
  }
  return buf;
}

function ensureNoiseBuf() {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 2);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/** Pink-ish noise buffer for the crowd bed (Voss-McCartney-ish) */
function makePinkBuf(seconds) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

// ── THE HEARD CLOCK ─────────────────────────────────────────────────
//
// Everything the player is asked to do is relative to when they HEAR the
// beat, which is not when we scheduled it. The gap is output latency: the
// buffers already handed to the OS, plus the DAC, plus — the big one —
// any Bluetooth link (AirPods add 120-180 ms all by themselves).
//
// WHY THIS WAS THE BUG. The Web Audio spec exposes `outputLatency` for
// exactly this, and Chrome implements it (32 ms on a typical desktop, and
// it is honest). WebKit does NOT. So on iOS Safari this fell through to
// `baseLatency`, which is a DIFFERENT quantity — the graph's internal
// processing quantum, about 5 ms — and reported it as if it were output
// latency. On an iPhone we were therefore compensating 5 ms for a true
// 100-200 ms. Two things follow, and both were reported as bugs:
//
//   1. The cube visibly arrives at its gate 100-200 ms BEFORE the sound
//      it is supposed to be cut on. That is "the chops aren't lined up
//      with the beats", exactly.
//   2. dtBeat is biased by that same amount, so it never fell inside the
//      +/-90 ms onBeat window. PERFECT, NAILED and every praise callout
//      were unreachable on the primary target device. Not rare — impossible.
//
// (The track grid was investigated first and largely exonerated: a
// search-free test that imposes a fixed grid and measures its distance to
// real transients scores the manifest's own 128 BPM at 3.0 ms median on
// flying-temple and 130 BPM at 2.5 ms on ascend, both with a ~2.5x margin
// over neighbours. See public/chop/js/beatgrid.js. Only starting-over's
// tempo was actually wrong.)
//
// THE FIX is to measure the device instead of asking it. `calibrate()`
// below is fed the signed timing error of real cuts; its median is the
// systematic component, which is precisely this latency. Human scatter is
// roughly symmetric about intent, so it cancels in a median while the
// device offset does not. Same principle as Clone Hero's auto-calibration,
// and it costs the player nothing.

// Platform-informed seed for the case where the API refuses to tell us.
// This is a GUESS and is labelled as one; its only job is to be less wrong
// than 5 ms for the first dozen cuts, after which measurement takes over.
const WEBKIT_OUTPUT_LATENCY_GUESS = 0.11;

// The estimator itself is pure math and lives in latency.js so the Node
// test can drive the REAL code through simulated devices instead of a
// paraphrase of it. See that file for why the median (and the flush) are
// the way they are.
const calibrator = createCalibrator(0);

function apiLatency() {
  if (!ctx) return 0;
  if (typeof ctx.outputLatency === "number" && Number.isFinite(ctx.outputLatency) && ctx.outputLatency > 0) {
    return ctx.outputLatency;
  }
  // Deliberately NOT baseLatency — see the note above. baseLatency is the
  // render quantum, not the output path, and using it here is what shipped
  // the bug. If the engine will not report outputLatency we say so by
  // falling back to a stated guess instead of a wrong measurement.
  return WEBKIT_OUTPUT_LATENCY_GUESS;
}

function latencyOffset() {
  if (!ctx) return 0;
  return Math.max(0, apiLatency() + calibrator.bias);
}

function heardTime() {
  if (!ctx) return 0;
  return Math.max(0, ctx.currentTime - latencyOffset());
}

// ── finite-safe AudioParam scheduling ───────────────────────────────
function fin(n, fallback) {
  return Number.isFinite(n) ? n : (fallback != null ? fallback : 0);
}
function safeTime(t) {
  if (!Number.isFinite(t)) return null;
  return t < 0 ? 0 : t;
}
function safeSet(param, value, t, fallback) {
  if (!param) return false;
  const v = fin(value, fallback != null ? fallback : 0);
  const time = safeTime(t);
  if (time == null) return false;
  try { param.setValueAtTime(v, time); return true; } catch { return false; }
}
function safeLin(param, value, t, fallback) {
  if (!param) return false;
  const v = fin(value, fallback != null ? fallback : 0);
  const time = safeTime(t);
  if (time == null) return false;
  try { param.linearRampToValueAtTime(v, time); return true; } catch { return false; }
}
function safeExp(param, value, t, fallback) {
  if (!param) return false;
  let v = fin(value, fallback != null ? fallback : 0.001);
  if (!(v > 0)) v = 0.001;
  const time = safeTime(t);
  if (time == null) return false;
  try { param.exponentialRampToValueAtTime(v, time); return true; } catch { return false; }
}
function safeCancel(param, t) {
  if (!param) return false;
  const time = safeTime(t);
  if (time == null) return false;
  try { param.cancelScheduledValues(time); return true; } catch { return false; }
}
function safeTarget(param, value, t, tc, fallback) {
  if (!param) return false;
  const v = fin(value, fallback != null ? fallback : 0);
  const time = safeTime(t);
  if (time == null || !(tc > 0)) return false;
  try { param.setTargetAtTime(v, time, tc); return true; } catch { return false; }
}

let _paramGuardInstalled = false;
function installAudioParamGuards() {
  if (_paramGuardInstalled || typeof AudioParam === "undefined") return;
  _paramGuardInstalled = true;
  const proto = AudioParam.prototype;
  const wrap = (name, sanitize) => {
    const orig = proto[name];
    if (typeof orig !== "function" || orig._gmSafe) return;
    const wrapped = function (...args) {
      const fixed = sanitize(args);
      if (!fixed) return this;
      try { return orig.apply(this, fixed); } catch { return this; }
    };
    wrapped._gmSafe = true;
    proto[name] = wrapped;
  };
  wrap("setValueAtTime", (a) => {
    if (!Number.isFinite(a[0]) || !Number.isFinite(a[1])) return null;
    return [a[0], Math.max(0, a[1])];
  });
  wrap("linearRampToValueAtTime", (a) => {
    if (!Number.isFinite(a[0]) || !Number.isFinite(a[1])) return null;
    return [a[0], Math.max(0, a[1])];
  });
  wrap("exponentialRampToValueAtTime", (a) => {
    if (!Number.isFinite(a[1])) return null;
    let v = a[0];
    if (!Number.isFinite(v) || v <= 0) v = 0.001;
    return [v, Math.max(0, a[1])];
  });
  wrap("cancelScheduledValues", (a) => {
    if (!Number.isFinite(a[0])) return null;
    return [Math.max(0, a[0])];
  });
  wrap("setTargetAtTime", (a) => {
    if (!Number.isFinite(a[0]) || !Number.isFinite(a[1]) || !Number.isFinite(a[2])) return null;
    return [a[0], Math.max(0, a[1]), Math.max(1e-4, a[2])];
  });
}

// ── bus graph ───────────────────────────────────────────────────────
// layerGain → pumpGain (kick sidechain ONLY) → genBedGain → duckBus (SFX duck)
// drumDry → drumSat → genBedGain        (kick/sub — never self-pumped)
// drumPumped → pumpGain                 (snare/hats/lead/bass)
// smashBus → smashComp → smashGain → genBedGain
// radioGain → duckBus                   (recorded bed · ducks with SFX)
// crowdGain → clip (parallel, not pumped — stadium bed)
// sfxBus → clip
// verbSend → verb → clip
// ── ATTRACT BED · music on the boot screen (operator 2026-08-06) ────
// Browsers only allow audio after a user gesture, so this starts on the
// FIRST tap anywhere on the boot card (a difficulty chip, settings,
// anywhere) — the closest a web game can get to "music on the home
// screen". A plain looping BufferSource at background level, fully
// outside the session clock (no grid, no scheduler), stopped by
// Music.start() the moment a real run begins. Best-effort everywhere:
// a failed fetch or decode just means a quiet boot screen.
let attractSrc = null;
let attractGain = null;
export async function attractStart(url) {
  ensureAudio();
  if (!ctx) return;
  if (ctx.state === "suspended") { try { ctx.resume(); } catch { /* */ } }
  if (attractSrc || started) return;
  try {
    const res = await fetch(url);
    const raw = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(raw);
    if (attractSrc || started) return; // a session started during decode
    attractGain = ctx.createGain();
    attractGain.gain.value = 0.0001;
    attractGain.connect(master);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(attractGain);
    s.start();
    attractSrc = s;
    const t = ctx.currentTime;
    attractGain.gain.setValueAtTime(0.0001, t);
    attractGain.gain.linearRampToValueAtTime(0.3, t + 1.2);
  } catch { /* quiet boot screen */ }
}
export function attractStop() {
  if (!ctx || !attractSrc) return;
  const s = attractSrc, g = attractGain;
  attractSrc = null;
  attractGain = null;
  try {
    const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.25);
    s.stop(t + 0.3);
  } catch { /* already dead */ }
}

export function ensureAudio() {
  if (ctx) return ctx;
  installAudioParamGuards();
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
  master = ctx.createGain(); master.gain.value = 0.9;
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 20; comp.ratio.value = 3.5;
  comp.attack.value = 0.003; comp.release.value = 0.18;
  clip = ctx.createWaveShaper(); clip.curve = softClipCurve(1.5); clip.oversample = "2x";

  // Outdoor mainstage reverb · 2.8s
  verb = ctx.createConvolver(); verb.buffer = makeImpulse(2.8, 2.2);
  verbSend = ctx.createGain(); verbSend.gain.value = 1;
  verbSendGain = ctx.createGain(); verbSendGain.gain.value = 0.55; // global room size

  duckBus = ctx.createGain(); duckBus.gain.value = 1;
  pumpGain = ctx.createGain(); pumpGain.gain.value = 1;
  layerGain = ctx.createGain(); layerGain.gain.value = 1;
  genBedGain = ctx.createGain(); genBedGain.gain.value = 1;
  radioGain = ctx.createGain(); radioGain.gain.value = 0.0001;
  sfxBus = ctx.createGain(); sfxBus.gain.value = 1;

  drumDry = ctx.createGain(); drumDry.gain.value = 1;
  drumPumped = ctx.createGain(); drumPumped.gain.value = 1;
  drumSat = ctx.createWaveShaper(); drumSat.oversample = "2x";
  drumSat.curve = satCurve(1.2);
  drumSatMakeup = ctx.createGain(); drumSatMakeup.gain.value = 1;

  smashBus = ctx.createGain(); smashBus.gain.value = 0.22;
  smashComp = ctx.createDynamicsCompressor();
  smashComp.threshold.value = -34; smashComp.knee.value = 3;
  smashComp.ratio.value = 12; smashComp.attack.value = 0.0012; smashComp.release.value = 0.09;
  smashGain = ctx.createGain(); smashGain.gain.value = 1;

  // Crowd bed (long-running pink noise)
  crowdGain = ctx.createGain(); crowdGain.gain.value = 0.0001;
  crowdFilter = ctx.createBiquadFilter();
  crowdFilter.type = "bandpass";
  crowdFilter.frequency.value = 1400;
  crowdFilter.Q.value = 0.55;
  const pink = makePinkBuf(4);
  crowdSrc = ctx.createBufferSource();
  crowdSrc.buffer = pink;
  crowdSrc.loop = true;
  crowdSrc.connect(crowdFilter);
  crowdFilter.connect(crowdGain);
  crowdGain.connect(clip);
  try { crowdSrc.start(0, Math.random() * 3.5); } catch { try { crowdSrc.start(0); } catch { /* */ } }

  // series chain · generated bed folds into genBedGain (radio crossfade writer)
  layerGain.connect(pumpGain);
  pumpGain.connect(genBedGain);
  drumPumped.connect(pumpGain);
  drumDry.connect(drumSat); drumSat.connect(drumSatMakeup); drumSatMakeup.connect(genBedGain);
  smashBus.connect(smashComp); smashComp.connect(smashGain); smashGain.connect(genBedGain);
  genBedGain.connect(duckBus);
  radioGain.connect(duckBus);
  duckBus.connect(clip);
  sfxBus.connect(clip);
  verbSend.connect(verbSendGain); verbSendGain.connect(verb); verb.connect(clip);
  clip.connect(comp); comp.connect(master); master.connect(ctx.destination);

  ensureNoiseBuf();
  return ctx;
}

/** Melodic/bed out · in radio bed-silent mode gameplay one-shots ride sfxBus. */
function musicOut() {
  if (radioBedSilent && sfxBus) return sfxBus;
  return layerGain || duckBus;
}
/** Kick/sub dry bus · keysound/ceremony stay audible after radio bed mute. */
function dryBus() {
  if (radioBedSilent && sfxBus) return sfxBus;
  return drumDry || duckBus;
}
/** Snare/hat pumped bus · same radio keysound rule. */
function pumpedBus() {
  if (radioBedSilent && sfxBus) return sfxBus;
  return drumPumped || duckBus;
}

function takeVoice(optional) {
  if (voicesThisStep >= MAX_VOICES_PER_STEP) {
    if (optional) return false;
  }
  voicesThisStep++;
  return true;
}

// ── noise helpers (random buffer offset — do not regress) ───────────
function noiseBurst(t, dur, freq, vol, opt) {
  opt = opt || {};
  const s = ctx.createBufferSource();
  s.buffer = ensureNoiseBuf();
  s.loop = true;
  const off = opt.off != null ? opt.off : brnd() * 1.9;
  const f = ctx.createBiquadFilter();
  f.type = opt.type || "highpass";
  f.frequency.value = freq;
  if (opt.Q != null) f.Q.value = opt.Q;
  const g = ctx.createGain();
  const atk = opt.atk != null ? opt.atk : NOISE_ATK;
  const peak = Math.max(0.0001, vol);
  safeSet(g.gain, 0.0001, t);
  safeLin(g.gain, peak, t + atk);
  safeExp(g.gain, 0.001, t + Math.max(atk + 0.004, fin(dur, 0.01)));
  s.connect(f); f.connect(g);
  const dest = opt.dest || pumpedBus();
  g.connect(dest);
  if (opt.verbAmt && verbSend) {
    const vg = ctx.createGain();
    vg.gain.value = fin(opt.verbAmt, 0);
    g.connect(vg); vg.connect(verbSend);
  }
  if (opt.smash && smashBus) g.connect(smashBus);
  const st = fin(t, 0);
  try { s.start(st, off); } catch { try { s.start(st); } catch { /* ignore */ } }
  try { s.stop(st + fin(dur, 0.01) + 0.04); } catch { /* ignore */ }
  return g;
}

function bandNoise(t, dur, f0, f1, vol, opt) {
  opt = opt || {};
  const s = ctx.createBufferSource();
  s.buffer = ensureNoiseBuf();
  s.loop = true;
  const off = opt.off != null ? opt.off : brnd() * 1.9;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = opt.Q != null ? opt.Q : 1.2;
  safeSet(f.frequency, Math.max(80, fin(f0, 1000)), t);
  safeExp(f.frequency, Math.max(80, fin(f1, 500)), t + Math.max(0.01, fin(dur, 0.05)));
  const g = ctx.createGain();
  const atk = opt.atk != null ? opt.atk : NOISE_ATK;
  const peak = Math.max(0.0001, fin(vol, 0.1));
  safeSet(g.gain, 0.0001, t);
  safeLin(g.gain, peak, t + atk);
  safeExp(g.gain, 0.001, t + Math.max(atk + 0.006, fin(dur, 0.01)));
  s.connect(f); f.connect(g);
  const dest = opt.dest || pumpedBus();
  g.connect(dest);
  if (opt.verbAmt && verbSend) {
    const vg = ctx.createGain();
    vg.gain.value = opt.verbAmt;
    g.connect(vg); vg.connect(verbSend);
  }
  if (opt.smash && smashBus) g.connect(smashBus);
  const st = fin(t, 0);
  try { s.start(st, off); } catch { try { s.start(st); } catch { /* ignore */ } }
  try { s.stop(st + fin(dur, 0.01) + 0.04); } catch { /* ignore */ }
  return g;
}

// ── phase machine ───────────────────────────────────────────────────
function autoPhaseOf(bar) {
  const c = ((bar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
  if (c < 8) return PHASE_INTRO;
  if (c < 24) return PHASE_GROOVE;
  if (c < 32) return PHASE_BREAKDOWN;
  if (c < 36) return PHASE_BUILD;
  return PHASE_DROP;
}

function autoBarInPhase(bar) {
  const c = ((bar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
  if (c < 8) return c;
  if (c < 24) return c - 8;
  if (c < 32) return c - 24;
  if (c < 36) return c - 32;
  return c - 36;
}

function phaseDuration(name) {
  if (name === PHASE_INTRO) return 8;
  if (name === PHASE_GROOVE) return 16;
  if (name === PHASE_BREAKDOWN) return 8;
  if (name === PHASE_BUILD) return 4;
  if (name === PHASE_DROP) return 16;
  return 16;
}

function nextAfter(name) {
  if (name === PHASE_INTRO) return PHASE_GROOVE;
  if (name === PHASE_GROOVE) return PHASE_BREAKDOWN;
  if (name === PHASE_BREAKDOWN) return PHASE_BUILD;
  if (name === PHASE_BUILD) return PHASE_DROP;
  return PHASE_GROOVE; // drop → groove (spec: cycle)
}

/**
 * Resolve musical phase for absolute bar + six.
 * GAP is the last beat of build bar 3 (six 12–15).
 */
function resolvePhase(bar, six) {
  let name, barIn;
  if (forcedPhase) {
    name = forcedPhase;
    barIn = forcedBarInPhase;
  } else {
    name = autoPhaseOf(bar);
    barIn = autoBarInPhase(bar);
  }
  const isGap = name === PHASE_BUILD && barIn === 3 && six >= 12;
  return { name, barIn, isGap, reportName: name };
}

function emitPhase(name, t) {
  if (name === currentPhaseName) return;
  currentPhaseName = name;
  buildRiserArmed = false;
  for (const cb of phaseListeners) {
    try { cb(name, t); } catch { /* listener fault must not stop audio */ }
  }
}

function barsToDropFrom(bar, six) {
  // During forced build/drop sequences
  if (forcedPhase === PHASE_BUILD) {
    // build has 4 bars; gap is last beat of bar 3
    const barsLeft = 3 - forcedBarInPhase;
    return Math.max(0, barsLeft + (six >= 12 && forcedBarInPhase === 3 ? 0 : 0));
  }
  if (forcedPhase === PHASE_DROP) return 0;
  if (forcedPhase === PHASE_BREAKDOWN) {
    return (7 - forcedBarInPhase) + 4; // rest of break + full build
  }
  if (forcedPhase === PHASE_GROOVE || forcedPhase === PHASE_INTRO) {
    // if armed, drop is ~next bar + 4 build bars
    if (dropArmed) return 1 + 4;
  }

  // Automatic phrase map
  const c = ((bar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
  if (c < 36) {
    // fraction of current bar already consumed doesn't reduce whole-bar count much
    return 36 - c;
  }
  // currently in drop → bars until NEXT drop
  return (PHRASE_BARS - c) + 36;
}

/**
 * Pure bar-boundary transition (mirrors onBarStart, zero side effects).
 * Used by phaseAt to project armed/aborted/forced state into the future.
 * state: { forcedPhase, forcedBarInPhase, forcedAtBar, dropArmed, abortPending }
 * → { name, barIn, state }
 */
function simBarTransition(state, bar) {
  let fp = state.forcedPhase;
  let fbi = state.forcedBarInPhase;
  let fat = state.forcedAtBar;
  let armed = state.dropArmed;
  let abort = state.abortPending;

  if (abort) {
    return {
      name: PHASE_GROOVE,
      barIn: 0,
      state: {
        forcedPhase: PHASE_GROOVE,
        forcedBarInPhase: 0,
        forcedAtBar: bar,
        dropArmed: false,
        abortPending: false,
      },
    };
  }

  if (armed) {
    return {
      name: PHASE_BUILD,
      barIn: 0,
      state: {
        forcedPhase: PHASE_BUILD,
        forcedBarInPhase: 0,
        forcedAtBar: bar,
        dropArmed: false,
        abortPending: false,
      },
    };
  }

  if (fp) {
    if (fat !== bar && fat >= 0) fbi++;
    fat = bar;
    const dur = phaseDuration(fp);
    if (fbi >= dur) {
      const from = fp;
      if (from === PHASE_DROP) {
        fp = null;
        fbi = 0;
        fat = -1;
        // fall through to auto
      } else if (from === PHASE_GROOVE) {
        // abort-forced groove lasts one phase then auto (matches onBarStart)
        fp = null;
        fbi = 0;
        fat = -1;
        // fall through to auto
      } else {
        fp = nextAfter(from);
        fbi = 0;
        return {
          name: fp,
          barIn: 0,
          state: {
            forcedPhase: fp,
            forcedBarInPhase: 0,
            forcedAtBar: bar,
            dropArmed: false,
            abortPending: false,
          },
        };
      }
    } else {
      return {
        name: fp,
        barIn: fbi,
        state: {
          forcedPhase: fp,
          forcedBarInPhase: fbi,
          forcedAtBar: fat,
          dropArmed: false,
          abortPending: false,
        },
      };
    }
  }

  // Automatic 52-bar cycle
  return {
    name: autoPhaseOf(bar),
    barIn: autoBarInPhase(bar),
    state: {
      forcedPhase: null,
      forcedBarInPhase: 0,
      forcedAtBar: -1,
      dropArmed: false,
      abortPending: false,
    },
  };
}

/**
 * Deterministic phase at absolute AudioContext time.
 * Pure · no side effects · O(known forced horizon) then O(1) auto.
 * Returns "groove" when the engine has not started.
 */
function phaseAtAbs(audioTime) {
  if (!started || !Number.isFinite(startTime) || !(BAR > 0) || !(BEAT > 0)) {
    return PHASE_GROOVE;
  }
  const t = Number(audioTime);
  if (!Number.isFinite(t)) return PHASE_GROOVE;

  const since = t - startTime;
  if (since < 0) return PHASE_GROOVE;

  const stepDur = BEAT / 4;
  const targetStep = Math.floor(since / stepDur + 1e-12);
  const targetBar = Math.floor(targetStep / 16);

  // Fast path: pure automatic phrase map, nothing armed/forced
  if (!forcedPhase && !dropArmed && !abortPending) {
    return autoPhaseOf(targetBar);
  }

  // Snapshot of the armed/forced machine at call time
  let st = {
    forcedPhase,
    forcedBarInPhase,
    forcedAtBar,
    dropArmed,
    abortPending,
  };

  // lastPhaseBar already had its transition applied by the scheduler.
  // If nothing scheduled yet, walk from bar 0 with the pristine snapshot.
  let bar0 = lastPhaseBar;
  let name;

  if (bar0 < 0) {
    let r = null;
    for (let b = 0; b <= targetBar; b++) {
      r = simBarTransition(st, b);
      st = r.state;
      name = r.name;
      // Beyond the known forced horizon → automatic cycle
      if (!st.forcedPhase && !st.dropArmed && !st.abortPending && b < targetBar) {
        return autoPhaseOf(targetBar);
      }
    }
    return name || PHASE_GROOVE;
  }

  // Past of the known horizon: auto map (chart gen is forward-looking)
  if (targetBar < bar0) return autoPhaseOf(targetBar);

  // Current bar — state already matches lastPhaseBar
  if (targetBar === bar0) {
    if (st.forcedPhase) return st.forcedPhase;
    return autoPhaseOf(targetBar);
  }

  // Project bar0+1 … targetBar
  for (let b = bar0 + 1; b <= targetBar; b++) {
    const r = simBarTransition(st, b);
    st = r.state;
    name = r.name;
    if (!st.forcedPhase && !st.dropArmed && !st.abortPending && b < targetBar) {
      return autoPhaseOf(targetBar);
    }
  }
  return name || PHASE_GROOVE;
}

// ── track commit ────────────────────────────────────────────────────
function commitTrack(opts) {
  const o = opts || {};
  const interval = Number(o.intervalSec != null ? o.intervalSec : o.interval) || 600;
  trackInterval = interval;

  let bpm = Number(o.bpm);
  if (!Number.isFinite(bpm) || bpm < 100 || bpm > 180) bpm = intervalToBpm(interval);
  // clamp to mainstage band even if caller forces bpm slightly outside
  if (bpm < 120) bpm = 120;
  if (bpm > 136) bpm = 136;
  BPM = bpm | 0;
  BEAT = 60 / BPM;
  BAR = BEAT * 4;

  const hash = typeof o.hash === "string" ? o.hash : "";
  trackSeed = Number.isFinite(Number(o.seed))
    ? (o.seed >>> 0)
    : ([...hash.slice(-16)].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 0) >>> 0) || 1;
  brnd = mulberry32(trackSeed ^ 0x9e3779b9);

  const hClean = hash.toLowerCase().replace(/[^0-9a-f]/g, "");
  NIBBLES = new Array(64);
  for (let i = 0; i < 64; i++) {
    NIBBLES[i] = hClean.length
      ? (parseInt(hClean[i % hClean.length], 16) || 0)
      : ((trackSeed >>> (i % 8)) & 0xf);
  }

  trackRootPc = ROOT_PCS[hashNib(hash, 0) % ROOT_PCS.length];
  const pressure = Number.isFinite(Number(o.pressure))
    ? Math.max(0, Math.min(1, Number(o.pressure)))
    : (() => {
      const med = Number(o.medianFee);
      const fr = o.feeRange;
      const top = Array.isArray(fr) && fr.length ? Number(fr[fr.length - 1]) : med;
      return Number.isFinite(top) ? Math.max(0, Math.min(1, Math.log10(1 + top) / 2.4)) : 0.45;
    })();
  const fullness = Number.isFinite(Number(o.fullness))
    ? Math.max(0, Math.min(1, Number(o.fullness)))
    : Math.max(0, Math.min(1, (Number(o.sizeMB) || 1) / 1.6));
  trackPressure = pressure;
  trackFullness = fullness;

  const slowness = Math.max(0, Math.min(1, (interval - 600) / 1200));
  const fastness = Math.max(0, Math.min(1, (600 - interval) / 420));
  const midPress = 1 - Math.abs(pressure - 0.5) * 2;
  const w = [
    1 + 1.2 * fullness + 0.6 * midPress,
    1 + 1.6 * slowness + 0.5 * fullness,
    1 + 1.4 * (1 - pressure) + 1.0 * fastness,
    1 + 2.0 * pressure + 0.5 * (1 - fullness),
  ];
  const total = w[0] + w[1] + w[2] + w[3];
  const target = ((hashNib(hash, 1) * 16 + hashNib(hash, 2)) / 256) * total;
  let acc = 0, shape = 0;
  for (let i = 0; i < 4; i++) {
    acc += w[i];
    if (target < acc) { shape = i; break; }
    shape = i;
  }
  trackProgShape = shape;
  const chordRot = hashNib(hash, 3) % 4;
  const rawProg = buildProg(trackRootPc, trackProgShape);
  PROG = [0, 1, 2, 3].map((i) => rawProg[(i + chordRot) % 4]);
  PENT_HZ = buildPent(trackRootPc, trackProgShape);
  ROOT_HZ = PROG[0][0];

  trackBassPat = hashNib(hash, 5) % BASS_PATS.length;
  trackLeadPat = hashNib(hash, 6) % LEAD_PATS.length;
  trackPalette = pickPalette(o, pressure, fullness);

  trackKit = kitFromInterval(interval);
  kitParams = KICK_KITS[trackKit];
  trackHalfDrop = false; // big room is always 4-on-floor on the drop
  trackSwing = Math.min(0.08, kitParams.breakSwing);
  trackHatMetalHz = kitParams.hatMetalHz * (0.94 + (hashNib(hash, 7) % 13) / 100);
  trackAnvilHz = kitParams.anvilHz;
  trackClapLayer = kitParams.clapLayer * (pressure > 0.3 ? 1 : 0.7);
  trackPunch = 0.9 + pressure * 0.3;
  trackMetalMix = [0.2, 0.4, 0.55, 0.7][Math.min(3, Math.max(0, Math.round(pressure * 3)))];
  trackGhostDens = 0.25 + fullness * 0.35;
  trackSmashTier = [0.1, 0.16, 0.22, 0.32][Math.min(3, Math.floor(pressure * 4))];

  const pool = String(o.pool || "");
  let poolSeed = 0;
  for (let i = 0; i < pool.length; i++) poolSeed = (Math.imul(poolSeed, 31) + pool.charCodeAt(i)) | 0;
  trackAnvilPartials = (poolSeed >>> 0) % 4;

  const sat = 0.9 + pressure * 1.6;
  if (drumSat) {
    drumSat.curve = satCurve(sat);
    drumSatMakeup.gain.value = 1 / (0.6 + 0.4 * Math.min(2.5, sat));
  }
  if (smashBus) smashBus.gain.value = trackSmashTier;
  if (verbSendGain) verbSendGain.gain.value = 0.5 + trackFullness * 0.15;

  // Radio wants a fixed track BPM — re-apply after configure so the
  // generated intro matches the track before handoff (no tempo lurch).
  if (radioWantBpm != null && (radioState === "loading" || radioState === "on")) {
    retuneBpm(radioWantBpm);
  }
}

commitTrack({ bpm: 128, interval: 600, hash: "0", pressure: 0.45, fullness: 0.55, seed: 1 });

// ── radio mode ──────────────────────────────────────────────────────
/**
 * Retune grid tempo to a track BPM. Uses exact BEAT = 60/bpm so the
 * loop boundary math and author-published grids stay locked.
 * Safe before start; during play only used at the handoff rebase.
 */
function retuneBpm(bpm) {
  const b = Number(bpm);
  if (!Number.isFinite(b) || b < 60 || b > 220) return false;
  BPM = Math.round(b);
  BEAT = 60 / b;
  BAR = BEAT * 4;
  return true;
}

/**
 * Loop points for a produced rhythm track.
 * loopStart = first-downbeat offset; loopEnd = last full BAR boundary
 * before buffer end so the loop never clips mid-bar.
 */
function radioLoopPoints(buffer, offsetSec, bpm) {
  const dur = buffer && Number.isFinite(buffer.duration) ? buffer.duration : 0;
  const beat = 60 / Math.max(60, Number(bpm) || 128);
  const bar = beat * 4;
  let loopStart = Math.max(0, Number(offsetSec) || 0);
  if (!(dur > 0) || !(bar > 0)) {
    return { loopStart: 0, loopEnd: Math.max(0.01, dur) };
  }
  if (loopStart >= dur) loopStart = 0;
  const usable = dur - loopStart;
  let bars = Math.floor(usable / bar + 1e-9);
  if (bars < 1) {
    // buffer shorter than one bar — loop what we can without past-end
    return { loopStart, loopEnd: Math.max(loopStart + 0.01, dur) };
  }
  let loopEnd = loopStart + bars * bar;
  // tiny float guard: never past the decoded buffer
  if (loopEnd > dur + 1e-4) {
    bars = Math.max(1, bars - 1);
    loopEnd = loopStart + bars * bar;
  }
  if (loopEnd <= loopStart) loopEnd = Math.min(dur, loopStart + bar);
  return { loopStart, loopEnd };
}

function stopRadioSource() {
  if (radioSrc) {
    try { radioSrc.onended = null; } catch { /* */ }
    try { radioSrc.stop(0); } catch { /* */ }
    try { radioSrc.disconnect(); } catch { /* */ }
    radioSrc = null;
  }
}

function radioFailSilent() {
  radioState = "off";
  radioTitle = null;
  radioBuffer = null;
  radioWantBpm = null;
  radioPendingStart = false;
  radioHandoffPending = false;
  radioResume = false;
  radioBedSilent = false;
  radioHandoffAt = 0;
  radioBedMuteAt = 0;
  stopRadioSource();
  // Restore generated bed if we had begun fading it for a failed swap
  if (ctx && genBedGain) {
    try {
      safeCancel(genBedGain.gain, ctx.currentTime);
      safeSet(genBedGain.gain, 1, ctx.currentTime);
    } catch { /* */ }
  }
  if (ctx && radioGain) {
    try {
      safeCancel(radioGain.gain, ctx.currentTime);
      safeSet(radioGain.gain, 0.0001, ctx.currentTime);
    } catch { /* */ }
  }
  console.info(RADIO_FAIL_MSG);
}

/**
 * Rebase the musical grid onto the track at the handoff downbeat.
 * Preserves the current step index so chart scheduling stays continuous:
 *   timeOfStep(step) === audibleStart after rebase.
 * Spec form startTime = audibleStart − offsetSec holds when step≈0 / offset=0.
 */
function rebaseGridToRadio(audibleStart, bpm, offsetSec) {
  retuneBpm(bpm);
  const stepDur = BEAT / 4;
  if (!(stepDur > 0) || !Number.isFinite(audibleStart)) return;
  // Keep the in-flight step on this absolute bar boundary
  startTime = audibleStart - step * stepDur;
  // offsetSec is the buffer position of the first downbeat — when non-zero
  // and we're still at session origin, align origin to audible − offset.
  if (step === 0 && offsetSec > 0) {
    startTime = audibleStart - offsetSec;
  }
  nextNote = timeOfStepAbs(step);
}

/**
 * Schedule recorded track start + 1-bar linear crossfade at absolute time tH
 * (must be a generated-bar downbeat). Grid rebases at tH; bed instruments
 * keep sounding under genBedGain for that one bar, then go silent.
 */
function beginRadioAt(tH) {
  if (!ctx || !radioBuffer || !radioGain || !genBedGain) return;
  const bpm = radioWantBpm != null ? radioWantBpm : BPM;
  const off = Math.max(0, Number(radioOffsetSec) || 0);
  const { loopStart, loopEnd } = radioLoopPoints(radioBuffer, off, bpm);
  const bar = (60 / Math.max(60, Number(bpm) || BPM)) * 4;
  const now = ctx.currentTime;
  const t0 = Math.max(tH, now + 0.02);

  stopRadioSource();

  // Crossfade writers: radioGain and genBedGain only (never duckBus / pumpGain)
  safeCancel(radioGain.gain, now);
  safeSet(radioGain.gain, Math.max(0.0001, fin(radioGain.gain.value, 0.0001)), now);
  safeSet(radioGain.gain, 0.0001, t0);
  safeLin(radioGain.gain, RADIO_PEAK, t0 + bar);

  safeCancel(genBedGain.gain, now);
  const genCur = Math.max(0.0001, fin(genBedGain.gain.value, 1));
  safeSet(genBedGain.gain, genCur, now);
  safeSet(genBedGain.gain, genCur, t0);
  safeLin(genBedGain.gain, 0.0001, t0 + bar);

  // Stadium pink bed out — one-shot crowdRoar still hits clip directly
  if (crowdGain) {
    safeCancel(crowdGain.gain, now);
    const cc = Math.max(0.0001, fin(crowdGain.gain.value, 0.0001));
    safeSet(crowdGain.gain, cc, now);
    safeSet(crowdGain.gain, cc, t0);
    safeLin(crowdGain.gain, 0.0001, t0 + bar);
  }

  const src = ctx.createBufferSource();
  src.buffer = radioBuffer;
  src.loop = true;
  src.loopStart = loopStart;
  src.loopEnd = loopEnd;
  src.connect(radioGain);
  try {
    // Start at the first-downbeat offset so the audible attack is on-grid
    src.start(t0, off);
  } catch {
    try { src.start(t0); } catch { /* ignore */ }
  }
  radioSrc = src;

  radioHandoffAt = t0;
  radioBedMuteAt = t0 + bar;
  radioHandoffPending = true;
  radioBedSilent = false;
  radioPendingStart = false;
  radioState = "on"; // track is armed; grid rebases at t0 in tick()
}

function scheduleRadioHandoff() {
  if (!radioBuffer) return;
  if (!started || !ctx) {
    radioPendingStart = true;
    return;
  }
  if (radioHandoffPending && radioSrc) return; // already armed
  if (radioState === "on" && radioSrc && radioBedSilent) return;

  const now = ctx.currentTime;
  const bar = BAR > 0 ? BAR : 1.875;
  // Next full bar downbeat on the CURRENT generated grid (≥ ~40ms ahead)
  let tH;
  if (Number.isFinite(startTime) && bar > 0) {
    const since = Math.max(0, now - startTime);
    const barsAhead = Math.ceil((since + 0.04) / bar - 1e-9);
    tH = startTime + Math.max(1, barsAhead) * bar;
    if (tH < now + 0.04) tH = now + bar;
  } else {
    tH = now + 0.12;
  }
  beginRadioAt(tH);
}

/**
 * Restart a decoded track after stop()/start() resume — full level, no
 * crossfade (generated bed already muted or about to mute).
 */
function resumeRadioImmediate() {
  if (!ctx || !radioBuffer || !radioGain) return;
  const bpm = radioWantBpm != null ? radioWantBpm : BPM;
  const off = Math.max(0, Number(radioOffsetSec) || 0);
  const { loopStart, loopEnd } = radioLoopPoints(radioBuffer, off, bpm);
  const t0 = ctx.currentTime + 0.05;

  stopRadioSource();
  retuneBpm(bpm);

  if (genBedGain) {
    safeCancel(genBedGain.gain, ctx.currentTime);
    safeSet(genBedGain.gain, 0.0001, ctx.currentTime);
  }
  safeCancel(radioGain.gain, ctx.currentTime);
  safeSet(radioGain.gain, RADIO_PEAK, ctx.currentTime);

  const src = ctx.createBufferSource();
  src.buffer = radioBuffer;
  src.loop = true;
  src.loopStart = loopStart;
  src.loopEnd = loopEnd;
  src.connect(radioGain);
  try { src.start(t0, off); } catch { try { src.start(t0); } catch { /* */ } }
  radioSrc = src;

  radioBedSilent = true;
  radioState = "on";
  radioHandoffPending = false;
  radioResume = false;
  // Align grid origin so current step sits on the resume downbeat
  rebaseGridToRadio(t0, bpm, off);
}

// ── crowd bed ───────────────────────────────────────────────────────
// THE CROWD HEARS THE PLAYER (Guitar Hero's crowd-as-judge, adapted).
// The venue's VISUALS already co-sign the run — but the stadium bed was
// keyed only to the music's phase, so a x40 chain and a fumbled groove
// SOUNDED identical. crowdHeat multiplies whatever level the phase asks
// for: a hot streak swells the room, a break drops it to a murmur. The
// hush is the phone-scale boo — no actual boo, ever.
let crowdBase = CROWD_GROOVE;   // the phase's own ask, pre-heat
let crowdHeat = 0;              // 0..1 · fed by the frame loop
function setCrowdLevel(t, level, rampSec) {
  if (!crowdGain) return;
  // Radio mode owns the bed — pink stadium wash stays parked at the floor
  if (radioBedSilent || radioState === "on") return;
  crowdBase = fin(level, CROWD_GROOVE);
  const tt = fin(t, 0);
  const lvl = Math.max(0.0001, crowdBase * (1 + crowdHeat * 0.9));
  const ramp = Math.max(0.02, fin(rampSec, 0.4));
  safeCancel(crowdGain.gain, tt);
  const cur = Math.max(0.0001, fin(crowdGain.gain.value, 0.0001));
  safeSet(crowdGain.gain, cur, tt);
  safeLin(crowdGain.gain, lvl, tt + ramp);
  // slow random wander via setTarget (only crowdGain writes this param)
  safeTarget(crowdGain.gain, lvl * (0.85 + brnd() * 0.3), tt + ramp + 0.5, 1.8);
}

function crowdRoar(t) {
  if (!ctx || !takeVoice(true)) return;
  // noise burst + upward filter sweep + fast decay
  const s = ctx.createBufferSource();
  s.buffer = ensureNoiseBuf();
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 0.7;
  safeSet(f.frequency, 400, t);
  safeExp(f.frequency, 4500, t + 0.35);
  const g = ctx.createGain();
  safeSet(g.gain, 0.0001, t);
  safeLin(g.gain, 0.32, t + 0.02);
  safeExp(g.gain, 0.001, t + 0.55);
  s.connect(f); f.connect(g); g.connect(clip);
  if (verbSend) {
    const vg = ctx.createGain(); vg.gain.value = 0.4;
    g.connect(vg); vg.connect(verbSend);
  }
  try { s.start(t, brnd() * 1.9); } catch { s.start(t); }
  s.stop(t + 0.6);
  // lift the bed to drop peak
  setCrowdLevel(t, CROWD_DROP, 0.08);
}

// ── drums ───────────────────────────────────────────────────────────
/**
 * Big-room kick: pitch 150→45 over ~60ms, click transient, distorted tail.
 * SIDECHAIN → pumpGain ONLY (never duckBus).
 * On drop: duck to 0.25, release ~180ms exponential.
 */
function kick(t, vel, opts) {
  if (!ctx || !kitParams) return;
  opts = opts || {};
  vel = vel == null ? 1 : vel;
  const K = kitParams;
  const punch = trackPunch;
  const onDrop = !!opts.drop;
  const decayMs = Math.min(K.decayMs, 0.8 * BEAT * 1000);

  // 1 · SUB BODY · long tonal pitch envelope
  if (takeVoice(false)) {
    const o = ctx.createOscillator(); o.type = "sine";
    safeSet(o.frequency, K.startHz, t);
    safeExp(o.frequency, K.endHz, t + K.pitchMs / 1000);
    safeExp(o.frequency, K.endHz * 0.94, t + decayMs / 1000);
    const g = ctx.createGain();
    safeSet(g.gain, 0.0001, t);
    safeLin(g.gain, K.subAmp * vel, t + 0.0015);
    safeExp(g.gain, 0.001, t + decayMs / 1000);
    o.connect(g); g.connect(dryBus());
    o.start(t); o.stop(t + decayMs / 1000 + 0.02);
  }

  // 2 · MID PUNCH
  if (takeVoice(false)) {
    const o2 = ctx.createOscillator(); o2.type = "triangle";
    safeSet(o2.frequency, K.punchHz * 2.2, t);
    safeExp(o2.frequency, K.punchHz, t + 0.014);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 950; lp.Q.value = 0.7;
    const g2 = ctx.createGain();
    safeSet(g2.gain, 0.0001, t);
    safeLin(g2.gain, K.punchAmp * vel * punch, t + 0.001);
    safeExp(g2.gain, 0.001, t + K.punchMs / 1000);
    o2.connect(lp); lp.connect(g2); g2.connect(dryBus());
    o2.start(t); o2.stop(t + K.punchMs / 1000 + 0.02);
  }

  // 3 · HF click transient
  if (takeVoice(true)) {
    noiseBurst(t, K.clickMs / 1000, K.clickHP, K.clickAmp * vel * punch, {
      off: brnd() * 1.9, dest: dryBus(), atk: 0.0003,
    });
  }

  // 4 · Distorted tail (wavefolded sine → sat bus)
  if (K.distAmp > 0 && takeVoice(true)) {
    const o = ctx.createOscillator(); o.type = "sine";
    safeSet(o.frequency, K.distHz * 1.4, t);
    safeExp(o.frequency, K.distHz, t + 0.04);
    const sh = ctx.createWaveShaper();
    sh.curve = satCurve(2.4);
    const g = ctx.createGain();
    safeSet(g.gain, 0.0001, t);
    safeLin(g.gain, K.distAmp * vel * 0.55, t + 0.003);
    safeExp(g.gain, 0.001, t + decayMs / 1000 * 0.7);
    o.connect(sh); sh.connect(g); g.connect(dryBus());
    o.start(t); o.stop(t + decayMs / 1000);
  }

  // SIDECHAIN → pumpGain ONLY (single writer — never duckBus).
  // Skip when radio bed is silent (keysound kicks ride sfxBus; no gen bed to pump).
  if (radioBedSilent || !pumpGain) return;
  const dip = onDrop
    ? 0.25
    : Math.max(0.18, fin(K.dip - trackPressure * 0.08, 0.3));
  const rel = onDrop
    ? (K.relMsDrop || 180) / 1000
    : (K.relMs || 170) / 1000;
  const t0 = Math.max(0, fin(t, 0) - 0.006);
  safeCancel(pumpGain.gain, t0);
  const cur = fin(pumpGain.gain.value, 1);
  safeSet(pumpGain.gain, cur, t0);
  safeLin(pumpGain.gain, dip, t);
  // exponential-ish release via setTarget (still only pumpGain writer = kick)
  safeTarget(pumpGain.gain, 1, t + 0.004, Math.max(0.03, rel * 0.38));
}

function snare(t, vel, opts) {
  if (!ctx || !kitParams) return;
  opts = opts || {};
  vel = vel == null ? 1 : vel;
  const K = kitParams;
  const v15 = Math.pow(vel, 1.5);
  let bodyHz = K.bodyHz * (0.97 + trackPressure * 0.1);
  let rattleMs = Math.min(K.rattleMs, 0.62 * BEAT * 1000);
  let sizzle = (opts.sizzle != null ? opts.sizzle : K.sizzle) * (0.7 + trackPressure * 0.7);
  if (opts.rattleScale) rattleMs *= opts.rattleScale;

  if (takeVoice(false)) {
    for (const [mul, amp, dec] of [[1, 0.28, 0.05], [1.48, 0.16, 0.035]]) {
      const o = ctx.createOscillator(); o.type = "triangle";
      safeSet(o.frequency, bodyHz * mul * 1.18, t);
      safeExp(o.frequency, bodyHz * mul, t + 0.018);
      const g = ctx.createGain();
      safeSet(g.gain, 0.0001, t);
      safeLin(g.gain, amp * v15, t + 0.001);
      safeExp(g.gain, 0.001, t + dec);
      o.connect(g); g.connect(pumpedBus());
      if (smashBus && !radioBedSilent) g.connect(smashBus);
      o.start(t); o.stop(t + dec + 0.02);
    }
  }

  if (takeVoice(false)) {
    bandNoise(t, rattleMs / 1000, K.rattleF0, K.rattleF0 * 0.38, 0.4 * v15, {
      off: brnd() * 1.9, Q: 0.9, atk: 0.0015, dest: pumpedBus(),
      verbAmt: 0.22, smash: !radioBedSilent,
    });
  }

  if (sizzle > 0.01 && takeVoice(true)) {
    noiseBurst(t, 0.2, 6500, 0.14 * vel * sizzle * 0.5, {
      off: brnd() * 1.9, dest: pumpedBus(), verbAmt: 0.45,
    });
  }

  if (takeVoice(true)) {
    noiseBurst(t, 0.006, 7000, 0.2 * vel * (opts.transientScale || 1), {
      off: brnd() * 1.9, dest: dryBus(), atk: 0.0003,
    });
  }
}

function ghostSnare(t, vel) {
  snare(t, vel, { sizzle: 0, rattleScale: 0.38, transientScale: 0.55 });
}

function clap(t, vel) {
  if (!ctx) return;
  vel = vel == null ? 1 : vel;
  const bursts = [
    { dt: 0, dur: 0.009, f0: 1200, f1: 1800, g: 0.28, room: false },
    { dt: 0.0085, dur: 0.009, f0: 1250, f1: 1850, g: 0.24, room: false },
    { dt: 0.0175, dur: 0.011, f0: 1300, f1: 1900, g: 0.32, room: false },
    { dt: 0.029, dur: 0.12, f0: 1600, f1: 700, g: 0.2, room: true },
  ];
  for (const b of bursts) {
    if (!takeVoice(true)) break;
    bandNoise(t + b.dt, b.dur, b.f0, b.f1, b.g * vel, {
      off: brnd() * 1.9, Q: 1.6, dest: pumpedBus(),
      verbAmt: b.room ? 0.4 : 0.12, smash: !radioBedSilent,
    });
  }
}

function hatClosed(t, vel, six) {
  if (!takeVoice(true)) return;
  const v15 = Math.pow(vel, 1.5);
  noiseBurst(t, (16 + vel * 20) / 1000, 7200 + vel * 2400, 0.09 * v15, {
    off: brnd() * 1.9, dest: pumpedBus(), atk: 0.0003,
  });
  if (six == null || HAT_V[six] >= 0.55) hatMetal(t, vel, false);
}

function hatOpen(t, vel) {
  if (!takeVoice(true)) return;
  const v15 = Math.pow(vel, 1.5);
  const dur = (90 + vel * 70) / 1000;
  bandNoise(t, dur, 9000, 6000, 0.12 * v15, {
    off: brnd() * 1.9, Q: 1.1, dest: pumpedBus(), verbAmt: 0.28,
  });
  hatMetal(t, vel, true);
}

function hatPedal(t) {
  if (!takeVoice(true)) return;
  noiseBurst(t, 0.026, 4000, 0.06, { off: brnd() * 1.9, dest: pumpedBus() });
}

function hatMetal(t, vel, open) {
  if (trackMetalMix < 0.15 || !takeVoice(true)) return;
  const ratios = [1, 1.4471, 1.617, 1.9265, 2.5028];
  const f0 = trackHatMetalHz;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = open ? 5800 : 7000; hp.Q.value = 0.7;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 10000; bp.Q.value = 0.6;
  const g = ctx.createGain();
  const v15 = Math.pow(vel, 1.5);
  const peak = 0.045 * v15 * trackMetalMix;
  const dec = open ? 0.14 : 0.024;
  safeSet(g.gain, 0.0001, t);
  safeLin(g.gain, peak, t + 0.0004);
  safeExp(g.gain, 0.001, t + dec);
  for (const r of ratios) {
    const o = ctx.createOscillator(); o.type = "square";
    o.frequency.value = f0 * r;
    o.connect(hp);
    o.start(t); o.stop(t + dec + 0.02);
  }
  hp.connect(bp); bp.connect(g); g.connect(pumpedBus());
}

function crash(t, vel) {
  if (!takeVoice(true)) return;
  vel = vel == null ? 1 : vel;
  // bright metallic crash
  bandNoise(t, 1.4, 5000, 1800, 0.28 * vel, {
    off: brnd() * 1.9, Q: 0.55, dest: pumpedBus(), verbAmt: 0.7, smash: !radioBedSilent,
  });
  noiseBurst(t, 0.8, 7000, 0.18 * vel, {
    off: brnd() * 1.9, dest: pumpedBus(), verbAmt: 0.55,
  });
}

function impactSub(t) {
  if (!takeVoice(false)) return;
  // sub-drop impact on drop downbeat
  const o = ctx.createOscillator(); o.type = "sine";
  safeSet(o.frequency, ROOT_HZ * 1.15, t);
  safeExp(o.frequency, ROOT_HZ * 0.45, t + 0.45);
  const g = ctx.createGain();
  safeSet(g.gain, 0.0001, t);
  safeLin(g.gain, 0.7, t + 0.004);
  safeExp(g.gain, 0.001, t + 0.7);
  o.connect(g); g.connect(dryBus());
  o.start(t); o.stop(t + 0.75);
}

function reverseCymbal(t, dur) {
  if (!takeVoice(true)) return;
  const s = ctx.createBufferSource();
  s.buffer = ensureNoiseBuf(); s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 0.75;
  safeSet(f.frequency, 400, t);
  safeExp(f.frequency, 9000, t + dur);
  const g = ctx.createGain();
  safeSet(g.gain, 0.001, t);
  safeLin(g.gain, 0.24, t + dur * 0.95);
  safeLin(g.gain, 0.0001, t + dur + 0.04);
  s.connect(f); f.connect(g); g.connect(pumpedBus());
  if (verbSend) {
    const vg = ctx.createGain(); vg.gain.value = 0.75;
    g.connect(vg); vg.connect(verbSend);
  }
  try { s.start(t, brnd() * 1.9); } catch { s.start(t); }
  s.stop(t + dur + 0.06);
}

/**
 * White-noise riser: LPF 200Hz → 12kHz over dur, gain rising.
 * Pitch riser: saw sweeping ~2 octaves.
 */
function buildRisers(t, dur) {
  if (!ctx) return;
  // noise riser
  if (takeVoice(true)) {
    const s = ctx.createBufferSource();
    s.buffer = ensureNoiseBuf(); s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.Q.value = 0.7;
    safeSet(f.frequency, 200, t);
    safeExp(f.frequency, 12000, t + dur);
    const g = ctx.createGain();
    safeSet(g.gain, 0.001, t);
    safeLin(g.gain, 0.16, t + dur * 0.92);
    safeLin(g.gain, 0.0001, t + dur + 0.05);
    s.connect(f); f.connect(g); g.connect(musicOut());
    if (verbSend) {
      const vg = ctx.createGain();
      // reverb send increases through the build
      safeSet(vg.gain, 0.15, t);
      safeLin(vg.gain, 0.7, t + dur);
      g.connect(vg); vg.connect(verbSend);
    }
    try { s.start(t, brnd() * 1.9); } catch { s.start(t); }
    s.stop(t + dur + 0.08);
  }
  // pitch riser saw · ~2 octaves
  if (takeVoice(true)) {
    const o = ctx.createOscillator(); o.type = "sawtooth";
    const f0 = ROOT_HZ * 2;
    safeSet(o.frequency, f0, t);
    safeExp(o.frequency, f0 * 4, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
    safeSet(lp.frequency, 800, t);
    safeExp(lp.frequency, 6000, t + dur);
    const g = ctx.createGain();
    safeSet(g.gain, 0.01, t);
    safeLin(g.gain, 0.11, t + dur * 0.9);
    safeLin(g.gain, 0.0001, t + dur + 0.04);
    o.connect(lp); lp.connect(g); g.connect(musicOut());
    o.start(t); o.stop(t + dur + 0.08);
  }
}

/**
 * Snare roll density by build bar:
 *   barIn 0 → 8ths · 1 → 16ths · 2 → 32nds · 3 first half → 64ths
 */
function snareRoll(t, six, barIn) {
  const step16 = BEAT / 4;
  if (barIn === 0) {
    // 8th notes
    if (six % 2 === 0) snare(t, 0.45 + (six / 16) * 0.25, { sizzle: 0, rattleScale: 0.4 });
  } else if (barIn === 1) {
    // 16ths
    snare(t, 0.5 + (six / 16) * 0.3, { sizzle: 0, rattleScale: 0.35, transientScale: 0.8 });
  } else if (barIn === 2) {
    // 32nds
    snare(t, 0.55 + (six / 16) * 0.3, { sizzle: 0, rattleScale: 0.3, transientScale: 0.7 });
    snare(t + step16 * 0.5, 0.5 + (six / 16) * 0.28, { sizzle: 0, rattleScale: 0.28, transientScale: 0.65 });
  } else if (barIn === 3 && six < 8) {
    // 64ths on first half of last build bar
    const v = 0.65 + (six / 8) * 0.3;
    snare(t, v, { sizzle: 0, rattleScale: 0.25, transientScale: 0.6 });
    snare(t + step16 * 0.25, v * 0.9, { sizzle: 0, rattleScale: 0.22, transientScale: 0.55 });
    snare(t + step16 * 0.5, v * 0.95, { sizzle: 0, rattleScale: 0.22, transientScale: 0.55 });
    snare(t + step16 * 0.75, v * 0.88, { sizzle: 0, rattleScale: 0.2, transientScale: 0.5 });
  }
  // six >= 12 of barIn 3 = GAP · silence handled by caller
}

function anvil(t, vel, hzMul) {
  if (!takeVoice(false)) return;
  vel = vel == null ? 0.7 : vel;
  const f = trackAnvilHz * (hzMul || 1);
  const parts = ANVIL_PARTIALS[trackAnvilPartials];
  const gains = [0.18, 0.13, 0.09, 0.06, 0.04];
  const decays = [0.7, 0.5, 0.36, 0.25, 0.18];
  const v15 = Math.pow(vel, 1.5);
  for (let i = 0; i < 5; i++) {
    const o = ctx.createOscillator();
    o.type = i < 2 ? "sine" : "triangle";
    o.frequency.value = f * parts[i];
    const g = ctx.createGain();
    const dec = decays[i] * 0.65;
    safeSet(g.gain, 0.0001, t);
    safeLin(g.gain, gains[i] * v15, t + 0.0015);
    safeExp(g.gain, 0.001, t + dec);
    o.connect(g); g.connect(dryBus());
    if (verbSend && i === 0) {
      const vg = ctx.createGain(); vg.gain.value = 0.4;
      g.connect(vg); vg.connect(verbSend);
    }
    o.start(t); o.stop(t + dec + 0.02);
  }
}

// ── THE DROP SOUND ──────────────────────────────────────────────────
/**
 * SUPERSAW LEAD — 7 saws:
 *   5 close-detuned evenly across ±18 cents + center,
 *   + one at -1200¢ and one at +1200¢ for octave body.
 * Lowpass envelope → musicOut (pumped) + reverb send.
 * Stereo width via per-voice pan spread.
 */
function supersaw(t, freq, dur, peak, opts) {
  if (!ctx || !takeVoice(false)) return;
  opts = opts || {};
  const fr = Math.max(40, fin(freq, 220));
  const d = Math.max(0.05, fin(dur, BEAT * 0.45));
  const vol = Math.max(0.001, fin(peak, 0.14));

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 1.1;
  const cut = opts.cut || 2800;
  safeSet(lp.frequency, cut * 1.4, t);
  safeExp(lp.frequency, cut * 0.45, t + d * 0.85);

  const g = ctx.createGain();
  safeSet(g.gain, 0.0001, t);
  safeLin(g.gain, vol, t + 0.008);
  safeSet(g.gain, vol * 0.85, t + d * 0.35);
  safeExp(g.gain, 0.001, t + d);

  // detunes: 5 close (±18) + 2 octaves = 7
  const dets = [-1200, -18, -9, 0, 9, 18, 1200];
  const pans = [-0.55, -0.35, -0.15, 0, 0.15, 0.35, 0.55];
  for (let i = 0; i < 7; i++) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = fr;
    o.detune.value = dets[i];
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pans[i];
      o.connect(panner);
      panner.connect(lp);
    } else {
      o.connect(lp);
    }
    o.start(t); o.stop(t + d + 0.03);
  }
  lp.connect(g); g.connect(musicOut());
  if (verbSend) {
    const vg = ctx.createGain();
    vg.gain.value = opts.verbAmt != null ? opts.verbAmt : 0.35;
    g.connect(vg); vg.connect(verbSend);
  }
}

/** Sub bass sine on offbeat 8ths under the kick */
function subBass(t, freq, dur, peak) {
  if (!takeVoice(true)) return;
  const fr = Math.max(28, Math.min(90, fin(freq, ROOT_HZ)));
  const o = ctx.createOscillator(); o.type = "sine";
  o.frequency.value = fr;
  const g = ctx.createGain();
  safeSet(g.gain, 0.0001, t);
  safeLin(g.gain, fin(peak, 0.42), t + 0.01);
  safeExp(g.gain, 0.001, t + Math.max(0.05, fin(dur, BEAT * 0.4)));
  o.connect(g); g.connect(musicOut());
  o.start(t); o.stop(t + fin(dur, BEAT * 0.45) + 0.02);
}

function comboBodyHz(combo, feeNorm) {
  // THE COMBO IS A LADDER YOU CAN HEAR (operator, on-device 2026-08-02:
  // "a satisfying noise when you slice that gives an audio cue of the
  // combo — maybe the pitch gets higher the longer your combo"). The old
  // version walked a pentatonic but WRAPPED back down every five notes,
  // so a x40 chain sounded like a x5 chain in a different inversion —
  // melody, not accumulation.
  //
  // Now the pitch genuinely CLIMBS: each cut steps up the pentatonic and
  // KEEPS the octave it has earned, rising two full octaves across the
  // first ~25 cuts of a chain and holding a bright plateau above that
  // (an unbounded climb turns into a dog whistle by x60). A break resets
  // the combo, so the next cut audibly starts back at the bottom of the
  // ladder — losing the chain is losing the altitude. The fee tier still
  // colours the voice (whale an octave down = weight, dust an octave up
  // = sparkle) without disturbing the climb itself.
  const pent = PENT_HZ || [220, 261.63, 293.66, 329.63, 392];
  const i = Math.max(0, (combo | 0) - 1);
  const octave = Math.min(2, (i / pent.length) | 0) + Math.min(0.5, Math.max(0, i - 25) * 0.01);
  let f = fin(pent[i % pent.length], 220) * Math.pow(2, octave);
  if (feeNorm >= 0.75) f *= 0.5;
  else if (feeNorm < 0.4) f *= 1.5;
  return fin(Math.min(2200, Math.max(110, f)), 220);
}

function bassStep(t, barIdx, six, level, deg) {
  if (!deg || !PROG) return;
  if (!takeVoice(true)) return;
  const chord = PROG[barIdx % 4];
  const next = PROG[(barIdx + 1) % 4];
  let freq = chord[0] * 2;
  if (deg === 2) freq = chord[0] * 2 * Math.pow(2, 7 / 12);
  else if (deg === 3) freq = chord[0] * 4;
  else if (deg === 4) freq = chord[0] * 2 * Math.pow(2, 10 / 12);
  else if (deg === 5) freq = chord[2];
  else if (deg === 6) freq = chord[0];
  if (six >= 14 && deg === 1) freq = freq * 0.65 + next[0] * 2 * 0.35;

  const dur = (BEAT / 4) * (deg === 3 || deg === 1 ? 1.6 : 1.1);
  const cutBase = [200, 360, 560, 1000, 1800][Math.max(0, Math.min(4, level))];
  const pal = trackPalette;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.Q.value = pal === 3 ? 5 : pal === 0 ? 3.5 : 2.0;
  safeSet(f.frequency, cutBase * (pal === 1 ? 1.35 : 1), t);
  safeLin(f.frequency, cutBase * (0.75 + (six % 5) * 0.06), t + dur * 0.45);
  safeLin(f.frequency, cutBase * 0.85, t + dur);
  const g = ctx.createGain();
  const peak = (pal === 1 ? 0.26 : pal === 3 ? 0.34 : 0.3) * (0.9 + trackPressure * 0.15);
  const atk = pal === 1 ? 0.004 : 0.01;
  safeSet(g.gain, 0.0001, t);
  safeLin(g.gain, peak, t + atk);
  if (pal === 1) safeExp(g.gain, 0.001, t + Math.min(dur, BEAT * 0.35));
  else {
    safeSet(g.gain, peak * 0.85, t + dur * 0.55);
    safeExp(g.gain, 0.001, t + dur);
  }

  if (pal === 0) {
    // supersaw-adjacent bass: 3 detuned saws
    for (const det of [-10, 0, 10]) {
      const o = ctx.createOscillator(); o.type = "sawtooth";
      o.frequency.value = freq; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.02);
    }
  } else if (pal === 1) {
    const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = freq;
    o.connect(f); o.start(t); o.stop(t + dur + 0.02);
  } else if (pal === 2) {
    const car = ctx.createOscillator(); car.type = "sine"; car.frequency.value = freq;
    const mod = ctx.createOscillator(); mod.type = "sine"; mod.frequency.value = freq * 2;
    const modG = ctx.createGain();
    safeSet(modG.gain, freq * (0.8 + level * 0.15), t);
    safeExp(modG.gain, freq * 0.1, t + dur);
    mod.connect(modG); modG.connect(car.frequency);
    car.connect(f); car.start(t); car.stop(t + dur + 0.02);
    mod.start(t); mod.stop(t + dur + 0.02);
  } else {
    for (const det of [-5, 5]) {
      const o = ctx.createOscillator(); o.type = "square";
      o.frequency.value = freq; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.02);
    }
  }
  f.connect(g); g.connect(musicOut());
}

function pad(t, barIdx, level, roomy) {
  if (!PROG || !takeVoice(true)) return;
  const chord = PROG[barIdx % 4];
  const next = PROG[(barIdx + 1) % 4];
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 0.65;
  const open = (600 + level * 320 + (roomy ? 500 : 0)) * (0.9 + trackPressure * 0.12);
  safeSet(f.frequency, open * 0.45, t);
  safeLin(f.frequency, open, t + BAR * 0.5);
  safeLin(f.frequency, open * 0.6, t + BAR);
  const g = ctx.createGain();
  const vol = (roomy ? 0.045 : 0.03) + level * 0.008;
  safeSet(g.gain, 0.0001, t);
  safeLin(g.gain, vol, t + BAR * 0.3);
  safeLin(g.gain, vol * 0.7, t + BAR * 0.85);
  safeLin(g.gain, 0.0001, t + BAR * 1.05);
  for (let vi = 1; vi < chord.length; vi++) {
    for (const det of [-8, 0, 8]) {
      const o = ctx.createOscillator(); o.type = "sawtooth";
      safeSet(o.frequency, chord[vi], t);
      safeSet(o.frequency, chord[vi], t + BAR * 0.88);
      safeExp(o.frequency, Math.max(40, next[vi] || next[1]), t + BAR);
      o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + BAR * 1.05);
    }
  }
  f.connect(g); g.connect(musicOut());
  if (verbSend) {
    const vg = ctx.createGain();
    vg.gain.value = roomy ? 0.55 : 0.22;
    g.connect(vg); vg.connect(verbSend);
  }
}

function motifNote(t, degIdx, level) {
  if (degIdx < 0 || !PENT_HZ || !takeVoice(true)) return;
  const freq = PENT_HZ[degIdx % PENT_HZ.length];
  // lone reverb-drenched motif for breakdown
  supersaw(t, freq, BEAT * 1.2, 0.07 + level * 0.015, { cut: 1800, verbAmt: 0.65 });
}

/**
 * Whisper price-ping: short airy blip walking the BTC close curve.
 * Pitch = 2-octave minor-pentatonic ladder on track root (always consonant).
 * Routed mostly through outdoor reverb · dry is a faint presence only.
 * Level: ~-26 dBFS groove/intro/break · ~-20 drop · silent in BUILD/GAP
 * (caller suppresses those). Optional layer — no-op when priceCurve is null.
 */
function pricePing(t, norm, phase) {
  if (!ctx || !priceCurve || !takeVoice(true)) return;
  const v = Math.max(0, Math.min(1, fin(norm, 0.5)));
  // Map 0..1 → 10 ladder steps (exclusive top so 1.0 seats the top step)
  const idx = Math.max(0, Math.min(PRICE_LADDER - 1, Math.floor(v * PRICE_LADDER * 0.9999)));
  const deg = PRICE_PENT_DEGS[idx % 5];
  const oct = (idx / 5) | 0; // 0 or 1 → two-octave span
  // High airy register (octave 5–6) so it sits above the bass bed
  const freq = midiToHz(pcToMidi((trackRootPc + deg) % 12, 5 + oct));

  let peak = PING_GROOVE;
  if (phase === PHASE_DROP) peak = PING_DROP;
  else if (phase === PHASE_INTRO) peak = PING_GROOVE * 0.7;
  else if (phase === PHASE_BREAKDOWN) peak = PING_GROOVE * 0.9;
  // Radio bed owns the groove — price ping stays at half its generated level
  if (radioState === "on" || radioBedSilent) peak *= 0.5;

  const dur = 0.085;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = Math.max(200, freq);
  bp.Q.value = 2.2;

  const g = ctx.createGain();
  safeSet(g.gain, 0.0001, t);
  safeLin(g.gain, peak, t + 0.006);
  safeExp(g.gain, 0.001, t + dur);

  // Fundamental + faint octave partial for air
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = "sine";
  o2.frequency.value = freq * 2;
  const g2 = ctx.createGain();
  g2.gain.value = 0.28;
  o.connect(bp);
  o2.connect(g2); g2.connect(bp);
  bp.connect(g);

  // Long outdoor reverb owns the voice ("city quietly singing the chart")
  if (verbSend) {
    const vg = ctx.createGain();
    vg.gain.value = 0.9;
    g.connect(vg); vg.connect(verbSend);
  }
  // Tiny dry so it doesn't vanish on dry monitoring / mono phone speakers
  const dry = ctx.createGain();
  dry.gain.value = 0.1;
  g.connect(dry); dry.connect(musicOut());

  try { o.start(t); o.stop(t + dur + 0.04); } catch { /* */ }
  try { o2.start(t); o2.stop(t + dur + 0.04); } catch { /* */ }
}

function pluckNote(t, degIdx, level) {
  if (degIdx < 0 || !PENT_HZ || !takeVoice(true)) return;
  const freq = PENT_HZ[degIdx % PENT_HZ.length];
  const f = ctx.createBiquadFilter();
  f.type = "lowpass"; f.Q.value = 2.5;
  safeSet(f.frequency, 3200, t);
  safeExp(f.frequency, 600, t + 0.18);
  const g = ctx.createGain();
  const peak = 0.07 + level * 0.02;
  safeSet(g.gain, 0.0001, t);
  safeLin(g.gain, peak, t + 0.004);
  safeExp(g.gain, 0.001, t + BEAT * 0.4);
  const o = ctx.createOscillator(); o.type = "triangle";
  o.frequency.value = freq;
  o.connect(f); f.connect(g); g.connect(musicOut());
  o.start(t); o.stop(t + BEAT * 0.45);
  if (verbSend) {
    const vg = ctx.createGain(); vg.gain.value = 0.18;
    g.connect(vg); vg.connect(verbSend);
  }
}

function applyIntensityAtBar(t, nextL) {
  const from = intensity;
  const to = Math.max(0, Math.min(MAX_LAYER, nextL | 0));
  if (from === to || !layerGain) { intensity = to; return; }
  const ampOf = (L) => 0.52 + L * 0.11;
  const a0 = fin(ampOf(from), 0.5), a1 = fin(ampOf(to), 0.5);
  const dur = 0.08;
  const tt = fin(t, 0);
  safeCancel(layerGain.gain, tt);
  safeSet(layerGain.gain, a0, tt);
  safeLin(layerGain.gain, a1, tt + dur);
  if (smashBus) {
    const base = [0, 0.1, 0.16, 0.22, 0.32][to];
    safeSet(smashBus.gain, Math.min(0.45, base + (trackPressure >= 0.8 ? 0.08 : 0)), tt);
  }
  intensity = to;
}

function timeOfStepAbs(n) {
  return startTime + n * (BEAT / 4);
}

function grooveTime(t, six, humanize) {
  let out = t;
  // big room stays mostly straight; light microtiming only
  out += (HAT_MICRO_MS[six] || 0) * 0.001 * (humanize != null ? humanize : 0.6);
  out += (brnd() - 0.5) * 0.002 * (humanize != null ? humanize : 0.6);
  return out;
}

// ── bar-boundary phase transitions ──────────────────────────────────
let lastPhaseBar = -1;
let forcedAtBar = -1;

function onBarStart(bar, t) {
  if (bar === lastPhaseBar) {
    return resolvePhase(bar, 0);
  }
  lastPhaseBar = bar;

  if (abortPending) {
    abortPending = false;
    dropArmed = false;
    forcedPhase = PHASE_GROOVE;
    forcedBarInPhase = 0;
    forcedAtBar = bar;
    emitPhase(PHASE_GROOVE, t);
    setCrowdLevel(t, CROWD_GROOVE, 0.45);
    return resolvePhase(bar, 0);
  }

  if (dropArmed) {
    dropArmed = false;
    forcedPhase = PHASE_BUILD;
    forcedBarInPhase = 0;
    forcedAtBar = bar;
    emitPhase(PHASE_BUILD, t);
    setCrowdLevel(t, CROWD_GROOVE * 1.3, 0.25);
    buildRiserArmed = false;
    return resolvePhase(bar, 0);
  }

  if (forcedPhase) {
    if (forcedAtBar !== bar && forcedAtBar >= 0) {
      forcedBarInPhase++;
    }
    forcedAtBar = bar;

    const dur = phaseDuration(forcedPhase);
    if (forcedBarInPhase >= dur) {
      const from = forcedPhase;
      const nxt = nextAfter(forcedPhase);
      if (from === PHASE_DROP) {
        // finished drop → automatic groove cycle
        forcedPhase = null;
        forcedBarInPhase = 0;
        forcedAtBar = -1;
        const p = resolvePhase(bar, 0);
        emitPhase(p.reportName, t);
        setCrowdLevel(t, CROWD_GROOVE, 0.4);
        return p;
      }
      if (from === PHASE_GROOVE && !dropArmed) {
        // abort-forced groove only lasts one phase then auto
        forcedPhase = null;
        forcedBarInPhase = 0;
        forcedAtBar = -1;
        const p = resolvePhase(bar, 0);
        emitPhase(p.reportName, t);
        return p;
      }
      forcedPhase = nxt;
      forcedBarInPhase = 0;
      emitPhase(nxt, t);
    } else {
      emitPhase(forcedPhase, t);
    }

    const pn = forcedPhase || autoPhaseOf(bar);
    if (pn === PHASE_BUILD) setCrowdLevel(t, CROWD_BUILD_PEAK * (0.45 + forcedBarInPhase * 0.14), BAR * 0.85);
    else if (pn === PHASE_DROP) setCrowdLevel(t, CROWD_DROP, 0.1);
    else if (pn === PHASE_BREAKDOWN) setCrowdLevel(t, CROWD_GROOVE * 0.65, 0.6);
    else setCrowdLevel(t, CROWD_GROOVE, 0.5);

    return resolvePhase(bar, 0);
  }

  const p = resolvePhase(bar, 0);
  emitPhase(p.reportName, t);
  if (p.name === PHASE_BUILD) setCrowdLevel(t, CROWD_BUILD_PEAK * (0.45 + p.barIn * 0.14), BAR * 0.85);
  else if (p.name === PHASE_DROP) setCrowdLevel(t, CROWD_DROP, 0.12);
  else if (p.name === PHASE_BREAKDOWN) setCrowdLevel(t, CROWD_GROOVE * 0.65, 0.6);
  else if (p.name === PHASE_INTRO) setCrowdLevel(t, CROWD_GROOVE * 0.5, 0.8);
  else setCrowdLevel(t, CROWD_GROOVE, 0.5);
  return p;
}

// ── scheduler ───────────────────────────────────────────────────────
function scheduleStep(t, s) {
  voicesThisStep = 0;
  const bar = Math.floor(s / 16);
  const six = s % 16;
  const beatIn = six % 4 === 0;
  const muted = t < muteUntil;
  const ceremonyDrop = t < dropUntil;

  let phaseInfo;
  if (six === 0) phaseInfo = onBarStart(bar, t);
  else phaseInfo = resolvePhase(bar, six);

  const phase = phaseInfo.name;
  const barIn = phaseInfo.barIn;
  const inGap = phaseInfo.isGap;

  // intensity by phase
  if (six === 0 && !muted) {
    let want = pendingIntensity;
    if (phase === PHASE_INTRO) want = Math.min(want, 2);
    if (phase === PHASE_BREAKDOWN) want = Math.min(Math.max(want, 1), 2);
    if (phase === PHASE_BUILD) want = Math.max(want, 2);
    if (phase === PHASE_DROP || ceremonyDrop) want = MAX_LAYER;
    if (phase === PHASE_GROOVE) want = Math.max(want, 1);
    applyIntensityAtBar(t, want);
  }

  let L = muted ? 0 : intensity;
  if (!muted && (phase === PHASE_DROP || ceremonyDrop)) L = Math.max(L, 3);
  if (!muted && ceremonyDrop) L = MAX_LAYER;

  if (beatIn) {
    beatQueue.push({
      time: t, bar, beat: six / 4, level: L,
      section: PHASE_IDX[phase] != null ? PHASE_IDX[phase] : 0,
      sectionName: phase,
      phase,
      barsToDrop: barsToDropFrom(bar, six),
    });
  }

  // ── PRICE PING · once/bar on beat-3 offbeat (six 10) ───────────
  // Advance the curve every bar so the walk stays bar-locked even when
  // BUILD/GAP duck the voice to silence (riser owns that space).
  // Stays LIVE in radio mode (at half level inside pricePing).
  if (six === PING_SIX && priceCurve && priceCurveLen > 0) {
    const pv = priceCurve[priceBarIdx % priceCurveLen];
    priceBarIdx++;
    if (!muted && !inGap && phase !== PHASE_BUILD) {
      pricePing(t, pv, phase);
    }
  }

  // ── RADIO · bed silent after handoff crossfade ─────────────────
  // Phase timeline + beatQueue + price ping already ran. Keep the
  // drop-downbeat ROAR (gameplay punctuation). Everything else generated
  // (kick/bass/lead/build/risers/pads) stays off — the track IS the music.
  // armDrop/abortDrop only move the phase machine (no audio mutation here).
  if (radioBedSilent) {
    if (!muted && phase === PHASE_DROP && barIn === 0 && six === 0) {
      crowdRoar(t);
    }
    return;
  }

  if (muted) return;

  // ── GAP · near silence, reverb tail only ────────────────────────
  if (inGap) {
    // one beat of nothing — reverb continues from prior sends
    return;
  }

  // ── BUILD ───────────────────────────────────────────────────────
  if (phase === PHASE_BUILD) {
    // arm risers once at start of build
    if (barIn === 0 && six === 0 && !buildRiserArmed) {
      buildRiserArmed = true;
      buildRisers(t, BAR * 4 - BEAT); // full 4 bars minus gap beat
      reverseCymbal(t + BAR * 3, BAR * 0.95); // reverse cymbal into drop
    }
    snareRoll(t, six, barIn);
    // filtered kick ghosts on build (very low) except gap
    if (barIn < 3 && six % 4 === 0 && L >= 1) {
      // optional pulse — keep for groove continuity under the roll
      if (barIn === 0) kick(t, 0.35, { drop: false });
    }
    // pad bed under build
    if (six === 0) pad(t, bar, Math.max(L, 2), true);
    // reverb send swell via verbSendGain (single writer here on bar starts)
    if (six === 0 && verbSendGain) {
      const room = 0.55 + barIn * 0.12;
      safeCancel(verbSendGain.gain, t);
      safeSet(verbSendGain.gain, fin(verbSendGain.gain.value, 0.55), t);
      safeLin(verbSendGain.gain, Math.min(0.95, room), t + BAR * 0.9);
    }
    return;
  }

  // ── DROP opener ─────────────────────────────────────────────────
  if (phase === PHASE_DROP && barIn === 0 && six === 0) {
    crash(t, 1);
    impactSub(t);
    crowdRoar(t);
    // open the filter room back a touch after build peak
    if (verbSendGain) {
      safeCancel(verbSendGain.gain, t);
      safeSet(verbSendGain.gain, 0.7, t);
      safeLin(verbSendGain.gain, 0.55, t + BAR);
    }
  }

  // ── KICK ────────────────────────────────────────────────────────
  // BREAKDOWN: no kick. INTRO: thinned. Else 4-on-floor.
  if (L >= 1 && phase !== PHASE_BREAKDOWN) {
    const pat = phase === PHASE_INTRO ? KICK_INTRO : KICK_4OF;
    const kv = pat[six];
    if (kv) kick(t, kv * (six === 0 ? 1 : 0.92), { drop: phase === PHASE_DROP });
  }

  // ── SNARE / CLAP backbeats ──────────────────────────────────────
  if (L >= 2 && phase !== PHASE_BREAKDOWN && phase !== PHASE_INTRO) {
    if (six === 4 || six === 12) {
      snare(t, six === 12 ? 1 : 0.9);
      if (trackClapLayer > 0) clap(t, trackClapLayer * (six === 12 ? 1 : 0.85));
    }
  } else if (phase === PHASE_BREAKDOWN && (six === 4 || six === 12) && L >= 1) {
    // soft rim in breakdown
    ghostSnare(t, 0.2);
  }

  // ── GHOSTS ──────────────────────────────────────────────────────
  if (L >= 2 && phase === PHASE_GROOVE && (six === 3 || six === 7 || six === 11 || six === 15)) {
    if (brnd() < trackGhostDens) ghostSnare(grooveTime(t, six), 0.18 + brnd() * 0.08);
  }

  // ── HATS ────────────────────────────────────────────────────────
  if (L >= 1 && phase !== PHASE_BREAKDOWN) {
    const gt = grooveTime(t, six);
    const v = HAT_V[six] * (phase === PHASE_INTRO ? 0.5 : 1) * (phase === PHASE_DROP ? 1.05 : 1);
    // intro: filtered feel via lower velocity + only even steps
    if (phase === PHASE_INTRO) {
      if (six % 2 === 0) hatClosed(gt, Math.max(0.12, v * 0.7), six);
    } else {
      const open = HAT_OPEN_BASE[six] || (L >= 3 && six === 6);
      if (six % 2 === 0 || L >= 3) {
        if (open && L >= 2) hatOpen(gt, v);
        else if (six % 2 === 0 || L >= 2) hatClosed(gt, Math.max(0.14, v), six);
      }
      if (phase === PHASE_DROP && L >= 4 && six % 2 === 1) {
        hatClosed(grooveTime(t, six), 0.4, six);
      }
    }
  }

  // ── BASS / SUB ──────────────────────────────────────────────────
  if (phase === PHASE_GROOVE || phase === PHASE_DROP) {
    const pat = BASS_PATS[trackBassPat];
    if (L >= 2) {
      const deg = pat[six];
      if (deg && (L >= 3 || six % 2 === 0 || deg === 1)) bassStep(t, bar, six, L, deg);
    }
    // sub on offbeat 8ths under the kick (six 2,6,10,14)
    if (phase === PHASE_DROP && L >= 2 && (six === 2 || six === 6 || six === 10 || six === 14)) {
      const root = PROG ? PROG[bar % 4][0] : ROOT_HZ;
      subBass(t, root, BEAT * 0.4, 0.38 + trackPressure * 0.1);
    }
  } else if (phase === PHASE_BREAKDOWN && (six === 0 || six === 8) && L >= 1) {
    bassStep(t, bar, six, 1, 1);
  }

  // ── PADS ────────────────────────────────────────────────────────
  if (six === 0) {
    if (phase === PHASE_BREAKDOWN) pad(t, bar, Math.max(L, 2), true);
    else if (phase === PHASE_GROOVE || phase === PHASE_DROP) pad(t, bar, L, phase === PHASE_DROP);
    else if (phase === PHASE_INTRO && L >= 1) pad(t, bar, 1, false);
  }

  // ── LEAD / SUPERSAW STABS ───────────────────────────────────────
  if (phase === PHASE_DROP && L >= 3) {
    const d = LEAD_PATS[trackLeadPat][six];
    if (d >= 0 && PENT_HZ) {
      const freq = PENT_HZ[d % PENT_HZ.length] * (six % 8 === 0 ? 1 : 1);
      supersaw(t, freq, BEAT * 0.42, 0.12 + L * 0.02, { cut: 3200 + L * 200, verbAmt: 0.4 });
    }
    // extra chord stab on downbeats
    if (six === 0 && PROG) {
      supersaw(t, PROG[bar % 4][2], BEAT * 0.55, 0.1, { cut: 2600, verbAmt: 0.45 });
    }
  } else if (phase === PHASE_GROOVE && L >= 3) {
    const d = LEAD_PATS[trackLeadPat][six];
    if (d >= 0) pluckNote(t, d, L);
  } else if (phase === PHASE_BREAKDOWN) {
    // lone melodic motif · contour biased by price-curve trend (if set)
    const motif = priceTrendUp ? BREAK_MOTIF : BREAK_MOTIF_DN;
    const d = motif[six];
    if (d >= 0) motifNote(t, d, L);
  }
}

function applyRadioHandoffIfDue(atTime) {
  if (!radioHandoffPending || !(radioHandoffAt > 0)) return;
  if (atTime < radioHandoffAt - 1e-4) return;
  const bpm = radioWantBpm != null ? radioWantBpm : BPM;
  const off = Math.max(0, Number(radioOffsetSec) || 0);
  // Keep the in-flight step index; place it exactly on the handoff downbeat
  // under the track tempo so chart step continuity is preserved.
  rebaseGridToRadio(radioHandoffAt, bpm, off);
  radioHandoffPending = false;
  radioState = "on";
  radioBedSilent = false; // remainder of the crossfade bar still has gen bed
}

function applyRadioBedMuteIfDue(atTime) {
  if (radioState !== "on" || radioBedSilent || !(radioBedMuteAt > 0)) return;
  if (atTime >= radioBedMuteAt - 1e-4) radioBedSilent = true;
}

function tick() {
  if (!ctx || !started) return;
  const horizon = ctx.currentTime + LOOKAHEAD_S;

  while (nextNote < horizon) {
    // Handoff / bed-mute must run inside the loop so a multi-step lookahead
    // never schedules past the boundary on the old grid.
    applyRadioHandoffIfDue(nextNote);
    applyRadioBedMuteIfDue(nextNote);
    const t = timeOfStepAbs(step);
    const st = t < ctx.currentTime ? ctx.currentTime + 0.001 : t;
    scheduleStep(st, step);
    step++;
    nextNote = timeOfStepAbs(step);
  }
  // Catch mute if the scheduler is idle past the deadline (tab throttle etc.)
  applyRadioBedMuteIfDue(ctx.currentTime);
}

// ── public API ──────────────────────────────────────────────────────
/**
 * Feed the player's streak heat into the crowd bed. Throttled: the bed
 * re-schedules only on a meaningful change, so the frame loop can call
 * this every frame without churning the AudioParam timeline.
 */
let _lastAppliedHeat = 0;
function setCrowdHeat(h) {
  const v = Math.max(0, Math.min(1, fin(h, 0)));
  crowdHeat = v;
  if (!ctx || !crowdGain) return;
  if (Math.abs(v - _lastAppliedHeat) < 0.08) return;
  _lastAppliedHeat = v;
  setCrowdLevel(ctx.currentTime, crowdBase, 0.8);
}

/**
 * A real chain died. One soft synthesized exhale — a falling band of
 * breath, not a boo — and the bed drops to a murmur before recovering
 * to whatever the phase wants over a couple of seconds. Radio mode's
 * bed is parked, so this no-ops there like every other bed write.
 */
function crowdBreath() {
  if (!ctx || !crowdGain) return;
  crowdHeat = 0;
  _lastAppliedHeat = 0;
  const t = ctx.currentTime;
  if (!(radioBedSilent || radioState === "on")) {
    // the murmur: duck the bed hard, then let the phase level pull it back
    safeCancel(crowdGain.gain, t);
    const cur = Math.max(0.0001, fin(crowdGain.gain.value, 0.0001));
    safeSet(crowdGain.gain, cur, t);
    safeLin(crowdGain.gain, Math.max(0.0001, crowdBase * 0.4), t + 0.12);
    safeLin(crowdGain.gain, Math.max(0.0001, crowdBase), t + 2.2);
  }
  // the exhale · downward sweep, quiet, once
  noiseBurst(t, 0.5, 900, 0.12, { off: brnd() * 1.9, dest: clip });
}

export const Music = {
  setCrowdHeat,
  crowdBreath,
  /**
   * QA/capture only: a MediaStream carrying the FULL game mix (music +
   * SFX, post-limiter). Lets a recorder capture real gameplay audio
   * without touching the graph's single-writer discipline — the tap is
   * an extra READER on the master, never a writer.
   */
  tapForCapture() {
    if (!ctx) return null;
    // master (post-compressor) so the capture hears the SAME mix the
    // player does; clip alone is pre-limiter and runs hot
    const src = (typeof master !== "undefined" && master) || clip;
    if (!src) return null;
    const dest = ctx.createMediaStreamDestination();
    src.connect(dest);
    return dest.stream;
  },
  configure(opts) {
    commitTrack(opts || {});
    configDirty = true;
    // reset phrase machine on new block track
    dropArmed = false;
    abortPending = false;
    forcedPhase = null;
    forcedBarInPhase = 0;
    forcedAtBar = -1;
    lastPhaseBar = -1;
    currentPhaseName = PHASE_INTRO;
    buildRiserArmed = false;
    return this.info();
  },

  /**
   * RADIO MODE — primary music path. Fetch + decode a same-origin produced
   * track; generated engine is the instant-start layer and offline fallback.
   * Call after configure(), before start() so the intro retunes to track BPM.
   * Never throws. Failure → generated keeps playing (one console.info).
   *
   * @param {string} url same-origin audio URL (m4a / AAC-LC preferred)
   * @param {{bpm?:number, offsetSec?:number, title?:string}} [opts]
   */
  radio(url, opts) {
    opts = opts || {};
    const bpm = Number(opts.bpm);
    const offsetSec = Number(opts.offsetSec);
    const title = typeof opts.title === "string" ? opts.title : null;

    if (!url || typeof url !== "string") {
      radioFailSilent();
      return this;
    }

    // Cancel any in-flight load / prior source
    radioLoadGen++;
    const gen = radioLoadGen;
    stopRadioSource();
    radioBuffer = null;
    radioHandoffPending = false;
    radioPendingStart = false;
    radioBedSilent = false;
    radioResume = false;
    radioBedMuteAt = 0;
    radioHandoffAt = 0;

    radioState = "loading";
    radioTitle = title;
    radioWantBpm = Number.isFinite(bpm) && bpm >= 60 && bpm <= 220 ? bpm : null;
    radioOffsetSec = Number.isFinite(offsetSec) && offsetSec >= 0 ? offsetSec : 0;

    // Retune generated intro BEFORE start so handoff never tempo-lurches.
    // Mid-session loads wait for the bar-boundary rebase (no mid-bar BPM jump).
    if (radioWantBpm != null && !started) {
      retuneBpm(radioWantBpm);
    }

    // Restore gen bed if we were already in radio (new track swap)
    if (ctx && genBedGain && radioState === "loading") {
      try {
        safeCancel(genBedGain.gain, ctx.currentTime);
        safeSet(genBedGain.gain, 1, ctx.currentTime);
      } catch { /* */ }
    }
    if (ctx && radioGain) {
      try {
        safeCancel(radioGain.gain, ctx.currentTime);
        safeSet(radioGain.gain, 0.0001, ctx.currentTime);
      } catch { /* */ }
    }

    let ac;
    try {
      ac = ensureAudio();
    } catch {
      radioFailSilent();
      return this;
    }

    // Fire-and-forget fetch · never rejects to caller.
    // decodeAudioData: promise + callback form (Safari/iOS).
    Promise.resolve()
      .then(() => fetch(url, { credentials: "same-origin", mode: "same-origin" }))
      .then((res) => {
        if (!res || !res.ok) throw new Error("http " + (res && res.status));
        return res.arrayBuffer();
      })
      .then((ab) => {
        if (gen !== radioLoadGen) return null;
        // decodeAudioData may detach the buffer — pass a copy
        const copy = ab.slice(0);
        return new Promise((resolve, reject) => {
          let settled = false;
          const ok = (b) => { if (!settled) { settled = true; resolve(b); } };
          const bad = (e) => { if (!settled) { settled = true; reject(e || new Error("decode")); } };
          try {
            const p = ac.decodeAudioData(copy, ok, bad);
            if (p && typeof p.then === "function") p.then(ok, bad);
          } catch (e) { bad(e); }
        });
      })
      .then((buf) => {
        if (gen !== radioLoadGen) return;
        if (!buf || !(buf.duration > 0.25)) throw new Error("empty buffer");
        radioBuffer = buf;
        scheduleRadioHandoff();
      })
      .catch(() => {
        if (gen !== radioLoadGen) return;
        radioFailSilent();
      });

    return this;
  },

  /** "off" | "loading" | "on" */
  radioState() {
    return radioState;
  },

  info() {
    const shapes = ["iron-vamp", "descent", "hollow", "phrygian-gate"];
    return {
      bpm: BPM,
      root: ROOT_NAMES[ROOT_PCS.indexOf(trackRootPc)] || "A",
      rootPc: trackRootPc,
      progression: shapes[trackProgShape] || "iron-vamp",
      palette: PALETTE_NAMES[trackPalette] || "supersaw",
      kit: KIT_NAMES[trackKit] || "STEEL",
      swing: Math.round(trackSwing * 100) / 100,
      halfDrop: trackHalfDrop,
      bassPat: trackBassPat,
      leadPat: trackLeadPat,
      pressure: Math.round(trackPressure * 100) / 100,
      metal: Math.round(trackMetalMix * 100) / 100,
      // new mainstage fields
      phase: currentPhaseName,
      genre: "mainstage-house",
      phraseBars: PHRASE_BARS,
      // radio HUD
      radio: radioTitle,
      radioState,
    };
  },

  bpm() { return BPM; },

  start() {
    ensureAudio();
    if (ctx.state === "suspended") ctx.resume();
    attractStop(); // the boot-screen bed always yields to a real session
    if (started && !configDirty) return;
    if (schedTimer) clearInterval(schedTimer);

    const resuming = hasSession && !configDirty;
    configDirty = false;
    started = true;
    hasSession = true;

    if (resuming) {
      const lead = 0.04;
      startTime = ctx.currentTime + lead - Math.max(0, pauseElapsed);
      const stepDur = BEAT / 4;
      step = Math.max(0, Math.ceil((ctx.currentTime + 0.01 - startTime) / stepDur - 1e-9));
      nextNote = timeOfStepAbs(step);
      dropUntil = dropRemain > 0 ? ctx.currentTime + lead + dropRemain : 0;
      muteUntil = muteRemain > 0 ? ctx.currentTime + lead + muteRemain : 0;
      beatQueue.length = 0;
      lastPhaseBar = -1;
    } else {
      startTime = ctx.currentTime + 0.1;
      step = 0;
      nextNote = timeOfStepAbs(0);
      dropUntil = 0;
      muteUntil = 0;
      pauseElapsed = 0;
      dropRemain = 0;
      muteRemain = 0;
      beatQueue.length = 0;
      lastPhaseBar = -1;
      forcedPhase = null;
      forcedBarInPhase = 0;
      forcedAtBar = -1;
      dropArmed = false;
      abortPending = false;
      currentPhaseName = PHASE_INTRO;
      buildRiserArmed = false;
      // Fresh session: restore gen bed unless radio will mute it
      if (genBedGain && !radioResume) {
        genBedGain.gain.cancelScheduledValues(ctx.currentTime);
        genBedGain.gain.setValueAtTime(1, ctx.currentTime);
      }
      if (crowdGain && !radioBedSilent && radioState !== "on") {
        setCrowdLevel(ctx.currentTime + 0.1, CROWD_GROOVE * 0.5, 1.2);
      }
    }

    if (layerGain) {
      const ampOf = (L) => 0.52 + L * 0.11;
      layerGain.gain.cancelScheduledValues(ctx.currentTime);
      layerGain.gain.setValueAtTime(ampOf(intensity), ctx.currentTime);
    }
    // reset pumps — single set, no competing writers
    if (pumpGain) pumpGain.gain.setValueAtTime(1, ctx.currentTime);
    if (duckBus) duckBus.gain.setValueAtTime(1, ctx.currentTime);
    schedTimer = setInterval(tick, TICK_MS);

    // Radio: buffer already decoded while waiting for gesture, or resume
    if (radioResume && radioBuffer) {
      resumeRadioImmediate();
    } else if (radioPendingStart && radioBuffer) {
      scheduleRadioHandoff();
    }
  },

  stop() {
    if (started && ctx) {
      pauseElapsed = Math.max(0, ctx.currentTime - startTime);
      dropRemain = dropUntil > ctx.currentTime ? dropUntil - ctx.currentTime : 0;
      muteRemain = muteUntil > ctx.currentTime ? muteUntil - ctx.currentTime : 0;
      hasSession = true;
    }
    // Freeze recorded source; keep buffer so start() can resume
    if (radioState === "on" || (radioState === "loading" && radioBuffer)) {
      radioResume = radioState === "on" || radioBedSilent;
      stopRadioSource();
      radioHandoffPending = false;
    }
    if (schedTimer) clearInterval(schedTimer);
    schedTimer = null;
    started = false;
  },

  now() { return heardTime(); },
  audioNow() { return ctx ? ctx.currentTime : 0; },
  latency() { return latencyOffset(); },

  /**
   * Feed one cut's SIGNED timing error, in seconds, as the player
   * experienced it: (whenTheyCut - whenTheBeatWas) on the heard clock.
   * Positive means they were late by our current reckoning.
   *
   * We never trust one sample — a single cut is mostly human scatter.
   * We keep a rolling window and use the MEDIAN, because that is the
   * statistic that separates the two error sources: a player's own
   * timing noise is roughly symmetric about their intent and cancels,
   * while device latency is a constant shift that does not. An outlier
   * (a panic swipe, a note they nearly missed) moves a mean and barely
   * moves a median, which is the whole reason for the choice.
   *
   * Returns the newly adopted bias when one is adopted, else null.
   */
  observeTiming(dtSigned) {
    return calibrator.observe(dtSigned) == null ? null : latencyOffset();
  },

  /** Current calibration state, for the settings readout and the teach line. */
  calibration() {
    return {
      totalMs: Math.round(latencyOffset() * 1000),
      apiMs: Math.round(apiLatency() * 1000),
      biasMs: Math.round(calibrator.bias * 1000),
      measured: calibrator.measured,
      samples: calibrator.sampleCount,
      // true when the engine refused to tell us and we are running on the
      // stated guess plus whatever calibration has learned
      apiIsGuess: !(ctx && typeof ctx.outputLatency === "number"
        && Number.isFinite(ctx.outputLatency) && ctx.outputLatency > 0),
    };
  },

  /** Restore a persisted bias (localStorage) so run 2 starts calibrated. */
  setLatencyBias(sec) {
    if (Number.isFinite(sec)) calibrator.setBias(sec);
  },

  /** Manual override from the calibration screen, in milliseconds. */
  setTotalLatencyMs(ms) {
    if (Number.isFinite(ms)) calibrator.setBias(ms / 1000 - apiLatency());
  },

  resetCalibration() { calibrator.reset(); },

  setIntensity(n) {
    pendingIntensity = Math.max(0, Math.min(MAX_LAYER, n | 0));
    if (!started) intensity = pendingIntensity;
  },

  /** Numeric section index (0 intro · 1 groove · 2 breakdown · 3 build · 4 drop) */
  section() {
    return PHASE_IDX[currentPhaseName] != null ? PHASE_IDX[currentPhaseName] : 0;
  },

  /**
   * Request: enter BUILD at the next bar boundary.
   * Drop lands 4 bars later as a REWARD. Default auto phrase runs when unused.
   * In radio mode this only moves the phase timeline (visuals + chart density);
   * it does not change the recorded bed.
   */
  armDrop() {
    abortPending = false;
    dropArmed = true;
  },

  /**
   * Abort an armed/in-progress build back to groove at the next bar boundary.
   * Call on a bad miss so the drop is earned, not free.
   */
  abortDrop() {
    dropArmed = false;
    if (currentPhaseName === PHASE_BUILD || currentPhaseName === PHASE_DROP) {
      abortPending = true;
    } else {
      abortPending = true; // still forces groove next bar
    }
  },

  /** Current phase name for visuals */
  phase() {
    return currentPhaseName;
  },

  /**
   * Deterministic phase lookup at an absolute AudioContext time.
   * Pure (no side effects), cheap, safe to call per scheduled note.
   * Honour armed/aborted/forced state known at call time; beyond that
   * horizon assume the automatic 52-bar cycle. Returns "groove" when
   * the engine has not started.
   * @returns {"intro"|"groove"|"breakdown"|"build"|"drop"}
   */
  phaseAt(audioTime) {
    return phaseAtAbs(audioTime);
  },

  /**
   * Optional BTC close curve for the whisper price-ping layer + breakdown
   * motif trend bias. `norm` = ~30–90 floats in [0,1], oldest first
   * (caller min/max-normalizes daily closes). Never-called → layer absent,
   * engine behaves exactly as before. Invalid/empty input clears the layer.
   */
  setPriceCurve(norm) {
    if (!Array.isArray(norm) || norm.length < 2) {
      priceCurve = null;
      priceCurveLen = 0;
      priceBarIdx = 0;
      priceTrendUp = true; // restore default ascending motif contour
      return;
    }
    const arr = [];
    for (let i = 0; i < norm.length; i++) {
      const n = Number(norm[i]);
      if (!Number.isFinite(n)) continue;
      arr.push(Math.max(0, Math.min(1, n)));
    }
    if (arr.length < 2) {
      priceCurve = null;
      priceCurveLen = 0;
      priceBarIdx = 0;
      priceTrendUp = true;
      return;
    }
    priceCurve = arr;
    priceCurveLen = arr.length;
    priceBarIdx = 0;

    // Trend bias: last quarter mean vs first quarter mean
    const q = Math.max(1, (arr.length / 4) | 0);
    let first = 0;
    let last = 0;
    for (let i = 0; i < q; i++) first += arr[i];
    for (let i = arr.length - q; i < arr.length; i++) last += arr[i];
    first /= q;
    last /= q;
    priceTrendUp = last >= first;
  },

  /** Whole bars until the next drop downbeat (0 if currently in drop) */
  barsToDrop() {
    if (!started) return 36;
    const since = Math.max(0, heardTime() - startTime);
    const bar = Math.floor(since / BAR);
    const six = Math.floor((since / (BEAT / 4)) % 16);
    return barsToDropFrom(bar, six);
  },

  /** Subscribe to phase changes. cb(phaseName, audioTime). Returns unsubscribe. */
  onPhase(cb) {
    if (typeof cb !== "function") return () => {};
    phaseListeners.push(cb);
    return () => {
      phaseListeners = phaseListeners.filter((f) => f !== cb);
    };
  },

  nextBeatTime(after) {
    if (!started) return after + BEAT;
    const since = Math.max(0, after - startTime);
    return startTime + Math.ceil(since / BEAT - 1e-6) * BEAT;
  },

  beatLen() { return BEAT; },
  barLen() { return BAR; },
  timeOfStep(n) { return timeOfStepAbs(n); },
  stepNow() {
    if (!started) return 0;
    return (heardTime() - startTime) / (BEAT / 4);
  },
  stepsPerBar() { return 16; },
  started() { return started; },
  maxLayer() { return MAX_LAYER; },

  beatPhase() {
    if (!ctx || !started) return 0;
    const since = Math.max(0, heardTime() - startTime);
    return (since / BEAT) % 1;
  },

  drainBeats(now) {
    const out = [];
    const tt = now != null ? now : heardTime();
    while (beatQueue.length && beatQueue[0].time <= tt) out.push(beatQueue.shift());
    return out;
  },

  ceremony(big) {
    if (!ctx || !started) return { dropAt: 0 };
    const t = ctx.currentTime;
    const dur = big ? BAR * 2 : BAR;
    buildRisers(t, dur);
    reverseCymbal(t, dur * 0.95);

    const dropAt = this.nextBeatTime(t + dur);
    muteUntil = dropAt;
    dropUntil = dropAt + BAR * 8;
    pendingIntensity = MAX_LAYER;

    // force drop phase for ceremony window
    forcedPhase = PHASE_DROP;
    forcedBarInPhase = 0;
    forcedAtBar = -1;

    kick(dropAt, 1.2, { drop: true });
    crash(dropAt, 1);
    impactSub(dropAt);
    crowdRoar(dropAt);
    if (PROG) supersaw(dropAt, PROG[0][2], BEAT * 0.8, 0.16, { cut: 3600, verbAmt: 0.5 });
    return { dropAt };
  },

  bell() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const base = PENT_HZ ? PENT_HZ[0] : 261.6;
    const partials = [
      [base, 0.45, 3.0],
      [base * (PENT_HZ ? PENT_HZ[1] / PENT_HZ[0] : 1.25), 0.3, 2.6],
      [base * (PENT_HZ ? PENT_HZ[2] / PENT_HZ[0] : 1.5), 0.26, 2.4],
      [base * 2, 0.18, 2.0],
    ];
    for (const [fr, vol, dec] of partials) {
      const o = ctx.createOscillator(); o.frequency.value = fr;
      const g = ctx.createGain();
      safeSet(g.gain, vol, t);
      safeExp(g.gain, 0.001, t + dec);
      o.connect(g); g.connect(verbSend); g.connect(duckBus);
      o.start(t); o.stop(t + dec + 0.1);
    }
  },
};

// ── grid quantize + keysound roles ──────────────────────────────────
// ── THE POCKET, GUARANTEED (operator, 2026-08-05: "the noise of all of
// the perfect block swipes should be in sync with the beat of the song
// ... this is kinda the whole premise") ──────────────────────────────
//
// The old quantizer rounded to the NEAREST gridline and, when that line
// had already passed — which is MOST of the time, because touch input
// reaches us 30-110ms after the finger and the player is aiming at the
// heard beat, itself output-latency after the scheduled one — it fell
// back to raw ctx.currentTime: no quantization at all. So the musical
// voice of a cut landed at a random 30-150ms offset on no subdivision,
// and the rest snapped to whichever line happened to be nearest, own
// beat or not. Measured (createOscillator start-time probe over a real
// autoplayed run, human-late cuts): pre-fix 40/60 chime starts on a
// gridline with the misses scattered 13-60ms off; post-fix 56/61, the
// residue being pre-handoff chimes measured against the rebased grid.
//
// The contract now:
//   1. A cut that arrives EARLY enough gets its note's OWN line — the
//      chime sounds exactly on the beat the cube was charted on.
//   2. Everything else gets the NEXT 16th line — always a real
//      subdivision of the actual song, never a raw offset. A 12ms grace
//      keeps a line we missed by less than perception.
//   3. There is no unquantized fallback. The click/thock/seat stack is
//      the immediate tactile answer; the TONAL layers are the band, and
//      the band only ever plays in the pocket.
function quantizeToSixteenth(tAudio, stepAbs) {
  if (!ctx) return fin(tAudio, 0);
  if (!started || !Number.isFinite(startTime) || !Number.isFinite(tAudio)) {
    return fin(ctx.currentTime, 0);
  }
  const stepDur = fin(BEAT / 4, 0.1);
  if (!(stepDur > 0)) return fin(ctx.currentTime, 0);
  // 1 · the note's own beat, when it is still schedulable
  if (Number.isFinite(stepAbs)) {
    const own = startTime + stepAbs * stepDur;
    if (Number.isFinite(own) && own > tAudio + 0.001) return own;
  }
  // 2 · the next line (12ms grace for a line only just missed)
  const k = Math.ceil((tAudio - startTime - 0.012) / stepDur);
  if (!Number.isFinite(k)) return fin(ctx.currentTime, 0);
  const qt = startTime + k * stepDur;
  if (!Number.isFinite(qt)) return fin(ctx.currentTime, 0);
  return qt > tAudio + 0.0005 ? qt : qt + stepDur;
}

function roleFromSix(six) {
  const s = ((six % 16) + 16) % 16;
  if (s === 0 || s === 8) return "downbeat";
  if (s === 4 || s === 12) return "backbeat";
  if (s % 2 === 0) return "eighth";
  return "accent";
}

function resolveChopPos(pos, tAudio) {
  let six = null;
  let stepAbs = null;
  if (pos && Number.isFinite(Number(pos.step))) {
    stepAbs = Math.round(Number(pos.step));
    six = ((stepAbs % 16) + 16) % 16;
  } else if (pos && Number.isFinite(Number(pos.six))) {
    six = ((Number(pos.six) % 16) + 16) % 16;
  } else if (started && Number.isFinite(startTime)) {
    const stepDur = BEAT / 4;
    stepAbs = Math.round((tAudio - startTime) / stepDur);
    six = ((stepAbs % 16) + 16) % 16;
  }
  const role = (pos && typeof pos.role === "string" && pos.role)
    ? pos.role
    : (six != null ? roleFromSix(six) : "eighth");
  return { six, stepAbs, role };
}

function keysoundAt(tQ, role, feeNorm) {
  if (!ctx || !kitParams) return;
  const heavy = feeNorm >= 0.75;
  const thin = feeNorm < 0.4;
  const saved = voicesThisStep;
  voicesThisStep = Math.min(voicesThisStep, Math.max(0, MAX_VOICES_PER_STEP - 12));
  try {
    if (role === "downbeat") {
      kick(tQ, thin ? 0.55 : heavy ? 0.9 : 0.7, { drop: currentPhaseName === PHASE_DROP });
    } else if (role === "backbeat") {
      snare(tQ, thin ? 0.5 : heavy ? 0.88 : 0.7, {
        sizzle: heavy ? 0.16 : 0.08,
        rattleScale: 0.75,
      });
      if (trackClapLayer > 0) clap(tQ, trackClapLayer * (heavy ? 0.85 : 0.55));
    } else if (role === "eighth") {
      hatClosed(tQ, thin ? 0.55 : heavy ? 0.95 : 0.75, 0);
    } else {
      ghostSnare(tQ, thin ? 0.25 : 0.35);
    }
  } finally {
    voicesThisStep = saved;
  }
}

/**
 * THE CLICKY CUT · premium mechanical keyswitch acoustics (Web Audio).
 *
 * Signal chain (all → sfxBus → clip → comp → master; bed ducked via duckBus):
 *   a) CLICK     · t+0ms      · 2–4ms white noise · HP ~2.5kHz · sharp LINEAR decay
 *   b) THOCK     · t+0ms      · 90–150Hz sine · 25–40ms · exp decay · fee-tier pitch
 *   b2) SEAT     · t+0ms      · 55–75Hz sine · 30ms · exp decay · ~0.5 thock gain
 *                 · bottom-out weight · pitched DOWN with fee tier (whale lowest)
 *   c) SNAP-BACK · t+55–70ms  · tiny second click · −14dB rel · the switch releasing
 *   d) BODY      · tQ (16th)  · detuned triangle pent climb · combo melody (quantized)
 *   e) MILESTONE · tQ         · every 5th combo · short ascending sparkle on top
 *   f) KEYSOUND  · tQ         · grid role kick/snare/hat layer into the bed
 *
 * CLICK + THOCK + SEAT + SNAP fire IMMEDIATELY (never quantized) so the finger
 * feels the snap before the tonal body locks to the grid. Whole clicky
 * stack <90ms. Per-layer ±3% pitch / ±10% level; noise voices use random
 * buffer offsets. Peaks staged so 3 cuts within 100ms don't clip the
 * soft-clipper (sfxBus rides the same clip+comp chain as the bed).
 * duckBus single-writer: only the SFX duck block writes it.
 */
export function chopSfx(feeNorm, combo, pos) {
  if (!ctx) return;
  ensureAudio();
  const t = ctx.currentTime;
  const thin = feeNorm < 0.4;
  const heavy = feeNorm >= 0.75;
  const pitch = comboBodyHz(combo, feeNorm);
  // resolve BEFORE quantizing: the note's own step is what lets an early
  // cut land its chime exactly on its own charted beat
  const { role, stepAbs } = resolveChopPos(pos, t);
  const tQ = quantizeToSixteenth(t, stepAbs);

  // Per-layer variance · ±3% pitch · ±10% level (never machine-stamped)
  const pVar = () => 1 + (brnd() - 0.5) * 0.06;
  const lVar = () => 1 + (brnd() - 0.5) * 0.2;

  // ── a) CLICK · the snap the finger hears first · IMMEDIATE ─────────
  // 2–4ms white-noise burst · highpass ~2.5kHz · sharp LINEAR decay · modest
  const clickPeak = (thin ? 0.15 : heavy ? 0.24 : 0.19) * lVar();
  {
    const dur = 0.002 + brnd() * 0.002; // 2–4ms
    const s = ctx.createBufferSource();
    s.buffer = ensureNoiseBuf();
    s.loop = true;
    const off = brnd() * 1.9;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = fin(2500 * pVar(), 2500);
    f.Q.value = 0.7;
    const g = ctx.createGain();
    safeSet(g.gain, 0.0001, t);
    safeLin(g.gain, Math.max(0.0001, clickPeak), t + 0.00025);
    safeLin(g.gain, 0.0001, t + dur); // sharp linear decay (not exp)
    s.connect(f); f.connect(g); g.connect(sfxBus);
    const st = fin(t, 0);
    try { s.start(st, off); } catch { try { s.start(st); } catch { /* */ } }
    try { s.stop(st + dur + 0.008); } catch { /* */ }
  }

  // ── b) THOCK · weight of the switch bottoming out · IMMEDIATE ──────
  // ~90–150Hz sine · 25–40ms · fast exp decay · whale = deeper
  const thockPeak = (thin ? 0.13 : heavy ? 0.24 : 0.18) * lVar();
  {
    const baseHz = heavy ? 92 : thin ? 145 : 118;
    const hz = fin(baseHz * pVar(), baseHz);
    const dur = heavy ? 0.036 + brnd() * 0.004 : thin ? 0.025 + brnd() * 0.004 : 0.03 + brnd() * 0.005;
    const peak = thockPeak;
    const o = ctx.createOscillator();
    o.type = "sine";
    safeSet(o.frequency, hz, t);
    // slight pitch settle as the housing absorbs energy
    safeExp(o.frequency, Math.max(40, hz * 0.9), t + dur);
    const g = ctx.createGain();
    safeSet(g.gain, 0.0001, t);
    safeLin(g.gain, Math.max(0.0001, peak), t + 0.0007);
    safeExp(g.gain, 0.001, t + dur);
    o.connect(g); g.connect(sfxBus);
    const st = fin(t, 0);
    try { o.start(st); } catch { /* */ }
    try { o.stop(st + dur + 0.02); } catch { /* */ }
  }

  // ── b2) SEAT · sub-weight under the thock · premium switch bottom-out
  // 55–75Hz sine · 30ms · fast exp decay · ~0.5 thock gain · whale lowest.
  // The body of a mechanical key: click + thock without seat reads thin.
  {
    const baseHz = heavy ? 55 : thin ? 75 : 65;
    const hz = fin(baseHz * pVar(), baseHz);
    const dur = 0.03;
    const peak = thockPeak * 0.5;
    const o = ctx.createOscillator();
    o.type = "sine";
    safeSet(o.frequency, hz, t);
    safeExp(o.frequency, Math.max(30, hz * 0.88), t + dur);
    const g = ctx.createGain();
    safeSet(g.gain, 0.0001, t);
    safeLin(g.gain, Math.max(0.0001, peak), t + 0.0008);
    safeExp(g.gain, 0.001, t + dur);
    o.connect(g); g.connect(sfxBus);
    const st = fin(t, 0);
    try { o.start(st); } catch { /* */ }
    try { o.stop(st + dur + 0.02); } catch { /* */ }
  }

  // ── c) SNAP-BACK · switch releasing · subtle second click ──────────
  // ~55–70ms after the first · −14dB relative · what makes it CLICKY
  {
    const delay = 0.055 + brnd() * 0.015; // 55–70ms
    const ts = t + delay;
    const dur = 0.002 + brnd() * 0.0015;
    const peak = clickPeak * Math.pow(10, -14 / 20) * lVar(); // −14dB
    const s = ctx.createBufferSource();
    s.buffer = ensureNoiseBuf();
    s.loop = true;
    const off = brnd() * 1.9;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = fin(2700 * pVar(), 2700);
    f.Q.value = 0.65;
    const g = ctx.createGain();
    safeSet(g.gain, 0.0001, ts);
    safeLin(g.gain, Math.max(0.0001, peak), ts + 0.0002);
    safeLin(g.gain, 0.0001, ts + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    const st = fin(ts, 0);
    try { s.start(st, off); } catch { try { s.start(st); } catch { /* */ } }
    try { s.stop(st + dur + 0.008); } catch { /* */ }
  }

  // SFX duck → duckBus ONLY (never pumpGain). Floor at 0.68 so three cuts
  // inside 100ms still leave the radio bed readable, never dig to zero.
  if (duckBus) {
    const nowG = fin(duckBus.gain.value, 1);
    safeCancel(duckBus.gain, t);
    safeSet(duckBus.gain, Math.max(0.68, Math.min(nowG, 0.74)), t);
    safeLin(duckBus.gain, 1, t + 0.085);
  }

  // ── d) QUANTIZED melodic CHIME · the combo ladder, out loud ─────────
  // Stays on-grid so a legal-but-sloppy cut still lands in the pocket.
  //
  // REBUILT AS THE STAR (operator, launch pass 2026-08-04: "I can't
  // really hear the pitch increase as you extend the combo"). They were
  // right by construction: this voice sat at 0.09-0.2 gain with a 100ms
  // decay UNDER a click/thock/seat stack at up to 0.24 each — the ladder
  // was the quietest layer in its own sound. Now it is a real chime:
  // louder than any single click layer, twice the length, with an octave
  // partial whose LEVEL grows with the combo — so a long chain rises in
  // pitch AND brightens in timbre, two axes saying the same thing.
  const comboLift = Math.min(1, combo / 25);
  const bodyVol = ((thin ? 0.2 : heavy ? 0.32 : 0.26) + comboLift * 0.08) * lVar();
  const bodyHz = fin(pitch * pVar(), pitch);
  for (const det of [-7, 7]) {
    const o = ctx.createOscillator(); o.type = "triangle";
    safeSet(o.frequency, bodyHz, tQ);
    o.detune.value = det;
    // lowpass, not bandpass — the bandpass strangled the harmonics that
    // carry pitch identity; a bright-open chime reads its note instantly
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.value = fin(Math.min(9000, bodyHz * 6), 4000); lp.Q.value = 0.8;
    const g = ctx.createGain();
    safeSet(g.gain, 0.0001, tQ);
    safeLin(g.gain, bodyVol, tQ + 0.003);
    safeExp(g.gain, 0.001, tQ + 0.22);
    o.connect(lp); lp.connect(g); g.connect(sfxBus);
    if (verbSend) {
      const vg = ctx.createGain(); vg.gain.value = 0.22;
      g.connect(vg); vg.connect(verbSend);
    }
    const st = fin(tQ, 0);
    try { o.start(st); } catch { /* */ }
    try { o.stop(st + 0.26); } catch { /* */ }
  }
  // the octave sparkle · silent at x1, unmistakable by x25 — brightness
  // as the second voice of the climb
  if (comboLift > 0.05) {
    const o = ctx.createOscillator(); o.type = "sine";
    safeSet(o.frequency, fin(bodyHz * 2, 880), tQ);
    const g = ctx.createGain();
    safeSet(g.gain, 0.0001, tQ);
    safeLin(g.gain, 0.14 * comboLift * lVar(), tQ + 0.004);
    safeExp(g.gain, 0.001, tQ + 0.18);
    o.connect(g); g.connect(sfxBus);
    const st = fin(tQ, 0);
    try { o.start(st); } catch { /* */ }
    try { o.stop(st + 0.2); } catch { /* */ }
  }

  // ── e) COMBO MILESTONE every 5 · melodic reward on top of the click ─
  if (combo > 0 && combo % 5 === 0) {
    const pent = PENT_HZ || [220, 261.63, 293.66, 329.63, 392];
    const a = fin(pent[((combo / 5) | 0) % pent.length] * pVar(), 330);
    const b = fin(a * Math.pow(2, 7 / 12) * pVar(), a * 1.5); // perfect 5th up
    const vols = [0.1 * lVar(), 0.08 * lVar()];
    const freqs = [a, b];
    for (let i = 0; i < 2; i++) {
      const ti = tQ + i * 0.045;
      const o = ctx.createOscillator(); o.type = "sine";
      safeSet(o.frequency, freqs[i], ti);
      const g = ctx.createGain();
      safeSet(g.gain, 0.0001, ti);
      safeLin(g.gain, vols[i], ti + 0.003);
      safeExp(g.gain, 0.001, ti + 0.09);
      o.connect(g); g.connect(sfxBus);
      if (verbSend) {
        const vg = ctx.createGain(); vg.gain.value = 0.22;
        g.connect(vg); vg.connect(verbSend);
      }
      const st = fin(ti, 0);
      try { o.start(st); } catch { /* */ }
      try { o.stop(st + 0.11); } catch { /* */ }
    }
  }

  keysoundAt(tQ, role, feeNorm);
}

export function whooshSfx(speed) {
  if (!ctx) return;
  ensureAudio();
  const t = ctx.currentTime;
  if (t - lastWhooshT < 0.065) return;
  if (speed < 2.8) return;
  lastWhooshT = t;
  const n = Math.max(0, Math.min(1, (speed - 2.8) / 12));
  const dur = 0.045 + n * 0.04;
  noiseBurst(t, dur, 500 + n * 2200, 0.05 + n * 0.1, {
    off: brnd() * 1.9, type: "bandpass", Q: 0.9, dest: sfxBus, atk: 0.008,
  });
}

export function missSfx() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = "sine";
  o.frequency.value = ROOT_HZ * 1.68;
  const g = ctx.createGain();
  safeSet(g.gain, 0.16, t);
  safeExp(g.gain, 0.001, t + 0.16);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.18);
}

/**
 * STREAK TIER UP · the chain is growing.
 *
 * Why this is its own voice rather than a louder chopSfx: the cut sound
 * already climbs a pentatonic (comboBodyHz), but that line WRAPS an octave
 * every five notes, so it reads as melody, not as accumulation — a ×40
 * chain sounds like a ×5 chain in a different inversion. The player asked
 * for pitch that says "your streak is building", which needs a signal that
 * only ever goes UP and only fires at milestones.
 *
 * `tier` is 0-based and monotonic. Three stacked partials tuned a fifth and
 * an octave apart, rising a whole tone per tier and capped so a very long
 * chain does not end up as a dog whistle.
 */
export function streakSfx(tier) {
  if (!ctx) return;
  ensureAudio();
  const t = ctx.currentTime;
  const k = Math.max(0, Math.min(7, tier | 0));
  // whole-tone ladder, hard-capped: audibly higher every tier, never shrill
  const base = fin(ROOT_HZ * 2 * Math.pow(2, (k * 2) / 12), 440);
  const parts = [
    { mul: 1, gain: 0.15, dur: 0.26 },
    { mul: 1.5, gain: 0.10, dur: 0.22 },   // fifth above · gives it a "ping"
    { mul: 2, gain: 0.07, dur: 0.18 },     // octave · air
  ];
  for (const p of parts) {
    const o = ctx.createOscillator();
    o.type = "triangle";
    const hz = fin(base * p.mul, 440);
    safeSet(o.frequency, hz, t);
    // small upward bend — the sound itself lifts, which is the whole point
    safeExp(o.frequency, Math.min(3600, hz * 1.06), t + p.dur * 0.7);
    const g = ctx.createGain();
    safeSet(g.gain, 0.0001, t);
    safeLin(g.gain, p.gain, t + 0.006);
    safeExp(g.gain, 0.0001, t + p.dur);
    o.connect(g); g.connect(sfxBus);
    const st = fin(t, 0);
    try { o.start(st); } catch { /* */ }
    try { o.stop(st + p.dur + 0.03); } catch { /* */ }
  }
}

/**
 * STREAK BROKEN · the counterpart, and deliberately the loudest negative
 * sound in the game.
 *
 * missSfx() is a single 160ms sine. That is the right weight for dropping
 * one note off a ×3, and completely the wrong weight for losing a ×40 —
 * the operator's note was that a broken chain needs its own cue. This is a
 * descending sweep with a noise edge: a power-down, not a beep. `depth`
 * 0..1 scales how hard it lands so a small loss stays proportionate.
 */
export function streakBreakSfx(depth) {
  if (!ctx) return;
  ensureAudio();
  const t = ctx.currentTime;
  const d = Math.max(0, Math.min(1, Number.isFinite(depth) ? depth : 0.5));
  const dur = 0.34 + d * 0.24;
  // falling body · a fifth down, then keeps sagging
  {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    const hz = fin(ROOT_HZ * 1.5, 330);
    safeSet(o.frequency, hz, t);
    safeExp(o.frequency, Math.max(45, hz * 0.32), t + dur);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    safeSet(f.frequency, 2200, t);
    safeExp(f.frequency, 320, t + dur);
    f.Q.value = 1.2;
    const g = ctx.createGain();
    safeSet(g.gain, 0.0001, t);
    safeLin(g.gain, 0.1 + d * 0.14, t + 0.008);
    safeExp(g.gain, 0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(sfxBus);
    const st = fin(t, 0);
    try { o.start(st); } catch { /* */ }
    try { o.stop(st + dur + 0.04); } catch { /* */ }
  }
  // grit on the front edge so it reads as a break, not a slow fade
  noiseBurst(t, 0.09 + d * 0.06, 900, 0.1 + d * 0.1,
    { off: brnd() * 1.9, dest: sfxBus });
}

/**
 * MULTIPLIER UNLOCK · x2 / x4 / x8.
 *
 * A separate voice from streakSfx on purpose. The trophy ladder
 * (10/25/50/100/200) and the multiplier ladder (8/16/32) are different
 * quantities — one is a badge, the other is the run's economy — and the
 * feel audit found the multiplier step, which is the single biggest
 * scoring moment in a run, was landing as a small text change on a pill.
 * This is a "door unlock": a low thunk with a bright fifth opening over
 * it, so it reads as something GRANTED rather than something scored.
 */
export function multSfx(tier) {
  if (!ctx) return;
  ensureAudio();
  const t = ctx.currentTime;
  const k = Math.max(0, Math.min(3, tier | 0));
  // the bolt drawing back
  {
    const o = ctx.createOscillator();
    o.type = "sine";
    const hz = fin(ROOT_HZ * (0.5 + k * 0.08), 110);
    safeSet(o.frequency, hz, t);
    safeExp(o.frequency, Math.max(40, hz * 0.7), t + 0.16);
    const g = ctx.createGain();
    safeSet(g.gain, 0.0001, t);
    safeLin(g.gain, 0.2, t + 0.005);
    safeExp(g.gain, 0.0001, t + 0.18);
    o.connect(g); g.connect(sfxBus);
    const st = fin(t, 0);
    try { o.start(st); } catch { /* */ }
    try { o.stop(st + 0.2); } catch { /* */ }
  }
  // the door opening — a fifth stack that RISES per tier
  const open = t + 0.055;
  for (const [mul, gain] of [[1, 0.13], [1.5, 0.1], [3, 0.06]]) {
    const o = ctx.createOscillator();
    o.type = "triangle";
    const hz = fin(ROOT_HZ * 2 * Math.pow(2, k * 3 / 12) * mul, 440);
    safeSet(o.frequency, hz, open);
    safeExp(o.frequency, Math.min(4000, hz * 1.18), open + 0.3);
    const g = ctx.createGain();
    safeSet(g.gain, 0.0001, open);
    safeLin(g.gain, gain, open + 0.012);
    safeExp(g.gain, 0.0001, open + 0.42);
    o.connect(g); g.connect(sfxBus);
    const st = fin(open, 0);
    try { o.start(st); } catch { /* */ }
    try { o.stop(st + 0.46); } catch { /* */ }
  }
}

/**
 * DROP ARMED · the four bars of anticipation.
 *
 * armDrop() was silent on every channel the player can perceive, so the
 * moment they EARNED the drop was invisible and the payoff four bars
 * later read as the track doing its own thing. One rising riser, quiet
 * enough to sit under the bed rather than on top of it.
 */
export function armedSfx() {
  if (!ctx) return;
  ensureAudio();
  const t = ctx.currentTime, dur = 0.75;
  const s = ctx.createBufferSource();
  s.buffer = ensureNoiseBuf();
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.6;
  safeSet(f.frequency, 300, t);
  safeExp(f.frequency, 5200, t + dur);
  const g = ctx.createGain();
  safeSet(g.gain, 0.0001, t);
  safeLin(g.gain, 0.075, t + dur * 0.75);
  safeExp(g.gain, 0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(sfxBus);
  const st = fin(t, 0);
  try { s.start(st, brnd() * 1.9); } catch { try { s.start(st); } catch { /* */ } }
  try { s.stop(st + dur + 0.05); } catch { /* */ }
}

export function bombSfx() {
  if (!ctx) return;
  ensureAudio();
  const t = ctx.currentTime;
  noiseBurst(t, 0.3, 300, 0.5, { off: brnd() * 1.9, dest: sfxBus });
  const o = ctx.createOscillator(); o.type = "square";
  safeSet(o.frequency, ROOT_HZ * 4, t);
  safeLin(o.frequency, ROOT_HZ, t + 0.28);
  const g = ctx.createGain();
  safeSet(g.gain, 0.25, t);
  safeExp(g.gain, 0.001, t + 0.3);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.32);
}
