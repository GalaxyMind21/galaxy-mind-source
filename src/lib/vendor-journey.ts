/* =====================================================================
 * lib/vendor-journey.ts · localStorage-backed vendor visit history
 *
 * Records the chronological list of LISTING KEYS (vendorKey · the /v
 * slug) the visitor has opened on /v/[slug]. Entries written before
 * 2026-10 are vendor HANDLES; readers resolve both forms through
 * normalizeVendorRefs() in lib/vendors (slug first, legacy handle
 * second), so old history keeps working without a storage migration. The most recent visit is at the head; older
 * visits trail behind, capped at MAX_HISTORY so the LS payload
 * stays tiny (~400 bytes max) and the "recently viewed" UI shows
 * the most relevant vendors.
 *
 * Why: turns the homepage into a "continue browsing where you left
 * off" surface for return visitors. Powerful retention pattern
 * (Spotify "Recently Played", Pinterest "Picked for you" etc.).
 *
 * Privacy: localStorage only · no server tracking, no cookies, no
 * cross-device. Cleared on devtools-storage-clear or a fresh device.
 *
 * Module boundary: this module is "use-anywhere" code that touches
 * window.localStorage · callers MUST be running in browser context.
 * On the server (SSR pre-paint), getJourney() returns an empty array
 * via the typeof window guard.
 *
 * Schema versioning: the LS key includes "_v1" so a future schema
 * change can ship a new key and silently leave v1 abandoned.
 * ===================================================================== */

const LS_KEY = "gm_vendor_journey_v1";
const MAX_HISTORY = 20;

export type VendorJourney = {
  // Listing keys (slugs), most-recent first. The field keeps its
  // original name so v1 storage stays readable; legacy entries may be
  // handles · resolve with normalizeVendorRefs before use.
  handles: string[];
  total: number; // monotonic visit count (NOT unique vendor count)
};

const EMPTY_JOURNEY: VendorJourney = { handles: [], total: 0 };

export function getJourney(): VendorJourney {
  if (typeof window === "undefined") return EMPTY_JOURNEY;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY_JOURNEY;
    const parsed = JSON.parse(raw) as Partial<VendorJourney>;
    if (
      !Array.isArray(parsed.handles) ||
      typeof parsed.total !== "number" ||
      parsed.total < 0
    ) {
      return EMPTY_JOURNEY;
    }
    // Defensive filter · stale LS could contain non-string entries.
    const handles = parsed.handles
      .filter((h): h is string => typeof h === "string" && h.length > 0)
      .slice(0, MAX_HISTORY);
    return { handles, total: parsed.total };
  } catch {
    return EMPTY_JOURNEY;
  }
}

/**
 * Record a vendor visit by listing key. Moves it to the head of the list,
 * dedupes prior occurrences, caps to MAX_HISTORY, increments the
 * monotonic total. No-op on the server.
 */
export function recordVisit(key: string): VendorJourney {
  if (typeof window === "undefined") return EMPTY_JOURNEY;
  if (!key || typeof key !== "string") return getJourney();

  const prev = getJourney();
  // Dedupe: remove any prior occurrence so the next push puts this
  // key at the head as "most recent".
  const filtered = prev.handles.filter((h) => h !== key);
  const next: VendorJourney = {
    handles: [key, ...filtered].slice(0, MAX_HISTORY),
    total: prev.total + 1,
  };

  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* LS quota / privacy mode · best-effort */
  }
  return next;
}
