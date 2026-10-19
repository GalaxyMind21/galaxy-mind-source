import { readFileSync } from "fs";
import { buildRun, hasUnnotifiedEntries, parseQueue, type QueueEntry,
  pruneNotified,
} from "../src/lib/vendor-queue";
import type { VendorSignals } from "../src/lib/vendor-signals";

let passed = 0, failed = 0;
function assert(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}`); }
}

const ok = (handle: string): VendorSignals => ({
  handle, observedAt: 1, failStreak: 0, lud16: null,
  shop: { kind: "ok", markers: { bitcoin: true, lightning: false, btc: false } },
  profile: null,
});
const gone = (handle: string, streak = 0): VendorSignals => ({
  ...ok(handle), failStreak: streak, shop: { kind: "gone", status: 404 },
});

assert("a clean run queues nothing", (() => {
  const r = buildRun([ok("a"), ok("b")], [ok("a"), ok("b")]);
  return !r.aborted && r.queue.length === 0;
})());

assert("one bad probe does not queue and DOES persist the streak", (() => {
  const r = buildRun([ok("a")], [gone("a")]);
  return r.queue.length === 0 && r.toStore[0].failStreak === 1;
})());

assert("the third consecutive failure queues", (() => {
  const r = buildRun([gone("a", 2)], [gone("a")]);
  return r.queue.length === 1 && r.toStore[0].failStreak === 3;
})());

assert("more than 30% failures aborts and writes nothing", (() => {
  const prev = ["a","b","c","d"].map(ok);
  const next = [gone("a"), gone("b"), ok("c"), ok("d")]; // 50%
  const r = buildRun(prev, next);
  return r.aborted && r.toStore.length === 0 && r.queue.length === 0;
})());

assert("exactly 25% failure does NOT abort", (() => {
  const prev = ["a","b","c","d"].map(ok);
  const r = buildRun(prev, [gone("a"), ok("b"), ok("c"), ok("d")]);
  return !r.aborted;
})());

assert("unprobeable does not count toward the abort ratio", (() => {
  const prev = ["a","b","c","d"].map(ok);
  const next: VendorSignals[] = [
    { ...ok("a"), shop: { kind: "unprobeable", reason: "403" } },
    { ...ok("b"), shop: { kind: "unprobeable", reason: "403" } },
    ok("c"), ok("d"),
  ];
  return !buildRun(prev, next).aborted;
})());

assert("a vendor with no baseline is stored but never queued", (() => {
  const r = buildRun([], [ok("new")]);
  return r.queue.length === 0 && r.toStore.length === 1;
})());

// ── hasUnnotifiedEntries · email on CHANGE, not on non-empty state ──────

const entry = (handle: string, priority: QueueEntry["priority"] = "normal"): QueueEntry => ({
  handle,
  reason: "unreachable 3 days running",
  priority,
});

assert(
  "an empty queue has nothing unnotified",
  !hasUnnotifiedEntries([], []),
);
assert(
  "a queue entry not in the notified set IS unnotified",
  hasUnnotifiedEntries([entry("a")], []),
);
assert(
  "a queue entry already in the notified set is NOT unnotified",
  !hasUnnotifiedEntries([entry("a")], ["a"]),
);
assert(
  "one new handle among several already-notified ones still counts",
  hasUnnotifiedEntries([entry("a"), entry("b")], ["a"]),
);
assert(
  "the same dead vendor queued night after night stops being unnotified",
  !hasUnnotifiedEntries([entry("a"), entry("b")], ["a", "b"]),
);


// ── notified-marker pruning ─────────────────────────────────────
// Regression: the marker used to be rewritten ONLY on a successful send,
// so a resolved handle stayed in it forever and its next independent
// incident was silently treated as already-notified.
const q = (h: string): QueueEntry => ({
  handle: h, reason: "unreachable 3 days running", priority: "normal",
});

assert(
  "an empty queue CLEARS the marker (was: kept forever)",
  pruneNotified(["a"], [], false).length === 0,
);
assert(
  "a handle that resolved is pruned even when another stays queued",
  (() => {
    const out = pruneNotified(["a", "b"], [q("a")], false);
    return out.length === 1 && out[0] === "a";
  })(),
);
assert(
  "a still-queued handle is kept, so no repeat email",
  pruneNotified(["a"], [q("a")], false).includes("a"),
);
assert(
  "a successful send folds tonight's queue into the marker",
  (() => {
    const out = pruneNotified([], [q("a"), q("b")], true).sort();
    return out.length === 2 && out[0] === "a" && out[1] === "b";
  })(),
);
assert(
  "after resolve-then-recur the handle is notifiable again",
  (() => {
    let notified = pruneNotified([], [q("a")], true); // night 3: emailed
    notified = pruneNotified(notified, [], false);    // night 6: resolved
    // weeks later, a queues again:
    return !new Set(notified).has("a");
  })(),
);

assert("parseQueue drops a non-array", parseQueue("nope").length === 0);
assert("parseQueue drops a malformed entry", parseQueue([{ handle: "a" }]).length === 0);
assert(
  "parseQueue keeps a well-formed entry",
  parseQueue([{ handle: "a", reason: "x", priority: "high" }]).length === 1,
);

const api = readFileSync("src/app/api/admin/review-queue/route.ts", "utf8");
assert("review-queue API uses verifyAdminAuth", /verifyAdminAuth/.test(api));
assert("review-queue API is GET-only (no dismiss write)", !/\bexport async function POST\b/.test(api));
assert("review-queue API never writes verifiedAt", !/verifiedAt/.test(api));

const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
assert("privacy inventories gm:vendor:signals", privacy.includes("gm:vendor:signals"));
assert("privacy inventories gm:vendor:review-queue", privacy.includes("gm:vendor:review-queue"));
assert("privacy inventories gm:vendor:review-notified", privacy.includes("gm:vendor:review-notified"));
assert("privacy inventories vendor:dormant:*", privacy.includes("vendor:dormant:*"));

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
