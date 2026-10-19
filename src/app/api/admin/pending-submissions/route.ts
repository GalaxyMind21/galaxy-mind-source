// GET /api/admin/pending-submissions · auth-gated list of pending
// vendor submissions for the review CLI.
//
// Returns: { submissions: VendorSubmission[] }
// Auth: Bearer CRON_SECRET (same shared secret used by the cron routes)

import { NextRequest, NextResponse } from "next/server";
import { readVendorNotify } from "@/lib/vendor-notify-key";
import { verifyAdminAuthLimited } from "@/lib/cron-auth";
import { listPendingSubmissions } from "@/lib/vendor-submissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await verifyAdminAuthLimited(req);
  if (!auth.ok) return auth.response;
  const submissions = await listPendingSubmissions();

  // Annotate each record with whether a notify address is on file.
  //
  // A BOOLEAN, never the address itself: this endpoint is the operator
  // tooling's view of the queue, and the address is PII that no caller
  // here needs to see. What they need is the ability to tell a
  // submission that CAN be answered from one that cannot, so
  // clear-pending-submissions can refuse to silently sweep the former.
  const withNotify = await Promise.all(
    submissions.map(async (sub) => ({
      ...sub,
      hasNotifyAddress: Boolean(
        await readVendorNotify(sub.vendor.handle, sub.vendor.name),
      ),
    })),
  );

  return NextResponse.json({
    submissions: withNotify,
    count: withNotify.length,
  });
}
