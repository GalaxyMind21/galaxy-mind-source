// GET /api/dormant-vendors · operator-only.
//
// Public hiding of dormant vendors was removed 2026-05-20. The homepage
// no longer consumes this. The list is an operator signal (quiet Nostr
// vendors for social-drafts / hard-removal review), so it is now
// ADMIN_SECRET gated instead of CORS-open.

import { NextResponse } from "next/server";
import { getDormantHandles } from "@/lib/vendor-dormancy";
import { verifyAdminAuthLimited } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await verifyAdminAuthLimited(req);
  if (!auth.ok) return auth.response;
  const handles = await getDormantHandles();
  return NextResponse.json(
    {
      handles: [...handles],
      count: handles.size,
      asOf: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
