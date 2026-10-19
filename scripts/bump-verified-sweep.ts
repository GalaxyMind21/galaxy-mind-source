/**
 * One-shot operator sweep bump (2026-08-13).
 *
 * The operator manually walked the whole roster on 2026-08-13 and
 * confirmed every merchant still accepts bitcoin. This rewrites
 * `verifiedAt` to that date's UTC midnight for every vendor EXCEPT any
 * handle passed to --hold, which is how a merchant the operator wants to
 * re-check individually keeps its older, honest date.
 *
 * This script exists so the bump is auditable: it prints every change and
 * refuses to run without --apply. It is deliberately NOT part of the
 * normal cadence — the rolling batches in scripts/reverify-vendors.ts are.
 * Delete it once the sweep is committed if it starts looking like a
 * shortcut around real verification, which is the only thing it must
 * never become.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/lib/vendors.ts";
const SWEEP_DATE = "2026-08-13";
const SWEEP_TS = Math.floor(Date.parse(`${SWEEP_DATE}T00:00:00Z`) / 1000);

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const hold = new Set(
  args
    .flatMap((a, i) => (a === "--hold" ? [args[i + 1]] : []))
    .filter((h): h is string => Boolean(h))
    .map((h) => h.toLowerCase()),
);

const src = readFileSync(FILE, "utf8");

// Split on entry boundaries so a `verifiedAt` is always attributed to the
// handle it belongs to. Entries look like `{ ... handle: "x", ... }`.
const entryRe = /handle:\s*"([^"]+)"([\s\S]*?)verifiedAt:\s*(\d+)/g;

let changed = 0;
let held = 0;
let already = 0;
const notes: string[] = [];

const out = src.replace(entryRe, (whole, handle: string, mid: string, ts: string) => {
  const h = String(handle);
  if (hold.has(h.toLowerCase())) {
    held++;
    notes.push(`  HOLD    ${h} — left at ${ts}`);
    return whole;
  }
  if (Number(ts) === SWEEP_TS) {
    already++;
    return whole;
  }
  changed++;
  const ageDays = Math.floor((SWEEP_TS - Number(ts)) / 86400);
  if (ageDays >= 90) notes.push(`  BUMP    ${h} — was ${ageDays}d old`);
  return `handle: "${h}"${mid}verifiedAt: ${SWEEP_TS}`;
});

console.log(`Sweep date ${SWEEP_DATE} (ts ${SWEEP_TS})`);
for (const n of notes.slice(0, 60)) console.log(n);
if (notes.length > 60) console.log(`  … and ${notes.length - 60} more`);
console.log(`\n  bumped: ${changed}   held: ${held}   already-current: ${already}`);

if (!apply) {
  console.log("\n  DRY RUN — pass --apply to write.");
  process.exit(0);
}
writeFileSync(FILE, out);
console.log(`\n  ✓ wrote ${FILE}`);
