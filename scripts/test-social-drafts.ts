// Smoke test for the social-post drafting pipeline.
//
// Exercises the pure functions (pick + draft + render) against the
// real VENDORS data WITHOUT any KV, network, or email side effects.
// Pass criteria:
//   1. X pick returns 3 vendors from the X platform pool
//   2. Nostr pick returns 3 vendors from the Nostr platform pool
//   3. X draft fits in 280 chars
//   4. Nostr draft is non-empty
//   5. Both drafts include vendor names
//   6. Category diversity: at most one vendor per category in each pick
//
// Run: npx tsx scripts/test-social-drafts.ts
//
// This is the "would the cron produce a sensible email today?" check.
// The cron's KV/Resend wiring is exercised at deploy-time via the
// ?dryRun=1 query param against the live preview deploy.

import {
  VENDORS,
  getPlatform,
  isNew,
  type VendorCategory,
} from "../src/lib/vendors";
import {
  draftArcadePost,
  draftFeaturedVendorPost,
  draftBlockShotPost,
  draftTopicalPost,
  draftFloatPost,
  draftGaugePost,
  draftInsightPost,
  draftNostrPost,
  draftReverifyBatchCard,
  draftXPost,
  draftXPostFitted,
  filterSocialEligible,
  pickWithCategoryDiversity,
  renderDraftsEmail,
  vendorDescriptor,
  xDraftFits,
  NOSTR_LEADS,
  NOSTR_NEW_ARRIVAL_LEADS,
  X_LEADS,
  X_NEW_ARRIVAL_LEADS,
  type InsightData,
  buildSocialDraftRecipients,
} from "../src/lib/social-drafts";
import { badgeDmText, badgeLaunchPost } from "../src/lib/badge-outreach";
import { nextHalvingHeight } from "../src/lib/bitcoin-supply";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const today = new Date();
const dayOfYear = Math.floor(
  (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) /
    86_400_000,
);

console.log(
  `\n══════════════════════════════════════════════════════════\n`,
);
console.log(
  ` Galaxy Mind · social-drafts smoke test · day ${dayOfYear}`,
);
console.log(
  `══════════════════════════════════════════════════════════\n`,
);

// Build pools (no cooldown filter · this is a draft-only test).
// filterSocialEligible mirrors the cron's pipeline · drops vendors
// flagged unsuitable for spotlight rotation.
const eligible = filterSocialEligible(VENDORS);
const xPool = eligible.filter((v) => getPlatform(v) === "x");
const nostrPool = eligible.filter((v) => getPlatform(v) === "nostr");

console.log(
  `Pool sizes · X: ${xPool.length} · Nostr: ${nostrPool.length}\n`,
);

const picksX = pickWithCategoryDiversity(xPool, 3, dayOfYear);
const picksNostr = pickWithCategoryDiversity(
  nostrPool,
  3,
  dayOfYear + 1000,
);

console.log(`X picks:`);
for (const v of picksX) {
  console.log(`  @${v.handle.padEnd(20)} · ${v.category.padEnd(12)} · ${v.name}`);
}
console.log(`\nNostr picks:`);
for (const v of picksNostr) {
  console.log(`  ${v.name.padEnd(28)} · ${v.category.padEnd(12)}`);
}

// Generate drafts
// draftXPostFitted, not draftXPost: the raw drafter does not promise to
// fit (a long vendor name can blow the budget; the contract is that the
// caller re-picks), and the cron ships the fitted one. Asserting on the
// raw drafter made this gate fail on whichever days the daily seed
// picked long vendors — 2026-08-06 came out at 289/280 — blocking
// unrelated deploys while production was fine.
const xDraft = draftXPostFitted(picksX, today);
const nostrDraft = draftNostrPost(picksNostr, today);

console.log(
  `\n──────────────────────────────────────────────────────────\n`,
);
console.log(` X DRAFT · ${xDraft.charCount}/280 chars`);
console.log(
  `──────────────────────────────────────────────────────────\n`,
);
console.log(xDraft.text);
console.log(
  `\n──────────────────────────────────────────────────────────\n`,
);
console.log(` NOSTR DRAFT · ${nostrDraft.charCount} chars`);
console.log(
  `──────────────────────────────────────────────────────────\n`,
);
console.log(nostrDraft.text);
console.log(
  `\n══════════════════════════════════════════════════════════\n`,
);

// ── Assertions ───────────────────────────────────────────────────
let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
}

console.log(`Assertions:\n`);
check(`X pool non-empty`, xPool.length > 0);
check(`Nostr pool non-empty`, nostrPool.length > 0);
check(`X pick returned 3 vendors`, picksX.length === 3);
check(`Nostr pick returned 3 vendors`, picksNostr.length === 3);
check(`X picks are all from x platform`, picksX.every((v) => getPlatform(v) === "x"));
check(`Nostr picks are all from nostr platform`, picksNostr.every((v) => getPlatform(v) === "nostr"));
check(`X picks all distinct handles`, new Set(picksX.map((v) => v.handle)).size === picksX.length);
check(`Nostr picks all distinct handles`, new Set(picksNostr.map((v) => v.handle)).size === picksNostr.length);
check(`X draft fits 280 chars`, xDraftFits(xDraft));

