// Daily price history for backtest. Caches for 6 hours since daily closes
// don't change intra-day. Returns a series of {date, price} for each ticker
// that we can fetch; tickers without history return null entries.
//
// Sources: CoinGecko for BTC; Yahoo chart endpoint for everything else.
// 180-day window — most BTC-treasury preferreds + leveraged ETFs have
// existed at least that long.

import { NextRequest, NextResponse } from "next/server";
import { ASSETS_BY_TICKER } from "@/lib/assets";
import { rateLimit } from "@/lib/rate-limit";

export const revalidate = 21600; // 6h

// Allow-list: only the asset universe + the chart benchmarks. This blocks
// the route from being used as an open Yahoo proxy (which would let an
// attacker amplify N inbound requests into N outbound Yahoo fetches with
// arbitrary tickers, plus probe Yahoo at our IP/quota).
const ALLOWED_TICKERS = new Set<string>([
  ...Object.keys(ASSETS_BY_TICKER),
  "BTC", // CoinGecko / Yahoo BTC-USD
]);

// Defense-in-depth: cap the request size even within the allow-list.
// Asset universe is ~22 + 1 benchmark = 23 max useful, so cap at 30.
const MAX_TICKERS_PER_REQUEST = 30;

type Point = { t: number; p: number }; // unix-seconds, price USD
type Series = { ticker: string; points: Point[] | null };

// Cache the success response (2026-07-29). `export const revalidate`
// below governs only the fetch data cache: rateLimit() reads request
// headers, which makes this route dynamic, so the RESPONSE was never
// cacheable and every caller hit the origin cold. Measured before the
// fix: two consecutive requests for the 64KB default payload both
// returned `x-vercel-cache: MISS`, while a control request to
// /api/stack returned HIT — the CDN was fine, this path just opted out.
// Same bug, same fix as /api/subscriber-count.
//
// Callers are the shared BTC loader (WEN / Gauntlet / Runner /
// TimeMachine), /fit's backtest, the asset-detail modal, and CHOP.
//
// s-maxage MUST stay <= 21600: lib/arcade-replay sizes its candidate
// window (MAX_LEAD_OFFSETS) to absorb exactly this 6h skew, and the
// upstream Yahoo fetch already carries `next: { revalidate: 21600 }`.
//
// Deliberately NOT snapping `days` to the yahooRangeForDays buckets to
// bound the cache key space. In practice callers request exactly two
// values — 1825 (the default, used by everything) and 60 (CHOP,
// public/chop/js/main.js) — so the theoretical 30..3650 key space is
// never exercised, and snapping 60 up to 90 would silently hand CHOP a
// different window than it asked for. Cache-busting by varying `days`
// just produces MISSes, which is exactly today's behaviour, and the
// per-IP limiter still bounds it.
const CACHE_OK =
  "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400";

/** Map requested day count to a Yahoo `range=` bucket (allow-listed). */
function yahooRangeForDays(days: number): string {
  if (days <= 90) return "3mo";
  if (days <= 180) return "6mo";
  if (days <= 365) return "1y";
  if (days <= 730) return "2y";
  return "5y"; // default · enough for 3y backtest + gauntlet windows
}

async function fetchBTC(range: string): Promise<Point[] | null> {
  // Use Yahoo's BTC-USD ticker — CoinGecko's market_chart endpoint
  // rate-limits the free tier aggressively. BTC-USD on Yahoo gives daily
  // closes via the same chart API we use for stocks.
  return fetchYahoo("BTC-USD", range);
}

