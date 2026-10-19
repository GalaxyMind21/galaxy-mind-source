#!/usr/bin/env tsx
/**
 * reverify-vendors · operator CLI for the rolling re-verification sweep.
 *
 * Run via:
 *   npx tsx scripts/reverify-vendors.ts                # full pool, oldest-first
 *   npx tsx scripts/reverify-vendors.ts --limit 25     # weekly rolling batch
 *   npx tsx scripts/reverify-vendors.ts --dry-run      # probe + report, no prompts
 *   npx tsx scripts/reverify-vendors.ts --min-age 30   # skip vendors verified <30d ago (default)
 *   npx tsx scripts/reverify-vendors.ts --handle X     # single vendor
 *   npx tsx scripts/reverify-vendors.ts --queue        # only what monitor-vendors flagged overnight
 *   AUDIT_OFFLINE=1 npx tsx scripts/reverify-vendors.ts --dry-run  # plumbing test
 *
 * --queue reads the KV review queue (gm:vendor:review-queue) written by
 * the nightly monitor-vendors cron and probes only those handles ·
 * --limit / --min-age / --handle are ignored in this mode. Needs KV
 * configured locally (UPSTASH_REDIS_REST_URL/TOKEN); with none configured
 * or an empty queue, it says so and exits rather than silently listing
 * zero vendors.
 *
 * Why this exists: 102 of the directory's vendors carry a verifiedAt
 * from the 2026-05-06..05-16 onboarding burst, so they all cross the
 * 90-day STALE_THRESHOLD between Aug 4-14, 2026 — ~83% of the directory
 * would flag stale near-simultaneously. The fix is a ROLLING sweep:
 * ~25 vendors/week via --limit, oldest-verified first, which both keeps
 * everything fresh and de-clusters the verifiedAt dates so the wall
 * never re-forms. Do NOT run the whole pool through in one day — that
 * just moves the wall to November.
 *
 * What it does:
 *   1. Runs the same per-platform probes as scripts/audit-vendors.ts
 *      (shared module: scripts/lib/vendor-probes.ts).
 *   2. Groups results:
 *        · auto-confirmable — Nostr vendors with a relay-visible note
 *          in the last 90d, Lightning vendors whose LNURL-pay endpoint
 *          returns a valid payRequest. Machine evidence they're alive
 *          and transacting on Bitcoin rails.
 *        · needs-human — ALL X vendors (liveness ≠ still-sells-for-BTC;
 *          no reliable public activity API — the probe's unavatar
 *          avatar-resolvability note is only a hint, never a confirm),
 *          silent Nostr vendors, unreachable LNURL endpoints.
 *        · gone — profile 404 / NIP-05 entry removed / LNURL-pay 404.
 *          NEVER bumped; listed as removal-review candidates.
 *   3. On explicit operator confirmation (per-group "all" or per-vendor
 *      y/n), bumps verifiedAt to today's UTC midnight in
 *      src/lib/vendors.ts. Nothing is ever bumped without a yes.
 *   4. Runs scripts/check-vendors.ts after writing and reports.
 *   5. Offers commit+push (same flow as review-submissions.ts).
 *
 * Conventions (the README): verifiedAt = UNIX seconds, UTC midnight of
 * confirmation date. Re-verifications bump it; corrections don't.
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import {
  getPlatform,
  oldestVerifiedBatch,
  REVERIFY_MIN_AGE_DAYS,
  STALE_THRESHOLD_DAYS,
  VENDORS,
  vendorKey,
  type Vendor,
} from "../src/lib/vendors";
import {
  auditOne,
  offline,
  PARALLEL_BATCH_SIZE,
  STALE_ACTIVITY_DAYS,
  type AuditResult,
} from "./lib/vendor-probes";
import { kvGet, isKvConfigured } from "../src/lib/kv";
import { QUEUE_KEY, type QueueEntry } from "../src/lib/vendor-queue";

const REPO_ROOT = pathResolve(__dirname, "..");
const VENDORS_PATH = pathResolve(REPO_ROOT, "src", "lib", "vendors.ts");
const SECS_PER_DAY = 86_400;

// Vendors re-verified within this window are excluded from the pool by
// default — a weekly `--limit 25` rerun then naturally skips last week's
// batch instead of re-listing it. Override with --min-age N (N=0 to
// include everyone).
const DEFAULT_MIN_AGE_DAYS = REVERIFY_MIN_AGE_DAYS;

const C = {
  ok: "\x1b[32m✓\x1b[0m",
  warn: "\x1b[33m⚠\x1b[0m",
  fail: "\x1b[31m✗\x1b[0m",
  info: "\x1b[36mℹ\x1b[0m",
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  accent: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
/**
 * Non-interactive mode for the ONE group that carries machine evidence.
 *
 * `--auto-yes` bumps the auto-confirmable group (Nostr note seen in the
 * last 90d / healthy LNURL-pay) without prompting, ALWAYS skips the
 * needs-human group, and never commits — it leaves the diff for review.
 *
 * The human gate is not weakened by this, it is enforced by it: X
 * vendors and silent Nostr accounts still cannot be bumped by a machine,
 * because liveness is not evidence that someone still sells for bitcoin.
 * What this removes is the chore of typing "a" and then "n" six times
 * every week for vendors whose evidence a probe already collected.
 *
 * It exists because the prompts cannot be driven over a pipe: readline
 * takes EOF on a piped stdin as the end of the session and the process
 * exits cleanly having written nothing, which looks exactly like success.
 */
