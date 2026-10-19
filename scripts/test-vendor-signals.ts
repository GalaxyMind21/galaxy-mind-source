/**
 * Invariants for the pure vendor-signal model. No network, no KV —
 * every case here is a hand-built observation pair, which is the whole
 * reason the model is pure.
 */
import {
  extractPaymentMarkers,
  diffSignals,
  nextFailStreak,
  shouldQueue,
  FAIL_STREAK_TO_QUEUE,
  ABORT_FAIL_RATIO,
  type VendorSignals,
} from "../src/lib/vendor-signals";

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` · ${detail}` : ""}`);
  }
}

function sig(over: Partial<VendorSignals> = {}): VendorSignals {
  return {
    handle: "acme",
    observedAt: 1_786_579_200,
    shop: { kind: "ok", markers: { bitcoin: true, lightning: true, btc: true } },
    profile: { kind: "ok", markers: { bitcoin: false, lightning: false, btc: false } },
    lud16: null,
    failStreak: 0,
    ...over,
  };
}

// ── marker extraction ────────────────────────────────────────────
assert(
  "detects bitcoin and lightning in checkout copy",
  (() => {
    const m = extractPaymentMarkers("<p>We accept Bitcoin and Lightning at checkout</p>");
    return m.bitcoin && m.lightning;
  })(),
);
assert(
  "detects standalone BTC token",
  extractPaymentMarkers("<span>Pay with BTC</span>").btc,
);
assert(
  "does not fire on substrings inside other words",
  (() => {
    const m = extractPaymentMarkers("<p>lightningproof jacket, bitcoinsplaining</p>");
    return !m.lightning && !m.bitcoin;
  })(),
);

// ── diff ─────────────────────────────────────────────────────────
assert(
  "no baseline produces no changes",
  diffSignals(null, sig()).length === 0,
);
assert(
  "identical observations produce no changes",
  diffSignals(sig(), sig()).length === 0,
);
assert(
  "shop going 404 is shop-gone",
  diffSignals(sig(), sig({ shop: { kind: "gone", status: 404 } }))
    .some((c) => c.type === "shop-gone"),
);
assert(
  "losing every payment marker is payment-markers-lost",
  diffSignals(
    sig(),
    sig({ shop: { kind: "ok", markers: { bitcoin: false, lightning: false, btc: false } } }),
  ).some((c) => c.type === "payment-markers-lost"),
);
assert(
  "losing ONE of several markers is not a change",
  diffSignals(
    sig(),
    sig({ shop: { kind: "ok", markers: { bitcoin: true, lightning: false, btc: true } } }),
  ).length === 0,
  "partial marker loss is normal copy churn",
);
assert(
  "a total marker loss where the NEW read was truncated is not a change",
  diffSignals(
    sig(),
    sig({
      shop: {
        kind: "ok",
        markers: { bitcoin: false, lightning: false, btc: false },
        truncated: true,
      },
    }),
  ).length === 0,
  "the markers may still be there past the 512KB cap, not actually gone",
);
assert(
  "a total marker loss where the BASELINE read was truncated is not a change",
  diffSignals(
    sig({ shop: { kind: "ok", markers: { bitcoin: true, lightning: true, btc: true }, truncated: true } }),
    sig({ shop: { kind: "ok", markers: { bitcoin: false, lightning: false, btc: false } } }),
  ).length === 0,
  "either side truncated is enough to suppress the diff",
);
assert(
  "a total marker loss with BOTH reads untruncated still fires",
  diffSignals(
    sig({ shop: { kind: "ok", markers: { bitcoin: true, lightning: true, btc: true }, truncated: false } }),
    sig({ shop: { kind: "ok", markers: { bitcoin: false, lightning: false, btc: false }, truncated: false } }),
  ).some((c) => c.type === "payment-markers-lost"),
);
assert(
  "lud16 drift is reported",
  diffSignals(sig({ lud16: "a@b.com" }), sig({ lud16: "c@d.com" }))
    .some((c) => c.type === "lud16-drift"),
);
assert(
  "unprobeable is NEVER a change",
  diffSignals(sig(), sig({ shop: { kind: "unprobeable", reason: "403" } })).length === 0,
);

// ── fail streak ──────────────────────────────────────────────────
assert(
  "a gone probe increments the streak",
  nextFailStreak(sig({ failStreak: 1 }), sig({ shop: { kind: "gone", status: 500 } })) === 2,
);
assert(
  "unprobeable does NOT increment the streak",
  nextFailStreak(sig({ failStreak: 1 }), sig({ shop: { kind: "unprobeable", reason: "429" } })) === 1,
);
assert(
  "a healthy probe resets the streak",
  nextFailStreak(sig({ failStreak: 2 }), sig()) === 0,
);

// ── queue policy ─────────────────────────────────────────────────
assert(
  "one failure does not queue",
  !shouldQueue([{ type: "shop-gone" }], 1).queue,
);
assert(
  "two failures do not queue",
  !shouldQueue([{ type: "shop-gone" }], 2).queue,
);
assert(
  `${FAIL_STREAK_TO_QUEUE} consecutive failures DO queue`,
  shouldQueue([{ type: "shop-gone" }], FAIL_STREAK_TO_QUEUE).queue,
);
assert(
  "payment-markers-lost queues immediately, no streak needed",
  shouldQueue([{ type: "payment-markers-lost", lost: ["bitcoin", "lightning", "btc"] }], 0).queue,
);
assert(
  "lud16 drift queues immediately at high priority",
  (() => {
    const d = shouldQueue([{ type: "lud16-drift", from: "a@b", to: "c@d" }], 0);
    return d.queue && d.priority === "high";
  })(),
);
assert(
  "lud16 drift reason names the signed kind:0, not listed-only",
  shouldQueue([{ type: "lud16-drift", from: "a@b", to: "c@d" }], 0).reason.includes(
    "kind:0",
  ),
);
assert("no changes never queues", !shouldQueue([], 0).queue);
assert("abort ratio is 30%", ABORT_FAIL_RATIO === 0.3);

// ── regression · the 3-strikes rule must actually fire ───────────
// This is the exact case that was broken: by the time a streak reaches
// the threshold the vendor has been gone for days, so diffSignals emits
// NOTHING and `changes` is empty. Reading liveness from `changes` made
// the branch unreachable and silently disabled the whole rule.
assert(
  "an empty change list with a qualifying streak STILL queues",
  shouldQueue([], FAIL_STREAK_TO_QUEUE).queue,
);

// Compose the real functions day over day, exactly as the caller does,
// threading each day's computed streak forward. Hand-built streaks are
// what hid this defect, so this test must never hand-build one.
assert(
  "three consecutive gone days queue on day 3, not before",
  (() => {
    let prev: VendorSignals = sig(); // healthy baseline
    const results: boolean[] = [];
    for (let day = 1; day <= 3; day++) {
      const observed = sig({ shop: { kind: "gone", status: 404 } });
      const streak = nextFailStreak(prev, observed);
      const changes = diffSignals(prev, observed);
      results.push(shouldQueue(changes, streak).queue);
      prev = { ...observed, failStreak: streak };
    }
    return results[0] === false && results[1] === false && results[2] === true;
  })(),
);

// ── regression · vendors with no website must not ratchet permanently ────
// 28 of 129 live vendors have no website field. The old reset logic required
// shop to read "ok", but null?.kind is undefined, never "ok". Once such a
// vendor's profile went down, the streak could never reset, and they stayed
// in the review queue forever. Test the full cycle: no-website vendor, profile
// down 3 days (queues), profile recovers (streak resets), stops queueing.
assert(
  "vendor with no website: profile down 3 days queues, then resets on recovery",
  (() => {
    let prev: VendorSignals = sig({ shop: null }); // no website
    const states: { streak: number; queue: boolean }[] = [];

    // Days 1-3: profile goes down
    for (let day = 1; day <= 3; day++) {
      const observed = sig({
        shop: null,
        profile: { kind: "gone", status: 500 },
      });
      const streak = nextFailStreak(prev, observed);
      const changes = diffSignals(prev, observed);
      const decision = shouldQueue(changes, streak);
      states.push({ streak, queue: decision.queue });
      prev = { ...observed, failStreak: streak };
    }

    // Day 4: profile recovers to ok
    const recovery = sig({ shop: null, profile: { kind: "ok", markers: { bitcoin: false, lightning: false, btc: false } } });
    const recoveryStreak = nextFailStreak(prev, recovery);
    const recoveryChanges = diffSignals(prev, recovery);
    const recoveryDecision = shouldQueue(recoveryChanges, recoveryStreak);
    states.push({ streak: recoveryStreak, queue: recoveryDecision.queue });

    // Verify: days 1-2 not queued, day 3 queued, day 4 (recovery) not queued
    // and streak reset to 0
    return (
      states[0].streak === 1 &&
      !states[0].queue &&
      states[1].streak === 2 &&
      !states[1].queue &&
      states[2].streak === 3 &&
      states[2].queue &&
      states[3].streak === 0 && // MUST reset on recovery
      !states[3].queue // MUST stop queueing
    );
  })(),
);

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
