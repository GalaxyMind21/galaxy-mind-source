// Machine-readable description of Galaxy Mind's public read-only API.
//
// Why: llms.txt already advertises these endpoints in prose, but agent
// tooling (Claude/Cursor/etc.) and HTTP clients auto-discover APIs via a
// standard OpenAPI document linked with <link rel="service-desc">. This
// route serves that document so the public data surface is wireable
// without hand-configuration · complements the live MCP server at
// /api/mcp/mcp (Streamable HTTP).
//
// Hand-authored (not generated) so it stays a deliberate, curated
// surface · only the endpoints meant for external consumption appear
// here. Keep it in sync when a public endpoint's params/shape change.
import { NextResponse } from "next/server";
import { TARGET_TICKERS } from "@/lib/market";
import { MARKETPLACE_NAME } from "@/lib/marketplace-listing";
import { RENT_PAGE_URL } from "@/lib/rent-page";

export const revalidate = 3600;

const SITE = "https://galaxymind.space";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
} as const;

// Reusable bits.
const jsonResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { type: "object" } } },
});

const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Galaxy Mind public API",
    // 1.1.1 · corrections only, no surface change: both history
    // endpoints return an OBJECT not a bare array, out-of-enum `days`
    // falls back rather than 400s, the treasuries CSV has six columns
    // (btcPrice was missing), and /api/heartbeat carries btcPrice.
    // 1.2.0 · /api/hashrate/quote added (agent rental quote).
    // 2026-10-16 · /api/hashrate/quote is now the direct quote (rigs, ph, days).
    // 2.0.0 · 2026-10-17 MRR-only: direct rentals closed; /api/hashrate/quote deprecated (410 direct_rentals_closed).
    version: "2.0.0",
    summary: "Live Bitcoin market signals, treasury mNAV, float, and a vendor directory.",
    description:
      "Read-only JSON endpoints powering galaxymind.space. All GET, no auth. " +
      "Every endpoint is edge-cached (see x-cache-seconds per path) and fail-closes " +
      "to neutral/null values rather than erroring when an upstream source is down. " +
      "Data sources: CoinGecko, Yahoo Finance, bitcointreasuries.net, alternative.me, " +
      "Coinmetrics, OKX, mempool.space. An MCP server with the same data is at /api/mcp/mcp (Streamable HTTP transport).",
    contact: { name: "Galaxy Mind", url: SITE },
    license: { name: "Public data · attribution appreciated", identifier: "CC-BY-4.0" },
  },
  // 2026-10-17 MRR-only: replaces the x402 payment note. The direct-rental routes answer 410 direct_rentals_closed.
  "x-rentals":
    `Galaxy Mind rents its hashrate on ${MARKETPLACE_NAME} now. Start at ${RENT_PAGE_URL}: pick how much hashrate ` +
    `you want in 270 TH/s units and each free unit has its own Rent button. Direct rental routes on this site answer ` +
    `410 direct_rentals_closed with rentUrl (${RENT_PAGE_URL}).`,
  servers: [{ url: SITE, description: "Production" }],
  tags: [
    { name: "market", description: "Live BTC market signals" },
    { name: "treasuries", description: "Bitcoin treasury company mNAV" },
    { name: "float", description: "Circulating / available supply" },
    { name: "hashrate", description: "ASIC rental market and hashprice" },
    { name: "directory", description: "Bitcoin-accepting vendor directory" },
  ],
  paths: {
    "/api/stack": {
      get: {
        tags: ["market"],
        operationId: "getStackVerdict",
        summary: "Bitcoin Buying Gauge verdict",
        description:
          "The 0-100 buying-pressure score, tier, and the 10 weighted signal readings " +
          "(MVRV, Mayer, Puell, funding, Fear & Greed, price-vs-30d-MA, realized vol, " +
          "hour-of-day, day-of-week, MSTR mNAV).",
        responses: { "200": jsonResponse("Verdict with score, tier, and signal breakdown.") },
        "x-cache-seconds": 120,
      },
    },
    // Added 2026-07-25 · these four are named in public/llms.txt and
    // allow-listed in robots.ts PUBLIC_DATA_ENDPOINTS, but were absent
    // from this document — so an agent that discovered the API through
    // the <link rel="service-desc"> tag could not see that any TIME
    // SERIES existed at all, only point-in-time reads.
    "/api/stack/history": {
      get: {
        tags: ["market"],
        operationId: "getStackHistory",
        summary: "Daily gauge history (JSON or CSV)",
        description:
          "Daily snapshots of the buying gauge, oldest-first. CSV columns: date,score,tier. " +
          "Backed by the daily snapshot cron, so coverage starts when snapshots began.",
        parameters: [
          {
            name: "days",
            in: "query",
            required: false,
            schema: { type: "integer", enum: [30, 90, 180, 365], default: 90 },
            description:
              // The route does NOT reject an out-of-enum value — it silently
              // falls back to 90 (stack/history/route.ts). Saying "rejected"
              // sent clients looking for a 4xx that never comes.
              "Window length. Any other value falls back to 90; the response echoes the window actually used.",
          },
          {
            name: "format",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["csv"] },
            description: "Omit for JSON; `csv` returns text/csv.",
          },
        ],
        responses: { "200": jsonResponse("Object {history, count, asOf} where history is [{date, score, tier}], oldest-first. NOT a bare array.") },
        "x-cache-seconds": 300,
      },
    },
    "/api/treasuries/history": {
      get: {
        tags: ["treasuries"],
        operationId: "getTreasuryHistory",
        summary: "Daily per-ticker mNAV history (JSON or CSV)",
        description:
          "Daily mNAV/price/holdings snapshots for one treasury, oldest-first. " +
          // Six columns, verified against treasuries/history/route.ts — the
          // list here previously omitted btcPrice, so a positional parser
          // written to these docs mis-mapped the final column.
          "CSV columns: date,mNAV,price,btcHoldings,marketCapM,btcPrice.",
        parameters: [
          {
            name: "ticker",
            in: "query",
            required: true,
            // Reuse the live constant so the enum can never drift from
            // the tickers the site actually tracks.
            schema: { type: "string", enum: [...TARGET_TICKERS] },
            description: "Treasury ticker.",
          },
          {
            name: "days",
            in: "query",
            required: false,
            schema: { type: "integer", enum: [30, 90, 180, 365], default: 90 },
            // Same silent fallback as /api/stack/history · an out-of-enum
            // value is snapped to the default, not rejected.
            description:
              "Window length. Any other value falls back to 90; the response echoes the window actually used.",
          },
          {
            name: "format",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["csv"] },
            description: "Omit for JSON; `csv` returns text/csv.",
          },
        ],
        responses: { "200": jsonResponse("Object {ticker, history, count, asOf} where history is [{date, mNAV, price, btcHoldings}], oldest-first. NOT a bare array.") },
        "x-cache-seconds": 300,
      },
    },
    "/api/pulse": {
      get: {
        tags: ["market"],
        operationId: "getPulseArchive",
        summary: "Weekly Pulse archive",
        description:
          "One entry per ISO week: that week's gauge verdict, in-play float and weekly delta, cheapest treasury mNAV, and directory growth. Answers \"what happened this week\" where /api/stack answers \"what is true now\". Written by the Monday 00:30 UTC cron; the archive is capped, so depth grows with time rather than being backfilled.",
        responses: { "200": jsonResponse("Object {count, weeks, asOf}, weeks newest-first.") },
        "x-cache-seconds": 1800,
      },
    },
    "/api/status": {
      get: {
        tags: ["market"],
        operationId: "getStatus",
        summary: "Data-source health (CORS-open · always 200)",
        description:
          "Per-source freshness plus whether each surface is live or on fallbacks. " +
          "CONTRACT: this route ALWAYS returns HTTP 200, even on internal error, so a " +
          "monitor watching it never pages because the status route itself hiccuped — " +
          "read the body's `ok` field, not the status code.",
        responses: { "200": jsonResponse("{ ok, asOf, sources[] }.") },
        "x-cache-seconds": 120,
      },
    },
    "/api/float-heartbeat": {
      get: {
        tags: ["market"],
        operationId: "getFloatHeartbeat",
        summary: "Lightweight in-play float (CORS-open)",
        description:
          "~200-byte payload powering the embeddable Supply Clock. Carries the in-play " +
          "float, a drain rate, and an honest state lamp (DRAINING / REFILLING / BASELINE / SYNCING).",
        responses: { "200": jsonResponse("Compact float payload with state.") },
        "x-cache-seconds": 300,
      },
    },
    "/api/heartbeat": {
      get: {
        tags: ["market"],
        operationId: "getHeartbeat",
        summary: "Lightweight gauge + block height (CORS-open)",
        description:
          "~120-byte payload: { blockHeight, score, tier, asOf, btcPrice, degraded }. This is the "
          + "only CORS-open, 30s-cached surface that carries BTC spot, which makes it the "
          + "right poll target for a browser widget that needs price. CORS-open for " +
          "third-party embeds. `degraded:true` means ≥4/8 signals were null at snapshot time.",
        responses: { "200": jsonResponse("blockHeight, score, tier, asOf, btcPrice, degraded.") },
        "x-cache-seconds": 30,
      },
    },
    "/api/market": {
      get: {
        tags: ["market"],
        operationId: "getMarketSnapshot",
        summary: "Full market snapshot",
        description:
          "Everything the gauge is built from: BTC price, 30d realized vol, Fear & Greed, " +
          "MVRV, Puell, funding rate, treasury rows, block height, and ~400d of hourly closes. " +
          "Large (~hundreds of KB) · prefer /api/heartbeat or /api/stack for polling.",
        responses: { "200": jsonResponse("MarketSnapshot.") },
        "x-cache-seconds": 300,
      },
    },
    "/api/treasuries": {
      get: {
        tags: ["treasuries"],
        operationId: "getTreasuries",
        summary: "Treasury mNAV scoreboard",
        description:
          `Per-ticker mNAV, price, market cap, BTC holdings, premium-to-NAV, and a ` +
          `plain-language interpretation for ${TARGET_TICKERS.join(", ")}. mNAV is the ` +
          `GROSS definition: market cap ÷ (BTC held × spot), no debt/converts/preferreds netted. ` +
          `Each row also carries a 'cebe' object · the NET (Common Equity Bitcoin Exposure) mNAV ` +
          `after senior claims (debt + preferred − cash) plus a claims %, where sourced.`,
        responses: { "200": jsonResponse("Treasury rows + asOf.") },
        "x-cache-seconds": 300,
      },
    },
    "/api/history": {
      get: {
        tags: ["treasuries"],
        operationId: "getHistory",
        summary: "Daily price history for allow-listed tickers",
        description:
          "Daily closes for charting. Allow-listed tickers only (BTC + the tracked treasuries " +
          "+ the /fit asset universe); 30-ticker cap per request.",
        parameters: [
          {
            name: "tickers",
            in: "query",
            required: true,
            description:
              "Comma-separated ticker symbols (allow-listed; max 30). " +
              "BTC spot is BTC, not Yahoo-style BTC-USD.",
            schema: { type: "string", example: "MSTR,BTC" },
          },
        ],
        responses: { "200": jsonResponse("Per-ticker daily close arrays.") },
        "x-cache-seconds": 21600,
      },
    },
    "/api/float": {
      get: {
        tags: ["float"],
        operationId: "getFloat",
        summary: "Available-supply (float) snapshot",
        description:
          "How much BTC is realistically buyable: mined supply minus lost, government, ETF, " +
          "public-company, and long-term-holder cohorts. Includes the cohort breakdown and a " +
          "`partial` flag when a live cohort fetch was degraded. " +
          "CSV columns: date,blockHeight,minedSupply,inPlay,totalSupply,partial.",
        parameters: [
          {
            name: "format",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["csv"] },
            description:
              "Omit for the JSON snapshot; `csv` returns the daily history series as text/csv.",
          },
          {
            name: "days",
            in: "query",
            required: false,
            schema: { type: "integer", enum: [30, 90, 180, 365], default: 90 },
            description:
              "CSV only. Any other value falls back to 90 (allow-listed to bound CDN cache keys).",
          },
        ],
        responses: { "200": jsonResponse("FloatSnapshot with cohorts + inPlay headline; text/csv history when format=csv.") },
        "x-cache-seconds": 1800,
      },
    },
    "/api/hashrate": {
      get: {
        tags: ["hashrate"],
        operationId: "getHashrateDesk",
        summary: "Network hashprice + outside SHA256 market aggregates",
        description:
          "The derived network hashprice, network hashrate, BTC spot in USD (btcUsd) and the " +
          "current block reward incl. recent fees (blockRewardBtc), plus outside SHA256 market " +
          "aggregates. All prices are BTC per PH per day, NOT the USD/PH/day convention published " +
          "hashprice indices use. Market aggregates are outside data, not Galaxy Mind's price; " +
          `rentals happen on ${MARKETPLACE_NAME} (see x-rentals). \`ourRigs\` lists our machines as bay aliases only ` +
          "(id, name, status, advertisedPh, measuredPh). " +
          "`degraded[]` lists any feed that failed.",
        responses: { "200": jsonResponse("Hashrate desk: hashprice, networkPhs, btcUsd, blockRewardBtc, market aggregates, degraded, asOf.") },
        "x-cache-seconds": 300,
      },
    },
    "/api/hashrate/quote": {
      get: {
        tags: ["hashrate"],
        operationId: "getRentalQuote",
        deprecated: true,
        summary: "Deprecated: direct rentals closed (410)",
        description:
          "Deprecated 2026-10-17: direct rentals from Galaxy Mind have closed. In the default mode this answers " +
          `410 { error: "direct_rentals_closed", message, rentUrl, units }, where rentUrl is ${RENT_PAGE_URL}. ` +
          "The rest of this description is the former behaviour, kept for the reversible direct mode. " +
          "Direct rental quote from Galaxy Mind: the same price as the MCP tools get_quote and " +
          "get_rental_quote and the /hashrate checkout, in USDC and BTC per PH per day, never below our " +
          "floor. 270 TH minimum in whole-rig steps, 1 to 4 rigs (up to 1.08 PH), 1 to 7 whole days during the pilot " +
          "(default 1). Quotes are valid 15 minutes and indicative only. Aggregate only: no per-machine " +
          "data. Fails closed with 503 pricing_unavailable when today's price is missing or stale. " +
          "Out-of-range input returns 400 with below_minimum, above_maximum or invalid_input and the supported limits. " +
          "This endpoint cannot rent and takes no payment.",
        parameters: [
          { name: "rigs", in: "query", required: false, description: "Whole S21 XP rigs, 1 to 4. Default 1.", schema: { type: "integer", minimum: 1, maximum: 4 } },
          { name: "ph", in: "query", required: false, description: "Hashrate in PH/s, up to 1.08, rounded to whole rigs. Overrides rigs.", schema: { type: "number", maximum: 1.08 } },
          { name: "days", in: "query", required: false, description: "Whole days, 1 to 30. Default 1.", schema: { type: "integer", minimum: 1, maximum: 30 } },
        ],
        responses: { "410": jsonResponse("direct_rentals_closed: message, rentUrl, units."), "200": jsonResponse("Direct mode only. DirectQuote: quoteId, rigType, rigs, thPerRig, ph, days, pricePerPhDayBtc, totalBtc, issuedAt, validUntil, priceAsOf, notes[], closeTheSale.") },
        "x-cache-seconds": 0,
      },
    },
    "/api/vendors.json": {
      get: {
        tags: ["directory"],
        operationId: "getVendors",
        summary: "Bitcoin-accepting vendor directory (CORS-open)",
        description:
          "Community-curated vendors that sell physical goods for native Bitcoin. Composable " +
          "filters; CORS-open so any site can render a custom widget. Response: " +
          "{ version, count, totalAvailable, filters, asOf, vendors }. Each vendor carries both " +
          "listedAt (day first listed, unix seconds UTC midnight; immutable, unaffected by " +
          "re-verification) and verifiedAt (unix seconds UTC midnight of the last human " +
          "re-confirmation; used by the `since` filter below and by staleness checks). " +
          "Each vendor also carries `slug` (stable listing id; its page is /v/{slug}, already in `url`). " +
          "`handle` is the identity that runs the shop and is NOT unique: one handle may own several " +
          "listings, in which case each carries `siblings: [{ name, slug, url }]` naming the others " +
          "(absent when the handle runs one shop). Key rows by `slug`, not `handle`.",
        parameters: [
          { name: "category", in: "query", required: false, schema: { type: "string", enum: ["apparel", "general-goods", "hardware", "consumables", "collectibles", "services", "books"] } },
          { name: "country", in: "query", required: false, description: "ISO-3166-1 alpha-2.", schema: { type: "string", example: "US" } },
          { name: "platform", in: "query", required: false, schema: { type: "string", enum: ["x", "nostr", "lightning"] } },
          { name: "since", in: "query", required: false, description: "verifiedAt cutoff (YYYY-MM-DD).", schema: { type: "string", format: "date" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200 } },
        ],
        responses: { "200": jsonResponse("Filtered vendor list with metadata.") },
        "x-cache-seconds": 300,
      },
    },
    "/api/subscriber-count": {
      get: {
        tags: ["market"],
        operationId: "getSubscriberCount",
        summary: "Alert subscriber count",
        description: "Total alert subscribers · used for social-proof UI.",
        responses: { "200": jsonResponse("{ count }.") },
        "x-cache-seconds": 300,
      },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(OPENAPI, { headers: CORS });
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}
