// Test harness for kvHSetMany (lib/kv.ts) — the batched hash-write
// helper added to fix the O(vendors) KV-write bug in monitor-vendors:
// route.ts used to loop `await kvHSet(SIGNALS_KEY, s.handle, s)` once
// per vendor, turning a 130-vendor run into 132 metered Upstash
// commands instead of the intended ~3. That bug was invisible to any
// test that only checks a return value — a loop of individual HSETs
// and a single batched HSET both leave the hash in the same end state.
// So this pins the actual wire behaviour: how many underlying commands
// get issued, and exactly what gets sent in the one that should exist.
// A test that would still pass against the old per-field loop is
// worthless here, which is why this asserts on the stubbed fetch call
// COUNT, not just kvHSetMany's boolean return.
//
// Same stub-fetch + main()-wrapper convention as test-safe-fetch.ts:
// this repo's tsx transform targets cjs (no top-level await), and
// kv.ts decides whether it's "configured" from process.env at MODULE
// LOAD time — static imports are hoisted above any top-level code in
// this file, so env vars must be set before a DYNAMIC import of
// lib/kv, not a static one, or the module would already have decided
// it's unconfigured and short-circuited every command before this
// file's env-setting code ever ran.
//
// Run: npx tsx scripts/test-kv-batch.ts

// Forces this file to be treated as an ES MODULE rather than a global
// script. The only import here is a dynamic `await import(...)` inside
// main() (deliberately, see above), which TypeScript does not count as
// a module-scoping declaration — without this, `main`/`passed`/`failed`/
// `stubFetch` leak into the shared global scope and collide with the
// identically-named top-level declarations in sibling test scripts
// (e.g. test-safe-fetch.ts's own `async function main()`), which is
// exactly what `tsc --noEmit` caught (TS2393 duplicate implementation).
import { readFileSync } from "node:fs";

export {};

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
  }
}

/** Stub fetch that records every call's decoded command array. */
function stubFetch(): { calls: unknown[][]; restore: () => void } {
  const realFetch = globalThis.fetch;
  const calls: unknown[][] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const args = JSON.parse(String(init?.body)) as unknown[];
    calls.push(args);
    // Upstash's REST shape: {result: ...}. The exact value doesn't
    // matter here — kvHSetMany only checks it's non-null.
    return new Response(JSON.stringify({ result: 2 }), { status: 200 });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

async function main() {
  process.env.UPSTASH_REDIS_REST_URL = "https://fake-kv.example/redis";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  const { kvHSetMany, kvZRem } = await import("../src/lib/kv");

  // ---------------------------------------------------------------
  console.log("\nkvHSetMany · one command, correctly flattened pairs");
  // ---------------------------------------------------------------
  {
    const { calls, restore } = stubFetch();
    const ok = await kvHSetMany("gm:vendor:signals", {
      alice: { handle: "alice", failStreak: 1 },
      bob: "already-a-string",
    });
    restore();

    assert("reports success", ok === true);
    assert(
      "issues exactly one underlying command for a two-entry write",
      calls.length === 1,
    );
    const args = calls[0] ?? [];
    assert("command is HSET", args[0] === "HSET");
    assert("targets the given key", args[1] === "gm:vendor:signals");
    assert(
      "object values are JSON-encoded, string values pass through raw",
      args[2] === "alice" &&
        args[3] === JSON.stringify({ handle: "alice", failStreak: 1 }) &&
        args[4] === "bob" &&
        args[5] === "already-a-string",
    );
    assert("no stray extra pairs", args.length === 6);
  }

  // ---------------------------------------------------------------
  console.log("\nkvHSetMany · a larger batch is still exactly one command");
  // ---------------------------------------------------------------
  {
    const { calls, restore } = stubFetch();
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) entries[`vendor-${i}`] = { n: i };
    await kvHSetMany("gm:vendor:signals", entries);
    restore();

    // This is the regression the bug fix targets: a loop of per-field
    // kvHSet calls would show up here as 25 commands, not 1.
    assert("25 fields still cost exactly one command", calls.length === 1);
    const args = calls[0] ?? [];
    assert("pair count matches field count (2 per field + HSET + key)", args.length === 2 + 25 * 2);
  }

  // ---------------------------------------------------------------
  console.log("\nkvHSetMany · empty input is a true no-op");
  // ---------------------------------------------------------------
  {
    const { calls, restore } = stubFetch();
    const ok = await kvHSetMany("gm:vendor:signals", {});
    restore();
    assert("reports success", ok === true);
    assert("issues no command at all", calls.length === 0);
  }

  // ---------------------------------------------------------------
  console.log("\nkvZRem · one ZREM, and an empty list is a no-op");
  // ---------------------------------------------------------------
  {
    const { calls, restore } = stubFetch();
    await kvZRem("push:subs:v2", "dead-a", "dead-b");
    await kvZRem("push:subs:v2");
    restore();
    assert("one ZREM command for two members", calls.length === 1);
    const args = calls[0] ?? [];
    assert(
      "ZREM carries the key and both members",
      args[0] === "ZREM" &&
        args[1] === "push:subs:v2" &&
        args[2] === "dead-a" &&
        args[3] === "dead-b",
    );
  }
  {
    const push = readFileSync("src/lib/push.ts", "utf8");
    assert(
      "deleteSubscription removes the index member",
      /export async function deleteSubscription[\s\S]*?kvZRem\(INDEX_KEY/.test(
        push,
      ),
    );
    assert(
      "an emptied topic set removes the index member",
      /merged\.length === 0[\s\S]*?kvZRem\(INDEX_KEY/.test(push),
    );
    assert(
      "a failed index read is not treated as a dead member",
      push.includes("if (!row.ok) continue"),
    );
  }

  console.log(`\n${passed} passed · ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