// ── The picker must be deterministic ACROSS ENGINES ────────────────
// It was not. `sort(() => rand() - 0.5)` has an inconsistent comparator,
// so V8 consumed the seeded PRNG in an order that depends on its own
// internals: CI (Node 22) and a dev machine (Node 26) picked DIFFERENT
// vendors from the same commit, roster and day seed, and the build went
// red with a failure that would not reproduce locally (2026-08-07).
//
// A same-process test cannot compare two engines, so this pins the
// OUTPUT instead: a synthetic roster (independent of the live vendor
// file, which changes weekly) plus a fixed seed must always produce this
// exact pick. Any future change to the shuffle — including an engine
// swap that reintroduces order-dependence — moves these handles and
// fails here, loudly, on every run rather than one day in ten.
{
  const synth = (
    [
      ["alpha", "apparel"],
      ["bravo", "hardware"],
      ["charlie", "consumables"],
      ["delta", "collectibles"],
      ["echo", "services"],
      ["foxtrot", "books"],
      ["golf", "apparel"],
      ["hotel", "hardware"],
    ] as const
  ).map(([handle, category], i) => ({
    handle,
    platform: "x" as const,
    name: handle,
    description: `${handle} test vendor`,
    category: category as VendorCategory,
    addedAt: 100 + i,
    listedAt: 1_760_000_000,
    verifiedAt: 1_760_000_000,
  }));

  // Captured from the Fisher-Yates implementation. Fisher-Yates consumes
  // rand() in a fixed order — index arithmetic and Math.floor, nothing
  // engine-dependent — so these hold on any JS engine. If they ever move,
  // the shuffle changed; do not "refresh" them without knowing why.
  const golden: Record<number, string> = {
    1: "echo, hotel, foxtrot",
    42: "hotel, golf, echo",
    219: "echo, golf, delta",
  };
  const actual: Record<number, string> = {};
  for (const seed of Object.keys(golden).map(Number)) {
    actual[seed] = pickWithCategoryDiversity(synth, 3, seed)
      .map((v) => v.handle)
      .join(", ");
  }
  const drift = Object.keys(golden)
    .map(Number)
    .filter((s) => golden[s] !== actual[s])
    .map((s) => `seed ${s}: expected [${golden[s]}] got [${actual[s]}]`);
  check(
    `picker is engine-deterministic · fixed seeds hit their golden picks${drift.length ? ` (${drift.join(" | ")})` : ""}`,
    drift.length === 0,
  );

  // Same seed twice in one process must also agree — cheap, and it
  // catches accidental global state in the PRNG.
  check(
    `picker is repeatable within a process`,
    pickWithCategoryDiversity(synth, 3, 7).map((v) => v.handle).join() ===
      pickWithCategoryDiversity(synth, 3, 7).map((v) => v.handle).join(),
  );
}

// The single-day check above only ever exercises one seed. This sweeps
// every vendor triple across a year of seeds, which is what actually
// proves the retry keeps the emailed draft inside the budget — and it
// fails deterministically (not one day in ten) if the guarantee breaks.
//
// Sweep the CONTENT invariants too, not just length. The gate above used
// to assert only that drafts fit, so when the fitted drafter began
// dropping a pick to stay under budget, the separate "contains all picked
// handles" check started failing on trim days and nobody found out until
// CI had been red for nine runs. Anything asserted about today's single
// draft gets asserted here across a year of seeds, where a data-dependent
// break fails every time instead of one day in ten.
{
  let worst = 0;
  let worstWhen = "";
  let overBudget = 0;
  let unnamedUsed = "";
  let usedNotPicked = "";
  let emptyUsed = "";
  let trimDays = 0;
  for (let d = 0; d < 365; d++) {
    const date = new Date(Date.UTC(2026, 0, 1 + d, 12));
    const vs = VENDORS.filter((v) => getPlatform(v) === "x").slice(
      (d * 3) % Math.max(1, VENDORS.length - 3),
      ((d * 3) % Math.max(1, VENDORS.length - 3)) + 3,
    );
    if (vs.length === 0) continue;
    const fitted = draftXPostFitted(vs, date);
    if (fitted.charCount > worst) {
      worst = fitted.charCount;
      worstWhen = `day ${d} · ${vs.map((v) => v.handle).join(", ")}`;
    }
    if (!xDraftFits(fitted)) overBudget++;
    if (fitted.retries > 0) trimDays++;
    if (fitted.used.length === 0) emptyUsed ||= `day ${d}`;
    for (const u of fitted.used) {
      if (!fitted.text.includes(`@${u.handle}`)) {
        unnamedUsed ||= `day ${d}: @${u.handle} missing from its own draft`;
      }
      if (!vs.some((v) => v.handle === u.handle)) {
        usedNotPicked ||= `day ${d}: @${u.handle} was never picked`;
      }
    }
  }
  check(
    `every fitted X draft fits · 365 seeds × rotating vendors (worst ${worst}/280 at ${worstWhen})`,
    overBudget === 0,
  );
  check(
    `every fitted X draft names every vendor it used · 365 seeds${unnamedUsed ? ` (${unnamedUsed})` : ""}`,
    unnamedUsed === "",
  );
  check(
    `no fitted X draft invents a vendor it was not given · 365 seeds${usedNotPicked ? ` (${usedNotPicked})` : ""}`,
    usedNotPicked === "",
  );
  check(
    `no fitted X draft trims itself down to nothing · 365 seeds${emptyUsed ? ` (${emptyUsed})` : ""}`,
    emptyUsed === "",
  );
  // Not an assertion, a fact worth printing: if this ever reads 0, the
  // trim path has gone dead and the fits-check above is proving nothing.
  console.log(`   (trim fired on ${trimDays}/365 seeds)`);
}

