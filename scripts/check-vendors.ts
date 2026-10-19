// Vendor schema sanity checks. Run with `npx tsx scripts/check-vendors.ts`.
// Exits 0 on clean, non-zero on any failure. Catches things that would slip
// past TypeScript: duplicate storefronts (websites) and /v slugs (one
// handle may own several listings since 2026-10), duplicate addedAt indices, country
// codes without metadata, malformed verifiedAt timestamps, missing fields.
//
// Add to CI in the future to block bad commits to the vendor list.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VENDORS,
  COUNTRIES,
  COUNTRY_COORDS,
  HOUSE_HANDLE,
  countrySlug,
  getPlatform,
  normalizeWebsite,
  vendorSlug,
  vendorWebsite,
  CATEGORY_LABELS,
  type Vendor,
  alsoSoldOnLinks,
} from "../src/lib/vendors";
import { validateOutboundUrl } from "../src/lib/safe-fetch";
import { hasControlledSubstanceCopy } from "../src/lib/submit-guard";
import AVATAR_MANIFEST from "../src/lib/avatar-manifest.json";
import SHELF_MANIFEST from "../src/lib/shelf-manifest.json";
import { ISO_COUNTRY_NAMES, flagFor } from "../src/lib/iso-countries";

type Check = { ok: boolean; label: string; detail?: string };
const checks: Check[] = [];

function ok(label: string) {
  checks.push({ ok: true, label });
}
function fail(label: string, detail: string) {
  checks.push({ ok: false, label, detail });
}

// --- 1. Required-field presence ---
// listedAt is the immutable first-appearance date (number, UTC midnight).
// It is required on the type; missing it used to only fail the later
// well-formed check, so an omitted field was a confusing second error.
// Note: paymentNote was dropped from REQUIRED — the rail distinction
// (Bitcoin only / Lightning / Lightning + on-chain) was removed from
// the card display in May 2026, and the field is now optional. Existing
// entries keep theirs (harmless data); new entries can omit it.
const REQUIRED = [
  "handle",
  "name",
  "description",
  "category",
  "addedAt",
  "verifiedAt",
  "listedAt",
] as const satisfies readonly (keyof Vendor)[];
for (const v of VENDORS) {
  for (const k of REQUIRED) {
    const val = v[k];
    if (val === undefined || val === null || val === "") {
      fail(`required field present`, `${v.handle}: missing/empty ${k}`);
    }
  }
}
if (checks.every((c) => c.ok)) ok("required fields present on all entries");

// --- 2. Unique storefronts (multi-shop, 2026-10) ---
// One identity (handle + platform) may own several listings, each its
// own shop with its own /v page (slug uniqueness is gate 3b). What must
// never repeat is the STOREFRONT: a website is listed once, under one
// handle. Compared via normalizeWebsite (host minus www + path, case-
// and trailing-slash-folded), the same rule /api/submit-vendor and the
// review CLI enforce. Listings without a website are not compared.
{
  const seen = new Map<string, string>();
  const dups: string[] = [];
  for (const v of VENDORS) {
    const w = vendorWebsite(v);
    if (!w) continue;
    const key = normalizeWebsite(w);
    const prev = seen.get(key);
    if (prev !== undefined) dups.push(`${key}: ${prev} / ${v.name}`);
    else seen.set(key, v.name);
  }
  if (dups.length > 0) {
    fail("unique storefronts", `duplicates: ${[...new Set(dups)].join("; ")}`);
  } else {
    ok(`unique storefronts (${seen.size} distinct websites)`);
  }
}

// --- 2b. Legacy refs stay unambiguous ---
// Browser storage written before 2026-10 (favourites, recently viewed)
// holds HANDLES; new entries hold listing keys (slugs). resolveVendorRef
// tries the slug first, so a handle equal to a DIFFERENT vendor's slug
// would silently re-point an old heart. Its own slug is fine.
{
  const slugOwner = new Map(VENDORS.map((v) => [vendorSlug(v), v]));
  const clashes: string[] = [];
  for (const v of VENDORS) {
    const other = slugOwner.get(v.handle.toLowerCase());
    if (other && other !== v && other.handle !== v.handle) {
      clashes.push(`handle "${v.handle}" = slug of "${other.name}"`);
    }
  }
  if (clashes.length > 0) {
    fail("handles never shadow another vendor's slug", clashes.join("; "));
  } else {
    ok("no handle shadows another vendor's /v slug (legacy refs resolve 1:1)");
  }
}

