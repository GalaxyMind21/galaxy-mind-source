// /hashrate/antminer-s21-xp guardrails (2026-10-18). In-process, no network.
// The one page allowed to name the model (operator exception). Specs match
// Bitmain's own pages, the page sells no return and quotes no price, it
// carries no marketplace link, rig id, pool name or location beyond
// "US-based", the rent CTA goes to /hashrate, and JSON-LD is built from the
// same strings the page renders.
import { readFileSync } from "node:fs";
import * as C from "../src/lib/s21xp-copy";
import { TIER1_BANNED, TIER2_CONTEXT_GATED } from "../src/lib/hashrate-copy";
import { VENDORS, vendorSlug } from "../src/lib/vendors";
import { blockOdds } from "../src/lib/block-odds";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

const page = readFileSync("src/app/hashrate/antminer-s21-xp/page.tsx", "utf8");
const og = readFileSync("src/app/hashrate/antminer-s21-xp/opengraph-image.tsx", "utf8");
const copy = [
  C.S21XP_META_TITLE, C.S21XP_DESCRIPTION, C.S21XP_H1, C.S21XP_OG_ALT, C.S21XP_SHORT, C.S21XP_SPEC_SOURCE,
  ...C.S21XP_SPECS.flatMap((s) => [s.label, s.value]),
  ...C.S21XP_COMPARE.flatMap((r) => [r.model, r.th, r.watts, r.eff, r.cooling, r.power]),
  C.S21XP_COMPARE_NOTE, C.S21XP_EFFICIENCY, C.S21XP_HYDRO,
  C.S21XP_WORTH_SHORT, ...C.S21XP_WORTH_NUMBERS, C.S21XP_WORTH_FORMULA, ...C.S21XP_WORTH_SOURCES.flatMap((s) => [s.label, s.note]),
  C.S21XP_ODDS_SHORT, C.S21XP_ODDS_DAY, C.S21XP_ODDS_WEEK, C.S21XP_ODDS_LINE, C.S21XP_ODDS_NOTE, C.S21XP_ODDS_NONE, C.S21XP_ODDS_WHY,
  C.S21XP_RENT_SHORT, ...C.S21XP_RENT_POINTS, ...C.S21XP_DELIVERY,
  ...C.S21XP_RENT_VS_BUY.flatMap((r) => [r.topic, r.buy, r.rent]),
  C.S21XP_NOISE, C.S21XP_BUY_INSTEAD,
  ...C.S21XP_FAQ.flatMap((f) => [f.q, f.a]),
].join("\n");
// Visible JSX prose in the page (tags and attributes stripped).
const pageProse = page.replace(/\/\/[^\n]*/g, "").replace(/<[^>]+>/g, " ");
const all = `${copy}\n${pageProse}\n${og}`;

console.log("── specs match Bitmain ──────────────────────────");
const spec = (label: string) => C.S21XP_SPECS.find((s) => s.label === label)?.value ?? "";
check("hashrate 270 TH/s (±3%)", C.S21XP_TH === 270 && /^270 TH\/s typical \(±3%\)$/.test(spec("Hashrate")));
check("power 3,645 W at 25 °C", C.S21XP_WATTS === 3645 && spec("Power at the wall").startsWith("3,645 W at 25 °C"));
check("efficiency 13.5 J/TH and consistent with power/hashrate", C.S21XP_J_PER_TH === 13.5 && Math.abs(C.S21XP_WATTS / C.S21XP_TH - 13.5) < 0.05);
check("220 to 277 V, 20 A single phase", spec("Input voltage").startsWith("220 to 277 V") && spec("Input current") === "20 A, single phase");
check("noise 76 dBA", spec("Noise").startsWith("76 dBA"));
check("SHA-256, BTC/BCH/BSV", spec("Algorithm") === "SHA-256" && spec("Coins") === "BTC, BCH, BSV");
check("spec source is Bitmain's support page, linked on the page", C.BITMAIN_S21XP_SPEC_URL.startsWith("https://support.bitmain.com/hc/en-us/articles/") && /href=\{BITMAIN_S21XP_SPEC_URL\}/.test(page));
check("every comparison row cites a Bitmain support URL", C.S21XP_COMPARE.every((r) => r.source.startsWith("https://support.bitmain.com/")));
const row = (m: string) => C.S21XP_COMPARE.find((r) => r.model === m)!;
check("S21 Pro row: 234 TH/s, 3,510 W, 15 J/TH", row("S21 Pro").th === "234 TH/s" && row("S21 Pro").watts === "3,510 W" && row("S21 Pro").eff === "15 J/TH");
check("S21 XP Hyd row: 473 TH/s, 5,676 W, 12.0 J/TH", row("S21 XP Hyd").th === "473 TH/s" && row("S21 XP Hyd").watts === "5,676 W" && row("S21 XP Hyd").eff === "12.0 J/TH");
check("daily energy line matches 3.645 kW × 24 h", /87\.5 kWh/.test(C.S21XP_WORTH_NUMBERS.join(" ")) && Math.abs((C.S21XP_WATTS * 24) / 1000 - 87.48) < 0.01);

console.log("── no return, no price, no forecast ─────────────");
const tier1 = TIER1_BANNED.filter((w) => all.toLowerCase().includes(w.toLowerCase()));
check("no TIER1 banned phrase", tier1.length === 0, tier1.join(", "));
const tier2 = TIER2_CONTEXT_GATED.filter((w) => new RegExp(`\\b${w}`, "i").test(copy));
check("no TIER2 return vocabulary (invest, yield, profit, returns, earn)", tier2.length === 0, tier2.join(", "));
check("no dollar amounts, USD, sats or price words", !/\$\d|\bUSD\b|\bsats?\b|\bprice\b|per\s+(day|hour)/i.test(copy));
check("no 'will' forecasts", !/\bwill (be|earn|make|pay|rise|reach|return)\b/i.test(copy));
check("no lottery or wager register", !/lottery|jackpot|\bprize\b|gamble|shot at/i.test(all));
check("no word 'real'", !/\breal\b/i.test(all));
check("no em/en-dash clause breaks", !/ [—–] /.test(copy));

