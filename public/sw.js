/* Galaxy Mind service worker · push notifications ONLY (2026-06-10).
 *
 * Deliberately NO fetch handler / NO caching · a rogue SW cache is
 * the classic way a site serves stale HTML forever. This worker
 * exists solely so the browser can deliver push events; the site's
 * caching strategy stays 100% server/CDN-side.
 *
 * Security (audit 2026-07-09): notification click URLs are allow-listed
 * to same-origin relative paths only. Absolute / javascript: / data:
 * URLs from a compromised VAPID payload cannot openWindow off-site.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Only relative path URLs on this origin · e.g. /stack, /float. */
function safeClickPath(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) {
    return "/stack";
  }
  // Must start with single slash, not protocol-relative //
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/stack";
  // Charset: path + query + hash only (no scheme, no backslash)
  if (!/^\/[A-Za-z0-9/_\-.~?=&%#]*$/.test(raw)) return "/stack";
  return raw;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* malformed payload · show a generic alert rather than nothing */
  }
  const title = data.title || "Galaxy Mind";
  const options = {
    body: data.body || "The Buying Gauge moved.",
    icon: "/apple-icon",
    badge: "/icon",
    tag: data.tag || "galaxymind-alert", // collapses repeat alerts
    data: { url: safeClickPath(data.url || "/stack") },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeClickPath(
    (event.notification.data && event.notification.data.url) || "/stack",
  );
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((tabs) => {
        for (const tab of tabs) {
          if (tab.url.includes("galaxymind.space") && "focus" in tab) {
            tab.navigate(url);
            return tab.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