// --- 3. Unique addedAt ---
const indices = VENDORS.map((v) => v.addedAt);
const dupIndices = indices.filter((n, i) => indices.indexOf(n) !== i);
if (dupIndices.length > 0) {
  fail("unique addedAt", `collisions: ${[...new Set(dupIndices)].join(", ")}`);
} else {
  ok(`unique addedAt indices (${indices.length} distinct)`);
}

// --- 3b. Unique URL slugs ---
// Each vendor gets a /v/[slug] page · slug is derived from
// vendor.name. Two vendors with names that slugify to the same value
// (e.g. "Soap Miner" and "Soap Miner!" both → "soap-miner") would
// collide on the dynamic route. Catch this at validate-time.
const slugs = VENDORS.map((v) => ({ name: v.name, slug: vendorSlug(v) }));
const slugCounts = new Map<string, string[]>();
for (const { name, slug } of slugs) {
  const list = slugCounts.get(slug) ?? [];
  list.push(name);
  slugCounts.set(slug, list);
}
const slugDupes = [...slugCounts.entries()].filter(([, names]) => names.length > 1);
if (slugDupes.length > 0) {
  fail(
    "unique URL slugs",
    slugDupes
      .map(([slug, names]) => `"${slug}" ← ${names.join(", ")}`)
      .join("; "),
  );
} else {
  ok(`unique URL slugs (${slugs.length} distinct /v/[slug] paths)`);
}

// --- 4. addedAt are positive integers ---
for (const v of VENDORS) {
  if (!Number.isInteger(v.addedAt) || v.addedAt <= 0) {
    fail("addedAt is positive integer", `${v.handle}: ${v.addedAt}`);
  }
}

// --- 5. verifiedAt are sensible UNIX-second timestamps ---
const NOW = Math.floor(Date.now() / 1000);
const TEN_YEARS_AGO = NOW - 10 * 365 * 86400;
for (const v of VENDORS) {
  if (!Number.isFinite(v.verifiedAt)) {
    fail("verifiedAt is finite", `${v.handle}: ${v.verifiedAt}`);
  } else if (v.verifiedAt > NOW + 86400) {
    fail("verifiedAt not in future", `${v.handle}: ${v.verifiedAt}`);
  } else if (v.verifiedAt < TEN_YEARS_AGO) {
    fail(
      "verifiedAt within last 10y",
      `${v.handle}: ${v.verifiedAt} (likely wrong unit?)`,
    );
  }
}

// --- listedAt (2026-08-15) ---
// listedAt is the day the vendor FIRST appeared; verifiedAt is the day it
// was last confirmed. Conflating them marked the whole directory NEW on
// 2026-08-13. Check 4 is the one that would have caught it.
{
  const bad: string[] = [];
  const nowSec = Math.floor(Date.now() / 1000);
  for (const v of VENDORS) {
    if (!Number.isFinite(v.listedAt) || !Number.isInteger(v.listedAt)) {
      bad.push(`${v.handle}: listedAt not an integer (${v.listedAt})`);
    } else if (v.listedAt % 86_400 !== 0) {
      bad.push(`${v.handle}: listedAt not UTC-midnight aligned`);
    } else if (v.listedAt > nowSec) {
      bad.push(`${v.handle}: listedAt in the future`);
    } else if (v.listedAt > v.verifiedAt) {
      bad.push(`${v.handle}: listedAt after verifiedAt (cannot verify before listing)`);
    }
  }
  if (bad.length === 0) ok("listedAt well-formed and <= verifiedAt");
  else fail("listedAt well-formed and <= verifiedAt", bad.join(" · "));
}

