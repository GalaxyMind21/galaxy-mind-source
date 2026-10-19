// GET /api/admin/cron-health · operator-only cron liveness dashboard.
//
// Returns the last-fire age for every scheduled cron and flags the
// overdue ones, so the operator can spot a silently-stopped cron at a
// glance instead of trawling the Vercel dashboard. Recommended by the
// 2026-06-01 pen test.
//
// Auth · CRON_SECRET bearer, same gate as the crons themselves
// (verifyCronAuth). No PII, no list contents · just cron names + ages.
//
// Usage:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     https://galaxymind.space/api/admin/cron-health
import { NextResponse } from "next/server";
import { verifyAdminAuthLimited } from "@/lib/cron-auth";
import { getAllCronStatuses } from "@/lib/cron-health";
import { checkConstantsFreshness } from "@/lib/constants-freshness";
import { VENDORS, verifiedAtClusterStats } from "@/lib/vendors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await verifyAdminAuthLimited(request);
  if (!auth.ok) return auth.response;

  const now = Date.now();
  const crons = await getAllCronStatuses(now);
  const stale = crons.filter((c) => c.stale);

  // Freshness of the hand-sourced treasury constants (share counts +
  // senior claims). These feed real mNAV / BPS / Amplification numbers
  // and decay fast for the overridden names, so surface their as-of age
  // here next to the cron ages · the operator's one health endpoint.
  const constants = checkConstantsFreshness(new Date(now));
  const staleConstants = constants.filter((c) => c.stale);
  const verification = verifiedAtClusterStats(VENDORS, now / 1000);

  return NextResponse.json({
    ok: true,
    asOf: new Date(now).toISOString(),
    total: crons.length,
    staleCount: stale.length,
    staleNames: stale.map((c) => c.name),
    crons,
    constants: {
      total: constants.length,
      staleCount: staleConstants.length,
      staleNames: staleConstants.map((c) => c.name),
      items: constants,
    },
    // Operator signal only. Never auto-bumps verifiedAt.
    verification,
  });
}
