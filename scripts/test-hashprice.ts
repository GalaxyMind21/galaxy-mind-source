// Unit tests for the /hashrate pure math. Same harness as
// scripts/test-float.ts · run with `npx tsx scripts/test-hashprice.ts`.

import {
  toPhs,
  hashpriceBtcPerPhDay,
  recoveryRatio,
} from "../src/lib/hashprice";
import { blockSubsidyAt } from "../src/lib/bitcoin-supply";

let pass = 0;
let fail = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` · ${detail}` : ""}`);
  }
}
function near(a: number, b: number, tol = 1e-9) {
  return Math.abs(a - b) < tol;
}

console.log("\n── toPhs · unit coercion ─────────────────────────");

// Observed live 2026-08-02: advertised.hash is a NUMBER, last_5min.hash
// is a STRING. Both must coerce. This is a real upstream trap.
assert("advertised 0.054 ph (number) → 0.054", toPhs(0.054, "ph") === 0.054);
assert(
  'last_5min "61616005.830" mh → 0.06161600583 ph',
  near(toPhs("61616005.830", "mh")!, 0.06161600583, 1e-12),
);
assert("255 th → 0.255 ph", near(toPhs(255, "th")!, 0.255));
assert("1 eh → 1000 ph", toPhs(1, "eh") === 1000);
assert("1e15 hash → 1 ph", near(toPhs(1e15, "hash")!, 1));
assert("unknown unit → null", toPhs(1, "furlongs") === null);
assert("non-numeric string → null", toPhs("abc", "ph") === null);
assert("empty string → null", toPhs("", "ph") === null);
assert("negative magnitude → null", toPhs(-5, "ph") === null);
assert("negative magnitude in another unit → null", toPhs("-61616005.830", "mh") === null);
// ZERO IS LEGAL: an idle available rig reports 0 hashrate. It is not an error.
assert("zero hashrate → 0, NOT null (idle rig, not broken)", toPhs(0, "mh") === 0);

console.log("\n── hashpriceBtcPerPhDay ──────────────────────────");

// Baseline measured 2026-08-02: network 922208 PH/s, subsidy 3.125,
// fees 0.019711 BTC/block → 0.00049104 BTC/PH/day.
const hp = hashpriceBtcPerPhDay({
  networkPhs: 922208,
  subsidyBtc: 3.125,
  feesBtcPerBlock: 0.019711,
})!;
assert("2026-08-02 baseline ≈ 0.00049104", near(hp, 0.00049104, 5e-9), `got ${hp}`);
assert(
  "fees are INCLUDED (fee-less value is strictly lower)",
  hashpriceBtcPerPhDay({ networkPhs: 922208, subsidyBtc: 3.125, feesBtcPerBlock: 0 })! < hp,
);
assert(
  "subsidy comes from bitcoin-supply, not a literal",
  blockSubsidyAt(960_753) === 3.125,
);
assert(
  "zero network hashrate → null (never Infinity)",
  hashpriceBtcPerPhDay({ networkPhs: 0, subsidyBtc: 3.125, feesBtcPerBlock: 0 }) === null,
);
assert(
  "negative network hashrate → null",
  hashpriceBtcPerPhDay({ networkPhs: -1, subsidyBtc: 3.125, feesBtcPerBlock: 0 }) === null,
);

console.log("\n── recoveryRatio ─────────────────────────────────");

assert("GalaxyMind S21 XP ask → ≈0.691", near(recoveryRatio(0.00071104, hp)!, 0.6906, 1e-3));
assert("Avalon Q ask → ≈0.614", near(recoveryRatio(0.0008, hp)!, 0.6138, 1e-3));
assert("zero ask → null (never Infinity)", recoveryRatio(0, hp) === null);
assert("negative ask → null", recoveryRatio(-1, hp) === null);
assert(
  "purity · same inputs give same output",
  recoveryRatio(0.00071104, hp) === recoveryRatio(0.00071104, hp),
);

// ── block-odds.ts · the sales math ────────────────────────────────
// This entire section was silently DELETED by a careless splice edit on
// 2026-08-02 and nobody noticed because the suite kept passing — the
// page's headline math ran with zero coverage while a deleted-instrument
// helper kept seven assertions. If you are restructuring this file, diff
// the section headers afterwards.
import {
  blockOdds,
  blockRewardBtc,
  rentalCostBtc,
  stakeReturn,
  humanizeYears,
  takeBookablePack,
  packCountPresets,
  nextPackStep,
  stepRentalWindow,
  RENTAL_WINDOWS,
  oddsImprovement,
  formatImprovement,
  sortShotOffers,
  nextSort,
  BLOCKS_PER_HOUR,
} from "../src/lib/block-odds";

console.log("\n── block-odds.ts ─────────────────────────────────");

assert("6 blocks per hour", BLOCKS_PER_HOUR === 6);

// Measured live 2026-08-02: network 922,208 PH/s, one S21 XP = 0.255 PH.
const o24 = blockOdds({ ph: 0.255, hours: 24, networkPhs: 922208 })!;
assert("one 255 TH machine over 24h ≈ 1 in 25,115", Math.round(o24.oneInN) === 25115, `got ${o24.oneInN}`);
assert("p is a probability", o24.pAtLeastOne > 0 && o24.pAtLeastOne < 1);
const o168 = blockOdds({ ph: 0.255, hours: 168, networkPhs: 922208 })!;
assert("one 255 TH machine over 168h ≈ 1 in 3,588", Math.round(o168.oneInN) === 3588, `got ${o168.oneInN}`);
assert("longer rental = better odds", o168.oneInN < o24.oneInN);
const fleet = blockOdds({ ph: 0.564, hours: 168, networkPhs: 922208 })!;
assert("whole fleet over 168h ≈ 1 in 1,623", Math.round(fleet.oneInN) === 1623, `got ${fleet.oneInN}`);
assert("more hashrate = better odds", fleet.oneInN < o168.oneInN);

// EXACT 1-(1-s)^n form, not n·s — the approximation exceeds 1.0 at large
// share and would print "1 in 0.8".
const huge = blockOdds({ ph: 900000, hours: 168, networkPhs: 922208 })!;
assert("p never exceeds 1 even at absurd share", huge.pAtLeastOne <= 1);
assert("oneInN never drops below 1", huge.oneInN >= 1);
assert(
  "exact form differs from the n·s approximation at large share",
  Math.abs(huge.pAtLeastOne - huge.expectedBlocks) > 1,
);

// Null on bad input, never Infinity/NaN — BlockShot's two crash bugs both
// came from assuming these could not be null.
assert("zero hashrate → null", blockOdds({ ph: 0, hours: 24, networkPhs: 922208 }) === null);
assert("zero hours → null", blockOdds({ ph: 0.255, hours: 0, networkPhs: 922208 }) === null);
assert("zero network → null", blockOdds({ ph: 0.255, hours: 24, networkPhs: 0 }) === null);
assert("negative hashrate → null", blockOdds({ ph: -1, hours: 24, networkPhs: 922208 }) === null);

assert("block reward = subsidy + fees", near(blockRewardBtc({ subsidyBtc: 3.125, feesBtcPerBlock: 0.0197 })!, 3.1447));
assert("reward rejects negative fees", blockRewardBtc({ subsidyBtc: 3.125, feesBtcPerBlock: -1 }) === null);

assert("24h rental cost", near(rentalCostBtc({ ph: 0.255, hours: 24, askBtcPerPhDay: 0.00068979 })!, 0.255 * 0.00068979, 1e-12));
assert("168h costs 7x the 24h", near(
  rentalCostBtc({ ph: 0.255, hours: 168, askBtcPerPhDay: 0.00068979 })!,
  7 * rentalCostBtc({ ph: 0.255, hours: 24, askBtcPerPhDay: 0.00068979 })!,
  1e-12,
));
assert("zero ask → null", rentalCostBtc({ ph: 0.255, hours: 24, askBtcPerPhDay: 0 }) === null);

assert("zero cost → null (never Infinity)", stakeReturn({ pAtLeastOne: 0.5, prize: 1, cost: 0 }) === null);
assert("stake return is prize×p ÷ cost", near(stakeReturn({ pAtLeastOne: 0.1, prize: 1000, cost: 200 })!, 0.5));

// Human-scale cadence · the same wording the solo-mining calculator
// already prints. The chooser has to speak this, not only "1 in N",
// or a 19-machine pack just looks like a smaller abstract integer.
assert("34.2 years → 34 years", humanizeYears(34.2) === "34 years");
assert("1.4 years → 1 year", humanizeYears(1.4) === "1 year");
assert("half a year → 6 months", humanizeYears(0.5) === "6 months");
assert("one month exactly", humanizeYears(1 / 12) === "1 month");
assert("a few days floors at 1 day", humanizeYears(0.001) === "1 day");
assert("non-finite cadence is an em dash", humanizeYears(Number.NaN) === "—");
assert("zero / negative cadence is an em dash", humanizeYears(0) === "—");

// Pack builder · first N *bookable* machines in the order given.
// The chooser must never .sort() (ownership-rank invariant); it walks
// desk.ourRigs, which rankByAsk already ordered cheapest-first.
const packSrc = [
  { id: "a", rentable: true },
  { id: "b", rentable: false },
  { id: "c", rentable: true },
  { id: "d", rentable: true },
];
assert(
  "takeBookablePack skips a rented machine and keeps order",
  takeBookablePack(packSrc, 2)
    .map((o) => o.id)
    .join(",") === "a,c",
);
assert(
  "takeBookablePack clamps an oversized count to every bookable machine",
  takeBookablePack(packSrc, 99)
    .map((o) => o.id)
    .join(",") === "a,c,d",
);
assert(
  "takeBookablePack treats a zero count as one machine",
  takeBookablePack(packSrc, 0)
    .map((o) => o.id)
    .join(",") === "a",
);
assert("takeBookablePack on an empty list is empty", takeBookablePack([], 1).length === 0);
assert(
  "takeBookablePack on a fully-rented list is empty",
  takeBookablePack([{ id: "x", rentable: false }], 1).length === 0,
);

assert(
  "packCountPresets(1) is just the single machine",
  packCountPresets(1).join(",") === "1",
);
assert(
  "packCountPresets(2) is the ends",
  packCountPresets(2).join(",") === "1,2",
);
assert(
  "packCountPresets(19) offers 1 / a few / half / all",
  packCountPresets(19).join(",") === "1,3,9,19",
);
assert("packCountPresets(0) is empty", packCountPresets(0).length === 0);
assert(
  "presets never invent a count above what's open",
  packCountPresets(5).every((n) => n >= 1 && n <= 5),
);

// The claim the new chooser exists to make feelable: more of the
// open fleet, in the existing ask order, is strictly better odds.
{
  const machines = [
    { rentable: true, ph: 0.27 },
    { rentable: true, ph: 0.27 },
    { rentable: false, ph: 0.27 },
    { rentable: true, ph: 0.054 },
  ];
  const one = blockOdds({
    ph: takeBookablePack(machines, 1).reduce((s, m) => s + m.ph, 0),
    hours: 3,
    networkPhs: 922208,
  })!;
  const three = blockOdds({
    ph: takeBookablePack(machines, 3).reduce((s, m) => s + m.ph, 0),
    hours: 3,
    networkPhs: 922208,
  })!;
  assert(
    "a 3-machine pack has better odds than one machine over the same window",
    three.oneInN < one.oneInN,
  );
}

// Calculator upsells · the next honest step toward more hash / more time.
assert("nextPackStep(1, 19) is the handful", nextPackStep(1, 19) === 3);
assert("nextPackStep(3, 19) is about half", nextPackStep(3, 19) === 9);
assert("nextPackStep(9, 19) is all open", nextPackStep(9, 19) === 19);
assert("nextPackStep(19, 19) is done", nextPackStep(19, 19) === null);
assert("nextPackStep on a single open machine is done", nextPackStep(1, 1) === null);
assert("stepRentalWindow + from 1 day is 3 days", stepRentalWindow(24, 1) === 72);
assert("stepRentalWindow + from 7 days stays 7 days (pilot cap)", stepRentalWindow(168, 1) === 168);
assert("stepRentalWindow − from 7 days is 3 days", stepRentalWindow(168, -1) === 72);
assert("stepRentalWindow − from 1 day stays 1 day", stepRentalWindow(24, -1) === 24);
assert("windows are whole days, 1 to 7 during the pilot", RENTAL_WINDOWS.every((h) => h % 24 === 0) && RENTAL_WINDOWS[0] === 24 && RENTAL_WINDOWS[RENTAL_WINDOWS.length - 1] === 168);
assert(
  "oddsImprovement is the 1-in-N ratio",
  near(oddsImprovement(19000, 1000)!, 19),
);
assert(
  "oddsImprovement rejects a worse ticket",
  oddsImprovement(1000, 19000) === null,
);
assert("formatImprovement(19.2) is a whole 19", formatImprovement(19.2) === "19");
assert("formatImprovement(2.4) keeps a tenth", formatImprovement(2.4) === "2.4");
assert("formatImprovement of a rounding error is silent", formatImprovement(1.05) === null);

// Visitor-facing sort of OUR machines. This is not the ownership-rank
// trap (that one pinned a Galaxy Mind listing above a cheaper third
// party). Price/TH, hashpower and window cost are honest columns on
// a single-owner roster.
const sortFleet = [
  { key: "big-dear", rentable: true, ph: 0.27, ask: 0.0008 },
  { key: "small-cheap", rentable: true, ph: 0.054, ask: 0.0005 },
  { key: "big-cheap", rentable: true, ph: 0.27, ask: 0.0006 },
];
assert(
  "sortShotOffers by price/TH is cheapest ask first",
  sortShotOffers(sortFleet, "price-th", "asc")
    .map((o) => o.key)
    .join(",") === "small-cheap,big-cheap,big-dear",
);
assert(
  "sortShotOffers by hashpower puts the big boxes first, ties by key",
  sortShotOffers(sortFleet, "power", "desc")
    .map((o) => o.key)
    .join(",") === "big-cheap,big-dear,small-cheap",
);
assert(
  "sortShotOffers by rental cost is ph × ask, cheapest first",
  sortShotOffers(sortFleet, "cost", "asc")
    .map((o) => o.key)
    .join(",") === "small-cheap,big-cheap,big-dear",
);
{
  const original = sortFleet.map((o) => o.key).join(",");
  sortShotOffers(sortFleet, "power", "desc");
  assert(
    "sortShotOffers does not mutate the input",
    sortFleet.map((o) => o.key).join(",") === original,
  );
}
assert(
  "a pack of 2 after a power sort is the two biggest",
  takeBookablePack(sortShotOffers(sortFleet, "power", "desc"), 2)
    .map((o) => o.key)
    .join(",") === "big-cheap,big-dear",
);
assert(
  "clicking the active sort key flips direction",
  nextSort({ key: "price-th", dir: "asc" }, "price-th").dir === "desc",
);
assert(
  "clicking hashpower defaults to most-first",
  nextSort({ key: "price-th", dir: "asc" }, "power").dir === "desc" &&
    nextSort({ key: "price-th", dir: "asc" }, "power").key === "power",
);
assert(
  "clicking rental cost defaults to cheapest-first",
  nextSort({ key: "power", dir: "desc" }, "cost").dir === "asc",
);
assert(
  "clicking bay defaults to lowest-number-first",
  nextSort({ key: "power", dir: "desc" }, "bay").dir === "asc" &&
    nextSort({ key: "power", dir: "desc" }, "bay").key === "bay",
);
{
  const bayFleet = [
    { key: "titan", ph: 0.012, ask: 0.0005, bay: null as number | null },
    { key: "bay-14", ph: 0.27, ask: 0.0006, bay: 14 },
    { key: "bay-02", ph: 0.27, ask: 0.0006, bay: 2 },
  ];
  assert(
    "sortShotOffers by bay is #02 before #14, house machines last",
    sortShotOffers(bayFleet, "bay", "asc")
      .map((o) => o.key)
      .join(",") === "bay-02,bay-14,titan",
  );
}

import {
  normaliseRig,
  rentUrlFor,
  MRR_REFERRAL_ID,
  MRR_SELLER_URL,
  sellerProofUrl,
  MRR_REFERRAL_URL,
} from "../src/lib/mrr";
import { INDEPENDENCE_CLAIM } from "../src/lib/listing";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("\n── mrr.ts · normaliseRig ─────────────────────────");

// Verbatim shape of rig 925852 as returned live on 2026-08-02.
const rawAvalonQ = {
  id: "925852",
  name: "⭐ 2026 Avalon Q GalaxyMind | US-South Stable",
  owner: "GalaxyMind",
  region: "us-south",
  status: { status: "available", hours: 0, rented: false, online: true },
  online: true,
  poolstatus: "online",
  rpi: "90.67",
  minhours: "3",
  maxhours: "168",
  description: "<h1>2026 Canaan Avalon Q</h1> <b>(50 TH guaranteed)</b>",
  shorturl: "http://rig.rent/rigs/925852",
  hashrate: {
    advertised: { hash: 0.054, type: "ph" },
    last_5min: { hash: "61616005.830", type: "mh" },
  },
  price: { type: "ph", BTC: { currency: "BTC", price: "0.00080000", enabled: true } },
};

const q = normaliseRig(rawAvalonQ)!;
assert("normalises id", q.id === "925852");
assert("normalises owner", q.owner === "GalaxyMind");
assert("status available", q.status === "available");
assert("advertised 0.054 PH", near(q.advertisedPh!, 0.054));
assert("measured ≈0.06162 PH (string mh coerced)", near(q.measuredPh!, 0.06161600583, 1e-9));
assert("ask parsed from string", near(q.askBtcPerPhDay!, 0.0008));
assert("minHours 3", q.minHours === 3);
assert("maxHours 168", q.maxHours === 168);
assert('rpi kept as string ("new" is a legal value)', q.rpi === "90.67");
// Checked as a prefix + builder identity rather than one literal, because
// rentUrlFor also attaches the referral id (2026-08-08). The property that
// matters here is unchanged: https, canonical /rigs/ path, never shorturl.
assert(
  "rentUrl is our own HTTPS rent section, NOT an MRR link",
  q.rentUrl === "https://galaxymind.space/hashrate/rent" &&
    q.rentUrl === rentUrlFor("925852"),
);
assert("shorturl is never surfaced", !JSON.stringify(q).includes("rig.rent"));
assert("raw HTML description is never carried through", !JSON.stringify(q).includes("<h1>"));
assert(
  "weaponised listing id is refused (not interpolated into rentUrl / JSON-LD)",
  normaliseRig({
    ...rawAvalonQ,
    id: "925852</script><script>alert(1)",
  }) === null,
);
{
  const tagged = normaliseRig({
    ...rawAvalonQ,
    name: "<b>Avalon</b> Q",
    owner: "GalaxyMind\u200b",
    region: "us-south\u202e",
  })!;
  assert(
    "listing name strips HTML brackets",
    !tagged.name.includes("<") &&
      !tagged.name.includes(">") &&
      /Avalon/.test(tagged.name) &&
      /Q/.test(tagged.name),
  );
  assert("listing owner strips bidi/zero-width", tagged.owner === "GalaxyMind");
  assert("listing region strips bidi overrides", tagged.region === "us-south");
}

const rawRented = {
  ...rawAvalonQ,
  id: "904196",
  rpi: "new",
  status: { status: "rented", hours: "2.8533", rented: true, online: true },
  hashrate: { advertised: { hash: 0.255, type: "ph" }, last_5min: { hash: "0", type: "mh" } },
  price: { type: "ph", BTC: { price: "0.00071104", enabled: true } },
};
const r = normaliseRig(rawRented)!;
assert("rented status", r.status === "rented");
assert("hoursLeft parsed from string", near(r.hoursLeft!, 2.8533, 1e-4));
assert('rpi "new" survives as a string', r.rpi === "new");

const rawOffline = { ...rawAvalonQ, id: "1", online: false };
assert(
  "online:false does not mark a listing offline (MRR checkout is the gate)",
  normaliseRig(rawOffline)!.status === "available",
);

const rawMrrDisabled = {
  ...rawAvalonQ,
  id: "998891",
  online: true,
  status: { status: "disabled", hours: 0, rented: false, online: true },
  available_status: "disabled",
};
assert(
  "MRR-disabled listing stays available; checkout is MRR's job",
  normaliseRig(rawMrrDisabled)!.status === "available",
);
assert(
  "normaliseRig never emits coming-online from live MRR",
  normaliseRig(rawMrrDisabled)!.status !== "coming-online",
);
assert(
  "rented stays rented even if MRR online is false",
  normaliseRig({ ...rawRented, online: false })!.status === "rented",
);

const rawDisabled = {
  ...rawAvalonQ,
  id: "2",
  price: { type: "ph", BTC: { price: "0", enabled: false } },
};
assert("BTC-disabled rig → null ask, not zero", normaliseRig(rawDisabled)!.askBtcPerPhDay === null);

assert("garbage input → null", normaliseRig({ nope: true }) === null);
assert("null input → null", normaliseRig(null) === null);
assert(
  "rentUrlFor is our own HTTPS rent section",
  rentUrlFor("123") === "https://galaxymind.space/hashrate/rent",
);
assert(
  "rentUrlFor carries the referral id while one is set",
  MRR_REFERRAL_ID == null ||
    rentUrlFor("123") === `https://www.miningrigrentals.com/rigs/123?ref=${MRR_REFERRAL_ID}`,
);
assert(
  "rentUrlFor never exposes rig ids or hours",
  rentUrlFor("123", 12) === "https://galaxymind.space/hashrate/rent",
);
assert(
  "rentUrlFor omits hours when omitted",
  !rentUrlFor("123").includes("hours="),
);
assert(
  "rentUrlFor ignores non-positive hours",
  !rentUrlFor("123", 0).includes("hours="),
);
assert(
  "seller url carries the referral id while one is set",
  MRR_REFERRAL_ID == null ||
    MRR_SELLER_URL.includes(`ref=${MRR_REFERRAL_ID}`),
);
/* sellerProofUrl · the "check it yourself" link on /hashrate.
 * The algorithm page shows page 1 of ~1,361 listings with NONE of ours
 * on it (measured 2026-08-27), so the verification link has to resolve
 * to a real Galaxy Mind listing. Three properties matter and all three
 * have already been wrong somewhere on this page before:
 *   1. prefer a machine somebody can actually book · landing a buyer on
 *      a rented listing proves the fleet and sells nothing,
 *   2. still prove the fleet when everything is rented,
 *   3. never build a URL from a guessed id when the feed is down. */
{
  const avail = sellerProofUrl([
    { id: "111", status: "rented" },
    { id: "222", status: "available" },
  ]);
  assert(
    "sellerProofUrl ('Rent with your AI bot') points at the agents page, same tab",
    !avail.isOurListing && avail.href === "/hashrate/agents",
  );
  const rented = sellerProofUrl([{ id: "111", status: "rented" }]);
  assert(
    "sellerProofUrl stays on the agents page when every machine is rented",
    !rented.isOurListing && rented.href === "/hashrate/agents",
  );
  const down = sellerProofUrl([]);
  assert(
    "sellerProofUrl falls back to the market page when the feed is down",
    !down.isOurListing && down.href === MRR_SELLER_URL,
  );
  assert(
    "every sellerProofUrl branch carries the referral while one is set",
    MRR_REFERRAL_ID == null ||
      [avail, rented, down].every((r) =>
        r.href.includes(`ref=${MRR_REFERRAL_ID}`),
      ),
  );
  assert(
    "the seller link label never promises the whole fleet from one listing",
    !COPY.SELLER_LINK_LABEL.toLowerCase().includes("every machine"),
  );
}
assert(
  "register referral url carries the referral id while one is set",
  MRR_REFERRAL_ID == null ||
    (MRR_REFERRAL_URL != null &&
      MRR_REFERRAL_URL.includes(`ref=${MRR_REFERRAL_ID}`)),
);
assert(
  "hours and referral share one query string",
  MRR_REFERRAL_ID == null ||
    (rentUrlFor("123", 12).includes("hours=12") &&
      rentUrlFor("123", 12).includes(`ref=${MRR_REFERRAL_ID}`)),
);

