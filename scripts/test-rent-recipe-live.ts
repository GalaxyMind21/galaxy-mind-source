// test-rent-recipe-live.ts · OPERATOR-RUN. Does the recipe we PUBLISH
// actually work?
//
// Every other test in this repo checks our own code. This one checks our
// own DOCUMENTATION: it reads the live quote from production, then walks
// handoff.mrrApi step by step against MiningRigRentals exactly as an
// agent following those instructions would — same order, same params,
// same mandatory rate.price cap. If our published recipe is wrong, this
// fails in the same place an agent's would, before a stranger's money
// finds the bug for us.
//
// SPENDS REAL BITCOIN (a few dollars) unless --dry-run. Two guards:
//   · it prints the exact cost and requires a typed yes before the one
//     call that spends
//   · it targets a THIRD-PARTY rig by default, never our own —
//     self-rental can trip MRR's wash-trading detection. --our-rig
//     exists for the launch demo, where renting our own machine is the
//     point; it refuses to run without an explicit second confirmation.
//
// Usage:
//   MRR_API_KEY=... MRR_API_SECRET=... npx tsx scripts/test-rent-recipe-live.ts --dry-run
//   MRR_API_KEY=... MRR_API_SECRET=... npx tsx scripts/test-rent-recipe-live.ts
//
// Flags:
//   --dry-run        walk every step, stop before the rental (spends nothing)
//   --machine <id>   quote a specific Galaxy Mind machine (default: cheapest)
//   --hours <n>      rental window (default: the machine's own minimum)
//   --our-rig        rent OUR machine rather than a third party's (demo only)
//   --quote-url <u>  point at a different deployment (default: production)
//
// The key needs Rentals: Write, Rigs: Read, Balance/Withdraw: Read or
// None — the fund-safe shape scripts/check-mrr-key-scope.ts verified.

import { createHmac } from "node:crypto";
import { createInterface } from "node:readline/promises";

