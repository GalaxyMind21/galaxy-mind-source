"use client";

/* =====================================================================
 * AddToHomeScreen · a calm, always-there "install this like an app"
 * card for the arcade (2026-07-10). Distinct from InstallNudge (the
 * post-run bottom-sheet that fires once): this is a deliberate, elegant
 * affordance a player can act on whenever they want.
 *
 * Only renders when the app is actually installable and NOT already
 * installed. Android/desktop Chrome fires the real install prompt;
 * iOS Safari has no install API, so it reveals the exact Share → Add
 * to Home Screen steps with a preview of the real app icon · so it
 * reads like adding a genuine iPhone app.
 * ===================================================================== */

import { useEffect, useRef, useState } from "react";

type BipEvent = Event & { prompt: () => Promise<void> };
type Mode = "android" | "ios";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  const ua = navigator.userAgent || "";
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as Mac · a touch-capable Mac is really an iPad.
  const iPadOS =
    navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1;
  return iOSDevice || iPadOS;
}

export function AddToHomeScreen({
  gameName = "Node Runner",
}: {
  gameName?: string;
} = {}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [iosOpen, setIosOpen] = useState(false);
  const deferredRef = useRef<BipEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) return; // already an app on this device
    const ios = isIOS();
    // Android / desktop Chrome · capture the real prompt when offered.
    // iOS never fires this in the wild, but keep the guard so a spurious
    // event can't override the coached iOS path.
    const onBip = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BipEvent;
      if (!ios) setMode("android");
    };
    window.addEventListener("beforeinstallprompt", onBip);
    // iOS has no prompt event · offer the coached path immediately.
    if (ios) setMode("ios");
    const onInstalled = () => setMode(null);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    const d = deferredRef.current;
    if (!d) return;
    try {
      await d.prompt();
    } catch {
      /* user dismissed the native sheet · fine */
    }
    deferredRef.current = null;
  }

  if (!mode) return null;

  return (
    <section
      aria-label={`Add ${gameName} to your home screen`}
      className="mt-8 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 elevate"
    >
      <div className="flex items-start gap-4">
        {/* The real app icon · so it previews the actual home-screen tile. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/apple-icon"
          alt=""
          width={56}
          height={56}
          className="h-14 w-14 shrink-0 rounded-[14px] border border-[var(--border-subtle)] shadow-[0_6px_20px_-8px_rgba(0,0,0,0.7)]"
        />
        <div className="min-w-0 flex-1">
          <p className="font-mono t-xs uppercase tracking-[0.2em] text-[var(--accent-ink)]">
            Play it like an app
          </p>
          <h3 className="mt-0.5 text-base font-semibold text-[var(--text-primary)]">
            Keep {gameName} one tap away
          </h3>
          <p className="mt-1 text-sm leading-snug text-[var(--text-secondary)]">
            Add it to your home screen · it opens full-screen, no app
            store and no account. Tomorrow&apos;s tape is one tap away.
          </p>

          <div className="mt-3">
            {mode === "android" ? (
              <button
                type="button"
                onClick={install}
                className="micro-label rounded-full bg-[var(--accent)] px-5 py-2 font-bold text-black active:scale-[0.98]"
              >
                Install →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIosOpen((v) => !v)}
                aria-expanded={iosOpen}
                className="micro-label rounded-full border border-[var(--accent)] px-5 py-2 font-bold text-[var(--accent-ink)] active:scale-[0.98]"
              >
                Add to Home Screen →
              </button>
            )}
          </div>

          {mode === "ios" && iosOpen && (
            <ol className="mt-4 space-y-2 border-t border-[var(--border-subtle)] pt-4">
              <li className="flex items-center gap-2.5 text-sm text-[var(--text-secondary)]">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--bg-elevated-2)] font-mono t-xs text-[var(--accent-ink)]">
                  1
                </span>
                <span className="inline-flex items-center gap-1.5">
                  Tap the
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
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
                  Share button in Safari
                </span>
              </li>
              <li className="flex items-center gap-2.5 text-sm text-[var(--text-secondary)]">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--bg-elevated-2)] font-mono t-xs text-[var(--accent-ink)]">
                  2
                </span>
                <span>
                  Choose{" "}
                  <span className="font-medium text-[var(--text-primary)]">
                    Add to Home Screen
                  </span>
                </span>
              </li>
              <li className="flex items-center gap-2.5 text-sm text-[var(--text-secondary)]">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--bg-elevated-2)] font-mono t-xs text-[var(--accent-ink)]">
                  3
                </span>
                <span>Tap Add · the ₿ icon lands on your home screen.</span>
              </li>
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
