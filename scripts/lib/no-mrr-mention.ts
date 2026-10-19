import { containsNeverReveal } from "../../src/lib/never-reveal";
// Rules for the files allowed to name MiningRigRentals in public output.
// Shared by check-no-mrr-public.ts and its negative tests, so they cannot drift.
//
// 1. MENTION_FILE (src/lib/marketplace-listing.ts, operator 2026-10-17;
//    primary since the MRR-only switch) may carry exactly the
//    one URL in MENTION_URLS: the signup page with our own referral id. The profile
//    page (BANNED_PROFILE_URL) is login-walled for signed-out visitors and is banned
//    everywhere since; rent links point at our own /hashrate. Referral id (userid 2770797 = the GalaxyMind account per the MRR monitor's
//    authenticated whoami). Digits and ref= are allowed ONLY inside those exact
//    strings. Any other URL, ref value, rig path, price word, digit or location
//    fails, and the referral must stay disclosed.
// 2. UNITS_FILE (src/lib/mrr-units.ts) is the only place a per-unit rig link may be
//    built: exactly one URL literal (the /rigs/ prefix), ?ref= only as our id, no
//    marketplace name or price wording in its strings.
// 3. NAMED_FILES (llms.txt, the OpenAPI document) may name MiningRigRentals and
//    carry MENTION_URLS verbatim (no profile URL); with those exact strings removed, every BAD
//    pattern still applies (no rig link, other ref, rig id or other MRR URL).
export const MENTION_FILE = "src/lib/marketplace-listing.ts";
/** Login-walled for signed-out visitors: must never appear in customer-facing output. */
export const BANNED_PROFILE_URL = "https://www.miningrigrentals.com/u/GalaxyMind?ref=2770797";
export const REGISTER_URL = "https://www.miningrigrentals.com/register?ref=2770797";
export const MENTION_URLS: readonly string[] = [REGISTER_URL];
export const MARKETPLACE_NAME = "MiningRigRentals";
export const UNITS_FILE = "src/lib/mrr-units.ts";
export const UNITS_PREFIX = "https://www.miningrigrentals.com/rigs/";
export const NAMED_FILES: readonly string[] = ["public/llms.txt", "src/app/api/openapi.json/route.ts"];

const PRICE = /\$(?!\{)|USD|BTC|sats?\b|price|cheaper|per\s+(day|hour)/i;
// Private words are screened by the keyed never-reveal list (src/lib/never-reveal.ts, "copy" scope), never spelled out here.
const LOCATION = [/\bus-?south\b/i, /\bfacility\b/i];
const STRICT: RegExp[] = [/\/rigs\//i, /[?&]ref=/i, /\d/, PRICE, ...LOCATION];
function hashedLocation(text: string): boolean { return containsNeverReveal(text, "copy"); }

/** Returns errors for the mention file's comment-stripped source. */
export function checkMention(body: string, rel = MENTION_FILE): string[] {
  const errors: string[] = [];
  const urls: string[] = body.match(/https?:\/\/[^"'`\s]+/g) ?? [];
  const bad = urls.filter((u) => !MENTION_URLS.includes(u));
  if (bad.length || !urls.includes(REGISTER_URL)) {
    errors.push(`${rel}: only ${MENTION_URLS.join(" and ")} may appear, found ${urls.join(", ") || "none"}`);
  }
  let prose = body;
  for (const u of MENTION_URLS) prose = prose.split(u).join("");
  for (const re of STRICT) {
    const m = prose.match(re);
    if (m) errors.push(`${rel}: ${re} matched "${m[0]}" (marketplace mention must carry no price, id, number, extra ref or location)`);
  }
  if (hashedLocation(prose)) errors.push(`${rel}: a never-reveal word matched (marketplace mention must carry no location or private name)`);
  if (!/referral link/i.test(prose)) errors.push(`${rel}: the referral must be disclosed ("referral link")`);
  return errors;
}

/** Returns errors for the units module's comment-stripped source. */
export function checkUnitsModule(body: string, rel = UNITS_FILE): string[] {
  const errors: string[] = [];
  const urls = body.match(/https?:\/\/[^"'`\s]+/g) ?? [];
  if (urls.length !== 1 || urls[0] !== UNITS_PREFIX) errors.push(`${rel}: only the literal ${UNITS_PREFIX} may appear, found ${urls.join(", ") || "none"}`);
  const refs = body.match(/[?&]ref=[^"'`\s$]*/gi) ?? [];
  if (refs.some((r) => r !== "?ref=2770797")) errors.push(`${rel}: a ref other than ours: ${refs.join(", ")}`);
  const strings = (body.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? []).join("\n");
  for (const re of [/MiningRigRentals/, /\bMRR\b/, PRICE, ...LOCATION]) {
    const m = strings.match(re);
    if (m) errors.push(`${rel}: ${re} matched "${m[0]}" in a string (the units module carries links only, no copy)`);
  }
  if (hashedLocation(strings)) errors.push(`${rel}: a never-reveal word in a string (the units module carries links only, no copy)`);
  return errors;
}

/** Strip the exact allowed strings from a NAMED_FILES body; the caller then applies BAD. */
export function stripNamed(body: string): string {
  let out = body;
  for (const u of MENTION_URLS) out = out.split(u).join("");
  return out.replace(/(?<![\w./-])MiningRigRentals(?![\w/]|\.\w)/g, "");
}