const autoYes = args.includes("--auto-yes");
const handleFilter = (() => {
  const i = args.indexOf("--handle");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();
const limit = (() => {
  const i = args.indexOf("--limit");
  if (i < 0 || !args[i + 1]) return null;
  const n = Number.parseInt(args[i + 1], 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${C.fail} --limit must be a positive integer`);
    process.exit(1);
  }
  return n;
})();
const minAgeDays = (() => {
  const i = args.indexOf("--min-age");
  if (i < 0 || !args[i + 1]) return DEFAULT_MIN_AGE_DAYS;
  const n = Number.parseInt(args[i + 1], 10);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${C.fail} --min-age must be a non-negative integer (days)`);
    process.exit(1);
  }
  return n;
})();
// --queue · review exactly what the nightly monitor flagged, instead of
// walking the roster oldest-first. This is the normal mode now; the
// oldest-first walk stays for the periodic human-touch backstop.
const useQueue = args.includes("--queue");

// Lazy readline singleton · created on first prompt, not at import time,
// so scripts/test-reverify-vendors.ts can import the pure helpers below
// without grabbing stdin (which would keep the test process alive).
let rlInstance: readline.Interface | null = null;
function rl(): readline.Interface {
  if (!rlInstance) rlInstance = readline.createInterface({ input, output });
  return rlInstance;
}
function closeRl(): void {
  rlInstance?.close();
  rlInstance = null;
}

async function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? C.dim(` [${defaultValue}]`) : "";
  const a = await rl().question(`${C.cyan("?")} ${question}${suffix}: `);
  return a.trim() || defaultValue || "";
}

async function askYN(question: string, defaultYes = false): Promise<boolean> {
  const a = await rl().question(
    `${C.cyan("?")} ${question} ${C.dim(defaultYes ? "[Y/n]" : "[y/N]")}: `,
  );
  const t = a.trim().toLowerCase();
  if (!t) return defaultYes;
  return t === "y" || t === "yes";
}

export function todayUtcMidnightSeconds(): number {
  const now = new Date();
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor(utcMidnight / 1000);
}

function daysSince(unixSec: number): number {
  return Math.floor((Date.now() / 1000 - unixSec) / SECS_PER_DAY);
}

function verifiedAgeLabel(v: Vendor): string {
  const age = daysSince(v.verifiedAt);
  const toStale = STALE_THRESHOLD_DAYS - age;
  const staleBit =
    toStale <= 0
      ? `\x1b[31mSTALE ${-toStale}d ago\x1b[0m`
      : toStale <= 21
        ? `\x1b[33mstale in ${toStale}d\x1b[0m`
        : `stale in ${toStale}d`;
  return `verified ${age}d ago · ${staleBit}`;
}

