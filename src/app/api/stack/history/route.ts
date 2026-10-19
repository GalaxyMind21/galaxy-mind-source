// GET /api/stack/history?days=N — daily Buying Gauge score history.
//
// Reads from KV ("stack:history" list, populated by the daily
// snapshot cron). Returns the most-recent N entries (default 90,
// capped at 365 — the storage cap).
//
// Edge-cached 5 min · days values are allow-listed (≤4 cache keys).
// No per-IP rate limit: reading headers would force this route
// dynamic and disable the edge cache (see lib/rate-limit.ts).

import { NextRequest, NextResponse } from "next/server";
import { kvList } from "@/lib/kv";
import type { StackSnapshot } from "../../cron/snapshot-stack/route";

export const revalidate = 300; // 5 min

const ALLOWED_DAYS = new Set([30, 90, 180, 365]);
const DEFAULT_DAYS = 90;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const requested = Number(url.searchParams.get("days") ?? DEFAULT_DAYS);
  const days =
    Number.isFinite(requested) && ALLOWED_DAYS.has(Math.floor(requested))
      ? Math.floor(requested)
      : DEFAULT_DAYS;

  // KV stores newest-first (LPUSH); reverse for oldest-first charting.
  const history = (
    await kvList<StackSnapshot>("stack:history", days)
  ).reverse();

  if (url.searchParams.get("format") === "csv") {
    const rows = history.map((h) => `${h.date},${h.score},${h.tier}`);
    return new NextResponse(["date,score,tier", ...rows].join("\n") + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'inline; filename="galaxymind-gauge-history.csv"',
        ...CACHE_HEADERS,
      },
    });
  }

  return NextResponse.json(
    {
      history,
      count: history.length,
      asOf: new Date().toISOString(),
    },
    { headers: CACHE_HEADERS },
  );
}

export type StackHistoryResponse = {
  history: StackSnapshot[];
  count: number;
  asOf: string;
};
