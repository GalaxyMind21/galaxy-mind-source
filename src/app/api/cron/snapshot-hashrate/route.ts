// Daily cron · snapshot the hashrate desk to KV.
//
// Accumulates the daily hashprice + book series. The live page reads
// rig status from MRR; this cron writes history so /hashrate can draw
// a trail without putting today's book behind a KV lag. The opposite
// split from /api/float.
//
// NOT snapshot-quality gated: that helper guards the market-signal
// WARM-50 fallback and is unrelated to MRR availability. If the desk is
// degraded we record NOTHING rather than a null-filled row.

import { NextResponse } from "next/server";
import { kvList, kvPushCapped, isKvConfigured } from "@/lib/kv";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { getHashrateDesk } from "@/lib/hashrate";
import {
  HASHRATE_HISTORY_CAP_DAYS,
  HASHRATE_HISTORY_KEY,
  type HashrateHistoryRow,
} from "@/lib/hashrate-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HISTORY_KEY = HASHRATE_HISTORY_KEY;
const HISTORY_CAP_DAYS = HASHRATE_HISTORY_CAP_DAYS;

export async function GET(req: Request) {
  const auth = await verifyCronAuthLimited(req);
  if (!auth.ok) return auth.response;

  await recordCronRun("snapshot-hashrate");

  if (!isKvConfigured()) {
    return NextResponse.json({ ok: true, skipped: "kv-unconfigured" });
  }

  const desk = await getHashrateDesk();
  // A row with a live hashprice and four null book columns is worse than
  // no row: /hashrate draws this series as a trail, so a phantom gap
  // written today is a lie the chart tells later. `floor` /
  // `clearedLast30` / `clearedLast10` come
  // from algo-stats and `medianAsk` from the ask-book sweep, so either
  // feed failing empties most of the row while hashprice alone survives
  // — which the old hashprice-only guard happily wrote.
  //
  // our-rigs is deliberately NOT in this list: `ourBestRecovery` is the
  // one openly-nullable column, and an MRR outage should not also cost us
  // the price and book series (hashrate-available already alarms on it).
  const BLOCKING_FEEDS = ["ask-book", "algo-stats"] as const;
  const blocking = BLOCKING_FEEDS.filter((f) => desk.degraded.includes(f));
  if (desk.hashprice == null || blocking.length > 0) {
    console.error(
      "[snapshot-hashrate] degraded desk · not recording",
      desk.degraded,
    );
    return NextResponse.json(
      { ok: false, error: "degraded", degraded: desk.degraded },
      { status: 503 },
    );
  }

  const date = new Date().toISOString().slice(0, 10);
  const recent = await kvList<HashrateHistoryRow>(HISTORY_KEY, 1);
  if (recent[0]?.date === date) {
    return NextResponse.json({ ok: true, skipped: "already-recorded", date });
  }

  const recoveries = desk.ourRigs
    .map((r) => r.recovery)
    .filter((x): x is number => x != null);

  const snap: HashrateHistoryRow = {
    date,
    hashprice: desk.hashprice,
    floor: desk.book.floor,
    medianAsk: desk.book.medianAsk,
    clearedLast30: desk.book.clearedLast30,
    clearedLast10: desk.book.clearedLast10,
    ourBestRecovery: recoveries.length > 0 ? Math.max(...recoveries) : null,
    medianAskSampleSize: desk.bookSample.collected,
    medianAskComplete: desk.bookSample.complete,
  };

  const wrote = await kvPushCapped(HISTORY_KEY, snap, HISTORY_CAP_DAYS);
  if (!wrote) {
    return NextResponse.json(
      { ok: false, error: "KV write failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, date, snapshot: snap });
}