console.log("\n── referral disclosure coupling ───────────────────");
assert(
  "independence claim does not deny referrals while one is set",
  MRR_REFERRAL_ID == null ||
    !/no affiliate or referral links/i.test(INDEPENDENCE_CLAIM),
);
{
  const about = readFileSync(
    join(process.cwd(), "src", "app", "about", "page.tsx"),
    "utf8",
  );
  const faq = readFileSync(
    join(process.cwd(), "src", "app", "faq", "page.tsx"),
    "utf8",
  );
  assert(
    "about discloses the referral while one is set",
    MRR_REFERRAL_ID == null || /referral links/i.test(about),
  );
  assert(
    "faq discloses the referral while one is set",
    MRR_REFERRAL_ID == null || /referral links/i.test(faq),
  );
  assert(
    "faq does not deny marketplace referrals while one is set",
    MRR_REFERRAL_ID == null ||
      !/marketplace links are not referral/i.test(faq),
  );
  assert(
    "about does not deny a marketplace referral cut while one is set",
    MRR_REFERRAL_ID == null ||
      !/no referral\s+cut on the rental marketplace/i.test(about),
  );
}

import {
  medianAsk,
  rankByAsk,
  composeRegionBook,
  composeFleetCapacity,
  GALAXY_MIND_RIG_IDS,
  hardwareLabel,
  machineBayNumber,
  FLEET_SLOT_TH,
  FLEET_SLOTS,
  OUR_REGION,
  type DeskRig,
} from "../src/lib/hashrate";
import { summarizeOpenFleet } from "../src/lib/open-fleet";

