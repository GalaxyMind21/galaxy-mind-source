// /how-to-buy-bitcoin guardrails (beginner guide, 2026-10-18). In-process, no
// network. The guide stays general education: a not-financial-advice line,
// no exchange picks, no affiliate or retailer links, no hardware-vendor names
// and no mining-pool names. Books link to author/publisher pages or a free
// official copy. JSON-LD is built from the same strings the page renders, and
// sitemap, llms.txt, nav, footer and cross-links keep the page discoverable.
import { readFileSync } from "node:fs";
import * as C from "../src/lib/buy-guide-copy";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

const page = readFileSync("src/app/how-to-buy-bitcoin/page.tsx", "utf8");
const og = readFileSync("src/app/how-to-buy-bitcoin/opengraph-image.tsx", "utf8");
const copy = [
  C.BUY_GUIDE_TITLE, C.BUY_GUIDE_META_TITLE, C.BUY_GUIDE_DESCRIPTION, C.BUY_GUIDE_OG_ALT, C.BUY_GUIDE_SHORT, C.NOT_ADVICE,
  ...C.BUY_STEPS.flatMap((s) => [s.title, s.body, s.hrefLabel ?? ""]),
  ...C.BUY_METHODS.flatMap((m) => [m.title, m.how, m.pros, m.cons, ...(m.links ?? []).map((l) => `${l.label} ${l.href}`), ...(m.internal ?? []).map((l) => l.label)]),
  ...C.FEES_POINTS, ...C.WALLET_POINTS, ...C.SCAM_POINTS,
  ...C.BOOKS.flatMap((b) => [b.title, b.author, b.blurb, b.href, b.linkNote]),
  ...C.BUY_FAQ.flatMap((f) => [f.q, f.a]),
].join("\n");
const copySrc = readFileSync("src/lib/buy-guide-copy.ts", "utf8");
const all = `${copy}\n${page}\n${og}\n${copySrc}`;

console.log("── education, not advice ────────────────────────");
check("has a not-financial-advice line, rendered on the page", /^Not financial advice\./.test(C.NOT_ADVICE) && /\{NOT_ADVICE\}/.test(page));
check("no word 'real'", !/\breal\b/i.test(copy));
check("no price calls or urgency", !/\b(buy now|price target|to the moon|guaranteed|will (go|rise|reach))\b/i.test(copy.replace(/Guaranteed returns[^.]*scams\./, "")));
check("covers small amounts and dollar-cost averaging", /small/i.test(C.BUY_GUIDE_SHORT) && /dollar-cost averaging/.test(copy));
check("no hardware-vendor names", !/coinkite|coldcard|start9/i.test(all));
check("no mining-pool names", !/\b(braiins|foundry|antpool|f2pool|viabtc|ocean|luxor|spiderpool|mara pool|binance pool|slush)\b/i.test(all));
check("no exchange or brokerage brand picks", !/\b(coinbase|kraken|binance|gemini|robinhood|cash app|strike|river|swan|fidelity|schwab)\b/i.test(copy));
check("no best/top/recommended app claim", !/\b(best|top|our pick)\b[^.]{0,30}\b(app|exchange|wallet|broker)/i.test(copy));
check("says we recommend none and earn nothing", /do not recommend one over another/.test(page) && /earn nothing/.test(page));
check("no em/en-dash clause breaks", !/ [—–] /.test(copy));

console.log("── ways to buy ──────────────────────────────────");
const ids = C.BUY_METHODS.map((m) => m.id).join();
check("methods: exchange, bitcoin-only, ATM, P2P, earn", ids === "exchange,bitcoin-only,atm,p2p,earn", ids);
check("every method lists pros and cons", C.BUY_METHODS.every((m) => m.pros.length > 20 && m.cons.length > 20));
const p2p = C.BUY_METHODS.find((m) => m.id === "p2p")!;
check("P2P names Bisq, RoboSats and Hodl Hodl", ["Bisq", "RoboSats", "Hodl Hodl"].every((n) => p2p.how.includes(n)));
check("P2P is honest about premiums, speed and fraud", /premium/.test(p2p.cons) && /slower/.test(p2p.cons) && /fraud/.test(p2p.cons));
const earn = C.BUY_METHODS.find((m) => m.id === "earn")!;
check("earn links /hashrate gently (one internal link, not a CTA)", (earn.internal ?? []).filter((l) => l.href === "/hashrate").length === 1);
check("fees section covers spread and withdrawal", C.FEES_POINTS.some((p) => /^Spread/.test(p)) && C.FEES_POINTS.some((p) => /Withdrawal/.test(p)));
check("self-custody covers recovery words and a test send", C.WALLET_POINTS.some((p) => /recovery words/.test(p)) && C.WALLET_POINTS.some((p) => /test amount/.test(p)));
check("scams: no agency asks for bitcoin or ATM payment", C.SCAM_POINTS.some((p) => /bitcoin ATM/.test(p)));

