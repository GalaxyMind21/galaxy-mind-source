"use client";

// Floating "Get alerts" chip in the bottom-right. Appears after
// scroll, dismissable (LS-gated for 30 days), expands inline into a
// compact one-row subscribe form on click. Companion to the
// inline-at-peak-interest prompts on /stack, /, /treasuries, /float ·
// this catches users who scrolled past those prompts and want a
// persistent low-friction option.
//
// Position: bottom-right at z-30 on desktop. On mobile the chip is
// pushed UP (bottom-24, ~96px) so it clears the MobileBottomNav (full-
// width fixed bar at z-40, ~56-60px tall + iOS safe-area inset on
// notched devices). Earlier comment claimed "z-40 nav means chip
// won't overlap" — wrong, z-index is paint order not collision
// avoidance · audit 2026-05-22 caught this. Easter-egg overlays sit
// at z-50+ so they always win.
//
// Page-aware: derives the surface from pathname so a chip on /stack
// pre-selects notifyOnTierChange, on /treasuries pre-selects
// notifyOnMnavCheap, etc. Pages with no specific surface fall back
// to the new-vendor digest (the widest-audience default).
//
// Captcha: same lazy-Turnstile pattern as AlertSubscribeCompact and
// InlineSubscribePrompt · loads only when the chip is expanded AND
// the email input is focused, so it's invisible until someone is
// actually engaging with the form.

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { track } from "@vercel/analytics";
import { stripLocalePrefix } from "@/lib/i18n";

const TURNSTILE_SITE_KEY: string | undefined =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type SourceCfg = {
  source: "stack" | "treasuries" | "float" | "vendors";
  headline: string;
  pref: string;
};

const STACK: SourceCfg = {
  source: "stack",
  headline: "Get the Bitcoin Buying Gauge by email",
  pref: "notifyOnTierChange",
};
const TREASURIES: SourceCfg = {
  source: "treasuries",
  headline: "Get an email when a treasury goes cheap",
  pref: "notifyOnMnavCheap",
};
const FLOAT: SourceCfg = {
  source: "float",
  headline: "Get an email when the float crosses a milestone",
  pref: "notifyOnFloatMilestone",
};
const VENDORS: SourceCfg = {
  source: "vendors",
  headline: "Get the weekly new-merchant digest",
  pref: "notifyOnNewVendors",
};

function pathToCfg(path: string): SourceCfg {
  if (path.startsWith("/stack")) return STACK;
  if (path.startsWith("/treasuries")) return TREASURIES;
  if (path.startsWith("/float")) return FLOAT;
  if (path.startsWith("/hashrate")) return FLOAT;
  // Catalyst/SEO pages (review 2026-06-11) · these visitors searched a
  // BUYING question or a TREASURY question, and the merchant digest
  // was a value-prop mismatch at peak interest. Route gauge-intent
  // pages to the gauge alert, treasury-intent pages to the mNAV alert.
  if (
    path.startsWith("/should-i-buy-bitcoin") ||
    path.startsWith("/is-it-too-late-to-buy-bitcoin") ||
    path.startsWith("/how-to-buy-bitcoin") ||
    path.startsWith("/bitcoin-halving-countdown")
  ) {
    return STACK;
  }
  if (
    path.startsWith("/mstr-vs-bitcoin") ||
    path.startsWith("/ibit-vs-mstr") ||
    path.startsWith("/cheapest-bitcoin-treasury") ||
    path.startsWith("/is-") // the four /is-X-overvalued verdict pages
  ) {
    return TREASURIES;
  }
  return VENDORS;
}

// Versioned dismiss key. The owner asked to bring the floating signup
// back (2026-06-03); it was never unmounted, but a prior × / "Not now"
// click sets a 30-day flag that hides it on that browser. Bumping the
// `:v2` suffix invalidates old `...dismissedAt` flags so the chip
// reappears once for everyone who'd dismissed it; re-dismissal writes
// the new key going forward (the 30-day hide still works).
const LS_DISMISSED_AT = "gm:sticky-subscribe:dismissedAt:v2";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Surfaces after a scroll so it appears post-engagement, not on page
// load. History: 600 → 400 (2026-06-03, "more present" per owner) →
// 800 (mobile UX audit 2026-07-13). At 400 on / the chip revealed over
// the hero ~1.5 screens BEFORE the search box / first vendor card
// (which sit ~2000px down on a 375px phone), asking for an email before
// a single merchant was seen. 800 keeps it present without pre-empting
// the primary task; on / it also yields to the vendor grid via the
// occlusion guard below.
const SCROLL_THRESHOLD_PX = 800;

// Funnels where a floating merchant-digest ask actively competes with
// the page's own primary CTA and is usually the wrong intent (games are
// not a newsletter surface). The chip is suppressed entirely here (UX
// audit 2026-07-13) rather than relying on per-element occlusion tags —
// e.g. on /submit it otherwise floats over the "Submit for review"
// button at the highest-intent moment.
const FUNNEL_PREFIXES = [
  "/submit",
  "/arcade",
  "/gauntlet",
  "/runner",
  "/horizon",
  "/wen",
  "/super-saylor",
  "/chop",
  "/trail",
  "/bitcoin-kart",
  "/hashrate",
];
function isFunnelPath(path: string): boolean {
  const p = stripLocalePrefix(path);
  // Homepage catalog: the floating chip occludes merchants and is a
  // third email ask. One subscribe lives below the grid.
  if (p === "/") return true;
  return FUNNEL_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; pending: boolean }
  | { kind: "error"; message: string };

