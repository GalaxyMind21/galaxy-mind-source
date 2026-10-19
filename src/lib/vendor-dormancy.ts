// Vendor dormancy · KV-backed overlay on top of the static VENDORS roster.
//
// Lifecycle:
//   1. Vendor lands in vendors.ts (static, canonical, "this vendor exists")
//   2. Daily cron `/api/cron/audit-vendor-activity` checks Nostr-platform
//      vendors. Vendors silent >DORMANT_THRESHOLD_DAYS get marked dormant
//      via setDormant().
//   3. Dormant vendors are HIDDEN from default views (directory grid,
//      featured rotation, RecentlyAddedStrip, /api/vendors.json default
//      response) but their /v/[slug] page still resolves and stays in the
//      sitemap (preserves SEO + shared links + cached OG cards).
//   4. If a dormant vendor posts again, the cron observes activity and
//      calls clearDormant() · they auto-reappear in default views.
//   5. Vendors dormant >HARD_REMOVAL_REVIEW_DAYS show up in
//      audit-vendors.ts reports as "candidate for hard removal" ·
//      removal is always a human decision, never automatic.
//
// Why KV-backed (not committed to vendors.ts):
//   - Fully reversible · clear the KV key, vendor reappears
//   - No GitHub write access needed for the cron
//   - Fail-safe · if KV is unreachable, vendors look active by default
//     (the opposite would empty the directory on KV outages)
//   - Activity-recovery auto-clear works without git churn
//
// Why X / Lightning vendors are NOT auto-dormant-marked:
//   - X has no reliable public activity API (paid API costs ~$200/mo)
//   - Lightning Addresses don't have an "activity" concept beyond
//     endpoint health (covered by audit-vendors.ts liveness check)
//   - This means dormancy is a Nostr-only signal in practice. The
//     asymmetry is honest about what we can measure.

import { kvDel, kvGet, kvList, kvPushCapped, kvSet, kvListRemove } from "./kv";
import { VENDORS } from "./vendors";

// Activity threshold · vendors silent more than this get marked dormant.
// Per the README, the existing 90-day STALE_THRESHOLD warns on the card
// without removing. Dormancy is a stronger action (removed from default
// views) so the threshold is ALSO 30 days — caller-configurable so the
// audit cron can pass a different value if you tune it.
export const DEFAULT_DORMANT_THRESHOLD_DAYS = 30;

// After this many days dormant, the vendor surfaces in audit reports
// as a "candidate for hard removal" · the human decides whether to
// actually delete from vendors.ts.
export const HARD_REMOVAL_REVIEW_DAYS = 180;

// KV layout:
//   vendor:dormant:<handle>   → { since, lastActivityAt, source }
//   vendor:dormant:_index     → list of handles currently dormant
//
// The _index list lets us enumerate dormant vendors cheaply
// (e.g. on the homepage, where we want to filter the full vendor
// list without N round trips). Maintained in lockstep with the
// per-handle keys.
const KEY_PREFIX = "vendor:dormant:";
const INDEX_KEY = "vendor:dormant:_index";
const INDEX_CAP = 1000; // soft cap · directory will never reach this

export type DormancyRecord = {
  // Unix seconds when we first marked this vendor dormant.
  since: number;
  // Unix seconds of the last detected activity (kind:1 event for
  // Nostr) at the time of marking. May be null if we couldn't find
  // any activity at all (vendor never posted from this pubkey).
  lastActivityAt: number | null;
  // What signal triggered the mark · "nostr_silent" today; future
  // expansions might add "lightning_endpoint_dead" etc.
  source: "nostr_silent" | "manual";
};

export async function getDormancy(handle: string): Promise<DormancyRecord | null> {
  return kvGet<DormancyRecord>(KEY_PREFIX + handle);
}