console.log("── books ────────────────────────────────────────");
check("seven books", C.BOOKS.length === 7);
const brunell = C.BOOKS.find((b) => b.title === "Bitcoin Is for Everyone");
check("Bitcoin Is for Everyone by Natalie Brunell links the Harriman House page", !!brunell && brunell.author === "Natalie Brunell" && brunell.href.startsWith("https://harriman-house.com/"));
check("book count word matches BOOKS", C.BOOKS_COUNT_WORD === "seven" && /BOOKS_COUNT_WORD/.test(page));
check("llms.txt and OG card state the same book count", readFileSync("public/llms.txt", "utf8").includes(`${C.BOOKS_COUNT_WORD} well-known bitcoin books`) && og.includes(`${C.BOOKS_COUNT_WORD} well-known bitcoin books`));
check("every book has author and year", C.BOOKS.every((b) => b.author.length > 3 && b.year >= 2008 && b.year <= 2026));
check("no retailer or affiliate book links", C.BOOKS.every((b) => !/amazon\.|amzn\.|bookshop\.org|barnesandnoble|audible|[?&](tag|ref|aff)=/i.test(b.href)));
check("every book link is https", C.BOOKS.every((b) => b.href.startsWith("https://")));
check("Mastering Bitcoin links the free official GitHub copy", C.BOOKS.some((b) => b.title.startsWith("Mastering Bitcoin") && b.href === "https://github.com/bitcoinbook/bitcoinbook"));
check("no referral/affiliate params anywhere", !/[?&](ref|referral|aff|affiliate|invite|code|tag|utm_[a-z]+)=/i.test(all));

console.log("── structured data ──────────────────────────────");
check("Article + HowTo + FAQPage + ItemList", ["Article", "HowTo", "FAQPage", "ItemList"].every((t) => page.includes(`"@type": "${t}"`)));
check("HowTo steps built from BUY_STEPS", /step: BUY_STEPS\.map/.test(page));
check("FAQPage built from BUY_FAQ (same strings as visible)", /mainEntity: BUY_FAQ\.map/.test(page) && /BUY_FAQ\.map\(\(f\) => \(\s*<div/.test(page));
check("book ItemList built from BOOKS", /itemListElement: BOOKS\.map/.test(page));
check("BreadcrumbList via buildBreadcrumb", /buildBreadcrumb\(\[/.test(page));
check("visible Last updated uses the same date as dateModified", /dateModified: BUY_GUIDE_UPDATED/.test(page) && /dateTime=\{BUY_GUIDE_UPDATED\}/.test(page) && /^\d{4}-\d{2}-\d{2}$/.test(C.BUY_GUIDE_UPDATED));
check("short answer opens with a direct, quotable answer", /^To buy bitcoin safely, /.test(C.BUY_GUIDE_SHORT));
check("meta title leads with the query and fits a SERP line", /^How to Buy Bitcoin/.test(C.BUY_GUIDE_META_TITLE) && C.BUY_GUIDE_META_TITLE.length <= 70);
check("meta description is 120 to 160 characters", C.BUY_GUIDE_DESCRIPTION.length >= 120 && C.BUY_GUIDE_DESCRIPTION.length <= 160, String(C.BUY_GUIDE_DESCRIPTION.length));
check("FAQ answers the best-books question", C.BUY_FAQ.some((f) => /best bitcoin books/i.test(f.q)));
check("one H1 on the page", (page.match(/<h1\b/g) ?? []).length === 1);
check("canonical is its own URL", C.BUY_GUIDE_URL === "https://galaxymind.space/how-to-buy-bitcoin" && /canonical: URL/.test(page));
check("OG card has descriptive alt", /export const alt = BUY_GUIDE_OG_ALT/.test(og) && C.BUY_GUIDE_OG_ALT.length > 40);
check("og image wired through pageOgImage", /pageOgImage\("\/how-to-buy-bitcoin\/opengraph-image", BUY_GUIDE_OG_ALT\)/.test(page));

console.log("── cross-links + discoverability ────────────────");
for (const href of ["/should-i-buy-bitcoin", "/is-it-too-late-to-buy-bitcoin", "/how-to-pay-with-lightning", "/spend-and-replace", "/hashrate"]) {
  check(`links ${href}`, all.includes(`"${href}"`));
}
check("links the merchant guide /how-to-accept-bitcoin from Keep reading", /href: "\/how-to-accept-bitcoin", tag:/.test(page));
check("links the spend-by-category hub", page.includes('href="/spend-bitcoin-on"'));
check("links the vendor directory (/)", /href: "\/", tag: "⌂ Vendor directory"/.test(page));
check("sitemap lists the guide", readFileSync("src/app/sitemap.ts", "utf8").includes('"https://galaxymind.space/how-to-buy-bitcoin"'));
check("llms.txt lists the guide", readFileSync("public/llms.txt", "utf8").includes("https://galaxymind.space/how-to-buy-bitcoin"));
check("Learn nav lists the guide", /href: "\/how-to-buy-bitcoin"/.test(readFileSync("src/lib/nav.ts", "utf8")));
check("footer lists the guide", readFileSync("src/components/SiteFooter.tsx", "utf8").includes('"/how-to-buy-bitcoin"'));
check("no-JS indexability list includes the guide", readFileSync("scripts/test-nojs-indexability.ts", "utf8").includes('"/how-to-buy-bitcoin"'));

console.log(`\n${fail ? "✗" : "✓"} ${pass} passed · ${fail} failed`);
if (fail) process.exit(1);
