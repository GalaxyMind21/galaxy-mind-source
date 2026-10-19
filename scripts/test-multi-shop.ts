// Multi-shop per handle (2026-10) · PR 2 of option D.
//
// One identity (handle) may run several shops; each shop is its own
// listing keyed by its /v slug. Pins:
//   · duplicate rules: a storefront is listed once (under ANY handle),
//     a slug is unique, and the same handle + a NEW site is accepted
//     but flagged for an ownership check
//   · ownership evidence parsing (X / Nostr / Lightning backlinks,
//     nostr.json) and the approval gate
//   · siblings, per-shop logo fallback, shared owner JSON-LD @id
//   · surfaces: /v "More from" section, layout parentOrganization,
//     vendors.json + MCP `slug`/`siblings`, finalize 409, SubmitForm copy
// No visible change today: no real handle owns two listings yet.
//
// Run: npx tsx scripts/test-multi-shop.ts
import { readFileSync } from "node:fs";
import { VENDORS, vendorSiblings, vendorSlug, vendorWebsite, type Vendor } from "../src/lib/vendors";
import {
  conflictErrors,
  findListingConflicts,
  findPendingConflict,
  nostrJsonNamesPubkey,
  ownershipGate,
  pageLinksToIdentity,
} from "../src/lib/vendor-dedupe";
import { vendorLogoSrc, xAvatarSrc } from "../src/lib/avatars";
import { ownerOrganizationId, ownerOrganizationLd } from "../src/lib/vendor-owner-ld";
import { SUBMIT_FLAGS } from "../src/lib/submit-guard";
import { decodeNostrBech32ToPubkey } from "../src/lib/nostr-activity";

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

// Minimal bech32 encoder (test-only) so the Nostr backlink case uses a
// real npub without a new dependency.
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values: number[]): number {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= G[i];
  }
  return chk;
}
function npubEncode(hex: string): string {
  const bytes = hex.match(/../g)!.map((b) => parseInt(b, 16));
  const data: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) data.push((acc << (5 - bits)) & 31);
  const hrp = "npub";
  const expand = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const pm = polymod([...expand, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (pm >> (5 * (5 - i))) & 31);
  return hrp + "1" + [...data, ...checksum].map((d) => CHARSET[d]).join("");
}

// ── 1 · duplicate rules ───────────────────────────────────────────────
const base = VENDORS.find((v) => (v.platform ?? "x") === "x" && vendorWebsite(v))!;
{
  const cand = { handle: base.handle, platform: base.platform, name: "Zz Brand New Second Shop", website: "https://zz-second-shop.example/" };
  const k = findListingConflicts(cand, VENDORS);
  check("same handle + new site · no rejecting conflict", conflictErrors(cand, k).length === 0, JSON.stringify(conflictErrors(cand, k)));
  check("same handle + new site · flagged via sameHandle", k.sameHandle.length >= 1 && k.sameHandle.some((v) => v.name === base.name));
  check("same handle matched case-insensitively and with @", findListingConflicts({ ...cand, handle: "@" + base.handle.toUpperCase() }, VENDORS).sameHandle.length >= 1);
}
{
  const site = vendorWebsite(base)!;
  const variant = site.replace(/^https:\/\/(www\.)?/i, "http://www.").replace(/\/?$/, "/?utm=x#top");
  const cand = { handle: base.handle, platform: base.platform, name: "Zz Other Name", website: variant };
  const k = findListingConflicts(cand, VENDORS);
  check("same handle + same site (scheme/www/query variant) · rejected", conflictErrors(cand, k).length === 1 && !!k.siteTaken);
  check("same-owner error names the existing listing", /already listed under/.test(conflictErrors(cand, k)[0] ?? ""));
}
{
  const cand = { handle: "zz_someone_else_entirely", name: "Zz Unrelated Name", website: vendorWebsite(base)! };
  const k = findListingConflicts(cand, VENDORS);
  check("other handle + listed site · rejected", !!k.siteTaken && k.sameHandle.length === 0);
  check("other-owner error says each storefront is listed once", /listed once/.test(conflictErrors(cand, k)[0] ?? ""));
}
{
  const cand = { handle: "zz_new_person", name: base.name.toUpperCase() + "!", website: "https://zz-unique.example" };
  const k = findListingConflicts(cand, VENDORS);
  check("slug collision · rejected", !!k.slugTaken && conflictErrors(cand, k).some((e) => /slugifies/.test(e)));
}
{
  const pending = [{ vendor: { name: "Pending Shop One", website: "https://pending-one.example/shop/" } }];
  check("pending twin by site (normalized)", findPendingConflict({ handle: "a", name: "Different", website: "http://www.PENDING-one.example/shop" }, pending) === "site");
  check("pending twin by slug", findPendingConflict({ handle: "a", name: "pending shop ONE", website: "https://elsewhere.example" }, pending) === "slug");
  check("no pending twin", findPendingConflict({ handle: "a", name: "Fresh", website: "https://fresh.example" }, pending) === null);
  check("different path on same host is a different storefront", findPendingConflict({ handle: "a", name: "Fresh", website: "https://pending-one.example/other" }, pending) === null);
}
{
  check("existing-handle flag is a known SubmitFlag", (SUBMIT_FLAGS as readonly string[]).includes("existing-handle"));
}

