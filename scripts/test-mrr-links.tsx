// Outbound marketplace links (operator 2026-10-17). In-process, no network.
// 1. Every miningrigrentals.com URL in src/ and public/ carries our referral id (ref=2770797). The only exceptions are
//    named below with their reason: the server-side API base, the plain signup baseline that is only ever rendered
//    through withReferral(), and the per-unit /rigs/ prefix that unitHref() always completes with ?ref=2770797.
// 2. Our profile page (/u/GalaxyMind) is login-walled for signed-out visitors, so it must never reach customer-facing
//    output: not in any src/ or public/ string, the footer, the home tile, /hashrate (live, zero, stale), the rent and
//    guide pages, the 410 payloads, the MCP redirect, llms.txt or the OpenAPI document.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { XP_UNIT_IDS, unitHref, UNIT_HREF_RE, snapshotFrom, unitsView } from "../src/lib/mrr-units";
import type { MrrUnitState } from "../src/lib/mrr";
import { directRentalsClosedBody, marketplaceRedirect } from "../src/lib/rentals/mode";
import { closeTheSale } from "../src/lib/rentals";
import { HashrateFunnel } from "../src/app/hashrate/components/HashrateFunnel";
import { FUNNEL_COPY, funnelView } from "../src/app/hashrate/components/MrrHashrateContent";
import { HomeRentHero } from "../src/components/HomeRentHero";
import { MarketplaceListingCard } from "../src/app/hashrate/components/MarketplaceListingCard";
import { MARKETPLACE_REGISTER_URL, MARKETPLACE_FOOTER_LINK, MARKETPLACE_REFERRAL_NOTE } from "../src/lib/marketplace-listing";
import { RENT_PAGE_URL } from "../src/lib/rent-page";
import * as C from "../src/lib/mrr-page-copy";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

