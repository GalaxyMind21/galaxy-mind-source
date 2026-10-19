// Drift guard for public/llms.txt · the canonical agent-readable file.
//
// llms.txt's entire value proposition is "every number here matches the
// live tools, cite it directly." A stale canonical file is WORSE than
// none · it tells answer engines to cite wrong numbers. This asserts the
// drift-prone facts (glossary term count, degraded threshold, key page
// list) against the actual code, so the file can never silently lie.
//
// Run in the validator suite before shipping (alongside the other
// scripts/check-*.ts). Exits non-zero on any drift.

import { readFileSync } from "fs";
import { join } from "path";
import { ALL_TERMS } from "../src/lib/glossary";
import { STALE_THRESHOLD_DAYS, VENDORS, VENDOR_BADGE } from "../src/lib/vendors";
import { INDEPENDENCE_CLAIM } from "../src/lib/listing";
import { MRR_REFERRAL_ID } from "../src/lib/mrr";
import {
  DEGRADED_NULL_THRESHOLD,
  WEIGHT_BEARING_SIGNAL_COUNT,
} from "../src/lib/snapshot-quality";

const txt = readFileSync(join(process.cwd(), "public/llms.txt"), "utf8");
const errors: string[] = [];
const warnings: string[] = [];
// `--strict` (the freshness-CI invocation) promotes soft freshness
// warnings to hard failures; the default run keeps them advisory so a
// soft date never blocks a local build.
const STRICT = process.argv.includes("--strict");
const STALE_DAYS = 120; // review the llms.txt prose at least this often

// 1 · Glossary term count · e.g. "(23 DefinedTerm nodes)".
const termMatch = txt.match(/\((\d+)\s+DefinedTerm nodes\)/);
if (!termMatch) {
  errors.push('could not find a "(N DefinedTerm nodes)" claim in llms.txt');
} else if (Number(termMatch[1]) !== ALL_TERMS.length) {
  errors.push(
    `glossary term count: llms.txt says ${termMatch[1]}, code has ${ALL_TERMS.length} (src/lib/glossary.ts ALL_TERMS)`,
  );
}

// 2 · Degraded threshold · every phrasing ("≥N of M weight-bearing" and
//     "N or more of the M weight-bearing") must match the engine's real
//     numerator/denominator from snapshot-quality.ts.
const thresholdRe =
  /(?:≥\s*(\d+)\s+of\s+(\d+)|(\d+)\s+or more of the\s+(\d+))\s+weight-bearing/g;
let thresholdHits = 0;
for (const match of txt.matchAll(thresholdRe)) {
  thresholdHits++;
  const num = Number(match[1] ?? match[3]);
  const den = Number(match[2] ?? match[4]);
  if (num !== DEGRADED_NULL_THRESHOLD || den !== WEIGHT_BEARING_SIGNAL_COUNT) {
    errors.push(
      `degraded threshold: llms.txt states "${num} of ${den}", code is "${DEGRADED_NULL_THRESHOLD} of ${WEIGHT_BEARING_SIGNAL_COUNT}" (src/lib/snapshot-quality.ts)`,
    );
  }
}
if (thresholdHits === 0) {
  errors.push("could not find any degraded-threshold statement in llms.txt");
}

// 3 · Key pages agents should be able to discover must be referenced.
//     Add new high-value pages here AND in llms.txt together.
const REQUIRED_PAGES = [
  "/stack",
  "/today",
  "/pulse",
  "/map",
  "/arcade",
  "/super-saylor",
  "/gauntlet",
  "/runner",
  "/wen",
  "/trail",
  "/horizon",
  "/treasuries",
  "/fit",
  "/float",
  "/hashrate",
  "/hashrate/agents",
  "/hashrate/how-to-rent",
  "/solo-mining-calculator",
  "/lottery-mining-bitcoin",
  "/mstr-vs-bitcoin",
  "/ibit-vs-mstr",
  "/cheapest-bitcoin-treasury",
  "/bitcoin-treasuries-below-nav",
  "/what-is-amplification",
  "/gross-vs-net-mnav",
  "/treasuries/methodology",
  "/treasuries/compare",
  "/should-i-buy-bitcoin",
  "/is-it-too-late-to-buy-bitcoin",
  "/nostr-vendors",
  "/nostr-marketplaces",
  "/spend-and-replace",
  "/how-to-help-grow-bitcoin",
  "/how-to-accept-bitcoin",
  "/how-to-pay-with-lightning",
  "/learn",
  "/how-to-buy-bitcoin",
  "/online-stores-that-accept-bitcoin",
  "/spend-bitcoin-in-latin-america",
  "/buy-coffee-with-bitcoin",
  "/state-of-bitcoin-directories",
  "/how-many-businesses-accept-bitcoin",
  "/glossary",
  "/methodology",
  "/about",
  "/faq",
  "/embed",
  "/badge",
];
for (const p of REQUIRED_PAGES) {
  if (!txt.includes(p)) {
    errors.push(`page not referenced in llms.txt: ${p}`);
  }
}

