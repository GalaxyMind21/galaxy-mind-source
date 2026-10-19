// Daily cron — snapshots today's Buying Gauge verdict to KV.
//
// Purpose:
// Builds a persistent score history that powers /stack's history
// sparkline. Without this, users see a single-number gauge with no
// context for "is 72 high or low?" — which is the most common
// question that lands on the page.
//
// Trigger: Vercel cron daily at 00:05 UTC (just after the day rolls
// over so the entry is dated as the *previous* day's verdict).
//
// Storage: kvPushCapped("stack:history", {...}, 365) — keeps the
// most-recent year of snapshots, dropping older entries automatically
// via LTRIM. Free-tier Upstash easily handles this volume.
//
// Idempotency: if the cron runs twice on the same day (manual retry,
// duplicate Vercel trigger), we'd get two entries for the same date.
// To prevent that, we read the most recent entry first and skip if
// today's date already exists. Cheaper than maintaining a separate
// "last snapshot date" key.
import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market";
import { computeStackVerdict } from "@/lib/stack";
import { kvList, kvPushCapped, isKvConfigured } from "@/lib/kv";
import { verifyCronAuthLimited } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-health";
import { isIndexNowConfigured, pingIndexNow } from "@/lib/indexnow";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HISTORY_KEY = "stack:history";
const HISTORY_CAP_DAYS = 365;

export type StackSnapshot = {
  date: string;       // YYYY-MM-DD (UTC) · the day this verdict represents
  score: number;      // 0-100
  tier: string;       // COLD/CHILL/WARM/HOT/MOLTEN
  // Slim signal payload — just name + normalized score, not the full
  // SignalReading objects (which include rationale strings — bloat the
  // KV payload for no reader benefit at history time).
  signals: { name: string; normalized: number }[];
  asOf: string;       // ISO timestamp of the snapshot
};

export async function GET(request: Request) {
  const auth = await verifyCronAuthLimited(request);
  if (!auth.ok) return auth.response;
  // Cron liveness · best-effort, never throws (see lib/cron-health).
  await recordCronRun("snapshot-stack");

  if (!isKvConfigured()) {
    return NextResponse.json(
      { ok: false, error: "KV not configured · snapshot skipped." },
      { status: 503 },
    );
  }

  const snapshot = await getMarketSnapshot();

  // Refuse to write degraded snapshots into stack:history · same
  // 4-of-8 threshold check-thresholds + weekly-digest use. Without
  // this guard, multi-day Yahoo / CoinGecko / Coinmetrics outages
  // would pollute the history list with score=50 fallback rows that
  // (1) leak into the /stack sparkline as a flat plateau visually
  // identical to "the market was actually neutral" and (2) feed into
  // weekly-digest's min/avg/max calculation, which would happily
  // report "min 50, avg 50, max 50" through the entire outage.
  // Returning 503 surfaces in the Vercel cron dashboard as a failure
  // → ops alarm. Sister cron snapshot-treasuries was hardened in
  // May 2026 with the same "refusedAllNull" pattern; this is the
  // matching M-class fix for the stack-snapshot side. (Audit
  // 2026-05-14 finding C-1.)
  if (isMarketSnapshotDegraded(snapshot)) {
    console.error(
      `[cron/snapshot-stack] snapshot degraded · refusing to write phantom history row`,
    );
    return NextResponse.json(
      {
        ok: false,
        error: "snapshot degraded · refusing to write phantom history row",
      },
      { status: 503 },
    );
  }

  const verdict = computeStackVerdict(snapshot);

  // Calendar UTC yesterday (not wall-clock − 12h). The cron fires at
  // 00:05 UTC so "today" is the new day; we tag the row as yesterday's
  // EOD. A late retry after 12:00 UTC must still tag the same calendar
  // day — Date.now() − 12h would flip to "today" and poison history.
  const now = new Date();
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  )
    .toISOString()
    .slice(0, 10);

  // Idempotency: if today's date is already in the list, skip.
  const recent = await kvList<StackSnapshot>(HISTORY_KEY, 1);
  if (recent[0]?.date === date) {
    return NextResponse.json({
      ok: true,
      action: "skip",
      reason: "already snapshotted today",
      date,
    });
  }

  const entry: StackSnapshot = {
    date,
    score: verdict.score,
    tier: verdict.tier,
    signals: verdict.signals.map((s) => ({
      name: s.name,
      normalized: s.normalized,
    })),
    asOf: new Date().toISOString(),
  };

  const ok = await kvPushCapped(HISTORY_KEY, entry, HISTORY_CAP_DAYS);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "KV write failed" },
      { status: 500 },
    );
  }

  // Push /stack to IndexNow so Bing / Yandex / Naver / Seznam re-crawl
  // within minutes of the snapshot landing. Best-effort · the cron's
  // ok:true response is independent of IndexNow's response (we report
  // it in the payload but never fail the cron on it). The fetch IS
  // awaited (5s timeout in lib/indexnow.ts) so the cron blocks briefly
  // on it · this is intentional, not a `void promise` fire-and-forget
  // (which would get terminated by the runtime · see submit-vendor
  // route's M5 fix from 2026-05-14). No-op if INDEXNOW_KEY isn't
  // configured (returns ok:false, status:0 with reason logged in the
  // response payload for the operator).
  let indexNow: { ok: boolean; status: number } | null = null;
  if (isIndexNowConfigured()) {
    const r = await pingIndexNow(["https://galaxymind.space/stack"]);
    indexNow = { ok: r.ok, status: r.status };
  }

  return NextResponse.json({
    ok: true,
    action: "snapshot",
    date,
    score: verdict.score,
    tier: verdict.tier,
    indexNow,
  });
}
