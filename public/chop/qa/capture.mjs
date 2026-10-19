// CHOP · qa/capture.mjs — the ONE repeatable capture condition.
//
// WHY THIS FILE EXISTS
//   Twice in one session I compared two histograms taken at different
//   moments in a run and drew a conclusion from the difference. A
//   whole-frame luminance histogram is dominated by whether an armed note
//   happens to be on screen at that instant, so it swings ~0.10 in
//   `fracMid` between two frames of the SAME build. Any effect smaller
//   than that is unmeasurable unless the capture condition is pinned.
//
//   It also fixes a subtler trap. A naive rig that loads the page, clicks
//   CHOP, waits and screenshots captures a frame no player ever sees:
//     - a fresh profile auto-runs the tutorial (tutseen < 3), and the
//       tutorial only advances on LANDED cuts, so a rig that never cuts
//       sits on step 1 with one note and a teach card, forever;
//     - LEADIN_BARS = 4 makes the first ~7.5s note-free by design;
//     - onsetTierFor clamps the first 3 bars to tier 0 on every run;
//     - a fresh profile is runIdx 0 on PLEB — the emptiest cell there is.
//   Every panel round before this one was judged on some mixture of those.
//
// USAGE (in the page console, or via a devtools MCP evaluate):
//   const cap = await import('/chop/qa/capture.mjs');
//   await cap.armed();     // freeze on an armed note — the money moment
//   await cap.drop();      // freeze inside the drop
//   await cap.measure();   // numbers for the frozen frame

const LS = {
  // A VETERAN profile: tutorial retired, HODLER, enough runs that the
  // per-session ramp is out of the way. This is the state most frames a
  // real player sees are drawn in.
  "gm:chop:tutseen": "3",
  "gm:chop:runs": "6",
  "gm:chop:diff": "hodler",
  "gm:chop:taught": "1",
  "gm:chop:c21": "1",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function seed() {
  for (const [k, v] of Object.entries(LS)) {
    try { localStorage.setItem(k, v); } catch { /* private mode */ }
  }
}

/** Boot, skip the note-free lead-in, and autoplay until the combo is fat. */
export async function warm({ seconds = 25 } = {}) {
  const S = window.__CHOP;
  if (!S) throw new Error("__CHOP handle missing — is the game loaded?");
  const start = document.getElementById("boot-start");
  if (start && !document.getElementById("boot").classList.contains("hidden")) start.click();
  await sleep(9000); // LEADIN_BARS = 4 -> ~7.5s note-free, plus decode slack
  if (window.__CAPAUTO) clearInterval(window.__CAPAUTO);
  // strokeCut, NOT autoCut. autoCut calls cutNote() directly and never
  // touches the trail buffer, so every frame it produces is missing the
  // swipe — the game's defining verb. Eight critique rounds in a row said
  // "cannot tell it is a slicer" while scoring frames in which the slice
  // was structurally impossible to depict. The rig now drives the same
  // feedSample() path a thumb does.
  window.__CAPAUTO = setInterval(() => {
    for (const n of S.inGate()) if (Math.abs(n.dt) < 0.05) S.strokeCut();
  }, 16);
  await sleep(seconds * 1000);
}

/**
 * Freeze on an ARMED note — the instant the player is acting on, and the
 * only frame worth judging composition or focal hierarchy from.
 */
export async function armed({ warmSeconds = 25 } = {}) {
  seed();
  await warm({ seconds: warmSeconds });
  const S = window.__CHOP;
  for (let i = 0; i < 1200; i++) {
    await sleep(8);
    const g = S.inGate();
    if (g.length && Math.abs(g[0].dt) < 0.07) break;
  }
  S.freeze(true);
  return measure();
}

/**
 * Freeze shortly after a WHALE cut — the loudest frame the game can make.
 *
 * CAPTURE BOTH BEFORE YOU SHIP. A visual change can improve the armed
 * frame and wreck the cut frame in the same edit, and the panel scores
 * both. That is not hypothetical: cooling the molten cut face made the
 * armed frame no worse and turned the drop frame's two biggest objects
 * into muddy brown slabs — 6.75 to 5.625 in one commit, shipped because
 * only frame A was looked at.
 */
export async function drop({ warmSeconds = 20 } = {}) {
  seed();
  await warm({ seconds: warmSeconds });
  const S = window.__CHOP;
  for (let i = 0; i < 1500; i++) {
    await sleep(50);
    if (S.state().music.phase === "drop") break;
  }
  await sleep(2200);
  const before = S.state().hits;
  for (let i = 0; i < 500; i++) {
    await sleep(8);
    if (S.state().hits > before) break;
  }
  await sleep(55); // let the burst bloom
  S.freeze(true);
  return measure();
}

/** Every number the tuning loop is allowed to argue from. */
export async function measure() {
  const S = window.__CHOP;
  const h = await S.histogram();
  const notes = S.liveNotes();
  const deb = S.debris();
  const venue = S.venueNdc();
  const fit = S.laneFit();
  const big = (a) => a.reduce((m, x) => Math.max(m, x.screenHeightPct), 0);
  return {
    // frame value structure — the headline the blind panels kept flagging
    fracMid: h.fracMid, fracDark: h.fracDark, fracHot: h.fracHot, meanLuma: h.meanLuma,
    // focal hierarchy: aftermath must never out-mass the subject
    biggestLiveNotePct: +big(notes).toFixed(2),
    biggestDebrisPct: +big(deb).toFixed(2),
    debrisToNoteRatio: +(big(deb) / Math.max(0.01, big(notes))).toFixed(2),
    // density
    liveNotes: notes.length,
    // fairness + venue visibility
    laneFitAllFit: fit.allFit,
    worstLaneNdcX: Math.max(...fit.rows.map((r) => r.worstNdcX)),
    venueOnScreen: `${venue.onScreen}/${venue.total}`,
    // capture provenance — a reading without this is not comparable
    phase: S.state().music.phase,
    combo: S.state().combo,
    difficulty: localStorage.getItem("gm:chop:diff"),
  };
}
