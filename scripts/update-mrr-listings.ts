// update-mrr-listings.ts · OPERATOR-RUN. Push listing descriptions to
// MiningRigRentals via POST /rig/batch.
//
// WHY IT IS THIS PARANOID. /rig/batch is documented as "update a batch of
// rigs" and accepts price, minhours, maxhours and hash alongside
// description. Whether omitting those LEAVES THEM ALONE or RESETS them is
// not documented anywhere, and the rigs it edits are a live business — one
// was rented and earning while this was written. So:
//
//   · it snapshots every field before touching anything
//   · it updates ONE rig first, re-reads it, and diffs every field
//   · if anything except the description moved, it stops and prints the
//     diff instead of continuing through the fleet
//   · rented rigs are skipped unless --include-rented is passed
//
// If you would rather not risk it at all, the MRR web UI does the same job
// in about two minutes and is the recommended path for three rigs. This
// script earns its keep when the rest of the fleet arrives.
//
// The key needs Rigs: WRITE (the read-only probe key will not do). Your key
// never leaves your shell — this script reads it from the environment and
// nothing here prints it.
//
// Usage:
//   MRR_LISTING_IDS=... MRR_API_KEY=... MRR_API_SECRET=... npx tsx scripts/update-mrr-listings.ts --dry-run
//   MRR_LISTING_IDS=... MRR_API_KEY=... MRR_API_SECRET=... npx tsx scripts/update-mrr-listings.ts
//
// Flags:
//   --dry-run          print what would be sent, touch nothing
//   --include-rented   also update rigs with a rental in progress
//   --only <id>        restrict to one rig id

import { createHmac } from "node:crypto";
import { createInterface } from "node:readline/promises";

const KEY = process.env.MRR_API_KEY ?? "";
const SECRET = process.env.MRR_API_SECRET ?? "";
if (!KEY || !SECRET) {
  console.error("Set MRR_API_KEY and MRR_API_SECRET (the key needs Rigs: Write).");
  process.exit(2);
}

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const INCLUDE_RENTED = argv.includes("--include-rented");
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;

const S21 = `<h1>2026 Bitmain Antminer S21 XP</h1>
<p>270 TH/s of SHA256 AsicBoost, US-based for low latency to US pools. Stable power and cooling, and listed below what the machine actually runs.</p>
<p>You choose your own pool and payout wallet: any SHA-256 pool, solo included. The live odds and exact cost for any window are published, machine by machine, at galaxymind.space/hashrate — no signup, nothing to install.</p>
<p>Three hour minimum, up to a week. Operated by Galaxy Mind.</p>`;

const AVALON = `<h1>2026 Canaan Avalon Q</h1>
<p>54 TH/s of SHA256 AsicBoost on the same US-based power and cooling as our larger machines, at the size that makes a short solo shot cheap. Reliable uptime, and listed below what the machine actually runs.</p>
<p>Live odds and exact cost for any rental window are published at galaxymind.space/hashrate.</p>
<p>Three hour minimum, up to a week. Operated by Galaxy Mind.</p>`;

/**
 * Idle rigs first — a canary that cannot interrupt anyone's rental. The ids come from MRR_LISTING_IDS in your shell
 * (comma-separated, in order; "123456=avalon" for the Avalon description, S21 otherwise). The repo carries no rig ids.
 */
