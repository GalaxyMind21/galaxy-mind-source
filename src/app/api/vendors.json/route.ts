// GET /api/vendors.json
//
// Public vendor directory in JSON form. Two contracts:
//
//   v1 (default, no query params): the full vendor list as a flat
//   array. Stable schema · field names match the Vendor type in
//   src/lib/vendors.ts.
//
//   v2 (query params present): filtered subset for embedders who
//   want to render a custom widget (e.g. "Bitcoin food vendors in
//   Germany"). Filters compose · category=consumables&country=DE
//   returns vendors that match BOTH.
//
// Filtering query params (all optional):
//   - category=apparel | general-goods | hardware | consumables | collectibles | services | books
//   - country=US | DE | GB | ... (ISO 3166-1 alpha-2)
//   - platform=x | nostr | lightning
//   - since=YYYY-MM-DD · vendors with verifiedAt >= midnight UTC of that date
//   - limit=N · cap response to first N vendors (after filtering, sort by addedAt desc)
//
// Response shape:
//   {
//     "version": 1 | 2,
//     "count": <number of vendors in `vendors`>,
//     "totalAvailable": <total before filter/limit>,
//     "filters": { applied filter params, omitted if none },
//     "asOf": <ISO timestamp>,
//     "vendors": [ ... ]
//   }
//
// CORS: Access-Control-Allow-Origin: * so any third-party site can
// fetch this from the browser to render their own vendor widgets.
// This is a read-only public dataset · CORS is the right call.
//
// Cache: 5 min edge cache. Vendor data changes only on commit/deploy
// so longer cache wouldn't hurt, but 5 min is the same cadence as
// /api/treasuries and gives a consistent feel.

import { NextRequest, NextResponse } from "next/server";
import {
  VENDORS,
  filterActive,
  vendorSiblings,
  vendorSlug,
  vendorWebsite,
  CATEGORY_LABELS,
  type Vendor,
  type VendorCategory,
  type VendorPlatform,
} from "@/lib/vendors";

export const revalidate = 300;

// Same constant + name the MCP twin uses (api/mcp/[transport]/route.ts),
// so the two agent-facing surfaces answer identically.
const SITE = "https://galaxymind.space";

// Explicit public projection (audit 2026-05). This route previously
// spread the raw Vendor object into the response, which meant:
//   (a) `shopUrl` (documented as latent metadata · explicitly NOT
//       linked from the UI · `website` is its public promoted form)
//       and the deprecated, never-displayed `paymentNote` leaked
//       into the public dataset, and
//   (b) ANY field later added to the Vendor type — e.g. an internal
//       contact, a private operations note — would auto-export the
//       day it was added, with no review gate.
// Building the object field-by-field (an ALLOWLIST · never `...v`)
// makes the public contract intentional and leak-proof: a new Vendor
// field is invisible here until someone explicitly adds it below.
type PublicVendor = {
  // The identity that runs the shop. NOT unique since 2026-10: one
  // handle may own several listings · key rows by `slug`.
  handle: string;
  // Stable listing id (added 2026-10) · the /v/{slug} page, same value
  // `url` ends in. Additive: no existing field changed.
  slug: string;
  // Other listings run by the same identity · present only when the
  // handle owns more than one (absent for single-shop handles).
  siblings?: { name: string; slug: string; url: string }[];
  platform: VendorPlatform;
  name: string;
  description: string;
  category: VendorCategory;
  // Canonical Galaxy Mind page for this vendor (added 2026-07-25).
  // Derived, not stored — the same value the MCP twin returns as
  // `pageUrl` and the sitemap/feed emit. Without it an agent answering
  // "where can I spend bitcoin on X" had only the vendor's own
  // `website` to cite, so the curation came from here and the
  // attribution went there. llms.txt used to tell agents to DERIVE the
  // slug ("lowercase, hyphenated"), which is a guess that breaks on
  // punctuation — "Sat's Oil" is /v/sat-s-oil, not /v/sats-oil.
  url: string;
  addedAt: number;
  // Day the vendor was first listed (unix seconds, UTC midnight);
  // unaffected by re-verification. Immutable once set — distinct from
  // verifiedAt, which moves every time a human re-confirms the vendor.
  listedAt: number;
  verifiedAt: number;
  country?: string;
  website?: string;
  founderName?: string;
  founderPhoto?: string;
  quote?: string;
  lightningAddress?: string;
  nostrPubkey?: string;
  pictureUrl?: string;
  shipsInternational?: boolean;
  acceptsOnChain?: boolean;
  acceptsLightning?: boolean;
  // NOTE: tradeFriendly / interestedIn are intentionally NOT projected.
  // The barter feature + its UI were removed May 2026; the Vendor
  // fields are kept as dormant data but, like shopUrl/paymentNote,
  // are excluded from this public allowlist so the JSON contract only
  // advertises live, surfaced fields.
};

