/**
 * Invariants for CHOP's anonymous gameplay telemetry.
 *
 * WHY THIS EXISTS
 *   A telemetry endpoint is the one place where a privacy promise is made
 *   in prose and kept (or broken) in code. /privacy tells players there is
 *   NO identifier of any kind, that values are bucketed, and that the
 *   payload is allow-listed. Those are testable claims, so they are tested
 *   here rather than trusted — a drift between the policy and the route is
 *   a false statement to users, not a stale comment.
 */
import { readFileSync } from "node:fs";

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; return; }
  fails.push(`${name}${detail ? " — " + detail : ""}`);
};

const route = readFileSync("src/app/api/chop/stats/route.ts", "utf8");
const admin = readFileSync("src/app/api/admin/chop-stats/route.ts", "utf8");
const client = readFileSync("public/chop/js/main.js", "utf8");
const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");

// ── 1. NO IDENTIFIERS EVER REACH STORAGE ────────────────────────────
// The stored object is built by an explicit allow-list. Anything that
// could identify a person must be absent from the projection.
const projection = route.slice(route.indexOf("const ev:"), route.indexOf("await kvPushCapped"));
for (const banned of ["ip", "handle", "name", "userId", "cookie", "ua", "userAgent", "id:"]) {
  ok(`projection never stores ${banned}`,
    !new RegExp(`\\b${banned}\\b\\s*:`, "i").test(projection));
}
ok("projection is an allow-list, not a spread",
  !/\.\.\.body/.test(route) && !/Object\.assign\([^)]*body/.test(route),
  "a spread would store unknown client fields");
ok("stores a DAY bucket, not a timestamp",
  /toISOString\(\)\.slice\(0, 10\)/.test(route) && !/Date\.now\(\)/.test(projection));

// ── 2. COST + ABUSE POSTURE ─────────────────────────────────────────
ok("body size is capped on the bytes actually read, not Content-Length",
  /MAX_BODY/.test(route) && /req\.text\(\)/.test(route) && /TextEncoder/.test(route)
  && !/content-length/.test(route));
ok("writes are capped (LPUSH+LTRIM via kvPushCapped)", /kvPushCapped/.test(route));
ok("rate limited per IP", /rateLimit\(/.test(route));
ok("free checks run BEFORE the metered limiter",
  route.indexOf("MAX_BODY") < route.indexOf("rateLimit(")
  && route.indexOf("KINDS)") < route.indexOf("rateLimit("),
  "shape rejection must cost zero KV commands");
ok("degrades silently when KV is unconfigured", /isKvConfigured\(\)/.test(route));

// ── 3. EVERY VALUE IS BOUNDED ───────────────────────────────────────
// A numeric field with no ceiling is an unbounded string in disguise.
const numCalls = [...route.matchAll(/num\(body\.\w+, (-?\d+), (\d+)\)/g)];
ok("every numeric field has explicit bounds", numCalls.length >= 6, `found ${numCalls.length}`);
ok("all numeric bounds are sane", numCalls.every(([, lo, hi]) => Number(hi) <= 5000 && Number(lo) >= -100));
ok("enum fields are set-checked", /pick<string>\(body\.\w+, [A-Z]+\)/.test(route));

// ── 4. THE CLIENT KEEPS ITS HALF OF THE PROMISE ─────────────────────
ok("client buckets duration before sending", /function statBucket/.test(client));
ok("duration bucket is 5s", /Math\.round\(sec \/ 5\) \* 5/.test(client));
ok("client sends run-count BANDS, not raw counts", /function runBand/.test(client));
ok("telemetry is opt-out and gated", /if \(!PREFS\.stats\) return;/.test(client));
ok("the arcade handle is never sent", !/getHandle\(\)/.test(
  client.slice(client.indexOf("function sendStat"), client.indexOf("function statBucket") + 400)));
ok("failures are silent", /catch \{ \/\* private mode/.test(client));

// ── 5. POLICY AND CODE AGREE ────────────────────────────────────────
ok("privacy page documents the KV key",
  /gm:chop:events:v1/.test(privacy), "the key must appear in the code inventory");
ok("privacy page has a CHOP stats section", /Anonymous gameplay stats/.test(privacy));
ok("privacy page states the opt-out path", /Anonymous stats/.test(privacy));
ok("privacy page claims no identifier", /no identifier|There is no/i.test(privacy));
// the toggle the policy promises must actually exist in the game
const html = readFileSync("public/chop/index.html", "utf8");
ok("the settings toggle exists", /id="set-stats"/.test(html));
ok("the toggle is wired", /prefsSet\("stats"/.test(client));

// ── 6. THE READ SIDE IS OPERATOR-ONLY ───────────────────────────────
ok("admin report requires auth", /verifyAdminAuth/.test(admin));
ok(
  "boot-hint track title is not innerHTML (manifest titles must not be a script sink)",
  !/hint\.innerHTML/.test(client) &&
    /title\.textContent/.test(client) &&
    /createElement\("b"\)/.test(client),
);
ok("admin report answers the funnel question", /runsPerBoot|finishRate/.test(admin));
ok("admin report answers 'for how long'", /secondsPerRun/.test(admin));

if (fails.length) {
  console.error(`\n✗ chop telemetry: ${fails.length} failed, ${pass} passed`);
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`✓ chop telemetry · ${pass} invariants (no identifiers, bounded, opt-out, policy-in-sync)`);