const KEY = process.env.MRR_API_KEY ?? "";
const SECRET = process.env.MRR_API_SECRET ?? "";
if (!KEY || !SECRET) {
  console.error(
    "Set MRR_API_KEY and MRR_API_SECRET (Rentals: Write, Rigs: Read, Balance/Withdraw: Read or None).",
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const DRY = has("--dry-run");
const OUR_RIG = has("--our-rig");
const QUOTE_URL = val("--quote-url") ?? "https://galaxymind.space/api/hashrate/quote";

const MRR = "https://www.miningrigrentals.com/api/v2";
let lastNonce = Date.now() * 1000;

async function mrr(
  method: "GET" | "PUT",
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  const n = String(++lastNonce);
  // Sign key + nonce + BARE path (no query string) — the contract our
  // own published `auth` string states.
  const path = endpoint.split("?")[0];
  const sign = createHmac("sha1", SECRET).update(KEY + n + path).digest("hex");
  const res = await fetch(MRR + endpoint, {
    method,
    headers: {
      "x-api-key": KEY,
      "x-api-nonce": n,
      "x-api-sign": sign,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

let failures = 0;
function step(n: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${n}${detail ? ` · ${detail}` : ""}`);
  else { failures++; console.error(`  ✗ ${n}${detail ? ` · ${detail}` : ""}`); }
}

async function confirm(question: string, expect: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer === expect;
}

(async () => {
  console.log("\n1 · Read the published quote (what an agent sees first)");
  const machineArg = val("--machine");
  const qs = new URLSearchParams({ machine: machineArg ?? "all" });
  const hoursArg = val("--hours");
  if (hoursArg) qs.set("hours", hoursArg);
  const qres = await fetch(`${QUOTE_URL}?${qs}`);
  const quote: any = await qres.json();
  step("quote endpoint answered", qres.status === 200, `HTTP ${qres.status}`);
  step("quote is not degraded", (quote.degraded?.length ?? 1) === 0, JSON.stringify(quote.degraded ?? "missing"));
  const api = quote.handoff?.mrrApi;
  step("quote carries the mrrApi recipe", Array.isArray(api?.steps) && api.steps.length > 0, `${api?.steps?.length ?? 0} steps`);
  if (failures) { console.error("\nThe quote itself is unusable; nothing further to test."); process.exit(1); }

  // Cheapest rentable machine, so the live test costs the least.
  const rentable = (quote.machines ?? []).filter((m: any) => m.machine.rentable && m.quote?.costBtc != null);
  step("at least one machine is rentable right now", rentable.length > 0, `${rentable.length} of ${quote.machines?.length ?? 0}`);
  if (rentable.length === 0) { console.error("\nEvery machine is rented. Re-run when one frees up."); process.exit(1); }
  const target = rentable.sort((a: any, b: any) => a.quote.costBtc - b.quote.costBtc)[0];
  console.log(`    quoted machine ${target.machine.id} · ${target.quote.quotedHours}h · ${target.quote.costBtc} BTC` +
    (target.quote.costUsd != null ? ` (~$${target.quote.costUsd.toFixed(2)})` : ""));

  console.log("\n2 · GET /whoami — the recipe's own first authenticated step");
  const who = await mrr("GET", "/whoami");
  const perms = who.json?.data?.permissions;
  step("key authenticates", who.json?.data?.authed === true, JSON.stringify(perms ?? who.json));
  step("key is fund-safe (withdraw is not write-capable)", perms?.withdraw !== "yes" && perms?.withdraw !== "write", `withdraw=${perms?.withdraw}`);
  step("key can rent", perms?.rent === "yes" || perms?.rent === "write", `rent=${perms?.rent}`);

  console.log("\n3 · GET /account — balance covers the quote");
  const acct = await mrr("GET", "/account");
  const balance = Number(acct.json?.data?.balance?.BTC?.confirmed ?? acct.json?.data?.balance?.BTC ?? NaN);
  step("balance readable", Number.isFinite(balance), `${balance} BTC`);
  step("balance covers the quoted cost", Number.isFinite(balance) && balance >= target.quote.costBtc,
    `need ${target.quote.costBtc}, have ${balance}`);

  console.log("\n4 · GET /account/profile — a profile on the rig's EXACT algo");
  const profs = await mrr("GET", "/account/profile");
  const list: any[] = Array.isArray(profs.json?.data) ? profs.json.data : [];
  const profile = list.find((p) => p?.algo?.name === "sha256ab");
  step("a sha256ab profile exists", profile != null,
    profile ? `id ${profile.id} · ${profile.name}` : `${list.length} profiles, none on sha256ab`);
  step("that profile has a pool attached", (profile?.pools?.length ?? 0) > 0,
    `${profile?.pools?.length ?? 0} pool(s)` + (profile?.pools?.[0] ? ` · ${profile.pools[0].host}` : ""));
  if (!profile) {
    console.error("\nCreate a pool + a SHA256 AsicBoost profile in the MRR UI (recipe steps 4-7), then re-run.");
    process.exit(1);
  }

  console.log("\n5 · Pick the rig to rent");
  let rigId = target.machine.id;
  if (!OUR_RIG) {
    const search = await mrr("GET", "/rig?type=sha256ab&count=20&offset=0");
    const records: any[] = search.json?.data?.records ?? [];
    const ours = new Set((quote.machines ?? []).map((m: any) => String(m.machine.id)));
    const third = records.find((r) => !ours.has(String(r.id)) && r.owner !== "GalaxyMind" && r?.status?.rented !== true);
    step("found a third-party rig (never our own · wash-trade safety)", third != null, third ? `rig ${third.id} · owner ${third.owner}` : "none available");
    if (!third) { console.error("\nNo third-party rig free right now. Re-run shortly, or use --our-rig for the demo."); process.exit(1); }
    rigId = String(third.id);
  } else {
    console.log("    --our-rig · renting OUR OWN machine. Only correct for a launch demo.");
  }

  const rig = await mrr("GET", `/rig/${rigId}`);
  const rigData = Array.isArray(rig.json?.data) ? rig.json.data[0] : rig.json?.data;
  const minH = Number(rigData?.minhours);
  const askBtc = Number(rigData?.price?.BTC?.price);
  const advPh = Number(rigData?.hashrate?.advertised?.hash) / (rigData?.hashrate?.advertised?.type === "th" ? 1000 : 1);
  const hours = hoursArg ? Number(hoursArg) : Number.isFinite(minH) && minH > 0 ? minH : 3;
  step("rig is live and priced", Number.isFinite(askBtc) && askBtc > 0, `ask ${askBtc} BTC/PH/day, min ${minH}h`);
  const costBtc = Number.isFinite(advPh) ? advPh * askBtc * (hours / 24) : NaN;
  console.log(`    renting rig ${rigId} for ${hours}h · estimated ${Number.isFinite(costBtc) ? costBtc.toFixed(8) : "?"} BTC`);

  if (DRY) {
    console.log("\n--dry-run · stopping before the rental. Nothing was spent.");
    console.log(`\n${failures === 0 ? "✓ every pre-flight step of the published recipe checks out" : `✗ ${failures} step(s) failed`}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  console.log("\n6 · PUT /rental — the one call that spends");
  console.log(`    rig ${rigId} · ${hours}h · profile ${profile.id} · price cap ${askBtc} BTC/PH/day`);
  console.log(`    estimated cost ${Number.isFinite(costBtc) ? costBtc.toFixed(8) : "?"} BTC` +
    (quote.machines?.[0]?.quote?.costUsd != null && Number.isFinite(costBtc)
      ? ` (~$${(costBtc * (quote.blockPrizeUsd / quote.blockPrizeBtc)).toFixed(2)})` : ""));
  if (OUR_RIG && !(await confirm("    Renting OUR OWN rig can trip wash-trade detection. Type 'demo' to accept: ", "demo"))) {
    console.log("    aborted."); process.exit(0);
  }
  if (!(await confirm("    Type 'rent' to spend: ", "rent"))) {
    console.log("    aborted. Nothing was spent."); process.exit(0);
  }

  // Exactly the shape the published recipe specifies: nested rate object,
  // price pinned to the live ask so a mid-flight reprice refuses.
  const rental = await mrr("PUT", "/rental", {
    rig: Number(rigId),
    length: hours,
    profile: Number(profile.id),
    rate: { type: "ph", price: askBtc },
  });
  console.log(`    HTTP ${rental.status}`);
  console.log(JSON.stringify(rental.json, null, 2));
  const rentalId = rental.json?.data?.id ?? rental.json?.data?.rental?.id;
  step("rental created", rental.json?.success === true && rentalId != null, rentalId ? `rental ${rentalId}` : rental.json?.data?.message ?? "no id");

  if (rentalId) {
    console.log("\n7 · GET /rental/{id} — verify, the recipe's last step");
    const check = await mrr("GET", `/rental/${rentalId}`);
    step("rental is readable back", check.json?.success === true, JSON.stringify(check.json?.data?.status ?? check.json?.data ?? "").slice(0, 200));
    console.log(`\n    Receipt: MiningRigRentals rental ${rentalId}. Screenshot this for the demo.`);
  }

  console.log(`\n${failures === 0 ? "✓ the published recipe works end to end" : `✗ ${failures} step(s) failed — fix the recipe before agents follow it`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
