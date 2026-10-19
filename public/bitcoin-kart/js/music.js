// BITCOIN KART · music.js
// Original soundtrack, written as note data for the patch synth in
// audio.js. All compositions are original: classic kart ENERGY (bounce,
// brass, mallets, calypso swing), never anyone's melody.
//
// Format per theme:
//   { bpm, bars, swing?, ch: [{ patch, vol, send, ev: [[step,dur,midi]] }],
//     dr: [[step, kind]] }
// 16 steps per bar. Drum kinds: 0 kick · 1 snare · 2 hat · 3 open hat ·
// 4 register ching · 5 crash · 6 low tom · 7 high tom · 8 shaker.
//
// MUSIC SLOTS · optional operator-supplied audio: set
// window.BITCOIN_KART_MUSIC = { themeKey: "/path/to/loop.ogg", ... } before
// load and the file plays instead of the synth for that key. Only ship
// audio you hold the rights to. Missing or failed files fall back to synth.

const B = 16;

function ev(bar, list) {
  return list.map(([s, d, m]) => [bar * B + s, d, m]);
}

function loopBars(fn, bars) {
  let out = [];
  for (let b = 0; b < bars; b++) out = out.concat(fn(b));
  return out;
}

// bass figures per bar
function bassBar(bar, r, style) {
  if (style === "calypso") {
    return ev(bar, [[0, 3, r], [4, 1, r + 7], [6, 2, r + 12], [8, 3, r], [12, 2, r + 7], [14, 2, r + 9]]);
  }
  if (style === "drive") {
    return ev(bar, [[0, 2, r], [2, 2, r], [4, 2, r], [6, 2, r + 12], [8, 2, r], [10, 2, r], [12, 2, r + 7], [14, 2, r + 10]]);
  }
  if (style === "walk") {
    return ev(bar, [[0, 4, r], [4, 4, r + 7], [8, 4, r + 12], [12, 4, r + 7]]);
  }
  if (style === "synco") {
    return ev(bar, [[0, 2, r], [3, 1, r], [6, 2, r + 7], [10, 2, r + 12], [12, 2, r + 7], [14, 2, r + 10]]);
  }
  if (style === "oompah") {
    return ev(bar, [[0, 3, r], [4, 3, r + 7], [8, 3, r], [12, 3, r + 7]]);
  }
  if (style === "long") {
    return ev(bar, [[0, 14, r]]);
  }
  return ev(bar, [[0, 6, r], [8, 6, r + 7]]);
}

// off-beat chord stabs: two chord tones on the ands
function stabs(bar, third, fifth) {
  return ev(bar, [[2, 1, third], [2, 1, fifth], [6, 1, third], [6, 1, fifth], [10, 1, third], [10, 1, fifth], [14, 1, third], [14, 1, fifth]]);
}

function drumBar(bar, style, fill) {
  const o = bar * B;
  const out = [];
  const put = (s, v) => out.push([o + s, v]);
  if (style === "beach") {
    put(0, 0); put(8, 0); put(4, 1); put(12, 1);
    for (let s = 0; s < B; s += 2) put(s, 8);
    put(14, 3);
  } else if (style === "drive") {
    for (let s = 0; s < B; s += 4) put(s, 0);
    put(4, 1); put(12, 1);
    for (let s = 2; s < B; s += 2) put(s, 2);
    put(14, 3);
  } else if (style === "bounce") {
    put(0, 0); put(4, 1); put(8, 0); put(10, 0); put(12, 1);
    for (let s = 2; s < B; s += 4) put(s, 2);
  } else if (style === "tight") {
    put(0, 0); put(6, 0); put(8, 0); put(4, 1); put(12, 1);
    for (let s = 2; s < B; s += 2) put(s, 2);
    for (let s = 0; s < B; s += 2) put(s, 8);
  } else if (style === "soft") {
    put(0, 0); put(8, 0); put(4, 8); put(12, 8); put(6, 2); put(14, 2);
  } else if (style === "chaos") {
    put(0, 0); put(3, 0); put(8, 0); put(11, 0); put(4, 1); put(12, 1); put(14, 1);
    for (let s = 1; s < B; s += 2) put(s, 2);
    put(6, 4); put(13, 4);
  }
  if (fill) {
    put(12, 7); put(13, 7); put(14, 6); put(15, 6);
  }
  return out;
}

// ---------------------------------------------------------------------------
export const THEMES = {};

