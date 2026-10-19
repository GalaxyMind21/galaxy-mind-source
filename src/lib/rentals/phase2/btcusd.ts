/**
 * Mainnet BTC/USD: live and cross-checked. Coinbase spot and Kraken ticker are fetched
 * in parallel; both must answer within 4 s with a positive price, and they must agree
 * within 4% (|a-b| / min(a,b)). Otherwise throw -> callers return pricing_unavailable
 * (fail closed). The answer is the HIGHER of the two (shared USDC formula: floor x max(Coinbase, Kraken) x 1.03).
 * Cached for 30 s. RENTALS_PHASE2_STAGING_BTCUSD is never consulted here.
 */
export const MAX_DIVERGENCE = 0.04;
/** Sanity range for any single feed (USD per BTC). */
export const MIN_SANE = 1_000, MAX_SANE = 10_000_000;
/** A failed fetch/check is cached this long (no hammering the feeds while they are down). */
export const FAIL_TTL_MS = 20_000;
const CB = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const KR = "https://api.kraken.com/0/public/Ticker?pair=XBTUSD";

async function getJson(f: typeof fetch, url: string): Promise<unknown> {
  const r = await f(url, { signal: AbortSignal.timeout(4000), cache: "no-store" } as RequestInit);
  if (!r.ok) throw new Error("http_" + r.status);
  return r.json();
}
export async function coinbaseBtcUsd(f: typeof fetch = fetch): Promise<number> {
  const j = await getJson(f, CB) as { data?: { amount?: string } };
  return Number(j?.data?.amount);
}
export async function krakenBtcUsd(f: typeof fetch = fetch): Promise<number> {
  const j = await getJson(f, KR) as { error?: unknown[]; result?: Record<string, { c?: string[] }> };
  if (j?.error && j.error.length) throw new Error("kraken_error");
  const row = j?.result ? Object.values(j.result)[0] : undefined;
  return Number(row?.c?.[0]);
}
export function crossCheck(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < MIN_SANE || b < MIN_SANE || a > MAX_SANE || b > MAX_SANE) throw new Error("rate_unavailable");
  if (Math.abs(a - b) / Math.min(a, b) > MAX_DIVERGENCE) throw new Error("rate_divergence");
  return Math.max(a, b);
}
export function liveBtcUsd(f: typeof fetch = fetch, now: () => number = Date.now, ttlMs = 30_000): () => Promise<number> {
  let cache: { v: number; at: number } | null = null;
  let fail: { e: Error; at: number } | null = null;
  let inflight: Promise<number> | null = null;
  return async () => {
    if (cache && now() - cache.at < ttlMs) return cache.v;
    if (fail && now() - fail.at < FAIL_TTL_MS) throw fail.e;
    if (inflight) return inflight; // one shared request for concurrent callers
    inflight = (async () => {
      try {
        const [a, b] = await Promise.all([coinbaseBtcUsd(f), krakenBtcUsd(f)]);
        const v = crossCheck(a, b);
        cache = { v, at: now() }; fail = null;
        return v;
      } catch (e) {
        fail = { e: e instanceof Error ? e : new Error("rate_unavailable"), at: now() };
        throw fail.e;
      } finally { inflight = null; }
    })();
    return inflight;
  };
}
