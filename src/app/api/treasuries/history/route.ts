// GET /api/treasuries/history?ticker=MSTR&days=90
//
// Returns the per-ticker mNAV history written by the daily
// snapshot-treasuries cron. Caller specifies one ticker; we return
// up to 365 entries (the storage cap).
//
// Edge-cached 5 min · ticker + days allow-lists bound cache keys.
// No per-IP rate limit (would force dynamic and kill edge cache).

import { NextRequest, NextResponse } from "next/server";
import { kvList } from "@/lib/kv";
import type { TreasurySnapshot } from "../../cron/snapshot-treasuries/route";

export const revalidate = 300;

const ALLOWED_TICKERS = new Set(["MSTR", "XXI", "MPJPY", "ASST"]);
const ALLOWED_DAYS = new Set([30, 90, 180, 365]);
const DEFAULT_DAYS = 90;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? "").toUpperCase();
  if (!ALLOWED_TICKERS.has(ticker)) {
    return NextResponse.json(
      {
        error:
          "ticker query param required and must be one of: " +
          [...ALLOWED_TICKERS].join(", "),
      },
      { status: 400 },
    );
  }

  const requestedDays = Number(url.searchParams.get("days") ?? DEFAULT_DAYS);
  const days =
    Number.isFinite(requestedDays) &&
    ALLOWED_DAYS.has(Math.floor(requestedDays))
      ? Math.floor(requestedDays)
      : DEFAULT_DAYS;

  const history = (
    await kvList<TreasurySnapshot>(`treasury:history:${ticker}`, days)
  ).reverse();

  if (url.searchParams.get("format") === "csv") {
    const cell = (v: number | null | undefined) =>
      v == null ? "" : String(v);
    const rows = history.map(
      (h) =>
        `${h.date},${cell(h.mNAV)},${cell(h.price)},${cell(h.btcHoldings)},${cell(h.marketCapM)},${cell(h.btcPrice)}`,
    );
    return new NextResponse(
      ["date,mNAV,price,btcHoldings,marketCapM,btcPrice", ...rows].join("\n") +
        "\n",
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `inline; filename="galaxymind-${ticker.toLowerCase()}-mnav-history.csv"`,
          ...CACHE_HEADERS,
        },
      },
    );
  }

  return NextResponse.json(
    {
      ticker,
      history,
      count: history.length,
      asOf: new Date().toISOString(),
    },
    { headers: CACHE_HEADERS },
  );
}

export type TreasuryHistoryResponse = {
  ticker: string;
  history: TreasurySnapshot[];
  count: number;
  asOf: string;
};