// Conditional spreads (same idiom as `...(hasFilters ? {filters} : {})`
// below) omit undefined optionals entirely, preserving the prior
// behavior where absent fields simply weren't present in the JSON.
function toPublicVendor(v: Vendor): PublicVendor {
  const website = vendorWebsite(v);
  const siblings = vendorSiblings(v);
  return {
    handle: v.handle,
    slug: vendorSlug(v),
    ...(siblings.length > 0
      ? {
          siblings: siblings.map((s) => ({
            name: s.name,
            slug: vendorSlug(s),
            url: `${SITE}/v/${vendorSlug(s)}`,
          })),
        }
      : {}),
    // Make the implicit "x" default explicit + stable for embedders.
    platform: v.platform ?? "x",
    name: v.name,
    description: v.description,
    category: v.category,
    url: `${SITE}/v/${vendorSlug(v)}`,
    addedAt: v.addedAt,
    listedAt: v.listedAt,
    verifiedAt: v.verifiedAt,
    ...(v.country !== undefined ? { country: v.country } : {}),
    ...(website !== undefined ? { website } : {}),
    ...(v.founderName !== undefined ? { founderName: v.founderName } : {}),
    ...(v.founderPhoto !== undefined ? { founderPhoto: v.founderPhoto } : {}),
    ...(v.quote !== undefined ? { quote: v.quote } : {}),
    ...(v.lightningAddress !== undefined
      ? { lightningAddress: v.lightningAddress }
      : {}),
    ...(v.nostrPubkey !== undefined ? { nostrPubkey: v.nostrPubkey } : {}),
    ...(v.pictureUrl !== undefined ? { pictureUrl: v.pictureUrl } : {}),
    ...(v.shipsInternational !== undefined
      ? { shipsInternational: v.shipsInternational }
      : {}),
    ...(v.acceptsOnChain !== undefined
      ? { acceptsOnChain: v.acceptsOnChain }
      : {}),
    ...(v.acceptsLightning !== undefined
      ? { acceptsLightning: v.acceptsLightning }
      : {}),
    // tradeFriendly / interestedIn deliberately omitted — see
    // PublicVendor note above (barter feature removed May 2026).
  };
}

const VALID_CATEGORIES: ReadonlySet<VendorCategory> = new Set(
  Object.keys(CATEGORY_LABELS) as VendorCategory[],
);

const VALID_PLATFORMS: ReadonlySet<string> = new Set([
  "x",
  "nostr",
  "lightning",
]);

