// /spend-bitcoin-in/tennessee guardrails (2026-10-18). In-process, no network.
// State-level only: no county, no city of residence claim, no operator name,
// no mining or hashrate link, no hosting or location detail. The treasury
// line is one factual sentence with no return, price or holdings talk.
// Named businesses are the hand-checked set; a directory listing is claimed
// only for businesses that exist in src/lib/vendors.ts. Legal content is
// dated, cited and marked not legal advice. JSON-LD uses the visible strings.
import { readFileSync } from "node:fs";
import * as C from "../src/lib/state-guide-copy";
import { VENDORS } from "../src/lib/vendors";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

const page = readFileSync("src/app/spend-bitcoin-in/tennessee/page.tsx", "utf8");
const og = readFileSync("src/app/spend-bitcoin-in/tennessee/opengraph-image.tsx", "utf8");
const places = [...C.TN_DIRECTORY_PLACES, C.TN_CHAIN_PLACE];
const copy = [
  C.TN_META_TITLE, C.TN_DESCRIPTION, C.TN_H1, C.TN_OG_ALT, C.TN_SHORT, C.NOT_LEGAL_ADVICE,
  C.TN_LAW_QUOTE, C.TN_LAW_SUMMARY, C.TN_LAW_SCOPE, C.TN_WHY, C.TN_LAWSUIT, ...C.TN_ATM_MEANING,
  C.TN_DIRECTORY_INTRO, ...places.flatMap((p) => [p.name, p.city, p.body]), C.TN_CONFERENCE_TIP,
  ...C.TN_CITIES.flatMap((c) => [c.name, c.body, c.extra?.label ?? ""]), C.TN_MAP_NOTE,
  C.TN_ONLINE_INTRO, ...C.TN_GET_BITCOIN, C.TN_BUSINESS, C.TN_ABOUT_TITLE, C.TN_TREASURY_LINE, C.TN_ABOUT_BODY,
  ...C.TN_FAQ.flatMap((f) => [f.q, f.a]),
].join("\n");
const pageProse = page.replace(/\/\/[^\n]*/g, "").replace(/<[^>]+>/g, " ");
const all = `${copy}\n${pageProse}\n${og}`;

