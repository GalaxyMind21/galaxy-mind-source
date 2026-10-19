// check-mrr-key-scope.ts · OPERATOR-RUN, answers ONE question with zero
// spend: does MRR's PUT /rental work with a key that CANNOT move funds?
// A third-party claim (oipwg/autominer-api README) said all scopes are
// required; the agent-rental copy must not ship key-scope advice until
// this is proven either way.
//
// WHAT WE KNOW FROM RUN 1 (2026-08-06, operator's live account): the key
// UI is per-group read/write/none (Balance·Withdraw /account, Rentals
// /rental, Rigs /rig) and /whoami reports a MIXED vocabulary:
// {withdraw:"read", rent:"yes", rigs:"read"}. A no-profile PUT /rental
// with that key returned the VALIDATION error "Must specify a profile ID"
// — strong evidence the permission gate passed. This script's phase 2
// makes it conclusive: with a real pool-profile id, the lowball
// rate.price cap forces a PRICE refusal, which can only happen after the
// permission check passed end-to-end.
//
// How zero-spend works: PUT /rental takes rate.price as a FILTER — "it
// will use the rig's current price as long as it is <= this value"
// (apidocv2). We pass a rate.price far BELOW any real ask, so even when
// permissions pass, MRR refuses on price and no rental is created.
//   · permission-style error  → claim TRUE (withdraw-write needed)
//   · price/filter-style error → claim FALSE (fund-safe key rents)
//
// SAFETY: targets a THIRD-PARTY rig, never our own — self-rental can trip
// MRR's wash-trading detection (adversarial review 2026-08-06). It is the
// first third-party listing on the default-sorted page, not the cheapest
// one — the rate.price filter alone is what keeps this zero-spend.
//
// Usage:
//   MRR_API_KEY=... MRR_API_SECRET=... npx tsx scripts/check-mrr-key-scope.ts
//   # optional: pin the pool profile instead of auto-discovery
//   MRR_API_KEY=... MRR_API_SECRET=... MRR_PROFILE_ID=12345 npx tsx scripts/check-mrr-key-scope.ts
//
// If no sha256-family pool profile exists on the account, the script says
// so and falls back to the run-1 (no-profile) probe. Create one in the
// MRR UI (a pool at solo.ckpool.org + a profile on the SHA256 AsicBoost
// algo) and re-run — profile creation is deliberately NOT automated here:
// pool/profile endpoints live under /account, and quietly writing to the
// operator's account is not this probe's job.
//
// Auth (apidocv2): x-api-sign = HMAC-SHA1(key + nonce + endpoint, secret)
// where endpoint is the path WITHOUT /api/v2 and without a trailing
// slash, e.g. "/rental". Nonce must strictly increase per key.

import { createHmac } from "node:crypto";
import { parseRigRoster } from "../src/lib/fleet-ids";

const KEY = process.env.MRR_API_KEY ?? "";
const SECRET = process.env.MRR_API_SECRET ?? "";
const PROFILE_OVERRIDE = process.env.MRR_PROFILE_ID ?? "";
if (!KEY || !SECRET) {
  console.error("Set MRR_API_KEY and MRR_API_SECRET (a key whose Balance/Withdraw group is Read or None).");
  process.exit(2);
}

const BASE = "https://www.miningrigrentals.com/api/v2";
let lastNonce = Date.now() * 1000;
function nonce(): string {
  lastNonce += 1;
  return String(lastNonce);
}