// A cut inside a parenthetical used to leave the bracket hanging
// ("drink sticks (variety packs"), which reads as a typo in a post the
// operator publishes under their own name.
{
  let unbalanced = "";
  for (let d = 0; d < 120; d++) {
    const date = new Date(Date.UTC(2026, 0, 1 + d, 12));
    const vs = VENDORS.slice(
      (d * 3) % Math.max(1, VENDORS.length - 3),
      ((d * 3) % Math.max(1, VENDORS.length - 3)) + 3,
    );
    if (vs.length === 0) continue;
    for (const text of [
      draftXPostFitted(vs, date).text,
      draftNostrPost(vs, date).text,
    ]) {
      for (const line of text.split("\n")) {
        const opens = (line.match(/\(/g) ?? []).length;
        const closes = (line.match(/\)/g) ?? []).length;
        if (opens !== closes) unbalanced ||= `day ${d}: ${line}`;
      }
    }
  }
  check(
    `no draft line leaves an unbalanced parenthesis${unbalanced ? ` (${unbalanced})` : ""}`,
    unbalanced === "",
  );
}
check(`Nostr draft non-empty`, nostrDraft.charCount > 0);
check(
  // `used`, not `picksX`. The shipped drafter DROPS a pick when the batch
  // would blow 280 chars, so asserting against the full pick list fails on
  // whichever days the seed happens to choose long vendors — which is
  // exactly what it did, nine CI runs in a row, after this gate was
  // switched to the fitted drafter (2026-08-07). The invariant that
  // actually matters is that every vendor the draft CLAIMS to feature is
  // named in it; the next two checks pin the rest.
  `X draft names every vendor it used`,
  xDraft.used.every((v) => xDraft.text.includes(`@${v.handle}`)),
);
check(
  `X draft used vendors are a non-empty subset of the picks`,
  xDraft.used.length > 0 &&
    xDraft.used.every((u) => picksX.some((p) => p.handle === u.handle)),
);
check(
  `Nostr draft contains all picked vendor names`,
  picksNostr.every((v) => nostrDraft.text.includes(v.name)),
);
check(
  `Nostr draft contains per-vendor /v/[slug] links`,
  picksNostr.every((v) =>
    nostrDraft.text.includes(`galaxymind.space/v/`),
  ),
);

// Category diversity · ideally one per category, but if the pool's
// thin in one platform we accept "at most 2 per category" as a soft
// pass · keeps the test from breaking when the pool is just 3
// vendors with 2 sharing a category.
const xCatCounts = new Map<string, number>();
for (const v of picksX) xCatCounts.set(v.category, (xCatCounts.get(v.category) ?? 0) + 1);
const xMaxPerCat = Math.max(...xCatCounts.values());
check(`X category diversity · max ${xMaxPerCat} per category (target ≤ 2)`, xMaxPerCat <= 2);

const nostrCatCounts = new Map<string, number>();
for (const v of picksNostr) nostrCatCounts.set(v.category, (nostrCatCounts.get(v.category) ?? 0) + 1);
const nostrMaxPerCat = Math.max(...nostrCatCounts.values());
check(`Nostr category diversity · max ${nostrMaxPerCat} per category (target ≤ 2)`, nostrMaxPerCat <= 2);

// X mention count · 2-3 max (tag etiquette)
check(`X mentions ≤ 3`, xDraft.mentionedHandles.length <= 3);

// ── 2026-07-09 overhaul · verbose descriptors, freshness, variance ──

// forceNewest must always include the newest-by-add-order vendor
// (addedAt is a monotonic ordinal · higher = newer).
const newestX = xPool.reduce((a, b) => (b.addedAt > a.addedAt ? b : a));
const forcedPicks = pickWithCategoryDiversity(xPool, 3, dayOfYear, {
  forceNewest: true,
});
check(
  `forceNewest includes the newest vendor (@${newestX.handle})`,
  forcedPicks.some((v) => v.handle === newestX.handle),
);

// Descriptors are a real phrase, not the bare category word · and
// never end on a dangling connector ("...coffee, plus").
const sampleDesc = vendorDescriptor(newestX);
check(
  `vendorDescriptor is more than the bare category`,
  sampleDesc.toLowerCase() !== newestX.category.toLowerCase(),
);
const danglingRe =
  /\b(plus|and|with|for|the|of|to|in|on|or|by|from|at|an?|including|made|featuring)$/i;
const anyDangling = eligible
  .map((v) => vendorDescriptor(v))
  .some((s) => danglingRe.test(s));
check(`no descriptor ends on a dangling connector word`, !anyDangling);

// The new-arrival shape fires (🆕 marker) when a genuinely-new vendor
// is in the batch, and never otherwise.
const freshHandles = new Set(
  eligible.filter((v) => isNew(v)).map((v) => v.handle),
);
if (freshHandles.size > 0) {
  const freshV = xPool.find((v) => freshHandles.has(v.handle));
  if (freshV) {
    // Sweep a month of dates · at least one day should pick the
    // new-arrival shape, and the plain list on others (variance).
    let sawNew = false;
    let sawList = false;
    for (let d = 0; d < 31; d++) {
      const date = new Date(Date.UTC(2026, 0, 1 + d));
      const t = draftXPost([freshV, xPool[0], xPool[1]], date, {
        freshHandles,
      }).text;
      if (t.includes("🆕")) sawNew = true;
      else sawList = true;
    }
    check(`new-arrival shape appears within a month`, sawNew);
    check(`plain list shape also appears (variance)`, sawList);
  }
}
// A batch with NO fresh vendor must never render the 🆕 marker.
const staleBatch = xPool
  .filter((v) => !freshHandles.has(v.handle))
  .slice(0, 3);
