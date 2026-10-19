// Invariants for the re-verification sweep tool (scripts/reverify-vendors.ts).
//
// The dangerous part of that tool is the in-place verifiedAt bump: a
// string-level edit inside the ~120-entry VENDORS literal. These tests
// pin the surgery down against the REAL vendors.ts source (so any
// formatting drift in the file that would break the block-bounding
// shows up here, not in a live sweep):
//
//   1. Bumping one vendor changes EXACTLY one line, and only the
//      verifiedAt value on it — never a neighbor's.
//   2. Ambiguity throws before writing (unknown handle).
//   3. The rolling-batch pool is oldest-verifiedAt-first with the
//      min-age exclusion — the de-clustering property that stops the
//      2026-08 stale wall from re-forming.
//   4. Auto-confirmable is ONLY relay-active Nostr / healthy LNURL.
//      X is never auto-confirmed (liveness ≠ still-sells-for-BTC).
//
// Run in the validator suite (see the README). Exits non-zero on drift.

import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import {
  VENDORS,
  oldestVerifiedBatch,
  REVERIFY_BATCH_SIZE,
  verifiedAtClusterStats,
  type Vendor,
} from "../src/lib/vendors";
import type { AuditResult } from "./lib/vendor-probes";
import {
  bumpVerifiedAtInSource,
  isAutoConfirmable,
  selectPool,
  todayUtcMidnightSeconds,
  type Probed,
} from "./reverify-vendors";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`);
  }
}

const VENDORS_PATH = pathResolve(__dirname, "..", "src", "lib", "vendors.ts");
const source = readFileSync(VENDORS_PATH, "utf8");

// Sentinel far outside any real verifiedAt (2100-01-01 UTC) so we can
// count its occurrences unambiguously after a bump.
const SENTINEL = 4_102_444_800;
check(
  "sentinel timestamp does not already appear in vendors.ts",
  !source.includes(String(SENTINEL)),
);

// ── 1 · single bump touches exactly one line ──────────────────────
const first = VENDORS[0];
const bumped = bumpVerifiedAtInSource(source, first.handle, SENTINEL, first.name);
{
  const a = source.split("\n");
  const b = bumped.split("\n");
  const changed = a
    .map((line, i) => (line !== b[i] ? i : -1))
    .filter((i) => i !== -1);
  check("bump preserves line count", a.length === b.length);
  check(
    "bump changes exactly one line",
    changed.length === 1,
    `changed lines: ${changed.join(", ")}`,
  );
  if (changed.length === 1) {
    const i = changed[0];
    check(
      "changed line is the old verifiedAt",
      a[i].includes(`verifiedAt: ${first.verifiedAt}`),
      a[i],
    );
    check(
      "changed line becomes the new verifiedAt",
      b[i].trim() === `verifiedAt: ${SENTINEL},`,
      b[i],
    );
    // The changed line must sit inside the first vendor's block · its
    // handle appears above it, and no OTHER handle sits between them.
    const above = b.slice(0, i).join("\n");
    const handleIdx = above.lastIndexOf(`handle: ${JSON.stringify(first.handle)}`);
    const anyHandleIdx = above.lastIndexOf("handle: ");
    check(
      "changed line belongs to the bumped vendor's block",
      handleIdx !== -1 && handleIdx === anyHandleIdx,
    );
  }
  check(
    "sentinel appears exactly once after single bump",
    bumped.split(String(SENTINEL)).length - 1 === 1,
  );
}

// ── 2 · multi-bump + edge entries ──────────────────────────────────
{
  const last = VENDORS[VENDORS.length - 1];
  const mid = VENDORS[Math.floor(VENDORS.length / 2)];
  let s = source;
  for (const v of [first, mid, last]) {
    s = bumpVerifiedAtInSource(s, v.handle, SENTINEL, v.name);
  }
  check(
    "sequential bump of first/middle/last entries lands 3 sentinels",
    s.split(String(SENTINEL)).length - 1 === 3,
  );
  check(
    "total verifiedAt count unchanged after multi-bump",
    (s.match(/verifiedAt:/g) ?? []).length ===
      (source.match(/verifiedAt:/g) ?? []).length,
  );
}

// ── 2b · EVERY vendor entry can be bumped ──────────────────────────
// Covers the Prettier line-wrap trap: long Nostr bech32 handles are
// formatted as `handle:\n      "nprofile1…",` so an exact-string
// `handle: "…",` needle silently misses them. Bumping all ~120 real
// entries proves the needle survives whatever formatting the file has.
{
  let allOk = true;
  let firstErr = "";
  // Both splits are HOISTED. They used to sit inside the filter callback,
  // which re-split the whole ~2,600-line file once PER LINE, per vendor:
  // 136 x 2,600 x 2,600 is ~920 million operations, each allocating a
  // 2,600-element array. The assertion was never wrong and it did finish,
  // it just took minutes and got slower every time a vendor was added, so
  // it read as a hung verify rather than a slow one.
  const srcLines = source.split("\n");
  for (const v of VENDORS) {
    try {
      const s = bumpVerifiedAtInSource(source, v.handle, SENTINEL, v.name);
      const sentinels = s.split(String(SENTINEL)).length - 1;
      const sLines = s.split("\n");
      const changedLines = srcLines.filter((line, i) => line !== sLines[i]).length;
      if (sentinels !== 1 || changedLines !== 1) {
        allOk = false;
        firstErr = `${v.handle}: ${sentinels} sentinels, ${changedLines} changed lines`;
        break;
      }
    } catch (e) {
      allOk = false;
      firstErr = `${v.handle}: ${e instanceof Error ? e.message : e}`;
      break;
    }
  }
  check(
    `every one of the ${VENDORS.length} vendor entries bumps cleanly (incl. wrapped Nostr handles)`,
    allOk,
    firstErr,
  );
}

// ── 3 · ambiguity throws instead of writing ────────────────────────
{
  let threw = false;
  try {
    bumpVerifiedAtInSource(source, "no-such-vendor-handle", SENTINEL);
  } catch {
    threw = true;
  }
  check("unknown handle throws", threw);
}

// ── 4 · rolling-batch pool selection ───────────────────────────────
{
  const day = 86_400;
  const now = 1_000_000 * day; // arbitrary fixed "now"
  const mk = (handle: string, verifiedDaysAgo: number): Vendor => ({
    handle,
    name: handle,
    description: "test",
    category: "apparel",
    addedAt: 1,
    listedAt: 1,
    verifiedAt: now - verifiedDaysAgo * day,
  });
  const vendors = [mk("fresh", 5), mk("oldest", 120), mk("mid", 60), mk("edge", 30)];
  const pool = selectPool(vendors, now, 30);
  check(
    "pool excludes vendors re-verified within min-age",
    !pool.some((v) => v.handle === "fresh"),
  );
  check(
    "pool includes the exactly-at-min-age vendor",
    pool.some((v) => v.handle === "edge"),
  );
  check(
    "pool is oldest-verifiedAt first",
    pool.map((v) => v.handle).join(",") === "oldest,mid,edge",
    pool.map((v) => v.handle).join(","),
  );
  check("min-age 0 includes everyone", selectPool(vendors, now, 0).length === 4);
  check(
    "selectPool does not mutate its input",
    vendors[0].handle === "fresh",
  );
  check(
    "selectPool matches oldestVerifiedBatch",
    selectPool(vendors, now, 30)
      .map((v) => v.handle)
      .join(",") ===
      oldestVerifiedBatch(vendors, now, { minAgeDays: 30 })
        .map((v) => v.handle)
        .join(","),
  );
  const limited = oldestVerifiedBatch(vendors, now, {
    minAgeDays: 30,
    limit: 2,
  });
  check(
    "oldestVerifiedBatch honors limit",
    limited.map((v) => v.handle).join(",") === "oldest,mid",
  );
  const stats = verifiedAtClusterStats(
    [mk("a", 10), mk("b", 10), mk("c", 40)],
    now,
    { minAgeDays: 30, batchSize: REVERIFY_BATCH_SIZE },
  );
  check(
    "cluster largest count is the shared date",
    stats.largest?.count === 2,
  );
  check(
    "cluster nextBatch is oldest-first and min-age gated",
    stats.nextBatch.map((v) => v.handle).join(",") === "c",
  );
}

{
  const health = readFileSync(
    pathResolve(process.cwd(), "src/app/api/admin/cron-health/route.ts"),
    "utf8",
  );
  check(
    "cron-health surfaces verifiedAt cluster stats",
    health.includes("verifiedAtClusterStats"),
  );
  check(
    "cron-health does not write verifiedAt",
    !health.includes("bumpVerifiedAt") && !/verifiedAt\s*=/.test(health),
  );
}

// ── 5 · verifiedAt convention · UTC midnight ───────────────────────
{
  const ts = todayUtcMidnightSeconds();
  const nowSec = Date.now() / 1000;
  check("todayUtcMidnightSeconds is UTC-midnight-aligned", ts % 86_400 === 0);
  check(
    "todayUtcMidnightSeconds is within the last 24h",
    nowSec - ts >= 0 && nowSec - ts < 86_400,
  );
}

// ── 6 · auto-confirmable gate ──────────────────────────────────────
{
  const mkProbed = (
    platform: Vendor["platform"],
    status: AuditResult["status"],
    livenessOk = true,
  ): Probed => ({
    vendor: {
      handle: "t",
      platform,
      name: "t",
      description: "t",
      category: "apparel",
      addedAt: 1,
      listedAt: 1,
      verifiedAt: 0,
    },
    result: {
      handle: "t",
      name: "t",
      platform: platform ?? "x",
      status,
      liveness: { ok: livenessOk, detail: "" },
      notes: [],
    },
  });
  check(
    "Nostr with recent relay activity is auto-confirmable",
    isAutoConfirmable(mkProbed("nostr", "alive")),
  );
  check(
    "Lightning with healthy LNURL-pay is auto-confirmable",
    isAutoConfirmable(mkProbed("lightning", "alive")),
  );
  check(
    "X is NEVER auto-confirmable, even when alive",
    !isAutoConfirmable(mkProbed("x", "alive")),
  );
  check(
    "silent (stale-active) Nostr needs a human",
    !isAutoConfirmable(mkProbed("nostr", "stale_active")),
  );
  check(
    "unknown-status Nostr needs a human",
    !isAutoConfirmable(mkProbed("nostr", "unknown")),
  );
  check(
    "liveness-failed Nostr needs a human even if status says alive",
    !isAutoConfirmable(mkProbed("nostr", "alive", false)),
  );
}

console.log("");
if (failures > 0) {
  console.error(`✗ ${failures} reverify-vendors invariant(s) failed.`);
  process.exit(1);
}
console.log("✓ all reverify-vendors invariants hold.");