/** Where the operator should look when spot-checking a needs-human vendor. */
function spotCheckUrl(v: Vendor): string {
  const platform = getPlatform(v);
  if (platform === "x") return `https://x.com/${v.handle}`;
  if (platform === "nostr") return `https://njump.me/${v.handle}`;
  const [name, domain] = v.handle.split("@");
  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name ?? "")}`;
}

// ─────────────────────────────────────────────────────────────────
// vendors.ts in-place bump
//
// Same file-surgery philosophy as review-submissions.ts / add-vendor.ts
// (string-level edit + validator afterward), but scoped to ONE field
// inside ONE existing entry. The edit is bounded to the vendor's object
// block — from the enclosing `  {` to its closing `  },` — and requires
// exactly one verifiedAt match inside; anything ambiguous throws before
// writing rather than corrupting the array.
// ─────────────────────────────────────────────────────────────────

export function bumpVerifiedAtInSource(
  source: string,
  handle: string,
  newTs: number,
  // Disambiguator since 2026-10: one handle may own several listings,
  // so when the handle needle hits more than once the block whose
  // `name:` matches wins. Exactly one block must match either way.
  name?: string,
): string {
  // Whitespace-tolerant needle: Prettier wraps long handles (Nostr
  // nprofile1… bech32) onto their own line as `handle:\n      "…",`,
  // so an exact `handle: "…",` string never matches those entries.
  const escaped = JSON.stringify(handle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const needleRe = new RegExp(`handle:\\s*${escaped}\\s*,`, "g");
  let hits = Array.from(source.matchAll(needleRe));
  if (hits.length === 0) {
    throw new Error(`couldn't find entry for handle "${handle}" in vendors.ts`);
  }
  if (hits.length > 1 && name !== undefined) {
    const nameRe = new RegExp(
      `\\n\\s*name:\\s*${JSON.stringify(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,`,
    );
    hits = hits.filter((h) => {
      const s = source.lastIndexOf("\n  {", h.index);
      const e = source.indexOf("\n  },", h.index);
      return s !== -1 && e !== -1 && nameRe.test(source.slice(s, e));
    });
    if (hits.length === 0) {
      throw new Error(`no "${handle}" entry is named "${name}" in vendors.ts`);
    }
  }
  if (hits.length > 1) {
    throw new Error(
      `handle "${handle}" appears more than once in vendors.ts${name === undefined ? " · pass the listing name to disambiguate" : ""}`,
    );
  }
  const hIdx = hits[0].index;
  const blockStart = source.lastIndexOf("\n  {", hIdx);
  const blockEndRel = source.indexOf("\n  },", hIdx);
  if (blockStart === -1 || blockEndRel === -1) {
    throw new Error(`couldn't bound the object block for "${handle}"`);
  }
  const blockEnd = blockEndRel + "\n  },".length;
  const block = source.slice(blockStart, blockEnd);
  const matches = block.match(/verifiedAt:\s*\d+/g);
  if (!matches || matches.length !== 1) {
    throw new Error(
      `expected exactly 1 verifiedAt in the "${handle}" block, found ${matches?.length ?? 0}`,
    );
  }
  const newBlock = block.replace(/verifiedAt:\s*\d+/, `verifiedAt: ${newTs}`);
  return source.slice(0, blockStart) + newBlock + source.slice(blockEnd);
}