const LISTINGS: { id: string; description: string }[] = (process.env.MRR_LISTING_IDS ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter((p) => /^\d{6}(=avalon)?$/i.test(p))
  .map((p) => ({ id: p.slice(0, 6), description: /=avalon$/i.test(p) ? AVALON : S21 }));
if (LISTINGS.length === 0) {
  console.error("Set MRR_LISTING_IDS (comma-separated listing ids, \"123456=avalon\" for the Avalon) and run again.");
  process.exit(2);
}

const API = "https://www.miningrigrentals.com/api/v2";
let lastNonce = Date.now() * 1000;

async function mrr(
  method: "GET" | "POST",
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  const n = String(++lastNonce);
  const path = endpoint.split("?")[0];
  const sign = createHmac("sha1", SECRET).update(KEY + n + path).digest("hex");
  const res = await fetch(API + endpoint, {
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

/** The fields we must prove did not move. */
function fingerprint(rig: any): Record<string, string> {
  return {
    name: String(rig?.name ?? ""),
    status: JSON.stringify(rig?.status ?? null),
    priceBTC: String(rig?.price?.BTC?.price ?? ""),
    priceEnabled: String(rig?.price?.BTC?.enabled ?? ""),
    priceType: String(rig?.price?.type ?? ""),
    minhours: String(rig?.minhours ?? ""),
    maxhours: String(rig?.maxhours ?? ""),
    advertised: JSON.stringify(rig?.hashrate?.advertised ?? null),
    region: String(rig?.region ?? ""),
    extensions: String(rig?.extensions ?? ""),
  };
}

function diff(before: Record<string, string>, after: Record<string, string>) {
  return Object.keys(before)
    .filter((k) => before[k] !== after[k])
    .map((k) => `${k}: ${before[k]} -> ${after[k]}`);
}

async function readRig(id: string): Promise<any> {
  const r = await mrr("GET", `/rig/${id}`);
  const d = r.json?.data;
  return Array.isArray(d) ? d[0] : d;
}

async function confirm(q: string, expect: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(q)).trim();
  rl.close();
  return a === expect;
}

(async () => {
  const who = await mrr("GET", "/whoami");
  const perms = who.json?.data?.permissions;
  console.log("permissions:", JSON.stringify(perms ?? who.json));
  if (!perms) { console.error("Could not authenticate. Check key, secret, and clock."); process.exit(1); }
  if (perms.rigs !== "yes" && perms.rigs !== "write") {
    console.error(`This key's Rigs scope is "${perms.rigs}". Renting-only keys cannot edit listings — mint one with Rigs: Write.`);
    process.exit(1);
  }

  const targets = LISTINGS.filter((l) => (ONLY ? l.id === ONLY : true));
  const plan: { id: string; description: string; before: any }[] = [];

  for (const t of targets) {
    const rig = await readRig(t.id);
    if (!rig) { console.error(`  rig ${t.id} unreadable — skipping`); continue; }
    const rented = rig?.status?.rented === true;
    if (rented && !INCLUDE_RENTED) {
      console.log(`  rig ${t.id} is RENTED (${rig.status.hours}h left) — skipping. Pass --include-rented to edit it anyway.`);
      continue;
    }
    const same = (rig.description ?? "").trim() === t.description.trim();
    console.log(`  rig ${t.id} · ${rig.name}`);
    console.log(`      current description: ${(rig.description ?? "").length} chars${same ? " (already up to date)" : ""}`);
    console.log(`      new description:     ${t.description.length} chars`);
    if (!same) plan.push({ ...t, before: rig });
  }

  if (plan.length === 0) { console.log("\nNothing to do."); process.exit(0); }
  if (DRY) {
    console.log(`\n--dry-run · would update ${plan.length} rig(s). Nothing was sent.`);
    process.exit(0);
  }

  if (!(await confirm(`\nUpdate ${plan.length} listing(s)? Type 'update': `, "update"))) {
    console.log("aborted."); process.exit(0);
  }

  // Canary: one rig, then verify every other field survived untouched.
  for (const [i, item] of plan.entries()) {
    const label = `rig ${item.id}`;
    const res = await mrr("POST", "/rig/batch", {
      rigs: [{ id: Number(item.id), description: item.description }],
    });
    const ok = res.json?.success === true;
    console.log(`  ${ok ? "✓" : "✗"} ${label} · HTTP ${res.status} ${ok ? "" : JSON.stringify(res.json)}`);
    if (!ok) { console.error("Stopping: the update was rejected."); process.exit(1); }

    const after = await readRig(item.id);
    const moved = diff(fingerprint(item.before), fingerprint(after));
    const descOk = (after?.description ?? "").trim() === item.description.trim();
    console.log(`      description applied: ${descOk}`);
    if (moved.length > 0) {
      console.error(`\n✗ STOP · ${label} had other fields change:`);
      for (const m of moved) console.error(`    ${m}`);
      console.error("\nThe batch endpoint resets omitted fields. Restore these in the MRR UI and do the rest by hand.");
      process.exit(1);
    }
    console.log(`      every other field unchanged`);
    if (i === 0 && plan.length > 1) console.log("      canary clean · continuing");
  }

  console.log(`\n✓ ${plan.length} listing(s) updated, nothing else moved.`);
})();
