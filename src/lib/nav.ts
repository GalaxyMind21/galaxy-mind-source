/* =====================================================================
 * nav.ts · the site's information architecture, in one place
 * (nav rethink 2026-07-08).
 *
 * The site outgrew a flat link row: four instrument links hid /today,
 * /map, the Arcade, and every learn page from new visitors. The fix
 * is the Apple pattern · FEWER top-level words, each opening a calm
 * flyout with room for plain-English subtitles · not more links.
 *
 * Five groups tell the whole story:
 *   Spend        · the network-effect core (directory, map, submit)
 *   Mine         · rent USA hashrate (operator 2026-08-24)
 *   Instruments  · the live dashboards
 *   Arcade       · the games
 *   Learn        · explainers and reference
 *
 * BOTH navs consume this file (SiteHeader flyouts on desktop, the
 * MobileBottomNav "More" sheet on phones), so they can never
 * disagree. Adding a page = adding a line here, never widening the
 * header. Primary items get large type + a subtitle in the flyout;
 * secondary items render as the small mono column.
 * ===================================================================== */

import { NAV_SUB, NAV_LABEL } from "@/lib/hashrate-copy";
import { stripLocalePrefix } from "@/lib/i18n";

export type NavLink = {
  href: string;
  label: string;
  /** One-line plain-English subtitle · shown under primary links. */
  sub?: string;
};

export type NavGroup = {
  id: "spend" | "mine" | "instruments" | "arcade" | "learn";
  label: string;
  /** Large-type destinations · keep to 2-4 per group. */
  primary: NavLink[];
  /** Small mono column · the long tail. */
  secondary: NavLink[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "spend",
    label: "Spend",
    primary: [
      {
        href: "/",
        label: "Vendor directory",
        sub: "Every verified shop that takes bitcoin",
      },
      {
        href: "/map",
        label: "Merchants map",
        sub: "Countries of listed online shops",
      },
      {
        href: "/submit",
        label: "Submit your shop",
        sub: "Get verified, get found",
      },
    ],
    secondary: [
      {
        href: "/online-stores-that-accept-bitcoin",
        label: "Online stores that accept bitcoin",
      },
      { href: "/spend-bitcoin-on", label: "Spend by category" },
      { href: "/spend-and-replace", label: "Spend and replace" },
      { href: "/how-to-accept-bitcoin", label: "How to accept bitcoin" },
      { href: "/badge", label: "Your verified badge" },
      {
        href: "/spend-bitcoin-in-latin-america",
        label: "Latin America",
      },
    ],
  },
  {
    id: "mine",
    label: "Mine",
    primary: [
      {
        href: "/hashrate",
        // Label + sub live in the gated copy module.
        label: NAV_LABEL,
        sub: NAV_SUB,
      },
      {
        href: "/hashrate/how-to-rent",
        label: "How to rent",
        sub: "Point a USA ASIC at your pool, step by step",
      },
      {
        href: "/hashrate/agents",
        label: "Rent as an agent",
        sub: "Quote and handoff · zero custody",
      },
    ],
    secondary: [
      { href: "/solo-mining-calculator", label: "Solo mining odds" },
    ],
  },
  {
    id: "instruments",
    label: "Instruments",
    primary: [
      {
        href: "/today",
        label: "Today in Bitcoin",
        sub: "The daily briefing · four live numbers",
      },
      {
        href: "/stack",
        label: "Buying Gauge",
        sub: "Should I buy bitcoin now? 0-100, live",
      },
      {
        href: "/float",
        label: "Supply Clock",
        sub: "How much bitcoin is left to buy",
      },
    ],
    secondary: [
      { href: "/treasuries", label: "Treasury desk · mNAV" },
      { href: "/fit", label: "Allocation engine" },
      { href: "/pulse", label: "Weekly pulse + archive" },
      { href: "/embed", label: "Embed the widgets" },
      { href: "/status", label: "System status" },
    ],
  },
  {
    id: "arcade",
    label: "Arcade",
    primary: [
      {
        href: "/arcade",
        label: "The Arcade",
        sub: "All eight games, one door",
      },
      {
        href: "/bitcoin-kart",
        label: "Bitcoin Kart",
        sub: "NEW · 3D kart racer · Team Bitcoin vs Team Fiat",
      },
      {
        href: "/super-saylor",
        label: "Super Saylor",
        sub: "The flagship · 21 levels of bitcoin history",
      },
      {
        href: "/chop",
        label: "CHOP",
        sub: "NEW · slice the live chain to the beat",
      },
      {
        href: "/trail",
        label: "The HODL Trail",
        sub: "Survive 15 years of bitcoin history",
      },
      {
        href: "/wen",
        label: "WEN",
        sub: "Daily puzzle · guess wen the chart happened",
      },
      {
        href: "/gauntlet",
        label: "The Bitcoin Gauntlet",
        sub: "Trade bitcoin history blind · beat the DCA bot",
      },
      {
        href: "/runner",
        label: "Node Runner",
        sub: "One tap · actual candles as terrain",
      },
      {
        href: "/horizon",
        label: "Timechain",
        sub: "One-tap block stacker on the halving clock",
      },
    ],
    secondary: [],
  },
  {
    id: "learn",
    label: "Learn",
    primary: [
      {
        href: "/learn",
        label: "All guides",
        sub: "Buy, spend, accept and mine, step by step",
      },
      {
        href: "/glossary",
        label: "Glossary",
        sub: "Bitcoin vocabulary, term by term",
      },
      {
        href: "/bitcoin-halving-countdown",
        label: "Halving countdown",
        sub: "Days and blocks to the next supply cut",
      },
    ],
    secondary: [
      { href: "/how-to-buy-bitcoin", label: "How to buy bitcoin" },
      { href: "/gross-vs-net-mnav", label: "Gross vs net mNAV" },
      { href: "/what-is-amplification", label: "What is Amplification" },
      { href: "/how-many-businesses-accept-bitcoin", label: "How many take bitcoin?" },
      { href: "/methodology", label: "Methodology" },
      { href: "/faq", label: "FAQ" },
      { href: "/about", label: "About" },
    ],
  },
];