// Warning-only: listedAt should broadly increase with the addedAt ordinal.
// 2 inversions exist from batch commits that added several vendors at once
// (ViciTax->fugum, bitlancework->CoinCards); the check fails only if that
// number GROWS. Keep this tight to the measured value — headroom in a
// ratchet is regressions nobody sees.
const EXPECTED_INVERSIONS = 2;
{
  const sorted = [...VENDORS].sort((a, b) => a.addedAt - b.addedAt);
  let inversions = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].listedAt < sorted[i - 1].listedAt) inversions++;
  }
  if (inversions <= EXPECTED_INVERSIONS) {
    ok(`listedAt ordering (${inversions}/${EXPECTED_INVERSIONS} known inversions)`);
  } else {
    fail(
      "listedAt ordering",
      `${inversions} inversions vs baseline ${EXPECTED_INVERSIONS} — a new vendor likely got a listedAt older than its predecessor`,
    );
  }
}

// --- 6. Handles match the format expected by the vendor's platform ---
//
// Per-platform regex:
//   X         → 1-15 chars, [A-Za-z0-9_] (X's classic username constraint)
//   Nostr     → either NIP-05 (`name@domain.tld`) or `npub1...` (1+58 chars
//               of bech32 lowercase alphanumerics, total 63 chars)
//   Lightning → Lightning Address: `name@domain.tld` (same shape as email)
//
// Platform defaults to "x" via getPlatform() so existing vendors that
// haven't set the field continue to be validated under the X regex.
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const EMAIL_LIKE_RE =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
// Bech32 charset for NIP-19 entities. npub1 is exactly 63 chars total
// (1 char prefix + "1" + 58 char data); nprofile1 is variable length
// because it embeds optional relay hints in addition to the pubkey.
const NPUB_RE = /^npub1[023456789acdefghjklmnpqrstuvwxyz]{58}$/;
const NPROFILE_RE = /^nprofile1[023456789acdefghjklmnpqrstuvwxyz]+$/;

for (const v of VENDORS) {
  const platform = getPlatform(v);
  let valid: boolean;
  let expected: string;
  switch (platform) {
    case "x":
      valid = X_HANDLE_RE.test(v.handle);
      expected = "X username: 1-15 chars, [A-Za-z0-9_]";
      break;
    case "nostr":
      valid =
        EMAIL_LIKE_RE.test(v.handle) ||
        NPUB_RE.test(v.handle) ||
        NPROFILE_RE.test(v.handle);
      expected =
        "Nostr: NIP-05 'name@domain', 'npub1…' (63 chars), or 'nprofile1…' bech32";
      break;
    case "lightning":
      valid = EMAIL_LIKE_RE.test(v.handle);
      expected = "Lightning Address: 'name@domain.tld'";
      break;
  }
  if (!valid) {
    fail(
      `handle matches ${platform} format`,
      `${v.handle} (platform=${platform}): expected ${expected}`,
    );
  }
}

// --- 7. shopUrl is valid URL when present ---
for (const v of VENDORS) {
  if (v.shopUrl !== undefined) {
    try {
      const u = new URL(v.shopUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        fail("shopUrl protocol", `${v.handle}: ${v.shopUrl}`);
      }
    } catch {
      fail("shopUrl is valid URL", `${v.handle}: ${v.shopUrl}`);
    }
  }
}

// --- 7b. bitcoin.org clause 2 · no cannabis / controlled-substance shops ---
// Operator 2026-09-14 (Ground Up Genes). Same helper as the /submit
// door, so a listed row cannot say a word the public form would reject.
{
  const hits: string[] = [];
  for (const v of VENDORS) {
    const blob = [v.name, v.description, vendorWebsite(v) ?? ""].join("\n");
    if (hasControlledSubstanceCopy(blob)) hits.push(v.handle);
  }
  if (hits.length > 0) {
    fail(
      "no cannabis / controlled-substance shops on the roster",
      hits.join(", "),
    );
  } else {
    ok("no cannabis / controlled-substance shops on the roster");
  }
}

// --- 8. country (when set) has metadata in COUNTRIES ---
for (const v of VENDORS) {
  if (v.country !== undefined && !COUNTRIES[v.country]) {
    fail(
      "country has metadata",
      `${v.handle}: country '${v.country}' has no entry in COUNTRIES (add flag + label)`,
    );
  }
}

