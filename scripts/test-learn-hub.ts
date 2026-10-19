// /learn hub + arcade/how-to-rent structured data (SEO desk fixes, 2026-10-18).
// In-process, no network. Pins: /learn exists, sits in the nav, sitemap and
// llms.txt, links only to live in-site routes, and its JSON-LD is built from
// the rendered list. Also parses every ld+json block in the static CHOP and
// SIX DEEP cabinets, and checks the marketplace HowTo mirrors the visible steps.
import { existsSync, readFileSync } from "node:fs";
import * as L from "../src/lib/learn-hub-copy";
import { NAV_GROUPS } from "../src/lib/nav";
import { mrrGuideJsonLd, HOW_TO_RENT_URL } from "../src/lib/how-to-rent-jsonld";
import { MRR_GUIDE_STEPS, MRR_GUIDE_H1 } from "../src/lib/mrr-page-copy";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

const page = readFileSync("src/app/learn/page.tsx", "utf8");
const copy = [
  L.LEARN_TITLE, L.LEARN_META_TITLE, L.LEARN_DESCRIPTION, L.LEARN_OG_ALT, L.LEARN_SHORT,
  ...L.LEARN_SECTIONS.flatMap((s) => [s.title, s.intro, ...s.links.flatMap((l) => [l.title, l.blurb])]),
].join("\n");

console.log("── /learn hub ───────────────────────────────────");
check("page and OG card exist", existsSync("src/app/learn/page.tsx") && existsSync("src/app/learn/opengraph-image.tsx"));
check("meta title ≤ 70 chars", L.LEARN_META_TITLE.length <= 70, `${L.LEARN_META_TITLE.length}`);
check("meta description 70-160 chars", L.LEARN_DESCRIPTION.length >= 70 && L.LEARN_DESCRIPTION.length <= 160, `${L.LEARN_DESCRIPTION.length}`);
check("canonical is its own URL", L.LEARN_URL === "https://galaxymind.space/learn" && /canonical: URL/.test(page));
check("og:url + twitter card declared", /url: URL,/.test(page) && /summary_large_image/.test(page));
const hrefs = L.LEARN_ALL_LINKS.map((l) => l.href);
check("no duplicate links", new Set(hrefs).size === hrefs.length);
check("covers the core guides", ["/how-to-buy-bitcoin", "/how-to-accept-bitcoin", "/how-to-pay-with-lightning", "/spend-bitcoin-on", "/glossary", "/hashrate/how-to-rent"].every((h) => hrefs.includes(h)));
for (const h of hrefs) {
  check(`links a live route: ${h}`, h.startsWith("/") && !h.startsWith("//") && existsSync(`src/app${h}/page.tsx`));
}
check("no word 'real'", !/\breal\b/i.test(copy));
check("no em/en-dash clause breaks", !/ [—–] /.test(copy));
check("no external or referral links", !/https?:\/\//.test(hrefs.join(" ")) && !/[?&](ref|aff|utm_[a-z]+)=/i.test(copy + page));
check("no prices or counts that can drift", !/\$\d|\b\d{2,}\s+(shops|stores|vendors)\b/i.test(copy));

console.log("── /learn structured data ───────────────────────");
check("CollectionPage + ItemList + BreadcrumbList", /"@type": "CollectionPage"/.test(page) && /"@type": "ItemList"/.test(page) && /buildBreadcrumb\(/.test(page));
check("ItemList built from LEARN_ALL_LINKS (same list as visible)", /itemListElement: LEARN_ALL_LINKS\.map/.test(page) && /LEARN_SECTIONS\.map\(\(s\) => \(/.test(page));

console.log("── discoverability ──────────────────────────────");
const learnGroup = NAV_GROUPS.find((g) => g.id === "learn");
check("Learn nav group links /learn first", learnGroup?.primary[0]?.href === "/learn");
check("sitemap lists /learn", readFileSync("src/app/sitemap.ts", "utf8").includes('"https://galaxymind.space/learn"'));
check("llms.txt lists /learn", readFileSync("public/llms.txt", "utf8").includes("https://galaxymind.space/learn)"));

console.log("── static cabinets: CHOP + SIX DEEP ─────────────");
function ldBlocks(html: string): unknown[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}
function types(doc: unknown): string[] {
  const graph = (doc as { "@graph"?: Record<string, unknown>[] })["@graph"] ?? [doc as Record<string, unknown>];
  return graph.flatMap((n) => ([] as string[]).concat(n["@type"] as string | string[]));
}
for (const [path, url] of [["public/chop/index.html", "https://galaxymind.space/chop"], ["public/six-deep/index.html", "https://galaxymind.space/six-deep"]] as const) {
  const html = readFileSync(path, "utf8");
  let docs: unknown[] = [];
  try { docs = ldBlocks(html); check(`${path}: every ld+json block parses`, docs.length >= 1); } catch (e) { check(`${path}: every ld+json block parses`, false, String(e)); }
  const t = docs.flatMap(types);
  check(`${path}: VideoGame + WebApplication + BreadcrumbList`, ["VideoGame", "WebApplication", "BreadcrumbList"].every((x) => t.includes(x)));
  check(`${path}: canonical + og:url point at itself`, html.includes(`<link rel="canonical" href="${url}"`) && html.includes(`og:url" content="${url}"`));
  check(`${path}: meta description present`, /<meta name="description" content="[^"]{70,}"/.test(html));
  check(`${path}: twitter card present`, /twitter:card" content="summary_large_image"/.test(html));
  check(`${path}: ld+json has no word 'real'`, !/\breal\b/i.test(JSON.stringify(docs)));
}
// SIX DEEP is still an unlisted gray-box prototype: it stays noindex and out
// of the sitemap until the operator promotes it (then flip both together).
const six = readFileSync("public/six-deep/index.html", "utf8");
const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
check("SIX DEEP noindex and sitemap agree", six.includes('content="noindex') === !sitemap.includes("galaxymind.space/six-deep"));

console.log("── /hashrate/how-to-rent (marketplace mode) ─────");
const [howTo, crumbs] = mrrGuideJsonLd() as Record<string, unknown>[];
const steps = howTo.step as { name: string; text: string }[];
check("HowTo @type + url", howTo["@type"] === "HowTo" && howTo.url === HOW_TO_RENT_URL && howTo.name === MRR_GUIDE_H1);
check("HowTo steps === visible MRR_GUIDE_STEPS", steps.length === MRR_GUIDE_STEPS.length && steps.every((s, i) => s.name === MRR_GUIDE_STEPS[i].title && s.text === MRR_GUIDE_STEPS[i].body));
check("BreadcrumbList ends at the guide", crumbs["@type"] === "BreadcrumbList" && (crumbs.itemListElement as { item: string }[]).at(-1)?.item === HOW_TO_RENT_URL);
const ldText = JSON.stringify(mrrGuideJsonLd());
check("no prices, rig ids or hardware model in the markup", !/\$|USD|BTC\/|S\d{2}\b|rig\s*#?\d/i.test(ldText));
const guide = readFileSync("src/app/hashrate/how-to-rent/page.tsx", "utf8");
check("marketplace branch passes the JSON-LD", /jsonLd=\{mrrGuideJsonLd\(\)\}/.test(guide));

console.log(`\n${fail ? "✗" : "✓"} ${pass} passed · ${fail} failed`);
if (fail) process.exit(1);
