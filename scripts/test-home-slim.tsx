// Home HTML slimming (Conduit (b) item 4, 2026-10-18). In-process, no network.
// 1. The directory JSON-LD is built by a client component, so it is in the SSR HTML once and not in the RSC payload,
//    and its @graph is unchanged: CollectionPage, ItemList over every vendor, Dataset, then the server's extra nodes.
// 2. The save heart is client-only, while every card still server-renders its /v link, name heading and description.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { VENDORS, vendorSlug } from "../src/lib/vendors";
import { buildHomeDirectoryLd } from "../src/lib/home-directory-ld";
import { HomeDirectoryLd } from "../src/components/HomeDirectoryLd";
import { VendorCard } from "../src/components/VendorCard";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

console.log("── directory JSON-LD ────────────────────────────");
const faq = { "@type": "FAQPage", "@id": "x#faq", mainEntity: [] };
const ld = buildHomeDirectoryLd([faq]) as { "@graph": Array<Record<string, unknown>> };
const g = ld["@graph"];
assert("@graph is CollectionPage, ItemList, Dataset, FAQPage", g.map((n) => n["@type"]).join(",") === "CollectionPage,ItemList,Dataset,FAQPage");
const list = g[1] as { numberOfItems: number; itemListElement: { url: string; name: string; position: number }[] };
assert("ItemList covers every vendor in order", list.numberOfItems === VENDORS.length && list.itemListElement.length === VENDORS.length &&
  list.itemListElement.every((e, i) => e.position === i + 1 && e.name === VENDORS[i].name && e.url === `https://galaxymind.space/v/${vendorSlug(VENDORS[i])}`));
assert("Dataset keeps its CC BY 4.0 license", (g[2] as { license?: string }).license === "https://creativecommons.org/licenses/by/4.0/");
const html = renderToStaticMarkup(<HomeDirectoryLd nonce="n0" extraNodes={[faq]} />);
const body = html.match(/<script type="application\/ld\+json" nonce="n0">([\s\S]*)<\/script>/)?.[1] ?? "";
let parsed: unknown = null; try { parsed = JSON.parse(body); } catch { /* fail below */ }
assert("client component renders one parseable ld+json script with the nonce", parsed !== null && JSON.stringify(parsed) === JSON.stringify(ld));
assert("HomeDirectoryLd is a client component", readFileSync("src/components/HomeDirectoryLd.tsx", "utf8").startsWith('"use client";'));
const page = readFileSync("src/app/page.tsx", "utf8");
assert("page.tsx no longer serializes the directory graph itself", !page.includes("DIRECTORY_LD") && !page.includes("itemListElement") && page.includes("<HomeDirectoryLd"));

console.log("── vendor cards ─────────────────────────────────");
let allOk = true;
for (const [i, v] of VENDORS.entries()) {
  const card = renderToStaticMarkup(<VendorCard vendor={v} index={i} onOpenDetail={() => {}} onToggleSave={() => {}} />);
  const ok = card.includes(`href="/v/${vendorSlug(v)}"`) && /<h3 class="vendor-name">/.test(card) &&
    card.includes(v.name.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")) && !card.includes("vendor-save");
  if (!ok) { allOk = false; console.error("    card check failed for " + v.name); }
}
assert("every card SSRs its /v link and name heading, without the save button", allOk);
assert("foot reserves the heart's height (no layout shift)", /\.vendor-foot\s*\{[^}]*min-height:\s*calc\(13px \+ 24px\)/.test(readFileSync("src/app/globals.css", "utf8")));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
