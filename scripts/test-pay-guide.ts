// /how-to-pay-with-lightning guardrails (competitor teardown lesson A2, 2026-10-18).
// In-process, no network. The guide must stay neutral and link-clean: no
// affiliate or referral links, no "best app" claims, every app mention
// carries the check-your-app caveat, and the JSON-LD is built from the same
// strings the page renders. Also pins sitemap + llms.txt discoverability.
import { readFileSync } from "node:fs";
import * as C from "../src/lib/pay-guide-copy";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

const page = readFileSync("src/app/how-to-pay-with-lightning/page.tsx", "utf8");
const og = readFileSync("src/app/how-to-pay-with-lightning/opengraph-image.tsx", "utf8");
const copy = [
  C.PAY_GUIDE_TITLE, C.PAY_GUIDE_META_TITLE, C.PAY_GUIDE_DESCRIPTION, C.PAY_GUIDE_OG_ALT, C.PAY_GUIDE_SHORT,
  ...C.PAY_STEPS.flatMap((s) => [s.title, s.body, s.hrefLabel ?? ""]),
  ...C.PAY_FAQ.flatMap((f) => [f.q, f.a]),
].join("\n");
const all = `${copy}\n${page}\n${og}`;

console.log("── pay guide copy ───────────────────────────────");
check("five steps", C.PAY_STEPS.length === 5);
check("short answer says many shops take Lightning", /many shops/i.test(C.PAY_GUIDE_SHORT) && /Lightning/.test(C.PAY_GUIDE_SHORT));
check("short answer: dollar balance, scan the QR, confirm", /dollar balance/.test(C.PAY_GUIDE_SHORT) && /QR code/.test(C.PAY_GUIDE_SHORT) && /confirm/.test(C.PAY_GUIDE_SHORT));
check("caveat: availability and fees vary by app and country", /Availability and fees vary by app and country/.test(C.PAY_GUIDE_SHORT));
for (const block of [C.PAY_GUIDE_SHORT, ...C.PAY_STEPS.map((s) => s.body), ...C.PAY_FAQ.map((f) => f.a)]) {
  if (/Cash App|Strike/.test(block)) {
    check(`app mention is an example with a caveat: "${block.slice(0, 40)}…"`, /such as/.test(block) && /where they are available/.test(block) && /check your app/i.test(block));
  }
}
check("no best/top/recommended-app claim", !/\b(best|top|our pick|recommended)\b[^.]{0,30}\bapp/i.test(copy));
check("says we recommend no app and earn nothing", /do not recommend/.test(copy) && /earn nothing/.test(copy));
check("no word 'real'", !/\breal\b/i.test(copy));
check("no external links at all (no affiliate surface)", !/href="https?:\/\//.test(page) && !/https?:\/\/(?!galaxymind\.space|schema\.org)/.test(copy));
check("no referral/affiliate params anywhere", !/[?&](ref|referral|aff|affiliate|invite|code|utm_[a-z]+)=/i.test(all));
check("no em/en-dash clause breaks", !/ [—–] /.test(copy));

console.log("── structured data ──────────────────────────────");
check("HowTo + FAQPage + Article", /"@type": "HowTo"/.test(page) && /"@type": "FAQPage"/.test(page) && /"@type": "Article"/.test(page));
check("no Dataset markup", !/"Dataset"/.test(page));
check("HowTo steps built from PAY_STEPS", /step: PAY_STEPS\.map/.test(page));
check("FAQPage built from PAY_FAQ (same strings as visible)", /mainEntity: PAY_FAQ\.map/.test(page) && /PAY_FAQ\.map\(\(f\) => \(\s*<div/.test(page));
check("canonical is its own URL", C.PAY_GUIDE_URL === "https://galaxymind.space/how-to-pay-with-lightning" && /canonical: URL/.test(page));
check("OG card has descriptive alt", /export const alt = PAY_GUIDE_OG_ALT/.test(og) && C.PAY_GUIDE_OG_ALT.length > 40);

console.log("── discoverability ──────────────────────────────");
check("sitemap lists the guide", readFileSync("src/app/sitemap.ts", "utf8").includes('"https://galaxymind.space/how-to-pay-with-lightning"'));
check("llms.txt lists the guide", readFileSync("public/llms.txt", "utf8").includes("https://galaxymind.space/how-to-pay-with-lightning"));

console.log(`\n${fail ? "✗" : "✓"} ${pass} passed · ${fail} failed`);
if (fail) process.exit(1);
