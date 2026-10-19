#!/usr/bin/env tsx
/**
 * Smoke tests for lib/upstream.ts — pure unit checks (no real network
 * for the timeout path; live JSON only if network available).
 */
import assert from "node:assert/strict";
import { z } from "zod";
import {
  logSchemaDrift,
  upstreamFetchJson,
  UPSTREAM_TIMEOUT_MS,
} from "../src/lib/upstream";

let passed = 0;
function ok(name: string) {
  passed++;
  console.log(`  PASS  ${name}`);
}

async function main() {
  // 1. logSchemaDrift is silent on success, warns on failure (no throw)
  {
    let warned = false;
    const orig = console.warn;
    console.warn = () => {
      warned = true;
    };
    logSchemaDrift("test-ok", { success: true });
    assert.equal(warned, false);
    logSchemaDrift(
      "test-bad",
      z.object({ a: z.number() }).safeParse({ a: "x" }),
    );
    assert.equal(warned, true);
    console.warn = orig;
    ok("logSchemaDrift silent on success, warns on drift");
  }

  // 2. Unreachable target returns ok:false (closed local port = fast fail)
  {
    const res = await upstreamFetchJson("http://127.0.0.1:1/", {
      label: "conn-refused-probe",
      timeoutMs: 500,
      retry: false,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.ok(res.error.length > 0);
    }
    ok("unreachable target returns ok:false");
  }

  // 3. HTTP error status returns ok:false (no hang)
  {
    const res = await upstreamFetchJson("https://httpstat.us/500", {
      label: "http-500-probe",
      timeoutMs: 5000,
      retry: false,
    });
    // Network may be offline in CI — either ok:false with HTTP 500 or network error
    assert.equal(res.ok, false);
    ok("non-2xx / network failure returns ok:false");
  }

  console.log(
    `\n${passed} checks passed. UPSTREAM_TIMEOUT_MS=${UPSTREAM_TIMEOUT_MS}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
