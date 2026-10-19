import type { NextConfig } from "next";

// Defense-in-depth security headers. Conservative defaults for a static info
// site — no embedding, no MIME sniffing, no leaking referrer to third
// parties on downgrade.
//
// CSP lives in src/proxy.ts (NOT here) so it can carry a per-request
// nonce — that's the modern way to drop 'unsafe-inline' for scripts. The
// static security headers below don't depend on the request and stay here
// because next.config.ts header rules are cheaper than middleware.
const securityHeaders = [
  // HSTS · HTTPS-only enforcement. Vercel injects this by default on
  // verified domains, but we set it explicitly so:
  //   1. The header is present even on Vercel preview URLs (where the
  //      apex-domain default doesn't always apply)
  //   2. We don't depend on platform behavior we can't review in code
  //   3. The value is auditable from this config (max-age, subdomain
  //      coverage, preload eligibility) instead of being implicit
  // 2 years (63072000 s) + includeSubDomains + preload matches the
  // hstspreload.org submission requirements. Don't lower the max-age
  // without a multi-month rollout · once a browser caches HSTS, it
  // refuses to downgrade for the duration regardless of header
  // changes from us.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable browser APIs we don't use. Saves the user's privacy budget if a
  // future dependency ever tries to ask for these.
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=()",
  },
  // COOP=same-origin: pops cross-origin window references on load,
  // blocking Spectre-style cross-origin window leaks. Safe to apply
  // globally — only affects window.opener relationships when our
  // pages are opened from another origin, which we don't depend on.
  //
  // We deliberately do NOT set Cross-Origin-Resource-Policy globally.
  // /embed.js is loaded cross-origin by third-party embedders, and
  // /api/heartbeat, /api/vendors.json, /api/nostr-nip05, /api/og/*,
  // /opengraph-image.tsx, /icon, /apple-icon are all routinely
  // fetched cross-origin (embedders, social-media scrapers, NIP-05
  // verifiers). A blanket CORP=same-origin would break all of these.
  // Per-route CORP can be added later if a specific route needs it.
  //
  // We also do NOT set Cross-Origin-Embedder-Policy. COEP=require-corp
  // would force every cross-origin resource we load (Vercel Analytics,
  // Cloudflare Turnstile, vendor avatar images from any host) to opt
  // in via CORP, which they don't and we can't change. The COOP
  // protection alone is the right trade-off for a site with our
  // cross-origin dependencies.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// Alpha-2 (and common short-form) aliases for the /spend-bitcoin-in
// country hubs (SEO sprint 2026-07-21). The canonical slugs are full
// label-derived names ("united-states"), but the site itself uses
// alpha-2 codes everywhere else (/?country=US, /map?country=XX), so
// hand-typed and guessed short URLs — /spend-bitcoin-in/us hard-404ed
// in the 2026-07 audit — are a predictable inbound shape.
//
// This is a KEPT-IN-SYNC MIRROR of COUNTRIES in src/lib/vendors.ts
// (duplicated because next.config.ts runs before the app bundle),
// NOT a frozen list like the /vendors/{facet} redirects below: every
// new country needs a row here. scripts/check-vendors.ts enforces the
// parity (every COUNTRIES code must have its lowercase alias mapping
// to countrySlug(label)) so a missing row fails `npm run verify`
// instead of silently 404ing the 21st country's short URL.
const COUNTRY_HUB_ALIASES: Record<string, string> = {
  us: "united-states",
  usa: "united-states",
  gb: "united-kingdom",
  uk: "united-kingdom",
  de: "germany",
  za: "south-africa",
  it: "italy",
  fr: "france",
  ch: "switzerland",
  co: "colombia",
  th: "thailand",
  si: "slovenia",
  nz: "new-zealand",
  sv: "el-salvador",
  nl: "netherlands",
  hu: "hungary",
  es: "spain",
  au: "australia",
  ca: "canada",
  at: "austria",
  fi: "finland",
  br: "brazil",
  brasil: "brazil",
  ie: "ireland",
};