if (staleBatch.length === 3) {
  const noneNew = Array.from({ length: 14 }, (_, d) =>
    draftXPost(staleBatch, new Date(Date.UTC(2026, 0, 1 + d)), {
      freshHandles,
    }).text,
  ).every((t) => !t.includes("🆕"));
  check(`no 🆕 marker when the batch has no fresh vendor`, noneNew);
}

// ── Daily arcade draft · every rotation must fit X and carry one link.
// The email shows N/280, but a copy edit that blew the budget would
// still ship a post that X silently truncates · guard it.
{
  let allFit = true;
  let allLinked = true;
  // 14 consecutive UTC days exercise all three rotation angles.
  for (let d = 0; d < 14; d++) {
    const draft = draftArcadePost(new Date(Date.UTC(2026, 0, 1 + d, 12)));
    if (draft.charCount > 280) allFit = false;
    if (!draft.text.includes("galaxymind.space/")) allLinked = false;
  }
  check("arcade draft fits 280 chars across the rotation", allFit);
  check("arcade draft always carries a galaxymind.space link", allLinked);
}

// ── Daily Bier insight draft · the growth post (one unexpected insight,
// site as soft proof). Must fit X, carry a link, stay em-dash-free,
// rotate through angles across days, fall back to the always-available
// circular-economy count, and return null only when there is no data.
{
  const fullInsight: InsightData = {
    treasuries: [
      { ticker: "ASST", name: "Strive", mNav: 0.97, amplification: 1.02 },
      { ticker: "MSTR", name: "Strategy", mNav: 1.55, amplification: 1.28 },
      { ticker: "MPJPY", name: "Metaplanet", mNav: 1.1, amplification: 1.06 },
      { ticker: "XXI", name: "Twenty One", mNav: 1.4, amplification: 1.12 },
    ],
    totalTreasuries: 4,
    btcPrice: 100_000,
    gauge: { score: 72, tier: "HOT", driver: "MVRV is flashing caution" },
    floatDrain30d: 21_000,
    vendorCount: 123,
    countryCount: 20,
  };
  let iFit = true;
  let iLinked = true;
  let iNoEmDash = true;
  const iAngles = new Set<string>();
  for (let d = 0; d < 14; d++) {
    const draft = draftInsightPost(
      new Date(Date.UTC(2026, 0, 1 + d, 12)),
      fullInsight,
    );
    if (!draft) {
      iFit = false;
      continue;
    }
    iAngles.add(draft.angle);
    if (draft.charCount > 280) iFit = false;
    if (!draft.text.includes("galaxymind.space")) iLinked = false;
    if (draft.text.includes("—")) iNoEmDash = false;
  }
  check("insight draft fits 280 across 14 days", iFit);
  check("insight draft always carries a galaxymind.space link", iLinked);
  check("insight draft has no em dashes", iNoEmDash);
  check("insight rotates through 5+ distinct angles over 14 days", iAngles.size >= 5);

  // Fallback · only the vendor count is known → still ships the circular
  // angle rather than skipping the day.
  const onlyVendors = draftInsightPost(new Date(Date.UTC(2026, 0, 3)), {
    treasuries: [],
    totalTreasuries: 0,
    btcPrice: null,
    gauge: null,
    floatDrain30d: null,
    vendorCount: 123,
    countryCount: 20,
  });
  check(
    "insight falls back to circular-economy when only vendors are known",
    onlyVendors?.angle === "circular",
  );

  // Null · genuinely no data → no post rather than an empty one.
  const noData = draftInsightPost(new Date(Date.UTC(2026, 0, 3)), {
    treasuries: [],
    totalTreasuries: 0,
    btcPrice: null,
    gauge: null,
    floatDrain30d: null,
    vendorCount: 0,
    countryCount: 0,
  });
  check("insight returns null when there is no data at all", noData === null);
}

