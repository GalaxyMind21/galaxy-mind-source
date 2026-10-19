/**
 * Moon terrain invariants · the Runner's overtime level generator.
 * Determinism (board fairness into overtime), runnable spacing, and
 * escalating difficulty by chunk.
 */

import { buildMoonChunk, MOON_CHUNK_LEN } from "../src/app/gauntlet/moon";

let failures = 0;
function check(desc: string, ok: boolean) {
  if (ok) console.log(`  PASS  ${desc}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${desc}`);
  }
}

console.log("\n🌙  Moon terrain\n");

const SEED = 0x2b0b1234;

{
  const a = buildMoonChunk(SEED, 3);
  const b = buildMoonChunk(SEED, 3);
  check(
    "deterministic · same (seed,chunk) → identical",
    JSON.stringify(a) === JSON.stringify(b),
  );
  const c = buildMoonChunk(SEED, 4);
  check("different chunk → different terrain", JSON.stringify(a) !== JSON.stringify(c));
  const d = buildMoonChunk(SEED ^ 0x4d4f4f4e, 3);
  check("different seed → different terrain", JSON.stringify(a) !== JSON.stringify(d));
}

{
  const c = buildMoonChunk(SEED, 5);
  check("chunk length", c.norm.length === MOON_CHUNK_LEN && c.spike.length === MOON_CHUNK_LEN);
  check(
    "norm in runnable band [0.42,0.6], all finite",
    c.norm.every((n) => Number.isFinite(n) && n >= 0.42 && n <= 0.6),
  );
  check("spikes finite and non-negative", c.spike.every((h) => Number.isFinite(h) && h >= 0));
}

{
  // Rocks must never sit closer than 4 days · always jumpable at speed.
  let minGap = Infinity;
  for (let chunk = 0; chunk < 10; chunk++) {
    const { spike } = buildMoonChunk(SEED, chunk);
    let last = -Infinity;
    for (let d = 0; d < spike.length; d++) {
      if (spike[d] > 0) {
        minGap = Math.min(minGap, d - last);
        last = d;
      }
    }
  }
  check("no two rocks within 4 days (jumpable spacing)", minGap >= 4);
}

{
  // Difficulty escalates · early chunks are sparser than deep chunks.
  const countSpikes = (chunk: number) =>
    buildMoonChunk(SEED, chunk).spike.filter((h) => h > 0).length;
  const early = countSpikes(0) + countSpikes(1) + countSpikes(2);
  const deep = countSpikes(8) + countSpikes(9) + countSpikes(10);
  check(`deep chunks have more rocks (${early} → ${deep})`, deep > early);
  const tallEarly = Math.max(...buildMoonChunk(SEED, 0).spike);
  const tallDeep = Math.max(...buildMoonChunk(SEED, 12).spike);
  check(`deep rocks are taller (${tallEarly.toFixed(0)} → ${tallDeep.toFixed(0)})`, tallDeep > tallEarly);
}

{
  // Orbs exist · the moon still pays sats.
  const anyOrbs = [0, 1, 2, 3].some((c) => buildMoonChunk(SEED, c).orb.some(Boolean));
  check("moon still spawns sat orbs", anyOrbs);
}

if (failures > 0) {
  console.error(`\n✗ ${failures} moon invariant(s) failed`);
  process.exit(1);
}
console.log("\n✓ all moon invariants hold.");