async function fetchYahoo(
  symbol: string,
  range: string,
): Promise<Point[] | null> {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}`,
      {
        next: { revalidate: 21600 },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
          Accept: "application/json",
        },
        // Cap each Yahoo fetch at 5s. Without this a slow Yahoo response
        // chains across all N tickers via Promise.all and pegs the function
        // for tens of seconds. Caller treats null as "no data" so a timeout
        // here is graceful.
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!r.ok) return null;
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result) return null;
    const ts: number[] | undefined = result.timestamp;
    const closes: (number | null)[] | undefined =
      result.indicators?.quote?.[0]?.close;
    if (!Array.isArray(ts) || !Array.isArray(closes)) return null;
    const out: Point[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (typeof c === "number" && c > 0) out.push({ t: ts[i], p: c });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  // Per-IP rate limit · /api/history is the user-input amplifier (up to
  // 30 allow-listed tickers, each an upstream fetch). It's already
  // dynamic (reads ?tickers=), so limiting here costs no edge cache.
  // Generous 30/min · the backtest UI makes one call per chart load.
  // Degrades open if KV is unconfigured. (The parameterless heavy reads
  // — /api/market, /stack, /treasuries, /float — are deliberately NOT
  // per-IP limited: they're statically cacheable and a limiter would
  // force them dynamic, disabling the edge cache that's the better
  // defense. Those rely on Cache-Control + stale-while-revalidate.)
  const rl = await rateLimit(req, { name: "history", limit: 30, windowSec: 60 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again shortly." },
      { status: 429, headers: rl.headers },
    );
  }
  const url = new URL(req.url);
  const tickersParam = url.searchParams.get("tickers") ?? "";
  // Dedupe before capping so an attacker can't waste budget by repeating
  // the same ticker 30× — `?tickers=BTC,BTC,BTC,...` becomes one BTC fetch.
  const requested = Array.from(
    new Set(
      tickersParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).slice(0, MAX_TICKERS_PER_REQUEST);

  // Drop anything not in the allow-list. Silent rather than 400 so a
  // typo doesn't fail the whole request — we just return empty for it.
  // Sort alphabetically so the response is deterministic regardless of
  // request order · audit 2026-05-21 · MEDIUM: without sorting, an
  // attacker could permute the ticker order (~allowed_count! variants)
  // to bypass the edge cache and force fresh upstream Yahoo fetches
  // on every request, amplifying their attack against our outbound
  // quota. Sorting before render means `?tickers=BTC,MSTR` and
  // `?tickers=MSTR,BTC` produce byte-identical response bodies →
  // upstream-caching layers (Vercel edge, browser cache, embedder
  // CDN) collapse them to the same slot.
  const tickers = requested
    .filter((t) => ALLOWED_TICKERS.has(t))
    .sort();

  // Mixing a 400 status with a success-shaped body was a smell — clients
  // can't reliably switch on body.series.length when the route can return
  // both `{series:[],status:400}` (no allowed tickers) and the same body
  // on a successful empty allow-list request. Use 400 + explicit error.
  if (tickers.length === 0)
    return NextResponse.json(
      { error: "No tickers in allow-list." },
      { status: 400, headers: rl.headers },
    );

  // Optional ?days=N · clamps Yahoo range. Default 5y headroom for
  // /fit backtests and Gauntlet windows. Cap at 3650 (~10y).
  const daysRaw = Number(url.searchParams.get("days") ?? 1825);
  const days = Number.isFinite(daysRaw)
    ? Math.min(3650, Math.max(30, Math.floor(daysRaw)))
    : 1825;
  const range = yahooRangeForDays(days);
  const cutoffSec = Math.floor(Date.now() / 1000) - days * 86_400;

  const fetches = tickers.map(async (t) => {
    const points =
      t === "BTC" ? await fetchBTC(range) : await fetchYahoo(t, range);
    if (!points) return { ticker: t, points: null };
    // Trim to requested window when Yahoo returns a coarser bucket.
    const trimmed = points.filter((p) => p.t >= cutoffSec);
    return { ticker: t, points: trimmed.length ? trimmed : points };
  });
  const series: Series[] = await Promise.all(fetches);

  return NextResponse.json(
    { series, asOf: new Date().toISOString(), days, range },
    { headers: { ...rl.headers, "Cache-Control": CACHE_OK } },
  );
}

export type HistoryResponse = {
  series: Series[];
  asOf: string;
};