/** Group active-state · lights the trigger when the visitor is on any
 *  page inside it. "/" only matches exactly (else home wins always). */
export function isGroupActive(pathname: string, group: NavGroup): boolean {
  const path = stripLocalePrefix(pathname);
  const links = [...group.primary, ...group.secondary];
  return links.some((l) =>
    l.href === "/"
      ? path === "/"
      : path === l.href || path.startsWith(`${l.href}/`),
  );
}

/**
 * Routes that next.config.ts rewrites to a STATIC HTML FILE
 * (public/super-saylor.html, public/bitcoin-kart/index.html,
 * public/chop/index.html, public/six-deep/index.html).
 *
 * They have no RSC representation, so Next's Link prefetch asks the
 * server for a payload it can only answer with a 404 — measured on
 * production 2026-08-30 as THREE failed requests on EVERY page, since
 * SiteFooter links three of them and the footer is in the root layout.
 * Each response is `cache-control: no-store`, so the browser repeats
 * them on every single view and nothing is ever reused.
 *
 * Prefetch cannot help these routes even when it succeeds: the click is
 * a full document load either way. So the answer is prefetch={false},
 * which in Next 16 means "never, on viewport or on hover" (see
 * node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md).
 *
 * Add a cabinet that ships as a static bundle? Add it here too.
 */
export const STATIC_HTML_ROUTES = [
  "/super-saylor",
  "/bitcoin-kart",
  "/chop",
  "/six-deep",
] as const;

/** True when href points at a static-HTML rewrite, so it must not prefetch. */
export function isStaticHtmlRoute(href: string): boolean {
  const path = href.split(/[?#]/)[0].replace(/\/+$/, "");
  return (STATIC_HTML_ROUTES as readonly string[]).includes(path);
}