// 3b · Vendor count band · the directory line reads "N+ merchants".
//      "N+" must stay true (roster >= N) but also close enough that a
//      citing agent isn't off by double digits: nag once the roster is
//      more than 20 past the floor. (Audit 2026-07-12: the line said
//      "110+" while the live roster was 123 — technically true, 12%
//      under on a file whose pitch is precision.)
const countMatch = txt.match(/Vendor Directory\]\([^)]*\):\s*(\d+)\+ merchants/);
if (!countMatch) {
  errors.push('could not find the "N+ merchants" directory line in llms.txt');
} else {
  const floor = Number(countMatch[1]);
  if (VENDORS.length < floor) {
    errors.push(
      `llms.txt claims "${floor}+ merchants" but the roster has only ${VENDORS.length}`,
    );
  } else if (VENDORS.length - floor > 20) {
    errors.push(
      `llms.txt "${floor}+ merchants" has drifted ${VENDORS.length - floor} behind the roster (${VENDORS.length}) — bump the floor`,
    );
  }
}

// 3c · Country count · same class of drift as 3b, but EXACT rather than
//      a band: the line reads "across N countries" with no "+", so it is
//      a flat claim and any deviation is simply wrong. (Audit 2026-07-29:
//      it said "~19" while the roster covered 20.)
//
//      The `\s+` is load-bearing, not cosmetic — llms.txt hard-wraps and
//      this phrase currently breaks between "across 20" and "countries",
//      so a regex using a literal space silently never matches and the
//      guard passes while asserting nothing. Same failure mode the
//      not-found branch below exists to catch.
const liveCountries = new Set(
  VENDORS.map((v) => v.country).filter(Boolean),
).size;
const countryMatch = txt.match(/across\s+~?(\d+)\s+countries/);
if (!countryMatch) {
  errors.push('could not find the "across N countries" line in llms.txt');
} else if (Number(countryMatch[1]) !== liveCountries) {
  errors.push(
    `llms.txt says "across ${countryMatch[1]} countries" but the roster covers ${liveCountries}`,
  );
}

