#!/usr/bin/env tsx
/**
 * ONE-TIME backfill of Vendor.listedAt from git history.
 *
 * For each vendor, listedAt = UTC midnight of the OLDEST commit that
 * changed the number of occurrences of that vendor's handle VALUE in
 * src/lib/vendors.ts.
 *
 * THE TRAP: searching for the string `handle: "<value>"` instead of the
 * bare value dates 31 nprofile vendors to 2026-08-13, because commit
 * 0d717ee re-wrapped long nprofile handle lines and `git log -S` counts
 * raw string occurrences, not semantics. Searching the bare value gives
 * 0 false positives. Do not "simplify" this back.
 *
 * Not retained as a runtime dependency: run once, commit the result.
 * New vendors get listedAt at add time (same value as verifiedAt).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/lib/vendors.ts";

// @foundationhq resolves to 2026-08-13 only because commit 0d717ee
// renamed it from @FOUNDATIONdvcs after the vendor's X handle changed.
// Derive its listing date from the predecessor handle instead.
const HANDLE_OVERRIDES: Record<string, string> = {
  foundationhq: "FOUNDATIONdvcs",
};

function utcMidnight(iso: string): number {
  const d = new Date(iso);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000,
  );
}

function firstSeen(handle: string): number | null {
  const query = HANDLE_OVERRIDES[handle] ?? handle;
  const out = execFileSync(
    "git",
    ["log", "--format=%aI", "-S", query, "--", FILE],
    { encoding: "utf-8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  if (out.length === 0) return null;
  return utcMidnight(out[out.length - 1]);
}

const src = readFileSync(FILE, "utf-8");
const lines = src.split("\n");
const outLines: string[] = [];
let currentHandle: string | null = null;
let inserted = 0;
const unresolved: string[] = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  outLines.push(line);

  // Handle value may be on this line, or on the next (long nprofile
  // strings are wrapped by the formatter).
  const same = line.match(/^    handle: "([^"]+)",$/);
  if (same) currentHandle = same[1];
  else if (/^    handle:$/.test(line)) {
    const next = lines[i + 1]?.match(/^\s*"([^"]+)",$/);
    if (next) currentHandle = next[1];
  }

  const addedAt = line.match(/^    addedAt: \d+,$/);
  if (addedAt && currentHandle) {
    const ts = firstSeen(currentHandle);
    if (ts === null) {
      unresolved.push(currentHandle);
    } else {
      outLines.push(`    listedAt: ${ts},`);
      inserted++;
    }
    currentHandle = null;
  }
}

if (unresolved.length > 0) {
  console.error(`✗ unresolved handles: ${unresolved.join(", ")}`);
  process.exit(1);
}

writeFileSync(FILE, outLines.join("\n"));
console.log(`✓ inserted listedAt on ${inserted} vendors`);