const nextConfig: NextConfig = {
  // Next 16.3 `next dev` rewrites the managed block at the top of the README whenever an AI
  // agent runs it and the block's wording differs from the installed version, which left a
  // dirty the README on every dev run. That wording changes between Next releases, so
  // committing the refreshed block would only drift again on the next bump. the README is
  // curated by hand here, so turn the generator off instead (review nit on #99).
  agentRules: false,
  // The opengraph cards are set in Plus Jakarta Sans and read the .ttf files off
  // disk at render time (src/lib/og-bench.tsx). Nothing IMPORTS those
  // files, so the tracer has no reason to keep them and the fonts would
  // be missing in the deployed function while working perfectly in dev.
  // benchFonts() degrades to Satori's built-in face rather than throwing,
  // which would make that failure silent — hence pinning it here, and
  // scripts/check-og-fonts.ts proving the files still load.
  outputFileTracingIncludes: {
    "/**": ["./src/app/fonts/*.ttf"],
  },
  // Suppress the X-Powered-By: Next.js header · standard defense-in-
  // depth hardening. Framework fingerprinting is trivial via other
  // signals so this isn't preventing exploitation, just removing one
  // free hint to opportunistic scanners.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      // Bitcoin Kart's offline service worker lives at
      // /bitcoin-kart/sw.js, but the game page is the CLEAN URL
      // /bitcoin-kart (no trailing slash) · a worker's default max scope
      // is its own directory ("/bitcoin-kart/"), which does NOT cover
      // the clean URL. This header authorizes the wider "/bitcoin-kart"
      // scope the registration asks for. Scope stays game-only · the
      // rest of the site is never SW-controlled.
      // Checkout only: Base Account (Coinbase Smart Wallet) signs in a popup at
      // keys.coinbase.com and answers over postMessage to window.opener. COOP
      // same-origin severs that link, and the SDK refuses to run under it.
      // same-origin-allow-popups keeps the protection for pages that open US
      // (another origin can't hold a reference to this page) while letting the
      // popup this page opens talk back. Later entries override earlier ones.
      {
        source: "/hashrate/rent",
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }],
      },
      {
        source: "/bitcoin-kart/sw.js",
        headers: [{ key: "Service-Worker-Allowed", value: "/bitcoin-kart" }],
      },
    ];
  },
  // Permanent (308) redirects so external links and social-card caches
  // update their canonical. /vendors was the directory's launch URL before
  // it was promoted to the homepage. /gauge is a friendly alias for
  // /stack — the gauge IS the page, but "stack" is the verb (so /stack
  // remains canonical for SEO + sharing). The 308 preserves request method.
  async redirects() {
    return [
      {
        source: "/vendors",
        destination: "/",
        permanent: true,
      },
      {
        source: "/gauge",
        destination: "/stack",
        permanent: true,
      },
      // The house hashrate listing shipped as /v/block-shot and was
      // renamed to /v/galaxy-mind-hashrate an hour later (the product
      // name was demoted · a directory row reading "Block Shot" looked
      // like a third party). The old slug lived briefly and had no
      // inbound links, but it WAS served in the sitemap, so anything
      // that crawled it in that window gets a clean 308 instead of a
      // 404. Same discipline as /vendors -> /.
      {
        source: "/v/block-shot",
        destination: "/v/galaxy-mind-hashrate",
        permanent: true,
      },
      // /trade (the "Bitcoin barter lane") was removed May 2026 — the
      // dedicated page + its UI didn't earn their keep. 308 → / so any
      // shared/indexed link lands on the directory instead of 404ing.
      // The tradeFriendly/interestedIn vendor fields are kept as
      // dormant data (see Vendor type) but no longer surfaced anywhere.
      {
        source: "/trade",
        destination: "/",
        permanent: true,
      },
      // PlebSource.com was unlisted 2026-10-13 by listing hygiene: its
      // Shopify storefront stopped serving (no TLS cert for the domain,
      // plain HTTP 409 from Shopify's edge, while other Shopify shops on
      // the same IP answered 200). 308 -> / so old links land on the
      // directory instead of 404ing.
      {
        source: "/v/plebsource-com",
        destination: "/",
        permanent: true,
      },
      {
        source: "/v/plebsource-com/:path*",
        destination: "/",
        permanent: true,
      },
      // BtcPins unlisted 2026-10-18 (D-20261018-19, the operator's yes,
      // 11:02 X+Nostr rule applied): its own X bio reads "Bitcoin Pins Shop
      // (CLOSED)", btcpins.com fails TLS, its Lightning address does not
      // answer and its newest Nostr product dates from 2023. Same posture as
      // PlebSource: 308 -> /. scripts/test-removed-vendors.ts keeps this in sync.
      {
        source: "/v/btcpins",
        destination: "/",
        permanent: true,
      },
      {
        source: "/v/btcpins/:path*",
        destination: "/",
        permanent: true,
      },
      // The game is served at the clean /super-saylor (rewrite below).
      // Its rewrite TARGET, /super-saylor.html, is ALSO directly
      // reachable and serves byte-identical content — a crawlable
      // duplicate that Bing flags (it honors the cross-URL canonical far
      // less reliably than Google). 308 the .html form to the clean URL
      // so exactly one URL is indexable. Loop-safe: redirects() (phase 2)
      // runs before the afterFiles rewrite (phase 6) that maps
      // /super-saylor -> /super-saylor.html, and a rewrite DESTINATION is
      // not re-run through the redirect table. (Verified locally 2026-07-13.)
      {
        source: "/super-saylor.html",
        destination: "/super-saylor",
        permanent: true,
      },
      // Bitcoin Kart mirrors the same one-indexable-URL discipline: the
      // rewrite target /bitcoin-kart/index.html is directly reachable as a
      // static file, so 308 it back to the clean URL.
      {
        source: "/bitcoin-kart/index.html",
        destination: "/bitcoin-kart",
        permanent: true,
      },
      // /vendors/{facet} hub consolidation (2026-07-11). The 2026-06-10
      // programmatic hubs and the 2026-07 /spend-bitcoin-in|on pages
      // were near-identical vendor lists competing for the same
      // queries; the spend-bitcoin family won. The route
      // (src/app/vendors/[slug]) is deleted; these 308s transfer the
      // old URLs' link equity to the twins.
      //
      // The list is FROZEN — it's the exact hub set that existed (and
      // was indexed) at removal time. New countries get only a
      // /spend-bitcoin-in page, never a /vendors twin, so nothing is
      // ever added here.
      //
      // Categories redirect row-by-row because the old slugs derive
      // from display labels ("hardware-mining") while the new routes
      // use the raw category key ("hardware"). Country slugs are
      // byte-identical on both sides (labelSlug ≡ countrySlug), so one
      // regex-enumerated rule covers all 20.
      {
        source: "/vendors/apparel",
        destination: "/spend-bitcoin-on/apparel",
        permanent: true,
      },
      {
        source: "/vendors/hardware-mining",
        destination: "/spend-bitcoin-on/hardware",
        permanent: true,
      },
      {
        source: "/vendors/consumables",
        destination: "/spend-bitcoin-on/consumables",
        permanent: true,
      },
      {
        source: "/vendors/collectibles-3d",
        destination: "/spend-bitcoin-on/collectibles",
        permanent: true,
      },
      {
        source: "/vendors/services",
        destination: "/spend-bitcoin-on/services",
        permanent: true,
      },
      {
        source: "/vendors/books-education",
        destination: "/spend-bitcoin-on/books",
        permanent: true,
      },
      {
        source: "/vendors/general-goods",
        destination: "/spend-bitcoin-on/general-goods",
        permanent: true,
      },
      {
        source:
          "/vendors/:country(united-states|united-kingdom|germany|south-africa|italy|france|switzerland|colombia|thailand|slovenia|new-zealand|el-salvador|netherlands|hungary|spain|australia|canada|austria|finland)",
        destination: "/spend-bitcoin-in/:country",
        permanent: true,
      },
      // Alpha-2 / short-form country-hub aliases → canonical full-name
      // slugs (see COUNTRY_HUB_ALIASES above). One rule per alias so
      // each maps to its own destination. /es/spend-bitcoin-in/{alias}
      // is NOT twinned: proxy 308s any leftover /es path (except the
      // LATAM page) onto the English URL, and this rule then maps the
      // short form to the hub slug.
      ...Object.entries(COUNTRY_HUB_ALIASES).map(([alias, slug]) => ({
        source: `/spend-bitcoin-in/${alias}`,
        destination: `/spend-bitcoin-in/${slug}`,
        permanent: true,
      })),
      // Empty-roster countries must NOT become /spend-bitcoin-in/[country]
      // pages (those 404 when the roster is empty). Point guessed
      // Argentina URLs at the LATAM research page instead. Brazil left
      // this list on 2026-08-25 when Homedock and KriptoBR landed —
      // /br and /brasil are COUNTRY_HUB_ALIASES to /brazil. /es twins
      // keep the Spanish LATAM landing; proxy also 308s these to
      // /es/spend-bitcoin-in-latin-america so a missed config row
      // cannot strip the prefix and dump a Spanish visitor on English.
      ...[
        "/spend-bitcoin-in/argentina",
        "/spend-bitcoin-in/ar",
        // Peru joined this list 2026-08-26: its only vendor (Delgado's Fuego,
        // addedAt 17) was mis-filed as PE because the hot sauce is Peruvian.
        // The L.L.C. and every retail location are in North Carolina, so the
        // country was corrected to US and the roster emptied. These URLs were
        // live and indexed, so they redirect rather than 404.
        "/spend-bitcoin-in/peru",
        "/spend-bitcoin-in/pe",
        "/vendors/peru",
        "/spend-bitcoin-in/latin-america",
        "/spend-bitcoin-in/latinoamerica",
      ].flatMap((source) => [
        {
          source,
          destination: "/spend-bitcoin-in-latin-america",
          permanent: true,
        },
        {
          source: `/es${source}`,
          destination: "/es/spend-bitcoin-in-latin-america",
          permanent: true,
        },
      ]),
      // Stale-share rescue · a tweet linking galaxymind.space/v/cluborange
      // is loose in X's card-fetch cache, generating recurring 404s on
      // /v/cluborange/opengraph-image. The canonical slug is club-orange
      // (vendorSlug() derives from `name` — "Club Orange" → "club-orange" —
      // not from the X handle · see lib/vendors.ts).
      //
      // Two explicit rules instead of a /v/cluborange/:path* wildcard
      // because the destinations differ: the page lives at /v/club-orange,
      // but the OG image route uses generateImageMetadata() so it's served
      // at /v/[slug]/opengraph-image/[id] — the bare /opengraph-image
      // path 404s for ALL vendors, not just this one. So the og-image
      // redirect has to point at the id-suffixed URL that returns the
      // real PNG. The id is `vendorSlug(vendor)` for whichever image we
      // want X's card to render; "club-orange" picks Club Orange's own
      // generated card.
      {
        source: "/v/cluborange",
        destination: "/v/club-orange",
        permanent: true,
      },
      {
        source: "/v/cluborange/opengraph-image",
        destination: "/v/club-orange/opengraph-image/club-orange",
        permanent: true,
      },
      // www → apex permanent redirect. Without this, www.galaxymind.space
      // serves the same content as the apex, which creates a duplicate
      // content problem AND Google reports the www variant as
      // "redirect, not indexed" in Search Console (because Vercel's
      // default www-handling was a 307 Temporary, not a 308 Permanent).
      // The 308 (permanent: true) tells Google "transfer all link
      // equity to the apex; the apex is canonical."
      //
      // The :path* wildcard preserves the entire URL path, including
      // query strings, so a link to https://www.galaxymind.space/stack?s=72
      // 308s correctly to https://galaxymind.space/stack?s=72.
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.galaxymind.space" }],
        destination: "https://galaxymind.space/:path*",
        permanent: true,
      },
      // galaxy-mind.vercel.app → apex (security audit 2026-10-18, L3).
      // The project's own vercel.app alias served production publicly as
      // a second origin outside host-scoped rules. Exact host only, so
      // per-deployment preview URLs are untouched. /api/* is left alone:
      // Vercel cron does not follow redirects, and a 308 there would
      // silently stop a scheduled job if it ever calls this host.
      {
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: "galaxy-mind.vercel.app" }],
        destination: "https://galaxymind.space/:path",
        permanent: true,
      },
    ];
  },
  // Rewrite the NIP-05 well-known path to the route handler. Avoids
  // tooling quirks with `app/.well-known/...` dot-prefixed folders.
  // The query string (?name=...) is preserved by Next's rewrite engine.
  //
  // ALSO: IndexNow site-ownership verification key. The IndexNow spec
  // requires the key file to live at a path that's a parent of the
  // URLs being submitted · serving it at /api/indexnow-key only
  // authorizes /api/* submissions, which is useless for our actual
  // pages. The rewrite below maps /<KEY>.txt at the root to the
  // existing key endpoint, so IndexNow sees the file at the proper
  // root location while the implementation stays in one place.
  //
  // The keyLocation we send to IndexNow is then
  // https://galaxymind.space/<KEY>.txt (root-level), which authorizes
  // submissions for the entire site. INDEXNOW_KEY env var must be set
  // for this rewrite to register; otherwise the array is empty and
  // the rewrite is a no-op.
  async rewrites() {
    // The only Spanish URL. Proxy 308s every other /es/* to English
    // (and empty-roster /es guesses to this page). Config rewrite,
    // not middleware: a proxy rewrite re-enters and would drop the
    // prefix header.
    const esPrefix = [
      {
        source: "/es/spend-bitcoin-in-latin-america",
        destination: "/spend-bitcoin-in-latin-america",
      },
    ];
    const rules = [
      {
        source: "/.well-known/nostr.json",
        destination: "/api/nostr-nip05",
      },
      // Some agent tooling probes /llms-full.txt as the "expanded"
      // companion to /llms.txt. Ours is ALREADY the full version (800+
      // lines: complete signal weights, engine invariants, glossary), so
      // serve the same file rather than forking a second copy — a fork
      // is a second thing to keep in sync and check-llms-txt.ts guards
      // exactly one path (2026-07-29).
      {
        source: "/llms-full.txt",
        destination: "/llms.txt",
      },
      // Super Saylor arcade cabinet · the game is a single static HTML
      // file in public/ (offline-playable deliverable). The rewrite
      // gives it the clean /super-saylor URL used on share cards.
      {
        source: "/super-saylor",
        destination: "/super-saylor.html",
      },
      // Bitcoin Kart arcade cabinet · static directory in
      // public/bitcoin-kart/ (index.html + ES modules + css). The rewrite
      // gives it the clean /bitcoin-kart URL; asset paths inside the HTML
      // are absolute (/bitcoin-kart/js/...) so they resolve regardless of
      // the trailing-slash form the visitor arrived on.
      {
        source: "/bitcoin-kart",
        destination: "/bitcoin-kart/index.html",
      },
      // SIX DEEP gray-box (cabinet #8 prototype · 2026-07-27) · static
      // directory, same posture as bitcoin-kart. UNLISTED while it is a
      // prototype: noindex meta in the HTML, no nav/sitemap entries.
      {
        source: "/six-deep",
        destination: "/six-deep/index.html",
      },
      // CHOP cabinet (2026-07-27) · static directory, same posture.
      // Exact `/chop` only — `/chop/card/[data]` is a Next share-landing
      // route and must not be swallowed by a `/chop/:path*` rewrite.
      {
        source: "/chop",
        destination: "/chop/index.html",
      },
    ];
    if (process.env.INDEXNOW_KEY) {
      rules.push({
        source: `/${process.env.INDEXNOW_KEY}.txt`,
        destination: "/api/indexnow-key",
      });
    }
    return { beforeFiles: esPrefix, afterFiles: rules };
  },
};

export default nextConfig;
