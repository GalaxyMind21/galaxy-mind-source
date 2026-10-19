// "Also sold on" marketplace links on vendor cards (operator-approved 2026-10-18, Conduit (b) item 3). In-process, no network.
// The helper keeps only https links on each marketplace's own host (one per marketplace); the card renders them as small
// rel="nofollow noopener" outbound links and nothing for vendors without the field; the roster only carries verified,
// well-formed entries; no Nostr trust score ships.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { VENDORS, alsoSoldOnLinks, MARKETPLACES, type Vendor } from "../src/lib/vendors";
import { VendorCard } from "../src/components/VendorCard";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

console.log("── alsoSoldOnLinks() ────────────────────────────");
const C = "https://shop.conduit.market/npub196gnqcsauj9pk4z29s4jkj3wtw0s3tlyw0mh8g2ef6ksw80jhlaqzpfq54";
assert("keeps a conduit storefront", alsoSoldOnLinks({ alsoSoldOn: [{ marketplace: "conduit", url: C }] }).length === 1);
assert("label is 'Conduit'", alsoSoldOnLinks({ alsoSoldOn: [{ marketplace: "conduit", url: C }] })[0]?.label === "Conduit");
assert("drops http://", alsoSoldOnLinks({ alsoSoldOn: [{ marketplace: "conduit", url: C.replace("https:", "http:") }] }).length === 0);
assert("drops a host that is not the marketplace's", alsoSoldOnLinks({ alsoSoldOn: [{ marketplace: "conduit", url: "https://evil.example/npub1x" }] }).length === 0);
assert("drops a lookalike host", alsoSoldOnLinks({ alsoSoldOn: [{ marketplace: "conduit", url: "https://shop.conduit.market.evil.example/x" }] }).length === 0);
assert("drops javascript:", alsoSoldOnLinks({ alsoSoldOn: [{ marketplace: "conduit", url: "javascript:alert(1)" }] }).length === 0);
assert("drops a mismatched marketplace", alsoSoldOnLinks({ alsoSoldOn: [{ marketplace: "shopstr", url: C }] }).length === 0);
assert("one link per marketplace", alsoSoldOnLinks({ alsoSoldOn: [{ marketplace: "conduit", url: C }, { marketplace: "conduit", url: C + "x" }] }).length === 1);
assert("none when the field is absent", alsoSoldOnLinks({}).length === 0);
assert("marketplaces are Conduit, Shopstr, Plebeian only", Object.keys(MARKETPLACES).sort().join(",") === "conduit,plebeian,shopstr");

console.log("── VendorCard ───────────────────────────────────");
const base = VENDORS.find((v) => !v.alsoSoldOn)!;
const withLink: Vendor = { ...base, alsoSoldOn: [{ marketplace: "conduit", url: C }] };
for (const [mode, props] of [["static", {}], ["interactive", { onOpenDetail: () => {} }]] as const) {
  const html = renderToStaticMarkup(<VendorCard vendor={withLink} index={0} {...props} />);
  const a = html.match(/<a[^>]*data-also-sold-on="conduit"[^>]*>/)?.[0] ?? "";
  assert(`${mode}: renders an 'Also sold on' line`, html.includes("Also sold on") && html.includes('class="vendor-also"'));
  assert(`${mode}: link goes to the storefront`, a.includes(`href="${C}"`));
  assert(`${mode}: rel="nofollow noopener"`, a.includes('rel="nofollow noopener"'));
  assert(`${mode}: opens in a new tab`, a.includes('target="_blank"'));
  assert(`${mode}: visible label is the marketplace name`, /data-also-sold-on="conduit"[^>]*>Conduit<\/a>/.test(html));
}
const plain = renderToStaticMarkup(<VendorCard vendor={base} index={0} onOpenDetail={() => {}} />);
assert("vendor without the field: no 'Also sold on' line, no outbound link", !plain.includes("Also sold on") && !/href="https?:/.test(plain));
const src = readFileSync("src/components/VendorCard.tsx", "utf8");
assert("card click handler ignores taps on the links", src.includes('closest(".vendor-save, .vendor-also")'));
assert("no Nostr trust score on the card", !/trust\s*score|brainstorm|web[- ]of[- ]trust/i.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")));

console.log("── roster ───────────────────────────────────────");
const listed = VENDORS.filter((v) => v.alsoSoldOn?.length);
assert("at least one vendor carries a verified link", listed.length > 0, String(listed.length));
for (const v of listed) {
  assert(`${v.name}: every entry survives validation`, alsoSoldOnLinks(v).length === v.alsoSoldOn!.length);
  // When we also hold the shop's npub, the Conduit storefront must be that npub's.
  const npub = v.nostrPubkey ?? (v.handle.startsWith("npub1") ? v.handle : undefined);
  const conduit = v.alsoSoldOn!.find((e) => e.marketplace === "conduit");
  if (npub && conduit) assert(`${v.name}: Conduit storefront matches its npub`, conduit.url.endsWith("/" + npub));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
