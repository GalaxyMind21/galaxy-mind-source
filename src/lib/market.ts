// Live market signal fetcher. Pure server-side; no Next runtime requirements
// beyond global fetch. Used by both /api/market/route.ts (the JSON endpoint
// the page consumes) and /opengraph-image handlers (so OG cards can embed
// live data without an internal HTTP round-trip).
//
// Each upstream fail-closes to null. Callers treat null as "neutral signal."

// Hard ceiling on every upstream fetch. Without this, a slow source
// (Yahoo intermittent, OKX edge node hiccup, mempool.space DDoS) holds
// the serverless function until Vercel's 10s/60s timeout — which both
// chains user-facing latency AND keeps the function slot occupied,
// triggering cold-start cascades. 5s is comfortably above the p99 of
// every source we use under normal conditions.
import { cache } from "react";
import { z } from "zod";
import { resolveTreasuryMarketCapM } from "./treasury-shares";
import {
  upstreamFetchJson,
  upstreamFetchText,
  YAHOO_UA,
  GM_UA,
  UPSTREAM_TIMEOUT_MS,
} from "./upstream";

const FETCH_TIMEOUT_MS = UPSTREAM_TIMEOUT_MS;

// Treasury equity universe tracked on /treasuries. SMLR was removed
// May 2026 — bitcointreasuries.net reports btc_balance: 0 for SMLR
// (they appear to have liquidated their treasury position) AND there's
// minimal community interest in tracking them. If the position is
// re-established, add SMLR back here + restore its row in
// src/lib/treasuries.ts and src/app/treasuries/components/MNavHistoryChart.tsx.
//
// May 2026: tried adding NAKA, BMNR, and BSTR as expansions; all three
// were pulled back. NAKA wasn't the audience fit we expected; BMNR is
// a miner-treasury hybrid that muddied the "pure-play treasury"
// framing; BSTR's bitcointreasuries.net entry was incomplete (BTC
// holdings reported but no price/market_cap), so the row rendered as
// half-data and confused readers more than it helped. Re-add BSTR
// (and reconsider the others) once the upstream data quality is
// reliable enough to not need an asterisk every time.
// Exported so the chart's ALL_TICKERS can derive from the canonical
// fetch list · adding/removing a treasury still requires the other
// mirrored touches (TREASURY_META, COLORS palette, history allow-
// list, JSON-LD) per the README, but the chart's ticker enumeration
// is no longer a separate literal that can drift out of sync.
export const TARGET_TICKERS = ["MSTR", "XXI", "MPJPY", "ASST"] as const;
export type Ticker = (typeof TARGET_TICKERS)[number];

export type Quote = {
  ticker: Ticker;
  price: number | null;
  marketCapM: number | null;
  btcHoldings: number | null;
  mNAV: number | null;
};

export type MarketSnapshot = {
  btcPrice: number | null;
  btcVol30d: number | null;
  fearGreed: number | null;
  fearGreedLabel: string | null;
  treasuries: Quote[];
  // NEW for /stack:
  mvrv: number | null;
  fundingRate: number | null;          // decimal, e.g. -0.0001 = -0.01%
  // Puell Multiple: daily issuance USD / 365d MA. Bitcoin-native cycle
  // indicator. <0.5 = bottom, >4.0 = top historically.
  puell: number | null;
  hourlyCloses: number[] | null;       // last ~730d × 24h, oldest first; null if fetch failed
  hourlyTimestamps: number[] | null;   // unix-seconds per close, parallel to hourlyCloses
  blockHeight: number | null;
  asOf: string;
  source: string;
};

/** Aggregate BTC holdings by cohort, used by /api/cron/snapshot-float. */
export type TreasuryAggregates = {
  governments: number | null;
  etfs: number | null;
  publicCompanies: number | null;
  asOf: string;
};

// ── Upstream boundary schemas ─────────────────────────────────────
// Validate the SHAPE of each upstream JSON response and log an
// attributable "schema drift" warning when it changes. The manual
// extraction in each fetcher below stays the source of truth · it
// already fail-closes to null correctly. These schemas are a DETECTION
// layer: the day a source changes its shape (the bitcointreasuries
// XXI/BSTR class of break) the operator sees "[market:X] upstream
// schema drift" in the Vercel logs, instead of discovering it later via
// a silently blank UI. Kept loose — only the fields we actually read,
// most optional/nullable — so they flag genuine breaks, not benign
// upstream additions.
const CoinGeckoPriceSchema = z.object({
  bitcoin: z.object({ usd: z.number() }),
});
const FearGreedSchema = z.object({
  data: z.array(z.object({ value: z.union([z.string(), z.number()]) })).min(1),
});
const CoinmetricsSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())).min(1),
});
const OkxFundingSchema = z.object({
  data: z
    .array(z.object({ fundingRate: z.union([z.string(), z.number()]) }))
    .min(1),
});
const YahooChartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({
            quote: z
              .array(
                z.object({ close: z.array(z.number().nullable()).optional() }),
              )
              .optional(),
          }),
        }),
      )
      .min(1),
  }),
});
const BtcTreasuriesEnvelopeSchema = z.object({
  nodes: z.array(z.unknown()).min(2),
});