// TITLE · brass adventure fanfare over a driving floor. 132 BPM, C major.
THEMES.title = {
  bpm: 132, bars: 8,
  ch: [
    { patch: "brass", vol: 0.24, send: 0.35, ev: [
      ...ev(0, [[0, 2, 72], [2, 2, 76], [4, 2, 79], [6, 2, 81], [8, 6, 79], [14, 2, 76]]),
      ...ev(1, [[0, 2, 77], [2, 2, 81], [4, 4, 84], [8, 4, 83], [12, 4, 79]]),
      ...ev(2, [[0, 2, 72], [2, 2, 76], [4, 2, 79], [6, 2, 81], [8, 6, 84], [14, 2, 81]]),
      ...ev(3, [[0, 4, 83], [4, 4, 79], [8, 8, 76]]),
      ...ev(4, [[0, 2, 74], [2, 2, 77], [4, 2, 81], [6, 2, 84], [8, 6, 81], [14, 2, 77]]),
      ...ev(5, [[0, 2, 76], [2, 2, 79], [4, 4, 84], [8, 4, 88], [12, 4, 84]]),
      ...ev(6, [[0, 2, 86], [2, 2, 84], [4, 2, 81], [6, 2, 79], [8, 4, 81], [12, 4, 83]]),
      ...ev(7, [[0, 12, 84]]),
    ] },
    { patch: "pulse", vol: 0.09, send: 0.25, ev: loopBars((b) => {
      const r = [60, 65, 60, 67, 62, 64, 65, 67][b];
      const out = [];
      for (let s = 0; s < B; s += 2) out.push([b * B + s, 1, r + [0, 4, 7, 12][(s / 2) % 4]]);
      return out;
    }, 8) },
    { patch: "bass", vol: 0.42, send: 0, ev: [
      ...bassBar(0, 36, "drive"), ...bassBar(1, 41, "drive"),
      ...bassBar(2, 36, "drive"), ...bassBar(3, 43, "drive"),
      ...bassBar(4, 38, "drive"), ...bassBar(5, 40, "drive"),
      ...bassBar(6, 41, "drive"), ...bassBar(7, 43, "drive"),
    ] },
  ],
  dr: [
    [0, 5],
    ...loopBars((b) => drumBar(b, "drive", b === 3 || b === 7), 8),
  ],
};

// TIMECHAIN ATOLL · lazy island stroll. Marimba + pad, swung. 98 BPM.
THEMES.atoll = {
  bpm: 98, bars: 8, swing: 0.22,
  ch: [
    { patch: "marimba", vol: 0.26, send: 0.4, ev: [
      ...ev(0, [[0, 2, 77], [4, 2, 81], [8, 3, 84], [12, 2, 81]]),
      ...ev(1, [[0, 2, 84], [4, 2, 86], [8, 6, 84]]),
      ...ev(2, [[0, 2, 77], [4, 2, 74], [8, 3, 77], [12, 2, 81]]),
      ...ev(3, [[0, 10, 79]]),
      ...ev(4, [[0, 2, 79], [4, 2, 84], [8, 3, 86], [12, 2, 84]]),
      ...ev(5, [[0, 2, 86], [4, 2, 88], [8, 6, 86]]),
      ...ev(6, [[0, 2, 84], [4, 2, 81], [8, 3, 79], [12, 2, 77]]),
      ...ev(7, [[0, 10, 74]]),
    ] },
    { patch: "bell", vol: 0.12, send: 0.6, ev: loopBars((b) => ev(b, [[6, 1, 89 + [0, 4, 0, -3, 2, 5, 0, -3][b]], [14, 1, 91 + [0, 2, -2, 0, 3, 2, 0, -2][b]]]), 8) },
    { patch: "pad", vol: 0.1, send: 0.5, ev: loopBars((b) => {
      const r = [65, 70, 62, 65, 67, 72, 67, 62][b];
      return ev(b, [[0, 15, r], [0, 15, r + 7]]);
    }, 8) },
    { patch: "bass", vol: 0.38, send: 0, ev: [
      ...bassBar(0, 41, "long"), ...bassBar(1, 46, "long"),
      ...bassBar(2, 38, "long"), ...bassBar(3, 41, "long"),
      ...bassBar(4, 43, "long"), ...bassBar(5, 48, "long"),
      ...bassBar(6, 43, "long"), ...bassBar(7, 38, "long"),
    ] },
  ],
  dr: loopBars((b) => drumBar(b, "soft"), 8),
};