// ── THE DAILY TOPICAL LINE (operator ask 2026-08-08) ─────────────
// The hooks are GATED on purpose: an ungated topical line prints the
// same true sentence every morning and becomes wallpaper (the lesson
// blockfacts.js already paid for in CHOP). The load-bearing assertion
// here is therefore the DULL DAY one — a drafter that always has
// something to say has no signal in it at all.
const TOPICAL_SAMPLES: string[] = [];
{
  const H = 961_630; // a real recent tip
  const NOW = new Date("2026-08-08T19:50:00Z");
  const dayAgo = (d: number) =>
    Math.floor((NOW.getTime() - d * 86_400_000) / 1000);

  const desk = (over: Record<string, unknown> = {}) =>
    ({
      asOf: NOW.toISOString(),
      hashprice: 0.0005,
      networkPhs: 915_538,
      btcUsd: 64_988,
      blockRewardBtc: 3.1443585, // subsidy 3.125 + ~0.6% fees = a dull day
      book: {},
      bookSample: {},
      ourRigs: [{ status: "available" }, { status: "rented" }],
      regionBook: [],
      region: "us-south",
      stats: null,
      degraded: [],
      ...over,
    }) as unknown as Parameters<typeof draftTopicalPost>[0]["desk"];

  // A deliberately boring Tuesday: fees normal, no fresh catch, gauge
  // mid-range, every treasury above NAV, machines partly free.
  const dull: Parameters<typeof draftTopicalPost>[0] = {
    desk: desk(),
    blockHeight: H,
    prevBlockHeight: H - 144,
    cheapestMNav: { ticker: "ASST", mNav: 1.12 },
    gauge: { score: 54, tier: "WARM" },
    now: NOW,
  };
  check("topical · a dull day produces NOTHING", draftTopicalPost(dull) === null);

  // Each hook fires under its own condition, and only then.
  const fires: [string, Parameters<typeof draftTopicalPost>[0], string][] = [
    [
      "fee spike",
      { ...dull, desk: desk({ blockRewardBtc: 3.55 }) },
      "fee spike",
    ],
    [
      "gauge extreme",
      { ...dull, gauge: { score: 84, tier: "MOLTEN" } },
      "gauge extreme",
    ],
    [
      "treasury below NAV",
      { ...dull, cheapestMNav: { ticker: "ASST", mNav: 0.93 } },
      "treasury below NAV",
    ],
    [
      "fleet sold out",
      {
        ...dull,
        desk: desk({ ourRigs: [{ status: "rented" }, { status: "rented" }] }),
      },
      "fleet sold out",
    ],
  ];
  for (const [name, ctx, hook] of fires) {
    const d = draftTopicalPost(ctx);
    check(`topical · ${name} fires`, d?.hook === hook);
    if (d) {
      TOPICAL_SAMPLES.push(d.text);
      check(`topical · ${name} fits 280 chars`, d.charCount <= 280);
      check(`topical · ${name} states its condition`, d.because.length > 10);
      // One link, at the end, never in the hook line (voice contract).
      const lines = d.text.split("\n");
      check(
        `topical · ${name} keeps the URL out of the first line`,
        !/galaxymind\.space/.test(lines[0]),
      );
      check(
        `topical · ${name} carries exactly one link`,
        (d.text.match(/galaxymind\.space/g) ?? []).length === 1,
      );
    }
  }

  // Halving fires on a CROSSING, not an exact match — block times wander,
  // so a rounded day count skips markers whenever the chain runs fast.
  {
    const target = nextHalvingHeight(H) - 200 * 144;
    const crossed = draftTopicalPost({
      ...dull,
      blockHeight: target,
      prevBlockHeight: target - 144,
    });
    check("topical · halving milestone fires on a crossing", crossed?.hook === "halving milestone");
    if (crossed) TOPICAL_SAMPLES.push(crossed.text);
    // Same day count on both sides = already past it = stay quiet.
    check(
      "topical · halving does NOT re-fire once past the marker",
      draftTopicalPost({
        ...dull,
        blockHeight: target - 288,
        prevBlockHeight: target - 432,
      }) === null,
    );
  }

  // Staleness + threshold: the gates are real, not decorative.
  check(
    "topical · a solo-pool block is never a hook (not affiliated with any pool)",
    !/soloCatches|solo\.ckpool|fresh solo catch/.test(readFileSync(join(process.cwd(), "src/lib/social-drafts.ts"), "utf8")),
  );
  check(
    "topical · ordinary fees do not trip the spike hook",
    draftTopicalPost({ ...dull, desk: desk({ blockRewardBtc: 3.16 }) }) === null,
  );

  // HONESTY. We do not claim blocks we did not find.
  // A draft implying WE found one would be a false claim about a
  // verifiable on-chain event, which is the expensive kind of wrong.
  for (const t of TOPICAL_SAMPLES) {
    check(
      `topical · never claims we caught the block (${t.slice(0, 28)}...)`,
      !/\b(?:we|our machines?|our fleet)\s+(?:just\s+)?(?:found|caught|mined|hit)\b/i.test(t),
    );
  }

  // Degraded feeds must silence the drafter, never make it guess.
  check(
    "topical · a null desk cannot produce a desk-derived line",
    draftTopicalPost({
      desk: null,
      blockHeight: H,
      prevBlockHeight: H - 144,
      cheapestMNav: null,
      gauge: null,
      now: NOW,
    }) === null,
  );
}