/** Spot BTC only · used by /float (no need for full market snapshot)
 *  and by getMarketSnapshot. Exported for slim consumers. */
export async function fetchBTCPrice(): Promise<number | null> {
  const res = await upstreamFetchJson<{ bitcoin?: { usd?: number } }>(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    {
      label: "btcprice",
      revalidate: 120,
      headers: { Accept: "application/json" },
      schema: CoinGeckoPriceSchema,
    },
  );
  if (!res.ok) return null;
  const j = res.data;
  return typeof j?.bitcoin?.usd === "number" ? j.bitcoin.usd : null;
}

async function fetchBTCVol30d(): Promise<number | null> {
  const res = await upstreamFetchJson(
    "https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1d&range=1mo",
    {
      label: "btcvol30d",
      revalidate: 3600,
      headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
      schema: YahooChartSchema,
    },
  );
  if (!res.ok) return null;
  const j = res.data as {
    chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> };
  };
  const result = j?.chart?.result?.[0];
  const closes: (number | null)[] | undefined =
    result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) return null;
  const validCloses = closes.filter(
    (c): c is number => typeof c === "number" && c > 0,
  );
  if (validCloses.length < 15) return null;
  const logRets: number[] = [];
  for (let i = 1; i < validCloses.length; i++) {
    logRets.push(Math.log(validCloses[i] / validCloses[i - 1]));
  }
  const mean = logRets.reduce((a, b) => a + b, 0) / logRets.length;
  const variance =
    logRets.reduce((a, x) => a + (x - mean) ** 2, 0) / (logRets.length - 1);
  const stdev = Math.sqrt(variance);
  return Math.round(stdev * Math.sqrt(365) * 1000) / 10;
}

async function fetchFearGreed(): Promise<{
  value: number | null;
  label: string | null;
}> {
  const res = await upstreamFetchJson(
    "https://api.alternative.me/fng/?limit=1",
    {
      label: "feargreed",
      revalidate: 600,
      headers: { Accept: "application/json" },
      schema: FearGreedSchema,
    },
  );
  if (!res.ok) return { value: null, label: null };
  const j = res.data as {
    data?: Array<{ value?: string | number; value_classification?: string }>;
  };
  const entry = j?.data?.[0];
  if (!entry) return { value: null, label: null };
  const value = Number(entry.value);
  const label =
    typeof entry.value_classification === "string"
      ? entry.value_classification
      : null;
  return {
    value: Number.isFinite(value) ? value : null,
    label,
  };
}

async function fetchMVRV(): Promise<number | null> {
  const res = await upstreamFetchJson(
    "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&page_size=1&pretty=false",
    {
      label: "mvrv",
      revalidate: 3600,
      headers: { Accept: "application/json" },
      schema: CoinmetricsSchema,
    },
  );
  if (!res.ok) return null;
  const j = res.data as { data?: Array<Record<string, unknown>> };
  const raw = j?.data?.[0]?.CapMVRVCur;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return typeof raw === "number" && raw > 0 ? raw : null;
}

/**
 * Puell Multiple — daily issuance value (USD) ÷ its 365-day moving
 * average. Bitcoin-native cycle indicator that's tracked every Bitcoin
 * cycle (2013/2017/2021/2025).
 *
 * Interpretation:
 *  • Below 0.5  → miner capitulation regime, historically every major
 *                  bottom (Dec 2018, Mar 2020, Nov 2022)
 *  • 0.5 – 1.0  → below-average miner economics, accumulation zone
 *  • 1.0 – 2.0  → typical mid-cycle conditions
 *  • 2.0 – 4.0  → miners earning above-average, late-cycle warning
 *  • Above 4.0  → euphoric top zone, has marked every major cycle top
 *
 * Source: Coinmetrics community API. We fetch the last 380 days of
 * IssTotUSD to compute today's value AND the 365-day trailing average
 * in one round-trip. ~100KB response, ~5KB after JSON-extraction.
 */
async function fetchPuellMultiple(): Promise<number | null> {
  const res = await upstreamFetchJson(
    "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics" +
      "?assets=btc&metrics=IssTotUSD&page_size=380&pretty=false",
    {
      label: "puell",
      revalidate: 3600,
      headers: { Accept: "application/json" },
      schema: CoinmetricsSchema,
    },
  );
  if (!res.ok) return null;
  const j = res.data as { data?: Array<Record<string, unknown>> };
  const data = j?.data;
  if (!Array.isArray(data) || data.length < 366) return null;
  const rows = data.slice(-366);
  const values: number[] = [];
  for (const row of rows) {
    const raw = row?.IssTotUSD;
    const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
    if (Number.isFinite(n) && n > 0) values.push(n);
  }
  if (values.length < 366) return null;
  const today = values[values.length - 1];
  const trailing = values.slice(-366, -1);
  const ma365 = trailing.reduce((a, b) => a + b, 0) / trailing.length;
  if (ma365 <= 0) return null;
  return today / ma365;
}