async function call(
  method: "GET" | "PUT",
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const n = nonce();
  // Signed string is key + nonce + BARE PATH — no query string. Query
  // params ride the fetch URL only (apidocv2 + the official reference
  // client both sign the path alone).
  const path = endpoint.split("?")[0];
  const sign = createHmac("sha1", SECRET).update(KEY + n + path).digest("hex");
  const res = await fetch(BASE + endpoint, {
    method,
    headers: {
      "x-api-key": KEY,
      "x-api-nonce": n,
      "x-api-sign": sign,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, json };
}

(async () => {
  console.log("1 · GET /whoami — what scopes did MRR actually grant this key?");
  const who = await call("GET", "/whoami");
  console.log(JSON.stringify(who.json, null, 2));
  const perms = (who.json as { data?: { permissions?: Record<string, string> } })
    ?.data?.permissions;
  if (!perms) {
    console.error("Could not read permissions — check the key, secret, and clock, then re-run.");
    process.exit(1);
  }
  // Observed vocabulary is mixed ("read"/"yes"/…): treat anything that is
  // not clearly read-or-none as withdraw-capable and refuse — the whole
  // point is testing the fund-safe key.
  if (perms.withdraw === "yes" || perms.withdraw === "write") {
    console.error("This key's Balance/Withdraw group is write-capable. Mint one with Read or None there and re-run.");
    process.exit(1);
  }

  console.log("\n2 · GET /account/profile — looking for a sha256-family pool profile…");
  let profileId: string | null = PROFILE_OVERRIDE || null;
  if (profileId) {
    console.log(`   using MRR_PROFILE_ID=${profileId} (override)`);
  } else {
    const prof = await call("GET", "/account/profile");
    console.log(`   HTTP ${prof.status}`);
    console.log(JSON.stringify(prof.json, null, 2));
    const d = (prof.json as { data?: unknown })?.data;
    const list: Array<Record<string, unknown>> = Array.isArray(d)
      ? (d as Array<Record<string, unknown>>)
      : Array.isArray((d as { profiles?: unknown[] })?.profiles)
        ? ((d as { profiles: unknown[] }).profiles as Array<Record<string, unknown>>)
        : [];
    // EXACT algo match only. Run 2 (2026-08-06) proved a loose "sha256"
    // substring match grabs a plain-sha256 profile and MRR refuses with
    // "Profile type does not match rig type" — the profile's algo.name
    // must equal the rig's algo exactly.
    const hit = list.find(
      (p) => (p as { algo?: { name?: string } }).algo?.name === "sha256ab",
    );
    if (hit && hit.id != null) {
      profileId = String(hit.id);
      console.log(`   found sha256ab profile id ${profileId}${list.length > 1 ? ` (of ${list.length} profiles — first exact-algo match wins)` : ""}`);
    } else {
      console.log(
        "   no sha256ab profile found (or the list could not be read — " +
          "the raw response above says which). Falling back to the " +
          "no-profile probe; for the CONCLUSIVE run, create a pool + a " +
          "profile on the SHA256 AsicBoost algo in the MRR UI, then re-run.",
      );
    }
  }

  // The target is simply the first third-party listing on the default-
  // sorted page — no price sort (MRR's search returns invalid JSON on
  // unsupported orderby values; don't add one). Cheapness isn't required
  // for safety: the rate.price filter below pins the offer far below any
  // real ask, so the probe is zero-spend regardless of which rig it
  // lands on.
  console.log("\n3 · Finding a THIRD-PARTY sha256ab rig (never ours — wash-trade safety)…");
  // Every listing in GALAXY_MIND_RIG_IDS (set it in your shell to the Production value); the owner check below also applies.
  const OURS = new Set(parseRigRoster(process.env.GALAXY_MIND_RIG_IDS).ids);
  const search = await call("GET", "/rig?type=sha256ab&count=20&offset=0");
  const records = ((search.json as { data?: { records?: unknown[] } })?.data?.records ?? []) as Array<Record<string, unknown>>;
  const target = records.find((r) => !OURS.has(String(r.id)) && (r as { owner?: string }).owner !== "GalaxyMind");
  if (!target) {
    console.error(
      `   HTTP ${search.status}\n` + JSON.stringify(search.json, null, 2),
    );
    console.error(
      "No third-party rig found in the first page. Two possibilities: " +
        "(a) the page is genuinely empty/unreachable right now, or " +
        "(b) the search request itself was rejected (check the HTTP status " +
        "and body just printed for a permission/auth error rather than an " +
        "empty result). Re-run in a moment, and if it keeps failing, check " +
        "that MRR is reachable and the rig search response shape hasn't changed.",
    );
    process.exit(1);
  }
  // Run 3 (2026-08-06) hit "error with the duration": rigs set their own
  // minhours and MRR validates duration before price. Rent the rig's own
  // minimum window so the price filter is the only thing left to refuse.
  const minH = Number((target as { minhours?: unknown }).minhours);
  const length = Number.isFinite(minH) && minH > 0 ? minH : 3;
  console.log(
    `   target rig ${target.id} (owner ${(target as { owner?: string }).owner}, minhours ${Number.isFinite(minH) ? minH : "unknown"} → renting window ${length}h)`,
  );

  console.log(
    profileId
      ? "\n4 · PUT /rental WITH profile + rate.price pinned far below ask (CONCLUSIVE zero-spend probe)…"
      : "\n4 · PUT /rental with rate.price pinned far below ask (no profile on the account — validation-level probe)…",
  );
  const rental = await call("PUT", "/rental", {
    rig: Number(target.id),
    length,
    // Deliberately absurd lowball: the price FILTER refuses before any
    // charge. 1e-8 BTC/PH/day is ~50,000× under the market.
    rate: { type: "ph", price: 0.00000001 },
    ...(profileId ? { profile: Number(profileId) } : {}),
  });
  console.log(`   HTTP ${rental.status}`);
  console.log(JSON.stringify(rental.json, null, 2));

  console.log(
    "\nVERDICT GUIDE:\n" +
      "  · message mentions permission / not authorized / API key → claim TRUE: renting needs a withdraw-capable key. The agent copy must say so, with the address-book mitigation.\n" +
      (profileId
        ? "  · message mentions price / rate / below minimum → claim FALSE, CONCLUSIVELY: a fund-safe key (Balance Read/None + Rentals Write + Rigs Read) rents end-to-end. The scoped-key advice ships as written.\n"
        : "  · message mentions profile → the permission gate passed request validation; create a sha256 AsicBoost profile in the MRR UI and re-run for the conclusive price-refusal proof.\n") +
      "  · success:true (should be impossible at this price) → STOP and check your MRR account's rentals immediately.\n" +
      "Paste this whole output back into the session.",
  );
})();