const COUNTRY_RE = /^[A-Z]{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 200;

type AppliedFilters = {
  category?: VendorCategory;
  country?: string;
  platform?: string;
  since?: string;
  limit?: number;
};

function parseFilters(req: NextRequest): {
  filters: AppliedFilters;
  errors: string[];
} {
  const url = new URL(req.url);
  const filters: AppliedFilters = {};
  const errors: string[] = [];

  const cat = url.searchParams.get("category");
  if (cat) {
    if (VALID_CATEGORIES.has(cat as VendorCategory)) {
      filters.category = cat as VendorCategory;
    } else {
      errors.push(
        `category must be one of: ${[...VALID_CATEGORIES].join(", ")}`,
      );
    }
  }

  const country = url.searchParams.get("country");
  if (country) {
    const upper = country.toUpperCase();
    if (COUNTRY_RE.test(upper)) {
      filters.country = upper;
    } else {
      errors.push("country must be a 2-letter ISO code (e.g. US, DE, GB)");
    }
  }

  const platform = url.searchParams.get("platform");
  if (platform) {
    if (VALID_PLATFORMS.has(platform)) {
      filters.platform = platform;
    } else {
      errors.push(
        `platform must be one of: ${[...VALID_PLATFORMS].join(", ")}`,
      );
    }
  }

  const since = url.searchParams.get("since");
  if (since) {
    if (!DATE_RE.test(since)) {
      errors.push("since must be in YYYY-MM-DD format");
    } else {
      // Roundtrip check (audit 2026-05-21 · MEDIUM): DATE_RE matches
      // shape only · `2026-13-40` or `2026-02-31` would pass and
      // Date.UTC silently rolls them forward (→ 2027-02-09 or
      // 2026-03-03). The since-filter would then return vendors
      // verified at a date the embedder didn't actually ask for.
      // Same defense the /api/og/stack route applies.
      const [y, m, d] = since.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (
        dt.getUTCFullYear() !== y ||
        dt.getUTCMonth() !== m - 1 ||
        dt.getUTCDate() !== d
      ) {
        errors.push("since is not a valid calendar date");
      } else {
        filters.since = since;
      }
    }
  }

  const limit = url.searchParams.get("limit");
  if (limit) {
    const n = Number.parseInt(limit, 10);
    if (Number.isFinite(n) && n > 0 && n <= MAX_LIMIT) {
      filters.limit = n;
    } else {
      errors.push(`limit must be an integer 1-${MAX_LIMIT}`);
    }
  }

  return { filters, errors };
}

function applyFilters(vendors: Vendor[], filters: AppliedFilters): Vendor[] {
  let out = vendors;
  if (filters.category) {
    out = out.filter((v) => v.category === filters.category);
  }
  if (filters.country) {
    out = out.filter((v) => v.country === filters.country);
  }
  if (filters.platform) {
    // Default platform is "x" when undefined · the source-of-truth
    // matches that convention (see getPlatform in lib/vendors.ts).
    out = out.filter((v) => (v.platform ?? "x") === filters.platform);
  }
  if (filters.since) {
    // since is YYYY-MM-DD interpreted as UTC midnight of that date.
    const [y, m, d] = filters.since.split("-").map(Number);
    const sinceSec = Date.UTC(y, m - 1, d) / 1000;
    out = out.filter((v) => v.verifiedAt >= sinceSec);
  }
  // Sort newest-first by addedAt before applying limit · embedders
  // who limit to N usually want the most-recent N.
  out = [...out].sort((a, b) => b.addedAt - a.addedAt);
  if (filters.limit) {
    out = out.slice(0, filters.limit);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const { filters, errors } = parseFilters(req);

  if (errors.length > 0) {
    return NextResponse.json(
      { ok: false, errors },
      {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
      },
    );
  }

  // Public-facing dormancy filter removed 2026-05-20 (operator
  // decision · customers don't care about "currently quiet,"
  // operator prunes truly-dead vendors periodically). The
  // ?includeDormant param is preserved as a no-op for backward
  // compat with any embedder pinning it.
  const activeUniverse = VENDORS;

  const hasFilters = Object.keys(filters).length > 0;
  const filtered = hasFilters
    ? applyFilters(activeUniverse, filters)
    : activeUniverse;

  return NextResponse.json(
    {
      version: hasFilters ? 2 : 1,
      count: filtered.length,
      totalAvailable: VENDORS.length,
      dormantHidden: 0,
      ...(hasFilters ? { filters } : {}),
      // Where this data came from · mirrors the MCP twin's field of the
      // same name so an agent citing either surface names the directory.
      directoryUrl: SITE,
      asOf: new Date().toISOString(),
      vendors: filtered.map(toPublicVendor),
    },
    {
      status: 200,
      headers: {
        // Public dataset, CORS-open so any embedder can fetch from
        // browser-side JS without proxying. This is the same posture
        // /api/treasuries and /api/heartbeat use.
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}

// Preflight · same CORS posture as the GET. Keeps embedders from
// hitting CORS errors on browser-side fetches with custom headers.
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}
