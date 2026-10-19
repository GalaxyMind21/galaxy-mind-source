/* =====================================================================
 * SiteFooter · sitewide machined footer (design elevation 2026-06-10)
 *
 * Two jobs in one component:
 *   1. DESIGN · gives every page a professional close instead of
 *      content just stopping. Hairline top edge, four-column link
 *      architecture, quiet bottom bar.
 *   2. TRAFFIC · the internal-link mesh. Every page now links the
 *      tools, the programmatic vendor hubs (category + top countries),
 *      and the resource pages · distributing crawl equity to the
 *      long-tail surfaces from every URL on the site.
 *
 * Server component · link lists derive from the same single sources
 * of truth as the pages themselves (CATEGORY_LABELS, COUNTRIES,
 * VENDORS), so a new country with vendors automatically appears here.
 * Mounted once in the root layout, so per-page footers
 * (FooterDisclaimer on /) stay untouched above it.
 * ===================================================================== */

import Link from "next/link";
import { isStaticHtmlRoute } from "@/lib/nav";
import { SupportTrigger } from "@/components/SupportTrigger";
import { GalaxyMark } from "@/components/GalaxyMark";
import { HideOnPaths } from "@/components/HideOnPaths";
import {
  CATEGORY_LABELS,
  COUNTRIES,
  VENDORS,
  countrySlug,
  type VendorCategory,
} from "@/lib/vendors";
import { getRequestLocale, translate } from "@/lib/locale";
import { countryLabel } from "@/lib/latam";
import { MARKETPLACE_FOOTER_LINK } from "@/lib/marketplace-listing";
import { RENT_PAGE_PATH } from "@/lib/rent-page";

const TOOLS = [
  { href: "/today", label: "Today in Bitcoin" },
  { href: "/stack", label: "Buying Gauge" },
  { href: "/treasuries", label: "Treasury mNAV" },
  { href: "/float", label: "Bitcoin Float" },
  { href: "/hashrate", label: "Rent Hashrate" },
  { href: "/hashrate/how-to-rent", label: "How to Rent Hashrate" },
  { href: "/hashrate/agents", label: "Rent as an Agent" },
  // Sits with /hashrate on purpose · it is the odds half of the same
  // question. It shipped 2026-08-04 into lib/nav.ts only, and the
  // header flyout renders its <a>s ONLY while open, so it had zero
  // crawlable inlinks anywhere and Ahrefs called it an orphan page
  // (2026-08-06). Same class as the feeds below. A page listed in
  // nav.ts is NOT linked as far as a crawler is concerned — if it
  // should be indexed, it belongs in this file too.
  { href: "/solo-mining-calculator", label: "Solo Mining Odds" },
  { href: "/map", label: "Merchants Map" },
  // The arcade cabinets' only server-rendered <a>s · the header's
  // "Arcade" entry is a client-side <button>, so without these links the
  // hub AND the individual games were invisible to crawlers. All EIGHT
  // cabinets ride the footer so each is one hop from every URL on the
  // site (Bitcoin Kart is the newest big swing — list it right after
  // the hub; Super Saylor stays high as the flagship).
  //
  // The HODL Trail was missing until 2026-07-29 — cabinet #7 shipped
  // 2026-07-25 and this list was never extended, so it was the only
  // cabinet without a sitewide link. CHOP (cabinet #8) shipped
  // 2026-08-04 and was linked here on launch, but the count in this
  // comment lagged until 2026-08-06, along with the prose counts on
  // /arcade, in nav.ts, in the command palette and in the hashrate
  // cross-sell. If you add cabinet #9, add it here in the same commit,
  // bump the count above, and grep for the spelled-out count word
  // (`grep -rniE '\b(seven|eight|nine)\b' src/`) before you call it
  // done — the cabinet count lives in prose in five places and no
  // validator derives it from CABINETS.length.
  { href: "/arcade", label: "The Arcade" },
  { href: "/bitcoin-kart", label: "Bitcoin Kart" },
  { href: "/super-saylor", label: "Super Saylor" },
  { href: "/gauntlet", label: "The Gauntlet" },
  { href: "/wen", label: "WEN" },
  { href: "/trail", label: "The HODL Trail" },
  { href: "/chop", label: "CHOP" },
  { href: "/runner", label: "The Runner" },
  { href: "/horizon", label: "Timechain" },
  { href: "/fit", label: "Allocation Engine" },
  { href: "/bitcoin-halving-countdown", label: "Halving Countdown" },
  { href: "/embed", label: "Embed the Gauge" },
  { href: "/badge", label: "Verified badge" },
];

