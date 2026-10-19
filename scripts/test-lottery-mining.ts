// /lottery-mining-bitcoin guardrails (SEO brief 2026-10-18). In-process, no
// network. Pins the probability math against hand-worked values, the copy
// rules (no return promises, no word "real", no pool or hardware names, no
// dollar figures, no referral params outside the gated module), the JSON-LD
// shape, the /hashrate CTA and discoverability.
import { readFileSync } from "node:fs";
import * as C from "../src/lib/lottery-mining-copy";
import { lotteryRows, roundOneIn, sameTicket, ehLabel, LOTTERY_SIZES } from "../src/lib/lottery-odds";
import { blockOdds } from "../src/lib/block-odds";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };
const near = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= Math.abs(b) * rel;

console.log("── odds math ────────────────────────────────────");
{
  // 1,000 EH/s network = 1,000,000 PH/s. One 270 TH/s chunk for a day:
  // p = 0.27 / 1e6 = 2.7e-7, n = 144, P = 1 - (1 - p)^144.
  const H = 1_000_000;
  const rows = lotteryRows(H)!;
  const one = rows.find((r) => r.id === "one")!;
  const p = 0.27 / H;
  check("per-block chance is hashrate ÷ network", near(one.perBlock, p));
  check("one day uses n = 144 exactly", near(1 / one.dayOneIn, 1 - Math.pow(1 - p, 144)));
  check("one week uses n = 1,008 exactly", near(1 / one.weekOneIn, 1 - Math.pow(1 - p, 1008)));
  check("exact form agrees with 1 - e^(-np) at this scale", near(1 / one.dayOneIn, 1 - Math.exp(-144 * p), 1e-6));
  check("one chunk, one day at 1,000 EH/s rounds to 1 in 26,000", roundOneIn(one.dayOneIn) === "26,000", roundOneIn(one.dayOneIn));
  check("average wait = network ÷ yours blocks of 10 minutes", near(one.expectedYears, (H / 0.27) / (144 * 365)));
  check("ten chunks are ten times likelier per block", near(rows.find((r) => r.id === "ten")!.perBlock, 10 * p));
  check("three sizes: 1.2 TH/s, 270 TH/s, 2.7 PH/s", LOTTERY_SIZES.map((s) => s.ph).join(",") === "0.0012,0.27,2.7");
  check("matches the calculator's blockOdds", near(one.dayOneIn, blockOdds({ ph: 0.27, hours: 24, networkPhs: H })!.oneInN));
  check("bad network input → null (page shows syncing note)", lotteryRows(0) === null && lotteryRows(NaN) === null);
  check("six hours at 1 PH/s is the same ticket as twelve at 500 TH/s", sameTicket({ ph: 1, hours: 6 }, { ph: 0.5, hours: 12 }));
  const a = blockOdds({ ph: 1, hours: 6, networkPhs: H })!, b = blockOdds({ ph: 0.5, hours: 12, networkPhs: H })!;
  check("…and blockOdds agrees to 1e-6", near(a.pAtLeastOne, b.pAtLeastOne, 1e-6));
  check("roundOneIn keeps two significant figures", roundOneIn(25_720) === "26,000" && roundOneIn(3_703_704) === "3,700,000" && roundOneIn(3.8) === "3.8");
  check("ehLabel", ehLabel(1_026_010) === "1,026 EH/s");
}

