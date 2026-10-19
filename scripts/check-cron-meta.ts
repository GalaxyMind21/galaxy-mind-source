/**
 * Cron-health drift guard · asserts every cron scheduled in vercel.json
 * has a matching entry in CRON_META (src/lib/cron-health.ts).
 *
 * /api/admin/cron-health only reports crons it knows about. A
 * cron added to vercel.json without a CRON_META entry is invisible to
 * the liveness dashboard forever — it can silently stop firing and
 * nothing flags it (this happened to weekly-pulse, found 2026-07-11).
 * This check makes the omission a verify-suite failure instead.
 *
 * Direction is deliberately one-way (vercel.json ⊆ CRON_META):
 * an extra CRON_META entry for an unscheduled cron reads as
 * permanently stale / historical — visible and harmless — while the
 * reverse is a blind spot.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CRON_META } from "../src/lib/cron-health";

const vercelJson = JSON.parse(
  readFileSync(join(__dirname, "..", "vercel.json"), "utf8"),
) as { crons?: { path: string; schedule: string }[] };

const scheduled = (vercelJson.crons ?? []).map((c) => {
  const m = c.path.match(/^\/api\/cron\/([a-z0-9-]+)$/);
  if (!m) {
    console.error(`✗ unexpected cron path shape in vercel.json: ${c.path}`);
    process.exit(1);
  }
  return m[1];
});

const known = new Set(CRON_META.map((m) => m.name));
const missing = scheduled.filter((slug) => !known.has(slug));

if (missing.length > 0) {
  console.error(
    `✗ ${missing.length} cron(s) scheduled in vercel.json but missing from CRON_META (src/lib/cron-health.ts):`,
  );
  for (const slug of missing) console.error(`    ${slug}`);
  console.error(
    "  → add { name, expectedIntervalHours } so /api/admin/cron-health can flag it when stale.",
  );
  process.exit(1);
}


console.log(
  `✓ all ${scheduled.length} vercel.json crons present in CRON_META (${known.size} entries).`,
);
