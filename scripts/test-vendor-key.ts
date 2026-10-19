// Listing key vs identity (2026-10) · PR 1 of multi-shop-per-handle.
//
// Pins the move of every SHOP-scoped use from the handle to the listing
// key (vendorKey · the /v slug) while old browser storage and old KV
// records keep resolving. No visible change is the contract: every
// current vendor must resolve 1:1 from its handle AND from its key.
//
// Run: npx tsx scripts/test-vendor-key.ts
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  VENDORS,
  findVendorByKey,
  normalizeVendorRefs,
  normalizeWebsite,
  resolveVendorRef,
  vendorKey,
  vendorSlug,
  vendorsByHandle,
  type Vendor,
} from "../src/lib/vendors";
import { vendorShelf } from "../src/lib/shelves";
import {
  buildRun,
  hasUnnotifiedEntries,
  parseQueue,
  pruneNotified,
  queueKey,
  type QueueEntry,
} from "../src/lib/vendor-queue";
import { signalKey, type VendorSignals } from "../src/lib/vendor-signals";
import { bumpVerifiedAtInSource } from "./reverify-vendors";
import {
  legacyVendorNotifyKey,
  vendorNotifyKey,
} from "../src/lib/vendor-notify-key";

export {};

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` · ${detail}` : ""}`);
  }
}

const src = (p: string) => readFileSync(p, "utf8");

// ── 1 · key = slug, lookups, legacy resolution ────────────────────────
{
  check(
    "vendorKey is the /v slug for every vendor",
    VENDORS.every((v) => vendorKey(v) === vendorSlug(v)),
  );
  check(
    "findVendorByKey round-trips every vendor",
    VENDORS.every((v) => findVendorByKey(vendorKey(v)) === v),
  );
  check("findVendorByKey misses cleanly", findVendorByKey("no-such-shop-xyz") === null);
  // A legacy handle ref predates any sibling shop, so it resolves to the
  // handle's OLDEST listing (vendorsByHandle order). For a single-shop
  // handle that is the vendor itself.
  const oldest = (v: Vendor) => vendorsByHandle(v.handle, null)[0];
  const badRef = VENDORS.filter((v) => resolveVendorRef(v.handle) !== oldest(v));
  check(
    "every current handle (legacy ref) resolves to its oldest listing",
    badRef.length === 0,
    badRef.map((v) => v.handle).join(", "),
  );
  const x = VENDORS.find((v) => (v.platform ?? "x") === "x" && /[A-Z]/.test(v.handle));
  if (x) {
    check(
      "legacy X handle refs resolve case-insensitively",
      resolveVendorRef(x.handle.toLowerCase()) === oldest(x),
    );
  }
  check("unknown ref resolves to null", resolveVendorRef("definitely-not-a-vendor-42") === null);
  check("empty ref resolves to null", resolveVendorRef("") === null);
}

// ── 2 · stored-list normalization (favourites, journey) ───────────────
{
  const [a, b] = VENDORS;
  const out = normalizeVendorRefs([a.handle, vendorKey(b), vendorKey(a), 7, null, "gone-shop"]);
  check(
    "legacy handle → key, duplicates collapse, unknown kept, junk dropped",
    JSON.stringify(out) === JSON.stringify([vendorKey(a), vendorKey(b), "gone-shop"]),
    JSON.stringify(out),
  );
  const keys = VENDORS.map(vendorKey);
  check(
    "already-migrated lists are a fixed point",
    JSON.stringify(normalizeVendorRefs(keys)) === JSON.stringify(keys),
  );
  // Legacy lists hold handles, so a multi-shop handle collapses to its
  // oldest listing (the shop the visitor actually hearted back then).
  const legacy = VENDORS.map((v) => v.handle);
  const expected = [
    ...new Set(VENDORS.map((v) => vendorKey(vendorsByHandle(v.handle, null)[0]))),
  ];
  check(
    "a full legacy handle list migrates to each handle's oldest listing key",
    JSON.stringify(normalizeVendorRefs(legacy)) === JSON.stringify(expected),
  );
}

// ── 3 · vendorsByHandle ────────────────────────────────────────────────
{
  const base = VENDORS[0];
  const mk = (o: Partial<Vendor>): Vendor => ({ ...base, ...o }) as Vendor;
  const synth: Vendor[] = [
    mk({ handle: "MultiShop", name: "Shop Two", listedAt: 200, addedAt: 2 }),
    mk({ handle: "multishop", name: "Shop One", listedAt: 100, addedAt: 1 }),
    mk({ handle: "multishop@nostr.example", platform: "nostr", name: "Nostr Shop" }),
    mk({ handle: "someoneelse", name: "Other" }),
  ];
  const got = vendorsByHandle("@MULTISHOP", "x", synth).map((v) => v.name);
  check(
    "vendorsByHandle is case-insensitive, strips @, oldest listing first",
    JSON.stringify(got) === JSON.stringify(["Shop One", "Shop Two"]),
    JSON.stringify(got),
  );
  check(
    "vendorsByHandle respects platform",
    vendorsByHandle("multishop@nostr.example", "x", synth).length === 0 &&
      vendorsByHandle("multishop@nostr.example", "nostr", synth).length === 1,
  );
  check("vendorsByHandle(null platform) matches any platform",
    vendorsByHandle("multishop", null, synth).length === 2);
  check(
    "sibling listings under one handle are distinct shops (own name and website)",
    VENDORS.every((v) => {
      const sibs = vendorsByHandle(v.handle, v.platform ?? "x");
      return (
        new Set(sibs.map((s) => s.name)).size === sibs.length &&
        new Set(sibs.map((s) => normalizeWebsite(s.website ?? s.shopUrl ?? s.name))).size === sibs.length
      );
    }),
  );
}

// ── 4 · normalizeWebsite ──────────────────────────────────────────────
{
  const same = [
    "https://www.Shop.com/Store/",
    "http://shop.com/store",
    "https://SHOP.com/store?ref=x#top",
    "shop.com/store/",
  ].map(normalizeWebsite);
  check("normalizeWebsite folds www, case, scheme, query, hash, trailing /", new Set(same).size === 1, same.join(" | "));
  check("normalizeWebsite keeps distinct paths distinct",
    normalizeWebsite("https://etsy.com/shop/a") !== normalizeWebsite("https://etsy.com/shop/b"));
  check("bare host and host/ compare equal",
    normalizeWebsite("https://shop.com") === normalizeWebsite("https://shop.com/"));
}

// ── 5 · shelf manifest is keyed by listing; output unchanged ─────────
{
  const manifest = JSON.parse(src("src/lib/shelf-manifest.json")) as Record<string, { src: string }>;
  const slugs = new Set(VENDORS.map(vendorKey));
  const strays = Object.keys(manifest).filter((k) => !slugs.has(k));
  check("every shelf-manifest key is a live listing key", strays.length === 0, strays.join(", "));
  let prior: Record<string, { src: string }> | null = null;
  try {
    prior = JSON.parse(
      execFileSync("git", ["show", "e6a5794:src/lib/shelf-manifest.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
    );
  } catch {
    prior = null; // shallow clone without the pre-move commit · skip
  }
  if (prior) {
    const p = prior;
    // The pre-move manifest was keyed by handle, so its handle entry is
    // the OLDEST listing's shelf. A later sibling shop never had one;
    // compare it by slug only and skip it if the slug is new.
    const drift = VENDORS.filter((v) => {
      const isOldest = vendorsByHandle(v.handle, null)[0] === v;
      if (!isOldest && !(vendorSlug(v) in p)) return false;
      // Listed after the re-key (neither its handle nor its slug was in
      // the pre-move manifest): there is no "before" to compare against,
      // and a shelf snapshotted at add time is expected, not drift.
      if (!(v.handle.toLowerCase() in p) && !(vendorSlug(v) in p)) return false;
      const old = (isOldest ? p[v.handle.toLowerCase()] : undefined) ?? p[vendorSlug(v)] ?? null;
      return (old?.src ?? null) !== (vendorShelf(v)?.src ?? null);
    });
    check("every vendor shows the same shelf image as before the re-key", drift.length === 0,
      drift.map((v) => v.handle).join(", "));
  }
}

// ── 6 · site checks + re-verify queue key by listing ─────────────────
{
  const sig = (handle: string, key?: string, streak = 0, gone = false): VendorSignals => ({
    handle,
    ...(key ? { key } : {}),
    observedAt: 1,
    failStreak: streak,
    lud16: null,
    shop: gone ? { kind: "gone", status: 404 } : { kind: "ok", markers: { bitcoin: true, lightning: false, btc: false } },
    profile: null,
  });
  check("signalKey prefers the listing key, falls back to handle",
    signalKey(sig("h", "shop-a")) === "shop-a" && signalKey(sig("h")) === "h");
  // Two shops under one handle keep separate baselines.
  const prev = [sig("h", "shop-a", 2, true), sig("h", "shop-b", 0)];
  const r = buildRun(prev, [sig("h", "shop-a", 0, true), sig("h", "shop-b", 0)]);
  check("sibling shops keep separate streaks (only the failing shop queues)",
    r.queue.length === 1 && r.queue[0].key === "shop-a" &&
      r.toStore.find((s) => s.key === "shop-b")?.failStreak === 0);
  check("queue entries carry handle AND listing key",
    r.queue[0].handle === "h" && queueKey(r.queue[0]) === "shop-a");
  check("parseQueue keeps a key and accepts legacy entries without one",
    parseQueue([{ handle: "h", key: "shop-a", reason: "x", priority: "high" }])[0].key === "shop-a" &&
      parseQueue([{ handle: "h", reason: "x", priority: "high" }])[0].key === undefined);
  const e: QueueEntry = { handle: "h", key: "shop-a", reason: "x", priority: "high" };
  check("a legacy handle marker still counts as notified (no repeat email)",
    !hasUnnotifiedEntries([e], ["h"]));
  check("pruneNotified carries a legacy handle marker over to the listing key",
    JSON.stringify(pruneNotified(["h"], [e], false)) === JSON.stringify(["shop-a"]));
  const route = src("src/app/api/cron/monitor-vendors/route.ts");
  check("monitor cron reads keys + legacy handles in ONE HMGET and writes by key",
    /kvHMGetChecked<VendorSignals>\(SIGNALS_KEY, \[\s*\.\.\.keys,\s*\.\.\.handles,?\s*\]\)/.test(route) &&
      route.includes("byKey[signalKey(s)] = s"));
  check("legacy baseline fallback only for a single-listing handle",
    route.includes("listingsPerHandle.get(handles[i]) === 1"));
}

// ── 7 · outcome-email KV is per listing with legacy fallback ─────────
{
  check("notify key is handle + slug", vendorNotifyKey("bcuz21", "Sat's Oil") === "vendor-notify:bcuz21:sat-s-oil");
  check("legacy notify key is per handle", legacyVendorNotifyKey("bcuz21") === "vendor-notify:bcuz21");
  const offenders = [
    "src/app/api/submit-vendor/route.ts",
    "src/lib/submission-notify.ts",
    "src/app/api/admin/notify-submitter/route.ts",
    "src/app/api/admin/pending-submissions/route.ts",
    "src/app/api/cron/new-vendor-digest/route.ts",
    "scripts/add-vendor.ts",
  ].filter((f) => /`vendor-notify:\$\{/.test(src(f)));
  check("no caller builds a vendor-notify key by hand", offenders.length === 0, offenders.join(", "));
}