const RESOURCES = [
  { href: "/glossary", label: "Glossary" },
  { href: "/methodology", label: "Methodology" },
  // /pulse was in neither TOOLS nor RESOURCES · its only inbound link
  // was one line on /today, and the dated weekly archive is meant to be
  // the evergreen retention asset (2026-07-29).
  { href: "/pulse", label: "Weekly Pulse" },
  { href: "/letter", label: "Monthly Letter" },
  { href: "/docs/api", label: "Public API" },
  { href: "/status", label: "System Status" },
  { href: "/faq", label: "FAQ" },
  { href: "/about", label: "About" },
  // Privacy must stay reachable from every page · connector directories
  // check for a discoverable policy, and the footer is mounted in the
  // root layout so this one line covers the whole site.
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/spend-and-replace", label: "Spend & Replace" },
  { href: "/how-to-help-grow-bitcoin", label: "Help Grow Bitcoin" },
  { href: "/how-to-accept-bitcoin", label: "Accept Bitcoin" },
  { href: "/how-to-buy-bitcoin", label: "Buy Bitcoin" },
  // The honest directory-landscape comparison (2026-07-21) · the
  // linkable asset behind the broken-link outreach sprint.
  { href: "/state-of-bitcoin-directories", label: "Directory Report" },
  // The verified-count stats page (2026-08-04) · orphaned for the same
  // reason as /solo-mining-calculator above: nav.ts is not a link mesh.
  {
    href: "/how-many-businesses-accept-bitcoin",
    label: "How Many Take Bitcoin",
  },
  // Visible feed links · the feeds only lived in <link rel="alternate">
  // head tags, which crawlers don't count as internal links, so both
  // showed up as orphan pages (Ahrefs 2026-06-11). Also makes them
  // human-discoverable.
  { href: "/feed.xml", label: "Vendor RSS" },
  { href: "/feed-gauge.xml", label: "Gauge RSS" },
];

