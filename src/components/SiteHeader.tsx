"use client";

/* =====================================================================
 * SiteHeader · the canonical top navigation bar
 *
 * Replaces the per-page <header> blocks that drift visually across
 * /, /stack, /float, /treasuries, /fit, /v/[slug], /about, /faq, /glossary.
 * Sticky-blur layout pattern matching the premium-fintech aesthetic
 * (Linear / Vercel / Stripe): logo left, quiet nav center, one
 * distinct CTA right · three visual zones that create hierarchy
 * without needing different shapes for every item.
 *
 * Active-page indicator: current route gets the accent color + a
 * small bottom underline. Reads as "you are here" without screaming.
 *
 * Mobile: center nav hides at < md (the MobileBottomNav already
 * covers primary navigation on mobile). Header shrinks to logo +
 * one compact CTA, leaving room for the page title below.
 *
 * The frosted pane is NOT on this element — it lives on
 * `.night-bench .site-header::before` in globals.css. `backdrop-filter`
 * here would become the backdrop root for the nav flyout below it, and
 * the flyout's own blur would then have nothing to reach (that shipped:
 * every menu was bare tint over live content). Do not add `glass-panel`
 * or any blur utility back to this className.
 *
 * Scroll behavior: sticky with backdrop-blur · the bar tracks the
 * visitor down the page and stays out of their reading flow.
 *
 * Accent CTA is overridable via props · routes that have a sharper
 * primary action ("submit a vendor" on /, etc.) can swap the
 * default "Find your fit" pill for their own.
 * ===================================================================== */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { GalaxyMark } from "@/components/GalaxyMark";
import { track } from "@vercel/analytics";
import { SupportModal } from "@/components/SupportModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HeaderBtcPrice } from "@/components/HeaderBtcPrice";
import { HeaderStreakChip } from "@/components/HeaderStreakChip";
import { HeaderDailiesChip } from "@/components/HeaderDailiesChip";
import { NAV_GROUPS, isGroupActive } from "@/lib/nav";
import { gauntletNumber } from "@/lib/gauntlet-day";
import { stripLocalePrefix } from "@/lib/i18n";
import { useT } from "@/components/LocaleProvider";

// Nav rethink (2026-07-08) · the flat four-instrument link row hid
// /today, /map, the Arcade, and every learn page from new visitors,
// and each new page threatened the header's width budget. The Apple
// pattern replaces it: FIVE quiet group words (Spend · Mine ·
// Instruments · Arcade · Learn), each opening a full-width flyout with large-type
// destinations + plain-English subtitles and a small mono column for
// the long tail. The IA lives in lib/nav.ts · one source shared with
// the mobile More sheet, so the two navs can never disagree. Adding
// a page = one line in nav.ts, never a wider header.

