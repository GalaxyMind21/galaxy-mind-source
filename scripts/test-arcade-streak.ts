/**
 * Cross-cabinet arcade streak invariants · consecutive-UTC-day math and
 * the today/yesterday active window. Guards the day-boundary logic that
 * decides whether a run extends, holds, or resets the streak.
 */

import { recordArcadePlay, readActiveArcadeStreak } from "../src/lib/arcade-streak";

// Minimal localStorage stub · the lib reads window.localStorage only at
// call time (never at import), so installing it before the first call is
// enough even though the import is hoisted above this line.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

let failures = 0;
function check(desc: string, ok: boolean) {
  if (ok) console.log(`  PASS  ${desc}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${desc}`);
  }
}

const DAY = 86_400_000;
// A fixed UTC midnight · noon offsets exercise the midnight-align floor.
const D0 = Date.UTC(2026, 6, 10);
const noon = (dayMs: number) => dayMs + DAY / 2;

console.log("\n🎮  Arcade streak\n");

{
  store.clear();
  check("fresh play → 1", recordArcadePlay(noon(D0)) === 1);
  check("active after first play", readActiveArcadeStreak(noon(D0)) === 1);
}

{
  store.clear();
  recordArcadePlay(noon(D0));
  check("same-day replay stays 1", recordArcadePlay(D0 + DAY - 1) === 1);
  check("still active same day", readActiveArcadeStreak(noon(D0)) === 1);
}

{
  store.clear();
  recordArcadePlay(noon(D0));
  recordArcadePlay(noon(D0 + DAY));
  check("consecutive day → 2", readActiveArcadeStreak(noon(D0 + DAY)) === 2);
  recordArcadePlay(noon(D0 + 2 * DAY));
  check("third consecutive → 3", readActiveArcadeStreak(noon(D0 + 2 * DAY)) === 3);
}

{
  store.clear();
  recordArcadePlay(noon(D0));
  recordArcadePlay(noon(D0 + DAY));
  // Skip D0+2, play D0+3 · the chain broke.
  check("gap resets to 1", recordArcadePlay(noon(D0 + 3 * DAY)) === 1);
}

{
  store.clear();
  recordArcadePlay(noon(D0)); // len 1, last = D0
  // Yesterday still counts as active (today can extend it).
  check("yesterday still active", readActiveArcadeStreak(noon(D0 + DAY)) === 1);
  // Two days later with no play · stale, reads 0.
  check("two-day gap reads 0", readActiveArcadeStreak(noon(D0 + 2 * DAY)) === 0);
}

{
  store.clear();
  check("no history reads 0", readActiveArcadeStreak(noon(D0)) === 0);
}

if (failures > 0) {
  console.error(`\n✗ ${failures} arcade-streak invariant(s) failed`);
  process.exit(1);
}
console.log("\n✓ all arcade-streak invariants hold.");