// --- 8a. COUNTRIES <-> ISO_COUNTRY_NAMES agreement (2026-08-20) ---
// The submit form and the add-vendor CLI now offer the FULL ISO table
// (src/lib/iso-countries.ts, generated) while COUNTRIES stays
// vendor-bearing-only, because COUNTRIES drives the hub pages. These two
// tables must not disagree about what a country is CALLED: the label is
// what becomes a /spend-bitcoin-in/[country] slug when a country is
// promoted, so a silent rename here moves a canonical URL.
//
// This gate does NOT relax gate 8 above. A vendor's country must still
// have a COUNTRIES row — that requirement is exactly what prevents ~250
// empty hub pages, and it is what forces promotion to be deliberate.
const LABEL_OVERRIDES: Record<string, string> = {
  // Deliberate divergences from the CLDR common name, if ever needed.
  // Add with a comment saying WHY — an entry here moves nothing on its
  // own, but it silences a drift alarm, so it must be a decision.
};
for (const [code, info] of Object.entries(COUNTRIES)) {
  if (!ISO_COUNTRY_NAMES[code]) {
    fail(
      "COUNTRIES code is ISO-3166-1",
      `${code}: not an officially assigned alpha-2 code (or iso-countries.ts is stale · run node scripts/build-iso-countries.mjs)`,
    );
    continue;
  }
  const expectedFlag = flagFor(code);
  if (info.flag !== expectedFlag) {
    fail(
      "COUNTRIES flag matches derivation",
      `${code}: COUNTRIES has ${info.flag}, regional-indicator derivation gives ${expectedFlag}`,
    );
  }
  const expectedLabel = LABEL_OVERRIDES[code] ?? ISO_COUNTRY_NAMES[code];
  if (info.label !== expectedLabel) {
    fail(
      "COUNTRIES label matches ISO table",
      `${code}: COUNTRIES says "${info.label}", ISO table says "${expectedLabel}" · a hub slug would move (add a LABEL_OVERRIDES entry if deliberate)`,
    );
  }
}

// --- 8b. COUNTRIES <-> COUNTRY_COORDS parity (audit 2026-05) ---
// Every country in COUNTRIES MUST have a COUNTRY_COORDS centroid, or
// that country's vendors render with NO dot on the homepage
// <VendorMap> (the component does `if (!coord) return null`).
// Enforced BIDIRECTIONALLY so an orphan coord (typo'd or removed
// country) is also caught. This gate exists because the two tables
// silently drifted: AU/NZ/NL/HU/SV/ES all had vendors but no map dot
// until this check was added. A PASS line is emitted on purpose so
// the invariant is visibly enforced, not silent.
{
  const countriesKeys = Object.keys(COUNTRIES).sort();
  const missingCoords = countriesKeys.filter((c) => !COUNTRY_COORDS[c]);
  const orphanCoords = Object.keys(COUNTRY_COORDS)
    .sort()
    .filter((c) => !COUNTRIES[c]);
  if (missingCoords.length > 0 || orphanCoords.length > 0) {
    const parts: string[] = [];
    if (missingCoords.length > 0)
      parts.push(
        `in COUNTRIES but missing COUNTRY_COORDS (→ no map dot): ${missingCoords.join(", ")}`,
      );
    if (orphanCoords.length > 0)
      parts.push(
        `in COUNTRY_COORDS but not COUNTRIES (orphan): ${orphanCoords.join(", ")}`,
      );
    fail("COUNTRIES ↔ COUNTRY_COORDS parity", parts.join(" · "));
  } else {
    ok(
      `COUNTRIES ↔ COUNTRY_COORDS parity (${countriesKeys.length} countries, all mapped)`,
    );
  }
}

