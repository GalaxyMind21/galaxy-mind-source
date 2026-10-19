import type { MetadataRoute } from "next";
import { CATEGORY_LABELS, COUNTRIES, VENDORS, countrySlug, vendorSlug } from "@/lib/vendors";
import { TARGET_TICKERS } from "@/lib/market";
import { OVERVALUED_CONFIG } from "@/lib/overvalued";
import { ALL_TERMS } from "@/lib/glossary";
import { LETTERS } from "@/lib/letters";
import { TN_URL } from "@/lib/state-guide-copy";

// Public crawlable pages. Tools (homepage, /fit, /stack, /treasuries)
// get priority 1.0 / 0.8; supporting pages (about, faq, embed) get
// 0.6; per-vendor pages (/v/[slug]) get 0.5 each but contribute the
// bulk of indexable URLs (54+ pages, one per vendor). /vendors used
// to live at its own route but now 308-redirects to /, so it doesn't
// need its own entry. Internal preview routes like
// /stack/skeleton-preview are robots:noindex'd and intentionally
// omitted.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  // Stable content-version date for EVERGREEN pages (tools, education,
  // glossary, hubs). Bump when their content materially changes. Using
  // request-time `now` for these churned lastmod on every deploy, which
  // trains Google to distrust the freshness signal across the whole
  // sitemap. `now` stays only on entries whose content genuinely changes
  // daily (catalyst verdicts, per-treasury, overvalued, feeds, status);
  // per-vendor pages use their own verifiedAt.
  const EVERGREEN = new Date("2026-06-18");
  // Surfaces launched AFTER the EVERGREEN stamp get their launch date
  // instead — a page claiming lastmod before it existed is exactly the
  // freshness-signal dishonesty the note above warns about, and it
  // deprioritizes crawl of the brand-new URLs that most need fast
  // discovery (audit 2026-07-12). Bump when content materially changes.
  const vendorEntries: MetadataRoute.Sitemap = VENDORS.map((v) => ({
    url: `https://galaxymind.space/v/${vendorSlug(v)}`,
    // Use the vendor's verifiedAt as lastModified · gives Google a
    // genuine freshness signal per page. Older verifiedAt = lower
    // priority for re-crawl, which is correct.
    lastModified: new Date(v.verifiedAt * 1000),
    changeFrequency: "monthly",
    priority: 0.5,
  }));
  return [
    {
      url: "https://galaxymind.space",
      lastModified: EVERGREEN,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: "https://galaxymind.space/fit",
      lastModified: EVERGREEN,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: "https://galaxymind.space/stack",
      lastModified: EVERGREEN,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: "https://galaxymind.space/treasuries",
      lastModified: EVERGREEN,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      // /float was missing from the sitemap entirely (found during the
      // 2026-06-29 Supply Clock rebuild recon) · same tool-tier entry
      // as /stack and /treasuries.
      url: "https://galaxymind.space/float",
      lastModified: EVERGREEN,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      // /hashrate · The Hashrate Desk (2026-08-02) · live SHA256 rental
      // market + recovery ratio. Same tool-tier entry as /stack, /treasuries,
      // /float.
      // lastmod 2026-10-17: MRR-only funnel, SEO copy and FAQ pass.
      url: "https://galaxymind.space/hashrate",
      lastModified: new Date("2026-10-17"),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      // /hashrate/agents · the agent-onboarding surface for Block Shot
      // (2026-08-06) · crawlable twin of get_rental_quote / /api/hashrate/quote.
      // One notch below /hashrate itself.
      url: "https://galaxymind.space/hashrate/agents",
      lastModified: new Date("2026-08-06"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      // /hashrate/how-to-rent · the step-by-step rental walkthrough
      // (2026-08-08). Static prose, so evergreen cadence.
      url: "https://galaxymind.space/hashrate/how-to-rent",
      lastModified: new Date("2026-08-31"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // /hashrate/antminer-s21-xp · model page for the machine behind the
      // 270 TH/s chunks (2026-10-18). Live odds, so weekly cadence.
      url: "https://galaxymind.space/hashrate/antminer-s21-xp",
      lastModified: new Date("2026-10-18"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      // /solo-mining-calculator · odds-calculator pSEO page (2026-08-04)
      // feeding the desk. Live numbers, so weekly cadence like the desk.
      url: "https://galaxymind.space/solo-mining-calculator",
      lastModified: new Date("2026-08-04"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      // /lottery-mining-bitcoin · solo/lottery mining explainer (SEO brief
      // 2026-10-18). Live odds table, so weekly like the calculator.
      url: "https://galaxymind.space/lottery-mining-bitcoin",
      lastModified: new Date("2026-10-18"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      // /how-many-businesses-accept-bitcoin · live stats page (2026-08-04,
      // roadmap item 8) · verification-as-headline applied to a stats query.
      url: "https://galaxymind.space/how-many-businesses-accept-bitcoin",
      lastModified: new Date("2026-08-04"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      // /today · the daily briefing (B3 · 2026-07-07). Daily cadence
      // is the whole premise, so tell crawlers exactly that.
      url: "https://galaxymind.space/today",
      lastModified: new Date("2026-07-07"),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      // /pulse · the Weekly Pulse + archive (2026-07-09). Weekly
      // cadence · the archive grows one entry per week.
      url: "https://galaxymind.space/pulse",
      lastModified: new Date("2026-07-09"),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      // /map · the circular-economy atlas (B8 · 2026-07-07).
      url: "https://galaxymind.space/map",
      lastModified: new Date("2026-08-30"),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      // /gauntlet · the history-replay game (2026-07-08). The tape
      // window slides daily but the page itself is evergreen.
      url: "https://galaxymind.space/gauntlet",
      lastModified: new Date("2026-07-08"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // /runner · the tape arcade, split to its own page 2026-07-08.
      url: "https://galaxymind.space/runner",
      lastModified: new Date("2026-07-08"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // /wen · the daily chart-dating puzzle (cabinet #4 · 2026-07-11).
      url: "https://galaxymind.space/wen",
      lastModified: new Date("2026-07-11"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // /chop · CHOP, the live-block slicer (cabinet #8 · launched 2026-08-04).
      url: "https://galaxymind.space/chop",
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    },
    {
      // /trail · THE HODL TRAIL daily expedition (cabinet #7 · 2026-07-25).
      url: "https://galaxymind.space/trail",
      lastModified: new Date("2026-07-25"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // /arcade · the single hub linking all four games (2026-07-09).
      url: "https://galaxymind.space/arcade",
      lastModified: new Date("2026-07-09"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // /super-saylor · the standalone single-file platformer
      // (2026-07-11). Served from public/ via a rewrite; indexable
      // like any cabinet page. Priority 0.7 to match the sibling
      // cabinets — it is the flagship / biggest hit, so it should not
      // sit below them.
      url: "https://galaxymind.space/super-saylor",
      lastModified: new Date("2026-07-13"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      // /bitcoin-kart · the 3D kart racer cabinet (2026-07-14). Static
      // directory in public/ served via a rewrite, same posture as
      // /super-saylor: indexable, canonical declared in its own head.
      url: "https://galaxymind.space/bitcoin-kart",
      lastModified: new Date("2026-07-14"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      // /michael-saylor-game · pSEO prose landing for the uncontested
      // "michael saylor game" query · a crawler-friendly (no-canvas)
      // ranking target that hands off to the game at /super-saylor.
      url: "https://galaxymind.space/michael-saylor-game",
      lastModified: new Date("2026-07-13"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    // Country landing pages (growth pass 2026-07-08) · one per
    // roster country, derived from the SAME record the routes use so
    // sitemap and pages can never diverge. A country with zero
    // vendors drops out here AND 404s there, in lockstep.
    ...Object.entries(COUNTRIES)
      .filter(([cc]) => VENDORS.some((v) => v.country === cc))
      .map(([, info]) => ({
        url: `https://galaxymind.space/spend-bitcoin-in/${countrySlug(info.label)}`,
        lastModified: new Date("2026-07-08"),
        changeFrequency: "weekly" as const,
        priority: 0.7,
      })),
    {
      // State spending guide (2026-10-18): the July 2026 kiosk ban,
      // hand-checked anchors, BTC Map links, online shops. URL lives in the copy lib.
      url: TN_URL,
      lastModified: new Date("2026-10-18"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    // Category landing pages (growth pass round 2 · 2026-07-09).
    ...Object.keys(CATEGORY_LABELS)
      .filter((cat) => VENDORS.some((v) => v.category === cat))
      .map((cat) => ({
        url: `https://galaxymind.space/spend-bitcoin-on/${cat}`,
        lastModified: new Date("2026-07-09"),
        changeFrequency: "weekly" as const,
        priority: 0.7,
      })),
    {
      // /horizon · scarcity arena mini-game seeded from live /float.
      url: "https://galaxymind.space/horizon",
      lastModified: new Date("2026-07-08"),
      changeFrequency: "monthly",
      priority: 0.55,
    },
    {
      url: "https://galaxymind.space/about",
      lastModified: EVERGREEN,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: "https://galaxymind.space/faq",
      lastModified: EVERGREEN,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: "https://galaxymind.space/privacy",
      lastModified: EVERGREEN,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: "https://galaxymind.space/terms",
      lastModified: EVERGREEN,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: "https://galaxymind.space/embed",
      lastModified: EVERGREEN,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: "https://galaxymind.space/badge",
      lastModified: EVERGREEN,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: "https://galaxymind.space/glossary",
      lastModified: EVERGREEN,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: "https://galaxymind.space/feed.xml",
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      // Daily gauge-verdict RSS (2026-06-10) · the no-email channel.
      url: "https://galaxymind.space/feed-gauge.xml",
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.5,
    },
    // Monthly "Letter from the directory" (2026-10-18): index + one URL
    // per letter, dated by the letter's own modified date.
    {
      url: "https://galaxymind.space/letter",
      lastModified: new Date(LETTERS[0].modified),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    ...LETTERS.map((l) => ({
      url: `https://galaxymind.space/letter/${l.slug}`,
      lastModified: new Date(l.modified),
      changeFrequency: "yearly" as const,
      priority: 0.5,
    })),
    {
      url: "https://galaxymind.space/methodology",
      lastModified: EVERGREEN,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      // Public API documentation · linkable developer surface for the
      // JSON/CSV/SVG endpoints (2026-06-10).
      url: "https://galaxymind.space/docs/api",
      lastModified: EVERGREEN,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: "https://galaxymind.space/submit",
      lastModified: EVERGREEN,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // SEO landing page · narrows / to the 40 Nostr-platform vendors
      // (audit 2026-05-25). Captures long-tail "nostr vendors directory"
      // / "nostr shops accepting bitcoin" queries that /'s broad commerce-
      // intent title doesn't currently target. Weekly changefreq matches
      // / since new Nostr vendors land in the same VENDORS array.
      url: "https://galaxymind.space/nostr-vendors",
      lastModified: EVERGREEN,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      // /nostr-marketplaces · neutral "what is a Nostr marketplace"
      // explainer naming Conduit, Shopstr, Plebeian (competitor lesson A5, 2026-10-18).
      url: "https://galaxymind.space/nostr-marketplaces",
      lastModified: new Date("2026-10-18"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      // /should-i-buy-bitcoin · SEO landing for the highest-volume
      // Bitcoin search query. Single-purpose doorway · embeds the
      // live verdict and drives into /stack for the full tool.
      // Audit 2026-05-28. priority 0.8 = same as /stack since this
      // page IS the search-intent doorway for the buying decision.
      // Daily changefreq because the embedded verdict updates daily.
      url: "https://galaxymind.space/should-i-buy-bitcoin",
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      // /spend-and-replace · the circular-economy rebuttal doorway
      // (2026-06-18). Evergreen educational content · stable lastmod,
      // monthly recrawl.
      url: "https://galaxymind.space/spend-and-replace",
      lastModified: EVERGREEN,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // /how-to-help-grow-bitcoin · broad "how to support bitcoin
      // adoption" doorway (2026-06-18). Evergreen educational content.
      url: "https://galaxymind.space/how-to-help-grow-bitcoin",
      lastModified: EVERGREEN,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // /how-to-accept-bitcoin · merchant-acquisition doorway for the
      // "how to accept bitcoin payments" query (2026-06-20). Evergreen.
      url: "https://galaxymind.space/how-to-accept-bitcoin",
      lastModified: new Date("2026-10-18"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // /how-to-buy-bitcoin · beginner buying guide with a short reading
      // list (2026-10-18). Evergreen.
      url: "https://galaxymind.space/how-to-buy-bitcoin",
      lastModified: new Date("2026-10-18"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // /learn · the hub behind the "Learn" nav group (SEO desk idea 14,
      // 2026-10-18). It indexes the guides, so it ranks with them.
      url: "https://galaxymind.space/learn",
      lastModified: new Date("2026-10-18"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // /how-to-pay-with-lightning · shopper guide "No bitcoin yet? You can
      // still pay." (competitor teardown lesson A2, 2026-10-18). Evergreen.
      url: "https://galaxymind.space/how-to-pay-with-lightning",
      lastModified: new Date("2026-10-18"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // /spend-bitcoin-in-latin-america · LATAM research page (2026-08-23).
      url: "https://galaxymind.space/spend-bitcoin-in-latin-america",
      lastModified: new Date("2026-08-23"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      // Spanish twin is self-canonical (hreflang cluster with EN).
      url: "https://galaxymind.space/es/spend-bitcoin-in-latin-america",
      lastModified: new Date("2026-08-23"),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      // /spend-bitcoin-on · the category INDEX above the per-category
      // hubs (2026-08-30). One crawlable door to all six facets; the
      // hubs themselves are generated below from CATEGORY_ORDER, so
      // index and hubs can never diverge.
      url: "https://galaxymind.space/spend-bitcoin-on",
      lastModified: new Date("2026-08-30"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      // /online-stores-that-accept-bitcoin · THE money page for the
      // core spend-intent query family (SEO sprint 2026-07-21). Renders
      // the live roster, so weekly recrawl matches real change cadence.
      // Priority 0.8 · same tier as /should-i-buy-bitcoin, the other
      // search-intent doorway for a head query.
      url: "https://galaxymind.space/online-stores-that-accept-bitcoin",
      lastModified: new Date("2026-08-30"),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      // /buy-coffee-with-bitcoin · question-page capture for the
      // weakest product long-tail SERP found in the 2026-07 research.
      url: "https://galaxymind.space/buy-coffee-with-bitcoin",
      lastModified: new Date("2026-08-30"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      // /state-of-bitcoin-directories · the liveness-checked landscape
      // comparison · linkable asset for the broken-link outreach.
      url: "https://galaxymind.space/state-of-bitcoin-directories",
      lastModified: new Date("2026-07-21"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    // Comparison / decision catalyst pages · each targets a distinct
    // high-intent query the umbrella tool pages can't rank for and
    // embeds a live verdict (mNAV-driven or gauge-driven), so daily
    // changefreq. These were live but previously absent from the
    // sitemap (added 2026-06-01) · /ibit-vs-mstr is new in the same pass.
    {
      // Live halving countdown · catalyst page for the highest-volume
      // evergreen Bitcoin query (2026-06-10). Daily changefreq · the
      // countdown numbers move every day.
      url: "https://galaxymind.space/bitcoin-halving-countdown",
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      // Public data-health page (2026-06-10) · trust surface.
      url: "https://galaxymind.space/status",
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.5,
    },
    // Per-term glossary pages (2026-06-10) · the citable leaves behind
    // the /glossary hub. Driven off ALL_TERMS so a new term in
    // lib/glossary.ts auto-extends the sitemap.
    ...ALL_TERMS.map((t) => ({
      url: `https://galaxymind.space/glossary/${t.slug}`,
      lastModified: EVERGREEN,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    // The /vendors/{facet} hubs (2026-06-10) were consolidated into
    // the /spend-bitcoin-in|on pages above (2026-07-11) · the old URLs
    // 308 via next.config.ts and must NOT appear here (a sitemap
    // should never list redirecting URLs).
    ...[
      "mstr-vs-bitcoin",
      "ibit-vs-mstr",
      "cheapest-bitcoin-treasury",
      "bitcoin-treasuries-below-nav",
      "is-it-too-late-to-buy-bitcoin",
      "what-is-amplification",
      "gross-vs-net-mnav",
      "treasuries/methodology",
      "treasuries/compare",
    ].map((slug) => ({
      url: `https://galaxymind.space/${slug}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    // Per-treasury landing pages · capture ticker-specific queries
    // ("MSTR mNAV", "twenty one capital bitcoin", "metaplanet mNAV")
    // that the /treasuries umbrella can't rank for. Matches Newhedge's
    // proven URL pattern (/bitcoin/treasuries/{ticker}). Audit
    // 2026-05-28 · sprint to capture HIGH-opportunity queries
    // identified in the SEO audit. Daily changefreq because the live
    // mNAV updates throughout the day and Google rewards freshness.
    ...TARGET_TICKERS.map((ticker) => ({
      url: `https://galaxymind.space/treasuries/${ticker}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    // Per-treasury "is {ticker} overvalued?" valuation pages · same
    // depth/value as the per-ticker treasury pages, so same priority.
    // Driven off OVERVALUED_CONFIG so they auto-extend with the set.
    ...Object.values(OVERVALUED_CONFIG).map((cfg) => ({
      url: `https://galaxymind.space/${cfg.slug}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...vendorEntries,
  ];
}
