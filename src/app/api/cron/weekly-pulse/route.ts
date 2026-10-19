// Weekly cron · composes the Weekly Pulse snapshot and appends it to
// the KV archive (once per UTC week · idempotent on re-run). The
// /pulse page reads the archive; this route is what makes the archive
// grow. Schedule: Mondays (see vercel.json).
//
// Manual: curl -H "Authorization: Bearer $CRON_SECRET" \
//              https://galaxymind.space/api/cron/weekly-pulse

import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { composePulse, savePulseSnapshot } from "@/lib/pulse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await verifyCronAuthLimited(req);
  if (!auth.ok) return auth.response;
  await recordCronRun("weekly-pulse");

  try {
    const snap = await composePulse();
    const result = await savePulseSnapshot(snap);
    // A failed archive write is a FAILURE, not an ok:true (fixed
    // 2026-07-25). Returning 200 here meant a KV outage produced a
    // green cron in the Vercel dashboard while /pulse's archive silently
    // stopped growing — the same "loud failure" posture the other
    // snapshot crons use, so Vercel's own cron-failure alert fires.
    if (result === "write_failed") {
      return NextResponse.json(
        { ok: false, error: "archive_write_failed", snapshot: snap },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, action: result, snapshot: snap });
  } catch (e) {
    console.error(
      `[cron/weekly-pulse] failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return NextResponse.json(
      { ok: false, error: "compose_or_save_failed" },
      { status: 500 },
    );
  }
}