// 3d · MCP tool count + names · the route file is the source of truth.
//      llms.txt said "9 read-only tools" while the live route had 10
//      (2026-08-06 audit) and nothing caught it — this kills the class.
const mcpRoute = readFileSync(
  join(process.cwd(), "src/app/api/mcp/[transport]/route.ts"),
  "utf8",
);
// Phase 2 rental tools register from src/lib/rentals/phase2/mcp.ts (PHASE2_TOOL_NAMES).
const phase2Src = readFileSync(join(process.cwd(), "src/lib/rentals/phase2/mcp.ts"), "utf8");
const phase2Tools = [...phase2Src.matchAll(/server\.tool\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
// RENTALS_MODE=mrr_only is the default (2026-10-17, MCP 3.0.0): create_rental and cancel_rental stay in the source for
// the reversible direct mode but are not registered, so llms.txt describes the live default surface.
const MRR_ONLY_REMOVED = ["create_rental", "cancel_rental"];
const registeredTools = [...new Set([...mcpRoute.matchAll(/server\.tool\(\s*"([a-z_]+)"/g)].map(
  (m) => m[1],
).concat(phase2Tools))].filter((t) => !MRR_ONLY_REMOVED.includes(t));
// get_rental_status counts as write: while unpaid it re-checks the payment, which can start the rental or queue a refund (review #106 N6).
const WRITE_TOOLS = ["get_rental_status"];
if (registeredTools.length === 0) {
  errors.push("could not parse any server.tool registrations from the MCP route");
}
const mcpCountMatch = txt.match(/as\s+(\d+)\s+tools\s+\((\d+)\s+read-only,\s+(\d+)\s+write\)/);
if (!mcpCountMatch) {
  errors.push('could not find the "as N tools (R read-only, W write)" MCP line in llms.txt');
} else if (Number(mcpCountMatch[1]) !== registeredTools.length || Number(mcpCountMatch[3]) !== WRITE_TOOLS.length || Number(mcpCountMatch[2]) !== registeredTools.length - WRITE_TOOLS.length) {
  errors.push(
    `llms.txt says ${mcpCountMatch[0]}, the server registers ${registeredTools.length} (${WRITE_TOOLS.length} write)`,
  );
}
for (const tool of registeredTools) {
  if (!txt.includes(tool)) {
    errors.push(`MCP tool not named in llms.txt: ${tool}`);
  }
}

// 3e · Every OpenAPI-documented endpoint appears in llms.txt · the
//      /api/hashrate incident (advertised endpoint absent from every
//      discovery surface) is the canonical failure this prevents.
const openapiSrc = readFileSync(
  join(process.cwd(), "src/app/api/openapi.json/route.ts"),
  "utf8",
);
const documentedPaths = [...openapiSrc.matchAll(/"(\/api\/[^"]+)":\s*\{/g)].map(
  (m) => m[1],
);
if (documentedPaths.length === 0) {
  errors.push("could not parse any paths from the OpenAPI route");
}
for (const p of documentedPaths) {
  if (!txt.includes(p)) {
    errors.push(`OpenAPI-documented endpoint missing from llms.txt: ${p}`);
  }
}

// 3f · Vendor-badge wording · the SVG sits on a merchant's own site,
//      so llms.txt must describe the live shop-facing copy, not the
//      retired "Pays in Bitcoin · verified" payroll phrasing.
const badgeLive = `"${VENDOR_BADGE.label} · ${VENDOR_BADGE.live}"`;
const badgeStale = `"${VENDOR_BADGE.stale}"`;
if (!txt.includes(badgeLive)) {
  errors.push(`vendor badge live copy missing from llms.txt: ${badgeLive}`);
}
if (!txt.includes(badgeStale)) {
  errors.push(`vendor badge stale copy missing from llms.txt: ${badgeStale}`);
}
if (!txt.includes(`${STALE_THRESHOLD_DAYS}-day window`)) {
  errors.push(
    `vendor badge stale window: llms.txt should name the ${STALE_THRESHOLD_DAYS}-day window (STALE_THRESHOLD_DAYS)`,
  );
}

// 3g · Independence claim · bitcoin.org listed the directory on the
//      condition it stays a curated spend map, not an affiliate portal.
//      llms.txt must keep the same words the pages quote from listing.ts.
if (!txt.includes(INDEPENDENCE_CLAIM)) {
  errors.push(
    `independence claim missing from llms.txt: "${INDEPENDENCE_CLAIM}" (src/lib/listing.ts)`,
  );
}
if (MRR_REFERRAL_ID != null) {
  if (!/MiningRigRentals[\s\S]{0,120}referral|referral[\s\S]{0,120}MiningRigRentals/i.test(txt)) {
    errors.push(
      "MRR_REFERRAL_ID is set but llms.txt does not disclose the MiningRigRentals referral",
    );
  }
  if (/no marketplace referral cut/i.test(txt)) {
    errors.push(
      "llms.txt still claims no marketplace referral cut while MRR_REFERRAL_ID is set",
    );
  }
}

// 3h · Advertised public JSON must be crawlable. llms.txt and OpenAPI
//      naming an endpoint is not enough if robots.txt Disallow /api/
//      hides it from Googlebot (the /api/openapi.json incident, again).
//      Includes hashrate, history, and subscriber-count (2026-09-09).
const robotsSrc = readFileSync(join(process.cwd(), "src/app/robots.ts"), "utf8");
for (const p of ["/api/hashrate", "/api/hashrate/quote", "/api/history", "/api/subscriber-count"]) {
  if (!robotsSrc.includes(`"${p}"`)) {
    errors.push(
      `robots.ts PUBLIC_DATA_ENDPOINTS missing ${p} (llms.txt advertises it)`,
    );
  }
}

// 4 · Freshness · the asserted numbers above can all pass while the
//     surrounding prose silently goes stale. The "Last refreshed <date>"
//     line is the operator's checkpoint. Soft by default; --strict makes
//     it fatal so a CI freshness job can flag it. (Live readings are not
//     baked in · llms.txt deliberately points agents at the live APIs,
//     so this guards prose freshness, not numbers.)
const refreshedMatch = txt.match(/Last refreshed\s+([A-Z][a-z]+ \d{1,2}, \d{4})/);
if (!refreshedMatch) {
  warnings.push('could not find a "Last refreshed <date>" line in llms.txt');
} else {
  const refreshed = new Date(refreshedMatch[1]);
  if (Number.isNaN(refreshed.getTime())) {
    warnings.push(`could not parse "Last refreshed ${refreshedMatch[1]}"`);
  } else {
    const ageDays = Math.floor((Date.now() - refreshed.getTime()) / 86_400_000);
    if (ageDays > STALE_DAYS) {
      warnings.push(
        `"Last refreshed ${refreshedMatch[1]}" is ${ageDays} days old (> ${STALE_DAYS}d) · review the prose and bump the date`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(
    "✗ llms.txt is out of sync with the code:\n" +
      errors.map((e) => "  - " + e).join("\n"),
  );
  console.error("\nUpdate public/llms.txt to match, then re-run.");
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn(
    "⚠ llms.txt freshness:\n" + warnings.map((w) => "  - " + w).join("\n"),
  );
  if (STRICT) {
    console.error("\n--strict: treating freshness warnings as failures.");
    process.exit(1);
  }
}

console.log(
  `✓ llms.txt in sync · ${ALL_TERMS.length} glossary terms, degraded ≥${DEGRADED_NULL_THRESHOLD}/${WEIGHT_BEARING_SIGNAL_COUNT}, ${REQUIRED_PAGES.length} key pages listed, ${registeredTools.length} MCP tools`,
);