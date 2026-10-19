/** Next's router, pointed at files the iOS shell can actually open. */
var GAME_ROOTS = [
  "/bitcoin-kart",
  "/chop",
  "/super-saylor",
  "/wen",
  "/gauntlet",
  "/runner",
  "/horizon",
  "/trail",
];

function inAppHref(href) {
  var url;
  try {
    url = new URL(href, location.href);
  } catch (e) {
    return "/index.html";
  }
  var path = url.pathname;
  if (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1);
  if (path === "" || path === "/" || path === "/arcade" || path === "/index.html") {
    return "/index.html";
  }
  for (var i = 0; i < GAME_ROOTS.length; i++) {
    if (path === GAME_ROOTS[i]) return GAME_ROOTS[i] + "/index.html" + url.search + url.hash;
  }
  if (url.origin === location.origin) return url.pathname + url.search + url.hash;
  return "/index.html";
}

export function useRouter() {
  return {
    push(href) { location.assign(inAppHref(href)); },
    replace(href) { location.replace(inAppHref(href)); },
    back() { history.back(); },
    prefetch() {},
  };
}

export function usePathname() {
  return location.pathname;
}

export function useSearchParams() {
  return new URLSearchParams(location.search);
}
