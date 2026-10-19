// /docs/api · human-readable documentation for the public JSON/CSV/SVG
// endpoints. The endpoints have existed (CORS-open, advertised inside
// Dataset JSON-LD distribution[] entries) but nothing documented
// parameters or shapes for humans · this page turns silent endpoints
// into a linkable developer surface, and gives AI agents reading
// llms.txt a canonical "how to query us" reference (2026-06-10).
//
// Static server component · zero data fetches. The example shapes are
// illustrative prose, not live data, so the page never goes stale on
// market moves; the live endpoints themselves are one click away.

import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { STALE_THRESHOLD_DAYS, VENDOR_BADGE } from "@/lib/vendors";
import { pageOgImage } from "@/lib/og";

const TITLE = "Public API + MCP Server · Galaxy Mind";
// 157 chars · Ahrefs flags meta descriptions >160 (2026-06-11 crawl
// caught the previous 185-char version).
const DESCRIPTION =
  "Free JSON, CSV, and SVG endpoints plus a remote MCP server for the Bitcoin Buying Gauge, treasury mNAVs, BTC float, and vendor directory. No auth, no API key.";
const URL = "https://galaxymind.space/docs/api";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { type: "website", url: URL, title: TITLE, description: DESCRIPTION, siteName: "Galaxy Mind", images: pageOgImage("/docs/api/opengraph-image", TITLE) },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, creator: "@GalaxyMind" },
  alternates: { canonical: URL },
};

type Endpoint = {
  method: string;
  path: string;
  what: string;
  params?: { name: string; desc: string }[];
  notes?: string;
  example: string;
};

const ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/api/stack",
    what: "Current Buying Gauge verdict · 0-100 score, tier, all 10 weighted signals, 7-day forecast.",
    notes:
      "Includes top-level `degraded: true` when ≥4 of the 8 weight-bearing market signals are unavailable upstream · treat the verdict as best-effort neutral, not a live reading. Cached ~2 min.",
    example: "curl -s https://galaxymind.space/api/stack",
  },
  {
    method: "GET",
    path: "/api/stack/history",
    what: "Daily gauge score history, oldest-first.",
    params: [
      { name: "days", desc: "30 · 90 (default) · 180 · 365" },
      { name: "format", desc: "csv for a date,score,tier spreadsheet · omit for JSON" },
    ],
    example: "curl -s 'https://galaxymind.space/api/stack/history?days=90&format=csv'",
  },
  {
    method: "GET",
    path: "/api/treasuries",
    what: "Live mNAV scoreboard for MSTR, XXI, MPJPY, ASST · price, market cap, BTC holdings, mNAV, premium %, interpretation. Includes the same `degraded` flag.",
    example: "curl -s https://galaxymind.space/api/treasuries",
  },
  {
    method: "GET",
    path: "/api/treasuries/history",
    what: "Per-ticker daily mNAV history, oldest-first.",
    params: [
      { name: "ticker", desc: "required · MSTR | XXI | MPJPY | ASST" },
      { name: "days", desc: "30 · 90 (default) · 180 · 365" },
      { name: "format", desc: "csv for date,mNAV,price,btcHoldings,marketCapM,btcPrice · omit for JSON" },
    ],
    example:
      "curl -s 'https://galaxymind.space/api/treasuries/history?ticker=MSTR&days=90&format=csv'",
  },
  {
    method: "GET",
    path: "/api/float",
    what: "Current Bitcoin float snapshot + daily history · in-play supply, cohort allocation (lost / governments / ETFs / treasuries / yet-to-mine), block height. `degraded: true` means a fallback or partial snapshot.",
    example: "curl -s https://galaxymind.space/api/float",
  },
  {
    method: "GET",
    path: "/api/hashrate",
    what: "The Hashrate Desk · the derived network hashprice, network hashrate, BTC spot (btcUsd), the current block reward (blockRewardBtc), and outside SHA256 market aggregates.",
    notes:
      "All prices are BTC per PH per day · not the USD/PH/day convention published hashprice indices use. Market aggregates are outside data, not Galaxy Mind's price; for our direct price use /api/hashrate/quote. `ourRigs` lists our machines as bay aliases only, and `rentalTerm` gives the 1 to 30 whole-day term. `degraded[]` names any feed that failed.",
    example: "curl -s https://galaxymind.space/api/hashrate",
  },
  {
    method: "GET",
    path: "/api/hashrate/quote",
    what: "Direct rental quote from Galaxy Mind · S21 XP hashrate in BTC per PH per day at today's published price, never below our floor. Same numbers as the MCP tool get_rental_quote.",
    params: [
      { name: "rigs", desc: "whole S21 XP rigs, 1 to 4 · default 1" },
      { name: "ph", desc: "PH/s up to 1.08, rounded to whole rigs · overrides rigs" },
      { name: "days", desc: "whole days, 1 to 30 · default 1" },
    ],
    notes:
      "270 TH minimum in whole-rig steps. Quotes are valid 15 minutes and indicative only; this endpoint cannot rent and takes no payment. Aggregate only, no per-machine data. Out-of-range input returns a 400 with the supported limits; a missing or stale daily price returns 503 pricing_unavailable.",
    example: "curl -s 'https://galaxymind.space/api/hashrate/quote?rigs=2&days=3'",
  },
  {
    method: "GET",
    path: "/api/market",
    what: "The raw market snapshot the engines run on · BTC spot, realized vol, MVRV, Puell, funding rate, Fear & Greed, treasury quotes. Null fields mean that upstream is down (never fabricated).",
    example: "curl -s https://galaxymind.space/api/market",
  },
  {
    method: "GET",
    path: "/api/vendors.json",
    what: "The vendor directory as JSON · every active vendor with slug, handle, platform, category, country, description (plus siblings when one handle runs several shops).",
    params: [
      { name: "category", desc: "apparel | hardware | consumables | collectibles | services | books" },
      { name: "country", desc: "ISO-3166 alpha-2, e.g. DE" },
      { name: "platform", desc: "x | nostr | lightning" },
      { name: "since", desc: "YYYY-MM-DD · only vendors verified on/after this date" },
      { name: "limit", desc: "max 200" },
    ],
    notes:
      "Composable · ?category=consumables&country=DE returns the intersection. Each vendor " +
      "carries both `listedAt` (day first listed, unix seconds UTC midnight · immutable, " +
      "unaffected by re-verification) and `verifiedAt` (unix seconds UTC midnight of the last " +
      "human re-confirmation that the vendor still accepts bitcoin — this is what `since` " +
      "filters on and what staleness is measured against).",
    example: "curl -s 'https://galaxymind.space/api/vendors.json?country=DE'",
  },
  {
    method: "GET",
    path: "/api/heartbeat",
    what: "Tiny health payload · current score, tier, BTC price, degraded flag. Built for embeds and uptime checks; CDN-cached.",
    example: "curl -s https://galaxymind.space/api/heartbeat",
  },
  {
    method: "GET",
    path: "/api/badge/gauge",
    what: "Live SVG badge of the current gauge score + tier · drop it in a README or forum post and it stays current.",
    notes: 'Embed: <img src="https://galaxymind.space/api/badge/gauge" alt="Bitcoin buying gauge" />',
    example: "curl -s https://galaxymind.space/api/badge/gauge",
  },
  {
    // The vendor badge is the directory's backlink flywheel but had no
    // row here — a listed merchant reading these docs had no way to find
    // the thing they are meant to embed (2026-07-29).
    method: "GET",
    path: "/api/badge/vendor/{slug}",
    what: `Live SVG badge a listed merchant can put on their own site. Reads “${VENDOR_BADGE.label} · ${VENDOR_BADGE.live}” and flips to amber “${VENDOR_BADGE.stale}” once the ${STALE_THRESHOLD_DAYS}-day window lapses, so it can never show a stale green.`,
    notes:
      `Embed: <a href="https://galaxymind.space/v/{slug}"><img src="https://galaxymind.space/api/badge/vendor/{slug}" alt="${VENDOR_BADGE.alt}" /></a>`,
    example: "curl -s https://galaxymind.space/api/badge/vendor/soap-miner",
  },
  {
    method: "GET",
    path: "/feed.xml",
    what: "RSS feed of newly added vendors.",
    example: "curl -s https://galaxymind.space/feed.xml",
  },
  {
    method: "GET",
    path: "/feed-gauge.xml",
    what: "RSS feed of the daily Buying Gauge verdict · follow the score without an email address. Each item links a frozen shareable verdict URL.",
    example: "curl -s https://galaxymind.space/feed-gauge.xml",
  },
];

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen flex-1 text-[var(--text-primary)] pb-16">
      <SiteHeader />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-10">
        <div className="micro-label text-[var(--text-tertiary)] mb-2">
          Developers · Researchers · Agents
        </div>
        <h1 className="text-3xl tracking-tight">Public API</h1>
        <p className="mt-3 text-sm sm:text-base text-[var(--text-secondary)] font-sans leading-relaxed max-w-2xl">
          Every number on this site is queryable. No auth, no API key,
          free. Browser-side (cross-origin) fetches work on the gauge,
          float, heartbeat, status, vendor and OpenAPI endpoints;{" "}
          <code className="text-[var(--accent-ink)]">/api/market</code> and{" "}
          <code className="text-[var(--accent-ink)]">/api/treasuries</code>{" "}
          are server-side reads. Data follows a strict no-fabrication rule: when
          an upstream source is down you get{" "}
          <code className="text-[var(--accent-ink)]">null</code> fields and a{" "}
          <code className="text-[var(--accent-ink)]">degraded</code> flag, never{" "}
          invented values. Please cache on your side where you can · the
          endpoints are CDN-cached between 2 and 30 minutes. Using an AI
          assistant? There&rsquo;s also a{" "}
          <a href="#mcp" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
            remote MCP server
          </a>{" "}
          below.
        </p>

        <div className="mt-8 space-y-4">
          {ENDPOINTS.map((e) => (
            <section
              key={e.path}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
            >
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <span className="px-2 py-0.5 rounded border border-[var(--accent)]/40 text-[var(--accent-ink)] t-xs uppercase tracking-widest">
                  {e.method}
                </span>
                <code className="text-sm sm:text-base text-[var(--text-primary)] font-semibold">
                  {e.path}
                </code>
              </div>
              <p className="mt-2.5 t-xs text-[var(--text-secondary)] font-sans leading-relaxed">
                {e.what}
              </p>
              {e.params && (
                <table className="mt-3 w-full text-left t-xs">
                  <tbody>
                    {e.params.map((p) => (
                      <tr key={p.name} className="align-top">
                        <td className="pr-4 py-1 text-[var(--accent-ink)] whitespace-nowrap">
                          {p.name}
                        </td>
                        <td className="py-1 text-[var(--text-tertiary)] font-sans">
                          {p.desc}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {e.notes && (
                <p className="mt-2 t-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
                  {e.notes}
                </p>
              )}
              <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--bg-elevated-2)] px-3 py-2.5 t-xs text-[#7ec0ff]">
                {e.example}
              </pre>
            </section>
          ))}
        </div>

        {/* MCP server · the agent-native way in. Same data as the REST
            endpoints above, but exposed as typed tools over the Model
            Context Protocol so Claude / ChatGPT / Cursor users can wire
            the site up once and query it conversationally. Read-only by
            construction · every tool reuses the same lib functions the
            pages render from, so there is nothing to authenticate. */}
        <section
          id="mcp"
          className="mt-10 scroll-mt-20 rounded-xl border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-5"
        >
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <span className="px-2 py-0.5 rounded border border-[var(--accent)]/40 text-[var(--accent-ink)] t-xs uppercase tracking-widest">
              MCP
            </span>
            <code className="text-sm sm:text-base text-[var(--text-primary)] font-semibold">
              https://galaxymind.space/api/mcp/mcp
            </code>
          </div>
          <p className="mt-2.5 t-xs text-[var(--text-secondary)] font-sans leading-relaxed">
            A remote MCP server (Streamable HTTP, no auth) that exposes the
            site as 11 read-only tools any MCP-capable assistant can call:
            the live Bitcoin spot price, the Buying Gauge with all 10
            signals, gauge history, treasury mNAVs + per-ticker history,
            the Bitcoin float breakdown, the hashrate rental market, the
            halving countdown, vendor-directory search, glossary
            definitions, and live rental quotes for our own mining fleet.
            Same no-fabrication rule as the REST API · degraded data says
            so.
          </p>
          <table className="mt-3 w-full text-left t-xs">
            <tbody>
              <tr className="align-top">
                <td className="pr-4 py-1 text-[var(--accent-ink)] whitespace-nowrap">Claude Code</td>
                <td className="py-1 text-[var(--text-tertiary)] font-sans">
                  <code className="text-[#7ec0ff]">claude mcp add --transport http galaxy-mind https://galaxymind.space/api/mcp/mcp</code>
                </td>
              </tr>
              <tr className="align-top">
                <td className="pr-4 py-1 text-[var(--accent-ink)] whitespace-nowrap">Claude.ai</td>
                <td className="py-1 text-[var(--text-tertiary)] font-sans">
                  Settings → Connectors → Add custom connector → paste the URL above
                </td>
              </tr>
              <tr className="align-top">
                <td className="pr-4 py-1 text-[var(--accent-ink)] whitespace-nowrap">ChatGPT</td>
                <td className="py-1 text-[var(--text-tertiary)] font-sans">
                  Settings → Connectors → Advanced → Developer mode → add the URL above (no auth)
                </td>
              </tr>
              <tr className="align-top">
                <td className="pr-4 py-1 text-[var(--accent-ink)] whitespace-nowrap">Cursor / others</td>
                <td className="py-1 text-[var(--text-tertiary)] font-sans">
                  Any client supporting remote Streamable-HTTP servers · type{" "}
                  <code className="text-[#7ec0ff]">http</code>, URL as above
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 t-xs text-[var(--text-tertiary)] font-sans leading-relaxed">
            Then ask things like &ldquo;is it a good time to buy bitcoin
            according to Galaxy Mind?&rdquo; or &ldquo;which bitcoin
            treasury is cheapest right now?&rdquo; and the assistant pulls
            live numbers instead of guessing.
          </p>
        </section>

        <section className="mt-10 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <h2 className="font-mono text-sm uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-3">
            Ground rules
          </h2>
          <ul className="space-y-2 t-xs text-[var(--text-secondary)] font-sans leading-relaxed list-disc pl-5">
            <li>
              Attribution appreciated: link to galaxymind.space when you
              publish derived work. Citation format lives on each data page.
            </li>
            <li>
              Methodology for every metric is public · see{" "}
              <a href="/methodology" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
                /methodology
              </a>{" "}
              and{" "}
              <a href="/glossary" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
                /glossary
              </a>
              .
            </li>
            <li>
              Machine-readable site map for agents:{" "}
              <a href="/llms.txt" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
                /llms.txt
              </a>
              .
            </li>
            <li>
              Want the gauge ON your site? The{" "}
              <a href="/embed" className="text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40 hover:decoration-[var(--accent-ink)]">
                embed widget
              </a>{" "}
              is a one-line script tag.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