const REF = "ref=2770797";
const MRR_URL = /https?:\/\/(?:[\w-]+\.)*miningrigrentals\.com[^\s"'`)<>\\]*/gi;
const PROFILE = /\/u\/GalaxyMind\b|miningrigrentals\.com\/u\//i;
/** Exact (file, url) pairs allowed without the ref, each for a stated reason. */
const NO_REF_OK: Record<string, string> = {
  "src/lib/mrr.ts https://www.miningrigrentals.com/api/v2": "server-side API base, never a link",
  "src/lib/mrr.ts https://www.miningrigrentals.com/register": "plain baseline, only rendered via withReferral()",
  "src/lib/mrr-units.ts https://www.miningrigrentals.com/rigs/": "unit prefix, unitHref() always appends ?ref=2770797",
};

console.log("── every marketplace URL in src/ and public/ carries our ref ──");
const TEXT = /\.(tsx?|mjs|js|json|txt|md|html|xml|css)$/;
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const f = join(d, n); return statSync(f).isDirectory() ? walk(f) : [f]; });
const files = [...walk("src"), ...walk("public")].filter((f) => TEXT.test(f));
const missing: string[] = [];
const profileHits: string[] = [];
let seen = 0;
for (const f of files) {
  const body = readFileSync(f, "utf8");
  for (const m of body.matchAll(MRR_URL)) {
    seen++;
    const u = m[0];
    if (!u.includes(REF) && !NO_REF_OK[`${f} ${u}`]) missing.push(`${f}: ${u}`);
    if (PROFILE.test(u)) profileHits.push(`${f}: ${u}`);
  }
  // The profile path must not appear in any string literal either (comments may explain why it is banned).
  const strings = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
  if (/["'`][^"'`\n]*\/u\/GalaxyMind/.test(strings) || (f.startsWith("public/") && /\/u\/GalaxyMind/.test(body))) profileHits.push(`${f}: /u/GalaxyMind in a string`);
}
assert(`scanned ${files.length} files, found ${seen} marketplace URLs`, files.length > 100 && seen >= 3);
assert("every marketplace URL has ref=2770797 (or a named exception)", missing.length === 0, missing.join("; "));
assert("no /u/GalaxyMind profile URL in src/ or public/", profileHits.length === 0, profileHits.join("; "));
assert("the guard itself catches a missing ref", !"https://www.miningrigrentals.com/rigs/980438".includes(REF) && !NO_REF_OK["src/x.ts https://www.miningrigrentals.com/rigs/980438"]);
assert("every unit link carries our ref", XP_UNIT_IDS.every((id) => unitHref(id).endsWith("?ref=2770797") && UNIT_HREF_RE.test(unitHref(id))));
assert("signup link carries our ref", MARKETPLACE_REGISTER_URL.endsWith("?ref=2770797"));

console.log("── customer-facing output has no profile link ──");
const u = (id: string, o: Partial<MrrUnitState> = {}): MrrUnitState => ({ id, owner: "GalaxyMind", status: "available", rented: false, availableStatus: "available", online: true, measured15Th: 270, ...o });
const now = Date.now();
const funnel = (view: Parameters<typeof HashrateFunnel>[0]["view"]) => renderToStaticMarkup(
  <HashrateFunnel view={view} copy={FUNNEL_COPY} networkPhs={900_000} registerUrl={MARKETPLACE_REGISTER_URL} rel="noopener noreferrer" agentsHref="/hashrate/agents" initialUnits={2} />,
);
const liveHtml = funnel(funnelView(unitsView(snapshotFrom(XP_UNIT_IDS.slice(0, 3).map((id) => u(id)), now), now)));
const zeroHtml = funnel({ state: "live", at: now, free: [], freeCount: 0 });
const staleHtml = funnel({ state: "stale" });
const homeCopy = { kicker: C.HOME_RENT_KICKER, title: C.HOME_RENT_TITLE, sub: C.HOME_RENT_SUB, live: C.HOME_RENT_LIVE, none: C.HOME_RENT_NONE, cta: C.HOME_RENT_CTA };
const outputs: [string, string][] = [
  ["/hashrate live", liveHtml], ["/hashrate zero free", zeroHtml], ["/hashrate stale", staleHtml],
  ["home tile live", renderToStaticMarkup(<HomeRentHero view={{ state: "live", at: now, freeCount: 2 }} copy={homeCopy} />)],
  ["home tile zero", renderToStaticMarkup(<HomeRentHero view={{ state: "live", at: now, freeCount: 0 }} copy={homeCopy} />)],
  ["home tile stale", renderToStaticMarkup(<HomeRentHero view={{ state: "stale" }} copy={homeCopy} />)],
  ["listing card", renderToStaticMarkup(<MarketplaceListingCard />)],
  ["410 body", JSON.stringify(directRentalsClosedBody())],
  ["MCP redirect", JSON.stringify(marketplaceRedirect())],
  ["closeTheSale", JSON.stringify(closeTheSale({}))],
  ["llms.txt", readFileSync("public/llms.txt", "utf8")],
  ["openapi source", readFileSync("src/app/api/openapi.json/route.ts", "utf8")],
  ["rent page source", readFileSync("src/app/hashrate/rent/page.tsx", "utf8")],
  ["guide source", readFileSync("src/app/hashrate/components/MarketplaceGuide.tsx", "utf8")],
  ["footer source", readFileSync("src/components/SiteFooter.tsx", "utf8")],
];
for (const [name, out] of outputs) {
  assert(`${name}: no /u/GalaxyMind`, !/\/u\/GalaxyMind/.test(out) && !/MARKETPLACE_PROFILE_URL/.test(out));
  const bad = [...out.matchAll(MRR_URL)].map((m) => m[0]).filter((x) => !x.includes(REF));
  assert(`${name}: every marketplace link carries our ref`, bad.length === 0, bad.join(", "));
}
assert("410 / MCP / closeTheSale point at our /hashrate", RENT_PAGE_URL === "https://galaxymind.space/hashrate" && directRentalsClosedBody().rentUrl === RENT_PAGE_URL && marketplaceRedirect().closeTheSale.url === RENT_PAGE_URL && closeTheSale({}).url === RENT_PAGE_URL);
assert("/hashrate live: unit buttons are referral rig links and the disclosure sits next to them", [...liveHtml.matchAll(/href="([^"]*\/rigs\/[^"]*)"/g)].every((m) => UNIT_HREF_RE.test(m[1])) && liveHtml.includes(MARKETPLACE_REFERRAL_NOTE));
for (const [n, h] of [["zero", zeroHtml], ["stale", staleHtml]] as const) {
  assert(`/hashrate ${n}: "All rented right now. Check back soon." with a disabled CTA`, h.includes("All rented right now. Check back soon.") && /<button[^>]*disabled/.test(h) && !/<a[^>]*data-primary-cta/.test(h));
}
const footer = readFileSync("src/components/SiteFooter.tsx", "utf8");
assert("footer: internal 'Rent hashrate' link to /hashrate, no referral label", MARKETPLACE_FOOTER_LINK === "Rent hashrate" && /href=\{RENT_PAGE_PATH\}/.test(footer) && !/\(referral link\)/.test(MARKETPLACE_FOOTER_LINK));
const llms = readFileSync("public/llms.txt", "utf8");
assert("llms.txt sends renters to https://galaxymind.space/hashrate", llms.includes("https://galaxymind.space/hashrate"));

console.log(`\n${fail ? "✗" : "✓"} ${pass} passed · ${fail} failed`);
if (fail) process.exit(1);
