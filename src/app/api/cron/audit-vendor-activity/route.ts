// Daily cron · vendor activity audit + dormancy auto-mark/clear.
//
// Schedule: 02:00 UTC daily. After the 00:05/00:10/00:15 snapshot
// crons (so we don't compete for upstream rate limits) and well
// before the 12:00 social-post-drafts cron (so dormant flags
// propagate before any outbound that mentions a vendor). The earlier
// rationale citing daily-tweet is stale — that cron was deleted
// May 13, 2026.
//
// What it does:
//   - For each Nostr-platform vendor (NIP-05 or bech32 npub/nprofile):
//     - Resolve to hex pubkey
//     - Query relays for last kind:1 (text note) timestamp
//     - If silent > DORMANT_THRESHOLD_DAYS AND not already dormant
//       → markDormant() · vendor disappears from default views
//     - If activity returned AND currently dormant
//       → clearDormant() · vendor reappears in default views
//   - X / Lightning vendors are SKIPPED · we don't have a reliable
//     activity check for those platforms (X has no public API,
//     Lightning Addresses don't have an "activity" concept beyond
//     endpoint health which is covered by the manual audit script).
//
// Why this never auto-removes from vendors.ts:
//   - Dormancy is a UX overlay (hide from default views), not a data
//     deletion. The /v/[slug] page still resolves, the sitemap still
//     includes it, shared social previews still work.
//   - A vendor who comes back posts again → cron observes → auto-clear.
//     Zero human intervention needed for the recovery path.
//   - Vendors dormant >180d show up in `audit-vendors.ts` reports as
//     "candidate for hard removal" · human decides whether to delete
//     from vendors.ts. Removal stays a trust decision, not data quality.
//
// Honors SOCIAL_AUTOMATION_DISABLED (kills all changes) and
// DRY_RUN_SOCIAL=1 (logs would-be actions without writing to KV).

import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { isKvConfigured } from "@/lib/kv";
import {
  DEFAULT_DORMANT_THRESHOLD_DAYS,
  clearDormant,
  getDormancy,
  markDormant,
} from "@/lib/vendor-dormancy";
import { setActivity } from "@/lib/vendor-activity";
import {
  fetchLastNostrActivity,
  resolveNostrHandleToPubkey,
} from "@/lib/nostr-activity";
import { VENDORS, getPlatform } from "@/lib/vendors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SECS_PER_DAY = 86_400;

type VendorAction =
  | { action: "no_change"; reason: string }
  | { action: "marked_dormant"; daysSilent: number; lastActivityAt: number | null }
  | { action: "cleared_dormant"; daysSilent: number }
  | { action: "skipped"; reason: string }
  | { action: "error"; reason: string };