// ── 7b · reverify's verifiedAt bump targets one listing of a handle ──
{
  const fake = [
    "export const VENDORS = [",
    "  {",
    '    handle: "multi",',
    '    name: "Shop One",',
    "    verifiedAt: 1,",
    "  },",
    "  {",
    '    handle: "multi",',
    '    name: "Shop Two",',
    "    verifiedAt: 1,",
    "  },",
    "];",
  ].join("\n");
  const out = bumpVerifiedAtInSource(fake, "multi", 99, "Shop Two");
  check("bump with a name edits only that sibling's verifiedAt",
    out.includes('name: "Shop One",\n    verifiedAt: 1,') &&
      out.includes('name: "Shop Two",\n    verifiedAt: 99,'));
  let threw = false;
  try { bumpVerifiedAtInSource(fake, "multi", 99); } catch { threw = true; }
  check("bump without a name refuses an ambiguous handle", threw);
  check("reverify passes the listing name to the source bump",
    src("scripts/reverify-vendors.ts").includes("bumpVerifiedAtInSource(source, v.handle, newTs, v.name)"));
}

// ── 8 · client surfaces key shop state by listing ────────────────────
{
  const home = src("src/app/HomeClient.tsx");
  check("homepage modal state is listing-keyed", home.includes("modalVendorKey") && !home.includes("modalVendorHandle"));
  check("favourites toggle/store by listing key and migrate legacy hearts",
    home.includes("saved.has(vendorKey(v))") && home.includes("normalizeVendorRefs(arr)"));
  check("filter matches favourites by listing key",
    src("src/lib/vendor-filter.ts").includes("f.saved.has(vendorKey(v))"));
  const shelf = src("src/components/DirectoryShelf.tsx");
  check("hub-shelf modal state is listing-keyed", shelf.includes("openKey") && !shelf.includes("openHandle"));
  check("recently-viewed records and resolves listing keys",
    src("src/app/v/[slug]/page.tsx").includes("<VendorJourneyTracker vendorKey={vendorKey(vendor)} />") &&
      src("src/components/RecentlyViewedVendors.tsx").includes("normalizeVendorRefs(j.handles)"));
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
