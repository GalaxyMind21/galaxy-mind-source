import type { Metadata } from "next";
import { Spline_Sans_Mono } from "next/font/google";
import localFont from "next/font/local";
import SiteAnalytics from "@/components/SiteAnalytics";
import { headers } from "next/headers";
import { SiteFooter } from "@/components/SiteFooter";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { MotionPrefs } from "@/components/MotionPrefs";
import { EasterEggs } from "@/components/EasterEggs";
import { CommandPalette } from "@/components/CommandPalette";
import { StickySubscribeChip } from "@/components/StickySubscribeChip";
import { BackToTop } from "@/components/BackToTop";
import { InstallNudge } from "@/components/InstallNudge";
import { ArcadeStreakTracker } from "@/components/ArcadeStreakTracker";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { DomMutationGuard } from "@/components/DomMutationGuard";
import { safeJsonLd } from "@/lib/json-ld";
import { LocaleProvider } from "@/components/LocaleProvider";
import { getRequestLocale, htmlLang } from "@/lib/locale";
import "./globals.css";

// Plus Jakarta Sans · primary sans-serif (Tokotype, SIL Open Font License 1.1; the licence
// text is src/app/fonts/OFL.txt). Self-hosted from src/app/fonts/ via next/font/local, so there
// is no third-party CDN at runtime and the files get the same /_next/static/ caching and
// preload treatment as the next/font/google fonts.
//
// Three weights (400/500/700) cover the site's usage. The browser synthesises 600
// (font-semibold) from 500/700.
//
// The CSS variable name is face-neutral (--font-site-sans), so a future font swap touches
// only this one declaration.
const siteSans = localFont({
  src: [
    { path: "./fonts/PlusJakartaSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/PlusJakartaSans-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/PlusJakartaSans-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-site-sans",
  display: "swap",
});

// Spline Sans Mono replaced JetBrains Mono (2026-06-10 typography
// elevation). JetBrains Mono became the second AI-built-site
// fingerprint after Inter · every generated dashboard ships it.
// Spline Sans Mono keeps tabular-nums + full 300-700 weights, runs
// slightly narrower (a win for the mobile chips and tables), and has
// a warmer grotesk voice that fits the brass-instrument brand.
// The CSS VARIABLE NAME deliberately stays --font-jetbrains-mono ·
// it's referenced in 10+ files incl. deep inside PressureGauge and
// StackSkeleton; same swap-the-fill convention documented on the
// site sans block above. Rename only with a repo-wide sweep.
const jetbrainsMono = Spline_Sans_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = "https://galaxymind.space";
// Default metadata describes the homepage (vendor directory). Per-route
// layouts (e.g. /fit/layout.tsx) override these values via Next's metadata
// merging.
// SEO-targeted for the homepage's primary intent: people searching
// "merchants/stores that accept bitcoin", "bitcoin accepted", "where
// to spend bitcoin", "bitcoin preferred payment". The homepage IS the
// directory, so its <title>/description lead with that exact phrasing
// (the tool pages set their own metadata; this is the directory's).
// "Human-verified" ties the listing to the public /methodology page.
// "Where to spend bitcoin" is the query family with real volume that
// the old title ("Spend Bitcoin at Merchants...") didn't literally
// match · lead with it (2026-06-10 traffic pass).
const TITLE = "Where to Spend Bitcoin · Verified BTC Merchant Directory · Galaxy Mind";
// Description is ALL-directory (SEO sprint 2026-07-21): the old copy
// spent half its snippet pitching the Buying Gauge / mNAV / float
// tools, which is noise to a spend-intent searcher and cost snippet
// CTR. The verification cadence is the claim no competitor can make ·
// lead with it. Phrased as a PROCESS claim rather than an absolute
// state claim ("checked within the last N days") — a static metadata
// string can't degrade the way the money page's computed freshness
// pill does, so it must only assert what stays true regardless of
// queue state. Updated 2026-08-15 when continuous monitoring shipped:
// the old "re-checked on a rolling N-day cycle" phrasing described a
// periodic human sweep that no longer exists, so it was replaced with
// what's actually true every day — daily automated monitoring plus
// human review on any change. (The exact phrase "online stores that
// accept bitcoin" deliberately stays OFF the homepage title/
// description — that query family belongs exclusively to
// /online-stores-that-accept-bitcoin, so the two pages never split
// relevance.)
const DESCRIPTION = `Human-verified directory of independent merchants that accept Bitcoin and Lightning for everyday goods. Every listing monitored daily; changes get human review.`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Galaxy Mind",
  authors: [{ name: "Galaxy Mind" }],
  // Per-page openGraph.images on /, /fit, /stack, /treasuries are
  // generated dynamically by their opengraph-image.tsx route handlers
  // (Satori-rendered PNGs that include live data). Root metadata
  // intentionally omits an explicit images array · Next merges the
  // per-route convention image automatically.
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Galaxy Mind",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    site: "@GalaxyMind",
    creator: "@GalaxyMind",
  },
  // Canonical URL for the home page. Per-route layouts (/stack, /fit,
  // etc.) set their own alternates.canonical; the root sets it for the
  // home page (the merchant directory at /). Without this, Google sees
  // www.galaxymind.space and galaxymind.space as separate URLs even
  // with the 308 redirect in place · the canonical tag is the
  // belt-and-braces signal that the apex is the one true URL.
  alternates: {
    canonical: SITE_URL,
    // RSS feed of newest vendors · planet-style aggregators auto-discover
    // via this link tag, no manual subscription needed.
    types: {
      "application/rss+xml": [
        { url: "/feed.xml", title: "Galaxy Mind · New Bitcoin Merchants" },
        // The site publishes TWO feeds; this array carried only one, so
        // head-tag autodiscovery found the weekly-ish vendor feed and
        // missed the DAILY one — the higher-cadence, more subscribable
        // of the pair (2026-07-29). Each gauge item links its frozen
        // /stack?s=..&t=..&d=.. permalink, which is the no-email channel
        // for RSS/IFTTT followers.
        { url: "/feed-gauge.xml", title: "Galaxy Mind · Daily Buying Gauge" },
      ],
    },
  },
  robots: {
    // Standard "index everything, follow links" posture for traditional
    // crawlers. Per-bot opt-in for AI agents (GPTBot, ClaudeBot, etc.)
    // is handled in src/app/robots.ts. Both layers cooperate · the
    // metadata robots tag here is what gets emitted as <meta
    // name="robots"> in the page <head>, while robots.ts produces
    // /robots.txt at the root.
    index: true,
    follow: true,
    googleBot: {
      // Google-specific opt-ins · enable rich result eligibility,
      // image previews, and snippet length up to the maximum.
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  // Search Console / Webmaster verification. Values are hardcoded
  // because they're public anyway (they get rendered into the page
  // <head> as <meta name="google-site-verification" content="...">,
  // visible to anyone via View Source) AND they're stable for the
  // lifetime of the property registration. Env-var support is kept
  // for the Bing / Yandex slots so those can be added without a
  // code change later.
  //
  // GOOGLE: registered May 10, 2026. To re-verify after a property
  // change, get a fresh value from https://search.google.com/search-console
  // → Add property → URL prefix → https://galaxymind.space → HTML tag,
  // and replace the literal below.
  //
  // BING_SITE_VERIFICATION: from https://www.bing.com/webmasters · same
  // flow. Bing's verification also unlocks IndexNow access for instant
  // content-update pings (see src/lib/indexnow.ts).
  //
  // YANDEX_VERIFICATION: only matters if targeting RU traffic.
  verification: {
    google: "7PLPrjeQ5t5Cme_ufYrWz0SKUVWcIDGZUzInSKhGGa4",
    other: {
      ...(process.env.BING_SITE_VERIFICATION
        ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
        : {}),
      ...(process.env.YANDEX_VERIFICATION
        ? { "yandex-verification": process.env.YANDEX_VERIFICATION }
        : {}),
    },
  },
  // PWA · iOS Add to Home Screen behavior. With the manifest.ts +
  // icon.tsx + apple-icon.tsx + these flags, an iPhone visitor who
  // adds the site to their home screen gets a standalone app
  // experience (no Safari chrome, branded splash, brand-color
  // status bar). Single biggest retention play for our 71% mobile
  // audience · turns "I should bookmark this" into a one-tap
  // home-screen install.
  appleWebApp: {
    capable: true,
    title: "Galaxy Mind",
    // black-translucent lets our radial-gradient backgrounds bleed
    // into the status bar area · matches the dark velvet aesthetic.
    statusBarStyle: "black-translucent",
  },
};

// Next 16 moved themeColor + viewport-config to a separate `viewport`
// export. Theme color paints the browser tab / status bar with the
// brand accent on Android Chrome + iOS Safari · part of the PWA
// experience that ties together with manifest.ts.
import type { Viewport } from "next";
export const viewport: Viewport = {
  themeColor: "#F7931A",
};

// Site-wide JSON-LD: Organization + WebSite. Establishes the brand
// entity for AI agents (Perplexity, ChatGPT search, Claude search,
// Google AI Overviews) and provides the "publisher" link that every
// per-page WebApplication / FAQPage block can attribute back to.
//
// Includes sameAs links to every public identity (X, Nostr) so
// search engines can correlate the brand across platforms.
//
// SearchAction lets AI agents discover that the site has a
// content-search affordance even though we don't have a /search
// endpoint — Bitcoin terms can be searched via the FAQ + glossary.
const SITE_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      name: "Galaxy Mind",
      url: SITE_URL,
      // /og.png did not exist and 404'd — the only dangling asset
      // reference in the repo, sitting in the site-wide Organization node
      // (fixed 2026-07-25). /icon/512 is the square brand mark emitted by
      // app/icon.tsx, which manifest.ts already calls the "single source
      // of truth for the brand mark, no binary assets to maintain".
      // Deliberately NOT /opengraph-image: that is a 1200x630 social card
      // with headline text baked in, and `logo` is the field Google may
      // crop into a Knowledge Panel.
      logo: `${SITE_URL}/icon/512`,
      sameAs: [
        "https://x.com/GalaxyMind",
        // Nostr: NIP-05 verification at galaxymind.space/.well-known/nostr.json
        "https://primal.net/p/nprofile1qqspwnkez659yrnzx2fu4kzpngtkak7v3sdpuh6jw83key38xru5wrcny0sdm",
        // Wikidata entity (Q139995523) · the structured-data graph that
        // Google Knowledge Panel / ChatGPT / Perplexity / Gemini read to
        // resolve "what is Galaxy Mind". The Wikidata item points back at
        // these same identifiers, so this reciprocal sameAs upgrades the
        // brand from "a website" to a resolved entity in AI knowledge
        // graphs (AEO · 2026-05-31).
        "https://www.wikidata.org/wiki/Q139995523",
      ],
      foundingDate: "2026-04",
      description:
        "Independent set of free Bitcoin tools: a human-verified directory of merchants and stores that accept Bitcoin for everyday goods, the Buying Gauge, a treasury mNAV scoreboard, and an allocation engine. Educational, not financial advice.",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Galaxy Mind",
      description: DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#org` },
      inLanguage: "en-US",
      // Sitelinks-searchbox affordance (2026-06-10) · ?q= became a
      // REAL working query param when the directory filters started
      // mirroring to the URL, so the SearchAction now points at a
      // genuine search surface (Google requires the target to work).
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE_URL}/?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Read the per-request CSP nonce that src/proxy.ts set on the
  // request headers. (Next 16 renamed middleware.ts → proxy.ts; see
  // proxy.ts for the rename rationale and don't reintroduce the
  // middleware filename.) Pass it to <Analytics> + <SpeedInsights> so
  // their injected <script> tags carry the matching nonce — without
  // this, strict-CSP browsers would block them.
  //
  // Next 16 made `headers()` async; awaiting is required.
  const hdrs = await headers();
  const nonce = hdrs.get("x-galaxymind-nonce") ?? undefined;
  const locale = await getRequestLocale();
  return (
    <html
      lang={htmlLang(locale)}
      className={`${siteSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
      // suppressHydrationWarning · the pre-paint script below mutates
      // <html> with data-theme based on LS / system preference BEFORE
      // React hydrates. Without this, React would warn about the
      // attribute mismatch between SSR (no data-theme) and client
      // (potentially data-theme="light"). The script is the entire
      // point of avoiding a flash-of-wrong-theme.
      suppressHydrationWarning
    >
      <head>
        {/* Pre-paint theme application · runs synchronously before
            React hydrates so the page never flashes the wrong theme.
            Reads localStorage.gm_theme. Default is DARK when no
            stored preference exists · the brand was designed dark-
            first and most visitors expect the original aesthetic.
            Visitors who explicitly toggle to light have that
            preference persisted in LS. The ThemeToggle component
            reads the same LS key on hydration so the toggle UI
            stays in sync. CSP-compliant via nonce.

            BOTH branches are explicit · the `else` removeAttribute
            is what prevents `data-theme="light"` from sticking
            across navigations when:
              · The HTML response was bf-cache restored with the
                attribute still on <html>
              · A previous SPA navigation set it and the user has
                since cleared / changed LS in another tab
              · React hydration persisted a server-side attribute
            Without the `else`, light mode could "stick" even after
            the user toggled back to dark or cleared the LS key. */}
        <script
          nonce={nonce}
          // THE NONCE HYDRATION MISMATCH · canonical note, referenced by
          // the ~34 other nonce'd <script> tags that carry this same
          // attribute.
          //
          // Browsers CLEAR the nonce content attribute once the element
          // is parsed (HTML spec, so a CSS attribute selector cannot
          // exfiltrate it) while keeping the value in an internal slot.
          // React's dev-only hydration check then compares its expected
          // nonce against the now-empty DOM attribute and reports a
          // mismatch that CANNOT be fixed at the source. Harmless — the
          // script already executed — but it pinned the dev overlay at
          // "2 Issues" permanently, which is how a real error goes
          // unnoticed.
          //
          // It must sit on EVERY nonce'd script, not just this one:
          // React reports one mismatch per hydration pass, so
          // suppressing only the first would silence the report while
          // hiding any unrelated, genuine mismatch further down the
          // tree — the same masking problem in a new form.
          suppressHydrationWarning
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `
              (function(){try{
                var t=localStorage.getItem("gm_theme");
                if(t==="light"){
                  document.documentElement.setAttribute("data-theme","light");
                } else {
                  document.documentElement.removeAttribute("data-theme");
                }
              }catch(e){
                document.documentElement.removeAttribute("data-theme");
              }})();
            `.replace(/\s+/g, " ").trim(),
          }}
        />
        {/* Machine-readable API description · lets agent tooling and
            HTTP clients auto-discover the public read-only endpoints
            (served by /api/openapi.json). Complements public/llms.txt
            and the MCP server at /api/mcp. */}
        <link
          rel="service-desc"
          type="application/openapi+json"
          href="/api/openapi.json"
        />
      </head>
      <body className="night-bench min-h-full flex flex-col pb-[calc(var(--mobile-nav-clearance)+env(safe-area-inset-bottom,0px)+0.5rem)] lg:pb-0">
        {/* DomMutationGuard · keeps a translated page alive. Browser
            translation (Chrome, Edge, Firefox) rewrites text nodes
            React still owns, and React's next removeChild or
            insertBefore on one threw straight into app/error.tsx
            (22 visitors in 30 days, 15 of them from bitcoin.org).
            Renders nothing; its module patches Node.prototype before
            hydration. See lib/dom-mutation-guard.ts. */}
        <DomMutationGuard />
        {/* Site-wide JSON-LD: Organization + WebSite. Per-page
            schema (WebApplication, FAQPage, Dataset, etc.) lives
            in each page's layout.tsx and references this
            Organization via @id="...#org" so all schema is
            consistently attributed. Content is fully server-side,
            no user input ever flows into it; safeJsonLd() escapes
            `<` and U+2028/U+2029 for defense in depth. */}
        <script
          type="application/ld+json"
          nonce={nonce}
          suppressHydrationWarning
          // Static, server-controlled object → no XSS surface.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: safeJsonLd(SITE_LD) }}
        />
        {/* MotionPrefs · framer-motion reads the OS reduced-motion
            setting (CSS media queries can't reach its inline-style
            animations). Wraps every UI slot below so page trees AND
            the floating layers inherit the config. */}
        <MotionPrefs>
        <LocaleProvider locale={locale}>
        {children}
        {/* Sitewide machined footer · design close + internal-link
            mesh (tools / vendor hubs / resources on every page). */}
        <SiteFooter />
        {/* Analytics + Speed Insights, with beforeSend scrubbing #fragment and ?pay= (S2). */}
        <SiteAnalytics />
        {/* Pass nonce to client-side scripts via a global. Vercel's
            Analytics/SpeedInsights use Next's <Script> internally;
            Next propagates nonce automatically when it's set on the
            outer Script tag. We don't need a manual <Script> here for
            those · Next handles it via the Headers we set. */}

        {/* Mobile bottom nav · visible only on sm-. The body reserves
            calc(--mobile-nav-clearance + env(safe-area-inset-bottom) +
            0.5rem) above so content isn't hidden behind it — the nav's
            real occupied height includes the iOS home-indicator inset,
            which the old fixed pb-16 ignored (footer rows were covered
            on notch iPhones). env() stays at the Tailwind use site:
            Lightning CSS silently drops env() inside a :root custom
            prop (memory: lightning-css-strips-env-in-root-var). The
            breakpoint follows MobileBottomNav, which covers up to lg
            (2026-08-02) — if one moves the other must. */}
        <MobileBottomNav />

        {/* Floating "back to top" pill · self-gates via scroll
            threshold (only appears past 800px) so short pages stay
            uncluttered. Mobile position dodges the bottom nav. */}
        <BackToTop />

        {/* Global keyboard layer · `?` toggles a help modal, `g`
            then h/s/f/t/i jumps between the five surfaces, `g v`
            focuses the homepage vendor search. Skips when the
            user is typing into an input/textarea/contenteditable
            so it never hijacks typing. Power-user retention boost
            for the segment most likely to share the site. */}
        <KeyboardShortcuts />

        {/* Command palette · the site-wide jump layer (Cmd+K / Ctrl+K
            or the header search button). Featherweight shell here;
            the vendor + glossary index loads on first open only
            (B5 · 2026-07-07). Complements KeyboardShortcuts: `g`
            sequences jump between surfaces, the palette jumps to
            ANYTHING (a specific vendor page, a glossary term). */}
        <CommandPalette />

        {/* Easter eggs · listens globally for the 21-click logo trigger,
            keyword-typing triggers, and score-based ribbons. Renders
            only the overlays it owns (logo-21 celebration, quote
            bubbles); per-page easter eggs (score ribbons) live next to
            the components they augment. */}
        <EasterEggs />

        {/* Floating "Get alerts" chip · appears after scroll on every
            page, dismissable for 30 days. Bottom-right (mobile FAB
            owns bottom-center). Page-aware: pre-selects the surface-
            relevant opt-in via pathname. */}
        <StickySubscribeChip />

        {/* Home-screen install invite · fires only at the post-game
            delight moment on phones, once per 30 days. The PWA itself
            (manifest, icons, push SW) was already built; this is the
            missing ask (growth sprint 2026-07-10). */}
        <InstallNudge />

        {/* Cross-cabinet arcade streak · renders nothing, just advances
            the "played N days running" counter on any finished run so it
            counts site-wide, not only on /today (growth sprint
            2026-07-10). */}
        <ArcadeStreakTracker />
        </LocaleProvider>
        </MotionPrefs>
      </body>
    </html>
  );
}