console.log("\n── solo catches removed (operator 2026-10-17: not affiliated with any pool) ──");
{
  const hr = readFileSync(join(process.cwd(), "src", "lib", "hashrate.ts"), "utf8");
  assert("no solo-pool block feed in the desk", !/solock|soloCatch|SoloCatch|solo-blocks/.test(hr));
}

console.log("\n── hashrate.ts · composition ─────────────────────");

const mk = (
  id: string,
  ask: number | null,
  ours: boolean,
  region = "us-south",
): DeskRig => ({
  id, name: "", owner: ours ? "GalaxyMind" : "other", region,
  status: "available", hoursLeft: null, online: true,
  advertisedPh: 0.25, measuredPh: 0.25, askBtcPerPhDay: ask,
  minHours: 3, maxHours: 168, rpi: "new",
  rentUrl: `https://www.miningrigrentals.com/rigs/${id}`,
  recovery: ask ? 0.00049104 / ask : null, isOurs: ours,
});

assert("medianAsk of odd set", near(medianAsk([mk("1", 1, false), mk("2", 3, false), mk("3", 2, false)])!, 2));
assert("medianAsk of even set averages the middle two", near(medianAsk([mk("1", 1, false), mk("2", 2, false), mk("3", 3, false), mk("4", 4, false)])!, 2.5));
assert("medianAsk ignores null asks", near(medianAsk([mk("1", 2, false), mk("2", null, false)])!, 2));
assert("medianAsk of empty → null", medianAsk([]) === null);

// INVARIANT #5 — ours must NOT float to the top.
const ranked = rankByAsk([
  mk("ours", 0.00071104, true),
  mk("daza", 0.00058, false),
  mk("luis", 0.00062, false),
]);
assert("ranked ascending by ask", ranked.map((r) => r.id).join(",") === "daza,luis,ours");
assert("our rig is NOT first when we are dearer", ranked[0].isOurs === false);
assert("our rig sorts last here", ranked[2].isOurs === true);

// Ascending ask === descending recovery, by construction.
const recs = ranked.map((r) => r.recovery!);
assert(
  "ascending ask is identical to descending recovery",
  recs.every((v, i) => i === 0 || recs[i - 1] >= v),
);

// A cheaper Galaxy Mind rig SHOULD come first — no reverse bias either.
const ranked2 = rankByAsk([mk("other", 0.0009, false), mk("ours", 0.0005, true)]);
assert("no reverse bias · cheaper rig wins regardless of owner", ranked2[0].isOurs === true);

