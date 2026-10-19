#!/usr/bin/env tsx
/**
 * Removed-vendor guard. When a listing leaves the directory its /v page
 * must not 500 or dangle: the repo's pattern (PlebSource, 2026-10-13) is a
 * permanent redirect of /v/<slug> and /v/<slug>/* to the directory, plus
 * dropping the shelf tile and avatar. This checks every removed slug:
 *   1. it is gone from VENDORS (no listing key resolves to it),
 *   2. next.config redirects both /v/<slug> and /v/<slug>/:path* to / (308),
 *   3. no shelf-manifest entry or tile file is left behind.
 * Add a slug here whenever a vendor is unlisted.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VENDORS, vendorKey } from "../src/lib/vendors";
import nextConfig from "../next.config";

const REMOVED = [
  "plebsource-com",
  "btcpins",
];

let failed = 0;
function check(label: string, ok: boolean) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failed++;
}

async function main() {
  const keys = new Set(VENDORS.map((v) => vendorKey(v)));
  const redirects = nextConfig.redirects ? await nextConfig.redirects() : [];
  const shelves = JSON.parse(
    readFileSync(resolve(__dirname, "../src/lib/shelf-manifest.json"), "utf8"),
  ) as Record<string, unknown>;

  console.log("\n🚪 Removed vendors");
  for (const slug of REMOVED) {
    check(`${slug}: not in VENDORS`, !keys.has(slug));
    for (const source of [`/v/${slug}`, `/v/${slug}/:path*`]) {
      const r = redirects.find((x) => x.source === source);
      check(
        `${source} → / (permanent)`,
        Boolean(r && r.destination === "/" && "permanent" in r && r.permanent === true),
      );
    }
    check(`${slug}: no shelf-manifest entry`, !(slug in shelves));
    check(
      `${slug}: no tile file`,
      !existsSync(resolve(__dirname, `../public/vendor-shelves/${slug}.jpg`)),
    );
  }

  // A redirect must never shadow a LIVE listing.
  for (const r of redirects) {
    const m = /^\/v\/([^/:]+)$/.exec(r.source);
    if (m) check(`redirect ${r.source} does not shadow a live vendor`, !keys.has(m[1]));
  }

  if (failed) {
    console.error(`\n✗ ${failed} removed-vendor check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ removed-vendor redirects clean");
}

main();
