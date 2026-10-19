// Every "Rent now" on /hashrate goes to the browser checkout (/hashrate/rent) in
// the SAME tab, and every "Rent with your AI bot" goes to /hashrate/agents.
// Until 2026-10-16 the roster buttons linked to /hashrate#rent-with-ai with
// target=_blank, so each click opened /hashrate again in a new tab (operator: "stuck
// in a loop"). Renders the real components and checks the anchors, then sweeps
// the /hashrate sources so a new rent link can't bring the loop back.
import React from "react";
import { renderToString } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { HashrateDesk, DeskRig } from "../src/lib/hashrate";
import { GALAXY_MIND_RIG_IDS } from "../src/lib/hashrate";
import { RentBuilder } from "../src/app/hashrate/components/RentBuilder";
import { StickyRentBar } from "../src/app/hashrate/components/StickyRentBar";
import { RentWithAiBot, HERO_RENT_HREF } from "../src/app/hashrate/components/RentWithAiBot";
import { BROWSER_RENT_PATH } from "../src/app/hashrate/components/RentWithAiBot";
import { sellerProofUrl, checkoutHref, rentUrlFor, OWN_RENT_URL, CHECKOUT_PATH, AGENTS_PATH } from "../src/lib/mrr";
import { HERO_CTA_LABEL, ODDS_RENT_CTA, ODDS_RENT_FIRST, STICKY_CTA, PACK_QUEUE_OPEN, SELLER_LINK_LABEL, RENT_CTA } from "../src/lib/hashrate-copy";
import { TEASER_CTA } from "../src/lib/agent-connect-copy";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };
const ROOT = join(__dirname, "..");

const ids = GALAXY_MIND_RIG_IDS.slice(0, 4);
const rig = (id: string, i: number): DeskRig => ({
  id, name: `GalaxyMind S21 XP USA #${25 + i}`, owner: "GalaxyMind", region: "us-south",
  status: i === 0 ? "rented" : "available", hoursLeft: i === 0 ? 5 : null, online: true,
  advertisedPh: 0.27, measuredPh: 0.28, askBtcPerPhDay: 0.00052, minHours: 3, maxHours: 168, rpi: "new",
  rentUrl: rentUrlFor(id), recovery: null, isOurs: true,
});
const desk = {
  asOf: "2026-10-16T11:00:00.000Z", hashprice: 0.00047, networkPhs: 1_000_000, btcUsd: 82_000, blockRewardBtc: 3.16,
  book: { floor: 0.0004, medianAsk: 0.0005, clearedLast30: null, clearedLast10: null, suggested: 0.00049 },
  bookSample: { collected: 10, availableRigs: 20, complete: false },
  ourRigs: ids.map(rig), regionBook: ids.map(rig), region: "us-south", stats: null, degraded: [],
} as unknown as HashrateDesk;

type A = { href: string; target: string | null; text: string };
const anchors = (html: string): A[] =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: (m[1].match(/\bhref="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&"),
    target: m[1].match(/\btarget="([^"]*)"/)?.[1] ?? null,
    text: m[2].replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim(),
  }));
