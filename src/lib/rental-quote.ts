/* =====================================================================
 * rental-quote.ts · the agent-facing rental quote.
 *
 * PURE BY CONTRACT (same rule as block-odds.ts): no I/O, no Date.now(),
 * no Math.random(). Composes entirely from a HashrateDesk the caller
 * already fetched, so the MCP tool, /api/hashrate/quote, and any future
 * surface can never disagree with the page.
 *
 * ZERO CUSTODY: this module quotes and hands off. It never rents.
 * Machines are public by bay alias only; no upstream ids, names or asks.
 * ===================================================================== */

import type { HashrateDesk, DeskRig } from "@/lib/hashrate";
import { GALAXY_MIND_RIG_IDS } from "@/lib/hashrate";
import { blockOdds, rentalCostBtc, stakeReturn } from "@/lib/block-odds";
import { rentUrl, FINISH_HOW } from "@/lib/rentals";
import { MIN_HOURS, PILOT_MAX_HOURS, maxHoursFor } from "@/lib/rental-limits";
import {
  QUOTE_HANDOFF_STEPS,
  QUOTE_PREREQS,
  QUOTE_FEE_NOTE,
  QUOTE_SINGLE_RENTAL_NOTE,
  QUOTE_HOURS_CLAMPED,
  QUOTE_REFUSAL_NOTE,
  QUOTE_CANNOT_LINE,
  QUOTE_REFERRAL_DISCLOSURE,
  QUOTE_API_NOTE,
  QUOTE_API_AUTH,
  QUOTE_API_STEPS,
  QUOTE_API_FIRST_RENTAL,
  ODDS_METHOD_NOTE,
} from "@/lib/hashrate-copy";

const SITE = "https://galaxymind.space";

/** Public alias for a machine: its bay, never an upstream id or name. */
export function bayIdFor(rigId: string): string | null {
  const i = GALAXY_MIND_RIG_IDS.indexOf(rigId);
  return i < 0 ? null : `bay-${i + 1}`;
}
export function rigIdForBay(bay: string): string | null {
  const m = /^bay-(\d{1,3})$/.exec(bay);
  if (!m) return null;
  return GALAXY_MIND_RIG_IDS[Number(m[1]) - 1] ?? null;
}
export const PUBLIC_BAY_IDS = GALAXY_MIND_RIG_IDS.map((_, i) => `bay-${i + 1}`);

export type MachineQuote = {
  machine: {
    /** Bay alias ("bay-3"), never an upstream id. */
    id: string;
    name: string;
    status: DeskRig["status"];
    rentable: boolean;
    /** Where to finish, or null until a finish link is set (see finishNote). */
    rentUrl: string | null;
    advertisedPh: number | null;
    measuredPh: number | null;
  };
  /** Null exactly when no honest cost exists (ask unavailable). */
  quote: {
    requestedHours: number;
    quotedHours: number;
    hoursAdjusted: string | null;
    costBtc: number | null;
    costUsd: number | null;
    expectedBlocks: number | null;
    pAtLeastOne: number | null;
    oneInN: number | null;
    stakeReturnAvg: number | null;
  } | null;
  refusal: string | null;
};

export type RentalQuoteResult = {
  asOf: string;
  degraded: string[];
  networkPhs: number | null;
  blockPrizeBtc: number | null;
  blockPrizeUsd: number | null;
  machines: MachineQuote[];
  handoff: {
    /** Where to finish, or null until one is set. Never a link back to /hashrate. */
    finishUrl: string | null;
    finishNote: string;
    prerequisites: string[];
    steps: string[];
  };
  feeNote: string;
  oddsNote: string;
  singleRentalNote: string;
  custody: string;
  liveUrl: string;
};

export type RentalQuoteOutcome =
  | { ok: true; result: RentalQuoteResult }
  | {
      ok: false;
      error: "unknown_machine" | "bad_hours" | "fleet_unavailable";
      message: string;
      supported: string[];
    };

