#!/usr/bin/env tsx
/**
 * Vendor social cards 404'd for months: generateImageMetadata returns
 * id: vendorSlug so Next serves /v/[slug]/opengraph-image/[id], but
 * page.tsx declared /v/[slug]/opengraph-image (no id segment). X then
 * reserved a summary_large_image and rendered nothing.
 *
 * This is a source assertion, not a live fetch — same rationale as
 * check-canonicals. A network-gated sibling can fetch later.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const page = readFileSync(
  join(ROOT, "src/app/v/[slug]/page.tsx"),
  "utf8",
);
const og = readFileSync(
  join(ROOT, "src/app/v/[slug]/opengraph-image.tsx"),
  "utf8",
);

let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

console.log("vendor OG path");
ok(
  /id:\s*vendorSlug\(vendor\)/.test(og),
  "generateImageMetadata still keys the card by vendorSlug",
);
ok(
  /pageOgImage\(`\/v\/\$\{slug\}\/opengraph-image\/\$\{slug\}`/.test(page),
  "page metadata points at /v/{slug}/opengraph-image/{slug}",
);
ok(
  !/pageOgImage\(`\/v\/\$\{slug\}\/opengraph-image`(?!\/)/.test(page),
  "page metadata does not declare the 404 path without the id segment",
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("ok");
