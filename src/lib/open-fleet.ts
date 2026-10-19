/**
 * open-fleet.ts · pure bookable-capacity summary for the house fleet.
 *
 * Lives in its own module (not hashrate.ts) so client components like
 * HashrateStrip can import it without pulling the server composition
 * layer (upstream fetches, MRR, mempool) into the browser bundle.
 */
import { MIN_HOURS } from "./rental-limits";

export type OpenFleetSummary = {
  openCount: number;
  /** Combined advertised hashrate of available machines, in TH. */
  openTh: number;
  /** Cheapest 1-day rental across open machines, in BTC · null if none.
   *  This is the FLOOR, and the floor is a 12 TH house machine — quoting
   *  it as "a shot starts around $0.10" anchored the whole page against a
   *  dime and made a real hosted fleet sound like a toy. Prefer
   *  flagshipDayBtc for any headline price; keep this for "from" framing
   *  where the small machine is genuinely the thing being described. */
  minDayBtc: number | null;
  /** 1-day rental on the LARGEST open machine, in BTC · null if none.
   *  The honest headline anchor: the machine people actually book. */
  flagshipDayBtc: number | null;
  /** Advertised PH of the largest open machine · null if none. */
  bestPh: number | null;
  /** Ask (BTC/PH/day) of that largest open machine · null if none. */
  bestAsk: number | null;
  /** Phantom / leftover staging count. Live MRR never emits this. */
  comingCount: number;
  comingTh: number;
  /** Live listings that are currently rented. Distinct from coming-online. */
  rentedCount: number;
};

/** Pure · no Date/random. Same filter the BlockShot chooser uses. */
export function summarizeOpenFleet(
  rigs: ReadonlyArray<{
    status: string;
    advertisedPh: number | null;
    askBtcPerPhDay: number | null;
  }>,
): OpenFleetSummary {
  const open = rigs.filter(
    (r) =>
      r.status === "available" &&
      r.advertisedPh != null &&
      r.advertisedPh > 0 &&
      r.askBtcPerPhDay != null &&
      r.askBtcPerPhDay > 0,
  );
  let openTh = 0;
  let minDayBtc: number | null = null;
  let bestPh: number | null = null;
  let bestAsk: number | null = null;
  let best3h: number | null = null;
  for (const r of open) {
    const ph = r.advertisedPh!;
    const ask = r.askBtcPerPhDay!;
    openTh += Math.round(ph * 1000);
    // cost = ph × ask × hours/24 · same as rentalCostBtc for 3h
    const c3 = ph * ask * (MIN_HOURS / 24);
    if (minDayBtc == null || c3 < minDayBtc) minDayBtc = c3;
    // Same size: keep the cheaper ask. The hero quotes this 3-hour
    // window, and the chooser opens on the same machine.
    const c3Flag = ph * ask * (MIN_HOURS / 24);
    if (
      bestPh == null ||
      ph > bestPh ||
      (ph === bestPh && (best3h == null || c3Flag < best3h))
    ) {
      bestPh = ph;
      bestAsk = ask;
      best3h = c3Flag;
    }
  }
  const coming = rigs.filter(
    (r) =>
      r.status === "coming-online" &&
      r.advertisedPh != null &&
      r.advertisedPh > 0,
  );
  const rented = rigs.filter((r) => r.status === "rented");
  return {
    openCount: open.length,
    openTh,
    minDayBtc,
    flagshipDayBtc:
      bestPh != null && bestAsk != null ? bestPh * bestAsk * (3 / 24) : null,
    bestPh,
    bestAsk,
    comingCount: coming.length,
    comingTh: coming.reduce((s, r) => s + Math.round(r.advertisedPh! * 1000), 0),
    rentedCount: rented.length,
  };
}
