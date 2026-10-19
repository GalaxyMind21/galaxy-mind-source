# Re-deriving CHOP's audio beat grid

Run this after **any** change to the files in `public/chop/audio/`, and
whenever someone claims the chart is out of time with the music.

The whole game is "cut on the beat", so `manifest.json`'s `bpm` and
`offsetSec` are load-bearing: they are what the note grid is rebased onto
when a recorded track takes over from the generated bed
(`rebaseGridToRadio` in `music.js`). A wrong `bpm` drifts the chart out
over the ~70 s of a block; a wrong `offsetSec` is wrong from note one.

## The procedure

```bash
./node_modules/.bin/next dev -p 3137
```

Open `http://localhost:3137/chop` and in the console:

```js
const m = await import('/chop/qa/derive-grid.js');
console.table(await m.default());
```

That reports, per track, a detected tempo and phase plus the confidence
evidence. **Do not paste its tempo into the manifest.** Use it to generate
candidates, then confirm with the fixed-grid test below.

## The fixed-grid test — this is the one that decides

Impose a *fixed* candidate tempo, slide the phase, and record the median
distance from each beat to the nearest real onset across the **whole**
track. A correct tempo produces a sharp minimum (~2-3 ms here); a wrong
one drifts and cannot, no matter what phase you give it. It involves no
search, so it cannot inherit a search's bias.

Ranked output from the 2026-07-29 run:

| track             | best | median | runner-up | verdict                    |
|-------------------|------|--------|-----------|----------------------------|
| ascend.m4a        | 130  | 2.5 ms | 129 → 8.6 | manifest correct           |
| flying-temple.m4a | 128  | 3.0 ms | 129 → 7.3 | manifest correct           |
| starting-over.m4a | 124  | 8.0 ms | 125 → 10.7| **manifest was 122, wrong** |

Measured phase with the correct tempo came out at 5–16 ms, confirming
`offsetSec: 0` for all six tracks.

## The trap that cost an afternoon

The first estimator was an autocorrelation/comb search, and it "found"
tempo errors on **five of six** tracks — 128 → 127.70, 130 → 129.90, and
so on. Those were not errors in the tracks. Probing the onset envelope
with `env[Math.round(i + lag)]` quantises every probe to one 5.3 ms frame,
which systematically favours slightly shorter lags. Fed a **synthetic**
track generated at exactly 128.000 BPM, that estimator returned 127.700 —
the very "correction" it was proposing for a real file. It was measuring
itself.

Two lessons are now baked into the code:

1. `beatgrid.js` interpolates into the envelope (`lerpAt`) instead of
   rounding, and reports tempo to 0.01 BPM rather than three decimals of
   false precision. Ground truth suite: ±0.16 BPM, ±12 ms phase.
2. **Verify the instrument before acting on a surprising reading.**
   Synthesise a click track at a tempo and phase you control, and require
   the analyser to recover them, before you believe anything it says about
   a file you don't control.

## What this did *not* explain

The grid was largely exonerated — and the operator's "the chops aren't
lined up with the beats" was still real. The dominant term is **device
output latency**, not the chart: WebKit does not implement
`AudioContext.outputLatency`, and the code was falling back to
`baseLatency` (~5 ms), a different quantity, against a true 100–200 ms on
iOS. See `public/chop/js/latency.js` and `scripts/test-chop-latency.ts`.