// ── 2 · ownership evidence ────────────────────────────────────────────
{
  check("X backlink · x.com", pageLinksToIdentity('<a href="https://x.com/SoapMiner">', { handle: "soapminer" }));
  check("X backlink · twitter.com with @", pageLinksToIdentity('<a href="https://twitter.com/@soapminer?s=1">', { handle: "@soapminer" }));
  check("X backlink · longer handle does NOT count", !pageLinksToIdentity('<a href="https://x.com/soapminer_fake">', { handle: "soapminer" }));
  check("X backlink · other domain does NOT count", !pageLinksToIdentity('<a href="https://notx.com/soapminer">', { handle: "soapminer" }));
  check("X backlink · absent", !pageLinksToIdentity("<p>hello</p>", { handle: "soapminer" }));

  const pk = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
  const npub = npubEncode(pk);
  check("test npub round-trips through the real decoder", decodeNostrBech32ToPubkey(npub) === pk);
  check("Nostr backlink · npub decodes to pubkey", pageLinksToIdentity(`<a href="https://njump.me/${npub}">`, { handle: npub, platform: "nostr", pubkeyHex: pk }));
  check("Nostr backlink · hex pubkey", pageLinksToIdentity(`pubkey: ${pk}`, { handle: npub, platform: "nostr", pubkeyHex: pk }));
  check("Nostr backlink · NIP-05 string", pageLinksToIdentity("contact shop@example.com on nostr", { handle: "shop@example.com", platform: "nostr", pubkeyHex: null }));
  const otherNpub = npubEncode("f".repeat(64));
  check("Nostr backlink · a different npub does NOT count", !pageLinksToIdentity(`<a href="nostr:${otherNpub}">`, { handle: npub, platform: "nostr", pubkeyHex: pk }));
  check("Lightning backlink · address present", pageLinksToIdentity("tips: pay@getalby.com", { handle: "pay@getalby.com", platform: "lightning" }));
  check("Lightning backlink · prefixed address does NOT count", !pageLinksToIdentity("tips: xpay@getalby.com", { handle: "pay@getalby.com", platform: "lightning" }));

  check("nostr.json · names the pubkey", nostrJsonNamesPubkey({ names: { _: pk.toUpperCase() } }, pk));
  check("nostr.json · other pubkey", !nostrJsonNamesPubkey({ names: { _: "a".repeat(64) } }, pk));
  check("nostr.json · junk shapes", !nostrJsonNamesPubkey(null, pk) && !nostrJsonNamesPubkey({ names: "x" }, pk) && !nostrJsonNamesPubkey({ names: { _: pk } }, null));
}
{
  const sib = [base];
  check("ownershipGate · first shop passes", ownershipGate({ sameHandle: [] }) === null);
  check("ownershipGate · sibling without proof blocked", typeof ownershipGate({ sameHandle: sib }) === "string");
  check("ownershipGate · failed check still blocked", typeof ownershipGate({ sameHandle: sib, check: { checkedAt: 1, ok: false, detail: "none" } }) === "string");
  check("ownershipGate · backlink proof passes", ownershipGate({ sameHandle: sib, check: { checkedAt: 1, ok: true, method: "backlink", detail: "x" } }) === null);
  check("ownershipGate · DM fallback passes", ownershipGate({ sameHandle: sib, dmConfirmed: true }) === null);
}