console.log("── state level only, nothing that locates the operator ──");
check("no county named", !/\bcount(y|ies)\b/i.test(all));
check("no mining, hashrate, rigs, hosting or facility", !/\bmin(ing|er|ers)\b|hash ?rate|\brigs?\b|\bhost(ed|ing)\b|facility|data ?cent(er|re)|US South/i.test(all));
check("no link to the rental side of the site", !/href="\/hashrate|href=\{?["'`]\/hashrate|\/solo-mining-calculator|\/treasuries/.test(page));
check("Galaxy Mind's own listing is never an online pick", C.onlinePicks().every((v) => !/galaxy mind/i.test(v.name)));
check("no IP addresses", !/\b\d{1,3}(\.\d{1,3}){3}\b/.test(all));
check("no phone numbers or street addresses", !/\(\d{3}\)\s?\d{3}-\d{4}|\+1-\d{3}|\b\d{2,5} [A-Z][a-z]+ (Street|Avenue|Road|Pike|Highway|Lane|Drive)\b/.test(all));
check("no hardware brands the house bans", !/coinkite|coldcard|start9/i.test(all));

console.log("── treasury framing stays factual ───────────────");
check("treasury line is exactly the approved sentence", C.TN_TREASURY_LINE === "Galaxy Mind is a Tennessee bitcoin treasury company.");
check("treasury line renders once, in the About block", (page.match(/\{TN_TREASURY_LINE\}/g) ?? []).length === 1 && /id="about"/.test(page));
check("no investment, return, price or holdings talk", !/invest|returns?\b|\byield|profit|earn|price|\$\d|holdings?|\bBTC\b(?! Map)|reserve|balance sheet|to the moon|will (rise|go up|reach)/i.test(copy));
check("word 'treasury' appears only in the approved line", (copy.match(/treasury/gi) ?? []).length === 1);
check("no word 'real'", !/\breal\b/i.test(all));
check("no em/en-dash clause breaks", !/ [—–] /.test(copy));

console.log("── named businesses ─────────────────────────────");
check("named set is exactly the verified three", places.map((p) => p.name).join("|") === "Bitcoin Park|Bitcoin Museum & Art Gallery|Steak 'n Shake");
for (const p of places) {
  const listed = VENDORS.some((v) => v.name === p.name);
  check(`${p.name}: directory claim matches vendors.ts (${listed ? "listed" : "not listed"})`, p.inDirectory === listed);
  check(`${p.name}: links its own https site`, p.href.startsWith("https://"));
}
check("listing link renders only when the vendor exists in VENDORS", /p\.inDirectory && VENDORS\.some\(\(v\) => v\.name === p\.name\)/.test(page));
check("every named place shows a last-checked date", /Last checked <time dateTime=\{TN_UPDATED\}>/.test(page));
check("other cities name no individual business except the verified chain", C.TN_CITIES.every((c) => !/Juicery|Liquors|DiCarlo|Piccola|Barber|BrainWerx|Crystal|Walking Pants|Arcade|Play N Trade|Sandwich/i.test(c.body)));
check("walk-in pins go to BTC Map, not copied", C.TN_CITIES.every((c) => c.mapHref.startsWith("https://btcmap.org/map#")) && page.includes('href="https://btcmap.org/map"'));
check("online picks are directory vendors from the US", C.onlinePicks().length >= 5 && C.onlinePicks().every((v) => v.country === "US" && VENDORS.includes(v)));
check("no affiliate params anywhere", !/[?&](ref|referral|aff|affiliate|tag|utm_[a-z]+)=/i.test(page + og + copy));

console.log("── legal summary: dated, cited, not advice ──────");
check("as-of date is stated and matches the update date", C.TN_AS_OF === "October 18, 2026" && C.TN_UPDATED === "2026-10-18" && /as of \{TN_AS_OF\}/.test(page));
check("not-legal-advice line renders", /\{NOT_LEGAL_ADVICE\}/.test(page) && /not legal advice/i.test(C.NOT_LEGAL_ADVICE));
check("quotes the operative language of the law", C.TN_LAW_QUOTE.includes("install or allow installation of, permit, place, or otherwise operate a virtual currency kiosk"));
check("effective date July 1, 2026 and Class A misdemeanor", /July 1, 2026/.test(C.TN_LAW_SUMMARY) && /Class A misdemeanor/.test(C.TN_LAW_SUMMARY));
check("cites capitol.tn.gov, TDFI, the AG, the docket and the FTC", [C.TN_LAW_URL, C.TN_BILL_URL].every((u) => u.includes("capitol.tn.gov")) && C.TN_TDFI_URL.includes("tn.gov/tdfi") && C.TN_AG_URL.includes("tn.gov/attorneygeneral") && C.TN_DOCKET_URL.includes("3:2026cv00284") && C.FTC_ATM_URL.startsWith("https://consumer.ftc.gov/"));
check("each legal source is linked on the page", ["TN_LAW_URL", "TN_BILL_URL", "TN_TDFI_URL", "TN_AG_URL", "TN_DOCKET_URL", "FTC_ATM_URL"].every((k) => page.includes(`href={${k}}`)));
check("says owning and spending bitcoin stay legal", C.TN_ATM_MEANING.some((s) => /Owning, buying, selling and spending bitcoin are still legal/.test(s)));
check("no provider recommendations in the get-bitcoin section", !/\b(coinbase|kraken|binance|gemini|robinhood|cash app|strike|river|swan|fidelity|schwab|coinflip)\b/i.test(C.TN_GET_BITCOIN.join(" ")));

console.log("── structured data + SEO ────────────────────────");
check("Article + CollectionPage + FAQPage + BreadcrumbList", ["Article", "CollectionPage", "FAQPage"].every((t) => page.includes(`"@type": "${t}"`)) && /buildBreadcrumb\(\[/.test(page));
check("ItemList is built from the named, verified places only", /itemListElement: named\.map/.test(page) && /const named = \[\.\.\.TN_DIRECTORY_PLACES, TN_CHAIN_PLACE\]/.test(page));
check("spatialCoverage is the state of Tennessee", (page.match(/spatialCoverage: \{ "@type": "State", name: "Tennessee" \}/g) ?? []).length === 2);
check("Article dateModified matches the visible date", /dateModified: TN_UPDATED/.test(page) && /dateTime=\{TN_UPDATED\}/.test(page));
check("FAQPage built from TN_FAQ (same strings as visible)", /mainEntity: TN_FAQ\.map/.test(page) && /TN_FAQ\.map\(\(f\) => \(\s*<div/.test(page) && C.TN_FAQ.length === 8);
check("breadcrumb: Galaxy Mind › United States › Tennessee", /name: "United States", url: `\$\{SITE_URL\}\/spend-bitcoin-in\/united-states`/.test(page) && /name: "Tennessee", url: URL/.test(page));
check("one H1", (page.match(/<h1\b/g) ?? []).length === 1);
check("canonical is its own URL", C.TN_URL === "https://galaxymind.space/spend-bitcoin-in/tennessee" && /canonical: URL/.test(page));
check("meta title fits a SERP line", C.TN_META_TITLE.length <= 60, String(C.TN_META_TITLE.length));
check("meta description is 120 to 160 characters", C.TN_DESCRIPTION.length >= 120 && C.TN_DESCRIPTION.length <= 160, String(C.TN_DESCRIPTION.length));
const words = C.TN_SHORT.split(/\s+/).length;
check("answer box is 50 to 70 words and opens with the ban", words >= 50 && words <= 70 && /^Bitcoin ATMs have been illegal/.test(C.TN_SHORT), String(words));
check("OG card wired with descriptive alt", /export const alt = TN_OG_ALT/.test(og) && /pageOgImage\("\/spend-bitcoin-in\/tennessee\/opengraph-image", TN_OG_ALT\)/.test(page));
check("primary CTA goes to the US hub with a live count", /href="\/spend-bitcoin-in\/united-states" className=\{CTA_CLS\} data-tn-cta="primary"/.test(page) && /\{usCount\} verified US shops/.test(page));
for (const href of ["/online-stores-that-accept-bitcoin", "/spend-bitcoin-on", "/how-to-buy-bitcoin", "/how-to-pay-with-lightning", "/how-to-accept-bitcoin", "/submit", "/badge", "/spend-and-replace"]) {
  check(`links ${href}`, page.includes(`href="${href}"`));
}

console.log("── discoverability ──────────────────────────────");
check("in the sitemap", /import \{ TN_URL \} from "@\/lib\/state-guide-copy"/.test(readFileSync("src/app/sitemap.ts", "utf8")) && /url: TN_URL,/.test(readFileSync("src/app/sitemap.ts", "utf8")));
check("footer rent button is hidden on /spend-bitcoin-in pages", /<HideOnPaths prefixes=\{\["\/spend-bitcoin-in"\]\}>\s*(\{\/\*[^]*?\*\/\}\s*)?<Link\s+href=\{RENT_PAGE_PATH\}[^]*?data-footer-mrr[^]*?<\/HideOnPaths>/.test(readFileSync("src/components/SiteFooter.tsx", "utf8")));
// Place names: every capitalised name after a location word must be on this allow-list (state + the three city cards)
// or on the short list of non-place proper nouns. A new name fails the test until someone reviews it.
const ALLOWED_PLACES = new Set(["Tennessee", "Knoxville", "Chattanooga", "Memphis"]);
const NON_PLACES = new Set(["BTC Map", "Financial Institutions", "October", "Spend Bitcoin", "TN_ONLINE_CATEGORIES"]);
const placeSrc = [page, og, readFileSync("src/lib/state-guide-copy.ts", "utf8")].join("\n");
const NAME = String.raw`[A-Z][\w'’&-]*(?: [A-Z][\w'’&-]*)*`;
const PLACE_RE = new RegExp(String.raw`\b(?:in|around|near|to|from|across|visiting|at|of)\s+(${NAME}(?:(?:,\s*|,?\s+(?:and|or)\s+)${NAME})*)`, "g");
const named = new Set<string>();
for (const m of placeSrc.matchAll(PLACE_RE)) for (const n of m[1].split(/,\s*|,?\s+(?:and|or)\s+/)) named.add(n);
const unknown = [...named].filter((n) => !ALLOWED_PLACES.has(n) && !NON_PLACES.has(n));
check(`only allow-listed place names appear${unknown.length ? ` (review: ${unknown.join(", ")})` : ""}`, unknown.length === 0 && named.has("Tennessee"));
check("city cards use allow-listed cities only", C.TN_CITIES.every((c) => ALLOWED_PLACES.has(c.name)) && places.every((p) => p.city === "Tennessee" || p.city === "Statewide"));
check("no county names", !/\bCounty\b/.test(placeSrc));
const llmsTn = (readFileSync("public/llms.txt", "utf8").split(/\n(?=- \[)/).find((e) => e.includes("/spend-bitcoin-in/tennessee)")) ?? "");
check("no private file paths or ops references (page, copy, OG, llms.txt entry)", llmsTn.length > 0 && !/\bseo\/|\.md\b|ops box/i.test(placeSrc + llmsTn));
check("in llms.txt", readFileSync("public/llms.txt", "utf8").includes("(https://galaxymind.space/spend-bitcoin-in/tennessee)"));

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