console.log("── never-reveal style guards ────────────────────");
check("no marketplace link or name on the page", !/miningrigrentals|\bMRR\b|[?&]ref=|\/rigs\//i.test(all));
check("no rig ids", !/\b3[78]\d{4}\b/.test(all));
check("no pool names", !/ckpool|braiins|f2pool|antpool|viabtc|foundry|ocean|luxor|public[- ]pool|solo\.ckpool/i.test(all));
check("location stays 'US-based' only", !/us-?south|US South|facility|data ?cent(er|re)|hosting company/i.test(all));
check("no hardware brands the house bans", !/coinkite|coldcard|start9/i.test(all));
check("no Avalon mention (brief guardrail)", !/avalon/i.test(all));
check("no affiliate params anywhere", !/[?&](ref|referral|aff|affiliate|tag|utm_[a-z]+)=/i.test(page + og));

console.log("── CTA + links ──────────────────────────────────");
check("hero and final CTAs go to /hashrate", /href="\/hashrate" className=\{`mt-5 \$\{CTA_CLS\}`\} data-s21xp-cta="hero"/.test(page) && /href="\/hashrate" className=\{CTA_CLS\} data-s21xp-cta="final"/.test(page));
check("CTA wording from the brief", (page.match(/Rent an S21 XP by the hour →/g) ?? []).length === 2);
for (const href of ["/hashrate/how-to-rent", "/solo-mining-calculator", "/hashrate/agents", "/spend-bitcoin-on/hardware"]) {
  check(`links ${href}`, page.includes(`href="${href}"`));
}
for (const name of C.S21XP_BUY_VENDORS) {
  check(`"buy instead" vendor ${name} is listed in the directory`, VENDORS.some((v) => v.name === name && v.category === "hardware"), vendorSlug({ name }));
}

console.log("── live odds ────────────────────────────────────");
check("odds come from getNetworkPhs + exact blockOdds", /getNetworkPhs\(\)/.test(page) && /blockOdds\(\{ ph, hours: 24, networkPhs \}\)/.test(page));
check("odds have an honest SYNCING state", /data-s21xp-odds="syncing"/.test(page) && /S21XP_ODDS_NONE/.test(page));
const o = blockOdds({ ph: 0.27, hours: 24, networkPhs: 1_029_000 })!;
check("sanity: 270 TH at about 1,029 EH/s is about 1 in 26,000 a day", C.roundOneIn(o.oneInN) === "26,000", C.roundOneIn(o.oneInN));
check("odds are not hard-coded in copy", !/1 in \d/.test(copy));

console.log("── structured data + SEO ────────────────────────");
check("Article + Product + FAQPage + BreadcrumbList", ["Article", "Product", "FAQPage"].every((t) => page.includes(`"@type": "${t}"`)) && /buildBreadcrumb\(\[/.test(page));
check("Product names Bitmain and carries no offers", /brand: \{ "@type": "Brand", name: "Bitmain" \}/.test(page) && !/offers/.test(page.replace(/\/\/[^\n]*/g, "")));
check("Product additionalProperty uses the spec constants", /value: S21XP_TH/.test(page) && /value: S21XP_WATTS/.test(page) && /value: S21XP_J_PER_TH/.test(page));
check("FAQPage built from S21XP_FAQ (same strings as visible)", /mainEntity: S21XP_FAQ\.map/.test(page) && /S21XP_FAQ\.map\(\(f\) => \(\s*<div/.test(page));
check("breadcrumb: Galaxy Mind › Rent hashrate › Antminer S21 XP", /name: "Rent hashrate", url: `\$\{SITE_URL\}\/hashrate`/.test(page) && /name: "Antminer S21 XP", url: URL/.test(page));
check("one H1 on the page", (page.match(/<h1\b/g) ?? []).length === 1);
check("canonical is its own URL", C.S21XP_URL === "https://galaxymind.space/hashrate/antminer-s21-xp" && /canonical: URL/.test(page));
check("meta title leads with the model and fits a SERP line", /^Antminer S21 XP/.test(C.S21XP_META_TITLE) && C.S21XP_META_TITLE.length <= 60, String(C.S21XP_META_TITLE.length));
check("meta description is 120 to 160 characters", C.S21XP_DESCRIPTION.length >= 120 && C.S21XP_DESCRIPTION.length <= 160, String(C.S21XP_DESCRIPTION.length));
const words = C.S21XP_SHORT.split(/\s+/).length;
check("answer box is 40 to 60 words and opens with the answer", words >= 40 && words <= 60 && /^The Antminer S21 XP is Bitmain's/.test(C.S21XP_SHORT), String(words));
check("visible Last updated matches dateModified", /dateModified: S21XP_UPDATED/.test(page) && /dateTime=\{S21XP_UPDATED\}/.test(page));
check("OG card wired with descriptive alt", /export const alt = S21XP_OG_ALT/.test(og) && /pageOgImage\("\/hashrate\/antminer-s21-xp\/opengraph-image", S21XP_OG_ALT\)/.test(page));

console.log("── discoverability ──────────────────────────────");
const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
const llms = readFileSync("public/llms.txt", "utf8");
check("in the sitemap", sitemap.includes('url: "https://galaxymind.space/hashrate/antminer-s21-xp"'));
check("in llms.txt", llms.includes("(https://galaxymind.space/hashrate/antminer-s21-xp)"));

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
