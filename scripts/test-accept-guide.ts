// /how-to-accept-bitcoin setup walkthrough guardrails (2026-10-18).
// In-process, no network. Square claims must match Square's own pages (no
// unsourced seller count, 0% through 2026 then 1%), every source is a plain
// https link to the provider's own domain, and the walkthrough stays neutral:
// no affiliate or referral links, no "best app" claims, no hardware vendors.
import { readFileSync } from "node:fs";
import * as C from "../src/lib/accept-walkthrough-copy";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

const page = readFileSync("src/app/how-to-accept-bitcoin/page.tsx", "utf8");
const copy = [
  C.SQUARE_SUMMARY, C.WALKTHROUGH_NOTE, C.ACCEPT_META_TITLE, C.ACCEPT_SOCIAL_TITLE, C.ACCEPT_DESCRIPTION,
  ...C.WALKTHROUGH_PATHS.flatMap((p) => [p.eyebrow, p.title, p.fit, p.tradeoff, ...p.blocks.flatMap((b) => [b.heading, ...b.items]), ...p.sources.map((s) => `${s.label} ${s.href}`)]),
].join("\n");
const all = `${copy}\n${page}`;

console.log("── Square fact-check ────────────────────────────");
check("no unsourced Square seller count anywhere on the page", !/800,000|800k|~800/i.test(all));
check("fee claim is 0% through Dec 31 2026, then 1%", /0% processing fee through December 31, 2026/.test(C.SQUARE_SUMMARY) && /1% after/.test(C.SQUARE_SUMMARY));
check("no stale 'zero fees through 2026' wording", !/zero fees through 2026/i.test(all));
check("dollars by default is stated", /in dollars unless you choose bitcoin/.test(C.SQUARE_SUMMARY));
const sq = C.WALKTHROUGH_PATHS.find((p) => p.id === "setup-square")!;
const sqText = sq.blocks.flatMap((b) => b.items).join(" ");
check("Square path covers setting location, customer view, settlement, fees", ["Where the setting lives", "What the customer sees", "How you get paid", "Fees"].every((h) => sq.blocks.some((b) => b.heading === h)));
check("Square path names the Dashboard and POS settings paths", /Banking, then Bitcoin/.test(sqText) && /Settings, then Checkout, then Payment/.test(sqText));
check("Square path states the per-payment and daily limits", /\$600/.test(sqText) && /\$20,000/.test(sqText));
check("Square path cites the Square help article", sq.sources.some((s) => s.href === C.SQUARE_HELP));

console.log("── paths + sources ──────────────────────────────");
check("three paths: Square, Lightning address, BTCPay", C.WALKTHROUGH_PATHS.map((p) => p.id).join() === "setup-square,setup-lightning-address,setup-btcpay");
check("every path has at least one source", C.WALKTHROUGH_PATHS.every((p) => p.sources.length > 0));
const OWN = /^https:\/\/(squareup\.com|lightningaddress\.com|docs\.btcpayserver\.org)\//;
check("every source is https on the provider's own domain", C.WALKTHROUGH_SOURCES.every((s) => OWN.test(s.href)), C.WALKTHROUGH_SOURCES.filter((s) => !OWN.test(s.href)).map((s) => s.href).join(" "));
check("BTCPay path cites BTCPay docs", C.WALKTHROUGH_PATHS[2].sources.every((s) => s.href.startsWith("https://docs.btcpayserver.org/")));
check("Lightning address path tells readers to check availability and fees", /where they are available/.test(copy) && /fees in the app/.test(copy));
check("neutral: says we recommend none and earn nothing", /do not recommend one over another/.test(C.WALKTHROUGH_NOTE) && /earn nothing/.test(C.WALKTHROUGH_NOTE));
check("no best/top/recommended provider claim", !/\b(best|top|our pick|recommended)\b[^.]{0,30}\b(app|wallet|provider)/i.test(copy));
check("no referral/affiliate params", !/[?&](ref|referral|aff|affiliate|invite|code|utm_[a-z]+)=/i.test(all));
check("no hardware-vendor names", !/coinkite|coldcard|start9/i.test(all));
check("no em/en-dash clause breaks", !/ [—–] /.test(copy));

console.log("── page wiring ──────────────────────────────────");
check("page renders WALKTHROUGH_PATHS", /WALKTHROUGH_PATHS\.map/.test(page));
check("FAQ markup and FAQPage JSON-LD still built from the same FAQ array", /mainEntity: FAQ\.map/.test(page) && /FAQ\.map\(\(f\) => \(/.test(page));
check("HowTo JSON-LD still built from STEPS", /step: STEPS\.map/.test(page));
check("Article cites the walkthrough sources", /citation: WALKTHROUGH_SOURCES\.map/.test(page));
check("FAQ answers where the Square setting is", /Where is the bitcoin setting in Square\?/.test(page));
check("external source links carry no target hijack", !/target="_blank"(?![^>]*noopener)/.test(page));

console.log("── SEO / AEO ────────────────────────────────────");
check("meta title targets accept bitcoin payments + small business", /^How to Accept Bitcoin Payments/.test(C.ACCEPT_META_TITLE) && /Small Business/.test(C.ACCEPT_META_TITLE) && C.ACCEPT_META_TITLE.length <= 70);
check("meta description names Lightning and is 120 to 160 characters", /Lightning/.test(C.ACCEPT_DESCRIPTION) && C.ACCEPT_DESCRIPTION.length >= 120 && C.ACCEPT_DESCRIPTION.length <= 160, String(C.ACCEPT_DESCRIPTION.length));
check("metadata wired from the copy module", /title: ACCEPT_META_TITLE/.test(page) && /description: ACCEPT_DESCRIPTION/.test(page) && /canonical: URL/.test(page));
check("BreadcrumbList via buildBreadcrumb", /buildBreadcrumb\(\[/.test(page));
check("BTCPay HowTo built from the walkthrough steps", /#setup-btcpay`/.test(page) && /btcpaySteps\.map/.test(page));
check("visible Last updated uses the same date as dateModified", /dateModified: ACCEPT_UPDATED/.test(page) && /dateTime=\{ACCEPT_UPDATED\}/.test(page));
check("short answer opens with a direct, quotable answer", /To accept bitcoin payments at a small business, turn it on/.test(page));
check("FAQ answers how to accept Lightning payments", /How do I accept Lightning payments\?/.test(page));
check("FAQ states the Square limits and New York exclusion", /\$600/.test(page) && /\$20,000 daily limit/.test(page) && /New York/.test(page));
check("links the buying guide and the spend hub", page.includes('href="/how-to-buy-bitcoin"') && page.includes('href="/spend-bitcoin-on"') && page.includes('href="/"'));
check("one H1 on the page", (page.match(/<h1\b/g) ?? []).length === 1);
check("frosted-glass short answer", /hero-glass my-8/.test(page));

console.log(`\n${fail ? "✗" : "✓"} ${pass} passed · ${fail} failed`);
if (fail) process.exit(1);
