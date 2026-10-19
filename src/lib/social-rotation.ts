// Social-post rotation · KV-backed cooldown tracking so the daily
// draft cron doesn't re-feature the same vendors back-to-back.
//
// Source of truth for "who has been featured recently" is KV, not
// any hand-kept notes.
// The cron writes cooldown records each time it drafts; the same
// records also serve as the queryable backing store for any future
// "show me used vendors" admin surface.
//
// Storage:
//   key:   social:cd:<platform>:<handle>
//   value: { usedAt: number, postType: string }   (JSON)
//   TTL:   14 days (matches the documented cooldown convention)
//
// Lifecycle:
//   markUsed(platform, handle, postType) · writes the record
//   isOnCooldown(platform, handle)        · returns boolean
//   filterAvailable(platform, candidates) · filters out on-cooldown
//
// All functions degrade gracefully when KV is unconfigured ·
// without KV the cooldown system is a no-op (everyone is always
// "available"), and the cron falls back to manual operator memory
// (the README path).
//
// Why 14 days · long enough that a vendor isn't featured
// twice in the same week, short enough that the pool cycles within
// a quarter even at a daily-post cadence.

import { kvGet, kvSet, isKvConfigured } from "./kv";
import type { VendorPlatform } from "./vendors";

// 14 days in seconds.
export const COOLDOWN_SECONDS = 14 * 24 * 60 * 60;

// Post types we currently produce · used for diagnostics + future
// "post-type-specific cooldowns" (e.g. spotlight: 14d, recap: 7d).
// For now all post types share the same 14-day cooldown.
export type SocialPostType = "spotlight" | "recap" | "callout";

export type CooldownRecord = {
  usedAt: number;     // unix seconds when marked used
  postType: SocialPostType;
};

function key(platform: VendorPlatform, handle: string): string {
  // Normalize the handle so case differences don't break the lookup
  // (X handles are case-insensitive; bech32 + LN addresses we keep
  // as-is). lower-case for X, leave others alone.
  const normalized = platform === "x" ? handle.toLowerCase() : handle;
  return `social:cd:${platform}:${normalized}`;
}

/**
 * Record that a vendor was featured in a social post. Sets a KV key
 * with a 14-day TTL · subsequent calls to isOnCooldown will return
 * true until the TTL elapses.
 *
 * Returns true on success, false if KV is unconfigured or the write
 * failed. The cron treats false as a soft failure (the draft still
 * goes out · the operator just won't have a record, which the
 * markdown file can compensate for).
 */
export async function markUsed(
  platform: VendorPlatform,
  handle: string,
  postType: SocialPostType,
): Promise<boolean> {
  if (!isKvConfigured()) return false;
  const record: CooldownRecord = {
    usedAt: Math.floor(Date.now() / 1000),
    postType,
  };
  const ok = await kvSet(key(platform, handle), record, COOLDOWN_SECONDS);
  // Log per-handle when the write fails AND KV IS configured · this
  // distinguishes "KV unconfigured (returned false above)" from "KV
  // up but the write failed." Without this, lib/kv.ts logs a generic
  // [kv] HTTP 500 with no caller context · operator can't tell which
  // vendor's cooldown silently failed and would re-feature within 14d.
  if (!ok) {
    console.error(
      `[social-rotation:markUsed] kvSet failed · platform=${platform} handle=${handle} · vendor may be re-picked within cooldown window`,
    );
  }
  return ok;
}

/**
 * Check if a handle is currently on cooldown. Returns true if a KV
 * record exists (TTL hasn't elapsed), false otherwise (no record
 * OR KV unconfigured).
 *
 * KV-unconfigured → false (fail-open) · matches the rest of the
 * rotation system. Better to draft a maybe-recently-used vendor
 * than to wedge the whole pool.
 */
export async function isOnCooldown(
  platform: VendorPlatform,
  handle: string,
): Promise<boolean> {
  if (!isKvConfigured()) return false;
  const record = await kvGet<CooldownRecord>(key(platform, handle));
  return record !== null;
}

/**
 * Filter a list of handles to only those NOT on cooldown. Runs the
 * KV lookups in parallel so even a large candidate pool resolves in
 * one round-trip's worth of latency rather than N.
 *
 * Useful for the cron's "pick the next batch" step:
 *   const available = await filterAvailable("x", xCandidates);
 *   const picks = pickWithCategoryDiversity(available, 3);
 */
export async function filterAvailable<T extends { handle: string }>(
  platform: VendorPlatform,
  candidates: T[],
): Promise<T[]> {
  if (!isKvConfigured() || candidates.length === 0) {
    // No KV · everyone's "available" (no cooldown enforcement).
    return candidates;
  }
  // Promise.allSettled (not Promise.all) so a per-key KV flake on
  // ONE candidate doesn't strand the whole filter. On a per-key
  // rejection we fail-open (treat as "not on cooldown") to match
  // the existing posture, AND log per-handle so the operator can
  // correlate "vendor surfaced unexpectedly" to "transient KV
  // failure on this specific lookup." Without the log, a single
  // KV flake silently violates the 14-day cooldown for one vendor.
  const settled = await Promise.allSettled(
    candidates.map((c) => isOnCooldown(platform, c.handle)),
  );
  const cooldowns = settled.map((r, i) => {
    if (r.status === "rejected") {
      console.warn(
        `[social-rotation:filterAvailable] cooldown lookup failed · platform=${platform} handle=${candidates[i].handle} · failing open`,
      );
      return false; // fail-open · matches isOnCooldown's KV-down posture
    }
    return r.value;
  });
  return candidates.filter((_, i) => !cooldowns[i]);
}
