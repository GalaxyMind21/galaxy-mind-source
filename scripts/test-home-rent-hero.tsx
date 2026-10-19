// Home page rental tile + /hashrate SEO copy (operator 2026-10-17; tile moved below the directory
// so the free vendor directory leads the home page for the bitcoin.org listing). In-process, no network.
// Live / zero / stale states, CTA to /hashrate, no outbound marketplace link in any state (profile is login-walled), no
// rig id, price, hardware model, named pool or the word "real" in visible text or the SEO strings.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { HomeRentHero, type HomeRentCopy } from "../src/components/HomeRentHero";
import VendorsPage from "../src/app/HomeClient";
import * as C from "../src/lib/mrr-page-copy";
import { HOME_FAQ, homeFaqLd } from "../src/lib/home-faq";
import { FOR_SHOPS_POINTS } from "../src/lib/for-shops";
import { MESSAGES } from "../src/lib/messages";
import { leaksNeverReveal } from "./lib/never-reveal-test";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };
const visible = (html: string) => html.replace(/<[^>]+>/g, " ") + "\n" + [...html.matchAll(/\s([a-zA-Z-:]+)="([^"]*)"/g)].filter((m) => m[1] !== "href").map((m) => m[2]).join("\n");
const BAD = [/\b3[78]\d{4}\b/, /\$|\bUSD\b|\bsats?\b|\bprice\b|per\s+(day|hour)/i, /\bS21\b|\bXP\b|antminer|bitmain|avalon/i, /ckpool|braiins|f2pool|antpool|viabtc|public[- ]pool/i, /\breal\b/i, /facility/i, { test: (t: string) => leaksNeverReveal(t) } as unknown as RegExp];

const copy: HomeRentCopy = {
  kicker: C.HOME_RENT_KICKER, title: C.HOME_RENT_TITLE, sub: C.HOME_RENT_SUB, live: C.HOME_RENT_LIVE, none: C.HOME_RENT_NONE,
  cta: C.HOME_RENT_CTA,
};
const render = (view: Parameters<typeof HomeRentHero>[0]["view"]) =>
  renderToStaticMarkup(<HomeRentHero view={view} copy={copy} />);

console.log("── home rent hero ───────────────────────────────");
const live = render({ state: "live", at: Date.now(), freeCount: 3 });
assert("live: count line reads 3 × 270 TH/s available now", live.includes("3 × 270 TH/s available now") && live.includes('data-home-rent="live"'));
assert("live: primary CTA goes to /hashrate", /<a[^>]*data-home-rent-cta[^>]*href="\/hashrate"|<a[^>]*href="\/hashrate"[^>]*data-home-rent-cta/.test(live));
assert("live: no marketplace link", !live.includes("miningrigrentals.com"));
assert("hero is an H2 (home keeps its one directory H1)", !live.includes("<h1") && live.includes("<h2"));

const zero = render({ state: "live", at: Date.now(), freeCount: 0 });
assert("zero: no count line", !zero.includes("data-home-live-line") && !/\d+ × 270 TH\/s available/.test(zero));
assert("zero: 'All rented right now. Check back soon.' and no outbound link", zero.includes("All rented right now. Check back soon.") && !zero.includes("miningrigrentals") && !zero.includes("/u/GalaxyMind"));
assert("zero: CTA still to /hashrate", zero.includes('href="/hashrate"'));

// The server (unitsView) already turns >15-minute data into "stale"; the client re-checks every 30 s after mount.
const stale = render({ state: "stale" });
assert("stale: no count, no all-rented claim", !stale.includes("available now") && !stale.includes("All rented") && stale.includes('data-home-rent="stale"'));
const down = render({ state: "unavailable" });
assert("feed down: no count, CTA only", !down.includes("available now") && down.includes('href="/hashrate"'));

for (const [name, html] of [["live", live], ["zero", zero], ["stale", stale]] as const) {
  const v = visible(html);
  const hit = BAD.find((re) => re.test(v));
  assert(`${name}: visible text clean`, !hit, hit ? String(v.match(hit)) : "");
}

// Quiet, secondary tile: no orange primary button, no big hero type.
assert("tile CTA is not the orange primary button", !/data-home-rent-cta[^>]*class="[^"]*(bg-\[var\(--accent\)\]|lit-primary)/.test(live) && !/class="[^"]*(bg-\[var\(--accent\)\]|lit-primary)[^"]*"[^>]*data-home-rent-cta/.test(live));
assert("tile heading is small (no hero-size type)", !/sm:text-4xl|text-\[24px\]/.test(live));
assert("tile keeps the frosted-glass card", live.includes("hero-glass"));
assert("tile click event is anonymous (surface + state only)", /track\("home_rent_cta_click", \{ surface: "home_below_directory", state \}\)/.test(readFileSync("src/components/HomeRentHero.tsx", "utf8")));

