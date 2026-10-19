/**
 * in-app-browser.ts · detect X / Instagram / Facebook / TikTok WebViews.
 *
 * Pure: no I/O, no Date, no Math.random. The React banner and the
 * static-game helper (public/arcade-open-browser.js) share these
 * patterns; scripts/test-in-app-browser.ts asserts the twin still
 * contains every source string below.
 *
 * We can DETECT these WebViews. We cannot force Safari or Chrome open
 * from inside them on iOS. The banner coaches the tap (··· → Open in
 * Safari). Android may honor an intent:// to Chrome; that is best-effort.
 */

export type InAppApp = "x" | "facebook" | "instagram" | "tiktok" | null;

export type InAppBrowser = {
  inApp: boolean;
  app: InAppApp;
  ios: boolean;
  android: boolean;
};

/** Kept as source strings so the public JS twin can be grepped for drift. */
export const IN_APP_PATTERNS = {
  crawler: "Twitterbot|facebookexternalhit|Facebot|InstagramBot",
  x: "TwitterAndroid|\\bTwitter\\b",
  facebook: "FBAN|FBAV|FB_IAB|FB4A|FBIOS",
  instagram: "\\bInstagram\\b",
  tiktok: "BytedanceWebview|TikTok|musical_ly",
} as const;

const CRAWLER_RE = new RegExp(IN_APP_PATTERNS.crawler, "i");
const X_RE = new RegExp(IN_APP_PATTERNS.x, "i");
const FB_RE = new RegExp(IN_APP_PATTERNS.facebook, "i");
const IG_RE = new RegExp(IN_APP_PATTERNS.instagram, "i");
const TT_RE = new RegExp(IN_APP_PATTERNS.tiktok, "i");

export function detectInAppBrowser(
  ua: string,
  opts: { standalone?: boolean } = {},
): InAppBrowser {
  const empty: InAppBrowser = {
    inApp: false,
    app: null,
    ios: false,
    android: false,
  };
  if (opts.standalone) return empty;
  if (!ua) return empty;
  if (CRAWLER_RE.test(ua)) return empty;

  const ios = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);

  let app: InAppApp = null;
  if (X_RE.test(ua)) app = "x";
  else if (IG_RE.test(ua)) app = "instagram";
  else if (FB_RE.test(ua)) app = "facebook";
  else if (TT_RE.test(ua)) app = "tiktok";

  return { inApp: app != null, app, ios, android };
}

/** Chrome intent URL for an https page. Best-effort on Android WebViews. */
export function chromeIntentUrl(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const path = `${u.host}${u.pathname}${u.search}`;
  return `intent://${path}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
}

export const INAPP_STORAGE_KEY = "gm:open-in-browser";

export const INAPP_COPY = {
  kicker: "Open in your full browser",
  lead: {
    x: "X's in-app browser cannot run this game properly.",
    facebook: "Facebook's in-app browser cannot run this game properly.",
    instagram: "Instagram's in-app browser cannot run this game properly.",
    tiktok: "TikTok's in-app browser cannot run this game properly.",
  },
  ios: {
    x: "Tap ··· then Open in Safari.",
    facebook: "Tap ··· then Open in External Browser.",
    instagram: "Tap ··· then Open in External Browser.",
    tiktok: "Tap ··· then Open in browser.",
  },
  androidStep: "Tap ··· then Open in browser. Or:",
  androidCta: "Open in Chrome",
  copyCta: "Copy link",
  copied: "Copied",
  dismiss: "I'll stay here",
} as const;
