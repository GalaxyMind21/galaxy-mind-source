/**
 * The modal focus trap must not depend on `onClose`.
 *
 * This regressed once already. use-modal-a11y.ts carries a long comment
 * explaining the 2026-07-25 fix — onClose in a ref, out of the deps —
 * and the ref was still there, still kept current, and simply not used:
 * the Escape handler called onClose() directly and the dep array still
 * listed it. A comment describing a fix is not the fix.
 *
 * Why it matters: every call site passes a fresh inline arrow, so with
 * onClose in the deps the effect tears down and re-runs on any parent
 * render while the dialog is OPEN. Cleanup returns focus to the trigger
 * and setup re-focuses the panel, so a filter tick or a live-price poll
 * yanks focus off whatever the user was typing in — and the re-run
 * re-reads document.activeElement as the "trigger", so the restore
 * target drifts to whatever was focused mid-dialog.
 */
import { readFileSync } from "node:fs";

let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    fail++;
    console.error(`  ✗ ${name}${detail ? " · " + detail : ""}`);
  }
}

console.log("\nmodal a11y focus trap\n");

const src = readFileSync("src/lib/use-modal-a11y.ts", "utf8");

const deps = src.match(/\}, \[([^\]]*)\]\);/);
check("the effect has a dep array", !!deps);
check(
  `onClose is NOT in the effect deps (found: [${deps ? deps[1].trim() : "?"}])`,
  !!deps && !/\bonClose\b/.test(deps[1]),
  "put onClose in onCloseRef and drop it from the deps",
);
check(
  "the ref is declared and kept current",
  /const onCloseRef = useRef\(onClose\);/.test(src) &&
    /onCloseRef\.current = onClose;/.test(src),
);
check(
  "the ref is actually USED (this is the half that went missing)",
  /onCloseRef\.current\(\)/.test(src),
);
// Any bare onClose() call inside the hook body defeats the ref.
const bareCalls = [...src.matchAll(/(?<!onCloseRef\.current)(?<![\w.])onClose\(\)/g)];
check(
  `no bare onClose() call in the hook body (found ${bareCalls.length})`,
  bareCalls.length === 0,
);

if (fail) {
  console.error(`\n${fail} failure(s)\n`);
  process.exit(1);
}
console.log("\nAll modal-a11y checks passed.\n");
