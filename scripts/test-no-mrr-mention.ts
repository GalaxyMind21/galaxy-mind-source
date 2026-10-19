// Negative tests for the single allow-listed MiningRigRentals mention
// (scripts/lib/no-mrr-mention.ts). The real file must pass; any other ref
// code, rig link, digit, price or missing disclosure must fail.
import { readFileSync } from "node:fs";
import { MENTION_FILE, BANNED_PROFILE_URL, REGISTER_URL, checkMention } from "./lib/no-mrr-mention";
import { useSyntheticNeverReveal, SYNTH } from "./lib/never-reveal-test";
useSyntheticNeverReveal();

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

const real = strip(readFileSync(MENTION_FILE, "utf8"));
assert("real marketplace-listing.ts passes", checkMention(real).length === 0, checkMention(real).join("; "));
assert("real file has no profile URL (login-walled, 2026-10-17)", !real.includes("/u/GalaxyMind") && !/miningrigrentals\.com\/u\//.test(real));
assert("real file links exactly the referral register URL", real.includes(`"${REGISTER_URL}"`));

const swap = (from: string, to: string) => checkMention(real.split(from).join(to));
const cases: [string, string[]][] = [
  ["our profile URL (login-walled) re-added", checkMention(real + `\nexport const X = "${BANNED_PROFILE_URL}";`)],
  ["a different ref code on signup", swap(REGISTER_URL, "https://www.miningrigrentals.com/register?ref=1234567")],
  ["a different user's profile", checkMention(real + '\nexport const X = "https://www.miningrigrentals.com/u/SomeoneElse?ref=2770797";')],
  ["a rig deep link instead of signup", swap(REGISTER_URL, "https://www.miningrigrentals.com/rigs/940018?ref=2770797")],
  ["a second URL", checkMention(real + '\nexport const X = "https://www.miningrigrentals.com/register";')],
  ["a second ref param in prose", checkMention(real + '\nexport const X = "use ?ref=2770797 at signup";')],
  // Appended exports, so the cases never go stale when the copy is reworded (MRR-only rewrite 2026-10-17).
  ["a digit outside the URL", checkMention(real + '\nexport const X = "four units, 270 TH";')],
  ["a price word", checkMention(real + '\nexport const X = "at a better price";')],
  ["a dollar sign", checkMention(real + '\nexport const X = "from $";')],
  ["a state name", checkMention(real + `\nexport const X = "${SYNTH.place}-based hash power";`)],
  ["a rig deep link appended", checkMention(real + '\nexport const X = "https://www.miningrigrentals.com/rigs/901409?ref=2770797";')],
  ["the register page without our ref", swap(REGISTER_URL, "https://www.miningrigrentals.com/register")],
  ["a missing referral disclosure", checkMention(real.replace(/referral link/gi, "link"))],
];
for (const [name, errs] of cases) assert(`fails on ${name}`, errs.length > 0);

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