const RENT_LABELS = [...new Set([RENT_CTA, HERO_CTA_LABEL, ODDS_RENT_CTA, ODDS_RENT_FIRST, STICKY_CTA, PACK_QUEUE_OPEN])];
const isRent = (a: A) => RENT_LABELS.some((l) => a.text.startsWith(l));
const isBot = (a: A) => a.text.startsWith(SELLER_LINK_LABEL) || a.text.startsWith(TEASER_CTA);
// Back to /hashrate itself (with or without a hash, relative or absolute) is the loop.
const loops = (href: string) => /^(https:\/\/galaxymind\.space)?\/hashrate\/?(#.*)?$/.test(href) || href.startsWith("#rent-with-ai");

console.log("── helpers ──────────────────────────────────────");
assert("checkout path", CHECKOUT_PATH === "/hashrate/rent" && BROWSER_RENT_PATH === CHECKOUT_PATH);
assert("JSON-LD / rig rentUrl is the checkout, not /hashrate#…", OWN_RENT_URL === "https://galaxymind.space/hashrate/rent" && rentUrlFor("x", 12) === OWN_RENT_URL);
assert("checkoutHref preselects rigs and whole days", checkoutHref(2, 30) === "/hashrate/rent?rigs=2&days=2" && checkoutHref(1, 3) === "/hashrate/rent?rigs=1&days=1");
assert("checkoutHref drops junk", checkoutHref(NaN, -1) === "/hashrate/rent" && checkoutHref() === "/hashrate/rent");
assert("Rent with your AI bot → /hashrate/agents", sellerProofUrl([]).href === AGENTS_PATH && AGENTS_PATH === "/hashrate/agents");

console.log("── rendered anchors ─────────────────────────────");
void desk;
const html = [
  renderToString(<RentBuilder perRigDayUsdc="12.34" maxRigs={4} maxDays={7} rigTh={270} networkPhs={1_000_000} title="t" oddsTitle="o" oddsNote="n" cta={RENT_CTA} />),
  renderToString(<StickyRentBar price="$12.34" unit="per rig per day" cta={RENT_CTA} href={HERO_RENT_HREF} watchId="rent-hero" />),
  renderToString(<RentWithAiBot quiet />),
].join("\n");
const all = anchors(html);
const rent = all.filter(isRent), bot = all.filter(isBot);
assert("found the builder and sticky Rent now buttons", rent.length >= 2, String(rent.length));
assert("hero href pre-fills 1 rig × 1 day on the checkout", HERO_RENT_HREF === "/hashrate/rent?rigs=1&days=1");
for (const a of rent) {
  assert(`"${a.text}" → ${a.href} is the checkout`, a.href.startsWith(CHECKOUT_PATH) && !loops(a.href));
  assert(`"${a.text}" opens in the same tab`, a.target === null, String(a.target));
}
assert("found Rent with your AI bot links", bot.length >= 1, String(bot.length));
for (const a of bot) assert(`"${a.text}" → ${a.href}, same tab`, a.href.startsWith(AGENTS_PATH) && a.target === null);
assert("no anchor on these sections loops back to /hashrate", all.every((a) => !loops(a.href)), all.filter((a) => loops(a.href)).map((a) => a.href).join(","));

console.log("── source sweep ─────────────────────────────────");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
const files = walk(join(ROOT, "src/app/hashrate")).filter((f) => !f.includes("/rent/") && !f.includes("/agents/"));
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const rel = f.slice(ROOT.length + 1);
  // Every JSX link element, from its tag to the end of its children.
  for (const m of src.matchAll(/<(a|TrackedLink|Link)\b[\s\S]*?<\/\1>/g)) {
    const el = m[0];
    const rentLink = /checkoutHref\(|rentUrlFor\(|packHref|rentHref|heroHref|BROWSER_RENT_PATH|\{href\}/.test(el) && /RENT_CTA|rentCta|HERO_CTA_LABEL|STICKY_CTA|PACK_QUEUE_OPEN|ODDS_RENT/.test(el);
    if (rentLink) assert(`${rel}: Rent link has no target=_blank`, !/target=/.test(el), el.slice(0, 120));
    if (/SELLER_LINK_LABEL|sellerLabel/.test(el)) assert(`${rel}: AI bot link has no target=_blank`, !/target=/.test(el), el.slice(0, 120));
  }
  assert(`${rel}: no rent-with-ai self link`, !/href=["{][^"}]*hashrate#rent-with-ai/.test(src));
}
const content = readFileSync(join(ROOT, "src/app/hashrate/HashrateContent.tsx"), "utf8");
assert("hero Rent now → /hashrate/rent whenever direct rentals are open", /const heroHref = open \? HERO_RENT_HREF : "#waitlist";/.test(content));
assert("paused state renders instead of a broken hero", content.includes("data-rentals-paused") && content.includes("PAUSED_TITLE"));
assert("/hashrate no longer links upstream sellers", !/sellerProofUrl|SELLER_LINK_LABEL|PrizeConsole|BlockShot|FleetGauge/.test(content));
const page = readFileSync(join(ROOT, "src/app/hashrate/page.tsx"), "utf8");
// MRR-only (2026-10-17): the header goes to the on-page unit picker in mrr_only and to /hashrate/rent in direct mode.
assert("header Rent now → /hashrate/rent (direct) or #rent-hero (MRR-only)", /const rentHref = mrr \? "#rent-hero" : "\/hashrate\/rent";/.test(page));
const rentPage = readFileSync(join(ROOT, "src/app/hashrate/rent/page.tsx"), "utf8");
// Bounded to OpeningSoon itself: the MarketplaceRent card after it opens the external marketplace in a new tab by design.
const soonEnd = rentPage.indexOf("\nfunction ", rentPage.indexOf("function OpeningSoon") + 1);
const soon = rentPage.slice(rentPage.indexOf("function OpeningSoon"), soonEnd > 0 ? soonEnd : undefined);
assert("opening-soon card's primary action is Rent with your AI bot → /hashrate/agents", soon.indexOf('href="/hashrate/agents"') > 0 && soon.indexOf('href="/hashrate/agents"') < soon.indexOf("Rent with your AI bot") && !/hashrate#rent-with-ai/.test(soon));
assert("opening-soon card has no target=_blank", !/target=/.test(soon));

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
