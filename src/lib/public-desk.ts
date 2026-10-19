/**
 * public-desk.ts · the ONLY shape /api/hashrate serves.
 * Our machines appear as bay aliases with size and status. No upstream
 * rig ids, names, owners, regions, asks, links or rental windows, and no
 * per-listing region book. Rental term comes from rental-limits.
 */
import type { HashrateDesk } from "@/lib/hashrate";
import { bayIdFor } from "@/lib/rental-quote";
import { MIN_DAYS, MAX_DAYS, DAYS_COPY, MAX_RIGS, RIG_TH, maxDaysNow, PILOT_MAX_DAYS } from "@/lib/rental-limits";

export type PublicBay = {
  id: string;
  name: string;
  status: HashrateDesk["ourRigs"][number]["status"];
  advertisedPh: number | null;
  measuredPh: number | null;
  askBtcPerPhDay: null;
};

export function publicDesk(d: HashrateDesk) {
  const ourRigs: PublicBay[] = d.ourRigs
    .map((r) => ({ r, bay: bayIdFor(r.id) }))
    .filter((x): x is { r: (typeof d.ourRigs)[number]; bay: string } => x.bay != null)
    .map(({ r, bay }) => ({
      id: bay,
      name: `Bay ${bay.slice(4)}`,
      status: r.status,
      advertisedPh: r.advertisedPh,
      measuredPh: r.measuredPh,
      // Direct prices come from get_rental_quote; no listing ask is published.
      askBtcPerPhDay: null,
    }));
  return {
    asOf: d.asOf,
    hashprice: d.hashprice,
    networkPhs: d.networkPhs,
    btcUsd: d.btcUsd,
    blockRewardBtc: d.blockRewardBtc,
    book: d.book,
    bookSample: d.bookSample,
    bookNote: "book is outside rental market data, not Galaxy Mind's price. For our direct price, use get_rental_quote.",
    degraded: d.degraded,
    rentalTerm: { minDays: MIN_DAYS, maxDays: maxDaysNow(), laterMaxDays: MAX_DAYS, copy: maxDaysNow() === PILOT_MAX_DAYS ? DAYS_COPY : `${MIN_DAYS} to ${MAX_DAYS} days`, wholeDays: true, rigTh: RIG_TH, maxRigs: MAX_RIGS },
    ourRigs,
  };
}