// --- 8c. COUNTRIES <-> next.config.ts COUNTRY_HUB_ALIASES parity ---
// (SEO sprint 2026-07-21.) next.config.ts 308s alpha-2 short URLs
// (/spend-bitcoin-in/us) to the canonical full-name hub slugs. That
// alias map is a hand-maintained MIRROR of COUNTRIES (next.config.ts
// can't import the app bundle), so a new country added without its
// alias row silently 404s the short URL — exactly the bug the aliases
// exist to fix. Parsed textually from next.config.ts (same
// static-analysis posture as check-canonicals).
{
  const configSrc = readFileSync(
    join(process.cwd(), "next.config.ts"),
    "utf8",
  );
  const aliasBlock = configSrc.match(
    /COUNTRY_HUB_ALIASES:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\}/,
  );
  if (!aliasBlock) {
    fail(
      "COUNTRIES ↔ COUNTRY_HUB_ALIASES parity",
      "could not find COUNTRY_HUB_ALIASES in next.config.ts",
    );
  } else {
    const aliases = new Map<string, string>();
    for (const m of aliasBlock[1].matchAll(/(\w+):\s*"([^"]+)"/g)) {
      aliases.set(m[1], m[2]);
    }
    const problems: string[] = [];
    for (const [code, info] of Object.entries(COUNTRIES)) {
      const alias = code.toLowerCase();
      const expected = countrySlug(info.label);
      const got = aliases.get(alias);
      if (!got) {
        problems.push(`missing alias "${alias}" → "${expected}"`);
      } else if (got !== expected) {
        problems.push(`alias "${alias}" → "${got}", expected "${expected}"`);
      }
    }
    if (problems.length > 0) {
      fail("COUNTRIES ↔ COUNTRY_HUB_ALIASES parity", problems.join(" · "));
    } else {
      ok(
        `COUNTRIES ↔ COUNTRY_HUB_ALIASES parity (${Object.keys(COUNTRIES).length} alpha-2 aliases present in next.config.ts)`,
      );
    }
  }
}

// --- 9. category is a known enum value ---
const CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));
for (const v of VENDORS) {
  if (!CATEGORIES.has(v.category)) {
    fail("category is known enum", `${v.handle}: '${v.category}'`);
  }
}

