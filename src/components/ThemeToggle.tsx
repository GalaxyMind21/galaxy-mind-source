"use client";

/* =====================================================================
 * ThemeToggle · light/dark theme switcher
 *
 * Per user request: visitors with a hard time reading lighter text on
 * dark backgrounds need a light mode option. The brand stays
 * recognizable in both modes (Bitcoin orange accent unchanged, brass
 * vocabulary preserved with warm palette swaps in light mode).
 *
 * Implementation:
 *   - Theme state lives in `localStorage.gm_theme` ("light" | "dark")
 *   - On mount, applies the stored theme OR system preference
 *   - Toggle flips the value + writes to LS + applies to <html>
 *   - The CSS variables in globals.css have a [data-theme="light"]
 *     override block · setting the attribute swaps the entire palette
 *   - Transitions on bg/color/border (220ms) prevent jarring flashes
 *
 * Inline boot script: this component renders the toggle UI but the
 * INITIAL theme application happens via a tiny inline script in
 * layout.tsx (RootLayout) that runs BEFORE first paint. Otherwise
 * a flash of dark theme would appear before this client component
 * hydrates. See gm_apply_theme_pre_paint() comment in layout.tsx.
 *
 * Position: lives in SiteHeader's right cluster, between Support
 * and the flagship CTA. Icon-only on mobile, icon + label on lg+.
 * ===================================================================== */

import { useCallback, useEffect, useState } from "react";

const LS_KEY = "gm_theme";
type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function ThemeToggle() {
  // Default to "dark" for SSR stability · the inline script in
  // layout.tsx applies the actual theme pre-paint, then this hydrates
  // and reads the same LS key to stay in sync.
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  // Hydrate from LS on mount · matches whatever the pre-paint script
  // applied. Default is "dark" when no LS value is set · matches the
  // pre-paint script's behavior so the toggle UI agrees with the
  // applied theme. Visitors who explicitly toggle to light have that
  // preference persisted in LS.
  //
  // CRITICAL: also call applyTheme(resolved) here so the DOM and the
  // React state are guaranteed in sync after hydration. Without this,
  // if the pre-paint script's DOM mutation was lost (bf-cache restore,
  // SPA navigation that didn't re-run the head script, hydration
  // attribute reconciliation, browser DOM persistence), the toggle
  // button could say "Switch to dark" while the page is actually
  // already in dark mode (or vice versa). Re-applying on hydration
  // is idempotent and cheap, and it's the only layer that runs after
  // every client-side navigation/bfcache-restore on the SPA.
  useEffect(() => {
    let resolved: Theme = "dark";
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored === "light" || stored === "dark") {
        resolved = stored;
      }
      // No stored preference · stay on the "dark" default.
    } catch {
      /* private mode · keep dark default */
    }
    setTheme(resolved);
    applyTheme(resolved);
    setMounted(true);
  }, []);

  // Re-apply on bfcache restore (Safari/Firefox keep the page in
  // memory and fire `pageshow` with `event.persisted = true` instead
  // of re-running the pre-paint script). Without this, a user who
  // toggles to dark, navigates away, then hits Back can land on a
  // page where <html data-theme="light"> is still attached from the
  // restored DOM. Listening for pageshow with persisted=true gives
  // us a hook to re-sync that case too.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      try {
        const stored = localStorage.getItem(LS_KEY);
        const resolved: Theme =
          stored === "light" ? "light" : "dark";
        applyTheme(resolved);
        setTheme(resolved);
      } catch {
        applyTheme("dark");
        setTheme("dark");
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "light" ? "dark" : "light";
      try {
        localStorage.setItem(LS_KEY, next);
      } catch {
        /* silent */
      }
      applyTheme(next);
      return next;
    });
  }, []);

  // Render the real button on the server too. A blank placeholder made
  // the control look missing on phones (the sun sits in a 36px cell
  // next to the lightning bolt; an empty bordered box reads as broken).
  // Default theme is dark, so the sun is the honest SSR icon; a stored
  // light preference swaps to the moon after mount. Disabled until then
  // so a pre-hydrate tap cannot disagree with the pre-paint script.
  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!mounted}
      aria-label={
        isLight ? "Switch to dark theme" : "Switch to light theme"
      }
      title={isLight ? "Switch to dark theme" : "Switch to light theme"}
      className="inline-flex items-center justify-center gap-1.5 px-2 sm:px-3 h-11 sm:h-9 min-w-11 sm:min-w-[36px] rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent-ink)] hover:border-[var(--accent)]/45 transition-colors disabled:opacity-100"
    >
      {/* Sun icon when in dark mode (clicking switches to light) ·
          Moon icon when in light mode (clicking switches to dark).
          Pure SVG inline · no icon library dep. Sized 20px on phones ·
          16px was near-invisible on iPhone Safari (operator report
          2026-07-11). */}
      {isLight ? (
        <svg
          className="h-5 w-5 sm:h-4 sm:w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg
          className="h-5 w-5 sm:h-4 sm:w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
      {/* Word at 2xl+ only. It used to show from xl, but the header had no
          room for the Support label and a sun/moon icon needs a word far
          less than a lightning bolt does — a new visitor cannot guess what
          the bolt means, which is the whole reason Support got the space.
          Both controls keep title + aria-label at every size. */}
      <span className="micro-label hidden 2xl:inline">
        {isLight ? "Dark" : "Light"}
      </span>
    </button>
  );
}
