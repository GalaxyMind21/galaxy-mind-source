import type { MetadataRoute } from "next";

// Robots policy. Three design goals:
//
//   1. Standard crawlers (Googlebot, Bingbot, etc.) index the public
//      surfaces (/, /stack, /fit, /treasuries, /about, /faq, /glossary,
//      /embed) and skip most of /api · the API returns JSON that's not
//      useful in a search result, and crawler hits there waste
//      rate-limit budget on upstream feeds (Yahoo, CoinGecko,
//      Coinmetrics, etc.).
//
//   2. BUT the handful of read-only, edge-cached endpoints that
//      llms.txt advertises as canonical citable data sources
//      (PUBLIC_DATA_ENDPOINTS below) are Allow-listed back in · it's
//      self-defeating to invite AI/search crawlers to cite
//      /api/treasuries in llms.txt and then Disallow the path they'd
//      have to fetch. robots.txt uses longest-match, so the specific
//      Allow entries override the broad "/api/" Disallow for exactly
//      those paths and nothing else under /api (admin, cron, og,
//      subscribe, submit, enrich, …) stays blocked.
//
//   3. AI agent crawlers (GPTBot, ClaudeBot, PerplexityBot,
//      Google-Extended, ChatGPT-User, anthropic-ai, etc.) are
//      explicitly opted-in to the whole public surface, including live
//      /api JSON · agents at inference time benefit from fetching the
//      structured endpoints directly when a user asks "what's the
//      current Buying Gauge". The endpoints are edge-cached (30s-5min)
//      so this doesn't drive extra upstream load. The whole site is
//      structured for direct quotation (DefinedTermSet, Dataset,
//      FAQPage JSON-LD; llms.txt; /glossary anchors) and we WANT to be
//      in their answer surfaces.
//
// Private user-utility pages (/prefs email preferences) are
// Disallowed for EVERY crawler, AI bots included · they're per-user
// surfaces with nothing to index and no reason to surface in an answer.
// robots.txt groups don't inherit (a bot that matches its own
// user-agent uses ONLY that group), so the block is restated in each
// rule rather than relying on the "*" group to cover the named bots.
//
// llms.txt lives at /llms.txt and the AI bots that want it fetch it
// directly · it's a discovery convention, not a sitemap, so it stays
// out of the Sitemap directive (an SEO scanner flagged a non-XML
// Sitemap entry as "wrong format" · audit 2026-05-28).

// Read-only, edge-cached JSON endpoints that public/llms.txt advertises
// as canonical, citable data sources. Kept in lock-step with the
// "## Public API endpoints" section of llms.txt (same order) · if you
// add or rename one there, mirror it here and vice versa so the
// invitation and the crawl policy never drift apart. Everything ELSE
// under /api stays behind the "/api/" Disallow in the rules below.
const PUBLIC_DATA_ENDPOINTS = [
  "/api/stack",
  "/api/treasuries",
  "/api/market",
  "/api/heartbeat",
  "/api/float",
  "/api/float-heartbeat",
  "/api/status",
  "/api/stack/history",
  "/api/treasuries/history",
  "/api/vendors.json",
  // The OpenAPI description itself (2026-07-29). It was advertised in
  // every page's <link rel="service-desc"> and in /docs/api, but was in
  // NEITHER this list nor llms.txt's endpoint section — so the broad
  // "/api/" Disallow blocked generic crawlers from the one file that
  // describes the whole API. Exactly the self-defeating pattern goal 2
  // above warns about, just via a different advertising channel than
  // llms.txt. Named AI bots could always reach it (their own group
  // allows "/"); this fixes it for everyone else.
  "/api/openapi.json",
  // Weekly Pulse archive (2026-07-29) · the JSON twin of /pulse.
  "/api/pulse",
  // Hashrate desk + rental quote (2026-08-22). llms.txt and OpenAPI
  // advertise both; the * group Disallow /api/ was hiding them from
  // Googlebot while named AI bots (Allow /) could already fetch them.
  // Same self-defeating pattern as /api/openapi.json above.
  "/api/hashrate",
  "/api/hashrate/quote",
  // /api/history + /api/subscriber-count (2026-09-09). Both are in
  // llms.txt's Public API endpoints section; the * group Disallow /api/
  // was hiding them from Googlebot while named AI bots (Allow /) could
  // already fetch them. Same self-defeating pattern as /api/hashrate.
  "/api/history",
  "/api/subscriber-count",
];

// Per-user / operator pages with nothing to index · Disallowed for every crawler.
const PRIVATE_PATHS = ["/prefs", "/admin", "/api/admin", "/api/cron"];

// AI agent user-agents we're explicitly inviting. Each company
// publishes their bot UA in their crawler docs; this list is current
// as of May 2026.
const AI_BOTS = [
  // OpenAI
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  // Anthropic
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  // Google AI Overviews / Gemini
  "Google-Extended",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // Common Crawl (training corpus for many models)
  "CCBot",
  // Apple Intelligence
  "Applebot-Extended",
  // Bytedance / TikTok AI
  "Bytespider",
  // You.com / Cohere
  "YouBot",
  "cohere-ai",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Generic crawlers (search engines + any bot without its own group
      // below): the whole public site plus the citable data endpoints,
      // but not the rest of /api and not the private pages. The specific
      // PUBLIC_DATA_ENDPOINTS Allows win over the "/api/" Disallow by
      // longest-match.
      {
        userAgent: "*",
        allow: ["/", ...PUBLIC_DATA_ENDPOINTS],
        disallow: ["/api/", ...PRIVATE_PATHS],
      },
      // Named AI crawlers · the full public surface (including live /api
      // JSON; the canonical citable set is PUBLIC_DATA_ENDPOINTS /
      // llms.txt) minus the private user pages. Each restates the
      // Disallow because groups don't inherit from "*".
      ...AI_BOTS.map((bot) => ({
        userAgent: bot,
        allow: "/",
        disallow: [...PRIVATE_PATHS],
      })),
    ],
    // Only XML sitemaps belong in the Sitemap directive · llms.txt is a
    // different convention (AI bots fetch /llms.txt directly), so it
    // stays out of here.
    sitemap: ["https://galaxymind.space/sitemap.xml"],
    host: "https://galaxymind.space",
  };
}