/**
 * mrr-units · live availability of our 270 TH/s units for the MRR-only /hashrate (operator 2026-10-17).
 *
 * The ONLY module allowed to build a per-unit marketplace link. Rig ids leave this module only inside the href that
 * unitHref() builds, always https, always with our referral id. Never in visible text, alt or aria text, never in an
 * API body (assertCustomerSafe still blocks them there). Enforced by scripts/check-no-mrr-public.ts
 * (scripts/lib/no-mrr-mention.ts checkUnitsModule) and scripts/test-mrr-only.tsx.
 *
 * Source (brief 2026-10-17 §5): the marketplace's public, keyless GET /rig/{id;id} via lib/mrr.ts
 * getUnitStates, one call for every unit, cached 60 s WITH its fetch time so staleness is visible downstream.
 *
 * Availability rule (reverses the 2026-09-14 "rented vs available only" note for THIS view):
 *   free = our account owns it && status.status === "available" && !rented && available_status === "available"
 *          && online && measured hashrate (15 min) > 0.
 * So a unit set unavailable/disabled on the marketplace, offline, not hashing or already rented never shows as
 * free. Data older than STALE_MS hides counts and unit buttons; the page falls back to the profile link.
 */
import { getUnitStates, type MrrUnitState } from "@/lib/mrr";
import { XP_UNIT_IDS_FROM_ENV } from "@/lib/fleet-ids";

/** Our 270 TH/s units, #01-#30, in fleet order (GALAXY_MIND_XP_UNIT_IDS, lib/fleet-ids.ts). Other hardware is never listed. */
export const XP_UNIT_IDS: readonly string[] = XP_UNIT_IDS_FROM_ENV;
export const UNIT_TH = 270;
export const OWNER = "GalaxyMind";
/** Older than this, counts and unit buttons are hidden (fleet rules: never relay a reading older than 15 minutes). */
export const STALE_MS = 15 * 60 * 1000;
export const CACHE_SEC = 60;

const RIG_LINK_PREFIX = "https://www.miningrigrentals.com/rigs/";
const REF_QUERY = "?ref=2770797";
const ID_RE = /^\d{6}$/;

/** The one per-unit link form. Throws for anything that is not one of our unit ids. */
export function unitHref(id: string): string {
  if (!ID_RE.test(id) || !XP_UNIT_IDS.includes(id)) throw new Error("not_a_unit");
  return `${RIG_LINK_PREFIX}${id}${REF_QUERY}`;
}
/** Exact shape unitHref produces, for tests and the gate. */
export const UNIT_HREF_RE = /^https:\/\/www\.miningrigrentals\.com\/rigs\/(\d{6})\?ref=2770797$/;

export function isUnitFree(u: MrrUnitState): boolean {
  return (
    XP_UNIT_IDS.includes(u.id) &&
    u.owner === OWNER &&
    u.status === "available" &&
    !u.rented &&
    u.availableStatus === "available" &&
    u.online &&
    u.measured15Th != null &&
    u.measured15Th > 0
  );
}

export type UnitSnapshot = {
  /** Fetch time (ms). */
  at: number;
  /** Free units, best measured first, as hrefs only. */
  free: string[];
  total: number;
  rented: number;
};

/** Pure: project a feed read into a snapshot. Order: measured hashrate desc, then fleet order. */
export function snapshotFrom(states: readonly MrrUnitState[], at: number): UnitSnapshot {
  const ours = states.filter((s) => XP_UNIT_IDS.includes(s.id) && s.owner === OWNER);
  const free = ours
    .filter(isUnitFree)
    .sort((a, b) => (b.measured15Th ?? 0) - (a.measured15Th ?? 0) || XP_UNIT_IDS.indexOf(a.id) - XP_UNIT_IDS.indexOf(b.id))
    .map((s) => unitHref(s.id));
  return { at, free, total: XP_UNIT_IDS.length, rented: ours.filter((s) => s.rented).length };
}

export type UnitsView =
  | { state: "live"; at: number; free: string[]; freeCount: number; total: number; rented: number }
  | { state: "stale" | "unavailable" };

/** Pure: what the page may show. Stale or missing data shows no count and no unit button. */
export function unitsView(s: UnitSnapshot | null, now: number): UnitsView {
  if (!s) return { state: "unavailable" };
  if (!(now - s.at <= STALE_MS) || s.at > now + 60_000) return { state: "stale" };
  return { state: "live", at: s.at, free: s.free, freeCount: s.free.length, total: s.total, rented: s.rented };
}

async function readSnapshot(): Promise<UnitSnapshot> {
  const states = await getUnitStates(XP_UNIT_IDS);
  // Throw (never cache) a failed read: the cache keeps the last good snapshot, whose own `at` then ages out.
  if (!states) throw new Error("units_unavailable");
  return snapshotFrom(states, Date.now());
}

/** Server-side: cached (60 s) snapshot with its fetch time, or null when the feed has never answered. */
export async function getUnitSnapshot(): Promise<UnitSnapshot | null> {
  try {
    const { unstable_cache } = await import("next/cache");
    return await unstable_cache(readSnapshot, ["mrr-units-v1"], { revalidate: CACHE_SEC })();
  } catch {
    try { return await readSnapshot(); } catch { return null; }
  }
}
