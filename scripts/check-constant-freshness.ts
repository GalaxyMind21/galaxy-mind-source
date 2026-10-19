// Run: npx tsx scripts/check-constant-freshness.ts [--strict]
//
// Flags hand-sourced, dated treasury constants (share counts in
// lib/treasury-shares.ts, senior claims in lib/cebe.ts) that have aged
// past their refresh cadence. These figures feed gross/net mNAV, the
// cheapest-callout, the /fit diversifier pick, and BPS/Amplification, so
// a silently stale constant degrades real numbers. Default mode prints
// status and exits 0 (informational); --strict exits 1 when anything is
// stale, so it can gate CI. Turns the three prose "refresh often"
// reminders scattered across the code into one guard.

import { checkConstantsFreshness } from "../src/lib/constants-freshness";

const strict = process.argv.includes("--strict");
const rows = checkConstantsFreshness(new Date());

console.log("\n📅 Treasury constant freshness\n");

let staleCount = 0;
for (const r of rows) {
  const mark = r.stale ? "✗" : "✓";
  if (r.stale) staleCount++;
  console.log(
    `  ${mark} ${r.label.padEnd(22)} asOf ${r.asOf} · ${String(r.ageDays).padStart(3)}d old (cadence ${r.cadenceDays}d)`,
  );
}

if (staleCount === 0) {
  console.log(`\n✓ all ${rows.length} constants within cadence`);
  process.exit(0);
}

console.log(
  `\n⚠ ${staleCount}/${rows.length} constant(s) past cadence · refresh sharesM/asOf/source from the latest filing.`,
);
process.exit(strict ? 1 : 0);