// ── 3 · siblings, logo, owner JSON-LD ─────────────────────────────────
{
  // First real multi-shop handle: @Bcuz21 (The Belief Machine + Bitcoin
  // Art Store, 2026-10-17, ownership via X-bio backlink). Pinned so a new
  // sibling only ever appears on purpose; add the handle here when one does.
  const MULTI_SHOP_HANDLES = ["bcuz21"];
  const withSibs = [...new Set(VENDORS.filter((v) => vendorSiblings(v).length > 0).map((v) => v.handle.toLowerCase()))].sort();
  check("only the pinned multi-shop handles have siblings", JSON.stringify(withSibs) === JSON.stringify(MULTI_SHOP_HANDLES), withSibs.join(", "));
  check("real sibling links are mutual", VENDORS.every((v) => vendorSiblings(v).every((s) => vendorSiblings(s).includes(v))));
  const a: Vendor = { ...base, name: "Zz Alpha Shop" };
  const b: Vendor = { ...base, name: "Zz Beta Shop", handle: base.handle.toUpperCase() };
  const c: Vendor = { ...base, name: "Zz Gamma Shop", handle: base.handle, platform: "nostr" };
  const pool = [a, b, c];
  const sa = vendorSiblings(a, pool);
  check("vendorSiblings · same handle (case-insensitive), same platform, excludes self", sa.length === 1 && sa[0].name === "Zz Beta Shop");
  check("vendorSiblings · different platform is a different identity", vendorSiblings(c, pool).length === 0);

  check("vendorLogoSrc · pictureUrl wins", vendorLogoSrc({ handle: "foo", pictureUrl: "https://cdn.example/logo.png" }) === "https://cdn.example/logo.png");
  check("vendorLogoSrc · unsafe pictureUrl falls back to account avatar", vendorLogoSrc({ handle: "foo", pictureUrl: "javascript:alert(1)" }) === xAvatarSrc("foo"));
  check("vendorLogoSrc · no pictureUrl → X account avatar", vendorLogoSrc({ handle: "foo" }) === xAvatarSrc("foo"));
  check("vendorLogoSrc · Nostr without pictureUrl → null (initials)", vendorLogoSrc({ handle: "npub1x", platform: "nostr" }) === null);

  const S = "https://galaxymind.space";
  check("owner @id shared across a handle's shops", ownerOrganizationId(a, S) === ownerOrganizationId(b, S));
  check("owner @id differs across platforms", ownerOrganizationId(a, S) !== ownerOrganizationId(c, S));
  const ld = ownerOrganizationLd(a, S);
  check("owner LD is an Organization with the shared @id", ld["@type"] === "Organization" && ld["@id"] === ownerOrganizationId(a, S));
}

// ── 4 · surfaces (source checks) ──────────────────────────────────────
{
  const page = src("src/app/v/[slug]/page.tsx");
  check("/v page renders a 'More from' section gated on siblings", page.includes('data-testid="more-from-handle"') && /siblings\.length\s*>\s*0/.test(page));
  check("/v page logo goes through vendorLogoSrc", page.includes("vendorLogoSrc"));
  const layout = src("src/app/v/[slug]/layout.tsx");
  check("layout JSON-LD adds parentOrganization only with siblings", layout.includes("parentOrganization") && layout.includes("hasSiblings"));
  const modal = src("src/components/VendorDetailModal.tsx");
  check("modal has the sibling row", modal.includes("vendor_modal_sibling_click"));
  const vj = src("src/app/api/vendors.json/route.ts");
  check("vendors.json carries slug + siblings", /slug:\s*vendorSlug\(v\)/.test(vj) && vj.includes("siblings"));
  const mcp = src("src/app/api/mcp/[transport]/route.ts");
  check("MCP search_vendors carries slug + siblings", /slug:\s*vendorSlug\(v\)/.test(mcp) && mcp.includes("vendorSiblings(v)"));
  check("OpenAPI documents slug + non-unique handle", /`slug`/.test(src("src/app/api/openapi.json/route.ts")) && /NOT unique/.test(src("src/app/api/openapi.json/route.ts")));
  const fin = src("src/app/api/admin/finalize-submission/route.ts");
  check("finalize 409s an existing-handle approval without proof", fin.includes("existing-handle") && fin.includes("status: 409") && fin.includes("ownershipConfirmedByDm"));
  const sub = src("src/app/api/submit-vendor/route.ts");
  check("submit-vendor uses findListingConflicts + pending twin + ownership check", sub.includes("findListingConflicts") && sub.includes("findPendingConflict") && sub.includes("checkOwnership"));
  const form = src("src/app/submit/SubmitForm.tsx");
  const en = JSON.parse(src("src/messages/en.json")) as Record<string, string>;
  const es = JSON.parse(src("src/messages/es.json")) as Record<string, string>;
  check("SubmitForm shows the multi-shop helper line", form.includes('t("submit.multiShop")') && /more than one shop/i.test(en["submit.multiShop"] ?? "") && !!es["submit.multiShop"]);
  const llms = src("public/llms.txt");
  check("llms.txt: slug is the key, handle not unique", llms.includes("unique slugs") && llms.includes("siblings"));
}

// Every vendors.json row would carry a slug equal to its /v url tail.
check("every vendor has a non-empty slug", VENDORS.every((v) => vendorSlug(v).length > 0));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
