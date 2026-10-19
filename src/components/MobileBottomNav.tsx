"use client";

// Persistent bottom nav for mobile users.
//
// Nav rethink (2026-07-08): four direct tabs + a More sheet from
// lib/nav.ts. Play stays center (operator: games one thumb-tap away).
//
// 2026-08-24: Night Bench chrome (sentence case, glass, SVG glyphs)
// and a Mine tab → /hashrate, replacing Today in the tab row. Today
// remains in the More sheet. The 2026-08-13 rule still holds for
// copy: no wager register in sitewide chrome; Mine is a destination,
// not a pitch.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { readActiveStreak } from "@/lib/streak";
import { gauntletNumber } from "@/lib/gauntlet-day";
import { readDailyDone, countOpenDailies, nextOpenDaily, subscribeDailyStorage } from "@/lib/daily-state";
import { NAV_GROUPS } from "@/lib/nav";
import { useModalA11y } from "@/lib/use-modal-a11y";
import { stripLocalePrefix } from "@/lib/i18n";
import { useT } from "@/components/LocaleProvider";

type TabId = "spend" | "mine" | "play" | "buy";

type Route = {
  id: TabId;
  href: string;
  labelKey: string;
  match: (path: string) => boolean;
};

const ROUTES: Route[] = [
  {
    id: "spend",
    href: "/",
    labelKey: "mobile.spend",
    match: (p) =>
      p === "/" ||
      p.startsWith("/map") ||
      p.startsWith("/submit") ||
      p.startsWith("/v/") ||
      p.startsWith("/spend-and-replace") ||
      p.startsWith("/online-stores-that-accept-bitcoin") ||
      p.startsWith("/buy-coffee-with-bitcoin") ||
      p.startsWith("/spend-bitcoin-in") ||
      p.startsWith("/spend-bitcoin-on"),
  },
  {
    id: "mine",
    href: "/hashrate",
    labelKey: "mobile.mine",
    match: (p) => p.startsWith("/hashrate"),
  },
  {
    id: "play",
    href: "/arcade",
    labelKey: "mobile.play",
    match: (p) =>
      p.startsWith("/gauntlet") ||
      p.startsWith("/runner") ||
      p.startsWith("/horizon") ||
      p.startsWith("/wen") ||
      p.startsWith("/chop") ||
      p.startsWith("/trail") ||
      p.startsWith("/arcade") ||
      p.startsWith("/super-saylor") ||
      p.startsWith("/bitcoin-kart"),
  },
  {
    id: "buy",
    href: "/stack",
    labelKey: "mobile.buy",
    match: (p) => p.startsWith("/stack"),
  },
];

