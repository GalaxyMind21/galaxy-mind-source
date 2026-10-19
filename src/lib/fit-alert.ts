// Helpers for the /fit allocation-change alert · the per-email
// stored profile (handle, tolerance, account + last-recommended
// sleeve list), the diff logic that decides "is this a meaningful
// change worth emailing about," and the MarketSignals projection
// from a MarketSnapshot.
//
// Storage model: one KV record per opted-in email at
// `fit-alert:<email>` · superseded on re-opt-in (single profile
// per email · multi-profile per user is intentionally out of scope
// for v1 since real demand is probably one).

import type { MarketSnapshot } from "./market";
import type {
  AccountType,
  MarketSignals,
  Recommendation,
  Sleeve,
  Tolerance,
} from "./recommend";

export type FitAlertRecord = {
  h: number;            // horizon years (1-30)
  t: Tolerance;         // 1-6
  a: AccountType;       // "taxable" | "traditional" | "roth"
  // Snapshot of the last recommendation the subscriber saw (or the
  // baseline at opt-in time). Stored as (ticker, weight) tuples so
  // the diff logic is decoupled from the engine's richer Sleeve
  // shape · only the comparison primitives are persisted.
  lastRec: SleeveSnapshot[];
  // Unix ms of the last time we sent a change email · used purely
  // for monitoring + the email body's "since [date]" line.
  lastSentAt: number;
  // Unix ms of the original opt-in · informational only.
  optedInAt: number;
};

export type SleeveSnapshot = {
  ticker: string;
  weight: number; // 0-100 (whole percent)
};

/**
 * Reduce the engine's Sleeve[] output to the (ticker, weight) tuples
 * we persist + compare against. Weight is stored as a whole percent
 * to match the user-facing display + keep the comparison stable
 * against tiny float drift.
 */
export function toSleeveSnapshot(allocation: Sleeve[]): SleeveSnapshot[] {
  return allocation.map((s) => ({
    ticker: s.asset.ticker,
    weight: Math.round(s.weight * 100), // recommend() weights are 0-1
  }));
}

/**
 * Extract just the MarketSignals fields from a full MarketSnapshot ·
 * matches the shape /fit's client polling assembles into the
 * recommend() input.
 */
export function marketSignalsFrom(
  snapshot: MarketSnapshot,
): MarketSignals {
  const mNAVByTicker: Record<string, number | null | undefined> = {};
  for (const t of snapshot.treasuries) {
    mNAVByTicker[t.ticker] = t.mNAV;
  }
  return {
    mNAVByTicker,
    fearGreed: snapshot.fearGreed,
    btcVol30d: snapshot.btcVol30d,
  };
}

export type DiffResult =
  | { changed: false; kind: "none" }
  | {
      changed: true;
      kind: "composition" | "weight";
      added: SleeveSnapshot[];   // in next, not in prev
      removed: SleeveSnapshot[]; // in prev, not in next
      shifted: Array<{
        ticker: string;
        prevWeight: number;
        nextWeight: number;
        deltaPp: number; // pp = percentage points, signed (next-prev)
      }>;
    };

// "Meaningful change" rule:
//   - Any sleeve added or removed (composition change) · always fires
//   - Otherwise: any sleeve weight delta >= 5 pp (percentage points)
// Below 5pp we treat as engine jitter from minor signal moves · the
// user doesn't want an email saying "MSTR went 41% → 43%."
const WEIGHT_DELTA_THRESHOLD_PP = 5;

export function diffAllocations(
  prev: SleeveSnapshot[],
  next: SleeveSnapshot[],
): DiffResult {
  const prevByTicker = new Map(prev.map((s) => [s.ticker, s.weight]));
  const nextByTicker = new Map(next.map((s) => [s.ticker, s.weight]));

  const added: SleeveSnapshot[] = [];
  const removed: SleeveSnapshot[] = [];
  const shifted: Array<{
    ticker: string;
    prevWeight: number;
    nextWeight: number;
    deltaPp: number;
  }> = [];

  for (const s of next) {
    if (!prevByTicker.has(s.ticker)) added.push(s);
  }
  for (const s of prev) {
    if (!nextByTicker.has(s.ticker)) removed.push(s);
  }
  for (const s of next) {
    const prevW = prevByTicker.get(s.ticker);
    if (prevW == null) continue; // already in `added`
    const delta = s.weight - prevW;
    if (Math.abs(delta) >= WEIGHT_DELTA_THRESHOLD_PP) {
      shifted.push({
        ticker: s.ticker,
        prevWeight: prevW,
        nextWeight: s.weight,
        deltaPp: delta,
      });
    }
  }

  if (added.length > 0 || removed.length > 0) {
    return { changed: true, kind: "composition", added, removed, shifted };
  }
  if (shifted.length > 0) {
    return { changed: true, kind: "weight", added, removed, shifted };
  }
  return { changed: false, kind: "none" };
}

/**
 * Project the recommend() output into the storage snapshot. Single
 * source of truth for "what we persist."
 */
export function snapshotFromRec(rec: Recommendation): SleeveSnapshot[] {
  return toSleeveSnapshot(rec.allocation);
}

/**
 * KV key for the per-email fit-alert record. Lowercased email
 * matches the rest of the subscriber-keyed conventions.
 */
export function fitAlertKey(email: string): string {
  return `fit-alert:${email.trim().toLowerCase()}`;
}
