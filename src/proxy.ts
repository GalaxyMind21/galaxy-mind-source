// Edge proxy (formerly "middleware") — generates a per-request CSP
// nonce and ships it with the response.
//
// Next 16 renamed `middleware.ts` → `proxy.ts` (same Edge runtime,
// same export shape; just a name change to clarify intent). Heed the
// deprecation: keep this file as `src/proxy.ts`, never reintroduce
// `src/middleware.ts`.
//
// Why this can't live in next.config.ts headers: a static CSP can't
// include a per-request nonce, which means it must allow either
// 'unsafe-inline' (defeats CSP for scripts) or hashes for every
// inline script (brittle, requires build-time hash tracking). A
// nonce in proxy is the modern Next pattern — generated fresh per
// request, included in script-src AND on every <script>/<Script>
// tag. Inline scripts without the matching nonce are blocked.
//
// The nonce is propagated to React via `x-galaxymind-nonce` request
// header → read in src/app/layout.tsx via `headers()` → passed to
// `<Script>` tags. Next 16's <Script> component automatically forwards
// nonce to the inline init script tags it emits.
//
// Static security headers (HSTS, X-Frame-Options, Permissions-Policy,
// X-Content-Type-Options, Referrer-Policy) stay in next.config.ts —
// they don't depend on the request and don't benefit from being in
// proxy (which adds latency to every request).

import { NextResponse, type NextRequest } from "next/server";
import {
  LATAM_ES_PATH,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  LOCALE_PREFIX_HEADER,
  hasLocalePrefix,
  isSpanishLatamAlias,
  isSpanishLatamPath,
  stripLocalePrefix,
} from "@/lib/i18n";
import { malformedPath, UPGRADE_INSECURE } from "@/lib/proxy-guards";

// Spanish exists on ONE URL: /es/spend-bitcoin-in-latin-america
// (rewritten in next.config beforeFiles). Every other /es/* 308s to
// the English path so lang="es" never lands on an English page and
// kills the browser translate prompt. Cookie/Accept-Language do not
// choose a locale.

function retireLocaleCookie(response: NextResponse, request: NextRequest) {
  if (!request.cookies.get(LOCALE_COOKIE)) return;
  response.cookies.set(LOCALE_COOKIE, "", {
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

function bounceNonLatamSpanish(request: NextRequest): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  if (!hasLocalePrefix(pathname)) return null;
  if (isSpanishLatamPath(pathname)) return null;
  const url = request.nextUrl.clone();
  url.pathname = isSpanishLatamAlias(pathname)
    ? LATAM_ES_PATH
    : stripLocalePrefix(pathname);
  const response = NextResponse.redirect(url, 308);
  retireLocaleCookie(response, request);
  return response;
}

// Skip proxy on these paths to keep static asset fetches fast.
// Anything that ships its own integrity guarantees (the embed.js with
// SRI, static images, fonts) doesn't need a per-request CSP nonce.
export const config = {
  matcher: [
    // Apply to all paths EXCEPT _next/static, _next/image, favicon,
    // robots, sitemap, embed.js (those are immutable, hashable).
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|embed\\.js|embed\\.integrity\\.json).*)",
  ],
};

// Generate a 128-bit base64-encoded nonce. Web Crypto is available in
// edge runtime; Node's `crypto` would also work but Web Crypto is the
// idiomatic edge-compatible API.
function generateNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  // base64-encode for use in HTTP headers + HTML attributes.
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