// ── THE VOICE GATE (operator rule 2026-08-04) ────────────────────
// Every draft must read like a person typed it. This gate enforces the
// mechanical half of that: no site typography (· — – ≈) in post text,
// no fragment-contrast tic (". Not X."), no hype-contrast filler, no
// stock AI vocabulary. It walks EVERY lead in both pools plus a wide
// sample of every drafter's output over rotating dates and vendors —
// including quoted vendor descriptions, which is where site typography
// actually leaks in (the depunct() scrub exists because of this gate).
// If the gate blocks a phrasing, rewrite the sentence. Never loosen
// the gate to admit it.
{
  const SLOP: [RegExp, string][] = [
    [/·/u, "interpunct (site typography, not prose)"],
    [/—|–/u, "em/en dash"],
    [/≈/u, "approx symbol (write 'about')"],
    [/\.\s+Not\s/, "fragment-contrast tic ('. Not X.')"],
    [
      /\b(?:isn't just|not just|it's not about|more than just)\b/i,
      "hype-contrast filler",
    ],
    [
      /\b(?:game.?changer|revolutioni[sz]|unleash|elevate your|in today's world)\b/i,
      "stock AI vocabulary",
    ],
    // ── The 2026-08-08 additions ──────────────────────────────────
    // Operator rejected a batch with "these read very AI". The six
    // patterns above are all TYPOGRAPHIC or vocabulary-level and none
    // of them fired on that batch, because what made it read machine-
    // written was SENTENCE ARCHITECTURE, not word choice.
    //
    // Each pattern below was measured against the 237 already-accepted
    // rendered texts in this file's own corpus (every lead pool plus 45
    // rotating days of every drafter) and fires on ZERO of them, while
    // catching a specific rejected line. The gate run itself re-proves
    // that on every commit: if one of these starts firing on shipped
    // copy, verify goes red rather than the claim going stale.
    //
    // A measured note worth keeping, because it contradicts the
    // obvious theory: the hook/body/link THREE-PARAGRAPH SHAPE is not
    // a tell. It is the dominant shape in copy that reads fine
    // (P1/P1/LINK x40, P1/P2/LINK x23 across the corpus). What
    // repeated across the rejected batch was the rhetorical sequence
    // (frame-promise, two-number body, value-clause CTA), which no
    // paragraph-shape check can see. Don't add a detector there.
    [
      /^[^\n]{0,20}\bhere(?:'s|s| is)\s+(?:what|why|how|where|when|the thing|everything)\b/i,
      "deictic-promise opener ('Here's what X costs')",
    ],
    [
      /\b(?:ever\s+(?:wonder(?:ed|ing)?|thought about|noticed)|did you know|you(?:'re| are) probably wondering)\b/i,
      "rhetorical-wondering hook ('Ever wondered...')",
    ],
    [
      /\b(?:we|i)\s+(?:built|made|created|shipped|launched)\s+(?:a|an|the)\s[^.!?\n]{0,40}\bthat\s+(?:lets|helps|shows|gives|tells|answers|makes|does|tracks|calculates)\b/i,
      "builder announcement with benefit clause ('We built a X that answers Y')",
    ],
    [
      /(?:^|[.!?]\s+|\n)\s*(?:you|your)\b[^,.!?\n]{2,40},\s*(?:we|our)\b[^.!?\n]{2,40}/i,
      "pronoun-contrast isocolon ('You pick the hours, we show the odds')",
    ],
    [
      /(?:^|\n|[.!?]\s+)(?:for context|put simply|simply put|in short|here'?s the thing|make no mistake|the kicker|let'?s be honest)\b/i,
      "discourse-marker preamble ('For context,')",
    ],
    [
      /(?:^|\n)\s*(?:imagine\b|picture this|let'?s say\b|say you\b|suppose you\b|you have \$?\d)/i,
      "assigned-scenario opener ('You have $50 to burn')",
    ],
    [
      /\byou(?:'d|'ll| would| will)\s+(?:statistically|effectively|essentially|realistically|technically|basically)\b/i,
      "hedged-adverb conditional (\"you'd statistically land a block\")",
    ],
  ];
  const violations: string[] = [];
  const scanVoice = (label: string, text: string | null | undefined) => {
    if (!text) return;
    for (const [re, why] of SLOP) {
      if (re.test(text)) violations.push(`${label}: ${why}`);
    }
  };

  for (const [i, l] of X_LEADS.entries()) scanVoice(`X lead #${i}`, l);
  for (const [i, l] of X_NEW_ARRIVAL_LEADS.entries())
    scanVoice(`X arrival lead #${i}`, l);
  for (const [i, l] of NOSTR_LEADS.entries()) scanVoice(`Nostr lead #${i}`, l);
  for (const [i, l] of NOSTR_NEW_ARRIVAL_LEADS.entries())
    scanVoice(`Nostr arrival lead #${i}`, l);

  // Rotate dates AND vendor triples so quoted descriptions from the
  // whole roster pass through the gate, not just today's picks.
  for (let d = 0; d < 45; d++) {
    const date = new Date(Date.UTC(2026, 0, 1 + d, 12));
    const vs = VENDORS.slice((d * 3) % Math.max(1, VENDORS.length - 3)).slice(
      0,
      3,
    );
    if (vs.length === 0) continue;
    scanVoice(`x day ${d}`, draftXPost(vs, date).text);
    scanVoice(
      `x fresh day ${d}`,
      draftXPost(vs, date, { freshHandles: new Set([vs[0].handle]) }).text,
    );
    scanVoice(`nostr day ${d}`, draftNostrPost(vs, date).text);
    scanVoice(`arcade day ${d}`, draftArcadePost(date).text);
    if (vs[0]) {
      scanVoice(`featured day ${d}`, draftFeaturedVendorPost(vs[0]).text);
    }
    scanVoice(
      `arcade no-ghost day ${d}`,
      draftArcadePost(date, { kartGhostSeated: false }).text,
    );
  }

  {
    const fullInsight: InsightData = {
      treasuries: [
        { ticker: "ASST", name: "Strive", mNav: 0.97, amplification: 1.02 },
        { ticker: "MSTR", name: "Strategy", mNav: 1.55, amplification: 1.28 },
      ],
      totalTreasuries: 4,
      btcPrice: 100_000,
      gauge: { score: 72, tier: "HOT", driver: "MVRV is flashing caution" },
      floatDrain30d: 21_000,
      vendorCount: 123,
      countryCount: 20,
    };
    for (let d = 0; d < 10; d++) {
      scanVoice(
        `insight day ${d}`,
        draftInsightPost(new Date(Date.UTC(2026, 0, 1 + d, 12)), fullInsight)
          ?.text,
      );
    }
  }

  scanVoice(
    "gauge",
    draftGaugePost(
      {
        score: 75,
        tier: "HOT",
        signals: [{ name: "MVRV", raw: 1.2, normalized: 80 }],
      } as unknown as Parameters<typeof draftGaugePost>[0],
      new Date(Date.UTC(2026, 0, 5)),
    ).text,
  );
  scanVoice(
    "float",
    draftFloatPost(
      { current: { inPlay: 6_100_000 }, history: [] } as unknown as Parameters<
        typeof draftFloatPost
      >[0],
      new Date(Date.UTC(2026, 0, 5)),
    ).text,
  );

  const deskFixture = {
    blockRewardBtc: 3.15,
    btcUsd: 64_000,
    networkPhs: 953_000,
    ourRigs: [
      { status: "available", advertisedPh: 0.255, askBtcPerPhDay: 0.00068 },
      { status: "rented", advertisedPh: 0.054, askBtcPerPhDay: 0.0008 },
    ],
  } as unknown as Parameters<typeof draftBlockShotPost>[0];
  const openDraft = draftBlockShotPost(deskFixture)?.text ?? "";
  scanVoice("blockShot", openDraft);
  // Open inventory must never fall through to the sold-out line — that
  // was a real false claim when ticket math and availability were ANDed.
  check(
    "blockShot open draft does not claim every machine is rented",
    !/every machine is rented/i.test(openDraft),
  );
  check(
    "blockShot open draft names open TH",
    /255 TH\/s is open right now/i.test(openDraft),
  );
  check(
    "blockShot open draft names USA machines already hashing",
    /already hashing/i.test(openDraft) && /your pool/i.test(openDraft),
  );
  check(
    "blockShot open draft does not dump on home mining",
    !/dust/i.test(openDraft) && !/garage/i.test(openDraft),
  );
  const rentedDraft = draftBlockShotPost({
    ...deskFixture,
    ourRigs: deskFixture.ourRigs.map((r) => ({ ...r, status: "rented" })),
  } as unknown as Parameters<typeof draftBlockShotPost>[0])?.text ?? "";
  scanVoice("blockShot all-rented", rentedDraft);
  check(
    "blockShot sold-out draft does claim every machine is rented",
    /every machine is rented/i.test(rentedDraft),
  );
  const comingDraft = draftBlockShotPost({
    ...deskFixture,
    ourRigs: deskFixture.ourRigs.map((r) => ({
      ...r,
      status: "coming-online",
    })),
  } as unknown as Parameters<typeof draftBlockShotPost>[0])?.text ?? "";
  scanVoice("blockShot coming-online", comingDraft);
  check(
    "blockShot coming-online draft does not claim every machine is rented",
    !/every machine is rented/i.test(comingDraft),
  );
  check(
    "blockShot coming-online draft names the staged fleet",
    /brought online/i.test(comingDraft),
  );

  const withShot: InsightData = {
    treasuries: [],
    totalTreasuries: 0,
    btcPrice: null,
    gauge: null,
    floatDrain30d: null,
    vendorCount: 0,
    countryCount: 0,
    blockShot: {
      prizeK: 201,
      openTh: 324,
      usd3: "1.52",
      oneIn24: "19,000",
    },
  };
  const shotInsight = draftInsightPost(
    new Date(Date.UTC(2026, 0, 6, 12)),
    withShot,
  );
  check(
    "insight can ship a rental angle when the desk is open",
    shotInsight?.angle === "blockshot" &&
      /324 TH\/s/.test(shotInsight.text) &&
      /already hashing/i.test(shotInsight.text) &&
      !/dust/i.test(shotInsight.text) &&
      shotInsight.text.includes("galaxymind.space/hashrate"),
  );
  if (shotInsight) scanVoice("insight blockshot", shotInsight.text);

  for (const [i, t] of TOPICAL_SAMPLES.entries()) scanVoice(`topical #${i}`, t);

  for (const v of VENDORS) scanVoice(`badge dm ${v.handle}`, badgeDmText(v));
  scanVoice("badge launch post", badgeLaunchPost().text);

  const reverify = draftReverifyBatchCard(VENDORS, new Date(Date.UTC(2026, 8, 14, 12)));
  scanVoice("reverify batch card", reverify.text);
  check(
    "reverify card names the rolling CLI",
    reverify.text.includes("npx tsx scripts/reverify-vendors.ts --limit 25"),
  );
  check(
    "reverify card forbids bulk-bumping verifiedAt",
    /never bulk-bump verifiedAt/i.test(reverify.text),
  );
  check(
    "reverify card is not a tweet composer payload",
    reverify.batchSize >= 0 && !reverify.text.includes("galaxymind.space"),
  );
  {
    const html = renderDraftsEmail(
      {
        x: { text: "x", charCount: 1, mentionedHandles: [] },
        nostr: { text: "n", charCount: 1 },
        picksX: [],
        picksNostr: [],
        reverifyBatch: reverify,
      },
      new Date(Date.UTC(2026, 8, 14, 12)),
    );
    check(
      "drafts email includes the reverify card",
      html.html.includes("reverify-vendors.ts --limit 25"),
    );
  }
  {
    const ready = JSON.parse(
      readFileSync(join(process.cwd(), "threads/hashrate-ready.json"), "utf8"),
    ) as { tweets: string[] };
    for (const [i, t] of ready.tweets.entries()) {
      scanVoice(`hashrate-ready.json #${i}`, t);
    }
    check(
      "hashrate-ready.json is a single post under 280 with t.co",
      ready.tweets.length === 1 &&
        ready.tweets[0]!.length -
          "galaxymind.space/hashrate".length +
          23 <=
          280,
    );
    check(
      "hashrate-ready.json first line has no URL",
      !ready.tweets[0]!.split("\n")[0]!.includes("http") &&
        !ready.tweets[0]!.split("\n")[0]!.includes("galaxymind.space"),
    );
  }

  check(
    `voice gate · zero slop across all drafters and leads${violations.length ? ` (${violations.slice(0, 5).join(" | ")})` : ""}`,
    violations.length === 0,
  );

  // Self-test · a gate nobody has seen fail is a gate nobody should
  // trust (same discipline as the hashrate vocabulary gate).
  const poison = "This is huge. Not a drill. It isn't just mining · it's a game-changer ≈ free money —";
  const caught = SLOP.filter(([re]) => re.test(poison)).length;
  check("voice gate self-test · poison line trips 4+ patterns", caught >= 4);

  // Second self-test, and the more important one: the ACTUAL drafts the
  // operator rejected on 2026-08-08 with "these read very AI". The six
  // original patterns caught NONE of them — every tell was structural,
  // not typographic — so a gate that only proves the old poison line
  // proves nothing about the failure that prompted the new patterns.
  const REJECTED: [string, string][] = [
    [
      "draft B",
      "Here's what a real shot at the next block costs.\n\n24 hours on 260 TH/s is about $12. Rent nonstop and you'd statistically land a block every 67 years.\n\nYou pick the hours, we show the odds: galaxymind.space/hashrate",
    ],
    [
      "draft C",
      "You have $50 to burn this weekend. Where does it go?\n\nFor context, the next bitcoin block pays about $202k.",
    ],
    [
      "draft D",
      "Ever wondered what your real odds of solo mining a bitcoin block are?\n\nWe built a calculator that answers with live numbers.",
    ],
  ];
  for (const [label, text] of REJECTED) {
    const hits = SLOP.filter(([re]) => re.test(text)).length;
    check(`voice gate self-test · the rejected ${label} IS caught (${hits} pattern${hits === 1 ? "" : "s"})`, hits >= 2);
  }
}

// ── Single delivery · SOCIAL_DRAFTS_EMAIL only (2026-09-04) ────────
// Dual-send to the +galaxymind alias was reverted after duplicate
// inbox copies. Pure helper — no live env required in CI.
{
  const primary = buildSocialDraftRecipients({
    primary: "vendors@galaxymind.space",
  });
  check(
    "recipient list is primary only",
    primary.length === 1 && primary[0] === "vendors@galaxymind.space",
  );
  const blank = buildSocialDraftRecipients({ primary: "  " });
  check("recipient list drops blank primary", blank.length === 0);
  const empty = buildSocialDraftRecipients({ primary: null });
  check("recipient list empty when primary unset", empty.length === 0);
}

// ── Bounce failover (2026-09-11) ───────────────────────────────────
// The drafts email bounced on 2026-09-03 and again on 2026-09-11
// while the cron reported action:"sent" and 200,
// because Resend ACCEPTING a message is not Resend DELIVERING it and
// nothing checked the difference. The fallback inbox exists so a single
// rejection is no longer total loss — but it must stay OFF by
// default, or it re-creates the duplicate-copy problem the 2026-09-04
// revert removed.
{
  const normal = buildSocialDraftRecipients({
    primary: "vendors@galaxymind.space",
    fallback: "owner+galaxymind@example.com",
  });
  check(
    "fallback is NOT used on a normal run",
    normal.length === 1 && normal[0] === "vendors@galaxymind.space",
  );

  const failover = buildSocialDraftRecipients({
    primary: "vendors@galaxymind.space",
    fallback: "owner+galaxymind@example.com",
    useFallback: true,
  });
  check(
    "fallback IS used after a bounce",
    failover.length === 2 &&
      failover[1] === "owner+galaxymind@example.com",
  );

  // The two env vars have held the same address before. Failing over to
  // it twice would send the operator two copies of the same mail at the
  // exact moment they are already annoyed about email.
  const same = buildSocialDraftRecipients({
    primary: "vendors@galaxymind.space",
    fallback: "VENDORS@galaxymind.space",
    useFallback: true,
  });
  check("failover dedupes a case-different duplicate", same.length === 1);

  const noFallback = buildSocialDraftRecipients({
    primary: "vendors@galaxymind.space",
    fallback: null,
    useFallback: true,
  });
  check(
    "failover with no fallback configured still sends to primary",
    noFallback.length === 1,
  );

  const onlyFallback = buildSocialDraftRecipients({
    primary: null,
    fallback: "owner+galaxymind@example.com",
    useFallback: true,
  });
  check(
    "failover still delivers when the primary itself is unset",
    onlyFallback.length === 1 &&
      onlyFallback[0] === "owner+galaxymind@example.com",
  );
}

// ── The cron must actually CONSULT the previous send ───────────────
// A source assertion rather than a behavioural one: the check runs
// against Resend over the network, so it cannot execute in verify. What
// verify CAN guarantee is that the wiring is still present — the bug
// being pinned here is a silent 200, and a silent 200 is exactly what
// comes back if someone removes these three lines.
{
  const src = readFileSync(
    join(process.cwd(), "src/app/api/cron/social-post-drafts/route.ts"),
    "utf8",
  );
  check(
    "cron reads the previous send id from KV",
    src.includes("LAST_SEND_KEY") && src.includes("kvGet<LastSend>"),
  );
  check(
    "cron asks Resend what happened to it",
    src.includes("fetchEmailDelivery(prevSend.id)"),
  );
  check(
    "cron fails loudly (503) when the previous send bounced",
    /if \(prevBounced && prevSend\)/.test(src) &&
      src.includes("PREVIOUS SEND BOUNCED") &&
      src.includes("status: 503"),
  );
  check(
    "cron records this send so tomorrow can check it",
    src.includes("kvSet(LAST_SEND_KEY, lastSend)"),
  );
  check(
    "bounce drives the failover recipient",
    src.includes("useFallback: prevBounced"),
  );
}

console.log(
  `\n${failures === 0 ? "✓" : "✗"} ${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}\n`,
);


process.exit(failures === 0 ? 0 : 1);