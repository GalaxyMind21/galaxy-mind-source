// BITCOIN KART · sw.js
// Offline service worker · honors the install funnel's "plays offline"
// promise. Strategy is NETWORK-FIRST with cache fallback for everything
// in scope: online players always get the newest build (the game's
// modules are unhashed, so cache-first would strand them on stale code
// after every deploy), and offline players get the last build that
// loaded. Scope is /bitcoin-kart only (Service-Worker-Allowed header in
// next.config.ts) · the rest of the site is never touched, and
// non-GET / cross-scope requests (the arcade board API, analytics)
// pass straight through to the network.

const CACHE = "bk-v1";

const PRECACHE = [
  "/bitcoin-kart",
  "/bitcoin-kart/css/style.css",
  "/bitcoin-kart/js/ai.js",
  "/bitcoin-kart/js/audio.js",
  "/bitcoin-kart/js/board.js",
  "/bitcoin-kart/js/coach.js",
  "/bitcoin-kart/js/data.js",
  "/bitcoin-kart/js/faces.js",
  "/bitcoin-kart/js/geometry.js",
  "/bitcoin-kart/js/gl.js",
  "/bitcoin-kart/js/hub.js",
  "/bitcoin-kart/js/hud.js",
  "/bitcoin-kart/js/items.js",
  "/bitcoin-kart/js/main.js",
  "/bitcoin-kart/js/math3d.js",
  "/bitcoin-kart/js/music.js",
  "/bitcoin-kart/js/physics.js",
  "/bitcoin-kart/js/race.js",
  "/bitcoin-kart/js/save.js",
  "/bitcoin-kart/js/select.js",
  "/bitcoin-kart/js/track.js",
  "/bitcoin-kart/manifest.webmanifest",
  "/bitcoin-kart/icon-180.png",
  "/bitcoin-kart/icon-192.png",
  "/bitcoin-kart/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function inScope(url) {
  // game shell + assets only · the Next-rendered share cards under
  // /bitcoin-kart/card/* are an unbounded URL space and must never
  // accumulate in (or be served stale from) the game cache
  return (
    url.origin === self.location.origin &&
    url.pathname.startsWith("/bitcoin-kart") &&
    !url.pathname.startsWith("/bitcoin-kart/card")
  );
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // score posts etc. go to the network
  const url = new URL(req.url);
  if (!inScope(url) || url.pathname === "/bitcoin-kart/sw.js") return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        // fresh copy wins · stash it for the next offline session
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => { /* quota */ });
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => {
          if (hit) return hit;
          // offline navigation to the clean URL serves the cached shell
          if (req.mode === "navigate") return caches.match("/bitcoin-kart");
          return Response.error();
        }),
      ),
  );
});