// GENESIS · calypso beach bounce. Marimba lead, organ stabs, swing. 124 BPM.
THEMES.genesis = {
  bpm: 124, bars: 8, swing: 0.24,
  ch: [
    { patch: "marimba", vol: 0.3, send: 0.35, ev: [
      ...ev(0, [[0, 2, 65], [2, 2, 69], [4, 3, 72], [8, 2, 69], [10, 2, 72], [12, 4, 74]]),
      ...ev(1, [[0, 2, 74], [2, 2, 70], [4, 3, 67], [8, 2, 70], [10, 2, 74], [12, 4, 77]]),
      ...ev(2, [[0, 2, 76], [2, 2, 72], [4, 3, 67], [8, 2, 76], [10, 2, 74], [12, 2, 72], [14, 2, 71]]),
      ...ev(3, [[0, 3, 72], [4, 3, 69], [8, 6, 65]]),
      ...ev(4, [[0, 2, 74], [2, 2, 77], [4, 3, 81], [8, 2, 77], [10, 2, 74], [12, 4, 72]]),
      ...ev(5, [[0, 2, 70], [2, 2, 74], [4, 3, 77], [8, 2, 74], [10, 2, 70], [12, 4, 69]]),
      ...ev(6, [[0, 2, 67], [2, 2, 71], [4, 2, 72], [6, 2, 74], [8, 2, 76], [10, 2, 77], [12, 2, 79], [14, 2, 77]]),
      ...ev(7, [[0, 6, 77], [8, 6, 72]]),
    ] },
    { patch: "organ", vol: 0.1, send: 0.3, ev: [
      ...stabs(0, 69, 72), ...stabs(1, 70, 74), ...stabs(2, 72, 76), ...stabs(3, 69, 72),
      ...stabs(4, 74, 77), ...stabs(5, 70, 74), ...stabs(6, 72, 76), ...stabs(7, 69, 72),
    ] },
    { patch: "bell", vol: 0.11, send: 0.55, ev: loopBars((b) => ev(b, [[6, 1, [84, 86, 88, 84, 89, 86, 88, 89][b]], [13, 1, [89, 89, 91, 88, 93, 89, 91, 84][b]]]), 8) },
    { patch: "bass", vol: 0.45, send: 0, ev: [
      ...bassBar(0, 41, "calypso"), ...bassBar(1, 46, "calypso"),
      ...bassBar(2, 48, "calypso"), ...bassBar(3, 41, "calypso"),
      ...bassBar(4, 38, "calypso"), ...bassBar(5, 46, "calypso"),
      ...bassBar(6, 48, "calypso"), ...bassBar(7, 41, "calypso"),
    ] },
  ],
  dr: loopBars((b) => drumBar(b, "beach", b === 7), 8),
};

// WINTER · the Bear of 2014. Sparse minor lead over a cold pad. 116 BPM.
THEMES.winter = {
  bpm: 116, bars: 8,
  ch: [
    { patch: "tri", vol: 0.28, send: 0.5, ev: [
      ...ev(0, [[0, 4, 69], [4, 2, 72], [6, 2, 71], [8, 6, 69]]),
      ...ev(1, [[0, 4, 65], [4, 2, 69], [6, 2, 67], [8, 6, 65]]),
      ...ev(2, [[0, 4, 62], [4, 2, 65], [6, 2, 64], [8, 6, 62]]),
      ...ev(3, [[0, 4, 64], [4, 4, 68], [8, 8, 64]]),
      ...ev(4, [[0, 4, 69], [4, 2, 72], [6, 2, 71], [8, 6, 72]]),
      ...ev(5, [[0, 4, 74], [4, 2, 72], [6, 2, 71], [8, 6, 69]]),
      ...ev(6, [[0, 4, 68], [4, 2, 64], [6, 2, 68], [8, 6, 71]]),
      ...ev(7, [[0, 12, 69]]),
    ] },
    { patch: "bell", vol: 0.1, send: 0.7, ev: loopBars((b) => ev(b, [[10, 1, [93, 96, 91, 88, 93, 96, 92, 88][b]]]), 8) },
    { patch: "pad", vol: 0.11, send: 0.6, ev: loopBars((b) => {
      const r = [69, 65, 62, 64, 69, 65, 64, 69][b];
      return ev(b, [[0, 15, r - 12], [0, 15, r - 5]]);
    }, 8) },
    { patch: "bass", vol: 0.42, send: 0, ev: [
      ...bassBar(0, 45, "half"), ...bassBar(1, 41, "half"),
      ...bassBar(2, 38, "half"), ...bassBar(3, 40, "half"),
      ...bassBar(4, 45, "half"), ...bassBar(5, 41, "half"),
      ...bassBar(6, 40, "half"), ...bassBar(7, 45, "half"),
    ] },
  ],
  dr: loopBars((b) => drumBar(b, b % 4 === 3 ? "drive" : "bounce", b === 7), 8),
};

