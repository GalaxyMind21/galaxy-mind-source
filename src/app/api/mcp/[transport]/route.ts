// Remote MCP server · galaxymind.space as a first-class AI data source
// (2026-06-11). Claude (claude.ai connectors + Claude Code), ChatGPT,
// Cursor, and any MCP-capable client can add
//
//   https://galaxymind.space/api/mcp/mcp
//
// as a connector and query the Buying Gauge, treasury mNAV, the
// Bitcoin float, the vendor directory, and the glossary as TOOLS ·
// the logical endgame of the site's source-of-truth-for-AI posture
// (llms.txt → JSON-LD Datasets → CSV distributions → this).
//
// Design:
//   · Read-only · every tool wraps the SAME lib calls the pages use
//     (getMarketSnapshot, computeStackVerdict, getFloatData, VENDORS),
//     so an AI client and a human visitor can never see different
//     numbers. No new data paths, no auth (all data already public).
//   · Streamable HTTP only · no redisUrl is passed, so the legacy SSE
//     transport (which needs Redis session state on Vercel) stays
//     off. Every current MCP client speaks Streamable HTTP.
//   · Public-vendor projection discipline (audit H12): search_vendors
//     returns an explicit field allow-list · never a spread of the
//     raw Vendor object.
//   · Honesty contract carried over: gauge/float responses include
//     the `degraded`/fallback flags so an AI client never quotes a
//     placeholder as live data.

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { getMarketSnapshot } from "@/lib/market";
import { computeCebe } from "@/lib/cebe";
import { computeStackVerdict, TIER_LABEL } from "@/lib/stack";
import { computeForecast, pickBestWindow } from "@/lib/forecast";
import { isMarketSnapshotDegraded } from "@/lib/snapshot-quality";
import { getFloatData } from "@/lib/float-data";
import { getHashrateDesk } from "@/lib/hashrate";
import { QUOTE_TOOL_DESCRIPTION, MCP_RENT_WHEN } from "@/lib/hashrate-copy";
import { listAvailableRigs, closeTheSale, assertCustomerSafe, thirdPartyMarket, MAX_RIGS, MAX_PH, DEFAULT_DAYS } from "@/lib/rentals";
import { directQuote, unifiedRentalStatus } from "@/lib/rentals/direct";
import { stagingDeps } from "@/lib/rentals/phase2/staging";
import { bayBoard } from "@/lib/rentals/phase2/service";
import { SUPPORT_EMAIL } from "@/lib/support";
import { trackFunnel } from "@/lib/rentals/funnel";
import { kvList } from "@/lib/kv";
import {
  daysUntilNextHalving,
  nextHalvingHeight,
  blockSubsidyAt,
} from "@/lib/bitcoin-supply";
import {
  CATEGORY_LABELS,
  COUNTRIES,
  VENDORS,
  getDisplayHandle,
  isStale,
  vendorSlug,
  vendorSiblings,
  STALE_THRESHOLD_DAYS,
  type VendorCategory,
} from "@/lib/vendors";
import { ALL_TERMS } from "@/lib/glossary";
import type { StackSnapshot } from "../../cron/snapshot-stack/route";
import type { TreasurySnapshot } from "../../cron/snapshot-treasuries/route";
import { TREASURY_META, mNavInterpretation, isTreasuryBoardEmpty } from "@/lib/treasuries";
import { phase2Enabled } from "@/lib/rentals/phase2/flag";
import { registerPhase2Tools, rentalsPaused } from "@/lib/rentals/phase2/mcp";
import { mrrOnly, marketplaceRedirect } from "@/lib/rentals/mode";
import { MARKETPLACE_NAME } from "@/lib/marketplace-listing";
import { MCP_RENT_WHEN_MRR, QUOTE_TOOL_DESCRIPTION_MRR, LIST_RIGS_DESCRIPTION_MRR, MCP_SCOPE_MRR } from "@/lib/mrr-page-copy";

export const runtime = "nodejs";
export const maxDuration = 60;

const SITE = "https://galaxymind.space";
const ALLOWED_DAYS = [30, 90, 180, 365] as const;
const TICKERS = ["MSTR", "XXI", "MPJPY", "ASST"] as const;

