#!/usr/bin/env tsx
// Monthly "Letter from the directory" (/letter, operator-approved 2026-10-18). Offline assertions on the content module,
// the routes, the sitemap and the footer. Copy rules: no "real", no prices, no miner models, pools, facility or
// location words, no em-dash clause breaks; every shop link resolves to a live /v page in the roster.
import { readFileSync, existsSync } from "node:fs";
import { LETTERS, letterText } from "../src/lib/letters";
import { VENDORS, vendorSlug } from "../src/lib/vendors";
import sitemap from "../src/app/sitemap";
import { leaksNeverReveal } from "./lib/never-reveal-test";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };
const BAD: [RegExp, string][] = [
  [/\breal\b/i, "the word 'real'"],
  [/\$\s?\d|\bUSD\b|\bper\s+(day|hour)\b/i, "a price"],
  [/\bS21\b|\bXP\b|antminer|bitmain|avalon|bitaxe/i, "a miner model"],
  [/ckpool|braiins|f2pool|antpool|viabtc|nicehash/i, "a pool name"],
  [/\bfacility\b/i, "the word facility"],
  [/\s[—–]\s/u, "an em-dash clause break"],
  [/\?ref=|affiliate link(?!s)/i, "an affiliate link"],
];

console.log("── letters ──────────────────────────────────────");
assert("at least one letter", LETTERS.length >= 1);
assert("October 2026 entry exists at /letter/2026-10", LETTERS.some((l) => l.slug === "2026-10" && l.month === "October 2026"));
assert("slugs are YYYY-MM and unique", LETTERS.every((l) => /^\d{4}-\d{2}$/.test(l.slug)) && new Set(LETTERS.map((l) => l.slug)).size === LETTERS.length);
assert("newest first", LETTERS.every((l, i) => i === 0 || LETTERS[i - 1].slug > l.slug));
const slugs = new Set(VENDORS.map(vendorSlug));
for (const l of LETTERS) {
  const text = [l.title, l.summary, letterText(l)].join("\n");
  for (const [re, what] of BAD) assert(`${l.slug}: no ${what}`, !re.test(text), text.match(re)?.[0]);
  assert(`${l.slug}: no never-reveal term`, !leaksNeverReveal(text));
  assert(`${l.slug}: dates are ISO`, /^\d{4}-\d{2}-\d{2}$/.test(l.published) && /^\d{4}-\d{2}-\d{2}$/.test(l.modified));
  for (const b of l.body) if (b.kind === "shops") for (const s of b.items)
    assert(`${l.slug}: ${s.name} links to its /v page in the roster`, s.href === `/v/${vendorSlug(VENDORS.find((v) => v.name === s.name) ?? ({ handle: "", name: "" } as never))}` && slugs.has(s.href.slice(3)));
}

console.log("── routes, sitemap, footer ──────────────────────");
const idx = "src/app/letter/page.tsx", entry = "src/app/letter/[month]/page.tsx";
assert("index and entry routes exist", existsSync(idx) && existsSync(entry));
const e = readFileSync(entry, "utf8"), i = readFileSync(idx, "utf8");
assert("entry emits Article JSON-LD", e.includes('"@type": "Article"') && e.includes("datePublished") && e.includes("safeJsonLd"));
assert("entry declares its own canonical", e.includes("alternates: { canonical: url }"));
assert("unknown months 404 (dynamicParams = false)", e.includes("export const dynamicParams = false"));
assert("index declares canonical /letter", i.includes('const URL_ = `${SITE_URL}/letter`') && i.includes("alternates: { canonical: URL_ }"));
assert("X card uses the letter's own title (twitter metadata)", e.includes("twitter: { title: letter.title, description: letter.summary }") && i.includes("twitter: {"));
assert("frosted panels (nb-panel)", e.includes("nb-panel") && i.includes("nb-panel"));
const urls = sitemap().map((u) => u.url);
assert("sitemap lists /letter", urls.includes("https://galaxymind.space/letter"));
for (const l of LETTERS) assert(`sitemap lists /letter/${l.slug}`, urls.includes(`https://galaxymind.space/letter/${l.slug}`));
assert("footer links /letter", readFileSync("src/components/SiteFooter.tsx", "utf8").includes('{ href: "/letter", label: "Monthly Letter" }'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