function FooterCol({
  title,
  links,
  dense = false,
}: {
  title: string;
  links: { href: string; label: string }[];
  /** Two-column grid for long lists (the all-countries column) so it
   *  doesn't tower over its siblings. */
  dense?: boolean;
}) {
  return (
    <div>
      <div className="font-mono t-xs uppercase tracking-[0.28em] text-[var(--text-tertiary)] mb-3.5">
        {title}
      </div>
      <ul
        className={
          dense
            ? "grid grid-cols-2 gap-x-4"
            : ""
        }
      >
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              prefetch={isStaticHtmlRoute(l.href) ? false : undefined}
              // inline-block + py-1 lifts the hit area from 18px to
              // ~26px tall (2026-07-29). Lighthouse flagged every footer
              // link as an undersized touch target on mobile — 18px
              // against a 24px minimum, in the densest link mesh on the
              // site (all 20 country hubs live here). Padding only; the
              // visual rhythm is unchanged because the rows already had
              // gap.
              className="inline-flex items-center min-h-[44px] py-1 t-xs font-sans text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function SiteFooter() {
  const locale = await getRequestLocale();
  const t = (key: string) => translate(locale, key);

  // Both link families point at the /spend-bitcoin-in|on landing pages
  // (canonical since 2026-07-11 · the older /vendors/{facet} hubs now
  // 308 to them, see next.config.ts). Categories route on the raw
  // category KEY ("hardware"); countries route on the label-derived
  // slug ("united-states"). Zero-vendor slices are skipped — their
  // pages 404, and a footer must never link a 404.
  const categoryLinks = (Object.keys(CATEGORY_LABELS) as VendorCategory[])
    .filter((cat) => VENDORS.some((v) => v.category === cat))
    .map((cat) => ({
      href: `/spend-bitcoin-on/${cat}`,
      label: CATEGORY_LABELS[cat],
    }));
  // ALL country hubs, vendor-count order (SEO sprint 2026-07-21 ·
  // was top-6). The 14 long-tail hubs were footer-orphaned — 2+
  // clicks from anywhere, throttling crawl of exactly the near-zero-
  // competition geo pages. The column renders dense (two sub-columns)
  // so 20 entries don't tower over the siblings.
  const countByCode = new Map<string, number>();
  for (const v of VENDORS) {
    if (v.country) countByCode.set(v.country, (countByCode.get(v.country) ?? 0) + 1);
  }
  const countryLinks = [...countByCode.entries()]
    .filter(([code]) => COUNTRIES[code])
    .sort((a, b) => b[1] - a[1])
    .map(([code]) => ({
      href: `/spend-bitcoin-in/${countrySlug(COUNTRIES[code].label)}`,
      label: countryLabel(code, locale),
    }));

  return (
    <footer className="relative mt-16">
      <div aria-hidden className="hairline-gradient" />
      <div className="bg-[var(--bg-elevated)]/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-10">
            {/* Brand column */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2">
                <GalaxyMark
                  size={24}
                  className="h-6 w-6"
                />
                <span className="hdr-mark text-[1.0625rem] font-medium tracking-[-0.02em] text-[var(--text-primary)]">
                  Galaxy Mind
                </span>
              </div>
              <p className="mt-3.5 t-xs font-sans text-[var(--text-tertiary)] leading-relaxed max-w-[28ch]">
                {t("footer.blurb")}{" "}
                {t("home.independence")}
              </p>
              <div className="micro-label mt-2 flex items-center gap-4">
                <a
                  href="https://x.com/GalaxyMind"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center min-h-11 text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
                >
                  𝕏
                </a>
                <Link
                  href="/status"
                  className="inline-flex items-center min-h-11 gap-1.5 text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors"
                >
                  <span
                    aria-hidden
                    className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--success)] live-pulse"
                  />
                  {t("footer.live")}
                </Link>
              </div>
              {/* MRR-only (operator 2026-10-17): the main way to rent, so it sits under the brand, in accent. It links to
                  our own /hashrate page: the marketplace profile is login-walled for signed-out visitors. */}
              {/* Hidden on the /spend-bitcoin-in guides (review 2026-10-18). */}
              <HideOnPaths prefixes={["/spend-bitcoin-in"]}>
              <Link
                href={RENT_PAGE_PATH}
                className="mt-3 inline-flex items-center gap-1 min-h-[44px] rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 text-sm font-semibold text-[var(--accent-ink)] backdrop-blur-md hover:border-[var(--accent)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
                data-footer-mrr
              >
                {MARKETPLACE_FOOTER_LINK}
                <span aria-hidden>→</span>
              </Link>
              </HideOnPaths>
            </div>

            <FooterCol title={t("footer.tools")} links={TOOLS} />
            <FooterCol
              title={t("footer.spendBitcoin")}
              links={[
                {
                  href: "/online-stores-that-accept-bitcoin",
                  label: t("footer.onlineStores"),
                },
                {
                  href: "/spend-bitcoin-on",
                  label: t("nav.spendByCategory"),
                },
                ...categoryLinks,
                { href: "/buy-coffee-with-bitcoin", label: t("footer.coffee") },
                { href: "/submit", label: t("footer.listShop") },
              ]}
            />
            <FooterCol
              title={t("footer.byCountry")}
              dense
              links={[
                {
                  href: "/spend-bitcoin-in-latin-america",
                  label: t("footer.latinAmerica"),
                },
                ...countryLinks,
                { href: "/", label: t("footer.allVendors") },
              ]}
            />
          </div>

          {/* Support · the footer had no entry at all, and the only way in
              was a bare glyph in the header. The rent-hashrate pitch that
              led this block was removed 2026-08-13 · see the note in
              MobileBottomNav. Sitewide chrome asks for support, it does not
              sell the house product. */}
          <div className="mt-10 rounded-xl border border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-5">
            <p className="t-xs font-medium text-[var(--accent-ink)]">
              {t("footer.support")}
            </p>
            <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
              {t("footer.supportBody")}{" "}
              {t("home.independence")}
              {t("footer.supportIf")}
              <SupportTrigger label="zap a few sats over Lightning" />
              .
            </p>
          </div>

          <div className="mt-10 pt-5 border-t border-[var(--border-subtle)]/50 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-6 t-xs font-medium text-[var(--text-tertiary)]">
            <span>{t("footer.built")}</span>
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              {RESOURCES.map((r) =>
                // Feeds are XML route handlers, not pages · next/link
                // would attempt a client-side RSC navigation into a
                // non-HTML response. Plain anchor = full document load.
                r.href.endsWith(".xml") ? (
                  <a
                    key={r.href}
                    href={r.href}
                    className="inline-flex items-center min-h-[44px] py-1 hover:text-[var(--accent-ink)] transition-colors"
                  >
                    {r.label}
                  </a>
                ) : (
                  <Link
                    key={r.href}
                    href={r.href}
                    prefetch={isStaticHtmlRoute(r.href) ? false : undefined}
                    className="inline-flex items-center min-h-[44px] py-1 hover:text-[var(--accent-ink)] transition-colors"
                  >
                    {r.label}
                  </Link>
                ),
              )}
            </span>
            <span className="sm:ml-auto normal-case tracking-normal font-sans t-xs">
              {t("footer.educational")}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