assert("fleet ids are configured", GALAXY_MIND_RIG_IDS.length >= 3);
assert("fleet ids are unique", new Set(GALAXY_MIND_RIG_IDS).size === GALAXY_MIND_RIG_IDS.length);
// Nominal full-size width tracks the live S21 XP listings (270 TH as of
// 2026-08). A drop back to 260 would understate any phantom top-up and
// would also mean the docs/comments have drifted from the seller page.
assert("FLEET_SLOT_TH tracks the current full-size listing", FLEET_SLOT_TH === 270);
assert("FLEET_SLOTS is the full-size roster size", FLEET_SLOTS === 30);
assert(
  "Bay #21 is in the roster",
  GALAXY_MIND_RIG_IDS.includes("966432"),
);
assert("Bay #21 names as S21 XP", hardwareLabel("966432") === "S21 XP");
assert(
  "Bay #22 is in the roster",
  GALAXY_MIND_RIG_IDS.includes("938441"),
);
assert("Bay #22 names as S21 XP", hardwareLabel("938441") === "S21 XP");
assert(
  "Bay #23 is in the roster",
  GALAXY_MIND_RIG_IDS.includes("986296"),
);
assert("Bay #23 names as S21 XP", hardwareLabel("986296") === "S21 XP");
assert(
  "S21 XP 976616 is in the roster",
  GALAXY_MIND_RIG_IDS.includes("976616"),
);
assert("S21 XP 976616 names as S21 XP", hardwareLabel("976616") === "S21 XP");
assert(
  "S21 XP 948457 is in the roster",
  GALAXY_MIND_RIG_IDS.includes("948457"),
);
assert("S21 XP 948457 names as S21 XP", hardwareLabel("948457") === "S21 XP");
assert(
  "S21 XP 942067 is in the roster",
  GALAXY_MIND_RIG_IDS.includes("942067"),
);
assert("S21 XP 942067 names as S21 XP", hardwareLabel("942067") === "S21 XP");
assert(
  "Bay #24 added 2026-09-23 is in the roster",
  GALAXY_MIND_RIG_IDS.includes("922028"),
);
assert("Bay #24 names as S21 XP", hardwareLabel("922028") === "S21 XP");
assert(
  "Bay #25 added 2026-09-23 is in the roster",
  GALAXY_MIND_RIG_IDS.includes("907300"),
);
assert(
  "Bay #26 added 2026-09-23 is in the roster",
  GALAXY_MIND_RIG_IDS.includes("901218"),
);
assert(
  "Bay #27 added 2026-09-23 is in the roster",
  GALAXY_MIND_RIG_IDS.includes("940018"),
);
assert("Avalon Q is in the roster", GALAXY_MIND_RIG_IDS.includes("925852"));
assert("TITAN is in the roster", GALAXY_MIND_RIG_IDS.includes("913977"));
assert(
  "GALAXY_MIND_RIG_IDS has every full-size slot + the two house machines",
  GALAXY_MIND_RIG_IDS.length === FLEET_SLOTS + 2,
  `got ${GALAXY_MIND_RIG_IDS.length}`,
);

console.log("\n── composeFleetCapacity · live status honesty ────");

// The 2026-08-12 page bug: small house machines were force-painted as
// "rented" via EXTRA_SLOT_DISPLAY even when MRR said available, so the
// gauge understated availableTh while BlockShot still offered them.
// Live listings always present at their real status; phantoms only use
// the operator PENDING/EXTRA constants.
const liveFleetShape = composeFleetCapacity([
  {
    ...mk("s21-a", 0.00064, true),
    advertisedPh: 0.27,
    measuredPh: 0.27,
    status: "available",
  },
  {
    ...mk("s21-b", 0.00064, true),
    advertisedPh: 0.27,
    measuredPh: 0.27,
    status: "coming-online",
  },
  {
    ...mk("avalon", 0.0008, true),
    advertisedPh: 0.054,
    measuredPh: 0.04,
    status: "available",
  },
  {
    ...mk("titan", 0.0009, true),
    advertisedPh: 0.012,
    measuredPh: 0.01,
    status: "rented",
    hoursLeft: 12,
  },
]);
assert(
  "available small machine counts toward availableTh (not forced rented)",
  liveFleetShape.availableTh === 270 + 54,
  `got ${liveFleetShape.availableTh}`,
);
assert(
  "rented small machine counts toward rentedTh only",
  liveFleetShape.rentedTh === 12 + FLEET_SLOT_TH * (FLEET_SLOTS - 2),
  `got ${liveFleetShape.rentedTh}`,
);
assert(
  "coming-online full-size counts toward comingTh",
  liveFleetShape.comingTh === 270,
  `got ${liveFleetShape.comingTh}`,
);
// 2 live full-size + remaining phantom full-size + 2 small
assert(
  "fleet length = full-size roster + live small machines",
  liveFleetShape.slots === FLEET_SLOTS + 2,
  `got ${liveFleetShape.slots}`,
);
assert(
  "totalTh is the exact sum of every machine's advertised hashrate",
  liveFleetShape.totalTh ===
    270 + 270 + 54 + 12 + FLEET_SLOT_TH * (FLEET_SLOTS - 2),
  `got ${liveFleetShape.totalTh}`,
);
// With the full roster present (no phantoms), totals track live
// listings only — the path the production page actually takes today.
const fullRosterNoPhantoms = composeFleetCapacity([
  ...Array.from({ length: FLEET_SLOTS }, (_, i) => ({
    ...mk(`s21-${i}`, 0.00064, true),
    advertisedPh: 0.27,
    measuredPh: 0.27,
    status: (i < 2 ? "available" : "coming-online") as DeskRig["status"],
  })),
  {
    ...mk("avalon", 0.0008, true),
    advertisedPh: 0.054,
    measuredPh: 0.04,
    status: "available",
  },
  {
    ...mk("titan", 0.0009, true),
    advertisedPh: 0.012,
    measuredPh: 0.01,
    status: "rented",
  },
]);
assert(
  "full roster · available = 2×270 + Avalon 54 (never drops the Avalon)",
  fullRosterNoPhantoms.availableTh === 594,
  `got ${fullRosterNoPhantoms.availableTh}`,
);
assert(
  "full roster · rented = TITAN 12 only",
  fullRosterNoPhantoms.rentedTh === 12,
  `got ${fullRosterNoPhantoms.rentedTh}`,
);
assert(
  "full roster · coming = (FLEET_SLOTS-2)×270",
  fullRosterNoPhantoms.comingTh === (FLEET_SLOTS - 2) * 270,
  `got ${fullRosterNoPhantoms.comingTh}`,
);
assert(
  "full roster · total = 8,166 TH (30×270 + 54 + 12)",
  fullRosterNoPhantoms.totalTh === 8166,
  `got ${fullRosterNoPhantoms.totalTh}`,
);
assert(
  "full roster total matches FLEET_SLOTS × 270 + house machines",
  fullRosterNoPhantoms.totalTh === FLEET_SLOTS * 270 + 54 + 12,
);
assert(
  "full roster · no phantom top-up when every slot has a live listing",
  fullRosterNoPhantoms.liveCount === FLEET_SLOTS + 2,
);

console.log("\n── summarizeOpenFleet · bookable capacity ────────");

const openSum = summarizeOpenFleet([
  {
    status: "available",
    advertisedPh: 0.27,
    askBtcPerPhDay: 0.00064,
  },
  {
    status: "available",
    advertisedPh: 0.054,
    askBtcPerPhDay: 0.0008,
  },
  {
    status: "rented",
    advertisedPh: 0.012,
    askBtcPerPhDay: 0.0009,
  },
  {
    status: "coming-online",
    advertisedPh: 0.27,
    askBtcPerPhDay: 0.00064,
  },
]);
assert("S21 XP id names the model", hardwareLabel("901409") === "S21 XP");
assert("Avalon Q id names the model", hardwareLabel("925852") === "Avalon Q");
assert("NerdOCTAXE id names the model", hardwareLabel("913977") === "NerdOCTAXE");
assert(
  "unknown id can still parse a clean name",
  hardwareLabel("000000", "Bitmain S21 XP") === "S21 XP",
);
assert(
  "bay number parses from a hash tag, not invented",
  machineBayNumber("⭐ GalaxyMind S21 XP 270TH · US-Exampleland #21") === 21 &&
    machineBayNumber("⭐ GalaxyMind Canaan Avalon Q · US South") === null,
);

assert("openCount ignores rented and coming-online", openSum.openCount === 2);
assert("comingCount counts staged listings", openSum.comingCount === 1);
assert("rentedCount counts live rentals", openSum.rentedCount === 1);
assert(
  "openTh = 270 + 54",
  openSum.openTh === 324,
  `got ${openSum.openTh}`,
);
assert("bestPh is the largest open machine", openSum.bestPh === 0.27);
assert(
  "minDayBtc is the cheaper of the two open windows",
  openSum.minDayBtc != null &&
    near(openSum.minDayBtc!, 0.054 * 0.0008 * 1, 1e-12),
  `got ${openSum.minDayBtc}`,
);
assert(
  "empty open set returns zeros, not fabricated scarcity",
  summarizeOpenFleet([
    { status: "rented", advertisedPh: 0.27, askBtcPerPhDay: 0.00064 },
  ]).openCount === 0 &&
    summarizeOpenFleet([
      { status: "rented", advertisedPh: 0.27, askBtcPerPhDay: 0.00064 },
    ]).openTh === 0,
);

console.log("\n── composeRegionBook · the degraded path ─────────");

// The suite used to prove rankByAsk and medianAsk pure and stop there.
// It never exercised the COMPOSITION, which is where a review found a
// failed ask-book quietly producing a Galaxy-Mind-only table that the
// page then labelled as the regional market. Every assertion below
// pins one property of that composition.

const comp = [mk("daza", 0.00058, false), mk("luis", 0.00062, false)];
const mine = [mk("ours-a", 0.00069, true), mk("ours-b", 0.0008, true)];

const full = composeRegionBook(comp, mine, "us-south");
assert(
  "healthy path · both sources merge, ranked ascending",
  full.map((r) => r.id).join(",") === "daza,luis,ours-a,ours-b",
  full.map((r) => r.id).join(","),
);

// DEGRADED PATH · this is the one that shipped wrong.
const noBook = composeRegionBook(null, mine, "us-south");
assert(
  "ask-book null → composition collapses to our own rigs ONLY",
  noBook.length === 2 && noBook.every((r) => r.isOurs),
);
assert(
  "…which is why a renderer must gate on degraded, not on length",
  noBook.length > 0,
);
assert(
  "ask-book null AND no rigs of our own → empty, never fabricated",
  composeRegionBook(null, [], "us-south").length === 0,
);