export function proxy(request: NextRequest) {
  if (malformedPath(request.nextUrl.pathname)) {
    return new NextResponse("Bad Request", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const bounced = bounceNonLatamSpanish(request);
  if (bounced) return bounced;

  const rawPath = request.nextUrl.pathname;
  const locale = isSpanishLatamPath(rawPath) ? "es" : "en";
  const hasEsPrefix = isSpanishLatamPath(rawPath);
  const gamePath = rawPath;

  // Super Saylor (/super-saylor · public/super-saylor.html) is a
  // self-contained single-file arcade game whose <script> is inline BY
  // DESIGN (the deliverable is one offline-playable HTML file). The
  // nonce CSP below would block that inline script, so the game path
  // gets its own locked-down static policy instead: inline allowed,
  // but NO external fetch targets of any kind (default-src 'none'),
  // no forms, no framing. Share links are plain <a> navigations,
  // which CSP does not gate. connect-src/media-src 'self' leaves room
  // for the optional operator-supplied licensed audio files.

  // Bitcoin Kart (/bitcoin-kart · public/bitcoin-kart/) is a static
  // directory cabinet: index.html + external ES modules + css, NO inline
  // executable scripts (the JSON-LD block is an inert data block, which
  // script-src does not gate). That lets its policy be STRICTER than
  // Super Saylor's: script-src 'self' only, no 'unsafe-inline' anywhere
  // except styles (the game toggles a few inline style props via JS).
  // connect-src 'self' covers the optional operator-supplied OGG music
  // fetches; media-src 'self' the same files via <audio> fallback paths.
  //
  // ONE Next-rendered exception lives under the game's URL space:
  // /bitcoin-kart/card/[data] (the per-run share landing + its dynamic
  // OG image) is a normal server component route, and Next inlines its
  // RSC-payload <script> tags · the static no-inline policy below would
  // break the page. The card path is carved out here and falls through
  // to the sitewide nonce CSP like every other Next route.
  if (
    (gamePath === "/bitcoin-kart" || gamePath.startsWith("/bitcoin-kart/")) &&
    !gamePath.startsWith("/bitcoin-kart/card")
  ) {
    const kartResponse = NextResponse.next();
    kartResponse.headers.set(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        // pbs.twimg.com: X profile avatars on the in-game leaderboard
        // (social board 2026-07-17 · operator-approved). The URLs come
        // from OUR arcade API (stored at X-link time), never from user
        // input, and this stays images-only on this one origin · don't
        // widen it further without the same scrutiny.
        "img-src 'self' data: https://pbs.twimg.com",
        "media-src 'self'",
        "connect-src 'self'",
        // home-screen install: the game links its own webmanifest
        "manifest-src 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "object-src 'none'",
        ...UPGRADE_INSECURE,
      ].join("; "),
    );
    retireLocaleCookie(kartResponse, request);
    return kartResponse;
  }

  // SIX DEEP gray-box (cabinet #8 prototype · 2026-07-27) · same static
  // no-inline posture as the kart: external ES modules only, so
  // script-src stays 'self' with no inline anywhere. connect-src 'self'
  // is enough because the live block seed rides our own CORS-open
  // /api/heartbeat · the game never talks to mempool.space directly
  // (proxying chain state through our CDN was a deliberate call: the
  // per-game CSP never has to name a third-party origin).
  if (gamePath === "/six-deep" || gamePath.startsWith("/six-deep/")) {
    const sixResponse = NextResponse.next();
    sixResponse.headers.set(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "object-src 'none'",
        ...UPGRADE_INSECURE,
      ].join("; "),
    );
    retireLocaleCookie(sixResponse, request);
    return sixResponse;
  }

  // CHOP cabinet (flagship candidate · 2026-07-27) · static no-inline
  // posture; three.js is VENDORED same-origin (public/chop/vendor/) so
  // script-src stays 'self'. Live block data rides our own CORS-open
  // /api/chop-block · connect-src never names a third party.
  //
  // ONE Next-rendered exception lives under the game's URL space:
  // /chop/card/[data] (the per-run share landing + its dynamic OG
  // image) is a normal server component route, and Next inlines its
  // RSC-payload <script> tags · the static no-inline policy below would
  // break the page. Carved out here, same as /bitcoin-kart/card.
  if (
    (gamePath === "/chop" || gamePath.startsWith("/chop/")) &&
    !gamePath.startsWith("/chop/card")
  ) {
    const chopResponse = NextResponse.next();
    chopResponse.headers.set(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "manifest-src 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "object-src 'none'",
        ...UPGRADE_INSECURE,
      ].join("; "),
    );
    retireLocaleCookie(chopResponse, request);
    return chopResponse;
  }

  if (gamePath === "/super-saylor" || gamePath === "/super-saylor.html") {
    const gameResponse = NextResponse.next();
    gameResponse.headers.set(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        // 'self' is only for arcade-open-browser.js (X/IG in-app coach).
        // The game itself stays one inline <script>.
        "script-src 'unsafe-inline' 'self'",
        "style-src 'unsafe-inline'",
        "img-src 'self' data:",
        "media-src 'self'",
        "connect-src 'self'",
        // the game page links its own webmanifest (home-screen install)
        "manifest-src 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "object-src 'none'",
        ...UPGRADE_INSECURE,
      ].join("; "),
    );
    retireLocaleCookie(gameResponse, request);
    return gameResponse;
  }

  const nonce = generateNonce();

  // CSP with the nonce. Style-src keeps 'unsafe-inline' because
  // framer-motion + recharts inject inline style attributes during
  // animation — replacing them would require giving up animations
  // entirely or writing a per-style hash list (brittle).
  //
  // 'strict-dynamic' lets the nonced script load further scripts
  // (e.g. Turnstile, Vercel Analytics chunks) without us needing to
  // enumerate every CDN. Modern browsers honor strict-dynamic; legacy
  // browsers fall back to host-source allowances which we keep as a
  // safety net.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://va.vercel-scripts.com https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // img-src · 'self' for our own routes (icons, OG cards), data:
    // for inline SVGs/data URIs, and HTTPS wildcard so vendor profile
    // pictures load from any host they're hosted on. The Nostr kind:0
    // metadata field can point at primal.net, image.nostr.build,
    // blossom relays, ipfs gateways, the vendor's own domain, etc. ·
    // there's no canonical CDN like X has with unavatar.io. Vendor-
    // controlled URLs are pre-vetted at vendor-add time + the
    // enrichment script verifies HTTPS-only · low risk surface.
    "img-src 'self' data: https:",
    // Vercel Analytics + Turnstile beacons. challenges.cloudflare.com is
    // REQUIRED for Turnstile — the widget XHR/fetches back to Cloudflare
    // for challenge verification. Without it, the captcha verification
    // hangs and silently times out, leaving form submissions to go
    // through without captcha protection. Documented requirement per
    // Cloudflare Turnstile CSP guide.
    //
    // Nostr relays (wss://) are needed by the client-side
    // VendorRecentPosts component on /v/[slug] · same relay set
    // NOSTR_DEFAULT_RELAYS uses server-side. If the relay set in
    // lib/nostr-activity.ts changes, mirror the change here · the
    // browser blocks WebSocket connections that aren't in connect-src.
    "connect-src 'self' https://va.vercel-scripts.com https://vitals.vercel-insights.com https://challenges.cloudflare.com wss://relay.damus.io wss://relay.primal.net wss://nos.lol",
    // Allow Turnstile + Vercel Analytics iframes (Turnstile renders in an iframe).
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // object-src 'none' · explicit kill-switch for <object>/<embed>/
    // <applet> plugin-injection vectors (Flash/PDF/Silverlight-era
    // XSS). CSP3 browsers fall this back to default-src 'self', but
    // (a) we never embed plugins so 'none' is strictly correct, and
    // (b) older engines + CSP evaluators don't apply the default-src
    // fallback for object-src — an explicit directive removes the
    // ambiguity at zero cost / zero regression risk (audit 2026-05).
    "object-src 'none'",
    ...UPGRADE_INSECURE,
  ].join("; ");

  // Pass nonce to React via request header — layout.tsx reads it via
  // next/headers and threads it to <Script nonce={nonce}>.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-galaxymind-nonce", nonce);
  requestHeaders.set(LOCALE_HEADER, locale);
  requestHeaders.set(LOCALE_PREFIX_HEADER, hasEsPrefix ? "1" : "0");

  // Do not rewrite /es here. next.config.ts beforeFiles strips the
  // prefix on the LATAM page only, after this proxy runs once.
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  retireLocaleCookie(response, request);
  return response;
}