async function fetchFundingRate(): Promise<number | null> {
  const res = await upstreamFetchJson(
    "https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP",
    {
      label: "fundingrate",
      revalidate: 300,
      headers: { Accept: "application/json" },
      schema: OkxFundingSchema,
    },
  );
  if (!res.ok) return null;
  const j = res.data as {
    data?: Array<{ fundingRate?: string | number }>;
  };
  const raw = j?.data?.[0]?.fundingRate;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

async function fetchHourlyCloses(): Promise<{
  closes: number[] | null;
  timestamps: number[] | null;
}> {
  const res = await upstreamFetchJson(
    "https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1h&range=400d",
    {
      label: "hourlycloses",
      revalidate: 3600,
      headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
      schema: YahooChartSchema,
    },
  );
  if (!res.ok) return { closes: null, timestamps: null };
  const j = res.data as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: (number | null)[] }> };
      }>;
    };
  };
  const result = j?.chart?.result?.[0];
  const ts: number[] | undefined = result?.timestamp;
  const rawCloses: (number | null)[] | undefined =
    result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(ts) || !Array.isArray(rawCloses)) {
    return { closes: null, timestamps: null };
  }
  const closes: number[] = [];
  const timestamps: number[] = [];
  for (let i = 0; i < rawCloses.length; i++) {
    const c = rawCloses[i];
    const t = ts[i];
    if (typeof c === "number" && c > 0 && typeof t === "number") {
      closes.push(c);
      timestamps.push(t);
    }
  }
  if (closes.length < 24 * 7) return { closes: null, timestamps: null };
  return { closes, timestamps };
}

/**
 * Daily closing prices for an arbitrary ticker (used for /treasuries
 * sparklines + historical mNAV derivation). Yahoo's chart endpoint is
 * the cheapest source — same one we use for BTC vol + hourly OHLCV,
 * just at the daily timescale.
 *
 * Returns up to `days` daily closes ending today, oldest first. Drops
 * any null/NaN entries. Returns null on fetch failure (graceful
 * degradation — caller renders a blank sparkline).
 */
// Allow-list of tickers we'll fetch from Yahoo. The function is
// `export`ed and the signature accepts an arbitrary string — without
// this guard, any future caller passing user input (or upstream-derived
// data from bitcointreasuries.net) could SSRF to arbitrary Yahoo paths.
// `encodeURIComponent` blocks path traversal but doesn't block
// callback-style query params. Allow-list is the right primitive.
const FETCHABLE_TICKERS = new Set([
  "BTC-USD",
  "MSTR", "MPJPY", "XXI", "ASST", "SMLR",
  "STRC", "STRF", "STRD", "STRK", "SATA", "MSTY",
  "MSBT", "IBIT", "FBTC", "BITX",
]);