// REGION FILTER · applies to BOTH sources. ourRigs used not to be
// filtered, so a Galaxy Mind machine in another region would have
// inserted itself into a comparison set it does not belong to.
const strayOurs = mk("ours-eu", 0.0004, true, "eu-north");
const strayComp = mk("comp-eu", 0.00041, false, "eu-north");
const filtered = composeRegionBook([...comp, strayComp], [...mine, strayOurs], "us-south");
assert(
  "our own out-of-region rig is EXCLUDED (self-preference guard)",
  !filtered.some((r) => r.id === "ours-eu"),
);
assert(
  "a competitor's out-of-region rig is excluded too — same rule both ways",
  !filtered.some((r) => r.id === "comp-eu"),
);
assert(
  "the stray would otherwise have ranked FIRST — the filter is load-bearing",
  strayOurs.askBtcPerPhDay! < Math.min(...filtered.map((r) => r.askBtcPerPhDay!)),
);

// COLLISION ORDER · the same rig can appear in both sources. getRigs
// rides a 120s cache, searchAvailable a 300s one, so the book copy is
// systematically staler — and status/measuredPh are exactly what the
// page's honesty claim rests on.
const freshOurs: DeskRig = { ...mk("dup", 0.00069, true), status: "rented", measuredPh: 0.26 };
const staleBook: DeskRig = { ...mk("dup", 0.00069, true), status: "available", measuredPh: 0.11 };
const deduped = composeRegionBook([staleBook], [freshOurs], "us-south");
assert("collision de-duplicates to one row", deduped.length === 1);
assert(
  "collision keeps the FRESHER our-rigs copy (120s cache), not the book's (300s)",
  deduped[0].status === "rented" && deduped[0].measuredPh === 0.26,
);

assert("OUR_REGION is the default region argument", composeRegionBook(comp, mine).length === full.length);
assert("OUR_REGION is us-south", OUR_REGION === "us-south");

// SOURCE GUARD · the panels render degraded states in JSX, which no unit
// test can call, so assert on the source text — the same move
// scripts/test-super-saylor.ts makes against its HTML bundle.
import { PENDING_SLOT_DISPLAY } from "../src/lib/hashrate";

const readComp = (name: string) =>
  readFileSync(
    join(process.cwd(), "src", "app", "hashrate", "components", `${name}.tsx`),
    "utf8",
  );

const gaugeSrc = readComp("FleetGauge");
// Operator decision 2026-08-02: machines not yet live present as RENTED so
// the gauge reads as a full fleet. Pin the constant that controls it, and
// pin that the gauge note does not simultaneously describe them as coming
// online — a panel contradicting its own bar is the defect class this page
// has already produced twice.
assert(
  "pending slots present per PENDING_SLOT_DISPLAY",
  PENDING_SLOT_DISPLAY === "rented" || PENDING_SLOT_DISPLAY === "coming-online",
);
// The headline number is the WHOLE fleet, most of which is not available
// at any given moment, so the label above it must not claim availability —
// that overclaim is what this title previously made. Availability has its
// own line, fed from live data.
assert(
  "the gauge title does not claim the total is available to rent",
  !/available|to rent/i.test(COPY.FLEET_GAUGE_TITLE),
  COPY.FLEET_GAUGE_TITLE,
);
assert(
  "the availability label carries no figure of its own",
  !/\d/.test(COPY.FLEET_GAUGE_AVAILABLE),
  COPY.FLEET_GAUGE_AVAILABLE,
);
assert(
  "the machine-count label carries no figure of its own",
  !/\d/.test(COPY.FLEET_GAUGE_MACHINES),
  COPY.FLEET_GAUGE_MACHINES,
);
// Strip + calculator open lines use placeholders, never frozen TH/price.
assert(
  "STRIP_OPEN_TH carries a {TH} placeholder, not a frozen figure",
  /\{TH\}/.test(COPY.STRIP_OPEN_TH) && !/\d{2,}/.test(COPY.STRIP_OPEN_TH),
  COPY.STRIP_OPEN_TH,
);
assert(
  "STRIP_ENTRY carries a {PRICE} placeholder",
  /\{PRICE\}/.test(COPY.STRIP_ENTRY),
  COPY.STRIP_ENTRY,
);
assert(
  "CALC_RENT_OPEN carries a {TH} placeholder",
  /\{TH\}/.test(COPY.CALC_RENT_OPEN),
  COPY.CALC_RENT_OPEN,
);

// The gauge's total and machine count both move as the fleet grows, so the
// note must not restate either — a hardcoded "2.55 PH/s" or "ten machines"
// goes stale silently the first time a machine is added.
assert(
  "the gauge note hardcodes neither a total nor a machine count",
  !/\d+(\.\d+)?\s?(PH|TH)\/s/i.test(COPY.FLEET_GAUGE_NOTE) &&
    !/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(
      COPY.FLEET_GAUGE_NOTE,
    ),
  COPY.FLEET_GAUGE_NOTE,
);

assert(
  "the gauge note does not contradict the slot state it describes",
  PENDING_SLOT_DISPLAY !== "rented" ||
    !/coming online|on order/i.test(COPY.FLEET_GAUGE_NOTE),
  COPY.FLEET_GAUGE_NOTE,
);

