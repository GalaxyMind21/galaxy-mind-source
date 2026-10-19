"use client";

/* =====================================================================
 * InstallNudge · the missing invitation (growth sprint 2026-07-10).
 *
 * The whole PWA is already built (manifest with display:standalone,
 * icons, apple-web-app flags, push service worker). The only thing
 * missing was asking · so nobody installs, and iOS Safari never offers
 * on its own. This fires the ask at the DELIGHT moment: right after a
 * game finishes, on a phone, to a returning player.
 *
 * Guardrails: shown at most once per 30 days, never when already
 * installed, only on phones, only after the player has finished >= 2
 * runs (engaged, not first-touch). iOS gets coached steps (no install
 * API exists there); Android/Chrome uses the beforeinstallprompt event.
 * ===================================================================== */

import { useEffect, useRef, useState } from "react";

const DISMISS_KEY = "gm:pwa:nudge"; // last-dismissed timestamp (ms)
const RUNS_KEY = "gm:arcade:runs"; // finished-run counter
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_RUNS = 2;
const SHOW_DELAY_MS = 1300; // let the death screen land first

type Mode = "ios" | "android";
type BipEvent = Event & { prompt: () => Promise<void> };

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone ===
      true
  );
}

// Narrow viewport · the nudge is a bottom sheet designed for phones.
// The real safety gate is the viable-install-path check below (an
// Android prompt actually fired, or genuine iOS) · so we don't also
// require a coarse pointer, which would exclude legitimate installs.
function isPhone(): boolean {
  return window.matchMedia("(max-width: 860px)").matches;
}

function isIOS(): boolean {
  const ua = navigator.userAgent || "";
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as Mac · treat touch-capable Mac as iOS.
  const iPadOS =
    navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1;
  return iOSDevice || iPadOS;
}

function recentlyDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const t = Number(raw);
    return Number.isFinite(t) && Date.now() - t < COOLDOWN_MS;
  } catch {
    return false;
  }
}

export function InstallNudge() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const deferredRef = useRef<BipEvent | null>(null);
  const shownRef = useRef(false);

  useEffect(() => {
    // Capture the Android install prompt as early as possible · it can
    // fire on page load, well before the delight event.
    const onBip = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BipEvent;
    };
    window.addEventListener("beforeinstallprompt", onBip);

    const onInstalled = () => {
      try {
        window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
      setVisible(false);
    };
    window.addEventListener("appinstalled", onInstalled);

    let timer: number | undefined;
    const onFinished = () => {
      let runs = MIN_RUNS;
      try {
        runs = Number(window.localStorage.getItem(RUNS_KEY) || "0") + 1;
        window.localStorage.setItem(RUNS_KEY, String(runs));
      } catch {
        /* private mode · treat as engaged */
      }
      if (shownRef.current || runs < MIN_RUNS) return;
      if (isStandalone() || !isPhone() || recentlyDismissed()) return;
      const canAndroid = deferredRef.current != null;
      const ios = isIOS();
      if (!canAndroid && !ios) return; // no viable install path
      shownRef.current = true;
      timer = window.setTimeout(() => {
        setMode(canAndroid ? "android" : "ios");
        setVisible(true);
      }, SHOW_DELAY_MS);
    };
    window.addEventListener("gm:arcade-finished", onFinished);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("gm:arcade-finished", onFinished);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  // One floating ask at a time (B8b · UX audit 2026-07-13): while this
  // nudge is up, tell the StickySubscribeChip to stand down, so a
  // returning player who finishes a game and then navigates to / doesn't
  // meet two stacked floating asks. The <html> attribute is the initial
  // state for a chip that mounts later (client nav); the event is the
  // live update.
  useEffect(() => {
    const active = visible && !!mode;
    const root = document.documentElement;
    if (active) root.setAttribute("data-floating-ask", "1");
    else root.removeAttribute("data-floating-ask");
    try {
      window.dispatchEvent(
        new CustomEvent("gm:floating-ask", { detail: { active } }),
      );
    } catch {
      /* noop */
    }
    return () => root.removeAttribute("data-floating-ask");
  }, [visible, mode]);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setVisible(false);
  }

  async function install() {
    const d = deferredRef.current;
    if (d) {
      try {
        await d.prompt();
      } catch {
        /* user dismissed the native sheet · fine */
      }
      deferredRef.current = null;
    }
    dismiss();
  }

  if (!visible || !mode) return null;

  return (
    <div
      role="dialog"
      aria-label="Add Galaxy Mind to your home screen"
      className="fixed inset-x-0 bottom-0 z-[70] px-3 pointer-events-none"
      style={{
        paddingBottom:
          "calc(var(--mobile-nav-clearance) + 0.875rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="pointer-events-auto mx-auto max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-[0_-8px_44px_-14px_rgba(0,0,0,0.7)]">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg font-mono text-lg font-bold text-black"
            style={{ background: "var(--accent)" }}
          >
            ₿
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono t-xs uppercase tracking-[0.2em] text-[var(--accent-ink)]">
              Keep the tape one tap away
            </p>
            <p className="mt-0.5 text-sm leading-snug text-[var(--text-secondary)]">
              {mode === "android"
                ? "Install Galaxy Mind for one-tap access to tomorrow's tape. No app store."
                : "Add Galaxy Mind to your home screen. No app store, no account."}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 shrink-0 rounded-md px-2 py-1 font-mono text-lg leading-none text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          {mode === "android" ? (
            <button
              type="button"
              onClick={install}
              className="micro-label rounded-full bg-[var(--accent)] px-5 py-2 font-bold text-black active:scale-[0.98]"
            >
              Install →
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-mono t-xs text-[var(--text-secondary)]">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M12 15V4m0 0L8.5 7.5M12 4l3.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M6 11H5a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2v-6a2 2 0 00-2-2h-1"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              Tap Share, then Add to Home Screen
            </span>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="micro-label ml-auto text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