export function SiteHeader({
  /** Optional CTA override · the default flagship CTA is context-
   * aware (Spend Bitcoin → / on tool pages, + Submit a vendor →
   * /submit on /). Pages with a sharper primary action of their
   * own can pass a custom CTA pill via this slot. */
  ctaSlot,
}: {
  ctaSlot?: ReactNode;
} = {}) {
  const pathname = stripLocalePrefix(usePathname() ?? "/");
  const { t } = useT();
  const NAV_LINK_KEY: Record<string, string> = {
    "/": "nav.vendorDirectory",
    "/map": "nav.merchantsMap",
    "/spend-bitcoin-on": "nav.spendByCategory",
    "/submit": "nav.submitShop",
    "/online-stores-that-accept-bitcoin": "nav.onlineStores",
    "/spend-and-replace": "nav.spendAndReplace",
    "/how-to-accept-bitcoin": "nav.howToAccept",
    "/badge": "nav.badge",
    "/spend-bitcoin-in-latin-america": "nav.latam",
  };
  const NAV_SUB_KEY: Record<string, string> = {
    "/": "nav.vendorDirectorySub",
    "/map": "nav.merchantsMapSub",
    "/submit": "nav.submitShopSub",
  };

  // Any surface can open the support modal by dispatching gm:support. The
  // footer is a server component and cannot hold this state, and the header
  // already owns the modal — same trick CommandPalette uses for gm:palette.
  useEffect(() => {
    function onSupport() {
      setSupportOpen(true);
      track("support_open", { source: "event" });
    }
    window.addEventListener("gm:support", onSupport);
    return () => window.removeEventListener("gm:support", onSupport);
  }, []);
  const [supportOpen, setSupportOpen] = useState(false);

  // ── Flyout state · hover opens with a grace period, click toggles,
  // Escape / route change / click-away / focus-out all close. Not a
  // dialog (no focus trap) · it is a menu you can leave freely.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const headerRef = useRef<HTMLElement>(null);

  const cancelClose = () => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpenGroup(null), 180);
  };

  useEffect(() => {
    setOpenGroup(null);
  }, [pathname]);

  useEffect(() => {
    if (!openGroup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenGroup(null);
    };
    const onDown = (e: MouseEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setOpenGroup(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [openGroup]);

  const flyout = openGroup
    ? NAV_GROUPS.find((g) => g.id === openGroup)
    : null;

  return (
    <>
      {/* Skip link (WCAG 2.4.1) · SiteHeader is the shared nav shell,
          so the bypass-block pair lives here rather than the root
          layout (each page owns its own <main>, there is no shared
          one). First focusable element on every page; visually hidden
          until keyboard focus, then a fixed accent pill above the
          sticky header (z-30) and flyout. Targets the #main anchor
          rendered right after </header> below. */}
      <a
        href="#main"
        className="micro-label sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:inline-flex focus:items-center focus:px-3.5 focus:h-9 focus:rounded-md focus:bg-[var(--accent)] focus:text-black font-semibold"
      >
        {t("skipToContent")}
      </a>
      <header
        ref={headerRef}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setOpenGroup(null);
          }
        }}
        className="site-header sticky top-0 z-30 border-b border-[var(--border-subtle)]/25"
      >
        {/* Machined hairline · gradient bottom edge over the soft
            border (sticky = positioned, so the absolute child anchors
            to the header itself). Design elevation 2026-06-10. */}
        <div
          aria-hidden
          className="hairline-gradient absolute inset-x-0 -bottom-px"
        />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3 sm:gap-4">
          {/* Logo · Imagine enamel-pin galaxy. icon.tsx / apple-icon.tsx
              render the same pin. data-egg-logo hooks the
              21-click easter egg from EasterEggs.tsx. */}
          <Link
            href="/"
            className="flex items-center gap-2 group shrink-0"
            data-egg-logo
            aria-label="Galaxy Mind home"
          >
            <GalaxyMark
              size={24}
              className="h-[22px] w-[22px] sm:h-6 sm:w-6 transition-transform group-hover:scale-110"
            />
            <span className="hdr-mark inline font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-ink)] transition-colors whitespace-nowrap">
              Galaxy Mind
            </span>
          </Link>

          {/* Center nav · five group words, each opening the flyout.
              Hidden on mobile (MobileBottomNav + its More sheet cover
              it). Active state lights the group containing the
              current page: accent color + the 2px underline. */}
          <nav
            aria-label="Primary"
            className="hidden lg:flex items-center gap-0.5 lg:gap-1"
            onMouseLeave={scheduleClose}
            onMouseEnter={cancelClose}
          >
            {NAV_GROUPS.map((g) => {
              const active = isGroupActive(pathname, g);
              const open = openGroup === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-expanded={open}
                  aria-controls={open ? "gm-nav-flyout" : undefined}
                  onClick={() => {
                    setOpenGroup(open ? null : g.id);
                    if (!open) track("nav_group_open", { group: g.id });
                  }}
                  onMouseEnter={() => {
                    cancelClose();
                    setOpenGroup(g.id);
                  }}
                  className={[
                    "hdr-nav relative inline-flex items-center px-2 lg:px-2.5 py-1.5 rounded-md font-mono text-[12px] lg:text-xs uppercase tracking-[0.18em] transition-colors whitespace-nowrap",
                    // PRIMARY, not secondary. The header is 42% glass over
                    // whatever is scrolling underneath, and on the vendor
                    // grid that is full-bleed shop artwork: measured against
                    // the real pixels behind them, secondary nav words hit
                    // 2.90:1 (dark) and 2.95:1 (light). Glass chrome earns
                    // its legibility from the TEXT, not from a denser pane —
                    // going the other way and thickening the glass to ~85%
                    // would have to stop being glass to get there. At
                    // primary these measure 6.5:1 and 9.0:1 with the frost
                    // untouched. The nav stays quiet through size and the
                    // 12px mono treatment, which is where "quiet" belonged.
                    // The ACTIVE word is primary ink and lets the 2px accent
                    // rule under it carry "you are here" on its own. Accent
                    // text on this glass measures 4.15:1 over dark shop
                    // artwork even after --accent-ink was darkened, and 12px
                    // mono gets no large-text exemption. The underline is
                    // the stronger indicator anyway; the colour was
                    // duplicating it at the cost of legibility. Hover keeps
                    // the accent, because a hover state is transient and
                    // user-initiated.
                    open
                      ? "text-[var(--accent-ink)]"
                      : "text-[var(--text-primary)] hover:text-[var(--accent-ink)] hover:bg-[var(--bg-elevated)]/60",
                  ].join(" ")}
                >
                  {t(`nav.${g.id}`)}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-2.5 lg:left-3 right-2.5 lg:right-3 -bottom-0.5 h-[2px] rounded-full bg-[var(--accent)]"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right cluster · BTC price chip + ThemeToggle + Support
              + primary CTA. The price chip (2026-05-20 audit) is
              sticky ambient context across every page · extends the
              /stack StickyScoreBar precedent ("price + verdict
              always visible") to the rest of the site. Hidden on
              the very smallest mobiles to avoid crowding the
              existing nav cluster. */}
          {/* gap-1 below sm: the B5 palette trigger added ~33px to
              this row and 375px viewports overflowed by exactly that
              (mobile audit 2026-07-08) · the xs reclaims below keep
              every control visible. */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Ambient BTC price is useful but secondary to Support (the actual
                funding mechanism). 2xl+, not xl: at exactly 1280-1374px the
                chip + full nav labels + Support text + CTA sum to ~1,374px of
                nowrap content and overflow the viewport (same bug family as
                the 1440px Safari overflow, audit 2026-06-12 · measured
                scrollWidth 1374 at vw 1280). */}
            {pathname !== "/" && (
              <div className="hidden 2xl:block">
                <HeaderBtcPrice />
              </div>
            )}
            {/* Arcade chips stay off the spend homepage: a bitcoin.org
                Shop-online referral is not asked to keep a streak. */}
            {pathname !== "/" && (
              <div className="hidden xl:flex items-center gap-1.5">
                <HeaderStreakChip />
                <HeaderDailiesChip />
              </div>
            )}
            {/* Palette trigger · dispatches gm:palette (the always-
                mounted CommandPalette in the root layout listens).
                Icon-only in the tight bands (header overflow audits
                2026-06-12), kbd hint at lg+. */}
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("gm:palette"))
              }
              aria-label={t("nav.searchAria")}
              title="Search (Cmd+K)"
              className="inline-flex items-center gap-1.5 h-11 min-w-11 sm:min-w-0 px-2 sm:h-8 rounded-md border border-transparent text-[var(--text-primary)] hover:text-[var(--accent-ink)] hover:border-[var(--border-subtle)] transition-colors"
            >
              {/* 19px on phones · the 13px glyph read as a speck on
                  iPhone Safari (operator report 2026-07-11). */}
              <span aria-hidden className="text-lg sm:text-sm leading-none">⌕</span>
              <kbd
                aria-hidden
                className="hidden lg:inline font-mono t-xs uppercase tracking-widest"
              >
                ⌘K
              </kbd>
            </button>
            <ThemeToggle />
            <button
              type="button"
              onClick={() => {
                setSupportOpen(true);
                track("support_open", { source: "header" });
              }}
              className="inline-flex items-center justify-center gap-1.5 px-2 sm:px-3 h-11 sm:h-9 min-w-11 sm:min-w-[36px] rounded-md border border-[var(--border-subtle)] text-[var(--text-primary)] hover:text-[var(--accent-ink)] hover:border-[var(--accent)]/45 transition-colors"
              aria-label={t("nav.supportAria")}
              title={t("nav.supportAria")}
            >
              <span
                aria-hidden
                style={{ fontFamily: "system-ui, sans-serif" }}
                className="text-lg sm:text-base leading-none"
              >
                {"⚡︎"}
              </span>
              {/* A lightning bolt tells a new visitor nothing — not what it
                  does, not that it is even a control. The word ships from lg
                  up, paid for by demoting the theme toggle's own label to
                  2xl (a sun icon is self-evident; a bolt is not). Measured at
                  1280 and 1024 after the swap: no header overflow. */}
              <span className="micro-label hdr-nav hidden lg:inline">
                {t("nav.support")}
              </span>
            </button>

            {/* Flagship CTA · context-aware so the action always
                pushes toward the network-effect engine (the vendor
                directory). On every tool page the orange pill sends
                visitors back to /, where they can browse vendors
                and potentially share specific /v/[slug] links · the
                viral loop. On / itself a "Browse vendors" CTA would
                be redundant (visitor is already on the directory),
                so we swap to "+ Submit a vendor" → /submit · the
                next natural action for someone reading the directory
                who realizes they (or someone they know) qualifies.
                Kept the ctaSlot prop as an override path for any
                future page that needs a sharper primary action. */}
            {ctaSlot ??
              (pathname === "/" ? (
                <Link
                  href="/submit"
                  className="hdr-cta inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3.5 h-11 sm:h-9 rounded-md bg-[var(--accent)] text-black font-mono t-xs sm:text-xs uppercase tracking-[0.18em] font-semibold hover:bg-[var(--accent-hover)] transition-all"
                >
                  {/* Decorative glyph yields below sm · part of the 375px
                      right-cluster overflow fix (a11y/UX audit 2026-07-11:
                      scrollWidth 385 at vw 375). */}
                  <span aria-hidden className="hidden sm:inline">+</span>
                  <span className="hidden 2xl:inline">{t("nav.submitVendor")}</span>
                  <span className="2xl:hidden">{t("nav.submit")}</span>
                  <span aria-hidden className="hidden sm:inline">→</span>
                </Link>
              ) : (
                <Link
                  href="/"
                  className="hdr-cta inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3.5 h-11 sm:h-9 rounded-md bg-[var(--accent)] text-black font-mono t-xs sm:text-xs uppercase tracking-[0.18em] font-semibold hover:bg-[var(--accent-hover)] transition-all"
                >
                  <span className="hidden 2xl:inline">{t("nav.spendBitcoin")}</span>
                  <span className="2xl:hidden">{t("nav.vendors")}</span>
                  <span aria-hidden className="hidden sm:inline">→</span>
                </Link>
              ))}

            {/* These two quiet utility links were previously shown at 2xl+
                to avoid overflowing the header on wide-but-not-ultrawide
                desktops (especially noticeable in Safari due to font
                rendering differences). They have now been fully removed
                from the desktop header to guarantee a clean, non-wide
                experience on all browsers and screen sizes (including
                16" MacBooks in Safari).

                "Get alerts" remains easily reachable via the prominent
                CTA on /stack and the floating StickySubscribeChip.
                "Not Financial Advice" remains in the footer + via the
                Disclaimer modal (opened from the Support flow or /about). */}
            {/* (Previously: hidden 2xl:inline-flex for both) */}
          </div>
        </div>

        {/* ── The flyout · full-width panel anchored under the sticky
            bar. Large-type primaries with plain-English subtitles on
            the left, the small mono long tail on the right. Rendered
            only while open (no hidden DOM), desktop only. */}
        {flyout && (
          <div
            id="gm-nav-flyout"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            className="nav-flyout hidden md:block absolute inset-x-0 top-full glass-panel border-b border-[var(--border-subtle)]/40"
          >
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7 flex items-start gap-14">
              <div className="grid content-start gap-0.5 min-w-0">
                <div className="micro-label text-[var(--text-tertiary)] mb-2">
                  {t(`nav.${flyout.id}`)}
                </div>
                {flyout.primary.map((l) => (
                  <Link
                    key={l.label}
                    href={l.href}
                    onClick={() => setOpenGroup(null)}
                    className="group/f py-1.5 rounded-md"
                  >
                    <span className="text-lg lg:text-xl font-semibold text-[var(--text-primary)] group-hover/f:text-[var(--accent-ink)] transition-colors">
                      {NAV_LINK_KEY[l.href] ? t(NAV_LINK_KEY[l.href]) : l.label}
                    </span>
                    {(NAV_SUB_KEY[l.href] || l.sub) && (
                      <span className="flyout-sub block text-sm text-[var(--text-tertiary)] mt-0.5">
                        {NAV_SUB_KEY[l.href] ? t(NAV_SUB_KEY[l.href]) : l.sub}
                      </span>
                    )}
                  </Link>
                ))}
                {flyout.id === "arcade" && (
                  <div className="micro-label mt-3 text-[var(--accent-ink)]">
                    WEN + Trail + Gauntlet #{gauntletNumber(Date.now())}
                    are open · today's dailies
                  </div>
                )}
              </div>
              {flyout.secondary.length > 0 && (
                <div className="grid content-start gap-2.5 pt-7 shrink-0">
                  {flyout.secondary.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setOpenGroup(null)}
                      className="micro-label flyout-more text-[var(--text-secondary)] hover:text-[var(--accent-ink)] transition-colors whitespace-nowrap"
                    >
                      {NAV_LINK_KEY[l.href] ? t(NAV_LINK_KEY[l.href]) : l.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Skip-link target · tabIndex={-1} makes it programmatically
          focusable (Safari won't move focus to a bare id anchor).
          Zero-size, so the focus ring never paints visibly. */}
      <div id="main" tabIndex={-1} className="outline-none" />

      <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />
    </>
  );
}
