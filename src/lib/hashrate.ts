/* =====================================================================
 * hashrate.ts · composition layer for /hashrate.
 *
 * Primary entry point — getHashrateDesk() — consumed by /hashrate, the
 * JSON twin at /api/hashrate, and the MCP tool. That is deliberate: a
 * human and an AI client must never be able to see different numbers.
 * getCalculatorDesk() is a SLIM sibling for /solo-mining-calculator only
 * (same helpers for the fields it shows; no ask-book / solo-catch fan-out).
 *
 * Every upstream is allowed to fail independently. A failure adds a
 * string to `degraded` and nulls its own field; it never fabricates a
 * value and never blocks the rest of the page.
 * ===================================================================== */

import { upstreamFetchJson, upstreamFetchText } from "@/lib/upstream";
import { blockSubsidyAt } from "@/lib/bitcoin-supply";
import { blockRewardBtc } from "@/lib/block-odds";
import {
  hashpriceBtcPerPhDay,
  recoveryRatio,
  type PriceBook,
} from "@/lib/hashprice";
import {
  getRigs,
  getAlgoStats,
  searchAvailable,
  ALGO,
  type MrrRig,
  type MrrAlgoStats,
} from "@/lib/mrr";
import { RIG_ROSTER } from "@/lib/fleet-ids";

/**
 * Our listings on MRR. Explicit IDs, because resolving by owner name
 * would silently drop every rig that is currently RENTED (the search
 * endpoint returns available rigs only). The ids are deployment config:
 * GALAXY_MIND_RIG_IDS (lib/fleet-ids.ts), in roster order. Stay listed even
 * if MRR flips one disabled (operator 2026-09-09: no site roster pulls on
 * downtime).
 */
export const GALAXY_MIND_RIG_IDS: string[] = RIG_ROSTER.ids;
export const MRR_OWNER = "GalaxyMind";

/**
 * Hardware the visitor is actually booking. The model is the credibility
 * in this market (operator reversal 2026-08-08) and the chooser used to
 * show only "260 TH/s · machine 1", which is how overstated listings
 * talk. IDs are the source of truth; the optional MRR name is a fallback
 * for a listing that is not yet in the roster map.
 */
const RIG_HARDWARE: Record<string, string> = RIG_ROSTER.hardware;

export function hardwareLabel(id: string, name?: string): string | null {
  if (RIG_HARDWARE[id]) return RIG_HARDWARE[id];
  if (GALAXY_MIND_RIG_IDS.includes(id)) return "S21 XP";
  const n = (name ?? "").trim();
  if (/\bS21\s*XP\b/i.test(n)) return "S21 XP";
  if (/avalon\s*q/i.test(n)) return "Avalon Q";
  if (/titan|nerdoctaxe/i.test(n)) return "NerdOCTAXE";
  return null;
}

/**
 * Bay number from the MRR listing name ("US-<Region> #14"). Null when the
 * listing has no number — the two house machines today. Never invented:
 * a missing hash-number is a unique model, not "machine 1".
 */