// NEON · night city arps + brass stabs. 144 BPM, E minor.
THEMES.neon = {
  bpm: 144, bars: 8,
  ch: [
    { patch: "pulse", vol: 0.14, send: 0.3, ev: loopBars((b) => {
      const roots = [64, 64, 60, 60, 62, 62, 59, 59];
      const r = roots[b] + 12;
      const seq = [r, r + 3, r + 7, r + 12, r + 7, r + 3, r, r + 3, r + 7, r + 12, r + 15, r + 12, r + 7, r + 3, r, r - 5];
      return seq.map((m, i) => [b * B + i, 1, m]);
    }, 8) },
    { patch: "brass", vol: 0.17, send: 0.35, ev: [
      ...ev(0, [[0, 8, 76], [8, 8, 79]]),
      ...ev(1, [[0, 8, 78], [8, 8, 76]]),
      ...ev(2, [[0, 8, 72], [8, 8, 76]]),
      ...ev(3, [[0, 16, 74]]),
      ...ev(4, [[0, 8, 76], [8, 8, 79]]),
      ...ev(5, [[0, 8, 83], [8, 8, 79]]),
      ...ev(6, [[0, 8, 78], [8, 8, 74]]),
      ...ev(7, [[0, 16, 76]]),
    ] },
    { patch: "bass", vol: 0.46, send: 0, ev: [
      ...bassBar(0, 40, "drive"), ...bassBar(1, 40, "drive"),
      ...bassBar(2, 36, "drive"), ...bassBar(3, 36, "drive"),
      ...bassBar(4, 38, "drive"), ...bassBar(5, 38, "drive"),
      ...bassBar(6, 35, "drive"), ...bassBar(7, 35, "drive"),
    ] },
  ],
  dr: loopBars((b) => drumBar(b, "drive", b % 4 === 3), 8),
};

// PRINTER · panic-comedy chromatics + cash registers. 138 BPM.
THEMES.printer = {
  bpm: 138, bars: 4,
  ch: [
    { patch: "pulse", vol: 0.24, send: 0.25, ev: [
      ...ev(0, [[0, 1, 77], [2, 1, 77], [4, 1, 76], [6, 1, 77], [8, 2, 80], [12, 2, 77], [14, 2, 75]]),
      ...ev(1, [[0, 1, 74], [2, 1, 74], [4, 1, 73], [6, 1, 74], [8, 2, 77], [12, 2, 74], [14, 2, 72]]),
      ...ev(2, [[0, 1, 77], [2, 1, 77], [4, 1, 76], [6, 1, 77], [8, 2, 80], [10, 2, 82], [12, 2, 84], [14, 2, 82]]),
      ...ev(3, [[0, 2, 80], [4, 2, 77], [6, 2, 75], [8, 2, 74], [10, 2, 72], [12, 4, 70]]),
    ] },
    { patch: "marimba", vol: 0.13, send: 0.4, ev: loopBars((b) => ev(b, [[6, 1, 89], [7, 1, 91], [14, 1, 92]]), 4) },
    { patch: "bass", vol: 0.44, send: 0, ev: [
      ...bassBar(0, 41, "oompah"), ...bassBar(1, 38, "oompah"),
      ...bassBar(2, 41, "oompah"), ...bassBar(3, 46, "oompah"),
    ] },
  ],
  dr: loopBars((b) => drumBar(b, "chaos"), 4),
};

// CORPORATE · sleek boardroom groove. Cool mallet lead, D dorian. 114 BPM.
THEMES.corporate = {
  bpm: 114, bars: 8,
  ch: [
    { patch: "marimba", vol: 0.26, send: 0.4, ev: [
      ...ev(0, [[0, 3, 74], [4, 3, 77], [8, 3, 81], [12, 4, 79]]),
      ...ev(1, [[0, 6, 77], [8, 6, 74]]),
      ...ev(2, [[0, 3, 72], [4, 3, 74], [8, 3, 77], [12, 4, 81]]),
      ...ev(3, [[0, 12, 79]]),
      ...ev(4, [[0, 3, 74], [4, 3, 77], [8, 3, 81], [12, 4, 84]]),
      ...ev(5, [[0, 6, 82], [8, 6, 79]]),
      ...ev(6, [[0, 3, 77], [4, 3, 79], [8, 3, 82], [12, 4, 81]]),
      ...ev(7, [[0, 12, 74]]),
    ] },
    { patch: "pad", vol: 0.1, send: 0.55, ev: loopBars((b) => {
      const r = [62, 65, 58, 57, 62, 67, 65, 62][b];
      return ev(b, [[0, 15, r], [0, 15, r + 7], [0, 15, r + 10]]);
    }, 8) },
    { patch: "bass", vol: 0.46, send: 0, ev: loopBars((b) => {
      const roots = [38, 41, 34, 33, 38, 43, 41, 38];
      return bassBar(b, roots[b], "synco");
    }, 8) },
  ],
  dr: loopBars((b) => drumBar(b, "tight", b === 7), 8),
};