console.log("── copy rules ───────────────────────────────────");
const copyFile = readFileSync("src/lib/lottery-mining-copy.ts", "utf8");
const page = readFileSync("src/app/lottery-mining-bitcoin/page.tsx", "utf8");
const og = readFileSync("src/app/lottery-mining-bitcoin/opengraph-image.tsx", "utf8");
const strings = Object.values(C).flatMap((v) => typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap((x) => typeof x === "string" ? [x] : Object.values(x as Record<string, string>)) : []).join("\n");
const all = `${strings}\n${page}\n${og}`;
check("meta title ≤ 70 chars", C.LOTTERY_META_TITLE.length <= 70, `${C.LOTTERY_META_TITLE.length}`);
check("meta description 70-160 chars", C.LOTTERY_DESCRIPTION.length >= 70 && C.LOTTERY_DESCRIPTION.length <= 160, `${C.LOTTERY_DESCRIPTION.length}`);
check("answer box is 40-70 words", (() => { const w = C.LOTTERY_SHORT.split(/\s+/).length; return w >= 40 && w <= 70; })());
check("no word 'real'", !/\breal\b/i.test(strings));
check("no return framing (profit as a promise, earn, passive income, you could win)", !/\b(earn|earnings|passive income|you could win|guaranteed)\b/i.test(strings));
check("'profitable' only appears as the honest FAQ question", (strings.match(/profitab/gi) ?? []).length === 1 && /On average, no\./.test(strings));
check("no hardware model names", !/\b(antminer|bitaxe|nerd\s?q?axe|nerdminer|avalon|whatsminer|s19|s21|t21|m50|m60|apollo)\b/i.test(all));
check("no pool names", !/\b(ckpool|braiins|public pool|solopool|viabtc|foundry|antpool|f2pool|ocean|nicehash|mkpool|nexuspool|solofury)\b/i.test(strings));
check("says Galaxy Mind is not affiliated with any pool", /not affiliated with any pool/.test(strings));
check("no dollar figures (outside source URLs)", !/\$\s?\d|\bUSD\b|\d\s?(dollars|k\b)/i.test(strings.replace(/https?:\/\/\S+/g, "")));
check("no em/en-dash clause breaks", !/ [—–] /.test(strings));
check("location only as US-based (US South)", /US-based \(US South\)/.test(strings));
check("marketplace name only via the gated module", !/miningrigrentals|\bMRR\b/i.test(copyFile + page));
check("no referral params outside the gated module", !/[?&]ref=/i.test(copyFile + page + og));
check("register link comes from marketplace-listing with its disclosure", /href=\{MARKETPLACE_REGISTER_URL\}/.test(page) && /MARKETPLACE_REFERRAL_NOTE/.test(page));
check("primary CTA points at /hashrate", /href="\/hashrate"\s/.test(page) && page.indexOf('href="/hashrate"\n') !== -1 || /<Link\s+href="\/hashrate"/.test(page));
check("links the calculator and how-to-rent", page.includes('href="/solo-mining-calculator"') && page.includes('href="/hashrate/how-to-rent"'));
check("odds come from the live feed, not hard-coded", /getNetworkPhs\(\)/.test(page) && /lotteryRows\(networkPhs\)/.test(page) && /data-odds-syncing/.test(page));
check("live table is date-stamped and sourced", /as of \{asOf\}/.test(page) && page.includes("https://mempool.space/mining"));
check("coinbase maturity is 100 blocks, cited", C.FOUND_BODY.join(" ").includes("100 more blocks") && page.includes("https://developer.bitcoin.org/devguide/"));
check("reported finds link a source each", C.WON_CASES.length === 2 && C.WON_CASES.every((w) => w.href.startsWith("https://")));
check("no usernames quoted from Reddit", !/\bu\/\w+/.test(strings));

console.log("── structured data ──────────────────────────────");
check("Article + HowTo + FAQPage + DefinedTerm + BreadcrumbList", /"@type": "Article"/.test(page) && /buildHowTo\(/.test(page) && /"@type": "FAQPage"/.test(page) && /"@type": "DefinedTerm"/.test(page) && /buildBreadcrumb\(/.test(page));
check("Article carries dateModified", /dateModified: C\.LOTTERY_MODIFIED/.test(page));
check("HowTo steps built from RENT_HOWTO_STEPS (same as visible)", /steps: C\.RENT_HOWTO_STEPS\.map/.test(page) && /C\.RENT_HOWTO_STEPS\.map\(\(s, i\) => \(/.test(page));
check("FAQPage built from LOTTERY_FAQ (same as visible)", /mainEntity: C\.LOTTERY_FAQ\.map/.test(page) && /C\.LOTTERY_FAQ\.map\(\(f\) => \(\s*<div/.test(page));
check("eight FAQs, five steps", C.LOTTERY_FAQ.length === 8 && C.RENT_HOWTO_STEPS.length === 5);
check("canonical is its own URL", C.LOTTERY_URL === "https://galaxymind.space/lottery-mining-bitcoin" && /canonical: URL/.test(page));
check("OG card has descriptive alt", /export const alt = LOTTERY_OG_ALT/.test(og) && C.LOTTERY_OG_ALT.length > 40);

console.log("── discoverability ──────────────────────────────");
check("sitemap lists the page", readFileSync("src/app/sitemap.ts", "utf8").includes('"https://galaxymind.space/lottery-mining-bitcoin"'));
check("llms.txt lists the page", readFileSync("public/llms.txt", "utf8").includes("https://galaxymind.space/lottery-mining-bitcoin)"));

console.log(`\n${fail ? "✗" : "✓"} ${pass} passed · ${fail} failed`);
if (fail) process.exit(1);
