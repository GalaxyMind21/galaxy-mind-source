#!/usr/bin/env tsx
/** Directory UX + spend-job split. Offline source assertions. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATEGORY_LABELS,
  HOUSE_HANDLE,
  oldestVerifiedAt,
  VENDORS,
  vendorSlug,
  vendorWebsite,
  type VendorCategory,
} from "../src/lib/vendors";
import {
  geoShipHint,
  parseVisitorCountry,
  visitorCountryLabel,
} from "../src/lib/geo-hint";
import { countMatching, type DirectoryFilters } from "../src/lib/vendor-filter";

const ROOT = process.cwd();
let failures = 0;
function check(desc: string, ok: boolean, detail?: string) {
  if (ok) console.log("  PASS  " + desc);
  else {
    failures++;
    console.error("  FAIL  " + desc + (detail ? " · " + detail : ""));
  }
}
/**
 * Blank out comments so authoring notes never reach the assertions.
 * Same rule check-site-voice.ts encodes, and for the same reason: this
 * file's negative checks ban a phrase, and a header comment explaining
 * what a page is NOT reads identically to the thing being banned.
 * buy-coffee-with-bitcoin/page.tsx line 1 says "not a street-cafe
 * finder", which failed the very check it was describing. Copied rather
 * than imported: check-site-voice.ts calls main() at module scope, so
 * importing it would run the gate.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    const c2 = source.slice(i, i + 2);
    if (quote) {
      if (c === "\\") { out += source.slice(i, i + 2); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c2 === "//") { while (i < source.length && source[i] !== "\n") { out += " "; i++; } continue; }
    if (c2 === "/*") {
      while (i < source.length && source.slice(i, i + 2) !== "*/") { out += source[i] === "\n" ? "\n" : " "; i++; }
      out += "  "; i += 2; continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}
function src(rel: string) {
  return stripComments(readFileSync(join(ROOT, rel), "utf8"));
}

console.log("\nDirectory UX + spend-job split\n");