function runQuiet(
  command: string,
  cmdArgs: string[],
  opts: { input?: string } = {},
): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(command, cmdArgs, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      input: opts.input,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();
    return { ok: true, stdout, stderr: "" };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    return {
      ok: false,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? String(e),
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Grouping
// ─────────────────────────────────────────────────────────────────

export type Probed = { vendor: Vendor; result: AuditResult };

/**
 * Machine evidence strong enough to confirm without a human look:
 *   Nostr    → posted a note within the last STALE_ACTIVITY_DAYS (90d)
 *   Lightning→ LNURL-pay endpoint returns a valid payRequest
 * X is NEVER auto-confirmable · profile-200 says the account exists,
 * not that it still sells for bitcoin.
 */
export function isAutoConfirmable(p: Probed): boolean {
  const platform = getPlatform(p.vendor);
  if (platform === "nostr") {
    return p.result.status === "alive" && p.result.liveness.ok;
  }
  if (platform === "lightning") {
    return p.result.status === "alive" && p.result.liveness.ok;
  }
  return false;
}

function printProbed(p: Probed, indent = "  "): void {
  const statusEmoji =
    p.result.status === "gone"
      ? C.fail
      : p.result.status === "alive"
        ? C.ok
        : C.warn;
  console.log(
    `${indent}${statusEmoji} ${C.bold(p.vendor.handle)} ${C.dim(`(${p.vendor.name} · ${p.result.platform})`)}`,
  );
  console.log(`${indent}    ${C.dim(verifiedAgeLabel(p.vendor))}`);
  console.log(`${indent}    ${p.result.liveness.detail}`);
  if (p.result.activity?.detail) {
    console.log(`${indent}    ${C.dim(p.result.activity.detail)}`);
  }
  for (const n of p.result.notes) {
    console.log(`${indent}    ${C.dim("· " + n)}`);
  }
}

/**
 * The rolling-batch pool: vendors not re-verified within the last
 * `minAge` days, oldest verifiedAt FIRST — so each weekly `--limit 25`
 * batch chews on the vendors closest to (or past) the stale wall, and
 * the bumped dates spread out over the following weeks instead of
 * re-clustering.
 */
export function selectPool(
  vendors: readonly Vendor[],
  nowSec: number,
  minAge: number,
): Vendor[] {
  return oldestVerifiedBatch(vendors, nowSec, { minAgeDays: minAge });
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log();
  console.log(C.bold("Galaxy Mind · re-verification sweep"));

  const nowSec = Math.floor(Date.now() / 1000);
  let targets: Vendor[];

  if (useQueue) {
    // --queue mode reviews exactly what monitor-vendors flagged overnight ·
    // --limit / --min-age / --handle (the oldest-first-walk knobs below)
    // don't apply here.
    if (!isKvConfigured()) {
      console.log(
        `  ${C.warn} --queue needs KV configured (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN) · none found locally, nothing to review`,
      );
      closeRl();
      return;
    }
    const queued = await kvGet<QueueEntry[]>(QUEUE_KEY);
    if (!queued || queued.length === 0) {
      console.log(
        `  ${C.ok} review queue is empty · the nightly monitor hasn't flagged anything`,
      );
      closeRl();
      return;
    }
    // Entries carry a listing `key` (slug) since 2026-10; older queue
    // values only had the handle, which resolves to every listing of it.
    const wantedKeys = new Set(queued.map((q) => q.key).filter(Boolean));
    const wantedHandles = new Set(
      queued.filter((q) => !q.key).map((q) => q.handle),
    );
    targets = VENDORS.filter(
      (v) => wantedKeys.has(vendorKey(v)) || wantedHandles.has(v.handle),
    );
    console.log(
      `  ${C.info} --queue · ${targets.length} flagged by the nightly monitor ${C.dim(`(${queued.length} queue entries)`)}`,
    );
  } else {
    let pool = selectPool(VENDORS, nowSec, minAgeDays);
    if (handleFilter) {
      // --handle takes a handle (every listing it owns) or a listing
      // slug (exactly that shop).
      pool = VENDORS.filter(
        (v) => v.handle === handleFilter || vendorKey(v) === handleFilter,
      );
      if (pool.length === 0) {
        console.error(`${C.fail} no vendor found with handle or slug "${handleFilter}"`);
        closeRl();
        process.exit(1);
      }
    }
    const skippedFresh = handleFilter ? 0 : VENDORS.length - pool.length;
    targets = limit ? pool.slice(0, limit) : pool;

    console.log(
      `  ${C.info} pool: ${pool.length} vendors ${C.dim(`(${skippedFresh} skipped · re-verified <${minAgeDays}d ago)`)}`,
    );
    console.log(
      `  ${C.info} this batch: ${targets.length}${limit ? C.dim(` (--limit ${limit} · oldest verifiedAt first)`) : ""}`,
    );
  }

  if (offline) console.log(C.dim("  (AUDIT_OFFLINE=1 · network calls skipped)"));
  if (targets.length === 0) {
    console.log(`  ${C.ok} nothing to re-verify`);
    closeRl();
    return;
  }
  console.log();
  console.log(C.dim("  probing..."));

  // Probe in the same batch pattern as audit-vendors.
  const probed: Probed[] = [];
  for (let i = 0; i < targets.length; i += PARALLEL_BATCH_SIZE) {
    const batch = targets.slice(i, i + PARALLEL_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (vendor): Promise<Probed> => ({
        vendor,
        result: await auditOne(vendor),
      })),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") probed.push(s.value);
    }
  }

  const gone = probed.filter((p) => p.result.status === "gone");
  const auto = probed.filter((p) => p.result.status !== "gone" && isAutoConfirmable(p));
  const needsHuman = probed.filter(
    (p) => p.result.status !== "gone" && !isAutoConfirmable(p),
  );

  console.log();
  console.log(
    C.bold(
      `── Auto-confirmable (${auto.length}) ─ Nostr note <${STALE_ACTIVITY_DAYS}d / LNURL-pay healthy ──`,
    ),
  );
  if (auto.length === 0) console.log(C.dim("  (none)"));
  for (const p of auto) printProbed(p);

  console.log();
  console.log(
    C.bold(`── Needs human spot-check (${needsHuman.length}) ──`),
  );
  if (needsHuman.length === 0) console.log(C.dim("  (none)"));
  for (const p of needsHuman) printProbed(p);

  if (gone.length > 0) {
    console.log();
    console.log(C.bold(`── Gone — removal-review candidates (${gone.length}) ──`));
    console.log(
      C.dim("  never bumped by this tool · removal is a separate human decision"),
    );
    for (const p of gone) printProbed(p);
  }

  if (dryRun) {
    console.log();
    console.log(C.dim("  --dry-run · no prompts, no writes"));
    closeRl();
    return;
  }

  // ── Confirmation · nothing is bumped without an explicit yes ──
  const approved: Vendor[] = [];

  if (auto.length > 0 && autoYes) {
    approved.push(...auto.map((p) => p.vendor));
    console.log();
    console.log(
      `  ${C.ok} --auto-yes · ${auto.length} machine-evidenced vendor${auto.length === 1 ? "" : "s"} queued for bump`,
    );
  } else if (auto.length > 0) {
    console.log();
    const mode = await ask(
      `Auto-confirmable group: bump [a]ll ${auto.length} / review [e]ach / [s]kip`,
      "e",
    );
    const t = mode.toLowerCase();
    if (t === "a" || t === "all") {
      approved.push(...auto.map((p) => p.vendor));
      console.log(`  ${C.ok} ${auto.length} queued for bump`);
    } else if (t === "e" || t === "each") {
      for (const p of auto) {
        printProbed(p);
        if (await askYN(`  bump ${p.vendor.handle}?`, true)) {
          approved.push(p.vendor);
        }
      }
    } else {
      console.log(C.dim("  skipped · group left untouched"));
    }
  }

  if (needsHuman.length > 0 && autoYes) {
    console.log();
    console.log(
      C.bold(`Needs-human group (${needsHuman.length}) · left untouched by --auto-yes`),
    );
    console.log(
      C.dim("  A live profile is not evidence anyone still sells for bitcoin."),
    );
    console.log(
      C.dim("  Open these, then re-run without --auto-yes to answer per vendor:"),
    );
    for (const p of needsHuman) {
      console.log(`    ${p.vendor.handle.slice(0, 28).padEnd(28)} ${spotCheckUrl(p.vendor)}`);
    }
  } else if (needsHuman.length > 0) {
    console.log();
    console.log(
      C.bold("Needs-human group") +
        C.dim(" · open each link, confirm they still sell for BTC, then answer:"),
    );
    for (const p of needsHuman) {
      console.log();
      printProbed(p);
      console.log(`      ${C.cyan("spot-check:")} ${spotCheckUrl(p.vendor)}`);
      if (await askYN(`  confirmed — bump ${p.vendor.handle}?`, false)) {
        approved.push(p.vendor);
      }
    }
  }

  if (approved.length === 0) {
    console.log();
    console.log(C.dim("  nothing approved · vendors.ts untouched"));
    closeRl();
    return;
  }

  // ── Write · re-read the file fresh, bump each approved entry ──
  const newTs = todayUtcMidnightSeconds();
  console.log();
  console.log(
    C.bold(`Bumping verifiedAt → ${newTs} (${new Date(newTs * 1000).toISOString().slice(0, 10)} UTC midnight) for ${approved.length} vendor${approved.length === 1 ? "" : "s"}:`),
  );
  for (const v of approved) console.log(`  ${C.ok} ${v.handle}`);

  let source = readFileSync(VENDORS_PATH, "utf8");
  for (const v of approved) {
    source = bumpVerifiedAtInSource(source, v.handle, newTs, v.name);
  }
  writeFileSync(VENDORS_PATH, source);
  console.log(`  ${C.ok} written to vendors.ts`);

  // ── Validate ──
  const check = runQuiet("npx", ["tsx", "scripts/check-vendors.ts"]);
  if (!check.ok) {
    console.log(`  ${C.fail} check-vendors.ts failed:`);
    console.log(check.stdout);
    console.log(check.stderr);
    console.log(
      `  ${C.warn} write succeeded but validation failed · inspect git diff before committing`,
    );
    closeRl();
    process.exit(1);
  }
  console.log(`  ${C.ok} check-vendors.ts passes`);

  // ── Commit + push? Same optional flow as review-submissions ──
  // --auto-yes deliberately stops here: the write is done and validated,
  // and the diff is left staged-in-the-worktree for a human to read
  // before it becomes a published claim about 19 real businesses.
  if (autoYes) {
    console.log();
    console.log(
      `  ${C.ok} diff left uncommitted on purpose · review it, then commit`,
    );
    closeRl();
    return;
  }
  const commitOk = await askYN("Commit + push?", false);
  if (!commitOk) {
    console.log(C.dim(`  Done · run "git diff src/lib/vendors.ts" to inspect`));
    closeRl();
    return;
  }
  const handles = approved.map((v) => "@" + v.handle).join(", ");
  const commitMsg = `Re-verify ${approved.length} vendor${approved.length === 1 ? "" : "s"} (rolling sweep)\n\n${handles}\n`;
  runQuiet("git", ["add", "src/lib/vendors.ts"]);
  const commitRes = runQuiet("git", ["commit", "-F", "-"], { input: commitMsg });
  if (!commitRes.ok) {
    console.log(`  ${C.fail} git commit failed: ${commitRes.stderr}`);
    closeRl();
    return;
  }
  console.log(`  ${C.ok} ${commitRes.stdout.trim().split("\n")[0]}`);
  try {
    execFileSync("git", ["push"], { cwd: REPO_ROOT, stdio: "inherit" });
    console.log(`  ${C.ok} pushed · Vercel will deploy in ~30s`);
  } catch {
    console.log(`  ${C.warn} push failed · run \`git push\` manually`);
  }
  closeRl();
}

// Only run the CLI when executed directly · the exported helpers above
// are imported (side-effect-free) by scripts/test-reverify-vendors.ts.
if (require.main === module) {
  main().catch((e) => {
    console.error("\nreverify-vendors failed:", e);
    closeRl();
    process.exit(1);
  });
}
