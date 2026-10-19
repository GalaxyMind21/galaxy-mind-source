// Paste-run in the page (or via the QA rig) to re-derive audio/manifest.json.
// Committed procedure lives in scripts/derive-chop-beatgrid.md.
export default async function derive() {
  const M = await import('/chop/js/beatgrid.js');
  const man = await (await fetch('/chop/audio/manifest.json')).json();
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const rows = [];
  for (const t of man.tracks) {
    const buf = await ac.decodeAudioData(
      await (await fetch('/chop/audio/' + t.file)).arrayBuffer());
    const g = M.analyseBeatGrid(buf, { hintBpm: t.bpm, searchWidth: 14 });
    const beat = g.beatSec;

    // ── bar-level tiebreak ──────────────────────────────────────────
    // The beat-level phase search can lock onto the backbeat. Score the
    // four candidate BAR phases (p, p+1, p+2, p+3 beats) using kick-band
    // energy at 4-beat spacing; a four-on-the-floor bar has its heaviest
    // kick on beat 1, so the bar test breaks ties the beat test cannot.
    const { data, rate } = M.toMono(buf, 12000);
    const low = M.onsetEnvelope(data, rate, 64); // full band is fine for relative bar weight
    const bf = beat * low.fps;
    const barScore = (p) => {
      let a = 0, n = 0;
      for (let k = 0; ; k++) {
        const i = Math.round(p + k * bf * 4);
        if (i >= low.env.length) break;
        a += Math.max(low.env[i], low.env[i - 1] || 0, low.env[i + 1] || 0);
        n++;
      }
      return n ? a / n : 0;
    };
    const p0 = g.offsetSec * low.fps;
    const bars = [0, 1, 2, 3].map((k) => ({ k, s: barScore(p0 + k * bf) }));
    bars.sort((a, b) => b.s - a.s);

    // ── candidate phases, normalised to the smallest magnitude ───────
    // The grid is periodic, so 0.96 of a beat IS −0.04 of a beat. Report
    // the signed distance to the nearest grid line, which is the number
    // that actually describes the error.
    const norm = (x) => { let v = x % beat; if (v > beat / 2) v -= beat; if (v < -beat / 2) v += beat; return v; };
    const primary = norm(g.offsetSec);
    const rival = norm(g.offsetSec + beat / 2);

    // ON-GRID PRIOR: these packs are authored from 0:00 on the grid, so a
    // phase near zero is far more likely a priori than one near half a
    // beat. Use that prior ONLY to break a tie the audio cannot break
    // (confidence below 1.30) — never to override a confident reading.
    const useRival = g.phaseConfidence < 1.30 && Math.abs(rival) < Math.abs(primary) - 0.02;
    const chosen = useRival ? rival : primary;

    rows.push({
      file: t.file, manifestBpm: t.bpm, bpm: g.bpm,
      beatMs: +(beat * 1000).toFixed(1),
      rawOffsetMs: +(g.offsetSec * 1000).toFixed(0),
      primaryMs: +(primary * 1000).toFixed(0),
      rivalMs: +(rival * 1000).toFixed(0),
      chosenMs: +(chosen * 1000).toFixed(0),
      usedRival: useRival,
      barWinner: bars[0].k, barMargin: +(bars[0].s / Math.max(1e-9, bars[1].s)).toFixed(2),
      conf: g.phaseConfidence, err: g.medianBeatToOnsetMs,
      stab: g.tempoStability, trust: M.gridIsTrustworthy(g),
      // offsetSec must be >= 0 (it is a buffer position). A negative phase
      // means "the downbeat is earlier than 0", which for a periodic grid
      // is the same as one beat later.
      offsetSec: +(chosen < 0 ? chosen + beat : chosen).toFixed(4),
    });
  }
  return rows;
}
