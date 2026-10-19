"use client";

/**
 * Coach people out of X / Instagram / Facebook / TikTok in-app browsers.
 *
 * Detection is honest; escape is not automatic. iOS will not let a page
 * inside X's WebView launch Safari. Android may honor an intent:// to
 * Chrome. The banner names the tap we cannot fire, then gets out of
 * the way. One dismiss, remembered. Never covers the game as a modal
 * and never blocks play.
 */

import { useEffect, useState } from "react";
import { track } from "@vercel/analytics";
import {
  chromeIntentUrl,
  detectInAppBrowser,
  INAPP_COPY,
  INAPP_STORAGE_KEY,
  type InAppApp,
} from "@/lib/in-app-browser";

function alreadyDismissed(): boolean {
  try {
    return window.localStorage.getItem(INAPP_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone ===
      true
  );
}

export function InAppBrowserBanner() {
  const [app, setApp] = useState<InAppApp>(null);
  const [ios, setIos] = useState(false);
  const [android, setAndroid] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (alreadyDismissed() || standalone()) return;
    const hit = detectInAppBrowser(navigator.userAgent || "", {
      standalone: standalone(),
    });
    if (!hit.inApp || (!hit.ios && !hit.android)) return;
    setApp(hit.app);
    setIos(hit.ios);
    setAndroid(hit.android);
    track("inapp_browser_banner", { app: hit.app ?? "other", action: "shown" });
  }, []);

  if (!app) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(INAPP_STORAGE_KEY, "1");
    } catch {
      /* private mode · just hide */
    }
    track("inapp_browser_banner", { app: app ?? "other", action: "dismiss" });
    setApp(null);
  }

  function openChrome() {
    const intent = chromeIntentUrl(window.location.href);
    if (!intent) return;
    track("inapp_browser_banner", { app: app ?? "other", action: "chrome" });
    window.location.href = intent;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      track("inapp_browser_banner", { app: app ?? "other", action: "copy" });
    } catch {
      /* WebView clipboard is spotty · the ··· path still works */
    }
  }

  const lead = INAPP_COPY.lead[app];
  const step = ios ? INAPP_COPY.ios[app] : INAPP_COPY.androidStep;

  return (
    <aside
      role="status"
      className="mb-4 rounded-xl border border-[var(--accent)]/40 bg-[var(--bg-elevated)] px-4 py-3"
    >
      <p className="micro-label text-[var(--accent-ink)]">
        {INAPP_COPY.kicker}
      </p>
      <p className="mt-1 text-sm text-[var(--text-primary)]">{lead}</p>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">{step}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {android && (
          <button
            type="button"
            onClick={openChrome}
            className="micro-label min-h-[44px] rounded-full bg-[var(--accent)] px-4 font-semibold text-black"
          >
            {INAPP_COPY.androidCta}
          </button>
        )}
        {ios && (
          <button
            type="button"
            onClick={() => void copyLink()}
            className="micro-label min-h-[44px] rounded-full border border-[var(--accent)]/45 px-4 text-[var(--accent-ink)]"
          >
            {copied ? INAPP_COPY.copied : INAPP_COPY.copyCta}
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="micro-label min-h-[44px] rounded-full border border-[var(--border-subtle)] px-4 text-[var(--text-secondary)]"
        >
          {INAPP_COPY.dismiss}
        </button>
      </div>
    </aside>
  );
}