console.log("── home page order: directory first ─────────────");
const home = renderToStaticMarkup(<VendorsPage rentHero={<HomeRentHero view={{ state: "live", at: Date.now(), freeCount: 2 }} copy={copy} />} />);
const iH1 = home.indexOf("<h1"), iSearch = home.indexOf('id="vendor-search"'), iGrid = home.indexOf("data-vendor-grid"), iTile = home.indexOf("data-home-rent=");
assert("home renders the directory H1, search, grid and the tile", iH1 >= 0 && iSearch >= 0 && iGrid >= 0 && iTile >= 0, `${iH1} ${iSearch} ${iGrid} ${iTile}`);
assert("directory H1 comes before the rent tile", iH1 >= 0 && iH1 < iTile);
assert("directory search comes before the rent tile", iSearch >= 0 && iSearch < iTile);
assert("vendor grid comes before the rent tile", iGrid >= 0 && iGrid < iTile);
assert("home keeps exactly one H1 (the directory's)", (home.match(/<h1[\s>]/g) ?? []).length === 1);

console.log("── home hook, chips, pay callout, For shops, FAQ (competitor lessons 2026-10-18) ──");
{
  const iHook = home.indexOf("data-home-hook"), iPay = home.indexOf("data-home-pay-callout");
  const iShops = home.indexOf("data-home-for-shops"), iFaq = home.indexOf("data-home-faq");
  assert("hook renders above the directory H1 as one compact line", iHook >= 0 && iHook < iH1);
  const hookBlock = home.slice(iHook, iH1);
  assert("hook is not a heading (H1 stays the directory's, no H2 above it)", !/<h[1-6][\s>]/.test(hookBlock));
  assert("hook is kicker-size text (no display/hero type)", !/night-bench-title|display-title|text-(2xl|3xl|4xl)/.test(hookBlock));
  assert("three chips, hidden on phones so mobile keeps the directory up top", (hookBlock.match(/<li[\s>]/g) ?? []).length === 3 && /hidden sm:flex[^"]*"[^>]*data-home-chips|data-home-chips[^>]*class="hidden sm:flex/.test(hookBlock));
  assert("pay callout, For shops and FAQ all render", iPay >= 0 && iShops >= 0 && iFaq >= 0, `${iPay} ${iShops} ${iFaq}`);
  assert("pay callout sits below the vendor grid", iPay > iGrid);
  assert("For shops sits below the grid and the rent tile", iShops > iGrid && iShops > iTile);
  assert("FAQ sits below the grid and the rent tile", iFaq > iGrid && iFaq > iTile);
  assert("pay callout links the Lightning guide", /data-home-pay-callout[\s\S]{0,800}href="\/how-to-pay-with-lightning"/.test(home));
  const shops = home.slice(iShops, iFaq);
  assert("For shops CTA: 'List your shop free' → /submit", /href="\/submit"[^>]*data-submit-cta|data-submit-cta[^>]*href="\/submit"/.test(shops) && shops.includes("List your shop free"));
  assert("For shops has a separate 'Browse shops' CTA to the directory", /href="#vendor-directory"[^>]*data-browse-cta/.test(shops) && shops.includes("Browse shops"));
  assert("For shops links the badge", shops.includes('href="/badge"'));
  assert("For shops lists all five points", FOR_SHOPS_POINTS.every((k) => shops.includes(MESSAGES.en[k].replace(/'/g, "&#x27;"))));
  assert("submit CTA event is anonymous (surface only)", /track\("submit_cta_click", \{ surface: "home_for_shops" \}\)/.test(readFileSync("src/components/HomeForShops.tsx", "utf8")));
  assert("For shops + FAQ keep the frosted-glass card", shops.includes("hero-glass") && home.slice(iFaq).includes("hero-glass"));

  const en = (k: string) => MESSAGES.en[k] ?? k;
  const ld = homeFaqLd(en, "https://galaxymind.space");
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
  const answers = [...home.matchAll(/data-home-faq-answer[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert("FAQ has 4-6 questions", HOME_FAQ.length >= 4 && HOME_FAQ.length <= 6 && ld.mainEntity.length === HOME_FAQ.length);
  assert("FAQPage JSON-LD answers match the visible answers exactly", answers.length === ld.mainEntity.length && ld.mainEntity.every((q, i) => esc(q.acceptedAnswer.text) === answers[i]));
  assert("FAQPage JSON-LD questions are visible", ld.mainEntity.every((q) => home.includes(esc(q.name))));
  assert("FAQPage JSON-LD is wired into the home @graph", /homeFaqLd\(/.test(readFileSync("src/app/page.tsx", "utf8")) && /\n\s*faqLd,\n/.test(readFileSync("src/app/page.tsx", "utf8")));
  assert("FAQ links /methodology, the pay guide and /faq", /data-home-faq[\s\S]*href="\/methodology"/.test(home) && /data-home-faq[\s\S]*href="\/how-to-pay-with-lightning"/.test(home) && /data-home-faq[\s\S]*href="\/faq"/.test(home));
  for (const loc of ["en", "es"] as const) {
    const keys = Object.keys(MESSAGES.en).filter((k) => /^home\.(hook|chip|payCallout|shops|faq)|^submit\.pitch/.test(k));
    assert(`${loc}: every new home key present`, keys.every((k) => typeof MESSAGES[loc][k] === "string" && MESSAGES[loc][k].length > 0));
    const txt = keys.map((k) => MESSAGES[loc][k]).join("\n");
    const hit = BAD.find((re) => re.test(txt));
    assert(`${loc}: new home copy clean (no price, model, pool, real, location)`, !hit, hit ? String(txt.match(hit)) : "");
  }
  const submit = readFileSync("src/app/submit/page.tsx", "utf8");
  assert("/submit opens with the same For shops points", /FOR_SHOPS_POINTS\.map/.test(submit) && /data-submit-pitch/.test(submit) && submit.indexOf("data-submit-pitch") < submit.indexOf("<SubmitForm"));
}

console.log("── /hashrate SEO copy ───────────────────────────");
assert("title leads with Rent Bitcoin Hashrate, ≤ 60 chars", /^Rent Bitcoin Hashrate/.test(C.MRR_PAGE_TITLE) && C.MRR_PAGE_TITLE.length <= 60, String(C.MRR_PAGE_TITLE.length));
assert("description ≤ 160 chars and leads with hashrate", C.MRR_PAGE_DESCRIPTION.length <= 160 && /^Rent Bitcoin hashrate/.test(C.MRR_PAGE_DESCRIPTION), String(C.MRR_PAGE_DESCRIPTION.length));
const qs = C.MRR_FAQ_ITEMS.map((f) => f.q);
for (const q of ["Can I rent hashrate to solo mine?", "Do I need KYC to rent hashrate?", "How much hashrate can I rent?", "What are my odds of finding a block?"]) {
  assert(`FAQ has "${q}"`, qs.includes(q));
}
const kyc = C.MRR_FAQ_ITEMS.find((f) => f.q.includes("KYC"))!.a;
assert("KYC answer: we ask no ID, marketplace rules apply and it may ask for ID", /never ask for ID/.test(kyc) && /can still ask for ID/.test(kyc) && /account rules apply/.test(kyc));
const seo = [C.MRR_PAGE_TITLE, C.MRR_PAGE_DESCRIPTION, C.MRR_SOCIAL_DESCRIPTION, C.MRR_OG_ALT, C.MRR_WHY_TITLE, C.MRR_ODDS_TITLE, C.MRR_FLOW_TITLE, C.MRR_FAQ_TITLE, ...C.MRR_FAQ_ITEMS.flatMap((f) => [f.q, f.a])].join("\n");
const seoHit = BAD.find((re) => re.test(seo.replace(/\$\{[^}]*\}/g, "")));
assert("SEO strings clean (no price, model, pool, real, location, id)", !seoHit, seoHit ? String(seo.match(seoHit)) : "");

const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
assert("sitemap: /hashrate lastmod 2026-10-17", /url: "https:\/\/galaxymind\.space\/hashrate",\s*lastModified: new Date\("2026-10-17"\)/.test(sitemap));
const rent = readFileSync("src/app/hashrate/rent/page.tsx", "utf8");
assert("/hashrate/rent stays noindex in both modes", (rent.match(/robots: \{ index: false, follow: true \}/g) ?? []).length === 2);
const hp = readFileSync("src/app/hashrate/page.tsx", "utf8");
assert("/hashrate: Service JSON-LD with an Offer and no price", /"@type": "Service"/.test(hp) && /"@type": "Offer"/.test(hp) && !/\bprice(Specification)?"?\s*:\s*[{"\d]/.test(hp));
assert("/hashrate: no Dataset JSON-LD (sales page; GSC flagged a missing license)", !/"@type":\s*"Dataset"/.test(hp) && !/DATASET_DESCRIPTION/.test(hp));
assert("/hashrate: FAQPage JSON-LD still emitted", /"@type": "FAQPage"/.test(hp) && /application\/ld\+json/.test(hp));
assert("/hashrate: Service JSON-LD still rendered in an ld+json script", /safeJsonLd\(serviceLd\)/.test(hp));

console.log(`\n${fail ? "✗" : "✓"} ${pass} passed · ${fail} failed`);
if (fail) process.exit(1);
