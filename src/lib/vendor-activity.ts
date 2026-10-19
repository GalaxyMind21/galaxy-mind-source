/* =====================================================================
 * lib/vendor-activity.ts · KV-backed last-activity record per vendor
 *
 * Sister module to lib/vendor-dormancy.ts. Where dormancy stores
 * "this vendor has gone quiet" (boolean state, only present for
 * dormant vendors), activity stores "this vendor was last seen at
 * unix-time T" for ALL Nostr vendors regardless of dormancy state.
 *
 * Why both:
 *   - Dormancy is a UX overlay (binary · "hide from default views?")
 *   - Activity is a TRUST SIGNAL (continuous · "last seen 2d ago")
 *
 * Today the only consumer is the /v/[slug] activity ribbon, which
 * reads activity for active (non-dormant) Nostr vendors and renders
 * a "Recently active on Nostr · last seen Nd ago" pill. Dormant
 * vendors get the existing dormancy banner instead (different copy,
 * warning color).
 *
 * Populated by the daily audit cron (`/api/cron/audit-vendor-activity`)
 * which already queries Nostr relays for last-activity timestamps as
 * part of its dormancy logic. We extend it to also write the
 * timestamp to KV (regardless of whether the vendor is dormant).
 *
 * Failure mode: KV unconfigured / write failure → reads return null
 * → /v/[slug] silently shows no activity pill (graceful). The
 * dormancy logic stays intact independent of this · they're written
 * separately.
 * ===================================================================== */

import { kvGet, kvSet } from "./kv";

const KEY_PREFIX = "vendor:activity:";

export type ActivityRecord = {
  /** Unix seconds of the last detected activity (kind:1 event for Nostr). */
  lastSeenAt: number;
  /** Unix seconds when this record was written by the cron. */
  recordedAt: number;
  /** What signal produced this · "nostr" today; future expansions
   * could add "lightning" if endpoint-health probes ever feed in. */
  source: "nostr";
};

export async function getActivity(handle: string): Promise<ActivityRecord | null> {
  return kvGet<ActivityRecord>(KEY_PREFIX + handle);
}

/**
 * Write or replace the activity record for a vendor. Called by the
 * audit cron after each Nostr query · idempotent (overwrites).
 */
export async function setActivity(
  handle: string,
  lastSeenAt: number,
  source: "nostr" = "nostr",
): Promise<void> {
  if (!Number.isFinite(lastSeenAt) || lastSeenAt <= 0) return;
  await kvSet(KEY_PREFIX + handle, {
    lastSeenAt,
    recordedAt: Math.floor(Date.now() / 1000),
    source,
  });
}

/** Days between two unix-second timestamps, floor()'d to whole days. */
export function daysBetween(fromSec: number, toSec: number): number {
  return Math.max(0, Math.floor((toSec - fromSec) / 86_400));
}
