// /nostr-marketplaces guardrails (competitor teardown lesson A5, 2026-10-18).
// In-process, no network. the operator okayed naming Conduit, Shopstr and Plebeian
// Market ( Oct 18): the page must lead with Galaxy Mind's strengths,
// name ONLY those three, cite each one's own site/GitHub (no other outbound
// links, no tracking params), stay neutral (no disparagement, no rankings or
// traffic claims), keep FAQPage JSON-LD identical to the visible answers, and
// stay in the sitemap and llms.txt.
import { readFileSync } from "node:fs";
import * as C from "../src/lib/nostr-marketplaces-copy";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

const page = readFileSync("src/app/nostr-marketplaces/page.tsx", "utf8");
const og = readFileSync("src/app/nostr-marketplaces/opengraph-image.tsx", "utf8");
const copy = [
  C.NM_TITLE, C.NM_META_TITLE, C.NM_DESCRIPTION, C.NM_OG_ALT, C.NM_SHORT, C.NM_WHY,
  ...C.NM_HOW.flatMap((b) => [b.title, b.body]),
  ...C.NM_COMPARE.flatMap((r) => [r.label, r.marketplace, r.directory]),
  ...C.NM_FAQ.flatMap((f) => [f.q, f.a]),
  C.NM_LEAD_TITLE, ...C.NM_LEAD,
  ...C.NM_PROJECTS.flatMap((p) => [p.name, p.what, p.checkout, p.code]),
].join("\n");
const all = `${copy}\n${page}\n${og}`;

console.log("── nostr marketplaces explainer ─────────────────");
const OTHERS = /cypher\.space|nostr\.market|amethyst|primal|damus|snort|iris\.to|coracle|lnbits/i;
check("names no marketplace or client beyond the three okayed", !OTHERS.test(all), String(all.match(OTHERS)));
check("names exactly Conduit, Shopstr and Plebeian Market", C.NM_PROJECTS.map((p) => p.name).join("|") === "Conduit|Shopstr|Plebeian Market");
const OWN: Record<string, RegExp> = { Conduit: /^https:\/\/(conduit\.market\/|github\.com\/Conduit-BTC)/, Shopstr: /^https:\/\/(shopstr\.market\/|github\.com\/shopstr-eng\/)/, "Plebeian Market": /^https:\/\/(plebeian\.market\/|github\.com\/PlebeianApp\/)/ };
check("each project cites only its own site and its own GitHub", C.NM_PROJECTS.every((p) => OWN[p.name].test(p.url) && OWN[p.name].test(p.codeUrl)));
check("outbound links are nofollow and open in a new tab", (page.match(/rel="noopener noreferrer nofollow"/g) ?? []).length === 2 && !/href="https?:\/\//.test(page));
check("says we are not affiliated and dates the summary", /not affiliated with any of them/.test(page) && /as of \{NM_AS_OF\}/.test(page) && /2026/.test(C.NM_AS_OF));
check("leads with Galaxy Mind's strengths, before the marketplace table", page.indexOf("data-nm-lead") > 0 && page.indexOf("data-nm-lead") < page.indexOf("data-nm-projects") && C.NM_LEAD.length >= 3 && /free/i.test(C.NM_LEAD.join(" ")) && /person/.test(C.NM_LEAD.join(" ")));
check("no ranking or traffic claims", !/\b(best|worst|largest|biggest|leading|#1|number one|users|visitors|traffic|followers)\b/i.test(copy));
check("covers signed listings, npub, Lightning checkout, encrypted messages",
  /signed/i.test(C.NM_SHORT) && C.NM_HOW.some((b) => /npub/.test(b.title)) && C.NM_HOW.some((b) => /Lightning checkout/.test(b.title)) && C.NM_HOW.some((b) => /Encrypted/.test(b.title)));
check("explains marketplace vs directory", C.NM_COMPARE.length >= 3 && /Marketplace or directory\?/.test(page));
check("explains why we index every platform", /whatever platform/.test(C.NM_WHY));
check("no word 'real'", !/\breal\b/i.test(copy));
check("no disparagement words", !/\b(scam|shady|worse|inferior|broken|dead|sketchy|risky|unsafe|clunky|slow|outdated)\b/i.test(copy));
check("no referral/affiliate/tracking params", !/[?&](ref|referral|aff|affiliate|utm_[a-z]+)=/i.test(all) && C.NM_PROJECTS.every((p) => !/[?#]/.test(p.url + p.codeUrl)));
check("no em/en-dash clause breaks", !/ [—–] /.test(copy));
check("FAQPage built from NM_FAQ and rendered from NM_FAQ", /mainEntity: NM_FAQ\.map/.test(page) && /NM_FAQ\.map\(\(f\) => \(\s*<div/.test(page));
check("no Dataset markup", !/"Dataset"/.test(page));
check("one H1", (page.match(/<h1[\s>]/g) ?? []).length === 1);
check("canonical is its own URL", C.NM_URL === "https://galaxymind.space/nostr-marketplaces" && /canonical: URL/.test(page));
check("OG card has descriptive alt", /export const alt = NM_OG_ALT/.test(og) && C.NM_OG_ALT.length > 40);
check("/nostr-vendors links the explainer", readFileSync("src/app/nostr-vendors/page.tsx", "utf8").includes('href="/nostr-marketplaces"'));
check("sitemap lists it", readFileSync("src/app/sitemap.ts", "utf8").includes('"https://galaxymind.space/nostr-marketplaces"'));
check("llms.txt lists it", readFileSync("public/llms.txt", "utf8").includes("https://galaxymind.space/nostr-marketplaces"));

console.log(`\n${fail ? "✗" : "✓"} ${pass} passed · ${fail} failed`);
if (fail) process.exit(1);
