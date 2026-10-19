#!/usr/bin/env tsx
/**
 * Recency invariants. Pins the 2026-08-13 bug: a hand re-walk of the
 * roster reset 128 verifiedAt values and every "recently added" surface
 * fired at once. isNew must be a pure function of listedAt.
 */
import { VENDORS, isNew, isNewThisWeek, formatVerifiedAge } from "../src/lib/vendors";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${detail ? ` · ${detail}` : ""}`);
    failures++;
  }
}

const DAY = 86_400;
const NOW = 1_786_752_000; // 2026-08-15T00:00:00Z · fixed, never Date.now()

// 1. isNew is invariant to verifiedAt across its whole plausible range.
{
  const base = { listedAt: NOW - 3 * DAY };
  const want = isNew(base, NOW);
  let stable = true;
  for (let d = 0; d <= 400; d++) {
    const v = { ...base, verifiedAt: NOW - d * DAY };
    if (isNew(v as never, NOW) !== want) stable = false;
  }
  check("isNew is invariant to verifiedAt (0-400 days)", stable && want === true);
}

// 2. isNewThisWeek likewise.
{
  const base = { listedAt: NOW - 2 * DAY };
  let stable = true;
  for (let d = 0; d <= 400; d++) {
    const v = { ...base, verifiedAt: NOW - d * DAY };
    if (isNewThisWeek(v as never, NOW) !== true) stable = false;
  }
  check("isNewThisWeek is invariant to verifiedAt", stable);
}

// 3. Thresholds still bite on listedAt.
check("14d boundary · 13 days ago is NEW", isNew({ listedAt: NOW - 13 * DAY }, NOW));
check("14d boundary · 15 days ago is not NEW", !isNew({ listedAt: NOW - 15 * DAY }, NOW));
check("7d boundary · 6 days ago is this-week", isNewThisWeek({ listedAt: NOW - 6 * DAY }, NOW));
check("7d boundary · 8 days ago is not this-week", !isNewThisWeek({ listedAt: NOW - 8 * DAY }, NOW));

// 4. THE REGRESSION: a full-roster re-verification must not mark the
//    directory NEW. Simulates exactly what commit 0d717ee did.
//    Vendors listed AFTER this frozen NOW did not exist on that day
//    and would always look "new" (future listedAt); exclude them so
//    later listings cannot inflate the incident replay.
{
  const thenRoster = VENDORS.filter((v) => v.listedAt <= NOW);
  const swept = thenRoster.map((v) => ({ ...v, verifiedAt: NOW }));
  const newCount = swept.filter((v) => isNew(v, NOW)).length;
  check(
    "full-roster re-verify does not mark the directory NEW",
    newCount <= 5,
    `${newCount} of ${swept.length} read as NEW`,
  );
}

// 5. Digest selection: same sweep must not select the whole roster.
{
  const thenRoster = VENDORS.filter((v) => v.listedAt <= NOW);
  const swept = thenRoster.map((v) => ({ ...v, verifiedAt: NOW }));
  const windowStart = NOW - 7 * DAY;
  const selected = swept.filter((v) => v.listedAt > windowStart).length;
  check(
    "full-roster re-verify does not select every vendor for the weekly digest",
    selected <= 5,
    `${selected} of ${swept.length} selected`,
  );
}

// --- formatVerifiedAge ---
{
  const f = (daysAgo: number) => formatVerifiedAge(NOW - daysAgo * DAY, NOW);
  check("age · same day reads 'today'", f(0) === "today", f(0));
  check("age · 1 day is singular", f(1) === "1 day ago", f(1));
  check("age · 5 days", f(5) === "5 days ago", f(5));
  check("age · 13 days still in days", f(13) === "13 days ago", f(13));
  check("age · 14 days rolls to weeks", f(14) === "2 weeks ago", f(14));
  check("age · 21 days", f(21) === "3 weeks ago", f(21));
  check("age · never returns an empty string", ![0,1,5,13,14,21,29].some(d => f(d) === ""));
}

console.log(
  failures === 0
    ? "\n✓ vendor recency invariants clean"
    : `\n✗ ${failures} failure(s)`,
);
process.exit(failures === 0 ? 0 : 1);
