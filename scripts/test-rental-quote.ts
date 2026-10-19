// Invariants for src/lib/rental-quote.ts · the agent rental-quote lib.
// Pure fixtures only — no network. Wired into `npm run verify`.

import type { HashrateDesk, DeskRig } from "../src/lib/hashrate";
import { composeRentalQuote, bayIdFor } from "../src/lib/rental-quote";
const B = bayIdFor("904196")!;
import { blockOdds } from "../src/lib/block-odds";
import {
  MRR_REGISTER_URL,
  MRR_REFERRAL_ID,
  rentUrlFor,
} from "../src/lib/mrr";
import { readFileSync } from "fs";
import { join } from "path";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const close = (a: number | null | undefined, b: number, eps = 1e-12) =>
  a != null && Math.abs(a - b) < eps;

function rig(over: Partial<DeskRig> = {}): DeskRig {
  return {
    id: "904196", name: "machine", owner: "GalaxyMind", region: "us-south",
    status: "available", hoursLeft: null, online: true,
    advertisedPh: 0.255, measuredPh: 0.3, askBtcPerPhDay: 0.00070221,
    minHours: 3, maxHours: 168, rpi: "new",
    rentUrl: "https://www.miningrigrentals.com/rigs/904196",
    recovery: null, isOurs: true, ...over,
  };
}
function desk(over: Partial<HashrateDesk> = {}): HashrateDesk {
  return {
    asOf: "2026-08-06T00:00:00.000Z", hashprice: 0.0006,
    networkPhs: 1_000_000, btcUsd: 115_000, blockRewardBtc: 3.2,
    book: { floor: null, medianAsk: null, clearedLast30: null, clearedLast10: null, suggested: null },
    bookSample: { collected: 0, availableRigs: null, complete: false },
    ourRigs: [rig()], regionBook: [], region: "us-south",
    stats: null, degraded: [], ...over,
  };
}

console.log("── rental-quote · math ───────────────────────────");
{
  const out = composeRentalQuote(desk(), B, 24);
  assert("quote succeeds", out.ok);
  if (out.ok) {
    const m = out.result.machines[0];
    // 0.255 PH × 0.00070221 BTC/PH/day × 1 day
    assert("costBtc is exact", close(m.quote?.costBtc, 0.255 * 0.00070221 * 1));
    assert("costUsd = costBtc × btcUsd", close(m.quote?.costUsd, 0.255 * 0.00070221 * 1 * 115_000, 1e-6));
    const ref = blockOdds({ ph: 0.255, hours: 24, networkPhs: 1_000_000 });
    assert("odds match blockOdds exactly", close(m.quote?.pAtLeastOne, ref!.pAtLeastOne));
    assert("oneInN = 1/p", close(m.quote?.oneInN, 1 / ref!.pAtLeastOne, 1e-3));
    assert("prize passes through", out.result.blockPrizeBtc === 3.2);
    assert("prizeUsd = prize × spot", close(out.result.blockPrizeUsd, 3.2 * 115_000, 1e-6));
    assert("stakeReturnAvg = p·prize/cost", close(m.quote?.stakeReturnAvg, (ref!.pAtLeastOne * 3.2) / (0.255 * 0.00070221 * 1), 1e-6));
    assert("no hours note when in range", m.quote?.hoursAdjusted === null);
    assert("rentable on an available rig", m.machine.rentable === true);
    assert("no finish link until one is set (never loops to /hashrate)", m.machine.rentUrl === null);
    assert("machine is a bay alias, never an upstream id", m.machine.id === B && !JSON.stringify(m).includes("904196"));
  }
}

console.log("── rental-quote · monotonicity ───────────────────");
{
  const p = (h: number) => {
    const o = composeRentalQuote(desk(), B, h);
    return o.ok ? o.result.machines[0].quote!.pAtLeastOne! : NaN;
  };
  assert("odds rise with hours", p(24) < p(72) && p(72) < p(168));
  assert("odds never exceed 1", p(168) <= 1);
}

console.log("── rental-quote · clamping ───────────────────────");
{
  const low = composeRentalQuote(desk(), B, 1);
  assert("1h clamps up to 1 day", low.ok && low.result.machines[0].quote?.quotedHours === 24);
  assert("clamp carries the note", low.ok && (low.result.machines[0].quote?.hoursAdjusted ?? "").includes("24"));
  assert(
    "clamped hours are reported",
    low.ok && low.result.machines[0].quote?.quotedHours === 24,
  );
  assert("requestedHours preserved", low.ok && low.result.machines[0].quote?.requestedHours === 1);
  const high = composeRentalQuote(desk(), B, 5000);
  assert("5000h clamps down to the 7-day pilot cap", high.ok && high.result.machines[0].quote?.quotedHours === 168);
}