export function StickySubscribeChip() {
  const pathname = usePathname() ?? "/";
  const cfg = pathToCfg(pathname);

  const [visible, setVisible] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  // True while any [data-occlusion-sensitive] element (interactive
  // panels the floating chip would cover · e.g. the /stack instrument
  // sliders) is in the viewport. The chip yields rather than sitting
  // on top of controls (review 2026-06-12). An expanded form never
  // hides · we don't interrupt an in-progress signup.
  const [occluded, setOccluded] = useState(false);
  // True while the InstallNudge is up · one floating ask at a time (B8b).
  const [floatingAskActive, setFloatingAskActive] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [activated, setActivated] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      setVisible(false);
      return;
    }
    try {
      const raw = window.localStorage.getItem(LS_DISMISSED_AT);
      const ts = raw ? Number(raw) : 0;
      if (Number.isFinite(ts) && ts > 0 && Date.now() - ts < DISMISS_TTL_MS) {
        setVisible(false);
        return;
      }
    } catch {
      /* privacy mode · best-effort */
    }
    function onScroll() {
      if (window.scrollY >= SCROLL_THRESHOLD_PX) {
        setVisible(true);
        window.removeEventListener("scroll", onScroll);
      }
    }
    if (window.scrollY >= SCROLL_THRESHOLD_PX) {
      setVisible(true);
    } else {
      setVisible(false);
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }
  }, []);

  // Detect already-loaded Turnstile + bfcache cleanup.
  useEffect(() => {
    if (typeof window !== "undefined" && window.turnstile) {
      setTurnstileReady(true);
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        widgetIdRef.current = null;
        setTurnstileToken(null);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Render Turnstile widget once activated + script ready.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !activated || !turnstileReady || !expanded) {
      return;
    }
    if (state.kind !== "idle" && state.kind !== "error") return;
    const container = turnstileContainerRef.current;
    if (!container || !window.turnstile) return;
    if (widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
      return;
    }
    widgetIdRef.current = window.turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      size: "flexible",
      callback: (token) => setTurnstileToken(token),
      "error-callback": () => setTurnstileToken(null),
      "expired-callback": () => setTurnstileToken(null),
    });
  }, [activated, turnstileReady, expanded, state.kind]);

  // Collapsing unmounts the Turnstile container, so the remembered
  // widget id now points at a destroyed DOM node. The render effect
  // above short-circuits on a truthy id — it resets that dead widget and
  // returns WITHOUT rendering into the freshly-mounted container — so
  // without this the captcha never paints again, the token stays null,
  // and "Go" is disabled for the rest of the page session. Collapse is
  // easy to hit: the ✕ button, or just navigating (the effect below
  // collapses on every pathname change). This component is the only one
  // of the four subscribe surfaces that can unmount its own container,
  // which is why only it needs this; AlertSubscribe clears the same ref
  // for the bfcache case and this file already copied that half.
  useEffect(() => {
    if (expanded) return;
    widgetIdRef.current = null;
    setTurnstileToken(null);
  }, [expanded]);

  // Surface changes (pathname switch) collapse the form back to a chip.
  useEffect(() => {
    setExpanded(false);
    setState({ kind: "idle" });
  }, [pathname]);

  // One floating ask at a time (B8b) · yield while the InstallNudge is
  // up. Read the <html> attribute for the initial state (the nudge may
  // already be visible when this chip mounts on a client nav) and listen
  // for gm:floating-ask for changes.
  useEffect(() => {
    setFloatingAskActive(
      document.documentElement.hasAttribute("data-floating-ask"),
    );
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { active?: boolean } | undefined;
      setFloatingAskActive(!!d?.active);
    };
    window.addEventListener("gm:floating-ask", on);
    return () => window.removeEventListener("gm:floating-ask", on);
  }, []);

  // Occlusion watcher · track which sensitive elements are currently
  // intersecting (IO only reports CHANGED entries, so keep a Set).
  useEffect(() => {
    const els = document.querySelectorAll("[data-occlusion-sensitive]");
    if (els.length === 0) {
      setOccluded(false);
      return;
    }
    const inView = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inView.add(e.target);
          else inView.delete(e.target);
        }
        setOccluded(inView.size > 0);
      },
      // threshold 0 = "any pixel intersecting" (UX audit 2026-07-13).
      // A percentage threshold silently FAILS for targets taller than
      // the viewport: the homepage vendor grid is ~31,000px, so a
      // 0.05 threshold (needs ~1,550px of it visible) could never fire
      // against an 812px screen — the chip would still float over the
      // grid it's supposed to yield to. threshold 0 works for both the
      // small /stack sliders and the full-page grid.
      { threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);

  const captchaBlock = !!TURNSTILE_SITE_KEY && activated && !turnstileToken;

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(LS_DISMISSED_AT, String(Date.now()));
    } catch {
      /* best-effort */
    }
    track("sticky_subscribe_dismissed", { source: cfg.source });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || state.kind === "submitting") return;
    if (captchaBlock) return;
    setState({ kind: "submitting" });
    track("sticky_subscribe_attempt", { source: cfg.source });
    try {
      const r = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ...(turnstileToken ? { turnstileToken } : {}),
          prefs: { [cfg.pref]: true },
          // Source threads through DOI so the confirmation email +
          // post-confirm CTA route the user back to the surface they
          // came from (fixed 2026-05-21 · was hardcoded /stack).
          source: cfg.source,
        }),
      });
      const body = (await r.json()) as {
        ok: boolean;
        kind?: "pending" | "added";
        error?: string;
      };
      if (body.ok) {
        track("sticky_subscribe_success", {
          source: cfg.source,
          flow: body.kind ?? "unknown",
        });
        setState({ kind: "success", pending: body.kind === "pending" });
        setEmail("");
      } else {
        setState({ kind: "error", message: body.error ?? "Try again." });
      }
    } catch {
      setState({ kind: "error", message: "Network error." });
    }
  }

  // Never float over a funnel's own primary CTA (submit form, game
  // cabinets). Placed after all hooks so hook order stays stable.
  if (isFunnelPath(pathname)) return null;
  if (visible !== true) return null;
  // Yield to interactive panels the chip would sit on top of · but
  // never mid-signup (expanded form stays).
  if (occluded && !expanded) return null;
  // Yield to the InstallNudge · one floating ask at a time (B8b), but
  // never interrupt an in-progress signup (expanded form stays).
  if (floatingAskActive && !expanded) return null;

  if (!expanded) {
    return (
      <div
        // bottom clears the MobileBottomNav + the iOS home-indicator
        // inset. Was a flat bottom-24 (96px) with NO safe-area term
        // (UX audit 2026-07-13) — on notched iPhones it cleared the nav
        // by only ~8px; the env() term restores real clearance.
        className="fixed bottom-[calc(var(--mobile-nav-clearance)+2.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-4 right-4 z-30 flex items-center gap-1"
        role="region"
        aria-label="Get email alerts"
      >
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            track("sticky_subscribe_expanded", { source: cfg.source });
          }}
          className="micro-label inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-[var(--accent)] text-black font-semibold lit-primary hover:lit-primary transition-shadow"
        >
          <span aria-hidden>✉</span>
          Get the signal
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss the alerts chip for 30 days"
          className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] text-base leading-none"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div
      // Matches the collapsed chip's safe-area-aware bottom offset.
      className="fixed bottom-[calc(var(--mobile-nav-clearance)+2.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-4 right-4 z-30 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-[var(--accent)]/40 bg-[var(--bg-elevated)] shadow-[0_8px_40px_rgba(0,0,0,0.6)] p-4"
      role="dialog"
      aria-label="Subscribe to alerts"
    >
      {/* Lazy-load Turnstile when expanded + email focused. */}
      {TURNSTILE_SITE_KEY && activated && !turnstileReady && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="lazyOnload"
          onReady={() => setTurnstileReady(true)}
        />
      )}

      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="text-sm text-[var(--text-secondary)] leading-snug">
          <span className="text-[var(--accent-ink)]">✉</span> {cfg.headline}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Collapse"
          className="text-[var(--text-tertiary)] hover:text-[var(--accent-ink)] text-xs font-mono flex-shrink-0 mt-0.5"
        >
          ✕
        </button>
      </div>
      {state.kind === "success" ? (
        <div className="text-sm text-[var(--text-secondary)] py-2">
          <span className="text-[var(--accent-ink)] font-semibold">✓ </span>
          {state.pending
            ? "Check your inbox to confirm."
            : "You're in. Watch for the next alert."}
        </div>
      ) : (
        <>
          <form onSubmit={submit} className="flex items-stretch gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setActivated(true)}
              placeholder="you@example.com"
              maxLength={254}
              aria-label="Email address"
              className="flex-1 min-w-0 px-3 py-2 rounded-md bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] focus:border-[var(--accent)] focus:outline-none text-[var(--text-primary)] text-sm"
            />
            <button
              type="submit"
              disabled={
                state.kind === "submitting" || !email.trim() || captchaBlock
              }
              className="micro-label px-3 py-2 rounded-md bg-[var(--accent)] text-black font-semibold hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              {state.kind === "submitting" ? "…" : "Go →"}
            </button>
          </form>
          {/* Captcha container · only renders when activated + key set */}
          {TURNSTILE_SITE_KEY && activated ? (
            <div ref={turnstileContainerRef} className="mt-2" />
          ) : null}
        </>
      )}
      {state.kind === "error" ? (
        <div className="mt-2 text-xs text-[var(--warning)]">{state.message}</div>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-3 t-xs text-[var(--text-tertiary)]">
        <span>No newsletter. Unsubscribe anytime.</span>
        <button
          type="button"
          onClick={dismiss}
          className="hover:text-[var(--accent-ink)] font-mono uppercase tracking-widest"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
