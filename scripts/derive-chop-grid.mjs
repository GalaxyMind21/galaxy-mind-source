// Derive a CHOP radio track's beat grid in Node, using the SAME detector
// the game ships (public/chop/js/beatgrid.js) — never a paraphrase.
//
//   node scripts/derive-chop-grid.mjs <file.m4a> [...more]
//
// ffmpeg decodes to raw f32le PCM and a tiny shim presents it as the
// AudioBuffer shape analyseBeatGrid expects. Measure the SHIPPED m4a, not
// the source: AAC-LC decode adds encoder priming at the head (~48 ms),
// which is exactly the phase error a "the pack starts at 0:00" assumption
// cannot see (see beatgrid.js's own header for the case history).
import { execFileSync } from "node:child_process";
import { analyseBeatGrid, gridIsTrustworthy } from "../public/chop/js/beatgrid.js";

const RATE = 44100;

function decode(path) {
  const raw = execFileSync("ffmpeg", [
    "-v", "error", "-i", path, "-vn",
    "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "2", "-ar", String(RATE), "-",
  ], { maxBuffer: 1 << 30 });
  const inter = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const frames = Math.floor(inter.length / 2);
  const L = new Float32Array(frames), R = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { L[i] = inter[i * 2]; R[i] = inter[i * 2 + 1]; }
  return {
    sampleRate: RATE, length: frames, numberOfChannels: 2,
    duration: frames / RATE,
    getChannelData: (c) => (c === 0 ? L : R),
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/derive-chop-grid.mjs <file.m4a> [...]");
  process.exit(2);
}
for (const f of files) {
  const buf = decode(f);
  // No hint: an unknown track must not be handed the answer we hope for.
  const g = analyseBeatGrid(buf, {});
  const trusted = gridIsTrustworthy(g);
  console.log(JSON.stringify({
    file: f.split("/").pop(),
    durationSec: Math.round(buf.duration * 10) / 10,
    ...g,
    TRUSTED: trusted,
  }));
}