console.log("── rental-quote · errors and honesty ─────────────");
{
  const bad = composeRentalQuote(desk(), "bay-999", 24);
  assert("unknown machine errors", !bad.ok && bad.error === "unknown_machine");
  assert("error lists valid ids", !bad.ok && bad.supported.includes(B) && !bad.supported.includes("904196"));
  const nan = composeRentalQuote(desk(), B, Number.NaN);
  assert("NaN hours error", !nan.ok && nan.error === "bad_hours");

  // machineId OMITTED (machine=all) against an empty fleet can only mean
  // the feed is down — never a bad id, since none was supplied. The old
  // unknown_machine message told the caller to "try again without
  // machineId", advice they'd already followed.
  const deadFeed = composeRentalQuote(desk({ ourRigs: [] }), undefined, 24);
  assert("empty fleet + omitted id → fleet_unavailable, not unknown_machine", !deadFeed.ok && deadFeed.error === "fleet_unavailable");
  assert("fleet_unavailable message does not tell the caller to redo what they already did", !deadFeed.ok && !/try again without machineId/.test(deadFeed.message));

  const rented = composeRentalQuote(desk({ ourRigs: [rig({ status: "rented", hoursLeft: 4 })] }), B, 24);
  assert("rented rig still quotes", rented.ok && rented.result.machines[0].quote !== null);
  assert("rented rig is not rentable", rented.ok && rented.result.machines[0].machine.rentable === false);

  const noNet = composeRentalQuote(desk({ networkPhs: null, degraded: ["network-hashrate"] }), B, 24);
  assert("null network → null odds, cost intact", noNet.ok
    && noNet.result.machines[0].quote?.pAtLeastOne === null
    && noNet.result.machines[0].quote?.costBtc !== null);
  assert("degraded passes through", noNet.ok && noNet.result.degraded.includes("network-hashrate"));

  const noUsd = composeRentalQuote(desk({ btcUsd: null }), B, 24);
  assert("null spot → null USD fields only", noUsd.ok
    && noUsd.result.machines[0].quote?.costUsd === null
    && noUsd.result.machines[0].quote?.costBtc !== null);

  const noAsk = composeRentalQuote(desk({ ourRigs: [rig({ askBtcPerPhDay: null })] }), B, 24);
  assert("null ask → refusal, never a fabricated cost", noAsk.ok
    && noAsk.result.machines[0].quote === null
    && (noAsk.result.machines[0].refusal ?? "").length > 0);
}

console.log("── rental-quote · fleet mode ─────────────────────");
{
  const two = desk({ ourRigs: [rig(), rig({ id: "901409", rentUrl: "https://www.miningrigrentals.com/rigs/901409" })] });
  const all = composeRentalQuote(two, undefined, 24);
  assert("omitted id quotes every machine", all.ok && all.result.machines.length === 2);
  const mixed = composeRentalQuote(
    desk({
      ourRigs: [
        rig({ id: "925852", status: "coming-online", advertisedPh: 0.054 }),
        rig({ id: "904196", status: "available", advertisedPh: 0.27 }),
        rig({ id: "901409", status: "rented", advertisedPh: 0.26 }),
      ],
    }),
    undefined,
    24,
  );
  assert(
    "fleet mode leads with a rentable machine",
    mixed.ok &&
      mixed.result.machines[0].machine.rentable === true &&
      mixed.result.machines[0].machine.id === B,
  );
  assert("handoff steps ride once at top level", all.ok && all.result.handoff.steps.length === 4);
  assert("finish url is our own", all.ok && all.result.handoff.finishUrl === null && all.result.handoff.finishNote.length > 0);
  assert("no MRR anywhere in the quote", all.ok && !/miningrigrentals/i.test(JSON.stringify(all.result)));
  assert("referral is off", MRR_REFERRAL_ID == null);
  assert("rent links are our own", rentUrlFor("904196") === "https://galaxymind.space/hashrate/rent");
}

console.log("── rental-quote · copy-location guard ────────────");
{
  const route = readFileSync(
    join(process.cwd(), "src/app/api/mcp/[transport]/route.ts"),
    "utf8",
  );
  assert(
    "MCP route imports QUOTE_TOOL_DESCRIPTION from hashrate-copy (gate-scanned), never inlines rental prose",
    route.includes("QUOTE_TOOL_DESCRIPTION") &&
      /QUOTE_TOOL_DESCRIPTION[^]*?from "@\/lib\/hashrate-copy"|from "@\/lib\/hashrate-copy"[^]*?QUOTE_TOOL_DESCRIPTION/.test(route),
  );
  assert(
    "get_rental_quote is registered",
    /server\.tool\(\s*"get_rental_quote"/.test(route),
  );
  assert(
    "serverInfo and server.json agree",
    (() => {
      const sv = route.match(/serverInfo:\s*\{\s*name:\s*"galaxy-mind",\s*version:\s*"([^"]+)"/)?.[1];
      const sj = JSON.parse(readFileSync(join(process.cwd(), "server.json"), "utf8")).version;
      return sv != null && sv === sj;
    })(),
  );
  assert(
    "the public MCP stub server.json is a copy of the registry entry",
    readFileSync(join(process.cwd(), "server.json"), "utf8") ===
      readFileSync(join(process.cwd(), "docs/mcp-stub-repo/server.json"), "utf8"),
  );
}

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
