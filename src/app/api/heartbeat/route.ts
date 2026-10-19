// Lightweight heartbeat endpoint — returns just the values that the
// BlockHeartbeat + BlockHeightTicker components need for their 30-second
// poll cycle: current Bitcoin block height, the live Buying Gauge score,
// and the active tier.
//
// Why: /api/market is ~430 KB per request because it bundles 730 days of
// hourly OHLCV (needed by the page render path but completely unused by
// the polling components). At 2 polls/min/visitor, that's 14 KB/sec of
// sustained bandwidth per visitor. This endpoint is ~120 bytes.
//
// Fetched by:
//   • <BlockHeightTicker /> (header on / and /stack)
//   • <BlockHeartbeat /> (wraps /stack main; pulses on each new block)
//   • Embed widget (galaxymind.space/embed.js) — third-party sites
//
// CORS: open to all origins so external embeds can poll directly. The
// payload is public information and the endpoint is read-only.
import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market";
import { computeStackVerdict } from "@/lib/stack";
import { kvGet, kvSet, isKvConfigured } from "@/lib/kv";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";

export const revalidate = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
  // Explicit CDN directive, not just ISR `revalidate`: the KV fast-path
  // read is a no-store fetch, which forces this route dynamic, so the
  // ISR cache never applies and Vercel was stamping max-age=0 (every
  // embed poll = a function invocation). Same mechanism as
  // /api/float-heartbeat: Vercel's CDN honors s-maxage on dynamic
  // responses. max-age gives browsers a short TTL between the widget's
  // 30-60s polls; s-maxage matches the KV cache TTL.
  "Cache-Control":
    "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
};

// KV-cache layer · audit 2026-05-22 (M2 deferred from 2026-05-21).
// The Vercel edge cache (revalidate=30) handles steady-state traffic
// efficiently, but cache-busting attackers OR multi-edge cold misses
// can each trigger a fresh getMarketSnapshot() · which itself fans
// out to 7-8 upstream APIs (CoinGecko, Yahoo, OKX, mempool.space,
// etc.). That's 8× amplification per heartbeat cache miss.
// With this KV layer: the FIRST cache miss does upstream work + writes
// to KV; subsequent misses within KV_CACHE_TTL_SECONDS read 1 byte
// from KV (~5ms) instead of fanning out 8 upstream calls (~500ms each).
// Same response body shape · no behavior change for callers.
const KV_CACHE_KEY = "heartbeat:cache";
const KV_CACHE_TTL_SECONDS = 60;

export type HeartbeatResponse = {
  blockHeight: number | null;
  score: number;
  tier: string;
  asOf: string;
  /** BTC spot USD · optional for back-compat with older KV cache entries. */
  btcPrice?: number | null;
  /** True when ≥4 of 8 weight-bearing market signals were null at snapshot time.
   * Consumers (embed, header effects) should treat the score/tier as a neutral
   * placeholder and surface an "updating" indicator rather than a confident reading.
   */
  degraded?: boolean;
};

export async function GET() {
  // Audit 2026-05 M-10: wrap so a code-error exception is logged +
  // returned as typed JSON 503 instead of an opaque, unlogged Next
  // 500. CRITICAL: the error response MUST still carry CORS_HEADERS —
  // embed.js polls this cross-origin every 30s, and without CORS on
  // the error the browser surfaces a CORS failure (not the 503), so
  // the widget can't distinguish "down" from "blocked".
  try {
    // Fast path · serve from KV when fresh (< 60s old).
    // Require btcPrice so pre-extension cache entries (score/tier only)
    // don't starve HeaderBtcPrice for a full TTL.
    if (isKvConfigured()) {
      const cached = await kvGet<HeartbeatResponse>(KV_CACHE_KEY);
      if (cached && cached.btcPrice != null) {
        return NextResponse.json(cached, { headers: CORS_HEADERS });
      }
    }

    // KV miss / unconfigured · do the live compute (legacy path).
    const snapshot = await getMarketSnapshot();
    const verdict = computeStackVerdict(snapshot);
    const degraded = isMarketSnapshotDegraded(snapshot);
    const body: HeartbeatResponse = {
      blockHeight: snapshot.blockHeight,
      score: verdict.score,
      tier: verdict.tier,
      asOf: snapshot.asOf,
      btcPrice: snapshot.btcPrice,
      degraded,
    };

    // Best-effort cache write · don't await + don't fail the response
    // on KV write outage (response is already computed correctly).
    if (isKvConfigured()) {
      kvSet(KV_CACHE_KEY, body, KV_CACHE_TTL_SECONDS).catch((err) =>
        console.warn(
          "[/api/heartbeat] KV cache write failed:",
          err instanceof Error ? err.message : err,
        ),
      );
    }

    return NextResponse.json(body, { headers: CORS_HEADERS });
  } catch (e) {
    console.error(
      "[/api/heartbeat] unhandled:",
      e instanceof Error ? e.stack ?? e.message : e,
    );
    return NextResponse.json(
      { ok: false, error: "heartbeat unavailable" },
      { status: 503, headers: CORS_HEADERS },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}
