// Pins the RENTALS_MODE default (security audit 2026-10-18, M3). In-process, no network.
// Checkout stays closed unless RENTALS_MODE is exactly "direct" (any case, trimmed). If anyone changes the
// fallback, renames the env var, or ships a config that sets direct, this test fails the verify run.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rentalsMode, mrrOnly } from "../src/lib/rentals/mode";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

console.log("rentals mode default");

// 1. No env at all, and the env var missing from process.env.
assert("rentalsMode({}) = mrr_only", rentalsMode({}) === "mrr_only");
assert("mrrOnly({}) = true", mrrOnly({}) === true);
const saved = process.env.RENTALS_MODE;
delete process.env.RENTALS_MODE;
assert("rentalsMode() with RENTALS_MODE unset in process.env = mrr_only", rentalsMode() === "mrr_only");
assert("mrrOnly() with RENTALS_MODE unset in process.env = true", mrrOnly() === true);
if (saved !== undefined) process.env.RENTALS_MODE = saved;

// 2. Anything that is not exactly "direct" fails safe to mrr_only.
const closed = ["", " ", "undefined", "null", "0", "1", "true", "false", "on", "open", "live", "mrr_only", "mrr", "directs",
  "direct_", "_direct", "direct checkout", "dir ect", "d1rect", "direct\u200b", "\u0000direct", "phase2", "x402", "solana", "mainnet"];
for (const v of closed) {
  assert(`RENTALS_MODE=${JSON.stringify(v)} → mrr_only`, rentalsMode({ RENTALS_MODE: v }) === "mrr_only" && mrrOnly({ RENTALS_MODE: v }));
}
// Other rail flags never open checkout on their own.
const flags = { RENTALS_PHASE2_ENABLED: "1", RENTALS_MAINNET_ENABLED: "1", RENTALS_MAINNET_ACK: "1", RENTALS_SOLANA_ENABLED: "1", RENTALS_HUMAN_CHECKOUT: "1", RENTALS_PILOT: "1" };
assert("every rail flag on, RENTALS_MODE unset → mrr_only", rentalsMode(flags) === "mrr_only");

// 3. Only the deliberate rollback value opens direct mode.
for (const v of ["direct", "DIRECT", " Direct ", "\tdirect\n"]) {
  assert(`RENTALS_MODE=${JSON.stringify(v)} → direct`, rentalsMode({ RENTALS_MODE: v }) === "direct" && !mrrOnly({ RENTALS_MODE: v }));
}

// 3b. Deploy context never changes the default (review follow-up): production/preview/development
//     VERCEL_ENV and NODE_ENV, both in the passed env and in process.env.
const deployEnvs: Array<Record<string, string>> = [];
for (const VERCEL_ENV of ["production", "preview", "development"]) for (const NODE_ENV of ["production", "development", "test"]) deployEnvs.push({ VERCEL_ENV, NODE_ENV });
for (const e of deployEnvs) {
  assert(`VERCEL_ENV=${e.VERCEL_ENV} NODE_ENV=${e.NODE_ENV}, RENTALS_MODE unset → mrr_only`, rentalsMode(e) === "mrr_only" && mrrOnly(e));
  assert(`VERCEL_ENV=${e.VERCEL_ENV} NODE_ENV=${e.NODE_ENV}, RENTALS_MODE=direct → direct`, rentalsMode({ ...e, RENTALS_MODE: "direct" }) === "direct");
}
{
  const pe = process.env as Record<string, string | undefined>;
  const keep = { VERCEL_ENV: pe.VERCEL_ENV, NODE_ENV: pe.NODE_ENV, RENTALS_MODE: pe.RENTALS_MODE };
  delete pe.RENTALS_MODE;
  for (const e of deployEnvs) {
    pe.VERCEL_ENV = e.VERCEL_ENV;
    pe.NODE_ENV = e.NODE_ENV;
    assert(`process.env VERCEL_ENV=${e.VERCEL_ENV} NODE_ENV=${e.NODE_ENV} → mrr_only`, rentalsMode() === "mrr_only" && mrrOnly());
  }
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete pe[k]; else pe[k] = v; }
}

// 4. No committed config sets RENTALS_MODE (it must come from a deliberate env edit, never from the repo).
const root = join(__dirname, "..");
for (const f of ["next.config.ts", "vercel.json"]) {
  const src = readFileSync(join(root, f), "utf8");
  assert(`${f} does not set RENTALS_MODE`, !/RENTALS_MODE/.test(src));
}

// 5. The source still reads RENTALS_MODE and still falls back to mrr_only.
const modeSrc = readFileSync(join(root, "src/lib/rentals/mode.ts"), "utf8");
assert("mode.ts reads env.RENTALS_MODE", /env\.RENTALS_MODE/.test(modeSrc));
assert("mode.ts falls back to \"mrr_only\"", /:\s*"mrr_only"\s*;/.test(modeSrc));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