// --- 10. Circular-economy enrichment fields (Phase 1A) ---
// All optional · only validate format when present. Names are
// suffixed with _ENRICH to avoid clashing with the LN/NPUB regexes
// used for handle validation earlier in the file.
const LN_ADDRESS_RE_ENRICH = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const NPUB_RE_ENRICH = /^npub1[a-z0-9]+$/;
// Website URL · HTTPS-only (audit 2026-05 · validator/endpoint
// parity). This used to tolerate http:// ("for legacy fields if
// any"), but `website` is the ONLY consumer and the public
// /api/submit-vendor path already rejects non-https websites
// ("website must be an https:// URL"). The laxer commit-time
// validator was the weak gate: a hand-edited or kind:0-enriched
// http:// website renders as an outbound "Visit shop →" link on the
// HTTPS site → mixed-content downgrade, MITM-tamperable destination,
// and visitor-IP leak to an unauthenticated origin (same rationale
// as HTTPS_RE_IMG below). All current entries (64 websites at this
// commit) are already https:// · zero migration cost.
const URL_RE_ENRICH = /^https:\/\/.+/;
// HTTPS-only · used for pictureUrl + founderPhoto. Image fields render
// inside <img src="…"> on the directory + /v/[slug] · serving via
// HTTP would (a) cause mixed-content warnings on the HTTPS site,
// (b) allow MITM tampering of the image payload, (c) leak the
// visitor's IP to an unauthenticated source. Tightening at validator
// time catches HTTP URLs at git-add (the operator can investigate
// before the vendor goes live) rather than at runtime when it's too
// late. All current entries (76 vendors at this commit) already
// satisfy this · zero migration cost.
const HTTPS_RE_IMG = /^https:\/\/.+/;
let enrichmentFailures = 0;
for (const v of VENDORS) {
  if (v.lightningAddress && !LN_ADDRESS_RE_ENRICH.test(v.lightningAddress)) {
    fail(
      "lightningAddress format",
      `${v.handle}: '${v.lightningAddress}' is not a valid Lightning Address (name@domain.tld)`,
    );
    enrichmentFailures++;
  }
  // "Also sold on" · every entry must survive alsoSoldOnLinks() (https,
  // marketplace host, one per marketplace), so nothing is silently dropped.
  if (v.alsoSoldOn) {
    const kept = alsoSoldOnLinks(v).length;
    if (kept !== v.alsoSoldOn.length) {
      fail(
        "alsoSoldOn format",
        `${v.handle}: ${v.alsoSoldOn.length - kept} alsoSoldOn entr(y/ies) rejected (need https on the marketplace's own host, one per marketplace)`,
      );
      enrichmentFailures++;
    }
  }
  if (v.nostrPubkey && !NPUB_RE_ENRICH.test(v.nostrPubkey)) {
    fail(
      "nostrPubkey format",
      `${v.handle}: '${v.nostrPubkey}' is not a valid bech32 npub (must start with 'npub1')`,
    );
    enrichmentFailures++;
  }
  if (v.website) {
    if (!URL_RE_ENRICH.test(v.website)) {
      fail(
        "website format",
        `${v.handle}: '${v.website}' must be a https:// URL (HTTPS-only · matches the /api/submit-vendor rule · prevents mixed-content + MITM + visitor-IP leak on the outbound shop link)`,
      );
      enrichmentFailures++;
    } else {
      // Parity with /api/submit-vendor + pictureUrl · SSRF/private-range
      // hosts must not land as live "Visit shop" anchors (audit 2026-07-09).
      const validation = validateOutboundUrl(v.website);
      if (!validation.ok) {
        fail(
          "website SSRF",
          `${v.handle}: '${v.website}' rejected by SSRF guard · ${validation.reason}`,
        );
        enrichmentFailures++;
      }
    }
  }
  if (v.interestedIn) {
    for (const c of v.interestedIn) {
      if (!CATEGORIES.has(c)) {
        fail(
          "interestedIn category",
          `${v.handle}: '${c}' is not a known category`,
        );
        enrichmentFailures++;
      }
    }
  }
  // pictureUrl · brand logo · HTTPS-only. The X-vendor fallback
  // (unavatar.io/x/<handle>) is dynamic and always HTTPS · this
  // check applies only to entries that explicitly set the field.
  // Audit 2026-05-22 (M5): the prefix-only regex was upgraded to
  // validateOutboundUrl which adds RFC1918 / loopback / link-local /
  // metadata-host / IPv6-literal / alt-port checks. A malicious entry
  // like `https://192.168.1.1/avatar.jpg` would pass the regex but
  // fail validateOutboundUrl · catches the rare case where a hostile
  // PR or hand-edit slips a private-network URL into a render path.
  if (v.pictureUrl) {
    if (!HTTPS_RE_IMG.test(v.pictureUrl)) {
      fail(
        "pictureUrl format",
        `${v.handle}: '${v.pictureUrl}' must be a https:// URL (image fields are HTTPS-only · prevents mixed-content + MITM tampering of the image)`,
      );
      enrichmentFailures++;
    } else {
      const validation = validateOutboundUrl(v.pictureUrl);
      if (!validation.ok) {
        fail(
          "pictureUrl SSRF",
          `${v.handle}: '${v.pictureUrl}' rejected by SSRF guard · ${validation.reason}`,
        );
        enrichmentFailures++;
      }
    }
  }
  // founderPhoto · the human face of the vendor (DISTINCT from
  // pictureUrl, which is the brand logo). HTTPS-only for the same
  // reasons as pictureUrl. Operator-curated · the validator catch
  // is the trust boundary before the URL becomes a render target.
  // Same SSRF-guard upgrade as pictureUrl above · audit M5.
  if (v.founderPhoto) {
    if (!HTTPS_RE_IMG.test(v.founderPhoto)) {
      fail(
        "founderPhoto format",
        `${v.handle}: '${v.founderPhoto}' must be a https:// URL (image fields are HTTPS-only)`,
      );
      enrichmentFailures++;
    } else {
      const validation = validateOutboundUrl(v.founderPhoto);
      if (!validation.ok) {
        fail(
          "founderPhoto SSRF",
          `${v.handle}: '${v.founderPhoto}' rejected by SSRF guard · ${validation.reason}`,
        );
        enrichmentFailures++;
      }
    }
  }
  // quote · cap at 240 chars · longer-than-tweet but still
  // scannable. The render uses it as a styled blockquote with
  // founderName attribution; very long quotes break the visual
  // hierarchy of the page.
  if (v.quote !== undefined) {
    if (typeof v.quote !== "string") {
      fail(
        "quote type",
        `${v.handle}: quote must be a string when present`,
      );
      enrichmentFailures++;
    } else if (v.quote.length > 240) {
      fail(
        "quote length",
        `${v.handle}: quote is ${v.quote.length} chars (max 240)`,
      );
      enrichmentFailures++;
    } else if (v.quote.trim().length === 0) {
      fail(
        "quote empty",
        `${v.handle}: quote is whitespace-only (omit instead)`,
      );
      enrichmentFailures++;
    }
  }
}
if (enrichmentFailures === 0) {
  ok("circular-economy enrichment fields well-formed (where present)");
}