export async function fetchDailyCloses(
  ticker: string,
  days: number,
): Promise<number[] | null> {
  if (!FETCHABLE_TICKERS.has(ticker)) {
    console.warn(`[market:fetchDailyCloses] refused non-allowlisted ticker: ${ticker}`);
    return null;
  }
  const res = await upstreamFetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${days}d`,
    {
      label: "dailycloses",
      revalidate: 3600,
      headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
      schema: YahooChartSchema,
    },
  );
  if (!res.ok) return null;
  const j = res.data as {
    chart?: {
      result?: Array<{
        indicators?: { quote?: Array<{ close?: (number | null)[] }> };
      }>;
    };
  };
  const closes: (number | null)[] | undefined =
    j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) return null;
  const valid = closes.filter(
    (c): c is number => typeof c === "number" && Number.isFinite(c) && c > 0,
  );
  if (valid.length < 5) return null;
  return valid;
}

async function fetchBlockHeight(): Promise<number | null> {
  const res = await upstreamFetchText(
    "https://mempool.space/api/blocks/tip/height",
    { label: "blockheight", revalidate: 30 },
  );
  if (!res.ok) return null;
  const n = parseInt(res.data.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveDevalue(arr: unknown[], v: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < arr.length) {
    return resolveDevalue(arr, arr[v], depth + 1);
  }
  if (Array.isArray(v)) return v.map((x) => resolveDevalue(arr, x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, vv] of Object.entries(v))
      out[k] = resolveDevalue(arr, vv, depth + 1);
    return out;
  }
  return v;
}

/**
 * Fetch a bitcointreasuries.net SvelteKit `__data.json` endpoint and
 * return the devalue-encoded flat data array from the second node.
 *
 * bitcointreasuries.net has separate pages per cohort type:
 *   /public-companies/__data.json
 *   /etfs/__data.json
 *   /governments/__data.json
 * Each returns the same SvelteKit devalue envelope. This helper is
 * the single fetch+parse path shared by fetchTreasuries() (per-ticker
 * rows for /treasuries) and getTreasuryAggregates() (cohort sums for
 * /float).
 *
 * Returns null on any network/parse failure · callers handle the null
 * case by returning their own zero/null fallback.
 */
async function fetchBtcTreasuriesArr(url: string): Promise<unknown[] | null> {
  const res = await upstreamFetchJson(
    url,
    {
      label: "btctreasuries",
      revalidate: 300,
      headers: {
        "User-Agent": GM_UA,
        Accept: "application/json",
      },
      schema: BtcTreasuriesEnvelopeSchema,
    },
  );
  if (!res.ok) return null;
  const payload = res.data as { nodes?: unknown[] };
  const nodes = payload?.nodes;
  if (!Array.isArray(nodes)) return null;

  // SCHEMA DRIFT, 2026-09-10 · the entity rows MOVED from nodes[1] to
  // nodes[2]. This used to read nodes[1].data unconditionally; when
  // SvelteKit added a node ahead of it, that array still existed and was
  // still 2,020 values long, so every guard downstream passed and simply
  // matched zero rows. Result: all four tickers null on /treasuries,
  // /fit's diversifier, /today's cheapest mNAV, the /stack mNAV signal
  // and the float cohort split — with the OG card degrading to a blank
  // rectangle. Nothing threw, nothing logged.
  //
  // So don't trust the index: find the pool that actually holds entity
  // rows. `holdings` is the right probe because it is the one key BOTH
  // consumers need (per-ticker rows and the cohort sums), and devalue
  // index pointers only resolve within their own pool, so the array we
  // return has to be the one the rows live in.
  let best: unknown[] | null = null;
  let bestRows = 0;
  for (const node of nodes) {
    const arr = (node as { data?: unknown } | null)?.data;
    if (!Array.isArray(arr)) continue;
    let rows = 0;
    for (const v of arr) {
      if (v && typeof v === "object" && !Array.isArray(v) && "holdings" in v) {
        rows++;
      }
    }
    if (rows > bestRows) {
      bestRows = rows;
      best = arr as unknown[];
    }
  }
  if (!best) {
    console.error(
      "[market:treasuries] no devalue node carried entity rows · upstream shape changed again",
    );
  }
  return best;
}

async function fetchTreasuries(): Promise<
  Map<Ticker, Omit<Quote, "ticker" | "mNAV">>
> {
  const out = new Map<Ticker, Omit<Quote, "ticker" | "mNAV">>();
  try {
    const arr = await fetchBtcTreasuriesArr(
      "https://bitcointreasuries.net/public-companies/__data.json",
    );
    if (!arr) return out;
    const targets = new Set<string>(TARGET_TICKERS);

    for (const v of arr) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const o = v as Record<string, unknown>;
      if (
        !("ticker" in o) ||
        // SCHEMA DRIFT, 2026-08 · `btc_balance` became `holdings`.
        // Not a rename: the scalar became an ARRAY of per-asset rows
        // ({asset, balance, per_basic_share, ...}), so the BTC entry has
        // to be selected by asset rather than taken positionally. When
        // this gate still said "btc_balance" it matched ZERO of the 386
        // upstream rows, every ticker was skipped, and /treasuries served
        // "Unavailable" for all four — with degraded reporting false,
        // because nothing counted an all-empty result as a failure.
        !("holdings" in o) ||
        // Accept a row that exposes EITHER market-cap field. Most tickers
        // report market_cap_basic; some (a future SPAC, or a re-added
        // BSTR) may expose only market_cap_fully_diluted. Requiring basic
        // here used to make the `mcapBasic ?? mcapFd` fallback below
        // unreachable, silently dropping any fully-diluted-only ticker.
        !("market_cap_basic" in o || "market_cap_fully_diluted" in o)
      )
        continue;
      // Audit 2026-05 M-6: a single malformed upstream row (a
      // devalue-resolve / Number-coerce TypeError) used to bubble to
      // the function-level catch and abort the ENTIRE walk — every
      // remaining ticker silently dropped, /treasuries rendering a
      // partial or empty table. Per-row try/catch isolates the
      // failure: skip the bad row (logged with its symbol if known)
      // and keep parsing the rest.
      let rowSymbol = "unknown";
      try {
        const tickerObj = resolveDevalue(arr, o.ticker);
        const symbol =
          tickerObj && typeof tickerObj === "object" && "symbol" in tickerObj
            ? (tickerObj as { symbol: unknown }).symbol
            : null;
        if (typeof symbol !== "string" || !targets.has(symbol)) continue;
        rowSymbol = symbol;

        const btcBal = btcBalanceOf(arr, o);
        if (btcBal != null && btcBal > PER_ENTITY_BTC_SANITY_CEILING) {
          console.error(
            `[market:treasuries] ${symbol} holdings ${btcBal} BTC over the ` +
              `${PER_ENTITY_BTC_SANITY_CEILING.toLocaleString()} ceiling · ticker withheld`,
          );
          continue;
        }
        const stockPxRaw = resolveDevalue(arr, o.stock_price);
        const mcapBasicRaw = resolveDevalue(arr, o.market_cap_basic);
        // ALSO read fully_diluted — some treasuries (notably SPACs like
        // XXI) report basic > fully_diluted because the basic share
        // count includes locked-up sponsor shares not yet circulating.
        // For those, market_cap_basic gives an inflated mNAV that
        // doesn't match the bitcointreasuries.net UI. We pick the
        // SMALLER of the two as the conservative estimate; this matches
        // BTCT.net's own UI for every ticker we follow (verified for
        // MSTR/XXI/MPJPY/ASST as of May 2026). For "normal" tickers
        // (basic < fully_diluted), this is just market_cap_basic; for
        // XXI it correctly drops to the inverted fully_diluted value.
        const mcapFdRaw =
          "market_cap_fully_diluted" in o
            ? resolveDevalue(arr, o.market_cap_fully_diluted)
            : null;

        const extractNative = (raw: unknown): number | null => {
          if (raw && typeof raw === "object" && "native" in raw) {
            const n = Number((raw as { native: unknown }).native);
            return Number.isFinite(n) ? n : null;
          }
          if (typeof raw === "number" && Number.isFinite(raw)) return raw;
          return null;
        };

        const price = extractNative(stockPxRaw);
        const mcapBasic = extractNative(mcapBasicRaw);
        const mcapFd = extractNative(mcapFdRaw);
        // Pick the smaller of basic and fully_diluted, defaulting to
        // whichever is non-null when the other is missing.
        let marketCap: number | null = null;
        if (mcapBasic != null && mcapFd != null) {
          marketCap = Math.min(mcapBasic, mcapFd);
        } else {
          marketCap = mcapBasic ?? mcapFd;
        }

        out.set(symbol as Ticker, {
          price: price,
          marketCapM: marketCap != null ? marketCap / 1_000_000 : null,
          btcHoldings: btcBal,
        });
      } catch (rowErr) {
        console.warn(
          `[market:treasuries] row skipped (${rowSymbol}):`,
          rowErr instanceof Error ? rowErr.message : rowErr,
        );
      }
    }
  } catch (e) {
    // Network errors are already caught + logged by fetchBtcTreasuriesArr above. This catch handles row-walking parse errors only.
    console.error("[market:treasuries:parse] row-walking failed:", e instanceof Error ? e.message : e);
    // Fall through with whatever we collected.
  }
  return out;
}

/**
 * Aggregate BTC holdings across all bitcointreasuries.net entries,
 * grouped by cohort. Used by /api/cron/snapshot-float to compose
 * the cohort breakdown for the Float page.
 *
 * Distinct from getMarketSnapshot()'s treasury rows · that one
 * filters to the 4 tracked tickers (MSTR/XXI/MPJPY/ASST) and pulls
 * per-row mNAV math. This one wants the FULL aggregate sums by
 * type (governments, ETFs, public companies) so /float can show
 * the structural composition of the 21M cap.
 *
 * bitcointreasuries.net exposes separate __data.json endpoints per
 * cohort type — there is no combined endpoint with a "type" field.
 * We fetch all three in parallel and sum each independently.
 *
 * Returns nulls for cohorts whose fetch/parse failed · caller
 * (cron) handles the partial case via FloatSnapshot.partial.
 */
export async function getTreasuryAggregates(): Promise<TreasuryAggregates> {
  const asOf = new Date().toISOString();
  // The /public-companies/__data.json endpoint returns ALL 359
  // entities (governments + funds/ETFs + public companies) in one
  // payload · the URL path is misleading. Fetching the other paths
  // (/governments, /etfs) returns a SvelteKit error envelope. So one
  // fetch + a `type`-filtered partition is the right architecture.
  const arr = await fetchBtcTreasuriesArr(
    "https://bitcointreasuries.net/public-companies/__data.json",
  );
  if (!arr) {
    return { governments: null, etfs: null, publicCompanies: null, asOf };
  }
  return {
    governments: sumBtcByType(arr, "GOVERNMENT"),
    etfs: sumBtcByType(arr, "FUND"),
    publicCompanies: sumBtcByType(
      arr,
      "PUBLIC_COMPANY",
      PUBLIC_COMPANY_BTC_TICKER_SET,
    ),
    asOf,
  };
}

/**
 * Sum the resolved btc_balance values of every entity in `arr`
 * whose `type` field resolves to `targetType`.
 *
 * Both `type` and `btc_balance` on each entity are devalue index
 * pointers (integers indexing back into `arr`). The earlier broken
 * parser treated the integer pointer values themselves as BTC counts
 * · result was sums of ~100 billion BTC (the index pointers were
 * adjacent to USD market-cap pointers, which sum to USD trillions).
 * resolveDevalue derefs the pointer → returns the actual scalar.
 *
 * Example structure (verified against the live payload):
 *   data[2] = {type: 5, btc_balance: 26, ...}     // Strategy entity
 *   data[5] = "PUBLIC_COMPANY"                     // type label
 *   data[26] = 818869                               // BTC count
 *
 * Returns null if no entities of the requested type are matched
 * (schema-shifted or empty cohort), so the cron can flag partial.
 */
// Per-entity sanity ceiling · 10M BTC. Bitcoin's max supply is 21M
// and the largest single holder (Strategy) has ~820K. Anything
// claiming over 10M for a single entity is clearly the wrong field
// resolved · we've seen entities where the btc_balance pointer
// resolves to USD market caps (billions/trillions) rather than BTC
// counts. Defense against schema-shifted entries leaking into the
// aggregate.
// No entity has ever held anything close to this. The largest single
// holder in the feed is Strategy at ~845k BTC and the largest fund is
// IBIT at ~772k, so 1.5M (about 7.5% of mined supply) rejects the
// impossible while leaving both room to keep buying for years.
//
// It was 10,000,000 — half of all bitcoin ever mined — which is not a
// sanity ceiling, it is a formality. Measured against the live feed on
// 2026-09-10 it let "Nakamoto Inc" through at 8,325,949 BTC, so the
// public-company cohort summed to 12.3M BTC: more than half the mined
// supply, held by 110 companies. Nothing flagged it.
export const PER_ENTITY_BTC_SANITY_CEILING = 1_500_000;

/**
 * Named public-company bitcoin holders we will actually count on /float.
 *
 * The feed's PUBLIC_COMPANY type is not a cohort we can sum. Measured
 * live 2026-09-12 it still carries Hamak Gold at 63 billion BTC, and
 * several "sane" rows that pass the ceiling are still wrong (SORA
 * copies Strategy's 845k, ATAI copies IBIT's 772k, BMNR copies the UK
 * government's 61k). Dropping only the over-ceiling rows and summing
 * the rest would publish ~3.1M public-company BTC against a real
 * figure nearer 1.0-1.3M.
 *
 * So this list is the methodology: we count tickers we independently
 * know as public bitcoin treasuries, each still ceiling-gated. A new
 * name joins here with a reason, never because it appeared in the
 * feed. GOVERNMENT and FUND keep summing the whole type — those two
 * currently reconcile, and a poison row there still withholds the
 * type rather than quietly dropping it.
 */
export const PUBLIC_COMPANY_BTC_TICKERS = [
  "MSTR",
  "MARA",
  "RIOT",
  "CLSK",
  "HUT",
  "TSLA",
  "COIN",
  "MPJPY",
  "XXI",
  "ASST",
  "IREN",
  "CORZ",
  "WULF",
  "CIFR",
  "BITF",
  "HIVE",
  "BTDR",
  "FLD",
  "GME",
] as const;

const PUBLIC_COMPANY_BTC_TICKER_SET: ReadonlySet<string> = new Set(
  PUBLIC_COMPANY_BTC_TICKERS,
);

/**
 * Resolve an entity row's BTC balance out of the `holdings` array.
 *
 * SCHEMA DRIFT, 2026-08 · the scalar `btc_balance` became `holdings`, an
 * ARRAY of per-asset rows. That fix was applied to fetchTreasuries and
 * NOT to sumBtcByType, which kept gating on `"btc_balance" in o` and so
 * matched zero entities — /float's government / ETF / public-company
 * split has been null ever since, reported only as `partial: true`.
 * This is the shared reader so the two cannot drift apart a third time.
 *
 * The BTC row is selected BY ASSET, never positionally: several upstream
 * entities hold more than one asset and holdings[0] would quietly
 * publish someone's ETH balance as their bitcoin.
 */
function btcBalanceOf(arr: unknown[], row: Record<string, unknown>): number | null {
  const holdingsRaw = resolveDevalue(arr, row.holdings);
  if (!Array.isArray(holdingsRaw)) return null;
  for (const entry of holdingsRaw) {
    const h = resolveDevalue(arr, entry);
    if (!h || typeof h !== "object") continue;
    const rec = h as Record<string, unknown>;
    const asset = resolveDevalue(arr, rec.asset);
    if (typeof asset === "string" && asset.toUpperCase() === "BTC") {
      const bal = resolveDevalue(arr, rec.balance);
      const n = typeof bal === "number" ? bal : Number(bal);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/** Symbol, and the display name when the feed has one. Poison rows
 *  are often a fund id with no equity ticker, or a row with neither. */
function entityPoisonLabel(
  arr: unknown[],
  o: Record<string, unknown>,
): string {
  const sym = entityTickerSymbol(arr, o);
  const nameRaw = resolveDevalue(arr, o.name);
  const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null;
  if (sym && name && name.toUpperCase() !== sym) return `${sym} (${name})`;
  return sym ?? name ?? "unnamed";
}

/**
 * Holders already judged impossible, matched by name or ticker symbol.
 * A row on this list is skipped only while its balance is OVER the
 * per-entity ceiling. A later reading under the ceiling counts.
 *
 * An over-ceiling row that is NOT on this list still withholds the
 * whole GOVERNMENT or FUND cohort. That rule stays. Public companies
 * are not handled here; they stay on the named-holder allowlist,
 * because under-ceiling rows in that type are copies often enough
 * that "drop the impossible ones and sum the rest" published a
 * fiction.
 *
 * Measured 2026-09-22. The other rows still summed to the numbers we
 * already publish: seven governments at 629,722 BTC, 34 funds at about
 * 1.44 million (the 2026-09-15 ETF cohort was 1.46 million).
 * - United Arab Emirates. The balance is not stable and not real:
 *   11,011,197 BTC on one read, 1.73 billion on the next.
 * - Incrementum Digital & Physical Gold Fund (Morningstar 0P0001DZL0),
 *   about 5.6 billion BTC.
 * - Osprey Bitcoin Trust (OBTC). The 2026-09-22 snapshot run withheld
 *   every ETF because this one row read 715,081,479 BTC. The other funds
 *   on that read still summed to about 1.44 million.
 * - Monochrome Bitcoin ETF (IBTC.XA). The next run, with Osprey skipped,
 *   withheld the cohort again on this row at 342,363,070 BTC. The other
 *   34 funds still summed to about 1.44 million.
 */
const KNOWN_CORRUPT_HOLDERS = new Set([
  "united arab emirates",
  "0p0001dzl0",
  "incrementum digital & physical gold fund",
  "obtc",
  "osprey bitcoin trust",
  "ibtc.xa",
  "monochrome bitcoin etf",
]);

function isKnownCorruptHolder(
  arr: unknown[],
  o: Record<string, unknown>,
): boolean {
  const sym = entityTickerSymbol(arr, o);
  if (sym && KNOWN_CORRUPT_HOLDERS.has(sym.toLowerCase())) return true;
  const nameRaw = resolveDevalue(arr, o.name);
  if (typeof nameRaw !== "string") return false;
  const name = nameRaw.trim().toLowerCase().replace(/\s+/g, " ");
  return name.length > 0 && KNOWN_CORRUPT_HOLDERS.has(name);
}

function entityTickerSymbol(
  arr: unknown[],
  o: Record<string, unknown>,
): string | null {
  const tickerObj = resolveDevalue(arr, o.ticker);
  if (typeof tickerObj === "string" && tickerObj) return tickerObj.toUpperCase();
  if (tickerObj && typeof tickerObj === "object" && "symbol" in tickerObj) {
    const s = (tickerObj as { symbol: unknown }).symbol;
    return typeof s === "string" && s ? s.toUpperCase() : null;
  }
  return null;
}

/**
 * Sum BTC holdings for one feed `type`.
 *
 * Without `allowTickers` (GOVERNMENT, FUND): an over-ceiling row
 * withholds the whole type, except a holder already on
 * KNOWN_CORRUPT_HOLDERS. Those are skipped and the rest publishes.
 * A new impossible row still withholds. Dropping every over-ceiling
 * row and summing whoever is left is how a 3.1M "public company"
 * figure would have shipped, which is why that type is allowlisted
 * instead.
 *
 * With `allowTickers` (PUBLIC_COMPANY): only named holders count.
 * Over-ceiling names on the list are skipped (logged) and the rest of
 * the list still publishes. Off-list poison never reaches the sum.
 *
 * Exported so verify can pin both postures against a fixture.
 */
export function sumBtcByType(
  arr: unknown[],
  targetType: string,
  allowTickers?: ReadonlySet<string>,
): number | null {
  let sum = 0;
  let matched = 0;
  let rejected = 0;
  // Names, not just a count. A withheld ETF cohort is otherwise a bare
  // `partial: true` and the operator cannot see which row poisoned it.
  const poison: string[] = [];
  const knownCorrupt: string[] = [];
  for (const v of arr) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    if (!("type" in o) || !("holdings" in o)) continue;
    const typeRaw = resolveDevalue(arr, o.type);
    if (typeRaw !== targetType) continue;
    if (allowTickers) {
      const sym = entityTickerSymbol(arr, o);
      if (!sym || !allowTickers.has(sym)) continue;
    }
    const btc = btcBalanceOf(arr, o);
    if (btc == null || !Number.isFinite(btc) || btc <= 0) continue;
    if (btc > PER_ENTITY_BTC_SANITY_CEILING) {
      const label = `${entityPoisonLabel(arr, o)} ${Math.round(btc)}`;
      // Known-impossible holders are not members of the cohort. An
      // unfamiliar over-ceiling row still withholds the type below.
      if (!allowTickers && isKnownCorruptHolder(arr, o)) {
        if (knownCorrupt.length < 8) knownCorrupt.push(label);
        continue;
      }
      rejected++;
      if (poison.length < 8) poison.push(label);
      continue;
    }
    sum += btc;
    matched++;
  }
  if (allowTickers) {
    if (rejected > 0) {
      console.error(
        `[market:treasuries:agg] type=${targetType} allowlist · skipped ${rejected} named holder(s) over the ` +
          `${PER_ENTITY_BTC_SANITY_CEILING.toLocaleString()} BTC ceiling (${poison.join(", ")}); ` +
          `${matched} named holder(s) remain (sum ${sum.toFixed(0)})`,
      );
    }
    return matched > 0 ? sum : null;
  }
  // A NEW impossible row still withholds the type. Known-impossible
  // holders were skipped above and do not trip this. Measured
  // 2026-09-10 the FUND cohort carried WisdomTree at 63,140,503,552 BTC
  // and Evolve at 3,255,666,461 beside rows that were right. Those
  // names are not on KNOWN_CORRUPT_HOLDERS, so if they reappear the
  // cohort goes null again until someone judges that specific row.
  if (knownCorrupt.length > 0 && rejected === 0) {
    console.warn(
      `[market:treasuries:agg] type=${targetType} skipped known-impossible ` +
        `${knownCorrupt.join(", ")}; publishing ${matched} row(s), sum ${sum.toFixed(0)}`,
    );
  }
  if (rejected > 0) {
    console.error(
      `[market:treasuries:agg] type=${targetType} WITHHELD · ${rejected} row(s) over the ` +
        `${PER_ENTITY_BTC_SANITY_CEILING.toLocaleString()} BTC ceiling (${poison.join(", ")}), so the ` +
        `${matched} row(s) that did parse (sum ${sum.toFixed(0)}) are not trustworthy either`,
    );
    return null;
  }
  return matched > 0 ? sum : null;
}


// One-shot: fetch every live signal in parallel. Result is shaped like the
// JSON response from /api/market.
// React.cache dedupes within a single RSC/route request so nested
// callers (today pack, pulse, OG) don't re-fan-out 8 upstreams.
export const getMarketSnapshot = cache(async (): Promise<MarketSnapshot> => {
  const [
    btcPrice,
    btcVol30d,
    fg,
    treasuryMap,
    mvrv,
    puell,
    fundingRate,
    hourly,
    blockHeight,
  ] = await Promise.all([
    fetchBTCPrice(),
    fetchBTCVol30d(),
    fetchFearGreed(),
    fetchTreasuries(),
    fetchMVRV(),
    fetchPuellMultiple(),
    fetchFundingRate(),
    fetchHourlyCloses(),
    fetchBlockHeight(),
  ]);

  const treasuries: Quote[] = TARGET_TICKERS.map((ticker) => {
    const t = treasuryMap.get(ticker);
    if (!t) {
      return {
        ticker,
        price: null,
        marketCapM: null,
        btcHoldings: null,
        mNAV: null,
      };
    }
    // Correct the feed market cap with a filing-sourced share count for
    // names where bitcointreasuries.net lags ATM dilution (ASST, MPJPY)
    // and under-prints the cap → biases mNAV low. No-op for MSTR/XXI
    // (override = null → feed value used). See lib/treasury-shares.ts.
    const marketCapM = resolveTreasuryMarketCapM(ticker, t.marketCapM, t.price);
    let mNAV: number | null = null;
    if (
      marketCapM != null &&
      t.btcHoldings != null &&
      btcPrice != null &&
      t.btcHoldings > 0
    ) {
      const btcNAVM = (t.btcHoldings * btcPrice) / 1_000_000;
      if (btcNAVM > 0) mNAV = marketCapM / btcNAVM;
    }
    return { ...t, ticker, marketCapM, mNAV };
  });

  return {
    btcPrice,
    btcVol30d,
    fearGreed: fg.value,
    fearGreedLabel: fg.label,
    treasuries,
    mvrv,
    puell,
    fundingRate,
    hourlyCloses: hourly.closes,
    hourlyTimestamps: hourly.timestamps,
    blockHeight,
    asOf: new Date().toISOString(),
    source: "coingecko · bitcointreasuries · alternative.me · coinmetrics · okx · yahoo · mempool.space",
  };
});