function TabGlyph({ id, active }: { id: TabId | "more"; active: boolean }) {
  const stroke = {
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden
      className={active ? "text-[var(--accent-ink)]" : undefined}
    >
      {id === "spend" && (
        <g {...stroke}>
          <path d="M7 10.5h10v8.2H7z" />
          <path d="M7 10.5 9 7h6l2 3.5" />
          <path d="M12 13.5v2.6" />
        </g>
      )}
      {id === "mine" && (
        <>
          <g {...stroke}>
            <path d="M7.2 20.4 13 10.6" />
            <path d="M8.6 8.2 13 10.6l6.4-2.6" />
            <path d="M13 10.6 17.4 14.4" />
          </g>
          <circle cx="17.35" cy="6.55" r="4.35" fill="var(--accent)" />
          <text
            x="17.35"
            y="8.55"
            textAnchor="middle"
            fontSize="7.2"
            fontWeight="700"
            fill="#12110F"
            fontFamily="system-ui, ui-sans-serif, sans-serif"
          >
            ₿
          </text>
        </>
      )}
      {id === "play" && (
        <path
          d="M8.5 6.5v11l10-5.5z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      )}
      {id === "buy" && (
        <g {...stroke}>
          <path d="M5.5 16.2a7.2 7.2 0 1 1 13 0" />
          <path d="M12 15.4 15.2 10" />
          <circle cx="12" cy="15.6" r="1.15" fill="currentColor" stroke="none" />
        </g>
      )}
      {id === "more" && (
        <g {...stroke}>
          <path d="M6 8h12" />
          <path d="M6 12h12" />
          <path d="M6 16h8" />
        </g>
      )}
    </svg>
  );
}

export function MobileBottomNav() {
  const pathname = stripLocalePrefix(usePathname() ?? "/");
  const { t } = useT();
  const [streak, setStreak] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dailiesOpen, setDailiesOpen] = useState(0);
  const [playHref, setPlayHref] = useState("/arcade");
  const sheetRef = useRef<HTMLDivElement>(null);
  useModalA11y(moreOpen, sheetRef, () => setMoreOpen(false));

  const [dayEpoch, setDayEpoch] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setDayEpoch((e) => e + 1), 60_000);
    const unsub = subscribeDailyStorage(() => setDayEpoch((e) => e + 1));
    return () => {
      window.clearInterval(id);
      unsub();
    };
  }, []);

  useEffect(() => {
    setStreak(readActiveStreak());
    setMoreOpen(false);
    try {
      const n = gauntletNumber(Date.now());
      const done = readDailyDone(n);
      setDailiesOpen(countOpenDailies(done));
      setPlayHref(nextOpenDaily(done, n)?.href ?? "/arcade");
    } catch {
      /* private mode · defaults stand */
    }
  }, [pathname, dayEpoch]);

  if (pathname === "/embed" || pathname.endsWith("/skeleton-preview")) {
    return null;
  }

  const moreActive = !ROUTES.some((r) => r.match(pathname));

  return (
    <>
      {/* Occupied height is --mobile-nav-clearance in globals.css. */}
      <nav
        className="mobile-tabbar lg:hidden fixed bottom-0 left-0 right-0 z-40"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
        aria-label="Primary navigation"
      >
        <ul className="grid grid-cols-5 max-w-md mx-auto">
          {ROUTES.map((r) => {
            const active = r.match(pathname);
            const isPlay = r.id === "play";
            const label = t(r.labelKey);
            const href = isPlay ? playHref : r.href;
            const showStreakBadge =
              r.id === "buy" && streak !== null && !active;
            const showDailiesBadge = isPlay && dailiesOpen > 0 && !active;
            return (
              <li key={r.id}>
                <Link
                  href={href}
                  onClick={() => track("mobile_nav_click", { route: href })}
                  className={`w-full flex flex-col items-center justify-center gap-1 py-2 transition-colors ${
                    active
                      ? "text-[var(--accent-ink)]"
                      : "text-[var(--text-secondary)]"
                  }`}
                  aria-current={active ? "page" : undefined}
                  aria-label={
                    showStreakBadge
                      ? `${label}. Daily streak: ${streak} days.`
                      : showDailiesBadge
                        ? `${label}. ${dailiesOpen} daily ${dailiesOpen === 1 ? "game" : "games"} open.`
                        : undefined
                  }
                >
                  <span className="relative inline-flex">
                    <TabGlyph id={r.id} active={active} />
                    {showStreakBadge && (
                      <span
                        aria-hidden
                        className="absolute -top-1.5 -right-2.5 inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded-full bg-[var(--accent)] t-xs font-sans font-bold leading-none text-black tabular-nums"
                      >
                        {streak}
                      </span>
                    )}
                    {showDailiesBadge && (
                      <span
                        aria-hidden
                        className="absolute -top-1.5 -right-2.5 inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded-full bg-[var(--accent)] t-xs font-sans font-bold leading-none text-black tabular-nums"
                      >
                        {dailiesOpen}
                      </span>
                    )}
                  </span>
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => {
                setMoreOpen(true);
                track("mobile_nav_click", { route: "more" });
              }}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              aria-current={moreActive ? "page" : undefined}
              className={`w-full flex flex-col items-center justify-center gap-1 py-2 transition-colors ${
                moreActive
                  ? "text-[var(--accent-ink)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              <TabGlyph id="more" active={moreActive} />
              <span>{t("mobile.more")}</span>
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="All pages"
        >
          <div
            className="absolute inset-0 glass-scrim"
            onClick={() => setMoreOpen(false)}
            aria-hidden
          />
          <div
            ref={sheetRef}
            tabIndex={-1}
            className="relative mt-auto max-h-[85vh] overflow-y-auto rounded-t-2xl glass-sheet border-x-0 border-b-0 px-6 pt-5 focus:outline-none"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="t-xs font-medium tracking-wide text-[var(--text-tertiary)]">
                All pages
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  aria-label="Close"
                  className="px-2.5 py-1 rounded-md border border-[var(--border-subtle)] t-xs text-[var(--text-secondary)]"
                >
                  Close
                </button>
              </div>
            </div>
            {/* Support is labelled here because the header only shows a
                bolt. Hashrate is the Mine tab — don't pitch it again. */}
            <div className="mb-6 rounded-xl border border-[var(--accent)]/40 bg-[var(--bg-elevated)] p-4">
              <div className="t-xs font-medium text-[var(--accent-ink)] mb-2">
                Support Galaxy Mind
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                Everything here is free to use and free to embed.
              </p>
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  window.dispatchEvent(new CustomEvent("gm:support"));
                }}
                className="mt-2 text-left text-sm text-[var(--accent-ink)] underline underline-offset-2 decoration-[var(--accent-ink)]/40"
              >
                Or zap sats over Lightning
              </button>
            </div>

            {NAV_GROUPS.map((g) => (
              <div key={g.id} className="mb-6">
                <div className="t-xs font-medium text-[var(--accent-ink)] mb-2">
                  {t(`nav.${g.id}`)}
                </div>
                <div className="grid gap-0.5">
                  {g.primary.map((l) => (
                    <Link
                      key={l.label}
                      href={l.href}
                      onClick={() => setMoreOpen(false)}
                      className="py-2"
                    >
                      <span className="text-base font-semibold text-[var(--text-primary)]">
                        {l.label}
                      </span>
                      {l.sub && (
                        <span className="block text-sm text-[var(--text-tertiary)]">
                          {l.sub}
                        </span>
                      )}
                    </Link>
                  ))}
                  {g.secondary.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setMoreOpen(false)}
                      className="py-2.5 t-xs text-[var(--text-secondary)]"
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
