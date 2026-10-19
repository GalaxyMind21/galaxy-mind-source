// Daily cron · pings WEN daily-drop subscribers when the new puzzle
// opens (scheduled 00:20 UTC · 20 minutes after the UTC-midnight
// rollover so the history API's new close has settled). NOTE: on the
// HOBBY plan Vercel's cron precision is per-hour (±59 min), so this
// actually fires somewhere in the 00:00 hour, possibly at 00:00 sharp.
// That is safe here BY CONSTRUCTION and must stay that way: this
// handler does no history fetch — it derives everything from the day
// number, and the whole ±59 min window sits inside one UTC day, so
// gauntletNumber() cannot slip. Don't add an upstream read to this
// route that assumes the new close has landed. Broadcasts to the "wen" push
// topic ONLY · gauge-alert subscribers never receive game pings (their
// opt-in contract is rare threshold alerts, and a daily ping to that
// audience is exactly the alert-fatigue the email dedupe system exists
// to prevent). Best-effort like every push path: a failed broadcast is
// a log line, never a retry storm.

import { NextResponse } from "next/server";
import { gauntletNumber, summitLevelFor } from "@/lib/gauntlet-day";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { broadcastPush } from "@/lib/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await verifyCronAuthLimited(request);
  if (!auth.ok) return auth.response;
  await recordCronRun("wen-drop");

  const n = gauntletNumber(Date.now());
  // The daily loop is five rituals now · the push names today's summit
  // level because a concrete mountain is the tap-worthy hook. Lands on
  // /today (the checklist hub), not a single cabinet.
  const lvl = summitLevelFor(n);
  const result = await broadcastPush(
    {
      title: `Daily drop #${n}: Summit on level ${lvl}`,
      body: "Date the chart, lead the expedition, beat the bot, race the tape, climb the mountain, take the circuit. Keep the streak.",
      url: "/today",
      tag: "wen-drop",
    },
    { topic: "wen" },
  );
  if (result.firstError) {
    console.error(
      `[cron/wen-drop] push partial failure · delivered ${result.delivered}/${result.attempted} · ${result.firstError}`,
    );
  }
  return NextResponse.json({ ok: true, n, ...result });
}