/**
 * Returns all currently-dormant vendor handles. Used at request time
 * by the homepage / featured rotation / RecentlyAddedStrip /
 * /api/vendors.json to filter dormant vendors out of default views.
 *
 * Cached at the consumer layer (Next's route revalidation handles
 * this) · the function itself doesn't memoize because we want fresh
 * reads when the cache invalidates.
 */
export async function getDormantHandles(): Promise<Set<string>> {
  // Wrapped { handle } objects · kvPushCapped stores plain strings
  // as-is but kvList JSON-parses, so wrapping ensures clean
  // round-trip. Same pattern as vendor-submissions._index.
  const entries = await kvList<{ handle: string }>(INDEX_KEY, INDEX_CAP);
  const flagged = new Set(
    entries.map((e) => e.handle).filter((x): x is string => !!x),
  );
  if (flagged.size === 0) return flagged;

  // Operator-verification override (audit 2026-05).
  //
  // Dormancy means "no Nostr kind:1 post in >DORMANT_THRESHOLD days".
  // But a SHOP's npub legitimately may rarely post notes while the
  // business is fully active — so post-absence is a weak proxy for
  // "abandoned". If the operator MANUALLY re-verified the vendor more
  // recently than the silence window, that's a stronger, fresher
  // "active + accepts BTC" signal than the absence of casual posts,
  // and it overrides the dormant flag.
  //
  // Applied at READ time so it (a) takes effect immediately without a
  // KV write (the cron's flag is left intact — this just suppresses
  // it while verification is fresh), (b) auto-rolls back on as
  // verifiedAt ages past the window, (c) needs no GitHub/CRON auth.
  // Without this, a freshly-added + signature-verified vendor (e.g.
  // Lightning Bazaar — added & kind:0-verified this session but 122d
  // post-silent) gets auto-hidden the moment it lands, and its
  // country vanishes from the map/filter (the AU bug).
  const cutoff =
    Math.floor(Date.now() / 1000) - DEFAULT_DORMANT_THRESHOLD_DAYS * 86400;
  for (const v of VENDORS) {
    if (flagged.has(v.handle) && v.verifiedAt >= cutoff) {
      flagged.delete(v.handle);
    }
  }
  return flagged;
}

/**
 * Mark a vendor dormant. Idempotent: re-marking an already-dormant
 * vendor preserves the original `since` timestamp (so age-based
 * thresholds like HARD_REMOVAL_REVIEW_DAYS measure from first mark).
 */
export async function markDormant(
  handle: string,
  lastActivityAt: number | null,
  source: DormancyRecord["source"] = "nostr_silent",
): Promise<{ ok: boolean; firstMark: boolean }> {
  const existing = await getDormancy(handle);
  if (existing) {
    return { ok: true, firstMark: false };
  }
  const now = Math.floor(Date.now() / 1000);
  const record: DormancyRecord = {
    since: now,
    lastActivityAt,
    source,
  };
  const ok = await kvSet(KEY_PREFIX + handle, record);
  if (ok) {
    await kvPushCapped(INDEX_KEY, { handle }, INDEX_CAP);
  }
  return { ok, firstMark: true };
}

/**
 * Clear dormancy for a vendor (they came back). Removes the
 * per-handle key AND prunes from the index. Safe to call even if
 * the vendor wasn't dormant.
 */
export async function clearDormant(handle: string): Promise<boolean> {
  const ok = await kvDel(KEY_PREFIX + handle);
  // ONE atomic LREM, not read-DEL-repush. The old rewrite emptied the
  // index and re-pushed the survivors one HTTP call at a time, so a
  // function timeout or a single failed push inside that window dropped
  // the remaining handles for good: markDormant early-returns on the
  // per-handle key without touching the index, so nothing ever puts a
  // lost row back and the vendor silently stops looking dormant to the
  // operator (and can be featured in the social drafts, which the
  // dormancy signal exists to prevent).
  await kvListRemove(INDEX_KEY, { handle });
  return ok;
}
