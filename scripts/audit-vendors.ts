#!/usr/bin/env tsx
/**
 * audit-vendors · liveness + activity check for the vendor directory.
 *
 * Run via:
 *   npx tsx scripts/audit-vendors.ts             # all vendors
 *   npx tsx scripts/audit-vendors.ts --handle X  # single vendor
 *   npx tsx scripts/audit-vendors.ts --json      # machine-readable
 *
 * The per-platform probe implementations live in
 * scripts/lib/vendor-probes.ts (shared with scripts/reverify-vendors.ts,
 * the batch re-verification sweep tool). See that module's header for
 * exactly what gets checked per platform.
 *
 * Output: a per-vendor report with a status emoji:
 *   ✓ alive · last activity recent
 *   ⚠ alive but no recent activity (stale-active)
 *   ⚠ activity check failed (couldn't verify, manual check needed)
 *   ✗ profile gone · candidate for removal
 *
 * The script NEVER auto-modifies vendors.ts · it only produces a
 * report. Removal decisions are always human.
 *
 * Network: respects a 5-second timeout per request, runs all checks
 * in parallel batches of 8 to keep total runtime under a minute even
 * for the full 56-vendor sweep. Set AUDIT_OFFLINE=1 to skip all
 * network calls and just exercise the script's plumbing.
 */
import { VENDORS } from "../src/lib/vendors";
import {
  auditOne,
  offline,
  PARALLEL_BATCH_SIZE,
  STALE_ACTIVITY_DAYS,
  type AuditResult,
  type AuditStatus,
} from "./lib/vendor-probes";

const C = {
  ok: "\x1b[32m✓\x1b[0m",
  warn: "\x1b[33m⚠\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  accent: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

const args = process.argv.slice(2);
const handleFilter = (() => {
  const i = args.indexOf("--handle");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();
const jsonOnly = args.includes("--json");

function emojiFor(s: AuditStatus): string {
  switch (s) {
    case "alive":
      return C.ok;
    case "stale_active":
      return C.warn;
    case "unknown":
      return C.warn;
    case "gone":
      return C.fail;
  }
}

async function main(): Promise<void> {
  const targets = handleFilter
    ? VENDORS.filter((v) => v.handle === handleFilter)
    : VENDORS;
  if (handleFilter && targets.length === 0) {
    console.error(`No vendor found with handle "${handleFilter}"`);
    process.exit(1);
  }

  if (!jsonOnly) {
    console.log(
      C.bold(`Auditing ${targets.length} vendor${targets.length === 1 ? "" : "s"}...`),
    );
    if (offline) console.log(C.dim("  (AUDIT_OFFLINE=1 · network calls skipped)"));
    console.log();
  }

  const results: AuditResult[] = [];
  for (let i = 0; i < targets.length; i += PARALLEL_BATCH_SIZE) {
    const batch = targets.slice(i, i + PARALLEL_BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(auditOne));
    for (const s of settled) {
      if (s.status === "fulfilled") results.push(s.value);
    }
  }

  if (jsonOnly) {
    console.log(JSON.stringify({ asOf: new Date().toISOString(), results }, null, 2));
    return;
  }

  // Pretty per-vendor report.
  for (const r of results) {
    const pad = (s: string, n: number) =>
      s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
    const head = `${emojiFor(r.status)} ${pad(r.handle, 24)} ${C.dim(`[${r.platform}]`)}`;
    let line = head + "  " + r.liveness.detail;
    if (r.activity?.detail) {
      line += C.dim(" · ") + r.activity.detail;
    }
    console.log(line);
    for (const n of r.notes) {
      console.log("    " + C.dim("· " + n));
    }
  }

  // Summary block.
  const counts = {
    alive: results.filter((r) => r.status === "alive").length,
    stale_active: results.filter((r) => r.status === "stale_active").length,
    unknown: results.filter((r) => r.status === "unknown").length,
    gone: results.filter((r) => r.status === "gone").length,
  };
  console.log();
  console.log(C.bold("Summary:"));
  console.log(`  ${C.ok} ${counts.alive} active`);
  console.log(
    `  ${C.warn} ${counts.stale_active} stale-active (alive but no recent posts >${STALE_ACTIVITY_DAYS}d)`,
  );
  console.log(`  ${C.warn} ${counts.unknown} could not verify (manual check needed)`);
  console.log(
    `  ${C.fail} ${counts.gone} gone${counts.gone > 0 ? " · candidate for removal" : ""}`,
  );
  if (counts.gone > 0) {
    console.log();
    console.log(C.bold("Candidates for removal:"));
    for (const r of results.filter((r) => r.status === "gone")) {
      console.log(`  ${C.fail} ${r.handle} (${r.name}) · ${r.liveness.detail}`);
    }
  }
  if (counts.stale_active > 0) {
    console.log();
    console.log(C.bold(`Stale-active (>${STALE_ACTIVITY_DAYS}d since last activity):`));
    for (const r of results.filter((r) => r.status === "stale_active")) {
      console.log(
        `  ${C.warn} ${r.handle} (${r.name}) · ${r.activity?.detail ?? ""}`,
      );
    }
  }

  // Hard-removal review · vendors that have been auto-marked
  // dormant for >180 days are candidates for actual deletion from
  // vendors.ts. We surface them as a separate section so the
  // operator can review during a re-verification sweep.
  //
  // We can only query KV from a server context; this script runs
  // outside that. Skip the section unless explicit opt-in via
  // --check-dormancy flag (requires KV_REST_API_URL + token
  // env vars locally).
  if (args.includes("--check-dormancy")) {
    try {
      const { getDormancy, HARD_REMOVAL_REVIEW_DAYS } = await import(
        "../src/lib/vendor-dormancy"
      );
      const nowSec = Math.floor(Date.now() / 1000);
      const candidates: Array<{
        handle: string;
        name: string;
        daysDormant: number;
      }> = [];
      for (const v of VENDORS) {
        const d = await getDormancy(v.handle);
        if (!d) continue;
        const days = Math.floor((nowSec - d.since) / 86_400);
        if (days >= HARD_REMOVAL_REVIEW_DAYS) {
          candidates.push({ handle: v.handle, name: v.name, daysDormant: days });
        }
      }
      if (candidates.length > 0) {
        console.log();
        console.log(
          C.bold(
            `Hard-removal candidates (dormant >${HARD_REMOVAL_REVIEW_DAYS}d):`,
          ),
        );
        for (const c of candidates) {
          console.log(
            `  ${C.fail} ${c.handle} (${c.name}) · ${c.daysDormant}d dormant`,
          );
        }
        console.log(
          C.dim(
            "  Removal is always human · review each candidate before deleting from vendors.ts.",
          ),
        );
      }
    } catch (e) {
      console.log();
      console.log(
        C.dim(
          `  (dormancy check skipped · ${e instanceof Error ? e.message : "unknown error"})`,
        ),
      );
    }
  }
}

main().catch((e) => {
  console.error("audit failed:", e);
  process.exit(1);
});
