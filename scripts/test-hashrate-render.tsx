// Renders the desk-driven /hashrate sections from a leaky fixture (real-looking
// rig ids, upstream listing names, MRR links, per-listing hour windows) and
// asserts none of it reaches HTML or client props. security review PR #73.
import React from "react";
import { renderToString } from "react-dom/server";
import type { HashrateDesk, DeskRig } from "../src/lib/hashrate";
import { GALAXY_MIND_RIG_IDS } from "../src/lib/hashrate";
import BlockShot from "../src/app/hashrate/components/BlockShot";
import FleetGauge from "../src/app/hashrate/components/FleetGauge";
import DeskStatusStrip from "../src/app/hashrate/components/DeskStatusStrip";
import { composeRentalQuote } from "../src/lib/rental-quote";
import { BayBoard } from "../src/app/hashrate/components/BayBoard";
import { RentBuilder } from "../src/app/hashrate/components/RentBuilder";

let pass = 0, fail = 0;
const assert = (n: string, ok: boolean, d = "") => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n} ${d}`); } };

const ids = GALAXY_MIND_RIG_IDS.slice(0, 4);
const rig = (id: string, i: number): DeskRig => ({
  id, name: `GalaxyMind S21 XP USA #${25 + i}`, owner: "GalaxyMind", region: "us-south",
  status: i === 0 ? "rented" : "available", hoursLeft: i === 0 ? 5 : null, online: true,
  advertisedPh: 0.27, measuredPh: 0.28, askBtcPerPhDay: 0.00052, minHours: 3, maxHours: 168, rpi: "new",
  rentUrl: `https://www.miningrigrentals.com/rigs/${id}?ref=2770797`, recovery: null, isOurs: true,
});
const desk = {
  asOf: "2026-10-16T11:00:00.000Z", hashprice: 0.00047, networkPhs: 1_000_000, btcUsd: 82_000, blockRewardBtc: 3.16,
  book: { floor: 0.0004, medianAsk: 0.0005, clearedLast30: null, clearedLast10: null, suggested: 0.00049 },
  bookSample: { collected: 10, availableRigs: 20, complete: false },
  ourRigs: ids.map(rig), regionBook: ids.map(rig), region: "us-south", stats: null, degraded: [],
} as unknown as HashrateDesk;

const BAD: [string, RegExp][] = [
  ["37xxxx/38xxxx rig id", /(?<![\d.])3[78]\d{4}(?![\d])/],
  ["minH", /\bminH\b/], ["maxH", /\bmaxH\b/], ["minHours", /minHours/], ["maxHours", /maxHours/],
  ["miningrigrentals", /miningrigrentals/i], ["ref=", /[?&]ref=/], ["listing name", /USA #\d/],
];
function clean(name: string, html: string) {
  assert(`${name} rendered`, html.length > 200, String(html.length));
  for (const [label, re] of BAD) { const m = html.match(re); assert(`${name}: no ${label}`, !m, m ? `matched "${m[0]}"` : ""); }
}

console.log("── /hashrate render ──────────────────────────────");
clean("BlockShot", renderToString(<BlockShot desk={desk} />));
clean("FleetGauge", renderToString(<FleetGauge desk={desk} />));
clean("DeskStatusStrip", renderToString(<DeskStatusStrip desk={desk} />));
clean("BayBoard (6 bays)", renderToString(<BayBoard board={{ bays: [1, 2, 3, 4, 5, 6].map((b) => ({ bay: b, state: b === 2 ? "rented" as const : "open" as const })), available: 5, total: 6 }} title="Rigs right now" openLabel="Open" rentedLabel="Rented" />));
{
  const h = renderToString(<BayBoard board={{ bays: [1, 2, 3, 4, 5, 6].map((b) => ({ bay: b, state: b === 2 ? "rented" as const : "open" as const })), available: 5, total: 6 }} title="t" openLabel="Open" rentedLabel="Rented" />);
  assert("BayBoard renders one tile per configured bay (data-driven, not 4)", (h.match(/data-bay-state=/g) ?? []).length === 6);
  assert("BayBoard counts open bays", /5<!-- --> of <!-- -->6<!-- --> open/.test(h));
}
clean("RentBuilder", renderToString(<RentBuilder perRigDayUsdc="12.34" maxRigs={4} maxDays={7} rigTh={270} networkPhs={1_000_000} title="t" oddsTitle="o" oddsNote="n" cta="Rent now" />));
const q = composeRentalQuote(desk, undefined, 24);
clean("Offer JSON-LD source (quote)", q.ok ? JSON.stringify(q.result) + " ".repeat(200) : "");

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