// BOSS · mean cartoon chase. Brass riff + toms. 150 BPM, G minor.
THEMES.boss = {
  bpm: 150, bars: 4,
  ch: [
    { patch: "brass", vol: 0.24, send: 0.3, ev: [
      ...ev(0, [[0, 2, 67], [2, 2, 67], [4, 2, 70], [6, 2, 67], [8, 2, 73], [10, 2, 72], [12, 4, 67]]),
      ...ev(1, [[0, 2, 67], [2, 2, 67], [4, 2, 70], [6, 2, 67], [8, 2, 74], [10, 2, 73], [12, 4, 70]]),
      ...ev(2, [[0, 2, 75], [2, 2, 74], [4, 2, 73], [6, 2, 72], [8, 2, 70], [10, 2, 68], [12, 2, 67], [14, 2, 65]]),
      ...ev(3, [[0, 4, 63], [4, 4, 62], [8, 8, 67]]),
    ] },
    { patch: "pulse", vol: 0.14, send: 0.2, ev: loopBars((b) => {
      const r = [55, 55, 51, 50][b];
      const out = [];
      for (let s = 0; s < B; s += 2) { if (s % 6 !== 4) out.push([b * B + s, 1, r]); }
      return out;
    }, 4) },
    { patch: "bass", vol: 0.48, send: 0, ev: [
      ...bassBar(0, 43, "drive"), ...bassBar(1, 43, "drive"),
      ...bassBar(2, 39, "drive"), ...bassBar(3, 38, "drive"),
    ] },
  ],
  dr: [
    [0, 5],
    ...loopBars((b) => drumBar(b, "drive", b === 3), 4),
  ],
};

// GOLDMINE · Schiff's swagger. Brass riff, bell clinks, heavy floor. 126 BPM.
THEMES.goldmine = {
  bpm: 126, bars: 8,
  ch: [
    { patch: "brass", vol: 0.22, send: 0.3, ev: [
      ...ev(0, [[0, 3, 67], [4, 1, 70], [6, 1, 72], [8, 4, 73], [12, 4, 72]]),
      ...ev(1, [[0, 3, 70], [4, 1, 72], [6, 1, 73], [8, 8, 75]]),
      ...ev(2, [[0, 3, 67], [4, 1, 70], [6, 1, 72], [8, 4, 73], [12, 4, 75]]),
      ...ev(3, [[0, 4, 74], [4, 4, 72], [8, 8, 70]]),
      ...ev(4, [[0, 3, 72], [4, 1, 75], [6, 1, 77], [8, 4, 79], [12, 4, 77]]),
      ...ev(5, [[0, 3, 75], [4, 1, 77], [6, 1, 79], [8, 8, 80]]),
      ...ev(6, [[0, 2, 79], [2, 2, 77], [4, 2, 75], [6, 2, 73], [8, 2, 72], [10, 2, 70], [12, 2, 68], [14, 2, 67]]),
      ...ev(7, [[0, 12, 67]]),
    ] },
    { patch: "bell", vol: 0.12, send: 0.5, ev: loopBars((b) => ev(b, [[2, 1, 91], [6, 1, 91], [10, 1, 94], [14, 1, 91]]), 8) },
    { patch: "bass", vol: 0.46, send: 0, ev: loopBars((b) => {
      const roots = [36, 36, 36, 34, 41, 41, 39, 36];
      return bassBar(b, roots[b], "oompah");
    }, 8) },
  ],
  dr: loopBars((b) => {
    const d = drumBar(b, "tight", b === 7);
    d.push([b * B + 8, 4]);
    return d;
  }, 8),
};