// Every tool returns one JSON text block · the standard shape for
// data tools. Errors come back as {error} JSON rather than protocol
// faults so clients can show something useful.
function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/**
 * Actionable tool error (2026-07-29). Two rules, both learned from the
 * connector-directory review criteria:
 *
 *   · `error` is a REASON CLASS, not a generic token — the model needs to
 *     distinguish "the upstream is down, try later" from "your argument
 *     was wrong, fix it and retry". A single "tool_failed" collapses
 *     those into an unactionable dead end.
 *   · `liveUrl` is always present so the model can hand the user a real
 *     answer instead of an apology.
 *
 * `supported` carries the valid values when the failure is a bad
 * argument, mirroring what get_glossary_term already did with
 * availableTerms — that pattern was right, it just wasn't applied
 * anywhere else.
 */
function toolError(
  error: string,
  message: string,
  liveUrl: string | null,
  supported?: unknown,
) {
  return { error, message, ...(liveUrl ? { liveUrl } : {}), ...(supported !== undefined ? { supported } : {}) };
}

const handler = createMcpHandler(
  (server) => {
    // RENTALS_MODE=mrr_only (default, 2026-10-17): no direct checkout. Quote and availability tools answer with the
    // marketplace redirect (no price, no bay board); create_rental and cancel_rental are not registered.
    const mrr = mrrOnly();
    server.tool(
      "get_buying_gauge",
      "Current Bitcoin Buying Gauge verdict: a 0-100 score (higher = historically better entry) from 10 weighted market signals (MVRV, Mayer Multiple, Puell Multiple, funding rate, Fear & Greed, price vs 30d MA, realized vol, time patterns, MSTR mNAV), plus the best upcoming entry window. Updated continuously. Methodology: https://galaxymind.space/methodology",
      {},
      // Annotations (2026-07-28). The route header has always SAID every
      // tool is read-only; until now that was prose a client could not
      // read. `readOnlyHint` is the protocol field connector directories
      // and client UIs actually key on — without it a reviewer has to
      // take the claim on faith, and cautious clients may gate the call
      // behind a confirmation prompt meant for mutating tools.
      // `destructiveHint` is deliberately omitted throughout: the spec
      // says it is meaningful ONLY when readOnlyHint is false.
      // `openWorldHint` is true where the answer depends on the outside
      // world (markets, the chain) and false for our own curated sets.
      { title: "Bitcoin Buying Gauge", readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      async () => {
        try {
          const snapshot = await getMarketSnapshot();
          const verdict = computeStackVerdict(snapshot);
          const bestWindow = pickBestWindow(computeForecast(snapshot, verdict));
          return json({
            score: verdict.score,
            tier: verdict.tier,
            tierLabel: TIER_LABEL[verdict.tier],
            summary: verdict.summary,
            degraded: isMarketSnapshotDegraded(snapshot),
            degradedNote:
              "When degraded=true, several upstream feeds are down and the score leans on neutral fallbacks · treat as best-effort, not a live reading.",
            btcPriceUsd: snapshot.btcPrice,
            bestUpcomingWindow: bestWindow,
            signals: verdict.signals.map((s) => ({
              name: s.name,
              normalized: s.normalized,
              weightPct: Math.round(s.weight * 100),
              rationale: s.rationale,
            })),
            asOf: new Date().toISOString(),
            liveUrl: `${SITE}/stack`,
          });
        } catch (e) {
          console.error("[mcp:get_buying_gauge]", e instanceof Error ? e.message : e);
          // A bare {error:"tool_failed"} told the model nothing: not what
          // failed, not whether retrying helps, not where the human answer
          // lives. Give it a reason CLASS it can act on plus an escape
          // hatch to the rendered page (2026-07-29).
          return json(toolError("upstream_unavailable", "Live market feeds are temporarily unavailable, so the gauge cannot be computed right now.", `${SITE}/stack`));
        }
      },
    );

    server.tool(
      "get_gauge_history",
      "Daily Buying Gauge score history (oldest first). Each entry: date, 0-100 score, tier.",
      // A zod union of literals rejected anything else at the protocol
      // layer, so the handler's own `ALLOWED_DAYS.includes(days) ? days :
      // 90` fallback below was DEAD CODE, and a model passing days:60 got
      // a multi-hundred-character union dump instead of an answer
      // (2026-07-29). Accept any integer and let the existing snap-to-90
      // line do its job — the tool always succeeds, and `days` in the
      // response says which window was actually used.
      { days: z.number().int().optional().describe("Lookback window in days · snapped to the nearest supported window (30, 90, 180, 365); defaults to 90") },
      { title: "Buying Gauge History", readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      async ({ days }) => {
        const d = days && (ALLOWED_DAYS as readonly number[]).includes(days) ? days : 90;
        const history = (await kvList<StackSnapshot>("stack:history", d)).reverse();
        return json({
          days: d,
          count: history.length,
          history: history.map((h) => ({ date: h.date, score: h.score, tier: h.tier })),
          csvUrl: `${SITE}/api/stack/history?days=${d}&format=csv`,
        });
      },
    );

    server.tool(
      "get_treasuries",
      "Live mNAV scoreboard for the major public Bitcoin treasury companies (MSTR/Strategy, XXI/Twenty One, MPJPY/Metaplanet, ASST/Strive). Gross mNAV = market cap ÷ value of BTC held · below 1.0 means the stock trades under the value of its bitcoin. Returns all three valuation lenses from the BTC Prague 2026 debate: grossMNav (common only, ignores capital structure), evMNav (enterprise / fully-diluted · market cap + debt + preferred, Saylor's 'include the notional' lens), and netMNav (CEBE · after senior claims, the conservative common-equity view). Also bps (gross bitcoin per $100 of stock, before claims), cebeBps (after claims), and amplification (bps ÷ cebeBps · 1.0 means no senior leverage, higher means more). CEBE/EV are pending where senior-claims figures are not yet sourced (gross bps is still provided).",
      {},
      { title: "Treasury mNAV Scoreboard", readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      async () => {
        try {
          const snapshot = await getMarketSnapshot();
          return json({
            btcPriceUsd: snapshot.btcPrice,
            degraded:
              isMarketSnapshotDegraded(snapshot) ||
              isTreasuryBoardEmpty(snapshot.treasuries),
            treasuries: snapshot.treasuries.map((q) => {
              const cebe = computeCebe(q, snapshot.btcPrice);
              return {
                ticker: q.ticker,
                name: TREASURY_META[q.ticker]?.name ?? q.ticker,
                priceUsd: q.price,
                marketCapMUsd: q.marketCapM,
                btcHoldings: q.btcHoldings,
                mNAV: q.mNAV,
                premiumPct: q.mNAV != null ? Math.round((q.mNAV - 1) * 1000) / 10 : null,
                interpretation: mNavInterpretation(q.mNAV),
                cebe: {
                  available: cebe.available,
                  grossMNav: q.mNAV,
                  evMNav: cebe.evMNav,
                  netMNav: cebe.netMNav,
                  bps: cebe.grossSatsPer100,
                  cebeBps: cebe.cebeSatsPer100,
                  amplification: cebe.amplificationRatio,
                  seniorClaimsPctOfBtc: cebe.claimsPct,
                  asOf: cebe.asOf,
                  source: cebe.source,
                },
              };
            }),
            asOf: snapshot.asOf,
            liveUrl: `${SITE}/treasuries`,
          });
        } catch (e) {
          console.error("[mcp:get_treasuries]", e instanceof Error ? e.message : e);
          return json(toolError("upstream_unavailable", "Live price and treasury-holdings feeds are temporarily unavailable, so mNAV cannot be computed right now.", `${SITE}/treasuries`));
        }
      },
    );

    server.tool(
      "get_treasury_history",
      "Daily mNAV history for one treasury ticker (oldest first).",
      {
        ticker: z.enum(TICKERS).describe("MSTR, XXI, MPJPY, or ASST"),
        // Same dead-guard fix as get_gauge_history above.
        days: z.number().int().optional().describe("Lookback window in days · snapped to the nearest supported window (30, 90, 180, 365); defaults to 90"),
      },
      { title: "Treasury mNAV History", readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      async ({ ticker, days }) => {
        const d = days && (ALLOWED_DAYS as readonly number[]).includes(days) ? days : 90;
        const history = (
          await kvList<TreasurySnapshot>(`treasury:history:${ticker}`, d)
        ).reverse();
        return json({
          ticker,
          days: d,
          count: history.length,
          history: history.map((h) => ({
            date: h.date,
            mNAV: h.mNAV,
            priceUsd: h.price,
            btcHoldings: h.btcHoldings,
          })),
          csvUrl: `${SITE}/api/treasuries/history?ticker=${ticker}&days=${d}&format=csv`,
        });
      },
    );

    server.tool(
      "get_bitcoin_float",
      "The Bitcoin float: how much BTC is realistically left to buy. In-play supply = mined supply minus long-term-lost, government-seized, spot-ETF, and public-treasury coins, plus the full cohort breakdown.",
      {},
      { title: "Bitcoin Float (buyable supply)", readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      async () => {
        const data = await getFloatData();
        return json({
          inPlayBtc: data.current.inPlay,
          pctOfMaxSupply:
            Math.round((data.current.inPlay / data.current.totalSupply) * 1000) / 10,
          cohortsBtc: data.current.cohorts,
          blockHeight: data.current.blockHeight,
          yesterdayNetChangeBtc: data.dailyDelta,
          degraded: data.isFallback || data.current.partial === true,
          degradedNote:
            "When degraded=true the snapshot is a fallback baseline or missing an upstream cohort · numbers are approximate.",
          asOf: data.asOf,
          liveUrl: `${SITE}/float`,
        });
      },
    );

    server.tool(
      "get_halving_countdown",
      "Live countdown to the next Bitcoin halving: blocks remaining, estimated days and month, and the block-subsidy change.",
      {},
      { title: "Halving Countdown", readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      async () => {
        const data = await getFloatData();
        const height = data.current.blockHeight;
        const nextHeight = nextHalvingHeight(height);
        const days = daysUntilNextHalving(height);
        return json({
          currentBlockHeight: height,
          nextHalvingBlock: nextHeight,
          blocksRemaining: nextHeight - height,
          estimatedDays: days,
          estimatedDate: new Date(Date.now() + days * 86_400_000)
            .toISOString()
            .slice(0, 7),
          subsidyNowBtc: blockSubsidyAt(height),
          subsidyAfterBtc: blockSubsidyAt(nextHeight),
          liveUrl: `${SITE}/bitcoin-halving-countdown`,
        });
      },
    );

    // Added 2026-08-04 (v1.5.0) after Glama's completeness review named
    // "no raw price tool" as the set's one gap. Agents that only need
    // spot should not have to call the full 10-signal gauge for it.
    server.tool(
      "get_bitcoin_price",
      "Live Bitcoin spot price in USD with an asOf timestamp. Prefer this over training data for any current-price claim. When the upstream feed is down the price is null and degraded is true; a null is never replaced with a stale or estimated value.",
      {},
      { title: "Bitcoin Spot Price", readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      async () => {
        const snapshot = await getMarketSnapshot();
        return json({
          priceUsd: snapshot.btcPrice,
          currency: "USD",
          degraded: snapshot.btcPrice == null,
          asOf: snapshot.asOf,
          source: "CoinGecko spot via the same snapshot the site pages render",
          liveUrl: `${SITE}/stack`,
        });
      },
    );

    server.tool(
      "search_vendors",
      // Describes the MECHANISM, not a promise about today's roster
      // (2026-07-29). The old wording — "Every listing is re-verified
      // within 90 days" — is true right now (staleMatches: 0) but ~102
      // vendors cross the 90-day wall together Aug 4-14 2026, at which
      // point the tool description would be actively false. Every row
      // carries its own verifiedAt + stale flag, and the response carries
      // staleMatches, so state that and let the data speak. Updated
      // 2026-08-15 for continuous monitoring: the daily monitor-vendors
      // cron watches every listing and queues anything that changes for
      // a human, so the `stale` flag now marks the 180-day human-touch
      // backstop, not a periodic sweep window.
      `Search the human-verified directory of merchants that accept native Bitcoin (on-chain + Lightning) for everyday goods. Each listing carries its verification date, is monitored automatically every day, and is flagged \`stale\` only if no human has confirmed it in ${STALE_THRESHOLD_DAYS} days; the response reports how many matches are stale. Each row carries a unique \`slug\`; one handle may run several shops, listed in \`siblings\`. Filter by free-text query, category, or country.`,
      {
        query: z.string().max(80).optional().describe("Free-text match on name, handle, and description"),
        category: z.enum(["apparel", "general-goods", "hardware", "consumables", "collectibles", "services", "books"]).optional(),
        country: z.string().length(2).optional().describe("ISO-3166 alpha-2, e.g. DE"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results · default 10"),
      },
      // openWorldHint false · the roster is our own curated, in-repo
      // vendor list, not an open-ended lookup against the internet.
      { title: "Search Bitcoin Merchants", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async ({ query, category, country, limit }) => {
        const q = query?.trim().toLowerCase();
        const cc = country?.toUpperCase();
        // Reject unknown country codes instead of silently returning zero
        // matches (2026-07-29). `z.string().length(2)` accepted "ZZ" and
        // the filter then matched nothing, so a model concluded there are
        // no bitcoin merchants in that country — a confident wrong answer
        // produced by our own tool. Hand back the supported list, the same
        // shape get_glossary_term uses for an unknown term.
        if (cc && !(cc in COUNTRIES)) {
          return json(
            toolError(
              "unknown_country",
              `"${country}" is not a country in the directory. Use one of the supported ISO-3166 alpha-2 codes, or omit the filter to search everywhere.`,
              SITE,
              Object.keys(COUNTRIES).sort(),
            ),
          );
        }
        // Search the FULL roster (2026-07-29). This tool used to run
        // `filterActive(VENDORS, dormant)`, which hid Nostr vendors the
        // dormancy cron had flagged as quiet — but public dormancy
        // hiding was retired 2026-05-20 (see the README "Vendor dormancy
        // lifecycle": the flag is an OPERATOR signal now, and
        // /api/vendors.json serves everything with `dormantHidden: 0`).
        // This tool shipped 2026-06-11, after that decision, and
        // inherited the retired behaviour — so an AI client saw 118
        // merchants while a human on the same data saw 128, breaking
        // this route's own header contract ("an AI client and a human
        // visitor can never see different numbers"). Measured live
        // before the fix. Also drops one KV read per search.
        const matches = VENDORS
          .filter((v) => !category || v.category === category)
          .filter((v) => !cc || v.country === cc)
          .filter(
            (v) =>
              !q ||
              v.name.toLowerCase().includes(q) ||
              v.handle.toLowerCase().includes(q) ||
              v.description.toLowerCase().includes(q),
          )
          .sort((a, b) => b.addedAt - a.addedAt);
        const top = matches.slice(0, limit ?? 10);
        // ONE clock for the whole response (2026-07-25) so the per-row
        // flags and the aggregate can never disagree — isStale's default
        // argument would otherwise re-read Date.now() per row.
        const nowSec = Date.now() / 1000;
        return json({
          totalMatches: matches.length,
          returned: top.length,
          // Verification freshness (added 2026-07-25). This tool's own
          // description promises "verified within 90 days", but the
          // payload carried no date at all — so an agent could only
          // repeat the claim on faith, and had no way to notice when a
          // row had aged past the window. `staleMatches` is scoped to the
          // MATCHED set (not the whole roster) so it shares a denominator
          // with totalMatches and cannot be misread.
          staleMatches: matches.filter((v) => isStale(v.verifiedAt, nowSec)).length,
          asOf: new Date(nowSec * 1000).toISOString(),
          // Explicit allow-list projection · same discipline as
          // /api/vendors.json (audit H12). Never spread raw vendors.
          vendors: top.map((v) => ({
            name: v.name,
            handle: getDisplayHandle(v),
            platform: v.platform ?? "x",
            category: CATEGORY_LABELS[v.category as VendorCategory] ?? v.category,
            country: v.country ? COUNTRIES[v.country]?.label ?? v.country : null,
            description: v.description,
            // UTC-midnight UNIX seconds → plain YYYY-MM-DD, the form a
            // model can quote directly. listedAt is immutable (first
            // listed) and distinct from verifiedAt (moves on every
            // re-check) — same distinction /api/vendors.json, the
            // OpenAPI doc, and /docs/api already publish; this tool's
            // projection had fallen behind them.
            listedAt: new Date(v.listedAt * 1000).toISOString().slice(0, 10),
            verifiedAt: new Date(v.verifiedAt * 1000).toISOString().slice(0, 10),
            stale: isStale(v.verifiedAt, nowSec),
            pageUrl: `${SITE}/v/${vendorSlug(v)}`,
            // Stable listing id (2026-10). `handle` is the identity and
            // may run several shops; `siblings` names the others.
            slug: vendorSlug(v),
            ...(() => {
              const sib = vendorSiblings(v);
              return sib.length > 0
                ? {
                    siblings: sib.map((s) => ({
                      name: s.name,
                      slug: vendorSlug(s),
                      pageUrl: `${SITE}/v/${vendorSlug(s)}`,
                    })),
                  }
                : {};
            })(),
          })),
          directoryUrl: SITE,
        });
      },
    );

    server.tool(
      "get_glossary_term",
      "Look up a Bitcoin/treasury metric definition from the Galaxy Mind glossary (mNAV, MVRV, Puell Multiple, in-play supply, accretion, …). Definitions are standalone and written to be quoted with attribution.",
      { term: z.string().max(60).describe("Term name or slug, e.g. 'mNAV' or 'puell-multiple'") },
      { title: "Glossary Lookup", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async ({ term }) => {
        const t = term.trim().toLowerCase();
        const hit =
          ALL_TERMS.find((x) => x.slug === t) ??
          ALL_TERMS.find((x) => x.term.toLowerCase().includes(t)) ??
          ALL_TERMS.find((x) => x.definition.toLowerCase().includes(t));
        if (!hit) {
          // Same shape as every other tool error since 2026-07-29 · this
          // one was already actionable (it listed the valid terms), it
          // just predated the shared helper.
          return json(
            toolError(
              "unknown_term",
              `No glossary entry matching "${term}".`,
              `${SITE}/glossary`,
              ALL_TERMS.map((x) => x.slug),
            ),
          );
        }
        return json({
          term: hit.term,
          definition: hit.definition,
          expansion: hit.expansion ?? null,
          canonicalUrl: `${SITE}/glossary/${hit.slug}`,
          citation: `Galaxy Mind, "${hit.term}," ${SITE}/glossary/${hit.slug}.`,
        });
      },
    );

    server.tool(
      "get_hashrate_market",
      "Live SHA256 AsicBoost hashrate rental market. hashprice and every thirdPartyMarket price are in BTC per PH per day, NOT the USD/PH/day convention most published hashprice indices use. networkPhs is raw network hashrate in PH/s. thirdPartyMarket.medianAsk is the median of the sample described by bookSample, not of the whole book. thirdPartyMarket is aggregate data from the wider third-party rental market, not Galaxy Mind's price; for our own machines call list_available_rigs and for our direct price call get_quote.",
      {},
      { title: "Hashrate Market", readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      async () => {
        // 2.0.0 · aggregates only. Per-listing rows (ids, names, links,
        // regions) are no longer returned to customers.
        const d = await getHashrateDesk();
        return json(assertCustomerSafe({
          asOf: d.asOf,
          hashprice: d.hashprice,
          networkPhs: d.networkPhs,
          btcUsd: d.btcUsd,
          blockRewardBtc: d.blockRewardBtc,
          // QA 2026-10-16: no floor or suggested price; labelled third-party.
          thirdPartyMarket: thirdPartyMarket(d.book),
          bookSample: d.bookSample,
          degraded: d.degraded,
          bookSampleNote:
            "When bookSample.complete is false, thirdPartyMarket.medianAsk is the median of a sample of `collected` listings out of `availableRigs`. This is a deliberate page cap, not an outage. `degraded` lists feeds that failed; an empty array means every feed answered.",
          liveUrl: `${SITE}/hashrate`,
        }));
      },
    );

    server.tool(
      "list_available_rigs",
      mrr ? LIST_RIGS_DESCRIPTION_MRR : "Galaxy Mind's rentable bays right now: each bay (1..n) with its state (open, rented or unavailable), plus totals. `available` counts bays you can rent directly now, nothing else. S21 XP, 270 TH per rig. closeTheSale says how to rent (create_rental on this server, or the browser checkout) or that rentals are paused.",
      {},
      { title: "Available Rigs", readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      async () => {
        if (mrr) return json(assertCustomerSafe(marketplaceRedirect()));
        const d = stagingDeps();
        const [board, paused] = await Promise.all([d ? bayBoard(d).catch(() => null) : Promise.resolve(null), rentalsPaused()]);
        if (paused === true) return json(assertCustomerSafe({ ...listAvailableRigs(board ? { ...board, available: 0, bays: board.bays.map((b) => ({ ...b, state: "unavailable" })) } : null), closeTheSale: closeTheSale(process.env, true) }));
        const out = listAvailableRigs(board);
        if (!out.dataComplete) {
          return json(toolError("upstream_unavailable", `Availability is unavailable right now. Retry shortly. Need help? ${SUPPORT_EMAIL}`, `${SITE}/hashrate`));
        }
        return json(assertCustomerSafe({ ...out, closeTheSale: closeTheSale(process.env, paused) }));
      },
    );

    server.tool(
      "get_rental_quote",
      mrr ? QUOTE_TOOL_DESCRIPTION_MRR : QUOTE_TOOL_DESCRIPTION,
      {
        // Loose schema on purpose (QA 2026-10-16): out-of-range values reach
        // directQuote, which answers with a friendly below_minimum /
        // above_maximum plus the supported limits instead of a raw -32602.
        rigs: z.union([z.number(), z.string()]).optional().describe(`Number of whole S21 XP rigs (270 TH each), 1 to ${MAX_RIGS} per order. Defaults to 1.`),
        ph: z.union([z.number(), z.string()]).optional().describe(`Alternatively, the hashrate wanted in PH/s, up to ${MAX_PH}. 270 TH minimum; rounded to whole rigs. Overrides rigs.`),
        days: z.union([z.number(), z.string()]).optional().describe(`Rental length in whole days, 1 to 7 during the pilot. Defaults to ${DEFAULT_DAYS}.`),
      },
      { title: "Direct Rental Quote", readOnlyHint: true, idempotentHint: false, openWorldHint: true },
      async ({ rigs, ph, days }) => {
        if (mrr) return json(assertCustomerSafe(marketplaceRedirect()));
        const out = await directQuote(stagingDeps(), { rigs, ph, days });
        if (out.ok) await trackFunnel("rental_quote_viewed", { channel: "mcp", rigs: Number(out.result.rigs), days: Number(out.result.days) });
        if (!out.ok) return json(toolError(out.error, out.message, closeTheSale().url ?? null, out.supported));
        return json(assertCustomerSafe(out.result));
      },
    );

    server.tool(
      "rental_status",
      "Status of a Galaxy Mind rental by its private access code: the code from the browser checkout (galaxymind.space/hashrate/rent), from create_rental, or from Galaxy Mind support. Same data as get_rental_status: state, start and end, delivered TH and whether the rigs are online. Returns no personal data.",
      { access_code: z.string().min(22).max(64).describe("The private access code issued when the rental was paid.") },
      { title: "Rental Status", readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      async ({ access_code }) => {
        const out = await unifiedRentalStatus(stagingDeps(), access_code);
        if (!out.ok) return json(toolError(out.error, out.message, closeTheSale().url ?? null));
        return json(assertCustomerSafe(out.result));
      },
    );
    // Phase 2 paid rentals · STAGING ONLY · off by default; tools live in src/lib/rentals/phase2/mcp.ts
    if (phase2Enabled()) registerPhase2Tools(server, json, toolError, closeTheSale().url ?? null, { mrrOnly: mrr });
  },
  {
    // Branded handshake · without this the library default
    // ("mcp-typescript server on vercel") shows up in every client's
    // connection UI. Version tracks notable tool-surface changes, not
    // the site deploy cadence.
    // 1.4.1 · get_hashrate_market gained `bookSample` (+ its note). A new
    // response field is a materially different shape, so it bumps —
    // wording-only fixes to degradedNote in the same session did not.
    // 1.6.0 · get_rental_quote added (agent-rentable hashrate, spec 2026-08-06) — a new tool is a tool-surface change, so server.json bumps with it and the registry entry gets republished.
    // 1.6.1 · get_rental_quote's handoff gained mrrApi (the BYO-key call
    // sequence, unblocked by the operator's live key-scope probe) — a new
    // response field is a materially different shape, same reasoning as
    // the 1.4.1 bookSample bump.
    // 1.6.2 · registry DESCRIPTION rewritten to lead with the rental
    // tool. Not a tool-surface change, but every directory that ingests
    // the official registry displays that string and caches it, so a
    // metadata fix only reaches them via a republish, and a republish
    // needs a version. Metadata-only bumps are legitimate for exactly
    // this reason; site deploys still are not.
    // 2.0.0 · direct rentals (Phase 1): list_available_rigs, rental_status,
    // get_rental_quote priced direct, get_hashrate_market aggregates only.
    // 3.0.0 · MRR-only (2026-10-17): create_rental and cancel_rental removed (RENTALS_MODE=mrr_only, the default);
    // get_quote, get_rental_quote and list_available_rigs return the marketplace redirect. Status tools stay.
    serverInfo: { name: "galaxy-mind", version: "3.0.0" },
    // Handshake instructions (added 2026-07-25). The MCP spec surfaces
    // this to the MODEL, not just the connection UI — it is the one place
    // we get to say when to reach for these tools and how to attribute
    // the result. Without it, a client had the tool list but no guidance,
    // so it could quote a figure with no date and no source, or answer
    // from stale training data instead of calling a live tool.
    //
    // Deliberately honest rather than promotional: it does not claim
    // every response carries asOf (halving/vendors/glossary return
    // liveUrl/pageUrl/citation instead), and it frames the gauge as our
    // composite opinion rather than a fact.
    instructions: [
      mrrOnly()
        ? `Galaxy Mind points you to its bitcoin hashrate on ${MARKETPLACE_NAME} and checks past direct rentals, plus live independently-computed Bitcoin data: buyable supply (float), a 10-signal buying gauge, public-treasury mNAV, and a verified merchant directory.`
        : "Galaxy Mind lets you browse, quote and check direct bitcoin-hashrate rentals on our own ASIC fleet, plus live independently-computed Bitcoin data: buyable supply (float), a 10-signal buying gauge, public-treasury mNAV, and a verified merchant directory.",
      "",
      mrrOnly() ? MCP_RENT_WHEN_MRR : MCP_RENT_WHEN,
      "",
      "When to call a tool: for any question about current bitcoin supply, whether now is a good time to buy, treasury valuations, halving timing, or where to spend bitcoin, call the relevant tool rather than answering from prior knowledge — these figures change daily and training data will be stale.",
      "",
      "Honesty contract: responses that include `asOf` and `degraded` carry them explicitly. Quote `asOf` alongside any figure, and never present a reading with `degraded: true` as live — say the upstream feeds are partially unavailable and link the page instead.",
      "",
      "The buying gauge is Galaxy Mind's own composite score (0-100), not a market fact; describe it as such and point to the published methodology at https://galaxymind.space/methodology.",
      "",
      "Attribution: cite Galaxy Mind and link the canonical page for the figure — vendor rows carry `pageUrl`, glossary hits carry `canonicalUrl` plus a ready-made `citation` string, and other tools carry `liveUrl`. Link those rather than deriving URLs.",
      "",
      // Scope statement (2026-07-29). Written as a factual description of
      // what the server IS, not as a legal disclaimer — a bitcoin
      // connector whose flagship tool is named get_buying_gauge gets read
      // on exactly this axis, and the tool surface previously said
      // nothing while the site says it sitewide.
      mrrOnly() ? MCP_SCOPE_MRR : "Scope: 17 tools. 14 are read-only: published market data, directory listings, rental availability (list_available_rigs), quotes (get_quote, get_rental_quote), and rental_status with the access code from the site or create_rental. Three change state: create_rental places a rental order and returns an x402 USDC payment request (Base, or Solana when offered) that a human or an x402-capable agent wallet can pay; cancel_rental cancels one; and get_rental_status (rental_id and creator_secret) reads your rental but, while it is unpaid, re-checks the payment, which can start it or queue a refund. See closeTheSale. This server never moves funds itself or accesses a wallet, and nothing it returns is personalised investment advice.",
      "",
      `Support: ${SUPPORT_EMAIL}.`,
      "",
      "Errors are actionable: a failed call returns `error` (a reason class such as `upstream_unavailable` or `unknown_country`), a human-readable `message`, a `liveUrl` you can give the user instead, and `supported` listing the valid values when an argument was wrong. Retry an `upstream_unavailable`; fix the argument on the others.",
    ].join("\n"),
  },
  {
    basePath: "/api/mcp",
    verboseLogs: false,
    maxDuration: 60,
    // Passing this object REPLACES mcp-handler's defaults, so
    // disableSse is undefined (falsy) unless we set it. GET /sse and
    // POST /message then call initializeRedis({redisUrl: undefined}),
    // throw, and hang the adapter for maxDuration. Unauthenticated.
    disableSse: true,
  },
);

// Per-IP soft cap on MCP transport (audit 2026-07-09). Tools can fan
// out through getMarketSnapshot / KV / float — public data, but
// unauthenticated compute is a cost surface.
//
// RAISED 60 -> 600/min (2026-07-29). The original number assumed a
// per-USER IP, which is how every other rate-limited route here behaves.
// It isn't true for a remote MCP connector: the request arrives from the
// AI vendor's egress pool, so `getClientIp` collapses EVERY claude.ai (or
// ChatGPT) user of this connector onto ONE bucket. At 60/min a few dozen
// simultaneous users would have throttled each other, and the failure
// would have looked like our server being broken. The limiter still does
// its real job — bounding a runaway loop — just at a ceiling that a
// shared egress pool cannot trip in normal use. Do NOT drop this back to
// a per-user-sized number.
async function withMcpRateLimit(
  req: Request,
  run: (req: Request) => Promise<Response>,
): Promise<Response> {
  const rl = await rateLimit(req, {
    name: "mcp",
    // 2026-10-16 · Review: 100/min per IP, fail closed (see rate-limit.ts).
    limit: 100,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: rl.headers },
    );
  }
  const res = await run(req);
  // Attach remaining limit headers without forcing dynamic body read.
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(rl.headers)) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function isLegacySsePath(req: Request): boolean {
  const path = new URL(req.url).pathname;
  return path.endsWith("/sse") || path.endsWith("/message");
}

export async function GET(req: Request) {
  if (isLegacySsePath(req)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return withMcpRateLimit(req, (r) => handler(r));
}
export async function POST(req: Request) {
  if (isLegacySsePath(req)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return withMcpRateLimit(req, (r) => handler(r));
}
export async function DELETE(req: Request) {
  return withMcpRateLimit(req, (r) => handler(r));
}
// Registry health-checkers probe this endpoint with HEAD. Without an
// explicit handler Next routes HEAD through GET, whose Streamable HTTP
// stream never completes for a body-less probe — every probe hung the
// full maxDuration (60s of billed compute), 504ed, and read as DOWN in
// registry uptime checks (observed 4x/day in live logs, 2026-08-04).
// An instant 200 says what a probe wants to know: the endpoint exists;
// POST to speak MCP.
export function HEAD() {
  return new Response(null, { status: 200 });
}