function quoteMachine(
  r: DeskRig,
  hours: number,
  networkPhs: number | null,
  btcUsd: number | null,
  blockRewardBtc: number | null,
  maxHours: number,
): MachineQuote {
  // Our own term (whole days, MIN_HOURS to today's cap, which follows the pilot flag), never a per-listing window.
  const min = MIN_HOURS;
  const max = maxHours;
  const quotedHours = Math.min(max, Math.max(min, Math.round(hours / 24) * 24 || min));

  const bay = bayIdFor(r.id) ?? "bay-0";
  const machine = {
    id: bay,
    name: `Bay ${bay.slice(4)}`,
    status: r.status,
    rentable: r.status === "available",
    rentUrl: rentUrl(),
    advertisedPh: r.advertisedPh,
    measuredPh: r.measuredPh,
  };

  // No ask or no size → no honest cost exists. Refuse, never fabricate.
  if (r.askBtcPerPhDay == null || r.advertisedPh == null) {
    return { machine, quote: null, refusal: QUOTE_REFUSAL_NOTE };
  }

  const hoursAdjusted =
    quotedHours === hours
      ? null
      : QUOTE_HOURS_CLAMPED.replace("{H}", String(quotedHours))
          .replace("{MIN}", String(min))
          .replace("{MAX}", String(max));

  const costBtc = rentalCostBtc({
    ph: r.advertisedPh,
    hours: quotedHours,
    askBtcPerPhDay: r.askBtcPerPhDay,
  });
  const costUsd = costBtc != null && btcUsd != null ? costBtc * btcUsd : null;

  // Odds quote the ADVERTISED floor, matching the page: we deliberately
  // list below what the machines actually run, so the odds are the
  // conservative edge of true.
  const odds =
    networkPhs != null
      ? blockOdds({ ph: r.advertisedPh, hours: quotedHours, networkPhs })
      : null;
  const ret =
    odds != null && blockRewardBtc != null && costBtc != null
      ? stakeReturn({
          pAtLeastOne: odds.pAtLeastOne,
          prize: blockRewardBtc,
          cost: costBtc,
        })
      : null;

  return {
    machine,
    quote: {
      requestedHours: hours,
      quotedHours,
      hoursAdjusted,
      costBtc,
      costUsd,
      expectedBlocks: odds?.expectedBlocks ?? null,
      pAtLeastOne: odds?.pAtLeastOne ?? null,
      // JSON turns Infinity into null anyway; make it explicit.
      oneInN: odds != null && Number.isFinite(odds.oneInN) ? odds.oneInN : null,
      stakeReturnAvg: ret,
    },
    refusal: null,
  };
}

export function composeRentalQuote(
  desk: HashrateDesk,
  machineId: string | undefined,
  hours: number,
  env?: Record<string, string | undefined>,
): RentalQuoteOutcome {
  const maxH = maxHoursFor(env);
  if (!Number.isFinite(hours) || hours <= 0) {
    return {
      ok: false,
      error: "bad_hours",
      message: "hours must be a positive number of rental hours",
      supported: [`${MIN_HOURS} to ${maxH} hours (${MIN_HOURS / 24} to ${maxH / 24} whole days${maxH === PILOT_MAX_HOURS ? " during the pilot" : ""}); other values round to whole days and clamp`],
    };
  }

  const pool = desk.ourRigs.filter((r) => GALAXY_MIND_RIG_IDS.includes(r.id));
  const wanted = machineId === undefined ? undefined : rigIdForBay(machineId) ?? "";
  const rigs =
    wanted === undefined ? pool : pool.filter((r) => r.id === wanted);
  if (rigs.length === 0) {
    // machineId omitted (machine=all) means the caller already asked for
    // every machine — an empty fleet here can only mean the feed itself
    // is down, never a bad id. Telling them to "try again without
    // machineId" is advice they already followed; name the real cause.
    if (machineId === undefined) {
      return {
        ok: false,
        error: "fleet_unavailable",
        message: "the fleet feed is unavailable right now, try again shortly",
        supported: [...PUBLIC_BAY_IDS],
      };
    }
    return {
      ok: false,
      error: "unknown_machine",
      message: "machineId is not one of Galaxy Mind's machines (or the fleet feed is down, so try again without machineId)",
      supported: [...PUBLIC_BAY_IDS],
    };
  }

  const blockPrizeUsd =
    desk.blockRewardBtc != null && desk.btcUsd != null
      ? desk.blockRewardBtc * desk.btcUsd
      : null;

  return {
    ok: true,
    result: {
      asOf: desk.asOf,
      degraded: desk.degraded,
      networkPhs: desk.networkPhs,
      blockPrizeBtc: desk.blockRewardBtc,
      blockPrizeUsd,
      machines: [...rigs]
        .sort((a, b) => {
          const aOpen = a.status === "available" ? 0 : 1;
          const bOpen = b.status === "available" ? 0 : 1;
          if (aOpen !== bOpen) return aOpen - bOpen;
          return (b.advertisedPh ?? 0) - (a.advertisedPh ?? 0);
        })
        .map((r) =>
          quoteMachine(
            r,
            hours,
            desk.networkPhs,
            desk.btcUsd,
            desk.blockRewardBtc,
            maxH,
          ),
        ),
      handoff: {
        finishUrl: rentUrl(),
        finishNote: rentUrl() ? "Finish your rental with Galaxy Mind at finishUrl." : FINISH_HOW,
        prerequisites: QUOTE_PREREQS,
        steps: QUOTE_HANDOFF_STEPS,
      },
      feeNote: QUOTE_FEE_NOTE,
      oddsNote: ODDS_METHOD_NOTE,
      singleRentalNote: QUOTE_SINGLE_RENTAL_NOTE,
      custody: QUOTE_CANNOT_LINE,
      liveUrl: `${SITE}/hashrate`,
    },
  };
}