export async function GET(req: NextRequest) {
  const auth = await verifyCronAuthLimited(req);
  if (!auth.ok) return auth.response;
  // Cron liveness · best-effort, never throws (see lib/cron-health).
  await recordCronRun("audit-vendor-activity");

  if (
    process.env.SOCIAL_AUTOMATION_DISABLED === "1" ||
    process.env.SOCIAL_AUTOMATION_DISABLED === "true"
  ) {
    return NextResponse.json({
      ok: true,
      action: "skipped",
      reason: "SOCIAL_AUTOMATION_DISABLED env set",
    });
  }
  if (!isKvConfigured()) {
    return NextResponse.json(
      { ok: false, error: "KV not configured · cron needs the dormancy store" },
      { status: 503 },
    );
  }

  const dryRun =
    process.env.DRY_RUN_SOCIAL === "1" ||
    process.env.DRY_RUN_SOCIAL === "true" ||
    new URL(req.url).searchParams.get("dryRun") === "1";

  const thresholdDays = DEFAULT_DORMANT_THRESHOLD_DAYS;
  const now = Math.floor(Date.now() / 1000);
  const thresholdSecs = thresholdDays * SECS_PER_DAY;

  // Only audit Nostr vendors · see file header for why X/Lightning
  // are excluded.
  const nostrVendors = VENDORS.filter((v) => getPlatform(v) === "nostr");

  // Run in parallel batches of 8 · matches the audit script's
  // concurrency pattern and keeps total runtime under a minute even
  // for a directory of hundreds.
  const BATCH = 8;
  const results: Array<{ handle: string; name: string } & VendorAction> = [];
  for (let i = 0; i < nostrVendors.length; i += BATCH) {
    const batch = nostrVendors.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (v) => {
        const pubkey = await resolveNostrHandleToPubkey(v.handle);
        if (!pubkey) {
          return {
            handle: v.handle,
            name: v.name,
            action: "skipped" as const,
            reason: "could not resolve handle to pubkey",
          };
        }
        const { lastActivityAt, reachable } = await fetchLastNostrActivity(pubkey);
        // Bug fix 2026-06-02: fetchLastNostrActivity used to return null
        // for BOTH "no recent posts" and "every relay failed/timed out".
        // A correlated relay outage during this daily cron therefore
        // marked ACTIVE vendors dormant and hid them from the directory.
        // If no relay answered definitively, skip · fail-open per the
        // vendor-dormancy doctrine ("if we can't tell, leave it visible").
        if (!reachable) {
          return {
            handle: v.handle,
            name: v.name,
            action: "skipped" as const,
            reason: "nostr relays unreachable",
          };
        }
        // Record activity for the /v/[slug] activity ribbon · written
        // for ALL Nostr vendors regardless of dormancy state. Skipped
        // when no activity was found at all (no record to write).
        if (!dryRun && lastActivityAt !== null) {
          try {
            await setActivity(v.handle, lastActivityAt, "nostr");
          } catch {
            // KV write failure shouldn't break the dormancy audit ·
            // the activity ribbon is purely additive UX.
          }
        }
        const existing = await getDormancy(v.handle);
        const daysSilent =
          lastActivityAt !== null
            ? Math.floor((now - lastActivityAt) / SECS_PER_DAY)
            : Number.POSITIVE_INFINITY;
        const isSilent = now - (lastActivityAt ?? 0) > thresholdSecs;

        if (isSilent && !existing) {
          // Mark dormant.
          if (!dryRun) {
            await markDormant(v.handle, lastActivityAt, "nostr_silent");
          }
          return {
            handle: v.handle,
            name: v.name,
            action: "marked_dormant" as const,
            daysSilent: lastActivityAt !== null ? daysSilent : -1,
            lastActivityAt,
          };
        }
        if (!isSilent && existing) {
          // Activity returned · clear dormant.
          if (!dryRun) {
            await clearDormant(v.handle);
          }
          return {
            handle: v.handle,
            name: v.name,
            action: "cleared_dormant" as const,
            daysSilent: lastActivityAt !== null ? daysSilent : 0,
          };
        }
        return {
          handle: v.handle,
          name: v.name,
          action: "no_change" as const,
          reason: existing
            ? `still dormant (${daysSilent}d silent)`
            : `active (${daysSilent}d since last post)`,
        };
      }),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") {
        results.push(s.value);
      } else {
        results.push({
          handle: "unknown",
          name: "unknown",
          action: "error",
          reason: String(s.reason),
        });
      }
    }
  }

  const counts = {
    marked: results.filter((r) => r.action === "marked_dormant").length,
    cleared: results.filter((r) => r.action === "cleared_dormant").length,
    no_change: results.filter((r) => r.action === "no_change").length,
    skipped: results.filter((r) => r.action === "skipped").length,
    error: results.filter((r) => r.action === "error").length,
  };

  return NextResponse.json({
    ok: true,
    thresholdDays,
    dryRun,
    counts,
    auditedNostrVendors: nostrVendors.length,
    results: results.filter((r) => r.action !== "no_change"),
  });
}
