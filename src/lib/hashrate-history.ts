// Daily hashrate desk snapshots written by /api/cron/snapshot-hashrate.
// The page used to have no reader — the series accrued so a chart could
// start with depth. This module is that reader.

import { kvList } from "./kv";

export const HASHRATE_HISTORY_KEY = "hashrate:history";
export const HASHRATE_HISTORY_CAP_DAYS = 365;
export const HASHRATE_HISTORY_MIN_POINTS = 7;

export type HashrateHistoryRow = {
  date: string;
  hashprice: number;
  floor: number | null;
  medianAsk: number | null;
  clearedLast30: number | null;
  clearedLast10: number | null;
  ourBestRecovery: number | null;
  medianAskSampleSize?: number;
  medianAskComplete?: boolean;
};

export async function getHashrateHistory(
  days = 90,
): Promise<HashrateHistoryRow[]> {
  return kvList<HashrateHistoryRow>(HASHRATE_HISTORY_KEY, days);
}

/** Oldest-first hashprice series for a sparkline. Drops non-finite rows. */
export function hashpriceSeries(
  rows: readonly HashrateHistoryRow[],
): { date: string; hashprice: number }[] {
  return [...rows]
    .reverse()
    .filter((r) => Number.isFinite(r.hashprice) && r.hashprice > 0)
    .map((r) => ({ date: r.date, hashprice: r.hashprice }));
}