export function machineBayNumber(name: string): number | null {
  const m = (name ?? "").match(/#(\d{1,2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** The region our machines sit in, and the honest comparison set. */
export const OUR_REGION = "us-south";

/**
 * FLEET CAPACITY, for the gauge.
 *
 * Every machine counts at its OWN advertised hashrate. The gauge is a
 * capacity readout, so the TOTAL has to be exactly right even though how
 * individual machines PRESENT is an operator call (see
 * PENDING_SLOT_DISPLAY / EXTRA_SLOT_DISPLAY below).
 *
 * FLEET_SLOT_TH is therefore only the NOMINAL width of a full-size machine:
 * it sizes slots we haven't listed yet, and sets the threshold that sorts
 * full-size units from small ones. A live rig never inherits it — reading
 * the real listing keeps the total right when a machine's advertised figure
 * moves, which is a thing that happens without any code change here.
 *
 * Small machines are never rounded up into a full slot: counting a 54 TH
 * unit as a full one would overstate the fleet by ~200 TH, which is the one
 * error on this panel that would be worth calling out.
 */
/*
 * FLEET_SLOTS is the number of full-size (S21 XP class) machines the gauge
 * claims. All 30 full-size units are REAL MRR listings, fetched by id above, so the
 * phantom-slot top-up below is a no-op and PENDING_SLOT_DISPLAY no longer
 * decides how anything renders.
 *
 * That matters: the "show unfilled slots as rented" call was made in
 * 2026-08-02 when the gauge was claiming machines that had no listing
 * behind them, and a reader who counted listings on the public MRR seller
 * page would have found fewer. Every slot is now a listing anyone can go
 * look at, so the gauge and the seller page finally agree. Leave the
 * constant alone (it is still the documented operator decision) but know
 * it is dormant while the roster is complete.
 *
 * FLEET_SLOT_TH is the nominal full-size width used only for phantom top-up
 * and the full-vs-small sort threshold. Live listings never inherit it —
 * each machine counts at its own advertised hashrate. Bumped 260→270 when
 * the S21 XP listings re-advertised at 270 TH (2026-08); without that the
 * dormant phantom path would understate capacity by 10 TH per missing slot.
 *
 * Fleet as of 2026-09-23: 30x S21 XP at 270 TH, plus an Avalon Q (54 TH)
 * and a NerdOCTAXE (12 TH). 8,166 TH total (8.17 PH/s). Every owned machine is
 * in GALAXY_MIND_RIG_IDS; site status is rented vs available only.
 * Do not drop ids when a rig is disabled on MRR (operator 2026-09-09),
 * and do not paint that as offline here (operator 2026-09-14 — MRR
 * checkout is the gate).
 * Raise FLEET_SLOTS only alongside new ids.
 */
export const FLEET_SLOT_TH = 270;
export const FLEET_SLOTS = 30;

export type SlotState = "available" | "rented" | "offline" | "coming-online";

/**
 * How slots for machines not yet live on MiningRigRentals present in the
 * gauge.
 *
 * OPERATOR DECISION 2026-08-02: show them as "rented", so the gauge reads
 * as a full, busy fleet. The trade-off was raised and reaffirmed — the MRR
 * seller page is public, so a reader who counts listings there will find
 * fewer machines than this gauge implies. Flipping this single constant to
 * "coming-online" reverts the presentation with no other change anywhere.
 *
 * Dormant while every full-size slot has a real listing in
 * GALAXY_MIND_RIG_IDS (see composeFleetCapacity top-up loop).
 */
export const PENDING_SLOT_DISPLAY: SlotState = "rented";

/**
 * Same operator decision, for PHANTOM small-machine slots only.
 *
 * Dormant: both house machines (Avalon Q + NerdOctaxe) are real MRR
 * listings and present at their live status. This constant is kept so a
 * future phantom-extra path can reuse the same presentation call without
 * reinventing it. It must NEVER override a live listing's status — that
 * was the 2026-08-12 gauge bug (Avalon open on MRR, gauge forced it to
 * "rented", understating availableTh by 54 TH against the chooser below).
 */
export const EXTRA_SLOT_DISPLAY: SlotState = "rented";

/** One machine in the gauge. Widths vary — see composeFleetCapacity. */
export type FleetSlot = { th: number; state: SlotState };

export type FleetCapacity = {
  slotTh: number;
  slots: number;
  totalTh: number;
  /** One entry per machine, in gauge order: full-size slots first. */
  fleet: FleetSlot[];
  availableTh: number;
  rentedTh: number;
  comingTh: number;
  /** Machines live on MRR right now, whatever their status. */
  liveCount: number;
};

// Bookable-capacity summary lives in lib/open-fleet.ts so client
// components can import it without pulling this server composition
// layer into the browser bundle. Re-export for server call sites that
// already import from here.
export {
  summarizeOpenFleet,
  type OpenFleetSummary,
} from "@/lib/open-fleet";

/**
 * Total Galaxy Mind hashpower.
 *
 * Full-size live listings first, each at its own advertised hashrate, topped
 * up to FLEET_SLOTS with nominal slots presenting per PENDING_SLOT_DISPLAY,
 * then any smaller machine appended at its own hashrate too. Nothing is
 * rounded into a uniform slot: a 54 TH machine counted as a full one would
 * overstate the total by ~200 TH, and the total is the one number on this
 * panel that has to be exactly right.
 */
export function composeFleetCapacity(rigs: DeskRig[]): FleetCapacity {
  const isFullSize = (r: DeskRig) =>
    r.advertisedPh != null && r.advertisedPh * 1000 >= FLEET_SLOT_TH * 0.8;

  const slotRigs = rigs.filter(isFullSize);
  const smallRigs = rigs.filter(
    (r) => !isFullSize(r) && r.advertisedPh != null && r.advertisedPh > 0,
  );

  const fleet: FleetSlot[] = [];
  for (const r of slotRigs.slice(0, FLEET_SLOTS))
    fleet.push({ th: Math.round(r.advertisedPh! * 1000), state: r.status });
  while (fleet.length < FLEET_SLOTS)
    fleet.push({ th: FLEET_SLOT_TH, state: PENDING_SLOT_DISPLAY });

  // Live small machines present at their REAL MRR status — same rule as
  // full-size above. Forcing EXTRA_SLOT_DISPLAY here understated available
  // hashrate whenever the Avalon (or any house box) was actually open,
  // while BlockShot still offered it to rent. Phantom extras (none today)
  // would still use EXTRA_SLOT_DISPLAY if a top-up path is ever added.
  for (const r of smallRigs)
    fleet.push({
      th: Math.round(r.advertisedPh! * 1000),
      state: r.status,
    });

  const sum = (s: SlotState) =>
    fleet.filter((f) => f.state === s).reduce((a, f) => a + f.th, 0);

  return {
    slotTh: FLEET_SLOT_TH,
    slots: fleet.length,
    totalTh: fleet.reduce((a, f) => a + f.th, 0),
    fleet,
    availableTh: sum("available"),
    rentedTh: sum("rented"),
    comingTh: sum("coming-online"),
    liveCount: slotRigs.length + smallRigs.length,
  };
}


export type DeskRig = MrrRig & { recovery: number | null; isOurs: boolean };

/**
 * How much of the live ask book the published figures are actually
 * derived from. `medianAsk` is a median OF THIS SAMPLE, not of the whole
 * book, whenever `complete` is false — see searchAvailable's cap comment.
 * Always present so a consumer never has to infer it from array lengths.
 */
export type BookSample = {
  /** Rigs actually collected and parsed. */
  collected: number;
  /** MRR's own count of available rigs on this algo, when it answered. */
  availableRigs: number | null;
  /** True only when pagination reached the end of the book without error. */
  complete: boolean;
};

export type HashrateDesk = {
  asOf: string;
  hashprice: number | null;
  networkPhs: number | null;
  /** BTC spot in USD — the page prints the block prize in dollars. */
  btcUsd: number | null;
  /** Subsidy + recent average fees: what the block finder actually takes. */
  blockRewardBtc: number | null;
  book: PriceBook;
  bookSample: BookSample;
  ourRigs: DeskRig[];
  regionBook: DeskRig[];
  region: string;
  stats: MrrAlgoStats | null;
  degraded: string[];
};

export function medianAsk(rigs: MrrRig[]): number | null {
  const xs = rigs
    .map((r) => r.askBtcPerPhDay)
    .filter((x): x is number => x != null && x > 0)
    .sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * INVARIANT #5. Sort by ask ascending and nothing else.
 *
 * Ascending ask is identical to descending recovery ratio, because
 * recovery = hashprice / ask and hashprice is constant across the book
 * at any instant. Equivalent by construction, not by coincidence.
 *
 * There is no `isOurs` term anywhere in this comparator, in either
 * direction. Adding one is the single change that would make the whole
 * page dishonest.
 */
export function rankByAsk(rigs: DeskRig[]): DeskRig[] {
  return [...rigs].sort((a, b) => {
    const x = a.askBtcPerPhDay ?? Number.POSITIVE_INFINITY;
    const y = b.askBtcPerPhDay ?? Number.POSITIVE_INFINITY;
    return x - y;
  });
}

/**
 * Build the regional comparison set. PURE, and extracted out of
 * getHashrateDesk specifically so scripts/test-hashprice.ts can exercise
 * the degraded path (`book === null`) without touching the network —
 * that path is what a review caught rendering a competitor-free table
 * under the heading "the regional rental book".
 *
 * Three properties, all of them load-bearing and all of them tested:
 *
 *  1. BOTH inputs are region-filtered. `ourRigs` used not to be, so a
 *     Galaxy Mind machine outside the region would have inserted itself
 *     into a comparison set it does not belong to — the exact
 *     self-preference shape invariant #5 exists to prevent. The fleet is
 *     growing to ten machines; this is not hypothetical.
 *  2. On an id collision OUR copy wins. The two sources ride different
 *     caches (`getRigs` 120s, `searchAvailable` 300s), so the search
 *     copy is systematically staler — and status/measuredPh are exactly
 *     the fields the page's honesty claim rests on.
 *  3. `book === null` (upstream failed) collapses this to our own rigs.
 *     That is arithmetically correct and journalistically indefensible,
 *     so any renderer MUST check `degraded` for "ask-book" first and
 *     render SYNCING instead. Since the 2026-08-02 sales pivot NO page
 *     component renders regionBook — its consumers are /api/hashrate and
 *     the MCP tool, whose degradedNote carries this exact warning. If a
 *     renderer ever returns, this rule comes back with it.
 */
export function composeRegionBook(
  book: DeskRig[] | null,
  ourRigs: DeskRig[],
  region: string = OUR_REGION,
): DeskRig[] {
  const seen = new Set<string>();
  return rankByAsk(
    [...ourRigs, ...(book ?? [])]
      .filter((r) => r.region === region)
      .filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      }),
  );
}

/** Network hashrate in PH/s (mempool.space 3-day estimate, 10 min cache); null on failure. */
export async function getNetworkPhs(): Promise<number | null> {
  return fetchNetworkPhs();
}

async function fetchNetworkPhs(): Promise<number | null> {
  const res = await upstreamFetchJson<{ currentHashrate?: number }>(
    "https://mempool.space/api/v1/mining/hashrate/3d",
    { label: "mempool-hashrate", revalidate: 600 },
  );
  if (!res.ok) return null;
  const hs = res.data?.currentHashrate;
  return typeof hs === "number" && hs > 0 ? hs / 1e15 : null;
}

async function fetchFeesPerBlock(): Promise<number | null> {
  const res = await upstreamFetchJson<{
    startBlock?: number;
    endBlock?: number;
    totalFee?: string | number;
  }>("https://mempool.space/api/v1/mining/reward-stats/144", {
    label: "mempool-rewards",
    revalidate: 600,
  });
  if (!res.ok) return null;
  const d = res.data;
  // TRAP: there is NO blockCount field. Derive the span.
  const start = Number(d?.startBlock);
  const end = Number(d?.endBlock);
  const fee = Number(d?.totalFee);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (!Number.isFinite(fee)) return null;
  const n = end - start + 1;
  if (n <= 0) return null;
  return fee / n / 1e8;
}

/** BTC spot. Same endpoint + label the market lib already uses. */
async function fetchBtcUsd(): Promise<number | null> {
  const res = await upstreamFetchJson<{ bitcoin?: { usd?: number } }>(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    { label: "btcprice", revalidate: 120 },
  );
  const v = res.ok ? res.data?.bitcoin?.usd : null;
  return typeof v === "number" && v > 0 ? v : null;
}

async function fetchTipHeight(): Promise<number | null> {
  // Same URL and text-parse shape the repo already uses in
  // lib/market.ts:404 and the snapshot-float cron. Note there is NO
  // /v1 on this path (unlike the mining/* endpoints above), and the
  // response is text/plain, not JSON.
  const res = await upstreamFetchText(
    "https://mempool.space/api/blocks/tip/height",
    { label: "mempool-tip", revalidate: 600 },
  );
  if (!res.ok) return null;
  const n = Number.parseInt(res.data.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getHashrateDesk(): Promise<HashrateDesk> {
  const degraded: string[] = [];

  const [
    networkPhs,
    feesPerBlock,
    tip,
    ourRaw,
    stats,
    bookRaw,
    btcUsd,
  ] = await Promise.all([
    fetchNetworkPhs(),
    fetchFeesPerBlock(),
    fetchTipHeight(),
    getRigs(GALAXY_MIND_RIG_IDS),
    getAlgoStats(ALGO),
    searchAvailable(ALGO),
    fetchBtcUsd(),
  ]);

  if (networkPhs == null) degraded.push("network-hashrate");
  if (feesPerBlock == null) degraded.push("block-fees");
  if (btcUsd == null) degraded.push("btc-price");
  if (ourRaw == null) degraded.push("our-rigs");
  if (stats == null) degraded.push("algo-stats");
  if (bookRaw == null) degraded.push("ask-book");
  // A sweep that stopped because a PAGE FAILED is a different animal from
  // one that stopped at our own page cap: the first is an accident and
  // nothing signals it, the second is a deliberate sample we label as
  // such (see bookSample below). Only the accident is degraded — putting
  // the deliberate cap in `degraded` would leave the array permanently
  // non-empty and teach every consumer, human and MCP client alike, to
  // ignore the one honest completeness signal we publish.
  else if (bookRaw.truncatedByError) degraded.push("ask-book-partial");

  // Subsidy comes from the lib that owns it, never a literal. If the
  // tip height is unavailable we cannot know the era, so we degrade
  // rather than assume — that is the whole honesty contract.
  const subsidy = tip != null ? blockSubsidyAt(tip) : null;
  if (subsidy == null) degraded.push("block-height");

  const hashprice =
    networkPhs != null && subsidy != null && feesPerBlock != null
      ? hashpriceBtcPerPhDay({
          networkPhs,
          subsidyBtc: subsidy,
          feesBtcPerBlock: feesPerBlock,
        })
      : null;

  const decorate = (r: MrrRig): DeskRig => ({
    ...r,
    isOurs: r.owner === MRR_OWNER,
    recovery:
      r.askBtcPerPhDay != null && hashprice != null
        ? recoveryRatio(r.askBtcPerPhDay, hashprice)
        : null,
  });

  const ourRigs = (ourRaw ?? []).map(decorate);
  const book = bookRaw ? bookRaw.rigs.map(decorate) : null;

  return {
    asOf: new Date().toISOString(),
    hashprice,
    networkPhs,
    btcUsd,
    blockRewardBtc:
      subsidy != null && feesPerBlock != null
        ? blockRewardBtc({ subsidyBtc: subsidy, feesBtcPerBlock: feesPerBlock })
        : null,
    book: {
      floor: stats?.floor ?? null,
      medianAsk: medianAsk(bookRaw?.rigs ?? []),
      clearedLast30: stats?.clearedLast30 ?? null,
      clearedLast10: stats?.clearedLast10 ?? null,
      suggested: stats?.suggested ?? null,
    },
    bookSample: {
      collected: bookRaw?.rigs.length ?? 0,
      availableRigs: stats?.availableRigs ?? null,
      complete:
        bookRaw != null &&
        !bookRaw.truncatedByError &&
        !bookRaw.cappedAtMaxPages,
    },
    ourRigs: rankByAsk(ourRigs),
    // The regional comparison set — our own rigs spliced in, because the
    // search endpoint omits them whenever they are rented. See
    // composeRegionBook for the three properties this has to hold.
    regionBook: composeRegionBook(book, ourRigs, OUR_REGION),
    region: OUR_REGION,
    stats,
    degraded,
  };
}

/**
 * Slim desk for /solo-mining-calculator only.
 *
 * Same upstream helpers and honesty rules as getHashrateDesk, but skips the
 * heavy MRR ask-book sweep (searchAvailable), algo stats, and solo-catch
 * fan-out — none of those fields appear on the calculator page. Ahrefs Site
 * Audit flagged this route at ~3.9s TTFB for AI crawlers (2026-09-10); the
 * cold ask-book path was the load we could drop without inventing numbers or
 * weakening the nonce CSP (HTML stays uncacheable by design).
 *
 * Numbers that DO appear still come from the same fetchNetworkPhs /
 * fetchBtcUsd / getRigs / subsidy path as /hashrate, so the two surfaces
 * cannot disagree about network / price / our open TH.
 */
export type CalculatorDesk = {
  networkPhs: number | null;
  btcUsd: number | null;
  blockRewardBtc: number | null;
  ourRigs: DeskRig[];
  degraded: string[];
};

export async function getCalculatorDesk(): Promise<CalculatorDesk> {
  const degraded: string[] = [];

  const [networkPhs, feesPerBlock, tip, ourRaw, btcUsd] = await Promise.all([
    fetchNetworkPhs(),
    fetchFeesPerBlock(),
    fetchTipHeight(),
    getRigs(GALAXY_MIND_RIG_IDS),
    fetchBtcUsd(),
  ]);

  if (networkPhs == null) degraded.push("network-hashrate");
  if (feesPerBlock == null) degraded.push("block-fees");
  if (btcUsd == null) degraded.push("btc-price");
  if (ourRaw == null) degraded.push("our-rigs");

  const subsidy = tip != null ? blockSubsidyAt(tip) : null;
  if (subsidy == null) degraded.push("block-height");

  const hashprice =
    networkPhs != null && subsidy != null && feesPerBlock != null
      ? hashpriceBtcPerPhDay({
          networkPhs,
          subsidyBtc: subsidy,
          feesBtcPerBlock: feesPerBlock,
        })
      : null;

  const decorate = (r: MrrRig): DeskRig => ({
    ...r,
    isOurs: r.owner === MRR_OWNER,
    recovery:
      r.askBtcPerPhDay != null && hashprice != null
        ? recoveryRatio(r.askBtcPerPhDay, hashprice)
        : null,
  });

  return {
    networkPhs,
    btcUsd,
    blockRewardBtc:
      subsidy != null && feesPerBlock != null
        ? blockRewardBtc({ subsidyBtc: subsidy, feesBtcPerBlock: feesPerBlock })
        : null,
    ourRigs: rankByAsk((ourRaw ?? []).map(decorate)),
    degraded,
  };
}