// ONE CHAIR · invincible hero brass. 150 BPM, C major.
THEMES.chair = {
  bpm: 150, bars: 4,
  ch: [
    { patch: "brass", vol: 0.28, send: 0.35, ev: [
      ...ev(0, [[0, 2, 72], [2, 2, 76], [4, 2, 79], [6, 2, 84], [8, 2, 79], [10, 2, 84], [12, 4, 88]]),
      ...ev(1, [[0, 2, 86], [2, 2, 84], [4, 2, 81], [6, 2, 84], [8, 8, 86]]),
      ...ev(2, [[0, 2, 72], [2, 2, 77], [4, 2, 81], [6, 2, 84], [8, 2, 81], [10, 2, 84], [12, 4, 89]]),
      ...ev(3, [[0, 2, 88], [2, 2, 86], [4, 2, 84], [6, 2, 83], [8, 8, 84]]),
    ] },
    { patch: "pulse", vol: 0.1, send: 0.25, ev: loopBars((b) => {
      const r = [72, 71, 74, 76][b];
      const out = [];
      for (let s = 0; s < B; s += 2) out.push([b * B + s, 1, r + [0, 4, 7, 4][(s / 2) % 4]]);
      return out;
    }, 4) },
    { patch: "bass", vol: 0.48, send: 0, ev: [
      ...bassBar(0, 36, "drive"), ...bassBar(1, 43, "drive"),
      ...bassBar(2, 41, "drive"), ...bassBar(3, 43, "drive"),
    ] },
  ],
  dr: [
    [0, 5],
    ...loopBars((b) => drumBar(b, "drive", b === 3), 4),
  ],
};

// VICTORY · trophy jingle. "No second best" cadence. 140 BPM.
THEMES.victory = {
  bpm: 140, bars: 4,
  ch: [
    { patch: "brass", vol: 0.28, send: 0.4, ev: [
      ...ev(0, [[0, 2, 72], [2, 2, 76], [4, 2, 79], [6, 2, 84], [8, 2, 79], [10, 2, 84], [12, 4, 88]]),
      ...ev(1, [[0, 12, 91]]),
      ...ev(2, [[0, 2, 89], [2, 2, 88], [4, 2, 86], [6, 2, 84], [8, 4, 86], [12, 4, 88]]),
      ...ev(3, [[0, 14, 84]]),
    ] },
    { patch: "marimba", vol: 0.16, send: 0.4, ev: [
      ...ev(0, [[0, 2, 64], [4, 2, 67], [8, 2, 72], [12, 2, 76]]),
      ...ev(1, [[0, 2, 79], [4, 2, 84], [8, 4, 79]]),
      ...ev(2, [[0, 8, 77], [8, 8, 79]]),
      ...ev(3, [[0, 14, 76]]),
    ] },
    { patch: "bass", vol: 0.42, send: 0, ev: [
      ...bassBar(0, 36, "walk"), ...bassBar(1, 40, "walk"),
      ...bassBar(2, 41, "walk"), ...bassBar(3, 36, "long"),
    ] },
  ],
  dr: [
    ...drumBar(0, "bounce"), ...drumBar(1, "drive"), ...drumBar(2, "drive", true),
    [3 * B, 5], [3 * B + 8, 4],
  ],
};

// RESULTS · soft tally loop with sat ticks. 100 BPM.
THEMES.results = {
  bpm: 100, bars: 4, swing: 0.18,
  ch: [
    { patch: "marimba", vol: 0.18, send: 0.45, ev: [
      ...ev(0, [[0, 3, 76], [8, 3, 79]]),
      ...ev(1, [[0, 3, 81], [8, 3, 79]]),
      ...ev(2, [[0, 3, 77], [8, 3, 76]]),
      ...ev(3, [[0, 8, 74]]),
    ] },
    { patch: "bell", vol: 0.12, send: 0.6, ev: loopBars((b) => ev(b, [[4, 1, 96], [10, 1, 96], [13, 1, 98]]), 4) },
    { patch: "pad", vol: 0.09, send: 0.55, ev: loopBars((b) => {
      const r = [69, 65, 62, 67][b];
      return ev(b, [[0, 15, r - 12], [0, 15, r - 5]]);
    }, 4) },
    { patch: "bass", vol: 0.36, send: 0, ev: [
      ...bassBar(0, 45, "long"), ...bassBar(1, 41, "long"),
      ...bassBar(2, 38, "long"), ...bassBar(3, 43, "long"),
    ] },
  ],
  dr: loopBars((b) => drumBar(b, "soft"), 4),
};

export const MUSIC_KEYS = Object.keys(THEMES);