{
  const idxPath = "src/app/spend-bitcoin-on/page.tsx";
  check("category index page exists (route 200, not 404)", existsSync(join(ROOT, idxPath)));
  const idx = existsSync(join(ROOT, idxPath)) ? src(idxPath) : "";
  check("category index is a default-export page", /export default function/.test(idx));
  check(
    "category index canonical is /spend-bitcoin-on",
    idx.includes("canonical: URL_") &&
      idx.includes("https://galaxymind.space/spend-bitcoin-on"),
  );
  const sm = src("src/app/sitemap.ts");
  check(
    "sitemap lists the exact category-index URL",
    sm.includes('url: "https://galaxymind.space/spend-bitcoin-on"'),
  );
  const liveCats = (Object.keys(CATEGORY_LABELS) as VendorCategory[]).filter(
    (c) => VENDORS.some((v) => v.category === c),
  );
  check("index copy walks non-empty CATEGORY_LABELS", idx.includes("CATEGORY_LABELS") && liveCats.length > 0);
  check(
    "consumables card captures the coffee page",
    idx.includes("/buy-coffee-with-bitcoin") && idx.includes("consumables"),
  );
  check(
    "category index ships FAQPage JSON-LD",
    idx.includes("FAQPage") && idx.includes("Questions people ask"),
  );
  check(
    "category index FAQ uses live HUB_RENT path",
    idx.includes("HUB_RENT_Q") && idx.includes("HUB_RENT_A"),
  );
  check(
    "category index mounts quiet VendorHashrateModule",
    idx.includes("VendorHashrateModule"),
  );
  const descMatch = idx.match(
    /const DESCRIPTION = `([^`]+)`;/,
  );
  const desc = descMatch?.[1] ?? "";
  check(
    "category index meta description is >= 140 chars",
    desc.length >= 140,
    `len=${desc.length}`,
  );
  check(
    "category index meta description keeps independent / live / not-street voice",
    /independent online stores/i.test(desc) &&
      /live counts/i.test(desc) &&
      /street map/i.test(desc),
  );
}

{
  const cat = src("src/app/spend-bitcoin-on/[category]/page.tsx");
  check(
    "category hubs mount quiet VendorHashrateModule",
    cat.includes("VendorHashrateModule"),
  );
  check(
    "category hubs keep FAQPage JSON-LD from HUB_PROSE",
    cat.includes("HUB_PROSE") && cat.includes("FAQPage"),
  );
}

{
  const online = src("src/app/online-stores-that-accept-bitcoin/page.tsx");
  check(
    "online-stores money page mounts quiet VendorHashrateModule",
    online.includes("VendorHashrateModule"),
  );
}

{
  const country = src("src/app/spend-bitcoin-in/[country]/page.tsx");
  check(
    "country hubs mount quiet VendorHashrateModule",
    country.includes("VendorHashrateModule"),
  );
}

{
  const latam = src("src/app/spend-bitcoin-in-latin-america/page.tsx");
  check(
    "LATAM research page mounts quiet VendorHashrateModule",
    latam.includes("VendorHashrateModule"),
  );
}

{
  const mapPage = src("src/app/map/page.tsx");
  check(
    "map atlas mounts quiet VendorHashrateModule",
    mapPage.includes("VendorHashrateModule"),
  );
}

{
  const vpage = src("src/app/v/[slug]/page.tsx");
  const outbound = src("src/components/VendorOutbound.tsx");
  check("vendor page mounts VendorOutbound for Visit shop", vpage.includes("VendorOutbound") && vpage.includes("Visit shop"));
  check(
    "Visit shop is gated on shopHref / website",
    /shopHref && isSafeHttpsHref\(shopHref\)/.test(vpage) && vpage.includes("vendorWebsite(vendor)"),
  );
  check(
    "VendorOutbound tracks vendor_outbound with dest defaulting to website",
    outbound.includes('track("vendor_outbound", { slug, dest') &&
      outbound.includes('dest = "website"'),
  );
  {
    const modalSrc = readFileSync("src/components/VendorDetailModal.tsx", "utf8");
    check(
      "vendor popup shows the shop shelf as a tracked outbound (dest shelf, surface vendor_modal)",
      modalSrc.includes("vendorShelf(vendor)") &&
        modalSrc.includes('dest="shelf"') &&
        modalSrc.includes('surface="vendor_modal"') &&
        modalSrc.includes("hasShop && shelf &&"),
    );
  }
  check(
    "vendor page shows the shop shelf as a tracked way into the shop",
    vpage.includes("vendorShelf(vendor)") &&
      vpage.includes('dest="shelf"') &&
      /hasShop && shelf &&/.test(vpage),
  );
  check(
    "vendor page profile CTAs are tracked like the homepage modal",
    (vpage.match(/event="vendor_click"/g) ?? []).length === 2 &&
      vpage.includes('surface: "vendor_page"'),
  );
  check(
    "third-party Visit shop is noopener noreferrer + new tab",
    outbound.includes("noopener noreferrer") && outbound.includes("_blank"),
  );
  check(
    "house shop galaxymind.space/hashrate stays in-tab",
    outbound.includes("https://galaxymind.space") &&
      outbound.includes("/hashrate") &&
      outbound.includes("sameOrigin"),
  );
  check("some listed shops have a website", VENDORS.some((v) => vendorWebsite(v)));
  check("some listed shops have no website (Visit shop skipped)", VENDORS.some((v) => !vendorWebsite(v)));
  const house = VENDORS.find((v) => v.handle === HOUSE_HANDLE);
  check(
    "house listing website is the in-tab /hashrate shop",
    !!house && vendorWebsite(house) === "https://galaxymind.space/hashrate",
  );
  // The house shelf (directory tile, /v banner, popup banner) is a
  // committed service still. The shelf script must never re-snapshot it
  // from /hashrate, whose share card carries the live block figure.
  const shelfManifest = JSON.parse(
    readFileSync(join(ROOT, "src/lib/shelf-manifest.json"), "utf8"),
  ) as Record<string, { src: string }>;
  const houseShelf = house ? shelfManifest[vendorSlug(house)] : undefined;
  check(
    "house listing has a committed shelf still",
    !!houseShelf && existsSync(join(ROOT, "public", houseShelf.src)),
  );
  check(
    "shelf snapshot script skips the house listing",
    /v\.handle !== HOUSE_HANDLE/.test(src("scripts/snapshot-vendor-shelves.ts")),
  );
}

{
  const vpage = src("src/app/v/[slug]/page.tsx");
  check("quiet hashrate module sits on /v/[slug]", vpage.includes("VendorHashrateModule"));
  const modal = src("src/components/VendorDetailModal.tsx");
  check(
    "vendor modal mounts quiet VendorHashrateModule (plain-click path)",
    modal.includes("VendorHashrateModule"),
  );
  check(
    "vendor modal mounts VendorOutbound for Visit shop (plain-click path)",
    modal.includes("VendorOutbound") && modal.includes("Visit shop"),
  );
  check(
    "vendor modal Visit shop is primary when website exists",
    modal.includes("hasShop") &&
      /shopHref && isSafeHttpsHref\(shopHref\)/.test(modal) &&
      modal.includes("VendorOutbound"),
  );
  check(
    "vendor modal skips hashrate module on the house listing",
    modal.includes("HOUSE_HANDLE") &&
      modal.includes("vendor.handle !== HOUSE_HANDLE"),
  );
  check(
    "hashrate module is skipped on the house listing",
    vpage.includes("HOUSE_HANDLE") && /vendor\.handle !== HOUSE_HANDLE/.test(vpage),
  );
  const home = existsSync(join(ROOT, "src/app/HomeClient.tsx"))
    ? src("src/app/HomeClient.tsx")
    : "";
  check("quiet hashrate module is NOT on the homepage", !home.includes("VendorHashrateModule"));
  check(
    "homepage More strip leads with gated /hashrate card",
    home.includes('href: "/hashrate"') &&
      home.includes("HOME_CARD_HOOK") &&
      home.includes("XSELL_OUT_HASHRATE_TITLE") &&
      !/href:\s*"\/map"/.test(home.split("<CrossPageCTA").pop() ?? ""),
  );
  const mod = src("src/components/VendorHashrateModule.tsx");
  check(
    "hashrate module reads /api/hashrate + summarizeOpenFleet",
    mod.includes("/api/hashrate") && mod.includes("summarizeOpenFleet"),
  );
  check("hashrate module does not invent a TH figure", !/\b\d{2,}\s*TH\b/.test(mod) && mod.includes("openTh"));
}

{
  const mapPage = src("src/app/map/page.tsx");
  check(
    "/map FAQ mentions BTC Map",
    /BTC Map/.test(mapPage) &&
      (/Frequently asked/.test(mapPage) ||
        /Questions people ask/.test(mapPage) ||
        /FAQ/.test(mapPage)),
  );
  check(
    "/map title is off the btcmap.org collision",
    !/Bitcoin Merchants Map · every verified vendor on Earth/.test(mapPage),
  );
}

{
  const howMany = src("src/app/how-many-businesses-accept-bitcoin/page.tsx");
  check(
    "how-many count page mounts quiet VendorHashrateModule",
    howMany.includes("VendorHashrateModule"),
  );
}

{
  const stateOf = src("src/app/state-of-bitcoin-directories/page.tsx");
  check(
    "state-of directories page mounts quiet VendorHashrateModule",
    stateOf.includes("VendorHashrateModule"),
  );
}


{
  const nostr = src("src/app/nostr-vendors/page.tsx");
  check(
    "nostr-vendors page mounts quiet VendorHashrateModule",
    nostr.includes("VendorHashrateModule"),
  );
}

{
  const coffee = src("src/app/buy-coffee-with-bitcoin/page.tsx");
  check(
    "coffee FAQ splits cafe cup vs bags shipped",
    /BTC Map/.test(coffee) && /Blink/.test(coffee) && (/ship/i.test(coffee) || /beans/i.test(coffee)),
  );
  check("coffee H1 is beans/shipped, not a street-cafe finder", /beans/i.test(coffee) && !/cafe finder/i.test(coffee));
  check(
    "coffee money page mounts quiet VendorHashrateModule",
    coffee.includes("VendorHashrateModule"),
  );
}


{
  const spendReplace = src("src/app/spend-and-replace/page.tsx");
  check(
    "spend-and-replace page mounts quiet VendorHashrateModule",
    spendReplace.includes("VendorHashrateModule"),
  );
}



{
  const helpGrow = src("src/app/how-to-help-grow-bitcoin/page.tsx");
  check(
    "how-to-help-grow page mounts quiet VendorHashrateModule",
    helpGrow.includes("VendorHashrateModule"),
  );
}

{
  const accept = src("src/app/how-to-accept-bitcoin/page.tsx");
  check(
    "how-to-accept sends physical walk-in shops to BTC Map",
    /BTC Map/.test(accept) && /sell online/i.test(accept),
  );
  check("how-to-accept step 4 links /badge", accept.includes('href: "/badge"'));
  check("how-to-accept start-here grid includes /badge", accept.includes('href="/badge"'));
  check("how-to-accept does not sell paid plans", !/paid plan/i.test(accept));
  check(
    "how-to-accept page mounts quiet VendorHashrateModule",
    accept.includes("VendorHashrateModule"),
  );
}

{
  const shouldBuy = src("src/app/should-i-buy-bitcoin/page.tsx");
  check(
    "should-i-buy page mounts quiet VendorHashrateModule",
    shouldBuy.includes("VendorHashrateModule"),
  );
}

{
  const tooLate = src("src/app/is-it-too-late-to-buy-bitcoin/page.tsx");
  check(
    "is-it-too-late page mounts quiet VendorHashrateModule",
    tooLate.includes("VendorHashrateModule"),
  );
}

{
  const prose = src("src/lib/hub-prose.ts");
  check("hub-prose does not hardcode Three roasters", !/Three roasters/.test(prose));
  check("consumables coffee FAQ uses a live {COFFEE} count", /\{COFFEE\}/.test(prose));
}

{
  const pkg = JSON.parse(src("package.json"));
  check(
    "verify hooks test-directory-ux.ts",
    typeof pkg.scripts?.verify === "string" &&
      pkg.scripts.verify.includes("scripts/test-directory-ux.ts"),
  );
  const nav = src("src/lib/nav.ts");
  check(
    "Spend secondary includes Spend by category",
    nav.includes('href: "/spend-bitcoin-on"') && nav.includes("Spend by category"),
  );
  const header = src("src/components/SiteHeader.tsx");
  check(
    "SiteHeader localizes nav.spendByCategory",
    header.includes('"/spend-bitcoin-on": "nav.spendByCategory"'),
  );
  // SiteFooter is server-rendered on / via root layout — this is the
  // Ahrefs orphan fix: default HTML of / must contain the exact index
  // href, not only /spend-bitcoin-on/[category] chips.
  const footer = src("src/components/SiteFooter.tsx");
  check(
    "SiteFooter SSR links the category index (exact href=/spend-bitcoin-on)",
    footer.includes('href: "/spend-bitcoin-on"') &&
      footer.includes('t("nav.spendByCategory")'),
  );
  const home = src("src/app/HomeClient.tsx");
  check(
    "HomeClient chips row links the category index",
    home.includes('href="/spend-bitcoin-on"') &&
      home.includes('t("nav.spendByCategory")'),
  );
  const catPage = src("src/app/spend-bitcoin-on/[category]/page.tsx");
  check(
    "category hubs crumb to /spend-bitcoin-on",
    catPage.includes('href="/spend-bitcoin-on"') &&
      /Spend by category|All categories/.test(catPage),
  );
  const en = JSON.parse(src("src/messages/en.json"));
  const es = JSON.parse(src("src/messages/es.json"));
  check("en+es share nav.spendByCategory", "nav.spendByCategory" in en && "nav.spendByCategory" in es);
  // THE HERO BLOCK IS READ AS ONE THING, so it is checked as one thing.
  // This used to pin every claim to home.heroStrong alone, which forced
  // the lede to carry all of them and produced visible repetition: on
  // 2026-09-06 "independent online stores" and "not a street map" each
  // appeared TWICE on one screen, once in the lede and again in the
  // method line directly beneath it. Scope widened to the two adjacent
  // lines a visitor actually reads together, and the assertions made
  // STRICTER rather than looser, because the reason they exist is that
  // bitcoin.org describes us to its own readers as:
  //
  //   "For independent stores that accept Bitcoin directly, Galaxy Mind
  //    maintains a directory of manually verified stores and shows when
  //    each listing was last confirmed."
  //
  // Every clause of that sentence is now a separate check, so the
  // homepage cannot drift away from the description that earns the
  // listing.
  const hero = `${en["home.heroStrong"]} ${en["home.method"]}`;
  check(
    "hero names independent online shops",
    /independent online/i.test(hero),
  );
  check(
    "hero distinguishes us from a walk-in map",
    /not a walk-in( street)? map/i.test(hero),
  );
  check(
    "hero says the shop takes bitcoin DIRECTLY (bitcoin.org's wording)",
    /bitcoin directly|directly at checkout/i.test(hero),
  );
  check(
    "hero claims a HUMAN confirmation, not an automated one",
    /confirmed by a person|a person confirm/i.test(hero),
  );
  check(
    "hero surfaces when the listing was last confirmed",
    /\{date\}/.test(en["home.method"]),
  );
  check(
    "hero date is the oldest confirmation, not the newest shop",
    /oldest/i.test(en["home.method"]) && /antigua/i.test(es["home.method"]),
  );
  const homeClient = src("src/app/HomeClient.tsx");
  check(
    "homepage prints oldestVerifiedAt",
    homeClient.includes("oldestVerifiedAt("),
  );
  check(
    "oldestVerifiedAt is the roster minimum",
    oldestVerifiedAt(VENDORS) ===
      Math.min(...VENDORS.map((v) => v.verifiedAt)),
  );
  check("oldestVerifiedAt of an empty roster is 0", oldestVerifiedAt([]) === 0);
  check(
    "hero tells a newcomer how to actually pay",
    /lightning/i.test(hero) && /(qr|scan|wallet)/i.test(hero),
  );
}

{
  console.log("\n  geo hint (Shopping from {country}?)");
  const base: DirectoryFilters = {
    search: "",
    categories: [],
    country: "all",
    shipsIntl: false,
    savedOnly: false,
    saved: new Set(),
  };
  check("edge header: lowercase code is normalised", parseVisitorCountry(" gb ") === "GB");
  check("edge header: junk is rejected", parseVisitorCountry("T1") === null && parseVisitorCountry("<x>") === null && parseVisitorCountry(null) === null);
  check("label: roster country uses roster label", visitorCountryLabel("GB") === "United Kingdom");
  check("label: non-roster country gets a real name", visitorCountryLabel("IN") === "India");
  check("label: unknown region is dropped", visitorCountryLabel("ZZ") === null && visitorCountryLabel("XX") === null);
  check("US visitors get no hint", geoShipHint("US", "United States", VENDORS, base) === null);
  check("no country, no hint", geoShipHint(null, null, VENDORS, base) === null);
  const inHint = geoShipHint("IN", "India", VENDORS, base);
  check(
    "a visitor from a country with no shops still sees ships-worldwide",
    inHint !== null && inHint.local === 0 && inHint.worldwide > 0,
  );
  check(
    "worldwide count equals what the Ships int'l filter yields",
    inHint?.worldwide === countMatching(VENDORS, { ...base, shipsIntl: true }),
  );
  const gbHint = geoShipHint("GB", "United Kingdom", VENDORS, base);
  check(
    "local count equals what the country filter yields",
    gbHint !== null &&
      gbHint.local === countMatching(VENDORS, { ...base, country: "GB" }) &&
      gbHint.local > 0,
  );
  check(
    "hint hides once the visitor picked a country or Ships int'l",
    geoShipHint("GB", "United Kingdom", VENDORS, { ...base, country: "GB" }) === null &&
      geoShipHint("GB", "United Kingdom", VENDORS, { ...base, shipsIntl: true }) === null,
  );
  const home = src("src/app/page.tsx");
  check(
    "homepage server reads the edge country header",
    home.includes('"x-vercel-ip-country"') && home.includes("visitorCountry={visitorCountry}"),
  );
  const client = src("src/app/HomeClient.tsx");
  check(
    "hint is tracked and dismissible",
    client.includes('"directory_geo_hint_shown"') &&
      client.includes('"directory_geo_hint_dismissed"') &&
      client.includes("GEO_HINT_DISMISSED_KEY"),
  );
  check(
    "privacy page discloses the country read",
    /country our host derives from\s+your IP/.test(src("src/app/privacy/page.tsx")),
  );
}

if (failures > 0) {
  console.error("\n" + failures + " failure(s)\n");
  process.exit(1);
}
console.log("\nAll directory UX checks passed.\n");