// --- Avatar snapshot drift guard ---
// src/lib/avatar-manifest.json indexes the committed X-vendor avatar
// snapshots under public/avatars/x/ (written by
// scripts/snapshot-avatars.ts · consumed by xAvatarSrc in
// src/lib/avatars.ts). Three drift modes would ship broken UI or
// stale bytes, so all are commit-blockers:
//   1. manifest entry → missing file  = broken <img> on every surface
//      that renders that vendor (the local path 404s, and the
//      client-side onError chip can't distinguish it from a dead
//      handle)
//   2. file → no manifest entry       = dead weight in the repo that
//      silently never renders
//   3. manifest entry → vendor gone   = orphaned snapshot outliving
//      its vendor
// Fix for all three: npx tsx scripts/snapshot-avatars.ts --prune
// (then re-run the snapshot script if a legit avatar got dropped).
{
  const AVATAR_DIR = "public/avatars/x";
  const activeXKeys = new Set(
    VENDORS.filter((v) => getPlatform(v) === "x").map((v) =>
      v.handle.toLowerCase(),
    ),
  );
  const manifest: Record<string, string> = AVATAR_MANIFEST;
  const files = new Set(
    existsSync(AVATAR_DIR)
      ? readdirSync(AVATAR_DIR).filter((f) => !f.startsWith("."))
      : [],
  );
  let avatarFailures = 0;
  for (const [key, p] of Object.entries(manifest)) {
    const expectedPrefix = `/avatars/x/${key}.`;
    if (key !== key.toLowerCase() || !p.startsWith(expectedPrefix)) {
      fail(
        "avatar manifest shape",
        `'${key}' → '${p}' · keys must be lowercase handles and paths must be ${expectedPrefix}<ext>`,
      );
      avatarFailures++;
      continue;
    }
    const basename = p.slice("/avatars/x/".length);
    if (!files.has(basename)) {
      fail(
        "avatar manifest → file",
        `'${key}' → '${p}' but ${AVATAR_DIR}/${basename} does not exist (would 404 sitewide) · run snapshot-avatars.ts --prune`,
      );
      avatarFailures++;
    }
    if (!activeXKeys.has(key)) {
      fail(
        "avatar manifest → vendor",
        `'${key}' has a snapshot but no matching X vendor in vendors.ts · run snapshot-avatars.ts --prune`,
      );
      avatarFailures++;
    }
  }
  const manifestBasenames = new Set(
    Object.values(manifest).map((p) => p.slice("/avatars/x/".length)),
  );
  for (const f of files) {
    if (!manifestBasenames.has(f)) {
      // iCloud duplicate, not a stale snapshot. The repo lives on an
      // iCloud-synced Desktop which periodically clones a file as
      // "name 2.ext" — the same mechanism tsconfig.json already excludes
      // `* ?.ts` for. `--prune` is the WRONG remedy here (it drops
      // snapshots for REMOVED vendors, and this file belongs to a vendor
      // still on the roster), so say so rather than send the next reader
      // down that path. Caught in the wild 2026-08-08 as
      // "galaxymind 2.jpg", byte-identical to the tracked original.
      const icloudDupe = / \d+\.(?:jpg|jpeg|png|webp|gif)$/i.test(f);
      fail(
        "avatar file → manifest",
        icloudDupe
          ? `${AVATAR_DIR}/${f} looks like an iCloud duplicate (untracked "name N.ext" clone) · delete the file; do NOT run --prune`
          : `${AVATAR_DIR}/${f} has no manifest entry (never renders) · run snapshot-avatars.ts --prune`,
      );
      avatarFailures++;
    }
  }
  if (avatarFailures === 0) {
    ok(
      `avatar snapshots consistent (${Object.keys(manifest).length} local · ${activeXKeys.size} X vendors)`,
    );
  }
}

