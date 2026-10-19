// Vendor listing JSON-LD + visible breadcrumb checks for /v/[slug]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let failures = 0;
function check(desc: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${desc}`);
  } else {
    failures++;
    console.error(`  FAIL  ${desc}${detail ? ` · ${detail}` : ""}`);
  }
}

console.log("\nVendor /v/[slug] schema + breadcrumb\n");

{
  const layout = readFileSync(
    resolve("src/app/v/[slug]/layout.tsx"),
    "utf8",
  );
  check("layout emits LocalBusiness", layout.includes('"LocalBusiness"'));
  check("layout emits WebPage", layout.includes('"WebPage"'));
  check("layout emits BreadcrumbList", layout.includes('"BreadcrumbList"'));
  check(
    "layout breadcrumb step 1 is Directory",
    layout.includes('name: "Directory"'),
  );
  check(
    "layout breadcrumb step 2 is the category hub",
    layout.includes("/spend-bitcoin-on/${vendor.category}"),
  );
  check(
    "layout sets dateModified from verifiedAt",
    layout.includes("dateModified") && layout.includes("verifiedAt"),
  );
  check(
    "layout does not also declare OnlineStore (one entity type)",
    !layout.includes("OnlineStore"),
  );
  check(
    "layout prefers shop website for LocalBusiness.url",
    layout.includes("businessUrl") &&
      layout.includes("vendorWebsite(vendor)") &&
      layout.includes("url: businessUrl"),
  );
  check(
    "layout keeps profile/Lightning actionUrl in sameAs",
    layout.includes("[actionUrl, shopHref]") ||
      layout.includes("[actionUrl, vendorWebsite(vendor)]"),
  );
}

{
  const page = readFileSync(resolve("src/app/v/[slug]/page.tsx"), "utf8");
  check(
    "page renders a visible Breadcrumb nav",
    page.includes('aria-label="Breadcrumb"'),
  );
  check(
    "page breadcrumb links the category hub",
    page.includes("`/spend-bitcoin-on/${vendor.category}`") ||
      page.includes("/spend-bitcoin-on/${vendor.category}"),
  );
  check(
    "page does not emit a second ld+json (layout owns schema)",
    !page.includes("application/ld+json"),
  );
  check(
    "page does not invent AggregateRating",
    !page.includes("AggregateRating") && !page.includes("aggregateRating"),
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)\n`);
  process.exit(1);
}
console.log("\nAll vendor listing schema checks passed.\n");