assert(
  "FleetGauge degrades when our-rigs is down",
  /degraded\.includes\(\s*["']our-rigs["']\s*\)/.test(gaugeSrc),
);
assert(
  "FleetGauge renders the live machine count, not a frozen figure",
  /f\.slots/.test(gaugeSrc),
);

const contentSrc = readFileSync(
  join(process.cwd(), "src", "app", "hashrate", "HashrateContent.tsx"),
  "utf8",
);
assert(
  "the redesign leads with one price and one Rent now (2026-10-17)",
  contentSrc.includes("data-hero-price") && contentSrc.includes("<RentBuilder") && !contentSrc.includes("<BlockShot"),
);
assert(
  "the rent page does not xsell the arcade off the close",
  !contentSrc.includes("CrossPageCTA"),
);
assert(
  "waitlist mounts in the paused state",
  contentSrc.includes('id="waitlist"') && contentSrc.indexOf('id="waitlist"') > contentSrc.indexOf("data-rentals-paused"),
);
assert(
  "FAQ still renders so FAQPage JSON-LD cannot drift",
  // The marketplace FAQ entry (2026-10-17) rides after FAQ_ITEMS in both the
  // rendered FAQ and the FAQPage JSON-LD, so the two lists stay identical.
  contentSrc.includes("{[...FAQ_ITEMS, MARKETPLACE_FAQ].map") &&
    // MRR-only (2026-10-17): the JSON-LD picks MRR_FAQ_ALL in mrr_only, the same array MrrHashrateContent renders.
    readFileSync(join(process.cwd(), "src", "app", "hashrate", "page.tsx"), "utf8").includes("mainEntity: (mrr ? MRR_FAQ_ALL : [...FAQ_ITEMS, MARKETPLACE_FAQ]).map") &&
    readFileSync(join(process.cwd(), "src", "app", "hashrate", "components", "MrrHashrateContent.tsx"), "utf8").includes("faq: MRR_FAQ_ALL"),
);

{
  // Marketplace mention (operator 2026-10-17): secondary to direct checkout.
  const card = readFileSync(join(process.cwd(), "src", "app", "hashrate", "components", "MarketplaceListingCard.tsx"), "utf8");
  const footer = readFileSync(join(process.cwd(), "src", "components", "SiteFooter.tsx"), "utf8");
  const ml = readFileSync(join(process.cwd(), "src", "lib", "marketplace-listing.ts"), "utf8");
  assert("marketplace card sits after the rent section and before the FAQ",
    contentSrc.indexOf("<MarketplaceListingCard") > contentSrc.indexOf("<RentBuilder") &&
    contentSrc.indexOf("<MarketplaceListingCard") < contentSrc.indexOf("{FAQ_TITLE}") &&
    !/\{open && \(\s*<MarketplaceListingCard/.test(contentSrc));
  assert("marketplace card button is outline, never the filled primary, and smaller than the Rent CTA",
    !card.includes("bg-[var(--accent)] ") && !card.includes("lit-primary") && card.includes("min-h-[44px]") && !card.includes("min-h-[52px]"));
  // 2026-10-17: the marketplace profile is login-walled, so the card and the footer link to our own
  // /hashrate instead. Internal links carry no referral disclosure and open in the same tab.
  assert("marketplace card and footer link internally to /hashrate, no referral label",
    card.includes('href="/hashrate#rent-hero"') && !card.includes("{MARKETPLACE_REFERRAL_NOTE}") && /MARKETPLACE_FOOTER_LINK = "Rent hashrate"/.test(ml) && footer.includes("{MARKETPLACE_FOOTER_LINK}") && footer.includes("href={RENT_PAGE_PATH}"));
  assert("internal rent links do not open a new tab; outbound links keep noopener noreferrer",
    !card.includes('target="_blank"') && ml.includes('MARKETPLACE_LINK_REL = "noopener noreferrer"'));
}

// A page that forgets SiteHeader ships with NO navigation and nothing
// fails: the header is not in the root layout, every one of the 55 other
// pages mounts it itself, and a missing element never shows up in a diff.
// That is exactly how this shipped to production without a nav bar.
const pageSrc = readFileSync(
  join(process.cwd(), "src", "app", "hashrate", "page.tsx"),
  "utf8",
);
assert(
  "the page mounts SiteHeader — it is not inherited from the root layout",
  /<SiteHeader[\s>]/.test(pageSrc),
);
assert(
  "page metadata comes from the gated copy module, not inline strings",
  /description:\s*PAGE_DESCRIPTION/.test(pageSrc) &&
    !/description:\s*"/.test(pageSrc),
);
assert(
  "hashrate JSON-LD uses safeJsonLd (JSON.stringify does not escape </script>)",
  /safeJsonLd\(/.test(pageSrc) &&
    !/__html:\s*JSON\.stringify\(/.test(pageSrc),
);
{
  const offerLd = readFileSync(
    join(process.cwd(), "src", "app", "hashrate", "components", "OfferJsonLd.tsx"),
    "utf8",
  );
  assert(
    "OfferJsonLd uses safeJsonLd — rent URLs and machine ids ride this tag",
    /safeJsonLd\(/.test(offerLd) &&
      !/__html:\s*JSON\.stringify\(/.test(offerLd),
  );
}
{
  const calcPage = readFileSync(
    join(
      process.cwd(),
      "src",
      "app",
      "solo-mining-calculator",
      "page.tsx",
    ),
    "utf8",
  );
  assert(
    "solo-mining-calculator JSON-LD uses safeJsonLd",
    /safeJsonLd\(/.test(calcPage) &&
      !/__html:\s*JSON\.stringify\(/.test(calcPage),
  );
}

// Same honesty invariant as ODDS_RENT_CTA/ODDS_VIEW_CTA on /hashrate's
// BlockShot chooser (asserted above against shotSrc), applied to the
// agent-facing machines table: a non-available machine must never wear
// the rent verb. Grepped straight from the component source, same
// discipline as the DeskStatusStrip FEEDS drift guard below.
const agentPageSrc = readFileSync(
  join(process.cwd(), "src", "app", "hashrate", "agents", "page.tsx"),
  "utf8",
);
// 2026-10-16: the machines list is STATUS ONLY. The per-row rent link (and
// the ~20x repeated create_rental sentence it fell back to) is gone; the
// how-to is said once, above the list. So no rent verb can sit beside a
// non-available machine at all, which is the invariant this guarded.
assert(
  "agents page machines list is status only · no per-row rent verb or how-to",
  !/AGENT_PAGE_RENT_LINK|AGENT_PAGE_VIEW_LINK|FINISH_HOW|rentUrl/.test(agentPageSrc) &&
    (agentPageSrc.match(/\{MACHINES_HOWTO\}/g) ?? []).length === 1,
);
const rentWithAiSrc = readFileSync(
  join(process.cwd(), "src", "app", "hashrate", "components", "RentWithAiBot.tsx"),
  "utf8",
);
assert(
  "/hashrate #rent-with-ai teaser links to /hashrate/agents in the same tab",
  /AGENTS_CONNECT_PATH = "\/hashrate\/agents#connect"/.test(rentWithAiSrc) &&
    /id="rent-with-ai"/.test(rentWithAiSrc) &&
    !/target=/.test(rentWithAiSrc),
);

const shotSrc = readComp("BlockShot");
const shotGridSrc = readComp("BlockShotGrid");
assert(
  "chooser hides unavailable machines until asked",
  /ODDS_SHOW_UNAVAILABLE/.test(shotGridSrc) &&
    /showRest \? ordered/.test(shotGridSrc),
);
assert(
  "the offer card itself has a rent CTA, not only the bay list",
  /source: "offer"/.test(shotGridSrc) && /ODDS_RENT_CTA/.test(shotGridSrc),
);
assert(
  "BlockShot renders SYNCING rather than odds when a feed is missing",
  /SYNCING/.test(shotSrc) &&
    /networkPhs == null \|\| btcUsd == null \|\| blockRewardBtc == null/.test(shotSrc),
);
assert(
  "BlockShot's SYNCING branch returns BEFORE it maps any offer",
  shotSrc.indexOf("SYNCING") < shotSrc.indexOf("BlockShotGrid") &&
    /ordered\.map/.test(shotGridSrc),
);
// The chooser must never pin our own listing above a cheaper one by
// ownership; ordering here follows desk.ourRigs, which rankByAsk already
// sorted. Assert no comparator sneaks in.
assert(
  "BlockShot does not re-sort offers",
  !/\.sort\(/.test(shotSrc),
);
assert(
  "chooser sort is the lib helper, never an inline comparator",
  /sortShotOffers/.test(shotGridSrc) && !/\.sort\(/.test(shotGridSrc),
);
assert(
  "chooser opens on one machine for three hours, the hero's offer",
  /useState\(MIN_H\)/.test(shotGridSrc) && /useState\(1\)/.test(shotGridSrc),
);
assert(
  "a multi-machine pack names the button as the first checkout",
  /count > 1 \? ODDS_RENT_FIRST : ODDS_RENT_CTA/.test(shotGridSrc) &&
    /ODDS_RENT_FIRST_NOTE/.test(shotGridSrc),
);
assert(
  "the sticky bar keeps the rental price outside the truncated summary",
  (() => {
    const at = shotGridSrc.indexOf('className="min-w-0 truncate"');
    const sticky = shotGridSrc.slice(at, at + 500);
    return (
      at !== -1 &&
      sticky.includes("STICKY_SUMMARY.replace") &&
      sticky.indexOf("shrink-0") < sticky.indexOf("usd(costUsd)") &&
      sticky.includes("usd(costUsd)")
    );
  })(),
);
assert(
  "the next rental is priced in the same glance as the cadence, ahead of the rent button",
  shotGridSrc.indexOf("ODDS_CADENCE.replace") !== -1 &&
    shotGridSrc.indexOf("ODDS_CADENCE.replace") <
      shotGridSrc.indexOf("usd(longerCost)") &&
    shotGridSrc.indexOf("usd(longerCost)") < shotGridSrc.indexOf("{rentCta}") &&
    shotGridSrc.indexOf("usd(moreCost)") < shotGridSrc.indexOf("{rentCta}") &&
    /ODDS_NUDGE_HEAD/.test(shotGridSrc) &&
    /ODDS_NUDGE_CADENCE/.test(shotGridSrc) &&
    /packCostUsd\(pack, longerHours/.test(shotGridSrc) &&
    /packCostUsd\(morePack, hours/.test(shotGridSrc),
);
{
  const pageSrc = readFileSync(
    join(process.cwd(), "src", "app", "hashrate", "HashrateContent.tsx"),
    "utf8",
  );
  const copySrc = readFileSync(
    join(process.cwd(), "src", "lib", "hashrate-copy.ts"),
    "utf8",
  );
  assert(
    "no solo catches section on /hashrate",
    !/SOLO_CATCHES/.test(pageSrc) && !/SOLO_CATCHES/.test(copySrc),
  );
}

// CRASH GUARD · MRR down while mempool+coingecko are up left offers empty
// and `offers[offers.length - 1].ph` threw, 500ing the whole content
// boundary — the third independent-upstream crash on this page. The
// guard must exist and must return before headline is derived.
assert(
  "BlockShot guards empty offers before deriving headline",
  /offers\.length === 0/.test(shotSrc) &&
    shotSrc.indexOf("offers.length === 0") < shotSrc.indexOf("bestOdds"),
);
assert(
  "BlockShot filters zero-PH and zero-ask rigs out of offers",
  /advertisedPh > 0/.test(shotSrc) && /askBtcPerPhDay > 0/.test(shotSrc),
);
assert(
  "BlockShot names coming-online bays with ODDS_STATUS_COMING",
  /ODDS_STATUS_COMING/.test(shotSrc) &&
    /status === "coming-online"/.test(shotSrc) &&
    !/actionable = rigs\.filter/.test(shotSrc),
);
assert(
  "a non-available machine never wears the buy-verb CTA",
  /o\.rentable \? ODDS_RENT_CTA : ODDS_VIEW_CTA/.test(shotGridSrc),
);
assert(
  "chooser duration: server-passed cap, pilot cap by default, never past 30 days, no RENTALS_PILOT in the client",
  /const MIN_H = MIN_HOURS/.test(shotGridSrc) &&
    /const DEFAULT_MAX_H = PILOT_MAX_HOURS/.test(shotGridSrc) &&
    /const HARD_MAX_H = 30 \* 24/.test(shotGridSrc) &&
    /Math\.min\(Math\.floor\(termCapHours\), HARD_MAX_H\)/.test(shotGridSrc) &&
    !/process\.env|maxHoursFor|maxDaysNow|pilotOn/.test(shotGridSrc) &&
    /termCapHours=\{maxDaysNow\(\) \* 24\}/.test(shotSrc),
);
assert(
  "rental-limits has no import-time pilot read (it ran inside client bundles)",
  !/^export const MAX_HOURS = /m.test(readFileSync(join(process.cwd(), "src/lib/rental-limits.ts"), "utf8")),
);
// ...but 3–168 is only the FLEET-WIDE ENVELOPE. Per-machine limits can
// still be tighter, and MRR sells one duration for a whole basket, so
// the tightest machine caps the pack. This assertion used to be the
// whole story, which is how the chooser shipped a 24h default and a
// "make it 7 days" upsell against machines that then refused both —
// discovered only on the marketplace, after the buyer had made an
// account, funded it on-chain and built a pool profile.
assert(
  "the window dial is clamped to our own 1 to 30 day term",
  /packMaxH = MAX_H/.test(shotGridSrc) &&
    /max=\{packMaxH\}/.test(shotGridSrc) &&
    /min=\{packMinH\}/.test(shotGridSrc),
);
assert(
  "the longer-window upsell can never exceed the pack maximum",
  /hours < packMaxH/.test(shotGridSrc) &&
    /longerTo <= packMaxH/.test(shotGridSrc),
);
assert(
  "no per-listing hour limits reach the chooser (our own 1 to 30 day term only)",
  !/minH|maxH/.test(shotSrc) && !/minH|maxH/.test(shotGridSrc),
);
assert(
  "chooser rent CTA goes to the same-tab checkout with the chosen window (never a rig id)",
  /checkoutHref\(1, hours\)/.test(shotGridSrc) &&
    /checkoutHref\(packRentable\.length, hours\)/.test(shotGridSrc) &&
    !/rentUrlFor\(/.test(shotGridSrc) &&
    !/checkoutHref\([^)]*o\.key/.test(shotGridSrc),
);

// 22 identical machine cards made the page unreadable once the fleet
// left three boxes. The chooser is one instrument: amount × duration
// → one odds readout. A per-machine card-lift grid is the regression.
assert(
  "BlockShot does not synthesize a phantom fleet listing",
  !/key:\s*["']fleet["']/.test(shotSrc),
);
assert(
  "chooser lets a visitor pick how much of the open fleet",
  /ODDS_AMOUNT_LABEL/.test(shotGridSrc) && /takeBookablePack/.test(shotGridSrc),
);
assert(
  "chooser quotes a human cadence, not only 1-in-N",
  /humanizeYears/.test(shotGridSrc) && /ODDS_CADENCE/.test(shotGridSrc),
);
assert(
  "chooser is one instrument, not a card per machine",
  !/card-lift/.test(shotGridSrc),
);
assert(
  "the first-time guide is named once, not on every machine",
  (shotGridSrc.match(/\{HOWTO_GUIDE_LINK\}/g) || []).length === 1 &&
    /HOWTO_STEPS\.map/.test(shotGridSrc),
);
assert(
  "first-time guide sits with the rent click, not after the bay list",
  /ODDS_HOWTO_HINT/.test(shotGridSrc) &&
    /HOWTO_TITLE/.test(shotGridSrc) &&
    shotGridSrc.indexOf("{HOWTO_GUIDE_LINK}") <
      shotGridSrc.indexOf("{ODDS_RENT_THESE}"),
);
assert(
  "calculator offers a more-machines upsell",
  /ODDS_NUDGE_MORE/.test(shotGridSrc) && /nextPackStep/.test(shotGridSrc),
);
assert(
  "calculator offers a longer-window upsell",
  /ODDS_NUDGE_LONGER/.test(shotGridSrc) && /stepRentalWindow/.test(shotGridSrc),
);
assert(
  "upsells are stacked buttons, not overlapping rail labels",
  /setWant\(moreTo\)/.test(shotGridSrc) &&
    !/youPct/.test(shotGridSrc) &&
    !/ghosts\.map/.test(shotGridSrc),
);
assert(
  "calculator puts the block prize next to the odds",
  /prizeUsd/.test(shotGridSrc) && /ODDS_PRIZE_LABEL/.test(shotGridSrc),
);
assert(
  "BlockShot hands the live prize to the calculator",
  /prizeUsd=\{prize\}/.test(shotSrc),
);
assert(
  "chooser can sort miners by bay, price per TH and hashpower",
  /ODDS_SORT_BAY/.test(shotGridSrc) &&
    /ODDS_SORT_PRICE/.test(shotGridSrc) &&
    /ODDS_SORT_POWER/.test(shotGridSrc),
);
assert(
  "the machine roster names public bays, never the listing name or rig id",
  /bayIdFor\(r\.id\)/.test(shotSrc) && !/machineBayLabel|key: r\.id/.test(shotSrc) && /o\.label/.test(shotGridSrc),
);
assert(
  "the machine roster lists rented bays alongside open ones",
  /kind === "rented"/.test(shotGridSrc) &&
    /ODDS_OCCUPANCY/.test(shotGridSrc) &&
    /offers\.length > 0/.test(shotGridSrc),
);
assert(
  "rented-row CTA is a short no-buy-verb pill, not a nowrap essay",
  COPY.ODDS_VIEW_CTA.length <= 16 &&
    !/rent it when it frees/i.test(COPY.ODDS_VIEW_CTA),
);
assert(
  "machine-row actions wrap inside the label column, not a shrink-to-fit rail",
  /flex min-w-0 flex-wrap items-center gap-2/.test(shotGridSrc),
);
assert(
  "the pack of N follows the visitor's sort",
  /takeBookablePack\(\s*ordered/.test(shotGridSrc),
);

// DRIFT GUARD · DeskStatusStrip's FEEDS list must cover every degraded
// flag the composition can emit, or the strip announces "feeds live"
// while sibling panels render SYNCING for a flag it cannot see — which
// is exactly what happened when btc-price was added without updating it.
// Derived from the source, so the NEXT new feed fails the build here.
const stripSrc = readComp("DeskStatusStrip");
const hashrateLibSrc = readFileSync(
  join(process.cwd(), "src", "lib", "hashrate.ts"),
  "utf8",
);
const emitted = [...hashrateLibSrc.matchAll(/degraded\.push\("([^"]+)"\)/g)]
  .map((m) => m[1])
  // ask-book-partial is a quality note, surfaced via the strip's own
  // sweepBroke branch rather than the FEEDS list.
  .filter((f) => f !== "ask-book-partial");
assert("composition emits at least 7 degraded flags", emitted.length >= 7, emitted.join(","));
for (const flag of emitted) {
  assert(
    `DeskStatusStrip FEEDS covers "${flag}"`,
    stripSrc.includes(`"${flag}"`),
  );
}
assert(
  "DeskStatusStrip handles ask-book-partial via sweepBroke",
  /ask-book-partial/.test(stripSrc),
);

// ── hashrate-copy.ts · vocabulary gate ────────────────────────────
import * as COPY from "../src/lib/hashrate-copy";

console.log("\n── hashrate-copy.ts · vocabulary gate ────────────");

function collect(v: unknown, path: string, into: [string, string][]) {
  if (typeof v === "string") into.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x) => collect(x, path, into));
  else if (v && typeof v === "object")
    for (const [, x] of Object.entries(v)) collect(x, path, into);
}

function scan(mod: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, val] of Object.entries(mod)) {
    // The banned lists are data, not copy — scanning them would make the
    // gate flag its own vocabulary.
    if (name === "TIER1_BANNED" || name === "TIER2_CONTEXT_GATED") continue;
    collect(val, name, out);
  }
  return out;
}

const strings = scan(COPY as unknown as Record<string, unknown>);
const scannedPaths = new Set(strings.map(([p]) => p));

/*
 * Hardware naming · RULE REVERSED 2026-08-08 (operator).
 *
 * This used to ban every miner brand name outright ("show hashpower, do not
 * advertise the hardware vendors"). The operator reversed it, and the
 * reversal is right: the model IS the credibility in this market, and
 * "S21 XP rental" is a phrase people actually type into a search box. The
 * SEO surfaces now name the fleet on purpose.
 *
 * So the gate flips to guard the claim that can genuinely hurt us — naming
 * hardware we do not run. Someone who books expecting an S21 XP and lands on
 * a previous-generation box has been misled, and in a market this burned by
 * overstated listings that is the expensive kind of wrong. Any model named
 * in copy must be one the fleet really operates.
 *
 * Update FOREIGN_MODELS / the fleet list in the SAME commit as the copy.
 */
const FOREIGN_MODELS: [RegExp, string][] = [
  [/\bS19\b/i, "S19 (previous generation, not in the fleet)"],
  [/\bS21\s*(?:pro|hyd|hydro|immersion|\+)\b/i, "an S21 variant we do not run"],
  [/\bT21\b/i, "T21 (not in the fleet)"],
  [/whatsminer|microbt/i, "MicroBT/Whatsminer (not in the fleet)"],
  [/\bM[356]\d\b/i, "a Whatsminer M-series model (not in the fleet)"],
  [/iceriver|goldshell/i, "a non-SHA256 vendor (wrong algorithm entirely)"],
];
{
  const joined = strings.map(([, v]) => v).join(" ");
  const foreign = FOREIGN_MODELS.filter(([re]) => re.test(joined)).map(
    ([, why]) => why,
  );
  assert(
    `copy names only hardware the fleet actually runs${foreign.length ? ` (found: ${foreign.join(", ")})` : ""}`,
    foreign.length === 0,
  );
  // A gate nobody has seen fail is a gate nobody should trust.
  assert(
    "hardware gate self-test · a foreign model IS caught",
    FOREIGN_MODELS.some(([re]) => re.test("rent our S19 fleet today")),
  );
}

assert("scan reaches WHY_POINTS (array branch)", scannedPaths.has("WHY_POINTS"));
assert("scan reaches TRUST_POINTS (array branch)", scannedPaths.has("TRUST_POINTS"));
assert("banned lists are excluded from the scan", !scannedPaths.has("TIER1_BANNED"));

// A bare count proves nothing: the flat string exports clear a low bar on
// their own, so if collect()'s array branch broke, the gate would report
// "clean" while scanning nothing that matters — worse than no gate at all.
// The floor must sit above what the flat strings alone can reach, forcing
// the nested traversal to contribute. Recompute it whenever a copy
// constant is added or removed; don't let it go stale.
// Measured 2026-08-06 (final-review wave: AGENT_PAGE_VIEW_LINK added so a
// non-available machine on /hashrate/agents never wears the rent verb —
// Measured 2026-08-06 (marketplace-name variants + agents cross-link,
// operator ask — "Mining Rig Rentals"/"miningrigrentals.com" spellings
// now appear once per surface for agent/search token matching):
// 185 strings. New contributors: XSELL_AGENTS_LEAD 1, XSELL_AGENTS_LINK 1.
// Prior (2026-08-06, mrrApi BYO-key batch + review fixes, spec §4
// unblocked by the operator's live key-scope probe): 183 strings. New
// contributors: QUOTE_API_NOTE 1, QUOTE_API_AUTH 1,
// QUOTE_API_FIRST_RENTAL 1, AGENT_PAGE_API_TITLE 1,
// AGENT_PAGE_API_BODY 1, and QUOTE_API_STEPS 41 (nested object branch:
// 9 steps × method/path/why plus the params maps — the object-walk is
// what makes this batch the strongest vacuity canary yet).
// Prior (2026-08-06, final-review fix wave — honest rent verb,
// same honesty invariant as ODDS_RENT_CTA/ODDS_VIEW_CTA on /hashrate
// itself): 137 strings, flat + nested. New contributor: AGENT_PAGE_VIEW_LINK 1.
// Prior (2026-08-06, escaped-prose finding: the /hashrate/agents H1 and
// SURFACES notes were typed straight into page.tsx JSX, invisible to this
// gate): 136 strings. New contributors then: AGENT_PAGE_H1_LEAD 1,
// AGENT_PAGE_H1_EM 1, AGENT_PAGE_RENT_LINK 1, AGENT_PAGE_SURFACE_NOTES 3
// (array branch).
// Prior (2026-08-06, agent rental-quote batch): 130 strings, flat + nested.
// Prior (2026-08-04): 109 strings, 75 flat + 34 nested (WHY_POINTS 4,
// TRUST_POINTS 4, HOWTO_STEPS 4, FAQ_ITEMS 12, CALC_FAQ_ITEMS 10). A broken
// array/object branch drops below these counts, so the floor must sit ABOVE
// that baseline or the gate goes vacuous undetected.
// Measured 2026-08-08 (how-to-rent guide + RENT NOW pass): 219 strings,
// 111 flat + 108 nested (GUIDE_STEPS contributes 6 objects x 2-3 fields,
// GUIDE_PREREQS 3, GUIDE_MISTAKES 2). Flat-only is 111, so the floor must
// stay well above that.
// Measured 2026-08-12 (open-TH strip + calculator open/how-to lines +
// ODDS_HOWTO_HINT): 236+ strings. Floor stays well above flat-only so a
// broken nested walk still fails the gate.
assert("scan is not vacuous · nested traversal contributes", strings.length >= 230);
assert(
  "PAGE_DESCRIPTION names the 1 to 7 day pilot term, not a 12-hour S21 cap",
  /1 to 7 days/.test(COPY.PAGE_DESCRIPTION) &&
    !/up to 12 hours/.test(COPY.PAGE_DESCRIPTION),
);
assert(
  "masthead names the 1 to 7 day pilot term, not a 12-hour S21 cap",
  /1 to 7 days/.test(COPY.MASTHEAD) && !/up to 12 hours/.test(COPY.MASTHEAD),
);
assert(
  "how-to guide never sends renters to a marketplace",
  !/miningrigrentals|marketplace/i.test(COPY.GUIDE_STEPS.map((g) => g.body).join(" ")) &&
    !/up to 12 hours/.test(COPY.GUIDE_STEPS[0].body) &&
    !/for three hours, a day, or a week/.test(COPY.GUIDE_STEPS[0].body),
);

const t1Hits = strings.filter(([, s]) =>
  COPY.TIER1_BANNED.some((w) => s.toLowerCase().includes(w.toLowerCase())),
);
assert(
  "TIER 1 · no hard-banned scam vocabulary anywhere",
  t1Hits.length === 0,
  t1Hits.map(([p, s]) => `${p}: ${s.slice(0, 60)}`).join(" | "),
);

const t2Hits = strings.filter(([, s]) =>
  COPY.TIER2_CONTEXT_GATED.some((w) =>
    new RegExp(`\\b${w}`, "i").test(s),
  ),
);
assert(
  "TIER 2 · investment vocabulary appears nowhere on the hashrate surface",
  t2Hits.length === 0,
  t2Hits.map(([p, s]) => `${p}: ${s.slice(0, 60)}`).join(" | "),
);

// SELF-TEST · the gate must prove it can actually fail. A gate nobody
// has seen fail is a gate nobody should trust. Same discipline as
// scripts/check-game-bindings.ts.
const poisonT1 = scan({ BAD: "guaranteed daily returns from cloud mining" });
assert(
  "gate self-test · tier-1 poison IS caught",
  poisonT1.some(([, s]) =>
    COPY.TIER1_BANNED.some((w) => s.toLowerCase().includes(w.toLowerCase())),
  ),
);
const poisonT2 = scan({ HERO_KICKER: "a great investment for your portfolio" });
assert(
  "gate self-test · tier-2 poison outside HONESTY_BLOCK IS caught",
  poisonT2.some(([, s]) =>
    COPY.TIER2_CONTEXT_GATED.some((w) => new RegExp(`\\b${w}`, "i").test(s)),
  ),
);

assert("masthead pitches renting for a block", COPY.MASTHEAD.toLowerCase().includes("block"));
assert("trust points state no custody", COPY.TRUST_POINTS.join(" ").toLowerCase().includes("never take custody"));
assert("trust points disclose we operate the machines", COPY.TRUST_POINTS.join(" ").includes("Galaxy Mind owns and operates"));
assert("solo note is pool-neutral (names no pool, renter chooses)", /any solo pool/.test(COPY.SOLO_NOTE) && /choose your own pool/.test(COPY.SOLO_NOTE) && !/ckpool/i.test(COPY.SOLO_NOTE));
assert("chooser keeps the single-rental caveat", COPY.QUOTE_SINGLE_RENTAL_NOTE.toLowerCase().includes("either finds a block or does not"));
assert("hashrate-copy no longer exports a lottery comparison", !("LOTTERY_COMPARE" in COPY));
assert(
  "no exported copy names a lottery",
  !strings.some(([, s]) => /lottery/i.test(s)),
  strings.filter(([, s]) => /lottery/i.test(s)).map(([p]) => p).join(", "),
);
assert("hashprice trail copy exists", COPY.HISTORY_TITLE.includes("Hashprice"));
assert("hero prize note explains what the prize is", COPY.HERO_PRIZE_NOTE.toLowerCase().includes("subsidy"));
assert("term cross-sell still points at the directory vendor", COPY.TERM_CROSSSELL_BODY.toLowerCase().includes("listed in our directory"));

assert("quote handoff does not name the marketplace", !/MiningRigRentals|\bMRR\b/.test(COPY.QUOTE_HANDOFF_STEPS.join(" ")));
assert("quote fee note exists and stays qualitative", !/marketplace/i.test(COPY.QUOTE_FEE_NOTE) && !/\d\s?%/.test(COPY.QUOTE_FEE_NOTE));
assert("quote cannot-pay-here line says the rental finishes with us", COPY.QUOTE_CANNOT_LINE.includes("directly with Galaxy Mind"));
assert("quote handoff starts with availability", COPY.QUOTE_HANDOFF_STEPS[0].includes("list_available_rigs"));
assert("single-rental caveat rides the quote surface", COPY.QUOTE_SINGLE_RENTAL_NOTE.includes("either finds a block or does not"));

// The markdown practice is the operator's listing POLICY, not a live
// measurement. last_5min swings — the Avalon Q read 61.6 TH (114% of
// advertised) and 49.6 TH (92%) within the same hour — so any copy that
// promises >100% delivery on screen would be contradicted by our own
// feed several times a day. Assert the claim stays a policy statement.
const why = COPY.WHY_POINTS.join(" ").toLowerCase();
assert(
  "the markdown claim is stated as a listing policy, not a live guarantee",
  why.includes("list") && !/\b(always|every|guarantee)\b.*\b1[0-9][0-9]%/.test(why),
);
assert(
  "why-rent names the renter's pool and no facility (B5, 2026-10-17)",
  !why.includes("facility") && why.includes("pool"),
);
assert(
  "why-rent does not dump on home mining",
  !why.includes("garage") && !why.includes("dust") && !why.includes("paste"),
);
const buyVsRent = COPY.FAQ_ITEMS.find((i) =>
  i.q.toLowerCase().includes("instead of buying"),
);
assert(
  "buy-vs-rent FAQ exists",
  !!buyVsRent,
);
assert(
  "buy-vs-rent FAQ points at directory shops for people who want their own miner",
  !!buyVsRent &&
    /directory lists shops/i.test(buyVsRent.a) &&
    /pool/i.test(buyVsRent.a),
);
assert(
  "maintenance FAQ exists",
  COPY.FAQ_ITEMS.some((i) => /maintain the miner/i.test(i.q)),
);

const xsellOffPage = [
  COPY.NAV_SUB,
  COPY.XSELL_HALVING_LEAD,
  COPY.XSELL_HALVING_LINK,
  COPY.XSELL_HELP_TITLE,
  COPY.XSELL_HELP_BODY,
  COPY.XSELL_HELP_LINK,
  COPY.XSELL_HELP_FAQ_Q,
  COPY.XSELL_HELP_FAQ_A,
  COPY.XSELL_OUT_HASHRATE_TITLE,
  COPY.XSELL_OUT_HASHRATE_HOOK,
  COPY.HOME_CARD_HOOK,
  COPY.SITE_FAQ_RENT_Q,
  COPY.SITE_FAQ_RENT_A,
  COPY.HUB_RENT_Q,
  COPY.HUB_RENT_A,
  COPY.ABOUT_HASHRATE_BLURB,
].join(" ");
assert(
  "off-hashrate xsell has no shot/swing/prize/odds wager words",
  !/\b(shot|swing|prize|odds)\b/i.test(xsellOffPage),
  xsellOffPage.match(/\b(shot|swing|prize|odds)\b/i)?.[0],
);
assert(
  "rental copy does not dump on home mining",
  !/stay our problem|no garage|thermal paste|home-mining chores/i.test(
    strings.map(([, s]) => s).join(" "),
  ),
);
assert(
  "no copy constant promises a delivery percentage",
  !/\b1[0-9][0-9]\s?%/.test(Object.values(COPY).flat().filter((v) => typeof v === "string").join(" ")),
);

// A third party's price with no date is a claim about THEM that goes
// quietly wrong. Nothing in this repo fetches it.
assert(
  "the 100 Acres Ranch cross-sell states no unverified price",
  !/\$\s?\d/.test(COPY.TERM_CROSSSELL_BODY),
  COPY.TERM_CROSSSELL_BODY.slice(0, 120),
);

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);