// Shop-shelf imagery · optional per vendor (millboard plate is the
// first-class no-photo state). A manifest entry MUST have a file, and
// a file MUST have a manifest entry, or the grid 404s / carries dead
// bytes. Missing vendors are fine.
{
  const SHELF_DIR = "public/vendor-shelves";
  // Keyed by listing (slug) since 2026-10 · see lib/shelves.ts.
  const slugKeys = new Set(VENDORS.map((v) => vendorSlug(v)));
  const shelves = SHELF_MANIFEST as Record<string, { src: string; kind: string }>;
  const files = new Set(
    existsSync(SHELF_DIR)
      ? readdirSync(SHELF_DIR).filter((f) => !f.startsWith("."))
      : [],
  );
  let shelfFails = 0;
  for (const [key, entry] of Object.entries(shelves)) {
    if (!entry?.src?.startsWith("/vendor-shelves/")) {
      fail("shelf manifest shape", `'${key}' path must start /vendor-shelves/`);
      shelfFails++;
      continue;
    }
    const basename = entry.src.slice("/vendor-shelves/".length);
    if (!files.has(basename)) {
      fail(
        "shelf manifest → file",
        `'${key}' → ${entry.src} missing on disk`,
      );
      shelfFails++;
    }
    if (!slugKeys.has(key)) {
      fail(
        "shelf manifest → vendor",
        `'${key}' is not a live vendor slug · prune or re-key it`,
      );
      shelfFails++;
    }
  }
  const named = new Set(
    Object.values(shelves).map((e) => e.src.slice("/vendor-shelves/".length)),
  );
  for (const f of files) {
    if (!named.has(f)) {
      fail("shelf file → manifest", `${SHELF_DIR}/${f} has no manifest entry`);
      shelfFails++;
    }
  }
  if (shelfFails === 0) {
    ok(
      `shop shelves consistent (${Object.keys(shelves).length} local of ${VENDORS.length})`,
    );
  }
}

// --- House listing must link the rental page ---
// The directory row for our own fleet is how a visitor who landed on
// "spend bitcoin" discovers the revenue product. It used to store the
// URL in `shopUrl` while every renderer read `website`, so /v and the
// modal had no rent CTA. vendorWebsite() is the render field; this
// pins the destination.
{
  const house = VENDORS.find((v) => v.handle === HOUSE_HANDLE);
  if (!house) {
    fail("house listing present", `no vendor with handle ${HOUSE_HANDLE}`);
  } else {
    const shop = vendorWebsite(house);
    if (shop === "https://galaxymind.space/hashrate") {
      ok("house listing shop URL is /hashrate");
    } else {
      fail(
        "house listing shop URL is /hashrate",
        `${HOUSE_HANDLE}: vendorWebsite()=${shop ?? "(none)"}`,
      );
    }
  }
}

// --- Report ---
const failures = checks.filter((c) => !c.ok);
const passes = checks.filter((c) => c.ok);

console.log(`\n${passes.length} passed:`);
for (const c of passes) console.log(`  PASS  ${c.label}`);

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILED:`);
  for (const c of failures) console.log(`  FAIL  ${c.label}\n        ${c.detail}`);
  console.log(`\n${VENDORS.length} vendors checked. ❌ ${failures.length} failures.`);
  process.exit(1);
}
console.log(`\n${VENDORS.length} vendors checked. ✓ all clean.`);
