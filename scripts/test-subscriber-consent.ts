/**
 * Consent fails CLOSED on an unreadable prefs record.
 *
 * kvGet answers an absent key and a FAILED read identically (null), so
 * getSubscriberPrefs falls back to DEFAULT_PREFS either way. For the
 * default-FALSE channels that is safe — a blip yields false and nothing
 * is sent. For a default-ON channel it silently converts an explicit
 * opt-OUT back into an opt-IN, mailing someone who unticked the box.
 *
 * `monthlyRoundupEnabled` is the only default-ON channel today, so it is
 * the only send path that must use getSubscriberPrefsChecked. The load-
 * bearing assertion here is the LAST one: if someone adds a second
 * default-ON channel, this test names the rule they have to follow.
 */
import { readFileSync } from "node:fs";
import { DEFAULT_PREFS } from "../src/lib/subscribe-flow";

let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    fail++;
    console.error(`  ✗ ${name}${detail ? " · " + detail : ""}`);
  }
}

console.log("\nsubscriber consent\n");

const kv = readFileSync("src/lib/kv.ts", "utf8");
check("kv exposes a checked GET", /export async function kvGetChecked/.test(kv));
check(
  "kvGetChecked reports ok:false when the command failed",
  /const \{ ok, result \} = await commandChecked<string>\(\["GET", key\]\);[\s\S]{0,120}if \(!ok\) return \{ ok: false, value: null \};/.test(kv),
);
check(
  "a present-but-null result is ok:true (absent key is not a failure)",
  /if \(result == null\) return \{ ok: true, value: null \};/.test(kv),
);

const flow = readFileSync("src/lib/subscribe-flow.ts", "utf8");
check(
  "getSubscriberPrefsChecked exists and surfaces ok",
  /export async function getSubscriberPrefsChecked\([\s\S]{0,220}Promise<\{ ok: boolean; prefs: SubscriberPrefs \}>/.test(flow),
);
check(
  "unconfigured KV is ok:true (no KV means no opt-out to miss)",
  /if \(!isKvConfigured\(\)\) return \{ ok: true, prefs: DEFAULT_PREFS \};/.test(flow),
);
check(
  "a failed read is ok:false",
  /if \(!ok\) return \{ ok: false, prefs: DEFAULT_PREFS \};/.test(flow),
);

const roundup = readFileSync(
  "src/app/api/cron/monthly-roundup/route.ts",
  "utf8",
);
check(
  "monthly-roundup reads prefs through the checked path",
  /getSubscriberPrefsChecked/.test(roundup) &&
    !/\bgetSubscriberPrefs\(/.test(roundup),
);
check(
  "monthly-roundup requires ok before mailing",
  /\.filter\(\(\{ ok, prefs \}\) => ok && prefs\.monthlyRoundupEnabled\)/.test(
    roundup,
  ),
);

// The rule, not the instance: every default-ON pref is a channel where a
// failed read would mail an opt-out, so each one needs a checked gate.
const defaultOn = Object.entries(DEFAULT_PREFS)
  .filter(([, v]) => v === true)
  .map(([k]) => k);
check(
  `exactly one default-ON channel, and it is monthlyRoundupEnabled (found: ${defaultOn.join(", ") || "none"})`,
  defaultOn.length === 1 && defaultOn[0] === "monthlyRoundupEnabled",
  "a new default-ON pref must gate its send on getSubscriberPrefsChecked's ok flag, then be added here",
);

{
  const subscribe = readFileSync("src/app/api/subscribe/route.ts", "utf8");
  const ts = subscribe.indexOf("verifyTurnstileToken");
  const rl = subscribe.indexOf("checkSubscribeRateLimit(ip)");
  check(
    "/api/subscribe verifies Turnstile before the KV rate limit",
    ts >= 0 && rl >= 0 && ts < rl,
  );
  const fit = readFileSync("src/app/api/fit-alerts/route.ts", "utf8");
  const fitTs = fit.indexOf("verifyTurnstileToken");
  const fitRl = fit.indexOf("checkSubscribeRateLimit(ip)");
  check(
    "/api/fit-alerts verifies Turnstile before the KV rate limit",
    fitTs >= 0 && fitRl >= 0 && fitTs < fitRl,
  );
}

if (fail) {
  console.error(`\n${fail} failure(s)\n`);
  process.exit(1);
}
console.log("\nAll subscriber-consent checks passed.\n");
