// BITCOIN KART · audio.js
// Web Audio engine v2. Patch-based synth voices (FM marimba/bell, detuned
// saw brass, pulse leads, sub bass), a proper mix bus with feedback delay
// and generated-impulse convolution reverb, punchier drums, and a layered
// SFX kit. All sound is synthesized: no files, fully offline.
// Music themes live in music.js as note data.

import { THEMES } from "./music.js";

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const Snd = {
  ctx: null,
  unlocked: false,
  settings: { music: 0.8, sfx: 0.9, musicOn: true, sfxOn: true, mute: false },
  master: null,
  musicGain: null,
  sfxGain: null,
  engineGain: null,
  delaySend: null,
  verbSend: null,
  sfxVerbSend: null,
  noiseBuf: null,
  theme: null,
  themeKey: null,
  schedTimer: null,
  nextBarTime: 0,
  barIndex: 0,
  fileSources: {},
  liftRate: 1,      // final-lap escalation: tempo multiplier
  liftSemis: 0,     // final-lap escalation: transpose in semitones

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.connect(this.master);
    this.sfxGain = ctx.createGain();
    this.sfxGain.connect(this.master);
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.sfxGain);

    // ---- mix bus: feedback delay + generated-impulse reverb ----
    this.delaySend = ctx.createGain();
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.23;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const dLp = ctx.createBiquadFilter();
    dLp.type = "lowpass";
    dLp.frequency.value = 2800;
    const dWet = ctx.createGain();
    dWet.gain.value = 0.2;
    this.delaySend.connect(delay);
    delay.connect(dLp);
    dLp.connect(fb);
    fb.connect(delay);
    dLp.connect(dWet);
    dWet.connect(this.musicGain);

    this.verbSend = ctx.createGain();
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.6);
    const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = impulse.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
    }
    conv.buffer = impulse;
    const vWet = ctx.createGain();
    vWet.gain.value = 0.24;
    this.verbSend.connect(conv);
    conv.connect(vWet);
    vWet.connect(this.musicGain);

    // SFX reverb return lives on the SFX bus. Both music wet returns above
    // MUST keep feeding musicGain (stopTheme's duck relies on that path to
    // kill scheduled-note tails), but that routing also meant every SFX
    // tail scaled with the MUSIC slider and vanished when music was off,
    // the common mobile config. Short room so item hits stay snappy.
    this.sfxVerbSend = ctx.createGain();
    const conv2 = ctx.createConvolver();
    const len2 = Math.floor(ctx.sampleRate * 0.45);
    const imp2 = ctx.createBuffer(2, len2, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = imp2.getChannelData(c);
      for (let i = 0; i < len2; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len2, 2.2);
      }
    }
    conv2.buffer = imp2;
    const vWet2 = ctx.createGain();
    vWet2.gain.value = 0.3;
    this.sfxVerbSend.connect(conv2);
    conv2.connect(vWet2);
    vWet2.connect(this.sfxGain);

    // shared white-noise buffer for percussion + whooshes
    const nlen = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    // gentle glue compressor so music, engine and SFX sit together on
    // phone speakers instead of clipping each other
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.disconnect();
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.unlocked = true;
    this.applyVolumes();
    this.startEngineVoice();
    this.startSkidVoice();
    this.startWindVoice();
  },

  // classic kart escalation: the whole theme runs faster and a semitone up
  setLift(rate, semis) {
    this.liftRate = rate || 1;
    this.liftSemis = semis || 0;
  },

  // per-channel target levels · the two persistent header toggles
  // (musicOn / sfxOn) gate each bus to zero. Read everywhere a gain is
  // (re)armed so no path can un-mute a channel the player turned off.
  _musicLevel() { return this.settings.musicOn === false ? 0 : this.settings.music * 0.85; },
  _sfxLevel() { return this.settings.sfxOn === false ? 0 : this.settings.sfx; },

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(1, t, 0.03);
    // cancel first: a toggle landing within ~50ms of playTheme's
    // future-dated un-duck ramp (ctx.currentTime + 0.05) would otherwise
    // be overridden by that later-dated event and the channel would drift
    // back to the wrong level (adversarial review 2026-07-15)
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setTargetAtTime(this._musicLevel(), t, 0.05);
    this.sfxGain.gain.cancelScheduledValues(t);
    this.sfxGain.gain.setTargetAtTime(this._sfxLevel(), t, 0.05);
  },

  suspend() { if (this.ctx && this.ctx.state === "running") this.ctx.suspend(); },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },

  // ------------------------------------------------------------------
  // synth voices · every music note and most SFX route through here
  // patch: pulse | square | saw | brass | tri | bass | marimba | bell |
  //        organ | pad | pluck
  // ------------------------------------------------------------------
  voice(patch, freq, t, dur, vol, opts) {
    const ctx = this.ctx;
    const o = opts || {};
    const out = o.out || this.musicGain;
    const amp = ctx.createGain();
    amp.gain.value = 0.0001;
    amp.connect(out);
    if (o.send) {
      // sends follow the voice's destination bus: an SFX voice must echo
      // on the SFX bus, never the music bus (whose returns die with the
      // music slider). The delay's return is music-side only, so SFX
      // voices skip it entirely.
      const toSfx = out === this.sfxGain;
      if (!toSfx) {
        const s1 = ctx.createGain();
        s1.gain.value = o.send * 0.6;
        amp.connect(s1);
        s1.connect(this.delaySend);
      }
      const s2 = ctx.createGain();
      s2.gain.value = o.send;
      amp.connect(s2);
      s2.connect(toSfx ? this.sfxVerbSend : this.verbSend);
    }

    const stop = [];
    const mk = (type, f, det) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      if (det) osc.detune.value = det;
      stop.push(osc);
      return osc;
    };
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    let a = 0.006, d = dur * 0.4, s = 0.6, r = 0.08, peak = vol;
    let filter = null;

    if (patch === "pulse" || patch === "square") {
      const o1 = mk("square", freq, -4), o2 = mk("square", freq, 5);
      const mix = g(0.5);
      o1.connect(mix); o2.connect(mix);
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 4200;
      mix.connect(filter); filter.connect(amp);
    } else if (patch === "saw" || patch === "brass") {
      const o1 = mk("sawtooth", freq, -9), o2 = mk("sawtooth", freq, 0), o3 = mk("sawtooth", freq, 9);
      const mix = g(0.36);
      o1.connect(mix); o2.connect(mix); o3.connect(mix);
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 1.1;
      mix.connect(filter); filter.connect(amp);
      if (patch === "brass") {
        a = 0.05; s = 0.8;
        filter.frequency.setValueAtTime(600, t);
        filter.frequency.linearRampToValueAtTime(3200, t + 0.12);
        // delayed vibrato
        const lfo = mk("sine", 5.6);
        const lg = g(7);
        lfo.connect(lg);
        lg.connect(o1.detune); lg.connect(o2.detune); lg.connect(o3.detune);
      } else {
        filter.frequency.setValueAtTime(1200 + vol * 4000, t);
        filter.frequency.exponentialRampToValueAtTime(2400, t + Math.max(dur, 0.1));
      }
    } else if (patch === "tri") {
      mk("triangle", freq).connect(amp);
    } else if (patch === "bass") {
      const o1 = mk("triangle", freq), o2 = mk("sine", freq / 2);
      const m1 = g(0.7), m2 = g(0.55);
      o1.connect(m1); o2.connect(m2);
      m1.connect(amp); m2.connect(amp);
      a = 0.004; s = 0.75; r = 0.05;
    } else if (patch === "marimba" || patch === "bell" || patch === "pluck") {
      // 2-op FM mallet: modulator ratio + fast index decay = woody strike
      const ratio = patch === "bell" ? 3.53 : patch === "pluck" ? 1.0 : 4.0;
      const decay = patch === "bell" ? 0.9 : patch === "pluck" ? 0.28 : 0.4;
      const car = mk("sine", freq);
      const mod = mk("sine", freq * ratio);
      const mg = g(freq * (patch === "pluck" ? 2.2 : 1.4));
      mod.connect(mg);
      mg.connect(car.frequency);
      mg.gain.setValueAtTime(mg.gain.value, t);
      mg.gain.exponentialRampToValueAtTime(1, t + decay * 0.5);
      car.connect(amp);
      a = 0.002;
      dur = Math.min(Math.max(dur, decay), decay * 1.6);
      d = dur; s = 0.0001; r = 0.05;
      peak = vol * 1.2;
    } else if (patch === "organ") {
      const m1 = g(0.55), m2 = g(0.3), m3 = g(0.18);
      mk("sine", freq).connect(m1);
      mk("sine", freq * 2).connect(m2);
      mk("sine", freq * 3).connect(m3);
      m1.connect(amp); m2.connect(amp); m3.connect(amp);
      a = 0.02;
    } else if (patch === "pad") {
      const o1 = mk("sawtooth", freq, -7), o2 = mk("sawtooth", freq, 7);
      const mix = g(0.4);
      o1.connect(mix); o2.connect(mix);
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1300;
      mix.connect(filter); filter.connect(amp);
      a = 0.12; s = 0.85; r = 0.25;
    } else {
      mk("square", freq).connect(amp);
    }

    // ADSR
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + a);
    amp.gain.setTargetAtTime(peak * s, t + a, Math.max(d * 0.35, 0.02));
    amp.gain.setTargetAtTime(0.0001, t + dur, r);
    for (const osc of stop) { osc.start(t); osc.stop(t + dur + r * 4 + 0.1); }
  },

  // ---------------- music pattern player ----------------
  playGen: 0, // generation token: every play/stop bumps it, so an async
  // file decode from a superseded playTheme can never seat a source
  // (overlap audit 2026-07-15)
  playTheme(key) {
    if (!this.ctx || this.themeKey === key) return;
    this.stopTheme();
    this.layerOn = false; // the P1 layer never leaks into menu themes
    const theme = THEMES[key];
    if (!theme) return;
    this.themeKey = key;
    // un-duck after stopTheme's tail-kill, in time for bar 0 · respects
    // the music toggle so a theme change never revives muted music
    this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicGain.gain.setTargetAtTime(this._musicLevel(), this.ctx.currentTime + 0.05, 0.05);
    // MUSIC SLOTS override: operator-supplied file per theme key. A file
    // that already failed to fetch/decode is skipped so we fall through to
    // the synth theme instead of hammering the network (bug sweep 2026-07-15)
    const files = typeof window !== "undefined" && window.BITCOIN_KART_MUSIC;
    if (files && files[key] && !this.fileFailed.has(files[key])) {
      this.playFile(files[key], key);
      return;
    }
    this.theme = theme;
    this.barIndex = 0;
    this.setLift(1, 0);
    this.nextBarTime = this.ctx.currentTime + 0.12;
    const tick = () => {
      if (!this.theme) return;
      const ahead = this.ctx.currentTime + 0.3;
      while (this.nextBarTime < ahead) {
        this.scheduleBar(this.theme, this.barIndex % this.theme.bars, this.nextBarTime);
        this.nextBarTime += (60 / (this.theme.bpm * this.liftRate)) * 4;
        this.barIndex++;
      }
    };
    tick();
    this.schedTimer = setInterval(tick, 90);
  },

  stopTheme() {
    this.playGen++;
    if (this.schedTimer) { clearInterval(this.schedTimer); this.schedTimer = null; }
    this.theme = null;
    this.themeKey = null;
    this.setLift(1, 0);
    for (const k in this.fileSources) {
      try { this.fileSources[k].stop(); } catch { /* already stopped */ }
      delete this.fileSources[k];
    }
    // duck the music bus for a beat: voices already scheduled up to 0.3s
    // ahead (plus their release tails) would otherwise ring under the
    // next theme and read as two songs at once
    if (this.ctx && this.musicGain) {
      this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.musicGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.035);
    }
  },

  fileBufs: {}, // decoded once per url · re-picking a theme is instant
  fileFailed: new Set(), // urls that 404'd / failed decode · never retried

  playFile(url, key) {
    const gen = ++this.playGen;
    const seat = (buf) => {
      // a newer playTheme/stopTheme superseded this decode · never seat
      // a source that nothing tracks (the old themeKey check let two
      // same-key decodes both pass and one loop forever)
      if (gen !== this.playGen || this.themeKey !== key) return;
      if (this.fileSources[key]) { try { this.fileSources[key].stop(); } catch { /* fine */ } }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.musicGain);
      src.start();
      this.fileSources[key] = src;
    };
    if (this.fileBufs[url]) { seat(this.fileBufs[url]); return; }
    fetch(url).then((r) => r.arrayBuffer()).then((ab) => this.ctx.decodeAudioData(ab)).then((buf) => {
      this.fileBufs[url] = buf;
      seat(buf);
    }).catch(() => {
      // mark the url dead FIRST so the retry falls through to the synth
      // theme instead of re-entering playFile forever
      this.fileFailed.add(url);
      if (gen === this.playGen && this.themeKey === key) { this.themeKey = null; this.playTheme(key); }
    });
  },

  scheduleBar(theme, bar, t0) {
    const stepDur = 60 / (theme.bpm * this.liftRate) / 4;
    const swing = theme.swing || 0;
    const s0 = bar * 16, s1 = s0 + 16;
    const stepTime = (step) => {
      const local = step - s0;
      const sw = (local % 2 === 1) ? swing * stepDur : 0;
      return t0 + local * stepDur + sw;
    };
    for (const ch of theme.ch) {
      for (const [step, dur, midi] of ch.ev) {
        if (step < s0 || step >= s1) continue;
        this.voice(ch.patch, midiHz(midi + this.liftSemis), stepTime(step), dur * stepDur * 0.92, ch.vol, { send: ch.send || 0 });
      }
    }
    // P1 layer: while the player LEADS, the lead line doubles an octave
    // up on quiet brass · holding first audibly matters (Tier 2)
    if (this.layerOn && theme.ch.length) {
      const lead = theme.ch[0];
      for (const [step, dur, midi] of lead.ev) {
        if (step < s0 || step >= s1) continue;
        this.voice("brass", midiHz(midi + 12 + this.liftSemis), stepTime(step), dur * stepDur * 0.9, 0.05, { send: 0.3 });
      }
    }
    for (const [step, kind] of theme.dr) {
      if (step < s0 || step >= s1) continue;
      this.drum(kind, stepTime(step));
    }
  },

  layerOn: false,
  setLayer(on) { this.layerOn = !!on; },

  drum(kind, t, outBus) {
    const ctx = this.ctx;
    // music percussion routes to musicGain (default); a one-shot SFX drum
    // (the 3-2-1 countdown) passes sfxGain so it follows the SFX toggle
    const out = outBus || this.musicGain;
    const noise = (dur, vol, f, type, out2) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const flt = ctx.createBiquadFilter();
      flt.type = type || "bandpass";
      flt.frequency.value = f;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(vol, t);
      gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(flt); flt.connect(gn); gn.connect(out2 || out);
      src.start(t); src.stop(t + dur + 0.02);
    };
    const drop = (f0, f1, dur, vol) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(vol, t);
      gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gn); gn.connect(out);
      osc.start(t); osc.stop(t + dur + 0.02);
    };
    switch (kind) {
      case 0: drop(150, 44, 0.16, 0.75); noise(0.02, 0.3, 4000, "highpass"); break; // kick
      case 1: noise(0.13, 0.5, 1750); drop(210, 150, 0.08, 0.3); break; // snare
      case 2: noise(0.04, 0.22, 9000, "highpass"); break; // closed hat
      case 3: noise(0.22, 0.24, 7600, "highpass"); break; // open hat
      case 4: { // register ching
        noise(0.14, 0.26, 6200, "highpass");
        this.voice("bell", 2093, t, 0.2, 0.12, { out });
        break;
      }
      case 5: noise(0.85, 0.4, 5200, "highpass"); break; // crash
      case 6: drop(200, 120, 0.2, 0.5); break; // low tom
      case 7: drop(300, 190, 0.16, 0.45); break; // high tom
      case 8: noise(0.06, 0.13, 5200); break; // shaker
    }
  },

  // ---------------- SFX kit ----------------
  tone(type, f0, f1, dur, vol, t0) {
    if (!this.ctx || !this.unlocked) return;
    const t = (t0 === undefined ? this.ctx.currentTime : t0) + 0.001;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  },

  hiss(dur, vol, freq, type, t0) {
    if (!this.ctx || !this.unlocked) return;
    const t = (t0 === undefined ? this.ctx.currentTime : t0) + 0.001;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type || "bandpass";
    f.frequency.value = freq || 2000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t); src.stop(t + dur + 0.02);
  },

  note(patch, midi, t, dur, vol) {
    this.voice(patch, midiHz(midi), t, dur, vol, { out: this.sfxGain, send: 0.25 });
  },

  sfx(name, opt) {
    if (!this.ctx || !this.unlocked || this.settings.sfxOn === false) return;
    const now = this.ctx.currentTime;
    switch (name) {
      case "click": this.note("pluck", 88, now, 0.08, 0.2); break;
      case "move": this.note("pluck", 93, now, 0.07, 0.15); break;
      case "doink": // item box: marimba arpeggio up
        this.note("marimba", 72, now, 0.2, 0.3);
        this.note("marimba", 76, now + 0.07, 0.2, 0.28);
        this.note("marimba", 79, now + 0.14, 0.3, 0.3);
        break;
      case "roulette": this.note("pluck", 84 + ((opt || 0) % 5), now, 0.05, 0.09); break;
      case "peel": this.tone("triangle", 220, 130, 0.14, 0.26); this.hiss(0.1, 0.12, 800); break;
      case "fud": this.hiss(0.18, 0.22, 1400); this.tone("square", 330, 520, 0.16, 0.13); break;
      case "ratio": this.hiss(0.45, 0.26, 2400); this.tone("sawtooth", 280, 980, 0.4, 0.17); break;
      case "hammer":
        this.tone("sine", 110, 38, 0.34, 0.55);
        this.hiss(0.4, 0.34, 800, "lowpass");
        this.note("bell", 55, now, 0.5, 0.2);
        break;
      case "laser": this.tone("sawtooth", 420, 1900, 0.3, 0.2); this.hiss(0.28, 0.15, 5200, "highpass"); break;
      case "chair": // rising brass power chord
        this.note("brass", 60, now, 0.5, 0.22);
        this.note("brass", 67, now + 0.12, 0.5, 0.22);
        this.note("brass", 72, now + 0.24, 0.7, 0.24);
        this.note("bell", 84, now + 0.4, 0.6, 0.18);
        break;
      case "bolt":
        this.tone("square", 1700, 180, 0.18, 0.24);
        this.tone("square", 1300, 140, 0.24, 0.2, now + 0.09);
        this.hiss(0.2, 0.2, 3500, "highpass");
        break;
      case "shield": this.note("organ", 67, now, 0.3, 0.22); this.note("organ", 74, now + 0.08, 0.35, 0.18); break;
      case "pill":
        this.note("bell", 88, now, 0.25, 0.2);
        this.note("bell", 93, now + 0.09, 0.35, 0.18);
        break;
      case "goldbar": this.tone("triangle", 170, 80, 0.22, 0.32); this.note("bell", 96, now, 0.15, 0.08); break;
      case "hit":
        this.tone("triangle", 280, 70, 0.3, 0.4);
        this.hiss(0.24, 0.24, 650, "lowpass");
        break;
      case "bump": this.tone("triangle", 190, 110, 0.1, 0.22); break;
      case "drift": this.hiss(0.08, 0.08, 1300); break;
      case "charge1": this.note("pluck", 88, now, 0.09, 0.2); break;
      case "charge2": this.note("pluck", 95, now, 0.11, 0.24); break;
      case "draft": // slipstream pop: lighter than a full turbo
        this.hiss(0.3, 0.18, 1400);
        this.tone("sawtooth", 260, 620, 0.24, 0.12);
        break;
      case "turbo": // riser + sub punch
        this.hiss(0.42, 0.3, 2000);
        this.tone("sawtooth", 200, 950, 0.35, 0.2);
        this.tone("sine", 90, 45, 0.22, 0.4);
        break;
      case "zipper":
        this.note("pluck", 84, now, 0.06, 0.22);
        this.note("pluck", 91, now + 0.05, 0.06, 0.2);
        this.note("pluck", 96, now + 0.1, 0.1, 0.2);
        break;
      case "sat": this.note("bell", 86 + Math.min(opt || 0, 10), now, 0.12, 0.13); break; // pitch ladders with the stack
      case "award": // roulette settles: your item has landed
        this.note("marimba", 76, now, 0.16, 0.26);
        this.note("bell", 88, now + 0.08, 0.35, 0.22);
        break;
      case "boing": this.tone("sine", 280, 620, 0.13, 0.22); this.tone("sine", 620, 360, 0.18, 0.18, now + 0.11); break;
      case "splash":
        this.hiss(0.5, 0.34, 900, "lowpass");
        this.tone("sine", 260, 60, 0.4, 0.3);
        this.hiss(0.3, 0.16, 2600, "bandpass", now + 0.12);
        break;
      case "land": { // touchdown · opt is impact energy 0..1 (~0.45 curb, 1 max);
        // squared so hop vs slam spreads superlinearly · chassis rattle FADES
        // in past e>0.4 ((e-0.4)/0.6 · zero at the gate, full at e=1): a
        // threshold that pops is a worse tell than no rattle
        const s = Math.min(1, Math.max(0, opt === undefined ? 1 : opt));
        const e = s * s;
        this.tone("sine", 92 - e * 22, 40 - e * 8, 0.11 + e * 0.16, 0.12 + e * 0.34);
        this.hiss(0.1 + e * 0.14, 0.06 + e * 0.16, 520 - e * 200, "lowpass");
        if (e > 0.4) this.hiss(0.07, 0.18 * ((e - 0.4) / 0.6), 2600, "bandpass", now + 0.003);
        break;
      }
      case "rescue":
        this.note("marimba", 72, now, 0.14, 0.2);
        this.note("marimba", 79, now + 0.1, 0.22, 0.2);
        break;
      case "crowd": // roar when you take P1 · the grid approves
        this.hiss(0.3, 0.9, 1400, "bandpass");
        this.hiss(0.2, 1.2, 700, "lowpass", now + 0.08);
        this.note("brass", 76, now + 0.05, 0.5, 0.13);
        this.note("brass", 83, now + 0.05, 0.6, 0.11);
        break;
      case "count": this.drumAt(6, now, this.sfxGain); this.note("pluck", 81, now, 0.18, 0.3); break;
      case "go":
        this.note("brass", 72, now, 0.5, 0.3);
        this.note("brass", 76, now, 0.5, 0.26);
        this.note("brass", 79, now, 0.6, 0.26);
        this.hiss(0.4, 0.16, 3000, "highpass");
        break;
      case "finish": { // three-chord fanfare + crowd swell
        const hit = (t, root) => {
          this.note("brass", root, now + t, 0.32, 0.24);
          this.note("brass", root + 4, now + t, 0.32, 0.2);
          this.note("brass", root + 7, now + t, 0.36, 0.2);
        };
        hit(0, 72); hit(0.22, 74); hit(0.44, 76);
        this.note("bell", 88, now + 0.66, 0.8, 0.22);
        this.hiss(1.4, 0.14, 1100);
        this.hiss(1.2, 0.12, 2400, "bandpass", now + 0.3);
        break;
      }
      case "headline": this.tone("square", 520, 300, 0.2, 0.16); this.hiss(0.16, 0.1, 3200); break;
      case "thunder": {
        // storm crack + long rumble · lowpassed noise with a sub drop
        this.hiss(1.1, 0.5, 340, "lowpass");
        this.hiss(0.16, 0.55, 2400, "lowpass");
        this.tone("sine", 74, 38, 0.9, 0.42);
        break;
      }
      case "balloon": this.note("marimba", 84, now, 0.2, 0.22); this.note("marimba", 91, now + 0.12, 0.3, 0.22); break;
      case "unlock":
        [72, 76, 79, 84, 88].forEach((m, i) => this.note("bell", m, now + i * 0.1, 0.4, 0.2));
        break;
      case "stinger": { // character select flourish, unique root per slot
        const root = 55 + ((opt || 0) % 11) * 2;
        this.note("marimba", root + 12, now, 0.16, 0.24);
        this.note("marimba", root + 19, now + 0.07, 0.16, 0.2);
        this.note("bell", root + 24, now + 0.14, 0.3, 0.2);
        break;
      }
      case "wrong": this.tone("square", 200, 165, 0.22, 0.16); break;
    }
  },

  drumAt(kind, t, outBus) { this.drum(kind, t, outBus); },

  // ---------------- engine loop ----------------
  engineOsc: null,
  engineOsc2: null,
  engineSub: null,
  engineFilter: null,

  startEngineVoice() {
    const ctx = this.ctx;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 400;
    this.engineFilter.connect(this.engineGain);
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 50;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = "square";
    this.engineOsc2.frequency.value = 25;
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = "sine";
    this.engineSub.frequency.value = 25;
    const g1 = ctx.createGain(); g1.gain.value = 0.42;
    const g2 = ctx.createGain(); g2.gain.value = 0.22;
    const g3 = ctx.createGain(); g3.gain.value = 0.4;
    this.engineOsc.connect(g1); g1.connect(this.engineFilter);
    this.engineOsc2.connect(g2); g2.connect(this.engineFilter);
    this.engineSub.connect(g3); g3.connect(this.engineFilter);
    // slow wobble so the idle never sounds like a test tone
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lg = ctx.createGain();
    lg.gain.value = 4;
    lfo.connect(lg);
    lg.connect(this.engineOsc.detune);
    lfo.start();
    this.engineOsc.start();
    this.engineOsc2.start();
    this.engineSub.start();
  },

  // ---- engine v3: virtual 4-speed gearbox + throttle-load axis ----
  // gear top speeds as fractions of speed01 · short low gears so a
  // standing start shifts early and often. gearLos overlap the previous
  // gear's band: at an upshift the new gear catches at ~35-38% rev
  // instead of the floor, so each shift drops ~5-6.5 semitones (a
  // close-ratio mechanical read · rev-floor landings were ~10 semitones,
  // which read as a slot machine, not a gearbox)
  gearTops: [0.22, 0.46, 0.72, 1.0001],
  gearLos: [0, 0.1, 0.3, 0.55],
  gearNow: 0,
  shiftUntil: 0,
  popT: 0,
  popN: 0,       // pops left in the current overrun burst
  overOn: false, // last frame's overrun state · fresh lift pops fast
  engT: 0,

  // speed01: 0..1, boost: bool, toneKind: per-driver flavor (0 deep .. 1
  // metallic), load01: throttle 0..1, airborne: bool. load01/airborne are
  // OPTIONAL: the legacy 3-arg call behaves as full-throttle grounded, so
  // callers that predate the gearbox keep working unchanged.
  engine(speed01, boost, toneKind, load01, airborne) {
    if (!this.ctx || !this.engineOsc) return;
    const hasLoad = load01 !== undefined;
    if (!hasLoad) load01 = 1;
    const t = this.ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0, t - this.engT));
    this.engT = t;

    const tops = this.gearTops;
    let gear = 3;
    for (let i = 0; i < 4; i++) { if (speed01 <= tops[i]) { gear = i; break; } }
    // downshift hysteresis: hold the higher gear until clearly below its
    // floor so boundary jitter can't machine-gun the shift thunk
    if (gear < this.gearNow && speed01 > (this.gearNow ? tops[this.gearNow - 1] : 0) - 0.03) gear = this.gearNow;
    const lo = this.gearLos[gear];
    const frac = Math.min(1, Math.max(0, (speed01 - lo) / (tops[gear] - lo)));
    let rpm01 = 0.3 + 0.7 * frac;
    // standstill throttle = revving on the line · makes the brake-hold
    // rocket ritual audible through the countdown. Legacy callers never
    // rev (their default load is a placeholder, not a held throttle).
    if (hasLoad && speed01 < 0.06) rpm01 = Math.max(rpm01, 0.3 + load01 * 0.55);
    if (gear > this.gearNow && t > this.shiftUntil) {
      // upshift: 40ms throttle-cut dip + a mechanical thunk
      this.shiftUntil = t + 0.04;
      if (this.settings.sfxOn !== false) {
        this.hiss(0.05, 0.16, 520, "lowpass", t);
        this.tone("sine", 130, 70, 0.05, 0.18, t);
      }
    }
    this.gearNow = gear;
    const shifting = t < this.shiftUntil;
    const over = hasLoad && load01 < 0.2 && speed01 > 0.3 && !boost; // decel overrun

    let base = 40 + rpm01 * 96 + speed01 * 34 + (boost ? 38 : 0) + toneKind * 16;
    let filt = 230 + rpm01 * 900 + speed01 * 500 + (boost ? 650 : 0);
    // the kart leads the mix, especially on phone speakers
    let vol = speed01 > 0.02 ? 0.075 + speed01 * 0.1 : 0.028 + (rpm01 - 0.3) * 0.09;
    // tau 0.035 (was 0.06) so the RPM drop at a shift reads as a STEP
    let fqTau = 0.035, ftTau = 0.08, gTau = shifting ? 0.012 : 0.05;
    if (shifting) { base *= 0.86; vol *= 0.5; fqTau = 0.015; }
    if (over) {
      // closed throttle at speed: darker, quieter, with overrun pops in
      // short bursts (2-4 pops 30-80ms apart, bursts 0.35-1s apart · the
      // uniform-random singles read as a metronome, real overrun
      // crackles cluster). Each pop is a gain/filter blip scheduled on
      // the persistent chain (the next frame's targets restore it), zero
      // new nodes per pop
      filt *= 0.45;
      vol *= 0.6;
      if (!this.overOn) { this.popN = 0; this.popT = 0.04 + Math.random() * 0.08; }
      this.popT -= dt;
      if (this.popT <= 0) {
        if (this.popN <= 0) this.popN = 2 + Math.floor(Math.random() * 3);
        this.popN--;
        this.popT = this.popN > 0 ? 0.03 + Math.random() * 0.05 : 0.35 + Math.random() * 0.65;
        vol = Math.min(0.2, vol * (1.7 + Math.random() * 0.6));
        filt = filt * 0.5 + 900 + Math.random() * 700;
        gTau = 0.004; ftTau = 0.006;
      }
    }
    this.overOn = over;
    if (airborne) {
      // flight unloads the engine: it falls away, revs float up (K11)
      base *= 1.08;
      filt = 300;
      vol *= 0.35;
      fqTau = 0.08; ftTau = 0.08; gTau = 0.08;
    }
    this.engineOsc.frequency.setTargetAtTime(base, t, fqTau);
    this.engineOsc2.frequency.setTargetAtTime(base * 0.5, t, fqTau);
    this.engineSub.frequency.setTargetAtTime(base * 0.5, t, fqTau);
    this.engineFilter.frequency.setTargetAtTime(filt, t, ftTau);
    this.engineGain.gain.setTargetAtTime(this.settings.sfxOn === false ? 0 : vol, t, gTau);
  },

  // ---------------- drift skid loop ----------------
  skidGain: null,
  skidFilter: null,

  startSkidVoice() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = "bandpass";
    this.skidFilter.frequency.value = 900;
    this.skidFilter.Q.value = 1.4;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    src.connect(this.skidFilter);
    this.skidFilter.connect(this.skidGain);
    this.skidGain.connect(this.sfxGain);
    src.start();
  },

  // persistent tire-skid while drifting: brightness rises with charge
  // tier, and the SURFACE flavors the noise · ice sings high and glassy,
  // sand hisses low, off-road is a dull rumble (Tier 2)
  skid(active, tier, speed01, surface) {
    if (!this.ctx || !this.skidGain) return;
    const t = this.ctx.currentTime;
    const offroad = surface === "offroad";
    const vol = active && this.settings.sfxOn !== false ? (offroad ? 0.03 : 0.045 + tier * 0.03) : 0;
    this.skidGain.gain.setTargetAtTime(vol, t, 0.05);
    if (active) {
      const base = surface === "ice" ? 1500 : surface === "sand" ? 430 : offroad ? 260 : 750;
      this.skidFilter.frequency.setTargetAtTime(base + tier * 550 + speed01 * 500, t, 0.08);
    }
  },

  // ---------------- airborne wind loop (K11) ----------------
  // cloned from the skid voice: looped noise through a bandpass, one
  // persistent chain so flight swells are gain moves, never new nodes
  windGain: null,
  windFilter: null,

  startWindVoice() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.7;
    // flutter multiplies the wind level so windGain=0 stays silent · an LFO
    // into windGain.gain would SUM and leak hiss while grounded
    const windFlut = ctx.createGain();
    windFlut.gain.value = 1;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter);
    this.windFilter.connect(windFlut);
    windFlut.connect(this.windGain);
    this.windGain.connect(this.sfxGain);
    src.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const lg = ctx.createGain();
    lg.gain.value = 0.3;
    lfo.connect(lg);
    lg.connect(windFlut.gain);
    lfo.start();
  },

  // air01: 0..1 airborne blend, speed01: 0..1 · the rush rises and
  // brightens with speed so a mega flight roars where a curb hop sighs.
  // Swell attack is faster than the release: the rush should hit as the
  // wheels leave, then bleed off through the landing squash
  wind(air01, speed01) {
    if (!this.ctx || !this.windGain) return;
    const t = this.ctx.currentTime;
    const vol = this.settings.sfxOn === false ? 0 : air01 * (0.03 + speed01 * 0.07);
    this.windGain.gain.setTargetAtTime(vol, t, air01 > 0 ? 0.06 : 0.12);
    if (air01 > 0) this.windFilter.frequency.setTargetAtTime(450 + speed01 * 900, t, 0.1);
  },

  engineOff() {
    if (!this.ctx || !this.engineGain) return;
    this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    this.gearNow = 0;
    this.shiftUntil = 0;
    this.popN = 0;
    this.overOn = false;
    this.rivals([]);
    this.skid(false, 0, 0);
    this.wind(0, 0);
  },

  // ---------------- per-world ambience beds ----------------
  // surf + gulls · wind · city hum · mine drips. Built from the shared
  // noise buffer; one-shot flourishes ride a scheduler.
  ambKind: null,
  ambNodes: [],
  ambTimer: null,

  ambience(kind) {
    if (!this.ctx || kind === this.ambKind) return;
    for (const n of this.ambNodes) { try { n.stop ? n.stop() : n.disconnect(); } catch { /* fine */ } }
    this.ambNodes = [];
    if (this.ambTimer) { clearInterval(this.ambTimer); this.ambTimer = null; }
    this.ambKind = kind;
    if (!kind) return;
    const ctx = this.ctx;
    const bed = (freq, type, vol, lfoHz, lfoDepth) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(this.sfxGain);
      src.start();
      this.ambNodes.push(src, f, g);
      if (lfoHz) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = lfoHz;
        const lg = ctx.createGain();
        lg.gain.value = lfoDepth;
        lfo.connect(lg); lg.connect(g.gain);
        lfo.start();
        this.ambNodes.push(lfo, lg);
      }
      return g;
    };
    if (kind === "surf") {
      bed(320, "lowpass", 0.028, 0.085, 0.02);
      bed(900, "bandpass", 0.012, 0.13, 0.008);
      this.ambTimer = setInterval(() => {
        if (this.ambKind !== "surf" || this.settings.sfxOn === false) return;
        if (Math.random() < 0.5) {
          // gull: two falling chirps
          const t = this.ctx.currentTime;
          this.tone("sine", 1500, 950, 0.18, 0.035, t);
          this.tone("sine", 1350, 900, 0.16, 0.03, t + 0.24);
        }
      }, 5200);
    } else if (kind === "wind") {
      bed(480, "bandpass", 0.035, 0.06, 0.028);
      bed(180, "lowpass", 0.02, 0.11, 0.012);
    } else if (kind === "city") {
      bed(210, "lowpass", 0.026, 0.05, 0.01);
      bed(1300, "bandpass", 0.007, 0.17, 0.004);
    } else if (kind === "drips") {
      bed(150, "lowpass", 0.02, 0.07, 0.008);
      this.ambTimer = setInterval(() => {
        if (this.ambKind !== "drips" || this.settings.sfxOn === false) return;
        if (Math.random() < 0.7) {
          this.voice("pluck", 1900 + Math.random() * 900, this.ctx.currentTime, 0.12, 0.05, { out: this.sfxGain, send: 0.8 });
        }
      }, 2100);
    }
  },

  // ---------------- rival engines (2 pooled voices, panned) ----------------
  rivalVoices: null,

  startRivalVoices() {
    const ctx = this.ctx;
    this.rivalVoices = [];
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 50;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      osc.connect(lp); lp.connect(g);
      if (pan) { g.connect(pan); pan.connect(this.sfxGain); }
      else g.connect(this.sfxGain);
      osc.start();
      this.rivalVoices.push({ osc, lp, g, pan });
    }
  },

  // list: up to 2 of { speed01, dist, pan (-1..1), tone }
  rivals(list) {
    if (!this.ctx) return;
    if (!this.rivalVoices) this.startRivalVoices();
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const v = this.rivalVoices[i];
      const r = list[i];
      if (!r || this.settings.sfxOn === false) {
        v.g.gain.setTargetAtTime(0, t, 0.1);
        continue;
      }
      v.osc.frequency.setTargetAtTime(38 + r.speed01 * 115 + r.tone * 14, t, 0.08);
      v.g.gain.setTargetAtTime(Math.max(0, 0.05 * (1 - r.dist / 45)), t, 0.1);
      if (v.pan) v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, r.pan)), t, 0.08);
    }
  },

  passBy() {
    // doppler-ish whoosh when a rival crosses close at speed
    this.hiss(0.28, 0.12, 700, "bandpass");
    this.tone("sawtooth", 240, 90, 0.26, 0.06);
  },
};
